const formatHour = (h) => {
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:00 ${suffix}`;
};

export const slotLabel = (hour) => `${formatHour(hour)} - ${formatHour(hour + 1)}`;

export const formatDateLabel = (dateStr) =>
  new Date(`${dateStr}T00:00:00.000Z`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

// "Mon, 26 Oct 2026 · 10:00 AM - 11:00 AM" (or null if no slot)
export const formatSlot = (parcel) => {
  if (!parcel?.slotDate || parcel.slotHour == null) return null;
  return `${formatDateLabel(parcel.slotDate.slice(0, 10))} · ${slotLabel(parcel.slotHour)}`;
};

// Today's date in India time as "YYYY-MM-DD"
export const getISTToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};