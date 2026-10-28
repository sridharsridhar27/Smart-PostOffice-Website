import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api, { getErrorMessage } from "../../api/axios";
import StatusBadge from "../../components/StatusBadge";
import StatusTimeline from "../../components/StatusTimeline";
import SlotPicker from "../../components/SlotPicker";
import { PARCEL_TYPE_LABELS, RETURN_REASON_LABELS } from "../../utils/parcelStatus";
import { formatDateTime } from "../../utils/format";
import { formatSlot } from "../../utils/slot";

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600";

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "-";

const daysLeft = (d) => Math.max(0, Math.ceil((new Date(d).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));

export default function CustomerParcelDetail() {
  const { id } = useParams();
  const [parcel, setParcel] = useState(null);
  const [returnReasons, setReturnReasons] = useState(RETURN_REASON_LABELS);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [notice, setNotice] = useState("");
  const [showReschedule, setShowReschedule] = useState(false);

  // Return request form
  const [showReturn, setShowReturn] = useState(false);
  const [returnReason, setReturnReason] = useState("DAMAGED");
  const [returnNote, setReturnNote] = useState("");
  const [cancelling, setCancelling] = useState(false);

  const loadParcel = useCallback(() => {
    api
      .get(`/customer/parcels/${id}`)
      .then((res) => {
        setParcel(res.data.parcel);
        if (res.data.returnReasons) setReturnReasons(res.data.returnReasons);
      })
      .catch((err) => setError(getErrorMessage(err)));
  }, [id]);

  useEffect(() => {
    loadParcel();
  }, [loadParcel]);

  const handleSlotSaved = (data) => {
    setResult(data);
    setNotice("");
    setShowReschedule(false);
    setShowReturn(false);
    loadParcel();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelReturn = async () => {
    if (!window.confirm("Cancel this return request? You will not be able to request a return again.")) return;
    setCancelling(true);
    setError("");
    try {
      const res = await api.post(`/customer/parcels/${id}/cancel-return`);
      setResult(null);
      setNotice(res.data.message);
      loadParcel();
    } catch (err) {
      setNotice("");
      alert(getErrorMessage(err));
    } finally {
      setCancelling(false);
    }
  };

  if (error) return <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>;
  if (!parcel) return <p className="text-sm text-slate-500">Loading...</p>;

  const a = parcel.actions;
  const slotText = formatSlot(parcel);
  const s = parcel.status;
  const inDeliverySlot = ["SLOT_BOOKED", "ASSIGNED", "OUT_FOR_DELIVERY"].includes(s);
  const inPickup = ["RETURN_REQUESTED", "PICKUP_ASSIGNED", "OUT_FOR_PICKUP"].includes(s);

  const cancelButton = a.canCancelReturn && (
    <button
      onClick={cancelReturn}
      disabled={cancelling}
      className="mt-3 rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
    >
      {cancelling ? "Cancelling..." : "Cancel Return"}
    </button>
  );

  return (
    <div>
      <Link to="/customer" className="text-sm text-red-700 hover:underline">← Back to my parcels</Link>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h2 className="font-mono text-xl font-semibold">{parcel.trackingNumber}</h2>
        <StatusBadge status={s} />
      </div>

      {/* Result of book / reschedule / return / pickup rebook */}
      {result && (
        <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
          {result.steps.map((step) => (
            <p key={step} className="flex items-center gap-2 text-sm font-medium text-green-800">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-200 text-xs">✓</span>
              {step}
            </p>
          ))}
          <p className="mt-2 pl-7 text-sm text-green-700">
            {result.previousSlot ? `${result.previousSlot} → ` : ""}
            {result.slot.dateLabel}, {result.slot.label}
          </p>
          {result.assignment?.assigned ? (
            <div className="mt-3 rounded-lg bg-white p-3 font-mono text-sm">
              {result.assignment.summary}
              <p className="mt-1 font-sans text-xs font-semibold text-green-700">Status: Assigned Successfully</p>
            </div>
          ) : (
            <p className="mt-2 pl-7 text-sm text-amber-700">{result.assignment?.message}</p>
          )}
        </div>
      )}

      {notice && <div className="mt-4 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">{notice}</div>}

      {/* ---------- Status banners ---------- */}
      {s === "OUT_FOR_DELIVERY" && (
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

      {s === "DELIVERED" && (
        <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
          <p className="font-semibold text-green-800">
            ✅ {parcel.collectedAtCounter ? "Collected at the post office" : "Delivered"} on{" "}
            {formatDateTime(parcel.deliveredAt)}
          </p>
          {parcel.receivedBy && !parcel.collectedAtCounter && (
            <p className="mt-1 text-sm text-green-700">Received by: {parcel.receivedBy}</p>
          )}
          {parcel.returnCancelledAt && (
            <p className="mt-1 text-sm text-slate-600">
              Return request cancelled on {formatDate(parcel.returnCancelledAt)}.
            </p>
          )}

          {a.canRequestReturn && !showReturn && (
            <div className="mt-3">
              <button
                onClick={() => {
                  setShowReturn(true);
                  setResult(null);
                  setNotice("");
                }}
                className="rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
              >
                ↩ Request Return
              </button>
              <span className="ml-3 text-xs text-slate-600">
                {daysLeft(parcel.returnWindowEndsAt)} day(s) left to request a return
              </span>
            </div>
          )}
        </div>
      )}

      {s === "FAILED" &&
        (a.mustCollect ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="font-semibold text-red-800">🏤 Please collect your parcel from the post office</p>
            <p className="mt-1 text-sm text-red-700">
              We tried {parcel.failedAttempts} times but could not deliver it (last reason:{" "}
              {parcel.lastFailureReasonLabel}). Bring a valid ID proof.
            </p>
            {parcel.collectionDeadline && (
              <p className="mt-2 text-sm font-semibold text-red-800">
                Collect by {formatDate(parcel.collectionDeadline)} ({daysLeft(parcel.collectionDeadline)} day(s) left),
                otherwise it will be returned to the sender.
              </p>
            )}
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

      {s === "RETURNED_TO_SENDER" && (
        <div className="mt-4 rounded-xl border border-slate-300 bg-slate-50 p-4">
          <p className="font-semibold text-slate-800">↩ Returned to sender</p>
          <p className="mt-1 text-sm text-slate-700">Reason: {parcel.returnReasonLabel}</p>
          {parcel.returnNote && <p className="text-sm text-slate-600">Note: {parcel.returnNote}</p>}
          <p className="mt-1 text-xs text-slate-500">{formatDateTime(parcel.returnedAt)}</p>
        </div>
      )}

      {s === "OUT_FOR_PICKUP" && (
        <div className="mt-4 rounded-xl border border-purple-200 bg-purple-50 p-4">
          <p className="font-semibold text-purple-800">🚚 Pickup partner is on the way – please keep the parcel ready</p>
          {parcel.assignedTo && (
            <p className="mt-1 text-sm text-purple-700">
              {parcel.assignedTo.name} ·{" "}
              <a href={`tel:${parcel.assignedTo.phone}`} className="underline">{parcel.assignedTo.phone}</a>
            </p>
          )}
        </div>
      )}

      {s === "PICKUP_FAILED" && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="font-semibold text-amber-800">⚠️ Pickup attempt failed</p>
          <p className="mt-1 text-sm text-amber-700">
            {a.pickupAttemptsLeft} pickup attempt{a.pickupAttemptsLeft === 1 ? "" : "s"} left. Book a new pickup slot
            below, or cancel the return.
          </p>
          {cancelButton}
        </div>
      )}

      {/* ---------- Request return form ---------- */}
      {showReturn && (
        <div className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h3 className="font-semibold">Request a Return</h3>
          <p className="mb-4 text-sm text-slate-500">
            Tell us why, then choose when our partner should pick it up. You can request a return only once.
          </p>

          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Reason</label>
              <select value={returnReason} onChange={(e) => setReturnReason(e.target.value)} className={inputClass}>
                {Object.entries(returnReasons).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                Note {returnReason === "OTHER" ? "(required)" : "(optional)"}
              </label>
              <input
                value={returnNote}
                onChange={(e) => setReturnNote(e.target.value)}
                maxLength={200}
                placeholder="e.g. Box was crushed"
                className={inputClass}
              />
            </div>
          </div>

          <SlotPicker
            parcelId={parcel.id}
            mode="return"
            extraBody={{ reason: returnReason, note: returnNote }}
            blocked={returnReason === "OTHER" && !returnNote.trim()}
            onBooked={handleSlotSaved}
            onCancel={() => setShowReturn(false)}
          />
        </div>
      )}

      {/* ---------- Book slot (new parcel or after failed delivery) ---------- */}
      {a.canBookSlot && (
        <div className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h3 className="font-semibold">{s === "FAILED" ? "Book a New Delivery Slot" : "Book a Delivery Slot"}</h3>
          <p className="mb-4 text-sm text-slate-500">Working hours 9 AM – 5 PM.</p>
          <SlotPicker parcelId={parcel.id} onBooked={handleSlotSaved} />
        </div>
      )}

      {/* ---------- Rebook pickup ---------- */}
      {a.canRebookPickup && (
        <div className="mt-4 rounded-xl bg-white p-5 shadow-sm">
          <h3 className="font-semibold">Book a New Pickup Slot</h3>
          <p className="mb-4 text-sm text-slate-500">Choose when our partner should come to collect the parcel.</p>
          <SlotPicker parcelId={parcel.id} mode="pickup" onBooked={handleSlotSaved} />
        </div>
      )}

      {/* ---------- Delivery slot + partner ---------- */}
      {inDeliverySlot && slotText && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl bg-white p-5 shadow-sm">
            <h3 className="font-semibold">Delivery Slot</h3>
            <p className="mt-1 text-lg font-medium text-red-700">{slotText}</p>
            {parcel.slotAutoBooked && (
              <p className="mt-1 rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-700">
                ⏰ Auto-booked because no slot was chosen within 24 hours. You can reschedule if this time doesn't suit
                you.
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
            {!a.canReschedule && ["SLOT_BOOKED", "ASSIGNED"].includes(s) && (
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
      )}

      {/* ---------- Return / pickup card ---------- */}
      {inPickup && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-orange-200 bg-white p-5 shadow-sm">
            <h3 className="font-semibold">↩ Return Pickup</h3>
            <p className="mt-1 text-lg font-medium text-orange-700">{slotText}</p>
            <p className="mt-1 text-sm text-slate-600">
              Reason: {parcel.customerReturnReasonLabel}
              {parcel.customerReturnNote ? ` – ${parcel.customerReturnNote}` : ""}
            </p>
            {cancelButton}
            {s === "OUT_FOR_PICKUP" && (
              <p className="mt-3 text-xs text-slate-500">The partner is on the way, so the return can't be cancelled now.</p>
            )}
          </div>

          <div className="rounded-xl bg-white p-5 shadow-sm">
            <h3 className="font-semibold">Pickup Partner</h3>
            {parcel.assignedTo ? (
              <>
                <p className="mt-1 text-lg font-medium">🚚 {parcel.assignedTo.name}</p>
                <a href={`tel:${parcel.assignedTo.phone}`} className="text-sm text-red-700 hover:underline">
                  📞 {parcel.assignedTo.phone}
                </a>
              </>
            ) : (
              <p className="mt-1 text-sm text-amber-700">A pickup partner will be assigned soon.</p>
            )}
          </div>
        </div>
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

      {/* ---------- Details + timeline ---------- */}
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
            {parcel.returnRequestedAt && (
              <>
                <dt className="text-slate-500">Return requested</dt>
                <dd>{formatDate(parcel.returnRequestedAt)}</dd>
              </>
            )}
            {parcel.pickupFailedAttempts > 0 && (
              <>
                <dt className="text-slate-500">Failed pickups</dt>
                <dd>{parcel.pickupFailedAttempts} of 2</dd>
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