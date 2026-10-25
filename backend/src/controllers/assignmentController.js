const prisma = require("../config/prisma");
const parseId = require("../utils/parseId");
const {
  LOAD_STATUSES,
  assignParcel,
  manualAssign,
  previewCandidates,
  toAdminResult,
} = require("../services/assignmentService");
const {
  MAX_PARCELS_PER_DAY,
  getISTNow,
  isValidDateStr,
  toSlotDate,
  slotLabel,
  formatDateLabel,
} = require("../utils/slotUtils");

// POST /api/admin/parcels/:id/auto-assign   (re-run AI, e.g. from unassigned queue)
const autoAssignParcel = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid parcel id" });

    const parcel = await prisma.parcel.findUnique({
      where: { id },
      select: { status: true, assignedToId: true },
    });
    if (!parcel) return res.status(404).json({ message: "Parcel not found" });
    if (parcel.status !== "SLOT_BOOKED" || parcel.assignedToId) {
      return res.status(409).json({ message: "Parcel is not waiting for assignment" });
    }

    const result = await assignParcel(id);
    res.json({
      message: result.assigned ? "Parcel assigned successfully" : "No suitable delivery person available",
      result: toAdminResult(result),
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/admin/parcels/:id/assign   body: { deliveryPersonId }
const manualAssignParcel = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const deliveryPersonId = parseId(req.body.deliveryPersonId);

    if (!id) return res.status(400).json({ message: "Invalid parcel id" });
    if (!deliveryPersonId) return res.status(400).json({ message: "Valid deliveryPersonId is required" });

    const result = await manualAssign({ parcelId: id, deliveryPersonId, admin: req.user });

    res.json({
      message: result.reassigned ? "Parcel reassigned successfully" : "Parcel assigned successfully",
      deliveryPerson: result.deliveryPerson,
      assignment: result.assignment,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/parcels/:id/ai-preview   (scores of all delivery persons, nothing saved)
const previewAssignment = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid parcel id" });

    const { parcel, evaluation } = await previewCandidates(id);

    res.json({
      parcel: { id: parcel.id, trackingNumber: parcel.trackingNumber, status: parcel.status },
      candidatesEvaluated: evaluation.evaluated,
      candidates: evaluation.candidates,
      excluded: evaluation.excluded,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/assignments/unassigned
const getUnassignedParcels = async (req, res, next) => {
  try {
    const parcels = await prisma.parcel.findMany({
      where: { status: "SLOT_BOOKED", assignedToId: null },
      orderBy: [{ slotDate: "asc" }, { slotHour: "asc" }],
      select: {
        id: true,
        trackingNumber: true,
        status: true,
        slotDate: true,
        slotHour: true,
        unassignedReason: true,
        customer: {
          select: {
            name: true,
            phone: true,
            area: { select: { id: true, name: true } },
            street: { select: { id: true, name: true } },
          },
        },
      },
    });

    res.json({ parcels });
  } catch (err) {
    next(err);
  }
};

// GET /api/admin/assignments/workload?date=2026-10-26   (defaults to today)
const getWorkload = async (req, res, next) => {
  try {
    const date = req.query.date || getISTNow().dateStr;
    if (!isValidDateStr(date)) {
      return res.status(400).json({ message: "Invalid date. Use YYYY-MM-DD format" });
    }

    const slotDate = toSlotDate(date);

    const [deliveryPersons, unassignedCount] = await Promise.all([
      prisma.user.findMany({
        where: { role: "DELIVERY" },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          phone: true,
          isActive: true,
          homeArea: { select: { id: true, name: true } },
          assignedParcels: {
            where: { slotDate, status: { in: LOAD_STATUSES } },
            orderBy: { slotHour: "asc" },
            select: {
              id: true,
              trackingNumber: true,
              status: true,
              slotHour: true,
              customer: {
                select: {
                  name: true,
                  area: { select: { name: true } },
                  street: { select: { name: true } },
                },
              },
            },
          },
        },
      }),
      prisma.parcel.count({ where: { slotDate, status: "SLOT_BOOKED", assignedToId: null } }),
    ]);

    const result = deliveryPersons.map(({ assignedParcels, ...dp }) => ({
      ...dp,
      load: assignedParcels.length,
      capacity: MAX_PARCELS_PER_DAY,
      freeSpots: Math.max(0, MAX_PARCELS_PER_DAY - assignedParcels.length),
      parcels: assignedParcels.map((p) => ({ ...p, slotLabel: slotLabel(p.slotHour) })),
    }));

    res.json({
      date,
      dateLabel: formatDateLabel(date),
      totalAssigned: result.reduce((sum, d) => sum + d.load, 0),
      unassignedCount,
      deliveryPersons: result,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  autoAssignParcel,
  manualAssignParcel,
  previewAssignment,
  getUnassignedParcels,
  getWorkload,
};