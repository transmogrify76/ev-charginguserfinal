// src/services/customerApi.ts
//
// Client for USER_APP_ROOT ({API_ORIGIN}/api/v1/app): me, profile, published
// network discovery (hubs/chargers), favorites, informational pricing, and
// wallet read/recharge. See USERAPP_FE_HANDOFF_3.md section 5.
//
// NOTE: per that doc's section 13, editing email, RFID/access-token
// management, start/stop charging + live telemetry, refunds/bills beyond
// wallet recharge, and notifications are NOT part of this contract yet.
// Screens for those features intentionally keep talking to the old backend
// (be.cms.ocpp.transev.site) until a routed contract exists.

import { API_ORIGIN, authedRequest, CPO_APP_ID, refreshSession, USER_APP_ROOT } from './http';
import { getAccessToken } from './session';
import {
  ChargingSessionHistoryResponse,
  ChargingSessionResponse,
  ChargingStartLimitRequest,
  ChargingStartResponse,
  CustomerCharger,
  CustomerChargeability,
  CustomerChargerList,
  CustomerChargerLocationList,
  CustomerFavorites,
  CustomerHub,
  CustomerHubList,
  CustomerLiveChargingSessionListResponse,
  CustomerMe,
  CustomerPriceResponse,
  CustomerRechargeOrder,
  CustomerRechargeVerifyRequest,
  CustomerUser,
  CustomerVehicle,
  CustomerVehicleList,
  CreateCustomerVehicleRequest,
  UpdateCustomerVehicleRequest,
  CustomerWalletResponse,
  CustomerWalletTransactionList,
  OperationalEventPage,
  UpdateCustomerProfileRequest,
} from '../types/auth';

function query(params: Record<string, string | number | boolean | undefined>): string {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      usp.set(key, String(value));
    }
  });
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

// ---------------------------------------------------------------------------
// Bootstrap / profile
// ---------------------------------------------------------------------------

export function getMe(): Promise<CustomerMe> {
  return authedRequest<CustomerMe>(USER_APP_ROOT, '/me', { method: 'GET' });
}

