const prisma = require("../config/prisma");
const {
  SLOT_HOURS,
  MAX_PARCELS_PER_DAY,
  getISTNow,
  toSlotDate,
  toDateStr,
  slotLabel,
  formatDateLabel,
  isTooSoon,
} = require("../utils/slotUtils");

// Parcels that use up a place in the day's capacity (FAILED frees its place)
// Parcels that use up a place in the day's capacity (deliveries + pickups; FAILED frees its place)
const ACTIVE_SLOT_STATUSES = [
  "SLOT_BOOKED",
  "ASSIGNED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "RETURN_REQUESTED",
  "PICKUP_ASSIGNED",
  "OUT_FOR_PICKUP",
  "RETURNED_TO_SENDER",
];

const getDayCapacity = async (client = prisma) => {
  const activeDeliveryPersons = await client.user.count({
    where: { role: "DELIVERY", isActive: true },
  });
  return activeDeliveryPersons * MAX_PARCELS_PER_DAY;
};

const countBookedOnDate = (client, dateStr, excludeParcelId = null) =>
  client.parcel.count({
    where: {
      slotDate: toSlotDate(dateStr),
      status: { in: ACTIVE_SLOT_STATUSES },
      ...(excludeParcelId ? { id: { not: excludeParcelId } } : {}),
    },
  });

// Availability for a list of dates ("YYYY-MM-DD")
const getAvailability = async (dateStrs, now = getISTNow()) => {
  const [capacity, grouped] = await Promise.all([
    getDayCapacity(),
    prisma.parcel.groupBy({
      by: ["slotDate", "slotHour"],
      where: {
        slotDate: { in: dateStrs.map(toSlotDate) },
        status: { in: ACTIVE_SLOT_STATUSES },
      },
      _count: { _all: true },
    }),
  ]);

  const countMap = {};
  grouped.forEach((g) => {
    countMap[`${toDateStr(g.slotDate)}|${g.slotHour}`] = g._count._all;
  });

  return dateStrs.map((dateStr) => {
    const slotCounts = SLOT_HOURS.map((hour) => countMap[`${dateStr}|${hour}`] || 0);
    const booked = slotCounts.reduce((sum, c) => sum + c, 0);
    const full = booked >= capacity;

    const slots = SLOT_HOURS.map((hour, i) => {
      const tooSoon = isTooSoon(dateStr, hour, now);
      return {
        hour,
        label: slotLabel(hour),
        bookedCount: slotCounts[i],
        available: !tooSoon && !full,
        reason: tooSoon ? "Time passed" : full ? "Fully booked" : null,
      };
    });

    return {
      date: dateStr,
      dateLabel: formatDateLabel(dateStr),
      isToday: dateStr === now.dateStr,
      capacity,
      booked,
      remaining: Math.max(0, capacity - booked),
      full,
      slots,
    };
  });
};

module.exports = { ACTIVE_SLOT_STATUSES, getDayCapacity, countBookedOnDate, getAvailability };