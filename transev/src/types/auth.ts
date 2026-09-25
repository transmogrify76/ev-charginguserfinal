// src/types/auth.ts
// Types matching the new customer app-auth contract
// (docs/contracts/openapi/openapi.yaml -> /api/v1/app/auth/*)

export type ApiErrorCode =
  | 'invalid_request'
  | 'missing_cpo_app_id'
  | 'invalid_credentials'
  | 'invalid_challenge'
  | 'unauthorized'
  | 'invalid_refresh_token'
  | 'signup_unavailable'
  | 'cpo_app_id_mismatch'
  | 'customer_already_registered'
  | 'rate_limited'
  | 'mail_unavailable'
  | 'internal_error'
  | 'session_not_found'
  | 'password_reused'
  | 'invalid_password'
  | 'invalid_current_password'
  | 'unknown_error'
  | string;

export type ApiError = {
  error: { code: ApiErrorCode; message: string };
};

/** Thrown by the auth API client on any non-2xx response. */
export class AuthApiError extends Error {
  status: number;
  code: ApiErrorCode;
  constructor(message: string, status: number, code: ApiErrorCode) {
    super(message);
    this.name = 'AuthApiError';
    this.status = status;
    this.code = code;
  }
}

export type ChallengeResponse = {
  challenge_id: string;
  expires_at: string; // UTC RFC 3339
  resend_available_at: string; // UTC RFC 3339
};

export type CustomerTokenResponse = {
  access_token: string;
  access_token_expires_at: string;
  refresh_token: string;
  session_expires_at: string;
  token_type: 'Bearer';
  customer_id: string;
  cpo_id: string;
  cpo_app_id: string;
};

export type CustomerMe = {
  user: {
    id: string;
    email: string;
    full_name: string;
    phone?: string;
    is_verified: boolean;
    last_login_at?: string;
  };
  customer: {
    id: string;
    status: 'ACTIVE' | 'BLOCKED';
    user_group_id?: string;
  };
  cpo: {
    id: string;
    business_name: string;
    app_id: string;
    app_id_mode: 'DUMMY' | 'LIVE';
  };
  wallet: {
    id: string;
    balance: string; // exact decimal string
    currency: string;
  };
};

export type CustomerSession = {
  id: string;
  ip_address?: string;
  user_agent: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  is_current: boolean;
};

export type SessionListResponse = {
  sessions: CustomerSession[];
};

export type MessageResponse = {
  message: string;
};

export type SignupStartPayload = {
  email: string;
  password: string;
  full_name: string;
  phone?: string;
};

export type SignupVerifyResponse = {
  customer_id: string;
  cpo_id: string;
  wallet_id: string;
};

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export type UpdateCustomerProfileRequest = {
  full_name: string;
  phone?: string | null; // omit to preserve; null to clear
};

export type CustomerUser = CustomerMe['user'];

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

export type CustomerVehicle = {
  id: string;
  vehicle_number: string;
  vehicle_type?: string;
  vehicle_make?: string;
  vehicle_model?: string;
  last_charged?: string;
  date_added: string;
  created_at: string;
  updated_at: string;
};

export type CreateCustomerVehicleRequest = {
  vehicle_number: string; // trimmed, 1-50 characters
  vehicle_type?: string | null; // trimmed; blank/null persist as absent metadata
  vehicle_make?: string | null;
  vehicle_model?: string | null;
};

export type UpdateCustomerVehicleRequest = Partial<CreateCustomerVehicleRequest>;

export type CustomerVehicleList = {
  vehicles: CustomerVehicle[];
  has_more: boolean;
  next_before?: string;
  next_before_id?: string;
};

// ---------------------------------------------------------------------------
// Published network discovery
// ---------------------------------------------------------------------------

export type CustomerHubSummary = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  open_24_hours: boolean;
  customer_visible: true;
  charger_count: number;
  is_favorite: boolean;
};

export type CustomerNetworkStatus =
  | 'ACTIVE'
  | 'INACTIVE'
  | 'SUSPENDED'
  | 'UNDERMAINTENANCE'
  | 'DECOMMISSIONED';

