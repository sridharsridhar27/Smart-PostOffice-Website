/**
 * Step 2 database verification (no server needed)
 * Usage: node tests/verify-step2-db.js
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

async function run() {
  let customer;
  let parcel;

  try {
    // ---- Setup ----
    console.log("\nSetup");
    const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    check("Admin exists", !!admin);

    const street = await prisma.street.findFirst({ include: { area: true } });
    check("A street exists", !!street);

    customer = await prisma.user.create({
      data: {
        name: "Step2 Test Customer",
        email: `step2_${stamp}@test.com`,
        phone: "8" + String(stamp).slice(-9),
        password: await bcrypt.hash("test123", 10),
        role: "CUSTOMER",
        addressLine: "No 1",
        areaId: street.areaId,
        streetId: street.id,
      },
    });
    check("Test customer created", !!customer.id);

    // ---- Parcel create (scan) ----
    console.log("\nParcel registration");
    const trackingNumber = `TEST${stamp}`;

    parcel = await prisma.parcel.create({
      data: {
        trackingNumber,
        customerId: customer.id,
        registeredById: admin.id,
        senderName: "Amazon",
        weight: 1.5,
        statusHistory: {
          create: { status: "REGISTERED", changedById: admin.id, note: "Parcel scanned" },
        },
      },
    });

    check("Parcel created", !!parcel.id);
    check("Default status is REGISTERED", parcel.status === "REGISTERED");
    check("Default parcelType is SMALL", parcel.parcelType === "SMALL");
    check("arrivedAt set automatically", parcel.arrivedAt instanceof Date);
    check("Weight stored as number", parcel.weight === 1.5);

    // ---- Duplicate tracking number ----
    let duplicateError = null;
    try {
      await prisma.parcel.create({
        data: { trackingNumber, customerId: customer.id, registeredById: admin.id },
      });
    } catch (err) {
      duplicateError = err;
    }
    check("Duplicate tracking number blocked (P2002)", duplicateError?.code === "P2002");

    // ---- Notify flow (transaction) ----
    console.log("\nNotification flow");
    await prisma.$transaction([
      prisma.parcel.update({ where: { id: parcel.id }, data: { status: "NOTIFIED" } }),
      prisma.statusHistory.create({
        data: { parcelId: parcel.id, status: "NOTIFIED", note: "Customer notified" },
      }),
      prisma.notification.create({
        data: {
          userId: customer.id,
          parcelId: parcel.id,
          type: "PARCEL_ARRIVED",
          title: "Parcel Arrived",
          message: `Your parcel ${trackingNumber} has arrived. Please book a delivery slot.`,
        },
      }),
    ]);

    const updated = await prisma.parcel.findUnique({
      where: { id: parcel.id },
      include: {
        customer: { select: { name: true, area: true, street: true } },
        registeredBy: { select: { role: true } },
        statusHistory: { orderBy: { createdAt: "asc" } },
        notifications: true,
      },
    });

    check("Status updated to NOTIFIED", updated.status === "NOTIFIED");
    check("Customer relation works (with area & street)", !!updated.customer.area && !!updated.customer.street);
    check("registeredBy is ADMIN", updated.registeredBy.role === "ADMIN");
    check(
      "Status history has 2 entries in order",
      updated.statusHistory.length === 2 &&
        updated.statusHistory[0].status === "REGISTERED" &&
        updated.statusHistory[1].status === "NOTIFIED"
    );
    check("System change has no changedBy (null)", updated.statusHistory[1].changedById === null);
    check("Parcel has 1 notification", updated.notifications.length === 1);

    const unreadCount = await prisma.notification.count({
      where: { userId: customer.id, isRead: false },
    });
    check("Customer unread notification count = 1", unreadCount === 1);

    await prisma.notification.updateMany({
      where: { userId: customer.id },
      data: { isRead: true },
    });
    const unreadAfter = await prisma.notification.count({
      where: { userId: customer.id, isRead: false },
    });
    check("Mark as read works (unread = 0)", unreadAfter === 0);

    const customerParcels = await prisma.user.findUnique({
      where: { id: customer.id },
      include: { parcels: true },
    });
    check("Customer -> parcels relation works", customerParcels.parcels.length === 1);

    // ---- Cascade delete ----
    console.log("\nCascade delete");
    await prisma.parcel.delete({ where: { id: parcel.id } });

    const historyLeft = await prisma.statusHistory.count({ where: { parcelId: parcel.id } });
    const notifLeft = await prisma.notification.count({ where: { parcelId: parcel.id } });
    check("Deleting parcel removes its status history", historyLeft === 0);
    check("Deleting parcel removes its notifications", notifLeft === 0);
    parcel = null;
  } catch (err) {
    failed++;
    console.log(`\n❌ Unexpected error: ${err.message}`);
  } finally {
    // ---- Cleanup ----
    if (parcel) await prisma.parcel.delete({ where: { id: parcel.id } }).catch(() => {});
    if (customer) await prisma.user.delete({ where: { id: customer.id } }).catch(() => {});
    await prisma.$disconnect();

    console.log("\n==============================");
    console.log(`Result: ${passed}/${passed + failed} passed, ${failed} failed`);
    console.log(failed === 0 ? "Step 2 database checks passed ✅" : "Some checks failed ❌");
    console.log("==============================\n");
    if (failed) process.exitCode = 1;
  }
}

run();