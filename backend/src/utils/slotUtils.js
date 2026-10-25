const SLOT_HOURS = [9, 10, 11, 12, 13, 14, 15, 16]; // 9-10 ... 4-5
const MAX_PARCELS_PER_DAY = 6; // per delivery person
const BOOKING_DAYS_AHEAD = 3; // today + 3 days
const MIN_LEAD_MINUTES = 60; // same-day slot must start 1 hour from now
const TIMEZONE = "Asia/Kolkata";
const MAX_RESCHEDULES = 2; // per parcel
const MAX_DELIVERY_ATTEMPTS = 3; // after this, customer collects from post office

// Current date and minutes-of-day in India time (works whatever the server timezone is)
const getISTNow = () => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );

  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
};

const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const isValidDateStr = (s) => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

// "2026-10-26" <-> Date stored in a @db.Date column
const toSlotDate = (dateStr) => new Date(`${dateStr}T00:00:00.000Z`);
const toDateStr = (date) => (date ? new Date(date).toISOString().slice(0, 10) : null);

const formatHour = (h) => {
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:00 ${suffix}`;
};

const slotLabel = (hour) => `${formatHour(hour)} - ${formatHour(hour + 1)}`;

const formatDateLabel = (dateStr) =>
  new Date(`${dateStr}T00:00:00.000Z`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

const getBookableDates = (now = getISTNow()) =>
  Array.from({ length: BOOKING_DAYS_AHEAD + 1 }, (_, i) => addDays(now.dateStr, i));

// Today's slot that already started or starts within the lead time
const isTooSoon = (dateStr, hour, now = getISTNow()) =>
  dateStr === now.dateStr && hour * 60 < now.minutes + MIN_LEAD_MINUTES;

module.exports = {
  SLOT_HOURS,
  MAX_PARCELS_PER_DAY,
  BOOKING_DAYS_AHEAD,
  MIN_LEAD_MINUTES,
  getISTNow,
  addDays,
  isValidDateStr,
  toSlotDate,
  toDateStr,
  slotLabel,
  formatDateLabel,
  getBookableDates,
  isTooSoon,
    MAX_RESCHEDULES,
  MAX_DELIVERY_ATTEMPTS,
};