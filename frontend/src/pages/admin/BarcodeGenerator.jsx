import { useState } from "react";
import Barcode from "react-barcode";

const randomTracking = () =>
  "PO" + Date.now().toString().slice(-8) + Math.floor(Math.random() * 90 + 10);

export default function BarcodeGenerator() {
  const [value, setValue] = useState(randomTracking);
  const [labels, setLabels] = useState([]);

  const addLabel = () => {
    const v = value.trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,30}$/.test(v) || labels.includes(v)) return;
    setLabels([v, ...labels]);
    setValue(randomTracking());
  };

  return (
    <div>
      <div className="print:hidden">
        <h2 className="text-xl font-semibold">Barcode Generator</h2>
        <p className="mb-4 text-sm text-slate-500">
          Create sample parcel barcodes for testing. Print them, or show them on a phone, and scan on the Scan
          Parcel page.
        </p>

        <div className="mb-6 flex flex-wrap gap-2">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value.toUpperCase())}
            className="min-w-64 flex-1 rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
          />
          <button onClick={() => setValue(randomTracking())} className="rounded-md bg-slate-200 px-4 text-sm font-medium hover:bg-slate-300">
            Random
          </button>
          <button onClick={addLabel} className="rounded-md bg-red-700 px-4 text-sm font-medium text-white hover:bg-red-800">
            Generate
          </button>
          {labels.length > 0 && (
            <button onClick={() => window.print()} className="rounded-md bg-slate-800 px-4 text-sm font-medium text-white hover:bg-slate-900">
              Print
            </button>
          )}
        </div>
      </div>

      {labels.length === 0 ? (
        <p className="text-sm text-slate-500 print:hidden">No barcodes yet. Click Generate.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {labels.map((l) => (
            <div key={l} className="flex flex-col items-center rounded-lg border bg-white p-3">
              <p className="mb-1 text-xs font-semibold text-red-700">SMART POST OFFICE</p>
              <Barcode value={l} format="CODE128" width={1.6} height={60} fontSize={14} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}