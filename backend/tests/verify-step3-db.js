/**
 * Step 3 database verification (no server needed)
 * Usage: node tests/verify-step3-db.js
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

// "2026-10-26" -> Date at UTC midnight (how we will store slot dates)
const toSlotDate = (dateStr) => new Date(`${dateStr}T00:00:00.000Z`);
const toDateStr = (date) => date.toISOString().slice(0, 10);

async function run() {
  let customer;
  const parcelIds = [];

  try {
    console.log("\nSetup");
    const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    const street = await prisma.street.findFirst();
    check("Admin and street exist", !!admin && !!street);

    customer = await prisma.user.create({
      data: {
        name: "Step3 Test Customer",
        email: `step3_${stamp}@test.com`,
        phone: "8" + String(stamp).slice(-9),
        password: await bcrypt.hash("test123", 10),
        role: "CUSTOMER",
        addressLine: "No 3",
        areaId: street.areaId,
        streetId: street.id,
      },
    });

    // Three parcels: two booked in the same slot, one in another slot
    for (let i = 1; i <= 3; i++) {
      const p = await prisma.parcel.create({
        data: {
          trackingNumber: `S3${stamp}${i}`,
          customerId: customer.id,
          registeredById: admin.id,
          status: "NOTIFIED",
        },
      });
      parcelIds.push(p.id);
    }

    console.log("\nDefaults (before booking)");
    const fresh = await prisma.parcel.findUnique({ where: { id: parcelIds[0] } });
    check("slotDate is null", fresh.slotDate === null);
    check("slotHour is null", fresh.slotHour === null);
    check("slotBookedAt is null", fresh.slotBookedAt === null);
    check("slotAutoBooked defaults to false", fresh.slotAutoBooked === false);
    check("rescheduleCount defaults to 0", fresh.rescheduleCount === 0);

    console.log("\nBooking a slot");
    const testDate = "2030-01-15"; // far-future date so real data never clashes

    const booked = await prisma.parcel.update({
      where: { id: parcelIds[0] },
      data: {
        slotDate: toSlotDate(testDate),
        slotHour: 10,
        slotBookedAt: new Date(),
        status: "SLOT_BOOKED",
      },
    });

    check("slotDate saved as the correct date (no timezone shift)", toDateStr(booked.slotDate) === testDate,
      `got ${toDateStr(booked.slotDate)}`);
    check("slotDate has no time part", booked.slotDate.toISOString().endsWith("T00:00:00.000Z"));
    check("slotHour saved", booked.slotHour === 10);
    check("slotBookedAt saved", booked.slotBookedAt instanceof Date);
    check("Status updated to SLOT_BOOKED", booked.status === "SLOT_BOOKED");

    await prisma.parcel.update({
      where: { id: parcelIds[1] },
      data: { slotDate: toSlotDate(testDate), slotHour: 10, slotBookedAt: new Date(), status: "SLOT_BOOKED" },
    });
    await prisma.parcel.update({
      where: { id: parcelIds[2] },
      data: {
        slotDate: toSlotDate(testDate),
        slotHour: 14,
        slotBookedAt: new Date(),
        slotAutoBooked: true,
        status: "SLOT_BOOKED",
      },
    });

    console.log("\nSlot queries (used for availability)");
    const inSlot10 = await prisma.parcel.count({
      where: { slotDate: toSlotDate(testDate), slotHour: 10 },
    });
    check("Count parcels in date + slot 10 = 2", inSlot10 === 2, `got ${inSlot10}`);

    const onDay = await prisma.parcel.count({ where: { slotDate: toSlotDate(testDate) } });
    check("Count parcels on that day = 3", onDay === 3, `got ${onDay}`);

    const grouped = await prisma.parcel.groupBy({
      by: ["slotHour"],
      where: { slotDate: toSlotDate(testDate) },
      _count: { _all: true },
      orderBy: { slotHour: "asc" },
    });
    check(
      "groupBy slotHour works (10 → 2, 14 → 1)",
      grouped.length === 2 &&
        grouped[0].slotHour === 10 && grouped[0]._count._all === 2 &&
        grouped[1].slotHour === 14 && grouped[1]._count._all === 1
    );

    const autoBooked = await prisma.parcel.count({
      where: { slotDate: toSlotDate(testDate), slotAutoBooked: true },
    });
    check("Filter auto-booked parcels = 1", autoBooked === 1);

    const otherDay = await prisma.parcel.count({ where: { slotDate: toSlotDate("2030-01-16") } });
    check("Different date has 0 parcels", otherDay === 0);

    console.log("\nReschedule fields");
    const rescheduled = await prisma.parcel.update({
      where: { id: parcelIds[0] },
      data: { slotHour: 15, rescheduleCount: { increment: 1 } },
    });
    check("rescheduleCount increments", rescheduled.rescheduleCount === 1);
    check("slotHour changed to 15", rescheduled.slotHour === 15);
  } catch (err) {
    failed++;
    console.log(`\n❌ Unexpected error: ${err.message}`);
  } finally {
    if (parcelIds.length) await prisma.parcel.deleteMany({ where: { id: { in: parcelIds } } }).catch(() => {});
    if (customer) await prisma.user.delete({ where: { id: customer.id } }).catch(() => {});
    await prisma.$disconnect();

    console.log("\n==============================");
    console.log(`Result: ${passed}/${passed + failed} passed, ${failed} failed`);
    console.log(failed === 0 ? "Step 3 database checks passed ✅" : "Some checks failed ❌");
    console.log("==============================\n");
    if (failed) process.exitCode = 1;
  }
}

run();