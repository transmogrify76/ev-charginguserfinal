import React from 'react';
import { FaCheckCircle, FaExclamationTriangle, FaTools, FaBan, FaTrash, FaWallet, FaBolt, FaPlug, FaClock, FaQuestion } from 'react-icons/fa';
import { CustomerChargeabilityReason, CustomerNetworkStatus } from '../types/auth';

/**
 * `CustomerNetworkStatus` is the operator's administrative listing status
 * (ACTIVE/INACTIVE/SUSPENDED/UNDERMAINTENANCE/DECOMMISSIONED) - still useful
 * as a display label, but it is NOT the source of truth for whether a
 * connector can actually be started. That's `can_charge`/
 * `chargeability_reason` (see ChargeabilityBadge below), which the server
 * computes from commercial state, wallet, tariff eligibility, admin status,
 * mapping/readiness, and live HAL freshness - a connector can be
 * operationally ACTIVE while can_charge is false (occupied by an existing
 * session), or vice versa. `isChargeable(status)` below is kept only as a
 * fallback for the rare payload that doesn't carry can_charge; every gating
 * decision in the app uses can_charge directly, not this function.
 */
export const CONNECTOR_STATUS_META: Record<
  CustomerNetworkStatus,
  { label: string; badgeClass: string; dotClass: string; icon: React.ReactNode; chargeable: boolean }
> = {
  ACTIVE: {
    label: 'Available',
    badgeClass: 'bg-green-50 text-green-700 border-green-200',
    dotClass: 'bg-green-500',
    icon: <FaCheckCircle />,
    chargeable: true,
  },
  UNDERMAINTENANCE: {
    label: 'Maintenance',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
    dotClass: 'bg-amber-500',
    icon: <FaTools />,
    chargeable: false,
  },
  SUSPENDED: {
    label: 'Suspended',
    badgeClass: 'bg-red-50 text-red-700 border-red-200',
    dotClass: 'bg-red-500',
    icon: <FaBan />,
    chargeable: false,
  },
  INACTIVE: {
    label: 'Unavailable',
    badgeClass: 'bg-gray-100 text-gray-500 border-gray-200',
    dotClass: 'bg-gray-400',
    icon: <FaExclamationTriangle />,
    chargeable: false,
  },
  DECOMMISSIONED: {
    label: 'Retired',
    badgeClass: 'bg-gray-100 text-gray-400 border-gray-200',
    dotClass: 'bg-gray-400',
    icon: <FaTrash />,
    chargeable: false,
  },
};

export const isChargeable = (status: CustomerNetworkStatus) => CONNECTOR_STATUS_META[status]?.chargeable ?? false;

/**
 * Short, human labels for the server's authoritative chargeability reason.
 * Per the handoff: render `can_charge`/`chargeability_reason` directly,
 * never re-derive chargeability from `status`/`availability` - a connector
 * can be operationally AVAILABLE while can_charge is false (e.g. occupied
 * by an existing session), and vice versa. This is the map used wherever a
 * charger/connector actually gates whether Start is allowed.
 */
export const CHARGEABILITY_REASON_META: Record<
  CustomerChargeabilityReason,
  { label: string; badgeClass: string; dotClass: string; icon: React.ReactNode }
