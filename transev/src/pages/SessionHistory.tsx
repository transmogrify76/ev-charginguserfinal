// src/pages/SessionHistory.tsx
//
// Bounded charging-session history (GET /charging-sessions), separate from
// the wallet ledger in TransactionHistory.tsx. Each card expands into the
// full session detail (GET /charging-sessions/{id}) - charger/connector,
// the charge limit the session was actually started with (Energy/Time/
// Amount, plus the enforced bounds and their source), pricing/tax, and
// payment - with the same PDF receipt download as the wallet ledger's
// drill-down, via the shared SessionReceiptPDF component.

import React, { useCallback, useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  FaHome,
  FaBolt,
  FaPlug,
  FaSpinner,
  FaDownload,
  FaReceipt,
  FaChevronDown,
  FaChevronUp,
  FaBatteryFull,
  FaHourglassHalf,
  FaRupeeSign,
  FaCheckCircle,
} from 'react-icons/fa';
import { getChargingSessions, getChargingSession } from '../services/customerApi';
import { AuthApiError, ChargingSessionHistoryItem, ChargingSessionResponse, ChargingSessionState } from '../types/auth';
import { clearSession } from '../services/session';
import { downloadSessionReceiptPDF } from '../components/SessionReceiptPDF';

type Filter = 'all' | 'COMPLETED' | 'FAILED';

const STATE_BADGE: Partial<Record<ChargingSessionState, { label: string; className: string }>> = {
  COMPLETED: { label: 'Completed', className: 'bg-gray-100 text-gray-600' },
  FAILED: { label: 'Failed', className: 'bg-red-100 text-red-700' },
  ACTIVE: { label: 'Active', className: 'bg-green-100 text-green-700' },
  STOP_PENDING: { label: 'Stopping', className: 'bg-orange-100 text-orange-700' },
  START_PENDING: { label: 'Starting', className: 'bg-yellow-100 text-yellow-700' },
  RECONCILIATION_REQUIRED: { label: 'Confirming', className: 'bg-orange-100 text-orange-700' },
};

const LIMIT_ICON: Record<string, React.ReactNode> = {
  ENERGY: <FaBatteryFull />,
  TIME: <FaHourglassHalf />,
  MONEY: <FaRupeeSign />,
};
const LIMIT_LABEL: Record<string, string> = { ENERGY: 'Energy limit', TIME: 'Time limit', MONEY: 'Amount limit' };
const LIMIT_SOURCE_LABEL: Record<string, string> = {
  CUSTOMER_ENERGY: 'your limit',
  CUSTOMER_TIME: 'your limit',
  CUSTOMER_MONEY: 'your limit',
  WALLET: 'wallet balance',
};

const formatDate = (value?: string): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

/**
 * Cosmetic-only formatting of a raw backend code (snake_case -> Title Case
 * with spaces) - never a translation or interpretation of what the code
 * means. Per handoff v14: don't infer missing stop provenance or turn these
 * codes into user-facing prose without product-owned presentation rules, so
 * this stays a literal display of the same value, not new meaning.
 */
const formatRawCode = (value: string): string =>
  value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

// Per handoff v12: a valid session always returns a real charger UUID,
// public charger_id, and name consistently everywhere it appears - a blank
// charger object isn't a legitimate state. This fallback stays as a
// defensive display safety net; if it visibly triggers in production,
// that's a backend data bug to report, not expected behavior.
const chargerLabel = (item: { charger?: { name?: string; charger_id?: string; id?: string } }) => {
  const name = item.charger?.name;
  const publicId = item.charger?.charger_id;
  if (name) return name;
  if (publicId) return publicId;
  if (item.charger?.id && item.charger.id !== '00000000-0000-0000-0000-000000000000') {
    return `Charger ${item.charger.id.slice(0, 8)}`;
  }
  return 'Charger';
};

const connectorLabel = (item: { connector?: { type?: string; number?: number } }) => {
  const c = item.connector;
  if (!c) return null;
  return c.type ? `${c.type}${c.number ? ` · Connector ${c.number}` : ''}` : c.number ? `Connector ${c.number}` : null;
};

