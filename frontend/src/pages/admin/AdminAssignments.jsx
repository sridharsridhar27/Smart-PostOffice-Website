import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { getErrorMessage } from "../../api/axios";
import StatusBadge from "../../components/StatusBadge";
import { addDays, getISTToday } from "../../utils/slot";

const barColor = (load) => (load >= 6 ? "bg-red-500" : load >= 4 ? "bg-amber-500" : "bg-green-500");

export default function AdminAssignments() {
  const today = getISTToday();
  const [date, setDate] = useState(today);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!date) return;
    setLoading(true);
    setError("");
    api
      .get("/admin/assignments/workload", { params: { date } })
      .then((res) => setData(res.data))
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [date]);

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
        <h2 className="text-xl font-semibold">Delivery Assignments</h2>
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

      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {loading || !data ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs uppercase text-slate-500">Date</p>
              <p className="text-lg font-semibold">{data.dateLabel}</p>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs uppercase text-slate-500">Parcels Assigned</p>
              <p className="text-lg font-semibold">{data.totalAssigned}</p>
            </div>
            <Link
              to="/admin/unassigned"
              className={`rounded-xl p-4 shadow-sm ${data.unassignedCount ? "bg-amber-50 hover:bg-amber-100" : "bg-white"}`}
            >
              <p className="text-xs uppercase text-slate-500">Unassigned (this day)</p>
              <p className={`text-lg font-semibold ${data.unassignedCount ? "text-amber-700" : ""}`}>
                {data.unassignedCount} {data.unassignedCount > 0 && <span className="text-sm">→ view queue</span>}
              </p>
            </Link>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {data.deliveryPersons.map((dp) => (
              <div key={dp.id} className={`rounded-xl bg-white p-4 shadow-sm ${!dp.isActive ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">
                      {dp.name}
                      {!dp.isActive && (
                        <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs font-normal">inactive</span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">
                      Home: {dp.homeArea?.name || "-"} · {dp.phone}
                    </p>
                  </div>
                  <p className="text-sm font-semibold">
                    {dp.load}/{dp.capacity}
                  </p>
                </div>

                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full ${barColor(dp.load)}`}
                    style={{ width: `${(dp.load / dp.capacity) * 100}%` }}
                  />
                </div>

                {dp.parcels.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-400">No parcels assigned</p>
                ) : (
                  <ul className="mt-3 divide-y text-sm">
                    {dp.parcels.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <div>
                          <p>
                            <span className="text-slate-500">{p.slotLabel}</span> ·{" "}
                            <Link to={`/admin/parcels/${p.id}`} className="font-mono font-medium text-red-700 hover:underline">
                              {p.trackingNumber}
                            </Link>
                          </p>
                          <p className="text-xs text-slate-500">
                            {p.customer.street?.name}, {p.customer.area?.name}
                          </p>
                        </div>
                        <StatusBadge status={p.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}