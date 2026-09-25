// src/pages/Dashboard.tsx
import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import {
  FaSearch,
  FaHeart,
  FaWallet,
  FaUser,
  FaQrcode,
  FaBars,
  FaMapMarkerAlt,
  FaTimes,
  FaBolt,
  FaClock,
  FaPlug,
  FaBuilding,
  FaLocationArrow,
  FaTag,
  FaParking,
  FaExclamationTriangle,
} from 'react-icons/fa';
import { useHistory } from 'react-router-dom';
import Sidebar from './Sidebar';
import QRScannerComponent from './QRScanner';
import Modal from './Modal';
import { ChargeabilityBadge, CHARGEABILITY_REASON_META } from '../components/StatusBadge';
import {
  getChargers,
  addFavoriteCharger,
  removeFavoriteCharger,
  getChargerPrice,
  fetchChargerImageObjectUrl,
  openChargerChargeabilityStream,
} from '../services/customerApi';
import { CustomerCharger, CustomerChargeability, CustomerPriceResponse } from '../types/auth';

const mapsLinkFor = (charger: CustomerCharger) =>
  charger.hub_latitude != null && charger.hub_longitude != null
    ? `https://www.google.com/maps/search/?api=1&query=${charger.hub_latitude},${charger.hub_longitude}`
    : undefined;

const connectorTypesFor = (charger: CustomerCharger) =>
  Array.from(new Set(charger.connectors.map((c) => c.connector_type))).join(', ') || 'Unknown';

const titleFor = (charger: CustomerCharger) => charger.charger_name || charger.hub_name || charger.charger_id;

/** Render an AVAILABLE CustomerPriceResponse per its declared price_type/units (handoff section 4). */
const formatPrice = (price: CustomerPriceResponse | null): string => {
  if (!price || price.status !== 'AVAILABLE' || !price.price_per_unit) return 'Not available right now';
  const amount = `\u20b9${price.price_per_unit}`;
  if (price.price_type === 'energy') return `${amount}/kWh`;
  if (price.price_type === 'time') return `${amount}/min`;
  if (price.price_type === 'sessions') return `${amount}/session`;
  return amount;
};

const ChargerThumb: React.FC<{ charger: CustomerCharger; size?: 'sm' | 'lg' }> = ({ charger, size = 'sm' }) => {
  const [src, setSrc] = useState<string | null>(null);
  const dim = size === 'lg' ? 'w-14 h-14' : 'w-12 h-12';

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setSrc(null);

    if (charger.charger_image_url) {
      fetchChargerImageObjectUrl(charger.charger_image_url)
        .then((url) => {
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          objectUrl = url;
          setSrc(url);
        })
        .catch(() => {
          
        });
    }

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [charger.charger_image_url]);

  if (src) {
    return (
      <img
        src={src}
        alt={titleFor(charger)}
        className={`${dim} rounded-2xl object-cover flex-shrink-0 bg-ink-50`}
      />
    );
  }

  return (
    <div className={`${dim} rounded-2xl bg-brand-50 flex items-center justify-center flex-shrink-0`}>
      <FaBolt className={size === 'lg' ? 'text-xl text-brand-600' : 'text-lg text-brand-600'} />
    </div>
  );
};

