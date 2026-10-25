import { useEffect, useState } from "react";
import api, { getErrorMessage } from "../../api/axios";
import { useAuth } from "../../context/AuthContext";
import StatusBadge from "../../components/StatusBadge";
import { PARCEL_TYPE_LABELS } from "../../utils/parcelStatus";
import { formatDateTime } from "../../utils/format";
import { addDays, getISTToday } from "../../utils/slot";

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600";

export default function DeliveryDashboard() {
  const { user } = useAuth();
  const today = getISTToday();

  const [date, setDate] = useState(today);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  // Inline form: { parcelId, type: "delivered" | "failed" }
  const [form, setForm] = useState(null);
  const [receivedBy, setReceivedBy] = useState("");
  const [failReason, setFailReason] = useState("CUSTOMER_NOT_AVAILABLE");
  const [failNote, setFailNote] = useState("");

  const load = async (d = date) => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/delivery/parcels", { params: { date: d } });
      setData(res.data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(date);
    setForm(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const openForm = (parcelId, type) => {
    setForm({ parcelId, type });
    setReceivedBy("");
    setFailReason("CUSTOMER_NOT_AVAILABLE");
    setFailNote("");
    setError("");
  };

  const runAction = async (fn, successText) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      setMessage(successText);
      setForm(null);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const startDelivery = (d) =>
    runAction(
      () => api.patch(`/delivery/parcels/${d.parcel.id}/out-for-delivery`),
      `✓ ${d.parcel.trackingNumber} is out for delivery`
    );

  const startAll = (items) =>
    runAction(async () => {
      for (const d of items) {
        await api.patch(`/delivery/parcels/${d.parcel.id}/out-for-delivery`);
      }
    }, `✓ ${items.length} parcel(s) out for delivery`);

  const submitDelivered = (d) =>
    runAction(
      () => api.patch(`/delivery/parcels/${d.parcel.id}/delivered`, { receivedBy }),
      `✓ ${d.parcel.trackingNumber} delivered`
    );

  const submitFailed = (d) =>
    runAction(
      () => api.patch(`/delivery/parcels/${d.parcel.id}/failed`, { reason: failReason, note: failNote }),
      `${d.parcel.trackingNumber} marked as failed. Customer has been notified.`
    );

  // Group deliveries by slot (already sorted by slot from the API)
  const groups = [];
  (data?.deliveries || []).forEach((d) => {
    let g = groups.find((x) => x.slotHour === d.slotHour);
    if (!g) {
      g = { slotHour: d.slotHour, slotLabel: d.slotLabel, items: [] };
      groups.push(g);
    }
    g.items.push(d);
  });

  const quickBtn = (label, value) => (
    <button
      onClick={() => setDate(value)}
      className={`rounded-md border border-slate-300 px-3 py-2 text-sm font-medium ${
        date === value ? "bg-red-700 text-white" : "bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">My Deliveries</h2>
          <p className="text-sm text-slate-500">
            {user?.name} · Home area: {user?.homeArea?.name}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {quickBtn("Today", today)}
          {quickBtn("Tomorrow", addDays(today, 1))}
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {message && <div className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{message}</div>}
      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {loading || !data ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : (
        <>
          {/* Summary */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              ["Total", data.summary.total, "text-slate-800"],
              ["To Start", data.summary.pending, "text-indigo-700"],
              ["On the Way", data.summary.outForDelivery, "text-purple-700"],
              ["Delivered", data.summary.delivered, "text-green-700"],
              ["Failed", data.summary.failed, "text-red-700"],
            ].map(([label, value, color]) => (
              <div key={label} className="rounded-xl bg-white p-3 text-center shadow-sm">
                <p className="text-xs uppercase text-slate-500">{label}</p>
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          {!data.isToday && data.summary.total > 0 && (
            <div className="mb-4 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
              Viewing {data.dateLabel}. You can start these deliveries on that day.
            </div>
          )}

          {groups.length === 0 ? (
            <div className="rounded-xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
              No deliveries for {data.dateLabel}.
            </div>
          ) : (
            <div className="space-y-5">
              {groups.map((g) => {
                const toStart = g.items.filter((d) => d.deliveryStatus === "ASSIGNED");
                return (
                  <div key={g.slotHour}>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold">🕒 {g.slotLabel}</h3>
                      {data.isToday && toStart.length > 1 && (
                        <button
                          onClick={() => startAll(toStart)}
                          disabled={busy}
                          className="rounded-md bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
                        >
                          🚚 Start all ({toStart.length})
                        </button>
                      )}
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      {g.items.map((d) => {
                        const p = d.parcel;
                        const formOpen = form?.parcelId === p.id;
                        return (
                          <div key={d.assignmentId} className="rounded-xl bg-white p-4 shadow-sm">
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-mono font-semibold">{p.trackingNumber}</p>
                              <StatusBadge status={d.deliveryStatus} />
                            </div>

                            <div className="mt-2 text-sm">
                              <p className="font-medium">{p.customer.name}</p>
                              <p className="text-slate-600">
                                {p.customer.addressLine}, {p.customer.street?.name}, {p.customer.area?.name}
                              </p>
                              <a href={`tel:${p.customer.phone}`} className="text-red-700 hover:underline">
                                📞 {p.customer.phone}
                              </a>
                              <p className="mt-1 text-xs text-slate-500">
                                {PARCEL_TYPE_LABELS[p.parcelType]}
                                {p.weight ? ` · ${p.weight} kg` : ""}
                                {p.senderName ? ` · from ${p.senderName}` : ""}
                              </p>
                            </div>

                            {/* Result info */}
                            {d.deliveryStatus === "DELIVERED" && (
                              <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-xs text-green-800">
                                Delivered {formatDateTime(p.deliveredAt)}
                                {p.receivedBy ? ` · Received by ${p.receivedBy}` : ""}
                              </p>
                            )}
                            {d.deliveryStatus === "FAILED" && (
                              <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">
                                Failed: {d.failureReasonLabel}
                                {d.failureNote ? ` – ${d.failureNote}` : ""}
                              </p>
                            )}

                            {/* Actions */}
                            {d.deliveryStatus === "ASSIGNED" && data.isToday && (
                              <button
                                onClick={() => startDelivery(d)}
                                disabled={busy}
                                className="mt-3 w-full rounded-md bg-purple-600 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
                              >
                                🚚 Start Delivery
                              </button>
                            )}

                            {d.deliveryStatus === "OUT_FOR_DELIVERY" && !formOpen && (
                              <div className="mt-3 grid grid-cols-2 gap-2">
                                <button
                                  onClick={() => openForm(p.id, "delivered")}
                                  className="rounded-md bg-green-600 py-2 text-sm font-semibold text-white hover:bg-green-700"
                                >
                                  ✅ Delivered
                                </button>
                                <button
                                  onClick={() => openForm(p.id, "failed")}
                                  className="rounded-md bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-700"
                                >
                                  ✖ Failed
                                </button>
                              </div>
                            )}

                            {/* Delivered form */}
                            {formOpen && form.type === "delivered" && (
                              <div className="mt-3 space-y-2 rounded-lg border border-green-200 bg-green-50 p-3">
                                <label className="block text-xs font-medium">Received by (optional)</label>
                                <input
                                  value={receivedBy}
                                  onChange={(e) => setReceivedBy(e.target.value)}
                                  maxLength={60}
                                  placeholder="e.g. Self, Neighbour - Ramesh"
                                  className={inputClass}
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => setForm(null)}
                                    className="flex-1 rounded-md border border-slate-300 bg-white py-2 text-sm"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => submitDelivered(d)}
                                    disabled={busy}
                                    className="flex-1 rounded-md bg-green-600 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                                  >
                                    Confirm Delivered
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Failed form */}
                            {formOpen && form.type === "failed" && (
                              <div className="mt-3 space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
                                <label className="block text-xs font-medium">Reason</label>
                                <select
                                  value={failReason}
                                  onChange={(e) => setFailReason(e.target.value)}
                                  className={inputClass}
                                >
                                  {Object.entries(data.failureReasons).map(([value, label]) => (
                                    <option key={value} value={value}>
                                      {label}
                                    </option>
                                  ))}
                                </select>
                                <label className="block text-xs font-medium">
                                  Note {failReason === "OTHER" ? "(required)" : "(optional)"}
                                </label>
                                <input
                                  value={failNote}
                                  onChange={(e) => setFailNote(e.target.value)}
                                  maxLength={200}
                                  placeholder="e.g. No answer on phone"
                                  className={inputClass}
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => setForm(null)}
                                    className="flex-1 rounded-md border border-slate-300 bg-white py-2 text-sm"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => submitFailed(d)}
                                    disabled={busy || (failReason === "OTHER" && !failNote.trim())}
                                    className="flex-1 rounded-md bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                                  >
                                    Confirm Failed
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}