export type CustomerChargeabilityReason =
  | 'AVAILABLE'
  | 'NO_CHARGEABLE_CONNECTOR'
  | 'CPO_NOT_ACTIVE'
  | 'COMMERCIAL_ADMISSION_BLOCKED'
  | 'HAL_UNAVAILABLE'
  | 'CHARGER_NOT_AVAILABLE'
  | 'CONNECTOR_NOT_AVAILABLE'
  | 'CHARGER_OFFLINE'
  | 'CHARGER_STATE_UNKNOWN'
  | 'CHARGER_STALE'
  | 'CONNECTOR_STATE_UNKNOWN'
  | 'CONNECTOR_STALE'
  | 'CONNECTOR_FAULTED'
  | 'START_IN_PROGRESS'
  | 'CONNECTOR_OCCUPIED'
  | 'MAPPING_UNAVAILABLE'
  | 'NO_ELIGIBLE_TARIFF'
  | 'UNSUPPORTED_TARIFF_PRICING'
  | 'HUB_GST_UNAVAILABLE'
  | 'WALLET_MINIMUM_BALANCE_NOT_MET'
  | 'INSUFFICIENT_WALLET_BALANCE';

export type CustomerConnector = {
  id: string;
  connector_number: number;
  connector_type: string;
  connector_total_capacity: number;
  status: CustomerNetworkStatus;
  availability: 'UNKNOWN';
  /**
   * Authoritative "can this connector actually be started" decision from
   * the server - combines commercial state, wallet, tariff eligibility,
   * admin status, mapping/readiness, and live HAL connection/connector
   * state/freshness. Render this directly; never re-derive chargeability
   * from `status`/`availability` - a connector can be operationally
   * AVAILABLE while can_charge is false (e.g. occupied by an existing CMS
   * session), and vice versa (a fresh Preparing connector can be
   * chargeable since CMS-controlled start intentionally supports it).
   * NOT a reservation - POST /charging-sessions still rechecks every gate.
   */
  can_charge: boolean;
  chargeability_reason: CustomerChargeabilityReason;
};

export type CustomerCharger = {
  id: string;
  hub_id: string;
  charger_id: string; // six-character public ID
  charger_name?: string;
  vendor?: string;
  model?: string;
  max_power_kw: number;
  ocpp_version: string;
  status: CustomerNetworkStatus;
  charger_image_url?: string; // authenticated relative API path, e.g. /api/v1/app/chargers/{charger_id}/image
  charger_type?: string;
  segment?: string;
  /**
   * True when any connector on this charger is chargeable. When false, the
   * reason is always NO_CHARGEABLE_CONNECTOR even if the underlying
   * per-connector reasons differ - check each connector's own
   * chargeability_reason for the specific cause.
   */
  can_charge: boolean;
  chargeability_reason: CustomerChargeabilityReason;
  sub_segment?: string;
  charger_use_type?: string;
  parking?: string;
  hub_name?: string;
  hub_address?: string;
  hub_latitude?: number;
  hub_longitude?: number;
  // The charger's own opening-hours flag - distinct from the attached hub's.
  twenty_four_seven_open_status: boolean;
  // The attached hub's opening-hours flag (CustomerHubSummary.open_24_hours).
  hub_open_24_hours?: boolean;
  distance_km?: number;
  availability: 'UNKNOWN';
  is_favorite: boolean;
  connectors: CustomerConnector[];
};

export type CustomerChargerLocation = {
  charger_name: string;
  latitude: number;
  longitude: number;
};

export type CustomerChargerLocationList = {
  chargers: CustomerChargerLocation[];
  next_before?: string;
  next_before_id?: string;
  has_more: boolean;
};

export type CustomerChargerList = {
  chargers: CustomerCharger[];
  next_before?: string;
  next_before_id?: string;
  has_more: boolean;
};

/**
 * Compact batch chargeability - GET /operations/charger-chargeability and its
 * SSE stream equivalent. Has no charger metadata (name/hub/etc.) - pair with
 * the existing list/detail payload for display fields. Never issue one
 * chargeability request per charger card; batch up to 100 public IDs in one
 * call, or one shared stream connection for many visible cards.
 */
export type CustomerChargeability = {
  as_of: string;
  chargers: Array<{
    charger_id: string;
    can_charge: boolean;
    chargeability_reason: CustomerChargeabilityReason;
    connectors: Array<{
      connector_id: string;
      connector_number: number;
      can_charge: boolean;
      chargeability_reason: CustomerChargeabilityReason;
    }>;
  }>;
};