const Dashboard: React.FC = () => {
  const history = useHistory();
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [isScannerOpen, setScannerOpen] = useState(false);
  const [chargers, setChargers] = useState<CustomerCharger[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedCharger, setSelectedCharger] = useState<CustomerCharger | null>(null);
  const [startModalOpen, setStartModalOpen] = useState(false);
  const [selectedPrice, setSelectedPrice] = useState<CustomerPriceResponse | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [searchTerm, setSearchTerm] = useState('');

  const [nearbyOnly, setNearbyOnly] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [radiusKm, setRadiusKm] = useState(10);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');

  const chargeabilityStreamRef = useRef<{ close: () => void } | null>(null);

  const toggleSidebar = () => setSidebarOpen(!isSidebarOpen);
  const toggleScanner = () => setScannerOpen(!isScannerOpen);

  const fetchChargers = async (opts?: { lat: number; lng: number; radius: number } | null) => {
    setLoading(true);
    setLoadError('');
    try {
      const result = await getChargers(
        opts ? { lat: opts.lat, lng: opts.lng, radius_km: opts.radius } : undefined
      );
      setChargers(result.chargers || []);
    } catch (error) {
      console.error('Error fetching chargers:', error);
      setLoadError('Could not load chargers right now. Pull down to try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChargers();
  }, []);


  useEffect(() => {
    chargeabilityStreamRef.current?.close();
    if (chargers.length === 0) return;

    const applyChargeability = (data: CustomerChargeability) => {
      const byId = new Map(data.chargers.map((c) => [c.charger_id, c]));
      const merge = (charger: CustomerCharger): CustomerCharger => {
        const update = byId.get(charger.charger_id);
        if (!update) return charger;
        const connectorsById = new Map(update.connectors.map((c) => [c.connector_id, c]));
        return {
          ...charger,
          can_charge: update.can_charge,
          chargeability_reason: update.chargeability_reason,
          connectors: charger.connectors.map((c) => {
            const cUpdate = connectorsById.get(c.id);
            return cUpdate ? { ...c, can_charge: cUpdate.can_charge, chargeability_reason: cUpdate.chargeability_reason } : c;
          }),
        };
      };
      setChargers((prev) => prev.map(merge));
      setSelectedCharger((prev) => (prev ? merge(prev) : prev));
    };

    chargeabilityStreamRef.current = openChargerChargeabilityStream(
      chargers.map((c) => c.charger_id),
      { onChargeability: applyChargeability }
    );

    return () => chargeabilityStreamRef.current?.close();
    // Re-subscribe whenever the visible set of charger IDs actually changes,
    // not on every chargers-state update (e.g. from this same merge).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chargers.map((c) => c.charger_id).join(',')]);

  const requestLocationAndFetch = (radius: number) => {
    if (!navigator.geolocation) {
      setLocationError('Location is not available on this device.');
      setNearbyOnly(false);
      return;
    }
    setLocating(true);
    setLocationError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCoords(next);
        setLocating(false);
        fetchChargers({ ...next, radius });
      },
      () => {
        setLocating(false);
        setLocationError('Enable location access to see nearby chargers.');
        setNearbyOnly(false);
        fetchChargers();
      },
      { timeout: 8000 }
    );
  };

  const handleNearbyToggle = () => {
    const next = !nearbyOnly;
    setNearbyOnly(next);
    if (next) {
      if (coords) {
        fetchChargers({ ...coords, radius: radiusKm });
      } else {
        requestLocationAndFetch(radiusKm);
      }
    } else {
      setLocationError('');
      fetchChargers();
    }
  };

  const handleRadiusChange = (radius: number) => {
    setRadiusKm(radius);
    if (nearbyOnly) {
      if (coords) {
        fetchChargers({ ...coords, radius });
      } else {
        requestLocationAndFetch(radius);
      }
    }
  };

  const handleFavoriteToggle = async (charger: CustomerCharger, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextIsFavorite = !charger.is_favorite;
    setChargers((prev) =>
      prev.map((ch) => (ch.id === charger.id ? { ...ch, is_favorite: nextIsFavorite } : ch))
    );
    if (selectedCharger?.id === charger.id) {
      setSelectedCharger({ ...charger, is_favorite: nextIsFavorite });
    }
    try {
      if (nextIsFavorite) {
        await addFavoriteCharger(charger.charger_id);
      } else {
        await removeFavoriteCharger(charger.charger_id);
      }
    } catch (error: any) {
      console.error('Error updating favorite:', error);
      toast.error(error?.message || 'Could not update favorite. Please try again.');
      setChargers((prev) =>
        prev.map((ch) => (ch.id === charger.id ? { ...ch, is_favorite: charger.is_favorite } : ch))
      );
      if (selectedCharger?.id === charger.id) {
        setSelectedCharger({ ...charger, is_favorite: charger.is_favorite });
      }
    }
  };

  const handleSelectCharger = async (charger: CustomerCharger) => {
    setSelectedCharger(charger);
    setSelectedPrice(null);
    setPriceLoading(true);
    try {
      const price = await getChargerPrice(charger.charger_id);
      setSelectedPrice(price);
    } catch (error: any) {
      console.error('Error fetching price:', error);
      toast.error(error?.message || 'Could not load pricing for this charger.');
    } finally {
      setPriceLoading(false);
    }
  };

  const filteredChargers = chargers
    .filter(
      (charger) =>
        charger.charger_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (charger.hub_name || '').toLowerCase().includes(searchTerm.toLowerCase())
    )
    // Available chargers first, unavailable ones pushed to the bottom.
    // Array.sort is stable in modern JS engines, so within each group the
    // original (e.g. distance-sorted) order from the API is preserved.
    .sort((a, b) => Number(b.can_charge) - Number(a.can_charge));

  const SkeletonLoader = () => (
    <div className="space-y-3 animate-fade-in">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white rounded-2.5xl shadow-soft p-4 flex gap-3.5">
          <div className="w-12 h-12 rounded-2xl skeleton flex-shrink-0" />
          <div className="flex-1 space-y-2 py-1">
            <div className="h-4 skeleton rounded w-2/3" />
            <div className="h-3 skeleton rounded w-1/2" />
            <div className="h-3 skeleton rounded w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-brand-50 via-white to-white overflow-hidden">
      <Sidebar isOpen={isSidebarOpen} toggleSidebar={toggleSidebar} />
      {isSidebarOpen && <div className="fixed inset-0 bg-black opacity-50 z-40" onClick={toggleSidebar} />}

      {/* Header */}
      <div className="flex-none sticky top-0 z-20 bg-white/80 backdrop-blur-lg border-b border-ink-100/60">
        <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-3.5">
          <button
            onClick={toggleSidebar}
            className="btn-press p-2.5 rounded-full bg-ink-50 text-ink-700 hover:bg-ink-100 transition flex-shrink-0"
            aria-label="Open menu"
          >
            <FaBars className="text-base" />
          </button>
          <div className="relative flex-1 min-w-0 group">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
              <FaSearch className="text-ink-300 text-sm transition-colors group-focus-within:text-brand-500" />
            </div>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-ink-100 rounded-full bg-ink-50 focus:bg-white focus:ring-2 focus:ring-brand-300 focus:border-transparent outline-none transition-all duration-200 text-sm sm:text-base placeholder:text-ink-300"
              placeholder="Search chargers or hubs..."
            />
          </div>
          <button
            onClick={() => history.push('/active-session')}
            className="btn-press p-2.5 rounded-full bg-brand-50 hover:bg-brand-100 transition flex-shrink-0"
            aria-label="Active session"
          >
            <FaBolt className="text-brand-600 text-sm" />
          </button>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 pb-24">
        <div className="max-w-2xl mx-auto">
          <div className="flex justify-center mb-4">
            <div className="inline-flex bg-ink-50 p-1 rounded-full">
              <button
                onClick={() => setViewMode('list')}
                className={`btn-press px-5 sm:px-6 py-1.5 rounded-full text-sm font-semibold transition ${
                  viewMode === 'list' ? 'bg-white text-brand-700 shadow-soft' : 'text-ink-400'
                }`}
              >
                List View
              </button>
              <button
                onClick={() => setViewMode('map')}
                className={`btn-press px-5 sm:px-6 py-1.5 rounded-full text-sm font-semibold transition ${
                  viewMode === 'map' ? 'bg-white text-brand-700 shadow-soft' : 'text-ink-400'
                }`}
              >
                Map View
              </button>
            </div>
          </div>

          {/* Nearby-only toggle */}
          <div className="bg-white rounded-2.5xl shadow-soft px-4 py-3.5 mb-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 transition-colors ${
                    nearbyOnly ? 'bg-brand-100' : 'bg-ink-50'
                  }`}
                >
                  <FaLocationArrow className={`text-sm ${nearbyOnly ? 'text-brand-600' : 'text-ink-300'}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-900">Nearby chargers only</p>
                  <p className="text-xs text-ink-400 truncate">
                    {nearbyOnly ? `Within ${radiusKm} km of you` : 'Showing all chargers'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={nearbyOnly}
                onClick={handleNearbyToggle}
                disabled={locating}
                className={`relative inline-flex flex-shrink-0 h-7 w-12 items-center rounded-full transition-colors disabled:opacity-60 ${
                  nearbyOnly ? 'bg-brand-600' : 'bg-ink-200'
                }`}
                aria-label="Toggle nearby chargers only"
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    nearbyOnly ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {nearbyOnly && (
              <div className="flex gap-2 mt-3.5 overflow-x-auto pb-0.5">
                {[5, 10, 25, 50].map((r) => (
                  <button
                    key={r}
                    onClick={() => handleRadiusChange(r)}
                    className={`btn-press flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${
                      radiusKm === r ? 'bg-brand-600 text-white shadow-glow' : 'bg-ink-50 text-ink-500'
                    }`}
                  >
                    {r} km
                  </button>
                ))}
              </div>
            )}

            {locating && (
              <p className="text-xs text-brand-600 mt-3 flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
                Getting your location...
              </p>
            )}
            {locationError && !locating && (
              <p className="text-xs text-amber-600 mt-3">{locationError}</p>
            )}
          </div>

          {loading ? (
            <SkeletonLoader />
          ) : loadError ? (
            <div className="text-center py-14">
              <div className="w-16 h-16 mx-auto rounded-full bg-red-50 flex items-center justify-center mb-4">
                <FaBolt className="text-2xl text-red-400" />
              </div>
              <p className="text-ink-500 mb-4">{loadError}</p>
              <button
                onClick={() => (nearbyOnly && coords ? fetchChargers({ ...coords, radius: radiusKm }) : fetchChargers())}
                className="px-5 py-2.5 bg-brand-600 text-white rounded-full text-sm font-semibold shadow-glow hover:bg-brand-700 transition"
              >
                Retry
              </button>
            </div>
          ) : viewMode === 'map' ? (
            <div className="rounded-2.5xl overflow-hidden shadow-card" style={{ height: '65vh' }}>
              <iframe
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3683.5341636237147!2d88.50827541536385!3d22.57175068517253!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3a020afe3fa83dab%3A0xda5c16b563780319!2sShapoorji%20Pallonji%20Shukhobrishti%20Housing%20Complex!5e0!3m2!1sen!2sin!4v1718888888888!5m2!1sen!2sin"
                width="100%"
                height="100%"
                style={{ border: 0 }}
                allowFullScreen
                loading="lazy"
                title="Charger Map"
                className="w-full h-full"
              />
            </div>
          ) : (
            <div className="space-y-3">
              {filteredChargers.length === 0 ? (
                <div className="text-center py-14">
                  <div className="w-16 h-16 mx-auto rounded-full bg-ink-50 flex items-center justify-center mb-4">
                    <FaBolt className="text-2xl text-ink-300" />
                  </div>
                  <p className="text-ink-400 text-sm">No chargers found matching your search.</p>
                </div>
              ) : (
                filteredChargers.map((charger, idx) => (
                  <div
                    key={charger.id}
                    onClick={() => handleSelectCharger(charger)}
                    style={{ animationDelay: `${Math.min(idx, 8) * 40}ms` }}
                    className="card-interactive animate-slide-up bg-white rounded-2.5xl shadow-soft hover:shadow-card cursor-pointer p-4 flex items-start gap-3.5"
                  >
                    <ChargerThumb charger={charger} />
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-2">
                        <div className="min-w-0">
                          <h3 className="text-sm sm:text-base font-semibold text-ink-900 truncate">
                            {titleFor(charger)}
                          </h3>
                          <p className="text-xs text-ink-400 mt-0.5">ID: {charger.charger_id}</p>
                        </div>
                        <button
                          onClick={(e) => handleFavoriteToggle(charger, e)}
                          className="btn-press p-1.5 -mt-1 -mr-1 rounded-full hover:bg-red-50 transition flex-shrink-0"
                          aria-label="Toggle favorite"
                        >
                          <FaHeart
                            className={`text-lg transition-all ${
                              charger.is_favorite ? 'text-red-500 animate-bounce-in' : 'text-ink-200 hover:text-red-300'
                            }`}
                          />
                        </button>
                      </div>
                      {charger.can_charge ? (
                        <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-50 text-green-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                          Available
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-500">
                          <FaExclamationTriangle className="text-[9px]" />
                          Currently Unavailable
                        </span>
                      )}
                      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-ink-500">
                        {charger.distance_km != null && (
                          <span className="inline-flex items-center gap-1">
                            <FaMapMarkerAlt className="text-ink-300 text-[10px]" />
                            {charger.distance_km.toFixed(1)} km
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <FaBolt className="text-ink-300 text-[10px]" />
                          {charger.max_power_kw} kW
                        </span>
                        <span className="inline-flex items-center gap-1 truncate">
                          <FaPlug className="text-ink-300 text-[10px]" />
                          {connectorTypesFor(charger)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <FaClock className="text-ink-300 text-[10px]" />
                          {charger.twenty_four_seven_open_status ? '24/7' : 'Specific hours'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-ink-100 px-2 sm:px-4 flex items-center justify-around shadow-[0_-4px_20px_rgba(30,41,26,0.06)] z-10 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
        <button onClick={() => history.push('/dashboard')} className="btn-press flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl bg-brand-50 text-brand-600 transition">
          <FaMapMarkerAlt className="text-lg" />
          <span className="text-[11px] font-medium">Find</span>
        </button>
        <button onClick={() => history.push('/wallet')} className="btn-press flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-ink-300 hover:text-brand-600 hover:bg-brand-50/60 transition">
          <FaWallet className="text-lg" />
          <span className="text-[11px] font-medium">Wallet</span>
        </button>

        <button
          onClick={toggleScanner}
          className="btn-press relative -translate-y-4 w-14 h-14 rounded-full bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-glow flex items-center justify-center transition"
          aria-label="Scan QR code"
        >
          <span className="absolute inset-0 rounded-full bg-brand-400 animate-pulse-ring" />
          <FaQrcode className="relative text-2xl" />
        </button>

        <button onClick={() => history.push('/userprofile')} className="btn-press flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-ink-300 hover:text-brand-600 hover:bg-brand-50/60 transition">
          <FaUser className="text-lg" />
          <span className="text-[11px] font-medium">Profile</span>
        </button>
        <button onClick={toggleSidebar} className="btn-press flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-ink-300 hover:text-brand-600 hover:bg-brand-50/60 transition">
          <FaBars className="text-lg" />
          <span className="text-[11px] font-medium">Menu</span>
        </button>
      </div>

      {/* Charger Details Modal */}
      {selectedCharger && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-t-3xl sm:rounded-2.5xl shadow-card w-full sm:max-w-md max-h-[90vh] overflow-y-auto animate-slide-up sm:animate-scale-in">
            <div className="sticky top-0 bg-white/95 backdrop-blur-sm rounded-t-3xl sm:rounded-t-2.5xl border-b border-ink-100 px-5 py-4 flex justify-between items-center gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <ChargerThumb charger={selectedCharger} size="lg" />
                <h2 className="text-base sm:text-lg font-bold text-ink-900 truncate">
                  {titleFor(selectedCharger)}
                </h2>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={(e) => handleFavoriteToggle(selectedCharger, e)}
                  className="p-2.5 rounded-full hover:bg-red-50 transition"
                  aria-label="Toggle favorite"
                >
                  <FaHeart className={`text-lg ${selectedCharger.is_favorite ? 'text-red-500' : 'text-ink-200'}`} />
                </button>
                <button
                  onClick={() => setSelectedCharger(null)}
                  className="p-2.5 rounded-full hover:bg-ink-50 transition"
                  aria-label="Close"
                >
                  <FaTimes className="text-ink-400" />
                </button>
              </div>
            </div>
            <div className="p-5 space-y-1">
              {!selectedCharger.can_charge && (
                <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-xl bg-gray-100 text-gray-600 text-xs font-medium">
                  <FaExclamationTriangle className="flex-shrink-0" />
                  <span>
                    Currently Unavailable
                    {CHARGEABILITY_REASON_META[selectedCharger.chargeability_reason]?.label &&
                      selectedCharger.chargeability_reason !== 'AVAILABLE' &&
                      ` - ${CHARGEABILITY_REASON_META[selectedCharger.chargeability_reason].label}`}
                  </span>
                </div>
              )}
              <InfoRow icon={<FaBuilding />} label="Public ID" value={selectedCharger.charger_id} />
              {selectedCharger.distance_km != null && (
                <InfoRow icon={<FaMapMarkerAlt />} label="Distance" value={`${selectedCharger.distance_km.toFixed(1)} km`} />
              )}
              <InfoRow icon={<FaClock />} label="Timings" value={selectedCharger.twenty_four_seven_open_status ? '24/7' : 'Specific hours'} />
              <InfoRow icon={<FaBolt />} label="Max Power" value={`${selectedCharger.max_power_kw} kW`} />
              <div className="flex items-start gap-3 py-2.5">
                <div className="text-brand-500 mt-0.5"><FaPlug /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-ink-400 mb-1.5">Connectors</p>
                  {selectedCharger.connectors.length === 0 ? (
                    <p className="text-sm text-ink-700">Unknown</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedCharger.connectors.map((c) => (
                        <span
                          key={c.id}
                          className="inline-flex items-center gap-1.5 bg-ink-50 rounded-lg pl-2.5 pr-1.5 py-1 text-xs font-medium text-ink-700"
                        >
                          {c.connector_type} · {c.connector_total_capacity}kW
                          <ChargeabilityBadge canCharge={c.can_charge} reason={c.chargeability_reason} compact />
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {(selectedCharger.charger_type || selectedCharger.segment || selectedCharger.sub_segment) && (
                <InfoRow
                  icon={<FaTag />}
                  label="Type"
                  value={[selectedCharger.charger_type, selectedCharger.segment, selectedCharger.sub_segment]
                    .filter(Boolean)
                    .join(' \u00b7 ')}
                />
              )}
              {selectedCharger.parking && (
                <InfoRow icon={<FaParking />} label="Parking" value={selectedCharger.parking} />
              )}
              <InfoRow icon={<FaBuilding />} label="Hub" value={selectedCharger.hub_name || 'N/A'} />
              <InfoRow icon={<FaMapMarkerAlt />} label="Address" value={selectedCharger.hub_address || 'Address not available'} />
              <InfoRow
                icon={<FaBolt />}
                label="Rate"
                value={
                  priceLoading ? 'Loading...' : formatPrice(selectedPrice)
                }
              />
            </div>
            <div className="border-t border-ink-100 p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] space-y-2.5">
              <button
                onClick={() => setStartModalOpen(true)}
                disabled={!selectedCharger.can_charge}
                className="btn-press w-full bg-gradient-to-r from-brand-600 to-brand-500 hover:shadow-glow text-white font-semibold py-3 px-4 rounded-2xl flex items-center justify-center gap-2 shadow-glow transition disabled:opacity-50 disabled:shadow-none"
              >
                <FaBolt />
                <span>Start Charging</span>
              </button>
              {!selectedCharger.can_charge && (
                <p className="text-xs text-ink-400 text-center -mt-1">
                  {CHARGEABILITY_REASON_META[selectedCharger.chargeability_reason]?.label || 'Not available right now'}
                </p>
              )}
              <button
                onClick={() => {
                  const link = mapsLinkFor(selectedCharger);
                  if (link) window.open(link, '_blank');
                }}
                disabled={!mapsLinkFor(selectedCharger)}
                className="btn-press w-full bg-ink-50 hover:bg-ink-100 text-ink-700 font-semibold py-3 px-4 rounded-2xl flex items-center justify-center gap-2 transition disabled:opacity-50"
              >
                <FaMapMarkerAlt />
                <span>Get Directions</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR Scanner – no accessToken required; uses authedRequest internally */}
      {isScannerOpen && <QRScannerComponent onClose={toggleScanner} />}

      {selectedCharger && (
        <Modal
          isOpen={startModalOpen}
          onClose={() => setStartModalOpen(false)}
          chargerId={selectedCharger.charger_id}
        />
      )}
    </div>
  );
};

const InfoRow: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="flex items-start gap-3 py-2">
    <div className="w-8 h-8 rounded-xl bg-ink-50 flex items-center justify-center flex-shrink-0 text-ink-400 text-sm">
      {icon}
    </div>
    <div className="min-w-0 pt-1">
      <span className="text-[11px] uppercase tracking-wide font-semibold text-ink-300">{label}</span>
      <p className="text-sm text-ink-800 break-words">{value}</p>
    </div>
  </div>
);

export default Dashboard;