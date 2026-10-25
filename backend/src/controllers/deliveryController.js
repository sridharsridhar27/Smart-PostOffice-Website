const prisma = require("../config/prisma");
const parseId = require("../utils/parseId");
const {
  FAILURE_REASONS,
  markOutForDelivery,
  markDelivered,
  markFailed,
} = require("../services/deliveryService");
const { getISTNow, isValidDateStr, toSlotDate, slotLabel, formatDateLabel } = require("../utils/slotUtils");

// GET /api/delivery/parcels?date=2026-10-26   (defaults to today)
// Based on assignments, so failed attempts still show in the delivery person's list
const getMyDeliveries = async (req, res, next) => {
  try {
    const today = getISTNow().dateStr;
    const date = req.query.date || today;

    if (!isValidDateStr(date)) {
      return res.status(400).json({ message: "Invalid date. Use YYYY-MM-DD format" });
    }

    const assignments = await prisma.assignment.findMany({
      where: {
        deliveryPersonId: req.user.id,
        slotDate: toSlotDate(date),
        status: { in: ["ACTIVE", "COMPLETED", "FAILED"] },
      },
      orderBy: [{ slotHour: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        status: true,
        slotHour: true,
        failureReason: true,
        failureNote: true,
        parcel: {
          select: {
            id: true,
            trackingNumber: true,
            status: true,
            parcelType: true,
            weight: true,
            senderName: true,
            receivedBy: true,
            deliveredAt: true,
            outForDeliveryAt: true,
            customer: {
              select: {
                name: true,
                phone: true,
                addressLine: true,
                area: { select: { name: true } },
                street: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    const deliveries = assignments.map((a) => {
      const deliveryStatus =
        a.status === "FAILED" ? "FAILED" : a.status === "COMPLETED" ? "DELIVERED" : a.parcel.status;

      return {
        assignmentId: a.id,
        slotHour: a.slotHour,
        slotLabel: slotLabel(a.slotHour),
        deliveryStatus,
        failureReason: a.failureReason,
        failureReasonLabel: a.failureReason ? FAILURE_REASONS[a.failureReason] : null,
        failureNote: a.failureNote,
        parcel: a.parcel,
      };
    });

    const count = (s) => deliveries.filter((d) => d.deliveryStatus === s).length;

    res.json({
      date,
      dateLabel: formatDateLabel(date),
      isToday: date === today,
      summary: {
        total: deliveries.length,
        pending: count("ASSIGNED"),
        outForDelivery: count("OUT_FOR_DELIVERY"),
        delivered: count("DELIVERED"),
        failed: count("FAILED"),
      },
      failureReasons: FAILURE_REASONS,
      deliveries,
    });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/delivery/parcels/:id/out-for-delivery
const outForDelivery = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid parcel id" });

    const parcel = await markOutForDelivery({ parcelId: id, dp: req.user });
    res.json({ message: "Parcel marked as out for delivery", parcel });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/delivery/parcels/:id/delivered   body: { receivedBy? }
const delivered = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid parcel id" });

    const receivedBy = (req.body.receivedBy || "").trim();
    if (receivedBy.length > 60) {
      return res.status(400).json({ message: "Received by must be 60 characters or less" });
    }

    const parcel = await markDelivered({ parcelId: id, dp: req.user, receivedBy });
    res.json({ message: "Parcel delivered successfully", parcel });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/delivery/parcels/:id/failed   body: { reason, note? }
const failed = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid parcel id" });

    const { reason } = req.body;
    const note = (req.body.note || "").trim();

    if (!FAILURE_REASONS[reason]) {
      return res.status(400).json({
        message: `Reason must be one of: ${Object.keys(FAILURE_REASONS).join(", ")}`,
      });
    }
    if (reason === "OTHER" && !note) {
      return res.status(400).json({ message: "Please describe the reason in the note" });
    }
    if (note.length > 200) {
      return res.status(400).json({ message: "Note must be 200 characters or less" });
    }

    const result = await markFailed({ parcelId: id, dp: req.user, reason, note });
    res.json({
      message: result.finalAttempt
        ? "Delivery failed. Maximum attempts reached – customer will collect from post office"
        : "Delivery marked as failed. Customer has been asked to book a new slot",
      ...result,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getMyDeliveries, outForDelivery, delivered, failed };