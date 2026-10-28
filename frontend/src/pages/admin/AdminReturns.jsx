import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { getErrorMessage } from "../../api/axios";
import StatusBadge from "../../components/StatusBadge";
import { FAILURE_REASON_LABELS } from "../../utils/parcelStatus";
import { formatDateTime } from "../../utils/format";
import { formatSlot } from "../../utils/slot";
import { areaWithPin } from "../../utils/address";

const daysLeft = (d) => Math.ceil((new Date(d).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
const formatDate = (d) =>
  new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function Section({ title, hint, count, children }) {
  return (
    <div className="rounded-xl bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="text-xs text-slate-500">{hint}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium">{count}</span>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

const Customer = ({ c }) => (
  <>
    <p>{c.name}</p>
    <p className="text-xs text-slate-500">
            {c.phone} · {c.street?.name}, {areaWithPin(c.area)}
    </p>
  </>
);

export default function AdminReturns() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = () =>
    api
      .get("/admin/returns")
      .then((res) => setData(res.data))
      .catch((err) => setError(getErrorMessage(err)));

  useEffect(() => {
    load();
  }, []);

  const act = async (id, fn) => {
    setBusyId(id);
    setError("");
    setMessage("");
    try {
      const res = await fn();
      setMessage(`✓ ${res.data.message}`);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const markCollected = (p) => {
    if (!window.confirm(`Confirm ${p.trackingNumber} was collected by the customer at the counter?`)) return;
    act(p.id, () => api.post(`/admin/parcels/${p.id}/mark-collected`));
  };

  const returnToSender = (p) => {
    const note = window.prompt(`Return ${p.trackingNumber} to the sender? Add a note (optional):`, "");
    if (note === null) return; // cancelled
    act(p.id, () => api.post(`/admin/parcels/${p.id}/return-to-sender`, { note }));
  };

  if (!data) {
    return error ? (
      <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
    ) : (
      <p className="text-sm text-slate-500">Loading...</p>
    );
  }

  const th = "px-4 py-3";
  const td = "px-4 py-3";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Returns</h2>
        <p className="text-sm text-slate-500">
          Parcels waiting to be collected, customer return pickups, and parcels sent back to the sender.
        </p>
      </div>

      {message && <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{message}</div>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {/* 1. Awaiting collection */}
      <Section
        title="Awaiting Collection at Post Office"
        hint="3 delivery attempts failed. Not collected by the deadline = returned to sender automatically."
        count={data.awaitingCollection.length}
      >
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className={th}>Tracking No</th>
              <th className={th}>Customer</th>
              <th className={th}>Last failure</th>
              <th className={th}>Collect by</th>
              <th className={`${th} text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.awaitingCollection.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">Nothing waiting</td></tr>
            ) : (
              data.awaitingCollection.map((p) => {
                const left = daysLeft(p.collectionDeadline);
                return (
                  <tr key={p.id} className="border-t">
                    <td className={td}>
                      <Link to={`/admin/parcels/${p.id}`} className="font-mono font-medium text-red-700 hover:underline">
                        {p.trackingNumber}
                      </Link>
                    </td>
                    <td className={td}><Customer c={p.customer} /></td>
                    <td className={td}>{FAILURE_REASON_LABELS[p.lastFailureReason] || "-"}</td>
                    <td className={td}>
                      <p>{formatDate(p.collectionDeadline)}</p>
                      <p className={`text-xs font-medium ${left <= 0 ? "text-red-600" : left <= 2 ? "text-amber-600" : "text-slate-500"}`}>
                        {left <= 0 ? "Overdue – returns on next job run" : `${left} day(s) left`}
                      </p>
                    </td>
                    <td className={td}>
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => markCollected(p)}
                          disabled={busyId === p.id}
                          className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          Mark Collected
                        </button>
                        <button
                          onClick={() => returnToSender(p)}
                          disabled={busyId === p.id}
                          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
                        >
                          Return to Sender
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Section>

      {/* 2. Active customer returns */}
      <Section
        title="Active Customer Returns"
        hint="Customers who asked to return a delivered parcel. A partner picks it up, then it goes back to the sender."
        count={data.activeReturns.length}
      >
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className={th}>Tracking No</th>
              <th className={th}>Customer</th>
              <th className={th}>Reason</th>
              <th className={th}>Pickup slot</th>
              <th className={th}>Partner</th>
              <th className={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.activeReturns.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No active returns</td></tr>
            ) : (
              data.activeReturns.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className={td}>
                    <Link to={`/admin/parcels/${p.id}`} className="font-mono font-medium text-red-700 hover:underline">
                      {p.trackingNumber}
                    </Link>
                  </td>
                  <td className={td}><Customer c={p.customer} /></td>
                  <td className={td}>
                    {data.returnReasons[p.customerReturnReason]}
                    {p.customerReturnNote && <p className="text-xs text-slate-500">{p.customerReturnNote}</p>}
                  </td>
                  <td className={td}>
                    {formatSlot(p) || "-"}
                    {p.pickupFailedAttempts > 0 && (
                      <p className="text-xs text-red-600">{p.pickupFailedAttempts} failed pickup(s)</p>
                    )}
                  </td>
                  <td className={td}>
                    {p.assignedTo?.name || <span className="text-xs font-medium text-amber-700">Unassigned</span>}
                  </td>
                  <td className={td}><StatusBadge status={p.status} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Section>

      {/* 3. Returned to sender */}
      <Section title="Returned to Sender" hint="Latest 50 parcels sent back." count={data.returnedToSender.length}>
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className={th}>Tracking No</th>
              <th className={th}>Customer</th>
              <th className={th}>Sender</th>
              <th className={th}>Reason</th>
              <th className={th}>Returned</th>
            </tr>
          </thead>
          <tbody>
            {data.returnedToSender.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">None yet</td></tr>
            ) : (
              data.returnedToSender.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className={td}>
                    <Link to={`/admin/parcels/${p.id}`} className="font-mono font-medium text-red-700 hover:underline">
                      {p.trackingNumber}
                    </Link>
                  </td>
                  <td className={td}><Customer c={p.customer} /></td>
                  <td className={td}>{p.senderName || "-"}</td>
                  <td className={td}>
                    {data.rtsReasons[p.returnReason]}
                    {p.returnNote && <p className="text-xs text-slate-500">{p.returnNote}</p>}
                  </td>
                  <td className={td}>{formatDateTime(p.returnedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Section>
    </div>
  );
}