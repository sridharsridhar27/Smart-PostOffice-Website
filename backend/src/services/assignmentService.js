const { Prisma } = require("@prisma/client");
const prisma = require("../config/prisma");
const { createNotification } = require("./notificationService");
const { MAX_PARCELS_PER_DAY, toDateStr, slotLabel, formatDateLabel } = require("../utils/slotUtils");

// ---------------- AI scoring weights ----------------
const WEIGHTS = {
  SAME_STREET_SLOT: 50,
  SAME_AREA_SLOT: 30,
  HOME_AREA: 20,
  PER_FREE_SPOT: 5,
};

// Jobs (deliveries + pickups) that count towards a delivery person's daily load
const LOAD_STATUSES = [
  "ASSIGNED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "PICKUP_ASSIGNED",
  "OUT_FOR_PICKUP",
  "RETURNED_TO_SENDER",
];

// Statuses waiting for a delivery person
const WAITING_STATUSES = ["SLOT_BOOKED", "RETURN_REQUESTED"];

// Which job a status belongs to, and the status after assignment
const JOB_BY_STATUS = {
  SLOT_BOOKED: { jobType: "DELIVERY", assignedStatus: "ASSIGNED" },
  ASSIGNED: { jobType: "DELIVERY", assignedStatus: "ASSIGNED" },
  RETURN_REQUESTED: { jobType: "PICKUP", assignedStatus: "PICKUP_ASSIGNED" },
  PICKUP_ASSIGNED: { jobType: "PICKUP", assignedStatus: "PICKUP_ASSIGNED" },
};

const TX_OPTIONS = { timeout: 20000, maxWait: 10000 };

const AI_STEPS = [
  "Area & Time Slot Verified",
  "Conflict Check Completed",
  "AI Assigned Suitable Delivery Person",
  "Assignment Details Displayed Successfully",
];

const httpError = (statusCode, message) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const parcelForAssignSelect = {
  id: true,
  trackingNumber: true,
  status: true,
  slotDate: true,
  slotHour: true,
  assignedToId: true,
  customerId: true,
  customer: {
    select: {
      id: true,
      name: true,
      areaId: true,
      streetId: true,
      area: { select: { name: true } },
      street: { select: { name: true } },
    },
  },
};

const slotText = (parcel) =>
  `${formatDateLabel(toDateStr(parcel.slotDate))}, ${slotLabel(parcel.slotHour)}`;

const buildReason = (c, parcel) => {
  const parts = [];
  if (c.sameStreetCount > 0) {
    parts.push(
      `Already has ${c.sameStreetCount} job${c.sameStreetCount > 1 ? "s" : ""} on ${
        parcel.customer.street.name
      } in this slot`
    );
  } else if (c.sameAreaCount > 0) {
    parts.push(`Already working in ${parcel.customer.area.name} in this slot`);
  }
  if (c.breakdown.homeArea > 0) parts.push(`Home area is ${parcel.customer.area.name}`);
  parts.push(`${c.load}/${MAX_PARCELS_PER_DAY} jobs used that day`);
  return parts.join("; ");
};

/**
 * Scores every active delivery person for a parcel (delivery or pickup).
 */