export type CustomerHub = CustomerHubSummary & {
  chargers: CustomerCharger[];
};

export type CustomerHubList = {
  hubs: CustomerHubSummary[];
  next_before?: string;
  next_before_id?: string;
  has_more: boolean;
};

export type CustomerFavorites = {
  hubs: CustomerHubSummary[];
  chargers: CustomerCharger[];
  next_hub_before?: string;
  next_hub_before_id?: string;
  has_more_hubs: boolean;
  next_charger_before?: string;
  next_charger_before_id?: string;
  has_more_chargers: boolean;
};

export type CustomerPriceType = 'sessions' | 'time' | 'energy';
export type CustomerPriceUnits = 'minutes' | 'kwh';

export type CustomerPriceResponse = {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  effective_at: string;
  currency?: string;
  price_per_unit?: string;
  tariff_type?: 'fixed';
  price_type?: CustomerPriceType;
  /** Omitted when price_type is "sessions" (one fixed session amount). */
  units?: CustomerPriceUnits;
  gst?: {
    sgst_rate: string;
    cgst_rate: string;
    igst_rate: string;
  };
  unavailable_reason?: 'no_eligible_tariff' | 'hub_gst_unavailable' | 'unsupported_tariff_pricing';
};

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

export type CustomerWalletDetails = {
  id: string;
  /** exact ledger balance, exact decimal string */
  balance: string;
  /** max(balance - wallet_buffer_min_balance, 0) - display/recharge aid only */
  usable_balance: string;
  /** amount to reach wallet_min_balance; does not include the buffer; "0.00" once met */
  minimum_recharge_amount: string;
  /** CPO whole-currency start threshold */
  wallet_min_balance: number;
  /** CPO whole-currency reservation buffer */
  wallet_buffer_min_balance: number;
  currency: string;
  updated_at: string;
};

export type CustomerWalletResponse = {
  wallet: CustomerWalletDetails;
};

export type CustomerWalletTransaction = {
  id: string;
  amount: string;
  transaction_type: 'CREDIT' | 'DEBIT';
  description: string;
  session_id?: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REVERSED';
  created_at: string;
};

export type CustomerWalletTransactionList = {
  wallet: CustomerWalletDetails;
  transactions: CustomerWalletTransaction[];
  next_before?: string;
  next_before_id?: string;
  has_more: boolean;
};

export type CustomerRechargeOrder = {
  recharge_order_id: string;
  provider: 'RAZORPAY';
  provider_order_id: string;
  amount: string;
  amount_minor: number;
  currency: 'INR';
  provider_key_id?: string; // present when creating the checkout order
  status: 'PAYMENT_PENDING' | 'PAID';
  created_at: string;
};

export type CustomerRechargeVerifyRequest = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

// ---------------------------------------------------------------------------
// Charging lifecycle (section 5.4)
// ---------------------------------------------------------------------------

/** Start-intent progress. Only ACTUALLY_STARTED means a session now exists. */
export type ChargingStartStatus =
  | 'REQUESTED'
  | 'ACCEPTED_FOR_DELIVERY'
  | 'PROTOCOL_ACKNOWLEDGED'
  | 'ACTUALLY_STARTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'RECONCILIATION_REQUIRED';

export type ChargingStartLimitType = 'ENERGY' | 'TIME' | 'MONEY';

/** Which effective bound (if any) actually produced an enforcement threshold. */
export type ChargingLimitSource = 'CUSTOMER_ENERGY' | 'CUSTOMER_TIME' | 'CUSTOMER_MONEY' | 'WALLET' | 'NONE';

/**
 * Optional execution limit on a start request. Exactly one of these three
 * shapes - never invent a default when omitted; CMS derives an effective
 * threshold from the usable wallet balance instead (no invented one-hour
 * default). Customer execution intent never has to match the tariff's
 * billing dimension - ENERGY, TIME, and MONEY are all valid regardless of
 * whether the tariff is priced by energy, time, or a fixed session amount
 * (a fixed-session tariff just treats MONEY as an admission ceiling, since
 * it has no continuous physical amount to bound).
 */
