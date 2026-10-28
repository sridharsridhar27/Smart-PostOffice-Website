const prisma = require("../config/prisma");
const parseId = require("../utils/parseId");
const { createNotification } = require("../services/notificationService");

const phoneRegex = /^[6-9]\d{9}$/;
const trackingRegex = /^[A-Z0-9-]{4,30}$/;
const PARCEL_TYPES = ["LETTER", "SMALL", "MEDIUM", "LARGE"];
const PARCEL_STATUSES = [
  "REGISTERED",
  "NOTIFIED",
  "SLOT_BOOKED",
  "ASSIGNED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "FAILED",
  "RETURN_REQUESTED",
  "PICKUP_ASSIGNED",
  "OUT_FOR_PICKUP",
  "PICKUP_FAILED",
  "RETURNED_TO_SENDER",
];

const customerSelect = {
  id: true,
  name: true,
  phone: true,
  email: true,
  addressLine: true,
    area: { select: { id: true, name: true, pincode: true } },
  street: { select: { id: true, name: true } },
};

const parcelSelect = {
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
  assignedAt: true,
  unassignedReason: true,
    rescheduleCount: true,
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
  assignedTo: { select: { id: true, name: true, phone: true } },
  customer: { select: customerSelect },
  registeredBy: { select: { id: true, name: true } },
};

// GET /api/admin/customers/lookup?phone=9876543210
const lookupCustomerByPhone = async (req, res, next) => {
  try {
    const phone = String(req.query.phone || "").trim();

    if (!phoneRegex.test(phone)) {
      return res.status(400).json({ message: "Enter a valid 10-digit phone number" });
    }

    const customer = await prisma.user.findFirst({
      where: { phone, role: "CUSTOMER", isActive: true },
      select: customerSelect,
    });

    if (!customer) {
      return res.status(404).json({ message: "No registered customer found with this phone number" });
    }

    res.json({ customer });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/parcels  (scan + register + notify)
const createParcel = async (req, res, next) => {
  try {
    const { trackingNumber, phone, senderName, parcelType, weight } = req.body;

    if (!trackingNumber || !phone) {
      return res.status(400).json({ message: "Tracking number and customer phone are required" });
    }

    const tn = String(trackingNumber).trim().toUpperCase();
    if (!trackingRegex.test(tn)) {
      return res
        .status(400)
        .json({ message: "Tracking number must be 4-30 characters (letters, numbers, hyphen)" });
    }

    if (!phoneRegex.test(String(phone).trim())) {
      return res.status(400).json({ message: "Enter a valid 10-digit phone number" });
    }

    if (parcelType && !PARCEL_TYPES.includes(parcelType)) {
      return res.status(400).json({ message: `Parcel type must be one of: ${PARCEL_TYPES.join(", ")}` });
    }

    let weightValue = null;
    if (weight !== undefined && weight !== null && weight !== "") {
      weightValue = Number(weight);
      if (Number.isNaN(weightValue) || weightValue <= 0) {
        return res.status(400).json({ message: "Weight must be a positive number" });
      }
    }

    const customer = await prisma.user.findFirst({
      where: { phone: String(phone).trim(), role: "CUSTOMER", isActive: true },
    });
    if (!customer) {
      return res.status(404).json({ message: "No registered customer found with this phone number" });
    }

    const existing = await prisma.parcel.findUnique({ where: { trackingNumber: tn } });
    if (existing) {
      return res.status(409).json({ message: `Parcel ${tn} is already registered` });
    }

    const parcel = await prisma.$transaction(
      async (tx) => {
        // 1. Register parcel
        const created = await tx.parcel.create({
          data: {
            trackingNumber: tn,
            customerId: customer.id,
            registeredById: req.user.id,
            senderName: senderName?.trim() || null,
            parcelType: parcelType || "SMALL",
            weight: weightValue,
            statusHistory: {
              create: {
                status: "REGISTERED",
                changedById: req.user.id,
                note: "Parcel scanned and registered",
              },
            },
          },
        });

        // 2. Notify customer
        await createNotification(tx, {
          userId: customer.id,
          parcelId: created.id,
          type: "PARCEL_ARRIVED",
          title: "Parcel Arrived",
          message: `Your parcel ${tn} has arrived at the post office. Please book a delivery slot.`,
        });

        await tx.statusHistory.create({
          data: {
            parcelId: created.id,
            status: "NOTIFIED",
            note: "Arrival notification sent to customer",
          },
        });

        // 3. Update status
        return tx.parcel.update({
          where: { id: created.id },
          data: { status: "NOTIFIED" },
          select: parcelSelect,
        });
      },
      { timeout: 15000 }
    );

    res.status(201).json({
      message: "Parcel registered and customer notified",
      steps: ["Parcel Details Registered Successfully", "Parcel Arrival Notification Sent"],
      parcel,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/parcels?status=NOTIFIED&search=TN123
const getParcels = async (req, res, next) => {
  try {
    const { status, search } = req.query;
    const where = {};

    if (status) {
      if (!PARCEL_STATUSES.includes(status)) {
        return res.status(400).json({ message: "Invalid status filter" });
      }
      where.status = status;
    }

        if (search?.trim()) {
      const s = search.trim();
      where.OR = [
        { trackingNumber: { contains: s, mode: "insensitive" } },
        { customer: { phone: { contains: s } } },
        { customer: { name: { contains: s, mode: "insensitive" } } },
        { customer: { area: { pincode: { contains: s } } } },
      ];
    }

    const parcels = await prisma.parcel.findMany({
      where,
      select: parcelSelect,
      orderBy: { arrivedAt: "desc" },
      take: 100,
    });

    res.json({ parcels });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/parcels/:id
const getParcelById = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid parcel id" });

    const parcel = await prisma.parcel.findUnique({
      where: { id },
      select: {
        ...parcelSelect,
        statusHistory: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            status: true,
            note: true,
            createdAt: true,
            changedBy: { select: { id: true, name: true, role: true } },
          },
        },
                assignments: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            method: true,
            status: true,
            score: true,
            scoreBreakdown: true,
            reason: true,
            candidatesEvaluated: true,
            createdAt: true,
            endedAt: true,
                        failureReason: true,
            failureNote: true,
            deliveryPerson: { select: { id: true, name: true } },
            assignedBy: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!parcel) return res.status(404).json({ message: "Parcel not found" });

    res.json({ parcel });
  } catch (err) {
    next(err);
  }
};

module.exports = { lookupCustomerByPhone, createParcel, getParcels, getParcelById };