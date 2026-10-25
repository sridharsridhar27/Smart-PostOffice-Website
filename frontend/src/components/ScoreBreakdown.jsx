const LABELS = {
  sameStreetSlot: "Same street",
  sameAreaSlot: "Same area",
  homeArea: "Home area",
  capacity: "Free capacity",
};

export default function ScoreBreakdown({ breakdown }) {
  if (!breakdown) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {Object.entries(LABELS).map(([key, label]) =>
        breakdown[key] ? (
          <span key={key} className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-800">
            {label} +{breakdown[key]}
          </span>
        ) : null
      )}
    </div>
  );
}