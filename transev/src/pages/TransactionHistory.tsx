// src/pages/TransactionHistory.tsx
//
// The whole wallet ledger (GET /wallet/transactions), with a per-session
// receipt drill-down (GET /charging-sessions/{id}) for entries that carry a
// session_id. Previously this screen called the *old* be.cms.ocpp.transev.site
// backend with the *new* customer JWT; the old backend rejected that token
// with a 401, which this screen mistook for "your session expired" and
// force-logged the person out on every visit. Routing through the new API's
// authedRequest (which already handles refresh-on-401 correctly) fixes that
// at the root instead of papering over the symptom.

import React, { useCallback, useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  FaHome,
  FaWallet,
  FaRupeeSign,
  FaSpinner,
  FaDownload,
  FaReceipt,
  FaChevronDown,
  FaChevronUp,
  FaBolt,
  FaPlug,
} from 'react-icons/fa';
import { getWalletTransactions, getWallet, getChargingSession } from '../services/customerApi';
import { AuthApiError, ChargingSessionResponse, CustomerWalletTransaction } from '../types/auth';
import { clearSession } from '../services/session';
import { downloadSessionReceiptPDF } from '../components/SessionReceiptPDF';

type Filter = 'all' | 'CREDIT' | 'DEBIT';

// ---------- Formatting helpers ----------
const formatINR = (amount: string | null | undefined): string => {
  if (!amount) return '—';
  const normalized = amount.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return normalized;
  const negative = normalized.startsWith('-');
  const [whole, fraction = ''] = normalized.replace('-', '').split('.');
  try {
    const groupedWhole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(BigInt(whole));
    const paise = fraction.padEnd(2, '0').slice(0, 2);
    return `${negative ? '-' : ''}₹${groupedWhole}.${paise}`;
  } catch {
    return `₹${normalized}`;
  }
};