export function updateProfile(payload: UpdateCustomerProfileRequest): Promise<CustomerUser> {
  return authedRequest<CustomerUser>(USER_APP_ROOT, '/profile', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

export function createVehicle(payload: CreateCustomerVehicleRequest): Promise<CustomerVehicle> {
  return authedRequest<CustomerVehicle>(USER_APP_ROOT, '/vehicles', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getVehicles(params?: {
  search?: string;
  vehicle_type?: string;
  vehicle_make?: string;
  vehicle_model?: string;
  limit?: number;
  before?: string;
  before_id?: string;
}): Promise<CustomerVehicleList> {
  return authedRequest<CustomerVehicleList>(USER_APP_ROOT, `/vehicles${query(params || {})}`, { method: 'GET' });
}

export function getVehicle(vehicleId: string): Promise<CustomerVehicle> {
  return authedRequest<CustomerVehicle>(USER_APP_ROOT, `/vehicles/${vehicleId}`, { method: 'GET' });
}

export function updateVehicle(vehicleId: string, payload: UpdateCustomerVehicleRequest): Promise<CustomerVehicle> {
  return authedRequest<CustomerVehicle>(USER_APP_ROOT, `/vehicles/${vehicleId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteVehicle(vehicleId: string): Promise<void> {
  return authedRequest<void>(USER_APP_ROOT, `/vehicles/${vehicleId}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Published network discovery
// ---------------------------------------------------------------------------

export function getHubs(params?: {
  q?: string;
  before?: string;
  before_id?: string;
}): Promise<CustomerHubList> {
  return authedRequest<CustomerHubList>(USER_APP_ROOT, `/hubs${query(params || {})}`, { method: 'GET' });
}

export function getHub(hubId: string): Promise<CustomerHub> {
  return authedRequest<CustomerHub>(USER_APP_ROOT, `/hubs/${hubId}`, { method: 'GET' });
}

export type GetChargersParams = {
  q?: string;
  connector_type?: string;
  min_power_kw?: number;
  max_power_kw?: number;
  open_24_hours?: boolean;
  /** Near-me query - lat and lng are required together. */
  lat?: number;
  lng?: number;
  /** Only valid with lat/lng; >0 and <=100; defaults to 10 server-side. */
  radius_km?: number;
  /** Ordinary list pagination - cannot be combined with lat/lng. */
  before?: string;
  before_id?: string;
};

export function getChargers(params?: GetChargersParams): Promise<CustomerChargerList> {
  return authedRequest<CustomerChargerList>(USER_APP_ROOT, `/chargers${query(params || {})}`, {
    method: 'GET',
  });
}

export function getCharger(chargerId: string): Promise<CustomerCharger> {
  return authedRequest<CustomerCharger>(USER_APP_ROOT, `/chargers/${chargerId}`, { method: 'GET' });
}

/**
 * Compact map-pin projection: only charger_name + coordinates, no inventory
 * or availability detail. Accepts the same filters as getChargers (including
 * near-me lat/lng/radius_km), but never paginated for near-me queries.
 */
export function getChargerLocations(params?: GetChargersParams): Promise<CustomerChargerLocationList> {
  return authedRequest<CustomerChargerLocationList>(
    USER_APP_ROOT,
    `/chargers/locations${query(params || {})}`,
    { method: 'GET' }
  );
}

// ---------------------------------------------------------------------------
// Favorites
// ---------------------------------------------------------------------------

export function getFavorites(params?: {
  hub_before?: string;
  hub_before_id?: string;
  charger_before?: string;
  charger_before_id?: string;
}): Promise<CustomerFavorites> {
  return authedRequest<CustomerFavorites>(USER_APP_ROOT, `/favorites${query(params || {})}`, {
    method: 'GET',
  });
}

export function addFavoriteHub(hubId: string): Promise<void> {
  return authedRequest<void>(USER_APP_ROOT, `/favorite-hubs/${hubId}`, { method: 'PUT' });
}

export function removeFavoriteHub(hubId: string): Promise<void> {
  return authedRequest<void>(USER_APP_ROOT, `/favorite-hubs/${hubId}`, { method: 'DELETE' });
}

export function addFavoriteCharger(chargerId: string): Promise<void> {
  return authedRequest<void>(USER_APP_ROOT, `/favorite-chargers/${chargerId}`, { method: 'PUT' });
}

export function removeFavoriteCharger(chargerId: string): Promise<void> {
  return authedRequest<void>(USER_APP_ROOT, `/favorite-chargers/${chargerId}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Informational pricing
// ---------------------------------------------------------------------------

export function getHubPrice(hubId: string): Promise<CustomerPriceResponse> {
  return authedRequest<CustomerPriceResponse>(USER_APP_ROOT, `/hubs/${hubId}/price`, { method: 'GET' });
}

export function getChargerPrice(chargerId: string): Promise<CustomerPriceResponse> {
  return authedRequest<CustomerPriceResponse>(USER_APP_ROOT, `/chargers/${chargerId}/price`, {
    method: 'GET',
  });
}

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

export function getWallet(): Promise<CustomerWalletResponse> {
  return authedRequest<CustomerWalletResponse>(USER_APP_ROOT, '/wallet', { method: 'GET' });
}

export function getWalletTransactions(params?: {
  before?: string;
  before_id?: string;
  limit?: number;
}): Promise<CustomerWalletTransactionList> {
  return authedRequest<CustomerWalletTransactionList>(
    USER_APP_ROOT,
    `/wallet/transactions${query(params || {})}`,
    { method: 'GET' }
  );
}

/** amount must be an exact decimal string, e.g. "500.00". */
export function createRechargeOrder(amount: string, idempotencyKey: string): Promise<CustomerRechargeOrder> {
  return authedRequest<CustomerRechargeOrder>(USER_APP_ROOT, '/wallet/recharge/orders', {
    method: 'POST',
    body: JSON.stringify({ amount }),
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

export function verifyRechargeOrder(
  payload: CustomerRechargeVerifyRequest
): Promise<CustomerRechargeOrder> {
  return authedRequest<CustomerRechargeOrder>(USER_APP_ROOT, '/wallet/recharge/verify', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Charging lifecycle (section 5.4) - start/poll/stop/history/detail
// ---------------------------------------------------------------------------

/** Admits only a fresh AVAILABLE connector; the response is start progress, not a session. */
export function startChargingSession(
  chargerId: string,
  connectorId: string,
  limit?: ChargingStartLimitRequest
): Promise<ChargingStartResponse> {
  return authedRequest<ChargingStartResponse>(USER_APP_ROOT, '/charging-sessions', {
    method: 'POST',
    body: JSON.stringify({ charger_id: chargerId, connector_id: connectorId, ...(limit ? { limit } : {}) }),
  });
}

/** Poll for the same start progress and the nullable materialized session_id. */
export function getStartIntent(startIntentId: string): Promise<ChargingStartResponse> {
  return authedRequest<ChargingStartResponse>(USER_APP_ROOT, `/charging-start-intents/${startIntentId}`, {
    method: 'GET',
  });
}

/** History resource: only sessions materialized from charger-originated start evidence. */
export function getChargingSessions(params?: {
  before?: string;
  before_id?: string;
  limit?: number;
}): Promise<ChargingSessionHistoryResponse> {
  return authedRequest<ChargingSessionHistoryResponse>(
    USER_APP_ROOT,
    `/charging-sessions${query(params || {})}`,
    { method: 'GET' }
  );
}

/** Canonical active/historical detail: live projection, totals once COMPLETED, frozen pricing/tax. */
export function getChargingSession(sessionId: string): Promise<ChargingSessionResponse> {
  return authedRequest<ChargingSessionResponse>(USER_APP_ROOT, `/charging-sessions/${sessionId}`, {
    method: 'GET',
  });
}

/** Persists/requests an owned stop. 202 means STOPPING/requested, not completion. */
export function stopChargingSession(sessionId: string, reason?: string): Promise<void> {
  return authedRequest<void>(USER_APP_ROOT, `/charging-sessions/${sessionId}/stop`, {
    method: 'POST',
    body: JSON.stringify(reason ? { reason } : {}),
  });
}

// ---------------------------------------------------------------------------
// Operational event recovery + realtime stream (section 5.5)
// ---------------------------------------------------------------------------

export function getOperationalEvents(afterId?: number, limit = 100): Promise<OperationalEventPage> {
  return authedRequest<OperationalEventPage>(
    USER_APP_ROOT,
    `/operations/events${query({ after_id: afterId, limit })}`,
    { method: 'GET' }
  );
}

export type OperationalStreamEvent = {
  id: number;
  type: string;
  resource_type: string;
  resource_id: string;
  raw: string;
};

/**
 * Opens exactly one long-lived GET /operations/realtime/stream connection using
 * fetch()+ReadableStream (native EventSource cannot attach Authorization /
 * X-CPO-App-ID headers). Call the returned `close()` to tear it down. Per the
 * handoff, the app shell should own a single instance of this stream, not one
 * per screen/card/charger.
 */
export function openOperationalRealtimeStream(handlers: {
  onEvent: (event: OperationalStreamEvent) => void;
  onError?: (err: unknown) => void;
  onClose?: () => void;
  lastEventId?: number;
}): { close: () => void } {
  const controller = new AbortController();
  let closed = false;

  (async () => {
    try {
      const token = getAccessToken();
      const headers: Record<string, string> = {
        Accept: 'text/event-stream',
        'X-CPO-App-ID': CPO_APP_ID,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(handlers.lastEventId != null ? { 'Last-Event-ID': String(handlers.lastEventId) } : {}),
      };
      const response = await fetch(`${USER_APP_ROOT}/operations/realtime/stream`, {
        headers,
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`realtime stream failed with ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!closed) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let frameEnd = buffer.indexOf('\n\n');
        while (frameEnd !== -1) {
          const frame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);
          frameEnd = buffer.indexOf('\n\n');

          if (!frame || frame.startsWith(':')) continue; // heartbeat/comment
          let eventId: number | null = null;
          let dataLines: string[] = [];
          for (const line of frame.split('\n')) {
            if (line.startsWith('id:')) eventId = Number(line.slice(3).trim());
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }
          const raw = dataLines.join('\n');
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw);
            handlers.onEvent({
              id: eventId ?? parsed.id,
              type: parsed.type,
              resource_type: parsed.resource_type,
              resource_id: parsed.resource_id,
              raw,
            });
          } catch {
            // ignore malformed frame
          }
        }
      }
      if (!closed) handlers.onClose?.();
    } catch (err) {
      if (!closed) handlers.onError?.(err);
    }
  })();

  return {
    close: () => {
      closed = true;
      controller.abort();
    },
  };
}

