import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api, { getErrorMessage } from "../../api/axios";
import StatusBadge from "../../components/StatusBadge";
import { STATUS_LABELS, PARCEL_TYPE_LABELS } from "../../utils/parcelStatus";
import { formatDateTime } from "../../utils/format";
import { formatSlot } from "../../utils/slot";

const inputClass =
  "rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600";

export default function AdminParcels() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [parcels, setParcels] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(searchParams.get("status") || "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadParcels = async (filters = { search, status }) => {
    setLoading(true);
    setError("");
    try {
      const params = {};
      if (filters.search.trim()) params.search = filters.search.trim();
      if (filters.status) params.status = filters.status;
      const res = await api.get("/admin/parcels", { params });
      setParcels(res.data.parcels);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // Load on first open and whenever ?status= changes (e.g. clicking a dashboard card)
  useEffect(() => {
    const s = searchParams.get("status") || "";
    setStatus(s);
    loadParcels({ search, status: s });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleSearch = (e) => {
    e.preventDefault();
    loadParcels({ search, status });
  };

  // Dropdown updates the URL, which triggers the effect above
  const handleStatusChange = (e) => {
    const value = e.target.value;
    setSearchParams(value ? { status: value } : {});
  };

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">Parcels</h2>

      <form onSubmit={handleSearch} className="mb-4 flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${inputClass} min-w-64 flex-1`}
                    placeholder="Search tracking no, name, phone or pincode"
        />
        <select value={status} onChange={handleStatusChange} className={inputClass}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-md bg-slate-800 px-4 text-sm font-medium text-white hover:bg-slate-900">
          Search
        </button>
      </form>

      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Tracking No</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Area / Street</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Slot</th>
              <th className="px-4 py-3">Arrived</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">Loading...</td>
              </tr>
            ) : parcels.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">No parcels found</td>
              </tr>
            ) : (
              parcels.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => navigate(`/admin/parcels/${p.id}`)}
                  className="cursor-pointer border-t hover:bg-slate-50"
                >
                  <td className="px-4 py-3 font-mono font-medium">{p.trackingNumber}</td>
                  <td className="px-4 py-3">
                    <p>{p.customer.name}</p>
                    <p className="text-xs text-slate-500">{p.customer.phone}</p>
                  </td>
                  <td className="px-4 py-3">
                                        <p>
                      {p.customer.area?.name}{" "}
                      <span className="font-mono text-xs text-slate-500">· {p.customer.area?.pincode}</span>
                    </p>
                    <p className="text-xs text-slate-500">{p.customer.street?.name}</p>
                  </td>
                  <td className="px-4 py-3">{PARCEL_TYPE_LABELS[p.parcelType]}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatSlot(p) || "-"}
                    {p.slotAutoBooked && (
                      <span className="ml-2 rounded bg-indigo-100 px-1.5 py-0.5 text-xs text-indigo-700">auto</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDateTime(p.arrivedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}