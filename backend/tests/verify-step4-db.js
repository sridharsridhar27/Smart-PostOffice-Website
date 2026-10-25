/**
 * Step 4 database verification (no server needed)
 * Usage: node tests/verify-step4-db.js
 */
require("dotenv").config();
const bcrypt = require("bcryptjs");
const prisma = require("../src/config/prisma");

let passed = 0;
let failed = 0;
const stamp = Date.now();

function check(name, condition, info = "") {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name} ${info}`);
  }
}

const toSlotDate = (dateStr) => new Date(`${dateStr}T00:00:00.000Z`);
const TEST_DATE = "2030-02-10"; // far-future date so real data never clashes

async function run() {
  let customer;
  const parcelIds = [];

  try {
    // ---- Setup ----
    console.log("\nSetup");
    const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    const dp1 = await prisma.user.findUnique({ where: { email: "dp1@postoffice.com" } });
    const dp2 = await prisma.user.findUnique({ where: { email: "dp2@postoffice.com" } });
    const street = await prisma.street.findFirst();
    check("Admin, dp1, dp2 and a street exist", !!admin && !!dp1 && !!dp2 && !!street);

    customer = await prisma.user.create({
      data: {
        name: "Step4 Test Customer",
        email: `step4_${stamp}@test.com`,
        phone: "8" + String(stamp).slice(-9),
        password: await bcrypt.hash("test123", 10),
        role: "CUSTOMER",
        addressLine: "No 4",
        areaId: street.areaId,
        streetId: street.id,
      },
    });

    for (let i = 1; i <= 3; i++) {
      const p = await prisma.parcel.create({
        data: {
          trackingNumber: `S4${stamp}${i}`,
          customerId: customer.id,
          registeredById: admin.id,
          status: "SLOT_BOOKED",
          slotDate: toSlotDate(TEST_DATE),
          slotHour: 10,
          slotBookedAt: new Date(),
        },
      });
      parcelIds.push(p.id);
    }
    const [p1Id, p2Id, p3Id] = parcelIds;

    // ---- Defaults ----
    console.log("\nDefaults");
    const fresh = await prisma.parcel.findUnique({ where: { id: p1Id } });
    check("assignedToId is null", fresh.assignedToId === null);
    check("assignedAt is null", fresh.assignedAt === null);
    check("unassignedReason is null", fresh.unassignedReason === null);

    // ---- AI assignment ----
    console.log("\nAI assignment (parcel 1 -> dp1)");
    const breakdown = { sameStreetSlot: 50, sameAreaSlot: 0, homeArea: 20, capacity: 25 };

    await prisma.$transaction([
      prisma.parcel.update({
        where: { id: p1Id },
        data: { assignedToId: dp1.id, assignedAt: new Date(), status: "ASSIGNED" },
      }),
      prisma.assignment.create({
        data: {
          parcelId: p1Id,
          deliveryPersonId: dp1.id,
          slotDate: toSlotDate(TEST_DATE),
          slotHour: 10,
          score: 95,
          scoreBreakdown: breakdown,
          reason: "Same street in slot, home area match, 5/6 capacity free",
          candidatesEvaluated: 4,
        },
      }),
    ]);

    const a1 = await prisma.assignment.findFirst({
      where: { parcelId: p1Id },
      include: { deliveryPerson: true, parcel: true },
    });
    check("Assignment row created", !!a1);
    check("Default method is AI_AUTO", a1.method === "AI_AUTO");
    check("Default status is ACTIVE", a1.status === "ACTIVE");
    check("Score saved", a1.score === 95);
    check("scoreBreakdown JSON saved and read back",
      a1.scoreBreakdown?.sameStreetSlot === 50 && a1.scoreBreakdown?.capacity === 25);
    check("candidatesEvaluated saved", a1.candidatesEvaluated === 4);
    check("assignedById null for AI", a1.assignedById === null);
    check("endedAt null while active", a1.endedAt === null);
    check("slotDate copied correctly", a1.slotDate.toISOString().slice(0, 10) === TEST_DATE);
    check("deliveryPerson relation works", a1.deliveryPerson.role === "DELIVERY");
    check("Parcel now ASSIGNED to dp1", a1.parcel.assignedToId === dp1.id && a1.parcel.status === "ASSIGNED");

    // ---- Capacity query (used by AI) ----
    console.log("\nCapacity queries");
    await prisma.parcel.update({
      where: { id: p2Id },
      data: { assignedToId: dp1.id, assignedAt: new Date(), status: "ASSIGNED" },
    });

    const dp1Load = await prisma.parcel.count({
      where: {
        assignedToId: dp1.id,
        slotDate: toSlotDate(TEST_DATE),
        status: { in: ["ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED"] },
      },
    });
    check("dp1 load on test date = 2", dp1Load === 2, `got ${dp1Load}`);

    const loads = await prisma.parcel.groupBy({
      by: ["assignedToId"],
      where: { slotDate: toSlotDate(TEST_DATE), assignedToId: { not: null } },
      _count: { _all: true },
    });
    check("groupBy load per delivery person works",
      loads.length === 1 && loads[0].assignedToId === dp1.id && loads[0]._count._all === 2);

    const sameStreetInSlot = await prisma.parcel.findMany({
      where: {
        slotDate: toSlotDate(TEST_DATE),
        slotHour: 10,
        assignedToId: { not: null },
        customer: { streetId: street.id },
      },
      select: { assignedToId: true },
    });
    check("Same street + same slot lookup finds dp1's parcels",
      sameStreetInSlot.length === 2 && sameStreetInSlot.every((p) => p.assignedToId === dp1.id));

    const dp1WithParcels = await prisma.user.findUnique({
      where: { id: dp1.id },
      include: { assignedParcels: { where: { slotDate: toSlotDate(TEST_DATE) } } },
    });
    check("User -> assignedParcels relation works", dp1WithParcels.assignedParcels.length === 2);

    // ---- Reassignment (manual) ----
    console.log("\nManual reassignment (parcel 1 -> dp2)");
    await prisma.$transaction([
      prisma.assignment.updateMany({
        where: { parcelId: p1Id, status: "ACTIVE" },
        data: { status: "CANCELLED", endedAt: new Date() },
      }),
      prisma.parcel.update({
        where: { id: p1Id },
        data: { assignedToId: dp2.id, assignedAt: new Date() },
      }),
      prisma.assignment.create({
        data: {
          parcelId: p1Id,
          deliveryPersonId: dp2.id,
          slotDate: toSlotDate(TEST_DATE),
          slotHour: 10,
          method: "MANUAL",
          reason: "Manually reassigned by admin",
          assignedById: admin.id,
        },
      }),
    ]);

    const history = await prisma.assignment.findMany({
      where: { parcelId: p1Id },
      orderBy: { createdAt: "asc" },
      include: { assignedBy: true },
    });
    check("Parcel has 2 assignment records", history.length === 2);
    check("Old assignment CANCELLED with endedAt",
      history[0].status === "CANCELLED" && history[0].endedAt instanceof Date);
    check("New assignment ACTIVE + MANUAL", history[1].status === "ACTIVE" && history[1].method === "MANUAL");
    check("Manual assignment has null score", history[1].score === null);
    check("assignedBy relation is the admin", history[1].assignedBy?.role === "ADMIN");

    const activeCount = await prisma.assignment.count({ where: { parcelId: p1Id, status: "ACTIVE" } });
    check("Exactly one ACTIVE assignment for the parcel", activeCount === 1);

    const reloaded = await prisma.parcel.findUnique({ where: { id: p1Id } });
    check("Parcel assignedToId now dp2 (single owner)", reloaded.assignedToId === dp2.id);

    // ---- Unassigned queue ----
    console.log("\nUnassigned queue");
    await prisma.parcel.update({
      where: { id: p3Id },
      data: { unassignedReason: "All delivery persons are at full capacity" },
    });
    const queue = await prisma.parcel.findMany({
      where: { status: "SLOT_BOOKED", assignedToId: null, unassignedReason: { not: null }, id: { in: parcelIds } },
    });
    check("Unassigned queue query finds parcel 3", queue.length === 1 && queue[0].id === p3Id);

    // ---- Cascade ----
    console.log("\nCascade delete");
    await prisma.parcel.delete({ where: { id: p1Id } });
    const left = await prisma.assignment.count({ where: { parcelId: p1Id } });
    check("Deleting parcel removes its assignment records", left === 0);
  } catch (err) {
    failed++;
    console.log(`\n❌ Unexpected error: ${err.message}`);
  } finally {
    await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } }).catch(() => {});
    if (customer) await prisma.user.delete({ where: { id: customer.id } }).catch(() => {});
    await prisma.$disconnect();

    console.log("\n==============================");
    console.log(`Result: ${passed}/${passed + failed} passed, ${failed} failed`);
    console.log(failed === 0 ? "Step 4 database checks passed ✅" : "Some checks failed ❌");
    console.log("==============================\n");
    if (failed) process.exitCode = 1;
  }
}

run();