export type ChargingStartLimitRequest =
  | { type: 'ENERGY'; energy_kwh: string } // up to three decimals
  | { type: 'TIME'; duration_minutes: number } // whole minutes
  | { type: 'MONEY'; amount: string }; // two-decimal tariff-currency amount

/**
 * Echoed back on the start response: requested value/unit plus two
 * independent effective bounds. CMS derives wallet safety only in the
 * tariff's own billing dimension (never estimates energy from time or vice
 * versa using charger power), so a cross-dimensional customer limit can
 * produce both an energy and a duration bound at once - whichever is
 * tighter wins per dimension, and `*_source` records which one actually
 * applied truthfully (WALLET, one of the CUSTOMER_* limits, or NONE if that
 * dimension has no bound at all).
 */
export type ChargingStartLimit = {
  type: ChargingStartLimitType;
  /** The customer's original request, echoed back verbatim - e.g. "15" + "minutes". */
  requested_value?: string;
  requested_unit?: string;
  /** 0 means that enforcement dimension is absent - not "unlimited" vs "zero", just not set. */
  energy_limit_wh: number;
  energy_limit_source?: ChargingLimitSource;
  max_duration_seconds: number;
  duration_limit_source?: ChargingLimitSource;
};

export type ChargingStartResponse = {
  start_intent_id: string;
  status: ChargingStartStatus;
  charger_id: string;
  connector_id: string;
  /** Nullable/omitted until charger-originated evidence materializes a session. */
  session_id?: string | null;
  /** Durable type + requested value/unit + effective thresholds CMS is enforcing. */
  limit?: ChargingStartLimit;
  created_at: string;
  updated_at?: string;
};

export type ChargingSessionState =
  | 'START_PENDING'
  | 'ACTIVE'
  | 'STOP_PENDING'
  | 'COMPLETED'
  | 'FAILED'
  /** CMS is confirming charger truth after an ambiguous HAL command outcome - still open, not terminal. */
  | 'RECONCILIATION_REQUIRED';

export type ChargingSessionHub = {
  id: string;
  name?: string;
  address?: string;
};

/** Nested charger projection shared by both the history and detail endpoints. */
export type ChargingSessionCharger = {
  id: string;
  charger_id: string;
  name?: string;
  hub?: ChargingSessionHub;
};

export type ChargingSessionConnector = {
  id: string;
  number?: number;
  type?: string;
};

/** Bounded history-card projection returned by GET /charging-sessions. */
export type ChargingSessionStop = {
  requested_initiator?: string;
  requested_reason?: string;
  ocpp_reason?: string;
};

export type ChargingSessionHistoryItem = {
  id: string; // CMS session UUID
  state: ChargingSessionState;
  started_at: string;
  completed_at?: string;
  consumed_wh?: number;
  /** Present only once state === COMPLETED. */
  total_kwh?: string;
  total_amount?: string;
  currency?: string;
  settlement_status?: string;
  /** Additive stop provenance - see ChargingSessionStop / ChargingSessionResponse.stop for handling notes. */
  stop?: ChargingSessionStop;
  charger: ChargingSessionCharger;
  connector: ChargingSessionConnector;
  /**
   * Only present when charger-provided OCPP SoC was actually observed.
   * `final_soc_percent` is the last observed value, not a guaranteed
   * stop-time reading. A missing field is unknown - never render it as 0%
   * or estimate it from consumed energy. Sent as decimal strings, not numbers.
   */
  initial_soc_percent?: string;
  final_soc_percent?: string;
  soc_observed_at?: string;
};

export type ChargingSessionHistoryResponse = {
  sessions: ChargingSessionHistoryItem[];
  next_before?: string;
  next_before_id?: string;
  has_more: boolean;
};

export type ChargingConnectionState = 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'CONNECTED' | 'DISCONNECTED';
export type ChargingFreshness = 'FRESH' | 'STALE' | 'UNKNOWN';

export type ChargingSessionPricing = {
  price_per_unit?: string;
  legacy_price_per_kwh?: string;
  tariff_type?: 'fixed';
  price_type?: CustomerPriceType;
  units?: CustomerPriceUnits;
  idle_fee_per_minute?: string;
  currency?: string;
};

export type ChargingSessionTax = {
  sgst_rate?: string;
  cgst_rate?: string;
  igst_rate?: string;
};

