const prisma = require("../config/prisma");
const parseId = require("../utils/parseId");
const { createNotification } = require("../services/notificationService");
const { assignParcel, toPublicResult } = require("../services/assignmentService");
const {
  ACTIVE_SLOT_STATUSES,
  getDayCapacity,
  countBookedOnDate,
  getAvailability,
} = require("../services/slotService");
const {
  SLOT_HOURS,
  BOOKING_DAYS_AHEAD,
  MIN_LEAD_MINUTES,
  MAX_RESCHEDULES,
  MAX_DELIVERY_ATTEMPTS,
  getISTNow,
  isValidDateStr,
  toSlotDate,
  toDateStr,
  slotLabel,
  formatDateLabel,
  getBookableDates,
  isTooSoon,
} = require("../utils/slotUtils");

const TX_OPTIONS = { timeout: 15000, maxWait: 10000 };

const slotParcelSelect = {
  id: true,
  trackingNumber: true,
  status: true,
  slotDate: true,
  slotHour: true,
  slotBookedAt: true,
  slotAutoBooked: true,
  rescheduleCount: true,
  assignedAt: true,
  assignedTo: { select: { id: true, name: true } },
};

const httpError = (statusCode, message) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

// Shared date/hour validation for book + reschedule. Returns { error } or { hour }
const validateSlotRequest = (date, hourRaw) => {
  const hour = Number(hourRaw);

  if (!isValidDateStr(date)) return { error: "Invalid date. Use YYYY-MM-DD format" };
  if (!Number.isInteger(hour) || !SLOT_HOURS.includes(hour)) {
    return { error: "Slot must be between 9 AM and 5 PM" };
  }

  const now = getISTNow();
  const bookable = getBookableDates(now);

  if (!bookable.includes(date)) {
    return {
      error: `You can book slots only from ${formatDateLabel(bookable[0])} to ${formatDateLabel(
        bookable[bookable.length - 1]
      )}`,
    };
  }
  if (isTooSoon(date, hour, now)) {
    return { error: "This slot has already started or starts within 1 hour. Please choose a later slot." };
  }
  return { hour };
};

const notifyAdmins = async (tx, { parcelId, type, title, message }) => {
  const admins = await tx.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
  if (admins.length) {
    await tx.notification.createMany({
      data: admins.map((a) => ({ userId: a.id, parcelId, type, title, message })),
    });
  }
};

// Runs AI after booking/rescheduling; booking stays saved even if AI fails
const runAssignment = async (parcelId) => {
  try {
    return toPublicResult(await assignParcel(parcelId));
  } catch (aiErr) {
    console.error("AI assignment failed:", aiErr);
    return { assigned: false, steps: [], message: "A delivery partner will be assigned soon." };
  }
};

