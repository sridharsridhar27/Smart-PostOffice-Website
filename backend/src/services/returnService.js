const prisma = require("../config/prisma");
const { createNotification } = require("./notificationService");
const { getDayCapacity, countBookedOnDate } = require("./slotService");
const {
  RETURN_WINDOW_DAYS,
  MAX_PICKUP_ATTEMPTS,
  toSlotDate,
  slotLabel,
  formatDateLabel,
} = require("../utils/slotUtils");

const RETURN_REASONS = {
  DAMAGED: "Parcel damaged",
  WRONG_ITEM: "Wrong item",
  NOT_NEEDED: "No longer needed",
  OTHER: "Other",
};

const RTS_REASONS = {
  NOT_COLLECTED: "Not collected within 7 days",
  CUSTOMER_REFUSED: "Customer refused the parcel",
  ADMIN_DECISION: "Post office decision",
  CUSTOMER_RETURN: "Returned by customer",
};

const PICKUP_STATUSES = ["RETURN_REQUESTED", "PICKUP_ASSIGNED", "OUT_FOR_PICKUP", "PICKUP_FAILED"];
const CANCELLABLE = ["RETURN_REQUESTED", "PICKUP_ASSIGNED", "PICKUP_FAILED"];

const TX_OPTIONS = { timeout: 20000, maxWait: 10000 };
const DAY_MS = 24 * 60 * 60 * 1000;

const httpError = (statusCode, message) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const notifyAdmins = async (tx, data) => {
  const admins = await tx.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
  if (admins.length) {
    await tx.notification.createMany({ data: admins.map((a) => ({ userId: a.id, ...data })) });
  }
};

const lockParcel = async (tx, parcelId) => {
  await tx.$queryRaw`SELECT id FROM "Parcel" WHERE id = ${parcelId} FOR UPDATE`;
  return tx.parcel.findUnique({
    where: { id: parcelId },
    select: {
      id: true,
      trackingNumber: true,
      status: true,
      customerId: true,
      deliveredAt: true,
      returnRequestedAt: true,
      pickupFailedAttempts: true,
      assignedToId: true,
      failedAttempts: true,
      collectionDeadline: true,
    },
  });
};

const ensureCapacity = async (tx, date, parcelId) => {
  const [capacity, booked] = await Promise.all([getDayCapacity(tx), countBookedOnDate(tx, date, parcelId)]);
  if (booked >= capacity) {
    throw httpError(409, "All slots for this day are fully booked. Please choose another day.");
  }
};

const slotData = (date, hour) => ({
  slotDate: toSlotDate(date),
  slotHour: hour,
  slotBookedAt: new Date(),
  slotAutoBooked: false,
  assignedToId: null,
  assignedAt: null,
  unassignedReason: null,
});

// ---------------- Customer: request a return ----------------
const requestReturn = async ({ parcelId, customer, reason, note, date, hour }) => {
  const label = slotLabel(hour);
  const dateLabel = formatDateLabel(date);

  return prisma.$transaction(async (tx) => {
    const parcel = await lockParcel(tx, parcelId);
    if (!parcel || parcel.customerId !== customer.id) throw httpError(404, "Parcel not found");

    if (parcel.returnRequestedAt) {
      throw httpError(409, "A return has already been requested for this parcel (only one return per parcel)");
    }
    if (parcel.status !== "DELIVERED") throw httpError(409, "Only delivered parcels can be returned");
    if (!parcel.deliveredAt || Date.now() - parcel.deliveredAt.getTime() > RETURN_WINDOW_DAYS * DAY_MS) {
      throw httpError(409, `The ${RETURN_WINDOW_DAYS}-day return window for this parcel has ended`);
    }

    await ensureCapacity(tx, date, parcelId);

    await tx.parcel.update({
      where: { id: parcelId },
      data: {
        ...slotData(date, hour),
        status: "RETURN_REQUESTED",
        returnRequestedAt: new Date(),
        customerReturnReason: reason,
        customerReturnNote: note || null,
      },
    });

    await tx.statusHistory.create({
      data: {
        parcelId,
        status: "RETURN_REQUESTED",
        changedById: customer.id,
        note: `Return requested (${RETURN_REASONS[reason]}${note ? ` – ${note}` : ""}): pickup ${dateLabel}, ${label}`,
      },
    });

    await createNotification(tx, {
      userId: customer.id,
      parcelId,
      type: "RETURN_REQUESTED",
      title: "Return Requested",
      message: `Pickup for your return ${parcel.trackingNumber} is booked for ${dateLabel}, ${label}.`,
    });

    await notifyAdmins(tx, {
      parcelId,
      type: "RETURN_REQUESTED",
      title: "New Return Request",
      message: `${customer.name} wants to return ${parcel.trackingNumber} (${RETURN_REASONS[reason]}). Pickup ${dateLabel}, ${label}.`,
    });

    return { trackingNumber: parcel.trackingNumber, slot: { date, dateLabel, hour, label } };
  }, TX_OPTIONS);
};

