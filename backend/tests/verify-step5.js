/**
 * Step 5 API verification: delivery portal, failed delivery + rebooking, reschedule
 *
 * Today's parcels are created directly in the DB (booking rules don't allow
 * same-day slots late in the day), then the real delivery APIs are tested.
 *
 * Usage (server must be running in another terminal with `npm run dev`):
 *   node tests/verify-step5.js
 *   node tests/verify-step5.js --keep   (keep test data)
 */

require("dotenv").config();
const prisma = require("../src/config/prisma");

const BASE_URL = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const KEEP_DATA = process.argv.includes("--keep");
const ADMIN = { email: "admin@postoffice.com", password: "admin123" };
const DP_PASSWORD = "dp1234";

let passed = 0;
let failed = 0;
const failures = [];
const createdEmails = [];
const stamp = Date.now();

const randomPhone = () => "9" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
const toSlotDate = (s) => new Date(`${s}T00:00:00.000Z`);
const getISTToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());
const addDays = (s, n) => {
  const d = new Date(`${s}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ---------- helpers ----------

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

const section = (t) => console.log(`\n${t}`);

// ---------- main ----------

async function run() {
  console.log(`Testing API at ${BASE_URL}`);
  try {
    await fetch(`${BASE_URL}/api/health`);
  } catch {
    console.log("\n❌ Server is not running. Start it first with: npm run dev\n");
    process.exitCode = 1;
    return;
  }

  const today = getISTToday();
  const tomorrow = addDays(today, 1);
  const dayAfter = addDays(today, 2);
  const day3 = addDays(today, 3);

  // ===== Setup =====
  section("0. Setup");
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  const dp3 = await prisma.user.findUnique({ where: { email: "dp3@postoffice.com" } });
  const dp4 = await prisma.user.findUnique({ where: { email: "dp4@postoffice.com" } });

  const adminToken = (await request("POST", "/api/auth/login", ADMIN)).data?.token;
  const dp4Token = (await request("POST", "/api/auth/login", { email: dp4.email, password: DP_PASSWORD })).data?.token;
  const dp3Token = (await request("POST", "/api/auth/login", { email: dp3.email, password: DP_PASSWORD })).data?.token;

  const areas = (await request("GET", "/api/areas")).data.areas;
  const C = areas.find((a) => a.name === "Area C");

  const registerCustomer = async (label) => {
    const c = {
      name: `S5 ${label}`,
      email: `s5_${label}_${stamp}@test.com`,
      phone: randomPhone(),
      password: "cust123",
      addressLine: "No 5",
      areaId: C.id,
      streetId: C.streets[0].id,
    };
    createdEmails.push(c.email);
    const res = await request("POST", "/api/auth/register", c);
    return { ...c, token: res.data?.token, id: res.data?.user?.id };
  };

  const c1 = await registerCustomer("c1");
  const c2 = await registerCustomer("c2");

  let n = 0;
  // Parcel already ASSIGNED to a delivery person (created directly in DB)
  const makeAssigned = async ({ customer, dp, date, hour = 10, failedAttempts = 0 }) => {
    const p = await prisma.parcel.create({
      data: {
        trackingNumber: `S5${stamp}${++n}`,
        customerId: customer.id,
        registeredById: admin.id,
        status: "ASSIGNED",
        slotDate: toSlotDate(date),
        slotHour: hour,
        slotBookedAt: new Date(),
        assignedToId: dp.id,
        assignedAt: new Date(),
        failedAttempts,
      },
    });
    await prisma.assignment.create({
      data: { parcelId: p.id, deliveryPersonId: dp.id, slotDate: toSlotDate(date), slotHour: hour, score: 50, reason: "test" },
    });
    return p;
  };

  // Parcel via real admin API (status NOTIFIED)
  const makeNotified = async (customer, suffix) => {
    const res = await request(
      "POST",
      "/api/admin/parcels",
      { trackingNumber: `S5N${stamp}${suffix}`, phone: customer.phone },
      adminToken
    );
    return res.data?.parcel;
  };

  const pA = await makeAssigned({ customer: c1, dp: dp4, date: today, hour: 10 });
  const pB = await makeAssigned({ customer: c1, dp: dp4, date: today, hour: 11 });
  const pC = await makeAssigned({ customer: c1, dp: dp4, date: tomorrow, hour: 10 });
  const pD = await makeAssigned({ customer: c1, dp: dp3, date: today, hour: 10 });
  const pE = await makeAssigned({ customer: c1, dp: dp4, date: today, hour: 12, failedAttempts: 2 });

  check("Tokens, customers and test parcels ready",
    !!adminToken && !!dp4Token && !!dp3Token && !!c1.token && !!c2.token && !!pA && !!pE);

  const del = (id, action) => `/api/delivery/parcels/${id}/${action}`;

  // ===== Delivery list =====
  section("1. Delivery list");

  await test("Delivery list without token -> 401", "GET", "/api/delivery/parcels", { expect: 401 });
  await test("Delivery list as customer -> 403", "GET", "/api/delivery/parcels", { token: c1.token, expect: 403 });
  await test("Delivery list as admin -> 403", "GET", "/api/delivery/parcels", { token: adminToken, expect: 403 });

  await test("dp4 today: sees own today parcels only (not dp3's, not tomorrow's)", "GET", "/api/delivery/parcels", {
    token: dp4Token,
    expect: 200,
    verify: (d) => {
      const ids = d.deliveries.map((x) => x.parcel.id);
      if (!ids.includes(pA.id) || !ids.includes(pB.id) || !ids.includes(pE.id)) return "own parcels missing";
      if (ids.includes(pD.id)) return "shows dp3's parcel";
      if (ids.includes(pC.id)) return "shows tomorrow's parcel";
      if (!d.isToday || d.date !== today) return "date/isToday wrong";
      const a = d.deliveries.find((x) => x.parcel.id === pA.id);
      if (a.deliveryStatus !== "ASSIGNED" || !a.parcel.customer.street?.name || !a.parcel.customer.phone) {
        return "delivery details missing";
      }
      if (!d.failureReasons?.CUSTOMER_NOT_AVAILABLE) return "failure reasons list missing";
      return true;
    },
  });

  await test("dp4 tomorrow list has pC", "GET", `/api/delivery/parcels?date=${tomorrow}`, {
    token: dp4Token,
    expect: 200,
    verify: (d) => (d.deliveries.some((x) => x.parcel.id === pC.id) && !d.isToday) || "pC missing",
  });

  await test("Delivery list invalid date -> 400", "GET", "/api/delivery/parcels?date=abc", {
    token: dp4Token,
    expect: 400,
  });

  // ===== Status rules =====
  section("2. Status transition rules");

  await test("Out for delivery on tomorrow's parcel -> 400 (not slot day)", "PATCH", del(pC.id, "out-for-delivery"), {
    token: dp4Token,
    expect: 400,
  });
  await test("Out for delivery on another delivery person's parcel -> 404", "PATCH", del(pD.id, "out-for-delivery"), {
    token: dp4Token,
    expect: 404,
  });
  await test("Delivered before out for delivery -> 409", "PATCH", del(pA.id, "delivered"), {
    token: dp4Token,
    expect: 409,
  });
  await test("Failed before out for delivery -> 409", "PATCH", del(pA.id, "failed"), {
    body: { reason: "CUSTOMER_NOT_AVAILABLE" },
    token: dp4Token,
    expect: 409,
  });
  await test("Invalid parcel id -> 400", "PATCH", del("abc", "out-for-delivery"), { token: dp4Token, expect: 400 });
  await test("Customer cannot mark out for delivery -> 403", "PATCH", del(pA.id, "out-for-delivery"), {
    token: c1.token,
    expect: 403,
  });

  // ===== Successful delivery =====
  section("3. Successful delivery");

  await test("Out for delivery (pA)", "PATCH", del(pA.id, "out-for-delivery"), {
    token: dp4Token,
    expect: 200,
    verify: (d) => (d.parcel.status === "OUT_FOR_DELIVERY" && !!d.parcel.outForDeliveryAt) || "not updated",
  });
  await test("Out for delivery again -> 409", "PATCH", del(pA.id, "out-for-delivery"), { token: dp4Token, expect: 409 });

  await test("Customer got 'Out for Delivery' notification with delivery person contact", "GET", "/api/notifications", {
    token: c1.token,
    expect: 200,
    verify: (d) => {
      const nt = d.notifications.find((x) => x.type === "OUT_FOR_DELIVERY" && x.parcel?.id === pA.id);
      if (!nt) return "missing";
      return nt.message.includes(dp4.phone) || "phone missing in message";
    },
  });

  await test("receivedBy too long -> 400", "PATCH", del(pA.id, "delivered"), {
    body: { receivedBy: "x".repeat(61) },
    token: dp4Token,
    expect: 400,
  });

  await test("Delivered (pA) with receivedBy", "PATCH", del(pA.id, "delivered"), {
    body: { receivedBy: "Neighbour - Ramesh" },
    token: dp4Token,
    expect: 200,
    verify: (d) =>
      (d.parcel.status === "DELIVERED" && d.parcel.receivedBy === "Neighbour - Ramesh" && !!d.parcel.deliveredAt) ||
      "not delivered",
  });

  const aRow = await prisma.assignment.findFirst({ where: { parcelId: pA.id } });
  check("Assignment marked COMPLETED", aRow.status === "COMPLETED" && !!aRow.endedAt);

  await test("Delivered again -> 409", "PATCH", del(pA.id, "delivered"), { token: dp4Token, expect: 409 });
  await test("Failed after delivered -> 409", "PATCH", del(pA.id, "failed"), {
    body: { reason: "OTHER", note: "x" },
    token: dp4Token,
    expect: 409,
  });

  await test("Customer timeline ends with DELIVERED + notification", "GET", `/api/customer/parcels/${pA.id}`, {
    token: c1.token,
    expect: 200,
    verify: (d) => {
      const h = d.parcel.statusHistory;
      if (h[h.length - 1].status !== "DELIVERED") return "last status not DELIVERED";
      if (d.parcel.actions.canReschedule || d.parcel.actions.canBookSlot) return "actions should be disabled";
      return true;
    },
  });

  // ===== Failed delivery =====
  section("4. Failed delivery");

  await request("PATCH", del(pB.id, "out-for-delivery"), null, dp4Token);

  await test("Invalid failure reason -> 400", "PATCH", del(pB.id, "failed"), {
    body: { reason: "DOG_BIT_ME" },
    token: dp4Token,
    expect: 400,
  });
  await test("OTHER without note -> 400", "PATCH", del(pB.id, "failed"), {
    body: { reason: "OTHER" },
    token: dp4Token,
    expect: 400,
  });
  await test("Note longer than 200 -> 400", "PATCH", del(pB.id, "failed"), {
    body: { reason: "WRONG_ADDRESS", note: "x".repeat(201) },
    token: dp4Token,
    expect: 400,
  });

  await test("Mark failed (pB, customer not available)", "PATCH", del(pB.id, "failed"), {
    body: { reason: "CUSTOMER_NOT_AVAILABLE", note: "No answer on phone" },
    token: dp4Token,
    expect: 200,
    verify: (d) => {
      if (d.parcel.status !== "FAILED") return "status not FAILED";
      if (d.attempt !== 1 || d.finalAttempt) return "attempt numbers wrong";
      return true;
    },
  });

  const pBdb = await prisma.parcel.findUnique({ where: { id: pB.id }, include: { assignments: true } });
  check("Delivery person released and slot cleared",
    pBdb.assignedToId === null && pBdb.slotDate === null && pBdb.slotHour === null && pBdb.failedAttempts === 1);
  check("Assignment FAILED with reason + note",
    pBdb.assignments[0].status === "FAILED" &&
      pBdb.assignments[0].failureReason === "CUSTOMER_NOT_AVAILABLE" &&
      pBdb.assignments[0].failureNote === "No answer on phone");

  await test("dp4 list still shows pB as FAILED (attempt history)", "GET", "/api/delivery/parcels", {
    token: dp4Token,
    expect: 200,
    verify: (d) => {
      const x = d.deliveries.find((y) => y.parcel.id === pB.id);
      if (!x) return "pB missing";
      if (x.deliveryStatus !== "FAILED" || x.failureReasonLabel !== "Customer not available") return "status/label wrong";
      if (d.summary.failed < 1 || d.summary.delivered < 1) return "summary counts wrong";
      return true;
    },
  });

  await test("Customer got 'Delivery Failed' asking to rebook", "GET", "/api/notifications", {
    token: c1.token,
    expect: 200,
    verify: (d) =>
      d.notifications.some((x) => x.title === "Delivery Failed" && x.parcel?.id === pB.id && x.message.includes("book a new"))
      || "missing",
  });

  await test("Customer actions: can book again, 2 attempts left", "GET", `/api/customer/parcels/${pB.id}`, {
    token: c1.token,
    expect: 200,
    verify: (d) => {
      const a = d.parcel.actions;
      if (!a.canBookSlot || a.attemptsLeft !== 2 || a.mustCollect) return JSON.stringify(a);
      if (d.parcel.lastFailureReasonLabel !== "Customer not available") return "failure label missing";
      return true;
    },
  });

  // ===== Rebook after failure =====
  section("5. Rebook after failed delivery");

  await test("Reschedule a FAILED parcel -> 409 (must book instead)", "POST", `/api/customer/parcels/${pB.id}/reschedule`, {
    body: { date: tomorrow, hour: 12 },
    token: c1.token,
    expect: 409,
  });

  await test("Rebook pB tomorrow 12PM -> AI assigns again", "POST", `/api/customer/parcels/${pB.id}/book-slot`, {
    body: { date: tomorrow, hour: 12 },
    token: c1.token,
    expect: 201,
    verify: (d) => {
      if (!["ASSIGNED", "SLOT_BOOKED"].includes(d.parcel.status)) return `status ${d.parcel.status}`;
      if (d.parcel.slotHour !== 12) return "slot not saved";
      return true;
    },
  });

  const pBhist = await prisma.statusHistory.findMany({ where: { parcelId: pB.id }, orderBy: { createdAt: "asc" } });
  check("History notes the rebooking after failure",
    pBhist.some((h) => h.status === "SLOT_BOOKED" && h.note.includes("after failed delivery")));

  // Simulate max attempts reached
  await prisma.assignment.updateMany({ where: { parcelId: pB.id, status: "ACTIVE" }, data: { status: "CANCELLED" } });
  await prisma.parcel.update({
    where: { id: pB.id },
    data: { status: "FAILED", failedAttempts: 3, assignedToId: null, slotDate: null, slotHour: null },
  });

  await test("Booking after 3 failed attempts -> 409 (collect from post office)", "POST",
    `/api/customer/parcels/${pB.id}/book-slot`, {
      body: { date: tomorrow, hour: 13 },
      token: c1.token,
      expect: 409,
      verify: (d) => d.message.includes("collect") || "message should mention collecting",
    });

  await test("Customer actions: mustCollect true, cannot book", "GET", `/api/customer/parcels/${pB.id}`, {
    token: c1.token,
    expect: 200,
    verify: (d) =>
      (d.parcel.actions.mustCollect && !d.parcel.actions.canBookSlot && d.parcel.actions.attemptsLeft === 0) ||
      JSON.stringify(d.parcel.actions),
  });

  // Real 3rd failure via API (pE already has 2 failed attempts)
  section("6. Third failed attempt via delivery API");
  await request("PATCH", del(pE.id, "out-for-delivery"), null, dp4Token);
  await test("Fail pE (3rd attempt) -> finalAttempt true", "PATCH", del(pE.id, "failed"), {
    body: { reason: "PREMISES_LOCKED" },
    token: dp4Token,
    expect: 200,
    verify: (d) => (d.finalAttempt === true && d.attempt === 3) || `attempt ${d.attempt}, final ${d.finalAttempt}`,
  });

  await test("Customer told to collect from post office", "GET", "/api/notifications", {
    token: c1.token,
    expect: 200,
    verify: (d) =>
      d.notifications.some((x) => x.parcel?.id === pE.id && x.title.includes("Collect from Post Office")) || "missing",
  });

  await test("Admin got 'Max Delivery Attempts Reached'", "GET", "/api/notifications", {
    token: adminToken,
    expect: 200,
    verify: (d) =>
      d.notifications.some((x) => x.parcel?.id === pE.id && x.title === "Max Delivery Attempts Reached") || "missing",
  });

  // ===== Reschedule =====
  section("7. Reschedule");

  const pF = await makeNotified(c1, "F");
  const pG = await makeNotified(c1, "G");

  const bookF = await request("POST", `/api/customer/parcels/${pF.id}/book-slot`, { date: tomorrow, hour: 10 }, c1.token);
  check("Setup: pF booked tomorrow 10AM", bookF.status === 201);
  const firstDpId = (await prisma.parcel.findUnique({ where: { id: pF.id } })).assignedToId;

  const resPath = (id) => `/api/customer/parcels/${id}/reschedule`;

  await test("Reschedule without token -> 401", "POST", resPath(pF.id), {
    body: { date: dayAfter, hour: 14 },
    expect: 401,
  });
  await test("Reschedule invalid date -> 400", "POST", resPath(pF.id), {
    body: { date: "bad", hour: 14 },
    token: c1.token,
    expect: 400,
  });
  await test("Reschedule to the same slot -> 400", "POST", resPath(pF.id), {
    body: { date: tomorrow, hour: 10 },
    token: c1.token,
    expect: 400,
  });
  await test("Reschedule another customer's parcel -> 404", "POST", resPath(pF.id), {
    body: { date: dayAfter, hour: 14 },
    token: c2.token,
    expect: 404,
  });
  await test("Reschedule a parcel with no slot yet -> 409", "POST", resPath(pG.id), {
    body: { date: dayAfter, hour: 14 },
    token: c1.token,
    expect: 409,
  });
  await test("Reschedule a delivered parcel -> 409", "POST", resPath(pA.id), {
    body: { date: dayAfter, hour: 14 },
    token: c1.token,
    expect: 409,
  });

  await test("Reschedule pF to day-after 2PM (1st)", "POST", resPath(pF.id), {
    body: { date: dayAfter, hour: 14 },
    token: c1.token,
    expect: 200,
    verify: (d) => {
      if (d.parcel.slotHour !== 14 || d.parcel.slotDate.slice(0, 10) !== dayAfter) return "slot not changed";
      if (d.parcel.rescheduleCount !== 1) return `rescheduleCount ${d.parcel.rescheduleCount}`;
      if (!d.steps.includes("Delivery Slot Rescheduled Successfully")) return "step missing";
      if (!d.previousSlot) return "previousSlot missing";
      return true;
    },
  });

  const fAssignments = await prisma.assignment.findMany({ where: { parcelId: pF.id }, orderBy: { createdAt: "asc" } });
  check("Old assignment CANCELLED, AI ran again for new slot",
    fAssignments[0].status === "CANCELLED" && fAssignments.filter((a) => a.status === "ACTIVE").length <= 1);

  if (firstDpId) {
    const oldDpNote = await prisma.notification.count({
      where: { userId: firstDpId, parcelId: pF.id, title: "Parcel Rescheduled" },
    });
    check("Old delivery person notified 'Parcel Rescheduled'", oldDpNote === 1);
  }

  await test("Customer got 'Delivery Slot Rescheduled'", "GET", "/api/notifications", {
    token: c1.token,
    expect: 200,
    verify: (d) => d.notifications.some((x) => x.type === "RESCHEDULED" && x.parcel?.id === pF.id) || "missing",
  });

  await test("Reschedule pF to day-3 3PM (2nd)", "POST", resPath(pF.id), {
    body: { date: day3, hour: 15 },
    token: c1.token,
    expect: 200,
    verify: (d) => d.parcel.rescheduleCount === 2 || `count ${d.parcel.rescheduleCount}`,
  });

  await test("3rd reschedule -> 409 (limit 2)", "POST", resPath(pF.id), {
    body: { date: tomorrow, hour: 11 },
    token: c1.token,
    expect: 409,
  });

  await test("Customer actions: canReschedule false, 0 left", "GET", `/api/customer/parcels/${pF.id}`, {
    token: c1.token,
    expect: 200,
    verify: (d) =>
      (!d.parcel.actions.canReschedule && d.parcel.actions.reschedulesLeft === 0) || JSON.stringify(d.parcel.actions),
  });

  await test("Admin parcel detail shows failure info on assignments", "GET", `/api/admin/parcels/${pE.id}`, {
    token: adminToken,
    expect: 200,
    verify: (d) => {
      if (d.parcel.failedAttempts !== 3) return "failedAttempts wrong";
      return d.parcel.assignments.some((a) => a.failureReason === "PREMISES_LOCKED") || "failureReason missing";
    },
  });
}

// ---------- cleanup + summary ----------

async function cleanup() {
  if (KEEP_DATA) {
    console.log("\n(--keep) Test data left in the database.");
    return;
  }
  try {
    const users = await prisma.user.findMany({ where: { email: { in: createdEmails } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    const parcels = await prisma.parcel.deleteMany({ where: { customerId: { in: ids } } });
    const del = await prisma.user.deleteMany({ where: { id: { in: ids } } });
    console.log(`\nCleanup: removed ${parcels.count} test parcels, ${del.count} test users.`);
  } catch (err) {
    console.log(`\nCleanup failed: ${err.message}`);
  }
}

(async () => {
  try {
    await run();
  } catch (err) {
    failed++;
    failures.push("Unexpected error");
    console.log(`\n❌ Unexpected error: ${err.stack || err.message}`);
  } finally {
    await cleanup();
    await prisma.$disconnect();

    const total = passed + failed;
    console.log("\n==============================");
    console.log(`Result: ${passed}/${total} passed, ${failed} failed`);
    if (failures.length) {
      console.log("Failed tests:");
      failures.forEach((f) => console.log(`  - ${f}`));
      process.exitCode = 1;
    } else {
      console.log("All Step 5 checks passed ✅");
    }
    console.log("==============================\n");
  }
})();