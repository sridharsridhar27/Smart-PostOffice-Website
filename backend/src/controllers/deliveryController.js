const prisma = require("../config/prisma");
const parseId = require("../utils/parseId");
const { FAILURE_REASONS, startJob, completeJob, failJob } = require("../services/deliveryService");
const { RETURN_REASONS } = require("../services/returnService");
const { getISTNow, isValidDateStr, toSlotDate, slotLabel, formatDateLabel } = require("../utils/slotUtils");

// Status shown on the delivery person's card, from the assignment + parcel
const cardStatus = (a) => {
  if (a.status === "FAILED") return a.jobType === "PICKUP" ? "PICKUP_FAILED" : "FAILED";
  if (a.status === "COMPLETED") return a.jobType === "PICKUP" ? "PICKED_UP" : "DELIVERED";
  return a.parcel.status; // ASSIGNED / OUT_FOR_DELIVERY / PICKUP_ASSIGNED / OUT_FOR_PICKUP
};

// GET /api/delivery/parcels?date=2026-10-26   (deliveries + pickups)
const getMyDeliveries = async (req, res, next) => {
  try {
    const today = getISTNow().dateStr;
    const date = req.query.date || today;
    if (!isValidDateStr(date)) return res.status(400).json({ message: "Invalid date. Use YYYY-MM-DD format" });

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
        jobType: true,
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
            customerReturnReason: true,
            customerReturnNote: true,
            customer: {
              select: {
                name: true,
                phone: true,
                addressLine: true,
                                area: { select: { name: true, pincode: true } },
                street: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    const deliveries = assignments.map((a) => ({
      assignmentId: a.id,
      jobType: a.jobType,
      slotHour: a.slotHour,
      slotLabel: slotLabel(a.slotHour),
      deliveryStatus: cardStatus(a),
      failureReason: a.failureReason,
      failureReasonLabel: a.failureReason ? FAILURE_REASONS[a.failureReason] : null,
      failureNote: a.failureNote,
      returnReasonLabel: a.parcel.customerReturnReason ? RETURN_REASONS[a.parcel.customerReturnReason] : null,
      parcel: a.parcel,
    }));

    const count = (...statuses) => deliveries.filter((d) => statuses.includes(d.deliveryStatus)).length;

    res.json({
      date,
      dateLabel: formatDateLabel(date),
      isToday: date === today,
      summary: {
        total: deliveries.length,
        pickups: deliveries.filter((d) => d.jobType === "PICKUP").length,
        pending: count("ASSIGNED", "PICKUP_ASSIGNED"),
        outForDelivery: count("OUT_FOR_DELIVERY", "OUT_FOR_PICKUP"),
        delivered: count("DELIVERED", "PICKED_UP"),
        failed: count("FAILED", "PICKUP_FAILED"),
      },
      failureReasons: FAILURE_REASONS,
      deliveries,
    });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/delivery/parcels/:id/start   (alias: /out-for-delivery)
const start = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid parcel id" });

    const result = await startJob({ parcelId: id, dp: req.user });
    res.json({
      message: result.jobType === "PICKUP" ? "Parcel marked as out for pickup" : "Parcel marked as out for delivery",
      ...result,
    });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/delivery/parcels/:id/complete   (alias: /delivered)   body: { receivedBy? }
const complete = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid parcel id" });

    const receivedBy = (req.body.receivedBy || "").trim();
    if (receivedBy.length > 60) {
      return res.status(400).json({ message: "Received by must be 60 characters or less" });
    }

    const result = await completeJob({ parcelId: id, dp: req.user, receivedBy });
    res.json({
      message: result.jobType === "PICKUP" ? "Return picked up – returning to sender" : "Parcel delivered successfully",
      ...result,
    });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/delivery/parcels/:id/fail   (alias: /failed)   body: { reason, note? }
const fail = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid parcel id" });

    const { reason } = req.body;
    const note = (req.body.note || "").trim();

    if (!FAILURE_REASONS[reason]) {
      return res.status(400).json({ message: `Reason must be one of: ${Object.keys(FAILURE_REASONS).join(", ")}` });
    }
    if (reason === "OTHER" && !note) return res.status(400).json({ message: "Please describe the reason in the note" });
    if (note.length > 200) return res.status(400).json({ message: "Note must be 200 characters or less" });

    const result = await failJob({ parcelId: id, dp: req.user, reason, note });

    let message;
    if (result.returnedToSender) message = "Customer refused – parcel will be returned to the sender";
    else if (result.jobType === "PICKUP") {
      message = result.returnCancelled
        ? "Pickup failed twice – return request cancelled"
        : "Pickup marked as failed. Customer has been asked to book a new pickup slot";
    } else {
      message = result.finalAttempt
        ? "Delivery failed. Maximum attempts reached – customer has 7 days to collect from post office"
        : "Delivery marked as failed. Customer has been asked to book a new slot";
    }

    res.json({ message, ...result });
  } catch (err) {
    next(err);
  }
};

module.exports = { getMyDeliveries, start, complete, fail };