const evaluateCandidates = async (client, parcel) => {
  const deliveryPersons = await client.user.findMany({
    where: { role: "DELIVERY", isActive: true },
    select: { id: true, name: true, phone: true, homeAreaId: true, homeArea: { select: { name: true } } },
    orderBy: { id: "asc" },
  });

  if (deliveryPersons.length === 0) return { candidates: [], excluded: [], evaluated: 0 };

  const dpIds = deliveryPersons.map((d) => d.id);

  const [loads, slotParcels] = await Promise.all([
    client.parcel.groupBy({
      by: ["assignedToId"],
      where: {
        slotDate: parcel.slotDate,
        assignedToId: { in: dpIds },
        status: { in: LOAD_STATUSES },
        id: { not: parcel.id },
      },
      _count: { _all: true },
    }),
    client.parcel.findMany({
      where: {
        slotDate: parcel.slotDate,
        slotHour: parcel.slotHour,
        assignedToId: { in: dpIds },
        status: { in: LOAD_STATUSES },
        id: { not: parcel.id },
      },
      select: { assignedToId: true, customer: { select: { areaId: true, streetId: true } } },
    }),
  ]);

  const loadMap = {};
  loads.forEach((l) => {
    loadMap[l.assignedToId] = l._count._all;
  });

  const candidates = [];
  const excluded = [];

  for (const dp of deliveryPersons) {
    const person = { id: dp.id, name: dp.name, phone: dp.phone, homeArea: dp.homeArea?.name || null };
    const load = loadMap[dp.id] || 0;

    if (load >= MAX_PARCELS_PER_DAY) {
      excluded.push({ deliveryPerson: person, load, reason: `Full capacity (${load}/${MAX_PARCELS_PER_DAY})` });
      continue;
    }

    const mine = slotParcels.filter((p) => p.assignedToId === dp.id);
    const sameStreetCount = mine.filter((p) => p.customer.streetId === parcel.customer.streetId).length;
    const sameAreaCount = mine.filter(
      (p) => p.customer.areaId === parcel.customer.areaId && p.customer.streetId !== parcel.customer.streetId
    ).length;

    const breakdown = {
      sameStreetSlot: sameStreetCount > 0 ? WEIGHTS.SAME_STREET_SLOT : 0,
      sameAreaSlot: sameStreetCount === 0 && sameAreaCount > 0 ? WEIGHTS.SAME_AREA_SLOT : 0,
      homeArea: dp.homeAreaId === parcel.customer.areaId ? WEIGHTS.HOME_AREA : 0,
      capacity: (MAX_PARCELS_PER_DAY - load) * WEIGHTS.PER_FREE_SPOT,
    };
    const score = Object.values(breakdown).reduce((sum, v) => sum + v, 0);

    const candidate = {
      deliveryPerson: person,
      load,
      freeSpots: MAX_PARCELS_PER_DAY - load,
      sameStreetCount,
      sameAreaCount,
      score,
      breakdown,
    };
    candidate.reason = buildReason(candidate, parcel);
    candidates.push(candidate);
  }

  candidates.sort(
    (a, b) => b.score - a.score || a.load - b.load || a.deliveryPerson.id - b.deliveryPerson.id
  );

  return { candidates, excluded, evaluated: deliveryPersons.length };
};

/**
 * AI auto-assignment for one parcel - delivery (SLOT_BOOKED) or pickup (RETURN_REQUESTED).
 * Locks the parcel and all active delivery persons (conflict-free).
 */
