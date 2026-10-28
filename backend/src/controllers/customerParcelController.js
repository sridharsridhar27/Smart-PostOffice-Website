const prisma = require("../config/prisma");
const parseId = require("../utils/parseId");
const {
  MAX_RESCHEDULES,
  MAX_DELIVERY_ATTEMPTS,
  MAX_PICKUP_ATTEMPTS,
  RETURN_WINDOW_DAYS,
} = require("../utils/slotUtils");
const { FAILURE_REASONS } = require("../services/deliveryService");
const { RETURN_REASONS, RTS_REASONS } = require("../services/returnService");

const DAY_MS = 24 * 60 * 60 * 1000;

const myParcelSelect = {
  id: true,
  trackingNumber: true,
  senderName: true,
  parcelType: true,
  weight: true,
  status: true,
  arrivedAt: true,
  updatedAt: true,
  slotDate: true,
  slotHour: true,
  slotBookedAt: true,
  slotAutoBooked: true,
  rescheduleCount: true,
  assignedAt: true,
  assignedTo: { select: { name: true, phone: true } },
  outForDeliveryAt: true,
  deliveredAt: true,
  receivedBy: true,
  failedAttempts: true,
  lastFailedAt: true,
  lastFailureReason: true,
  lastFailureNote: true,
  collectionDeadline: true,
  collectedAtCounter: true,
  returnedAt: true,
  returnReason: true,
  returnNote: true,
  returnRequestedAt: true,
  customerReturnReason: true,
  customerReturnNote: true,
  returnCancelledAt: true,
  pickupFailedAttempts: true,
};

// What the customer can do with this parcel right now
const withActions = (p) => {
  const returnWindowEndsAt = p.deliveredAt ? new Date(p.deliveredAt.getTime() + RETURN_WINDOW_DAYS * DAY_MS) : null;

  return {
    ...p,
    lastFailureReasonLabel: p.lastFailureReason ? FAILURE_REASONS[p.lastFailureReason] : null,
    customerReturnReasonLabel: p.customerReturnReason ? RETURN_REASONS[p.customerReturnReason] : null,
    returnReasonLabel: p.returnReason ? RTS_REASONS[p.returnReason] : null,
    returnWindowEndsAt,
    actions: {
      canBookSlot:
        p.status === "NOTIFIED" || (p.status === "FAILED" && p.failedAttempts < MAX_DELIVERY_ATTEMPTS),
      canReschedule: ["SLOT_BOOKED", "ASSIGNED"].includes(p.status) && p.rescheduleCount < MAX_RESCHEDULES,
      reschedulesLeft: Math.max(0, MAX_RESCHEDULES - p.rescheduleCount),
      attemptsLeft: Math.max(0, MAX_DELIVERY_ATTEMPTS - p.failedAttempts),
      mustCollect: p.status === "FAILED" && p.failedAttempts >= MAX_DELIVERY_ATTEMPTS,
      canRequestReturn:
        p.status === "DELIVERED" && !p.returnRequestedAt && !!returnWindowEndsAt && returnWindowEndsAt > new Date(),
      canCancelReturn: ["RETURN_REQUESTED", "PICKUP_ASSIGNED", "PICKUP_FAILED"].includes(p.status),
      canRebookPickup: p.status === "PICKUP_FAILED" && p.pickupFailedAttempts < MAX_PICKUP_ATTEMPTS,
      pickupAttemptsLeft: Math.max(0, MAX_PICKUP_ATTEMPTS - p.pickupFailedAttempts),
    },
  };
};

// GET /api/customer/parcels
const getMyParcels = async (req, res, next) => {
  try {
    const parcels = await prisma.parcel.findMany({
      where: { customerId: req.user.id },
      select: myParcelSelect,
      orderBy: { arrivedAt: "desc" },
    });
    res.json({ parcels: parcels.map(withActions), returnReasons: RETURN_REASONS });
  } catch (err) {
    next(err);
  }
};

// GET /api/customer/parcels/:id
const getMyParcelById = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid parcel id" });

    const parcel = await prisma.parcel.findFirst({
      where: { id, customerId: req.user.id },
      select: {
        ...myParcelSelect,
        statusHistory: {
          orderBy: { createdAt: "asc" },
          select: { id: true, status: true, note: true, createdAt: true },
        },
      },
    });

    if (!parcel) return res.status(404).json({ message: "Parcel not found" });

    res.json({ parcel: withActions(parcel), returnReasons: RETURN_REASONS });
  } catch (err) {
    next(err);
  }
};

module.exports = { getMyParcels, getMyParcelById };