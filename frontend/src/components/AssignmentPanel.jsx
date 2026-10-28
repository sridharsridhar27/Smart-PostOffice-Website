import { useEffect, useState } from "react";
import api, { getErrorMessage } from "../api/axios";
import ScoreBreakdown from "./ScoreBreakdown";
import { formatDateTime } from "../utils/format";
import { FAILURE_REASON_LABELS } from "../utils/parcelStatus";

const statusStyle = {
  ACTIVE: "bg-green-100 text-green-800",
  CANCELLED: "bg-slate-100 text-slate-600",
  COMPLETED: "bg-blue-100 text-blue-800",
  FAILED: "bg-red-100 text-red-800",
};

export default function AssignmentPanel({ parcel, onChanged }) {
  const [preview, setPreview] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [deliveryPersons, setDeliveryPersons] = useState([]);
  const [selectedDp, setSelectedDp] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const hasSlot = !!parcel.slotDate;
  const canAssign =
    hasSlot && ["SLOT_BOOKED", "ASSIGNED", "RETURN_REQUESTED", "PICKUP_ASSIGNED"].includes(parcel.status);
  const isPickupJob = ["RETURN_REQUESTED", "PICKUP_ASSIGNED", "OUT_FOR_PICKUP"].includes(parcel.status);
  const waitingForPartner = ["SLOT_BOOKED", "RETURN_REQUESTED"].includes(parcel.status);
  const dateStr = parcel.slotDate?.slice(0, 10);
  const activeAssignment = parcel.assignments?.find((a) => a.status === "ACTIVE");

  // Delivery persons with their load on the parcel's date (for the dropdown)
  const loadWorkload = () => {
    if (!canAssign) return;
    api
      .get("/admin/assignments/workload", { params: { date: dateStr } })
      .then((res) => setDeliveryPersons(res.data.deliveryPersons))
      .catch(() => {});
  };

  useEffect(() => {
    loadWorkload();
    setPreview(null);
    setShowPreview(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcel.id, parcel.assignedTo?.id, parcel.status]);

  const togglePreview = async () => {
    if (showPreview) {
      setShowPreview(false);
      return;
    }
    setError("");
    try {
      const res = await api.get(`/admin/parcels/${parcel.id}/ai-preview`);
      setPreview(res.data);
      setShowPreview(true);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const runAutoAssign = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await api.post(`/admin/parcels/${parcel.id}/auto-assign`);
      const r = res.data.result;
      setMessage(r.assigned ? `✓ ${r.summary}` : `No suitable delivery person: ${r.reason}`);
      onChanged();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const doManualAssign = async () => {
    if (!selectedDp) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await api.post(`/admin/parcels/${parcel.id}/assign`, {
        deliveryPersonId: Number(selectedDp),
      });
      setMessage(`✓ ${res.data.message} to ${res.data.deliveryPerson.name}`);
      setSelectedDp("");
      onChanged();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{isPickupJob ? "Pickup Assignment" : "Delivery Assignment"}</h3>
        {hasSlot && (
          <button
            onClick={togglePreview}
            className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
          >
            {showPreview ? "Hide AI scores" : "🤖 Why this person? (AI scores)"}
          </button>
        )}
      </div>

      {/* Current state */}
      {parcel.assignedTo ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="text-sm text-slate-600">{isPickupJob ? "Pickup assigned to" : "Assigned to"}</p>
          <p className="text-lg font-semibold text-green-800">
            {parcel.assignedTo.name} <span className="text-sm font-normal text-slate-600">· {parcel.assignedTo.phone}</span>
          </p>
          {activeAssignment && (
            <div className="mt-2 space-y-1.5 text-sm">
              <p>
                <span className="rounded bg-white px-1.5 py-0.5 text-xs font-medium">
                  {activeAssignment.method === "AI_AUTO" ? "🤖 AI" : "✋ Manual"}
                </span>
                {activeAssignment.jobType === "PICKUP" && (
                  <span className="ml-1 rounded bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-700">
                    Pickup
                  </span>
                )}
                {activeAssignment.score != null && (
                  <span className="ml-2 font-medium">Score {activeAssignment.score}</span>
                )}
              </p>
              <p className="text-slate-700">{activeAssignment.reason}</p>
              <ScoreBreakdown breakdown={activeAssignment.scoreBreakdown} />
            </div>
          )}
        </div>
      ) : waitingForPartner ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="font-semibold text-amber-800">
            {isPickupJob ? "Pickup not assigned yet" : "Not assigned yet"}
          </p>
          {parcel.unassignedReason && <p className="text-sm text-amber-700">{parcel.unassignedReason}</p>}
          <button
            onClick={runAutoAssign}
            disabled={busy}
            className="mt-3 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? "Running..." : "🤖 Run AI Assignment"}
          </button>
        </div>
      ) : (
        <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">
          {hasSlot ? "No active assignment." : "Waiting for the customer to book a slot."}
        </p>
      )}

      {message && <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{message}</p>}
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {/* AI score table */}
      {showPreview && preview && (
        <div className="mt-5">
          <p className="mb-2 text-sm text-slate-600">
            AI evaluated <b>{preview.candidatesEvaluated}</b> delivery person(s) for this slot:
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Delivery Person</th>
                  <th className="px-3 py-2">Load</th>
                  <th className="px-3 py-2 text-center">Street</th>
                  <th className="px-3 py-2 text-center">Area</th>
                  <th className="px-3 py-2 text-center">Home</th>
                  <th className="px-3 py-2 text-center">Capacity</th>
                  <th className="px-3 py-2 text-center">Total</th>
                </tr>
              </thead>
              <tbody>
                {preview.candidates.map((c, i) => (
                  <tr key={c.deliveryPerson.id} className={`border-t ${i === 0 ? "bg-green-50 font-medium" : ""}`}>
                    <td className="px-3 py-2">{i + 1}</td>
                    <td className="px-3 py-2">
                      {c.deliveryPerson.name}
                      <p className="text-xs font-normal text-slate-500">Home: {c.deliveryPerson.homeArea || "-"}</p>
                    </td>
                    <td className="px-3 py-2">{c.load}/6</td>
                    <td className="px-3 py-2 text-center">{c.breakdown.sameStreetSlot || "-"}</td>
                    <td className="px-3 py-2 text-center">{c.breakdown.sameAreaSlot || "-"}</td>
                    <td className="px-3 py-2 text-center">{c.breakdown.homeArea || "-"}</td>
                    <td className="px-3 py-2 text-center">{c.breakdown.capacity}</td>
                    <td className="px-3 py-2 text-center text-base font-bold">{c.score}</td>
                  </tr>
                ))}
                {preview.excluded.map((e) => (
                  <tr key={e.deliveryPerson.id} className="border-t bg-slate-50 text-slate-400">
                    <td className="px-3 py-2">–</td>
                    <td className="px-3 py-2">{e.deliveryPerson.name}</td>
                    <td className="px-3 py-2">{e.load}/6</td>
                    <td colSpan={5} className="px-3 py-2 text-center">Excluded: {e.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Rules: same street in slot +50 · same area in slot +30 · home area +20 · +5 per free spot · max 6 jobs
            (deliveries + pickups) per day. Scores are calculated live, so they reflect the current workload.
          </p>
        </div>
      )}

      {/* Manual assign */}
      {canAssign && (
        <div className="mt-5 border-t pt-4">
          <p className="mb-2 text-sm font-medium">{parcel.assignedTo ? "Reassign manually" : "Assign manually"}</p>
          <div className="flex flex-wrap gap-2">
            <select
              value={selectedDp}
              onChange={(e) => setSelectedDp(e.target.value)}
              className="min-w-64 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Select delivery person</option>
              {deliveryPersons.map((dp) => {
                const isCurrent = dp.id === parcel.assignedTo?.id;
                const disabled = !dp.isActive || isCurrent || dp.freeSpots === 0;
                return (
                  <option key={dp.id} value={dp.id} disabled={disabled}>
                    {dp.name} · {dp.homeArea?.name || "-"} · {dp.load}/6
                    {isCurrent ? " (current)" : !dp.isActive ? " (inactive)" : dp.freeSpots === 0 ? " (full)" : ""}
                  </option>
                );
              })}
            </select>
            <button
              onClick={doManualAssign}
              disabled={!selectedDp || busy}
              className="rounded-md bg-slate-800 px-4 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
            >
              {parcel.assignedTo ? "Reassign" : "Assign"}
            </button>
          </div>
        </div>
      )}

      {/* History */}
      {parcel.assignments?.length > 0 && (
        <div className="mt-5 border-t pt-4">
          <p className="mb-2 text-sm font-medium">Assignment History</p>
          <ul className="space-y-2">
            {parcel.assignments.map((a) => (
              <li key={a.id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{a.deliveryPerson.name}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                    {a.method === "AI_AUTO" ? "🤖 AI" : "✋ Manual"}
                  </span>
                  {a.jobType === "PICKUP" && (
                    <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-700">Pickup</span>
                  )}
                  <span className={`rounded px-1.5 py-0.5 text-xs ${statusStyle[a.status]}`}>{a.status}</span>
                  {a.score != null && <span className="text-xs text-slate-500">Score {a.score}</span>}
                </div>
                <p className="mt-1 text-slate-600">{a.reason}</p>
                {a.failureReason && (
                  <p className="mt-1 text-sm text-red-700">
                    Failed: {FAILURE_REASON_LABELS[a.failureReason]}
                    {a.failureNote ? ` – ${a.failureNote}` : ""}
                  </p>
                )}
                <p className="mt-0.5 text-xs text-slate-400">
                  {formatDateTime(a.createdAt)}
                  {a.assignedBy ? ` · by ${a.assignedBy.name}` : ""}
                  {a.candidatesEvaluated ? ` · ${a.candidatesEvaluated} candidates evaluated` : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}