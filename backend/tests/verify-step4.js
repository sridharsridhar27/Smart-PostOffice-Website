/**
 * Step 4 verification: AI assignment engine
 *
 * Part A - AI scenarios (calls the engine directly, exact expected scores):
 *   tie-break, same street, same area, load balancing, home area,
 *   6-per-day limit, no capacity -> unassigned queue, idempotency,
 *   concurrency (3 parcels at once, 1 spot left), manual assign limits.
 *
 * Part B - API checks (server must be running):
 *   book slot -> auto assigned, notifications, admin detail, AI preview,
 *   workload, manual reassign, unassigned queue, validation, roles.
 *
 * Uses seeded dp1 (Area A), dp2 (Area A), dp3 (Area B), dp4 (Area C).
 * Any other delivery persons are set inactive during the test and restored after.
 *
 * Usage:
 *   node tests/verify-step4.js
 *   node tests/verify-step4.js --keep   (keep test data)
 */

require("dotenv").config();
const bcrypt = require("bcryptjs");
const prisma = require("../src/config/prisma");
const { assignParcel, manualAssign } = require("../src/services/assignmentService");

const BASE_URL = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const KEEP_DATA = process.argv.includes("--keep");
const ADMIN = { email: "admin@postoffice.com", password: "admin123" };
const DP_PASSWORD = "dp1234";

let passed = 0;
let failed = 0;
const failures = [];
const createdEmails = [];
const stamp = Date.now();

// Delivery persons whose isActive we changed -> restored in cleanup
const toRestore = new Set();

const D = "2030-03-01"; // far-future date for Part A
const toSlotDate = (s) => new Date(`${s}T00:00:00.000Z`);

