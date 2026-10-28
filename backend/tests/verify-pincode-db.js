/**
 * Area pincode - database verification (no server needed)
 * Usage: node tests/verify-pincode-db.js
 */
require("dotenv").config();
const prisma = require("../src/config/prisma");

let passed = 0;
let failed = 0;
const stamp = Date.now();
const createdAreaIds = [];

function check(name, condition, info = "") {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name} ${info}`);
  }
}

async function expectError(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

async function run() {
  try {
    console.log("\nSeeded areas");
    const expected = { "Area A": "635601", "Area B": "635602", "Area C": "635603" };
    const areas = await prisma.area.findMany({ where: { name: { in: Object.keys(expected) } } });
    check("Area A, B, C exist", areas.length === 3);
    for (const a of areas) {
      check(`${a.name} has pincode ${expected[a.name]}`, a.pincode === expected[a.name], `got ${a.pincode}`);
    }

    const all = await prisma.area.findMany();
    check("Every area has a 6-digit pincode", all.every((a) => /^[1-9][0-9]{5}$/.test(a.pincode)),
      JSON.stringify(all.map((a) => [a.name, a.pincode])));

    console.log("\nRules");
    const dup = await expectError(() =>
      prisma.area.create({ data: { name: `Dup Test ${stamp}`, pincode: "635601" } })
    );
    check("Duplicate pincode is rejected (unique)", dup?.code === "P2002", dup?.message);

    const missing = await expectError(() => prisma.area.create({ data: { name: `No Pin ${stamp}` } }));
    check("Area without pincode is rejected (required)", !!missing);

    const short = await expectError(() =>
      prisma.area.create({ data: { name: `Short Pin ${stamp}`, pincode: "12345" } })
    );
    check("5-digit pincode rejected by database rule", !!short);

    const zero = await expectError(() =>
      prisma.area.create({ data: { name: `Zero Pin ${stamp}`, pincode: "063560" } })
    );
    check("Pincode starting with 0 rejected", !!zero);

    const letters = await expectError(() =>
      prisma.area.create({ data: { name: `Letter Pin ${stamp}`, pincode: "63A601" } })
    );
    check("Pincode with letters rejected", !!letters);

    const good = await prisma.area.create({ data: { name: `Good Pin ${stamp}`, pincode: "699999" } });
    createdAreaIds.push(good.id);
    check("Valid new pincode accepted", good.pincode === "699999");

    console.log("\nRelations");
    const street = await prisma.street.findFirst({
      where: { area: { name: "Area A" } },
      include: { area: { select: { name: true, pincode: true } } },
    });
    check("Street → area → pincode works", street?.area?.pincode === "635601");

    const byPin = await prisma.area.findUnique({ where: { pincode: "635602" } });
    check("Find area by pincode works", byPin?.name === "Area B");

    const parcelsByPin = await prisma.parcel.count({ where: { customer: { area: { pincode: "635601" } } } });
    check("Parcel search by customer pincode query works", typeof parcelsByPin === "number");
  } catch (err) {
    failed++;
    console.log(`\n❌ Unexpected error: ${err.message}`);
  } finally {
    if (createdAreaIds.length) await prisma.area.deleteMany({ where: { id: { in: createdAreaIds } } }).catch(() => {});
    await prisma.$disconnect();

    console.log("\n==============================");
    console.log(`Result: ${passed}/${passed + failed} passed, ${failed} failed`);
    console.log(failed === 0 ? "Pincode database checks passed ✅" : "Some checks failed ❌");
    console.log("==============================\n");
    if (failed) process.exitCode = 1;
  }
}

run();