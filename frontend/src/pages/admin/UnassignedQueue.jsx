import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { getErrorMessage } from "../../api/axios";
import { formatSlot } from "../../utils/slot";

export default function UnassignedQueue() {
  const [parcels, setParcels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState("");

  const loadQueue = () => {
    setLoading(true);
    api
      .get("/admin/assignments/unassigned")
      .then((res) => setParcels(res.data.parcels))
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  };

  useEffect(loadQueue, []);

  const runAI = async (p) => {
    setBusyId(p.id);
    setMessage(null);
    setError("");
    try {
      const res = await api.post(`/admin/parcels/${p.id}/auto-assign`);
      const r = res.data.result;
      setMessage({
        ok: r.assigned,
        text: r.assigned ? `✓ ${r.summary}` : `${p.trackingNumber}: ${r.reason}`,
      });
      loadQueue();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold">Unassigned Queue</h2>
      <p className="mb-4 text-sm text-slate-500">
        Parcels with a booked slot but no delivery person. Run the AI again (e.g. after adding a delivery person) or
        assign manually.
      </p>

      {message && (
        <div className={`mb-4 rounded-md px-3 py-2 text-sm ${message.ok ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>
          {message.text}
        </div>
      )}
      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Tracking No</th>
              <th className="px-4 py-3">Slot</th>
              <th className="px-4 py-3">Customer / Address</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Loading...</td></tr>
            ) : parcels.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-green-700">🎉 All booked parcels are assigned</td></tr>
            ) : (
              parcels.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-4 py-3 font-mono font-medium">{p.trackingNumber}</td>
                  <td className="px-4 py-3">{formatSlot(p)}</td>
                  <td className="px-4 py-3">
                    <p>{p.customer.name}</p>
                    <p className="text-xs text-slate-500">
                      {p.customer.street?.name}, {p.customer.area?.name}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-amber-700">{p.unassignedReason || "Not attempted yet"}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => runAI(p)}
                        disabled={busyId === p.id}
                        className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {busyId === p.id ? "Running..." : "🤖 Run AI"}
                      </button>
                      <Link
                        to={`/admin/parcels/${p.id}`}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
                      >
                        Assign manually
                      </Link>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}