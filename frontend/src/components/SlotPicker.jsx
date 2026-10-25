import { useEffect, useState } from "react";
import api, { getErrorMessage } from "../api/axios";

/**
 * mode="book"       -> POST /customer/parcels/:id/book-slot   (new or after failed delivery)
 * mode="reschedule" -> POST /customer/parcels/:id/reschedule  (currentDate/currentHour = existing slot)
 */
export default function SlotPicker({ parcelId, onBooked, mode = "book", currentDate, currentHour, onCancel }) {
  const [days, setDays] = useState([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedHour, setSelectedHour] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isCurrent = (date, hour) => mode === "reschedule" && date === currentDate && hour === currentHour;

  const loadAvailability = async (keepDate = false) => {
    setLoading(true);
    try {
      const res = await api.get("/customer/slots/availability");
      const list = res.data.days;
      setDays(list);
      if (!keepDate) {
        const firstOpen = list.find((d) => d.slots.some((s) => s.available && !isCurrent(d.date, s.hour)));
        setSelectedDate(firstOpen?.date || list[0]?.date || "");
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAvailability();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedDay = days.find((d) => d.date === selectedDate);
  const selectedSlot = selectedDay?.slots.find((s) => s.hour === selectedHour);

  const handleDayClick = (date) => {
    setSelectedDate(date);
    setSelectedHour(null);
    setError("");
  };

  const handleSubmit = async () => {
    if (!selectedDate || selectedHour == null) return;
    setSubmitting(true);
    setError("");
    try {
      const endpoint = mode === "reschedule" ? "reschedule" : "book-slot";
      const res = await api.post(`/customer/parcels/${parcelId}/${endpoint}`, {
        date: selectedDate,
        hour: selectedHour,
      });
      onBooked(res.data);
    } catch (err) {
      setError(getErrorMessage(err));
      setSelectedHour(null);
      loadAvailability(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && days.length === 0) {
    return <p className="text-sm text-slate-500">Loading available slots...</p>;
  }

  return (
    <div>
      {/* Day tabs */}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {days.map((d) => {
          const hasOpen = d.slots.some((s) => s.available);
          const active = d.date === selectedDate;
          return (
            <button
              key={d.date}
              type="button"
              onClick={() => handleDayClick(d.date)}
              className={`shrink-0 rounded-lg border px-3 py-2 text-left text-sm ${
                active ? "border-red-700 bg-red-700 text-white" : "border-slate-300 bg-white hover:border-red-400"
              }`}
            >
              <p className="font-semibold">{d.isToday ? "Today" : d.dateLabel.split(",")[0]}</p>
              <p className={`text-xs ${active ? "text-red-100" : "text-slate-500"}`}>
                {d.dateLabel.split(",")[1]?.trim().replace(/\s\d{4}$/, "")}
              </p>
              {!hasOpen && (
                <p className={`text-xs font-medium ${active ? "text-yellow-200" : "text-red-600"}`}>
                  {d.full ? "Full" : "Closed"}
                </p>
              )}
            </button>
          );
        })}
      </div>

      {/* Slots */}
      {selectedDay && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {selectedDay.slots.map((s) => {
            const current = isCurrent(selectedDay.date, s.hour);
            const disabled = !s.available || current;
            const active = s.hour === selectedHour;
            return (
              <button
                key={s.hour}
                type="button"
                disabled={disabled}
                onClick={() => setSelectedHour(s.hour)}
                className={`rounded-lg border px-2 py-3 text-sm ${
                  current
                    ? "cursor-not-allowed border-blue-300 bg-blue-50 text-blue-700"
                    : disabled
                    ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                    : active
                    ? "border-red-700 bg-red-50 font-semibold text-red-700 ring-2 ring-red-700"
                    : "border-slate-300 bg-white hover:border-red-400"
                }`}
              >
                <p>{s.label}</p>
                {current ? (
                  <p className="mt-0.5 text-xs font-medium">Current slot</p>
                ) : (
                  !s.available && <p className="mt-0.5 text-xs">{s.reason}</p>
                )}
              </button>
            );
          })}
        </div>
      )}

      {error && <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {/* Confirm */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 p-3">
        <p className="text-sm">
          {selectedSlot ? (
            <>
              {mode === "reschedule" ? "New slot" : "Selected"}:{" "}
              <span className="font-semibold">{selectedDay.dateLabel}</span>,{" "}
              <span className="font-semibold">{selectedSlot.label}</span>
            </>
          ) : (
            <span className="text-slate-500">Choose a time slot</span>
          )}
        </p>
        <div className="flex gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selectedSlot || submitting}
            className="rounded-md bg-red-700 px-5 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
          >
            {submitting ? "Saving..." : mode === "reschedule" ? "Confirm Reschedule" : "Confirm Slot"}
          </button>
        </div>
      </div>
    </div>
  );
}