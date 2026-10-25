import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { getErrorMessage } from "../../api/axios";
import { useAuth } from "../../context/AuthContext";
import StatusBadge from "../../components/StatusBadge";
import { PARCEL_TYPE_LABELS } from "../../utils/parcelStatus";
import { formatDateTime } from "../../utils/format";
import { formatSlot } from "../../utils/slot";

export default function CustomerDashboard() {
  const { user } = useAuth();
  const [parcels, setParcels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get("/customer/parcels")
      .then((res) => setParcels(res.data.parcels))
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold">Welcome, {user?.name}</h2>
        <p className="mt-1 text-sm text-slate-600">
          {user?.addressLine}, {user?.street?.name}, {user?.area?.name} · {user?.phone}
        </p>
      </div>

      <div>
        <h3 className="mb-3 text-lg font-semibold">My Parcels</h3>

        {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        {loading ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : parcels.length === 0 ? (
          <div className="rounded-xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
            No parcels yet. You'll get a notification when a parcel arrives at the post office.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {parcels.map((p) => (
              <Link
                key={p.id}
                to={`/customer/parcels/${p.id}`}
                className="block rounded-xl bg-white p-4 shadow-sm transition hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-mono font-semibold">{p.trackingNumber}</p>
                  <StatusBadge status={p.status} />
                </div>

                <p className="mt-2 text-sm text-slate-600">
                  {PARCEL_TYPE_LABELS[p.parcelType]}
                  {p.senderName ? ` · from ${p.senderName}` : ""}
                </p>

                <p className="mt-1 text-xs text-slate-400">Arrived {formatDateTime(p.arrivedAt)}</p>

                {p.actions?.canBookSlot ? (
                  <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
                    {p.status === "FAILED" ? "⚠️ Delivery failed – book a new slot →" : "📅 Book your delivery slot →"}
                  </p>
                ) : p.actions?.mustCollect ? (
                  <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
                    🏤 Please collect from the post office
                  </p>
                ) : p.status === "OUT_FOR_DELIVERY" ? (
                  <p className="mt-3 rounded-md bg-purple-50 px-3 py-2 text-sm font-medium text-purple-800">
                    🚚 On the way{p.assignedTo ? ` with ${p.assignedTo.name}` : ""}
                  </p>
                ) : p.status === "DELIVERED" ? (
                  <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
                    ✅ Delivered {formatDateTime(p.deliveredAt)}
                  </p>
                ) : (
                  formatSlot(p) && (
                    <p className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
                      📅 {formatSlot(p)}
                      {p.slotAutoBooked && (
                        <span className="ml-2 rounded bg-indigo-100 px-1.5 py-0.5 text-xs text-indigo-700">
                          auto-booked
                        </span>
                      )}
                    </p>
                  )
                )}

                {p.assignedTo && p.status === "ASSIGNED" && (
                  <p className="mt-2 text-xs text-slate-600">Delivery partner: {p.assignedTo.name}</p>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}