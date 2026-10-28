const prisma = require("../config/prisma");
const parseId = require("../utils/parseId");
const { assignForCustomer } = require("../services/assignmentService");
const { validateSlotRequest } = require("../utils/slotUtils");
const {
  RETURN_REASONS,
  RTS_REASONS,
  PICKUP_STATUSES,
  requestReturn,
  rebookPickup,
  cancelReturn,
  markCollected,
  adminReturnToSender,
} = require("../services/returnService");

const parcelResultSelect = {
  id: true,
  trackingNumber: true,
  status: true,
  slotDate: true,
  slotHour: true,
  returnRequestedAt: true,
  customerReturnReason: true,
  pickupFailedAttempts: true,
  assignedTo: { select: { id: true, name: true } },
};

// POST /api/customer/parcels/:id/return   body: { reason, note?, date, hour }
const requestReturnHandler = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid parcel id" });

    const { reason, date } = req.body;
    const note = (req.body.note || "").trim();

    if (!RETURN_REASONS[reason]) {
      return res.status(400).json({ message: `Reason must be one of: ${Object.keys(RETURN_REASONS).join(", ")}` });
    }
    if (reason === "OTHER" && !note) return res.status(400).json({ message: "Please describe the reason in the note" });
    if (note.length > 200) return res.status(400).json({ message: "Note must be 200 characters or less" });

    const { error, hour } = validateSlotRequest(date, req.body.hour);
    if (error) return res.status(400).json({ message: error });

    const { slot } = await requestReturn({ parcelId: id, customer: req.user, reason, note, date, hour });
    const assignment = await assignForCustomer(id);
    const parcel = await prisma.parcel.findUnique({ where: { id }, select: parcelResultSelect });

    res.status(201).json({
      message: "Return requested successfully",
      steps: ["Return Requested Successfully", ...assignment.steps],
      parcel,
      slot,
      assignment,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/customer/parcels/:id/pickup-slot   body: { date, hour }
const rebookPickupHandler = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid parcel id" });

    const { date } = req.body;
    const { error, hour } = validateSlotRequest(date, req.body.hour);
    if (error) return res.status(400).json({ message: error });

    const { slot } = await rebookPickup({ parcelId: id, customer: req.user, date, hour });
    const assignment = await assignForCustomer(id);
    const parcel = await prisma.parcel.findUnique({ where: { id }, select: parcelResultSelect });

    res.status(201).json({
      message: "New pickup slot booked",
      steps: ["Pickup Slot Booked Successfully", ...assignment.steps],
      parcel,
      slot,
      assignment,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/customer/parcels/:id/cancel-return
const cancelReturnHandler = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid parcel id" });

    await cancelReturn({ parcelId: id, customer: req.user });
    const parcel = await prisma.parcel.findUnique({ where: { id }, select: parcelResultSelect });
    res.json({ message: "Return request cancelled", parcel });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/parcels/:id/mark-collected
const markCollectedHandler = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid parcel id" });

    const r = await markCollected({ parcelId: id, admin: req.user });
    res.json({ message: `${r.trackingNumber} marked as collected at the post office` });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/parcels/:id/return-to-sender   body: { note? }
const returnToSenderHandler = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid parcel id" });

    const note = (req.body.note || "").trim();
    if (note.length > 200) return res.status(400).json({ message: "Note must be 200 characters or less" });

    const r = await adminReturnToSender({ parcelId: id, admin: req.user, note });
    res.json({ message: `${r.trackingNumber} returned to sender` });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/returns   (three lists for the admin Returns page)
const getReturns = async (req, res, next) => {
  try {
    const customerSelect = {
      select: {
        name: true,
        phone: true,
                area: { select: { name: true, pincode: true } },
        street: { select: { name: true } },
      },
    };

    const [awaitingCollection, activeReturns, returnedToSender] = await Promise.all([
      prisma.parcel.findMany({
        where: { status: "FAILED", collectionDeadline: { not: null } },
        orderBy: { collectionDeadline: "asc" },
        select: {
          id: true,
          trackingNumber: true,
          failedAttempts: true,
          lastFailureReason: true,
          collectionDeadline: true,
          customer: customerSelect,
        },
      }),
      prisma.parcel.findMany({
        where: { status: { in: PICKUP_STATUSES } },
        orderBy: { returnRequestedAt: "desc" },
        select: {
          id: true,
          trackingNumber: true,
          status: true,
          slotDate: true,
          slotHour: true,
          returnRequestedAt: true,
          customerReturnReason: true,
          customerReturnNote: true,
          pickupFailedAttempts: true,
          assignedTo: { select: { name: true } },
          customer: customerSelect,
        },
      }),
      prisma.parcel.findMany({
        where: { status: "RETURNED_TO_SENDER" },
        orderBy: { returnedAt: "desc" },
        take: 50,
        select: {
          id: true,
          trackingNumber: true,
          returnedAt: true,
          returnReason: true,
          returnNote: true,
          senderName: true,
          customer: customerSelect,
        },
      }),
    ]);

    res.json({
      returnReasons: RETURN_REASONS,
      rtsReasons: RTS_REASONS,
      awaitingCollection,
      activeReturns,
      returnedToSender,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  requestReturnHandler,
  rebookPickupHandler,
  cancelReturnHandler,
  markCollectedHandler,
  returnToSenderHandler,
  getReturns,
};