const prisma = require("../config/prisma");
const parseId = require("../utils/parseId");
const { MAX_RESCHEDULES, MAX_DELIVERY_ATTEMPTS } = require("../utils/slotUtils");
const { FAILURE_REASONS } = require("../services/deliveryService");

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
};

// What the customer can do with this parcel right now
const withActions = (p) => ({
  ...p,
  lastFailureReasonLabel: p.lastFailureReason ? FAILURE_REASONS[p.lastFailureReason] : null,
  actions: {
    canBookSlot:
      p.status === "NOTIFIED" || (p.status === "FAILED" && p.failedAttempts < MAX_DELIVERY_ATTEMPTS),
    canReschedule: ["SLOT_BOOKED", "ASSIGNED"].includes(p.status) && p.rescheduleCount < MAX_RESCHEDULES,
    reschedulesLeft: Math.max(0, MAX_RESCHEDULES - p.rescheduleCount),
    attemptsLeft: Math.max(0, MAX_DELIVERY_ATTEMPTS - p.failedAttempts),
    mustCollect: p.status === "FAILED" && p.failedAttempts >= MAX_DELIVERY_ATTEMPTS,
  },
});

// GET /api/customer/parcels
const getMyParcels = async (req, res, next) => {
  try {
    const parcels = await prisma.parcel.findMany({
      where: { customerId: req.user.id },
      select: myParcelSelect,
      orderBy: { arrivedAt: "desc" },
    });

    res.json({ parcels: parcels.map(withActions) });
  } catch (err) {
    next(err);
  }
};

// GET /api/customer/parcels/:id  (only own parcel)
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

    res.json({ parcel: withActions(parcel) });
  } catch (err) {
    next(err);
  }
};

module.exports = { getMyParcels, getMyParcelById };