// ---------------------------------------------------------------------------
// Live sessions + charger availability full-state streams (section 5.5)
//
// These are dedicated full-state SSE contracts, distinct from the legacy
// /operations/events + /operations/realtime/stream feed above (which is only
// for generic durable invalidation/replay, not the state contract for these
// two views). Every frame here carries the *complete* current state - apply
// it as a full replace, never merge/patch against prior frames.
// ---------------------------------------------------------------------------

type NamedSSEFrame = { event: string; id: string | null; data: string };

/**
 * Low-level named-event SSE reader shared by the live-sessions and
 * charger-availability streams below. Uses fetch()+ReadableStream since
 * native EventSource can't attach Authorization/X-CPO-App-ID headers.
 */
function openNamedEventStream(
  path: string,
  handlers: { onFrame: (frame: NamedSSEFrame) => void; onError?: (err: unknown) => void; onClose?: () => void }
): { close: () => void } {
  const controller = new AbortController();
  let closed = false;

  (async () => {
    try {
      const token = getAccessToken();
      const response = await fetch(`${USER_APP_ROOT}${path}`, {
        headers: {
          Accept: 'text/event-stream',
          'X-CPO-App-ID': CPO_APP_ID,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`stream failed with ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!closed) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let frameEnd = buffer.indexOf('\n\n');
        while (frameEnd !== -1) {
          const rawFrame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);
          frameEnd = buffer.indexOf('\n\n');

          if (!rawFrame || rawFrame.startsWith(':')) continue; // heartbeat/comment
          let eventName = 'message';
          let id: string | null = null;
          const dataLines: string[] = [];
          for (const line of rawFrame.split('\n')) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('id:')) id = line.slice(3).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }
          const data = dataLines.join('\n');
          if (!data) continue;
          handlers.onFrame({ event: eventName, id, data });
        }
      }
      if (!closed) handlers.onClose?.();
    } catch (err) {
      if (!closed) handlers.onError?.(err);
    }
  })();

  return {
    close: () => {
      closed = true;
      controller.abort();
    },
  };
}

/** JSON read/recovery equivalent of the live-sessions stream's first frame. */
export function getLiveSessionsSnapshot(): Promise<CustomerLiveChargingSessionListResponse> {
  return authedRequest<CustomerLiveChargingSessionListResponse>(
    USER_APP_ROOT,
    '/operations/live-sessions/snapshot',
    { method: 'GET' }
  );
}

/**
 * Opens the primary full-state stream for this customer's complete current
 * live-session collection (GET /operations/live-sessions). The first frame
 * is `snapshot`, later frames are `live_sessions` - every frame's data is a
 * full `CustomerLiveChargingSessionListResponse`; apply it as a full replace
 * (`sessions = frame.sessions`), never merge. The collection only ever holds
 * still-open ACTIVE/STOP_PENDING/RECONCILIATION_REQUIRED sessions - a
 * completed session simply disappears from the next frame rather than being
 * flagged COMPLETED here.
 */
export function openLiveSessionsStream(handlers: {
  onSessions: (payload: CustomerLiveChargingSessionListResponse) => void;
  onError?: (err: unknown) => void;
  onClose?: () => void;
}): { close: () => void } {
  return openNamedEventStream('/operations/live-sessions', {
    onFrame: (frame) => {
      if (frame.event !== 'snapshot' && frame.event !== 'live_sessions') return;
      try {
        handlers.onSessions(JSON.parse(frame.data) as CustomerLiveChargingSessionListResponse);
      } catch {
        // ignore malformed frame
      }
    },
    onError: handlers.onError,
    onClose: handlers.onClose,
  });
}

/**
 * Opens a full-state stream for one customer-visible charger's current
 * connector availability (GET /operations/charger-availability). Only open
 * this while a charger detail screen for that charger is actually active -
 * one stream per active screen, not one per card in a list. The first frame
 * is `snapshot`, later frames are `charger_availability` - every frame's
 * data is the complete `CustomerCharger` object; apply it as a full replace,
 * never refetch REST after a frame. A clean close doesn't necessarily mean
 * the charger no longer exists (it may just no longer be visible to this
 * customer/app scope).
 */
export function openChargerAvailabilityStream(
  chargerId: string,
  handlers: {
    onCharger: (charger: CustomerCharger) => void;
    onError?: (err: unknown) => void;
    onClose?: () => void;
  }
): { close: () => void } {
  return openNamedEventStream(`/operations/charger-availability?charger_id=${encodeURIComponent(chargerId)}`, {
    onFrame: (frame) => {
      if (frame.event !== 'snapshot' && frame.event !== 'charger_availability') return;
      try {
        handlers.onCharger(JSON.parse(frame.data) as CustomerCharger);
      } catch {
        // ignore malformed frame
      }
    },
    onError: handlers.onError,
    onClose: handlers.onClose,
  });
}

// ---------------------------------------------------------------------------
// Chargeability (compact "can this charger/connector actually be started"
// decision - render directly, never re-derive from status/availability)
// ---------------------------------------------------------------------------

const chargerIdsParam = (chargerIds: string[]) =>
  chargerIds
    .map((id) => id.trim().toLowerCase())
    .filter((id, idx, arr) => id && arr.indexOf(id) === idx)
    .slice(0, 100)
    .join(',');

/**
 * One batch request for up to 100 public charger IDs - never issue one
 * chargeability request per card. Has no charger metadata; pair with the
 * existing list/detail payload (which also now carries can_charge directly)
 * for display fields.
 */
export function getChargerChargeability(chargerIds: string[]): Promise<CustomerChargeability> {
  return authedRequest<CustomerChargeability>(
    USER_APP_ROOT,
    `/operations/charger-chargeability?charger_ids=${encodeURIComponent(chargerIdsParam(chargerIds))}`,
    { method: 'GET' }
  );
}

/**
 * One shared batch stream for many visible cards (e.g. a search/list screen)
 * - never one stream per card. Initial `snapshot` and later
 * `charger_chargeability` frames are complete replacements of the whole
 * requested batch; index by charger_id and apply directly, never diff/merge.
 * Reconnect starts with a fresh snapshot.
 */
export function openChargerChargeabilityStream(
  chargerIds: string[],
  handlers: {
    onChargeability: (data: CustomerChargeability) => void;
    onError?: (err: unknown) => void;
    onClose?: () => void;
  }
): { close: () => void } {
  return openNamedEventStream(
    `/operations/charger-chargeability/stream?charger_ids=${encodeURIComponent(chargerIdsParam(chargerIds))}`,
    {
      onFrame: (frame) => {
        if (frame.event !== 'snapshot' && frame.event !== 'charger_chargeability') return;
        try {
          handlers.onChargeability(JSON.parse(frame.data) as CustomerChargeability);
        } catch {
          // ignore malformed frame
        }
      },
      onError: handlers.onError,
      onClose: handlers.onClose,
    }
  );
}

// ---------------------------------------------------------------------------
// Charger image
// ---------------------------------------------------------------------------

/**
 * `charger.charger_image_url` (e.g. "/api/v1/app/chargers/a1b2c3/image") is an
 * authenticated relative path, not a public image URL - a plain <img src>
 * can't use it because it needs Authorization + X-CPO-App-ID headers. Fetch
 * it as a blob and hand back a temporary object URL instead. Retries once
 * after a token refresh on 401, same as authedRequest. Callers must revoke
 * the returned URL (URL.revokeObjectURL) when done with it.
 */
export async function fetchChargerImageObjectUrl(relativePath: string): Promise<string> {
  const doFetch = async (token: string | null) =>
    fetch(`${API_ORIGIN}${relativePath}`, {
      headers: {
        'X-CPO-App-ID': CPO_APP_ID,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

  let response = await doFetch(getAccessToken());
  if (response.status === 401) {
    const refreshed = await refreshSession();
    response = await doFetch(refreshed.access_token);
  }
  if (!response.ok) {
    throw new Error('charger image unavailable');
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}