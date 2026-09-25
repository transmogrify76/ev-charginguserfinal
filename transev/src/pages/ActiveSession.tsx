// src/pages/ActiveSession.tsx
//
// Shows the customer's in-progress charging session(s) using the dedicated
// live-sessions contract (section 5.5): GET /operations/live-sessions is a
// full-state SSE stream whose every frame carries the customer's complete
// current live-session collection - apply it as a full replace, never merge.
// GET /operations/live-sessions/snapshot is the JSON read/recovery
// equivalent, used for the initial paint and as a fallback poll if the
// stream drops. This deliberately does NOT use the generic
// /operations/events + /operations/realtime/stream feed, which per the
// handoff is only for durable invalidation/replay, not the state contract
// for this view.
//
// The live collection only ever contains still-open ACTIVE/STOP_PENDING/
// RECONCILIATION_REQUIRED sessions - a session that completes simply
// disappears from the next frame. To still show a brief "you're done, here's
// your receipt" moment, we detect a session dropping out of the live list
// and fetch its final detail once via GET /charging-sessions/{id}.
//
// The first session gets a "hero" treatment (ring gauge, live ticking timer,
// energy sparkline, live projected cost) since that's the one someone
// actually watches while charging; any additional sessions are listed
// compactly below it.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  FaHome,
  FaBolt,
  FaClock,
  FaSync,
  FaWifi,
  FaExclamationTriangle,
  FaCheckCircle,
  FaSpinner,
  FaReceipt,
  FaPlug,
  FaBatteryHalf,
  FaRupeeSign,
} from 'react-icons/fa';
import { getChargingSession, getLiveSessionsSnapshot, openLiveSessionsStream, stopChargingSession } from '../services/customerApi';
import { ChargingSessionResponse, ChargingSessionState } from '../types/auth';
import { RingGauge, EnergySparkline } from '../components/ChargingGauges';

const FALLBACK_POLL_MS = 15000;
const MAX_SAMPLES = 40;

const STATUS_LABEL: Record<ChargingSessionState, { label: string; color: string }> = {
  START_PENDING: { label: 'Starting', color: 'text-yellow-600' },
  ACTIVE: { label: 'Active', color: 'text-green-600' },
  STOP_PENDING: { label: 'Stopping', color: 'text-orange-600' },
  COMPLETED: { label: 'Completed', color: 'text-gray-600' },
  FAILED: { label: 'Failed', color: 'text-red-600' },
  RECONCILIATION_REQUIRED: { label: 'Confirming', color: 'text-orange-600' },
};

const kwh = (wh?: number | null) => (wh == null ? null : wh / 1000);
const fmtKwh = (wh?: number | null) => (wh == null ? '—' : `${(wh / 1000).toFixed(3)}`);


const chargerLabel = (session: ChargingSessionResponse) => {
  const name = session.charger?.name;
  const publicId = session.charger?.charger_id;
  const internalId = session.charger?.id;
  if (name) return name;
  if (publicId) return publicId;
  if (internalId && internalId !== '00000000-0000-0000-0000-000000000000') return `Charger ${internalId.slice(0, 8)}`;
  return 'Charger';
};

const chargerIdLabel = (session: ChargingSessionResponse) => session.charger?.charger_id || null;

const hubLabel = (session: ChargingSessionResponse) => session.charger?.hub?.name;

const connectorLabel = (session: ChargingSessionResponse) => {
  const c = session.connector;
  if (!c) return null;
  return c.type ? `${c.type}${c.number ? ` · Connector ${c.number}` : ''}` : c.number ? `Connector ${c.number}` : null;
};

const isDisconnected = (session: ChargingSessionResponse) =>
  session.connection_state === 'DISCONNECTED' || session.connection_state === 'OFFLINE';

/**
 * Cosmetic-only formatting of a raw backend code, never a translation or
 * interpretation. Per handoff v14, stop-reason codes must be shown as-is,
 * not turned into inferred prose without product-owned presentation rules.
 */
const formatRawCode = (v?: string | null) => (v ? v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : undefined);

const LIMIT_SOURCE_LABEL: Record<string, string> = {
  CUSTOMER_ENERGY: 'your limit',
  CUSTOMER_TIME: 'your limit',
  CUSTOMER_MONEY: 'your limit',
  WALLET: 'wallet balance',
};

