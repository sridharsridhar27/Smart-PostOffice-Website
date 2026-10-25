const prisma = require("../config/prisma");
const { createNotification } = require("./notificationService");
const { assignParcel } = require("./assignmentService");
const { ACTIVE_SLOT_STATUSES, getDayCapacity, countBookedOnDate } = require("./slotService");
const {
  SLOT_HOURS,
  MAX_DELIVERY_ATTEMPTS,
  toSlotDate,
  slotLabel,
  formatDateLabel,
  getBookableDates,
} = require("../utils/slotUtils");

const TX_OPTIONS = { timeout: 20000, maxWait: 10000 };

const getAfterHours = () => {
  const h = Number(process.env.AUTO_BOOK_AFTER_HOURS);
  return Number.isFinite(h) && h > 0 ? h : 24;
};

const cutoffFor = (afterHours) => new Date(Date.now() - afterHours * 60 * 60 * 1000);

// Where-clause for parcels whose 24h booking window has passed
const dueWhere = (cutoff) => ({
  OR: [
    { status: "NOTIFIED", arrivedAt: { lte: cutoff } },
    { status: "FAILED", failedAttempts: { lt: MAX_DELIVERY_ATTEMPTS }, lastFailedAt: { lte: cutoff } },
  ],
});

const findDueParcelIds = async (afterHours = getAfterHours()) => {
  const parcels = await prisma.parcel.findMany({
    where: dueWhere(cutoffFor(afterHours)),
    select: { id: true },
    orderBy: { arrivedAt: "asc" },
  });
  return parcels.map((p) => p.id);
};

const countDue = (afterHours = getAfterHours()) =>
  prisma.parcel.count({ where: dueWhere(cutoffFor(afterHours)) });

/**
 * Smart slot choice: first day (from tomorrow) with capacity; inside that day
 * prefer the slot with parcels on the same street, then same area, else earliest.
 */
const chooseSlot = async (tx, parcel) => {
  const capacity = await getDayCapacity(tx);
  const dates = getBookableDates().slice(1); // tomorrow onwards

  for (const date of dates) {
    const booked = await countBookedOnDate(tx, date, parcel.id);
    if (booked >= capacity) continue;

    const dayParcels = await tx.parcel.findMany({
      where: { slotDate: toSlotDate(date), status: { in: ACTIVE_SLOT_STATUSES }, id: { not: parcel.id } },
      select: { slotHour: true, customer: { select: { streetId: true, areaId: true } } },
    });

    let best = null;
    for (const hour of SLOT_HOURS) {
      const inSlot = dayParcels.filter((p) => p.slotHour === hour);
      const street = inSlot.filter((p) => p.customer.streetId === parcel.customer.streetId).length;
      const area = inSlot.filter(
        (p) => p.customer.areaId === parcel.customer.areaId && p.customer.streetId !== parcel.customer.streetId
      ).length;
      const score = street * 10 + area;
      if (!best || score > best.score) best = { hour, street, area, score };
    }

    const reason =
      best.street > 0
        ? `${best.street} parcel(s) on the same street already in this slot`
        : best.area > 0
        ? "Parcels in the same area already in this slot"
        : "Earliest available slot";

    return { date, hour: best.hour, reason };
  }
  return null;
};

/**
 * Auto-book one parcel (if still due). Returns { booked, skipped, reason, ... }.
 */
