import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { Capacitor } from '@capacitor/core';
import QrReader from 'react-qr-barcode-scanner';
import Modal from './Modal';
import CameraErrorBoundary from '../components/CameraErrorBoundary';
import { FaQrcode, FaCheckCircle, FaExclamationTriangle, FaTimes, FaKeyboard, FaCamera } from 'react-icons/fa';
import { getCharger } from '../services/customerApi';
import StatusBadge from '../components/StatusBadge';

interface QRScannerComponentProps {
  onClose: () => void;
}

type CameraCapability = 'checking' | 'available' | 'unavailable';

/**
 * Feature-detects a usable camera *before* mounting the scanner.
 * `react-qr-barcode-scanner` calls `navigator.mediaDevices.getUserMedia`
 * directly; on a browser/webview where that API doesn't exist at all (older
 * or restricted browsers, non-HTTPS/non-localhost origins, some embedded
 * webviews), it throws synchronously rather than reporting through the
 * component's `onError` prop - so we have to check before rendering it, not
 * just handle its error callback.
 */
const detectCameraCapability = (): CameraCapability => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return 'unavailable';
  }
  // getUserMedia is only exposed in secure contexts (https, or localhost).
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return 'unavailable';
  }
  return 'available';
};

const QRScannerComponent: React.FC<QRScannerComponentProps> = ({ onClose }) => {
  const [scannedData, setScannedData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [scanning, setScanning] = useState(true);
  const [lookupLoading, setLookupLoading] = useState(false);

  const isNative = Capacitor.isNativePlatform();
  const [cameraCapability, setCameraCapability] = useState<CameraCapability>(isNative ? 'available' : 'checking');
  const [manualEntry, setManualEntry] = useState(false);
  const [manualChargerId, setManualChargerId] = useState('');
  const nativeScanRef = useRef(false);

  useEffect(() => {
    if (!isNative) {
      setCameraCapability(detectCameraCapability());
    }
  }, [isNative]);

  /**
   * Safely extract charger ID (uid) from QR text.
   * Handles JSON objects with uid/charger_id/id or plain strings.
   */
  const extractChargerId = (rawText: string): string | null => {
    const trimmed = rawText.trim();
    if (!trimmed) return null;

    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'string') return parsed.trim() || null;
      if (parsed && typeof parsed === 'object') {
        return parsed.uid || parsed.charger_id || parsed.id || parsed.chargerId || null;
      }
      return null;
    } catch {
      // Not JSON – treat the raw string as the charger ID
      return trimmed;
    }
  };

  const lookupCharger = async (chargerId: string) => {
    setLookupLoading(true);
    setScanning(false);
    try {
      // Uses authedRequest under the hood - handles token injection + refresh.
      const chargerData = await getCharger(chargerId);

      const connectors = chargerData.connectors
        ?.filter((conn: any) => conn.status === 'ACTIVE')
        ?.map((conn: any) => conn.connector_type || `Connector ${conn.connector_number}`) || [];

      setScannedData({
        uid: chargerId,
        ChargerName: chargerData.charger_name || chargerData.hub_name || `Charger ${chargerId}`,
        Chargertype: chargerData.charger_type,
        Total_Capacity: chargerData.max_power_kw,
        Connector_type: connectors.join(', '),
        full_address: chargerData.hub_address,
        status: chargerData.status,
        connectors: chargerData.connectors,
      });

      setModalOpen(true);
      setError(null);
    } catch (err: any) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Error: ${errorMessage}`);
      toast.error(errorMessage || 'Could not find that charger.');
    } finally {
      setLookupLoading(false);
      setScanning(true);
    }
  };

  const handleUpdate = async (_: any, result: any) => {
    if (!result?.text) return;
    const chargerId = extractChargerId(result.text);
    if (!chargerId) {
      setError('Could not extract charger ID from QR code.');
      toast.error('Could not read that QR code. Try again or enter the charger ID manually.');
      return;
    }
    await lookupCharger(chargerId);
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = manualChargerId.trim();
    if (!trimmed) {
      setError('Enter a charger ID.');
      toast.error('Enter a charger ID.');
      return;
    }
    await lookupCharger(trimmed);
  };

  /** Native camera scan via the Capacitor plugin - bypasses the web getUserMedia path entirely. */
  const startNativeScan = async () => {
    if (nativeScanRef.current) return;
    nativeScanRef.current = true;
    setError(null);
    try {
      const { BarcodeScanner } = await import('@capacitor-community/barcode-scanner');
      const permission = await BarcodeScanner.checkPermission({ force: true });
      if (!permission.granted) {
        const message = 'Camera permission was denied. You can still enter the charger ID manually below.';
        setError(message);
        toast.error(message);
        setManualEntry(true);
        return;
      }
      await BarcodeScanner.hideBackground();
      document.body.classList.add('qr-scanner-active');
      const result = await BarcodeScanner.startScan();
      document.body.classList.remove('qr-scanner-active');
      await BarcodeScanner.showBackground();
      if (result.hasContent) {
        const chargerId = extractChargerId(result.content);
        if (chargerId) await lookupCharger(chargerId);
        else {
          setError('Could not extract charger ID from QR code.');
          toast.error('Could not read that QR code. Try again or enter the charger ID manually.');
        }
      }
    } catch (err) {
      document.body.classList.remove('qr-scanner-active');
      const message = err instanceof Error ? err.message : String(err);
      setError(`Camera error: ${message}. You can enter the charger ID manually below.`);
      toast.error('Camera failed to start. You can enter the charger ID manually.');
      setManualEntry(true);
    } finally {
      nativeScanRef.current = false;
    }
  };

  useEffect(() => {
    if (isNative && !modalOpen && !manualEntry) {
      startNativeScan();
    }
    return () => {
      if (isNative) {
        import('@capacitor-community/barcode-scanner')
          .then(({ BarcodeScanner }) => BarcodeScanner.stopScan().catch(() => {}))
          .catch(() => {});
        document.body.classList.remove('qr-scanner-active');
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNative, manualEntry]);

  return (
    <div className={`fixed inset-0 flex items-center justify-center z-50 p-4 animate-fade-in ${isNative ? '' : 'bg-black/50 backdrop-blur-md'}`}>
      <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl w-full max-w-md mx-auto overflow-hidden animate-slide-up sm:animate-scale-in">
        {/* Header */}
        <div className="bg-gradient-to-r from-brand-600 to-brand-500 px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <FaQrcode className="text-white text-2xl" />
            <h2 className="text-xl font-bold text-white">Scan Charger QR</h2>
          </div>
          <button onClick={onClose} className="btn-press text-white/80 hover:text-white transition p-1" aria-label="Close">
            <FaTimes className="text-xl" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {error && (
            <div className="mb-4 bg-red-50 border-l-4 border-red-500 p-3 rounded flex items-start gap-2 animate-slide-up">
              <FaExclamationTriangle className="text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}

          {isNative ? (
            <div className="text-center py-6">
              <FaCamera className="mx-auto text-4xl text-brand-400 mb-3" />
              <p className="text-gray-600 text-sm">Point your camera at the charger's QR code.</p>
              <button
                onClick={startNativeScan}
                className="btn-press mt-4 px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition"
              >
                Open camera
              </button>
            </div>
          ) : cameraCapability === 'checking' ? (
            <div className="flex justify-center py-10">
              <div className="animate-spin h-8 w-8 border-2 border-brand-500 border-t-transparent rounded-full" />
            </div>
          ) : cameraCapability === 'unavailable' || manualEntry ? (
            <div className="py-2">
              {cameraCapability === 'unavailable' && !manualEntry && (
                <div className="mb-4 bg-amber-50 border-l-4 border-amber-400 p-3 rounded flex items-start gap-2 animate-slide-up">
                  <FaExclamationTriangle className="text-amber-500 mt-0.5 flex-shrink-0" />
                  <p className="text-amber-800 text-sm">
                    Camera scanning isn't available in this browser (no camera access, or the page isn't loaded
                    over HTTPS). Enter the charger ID printed on the unit instead.
                  </p>
                </div>
              )}
              <form onSubmit={handleManualSubmit} className="space-y-3">
                <label className="block text-sm font-medium text-gray-700">Charger ID</label>
                <input
                  type="text"
                  value={manualChargerId}
                  onChange={(e) => setManualChargerId(e.target.value)}
                  placeholder="e.g. CH-00123"
                  autoFocus
                  className="w-full bg-white text-black border border-gray-300 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                />
                <button
                  type="submit"
                  disabled={lookupLoading || !manualChargerId.trim()}
                  className="btn-press w-full bg-gradient-to-r from-brand-600 to-brand-500 hover:shadow-glow text-white font-semibold py-2.5 rounded-lg transition disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
                >
                  {lookupLoading ? (
                    <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
                  ) : (
                    'Find charger'
                  )}
                </button>
              </form>
              {cameraCapability === 'available' && manualEntry && (
                <button
                  onClick={() => {
                    setManualEntry(false);
                    setError(null);
                  }}
                  className="btn-press mt-3 w-full text-sm text-brand-600 hover:text-brand-700 font-medium flex items-center justify-center gap-2"
                >
                  <FaCamera /> Use camera instead
                </button>
              )}
            </div>
          ) : (
            <>
              <p className="text-gray-600 text-sm text-center mb-4">
                Align the QR code within the frame to start charging
              </p>

              {/* Scanner Container */}
              <div className="relative rounded-xl overflow-hidden shadow-lg border-2 border-brand-200 bg-black/5">
                <div className="relative">
                  <CameraErrorBoundary
                    onFailure={(message) => {
                      setError(`${message} - you can enter the charger ID manually below.`);
                      setScanning(false);
                      setManualEntry(true);
                    }}
                  >
                    <QrReader
                      delay={300}
                      onError={(err) => {
                        const errorMessage = err instanceof Error ? err.message : String(err);
                        setError(
                          `${errorMessage || 'Scanning failed'} - you can enter the charger ID manually below.`
                        );
                        setScanning(false);
                        setManualEntry(true);
                      }}
                      onUpdate={handleUpdate}
                    />
                  </CameraErrorBoundary>
                  {scanning && !error && (
                    <div className="absolute inset-0 pointer-events-none overflow-hidden">
                      <div className="absolute left-0 w-full h-8 -translate-y-1/2 animate-scan" style={{ background: 'linear-gradient(to bottom, transparent, rgba(125,171,73,0.35), transparent)' }} />
                      <div className="absolute left-0 w-full h-0.5 bg-brand-400 shadow-glow animate-scan" />
                      <div className="absolute inset-0 border-2 border-brand-400 rounded-xl animate-pulse"></div>
                    </div>
                  )}
                </div>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-64 h-64 border-2 border-brand-400 rounded-lg shadow-lg bg-transparent flex items-center justify-center">
                    <FaQrcode className="text-brand-500 text-5xl opacity-40" />
                  </div>
                </div>
              </div>

              <button
                onClick={() => setManualEntry(true)}
                className="btn-press mt-4 w-full text-sm text-gray-500 hover:text-brand-600 font-medium flex items-center justify-center gap-2"
              >
                <FaKeyboard /> Enter charger ID manually instead
              </button>
            </>
          )}

          {/* Scanned Data Card */}
          {scannedData && (
            <div className="mt-5 bg-brand-50 border border-brand-200 rounded-xl p-4 animate-slide-up">
              <div className="flex items-center gap-2 mb-2">
                <FaCheckCircle className="text-green-600" />
                <h3 className="font-semibold text-brand-800">Charger Detected</h3>
                {scannedData?.status && <StatusBadge status={scannedData.status} compact />}
              </div>
              <div className="space-y-2 text-sm">
                <p><strong className="text-gray-700">Name:</strong> <span className="text-gray-900">{scannedData?.ChargerName}</span></p>
                <p><strong className="text-gray-700">UID:</strong> <span className="font-mono text-gray-900">{scannedData?.uid}</span></p>
                {scannedData?.Chargertype && (
                  <p><strong className="text-gray-700">Type:</strong> {scannedData.Chargertype}</p>
                )}
                {scannedData?.Total_Capacity && (
                  <p><strong className="text-gray-700">Capacity:</strong> {scannedData.Total_Capacity} kW</p>
                )}
                {scannedData?.Connector_type && (
                  <p><strong className="text-gray-700">Connectors:</strong> {scannedData.Connector_type}</p>
                )}
                {scannedData?.full_address && (
                  <p><strong className="text-gray-700">Address:</strong> {scannedData.full_address}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} chargerId={scannedData?.uid} />
    </div>
  );
};

export default QRScannerComponent;