// GET /api/customer/slots/availability
const getSlotAvailability = async (req, res, next) => {
  try {
    const days = await getAvailability(getBookableDates());
    res.json({
      days,
      rules: {
        workingHours: "9:00 AM - 5:00 PM",
        minLeadMinutes: MIN_LEAD_MINUTES,
        daysAhead: BOOKING_DAYS_AHEAD,
      },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/customer/parcels/:id/book-slot   body: { date, hour }
// Works for new parcels (NOTIFIED) and re-delivery after a failed attempt (FAILED)
const bookSlot = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid parcel id" });

    const { date } = req.body;
    const { error, hour } = validateSlotRequest(date, req.body.hour);
    if (error) return res.status(400).json({ message: error });

    const parcel = await prisma.parcel.findFirst({
      where: { id, customerId: req.user.id },
      select: { id: true, trackingNumber: true, status: true, failedAttempts: true },
    });
    if (!parcel) return res.status(404).json({ message: "Parcel not found" });

    if (parcel.status === "FAILED" && parcel.failedAttempts >= MAX_DELIVERY_ATTEMPTS) {
      return res.status(409).json({
        message: `Maximum ${MAX_DELIVERY_ATTEMPTS} delivery attempts reached. Please collect your parcel from the post office.`,
      });
    }

    if (!["NOTIFIED", "FAILED"].includes(parcel.status)) {
      const messages = {
        REGISTERED: "This parcel is not ready for slot booking yet",
        SLOT_BOOKED: "A delivery slot is already booked for this parcel. Use reschedule to change it.",
        ASSIGNED: "A delivery slot is already booked for this parcel. Use reschedule to change it.",
      };
      return res.status(409).json({ message: messages[parcel.status] || "This parcel can no longer be booked" });
    }

    const isRebook = parcel.status === "FAILED";
    const label = slotLabel(hour);
    const dateLabel = formatDateLabel(date);

    await prisma.$transaction(async (tx) => {
      const [capacity, booked] = await Promise.all([getDayCapacity(tx), countBookedOnDate(tx, date)]);
      if (booked >= capacity) {
        throw httpError(409, "All delivery slots for this day are fully booked. Please choose another day.");
      }

      // Only if status is still what we checked (prevents double booking)
      const result = await tx.parcel.updateMany({
        where: { id, status: parcel.status },
        data: {
          slotDate: toSlotDate(date),
          slotHour: hour,
          slotBookedAt: new Date(),
          slotAutoBooked: false,
          status: "SLOT_BOOKED",
        },
      });
      if (result.count === 0) throw httpError(409, "A delivery slot is already booked for this parcel");

      await tx.statusHistory.create({
        data: {
          parcelId: id,
          status: "SLOT_BOOKED",
          changedById: req.user.id,
          note: isRebook
            ? `Slot rebooked after failed delivery: ${label} on ${dateLabel}`
            : `Slot booked: ${label} on ${dateLabel}`,
        },
      });

      await createNotification(tx, {
        userId: req.user.id,
        parcelId: id,
        type: "SLOT_BOOKED",
        title: isRebook ? "New Delivery Slot Booked" : "Delivery Slot Booked",
        message: `Your parcel ${parcel.trackingNumber} will be delivered on ${dateLabel}, ${label}.`,
      });

      await notifyAdmins(tx, {
        parcelId: id,
        type: "SLOT_BOOKED",
        title: isRebook ? "Re-delivery Slot Booked" : "New Slot Booking",
        message: `${req.user.name} booked ${label} on ${dateLabel} for parcel ${parcel.trackingNumber}.`,
      });
    }, TX_OPTIONS);

    const assignment = await runAssignment(id);
    const finalParcel = await prisma.parcel.findUnique({ where: { id }, select: slotParcelSelect });

    res.status(201).json({
      message: "Delivery slot booked successfully",
      steps: ["Delivery Slot Booked Successfully", ...assignment.steps],
      parcel: finalParcel,
      slot: { date, dateLabel, hour, label },
      assignment,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/customer/parcels/:id/reschedule   body: { date, hour }
const rescheduleSlot = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid parcel id" });

    const { date } = req.body;
    const { error, hour } = validateSlotRequest(date, req.body.hour);
    if (error) return res.status(400).json({ message: error });

    const label = slotLabel(hour);
    const dateLabel = formatDateLabel(date);

    const { trackingNumber, oldSlotText } = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Parcel" WHERE id = ${id} FOR UPDATE`;

      const parcel = await tx.parcel.findUnique({
        where: { id },
        select: {
          id: true,
          trackingNumber: true,
          status: true,
          customerId: true,
          slotDate: true,
          slotHour: true,
          rescheduleCount: true,
          assignedToId: true,
        },
      });

      if (!parcel || parcel.customerId !== req.user.id) throw httpError(404, "Parcel not found");

      if (!["SLOT_BOOKED", "ASSIGNED"].includes(parcel.status)) {
        const messages = {
          NOTIFIED: "No slot booked yet. Please book a slot first.",
          FAILED: "Please book a new slot for this parcel.",
          OUT_FOR_DELIVERY: "Parcel is already out for delivery and can no longer be rescheduled",
          DELIVERED: "Parcel has already been delivered",
        };
        throw httpError(409, messages[parcel.status] || "This parcel cannot be rescheduled");
      }

      if (parcel.rescheduleCount >= MAX_RESCHEDULES) {
        throw httpError(409, `A parcel can be rescheduled only ${MAX_RESCHEDULES} times`);
      }

      if (toDateStr(parcel.slotDate) === date && parcel.slotHour === hour) {
        throw httpError(400, "Please choose a different slot from the current one");
      }

      const [capacity, booked] = await Promise.all([getDayCapacity(tx), countBookedOnDate(tx, date, id)]);
      if (booked >= capacity) {
        throw httpError(409, "All delivery slots for this day are fully booked. Please choose another day.");
      }

      const oldText = `${formatDateLabel(toDateStr(parcel.slotDate))}, ${slotLabel(parcel.slotHour)}`;
      const previousDpId = parcel.assignedToId;

      await tx.assignment.updateMany({
        where: { parcelId: id, status: "ACTIVE" },
        data: { status: "CANCELLED", endedAt: new Date() },
      });

      await tx.parcel.update({
        where: { id },
        data: {
          slotDate: toSlotDate(date),
          slotHour: hour,
          slotBookedAt: new Date(),
          slotAutoBooked: false,
          status: "SLOT_BOOKED",
          assignedToId: null,
          assignedAt: null,
          unassignedReason: null,
          rescheduleCount: { increment: 1 },
        },
      });

      await tx.statusHistory.create({
        data: {
          parcelId: id,
          status: "SLOT_BOOKED",
          changedById: req.user.id,
          note: `Rescheduled from ${oldText} to ${dateLabel}, ${label}`,
        },
      });

      await createNotification(tx, {
        userId: req.user.id,
        parcelId: id,
        type: "RESCHEDULED",
        title: "Delivery Slot Rescheduled",
        message: `Your parcel ${parcel.trackingNumber} is now scheduled for ${dateLabel}, ${label}.`,
      });

      if (previousDpId) {
        await createNotification(tx, {
          userId: previousDpId,
          parcelId: id,
          type: "RESCHEDULED",
          title: "Parcel Rescheduled",
          message: `${parcel.trackingNumber} was rescheduled by the customer and removed from your deliveries.`,
        });
      }

      await notifyAdmins(tx, {
        parcelId: id,
        type: "RESCHEDULED",
        title: "Slot Rescheduled",
        message: `${req.user.name} moved ${parcel.trackingNumber} from ${oldText} to ${dateLabel}, ${label}.`,
      });

      return { trackingNumber: parcel.trackingNumber, oldSlotText: oldText };
    }, TX_OPTIONS);

    const assignment = await runAssignment(id);
    const finalParcel = await prisma.parcel.findUnique({ where: { id }, select: slotParcelSelect });

    res.json({
      message: "Delivery slot rescheduled successfully",
      steps: ["Delivery Slot Rescheduled Successfully", ...assignment.steps],
      parcel: finalParcel,
      trackingNumber,
      previousSlot: oldSlotText,
      slot: { date, dateLabel, hour, label },
      assignment,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/slot-bookings?date=2026-10-26   (defaults to today)
const getSlotBookings = async (req, res, next) => {
  try {
    const date = req.query.date || getISTNow().dateStr;

    if (!isValidDateStr(date)) {
      return res.status(400).json({ message: "Invalid date. Use YYYY-MM-DD format" });
    }

    const [capacity, parcels] = await Promise.all([
      getDayCapacity(),
      prisma.parcel.findMany({
        where: { slotDate: toSlotDate(date), status: { in: ACTIVE_SLOT_STATUSES } },
        orderBy: [{ slotHour: "asc" }, { slotBookedAt: "asc" }],
        select: {
          ...slotParcelSelect,
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
              addressLine: true,
              area: { select: { id: true, name: true } },
              street: { select: { id: true, name: true } },
            },
          },
        },
      }),
    ]);

    const slots = SLOT_HOURS.map((h) => {
      const inSlot = parcels.filter((p) => p.slotHour === h);
      return { hour: h, label: slotLabel(h), count: inSlot.length, parcels: inSlot };
    });

    res.json({
      date,
      dateLabel: formatDateLabel(date),
      capacity,
      totalBooked: parcels.length,
      slots,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getSlotAvailability, bookSlot, rescheduleSlot, getSlotBookings };