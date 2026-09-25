import React, { useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { toast } from 'react-toastify';
import { FaArrowLeft, FaWallet, FaRupeeSign, FaHistory, FaArrowUp, FaSpinner } from 'react-icons/fa';
import {
  createRechargeOrder,
  getWallet,
  getWalletTransactions,
  verifyRechargeOrder,
} from '../services/customerApi';
import { CustomerWalletTransaction } from '../types/auth';

declare global {
  interface Window {
    Razorpay: any;
  }
}

const generateIdempotencyKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const Wallet: React.FC = () => {
  const history = useHistory();
  const [balance, setBalance] = useState<string>('0.00');
  const [usableBalance, setUsableBalance] = useState<string>('0.00');
  const [minimumRecharge, setMinimumRecharge] = useState<string>('0.00');
  const [currency, setCurrency] = useState<string>('INR');
  const [selectedAmount, setSelectedAmount] = useState<number>(0);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [balanceLoaded, setBalanceLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [transactions, setTransactions] = useState<CustomerWalletTransaction[]>([]);
  const [isFetchingHistory, setIsFetchingHistory] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [subscriptionExpired, setSubscriptionExpired] = useState(false);

  const fetchBalance = async () => {
    try {
      const response = await getWallet();
      setBalance(response.wallet.balance);
      setUsableBalance(response.wallet.usable_balance);
      setMinimumRecharge(response.wallet.minimum_recharge_amount);
      setCurrency(response.wallet.currency);
      setBalanceLoaded(true);
    } catch {
      toast.error('Failed to fetch balance');
    }
  };

  const fetchTransactions = async () => {
    setIsFetchingHistory(true);
    setHistoryError('');
    try {
      const result = await getWalletTransactions();
      setTransactions(result.transactions || []);
    } catch {
      setHistoryError('Failed to load transaction history');
    } finally {
      setIsFetchingHistory(false);
    }
  };

  useEffect(() => {
    fetchBalance();
    fetchTransactions();
  }, []);

  const loadRazorpayScript = () =>
    new Promise((resolve) => {
      if (window.Razorpay) {
        resolve(true);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve(true);
      document.body.appendChild(script);
    });

  const handlePayment = async () => {
    if (!selectedAmount) {
      toast.warn('Select an amount');
      return;
    }
    setLoading(true);

    try {
      await loadRazorpayScript();

      const order = await createRechargeOrder(selectedAmount.toFixed(2), generateIdempotencyKey());

      if (!order.provider_key_id) {
        toast.error('Unable to start payment. Please try again.');
        setLoading(false);
        return;
      }

      const rzp = new window.Razorpay({
        key: order.provider_key_id,
        amount: order.amount_minor,
        currency: order.currency,
        name: 'TransEV',
        description: 'Wallet Recharge',
        image: 'https://transev.in/assets/up-B0GM0qzi.png',
        order_id: order.provider_order_id,
        handler: async (response: any) => {
          try {
            await verifyRechargeOrder({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            });
            toast.success('Recharge successful!');
            fetchBalance();
            fetchTransactions();
          } catch (err) {
            console.error('Recharge verification error:', err);
            toast.error('Verification failed. Please contact support if the amount was debited.');
          }
        },
        theme: { color: '#4d6b2d' },
        modal: {
          ondismiss: () => {
            toast.info('Payment cancelled');
          },
        },
      });

      rzp.open();
    } catch (err: any) {
      console.error('Payment initiation error:', err);
      if (err?.code === 'cpo_subscription_expired') {
        // Commercial-unavailable state: don't auto-retry. A recharge order
        // created before expiry can still be verified via the Razorpay
        // handler above, so we only block *new* order creation here.
        setSubscriptionExpired(true);
        toast.error('Recharge is temporarily unavailable for this network. Please try again later.');
      } else {
        toast.error('Recharge failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  const formatTime = (dateStr: string) =>
    new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-brand-50 via-white to-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-lg border-b border-ink-100/60">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <button
            onClick={() => history.push('/dashboard')}
            className="btn-press p-2.5 rounded-full bg-ink-50 text-ink-700 hover:bg-ink-100 transition flex-shrink-0"
            aria-label="Back to dashboard"
          >
            <FaArrowLeft className="text-base" />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-ink-900 tracking-tight">Wallet</h1>
            <p className="text-xs sm:text-sm text-ink-400">Balance, recharge &amp; activity</p>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 sm:px-6 py-6 pb-10">
        <div className="bg-white rounded-2.5xl shadow-soft overflow-hidden animate-slide-up">
          <div className="bg-gradient-to-r from-brand-600 to-brand-500 px-5 sm:px-6 py-6">
            <div className="flex items-center justify-between text-white">
              <div className="min-w-0">
                <p className="text-brand-100 text-sm">Your Balance</p>
                {balanceLoaded ? (
                  <p className="text-3xl sm:text-4xl font-bold tracking-tight truncate animate-scale-in">
                    ₹{parseFloat(balance).toFixed(2)}
                  </p>
                ) : (
                  <div className="h-9 w-32 mt-1 rounded-lg bg-white/20 animate-pulse" />
                )}
                <p className="text-brand-100 text-xs mt-1">
                  {currency} · ₹{parseFloat(usableBalance).toFixed(2)} usable
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-full flex-shrink-0">
                <FaWallet className="text-2xl" />
              </div>
            </div>
          </div>

          {parseFloat(minimumRecharge) > 0 && (
            <div className="mx-5 sm:mx-6 mt-4 bg-amber-50 border border-amber-200 text-amber-800 text-xs sm:text-sm rounded-xl px-4 py-3">
              Recharge at least <span className="font-semibold">₹{parseFloat(minimumRecharge).toFixed(2)}</span> to
              meet the minimum balance required to start a charging session.
            </div>
          )}

          <div className="p-5 sm:p-6">
            {subscriptionExpired ? (
              <div className="mb-6 bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
                <p className="text-red-700 text-sm font-medium">Recharge is temporarily unavailable</p>
                <p className="text-red-500 text-xs mt-1">
                  This charging network's provider subscription has lapsed. Please try again later or contact
                  support.
                </p>
              </div>
            ) : (
            <div className="mb-6">
              <h2 className="text-ink-800 font-semibold mb-3 flex items-center gap-2">
                <FaRupeeSign className="text-brand-600" />
                Recharge Amount
              </h2>
              <div className="grid grid-cols-4 gap-2 mb-4">
                {[100, 200, 500, 1000].map((amount) => (
                  <button
                    key={amount}
                    onClick={() => {
                      setSelectedAmount(amount);
                      setCustomAmount('');
                    }}
                    className={`btn-press py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 ${selectedAmount === amount
                        ? 'bg-brand-600 text-white shadow-glow'
                        : 'bg-ink-50 text-ink-600 hover:bg-ink-100'
                      }`}
                  >
                    ₹{amount}
                  </button>
                ))}
              </div>
              <div className="relative mb-4">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-ink-300 text-sm font-semibold">
                  ₹
                </span>
                <input
                  type="number"
                  min={1}
                  inputMode="decimal"
                  value={customAmount}
                  onChange={(e) => {
                    setCustomAmount(e.target.value);
                    const parsed = Number(e.target.value);
                    setSelectedAmount(parsed > 0 ? parsed : 0);
                  }}
                  placeholder="Enter a custom amount"
                  className="w-full pl-7 pr-4 py-2.5 border border-ink-100 rounded-xl bg-ink-50 focus:bg-white focus:ring-2 focus:ring-brand-300 focus:border-transparent outline-none transition-all duration-200 text-sm placeholder:text-ink-300"
                />
              </div>
              <button
                onClick={handlePayment}
                disabled={!selectedAmount || loading}
                className="btn-press w-full bg-gradient-to-r from-brand-600 to-brand-500 text-white py-3 rounded-2xl font-semibold shadow-glow hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <FaSpinner className="animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <FaArrowUp />
                    Pay ₹{selectedAmount}
                  </>
                )}
              </button>
            </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-ink-800 font-semibold flex items-center gap-2">
                  <FaHistory className="text-brand-600" />
                  Wallet Activity
                </h2>
              </div>

              {isFetchingHistory ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="bg-white p-4 rounded-2xl shadow-soft border border-ink-50 flex justify-between">
                      <div className="space-y-2">
                        <div className="h-5 w-20 skeleton" />
                        <div className="h-3 w-32 skeleton" />
                      </div>
                      <div className="space-y-2 text-right">
                        <div className="h-3 w-16 skeleton" />
                        <div className="h-3 w-10 skeleton ml-auto" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : historyError ? (
                <div className="text-center py-8 animate-scale-in">
                  <p className="text-red-500 text-sm mb-2">{historyError}</p>
                  <button
                    onClick={fetchTransactions}
                    className="btn-press px-4 py-1.5 bg-brand-600 text-white rounded-full text-xs font-medium"
                  >
                    Retry
                  </button>
                </div>
              ) : transactions.length === 0 ? (
                <div className="text-center py-10 bg-ink-50 rounded-2xl animate-fade-in">
                  <FaHistory className="mx-auto text-ink-300 text-3xl mb-2" />
                  <p className="text-ink-400 text-sm">No wallet activity yet</p>
                  <p className="text-ink-300 text-xs mt-1">Your transactions will appear here</p>
                </div>
              ) : (
                <div className="space-y-3 pr-1">
                  {transactions.map((tx, idx) => (
                    <div
                      key={tx.id}
                      style={{ animationDelay: `${Math.min(idx, 8) * 40}ms` }}
                      className="card-interactive animate-slide-up bg-white p-4 rounded-2xl shadow-soft border border-ink-50"
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="min-w-0">
                          <p
                            className={`font-bold text-base sm:text-lg ${tx.transaction_type === 'CREDIT' ? 'text-green-600' : 'text-ink-800'
                              }`}
                          >
                            {tx.transaction_type === 'CREDIT' ? '+' : '-'} ₹{tx.amount}
                          </p>
                          <p className="text-xs text-ink-400 truncate">{tx.description}</p>
                          <span
                            className={`inline-block mt-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${tx.status === 'COMPLETED'
                                ? 'bg-green-100 text-green-700'
                                : tx.status === 'PENDING'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-red-100 text-red-700'
                              }`}
                          >
                            {tx.status}
                          </span>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs text-ink-400">{formatDate(tx.created_at)}</p>
                          <p className="text-xs text-ink-300">{formatTime(tx.created_at)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Wallet;