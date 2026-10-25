const { Prisma } = require("@prisma/client");
const prisma = require("../config/prisma");
const { createNotification } = require("./notificationService");
const { MAX_PARCELS_PER_DAY, toDateStr, slotLabel, formatDateLabel } = require("../utils/slotUtils");

// ---------------- AI scoring weights ----------------
const WEIGHTS = {
  SAME_STREET_SLOT: 50, // already delivering on the same street in the same slot
  SAME_AREA_SLOT: 30, // already delivering in the same area (other street) in the same slot
  HOME_AREA: 20, // delivery person's home area matches the parcel's area
  PER_FREE_SPOT: 5, // each free spot of daily capacity
};

// Parcels that count towards a delivery person's daily load
const LOAD_STATUSES = ["ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED"];

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
      `Already delivering ${c.sameStreetCount} parcel${c.sameStreetCount > 1 ? "s" : ""} on ${
        parcel.customer.street.name
      } in this slot`
    );
  } else if (c.sameAreaCount > 0) {
    parts.push(`Already delivering in ${parcel.customer.area.name} in this slot`);
  }
  if (c.breakdown.homeArea > 0) parts.push(`Home area is ${parcel.customer.area.name}`);
  parts.push(`${c.load}/${MAX_PARCELS_PER_DAY} parcels used that day`);
  return parts.join("; ");
};

/**
 * Scores every active delivery person for a parcel.
 * Returns candidates sorted best-first, plus the ones excluded (full).
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
    // Daily load per delivery person
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
    // Parcels already assigned in the same slot (for street/area clustering)
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

    // Hard rule: max parcels per day
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

  // Best score first; tie -> fewer parcels; tie -> lowest id
  candidates.sort(
    (a, b) => b.score - a.score || a.load - b.load || a.deliveryPerson.id - b.deliveryPerson.id
  );

  return { candidates, excluded, evaluated: deliveryPersons.length };
};

/**
 * AI auto-assignment for one parcel (conflict-free).
 * Locks the parcel row and all active delivery person rows, so two bookings
 * running at the same moment can never overfill a delivery person.
 */
