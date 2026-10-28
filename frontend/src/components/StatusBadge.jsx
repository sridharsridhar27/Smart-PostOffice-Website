import { CARD_ONLY_LABELS, STATUS_COLORS, STATUS_LABELS } from "../utils/parcelStatus";

export default function StatusBadge({ status }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
        STATUS_COLORS[status] || "bg-slate-100 text-slate-700"
      }`}
    >
      {STATUS_LABELS[status] || CARD_ONLY_LABELS[status] || status}
    </span>
  );
}