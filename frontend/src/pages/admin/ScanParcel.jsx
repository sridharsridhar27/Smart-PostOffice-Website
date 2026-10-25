import { useState } from "react";
import { Link } from "react-router-dom";
import api, { getErrorMessage } from "../../api/axios";
import BarcodeScanner from "../../components/BarcodeScanner";
import { PARCEL_TYPES, PARCEL_TYPE_LABELS } from "../../utils/parcelStatus";

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600";

const initialDetails = { senderName: "", parcelType: "SMALL", weight: "" };

export default function ScanParcel() {
  const [trackingNumber, setTrackingNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [customer, setCustomer] = useState(null);
  const [details, setDetails] = useState(initialDetails);

  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const handleScan = (text) => setTrackingNumber(text.toUpperCase());

  const handlePhoneChange = (e) => {
    setPhone(e.target.value.replace(/\D/g, ""));
    setCustomer(null);
    setLookupError("");
  };

  const findCustomer = async () => {
    setLookupError("");
    setCustomer(null);

    if (!/^[6-9]\d{9}$/.test(phone)) {
      setLookupError("Enter a valid 10-digit phone number");
      return;
    }

    setLookingUp(true);
    try {
      const res = await api.get("/admin/customers/lookup", { params: { phone } });
      setCustomer(res.data.customer);
    } catch (err) {
      setLookupError(getErrorMessage(err));
    } finally {
      setLookingUp(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!trackingNumber.trim()) {
      setError("Scan or enter the tracking number");
      return;
    }
    if (!customer) {
      setError("Find and confirm the customer first");
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.post("/admin/parcels", {
        trackingNumber: trackingNumber.trim(),
        phone,
        senderName: details.senderName,
        parcelType: details.parcelType,
        weight: details.weight,
      });
      setResult(res.data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setTrackingNumber("");
    setPhone("");
    setCustomer(null);
    setDetails(initialDetails);
    setError("");
    setLookupError("");
    setResult(null);
  };

  // ---------- Success screen ----------
  if (result) {
    const p = result.parcel;
    return (
      <div className="mx-auto max-w-xl rounded-xl bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-green-700">Parcel Registered</h2>

        <ul className="mt-4 space-y-2">
          {result.steps.map((step) => (
            <li key={step} className="flex items-center gap-2 text-sm">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-xs text-green-700">
                ✓
              </span>
              {step}
            </li>
          ))}
        </ul>

        <div className="mt-5 rounded-lg bg-slate-50 p-4 font-mono text-sm">
          {p.trackingNumber} → {p.customer.name} → {p.customer.street.name}, {p.customer.area.name}
          <p className="mt-1 font-sans text-xs text-slate-500">Status: Waiting for customer slot booking</p>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={resetForm}
            className="flex-1 rounded-md bg-red-700 py-2 text-sm font-semibold text-white hover:bg-red-800"
          >
            Scan Next Parcel
          </button>
          <Link
            to={`/admin/parcels/${p.id}`}
            className="flex-1 rounded-md border border-slate-300 py-2 text-center text-sm font-medium hover:bg-slate-50"
          >
            View Parcel
          </Link>
        </div>
      </div>
    );
  }

  // ---------- Scan form ----------
  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">Scan & Register Parcel</h2>

      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <form onSubmit={handleSubmit} className="grid gap-6 md:grid-cols-2">
        {/* Left: barcode */}
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <h3 className="mb-3 font-semibold">1. Parcel Barcode</h3>
          <BarcodeScanner onScan={handleScan} />

          <label className="mb-1 mt-4 block text-sm font-medium">Tracking Number</label>
          <input
            value={trackingNumber}
            onChange={(e) => setTrackingNumber(e.target.value.toUpperCase())}
            className={`${inputClass} font-mono`}
            placeholder="Scan or type tracking number"
          />
          {trackingNumber && <p className="mt-1 text-xs text-green-700">✓ Barcode captured</p>}
        </div>

        {/* Right: customer + details */}
        <div className="space-y-6">
          <div className="rounded-xl bg-white p-5 shadow-sm">
            <h3 className="mb-3 font-semibold">2. Customer</h3>
            <label className="mb-1 block text-sm font-medium">Customer Phone</label>
            <div className="flex gap-2">
              <input
                value={phone}
                onChange={handlePhoneChange}
                maxLength={10}
                className={inputClass}
                placeholder="10-digit phone number"
              />
              <button
                type="button"
                onClick={findCustomer}
                disabled={lookingUp}
                className="shrink-0 rounded-md bg-slate-800 px-4 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-60"
              >
                {lookingUp ? "Finding..." : "Find"}
              </button>
            </div>

            {lookupError && <p className="mt-2 text-sm text-red-600">{lookupError}</p>}

            {customer && (
              <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
                <p className="font-semibold text-green-800">✓ {customer.name}</p>
                <p className="text-slate-700">
                  {customer.addressLine}, {customer.street?.name}, {customer.area?.name}
                </p>
                <p className="text-slate-500">{customer.email}</p>
              </div>
            )}
          </div>

          <div className="rounded-xl bg-white p-5 shadow-sm">
            <h3 className="mb-3 font-semibold">3. Parcel Details</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium">Sender Name (optional)</label>
                <input
                  value={details.senderName}
                  onChange={(e) => setDetails({ ...details, senderName: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Parcel Type</label>
                <select
                  value={details.parcelType}
                  onChange={(e) => setDetails({ ...details, parcelType: e.target.value })}
                  className={inputClass}
                >
                  {PARCEL_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {PARCEL_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Weight in kg (optional)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={details.weight}
                  onChange={(e) => setDetails({ ...details, weight: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || !customer || !trackingNumber}
            className="w-full rounded-md bg-red-700 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
          >
            {submitting ? "Registering..." : "Register Parcel & Notify Customer"}
          </button>
        </div>
      </form>
    </div>
  );
}