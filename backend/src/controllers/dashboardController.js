const prisma = require("../config/prisma");
const { getDayCapacity, ACTIVE_SLOT_STATUSES } = require("../services/slotService");
const { LOAD_STATUSES } = require("../services/assignmentService");
const { countDue, getAfterHours } = require("../services/autoBookService");
const {
  SLOT_HOURS,
  MAX_PARCELS_PER_DAY,
  MAX_DELIVERY_ATTEMPTS,
  getISTNow,
  toSlotDate,
  slotLabel,
  formatDateLabel,
} = require("../utils/slotUtils");

const ALL_STATUSES = ["REGISTERED", "NOTIFIED", "SLOT_BOOKED", "ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED"];

// GET /api/admin/dashboard
const getDashboard = async (req, res, next) => {
  try {
    const today = getISTNow().dateStr;
    const todayDate = toSlotDate(today);
    const startOfTodayIST = new Date(`${today}T00:00:00+05:30`);

    const [
      statusGroups,
      arrivedToday,
      todayStatusGroups,
      todaySlotGroups,
      unassigned,
      autoBookDue,
      mustCollect,
      capacity,
      deliveryPersons,
      todayLoads,
      aiCount,
      manualCount,
      aiAvg,
      autoBookedTotal,
      recent,
    ] = await Promise.all([
      prisma.parcel.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.parcel.count({ where: { arrivedAt: { gte: startOfTodayIST } } }),
      prisma.parcel.groupBy({ by: ["status"], where: { slotDate: todayDate }, _count: { _all: true } }),
      prisma.parcel.groupBy({
        by: ["slotHour"],
        where: { slotDate: todayDate, status: { in: ACTIVE_SLOT_STATUSES } },
        _count: { _all: true },
      }),
      prisma.parcel.count({ where: { status: "SLOT_BOOKED", assignedToId: null } }),
      countDue(),
      prisma.parcel.count({ where: { status: "FAILED", failedAttempts: { gte: MAX_DELIVERY_ATTEMPTS } } }),
      getDayCapacity(),
      prisma.user.findMany({
        where: { role: "DELIVERY", isActive: true },
        select: { id: true, name: true, homeArea: { select: { name: true } } },
        orderBy: { name: "asc" },
      }),
      prisma.parcel.groupBy({
        by: ["assignedToId", "status"],
        where: { slotDate: todayDate, assignedToId: { not: null }, status: { in: LOAD_STATUSES } },
        _count: { _all: true },
      }),
      prisma.assignment.count({ where: { method: "AI_AUTO" } }),
      prisma.assignment.count({ where: { method: "MANUAL" } }),
      prisma.assignment.aggregate({ where: { method: "AI_AUTO" }, _avg: { score: true } }),
      prisma.parcel.count({ where: { slotAutoBooked: true } }),
      prisma.statusHistory.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          status: true,
          note: true,
          createdAt: true,
          parcel: { select: { id: true, trackingNumber: true } },
          changedBy: { select: { name: true, role: true } },
        },
      }),
    ]);

    // Pipeline (all parcels by status)
    const pipeline = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0]));
    statusGroups.forEach((g) => {
      pipeline[g.status] = g._count._all;
    });

    // Today's deliveries by status
    const todayByStatus = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0]));
    todayStatusGroups.forEach((g) => {
      todayByStatus[g.status] = g._count._all;
    });

    // Failed attempts happening today clear the slot, so count them from assignments
    const failedToday = await prisma.assignment.count({ where: { slotDate: todayDate, status: "FAILED" } });

    const slotsToday = SLOT_HOURS.map((hour) => ({
      hour,
      label: slotLabel(hour),
      count: todaySlotGroups.find((g) => g.slotHour === hour)?._count._all || 0,
    }));

    const workload = deliveryPersons.map((dp) => {
      const rows = todayLoads.filter((l) => l.assignedToId === dp.id);
      const by = (s) => rows.find((r) => r.status === s)?._count._all || 0;
      const load = rows.reduce((sum, r) => sum + r._count._all, 0);
      return {
        id: dp.id,
        name: dp.name,
        homeArea: dp.homeArea?.name || null,
        load,
        capacity: MAX_PARCELS_PER_DAY,
        assigned: by("ASSIGNED"),
        outForDelivery: by("OUT_FOR_DELIVERY"),
        delivered: by("DELIVERED"),
      };
    });

    const bookedToday = slotsToday.reduce((s, x) => s + x.count, 0);

    res.json({
      date: today,
      dateLabel: formatDateLabel(today),
      generatedAt: new Date(),
      today: {
        arrived: arrivedToday,
        slotsBooked: bookedToday,
        capacity,
        assigned: todayByStatus.ASSIGNED,
        outForDelivery: todayByStatus.OUT_FOR_DELIVERY,
        delivered: todayByStatus.DELIVERED,
        failed: failedToday,
        waitingAssignment: todayByStatus.SLOT_BOOKED,
      },
      pipeline,
      alerts: {
        awaitingBooking: pipeline.NOTIFIED,
        autoBookDue,
        autoBookAfterHours: getAfterHours(),
        unassigned,
        mustCollect,
      },
      slotsToday,
      workload,
      ai: {
        aiAssignments: aiCount,
        manualAssignments: manualCount,
        aiRate: aiCount + manualCount ? Math.round((aiCount / (aiCount + manualCount)) * 100) : 0,
        averageScore: aiAvg._avg.score ? Math.round(aiAvg._avg.score) : 0,
        autoBookedSlots: autoBookedTotal,
      },
      recentActivity: recent,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getDashboard };