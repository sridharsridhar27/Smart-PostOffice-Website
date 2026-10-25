import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

const REGION_ID = "barcode-scanner-region";

const FORMATS = [
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.QR_CODE,
];

export default function BarcodeScanner({ onScan }) {
  const scannerRef = useRef(null);
  const handledRef = useRef(false);
  const [active, setActive] = useState(false);
  const [error, setError] = useState("");

  const stopScanner = async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (scanner) {
      try {
        if (scanner.isScanning) await scanner.stop();
        scanner.clear();
      } catch {
        /* already stopped */
      }
    }
    setActive(false);
  };

  const startScanner = async () => {
    setError("");
    handledRef.current = false;

    try {
      const scanner = new Html5Qrcode(REGION_ID, { formatsToSupport: FORMATS, verbose: false });
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 300, height: 120 } },
        async (decodedText) => {
          if (handledRef.current) return; // avoid double reads
          handledRef.current = true;
          await stopScanner();
          onScan(decodedText.trim());
        },
        () => {} // ignore "not found" frames
      );

      setActive(true);
    } catch {
      scannerRef.current = null;
      setError("Could not start camera. Allow camera permission, or type the tracking number below.");
    }
  };

  // Stop camera when leaving the page
  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, []);

  return (
    <div>
      <div
        id={REGION_ID}
        className={`overflow-hidden rounded-lg bg-slate-900 ${active ? "min-h-56" : "h-0"}`}
      />

      {!active ? (
        <button
          type="button"
          onClick={startScanner}
          className="flex w-full items-center justify-center gap-2 rounded-md border-2 border-dashed border-red-300 bg-red-50 py-6 text-sm font-medium text-red-700 hover:bg-red-100"
        >
          📷 Start Camera Scan
        </button>
      ) : (
        <button
          type="button"
          onClick={stopScanner}
          className="mt-2 w-full rounded-md bg-slate-200 py-2 text-sm font-medium hover:bg-slate-300"
        >
          Stop Camera
        </button>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}