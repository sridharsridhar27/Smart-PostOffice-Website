import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api, { getErrorMessage } from "../../api/axios";
import StatusBadge from "../../components/StatusBadge";
import StatusTimeline from "../../components/StatusTimeline";
import AssignmentPanel from "../../components/AssignmentPanel";
import { PARCEL_TYPE_LABELS, FAILURE_REASON_LABELS } from "../../utils/parcelStatus";
import { formatDateTime } from "../../utils/format";
import { formatSlot } from "../../utils/slot";

export default function AdminParcelDetail() {
  const { id } = useParams();
  const [parcel, setParcel] = useState(null);
  const [error, setError] = useState("");

  const loadParcel = useCallback(() => {
    api
      .get(`/admin/parcels/${id}`)
      .then((res) => setParcel(res.data.parcel))
      .catch((err) => setError(getErrorMessage(err)));
  }, [id]);

  useEffect(() => {
    loadParcel();
  }, [loadParcel]);

  if (error) return <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>;
  if (!parcel) return <p className="text-sm text-slate-500">Loading...</p>;

  return (
    <div>
      <Link to="/admin/parcels" className="text-sm text-red-700 hover:underline">← Back to parcels</Link>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h2 className="font-mono text-xl font-semibold">{parcel.trackingNumber}</h2>
        <StatusBadge status={parcel.status} />
      </div>

      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <div className="space-y-6">
          <div className="rounded-xl bg-white p-5 shadow-sm">
            <h3 className="mb-3 font-semibold">Parcel</h3>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-slate-500">Type</dt>
              <dd>{PARCEL_TYPE_LABELS[parcel.parcelType]}</dd>

              <dt className="text-slate-500">Weight</dt>
              <dd>{parcel.weight ? `${parcel.weight} kg` : "-"}</dd>

              <dt className="text-slate-500">Sender</dt>
              <dd>{parcel.senderName || "-"}</dd>

              <dt className="text-slate-500">Arrived</dt>
              <dd>{formatDateTime(parcel.arrivedAt)}</dd>

              <dt className="text-slate-500">Scanned by</dt>
              <dd>{parcel.registeredBy?.name}</dd>

              <dt className="text-slate-500">Delivery Slot</dt>
              <dd>{formatSlot(parcel) || "Not booked yet"}</dd>

              {parcel.rescheduleCount > 0 && (
                <>
                  <dt className="text-slate-500">Rescheduled</dt>
                  <dd>{parcel.rescheduleCount} of 2</dd>
                </>
              )}

              {parcel.failedAttempts > 0 && (
                <>
                  <dt className="text-slate-500">Failed attempts</dt>
                  <dd className="text-red-700">{parcel.failedAttempts} of 3</dd>

                  <dt className="text-slate-500">Last failure</dt>
                  <dd className="text-red-700">
                    {FAILURE_REASON_LABELS[parcel.lastFailureReason]}
                    {parcel.lastFailureNote ? ` – ${parcel.lastFailureNote}` : ""}
                  </dd>
                </>
              )}

              {parcel.deliveredAt && (
                <>
                  <dt className="text-slate-500">Delivered</dt>
                  <dd className="text-green-700">
                    {formatDateTime(parcel.deliveredAt)}
                    {parcel.receivedBy ? ` · ${parcel.receivedBy}` : ""}
                  </dd>
                </>
              )}
            </dl>
          </div>

          <div className="rounded-xl bg-white p-5 shadow-sm">
            <h3 className="mb-3 font-semibold">Customer</h3>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-slate-500">Name</dt>
              <dd>{parcel.customer.name}</dd>

              <dt className="text-slate-500">Phone</dt>
              <dd>{parcel.customer.phone}</dd>

              <dt className="text-slate-500">Email</dt>
              <dd className="break-all">{parcel.customer.email}</dd>

              <dt className="text-slate-500">Address</dt>
              <dd>
                {parcel.customer.addressLine}, {parcel.customer.street?.name}, {parcel.customer.area?.name}
              </dd>
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