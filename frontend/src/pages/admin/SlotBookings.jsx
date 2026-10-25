import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { getErrorMessage } from "../../api/axios";
import StatusBadge from "../../components/StatusBadge";
import { addDays, getISTToday } from "../../utils/slot";

export default function SlotBookings() {
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
      .get("/admin/slot-bookings", { params: { date } })
      .then((res) => setData(res.data))
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [date]);

  const quickBtn = (label, value) => (
    <button
      onClick={() => setDate(value)}
      className={`rounded-md px-3 py-2 text-sm font-medium ${
        date === value ? "bg-red-700 text-white" : "bg-white text-slate-700 hover:bg-slate-50"
      } border border-slate-300`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Slot Bookings</h2>
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
              <p className="text-xs uppercase text-slate-500">Booked / Capacity</p>
              <p className="text-lg font-semibold">
                {data.totalBooked} / {data.capacity}
              </p>
            </div>
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs uppercase text-slate-500">Remaining</p>
              <p className={`text-lg font-semibold ${data.totalBooked >= data.capacity ? "text-red-600" : "text-green-700"}`}>
                {Math.max(0, data.capacity - data.totalBooked)}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {data.slots.map((slot) => (
              <div key={slot.hour} className="rounded-xl bg-white shadow-sm">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <p className="font-semibold">{slot.label}</p>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      slot.count ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {slot.count} parcel{slot.count === 1 ? "" : "s"}
                  </span>
                </div>

                {slot.count === 0 ? (
                  <p className="px-4 py-3 text-sm text-slate-400">No bookings</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <tbody>
                        {slot.parcels.map((p) => (
                          <tr key={p.id} className="border-t first:border-t-0">
                            <td className="px-4 py-2.5">
                              <Link to={`/admin/parcels/${p.id}`} className="font-mono font-medium text-red-700 hover:underline">
                                {p.trackingNumber}
                              </Link>
                              {p.slotAutoBooked && (
                                <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">auto</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              <p>{p.customer.name}</p>
                              <p className="text-xs text-slate-500">{p.customer.phone}</p>
                            </td>
                            <td className="px-4 py-2.5">
                              <p>{p.customer.street?.name}</p>
                              <p className="text-xs text-slate-500">{p.customer.area?.name}</p>
                            </td>
                                                        <td className="px-4 py-2.5">
                              {p.assignedTo ? (
                                <span className="text-sm">🚚 {p.assignedTo.name}</span>
                              ) : (
                                <span className="text-xs font-medium text-amber-700">Unassigned</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <StatusBadge status={p.status} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}