/** Only present once a valid session-linked payment/wallet debit exists. */
export type ChargingSessionFinancial = {
  wallet_transaction_id?: string;
  payment_id?: string;
  amount?: string;
  currency?: string;
  payment_method?: string;
  payment_status?: string;
};

/** Canonical, customer-scoped active/historical detail: GET /charging-sessions/{id}. */
export type ChargingSessionResponse = {
  id: string;
  start_intent_id?: string;
  state: ChargingSessionState;
  start_progress?: ChargingStartStatus;
  stop_progress?: string;

  latest_meter_wh?: number;
  consumed_wh?: number;
  meter_observed_at?: string;
  meter_freshness?: ChargingFreshness;

  /**
   * SoC has its own independent freshness signal from the meter/energy
   * freshness above - never treat fresh energy data as implying fresh SoC.
   * A missing soc_percent is unknown, never render as 0%. Sent as a decimal
   * string (e.g. "35.2"), not a number.
   */
  soc_percent?: string;
  soc_observed_at?: string;
  soc_freshness?: ChargingFreshness;

  connection_state?: ChargingConnectionState;
  connection_observed_at?: string;

  connector_ocpp_status?: string;
  connector_observed_at?: string;
  connector_freshness?: ChargingFreshness;

  started_at: string;
  completed_at?: string;

  meter_start_wh?: number;
  meter_stop_wh?: number;

  total_kwh?: string;
  total_amount?: string;
  /**
   * CMS-calculated running estimate for a still-open session, derived from
   * its immutable tariff/tax snapshots as of the live-sessions frame's
   * `as_of` timestamp. This is NOT the final `total_amount` - it's a live
   * projection that only settles once the session actually completes.
   */
  projected_amount?: string;
  currency?: string;
  settlement_status?: string;
  /** Legacy compatibility field - kept alongside the newer `stop` object below, not replaced by it. */
  stop_reason?: string;
  /**
   * Additive stop provenance, present on completed sessions. `requested_*`
   * describe an actual CMS/HAL stop request when one existed - missing is
   * valid and expected for a spontaneous charger-originated stop (no CMS
   * request preceded it). `ocpp_reason` is the charger-reported OCPP
   * StopTransaction.reason - a protocol-level code, not the business reason
   * (e.g. an energy-limit stop can report ocpp_reason "Remote", which
   * describes how the stop was delivered, not why it happened). Render the
   * raw values, don't infer missing provenance or turn these into narrative
   * prose - that needs product-owned presentation rules this app doesn't
   * have yet.
   */
  stop?: ChargingSessionStop;

  charger: ChargingSessionCharger;
  connector: ChargingSessionConnector;

  pricing?: ChargingSessionPricing;
  tax?: ChargingSessionTax;
  /** The effective charge limit CMS is enforcing on this session, if one was requested at start. */
  limit?: ChargingStartLimit;
  /** Present only when a session-linked payment/wallet debit exists. */
  financial?: ChargingSessionFinancial;
};

/**
 * Full-state payload on every frame of GET /operations/live-sessions (and
 * its JSON snapshot/deprecated-alias equivalents). Apply directly - this is
 * a complete replace of the customer's whole live-session collection, never
 * a patch to merge. Contains only materialized ACTIVE, STOP_PENDING, and
 * still-open RECONCILIATION_REQUIRED sessions; a session that completes
 * simply disappears from the next frame.
 */
export type CustomerLiveChargingSessionListResponse = {
  sessions: ChargingSessionResponse[];
  as_of: string;
};

// ---------------------------------------------------------------------------
// Operational event recovery + realtime (section 5.5)
// ---------------------------------------------------------------------------

export type OperationalEventType =
  | 'charging.meter_changed'
  | 'charging.telemetry_changed'
  | 'charging.session_changed'
  | 'charger.availability_changed'
  | 'connector.availability_changed'
  | string;

export type OperationalResourceType = 'CHARGING_SESSION' | 'CHARGER' | 'CONNECTOR' | string;

export type OperationalEvent = {
  id: number;
  type: OperationalEventType;
  resource_type: OperationalResourceType;
  resource_id: string;
  created_at: string;
};

export type OperationalEventPage = {
  events: OperationalEvent[];
  has_more: boolean;
  next_after_id?: number;
};