const formatDate = (value: string): string => {
  const date = new Date(value);
  if (isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

const transactionTitle = (tx: CustomerWalletTransaction): string =>
  tx.session_id ? 'EV Charging' : tx.transaction_type === 'CREDIT' ? 'Wallet Recharge' : 'Wallet Debit';

// ---------- Main component ----------
const TransactionHistory: React.FC = () => {
  const history = useHistory();

  const [transactions, setTransactions] = useState<CustomerWalletTransaction[]>([]);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [cursor, setCursor] = useState<{ before?: string; before_id?: string } | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<Record<string, ChargingSessionResponse>>({});
  const [receiptLoading, setReceiptLoading] = useState<string | null>(null);
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
      const [txPage, wallet] = await Promise.all([getWalletTransactions({ limit: 20 }), getWallet()]);
      setTransactions(txPage.transactions);
      setHasMore(txPage.has_more);
      setCursor(txPage.has_more ? { before: txPage.next_before, before_id: txPage.next_before_id } : null);
      setWalletBalance(wallet.wallet.balance);
    } catch (err: any) {
      if (handleAuthFailure(err)) return;
      const message = err.message || 'Failed to load transaction history';
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
      const page = await getWalletTransactions({ ...cursor, limit: 20 });
      setTransactions((prev) => [...prev, ...page.transactions]);
      setHasMore(page.has_more);
      setCursor(page.has_more ? { before: page.next_before, before_id: page.next_before_id } : null);
    } catch (err: any) {
      if (handleAuthFailure(err)) return;
      toast.error(err.message || 'Could not load more transactions');
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleReceipt = async (tx: CustomerWalletTransaction) => {
    if (!tx.session_id) return;
    if (expandedId === tx.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(tx.id);
    if (!receipts[tx.session_id]) {
      setReceiptLoading(tx.session_id);
      try {
        const detail = await getChargingSession(tx.session_id);
        setReceipts((prev) => ({ ...prev, [tx.session_id!]: detail }));
      } catch (err: any) {
        if (handleAuthFailure(err)) return;
        toast.error(err.message || 'Could not load the receipt for this session');
        setExpandedId(null);
      } finally {
        setReceiptLoading(null);
      }
    }
  };

  const handleDownload = async (sessionId: string) => {
    const session = receipts[sessionId];
    if (!session) return;
    setDownloadingId(sessionId);
    try {
      await downloadSessionReceiptPDF(session);
      toast.success('Receipt downloaded');
    } catch (err: any) {
      toast.error(err.message || 'Could not generate the receipt PDF');
    } finally {
      setDownloadingId(null);
    }
  };

  const filteredTransactions = transactions.filter((tx) => filter === 'all' || tx.transaction_type === filter);

  if (loading) {
    return (
      <div className="h-full overflow-y-auto bg-gradient-to-br from-brand-50 via-white to-blue-50 p-4">
        <div className="max-w-md mx-auto animate-fade-in">
          <div className="h-11 w-11 rounded-full skeleton mb-4" />
          <div className="rounded-3xl overflow-hidden shadow-xl">
            <div className="h-28 skeleton rounded-none" />
            <div className="bg-white p-6 space-y-3">
              <div className="h-16 skeleton" />
              <div className="h-16 skeleton" />
              <div className="h-16 skeleton" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error && transactions.length === 0) {
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
        <div className="mb-4">
          <button
            onClick={() => history.push('/dashboard')}
            className="btn-press p-3 bg-brand-600 rounded-full shadow-lg hover:bg-brand-700 hover:shadow-glow transition-all duration-200"
          >
            <FaHome className="text-white text-xl" />
          </button>
        </div>

        <div className="bg-white/80 backdrop-blur-md rounded-3xl shadow-xl overflow-hidden animate-slide-up">
          <div className="bg-gradient-to-r from-brand-600 to-brand-500 px-6 py-6">
            <div className="flex items-center justify-between text-white">
              <div>
                <p className="text-brand-100 text-sm">Wallet Balance</p>
                <p className="text-3xl font-bold tracking-tight">
                  {walletBalance != null ? formatINR(walletBalance) : '₹—'}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-full">
                <FaWallet className="text-2xl" />
              </div>
            </div>
          </div>

          <div className="p-6">
            <div className="flex bg-gray-100 rounded-full p-1 mb-6">
              {(['all', 'CREDIT', 'DEBIT'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setFilter(type)}
                  className={`btn-press flex-1 py-2 text-sm font-medium rounded-full transition ${
                    filter === type ? 'bg-brand-600 text-white shadow-md' : 'text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {type === 'all' ? 'All' : type === 'CREDIT' ? 'Credits' : 'Debits'}
                </button>
              ))}
            </div>

            {filteredTransactions.length === 0 ? (
              <div className="text-center py-10 animate-fade-in">
                <FaRupeeSign className="mx-auto text-4xl text-gray-300 mb-3" />
                <p className="text-gray-500">No transactions yet</p>
                <p className="text-gray-400 text-sm">Your financial history will appear here</p>
              </div>
            ) : (
              <>
                {filteredTransactions.map((tx, idx) => {
                  const isCredit = tx.transaction_type === 'CREDIT';
                  const isExpanded = expandedId === tx.id;
                  const receipt = tx.session_id ? receipts[tx.session_id] : undefined;
                  const isLoadingReceipt = tx.session_id && receiptLoading === tx.session_id;

                  return (
                    <div
                      key={tx.id}
                      style={{ animationDelay: `${Math.min(idx, 8) * 40}ms` }}
                      className="animate-slide-up bg-white rounded-xl shadow-sm border border-gray-100 mb-4 overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => toggleReceipt(tx)}
                        disabled={!tx.session_id}
                        className={`w-full text-left p-4 transition ${tx.session_id ? 'hover:bg-gray-50 cursor-pointer' : 'cursor-default'}`}
                      >
                        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-gray-800">{transactionTitle(tx)}</span>
                              <span
                                className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                  isCredit ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                }`}
                              >
                                {isCredit ? 'Credit' : 'Debit'}
                              </span>
                              <span
                                className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                  tx.status === 'COMPLETED'
                                    ? 'bg-gray-100 text-gray-500'
                                    : tx.status === 'PENDING'
                                    ? 'bg-amber-100 text-amber-700'
                                    : tx.status === 'FAILED'
                                    ? 'bg-red-100 text-red-700'
                                    : 'bg-gray-100 text-gray-500'
                                }`}
                              >
                                {tx.status}
                              </span>
                            </div>
                            <p className="text-sm text-gray-600 mt-1 truncate">{tx.description}</p>
                            <p className="text-xs text-gray-400 mt-1">{formatDate(tx.created_at)}</p>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <p className={`text-lg font-bold ${isCredit ? 'text-green-600' : 'text-red-600'}`}>
                              {isCredit ? '+' : '\u2212'} {formatINR(tx.amount)}
                            </p>
                            {tx.session_id && (
                              <span className="text-xs text-brand-600 font-medium flex items-center gap-1">
                                <FaReceipt /> Receipt {isExpanded ? <FaChevronUp /> : <FaChevronDown />}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>

                      {isExpanded && tx.session_id && (
                        <div className="border-t border-gray-100 bg-gray-50 p-4 animate-slide-up">
                          {isLoadingReceipt ? (
                            <div className="space-y-2">
                              <div className="h-4 w-2/3 skeleton" />
                              <div className="h-4 w-1/2 skeleton" />
                              <div className="h-4 w-1/3 skeleton" />
                            </div>
                          ) : receipt ? (
                            <div className="space-y-2 text-sm text-gray-700">
                              <div className="flex items-center gap-2 text-gray-800 font-medium">
                                <FaBolt className="text-brand-500" />
                                {receipt.charger?.name || receipt.charger?.charger_id}
                              </div>
                              {receipt.connector?.type && (
                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                  <FaPlug /> {receipt.connector.type}
                                  {receipt.connector.number ? ` \u00b7 Connector ${receipt.connector.number}` : ''}
                                </div>
                              )}
                              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs pt-1">
                                <span>Started: {formatDate(receipt.started_at)}</span>
                                {receipt.completed_at && <span>Completed: {formatDate(receipt.completed_at)}</span>}
                                {receipt.total_kwh && <span>Energy: {receipt.total_kwh} kWh</span>}
                                {receipt.pricing?.price_per_unit && (
                                  <span>
                                    Rate: \u20b9{receipt.pricing.price_per_unit}/{receipt.pricing.units || receipt.pricing.price_type}
                                  </span>
                                )}
                              </div>
                              {receipt.financial && (
                                <div className="text-xs pt-1 text-gray-500">
                                  {receipt.financial.payment_method || 'Wallet'} \u00b7 {receipt.financial.payment_status}
                                </div>
                              )}
                              <button
                                onClick={() => handleDownload(tx.session_id!)}
                                disabled={downloadingId === tx.session_id}
                                className="btn-press mt-2 text-xs bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-full flex items-center gap-1.5 transition disabled:opacity-50"
                              >
                                {downloadingId === tx.session_id ? (
                                  <FaSpinner className="animate-spin" />
                                ) : (
                                  <FaDownload />
                                )}
                                {downloadingId === tx.session_id ? 'Generating…' : 'Download Receipt'}
                              </button>
                            </div>
                          ) : (
                            <p className="text-sm text-gray-400">Receipt unavailable.</p>
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

export default TransactionHistory;
