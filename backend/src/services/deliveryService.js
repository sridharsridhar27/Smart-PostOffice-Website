const prisma = require("../config/prisma");
const { createNotification } = require("./notificationService");
const {
  MAX_DELIVERY_ATTEMPTS,
  MAX_PICKUP_ATTEMPTS,
  COLLECTION_WINDOW_DAYS,
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
const DAY_MS = 24 * 60 * 60 * 1000;

const httpError = (statusCode, message) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const istDate = (d) =>
  d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

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
  collectionDeadline: true,
  returnedAt: true,
  returnReason: true,
  pickupFailedAttempts: true,
  returnCancelledAt: true,
};

const notifyAdmins = async (tx, data) => {
  const admins = await tx.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
  if (admins.length) {
    await tx.notification.createMany({ data: admins.map((a) => ({ userId: a.id, ...data })) });
  }
};

// Lock the parcel and make sure it belongs to this delivery person
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
      pickupFailedAttempts: true,
    },
  });

  if (!parcel || parcel.assignedToId !== dpId) throw httpError(404, "Parcel not found in your deliveries");
  return parcel;
};

const releaseSlot = {
  assignedToId: null,
  assignedAt: null,
  outForDeliveryAt: null,
  slotDate: null,
  slotHour: null,
  slotBookedAt: null,
  slotAutoBooked: false,
};

/**
 * START: ASSIGNED -> OUT_FOR_DELIVERY, or PICKUP_ASSIGNED -> OUT_FOR_PICKUP (slot day only)
 */
const startJob = async ({ parcelId, dp }) => {
  return prisma.$transaction(async (tx) => {
    const parcel = await lockOwnParcel(tx, parcelId, dp.id);

    const isPickup = parcel.status === "PICKUP_ASSIGNED";
    if (parcel.status !== "ASSIGNED" && !isPickup) {
      throw httpError(409, `Parcel is ${parcel.status.replace(/_/g, " ").toLowerCase()}, cannot start`);
    }

    const slotDateStr = toDateStr(parcel.slotDate);
    if (slotDateStr !== getISTNow().dateStr) {
      throw httpError(400, `This job can start only on the slot date (${formatDateLabel(slotDateStr)})`);
    }

    const next = isPickup ? "OUT_FOR_PICKUP" : "OUT_FOR_DELIVERY";

    const updated = await tx.parcel.update({
      where: { id: parcel.id },
      data: { status: next, outForDeliveryAt: new Date() },
      select: deliveryParcelSelect,
    });

    await tx.statusHistory.create({
      data: {
        parcelId: parcel.id,
        status: next,
        changedById: dp.id,
        note: isPickup ? `Out for pickup with ${dp.name}` : `Out for delivery with ${dp.name}`,
      },
    });

    await createNotification(tx, {
      userId: parcel.customerId,
      parcelId: parcel.id,
      type: isPickup ? "PICKUP_UPDATE" : "OUT_FOR_DELIVERY",
      title: isPickup ? "Out for Pickup" : "Out for Delivery",
      message: isPickup
        ? `${dp.name} is on the way to collect your return ${parcel.trackingNumber} (${slotLabel(
            parcel.slotHour
          )}). Please keep the parcel ready. Contact: ${dp.phone}.`
        : `${dp.name} is on the way with your parcel ${parcel.trackingNumber} (${slotLabel(
            parcel.slotHour
          )}). Contact: ${dp.phone}.`,
    });

    return { parcel: updated, jobType: isPickup ? "PICKUP" : "DELIVERY" };
  }, TX_OPTIONS);
};

/**
 * COMPLETE: OUT_FOR_DELIVERY -> DELIVERED, or OUT_FOR_PICKUP -> RETURNED_TO_SENDER
 */
