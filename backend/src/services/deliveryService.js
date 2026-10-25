const prisma = require("../config/prisma");
const { createNotification } = require("./notificationService");
const {
  MAX_DELIVERY_ATTEMPTS,
  getISTNow,
  toDateStr,
  slotLabel,
  formatDateLabel,
} = require("../utils/slotUtils");

const FAILURE_REASONS = {
  CUSTOMER_NOT_AVAILABLE: "Customer not available",
  WRONG_ADDRESS: "Wrong / incomplete address",
  CUSTOMER_REFUSED: "Customer refused the parcel",
  PREMISES_LOCKED: "Premises locked",
  OTHER: "Other",
};

const TX_OPTIONS = { timeout: 20000, maxWait: 10000 };

const httpError = (statusCode, message) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const deliveryParcelSelect = {
  id: true,
  trackingNumber: true,
  status: true,
  outForDeliveryAt: true,
  deliveredAt: true,
  receivedBy: true,
  failedAttempts: true,
  lastFailureReason: true,
  lastFailureNote: true,
};

// Lock the parcel row and make sure it belongs to this delivery person
const lockOwnParcel = async (tx, parcelId, dpId) => {
  await tx.$queryRaw`SELECT id FROM "Parcel" WHERE id = ${parcelId} FOR UPDATE`;

  const parcel = await tx.parcel.findUnique({
    where: { id: parcelId },
    select: {
      id: true,
      trackingNumber: true,
      status: true,
      slotDate: true,
      slotHour: true,
      assignedToId: true,
      customerId: true,
      failedAttempts: true,
    },
  });

  if (!parcel || parcel.assignedToId !== dpId) {
    throw httpError(404, "Parcel not found in your deliveries");
  }
  return parcel;
};

// ASSIGNED -> OUT_FOR_DELIVERY (only on the slot date)
const markOutForDelivery = async ({ parcelId, dp }) => {
  return prisma.$transaction(async (tx) => {
    const parcel = await lockOwnParcel(tx, parcelId, dp.id);

    if (parcel.status !== "ASSIGNED") {
      throw httpError(409, `Parcel is ${parcel.status.replace(/_/g, " ").toLowerCase()}, cannot start delivery`);
    }

    const slotDateStr = toDateStr(parcel.slotDate);
    if (slotDateStr !== getISTNow().dateStr) {
      throw httpError(400, `Delivery can start only on the slot date (${formatDateLabel(slotDateStr)})`);
    }

    const updated = await tx.parcel.update({
      where: { id: parcel.id },
      data: { status: "OUT_FOR_DELIVERY", outForDeliveryAt: new Date() },
      select: deliveryParcelSelect,
    });

    await tx.statusHistory.create({
      data: {
        parcelId: parcel.id,
        status: "OUT_FOR_DELIVERY",
        changedById: dp.id,
        note: `Out for delivery with ${dp.name}`,
      },
    });

    await createNotification(tx, {
      userId: parcel.customerId,
      parcelId: parcel.id,
      type: "OUT_FOR_DELIVERY",
      title: "Out for Delivery",
      message: `${dp.name} is on the way with your parcel ${parcel.trackingNumber} (${slotLabel(
        parcel.slotHour
      )}). Contact: ${dp.phone}.`,
    });

    return updated;
  }, TX_OPTIONS);
};