const assignParcel = async (parcelId) => {
  return prisma.$transaction(async (tx) => {
    // 1. Lock the parcel
    await tx.$queryRaw`SELECT id FROM "Parcel" WHERE id = ${parcelId} FOR UPDATE`;

    const parcel = await tx.parcel.findUnique({ where: { id: parcelId }, select: parcelForAssignSelect });

    if (!parcel) return { assigned: false, skipped: true, reason: "Parcel not found" };
    if (parcel.status !== "SLOT_BOOKED" || parcel.assignedToId) {
      return { assigned: false, skipped: true, reason: "Parcel is not waiting for assignment" };
    }
    if (!parcel.slotDate || parcel.slotHour == null) {
      return { assigned: false, skipped: true, reason: "Parcel has no booked slot" };
    }

    // 2. Lock all active delivery persons (same order every time = no deadlocks)
    const active = await tx.user.findMany({
      where: { role: "DELIVERY", isActive: true },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    if (active.length) {
      const ids = active.map((a) => a.id);
      await tx.$queryRaw`SELECT id FROM "User" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
    }

    // 3. Evaluate with fresh data
    const evaluation = await evaluateCandidates(tx, parcel);
    const chosen = evaluation.candidates[0];

    // 4a. Nobody available -> unassigned queue + alert admins
    if (!chosen) {
      const reason =
        evaluation.evaluated === 0
          ? "No active delivery persons available"
          : "All delivery persons are at full capacity for this day";

      await tx.parcel.update({ where: { id: parcel.id }, data: { unassignedReason: reason } });

      const admins = await tx.user.findMany({
        where: { role: "ADMIN", isActive: true },
        select: { id: true },
      });
      if (admins.length) {
        await tx.notification.createMany({
          data: admins.map((a) => ({
            userId: a.id,
            parcelId: parcel.id,
            type: "UNASSIGNED_ALERT",
            title: "Parcel Needs Manual Assignment",
            message: `${parcel.trackingNumber} (${slotText(parcel)}) could not be assigned: ${reason}.`,
          })),
        });
      }

      return { assigned: false, skipped: false, reason, parcel, evaluation };
    }

    // 4b. Assign to the best candidate
    const dp = chosen.deliveryPerson;

    await tx.parcel.update({
      where: { id: parcel.id },
      data: { assignedToId: dp.id, assignedAt: new Date(), status: "ASSIGNED", unassignedReason: null },
    });

    const assignment = await tx.assignment.create({
      data: {
        parcelId: parcel.id,
        deliveryPersonId: dp.id,
        slotDate: parcel.slotDate,
        slotHour: parcel.slotHour,
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
        status: "ASSIGNED",
        note: `AI assigned to ${dp.name} (score ${chosen.score})`,
      },
    });

    await createNotification(tx, {
      userId: parcel.customerId,
      parcelId: parcel.id,
      type: "ASSIGNED",
      title: "Delivery Partner Assigned",
      message: `${dp.name} will deliver your parcel ${parcel.trackingNumber} on ${slotText(parcel)}.`,
    });

    await createNotification(tx, {
      userId: dp.id,
      parcelId: parcel.id,
      type: "ASSIGNED",
      title: "New Parcel Assigned",
      message: `${parcel.trackingNumber} → ${parcel.customer.street.name}, ${parcel.customer.area.name} → ${slotText(
        parcel
      )}.`,
    });

    return {
      assigned: true,
      skipped: false,
      parcel,
      assignment,
      chosen,
      evaluation,
      summary: `${parcel.trackingNumber} → ${parcel.customer.area.name} → ${slotLabel(parcel.slotHour)} → ${dp.name}`,
    };
  }, TX_OPTIONS);
};

/**
 * Manual assign / reassign by admin.
 */
const manualAssign = async ({ parcelId, deliveryPersonId, admin }) => {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Parcel" WHERE id = ${parcelId} FOR UPDATE`;

    const parcel = await tx.parcel.findUnique({ where: { id: parcelId }, select: parcelForAssignSelect });
    if (!parcel) throw httpError(404, "Parcel not found");

    if (!["SLOT_BOOKED", "ASSIGNED"].includes(parcel.status)) {
      throw httpError(409, "Only parcels with a booked slot (not yet out for delivery) can be assigned");
    }
    if (parcel.assignedToId === deliveryPersonId) {
      throw httpError(409, "Parcel is already assigned to this delivery person");
    }

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
      throw httpError(409, `${dp.name} already has ${MAX_PARCELS_PER_DAY} parcels on this day`);
    }

    const previousDpId = parcel.assignedToId;

    await tx.assignment.updateMany({
      where: { parcelId: parcel.id, status: "ACTIVE" },
      data: { status: "CANCELLED", endedAt: new Date() },
    });

    await tx.parcel.update({
      where: { id: parcel.id },
      data: { assignedToId: dp.id, assignedAt: new Date(), status: "ASSIGNED", unassignedReason: null },
    });

    const assignment = await tx.assignment.create({
      data: {
        parcelId: parcel.id,
        deliveryPersonId: dp.id,
        slotDate: parcel.slotDate,
        slotHour: parcel.slotHour,
        method: "MANUAL",
        reason: `${previousDpId ? "Reassigned" : "Assigned"} manually by ${admin.name}`,
        assignedById: admin.id,
      },
    });

    await tx.statusHistory.create({
      data: {
        parcelId: parcel.id,
        status: "ASSIGNED",
        changedById: admin.id,
        note: `${previousDpId ? "Reassigned" : "Assigned"} manually to ${dp.name}`,
      },
    });

    await createNotification(tx, {
      userId: dp.id,
      parcelId: parcel.id,
      type: "ASSIGNED",
      title: "New Parcel Assigned",
      message: `${parcel.trackingNumber} → ${parcel.customer.street.name}, ${parcel.customer.area.name} → ${slotText(
        parcel
      )}.`,
    });

    await createNotification(tx, {
      userId: parcel.customerId,
      parcelId: parcel.id,
      type: "ASSIGNED",
      title: previousDpId ? "Delivery Partner Changed" : "Delivery Partner Assigned",
      message: `${dp.name} will deliver your parcel ${parcel.trackingNumber} on ${slotText(parcel)}.`,
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

    return { parcel, assignment, deliveryPerson: dp, reassigned: !!previousDpId };
  }, TX_OPTIONS);
};

// Score preview without assigning (for the admin "Why this person?" view)
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
    message: "A delivery partner will be assigned soon.",
  };
};

// Full version for admins (scores of every candidate)
const toAdminResult = (r) => ({
  assigned: r.assigned,
  skipped: !!r.skipped,
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
  evaluateCandidates,
  assignParcel,
  manualAssign,
  previewCandidates,
  toPublicResult,
  toAdminResult,
};