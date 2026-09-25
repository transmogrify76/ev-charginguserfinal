import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { FaBolt, FaClock, FaExclamationTriangle, FaTimes, FaPlug, FaInfinity, FaBatteryFull, FaHourglassHalf, FaRupeeSign, FaWifi } from 'react-icons/fa';
import {
  getCharger,
  getChargerPrice,
  getLiveSessionsSnapshot,
  getStartIntent,
  openChargerAvailabilityStream,
  startChargingSession,
  stopChargingSession,
} from '../services/customerApi';
import {
  ChargingLimitSource,
  ChargingSessionResponse,
  ChargingSessionState,
  ChargingStartLimit,
  ChargingStartLimitRequest,
  ChargingStartStatus,
  CustomerChargeabilityReason,
  CustomerCharger,
  CustomerConnector,
  CustomerNetworkStatus,
  CustomerPriceResponse,
} from '../types/auth';
import StatusBadge, { ChargeabilityBadge } from '../components/StatusBadge';

type LimitChoice = 'AUTO' | 'ENERGY' | 'TIME' | 'MONEY';

/** Longer-form banner copy for the reasons someone is actually likely to hit before starting. */
const CHARGEABILITY_REASON_MESSAGE: Partial<Record<CustomerChargeabilityReason, string>> = {
  CPO_NOT_ACTIVE: "This charging network isn't currently active.",
  COMMERCIAL_ADMISSION_BLOCKED: "This charger isn't available for your account right now.",
  HAL_UNAVAILABLE: "This charger's network connection is temporarily unreachable. Try again shortly.",
  CHARGER_OFFLINE: 'This charger is currently offline.',
  CHARGER_STALE: "We haven't heard from this charger recently - its status may be out of date.",
  CONNECTOR_FAULTED: 'This connector is reporting a fault and needs attention before it can be used.',
  START_IN_PROGRESS: 'Someone is already starting a session on this charger.',
  CONNECTOR_OCCUPIED: 'Every connector on this charger is currently in use.',
  MAPPING_UNAVAILABLE: "This charger isn't ready to accept start requests yet. Try again in a moment.",
  NO_ELIGIBLE_TARIFF: "This charger doesn't have pricing set up right now.",
  UNSUPPORTED_TARIFF_PRICING: "This charger's pricing can't be processed right now.",
  HUB_GST_UNAVAILABLE: "This location's tax details aren't available right now.",
  WALLET_MINIMUM_BALANCE_NOT_MET: 'Recharge your wallet to meet the minimum balance required to start a session.',
  INSUFFICIENT_WALLET_BALANCE: "Your wallet balance isn't enough to start a session here. Please recharge.",
};

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  chargerId: string; // public charger ID
  connectors?: string[]; // deprecated - kept so existing call sites still typecheck
}

const START_POLL_INTERVAL_MS = 1500;
const START_POLL_TIMEOUT_MS = 30000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const START_STATUS_LABEL: Record<ChargingStartStatus, string> = {
  REQUESTED: 'Requesting start…',
  ACCEPTED_FOR_DELIVERY: 'Sending to charger…',
  PROTOCOL_ACKNOWLEDGED: 'Charger acknowledged…',
  ACTUALLY_STARTED: 'Charging started',
  REJECTED: 'Charger rejected the request',
  EXPIRED: 'Start request expired',
  RECONCILIATION_REQUIRED: 'Needs reconciliation - contact support',
};

/**
 * All three limit types are valid on every tariff - customer execution
 * intent never has to match the tariff's billing dimension (confirmed in
 * handoff v11). A fixed per-session tariff just treats MONEY as an
 * admission-ceiling check rather than a continuous spend cap, since it has
 * no continuous physical amount to bound.
 */
const availableLimitChoices = (): LimitChoice[] => ['AUTO', 'ENERGY', 'TIME', 'MONEY'];

const LIMIT_META: Record<Exclude<LimitChoice, 'AUTO'>, { label: string; icon: React.ReactNode; unit: string }> = {
  ENERGY: { label: 'Energy', icon: <FaBatteryFull />, unit: 'kWh' },
  TIME: { label: 'Time', icon: <FaHourglassHalf />, unit: 'min' },
  MONEY: { label: 'Amount', icon: <FaRupeeSign />, unit: '₹' },
};

const DURATION_PRESETS_MIN = [15, 30, 45, 60, 90, 120];
const formatDurationPreset = (min: number) => (min < 60 ? `${min}m` : min % 60 === 0 ? `${min / 60}h` : `${(min / 60).toFixed(1)}h`);

