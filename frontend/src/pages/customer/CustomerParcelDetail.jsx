import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api, { getErrorMessage } from "../../api/axios";
import StatusBadge from "../../components/StatusBadge";
import StatusTimeline from "../../components/StatusTimeline";
import SlotPicker from "../../components/SlotPicker";
import { PARCEL_TYPE_LABELS } from "../../utils/parcelStatus";
import { formatDateTime } from "../../utils/format";
import { formatSlot } from "../../utils/slot";

export default function CustomerParcelDetail() {
  const { id } = useParams();
  const [parcel, setParcel] = useState(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [showReschedule, setShowReschedule] = useState(false);

  const loadParcel = useCallback(() => {
    api
      .get(`/customer/parcels/${id}`)
      .then((res) => setParcel(res.data.parcel))
      .catch((err) => setError(getErrorMessage(err)));
  }, [id]);

  useEffect(() => {
    loadParcel();
  }, [loadParcel]);

  const handleSlotSaved = (data) => {
    setResult(data);
    setShowReschedule(false);
    loadParcel();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (error) return <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>;
  if (!parcel) return <p className="text-sm text-slate-500">Loading...</p>;

  const a = parcel.actions;
  const slotText = formatSlot(parcel);

  return (
    <div>
      <Link to="/customer" className="text-sm text-red-700 hover:underline">← Back to my parcels</Link>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h2 className="font-mono text-xl font-semibold">{parcel.trackingNumber}</h2>
        <StatusBadge status={parcel.status} />
      </div>

      {/* Book / reschedule result */}
      {result && (
        <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
          {result.steps.map((s) => (
            <p key={s} className="flex items-center gap-2 text-sm font-medium text-green-800">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-200 text-xs">✓</span>
              {s}
            </p>
          ))}
          <p className="mt-2 pl-7 text-sm text-green-700">
            {result.previousSlot ? `${result.previousSlot} → ` : ""}
            {result.slot.dateLabel}, {result.slot.label}
          </p>
          {result.assignment?.assigned ? (
            <div className="mt-3 rounded-lg bg-white p-3 font-mono text-sm">
              {result.assignment.summary}
              <p className="mt-1 font-sans text-xs font-semibold text-green-700">Status: Parcel Assigned Successfully</p>
            </div>
          ) : (
            <p className="mt-2 pl-7 text-sm text-amber-700">{result.assignment?.message}</p>
          )}
        </div>
      )}

      {/* Status banners */}
      {parcel.status === "OUT_FOR_DELIVERY" && (
        <div className="mt-4 rounded-xl border border-purple-200 bg-purple-50 p-4">
          <p className="font-semibold text-purple-800">🚚 Your parcel is on the way!</p>
          {parcel.assignedTo && (
            <p className="mt-1 text-sm text-purple-700">
              {parcel.assignedTo.name} ·{" "}
              <a href={`tel:${parcel.assignedTo.phone}`} className="underline">{parcel.assignedTo.phone}</a>
            </p>
          )}
        </div>
      )}

      {parcel.status === "DELIVERED" && (
        <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
          <p className="font-semibold text-green-800">✅ Delivered on {formatDateTime(parcel.deliveredAt)}</p>
          {parcel.receivedBy && <p className="mt-1 text-sm text-green-700">Received by: {parcel.receivedBy}</p>}
        </div>
      )}

      {parcel.status === "FAILED" &&
        (a.mustCollect ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="font-semibold text-red-800">🏤 Please collect your parcel from the post office</p>
            <p className="mt-1 text-sm text-red-700">
              We tried {parcel.failedAttempts} times but could not deliver it (last reason:{" "}
              {parcel.lastFailureReasonLabel}). Bring a valid ID proof.
            </p>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="font-semibold text-amber-800">⚠️ Delivery attempt failed</p>
            <p className="mt-1 text-sm text-amber-700">
              Reason: {parcel.lastFailureReasonLabel}
              {parcel.lastFailureNote ? ` – ${parcel.lastFailureNote}` : ""}
            </p>
            <p className="mt-1 text-sm text-amber-700">
              {a.attemptsLeft} attempt{a.attemptsLeft === 1 ? "" : "s"} left. Please book a new delivery slot below.
            </p>
          </div>
        ))}

      {/* Book slot (new parcel or after failure) */}
      {a.canBookSlot ? (
        <div className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h3 className="font-semibold">
            {parcel.status === "FAILED" ? "Book a New Delivery Slot" : "Book a Delivery Slot"}
          </h3>
          <p className="mb-4 text-sm text-slate-500">Working hours 9 AM – 5 PM.</p>
          <SlotPicker parcelId={parcel.id} onBooked={handleSlotSaved} />
        </div>
      ) : (
        slotText && (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl bg-white p-5 shadow-sm">
              <h3 className="font-semibold">Delivery Slot</h3>
              <p className="mt-1 text-lg font-medium text-red-700">{slotText}</p>
              {parcel.slotAutoBooked && (
                               <p className="mt-1 rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-700">
                  ⏰ Auto-booked because no slot was chosen within 24 hours. You can reschedule if this time doesn't suit you.
                </p>
              )}

              {a.canReschedule && !showReschedule && (
                <button
                  onClick={() => {
                    setShowReschedule(true);
                    setResult(null);
                  }}
                  className="mt-3 rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
                >
                  🔄 Reschedule ({a.reschedulesLeft} left)
                </button>
              )}
              {!a.canReschedule && ["SLOT_BOOKED", "ASSIGNED"].includes(parcel.status) && (
                <p className="mt-3 text-xs text-slate-500">Reschedule limit reached.</p>
              )}
            </div>

            <div className="rounded-xl bg-white p-5 shadow-sm">
              <h3 className="font-semibold">Delivery Partner</h3>
              {parcel.assignedTo ? (
                <>
                  <p className="mt-1 text-lg font-medium">🚚 {parcel.assignedTo.name}</p>
                  <a href={`tel:${parcel.assignedTo.phone}`} className="text-sm text-red-700 hover:underline">
                    📞 {parcel.assignedTo.phone}
                  </a>
                </>
              ) : (
                <p className="mt-1 text-sm text-amber-700">A delivery partner will be assigned soon.</p>
              )}
            </div>
          </div>
        )
      )}

      {/* Reschedule picker */}
      {showReschedule && (
        <div className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h3 className="font-semibold">Choose a New Slot</h3>
          <p className="mb-4 text-sm text-slate-500">
            Your current delivery partner assignment will be cancelled and a new one assigned for the new slot.
          </p>
          <SlotPicker
            parcelId={parcel.id}
            mode="reschedule"
            currentDate={parcel.slotDate?.slice(0, 10)}
            currentHour={parcel.slotHour}
            onBooked={handleSlotSaved}
            onCancel={() => setShowReschedule(false)}
          />
        </div>
      )}

      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <h3 className="mb-3 font-semibold">Parcel Details</h3>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-500">Type</dt>
            <dd>{PARCEL_TYPE_LABELS[parcel.parcelType]}</dd>
            <dt className="text-slate-500">Weight</dt>
            <dd>{parcel.weight ? `${parcel.weight} kg` : "-"}</dd>
            <dt className="text-slate-500">Sender</dt>
            <dd>{parcel.senderName || "-"}</dd>
            <dt className="text-slate-500">Arrived</dt>
            <dd>{formatDateTime(parcel.arrivedAt)}</dd>
            {parcel.failedAttempts > 0 && (
              <>
                <dt className="text-slate-500">Failed attempts</dt>
                <dd>{parcel.failedAttempts} of 3</dd>
              </>
            )}
            {parcel.rescheduleCount > 0 && (
              <>
                <dt className="text-slate-500">Rescheduled</dt>
                <dd>{parcel.rescheduleCount} of 2</dd>
              </>
            )}
          </dl>
        </div>

        <div className="rounded-xl bg-white p-5 shadow-sm">
          <h3 className="mb-4 font-semibold">Tracking</h3>
          <StatusTimeline history={parcel.statusHistory} />
        </div>
      </div>
    </div>
  );
}