const completeJob = async ({ parcelId, dp, receivedBy }) => {
  return prisma.$transaction(async (tx) => {
    const parcel = await lockOwnParcel(tx, parcelId, dp.id);

    if (parcel.status === "OUT_FOR_DELIVERY") {
      const updated = await tx.parcel.update({
        where: { id: parcel.id },
        data: { status: "DELIVERED", deliveredAt: new Date(), receivedBy: receivedBy || null, collectedAtCounter: false },
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

      return { parcel: updated, jobType: "DELIVERY" };
    }

    if (parcel.status === "OUT_FOR_PICKUP") {
      const updated = await tx.parcel.update({
        where: { id: parcel.id },
        data: { status: "RETURNED_TO_SENDER", returnedAt: new Date(), returnReason: "CUSTOMER_RETURN" },
        select: deliveryParcelSelect,
      });

      await tx.assignment.updateMany({
        where: { parcelId: parcel.id, status: "ACTIVE" },
        data: { status: "COMPLETED", endedAt: new Date() },
      });

      await tx.statusHistory.create({
        data: {
          parcelId: parcel.id,
          status: "RETURNED_TO_SENDER",
          changedById: dp.id,
          note: `Picked up by ${dp.name} · returning to sender`,
        },
      });

      await createNotification(tx, {
        userId: parcel.customerId,
        parcelId: parcel.id,
        type: "RETURNED_TO_SENDER",
        title: "Return Picked Up",
        message: `Your return ${parcel.trackingNumber} was picked up and is being returned to the sender.`,
      });

      return { parcel: updated, jobType: "PICKUP" };
    }

    throw httpError(409, "Only parcels that are out for delivery or out for pickup can be completed");
  }, TX_OPTIONS);
};

/**
 * FAIL a delivery or a pickup.
 *  - Delivery refused -> RETURNED_TO_SENDER at once
 *  - Delivery 3rd failure -> customer has 7 days to collect
 *  - Pickup 2nd failure -> return request cancelled (back to DELIVERED)
 */
const failJob = async ({ parcelId, dp, reason, note }) => {
  return prisma.$transaction(async (tx) => {
    const parcel = await lockOwnParcel(tx, parcelId, dp.id);
    const reasonText = `${FAILURE_REASONS[reason]}${note ? ` – ${note}` : ""}`;

    // ---------- Delivery failures ----------
    if (parcel.status === "OUT_FOR_DELIVERY") {
      const attempt = parcel.failedAttempts + 1;

      await tx.assignment.updateMany({
        where: { parcelId: parcel.id, status: "ACTIVE" },
        data: { status: "FAILED", endedAt: new Date(), failureReason: reason, failureNote: note || null },
      });

      const failureFields = {
        failedAttempts: { increment: 1 },
        lastFailedAt: new Date(),
        lastFailureReason: reason,
        lastFailureNote: note || null,
        ...releaseSlot,
      };

      // Refused -> straight back to the sender
      if (reason === "CUSTOMER_REFUSED") {
        const updated = await tx.parcel.update({
          where: { id: parcel.id },
          data: {
            ...failureFields,
            status: "RETURNED_TO_SENDER",
            returnedAt: new Date(),
            returnReason: "CUSTOMER_REFUSED",
            returnNote: note || null,
          },
          select: deliveryParcelSelect,
        });

        await tx.statusHistory.create({
          data: {
            parcelId: parcel.id,
            status: "RETURNED_TO_SENDER",
            changedById: dp.id,
            note: `Customer refused the parcel – returning to sender${note ? ` (${note})` : ""}`,
          },
        });

        await createNotification(tx, {
          userId: parcel.customerId,
          parcelId: parcel.id,
          type: "RETURNED_TO_SENDER",
          title: "Parcel Returned to Sender",
          message: `You refused parcel ${parcel.trackingNumber}, so it is being returned to the sender.`,
        });

        await notifyAdmins(tx, {
          parcelId: parcel.id,
          type: "RETURNED_TO_SENDER",
          title: "Parcel Refused",
          message: `${parcel.trackingNumber} was refused by the customer and is being returned to the sender.`,
        });

        return { parcel: updated, jobType: "DELIVERY", attempt, finalAttempt: false, returnedToSender: true };
      }

      const finalAttempt = attempt >= MAX_DELIVERY_ATTEMPTS;
      const deadline = finalAttempt ? new Date(Date.now() + COLLECTION_WINDOW_DAYS * DAY_MS) : null;

      const updated = await tx.parcel.update({
        where: { id: parcel.id },
        data: { ...failureFields, status: "FAILED", ...(deadline ? { collectionDeadline: deadline } : {}) },
        select: deliveryParcelSelect,
      });

      await tx.statusHistory.create({
        data: {
          parcelId: parcel.id,
          status: "FAILED",
          changedById: dp.id,
          note: `Attempt ${attempt} of ${MAX_DELIVERY_ATTEMPTS} failed: ${reasonText}${
            deadline ? ` · collect by ${istDate(deadline)}` : ""
          }`,
        },
      });

      await createNotification(tx, {
        userId: parcel.customerId,
        parcelId: parcel.id,
        type: "FAILED",
        title: finalAttempt ? "Delivery Failed – Collect from Post Office" : "Delivery Failed",
        message: finalAttempt
          ? `We could not deliver ${parcel.trackingNumber} after ${MAX_DELIVERY_ATTEMPTS} attempts (${FAILURE_REASONS[reason]}). Please collect it from the post office with ID proof by ${istDate(deadline)}, or it will be returned to the sender.`
          : `Delivery attempt ${attempt} of ${MAX_DELIVERY_ATTEMPTS} for ${parcel.trackingNumber} failed (${FAILURE_REASONS[reason]}). Please book a new delivery slot.`,
      });

      if (finalAttempt) {
        await notifyAdmins(tx, {
          parcelId: parcel.id,
          type: "FAILED",
          title: "Max Delivery Attempts Reached",
          message: `${parcel.trackingNumber} failed ${MAX_DELIVERY_ATTEMPTS} times. Customer must collect it by ${istDate(
            deadline
          )}.`,
        });
      }

      return { parcel: updated, jobType: "DELIVERY", attempt, finalAttempt, returnedToSender: false };
    }

    // ---------- Pickup failures ----------
    if (parcel.status === "OUT_FOR_PICKUP") {
      const attempt = parcel.pickupFailedAttempts + 1;
      const cancelReturn = attempt >= MAX_PICKUP_ATTEMPTS;

      await tx.assignment.updateMany({
        where: { parcelId: parcel.id, status: "ACTIVE" },
        data: { status: "FAILED", endedAt: new Date(), failureReason: reason, failureNote: note || null },
      });

      const updated = await tx.parcel.update({
        where: { id: parcel.id },
        data: {
          ...releaseSlot,
          pickupFailedAttempts: { increment: 1 },
          status: cancelReturn ? "DELIVERED" : "PICKUP_FAILED",
          ...(cancelReturn ? { returnCancelledAt: new Date() } : {}),
        },
        select: deliveryParcelSelect,
      });

      await tx.statusHistory.create({
        data: {
          parcelId: parcel.id,
          status: cancelReturn ? "DELIVERED" : "PICKUP_FAILED",
          changedById: dp.id,
          note: `Pickup attempt ${attempt} of ${MAX_PICKUP_ATTEMPTS} failed: ${reasonText}${
            cancelReturn ? " · return request cancelled" : ""
          }`,
        },
      });

      await createNotification(tx, {
        userId: parcel.customerId,
        parcelId: parcel.id,
        type: "PICKUP_UPDATE",
        title: cancelReturn ? "Return Cancelled" : "Pickup Failed",
        message: cancelReturn
          ? `We could not collect ${parcel.trackingNumber} after ${MAX_PICKUP_ATTEMPTS} attempts, so the return request has been cancelled.`
          : `Pickup attempt ${attempt} of ${MAX_PICKUP_ATTEMPTS} for ${parcel.trackingNumber} failed (${FAILURE_REASONS[reason]}). Please book a new pickup slot.`,
      });

      return { parcel: updated, jobType: "PICKUP", attempt, finalAttempt: cancelReturn, returnCancelled: cancelReturn };
    }

    throw httpError(409, "Only parcels that are out for delivery or out for pickup can be marked as failed");
  }, TX_OPTIONS);
};

module.exports = { FAILURE_REASONS, startJob, completeJob, failJob };