// OUT_FOR_DELIVERY -> DELIVERED
const markDelivered = async ({ parcelId, dp, receivedBy }) => {
  return prisma.$transaction(async (tx) => {
    const parcel = await lockOwnParcel(tx, parcelId, dp.id);

    if (parcel.status !== "OUT_FOR_DELIVERY") {
      throw httpError(409, "Only parcels that are out for delivery can be marked as delivered");
    }

    const updated = await tx.parcel.update({
      where: { id: parcel.id },
      data: { status: "DELIVERED", deliveredAt: new Date(), receivedBy: receivedBy || null },
      select: deliveryParcelSelect,
    });

    await tx.assignment.updateMany({
      where: { parcelId: parcel.id, status: "ACTIVE" },
      data: { status: "COMPLETED", endedAt: new Date() },
    });

    await tx.statusHistory.create({
      data: {
        parcelId: parcel.id,
        status: "DELIVERED",
        changedById: dp.id,
        note: `Delivered by ${dp.name}${receivedBy ? ` · Received by ${receivedBy}` : ""}`,
      },
    });

    await createNotification(tx, {
      userId: parcel.customerId,
      parcelId: parcel.id,
      type: "DELIVERED",
      title: "Parcel Delivered",
      message: `Your parcel ${parcel.trackingNumber} has been delivered${
        receivedBy ? ` (received by ${receivedBy})` : ""
      }. Thank you!`,
    });

    return updated;
  }, TX_OPTIONS);
};

// OUT_FOR_DELIVERY -> FAILED (releases delivery person, clears slot)
const markFailed = async ({ parcelId, dp, reason, note }) => {
  return prisma.$transaction(async (tx) => {
    const parcel = await lockOwnParcel(tx, parcelId, dp.id);

    if (parcel.status !== "OUT_FOR_DELIVERY") {
      throw httpError(409, "Only parcels that are out for delivery can be marked as failed");
    }

    const attempt = parcel.failedAttempts + 1;
    const finalAttempt = attempt >= MAX_DELIVERY_ATTEMPTS;
    const reasonText = `${FAILURE_REASONS[reason]}${note ? ` – ${note}` : ""}`;

    await tx.assignment.updateMany({
      where: { parcelId: parcel.id, status: "ACTIVE" },
      data: { status: "FAILED", endedAt: new Date(), failureReason: reason, failureNote: note || null },
    });

    const updated = await tx.parcel.update({
      where: { id: parcel.id },
      data: {
        status: "FAILED",
        failedAttempts: { increment: 1 },
        lastFailedAt: new Date(),
        lastFailureReason: reason,
        lastFailureNote: note || null,
        assignedToId: null,
        assignedAt: null,
        outForDeliveryAt: null,
        slotDate: null,
        slotHour: null,
        slotBookedAt: null,
        slotAutoBooked: false,
      },
      select: deliveryParcelSelect,
    });

    await tx.statusHistory.create({
      data: {
        parcelId: parcel.id,
        status: "FAILED",
        changedById: dp.id,
        note: `Attempt ${attempt} of ${MAX_DELIVERY_ATTEMPTS} failed: ${reasonText}`,
      },
    });

    await createNotification(tx, {
      userId: parcel.customerId,
      parcelId: parcel.id,
      type: "FAILED",
      title: finalAttempt ? "Delivery Failed – Collect from Post Office" : "Delivery Failed",
      message: finalAttempt
        ? `We could not deliver ${parcel.trackingNumber} after ${MAX_DELIVERY_ATTEMPTS} attempts (${FAILURE_REASONS[reason]}). Please collect it from the post office with ID proof.`
        : `Delivery attempt ${attempt} of ${MAX_DELIVERY_ATTEMPTS} for ${parcel.trackingNumber} failed (${FAILURE_REASONS[reason]}). Please book a new delivery slot.`,
    });

    if (finalAttempt) {
      const admins = await tx.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
      if (admins.length) {
        await tx.notification.createMany({
          data: admins.map((a) => ({
            userId: a.id,
            parcelId: parcel.id,
            type: "FAILED",
            title: "Max Delivery Attempts Reached",
            message: `${parcel.trackingNumber} failed ${MAX_DELIVERY_ATTEMPTS} times. Customer must collect it from the post office.`,
          })),
        });
      }
    }

    return { parcel: updated, attempt, finalAttempt };
  }, TX_OPTIONS);
};

module.exports = { FAILURE_REASONS, markOutForDelivery, markDelivered, markFailed };