/**
 * Returns feature - database verification (no server needed)
 * Usage: node tests/verify-returns-db.js
 */
require("dotenv").config();
const bcrypt = require("bcryptjs");
const prisma = require("../src/config/prisma");

let passed = 0;
let failed = 0;
const stamp = Date.now();
const DAY = 24 * 60 * 60 * 1000;

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
const D = "2030-05-01";

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
        name: "Returns Test Customer",
        email: `ret_${stamp}@test.com`,
        phone: "8" + String(stamp).slice(-9),
        password: await bcrypt.hash("test123", 10),
        role: "CUSTOMER",
        addressLine: "No 9",
        areaId: street.areaId,
        streetId: street.id,
      },
    });

    let n = 0;
    const makeParcel = async (data) => {
      const p = await prisma.parcel.create({
        data: { trackingNumber: `RT${stamp}${++n}`, customerId: customer.id, registeredById: admin.id, ...data },
      });
      parcelIds.push(p.id);
      return p;
    };

    // ---- Defaults ----
    console.log("\nDefaults on a normal parcel");
    const p0 = await makeParcel({ status: "NOTIFIED" });
    check("collectedAtCounter defaults to false", p0.collectedAtCounter === false);
    check("pickupFailedAttempts defaults to 0", p0.pickupFailedAttempts === 0);
    check("Return fields start empty",
      p0.collectionDeadline === null && p0.returnedAt === null && p0.returnReason === null &&
        p0.returnRequestedAt === null && p0.customerReturnReason === null && p0.returnCancelledAt === null);

    const oldAssignment = await prisma.assignment.create({
      data: { parcelId: p0.id, deliveryPersonId: dp1.id, slotDate: toSlotDate(D), slotHour: 10, reason: "test" },
    });
    check("Assignment jobType defaults to DELIVERY", oldAssignment.jobType === "DELIVERY");

    // ---- Return to sender: not collected ----
    console.log("\nReturn to sender - not collected after deadline");
    const pExpired = await makeParcel({
      status: "FAILED",
      failedAttempts: 3,
      collectionDeadline: new Date(Date.now() - DAY),
    });
    const pWaiting = await makeParcel({
      status: "FAILED",
      failedAttempts: 3,
      collectionDeadline: new Date(Date.now() + 3 * DAY),
    });

    const overdue = await prisma.parcel.findMany({
      where: { status: "FAILED", collectionDeadline: { lte: new Date() }, id: { in: parcelIds } },
      select: { id: true },
    });
    check("Overdue query finds the expired parcel only",
      overdue.length === 1 && overdue[0].id === pExpired.id);
    check("Parcel still inside its 7 days is not overdue", !overdue.some((o) => o.id === pWaiting.id));

    const rts = await prisma.parcel.update({
      where: { id: pExpired.id },
      data: { status: "RETURNED_TO_SENDER", returnedAt: new Date(), returnReason: "NOT_COLLECTED" },
    });
    check("RETURNED_TO_SENDER status + NOT_COLLECTED reason saved",
      rts.status === "RETURNED_TO_SENDER" && rts.returnReason === "NOT_COLLECTED" && rts.returnedAt instanceof Date);

    // ---- Collected at counter ----
    console.log("\nCollected at post office counter");
    const collected = await prisma.parcel.update({
      where: { id: pWaiting.id },
      data: { status: "DELIVERED", deliveredAt: new Date(), collectedAtCounter: true, receivedBy: "Collected at post office" },
    });
    check("Collected parcel = DELIVERED with collectedAtCounter true",
      collected.status === "DELIVERED" && collected.collectedAtCounter === true);

    // ---- Refused + admin decision ----
    console.log("\nOther return-to-sender reasons");
    const pRefused = await makeParcel({
      status: "RETURNED_TO_SENDER",
      returnedAt: new Date(),
      returnReason: "CUSTOMER_REFUSED",
      returnNote: "Customer said they did not order it",
    });
    check("CUSTOMER_REFUSED reason + note saved",
      pRefused.returnReason === "CUSTOMER_REFUSED" && pRefused.returnNote.includes("did not order"));
    const pAdmin = await makeParcel({ status: "RETURNED_TO_SENDER", returnedAt: new Date(), returnReason: "ADMIN_DECISION" });
    check("ADMIN_DECISION reason saved", pAdmin.returnReason === "ADMIN_DECISION");

    // ---- Customer return request flow ----
    console.log("\nCustomer return request + pickup");
    const pRet = await makeParcel({
      status: "DELIVERED",
      deliveredAt: new Date(Date.now() - 2 * DAY),
      slotDate: toSlotDate(D),
      slotHour: 10,
      assignedToId: dp1.id,
    });

    const requested = await prisma.parcel.update({
      where: { id: pRet.id },
      data: {
        status: "RETURN_REQUESTED",
        returnRequestedAt: new Date(),
        customerReturnReason: "DAMAGED",
        customerReturnNote: "Box was crushed",
        slotDate: toSlotDate("2030-05-03"),
        slotHour: 14,
        assignedToId: null,
      },
    });
    check("RETURN_REQUESTED with reason, note and pickup slot",
      requested.status === "RETURN_REQUESTED" && requested.customerReturnReason === "DAMAGED" &&
        requested.slotHour === 14 && requested.deliveredAt instanceof Date);

    const pickup = await prisma.assignment.create({
      data: {
        parcelId: pRet.id,
        deliveryPersonId: dp1.id,
        slotDate: toSlotDate("2030-05-03"),
        slotHour: 14,
        jobType: "PICKUP",
        score: 70,
        reason: "test pickup",
      },
    });
    check("PICKUP assignment saved", pickup.jobType === "PICKUP");

    for (const s of ["PICKUP_ASSIGNED", "OUT_FOR_PICKUP", "PICKUP_FAILED"]) {
      const u = await prisma.parcel.update({ where: { id: pRet.id }, data: { status: s } });
      check(`Status ${s} accepted`, u.status === s);
    }

    const failedPickup = await prisma.parcel.update({
      where: { id: pRet.id },
      data: { pickupFailedAttempts: { increment: 1 } },
    });
    check("pickupFailedAttempts increments", failedPickup.pickupFailedAttempts === 1);

    const done = await prisma.parcel.update({
      where: { id: pRet.id },
      data: { status: "RETURNED_TO_SENDER", returnedAt: new Date(), returnReason: "CUSTOMER_RETURN" },
    });
    check("Picked-up return ends as RETURNED_TO_SENDER (CUSTOMER_RETURN)",
      done.status === "RETURNED_TO_SENDER" && done.returnReason === "CUSTOMER_RETURN");

    const jobs = await prisma.assignment.groupBy({
      by: ["jobType"],
      where: { deliveryPersonId: dp1.id, slotDate: { in: [toSlotDate(D), toSlotDate("2030-05-03")] } },
      _count: { _all: true },
    });
    check("Assignments can be grouped by job type (DELIVERY + PICKUP)",
      jobs.some((j) => j.jobType === "DELIVERY") && jobs.some((j) => j.jobType === "PICKUP"));

    // ---- Cancel ----
    console.log("\nCancel return");
    const pCancel = await makeParcel({ status: "RETURN_REQUESTED", returnRequestedAt: new Date(), customerReturnReason: "NOT_NEEDED" });
    const cancelled = await prisma.parcel.update({
      where: { id: pCancel.id },
      data: { status: "DELIVERED", returnCancelledAt: new Date() },
    });
    check("Cancelled return goes back to DELIVERED and keeps returnRequestedAt (one request only)",
      cancelled.status === "DELIVERED" && cancelled.returnCancelledAt instanceof Date && cancelled.returnRequestedAt !== null);

    // ---- Enums ----
    console.log("\nEnum validation");
    for (const r of ["WRONG_ITEM", "OTHER"]) {
      const u = await prisma.parcel.update({ where: { id: pCancel.id }, data: { customerReturnReason: r } });
      check(`CustomerReturnReason ${r} accepted`, u.customerReturnReason === r);
    }
    let bad = null;
    try {
      await prisma.parcel.update({ where: { id: pCancel.id }, data: { returnReason: "LOST_IN_SPACE" } });
    } catch (e) {
      bad = e;
    }
    check("Invalid return reason rejected", !!bad);

    for (const t of ["RETURN_REQUESTED", "PICKUP_UPDATE", "RETURNED_TO_SENDER"]) {
      const nt = await prisma.notification.create({
        data: { userId: customer.id, parcelId: pCancel.id, type: t, title: "t", message: "m" },
      });
      check(`NotificationType ${t} accepted`, nt.type === t);
    }
  } catch (err) {
    failed++;
    console.log(`\n❌ Unexpected error: ${err.message}`);
  } finally {
    if (parcelIds.length) await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } }).catch(() => {});
    if (customer) await prisma.user.delete({ where: { id: customer.id } }).catch(() => {});
    await prisma.$disconnect();

    console.log("\n==============================");
    console.log(`Result: ${passed}/${passed + failed} passed, ${failed} failed`);
    console.log(failed === 0 ? "Returns database checks passed ✅" : "Some checks failed ❌");
    console.log("==============================\n");
    if (failed) process.exitCode = 1;
  }
}

run();