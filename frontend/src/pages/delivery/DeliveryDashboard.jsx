import { useEffect, useState } from "react";
import api, { getErrorMessage } from "../../api/axios";
import { useAuth } from "../../context/AuthContext";
import StatusBadge from "../../components/StatusBadge";
import { PARCEL_TYPE_LABELS } from "../../utils/parcelStatus";
import { formatDateTime } from "../../utils/format";
import { addDays, getISTToday } from "../../utils/slot";
import { areaWithPin, formatAddress } from "../../utils/address";

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600";

const TO_START = ["ASSIGNED", "PICKUP_ASSIGNED"];
const ON_THE_WAY = ["OUT_FOR_DELIVERY", "OUT_FOR_PICKUP"];

export default function DeliveryDashboard() {
  const { user } = useAuth();
  const today = getISTToday();

  const [date, setDate] = useState(today);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  // Inline form: { parcelId, type: "complete" | "fail" }
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

  const runAction = async (fn) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fn();
      setMessage(`✓ ${res?.data?.message || "Done"}`);
      setForm(null);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const startJob = (d) => runAction(() => api.patch(`/delivery/parcels/${d.parcel.id}/start`));

  const startAll = (items) =>
    runAction(async () => {
      for (const d of items) await api.patch(`/delivery/parcels/${d.parcel.id}/start`);
      return { data: { message: `${items.length} job(s) started` } };
    });

  const completeJob = (d) =>
    runAction(() => api.patch(`/delivery/parcels/${d.parcel.id}/complete`, { receivedBy }));

  const failJob = (d) =>
    runAction(() => api.patch(`/delivery/parcels/${d.parcel.id}/fail`, { reason: failReason, note: failNote }));

  // Group by slot (already sorted by slot from the API)
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
                        {user?.name} · Home area: {areaWithPin(user?.homeArea)}
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
          <div className="mb-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              ["Total jobs", data.summary.total, "text-slate-800"],
              ["To Start", data.summary.pending, "text-indigo-700"],
              ["On the Way", data.summary.outForDelivery, "text-purple-700"],
              ["Done", data.summary.delivered, "text-green-700"],
              ["Failed", data.summary.failed, "text-red-700"],
            ].map(([label, value, color]) => (
              <div key={label} className="rounded-xl bg-white p-3 text-center shadow-sm">
                <p className="text-xs uppercase text-slate-500">{label}</p>
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
              </div>
            ))}
          </div>
          {data.summary.pickups > 0 && (
            <p className="mb-4 text-sm text-orange-700">Includes {data.summary.pickups} return pickup(s).</p>
          )}

          {!data.isToday && data.summary.total > 0 && (
            <div className="mb-4 mt-2 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
              Viewing {data.dateLabel}. You can start these jobs on that day.
            </div>
          )}

          {groups.length === 0 ? (
            <div className="mt-4 rounded-xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
              No jobs for {data.dateLabel}.
            </div>
          ) : (
            <div className="mt-4 space-y-5">
              {groups.map((g) => {
                const toStart = g.items.filter((d) => TO_START.includes(d.deliveryStatus));
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
                        const isPickup = d.jobType === "PICKUP";
                        const formOpen = form?.parcelId === p.id;
                        const reasons = Object.entries(data.failureReasons).filter(
                          ([value]) => !(isPickup && value === "CUSTOMER_REFUSED")
                        );

                        return (
                          <div
                            key={d.assignmentId}
                            className={`rounded-xl bg-white p-4 shadow-sm ${isPickup ? "border-l-4 border-orange-400" : ""}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-mono font-semibold">
                                {p.trackingNumber}
                                {isPickup && (
                                  <span className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 font-sans text-xs font-semibold text-orange-700">
                                    PICKUP
                                  </span>
                                )}
                              </p>
                              <StatusBadge status={d.deliveryStatus} />
                            </div>

                            <div className="mt-2 text-sm">
                              <p className="font-medium">{p.customer.name}</p>
                                                            <p className="text-slate-600">{formatAddress(p.customer)}</p>
                              <a href={`tel:${p.customer.phone}`} className="text-red-700 hover:underline">
                                📞 {p.customer.phone}
                              </a>
                              <p className="mt-1 text-xs text-slate-500">
                                {PARCEL_TYPE_LABELS[p.parcelType]}
                                {p.weight ? ` · ${p.weight} kg` : ""}
                                {p.senderName ? ` · from ${p.senderName}` : ""}
                              </p>
                              {isPickup && d.returnReasonLabel && (
                                <p className="mt-1 text-xs font-medium text-orange-700">
                                  Return reason: {d.returnReasonLabel}
                                  {p.customerReturnNote ? ` – ${p.customerReturnNote}` : ""}
                                </p>
                              )}
                            </div>

                            {/* Result info */}
                            {d.deliveryStatus === "DELIVERED" && (
                              <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-xs text-green-800">
                                Delivered {formatDateTime(p.deliveredAt)}
                                {p.receivedBy ? ` · Received by ${p.receivedBy}` : ""}
                              </p>
                            )}
                            {d.deliveryStatus === "PICKED_UP" && (
                              <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-xs text-green-800">
                                Picked up · returning to sender
                              </p>
                            )}
                            {["FAILED", "PICKUP_FAILED"].includes(d.deliveryStatus) && (
                              <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">
                                Failed: {d.failureReasonLabel}
                                {d.failureNote ? ` – ${d.failureNote}` : ""}
                              </p>
                            )}

                            {/* Start */}
                            {TO_START.includes(d.deliveryStatus) && data.isToday && (
                              <button
                                onClick={() => startJob(d)}
                                disabled={busy}
                                className="mt-3 w-full rounded-md bg-purple-600 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
                              >
                                🚚 {isPickup ? "Start Pickup" : "Start Delivery"}
                              </button>
                            )}

                            {/* Complete / fail buttons */}
                            {ON_THE_WAY.includes(d.deliveryStatus) && !formOpen && (
                              <div className="mt-3 grid grid-cols-2 gap-2">
                                <button
                                  onClick={() => openForm(p.id, "complete")}
                                  className="rounded-md bg-green-600 py-2 text-sm font-semibold text-white hover:bg-green-700"
                                >
                                  ✅ {isPickup ? "Picked Up" : "Delivered"}
                                </button>
                                <button
                                  onClick={() => openForm(p.id, "fail")}
                                  className="rounded-md bg-red-600 py-2 text-sm font-semibold text-white hover:bg-red-700"
                                >
                                  ✖ Failed
                                </button>
                              </div>
                            )}

                            {/* Complete form */}
                            {formOpen && form.type === "complete" && (
                              <div className="mt-3 space-y-2 rounded-lg border border-green-200 bg-green-50 p-3">
                                {isPickup ? (
                                  <p className="text-sm text-green-800">
                                    Confirm you have collected the parcel from the customer.
                                  </p>
                                ) : (
                                  <>
                                    <label className="block text-xs font-medium">Received by (optional)</label>
                                    <input
                                      value={receivedBy}
                                      onChange={(e) => setReceivedBy(e.target.value)}
                                      maxLength={60}
                                      placeholder="e.g. Self, Neighbour - Ramesh"
                                      className={inputClass}
                                    />
                                  </>
                                )}
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => setForm(null)}
                                    className="flex-1 rounded-md border border-slate-300 bg-white py-2 text-sm"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => completeJob(d)}
                                    disabled={busy}
                                    className="flex-1 rounded-md bg-green-600 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                                  >
                                    {isPickup ? "Confirm Picked Up" : "Confirm Delivered"}
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Fail form */}
                            {formOpen && form.type === "fail" && (
                              <div className="mt-3 space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
                                <label className="block text-xs font-medium">Reason</label>
                                <select
                                  value={failReason}
                                  onChange={(e) => setFailReason(e.target.value)}
                                  className={inputClass}
                                >
                                  {reasons.map(([value, label]) => (
                                    <option key={value} value={value}>
                                      {label}
                                    </option>
                                  ))}
                                </select>
                                {failReason === "CUSTOMER_REFUSED" && (
                                  <p className="rounded bg-white px-2 py-1 text-xs font-medium text-red-700">
                                    The parcel will be returned to the sender. The customer cannot rebook it.
                                  </p>
                                )}
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
                                    onClick={() => failJob(d)}
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