const LIMIT_TYPE_ICON: Record<string, React.ReactNode> = {
  ENERGY: <FaBatteryHalf />,
  TIME: <FaClock />,
  MONEY: <FaRupeeSign />,
};
const LIMIT_TYPE_LABEL: Record<string, string> = { ENERGY: 'Energy limit', TIME: 'Time limit', MONEY: 'Amount limit' };

const elapsedLabel = (startedAt: string, now: number) => {
  const started = new Date(startedAt).getTime();
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

const ActiveSession: React.FC = () => {
  const history = useHistory();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveSessions, setLiveSessions] = useState<Record<string, ChargingSessionResponse>>({});
  const [liveOrder, setLiveOrder] = useState<string[]>([]);
  const [justCompleted, setJustCompleted] = useState<Record<string, ChargingSessionResponse>>({});
  const [energySamples, setEnergySamples] = useState<Record<string, number[]>>({});
  const [stopping, setStopping] = useState<string | null>(null);
  const [streamConnected, setStreamConnected] = useState(false);
  const [now, setNow] = useState(Date.now());

  const streamRef = useRef<{ close: () => void } | null>(null);
  const pollRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const prevIdsRef = useRef<Set<string>>(new Set());

  const trackEnergySample = useCallback((session: ChargingSessionResponse) => {
    const kWh = kwh(session.consumed_wh ?? session.latest_meter_wh);
    if (kWh == null) return;
    setEnergySamples((prev) => {
      const existing = prev[session.id] || [];
      if (existing[existing.length - 1] === kWh) return prev;
      return { ...prev, [session.id]: [...existing, kWh].slice(-MAX_SAMPLES) };
    });
  }, []);

  /** A session that just dropped out of the live collection - fetch its final detail once so the receipt is still visible for a moment. */
  const captureJustCompleted = useCallback(async (sessionId: string) => {
    try {
      const detail = await getChargingSession(sessionId);
      setJustCompleted((prev) => ({ ...prev, [sessionId]: detail }));
    } catch (err) {
      console.error(`Failed to fetch final detail for completed session ${sessionId}`, err);
    }
  }, []);

  const applySessionsFrame = useCallback(
    (sessions: ChargingSessionResponse[]) => {
      const nextIds = new Set(sessions.map((s) => s.id));
      // Anything that was live a moment ago and isn't anymore just completed.
      for (const id of prevIdsRef.current) {
        if (!nextIds.has(id)) captureJustCompleted(id);
      }
      prevIdsRef.current = nextIds;

      setLiveOrder(sessions.map((s) => s.id));
      setLiveSessions(Object.fromEntries(sessions.map((s) => [s.id, s])));
      sessions.forEach(trackEnergySample);
      setError(null);
      setLoading(false);
    },
    [captureJustCompleted, trackEnergySample]
  );

  const loadSnapshot = useCallback(async () => {
    try {
      const snapshot = await getLiveSessionsSnapshot();
      applySessionsFrame(snapshot.sessions);
    } catch (err: any) {
      const message = err.message || 'Failed to load charging sessions';
      setError(message);
      toast.error(message);
      setLoading(false);
    }
  }, [applySessionsFrame]);

  useEffect(() => {
    setLoading(true);
    loadSnapshot();

    streamRef.current = openLiveSessionsStream({
      onSessions: (payload) => {
        setStreamConnected(true);
        applySessionsFrame(payload.sessions);
      },
      onError: () => setStreamConnected(false),
      onClose: () => setStreamConnected(false),
    });

    // Defensive fallback poll in case SSE is unavailable in this environment.
    pollRef.current = window.setInterval(() => {
      if (!streamConnected) loadSnapshot();
    }, FALLBACK_POLL_MS);

    // Drives the live elapsed-time readout independent of data refreshes.
    tickRef.current = window.setInterval(() => setNow(Date.now()), 1000);

    return () => {
      streamRef.current?.close();
      if (pollRef.current) window.clearInterval(pollRef.current);
      if (tickRef.current) window.clearInterval(tickRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStop = async (sessionId: string) => {
    setStopping(sessionId);
    try {
      await stopChargingSession(sessionId, 'User requested stop');
      toast.info('Stop requested. This may take a moment to complete.');
      // The live stream will reflect STOP_PENDING/removal on its own; no REST refetch needed here.
    } catch (err: any) {
      toast.error(err.message || 'Stop failed');
    } finally {
      setStopping(null);
    }
  };

  const handleRefresh = () => {
    setJustCompleted({});
    loadSnapshot();
  };

  const liveList = liveOrder.map((id) => liveSessions[id]).filter(Boolean);
  const completedList = Object.values(justCompleted).filter((s) => !liveSessions[s.id]);
  const ongoingSessions = [...liveList, ...completedList];
  const heroSession = ongoingSessions[0];
  const otherSessions = ongoingSessions.slice(1);

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-gradient-to-br from-brand-50 via-white to-blue-50 p-3 sm:p-4">
        <div className="max-w-md sm:max-w-xl mx-auto animate-fade-in">
          <div className="h-11 w-11 rounded-full skeleton mb-4" />
          <div className="rounded-3xl overflow-hidden shadow-xl">
            <div className="h-64 skeleton rounded-none" />
            <div className="bg-white p-4 sm:p-6 space-y-3">
              <div className="h-24 skeleton" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-br from-brand-50 via-white to-blue-50 p-4">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 max-w-md w-full text-center animate-scale-in">
          <p className="text-red-700">{error}</p>
          <button
            onClick={handleRefresh}
            className="btn-press mt-4 px-6 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 transition"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] overflow-y-auto bg-gradient-to-br from-brand-50 via-white to-blue-50 p-3 sm:p-4">
      <div className="max-w-md sm:max-w-xl mx-auto pb-[calc(env(safe-area-inset-bottom)+1rem)] animate-fade-in">
        <div className="mb-4 flex items-center justify-between">
          <button
            onClick={() => history.push('/dashboard')}
            className="btn-press p-3 bg-brand-600 rounded-full shadow-lg hover:bg-brand-700 hover:shadow-glow transition-all duration-200"
            aria-label="Back to dashboard"
          >
            <FaHome className="text-white text-xl" />
          </button>
          <button
            onClick={handleRefresh}
            className="btn-press flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-white/70 backdrop-blur-sm text-ink-500 shadow-sm"
          >
            <FaWifi className={streamConnected ? 'text-green-500 animate-pulse' : 'text-ink-300'} />
            {streamConnected ? 'Live' : 'Polling'}
            <FaSync className="ml-1" />
          </button>
        </div>

        {!heroSession ? (
          <div className="bg-white/80 backdrop-blur-md rounded-3xl shadow-xl overflow-hidden animate-slide-up p-10 text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-brand-50 flex items-center justify-center mb-3">
              <FaBolt className="text-2xl text-brand-300" />
            </div>
            <p className="text-gray-500 font-medium">No active charging session</p>
            <p className="text-gray-400 text-sm mt-0.5">Scan a charger to start</p>
          </div>
        ) : (
          <div className="bg-white rounded-3xl shadow-xl overflow-hidden animate-slide-up">
            {/* Hero header */}
            <div className="bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 px-5 sm:px-6 pt-6 pb-8 text-white relative overflow-hidden">
              <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10" />
              <div className="absolute -bottom-16 -left-8 w-40 h-40 rounded-full bg-white/5" />
              <div className="relative flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white/20 flex items-center gap-1">
                      <span className="relative flex h-2 w-2">
                        {heroSession.state === 'ACTIVE' && (
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                        )}
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
                      </span>
                      {STATUS_LABEL[heroSession.state]?.label || heroSession.state}
                    </span>
                    {isDisconnected(heroSession)
                      ? heroSession.state === 'ACTIVE' && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-400/90 text-amber-950 flex items-center gap-1">
                            <FaExclamationTriangle /> Disconnected
                          </span>
                        )
                      : null}
                  </div>
                  <h2 className="text-lg font-bold mt-2 truncate">{chargerLabel(heroSession)}</h2>
                  {chargerIdLabel(heroSession) && (
                    <p className="text-brand-100/80 text-[11px] font-mono truncate">ID: {chargerIdLabel(heroSession)}</p>
                  )}
                  {hubLabel(heroSession) && <p className="text-brand-100 text-xs truncate">{hubLabel(heroSession)}</p>}
                  {connectorLabel(heroSession) && (
                    <p className="text-brand-100 text-xs flex items-center gap-1 mt-1">
                      <FaPlug /> {connectorLabel(heroSession)}
                    </p>
                  )}
                </div>
                <span className="text-2xl font-mono tabular-nums font-bold bg-white/15 rounded-xl px-3 py-1.5 flex-shrink-0">
                  {elapsedLabel(heroSession.started_at, now)}
                </span>
              </div>

              {/* Ring gauge + headline energy number */}
              <div className="relative flex items-center justify-center gap-6 mt-6">
                <RingGauge percent={heroSession.soc_percent != null ? parseFloat(heroSession.soc_percent) : null} active={heroSession.state === 'ACTIVE'}>
                  <div className="flex flex-col items-center">
                    {heroSession.soc_percent != null ? (
                      <>
                        <span className="text-2xl font-bold text-white">{parseFloat(heroSession.soc_percent).toFixed(0)}%</span>
                        <span className="text-[10px] text-brand-100 flex items-center gap-1">
                          <FaBatteryHalf /> SoC
                        </span>
                      </>
                    ) : (
                      <FaBolt className="text-3xl text-white animate-pulse" />
                    )}
                  </div>
                </RingGauge>
                <div className="text-left">
                  <p className="text-brand-100 text-xs">Energy delivered</p>
                  <p className="text-3xl font-bold tabular-nums leading-tight">
                    {fmtKwh(heroSession.consumed_wh ?? heroSession.latest_meter_wh)}
                    <span className="text-base font-medium text-brand-100"> kWh</span>
                  </p>
                  {heroSession.projected_amount && (
                    <p className="text-brand-100 text-xs mt-1 flex items-center gap-1">
                      <FaRupeeSign /> Est. {heroSession.currency || 'INR'} {heroSession.projected_amount} so far
                    </p>
                  )}
                </div>
              </div>

              {heroSession.limit && (heroSession.limit.energy_limit_wh > 0 || heroSession.limit.max_duration_seconds > 0) && (
                <div className="relative mt-4 bg-white/10 rounded-2xl px-4 py-3 text-xs">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-white mb-1.5">
                    {LIMIT_TYPE_ICON[heroSession.limit.type] || <FaBolt />}
                    Started with: {LIMIT_TYPE_LABEL[heroSession.limit.type] || heroSession.limit.type}
                  </div>
                  {heroSession.limit.requested_value && heroSession.limit.requested_unit && (
                    <p className="text-brand-100 mb-1">
                      You requested: <span className="text-white font-semibold">{heroSession.limit.requested_value} {heroSession.limit.requested_unit}</span>
                    </p>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-brand-100">
                    {heroSession.limit.energy_limit_wh > 0 && (
                      <span>
                        Enforcing up to <span className="text-white font-medium">{(heroSession.limit.energy_limit_wh / 1000).toFixed(2)} kWh</span>
                        {heroSession.limit.energy_limit_source && LIMIT_SOURCE_LABEL[heroSession.limit.energy_limit_source] && (
                          <> ({LIMIT_SOURCE_LABEL[heroSession.limit.energy_limit_source]})</>
                        )}
                      </span>
                    )}
                    {heroSession.limit.max_duration_seconds > 0 && (
                      <span>
                        Enforcing up to <span className="text-white font-medium">{Math.round(heroSession.limit.max_duration_seconds / 60)} min</span>
                        {heroSession.limit.duration_limit_source && LIMIT_SOURCE_LABEL[heroSession.limit.duration_limit_source] && (
                          <> ({LIMIT_SOURCE_LABEL[heroSession.limit.duration_limit_source]})</>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Sparkline */}
            <div className="px-5 sm:px-6 pt-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium text-ink-400">Live energy trend</p>
                {heroSession.meter_freshness === 'STALE' && (
                  <span className="text-[10px] text-orange-500 flex items-center gap-1">
                    <FaExclamationTriangle /> stale reading
                  </span>
                )}
              </div>
              <EnergySparkline values={energySamples[heroSession.id] || []} />
            </div>

            {/* Stats + actions */}
            <div className="p-5 sm:p-6 pt-3 space-y-4">
              {isDisconnected(heroSession) && heroSession.state === 'ACTIVE' && (
                <div className="bg-amber-50 border-l-4 border-amber-400 rounded-lg p-3 flex items-start gap-2 animate-slide-up">
                  <FaExclamationTriangle className="text-amber-500 mt-0.5 flex-shrink-0" />
                  <p className="text-amber-800 text-xs">The connector is reporting disconnected right now.</p>
                </div>
              )}

              {heroSession.state === 'COMPLETED' && (
                <div className="bg-green-50 border border-green-100 rounded-2xl p-4 animate-slide-up">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-green-700 mb-2">
                    <FaReceipt /> Receipt
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm text-gray-600">
                    {heroSession.total_kwh && <span>{heroSession.total_kwh} kWh</span>}
                    {heroSession.total_amount && (
                      <span className="font-semibold text-gray-800">
                        {heroSession.currency || 'INR'} {heroSession.total_amount}
                      </span>
                    )}
                    <span className="col-span-2 text-xs">Settlement: {heroSession.settlement_status || 'pending'}</span>
                    {heroSession.financial?.payment_status && (
                      <span className="col-span-2 text-xs flex items-center gap-1">
                        <FaCheckCircle className="text-green-600" />
                        {heroSession.financial.payment_method || 'Wallet'} · {heroSession.financial.payment_status}
                      </span>
                    )}
                    {(heroSession.stop?.requested_reason || heroSession.stop?.ocpp_reason || heroSession.stop_reason) && (
                      <span className="col-span-2 text-xs text-gray-400">
                        Stop reason: {formatRawCode(heroSession.stop?.requested_reason || heroSession.stop_reason)}
                        {heroSession.stop?.ocpp_reason && ` (OCPP: ${heroSession.stop.ocpp_reason})`}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {heroSession.state === 'ACTIVE' && (
                <button
                  onClick={() => handleStop(heroSession.id)}
                  disabled={stopping === heroSession.id}
                  className="btn-press w-full bg-gradient-to-r from-red-600 to-red-500 hover:shadow-lg text-white font-semibold py-3.5 rounded-2xl flex items-center justify-center gap-2 transition disabled:opacity-50"
                >
                  {stopping === heroSession.id ? (
                    <FaSpinner className="animate-spin" />
                  ) : (
                    <>
                      <FaBolt /> Stop Charging
                    </>
                  )}
                </button>
              )}
              {heroSession.state === 'STOP_PENDING' && (
                <div className="flex items-center justify-center gap-2 text-orange-600 text-sm py-2">
                  <FaSpinner className="animate-spin" /> Stopping…
                </div>
              )}
              {heroSession.state === 'START_PENDING' && (
                <div className="flex items-center justify-center gap-2 text-yellow-600 text-sm py-2">
                  <FaClock className="animate-pulse" /> Waiting for the charger to confirm…
                </div>
              )}
              {heroSession.state === 'RECONCILIATION_REQUIRED' && (
                <div className="flex items-center justify-center gap-2 text-orange-600 text-sm py-2">
                  <FaExclamationTriangle /> Confirming with the charger…
                </div>
              )}
            </div>
          </div>
        )}

        {/* Other sessions, compact */}
        {otherSessions.length > 0 && (
          <div className="mt-4 space-y-3">
            <p className="text-xs font-semibold text-ink-400 px-1">Other sessions</p>
            {otherSessions.map((session, idx) => {
              const status = STATUS_LABEL[session.state] || { label: session.state, color: 'text-gray-600' };
              const isStopping = stopping === session.id;
              const canStop = session.state === 'ACTIVE';

              return (
                <div
                  key={session.id}
                  style={{ animationDelay: `${idx * 60}ms` }}
                  className="card-interactive animate-slide-up bg-white p-4 rounded-xl shadow-sm border border-gray-100"
                >
                  <div className="flex justify-between items-start gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-800">#{session.id.slice(0, 8)}</span>
                        <span className={`text-xs font-medium ${status.color}`}>● {status.label}</span>
                      </div>
                      <p className="text-sm text-gray-600 mt-1 truncate">{chargerLabel(session)}</p>
                      {chargerIdLabel(session) && (
                        <p className="text-[11px] text-gray-400 font-mono truncate">ID: {chargerIdLabel(session)}</p>
                      )}
                    </div>
                    {canStop && (
                      <button
                        onClick={() => handleStop(session.id)}
                        disabled={isStopping}
                        className="btn-press px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50 flex-shrink-0"
                      >
                        {isStopping ? <FaSpinner className="animate-spin inline" /> : 'Stop'}
                      </button>
                    )}
                  </div>
                  <div className="mt-2 pt-2 border-t border-gray-100 flex items-center gap-4 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <FaBolt className="text-brand-500" /> {fmtKwh(session.consumed_wh ?? session.latest_meter_wh)} kWh
                    </span>
                    <span className="flex items-center gap-1">
                      <FaClock /> {elapsedLabel(session.started_at, now)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ActiveSession;
