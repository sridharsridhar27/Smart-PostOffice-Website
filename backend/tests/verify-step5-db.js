/**
 * Step 5 database verification (no server needed)
 * Usage: node tests/verify-step5-db.js
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

const toSlotDate = (s) => new Date(`${s}T00:00:00.000Z`);
const D = "2030-04-01";

async function run() {
  let customer;
  const parcelIds = [];

  try {
    console.log("\nSetup");
    const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    const dp1 = await prisma.user.findUnique({ where: { email: "dp1@postoffice.com" } });
    const street = await prisma.street.findFirst();
    check("Admin, dp1 and a street exist", !!admin && !!dp1 && !!street);

    customer = await prisma.user.create({
      data: {
        name: "Step5 Test Customer",
        email: `step5_${stamp}@test.com`,
        phone: "8" + String(stamp).slice(-9),
        password: await bcrypt.hash("test123", 10),
        role: "CUSTOMER",
        addressLine: "No 5",
        areaId: street.areaId,
        streetId: street.id,
      },
    });

    const makeAssigned = async (suffix) => {
      const p = await prisma.parcel.create({
        data: {
          trackingNumber: `S5${stamp}${suffix}`,
          customerId: customer.id,
          registeredById: admin.id,
          status: "ASSIGNED",
          slotDate: toSlotDate(D),
          slotHour: 10,
          slotBookedAt: new Date(),
          assignedToId: dp1.id,
          assignedAt: new Date(),
        },
      });
      parcelIds.push(p.id);
      const a = await prisma.assignment.create({
        data: {
          parcelId: p.id,
          deliveryPersonId: dp1.id,
          slotDate: toSlotDate(D),
          slotHour: 10,
          score: 70,
          reason: "test",
        },
      });
      return { p, a };
    };

    // ---- Defaults ----
    console.log("\nDefaults");
    const { p: p1, a: a1 } = await makeAssigned("A");
    check("outForDeliveryAt null", p1.outForDeliveryAt === null);
    check("deliveredAt null", p1.deliveredAt === null);
    check("receivedBy null", p1.receivedBy === null);
    check("failedAttempts defaults to 0", p1.failedAttempts === 0);
    check("lastFailureReason null", p1.lastFailureReason === null);
    check("Assignment failureReason null", a1.failureReason === null);

    // ---- Successful delivery ----
    console.log("\nSuccessful delivery flow");
    const out = await prisma.parcel.update({
      where: { id: p1.id },
      data: { status: "OUT_FOR_DELIVERY", outForDeliveryAt: new Date() },
    });
    check("Out for delivery saved", out.status === "OUT_FOR_DELIVERY" && out.outForDeliveryAt instanceof Date);

    await prisma.$transaction([
      prisma.parcel.update({
        where: { id: p1.id },
        data: { status: "DELIVERED", deliveredAt: new Date(), receivedBy: "Self" },
      }),
      prisma.assignment.update({
        where: { id: a1.id },
        data: { status: "COMPLETED", endedAt: new Date() },
      }),
    ]);
    const delivered = await prisma.parcel.findUnique({ where: { id: p1.id }, include: { assignments: true } });
    check("Delivered with receivedBy", delivered.status === "DELIVERED" && delivered.receivedBy === "Self");
    check("Assignment COMPLETED", delivered.assignments[0].status === "COMPLETED");
    check("Delivered parcel keeps assignedToId (counts in load)", delivered.assignedToId === dp1.id);

    // ---- Failed delivery ----
    console.log("\nFailed delivery flow");
    const { p: p2, a: a2 } = await makeAssigned("B");
    await prisma.parcel.update({
      where: { id: p2.id },
      data: { status: "OUT_FOR_DELIVERY", outForDeliveryAt: new Date() },
    });

    await prisma.$transaction([
      prisma.assignment.update({
        where: { id: a2.id },
        data: {
          status: "FAILED",
          endedAt: new Date(),
          failureReason: "CUSTOMER_NOT_AVAILABLE",
          failureNote: "Door locked, no answer on phone",
        },
      }),
      prisma.parcel.update({
        where: { id: p2.id },
        data: {
          status: "FAILED",
          failedAttempts: { increment: 1 },
          lastFailedAt: new Date(),
          lastFailureReason: "CUSTOMER_NOT_AVAILABLE",
          lastFailureNote: "Door locked, no answer on phone",
          assignedToId: null,
          assignedAt: null,
          outForDeliveryAt: null,
          slotDate: null,
          slotHour: null,
        },
      }),
    ]);

    const failedP = await prisma.parcel.findUnique({ where: { id: p2.id }, include: { assignments: true } });
    check("Parcel FAILED", failedP.status === "FAILED");
    check("failedAttempts = 1", failedP.failedAttempts === 1);
    check("lastFailureReason enum saved", failedP.lastFailureReason === "CUSTOMER_NOT_AVAILABLE");
    check("lastFailureNote saved", failedP.lastFailureNote === "Door locked, no answer on phone");
    check("Delivery person released", failedP.assignedToId === null);
    check("Slot cleared for rebooking", failedP.slotDate === null && failedP.slotHour === null);
    check("Assignment FAILED with reason kept",
      failedP.assignments[0].status === "FAILED" && failedP.assignments[0].failureReason === "CUSTOMER_NOT_AVAILABLE");

    const dp1Load = await prisma.parcel.count({
      where: {
        assignedToId: dp1.id,
        slotDate: toSlotDate(D),
        status: { in: ["ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED"] },
      },
    });
    check("Failed parcel no longer counts in dp1's load (1 = delivered only)", dp1Load === 1, `got ${dp1Load}`);

    // ---- Attempts counter ----
    console.log("\nAttempt limit counter");
    await prisma.parcel.update({ where: { id: p2.id }, data: { failedAttempts: { increment: 2 } } });
    const atLimit = await prisma.parcel.count({ where: { id: p2.id, failedAttempts: { gte: 3 } } });
    check("failedAttempts reaches 3 (limit check query works)", atLimit === 1);

    // ---- Enum values ----
    console.log("\nEnum values");
    for (const reason of ["WRONG_ADDRESS", "CUSTOMER_REFUSED", "PREMISES_LOCKED", "OTHER"]) {
      const r = await prisma.parcel.update({ where: { id: p2.id }, data: { lastFailureReason: reason } });
      check(`FailureReason ${reason} accepted`, r.lastFailureReason === reason);
    }

    let badEnum = null;
    try {
      await prisma.parcel.update({ where: { id: p2.id }, data: { lastFailureReason: "DOG_BIT_ME" } });
    } catch (e) {
      badEnum = e;
    }
    check("Invalid failure reason rejected", !!badEnum);

    const n = await prisma.notification.create({
      data: { userId: customer.id, parcelId: p2.id, type: "RESCHEDULED", title: "t", message: "m" },
    });
    check("NotificationType RESCHEDULED accepted", n.type === "RESCHEDULED");
  } catch (err) {
    failed++;
    console.log(`\n❌ Unexpected error: ${err.message}`);
  } finally {
    if (parcelIds.length) await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } }).catch(() => {});
    if (customer) await prisma.user.delete({ where: { id: customer.id } }).catch(() => {});
    await prisma.$disconnect();

    console.log("\n==============================");
    console.log(`Result: ${passed}/${passed + failed} passed, ${failed} failed`);
    console.log(failed === 0 ? "Step 5 database checks passed ✅" : "Some checks failed ❌");
    console.log("==============================\n");
    if (failed) process.exitCode = 1;
  }
}

run();