const autoBookParcel = async (parcelId, { afterHours = getAfterHours() } = {}) => {
  const cutoff = cutoffFor(afterHours);

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Parcel" WHERE id = ${parcelId} FOR UPDATE`;

    const parcel = await tx.parcel.findUnique({
      where: { id: parcelId },
      select: {
        id: true,
        trackingNumber: true,
        status: true,
        arrivedAt: true,
        failedAttempts: true,
        lastFailedAt: true,
        customerId: true,
        customer: { select: { streetId: true, areaId: true } },
      },
    });
    if (!parcel) return { booked: false, skipped: true, reason: "Parcel not found" };

    const due =
      (parcel.status === "NOTIFIED" && parcel.arrivedAt <= cutoff) ||
      (parcel.status === "FAILED" &&
        parcel.failedAttempts < MAX_DELIVERY_ATTEMPTS &&
        parcel.lastFailedAt &&
        parcel.lastFailedAt <= cutoff);

    if (!due) return { booked: false, skipped: true, reason: "Parcel is not due for auto-booking" };

    const slot = await chooseSlot(tx, parcel);
    if (!slot) {
      return { booked: false, skipped: false, reason: "No delivery capacity in the next 3 days" };
    }

    const label = slotLabel(slot.hour);
    const dateLabel = formatDateLabel(slot.date);
    const isRebook = parcel.status === "FAILED";

    await tx.parcel.update({
      where: { id: parcel.id },
      data: {
        slotDate: toSlotDate(slot.date),
        slotHour: slot.hour,
        slotBookedAt: new Date(),
        slotAutoBooked: true,
        status: "SLOT_BOOKED",
      },
    });

    await tx.statusHistory.create({
      data: {
        parcelId: parcel.id,
        status: "SLOT_BOOKED",
        note: `Auto-booked after ${afterHours} hours without ${isRebook ? "rebooking" : "booking"}: ${label} on ${dateLabel} (${slot.reason})`,
      },
    });

    await createNotification(tx, {
      userId: parcel.customerId,
      parcelId: parcel.id,
      type: "AUTO_ASSIGNED",
      title: "Delivery Slot Auto-Booked",
      message: `You didn't ${isRebook ? "rebook" : "book"} a slot for ${parcel.trackingNumber}, so we booked ${dateLabel}, ${label}. You can reschedule if it doesn't suit you.`,
    });

    return {
      booked: true,
      skipped: false,
      trackingNumber: parcel.trackingNumber,
      date: slot.date,
      hour: slot.hour,
      slotText: `${dateLabel}, ${label}`,
      slotReason: slot.reason,
    };
  }, TX_OPTIONS);

  if (!result.booked) return result;

  // AI assignment right after auto-booking
  try {
    const ai = await assignParcel(parcelId);
    result.assigned = ai.assigned;
    result.deliveryPerson = ai.assigned ? ai.chosen.deliveryPerson.name : null;
  } catch (err) {
    console.error("AI assignment after auto-book failed:", err);
    result.assigned = false;
  }
  return result;
};

// ---------------- Job runner ----------------

let running = false;
let lastRun = null;

const runAutoBookJob = async ({ trigger = "cron" } = {}) => {
  if (running) return { skipped: true, reason: "Auto-booking job is already running" };
  running = true;

  const afterHours = getAfterHours();
  const run = {
    trigger,
    afterHours,
    startedAt: new Date(),
    finishedAt: null,
    checked: 0,
    booked: 0,
    assigned: 0,
    noCapacity: 0,
    errors: 0,
    parcels: [],
  };

  try {
    const ids = await findDueParcelIds(afterHours);
    run.checked = ids.length;

    for (const id of ids) {
      try {
        const r = await autoBookParcel(id, { afterHours });
        if (r.booked) {
          run.booked++;
          if (r.assigned) run.assigned++;
          run.parcels.push({
            trackingNumber: r.trackingNumber,
            slot: r.slotText,
            deliveryPerson: r.deliveryPerson,
          });
        } else if (!r.skipped) {
          run.noCapacity++;
        }
      } catch (err) {
        run.errors++;
        console.error(`Auto-book failed for parcel ${id}:`, err.message);
      }
    }
  } finally {
    run.finishedAt = new Date();
    lastRun = run;
    running = false;
  }

  if (run.booked || run.errors) {
    console.log(
      `[auto-book] ${trigger}: checked ${run.checked}, booked ${run.booked}, assigned ${run.assigned}, errors ${run.errors}`
    );
  }
  return run;
};

const getJobStatus = async () => {
  const afterHours = getAfterHours();
  const [dueNow, dueWithin6h] = await Promise.all([countDue(afterHours), countDue(Math.max(afterHours - 6, 0.0001))]);
  return {
    afterHours,
    schedule: process.env.AUTO_BOOK_CRON || "*/15 * * * *",
    running,
    lastRun,
    dueNow,
    dueWithin6h: Math.max(0, dueWithin6h - dueNow),
  };
};

module.exports = {
  getAfterHours,
  findDueParcelIds,
  countDue,
  chooseSlot,
  autoBookParcel,
  runAutoBookJob,
  getJobStatus,
};