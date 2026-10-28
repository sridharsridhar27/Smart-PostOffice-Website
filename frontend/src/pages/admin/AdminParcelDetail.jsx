import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api, { getErrorMessage } from "../../api/axios";
import StatusBadge from "../../components/StatusBadge";
import StatusTimeline from "../../components/StatusTimeline";
import AssignmentPanel from "../../components/AssignmentPanel";
import {
  PARCEL_TYPE_LABELS,
  FAILURE_REASON_LABELS,
  RETURN_REASON_LABELS,
  RTS_REASON_LABELS,
} from "../../utils/parcelStatus";
import { formatDateTime } from "../../utils/format";
import { formatSlot } from "../../utils/slot";
import { formatAddress } from "../../utils/address";

const formatDate = (d) =>
  new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default function AdminParcelDetail() {
  const { id } = useParams();
  const [parcel, setParcel] = useState(null);
  const [error, setError] = useState("");

  // Return actions (FAILED parcels)
  const [rtsNote, setRtsNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);

  const loadParcel = useCallback(() => {
    api
      .get(`/admin/parcels/${id}`)
      .then((res) => setParcel(res.data.parcel))
      .catch((err) => setError(getErrorMessage(err)));
  }, [id]);

  useEffect(() => {
    loadParcel();
  }, [loadParcel]);

  const runAction = async (fn) => {
    setBusy(true);
    setActionMsg(null);
    try {
      const res = await fn();
      setActionMsg({ ok: true, text: res.data.message });
      setRtsNote("");
      loadParcel();
    } catch (err) {
      setActionMsg({ ok: false, text: getErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>;
  if (!parcel) return <p className="text-sm text-slate-500">Loading...</p>;

  const row = (label, value, cls = "") => (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className={cls}>{value}</dd>
    </>
  );

  return (
    <div>
      <Link to="/admin/parcels" className="text-sm text-red-700 hover:underline">← Back to parcels</Link>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h2 className="font-mono text-xl font-semibold">{parcel.trackingNumber}</h2>
        <StatusBadge status={parcel.status} />
      </div>

      {/* Return actions for failed parcels */}
      {parcel.status === "FAILED" && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="font-semibold text-amber-900">Delivery failed – post office actions</p>
          {parcel.collectionDeadline && (
            <p className="mt-1 text-sm text-amber-800">
              Customer must collect by {formatDate(parcel.collectionDeadline)}, otherwise it is returned to the sender
              automatically.
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => runAction(() => api.post(`/admin/parcels/${parcel.id}/mark-collected`))}
              disabled={busy}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            >
              Customer Collected at Counter
            </button>
            <input
              value={rtsNote}
              onChange={(e) => setRtsNote(e.target.value)}
              maxLength={200}
              placeholder="Note for return (optional)"
              className="min-w-56 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              onClick={() => runAction(() => api.post(`/admin/parcels/${parcel.id}/return-to-sender`, { note: rtsNote }))}
              disabled={busy}
              className="rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
            >
              Return to Sender
            </button>
          </div>
          {actionMsg && (
            <p className={`mt-2 text-sm ${actionMsg.ok ? "text-green-700" : "text-red-700"}`}>{actionMsg.text}</p>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <div className="space-y-6">
          <div className="rounded-xl bg-white p-5 shadow-sm">
            <h3 className="mb-3 font-semibold">Parcel</h3>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              {row("Type", PARCEL_TYPE_LABELS[parcel.parcelType])}
              {row("Weight", parcel.weight ? `${parcel.weight} kg` : "-")}
              {row("Sender", parcel.senderName || "-")}
              {row("Arrived", formatDateTime(parcel.arrivedAt))}
              {row("Scanned by", parcel.registeredBy?.name)}
              {row(
                ["RETURN_REQUESTED", "PICKUP_ASSIGNED", "OUT_FOR_PICKUP"].includes(parcel.status)
                  ? "Pickup Slot"
                  : "Delivery Slot",
                formatSlot(parcel) || "Not booked yet"
              )}

              {parcel.rescheduleCount > 0 && row("Rescheduled", `${parcel.rescheduleCount} of 2`)}

              {parcel.failedAttempts > 0 && (
                <>
                  {row("Failed attempts", `${parcel.failedAttempts} of 3`, "text-red-700")}
                  {row(
                    "Last failure",
                    `${FAILURE_REASON_LABELS[parcel.lastFailureReason] || "-"}${
                      parcel.lastFailureNote ? ` – ${parcel.lastFailureNote}` : ""
                    }`,
                    "text-red-700"
                  )}
                </>
              )}

              {parcel.collectionDeadline && row("Collect by", formatDate(parcel.collectionDeadline), "text-amber-700")}

              {parcel.deliveredAt &&
                row(
                  parcel.collectedAtCounter ? "Collected" : "Delivered",
                  `${formatDateTime(parcel.deliveredAt)}${
                    parcel.receivedBy && !parcel.collectedAtCounter ? ` · ${parcel.receivedBy}` : ""
                  }${parcel.collectedAtCounter ? " · at post office" : ""}`,
                  "text-green-700"
                )}

              {parcel.returnRequestedAt && (
                <>
                  {row("Return requested", formatDate(parcel.returnRequestedAt), "text-orange-700")}
                  {row(
                    "Return reason",
                    `${RETURN_REASON_LABELS[parcel.customerReturnReason] || "-"}${
                      parcel.customerReturnNote ? ` – ${parcel.customerReturnNote}` : ""
                    }`,
                    "text-orange-700"
                  )}
                </>
              )}

              {parcel.pickupFailedAttempts > 0 && row("Failed pickups", `${parcel.pickupFailedAttempts} of 2`, "text-red-700")}
              {parcel.returnCancelledAt && row("Return cancelled", formatDate(parcel.returnCancelledAt))}

              {parcel.returnedAt && (
                <>
                  {row("Returned to sender", formatDateTime(parcel.returnedAt), "font-medium")}
                  {row(
                    "Return to sender reason",
                    `${RTS_REASON_LABELS[parcel.returnReason] || "-"}${parcel.returnNote ? ` – ${parcel.returnNote}` : ""}`
                  )}
                </>
              )}
            </dl>
          </div>

          <div className="rounded-xl bg-white p-5 shadow-sm">
            <h3 className="mb-3 font-semibold">Customer</h3>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              {row("Name", parcel.customer.name)}
              {row("Phone", parcel.customer.phone)}
              {row("Email", parcel.customer.email, "break-all")}
                            {row("Address", formatAddress(parcel.customer))}
            </dl>
          </div>
        </div>

        <div className="rounded-xl bg-white p-5 shadow-sm">
          <h3 className="mb-4 font-semibold">Status Timeline</h3>
          <StatusTimeline history={parcel.statusHistory} />
        </div>
      </div>

      <div className="mt-6">
        <AssignmentPanel parcel={parcel} onChanged={loadParcel} />
      </div>
    </div>
  );
}