const SessionHistory: React.FC = () => {
  const history = useHistory();

  const [sessions, setSessions] = useState<ChargingSessionHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [cursor, setCursor] = useState<{ before?: string; before_id?: string } | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, ChargingSessionResponse>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleAuthFailure = useCallback(
    (err: unknown) => {
      // Only a genuine, already-confirmed refresh-token failure means the
      // session is actually dead - authedRequest already tried refreshing
      // once before this error ever reaches us. Anything else is a normal
      // fetch failure and should not log the person out.
      if (err instanceof AuthApiError && err.code === 'invalid_refresh_token') {
        clearSession();
        toast.error('Your session has expired. Please log in again.');
        history.push('/login');
        return true;
      }
      return false;
    },
    [history]
  );

  const fetchFirstPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await getChargingSessions({ limit: 20 });
      setSessions(page.sessions);
      setHasMore(page.has_more);
      setCursor(page.has_more ? { before: page.next_before, before_id: page.next_before_id } : null);
    } catch (err: any) {
      if (handleAuthFailure(err)) return;
      const message = err.message || 'Failed to load session history';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [handleAuthFailure]);

  useEffect(() => {
    fetchFirstPage();
  }, [fetchFirstPage]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getChargingSessions({ ...cursor, limit: 20 });
      setSessions((prev) => [...prev, ...page.sessions]);
      setHasMore(page.has_more);
      setCursor(page.has_more ? { before: page.next_before, before_id: page.next_before_id } : null);
    } catch (err: any) {
      if (handleAuthFailure(err)) return;
      toast.error(err.message || 'Could not load more sessions');
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleDetail = async (session: ChargingSessionHistoryItem) => {
    if (expandedId === session.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(session.id);
    if (!details[session.id]) {
      setDetailLoading(session.id);
      try {
        const detail = await getChargingSession(session.id);
        setDetails((prev) => ({ ...prev, [session.id]: detail }));
      } catch (err: any) {
        if (handleAuthFailure(err)) return;
        toast.error(err.message || 'Could not load this session');
        setExpandedId(null);
      } finally {
        setDetailLoading(null);
      }
    }
  };

  const handleDownload = async (sessionId: string) => {
    const detail = details[sessionId];
    if (!detail) return;
    setDownloadingId(sessionId);
    try {
      await downloadSessionReceiptPDF(detail);
      toast.success('Receipt downloaded');
    } catch (err: any) {
      toast.error(err.message || 'Could not generate the receipt PDF');
    } finally {
      setDownloadingId(null);
    }
  };

  const filteredSessions = sessions.filter((s) => filter === 'all' || s.state === filter);

  if (loading) {
    return (
      <div className="h-full overflow-y-auto bg-gradient-to-br from-brand-50 via-white to-blue-50 p-4">
        <div className="max-w-md mx-auto animate-fade-in">
          <div className="h-11 w-11 rounded-full skeleton mb-4" />
          <div className="rounded-3xl overflow-hidden shadow-xl">
            <div className="h-20 skeleton rounded-none" />
            <div className="bg-white p-6 space-y-3">
              <div className="h-20 skeleton" />
              <div className="h-20 skeleton" />
              <div className="h-20 skeleton" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error && sessions.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-gradient-to-br from-brand-50 via-white to-blue-50 p-4">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 max-w-md w-full text-center animate-scale-in">
          <p className="text-red-700">{error}</p>
          <button
            onClick={fetchFirstPage}
            className="btn-press mt-4 px-6 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 transition"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-brand-50 via-white to-blue-50 p-4">
      <div className="max-w-md mx-auto pb-8">
        <div className="mb-4 flex items-center justify-between">
          <button
            onClick={() => history.push('/dashboard')}
            className="btn-press p-3 bg-brand-600 rounded-full shadow-lg hover:bg-brand-700 hover:shadow-glow transition-all duration-200"
          >
            <FaHome className="text-white text-xl" />
          </button>
          <button
            onClick={() => history.push('/active-session')}
            className="btn-press flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-white/70 backdrop-blur-sm text-ink-500 shadow-sm"
          >
            <FaBolt className="text-brand-500" /> Active session
          </button>
        </div>

        <div className="bg-white/80 backdrop-blur-md rounded-3xl shadow-xl overflow-hidden animate-slide-up">
          <div className="bg-gradient-to-r from-brand-600 to-brand-500 px-6 py-6">
            <div className="flex items-center justify-between text-white">
              <div>
                <p className="text-brand-100 text-sm">Session History</p>
                <p className="text-2xl font-bold tracking-tight">
                  {sessions.length} session{sessions.length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-full">
                <FaBolt className="text-2xl" />
              </div>
            </div>
          </div>

          <div className="p-6">
            <div className="flex bg-gray-100 rounded-full p-1 mb-6">
              {(['all', 'COMPLETED', 'FAILED'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setFilter(type)}
                  className={`btn-press flex-1 py-2 text-sm font-medium rounded-full transition ${
                    filter === type ? 'bg-brand-600 text-white shadow-md' : 'text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {type === 'all' ? 'All' : type === 'COMPLETED' ? 'Completed' : 'Failed'}
                </button>
              ))}
            </div>

            {filteredSessions.length === 0 ? (
              <div className="text-center py-10 animate-fade-in">
                <FaBolt className="mx-auto text-4xl text-gray-300 mb-3" />
                <p className="text-gray-500">No sessions yet</p>
                <p className="text-gray-400 text-sm">Your charging history will appear here</p>
              </div>
            ) : (
              <>
                {filteredSessions.map((session, idx) => {
                  const isExpanded = expandedId === session.id;
                  const detail = details[session.id];
                  const isLoadingDetail = detailLoading === session.id;
                  const stateBadge = STATE_BADGE[session.state] || { label: session.state, className: 'bg-gray-100 text-gray-500' };
                  const limit = detail?.limit;
                  const hasLimit = limit && (limit.energy_limit_wh > 0 || limit.max_duration_seconds > 0);

                  return (
                    <div
                      key={session.id}
                      style={{ animationDelay: `${Math.min(idx, 8) * 40}ms` }}
                      className="animate-slide-up bg-white rounded-xl shadow-sm border border-gray-100 mb-4 overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => toggleDetail(session)}
                        className="w-full text-left p-4 hover:bg-gray-50 transition"
                      >
                        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-gray-800 truncate">{chargerLabel(session)}</span>
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${stateBadge.className}`}>
                                {stateBadge.label}
                              </span>
                            </div>
                            {connectorLabel(session) && (
                              <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                                <FaPlug className="text-gray-400" /> {connectorLabel(session)}
                              </p>
                            )}
                            <p className="text-xs text-gray-400 mt-1">{formatDate(session.started_at)}</p>
                          </div>
                          <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            {session.total_amount ? (
                              <p className="text-lg font-bold text-gray-800">
                                {session.currency || 'INR'} {session.total_amount}
                              </p>
                            ) : session.consumed_wh != null ? (
                              <p className="text-sm font-semibold text-gray-600">{(session.consumed_wh / 1000).toFixed(2)} kWh</p>
                            ) : null}
                            <span className="text-xs text-brand-600 font-medium flex items-center gap-1">
                              <FaReceipt /> Details {isExpanded ? <FaChevronUp /> : <FaChevronDown />}
                            </span>
                          </div>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="border-t border-gray-100 bg-gray-50 p-4 animate-slide-up">
                          {isLoadingDetail ? (
                            <div className="space-y-2">
                              <div className="h-4 w-2/3 skeleton" />
                              <div className="h-4 w-1/2 skeleton" />
                              <div className="h-4 w-1/3 skeleton" />
                            </div>
                          ) : detail ? (
                            <div className="space-y-3 text-sm text-gray-700">
                              {detail.charger?.hub?.name && (
                                <p className="text-xs text-gray-500">
                                  {detail.charger.hub.name}
                                  {detail.charger.hub.address ? ` · ${detail.charger.hub.address}` : ''}
                                </p>
                              )}

                              {/* The charge limit this session was actually started with */}
                              {limit && (
                                <div className="bg-brand-50 border border-brand-100 rounded-xl p-3">
                                  <div className="flex items-center gap-1.5 text-xs font-semibold text-brand-700 mb-1.5">
                                    {LIMIT_ICON[limit.type] || <FaBolt />}
                                    Started with: {LIMIT_LABEL[limit.type] || limit.type}
                                  </div>
                                  {limit.requested_value && limit.requested_unit && (
                                    <p className="text-xs text-gray-600">
                                      Requested {limit.requested_value} {limit.requested_unit}
                                    </p>
                                  )}
                                  {hasLimit ? (
                                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 mt-1">
                                      {limit.energy_limit_wh > 0 && (
                                        <span>
                                          Up to {(limit.energy_limit_wh / 1000).toFixed(2)} kWh
                                          {limit.energy_limit_source && LIMIT_SOURCE_LABEL[limit.energy_limit_source] && (
                                            <> ({LIMIT_SOURCE_LABEL[limit.energy_limit_source]})</>
                                          )}
                                        </span>
                                      )}
                                      {limit.max_duration_seconds > 0 && (
                                        <span>
                                          Up to {Math.round(limit.max_duration_seconds / 60)} min
                                          {limit.duration_limit_source && LIMIT_SOURCE_LABEL[limit.duration_limit_source] && (
                                            <> ({LIMIT_SOURCE_LABEL[limit.duration_limit_source]})</>
                                          )}
                                        </span>
                                      )}
                                    </div>
                                  ) : (
                                    <p className="text-xs text-gray-500 mt-1">No preset limit - charged to wallet balance.</p>
                                  )}
                                </div>
                              )}

                              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs pt-1">
                                <span>Started: {formatDate(detail.started_at)}</span>
                                {detail.completed_at && <span>Completed: {formatDate(detail.completed_at)}</span>}
                                {detail.total_kwh && <span>Energy: {detail.total_kwh} kWh</span>}
                                {detail.pricing?.price_per_unit && (
                                  <span>
                                    Rate: ₹{detail.pricing.price_per_unit}/{detail.pricing.units || detail.pricing.price_type}
                                  </span>
                                )}
                              </div>

                              {detail.financial && (
                                <div className="text-xs pt-1 text-gray-500 flex items-center gap-1">
                                  <FaCheckCircle className="text-green-600" />
                                  {detail.financial.payment_method || 'Wallet'} · {detail.financial.payment_status}
                                </div>
                              )}

                              {(detail.stop?.requested_initiator || detail.stop?.requested_reason || detail.stop?.ocpp_reason || detail.stop_reason) && (
                                <div className="text-xs pt-1 border-t border-gray-100 mt-1 pt-2">
                                  <p className="text-gray-400 font-medium mb-0.5">Stop details</p>
                                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-gray-500">
                                    {detail.stop?.requested_initiator && (
                                      <span>Requested by: {formatRawCode(detail.stop.requested_initiator)}</span>
                                    )}
                                    {detail.stop?.requested_reason && (
                                      <span>Reason: {formatRawCode(detail.stop.requested_reason)}</span>
                                    )}
                                    {detail.stop?.ocpp_reason && <span>OCPP: {detail.stop.ocpp_reason}</span>}
                                    {!detail.stop?.requested_reason && detail.stop_reason && (
                                      <span>Reason: {formatRawCode(detail.stop_reason)}</span>
                                    )}
                                  </div>
                                </div>
                              )}

                              {detail.total_amount && (
                                <div className="flex justify-between items-center pt-2 border-t border-gray-200">
                                  <span className="text-xs font-medium text-gray-500">Total</span>
                                  <span className="text-base font-bold text-gray-800">
                                    {detail.currency || 'INR'} {detail.total_amount}
                                  </span>
                                </div>
                              )}

                              <button
                                onClick={() => handleDownload(session.id)}
                                disabled={downloadingId === session.id}
                                className="btn-press mt-2 text-xs bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-full flex items-center gap-1.5 transition disabled:opacity-50"
                              >
                                {downloadingId === session.id ? <FaSpinner className="animate-spin" /> : <FaDownload />}
                                {downloadingId === session.id ? 'Generating…' : 'Download Receipt'}
                              </button>
                            </div>
                          ) : (
                            <p className="text-sm text-gray-400">Details unavailable.</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {hasMore && (
                  <button
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="btn-press w-full py-2.5 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium transition disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {loadingMore ? <FaSpinner className="animate-spin" /> : null}
                    {loadingMore ? 'Loading…' : 'Load more'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SessionHistory;
