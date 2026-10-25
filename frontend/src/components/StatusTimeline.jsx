import { STATUS_LABELS } from "../utils/parcelStatus";
import { formatDateTime } from "../utils/format";

export default function StatusTimeline({ history = [] }) {
  if (history.length === 0) {
    return <p className="text-sm text-slate-500">No status updates yet.</p>;
  }

  return (
    <ol className="relative ml-2 border-l-2 border-slate-200">
      {history.map((h, index) => {
        const isLatest = index === history.length - 1;
        return (
          <li key={h.id} className="mb-5 ml-5 last:mb-0">
            <span
              className={`absolute -left-[9px] mt-1 h-4 w-4 rounded-full border-2 border-white ${
                isLatest ? "bg-red-600" : "bg-slate-400"
              }`}
            />
            <p className={`text-sm font-semibold ${isLatest ? "text-red-700" : ""}`}>
              {STATUS_LABELS[h.status] || h.status}
            </p>
            {h.note && <p className="text-sm text-slate-600">{h.note}</p>}
            <p className="text-xs text-slate-400">
              {formatDateTime(h.createdAt)}
              {h.changedBy ? ` · by ${h.changedBy.name}` : " · System"}
            </p>
          </li>
        );
      })}
    </ol>
  );
}