const assignParcel = async (parcelId) => {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Parcel" WHERE id = ${parcelId} FOR UPDATE`;

    const parcel = await tx.parcel.findUnique({ where: { id: parcelId }, select: parcelForAssignSelect });

    if (!parcel) return { assigned: false, skipped: true, reason: "Parcel not found" };
    if (!WAITING_STATUSES.includes(parcel.status) || parcel.assignedToId) {
      return { assigned: false, skipped: true, reason: "Parcel is not waiting for assignment" };
    }
    if (!parcel.slotDate || parcel.slotHour == null) {
      return { assigned: false, skipped: true, reason: "Parcel has no booked slot" };
    }

    const job = JOB_BY_STATUS[parcel.status];
    const isPickup = job.jobType === "PICKUP";

    const active = await tx.user.findMany({
      where: { role: "DELIVERY", isActive: true },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    if (active.length) {
      const ids = active.map((a) => a.id);
      await tx.$queryRaw`SELECT id FROM "User" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
    }

    const evaluation = await evaluateCandidates(tx, parcel);
    const chosen = evaluation.candidates[0];

    // Nobody available -> unassigned queue + alert admins
    if (!chosen) {
      const reason =
        evaluation.evaluated === 0
          ? "No active delivery persons available"
          : "All delivery persons are at full capacity for this day";

      await tx.parcel.update({ where: { id: parcel.id }, data: { unassignedReason: reason } });

      const admins = await tx.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
      if (admins.length) {
        await tx.notification.createMany({
          data: admins.map((a) => ({
            userId: a.id,
            parcelId: parcel.id,
            type: "UNASSIGNED_ALERT",
            title: isPickup ? "Pickup Needs Manual Assignment" : "Parcel Needs Manual Assignment",
            message: `${isPickup ? "Pickup for " : ""}${parcel.trackingNumber} (${slotText(
              parcel
            )}) could not be assigned: ${reason}.`,
          })),
        });
      }

      return { assigned: false, skipped: false, reason, parcel, evaluation, jobType: job.jobType };
    }

    const dp = chosen.deliveryPerson;

    await tx.parcel.update({
      where: { id: parcel.id },
      data: { assignedToId: dp.id, assignedAt: new Date(), status: job.assignedStatus, unassignedReason: null },
    });

    const assignment = await tx.assignment.create({
      data: {
        parcelId: parcel.id,
        deliveryPersonId: dp.id,
        slotDate: parcel.slotDate,
        slotHour: parcel.slotHour,
        jobType: job.jobType,
        method: "AI_AUTO",
        score: chosen.score,
        scoreBreakdown: chosen.breakdown,
        reason: chosen.reason,
        candidatesEvaluated: evaluation.evaluated,
      },
    });

    await tx.statusHistory.create({
      data: {
        parcelId: parcel.id,
        status: job.assignedStatus,
        note: `AI assigned ${isPickup ? "pickup " : ""}to ${dp.name} (score ${chosen.score})`,
      },
    });

    await createNotification(tx, {
      userId: parcel.customerId,
      parcelId: parcel.id,
      type: isPickup ? "PICKUP_UPDATE" : "ASSIGNED",
      title: isPickup ? "Pickup Partner Assigned" : "Delivery Partner Assigned",
      message: isPickup
        ? `${dp.name} will collect your return ${parcel.trackingNumber} on ${slotText(parcel)}.`
        : `${dp.name} will deliver your parcel ${parcel.trackingNumber} on ${slotText(parcel)}.`,
    });

    await createNotification(tx, {
      userId: dp.id,
      parcelId: parcel.id,
      type: "ASSIGNED",
      title: isPickup ? "New Pickup Assigned" : "New Parcel Assigned",
      message: `${isPickup ? "PICKUP: " : ""}${parcel.trackingNumber} → ${parcel.customer.street.name}, ${
        parcel.customer.area.name
      } → ${slotText(parcel)}.`,
    });

    return {
      assigned: true,
      skipped: false,
      parcel,
      assignment,
      chosen,
      evaluation,
      jobType: job.jobType,
      summary: `${parcel.trackingNumber} → ${parcel.customer.area.name} → ${slotLabel(parcel.slotHour)} → ${dp.name}${
        isPickup ? " (pickup)" : ""
      }`,
    };
  }, TX_OPTIONS);
};

/**
 * Manual assign / reassign by admin (delivery or pickup, not yet started).
 */
const manualAssign = async ({ parcelId, deliveryPersonId, admin }) => {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Parcel" WHERE id = ${parcelId} FOR UPDATE`;

    const parcel = await tx.parcel.findUnique({ where: { id: parcelId }, select: parcelForAssignSelect });
    if (!parcel) throw httpError(404, "Parcel not found");

    const job = JOB_BY_STATUS[parcel.status];
    if (!job) {
      throw httpError(409, "Only parcels with a booked delivery or pickup slot (not yet started) can be assigned");
    }
    if (parcel.assignedToId === deliveryPersonId) {
      throw httpError(409, "Parcel is already assigned to this delivery person");
    }
    const isPickup = job.jobType === "PICKUP";

    const dp = await tx.user.findFirst({
      where: { id: deliveryPersonId, role: "DELIVERY" },
      select: { id: true, name: true, isActive: true },
    });
    if (!dp) throw httpError(404, "Delivery person not found");
    if (!dp.isActive) throw httpError(400, "Delivery person is inactive");

    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${dp.id} FOR UPDATE`;

    const load = await tx.parcel.count({
      where: {
        assignedToId: dp.id,
        slotDate: parcel.slotDate,
        status: { in: LOAD_STATUSES },
        id: { not: parcel.id },
      },
    });
    if (load >= MAX_PARCELS_PER_DAY) {
      throw httpError(409, `${dp.name} already has ${MAX_PARCELS_PER_DAY} jobs on this day`);
    }

    const previousDpId = parcel.assignedToId;

    await tx.assignment.updateMany({
      where: { parcelId: parcel.id, status: "ACTIVE" },
      data: { status: "CANCELLED", endedAt: new Date() },
    });

    await tx.parcel.update({
      where: { id: parcel.id },
      data: { assignedToId: dp.id, assignedAt: new Date(), status: job.assignedStatus, unassignedReason: null },
    });

    const assignment = await tx.assignment.create({
      data: {
        parcelId: parcel.id,
        deliveryPersonId: dp.id,
        slotDate: parcel.slotDate,
        slotHour: parcel.slotHour,
        jobType: job.jobType,
        method: "MANUAL",
        reason: `${previousDpId ? "Reassigned" : "Assigned"} manually by ${admin.name}`,
        assignedById: admin.id,
      },
    });

    await tx.statusHistory.create({
      data: {
        parcelId: parcel.id,
        status: job.assignedStatus,
        changedById: admin.id,
        note: `${isPickup ? "Pickup " : ""}${previousDpId ? "reassigned" : "assigned"} manually to ${dp.name}`,
      },
    });

    await createNotification(tx, {
      userId: dp.id,
      parcelId: parcel.id,
      type: "ASSIGNED",
      title: isPickup ? "New Pickup Assigned" : "New Parcel Assigned",
      message: `${isPickup ? "PICKUP: " : ""}${parcel.trackingNumber} → ${parcel.customer.street.name}, ${
        parcel.customer.area.name
      } → ${slotText(parcel)}.`,
    });

    await createNotification(tx, {
      userId: parcel.customerId,
      parcelId: parcel.id,
      type: isPickup ? "PICKUP_UPDATE" : "ASSIGNED",
      title: isPickup
        ? previousDpId
          ? "Pickup Partner Changed"
          : "Pickup Partner Assigned"
        : previousDpId
        ? "Delivery Partner Changed"
        : "Delivery Partner Assigned",
      message: isPickup
        ? `${dp.name} will collect your return ${parcel.trackingNumber} on ${slotText(parcel)}.`
        : `${dp.name} will deliver your parcel ${parcel.trackingNumber} on ${slotText(parcel)}.`,
    });

    if (previousDpId) {
      await createNotification(tx, {
        userId: previousDpId,
        parcelId: parcel.id,
        type: "GENERAL",
        title: "Parcel Reassigned",
        message: `${parcel.trackingNumber} has been reassigned to another delivery partner.`,
      });
    }

    return { parcel, assignment, deliveryPerson: dp, reassigned: !!previousDpId, jobType: job.jobType };
  }, TX_OPTIONS);
};

const previewCandidates = async (parcelId) => {
  const parcel = await prisma.parcel.findUnique({ where: { id: parcelId }, select: parcelForAssignSelect });
  if (!parcel) throw httpError(404, "Parcel not found");
  if (!parcel.slotDate || parcel.slotHour == null) throw httpError(400, "Parcel has no booked slot yet");
  const evaluation = await evaluateCandidates(prisma, parcel);
  return { parcel, evaluation };
};

// Safe version for customers (no other delivery persons' details)
const toPublicResult = (r) => {
  if (r.assigned) {
    return {
      assigned: true,
      steps: AI_STEPS,
      summary: r.summary,
      deliveryPerson: { name: r.chosen.deliveryPerson.name },
    };
  }
  return {
    assigned: false,
    steps: ["Area & Time Slot Verified", "Conflict Check Completed"],
    message:
      r.jobType === "PICKUP" ? "A pickup partner will be assigned soon." : "A delivery partner will be assigned soon.",
  };
};

// Runs AI and returns the customer-safe result; never throws
const assignForCustomer = async (parcelId) => {
  try {
    return toPublicResult(await assignParcel(parcelId));
  } catch (err) {
    console.error("AI assignment failed:", err);
    return { assigned: false, steps: [], message: "A partner will be assigned soon." };
  }
};

const toAdminResult = (r) => ({
  assigned: r.assigned,
  skipped: !!r.skipped,
  jobType: r.jobType || null,
  reason: r.assigned ? r.chosen.reason : r.reason,
  steps: r.assigned
    ? AI_STEPS
    : ["Area & Time Slot Verified", "Conflict Check Completed", "No Suitable Delivery Person – Sent to Admin Queue"],
  summary: r.summary || null,
  deliveryPerson: r.assigned ? r.chosen.deliveryPerson : null,
  score: r.assigned ? r.chosen.score : null,
  breakdown: r.assigned ? r.chosen.breakdown : null,
  candidatesEvaluated: r.evaluation?.evaluated ?? 0,
  candidates: r.evaluation?.candidates ?? [],
  excluded: r.evaluation?.excluded ?? [],
});

module.exports = {
  WEIGHTS,
  LOAD_STATUSES,
  WAITING_STATUSES,
  evaluateCandidates,
  assignParcel,
  manualAssign,
  previewCandidates,
  toPublicResult,
  assignForCustomer,
  toAdminResult,
};