function check(name, condition, info = "") {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ❌ ${name}${info ? `\n     ${info}` : ""}`);
  }
}

const section = (t) => console.log(`\n${t}`);

async function setActive(ids, isActive) {
  ids.forEach((id) => toRestore.add(id));
  await prisma.user.updateMany({ where: { id: { in: ids } }, data: { isActive } });
}

// ======================================================================
// PART A - AI scenarios
// ======================================================================

async function partA(ctx) {
  const { dp1, dp2, dp3, dp4, admin } = ctx;

  section("A0. Setup");
  const areas = await prisma.area.findMany({
    where: { name: { in: ["Area A", "Area B", "Area C"] } },
    include: { streets: { orderBy: { id: "asc" } } },
  });
  const A = areas.find((a) => a.name === "Area A");
  const B = areas.find((a) => a.name === "Area B");
  const C = areas.find((a) => a.name === "Area C");
  check("Seeded Area A (2+ streets), B, C exist", A?.streets.length >= 2 && B?.streets.length && C?.streets.length);
  check("dp1 id < dp2 id (needed for tie-break check)", dp1.id < dp2.id);

  const pw = await bcrypt.hash("test123", 10);
  const makeCustomer = async (label, area, street) => {
    const email = `s4a_${label}_${stamp}@test.com`;
    createdEmails.push(email);
    return prisma.user.create({
      data: {
        name: `S4 ${label}`,
        email,
        phone: "7" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0"),
        password: pw,
        role: "CUSTOMER",
        addressLine: "No 1",
        areaId: area.id,
        streetId: street.id,
      },
    });
  };

  const cA1 = await makeCustomer("a1", A, A.streets[0]);
  const cA2 = await makeCustomer("a2", A, A.streets[0]); // same street as cA1
  const cA3 = await makeCustomer("a3", A, A.streets[1]); // same area, other street
  const cB = await makeCustomer("b", B, B.streets[0]);
  const cC = await makeCustomer("c", C, C.streets[0]);

  let n = 0;
  const makeParcel = (customer, hour) =>
    prisma.parcel.create({
      data: {
        trackingNumber: `S4A${stamp}${++n}`,
        customerId: customer.id,
        registeredById: admin.id,
        status: "SLOT_BOOKED",
        slotDate: toSlotDate(D),
        slotHour: hour,
        slotBookedAt: new Date(),
      },
    });

  const expectAssign = async (label, parcel, expectedDp, extra) => {
    const r = await assignParcel(parcel.id);
    const gotId = r.chosen?.deliveryPerson.id;
    let ok = r.assigned && gotId === expectedDp.id;
    let info = ok ? "" : `expected ${expectedDp.name}, got ${r.chosen?.deliveryPerson.name || "none"} (${r.reason || ""})`;
    if (ok && extra) {
      const e = extra(r);
      if (e !== true) {
        ok = false;
        info = e;
      }
    }
    check(label, ok, info);
    return r;
  };

  // S1 - tie-break
  section("A1. Tie-break (dp1 and dp2 both home Area A, empty)");
  const p1 = await makeParcel(cA1, 10);
  await expectAssign("Area A street-1, 10AM -> dp1 (score 50, lower id wins tie)", p1, dp1, (r) => {
    const b = r.chosen.breakdown;
    if (r.chosen.score !== 50) return `score ${r.chosen.score}, expected 50`;
    if (b.homeArea !== 20 || b.capacity !== 30 || b.sameStreetSlot !== 0) return `breakdown ${JSON.stringify(b)}`;
    if (r.evaluation.candidates[1].score !== 50) return "dp2 should also have scored 50 (tie)";
    if (r.evaluation.evaluated !== 4) return `evaluated ${r.evaluation.evaluated}, expected 4`;
    return true;
  });

  // S2 - same street
  section("A2. Same street + same slot clustering");
  const p2 = await makeParcel(cA2, 10);
  await expectAssign("Same street, 10AM -> dp1 (50 street + 20 home + 25 cap = 95)", p2, dp1, (r) =>
    (r.chosen.score === 95 && r.chosen.breakdown.sameStreetSlot === 50) || `score ${r.chosen.score}`
  );

  // S3 - same area other street
  section("A3. Same area, different street");
  const p3 = await makeParcel(cA3, 10);
  await expectAssign("Area A street-2, 10AM -> dp1 (30 area + 20 home + 20 cap = 70)", p3, dp1, (r) =>
    (r.chosen.score === 70 && r.chosen.breakdown.sameAreaSlot === 30 && r.chosen.breakdown.sameStreetSlot === 0) ||
    `score ${r.chosen.score}, breakdown ${JSON.stringify(r.chosen.breakdown)}`
  );

  // S4 - load balancing in a different slot
  section("A4. Load balancing (different slot)");
  const p4 = await makeParcel(cA1, 14);
  await expectAssign("Area A, 2PM -> dp2 (dp1 has 3 already: 35 vs dp2: 50)", p4, dp2, (r) => {
    const dp1c = r.evaluation.candidates.find((c) => c.deliveryPerson.id === dp1.id);
    return (r.chosen.score === 50 && dp1c?.score === 35) || `dp2 ${r.chosen.score}, dp1 ${dp1c?.score}`;
  });

  // S5/S6 - home area
  section("A5. Home area");
  const p5 = await makeParcel(cB, 10);
  await expectAssign("Area B, 10AM -> dp3 (home Area B)", p5, dp3, (r) => r.chosen.breakdown.homeArea === 20 || "no home bonus");
  const p6 = await makeParcel(cC, 10);
  await expectAssign("Area C, 10AM -> dp4 (home Area C)", p6, dp4);

  // S7 - fill dp1 to 6
  section("A6. 6 parcels per day limit");
  for (let i = 0; i < 3; i++) {
    const p = await makeParcel(cA1, 10);
    await expectAssign(`Same street, 10AM -> dp1 (parcel ${4 + i} of 6)`, p, dp1);
  }
  const dp1Load = await prisma.parcel.count({
    where: { assignedToId: dp1.id, slotDate: toSlotDate(D), status: "ASSIGNED" },
  });
  check("dp1 now has exactly 6 parcels", dp1Load === 6, `got ${dp1Load}`);

  const p10 = await makeParcel(cA1, 10);
  await expectAssign("7th same-street parcel -> dp1 excluded (full), goes to dp2", p10, dp2, (r) => {
    const ex = r.evaluation.excluded.find((e) => e.deliveryPerson.id === dp1.id);
    if (!ex) return "dp1 not in excluded list";
    if (!ex.reason.includes("Full")) return `exclude reason: ${ex.reason}`;
    if (r.evaluation.candidates.some((c) => c.deliveryPerson.id === dp1.id)) return "dp1 still in candidates";
    return true;
  });

  // S9 - idempotent
  section("A7. Idempotency (assign same parcel twice)");
  const again = await assignParcel(p1.id);
  check("Second run is skipped", again.skipped === true && again.assigned === false);
  const activeForP1 = await prisma.assignment.count({ where: { parcelId: p1.id, status: "ACTIVE" } });
  const p1Reload = await prisma.parcel.findUnique({ where: { id: p1.id } });
  check("Still exactly 1 ACTIVE assignment, still dp1", activeForP1 === 1 && p1Reload.assignedToId === dp1.id);

  // S10 - no delivery persons -> unassigned queue
  section("A8. No delivery persons -> unassigned queue");
  const allFour = [dp1.id, dp2.id, dp3.id, dp4.id];
  await setActive(allFour, false);
  const p11 = await makeParcel(cB, 12);
  const r11 = await assignParcel(p11.id);
  check("Not assigned", r11.assigned === false && !r11.skipped, r11.reason);
  const p11db = await prisma.parcel.findUnique({ where: { id: p11.id } });
  check("Parcel stays SLOT_BOOKED, unassignedReason set",
    p11db.status === "SLOT_BOOKED" && p11db.assignedToId === null && !!p11db.unassignedReason);
  const alert = await prisma.notification.count({
    where: { parcelId: p11.id, type: "UNASSIGNED_ALERT", user: { role: "ADMIN" } },
  });
  check("Admin got UNASSIGNED_ALERT notification", alert >= 1);

  await setActive(allFour, true);
  const r11b = await assignParcel(p11.id);
  const p11after = await prisma.parcel.findUnique({ where: { id: p11.id } });
  check("After restoring, re-run assigns it and clears unassignedReason",
    r11b.assigned && p11after.assignedToId !== null && p11after.unassignedReason === null);

  // S11 - concurrency
  section("A9. Concurrency (only dp4 active, 1 spot left, 3 parcels at once)");
  await setActive([dp1.id, dp2.id, dp3.id], false);

  const dp4LoadNow = () =>
    prisma.parcel.count({ where: { assignedToId: dp4.id, slotDate: toSlotDate(D), status: "ASSIGNED" } });

  while ((await dp4LoadNow()) < 5) {
    const p = await makeParcel(cC, 11);
    await assignParcel(p.id);
  }
  check("dp4 filled to 5/6", (await dp4LoadNow()) === 5);

  const race = await Promise.all([makeParcel(cC, 15), makeParcel(cC, 15), makeParcel(cC, 15)]);
  const results = await Promise.all(race.map((p) => assignParcel(p.id)));
  const assignedCount = results.filter((r) => r.assigned).length;
  check("Exactly 1 of 3 simultaneous parcels assigned", assignedCount === 1, `assigned ${assignedCount}`);
  check("dp4 ends at exactly 6 (never 7+)", (await dp4LoadNow()) === 6);

  const queued = results.filter((r) => !r.assigned && !r.skipped).length;
  check("Other 2 went to unassigned queue", queued === 2);

  const dp4Active = await prisma.assignment.count({
    where: { deliveryPersonId: dp4.id, slotDate: toSlotDate(D), status: "ACTIVE" },
  });
  check("Assignment table: dp4 has 6 ACTIVE rows", dp4Active === 6, `got ${dp4Active}`);

  // S12 - manual assign limits
  section("A10. Manual assign (service level)");
  const leftover = race.find((p, i) => !results[i].assigned);

  let fullErr = null;
  try {
    await manualAssign({ parcelId: leftover.id, deliveryPersonId: dp4.id, admin });
  } catch (e) {
    fullErr = e;
  }
  check("Manual assign to full dp4 -> 409", fullErr?.statusCode === 409, fullErr?.message);

  let inactiveErr = null;
  try {
    await manualAssign({ parcelId: leftover.id, deliveryPersonId: dp3.id, admin });
  } catch (e) {
    inactiveErr = e;
  }
  check("Manual assign to inactive dp3 -> 400", inactiveErr?.statusCode === 400, inactiveErr?.message);

  await setActive([dp1.id, dp2.id, dp3.id], true);
  const manual = await manualAssign({ parcelId: leftover.id, deliveryPersonId: dp3.id, admin });
  const manualRow = await prisma.assignment.findFirst({ where: { parcelId: leftover.id, status: "ACTIVE" } });
  check("Manual assign to dp3 works (MANUAL, no score, assignedBy admin)",
    manual.deliveryPerson.id === dp3.id && manualRow.method === "MANUAL" && manualRow.score === null &&
      manualRow.assignedById === admin.id);
}

// ======================================================================
// PART B - API checks
// ======================================================================

async function request(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE_URL + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

async function test(name, method, path, { body, token, expect, verify } = {}) {
  let res;
  try {
    res = await request(method, path, body, token);
  } catch (err) {
    check(name, false, `Request failed: ${err.message}`);
    return { status: 0, data: null };
  }
  let ok = res.status === expect;
  let info = ok ? "" : `expected ${expect}, got ${res.status} - ${JSON.stringify(res.data)}`;
  if (ok && verify) {
    let v;
    try {
      v = verify(res.data);
    } catch (e) {
      v = `verify crashed: ${e.message}`;
    }
    if (v !== true) {
      ok = false;
      info = `${v} - ${JSON.stringify(res.data).slice(0, 400)}`;
    }
  }
  check(name, ok, info);
  return res;
}

const getISTToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());
const addDays = (s, n) => {
  const d = new Date(`${s}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function partB(ctx) {
  const { dp1, dp2, dp3, dp4 } = ctx;
  const dpById = { [dp1.id]: dp1, [dp2.id]: dp2, [dp3.id]: dp3, [dp4.id]: dp4 };

  try {
    await fetch(`${BASE_URL}/api/health`);
  } catch {
    check("Server running for Part B", false, "Start it with: npm run dev");
    return;
  }

  const tomorrow = addDays(getISTToday(), 1);

  section("B0. Setup");
  const adminToken = (await request("POST", "/api/auth/login", ADMIN)).data?.token;
  const areas = (await request("GET", "/api/areas")).data?.areas;
  const A = areas.find((a) => a.name === "Area A");

  const cust = {
    name: "S4 API Customer",
    email: `s4b_${stamp}@test.com`,
    phone: "9" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0"),
    password: "cust123",
    addressLine: "No 5",
    areaId: A.id,
    streetId: A.streets[0].id,
  };
  createdEmails.push(cust.email);
  const reg = await request("POST", "/api/auth/register", cust);
  const custToken = reg.data?.token;

  const parcelRes = await request("POST", "/api/admin/parcels", { trackingNumber: `S4B${stamp}1`, phone: cust.phone }, adminToken);
  const parcel2Res = await request("POST", "/api/admin/parcels", { trackingNumber: `S4B${stamp}2`, phone: cust.phone }, adminToken);
  const pId = parcelRes.data?.parcel?.id;
  const p2Id = parcel2Res.data?.parcel?.id;
  check("Admin token, customer, 2 parcels ready", !!adminToken && !!custToken && !!pId && !!p2Id);
  if (!pId) return;

  // ---- auto assignment on booking ----
  section("B1. Booking a slot triggers AI assignment");
  await test("Book tomorrow 11AM -> parcel ASSIGNED in same response", "POST", `/api/customer/parcels/${pId}/book-slot`, {
    body: { date: tomorrow, hour: 11 },
    token: custToken,
    expect: 201,
    verify: (d) => {
      if (d.parcel?.status !== "ASSIGNED") return `status ${d.parcel?.status}`;
      if (!d.assignment?.assigned) return "assignment.assigned false";
      if (!d.steps.includes("Delivery Slot Booked Successfully")) return "booking step missing";
      if (!d.steps.includes("AI Assigned Suitable Delivery Person")) return "AI step missing";
      if (!d.assignment.summary?.includes(`S4B${stamp}1`)) return "summary missing tracking no";
      if (!d.parcel.assignedTo?.name) return "assignedTo missing on parcel";
      if (d.assignment.candidates) return "customer must NOT see candidate scores";
      return true;
    },
  });

  const pDb = await prisma.parcel.findUnique({ where: { id: pId } });
  const firstDp = dpById[pDb.assignedToId];
  check("Assigned to one of the seeded delivery persons", !!firstDp);
  if (!firstDp) return;

  await test("Customer parcel detail shows delivery partner + ASSIGNED in history", "GET", `/api/customer/parcels/${pId}`, {
    token: custToken,
    expect: 200,
    verify: (d) => {
      if (d.parcel.assignedTo?.name !== firstDp.name) return "assignedTo wrong";
      const last = d.parcel.statusHistory[d.parcel.statusHistory.length - 1];
      return last.status === "ASSIGNED" || `last history ${last.status}`;
    },
  });

  await test("Customer got 'Delivery Partner Assigned' notification", "GET", "/api/notifications", {
    token: custToken,
    expect: 200,
    verify: (d) => d.notifications.some((n) => n.type === "ASSIGNED" && n.parcel?.id === pId) || "missing",
  });

  const dpToken = (await request("POST", "/api/auth/login", { email: firstDp.email, password: DP_PASSWORD })).data?.token;
  await test("Delivery person got 'New Parcel Assigned' notification", "GET", "/api/notifications", {
    token: dpToken,
    expect: 200,
    verify: (d) =>
      d.notifications.some((n) => n.title === "New Parcel Assigned" && n.parcel?.id === pId) || "missing",
  });

  // ---- admin views ----
  section("B2. Admin views");
  await test("Admin parcel detail: assignedTo + 1 AI assignment with score", "GET", `/api/admin/parcels/${pId}`, {
    token: adminToken,
    expect: 200,
    verify: (d) => {
      const a = d.parcel.assignments;
      if (d.parcel.assignedTo?.id !== firstDp.id) return "assignedTo wrong";
      if (a.length !== 1) return `assignments ${a.length}`;
      if (a[0].method !== "AI_AUTO" || typeof a[0].score !== "number") return "method/score wrong";
      if (!a[0].scoreBreakdown || !a[0].reason) return "breakdown/reason missing";
      return true;
    },
  });

  await test("AI preview lists scored candidates, best first", "GET", `/api/admin/parcels/${pId}/ai-preview`, {
    token: adminToken,
    expect: 200,
    verify: (d) => {
      if (!d.candidates.length) return "no candidates";
      for (let i = 1; i < d.candidates.length; i++) {
        if (d.candidates[i].score > d.candidates[i - 1].score) return "not sorted";
      }
      return d.candidates.every((c) => c.breakdown && c.reason) || "breakdown/reason missing";
    },
  });

  await test("AI preview for parcel without slot -> 400", "GET", `/api/admin/parcels/${p2Id}/ai-preview`, {
    token: adminToken,
    expect: 400,
  });

  await test("AI preview as customer -> 403", "GET", `/api/admin/parcels/${pId}/ai-preview`, {
    token: custToken,
    expect: 403,
  });

  await test("Workload for tomorrow shows the parcel under the delivery person", "GET",
    `/api/admin/assignments/workload?date=${tomorrow}`, {
      token: adminToken,
      expect: 200,
      verify: (d) => {
        const dp = d.deliveryPersons.find((x) => x.id === firstDp.id);
        if (!dp) return "delivery person missing";
        if (!dp.parcels.some((p) => p.id === pId)) return "parcel missing";
        if (dp.capacity !== 6 || dp.freeSpots !== 6 - dp.load) return "capacity numbers wrong";
        return true;
      },
    });

  await test("Workload invalid date -> 400", "GET", "/api/admin/assignments/workload?date=xyz", {
    token: adminToken,
    expect: 400,
  });

  await test("Unassigned queue returns a list", "GET", "/api/admin/assignments/unassigned", {
    token: adminToken,
    expect: 200,
    verify: (d) => Array.isArray(d.parcels) || "not a list",
  });

  await test("Auto-assign an already assigned parcel -> 409", "POST", `/api/admin/parcels/${pId}/auto-assign`, {
    token: adminToken,
    expect: 409,
  });

  // ---- manual reassign ----
  section("B3. Manual assign / reassign");
  const otherDp = [dp1, dp2, dp3, dp4].find((d) => d.id !== firstDp.id);

  await test("Assign as customer -> 403", "POST", `/api/admin/parcels/${pId}/assign`, {
    body: { deliveryPersonId: otherDp.id },
    token: custToken,
    expect: 403,
  });

  await test("Invalid deliveryPersonId -> 400", "POST", `/api/admin/parcels/${pId}/assign`, {
    body: { deliveryPersonId: "abc" },
    token: adminToken,
    expect: 400,
  });

  await test("Non-existent delivery person -> 404", "POST", `/api/admin/parcels/${pId}/assign`, {
    body: { deliveryPersonId: 999999 },
    token: adminToken,
    expect: 404,
  });

  const custUser = await prisma.user.findUnique({ where: { email: cust.email } });
  await test("A customer's id as delivery person -> 404", "POST", `/api/admin/parcels/${pId}/assign`, {
    body: { deliveryPersonId: custUser.id },
    token: adminToken,
    expect: 404,
  });

  await test("Parcel without booked slot -> 409", "POST", `/api/admin/parcels/${p2Id}/assign`, {
    body: { deliveryPersonId: otherDp.id },
    token: adminToken,
    expect: 409,
  });

  await test("Assign to the same delivery person -> 409", "POST", `/api/admin/parcels/${pId}/assign`, {
    body: { deliveryPersonId: firstDp.id },
    token: adminToken,
    expect: 409,
  });

  await test(`Reassign to ${otherDp.name}`, "POST", `/api/admin/parcels/${pId}/assign`, {
    body: { deliveryPersonId: otherDp.id },
    token: adminToken,
    expect: 200,
    verify: (d) => d.deliveryPerson?.id === otherDp.id || "wrong delivery person",
  });

  await test("History: old CANCELLED, new MANUAL ACTIVE by admin", "GET", `/api/admin/parcels/${pId}`, {
    token: adminToken,
    expect: 200,
    verify: (d) => {
      const a = d.parcel.assignments;
      if (a.length !== 2) return `assignments ${a.length}`;
      if (a[0].status !== "CANCELLED" || !a[0].endedAt) return "old not cancelled";
      if (a[1].status !== "ACTIVE" || a[1].method !== "MANUAL") return "new not MANUAL ACTIVE";
      if (!a[1].assignedBy?.name) return "assignedBy missing";
      if (d.parcel.assignedTo?.id !== otherDp.id) return "assignedTo not updated";
      return true;
    },
  });

  await test("Old delivery person got 'Parcel Reassigned'", "GET", "/api/notifications", {
    token: dpToken,
    expect: 200,
    verify: (d) => d.notifications.some((n) => n.title === "Parcel Reassigned" && n.parcel?.id === pId) || "missing",
  });

  const otherToken = (await request("POST", "/api/auth/login", { email: otherDp.email, password: DP_PASSWORD })).data?.token;
  await test("New delivery person got 'New Parcel Assigned'", "GET", "/api/notifications", {
    token: otherToken,
    expect: 200,
    verify: (d) =>
      d.notifications.some((n) => n.title === "New Parcel Assigned" && n.parcel?.id === pId) || "missing",
  });

  await test("Customer got 'Delivery Partner Changed'", "GET", "/api/notifications", {
    token: custToken,
    expect: 200,
    verify: (d) =>
      d.notifications.some((n) => n.title === "Delivery Partner Changed" && n.parcel?.id === pId) || "missing",
  });

  await test("Delivery person cannot use admin assign -> 403", "POST", `/api/admin/parcels/${pId}/assign`, {
    body: { deliveryPersonId: firstDp.id },
    token: otherToken,
    expect: 403,
  });
}

// ======================================================================
// Runner
// ======================================================================

async function cleanup() {
  if (toRestore.size) {
    await prisma.user
      .updateMany({ where: { id: { in: [...toRestore] } }, data: { isActive: true } })
      .catch(() => {});
    console.log(`\nRestored ${toRestore.size} delivery person(s) to active.`);
  }

  if (KEEP_DATA) {
    console.log("(--keep) Test data left in the database.");
    return;
  }

  try {
    const users = await prisma.user.findMany({ where: { email: { in: createdEmails } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    const parcels = await prisma.parcel.deleteMany({ where: { customerId: { in: ids } } });
    const del = await prisma.user.deleteMany({ where: { id: { in: ids } } });
    console.log(`Cleanup: removed ${parcels.count} test parcels, ${del.count} test users.`);
  } catch (err) {
    console.log(`Cleanup failed: ${err.message}`);
  }
}

(async () => {
  try {
    const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    const emails = ["dp1@postoffice.com", "dp2@postoffice.com", "dp3@postoffice.com", "dp4@postoffice.com"];
    const dps = await prisma.user.findMany({ where: { email: { in: emails } }, orderBy: { id: "asc" } });
    const byEmail = Object.fromEntries(dps.map((d) => [d.email, d]));
    const ctx = {
      admin,
      dp1: byEmail[emails[0]],
      dp2: byEmail[emails[1]],
      dp3: byEmail[emails[2]],
      dp4: byEmail[emails[3]],
    };

    if (!admin || dps.length !== 4) {
      console.log("❌ Need admin + dp1..dp4 from seed. Run: npx prisma db seed");
      process.exitCode = 1;
      return;
    }

    // Make sure dp1-dp4 are active; deactivate any other delivery persons for a predictable test
    await setActive(dps.map((d) => d.id), true);
    const others = await prisma.user.findMany({
      where: { role: "DELIVERY", isActive: true, email: { notIn: emails } },
      select: { id: true },
    });
    if (others.length) {
      await setActive(others.map((o) => o.id), false);
      console.log(`(Temporarily deactivated ${others.length} other delivery person(s))`);
    }

    console.log("\n========== PART A: AI scenarios ==========");
    await partA(ctx);

    console.log("\n========== PART B: API checks ==========");
    console.log(`Testing API at ${BASE_URL}`);
    await partB(ctx);
  } catch (err) {
    failed++;
    failures.push("Unexpected error");
    console.log(`\n❌ Unexpected error: ${err.stack || err.message}`);
  } finally {
    await cleanup();
    await prisma.$disconnect();

    console.log("\n==============================");
    console.log(`Result: ${passed}/${passed + failed} passed, ${failed} failed`);
    if (failures.length) {
      console.log("Failed tests:");
      failures.forEach((f) => console.log(`  - ${f}`));
      process.exitCode = 1;
    } else {
      console.log("All Step 4 checks passed ✅");
    }
    console.log("==============================\n");
  }
})();