/** Short human label for why a given effective bound applies - a customer
 * limit on one dimension can trigger a wallet-derived bound on the other
 * (e.g. an ENERGY limit on a time tariff also carries a wallet duration
 * cap), so this avoids the bound looking unexplained. */
const LIMIT_SOURCE_LABEL: Partial<Record<ChargingLimitSource, string>> = {
  CUSTOMER_ENERGY: 'your limit',
  CUSTOMER_TIME: 'your limit',
  CUSTOMER_MONEY: 'your limit',
  WALLET: 'wallet balance',
};

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, chargerId }) => {
  const [sessions, setSessions] = useState<ChargingSessionResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [chargerStatus, setChargerStatus] = useState<CustomerNetworkStatus | null>(null);
  const [chargerCanCharge, setChargerCanCharge] = useState<boolean | null>(null);
  const [chargerChargeabilityReason, setChargerChargeabilityReason] = useState<CustomerChargeabilityReason | null>(null);
  const [chargerName, setChargerName] = useState<string>('');
  const [connectorList, setConnectorList] = useState<CustomerConnector[]>([]);
  const [connectorStreamLive, setConnectorStreamLive] = useState(false);
  const chargerStreamRef = useRef<{ close: () => void } | null>(null);
  const [selectedConnectorId, setSelectedConnectorId] = useState<string>('');
  const [startLoading, setStartLoading] = useState(false);
  const [stoppingSessionId, setStoppingSessionId] = useState<string | null>(null);
  const [subscriptionExpired, setSubscriptionExpired] = useState(false);

  const [price, setPrice] = useState<CustomerPriceResponse | null>(null);
  const [priceStatus, setPriceStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const [limitChoice, setLimitChoice] = useState<LimitChoice>('TIME');
  const [energyKwh, setEnergyKwh] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [moneyAmount, setMoneyAmount] = useState('');
  const [appliedLimit, setAppliedLimit] = useState<ChargingStartLimit | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchActiveSessions();
      fetchChargerDetail();
      fetchPrice();

      // Live connector/charger status for as long as this screen is open -
      // per the handoff, one stream per active charger-detail screen, not
      // one per card. Applies each frame as a full replace of the charger.
      chargerStreamRef.current = openChargerAvailabilityStream(chargerId, {
        onCharger: (chargerData) => {
          setConnectorStreamLive(true);
          applyChargerDetail(chargerData);
        },
        onError: () => setConnectorStreamLive(false),
        onClose: () => setConnectorStreamLive(false),
      });
    } else {
      chargerStreamRef.current?.close();
      setConnectorStreamLive(false);
      // Reset so a re-open never briefly shows stale data from the last charger.
      setError(null);
      setInfo(null);
      setSelectedConnectorId('');
      setSubscriptionExpired(false);
      setLimitChoice('TIME');
      setEnergyKwh('');
      setDurationMinutes('');
      setMoneyAmount('');
      setAppliedLimit(null);
      setPrice(null);
      setPriceStatus('loading');
    }
    return () => {
      chargerStreamRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, chargerId]);

  useEffect(() => {
    if (!selectedConnectorId) {
      const firstChargeable = connectorList.find((c) => c.can_charge);
      if (firstChargeable) setSelectedConnectorId(firstChargeable.id);
    }
  }, [connectorList, selectedConnectorId]);

  const applyChargerDetail = (chargerData: CustomerCharger) => {
    setChargerStatus(chargerData.status);
    setChargerCanCharge(chargerData.can_charge);
    setChargerChargeabilityReason(chargerData.chargeability_reason);
    setChargerName(chargerData.charger_name || chargerData.hub_name || chargerId);
    setConnectorList(chargerData.connectors);
  };

  const fetchChargerDetail = async () => {
    try {
      const chargerData = await getCharger(chargerId);
      applyChargerDetail(chargerData);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load charger details');
    }
  };

  /** Fetched for informational display (e.g. the fixed-tariff MONEY note) - no longer gates which limit types are offered. */
  const fetchPrice = async () => {
    setPriceStatus('loading');
    try {
      const priceData = await getChargerPrice(chargerId);
      setPrice(priceData);
      setPriceStatus('loaded');
    } catch (err: any) {
      console.error('Failed to load pricing for limit options:', err);
      toast.error(err?.message || "Couldn't load pricing - charge limits are unavailable this time.");
      setPrice(null);
      setPriceStatus('failed');
    }
  };

  const fetchActiveSessions = async () => {
    setLoading(true);
    setError(null);
    try {
      // The dedicated live-sessions surface only ever contains this
      // customer's currently-open sessions (no charger_id filter on it
      // either, so we still filter client-side for this charger's rows).
      const response = await getLiveSessionsSnapshot();
      const inProgress: ChargingSessionState[] = ['ACTIVE', 'START_PENDING', 'STOP_PENDING', 'RECONCILIATION_REQUIRED'];
      const active = response.sessions.filter(
        (s) => inProgress.includes(s.state) && s.charger.charger_id === chargerId
      );
      setSessions(active);
    } catch (err: any) {
      const message = err.message || 'Failed to fetch active sessions';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  /** Builds the request payload for the currently selected limit choice, or null if AUTO / invalid. */
  const buildLimitRequest = (): ChargingStartLimitRequest | null => {
    if (limitChoice === 'ENERGY') {
      const n = Number(energyKwh);
      if (!energyKwh || Number.isNaN(n) || n <= 0) return null;
      return { type: 'ENERGY', energy_kwh: n.toFixed(3) };
    }
    if (limitChoice === 'TIME') {
      const n = Math.round(Number(durationMinutes));
      if (!durationMinutes || Number.isNaN(n) || n <= 0) return null;
      return { type: 'TIME', duration_minutes: n };
    }
    if (limitChoice === 'MONEY') {
      const n = Number(moneyAmount);
      if (!moneyAmount || Number.isNaN(n) || n <= 0) return null;
      return { type: 'MONEY', amount: n.toFixed(2) };
    }
    return null;
  };

  /**
   * RECONCILIATION_REQUIRED means the original HAL request was sent but its
   * delivery outcome is unknown - CMS is confirming charger truth. Per the
   * handoff this must keep polling the *same* intent, never be treated as
   * terminal and never trigger a replacement start request. If HAL's lookup
   * later proves the command absent, CMS itself resolves the intent to
   * REJECTED/EXPIRED, which we do treat as terminal below.
   */
  const pollStartIntent = async (startIntentId: string) => {
    const deadline = Date.now() + START_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const intent = await getStartIntent(startIntentId);
      if (intent.limit) setAppliedLimit(intent.limit);

      if (intent.session_id) {
        setInfo('Charging started');
        toast.success('Charging started!');
        await fetchActiveSessions();
        setInfo(null);
        return;
      }
      if (intent.status === 'RECONCILIATION_REQUIRED') {
        setInfo('Confirming with the charger…');
        await sleep(START_POLL_INTERVAL_MS);
        continue;
      }
      if (intent.status === 'REJECTED' || intent.status === 'EXPIRED') {
        const message = START_STATUS_LABEL[intent.status];
        setError(message);
        toast.error(message);
        setInfo(null);
        return;
      }
      setInfo(START_STATUS_LABEL[intent.status] || intent.status);
      await sleep(START_POLL_INTERVAL_MS);
    }
    // Don't leave the screen in an indefinite optimistic "starting" state -
    // stop polling and let the person know explicitly rather than spinning.
    setInfo(null);
    const message = 'Still waiting on the charger. Pull to refresh in a moment to check again.';
    setError(message);
    toast.warn(message);
  };

  const handleStart = async () => {
    if (!selectedConnectorId) {
      setError('Please select a connector');
      return;
    }
    const limit = buildLimitRequest();
    if (limitChoice !== 'AUTO' && !limit) {
      setError('Enter a valid limit value, or switch back to no limit.');
      return;
    }
    setStartLoading(true);
    setError(null);
    setAppliedLimit(null);
    setInfo('Requesting start…');
    try {
      const startResponse = await startChargingSession(chargerId, selectedConnectorId, limit ?? undefined);
      if (startResponse.limit) setAppliedLimit(startResponse.limit);
      setInfo(START_STATUS_LABEL[startResponse.status] || startResponse.status);
      await pollStartIntent(startResponse.start_intent_id);
    } catch (err: any) {
      let message: string;
      if (err.status === 409) {
        message = 'You already have an active session on this charger.';
        await fetchActiveSessions();
      } else if (err.status === 402) {
        message = 'Insufficient wallet balance. Please recharge.';
      } else if (err.status === 403 && err.code === 'cpo_subscription_expired') {
        // Commercial-unavailable state - disable Start and don't auto-retry.
        // Never blocks stopping an already-active session (handled separately).
        setSubscriptionExpired(true);
        message = "This charging network's provider subscription has lapsed. Charging is temporarily unavailable.";
      } else if (err.status === 503 && err.code === 'charger_mapping_unavailable') {
        message = "This charger isn't ready to accept start requests yet. Try again in a moment.";
      } else if (err.status === 503) {
        message = 'The charger network is temporarily unavailable. Please try again shortly.';
      } else {
        message = err.message || 'Start request failed';
      }
      setError(message);
      toast.error(message);
      setInfo(null);
    } finally {
      setStartLoading(false);
    }
  };

  const handleStop = async (sessionId: string) => {
    setStoppingSessionId(sessionId);
    setError(null);
    try {
      await stopChargingSession(sessionId, 'User requested stop');
      setInfo('Stop requested…');
      toast.info('Stop requested. This may take a moment to complete.');
      await sleep(2000);
      await fetchActiveSessions();
      setInfo(null);
    } catch (err: any) {
      const message = err.message || 'Stop failed';
      setError(message);
      toast.error(message);
    } finally {
      setStoppingSessionId(null);
    }
  };

  const getStatusDisplay = (state: ChargingSessionState) => {
    const map: Record<ChargingSessionState, { label: string; color: string }> = {
      START_PENDING: { label: 'Starting...', color: 'text-yellow-600' },
      ACTIVE: { label: 'Active', color: 'text-green-600' },
      STOP_PENDING: { label: 'Stopping...', color: 'text-orange-600' },
      COMPLETED: { label: 'Completed', color: 'text-gray-600' },
      FAILED: { label: 'Failed', color: 'text-red-600' },
      RECONCILIATION_REQUIRED: { label: 'Confirming...', color: 'text-orange-600' },
    };
    return map[state] || { label: state, color: 'text-gray-600' };
  };

  if (!isOpen) return null;

  // chargerCanCharge is null only before the first fetch resolves - don't
  // block prematurely on that transient state.
  const chargerIsChargeable = chargerCanCharge ?? true;
  const selectedConnector = connectorList.find((c) => c.id === selectedConnectorId);
  const canSubmitStart =
    chargerIsChargeable && !subscriptionExpired && !!selectedConnector && selectedConnector.can_charge && !startLoading;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto animate-slide-up sm:animate-scale-in">
        {/* Header */}
        <div className="sticky top-0 bg-white rounded-t-2xl border-b border-gray-100 px-4 sm:px-5 py-4 flex justify-between items-center z-10">
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-bold text-gray-800 flex items-center gap-2 truncate">
              <FaBolt className="text-brand-600 flex-shrink-0" />
              <span className="truncate">{chargerName || 'Charger Control'}</span>
            </h2>
            {chargerStatus && (
              <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                <StatusBadge status={chargerStatus} compact />
                {chargerChargeabilityReason && (
                  <ChargeabilityBadge canCharge={!!chargerCanCharge} reason={chargerChargeabilityReason} compact />
                )}
                {connectorStreamLive && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-600">
                    <FaWifi className="animate-pulse" /> Live
                  </span>
                )}
              </div>
            )}
          </div>
          <button onClick={onClose} className="btn-press p-2 rounded-full hover:bg-gray-100 transition flex-shrink-0" aria-label="Close">
            <FaTimes className="text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-5">
          {!chargerIsChargeable && chargerChargeabilityReason && (
            <div className="mb-4 bg-amber-50 border-l-4 border-amber-400 p-3 rounded flex items-start gap-2 animate-slide-up">
              <FaExclamationTriangle className="text-amber-500 mt-0.5 flex-shrink-0" />
              <p className="text-amber-800 text-sm">
                {CHARGEABILITY_REASON_MESSAGE[chargerChargeabilityReason] ||
                  "This charger can't accept new charging sessions right now."}
              </p>
            </div>
          )}
          {subscriptionExpired && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-2xl p-4 text-center animate-slide-up">
              <p className="text-red-700 text-sm font-medium">Charging is temporarily unavailable</p>
              <p className="text-red-500 text-xs mt-1">
                This charging network's provider subscription has lapsed. Please try again later or contact support.
              </p>
            </div>
          )}
          {error && (
            <div className="mb-4 bg-red-50 border-l-4 border-red-500 p-3 rounded flex items-start gap-2 animate-slide-up">
              <FaExclamationTriangle className="text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}
          {info && !error && (
            <div className="mb-4 bg-brand-50 border-l-4 border-brand-500 p-3 rounded flex items-start gap-2 animate-slide-up">
              <FaClock className="text-brand-500 mt-0.5 flex-shrink-0 animate-pulse" />
              <p className="text-brand-700 text-sm">{info}</p>
            </div>
          )}
          {appliedLimit && !error && (
            <div className="mb-4 bg-green-50 border-l-4 border-green-500 p-3 rounded flex items-start gap-2 animate-slide-up">
              <FaBolt className="text-green-600 mt-0.5 flex-shrink-0" />
              <div className="text-green-800 text-sm">
                {appliedLimit.energy_limit_wh === 0 && appliedLimit.max_duration_seconds === 0 ? (
                  <p>Charging with no preset limit - stops when you tap Stop.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {appliedLimit.energy_limit_wh > 0 && (
                      <li>
                        Up to {(appliedLimit.energy_limit_wh / 1000).toFixed(2)} kWh
                        {appliedLimit.energy_limit_source && LIMIT_SOURCE_LABEL[appliedLimit.energy_limit_source] && (
                          <span className="text-green-700/70"> ({LIMIT_SOURCE_LABEL[appliedLimit.energy_limit_source]})</span>
                        )}
                      </li>
                    )}
                    {appliedLimit.max_duration_seconds > 0 && (
                      <li>
                        Up to {Math.round(appliedLimit.max_duration_seconds / 60)} min
                        {appliedLimit.duration_limit_source && LIMIT_SOURCE_LABEL[appliedLimit.duration_limit_source] && (
                          <span className="text-green-700/70"> ({LIMIT_SOURCE_LABEL[appliedLimit.duration_limit_source]})</span>
                        )}
                      </li>
                    )}
                    {appliedLimit.energy_limit_wh > 0 && appliedLimit.max_duration_seconds > 0 && (
                      <li className="text-green-700/70 text-xs">Whichever is reached first.</li>
                    )}
                  </ul>
                )}
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-600"></div>
            </div>
          ) : (
            <>
              {sessions.length > 0 && (
                <div className="space-y-4 mb-6">
                  <h3 className="font-semibold text-gray-700">Active Session(s)</h3>
                  {sessions.map((session) => {
                    const statusInfo = getStatusDisplay(session.state);
                    const isStopping = stoppingSessionId === session.id;
                    const canStop = session.state === 'ACTIVE';

                    return (
                      <div key={session.id} className="card-interactive animate-slide-up bg-gray-50 rounded-xl p-4 border border-gray-200">
                        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-gray-800">#{session.id.slice(0, 8)}</span>
                              <span className={`text-sm font-medium ${statusInfo.color}`}>● {statusInfo.label}</span>
                            </div>
                            <div className="text-sm text-gray-600 mt-1">
                              <p>Charger: {session.charger.name || session.charger.charger_id}</p>
                              <p>Started: {new Date(session.started_at).toLocaleString()}</p>
                              {session.consumed_wh !== undefined && <p>Consumed: {session.consumed_wh} Wh</p>}
                            </div>
                          </div>
                          {canStop && (
                            <button
                              onClick={() => handleStop(session.id)}
                              disabled={isStopping}
                              className="btn-press px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition self-start"
                            >
                              {isStopping ? 'Stopping...' : 'Stop'}
                            </button>
                          )}
                          {session.state === 'STOP_PENDING' && (
                            <span className="text-xs text-orange-600 bg-orange-100 px-2 py-1 rounded self-start">
                              Stopping
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {sessions.length === 0 ? (
                !subscriptionExpired && (
                <>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Select Connector</label>
                    {connectorList.length === 0 ? (
                      <div className="h-14 skeleton rounded-lg" />
                    ) : (
                      <div className="space-y-2">
                        {connectorList.map((c) => {
                          const chargeable = c.can_charge;
                          const selected = selectedConnectorId === c.id;
                          return (
                            <button
                              key={c.id}
                              type="button"
                              disabled={!chargeable}
                              onClick={() => setSelectedConnectorId(c.id)}
                              className={`btn-press w-full flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-left transition-all ${
                                selected
                                  ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-200'
                                  : 'border-gray-200 bg-white hover:border-gray-300'
                              } ${!chargeable ? 'opacity-60 cursor-not-allowed' : ''}`}
                            >
                              <span className="flex items-center gap-2.5 min-w-0">
                                <FaPlug className={`flex-shrink-0 ${selected ? 'text-brand-600' : 'text-gray-400'}`} />
                                <span className="min-w-0">
                                  <span className="block text-sm font-medium text-gray-800 truncate">
                                    {c.connector_type} · {c.connector_total_capacity} kW
                                  </span>
                                  <span className="block text-xs text-gray-400">Connector {c.connector_number}</span>
                                </span>
                              </span>
                              <ChargeabilityBadge canCharge={c.can_charge} reason={c.chargeability_reason} compact />
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Charge limit (optional)</label>

                    <div className="flex gap-1.5 mb-2">
                      {availableLimitChoices().map((choice) => (
                        <button
                          key={choice}
                          type="button"
                          onClick={() => setLimitChoice(choice)}
                          className={`btn-press flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-lg border transition-all ${
                            limitChoice === choice
                              ? 'border-brand-500 bg-brand-50 text-brand-700'
                              : 'border-gray-200 text-gray-500 hover:border-gray-300'
                          }`}
                        >
                          {choice === 'AUTO' ? <FaInfinity /> : LIMIT_META[choice].icon}
                          {choice === 'AUTO' ? 'No limit' : LIMIT_META[choice].label}
                        </button>
                      ))}
                    </div>

                    {limitChoice === 'MONEY' && priceStatus === 'loaded' && price?.status === 'AVAILABLE' && price.price_type === 'sessions' && (
                      <p className="text-[11px] text-gray-400 mb-2">
                        This charger uses a fixed per-session price, so an amount limit here works as a minimum
                        balance check, not a running spend cap.
                      </p>
                    )}

                    {limitChoice !== 'AUTO' && (
                      <div className="animate-slide-up space-y-2.5">
                        {limitChoice === 'TIME' && (
                          <div className="grid grid-cols-3 gap-1.5">
                            {DURATION_PRESETS_MIN.map((min) => (
                              <button
                                key={min}
                                type="button"
                                onClick={() => setDurationMinutes(String(min))}
                                className={`btn-press py-2 rounded-lg text-sm font-semibold transition-all ${
                                  durationMinutes === String(min)
                                    ? 'bg-brand-600 text-white shadow-glow'
                                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                                }`}
                              >
                                {formatDurationPreset(min)}
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="relative">
                          <input
                            type="number"
                            min={0}
                            step={limitChoice === 'ENERGY' ? 0.001 : limitChoice === 'MONEY' ? 0.01 : 1}
                            inputMode="decimal"
                            placeholder={
                              limitChoice === 'TIME'
                                ? 'Or enter a custom duration (min)'
                                : `Enter ${LIMIT_META[limitChoice].label.toLowerCase()} (${LIMIT_META[limitChoice].unit})`
                            }
                            value={limitChoice === 'ENERGY' ? energyKwh : limitChoice === 'TIME' ? durationMinutes : moneyAmount}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (limitChoice === 'ENERGY') setEnergyKwh(v);
                              else if (limitChoice === 'TIME') setDurationMinutes(v);
                              else setMoneyAmount(v);
                            }}
                            className="w-full bg-white text-black border border-gray-300 rounded-lg pl-3 pr-14 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                          />
                          <span className="absolute inset-y-0 right-3.5 flex items-center text-xs text-gray-400 font-medium">
                            {LIMIT_META[limitChoice].unit}
                          </span>
                        </div>
                      </div>
                    )}
                    <p className="text-[11px] text-gray-400 mt-1.5">
                      {limitChoice === 'AUTO'
                        ? "Charges up to your wallet's usable balance."
                        : limitChoice === 'TIME' && durationMinutes
                        ? `Charging will stop automatically after about ${durationMinutes} minute${Number(durationMinutes) === 1 ? '' : 's'}.`
                        : 'Charging stops automatically once this limit is reached.'}
                    </p>
                  </div>

                  <button
                    onClick={handleStart}
                    disabled={!canSubmitStart}
                    className="btn-press w-full bg-gradient-to-r from-brand-600 to-brand-500 hover:shadow-glow text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition disabled:opacity-50 disabled:shadow-none"
                  >
                    {startLoading ? (
                      <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"></div>
                    ) : (
                      <>
                        <FaBolt /> Start Charging
                      </>
                    )}
                  </button>
                </>
                )
              ) : (
                <div className="text-center text-gray-500 text-sm py-4">
                  You have an active session on this charger. Use the stop button above.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Modal;