// ---------------- Customer: rebook pickup after a failed pickup ----------------
const rebookPickup = async ({ parcelId, customer, date, hour }) => {
  const label = slotLabel(hour);
  const dateLabel = formatDateLabel(date);

  return prisma.$transaction(async (tx) => {
    const parcel = await lockParcel(tx, parcelId);
    if (!parcel || parcel.customerId !== customer.id) throw httpError(404, "Parcel not found");

    if (parcel.status !== "PICKUP_FAILED") {
      throw httpError(409, "A new pickup slot can be booked only after a failed pickup");
    }
    if (parcel.pickupFailedAttempts >= MAX_PICKUP_ATTEMPTS) {
      throw httpError(409, `Maximum ${MAX_PICKUP_ATTEMPTS} pickup attempts reached`);
    }

    await ensureCapacity(tx, date, parcelId);

    await tx.parcel.update({
      where: { id: parcelId },
      data: { ...slotData(date, hour), status: "RETURN_REQUESTED" },
    });

    await tx.statusHistory.create({
      data: {
        parcelId,
        status: "RETURN_REQUESTED",
        changedById: customer.id,
        note: `Pickup rebooked after failed attempt: ${dateLabel}, ${label}`,
      },
    });

    await createNotification(tx, {
      userId: customer.id,
      parcelId,
      type: "PICKUP_UPDATE",
      title: "New Pickup Slot Booked",
      message: `Pickup for ${parcel.trackingNumber} is now booked for ${dateLabel}, ${label}.`,
    });

    return { trackingNumber: parcel.trackingNumber, slot: { date, dateLabel, hour, label } };
  }, TX_OPTIONS);
};

// ---------------- Customer: cancel a return ----------------
const cancelReturn = async ({ parcelId, customer }) => {
  return prisma.$transaction(async (tx) => {
    const parcel = await lockParcel(tx, parcelId);
    if (!parcel || parcel.customerId !== customer.id) throw httpError(404, "Parcel not found");

    if (parcel.status === "OUT_FOR_PICKUP") {
      throw httpError(409, "The pickup partner is already on the way, so the return can no longer be cancelled");
    }
    if (!CANCELLABLE.includes(parcel.status)) throw httpError(409, "This parcel has no active return request");

    const previousDpId = parcel.assignedToId;

    await tx.assignment.updateMany({
      where: { parcelId, status: "ACTIVE" },
      data: { status: "CANCELLED", endedAt: new Date() },
    });

    await tx.parcel.update({
      where: { id: parcelId },
      data: {
        status: "DELIVERED",
        returnCancelledAt: new Date(),
        assignedToId: null,
        assignedAt: null,
        slotDate: null,
        slotHour: null,
        slotBookedAt: null,
        unassignedReason: null,
      },
    });

    await tx.statusHistory.create({
      data: { parcelId, status: "DELIVERED", changedById: customer.id, note: "Return cancelled by customer" },
    });

    await createNotification(tx, {
      userId: customer.id,
      parcelId,
      type: "PICKUP_UPDATE",
      title: "Return Cancelled",
      message: `Your return request for ${parcel.trackingNumber} has been cancelled.`,
    });

    if (previousDpId) {
      await createNotification(tx, {
        userId: previousDpId,
        parcelId,
        type: "PICKUP_UPDATE",
        title: "Pickup Cancelled",
        message: `The customer cancelled the return for ${parcel.trackingNumber}. It has been removed from your list.`,
      });
    }

    return { trackingNumber: parcel.trackingNumber };
  }, TX_OPTIONS);
};

