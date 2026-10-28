import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { getErrorMessage } from "../../api/axios";
import { useAuth } from "../../context/AuthContext";
import StatusBadge from "../../components/StatusBadge";
import { PARCEL_TYPE_LABELS } from "../../utils/parcelStatus";
import { formatDateTime } from "../../utils/format";
import { formatSlot } from "../../utils/slot";
import { formatAddress } from "../../utils/address";

const line = (tone, text) => {
  const tones = {
    amber: "bg-amber-50 text-amber-800",
    red: "bg-red-50 text-red-800",
    purple: "bg-purple-50 text-purple-800",
    green: "bg-green-50 text-green-800",
    blue: "bg-blue-50 text-blue-800",
    orange: "bg-orange-50 text-orange-800",
    slate: "bg-slate-100 text-slate-700",
  };
  return <p className={`mt-3 rounded-md px-3 py-2 text-sm font-medium ${tones[tone]}`}>{text}</p>;
};

// The one line on each card that says what's happening / what to do next
function NextStep({ p }) {
  const a = p.actions || {};
  switch (p.status) {
    case "NOTIFIED":
      return line("amber", "📅 Book your delivery slot →");
    case "FAILED":
      return a.mustCollect ? line("red", "🏤 Please collect from the post office") : line("amber", "⚠️ Delivery failed – book a new slot →");
    case "OUT_FOR_DELIVERY":
      return line("purple", `🚚 On the way${p.assignedTo ? ` with ${p.assignedTo.name}` : ""}`);
    case "DELIVERED":
      return (
        <>
          {line("green", `✅ ${p.collectedAtCounter ? "Collected" : "Delivered"} ${formatDateTime(p.deliveredAt)}`)}
          {a.canRequestReturn && <p className="mt-2 text-xs font-medium text-orange-700">↩ Return available</p>}
        </>
      );
    case "RETURN_REQUESTED":
    case "PICKUP_ASSIGNED":
      return line("orange", `↩ Return pickup: ${formatSlot(p) || "-"}`);
    case "OUT_FOR_PICKUP":
      return line("purple", "🚚 Pickup partner on the way");
    case "PICKUP_FAILED":
      return line("amber", "⚠️ Pickup failed – book a new pickup slot →");
    case "RETURNED_TO_SENDER":
      return line("slate", "↩ Returned to sender");
    default:
      return formatSlot(p) ? (
        <p className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
          📅 {formatSlot(p)}
          {p.slotAutoBooked && (
            <span className="ml-2 rounded bg-indigo-100 px-1.5 py-0.5 text-xs text-indigo-700">auto-booked</span>
          )}
        </p>
      ) : null;
  }
}

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
                   {formatAddress(user)} · {user?.phone}
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

                <NextStep p={p} />

                {p.assignedTo && ["ASSIGNED", "PICKUP_ASSIGNED"].includes(p.status) && (
                  <p className="mt-2 text-xs text-slate-600">
                    {p.status === "PICKUP_ASSIGNED" ? "Pickup" : "Delivery"} partner: {p.assignedTo.name}
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}