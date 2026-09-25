// src/pages/VehicleCreation.tsx
//
// "My Vehicles" - full CRUD against USER_APP_ROOT's /vehicles surface
// (list with search/cursor pagination, create, update, delete). Kept the
// original filename/route (/add-vehicle) since App.tsx and Sidebar.tsx both
// already point here and the sidebar already labels it "My Vehicles".

import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { useHistory } from 'react-router-dom';
import { FaArrowLeft, FaCar, FaPlus, FaPen, FaTrash, FaTimes, FaSearch, FaSpinner } from 'react-icons/fa';
import { createVehicle, deleteVehicle, getVehicles, updateVehicle } from '../services/customerApi';
import { CustomerVehicle } from '../types/auth';

const inputClass =
  'block w-full px-4 py-2.5 border border-ink-100 rounded-xl bg-ink-50 focus:bg-white text-ink-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-transparent transition-all';
const labelClass = 'block text-sm font-semibold text-ink-700 mb-1.5';

type FormState = {
  vehicle_number: string;
  vehicle_type: string;
  vehicle_make: string;
  vehicle_model: string;
};

const EMPTY_FORM: FormState = { vehicle_number: '', vehicle_type: '', vehicle_make: '', vehicle_model: '' };

const subtitleFor = (v: CustomerVehicle) => [v.vehicle_make, v.vehicle_model, v.vehicle_type].filter(Boolean).join(' · ');