// ---------------- Admin: customer collected at the counter ----------------
const markCollected = async ({ parcelId, admin }) => {
  return prisma.$transaction(async (tx) => {
    const parcel = await lockParcel(tx, parcelId);
    if (!parcel) throw httpError(404, "Parcel not found");
    if (parcel.status !== "FAILED") {
      throw httpError(409, "Only parcels waiting after a failed delivery can be marked as collected");
    }

    await tx.parcel.update({
      where: { id: parcelId },
      data: {
        status: "DELIVERED",
        deliveredAt: new Date(),
        collectedAtCounter: true,
        receivedBy: "Collected at post office",
        collectionDeadline: null,
      },
    });

    await tx.statusHistory.create({
      data: {
        parcelId,
        status: "DELIVERED",
        changedById: admin.id,
        note: "Collected by customer at the post office counter",
      },
    });

    await createNotification(tx, {
      userId: parcel.customerId,
      parcelId,
      type: "DELIVERED",
      title: "Parcel Collected",
      message: `You collected ${parcel.trackingNumber} from the post office. Thank you!`,
    });

    return { trackingNumber: parcel.trackingNumber };
  }, TX_OPTIONS);
};

// ---------------- Return to sender (shared) ----------------
const returnFailedParcel = async (tx, parcel, { reason, note, adminId }) => {
  await tx.parcel.update({
    where: { id: parcel.id },
    data: {
      status: "RETURNED_TO_SENDER",
      returnedAt: new Date(),
      returnReason: reason,
      returnNote: note || null,
      collectionDeadline: null,
    },
  });

  await tx.statusHistory.create({
    data: {
      parcelId: parcel.id,
      status: "RETURNED_TO_SENDER",
      changedById: adminId || null,
      note: `Returned to sender: ${RTS_REASONS[reason]}${note ? ` – ${note}` : ""}`,
    },
  });

  await createNotification(tx, {
    userId: parcel.customerId,
    parcelId: parcel.id,
    type: "RETURNED_TO_SENDER",
    title: "Parcel Returned to Sender",
    message:
      reason === "NOT_COLLECTED"
        ? `${parcel.trackingNumber} was not collected within 7 days, so it has been returned to the sender.`
        : `${parcel.trackingNumber} has been returned to the sender by the post office.${note ? ` Note: ${note}` : ""}`,
  });
};

// Admin decision
const adminReturnToSender = async ({ parcelId, admin, note }) => {
  return prisma.$transaction(async (tx) => {
    const parcel = await lockParcel(tx, parcelId);
    if (!parcel) throw httpError(404, "Parcel not found");
    if (parcel.status !== "FAILED") throw httpError(409, "Only failed parcels can be returned to the sender");

    await returnFailedParcel(tx, parcel, { reason: "ADMIN_DECISION", note, adminId: admin.id });
    return { trackingNumber: parcel.trackingNumber };
  }, TX_OPTIONS);
};

// Background job: not collected within 7 days
const autoReturnOverdue = async () => {
  const overdue = await prisma.parcel.findMany({
    where: { status: "FAILED", collectionDeadline: { lte: new Date() } },
    select: { id: true },
  });

  const returned = [];
  for (const { id } of overdue) {
    try {
      const r = await prisma.$transaction(async (tx) => {
        const parcel = await lockParcel(tx, id);
        if (!parcel || parcel.status !== "FAILED" || !parcel.collectionDeadline || parcel.collectionDeadline > new Date()) {
          return null;
        }
        await returnFailedParcel(tx, parcel, { reason: "NOT_COLLECTED" });
        await notifyAdmins(tx, {
          parcelId: parcel.id,
          type: "RETURNED_TO_SENDER",
          title: "Returned to Sender (Not Collected)",
          message: `${parcel.trackingNumber} was not collected within 7 days and has been returned to the sender.`,
        });
        return parcel.trackingNumber;
      }, TX_OPTIONS);
      if (r) returned.push(r);
    } catch (err) {
      console.error(`Auto-return failed for parcel ${id}:`, err.message);
    }
  }
  return returned;
};

module.exports = {
  RETURN_REASONS,
  RTS_REASONS,
  PICKUP_STATUSES,
  requestReturn,
  rebookPickup,
  cancelReturn,
  markCollected,
  adminReturnToSender,
  autoReturnOverdue,
};