> = {
  AVAILABLE: { label: 'Available', badgeClass: 'bg-green-50 text-green-700 border-green-200', dotClass: 'bg-green-500', icon: <FaCheckCircle /> },
  NO_CHARGEABLE_CONNECTOR: { label: 'No connector available', badgeClass: 'bg-gray-100 text-gray-500 border-gray-200', dotClass: 'bg-gray-400', icon: <FaPlug /> },
  CPO_NOT_ACTIVE: { label: 'Network unavailable', badgeClass: 'bg-red-50 text-red-700 border-red-200', dotClass: 'bg-red-500', icon: <FaBan /> },
  COMMERCIAL_ADMISSION_BLOCKED: { label: 'Not available for you', badgeClass: 'bg-red-50 text-red-700 border-red-200', dotClass: 'bg-red-500', icon: <FaBan /> },
  HAL_UNAVAILABLE: { label: 'Charger network unreachable', badgeClass: 'bg-amber-50 text-amber-700 border-amber-200', dotClass: 'bg-amber-500', icon: <FaExclamationTriangle /> },
  CHARGER_NOT_AVAILABLE: { label: 'Unavailable', badgeClass: 'bg-gray-100 text-gray-500 border-gray-200', dotClass: 'bg-gray-400', icon: <FaExclamationTriangle /> },
  CONNECTOR_NOT_AVAILABLE: { label: 'Unavailable', badgeClass: 'bg-gray-100 text-gray-500 border-gray-200', dotClass: 'bg-gray-400', icon: <FaExclamationTriangle /> },
  CHARGER_OFFLINE: { label: 'Offline', badgeClass: 'bg-gray-100 text-gray-500 border-gray-200', dotClass: 'bg-gray-400', icon: <FaExclamationTriangle /> },
  CHARGER_STATE_UNKNOWN: { label: 'Status unknown', badgeClass: 'bg-gray-100 text-gray-500 border-gray-200', dotClass: 'bg-gray-400', icon: <FaQuestion /> },
  CHARGER_STALE: { label: 'Status outdated', badgeClass: 'bg-amber-50 text-amber-700 border-amber-200', dotClass: 'bg-amber-500', icon: <FaClock /> },
  CONNECTOR_STATE_UNKNOWN: { label: 'Status unknown', badgeClass: 'bg-gray-100 text-gray-500 border-gray-200', dotClass: 'bg-gray-400', icon: <FaQuestion /> },
  CONNECTOR_STALE: { label: 'Status outdated', badgeClass: 'bg-amber-50 text-amber-700 border-amber-200', dotClass: 'bg-amber-500', icon: <FaClock /> },
  CONNECTOR_FAULTED: { label: 'Faulted', badgeClass: 'bg-red-50 text-red-700 border-red-200', dotClass: 'bg-red-500', icon: <FaExclamationTriangle /> },
  START_IN_PROGRESS: { label: 'Starting elsewhere', badgeClass: 'bg-amber-50 text-amber-700 border-amber-200', dotClass: 'bg-amber-500', icon: <FaClock /> },
  CONNECTOR_OCCUPIED: { label: 'In use', badgeClass: 'bg-amber-50 text-amber-700 border-amber-200', dotClass: 'bg-amber-500', icon: <FaBolt /> },
  MAPPING_UNAVAILABLE: { label: 'Not ready yet', badgeClass: 'bg-amber-50 text-amber-700 border-amber-200', dotClass: 'bg-amber-500', icon: <FaExclamationTriangle /> },
  NO_ELIGIBLE_TARIFF: { label: 'Pricing unavailable', badgeClass: 'bg-gray-100 text-gray-500 border-gray-200', dotClass: 'bg-gray-400', icon: <FaExclamationTriangle /> },
  UNSUPPORTED_TARIFF_PRICING: { label: 'Pricing unavailable', badgeClass: 'bg-gray-100 text-gray-500 border-gray-200', dotClass: 'bg-gray-400', icon: <FaExclamationTriangle /> },
  HUB_GST_UNAVAILABLE: { label: 'Pricing unavailable', badgeClass: 'bg-gray-100 text-gray-500 border-gray-200', dotClass: 'bg-gray-400', icon: <FaExclamationTriangle /> },
  WALLET_MINIMUM_BALANCE_NOT_MET: { label: 'Recharge required', badgeClass: 'bg-amber-50 text-amber-700 border-amber-200', dotClass: 'bg-amber-500', icon: <FaWallet /> },
  INSUFFICIENT_WALLET_BALANCE: { label: 'Insufficient balance', badgeClass: 'bg-amber-50 text-amber-700 border-amber-200', dotClass: 'bg-amber-500', icon: <FaWallet /> },
};

/** Badge driven by the server's authoritative can_charge/chargeability_reason - use this to gate Start, not StatusBadge. */
export const ChargeabilityBadge: React.FC<{
  canCharge: boolean;
  reason: CustomerChargeabilityReason;
  className?: string;
  compact?: boolean;
}> = ({ canCharge, reason, className = '', compact = false }) => {
  const meta = CHARGEABILITY_REASON_META[reason] || CHARGEABILITY_REASON_META.CHARGER_STATE_UNKNOWN;
  return (
    <span
      className={`inline-flex items-center gap-1 border rounded-full font-medium ${meta.badgeClass} ${
        compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
      } ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dotClass} ${canCharge ? 'animate-pulse' : ''}`} />
      {meta.label}
    </span>
  );
};

const StatusBadge: React.FC<{ status: CustomerNetworkStatus; className?: string; compact?: boolean }> = ({
  status,
  className = '',
  compact = false,
}) => {
  const meta = CONNECTOR_STATUS_META[status] || CONNECTOR_STATUS_META.INACTIVE;
  return (
    <span
      className={`inline-flex items-center gap-1 border rounded-full font-medium ${meta.badgeClass} ${
        compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
      } ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dotClass} ${status === 'ACTIVE' ? 'animate-pulse' : ''}`} />
      {meta.label}
    </span>
  );
};

export default StatusBadge;