const VehicleCreation: React.FC = () => {
  const history = useHistory();

  const [vehicles, setVehicles] = useState<CustomerVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [nextBefore, setNextBefore] = useState<string | undefined>();
  const [nextBeforeId, setNextBeforeId] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchVehicles = async (search?: string) => {
    setLoading(true);
    setLoadError('');
    try {
      const result = await getVehicles({ search: search || undefined, limit: 50 });
      setVehicles(result.vehicles);
      setHasMore(result.has_more);
      setNextBefore(result.next_before);
      setNextBeforeId(result.next_before_id);
    } catch (err: any) {
      const message = err.message || 'Could not load your vehicles.';
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVehicles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Simple debounce so every keystroke doesn't fire a request.
  useEffect(() => {
    const t = setTimeout(() => fetchVehicles(searchTerm), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

  const loadMore = async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await getVehicles({
        search: searchTerm || undefined,
        limit: 50,
        before: nextBefore,
        before_id: nextBeforeId,
      });
      setVehicles((prev) => [...prev, ...result.vehicles]);
      setHasMore(result.has_more);
      setNextBefore(result.next_before);
      setNextBeforeId(result.next_before_id);
    } catch (err: any) {
      toast.error(err.message || 'Could not load more vehicles.');
    } finally {
      setLoadingMore(false);
    }
  };

  const openAddSheet = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setSheetOpen(true);
  };

  const openEditSheet = (vehicle: CustomerVehicle) => {
    setEditingId(vehicle.id);
    setForm({
      vehicle_number: vehicle.vehicle_number,
      vehicle_type: vehicle.vehicle_type || '',
      vehicle_make: vehicle.vehicle_make || '',
      vehicle_model: vehicle.vehicle_model || '',
    });
    setFormError('');
    setSheetOpen(true);
  };

  const closeSheet = () => {
    if (submitting) return;
    setSheetOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const vehicleNumber = form.vehicle_number.trim();
    if (!vehicleNumber) {
      setFormError('Vehicle number is required.');
      return;
    }
    if (vehicleNumber.length > 50) {
      setFormError('Vehicle number must be 50 characters or fewer.');
      return;
    }
    setFormError('');
    setSubmitting(true);
    try {
      if (editingId) {
        const updated = await updateVehicle(editingId, {
          vehicle_number: vehicleNumber,
          vehicle_type: form.vehicle_type.trim() || null,
          vehicle_make: form.vehicle_make.trim() || null,
          vehicle_model: form.vehicle_model.trim() || null,
        });
        setVehicles((prev) => prev.map((v) => (v.id === editingId ? updated : v)));
        toast.success('Vehicle updated');
      } else {
        const created = await createVehicle({
          vehicle_number: vehicleNumber,
          vehicle_type: form.vehicle_type.trim() || undefined,
          vehicle_make: form.vehicle_make.trim() || undefined,
          vehicle_model: form.vehicle_model.trim() || undefined,
        });
        setVehicles((prev) => [created, ...prev]);
        toast.success('Vehicle added');
      }
      setSheetOpen(false);
    } catch (err: any) {
      const message = err.message || 'Something went wrong. Please try again.';
      setFormError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (vehicleId: string) => {
    setDeletingId(vehicleId);
    try {
      await deleteVehicle(vehicleId);
      setVehicles((prev) => prev.filter((v) => v.id !== vehicleId));
      toast.success('Vehicle removed');
    } catch (err: any) {
      toast.error(err.message || 'Could not remove this vehicle.');
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-b from-brand-50 via-white to-white">
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
          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl font-bold text-ink-900 tracking-tight">My Vehicles</h1>
            <p className="text-xs sm:text-sm text-ink-400">Manage the vehicles on your account</p>
          </div>
          <button
            onClick={openAddSheet}
            className="btn-press flex-shrink-0 flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-3.5 py-2 rounded-full shadow-glow transition"
          >
            <FaPlus className="text-xs" /> Add
          </button>
        </div>
        <div className="max-w-2xl mx-auto px-4 sm:px-6 pb-3">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
              <FaSearch className="text-ink-300 text-sm" />
            </div>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by number, make, model…"
              className="w-full pl-10 pr-4 py-2.5 border border-ink-100 rounded-full bg-ink-50 focus:bg-white focus:ring-2 focus:ring-brand-300 focus:border-transparent outline-none transition-all text-sm placeholder:text-ink-300"
            />
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 pb-10">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-2xl shadow-soft p-4 flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-xl skeleton flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/2 skeleton rounded" />
                  <div className="h-3 w-1/3 skeleton rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : loadError ? (
          <div className="text-center py-12 animate-scale-in">
            <p className="text-red-500 text-sm mb-3">{loadError}</p>
            <button
              onClick={() => fetchVehicles(searchTerm)}
              className="btn-press px-5 py-2 bg-brand-600 text-white rounded-full text-sm font-medium"
            >
              Retry
            </button>
          </div>
        ) : vehicles.length === 0 ? (
          <div className="text-center py-16 animate-fade-in">
            <div className="w-16 h-16 mx-auto rounded-full bg-brand-50 flex items-center justify-center mb-4">
              <FaCar className="text-2xl text-brand-300" />
            </div>
            <p className="text-ink-500 font-medium">
              {searchTerm ? 'No vehicles match your search.' : "You haven't added a vehicle yet."}
            </p>
            {!searchTerm && (
              <button
                onClick={openAddSheet}
                className="btn-press mt-4 inline-flex items-center gap-1.5 px-5 py-2.5 bg-brand-600 text-white rounded-full text-sm font-semibold shadow-glow"
              >
                <FaPlus className="text-xs" /> Add your first vehicle
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {vehicles.map((vehicle, idx) => (
              <div
                key={vehicle.id}
                style={{ animationDelay: `${Math.min(idx, 8) * 40}ms` }}
                className="card-interactive animate-slide-up bg-white rounded-2xl shadow-soft p-4 flex items-center gap-3.5"
              >
                <div className="w-11 h-11 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
                  <FaCar className="text-brand-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm sm:text-base font-semibold text-ink-900 truncate">{vehicle.vehicle_number}</h3>
                  <p className="text-xs text-ink-400 truncate">{subtitleFor(vehicle) || 'No other details added'}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => openEditSheet(vehicle)}
                    className="btn-press p-2 rounded-full hover:bg-ink-50 text-ink-400 hover:text-brand-600 transition"
                    aria-label="Edit vehicle"
                  >
                    <FaPen className="text-sm" />
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(vehicle.id)}
                    className="btn-press p-2 rounded-full hover:bg-red-50 text-ink-400 hover:text-red-500 transition"
                    aria-label="Remove vehicle"
                  >
                    <FaTrash className="text-sm" />
                  </button>
                </div>
              </div>
            ))}

            {hasMore && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="btn-press w-full py-2.5 rounded-full bg-ink-50 text-ink-600 text-sm font-medium hover:bg-ink-100 transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loadingMore ? <FaSpinner className="animate-spin" /> : null}
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Add / edit sheet */}
      {sheetOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 sm:p-4 animate-fade-in">
          <div className="bg-white rounded-t-3xl sm:rounded-2.5xl shadow-card w-full sm:max-w-md max-h-[90vh] overflow-y-auto animate-slide-up sm:animate-scale-in">
            <div className="sticky top-0 bg-white rounded-t-3xl sm:rounded-t-2.5xl border-b border-ink-100 px-5 py-4 flex justify-between items-center z-10">
              <h2 className="text-lg font-bold text-ink-900 flex items-center gap-2">
                <FaCar className="text-brand-600" />
                {editingId ? 'Edit Vehicle' : 'Add Vehicle'}
              </h2>
              <button onClick={closeSheet} className="btn-press p-2 rounded-full hover:bg-ink-50 transition" aria-label="Close">
                <FaTimes className="text-ink-400" />
              </button>
            </div>

            <form onSubmit={handleSubmit} noValidate className="p-5 space-y-4">
              <div>
                <label className={labelClass}>Vehicle Number *</label>
                <input
                  type="text"
                  value={form.vehicle_number}
                  onChange={(e) => setForm((f) => ({ ...f, vehicle_number: e.target.value }))}
                  maxLength={50}
                  required
                  autoFocus
                  className={inputClass}
                  placeholder="e.g. KA01AB1234"
                />
              </div>
              <div>
                <label className={labelClass}>Type</label>
                <input
                  type="text"
                  value={form.vehicle_type}
                  onChange={(e) => setForm((f) => ({ ...f, vehicle_type: e.target.value }))}
                  maxLength={50}
                  className={inputClass}
                  placeholder="e.g. Hatchback"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Make</label>
                  <input
                    type="text"
                    value={form.vehicle_make}
                    onChange={(e) => setForm((f) => ({ ...f, vehicle_make: e.target.value }))}
                    maxLength={100}
                    className={inputClass}
                    placeholder="e.g. Tata"
                  />
                </div>
                <div>
                  <label className={labelClass}>Model</label>
                  <input
                    type="text"
                    value={form.vehicle_model}
                    onChange={(e) => setForm((f) => ({ ...f, vehicle_model: e.target.value }))}
                    maxLength={100}
                    className={inputClass}
                    placeholder="e.g. Tiago EV"
                  />
                </div>
              </div>

              {formError && (
                <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2.5 animate-slide-up">
                  <p className="text-red-700 text-sm text-center">{formError}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !form.vehicle_number.trim()}
                className="btn-press w-full bg-gradient-to-r from-brand-600 to-brand-500 hover:shadow-glow text-white font-semibold py-3 rounded-2xl shadow-glow transition disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <FaSpinner className="animate-spin" />
                ) : editingId ? (
                  'Save Changes'
                ) : (
                  'Add Vehicle'
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDeleteId && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-2.5xl shadow-card w-full max-w-sm p-5 animate-scale-in">
            <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center mb-3">
              <FaTrash className="text-red-500" />
            </div>
            <h3 className="text-base font-bold text-ink-900 mb-1">Remove this vehicle?</h3>
            <p className="text-sm text-ink-400 mb-5">This can't be undone.</p>
            <div className="flex gap-2.5">
              <button
                onClick={() => setConfirmDeleteId(null)}
                disabled={deletingId === confirmDeleteId}
                className="btn-press flex-1 py-2.5 rounded-xl bg-ink-50 text-ink-600 font-semibold text-sm hover:bg-ink-100 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDeleteId)}
                disabled={deletingId === confirmDeleteId}
                className="btn-press flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-sm transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {deletingId === confirmDeleteId ? <FaSpinner className="animate-spin" /> : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VehicleCreation;
