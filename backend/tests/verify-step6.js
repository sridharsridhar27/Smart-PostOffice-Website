/**
 * Returns verification: return to sender + customer return requests (pickups)
 *
 * Today's jobs are set up directly in the DB, then the real APIs are tested.
 * Uses seeded dp1-dp4 (password dp1234); other delivery persons are set
 * inactive during the test and restored after.
 *
 * Usage (server must be running in another terminal with `npm run dev`):
 *   node tests/verify-returns.js
 *   node tests/verify-returns.js --keep
 */

require("dotenv").config();
const prisma = require("../src/config/prisma");
const { autoReturnOverdue } = require("../src/services/returnService");

const BASE_URL = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const KEEP_DATA = process.argv.includes("--keep");
const ADMIN = { email: "admin@postoffice.com", password: "admin123" };
const DP_EMAILS = ["dp1@postoffice.com", "dp2@postoffice.com", "dp3@postoffice.com", "dp4@postoffice.com"];

let passed = 0;
let failed = 0;
const failures = [];
const createdEmails = [];
const toRestore = new Set();
const stamp = Date.now();
const DAY = 24 * 60 * 60 * 1000;

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

  // ===== Setup =====
  section("0. Setup");
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  const dps = await prisma.user.findMany({ where: { email: { in: DP_EMAILS } }, orderBy: { id: "asc" } });
  const dp4 = dps.find((d) => d.email === "dp4@postoffice.com");

  // only seeded delivery persons active (so we know their passwords)
  await prisma.user.updateMany({ where: { id: { in: dps.map((d) => d.id) } }, data: { isActive: true } });
  const others = await prisma.user.findMany({
    where: { role: "DELIVERY", isActive: true, email: { notIn: DP_EMAILS } },
    select: { id: true },
  });
  if (others.length) {
    others.forEach((o) => toRestore.add(o.id));
    await prisma.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { isActive: false } });
    console.log(`  (temporarily deactivated ${others.length} other delivery person(s))`);
  }

  const tokens = {};
  for (const d of dps) {
    tokens[d.id] = (await request("POST", "/api/auth/login", { email: d.email, password: "dp1234" })).data?.token;
  }
  const dp4Token = tokens[dp4.id];
  const adminToken = (await request("POST", "/api/auth/login", ADMIN)).data?.token;

  const areas = (await request("GET", "/api/areas")).data.areas;
  const C = areas.find((a) => a.name === "Area C");

  const registerCustomer = async (label) => {
    const c = {
      name: `RT ${label}`,
      email: `rt_${label}_${stamp}@test.com`,
      phone: randomPhone(),
      password: "cust123",
      addressLine: "No 3",
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
  const makeParcel = (customer, data) =>
    prisma.parcel.create({
      data: { trackingNumber: `RT${stamp}${++n}`, customerId: customer.id, registeredById: admin.id, ...data },
    });

  const makeAssignedToday = async (customer, extra = {}) => {
    const p = await makeParcel(customer, {
      status: "ASSIGNED",
      slotDate: toSlotDate(today),
      slotHour: 10,
      slotBookedAt: new Date(),
      assignedToId: dp4.id,
      assignedAt: new Date(),
      ...extra,
    });
    await prisma.assignment.create({
      data: { parcelId: p.id, deliveryPersonId: dp4.id, slotDate: toSlotDate(today), slotHour: 10, score: 50, reason: "test" },
    });
    return p;
  };

  // Move a pickup's slot (parcel + active assignment) to today so it can be started
  const moveToToday = async (parcelId) => {
    await prisma.parcel.update({ where: { id: parcelId }, data: { slotDate: toSlotDate(today) } });
    await prisma.assignment.updateMany({ where: { parcelId, status: "ACTIVE" }, data: { slotDate: toSlotDate(today) } });
    const p = await prisma.parcel.findUnique({ where: { id: parcelId } });
    return p.assignedToId;
  };

  check("Admin, 4 delivery persons, 2 customers ready",
    !!adminToken && Object.values(tokens).every(Boolean) && !!c1.token && !!c2.token);

  const del = (id, action) => `/api/delivery/parcels/${id}/${action}`;

  // ===================================================================
  section("1. Customer refused -> straight back to sender");
  const pR = await makeAssignedToday(c1);
  await request("PATCH", del(pR.id, "start"), null, dp4Token);
  await test("Fail with CUSTOMER_REFUSED", "PATCH", del(pR.id, "fail"), {
    body: { reason: "CUSTOMER_REFUSED", note: "Did not order it" },
    token: dp4Token,
    expect: 200,
    verify: (d) =>
      (d.returnedToSender === true && d.parcel.status === "RETURNED_TO_SENDER" && d.parcel.returnReason === "CUSTOMER_REFUSED") ||
      "not returned to sender",
  });
  const pRdb = await prisma.parcel.findUnique({ where: { id: pR.id } });
  check("Partner released, slot cleared, note kept",
    pRdb.assignedToId === null && pRdb.slotDate === null && pRdb.returnNote === "Did not order it");
  await test("Customer told 'Parcel Returned to Sender'", "GET", "/api/notifications", {
    token: c1.token,
    expect: 200,
    verify: (d) => d.notifications.some((x) => x.parcel?.id === pR.id && x.title === "Parcel Returned to Sender") || "missing",
  });
  await test("Customer cannot rebook a refused parcel", "POST", `/api/customer/parcels/${pR.id}/book-slot`, {
    body: { date: tomorrow, hour: 12 },
    token: c1.token,
    expect: 409,
  });

  // ===================================================================
  section("2. 3rd failure -> 7-day collection deadline");
  const pE = await makeAssignedToday(c1, { failedAttempts: 2 });
  await request("PATCH", del(pE.id, "start"), null, dp4Token);
  await test("3rd failure sets finalAttempt", "PATCH", del(pE.id, "fail"), {
    body: { reason: "CUSTOMER_NOT_AVAILABLE" },
    token: dp4Token,
    expect: 200,
    verify: (d) => (d.finalAttempt === true && !!d.parcel.collectionDeadline) || "no deadline",
  });
  const pEdb = await prisma.parcel.findUnique({ where: { id: pE.id } });
  const diffDays = (pEdb.collectionDeadline.getTime() - Date.now()) / DAY;
  check("Deadline is about 7 days from now", diffDays > 6.9 && diffDays < 7.1, `${diffDays.toFixed(2)} days`);
  await test("Customer sees mustCollect + deadline", "GET", `/api/customer/parcels/${pE.id}`, {
    token: c1.token,
    expect: 200,
    verify: (d) => (d.parcel.actions.mustCollect && !!d.parcel.collectionDeadline) || JSON.stringify(d.parcel.actions),
  });

  // ===================================================================
  section("3. Admin: mark collected at counter");
  await test("Mark collected as customer -> 403", "POST", `/api/admin/parcels/${pE.id}/mark-collected`, {
    token: c1.token,
    expect: 403,
  });
  await test("Mark collected as admin", "POST", `/api/admin/parcels/${pE.id}/mark-collected`, {
    token: adminToken,
    expect: 200,
  });
  const pEafter = await prisma.parcel.findUnique({ where: { id: pE.id } });
  check("Now DELIVERED, collectedAtCounter, deadline cleared",
    pEafter.status === "DELIVERED" && pEafter.collectedAtCounter && pEafter.collectionDeadline === null &&
      pEafter.receivedBy === "Collected at post office");
  await test("Mark collected again -> 409", "POST", `/api/admin/parcels/${pE.id}/mark-collected`, {
    token: adminToken,
    expect: 409,
  });

  // ===================================================================
  section("4. Auto return after deadline (background job logic)");
  const pOverdue = await makeParcel(c1, {
    status: "FAILED",
    failedAttempts: 3,
    lastFailedAt: new Date(Date.now() - 8 * DAY),
    collectionDeadline: new Date(Date.now() - DAY),
  });
  const pStillOk = await makeParcel(c1, {
    status: "FAILED",
    failedAttempts: 3,
    lastFailedAt: new Date(),
    collectionDeadline: new Date(Date.now() + 5 * DAY),
  });
  const pRebookable = await makeParcel(c1, { status: "FAILED", failedAttempts: 1, lastFailedAt: new Date() });

  const returned = await autoReturnOverdue();
  check("Overdue parcel returned", returned.includes(pOverdue.trackingNumber));
  check("Parcel inside 7 days not returned", !returned.includes(pStillOk.trackingNumber));
  check("Failed parcel without deadline not returned", !returned.includes(pRebookable.trackingNumber));
  const pOdb = await prisma.parcel.findUnique({ where: { id: pOverdue.id } });
  check("Reason NOT_COLLECTED", pOdb.status === "RETURNED_TO_SENDER" && pOdb.returnReason === "NOT_COLLECTED");

  // ===================================================================
  section("5. Admin: return to sender");
  await test("Note too long -> 400", "POST", `/api/admin/parcels/${pStillOk.id}/return-to-sender`, {
    body: { note: "x".repeat(201) },
    token: adminToken,
    expect: 400,
  });
  await test("Return a failed parcel to sender", "POST", `/api/admin/parcels/${pStillOk.id}/return-to-sender`, {
    body: { note: "Customer asked to send back" },
    token: adminToken,
    expect: 200,
  });
  const pSdb = await prisma.parcel.findUnique({ where: { id: pStillOk.id } });
  check("Reason ADMIN_DECISION + note", pSdb.returnReason === "ADMIN_DECISION" && pSdb.returnNote.includes("send back"));
  await test("Return a delivered parcel -> 409", "POST", `/api/admin/parcels/${pE.id}/return-to-sender`, {
    token: adminToken,
    expect: 409,
  });

  // ===================================================================
  section("6. Customer return request - validation");
  const pD = await makeParcel(c1, { status: "DELIVERED", deliveredAt: new Date(Date.now() - 2 * DAY) });
  const pOld = await makeParcel(c1, { status: "DELIVERED", deliveredAt: new Date(Date.now() - 8 * DAY) });
  const ret = (id) => `/api/customer/parcels/${id}/return`;
  const good = { reason: "DAMAGED", note: "Box crushed", date: tomorrow, hour: 11 };

  await test("Without token -> 401", "POST", ret(pD.id), { body: good, expect: 401 });
  await test("As admin -> 403", "POST", ret(pD.id), { body: good, token: adminToken, expect: 403 });
  await test("Another customer's parcel -> 404", "POST", ret(pD.id), { body: good, token: c2.token, expect: 404 });
  await test("Invalid reason -> 400", "POST", ret(pD.id), { body: { ...good, reason: "BORED" }, token: c1.token, expect: 400 });
  await test("OTHER without note -> 400", "POST", ret(pD.id), {
    body: { ...good, reason: "OTHER", note: "" },
    token: c1.token,
    expect: 400,
  });
  await test("Bad date -> 400", "POST", ret(pD.id), { body: { ...good, date: "bad" }, token: c1.token, expect: 400 });
  await test("Delivered 8 days ago -> 409 (window ended)", "POST", ret(pOld.id), { body: good, token: c1.token, expect: 409 });
  await test("Not delivered -> 409", "POST", ret(pRebookable.id), { body: good, token: c1.token, expect: 409 });

  // ===================================================================
  section("7. Return request -> pickup -> returned to sender");
  await test("Request return (Damaged, tomorrow 11AM)", "POST", ret(pD.id), {
    body: good,
    token: c1.token,
    expect: 201,
    verify: (d) => {
      if (!d.steps.includes("Return Requested Successfully")) return "step missing";
      if (!["PICKUP_ASSIGNED", "RETURN_REQUESTED"].includes(d.parcel.status)) return `status ${d.parcel.status}`;
      return true;
    },
  });
  const pickupRow = await prisma.assignment.findFirst({ where: { parcelId: pD.id, status: "ACTIVE" } });
  check("AI created a PICKUP assignment", pickupRow?.jobType === "PICKUP");

  await test("Second return request -> 409 (one per parcel)", "POST", ret(pD.id), {
    body: good,
    token: c1.token,
    expect: 409,
  });
  await test("Customer actions: can cancel, cannot request again", "GET", `/api/customer/parcels/${pD.id}`, {
    token: c1.token,
    expect: 200,
    verify: (d) =>
      (d.parcel.actions.canCancelReturn && !d.parcel.actions.canRequestReturn && d.parcel.customerReturnReasonLabel === "Parcel damaged") ||
      JSON.stringify(d.parcel.actions),
  });
  await test("Admin got 'New Return Request'", "GET", "/api/notifications", {
    token: adminToken,
    expect: 200,
    verify: (d) => d.notifications.some((x) => x.parcel?.id === pD.id && x.title === "New Return Request") || "missing",
  });

  const pickupDpId = await moveToToday(pD.id);
  const pickupToken = tokens[pickupDpId];
  check("Pickup assigned to a seeded delivery person", !!pickupToken);

  const pickupNote = await prisma.notification.count({
    where: { userId: pickupDpId, parcelId: pD.id, title: "New Pickup Assigned" },
  });
  check("Delivery person got 'New Pickup Assigned'", pickupNote === 1);

  await test("Delivery list shows a PICKUP job", "GET", "/api/delivery/parcels", {
    token: pickupToken,
    expect: 200,
    verify: (d) => {
      const x = d.deliveries.find((y) => y.parcel.id === pD.id);
      if (!x) return "pickup missing";
      return (x.jobType === "PICKUP" && x.deliveryStatus === "PICKUP_ASSIGNED" && x.returnReasonLabel === "Parcel damaged") ||
        JSON.stringify(x);
    },
  });

  await test("Start pickup", "PATCH", del(pD.id, "start"), {
    token: pickupToken,
    expect: 200,
    verify: (d) => (d.jobType === "PICKUP" && d.parcel.status === "OUT_FOR_PICKUP") || "not out for pickup",
  });
  await test("Cancel while out for pickup -> 409", "POST", `/api/customer/parcels/${pD.id}/cancel-return`, {
    token: c1.token,
    expect: 409,
  });
  await test("Complete pickup -> RETURNED_TO_SENDER", "PATCH", del(pD.id, "complete"), {
    token: pickupToken,
    expect: 200,
    verify: (d) =>
      (d.parcel.status === "RETURNED_TO_SENDER" && d.parcel.returnReason === "CUSTOMER_RETURN") || "not returned",
  });
  const doneRow = await prisma.assignment.findFirst({ where: { parcelId: pD.id, jobType: "PICKUP" } });
  check("Pickup assignment COMPLETED", doneRow.status === "COMPLETED");
  await test("Customer told 'Return Picked Up'", "GET", "/api/notifications", {
    token: c1.token,
    expect: 200,
    verify: (d) => d.notifications.some((x) => x.parcel?.id === pD.id && x.title === "Return Picked Up") || "missing",
  });
  await test("Delivery list shows PICKED_UP", "GET", "/api/delivery/parcels", {
    token: pickupToken,
    expect: 200,
    verify: (d) => d.deliveries.some((x) => x.parcel.id === pD.id && x.deliveryStatus === "PICKED_UP") || "missing",
  });

  // ===================================================================
  section("8. Failed pickups -> rebook -> cancelled after 2");
  const pD2 = await makeParcel(c1, { status: "DELIVERED", deliveredAt: new Date(Date.now() - DAY) });
  await request("POST", ret(pD2.id), { reason: "NOT_NEEDED", date: tomorrow, hour: 12 }, c1.token);

  let dpId2 = await moveToToday(pD2.id);
  await request("PATCH", del(pD2.id, "start"), null, tokens[dpId2]);
  await test("1st pickup failure -> PICKUP_FAILED", "PATCH", del(pD2.id, "fail"), {
    body: { reason: "PREMISES_LOCKED" },
    token: tokens[dpId2],
    expect: 200,
    verify: (d) => (d.parcel.status === "PICKUP_FAILED" && d.attempt === 1 && !d.returnCancelled) || "wrong state",
  });
  await test("Customer can rebook pickup (1 attempt left)", "GET", `/api/customer/parcels/${pD2.id}`, {
    token: c1.token,
    expect: 200,
    verify: (d) =>
      (d.parcel.actions.canRebookPickup && d.parcel.actions.pickupAttemptsLeft === 1) || JSON.stringify(d.parcel.actions),
  });
  await test("Rebook pickup on a returned parcel -> 409", "POST", `/api/customer/parcels/${pD.id}/pickup-slot`, {
    body: { date: tomorrow, hour: 13 },
    token: c1.token,
    expect: 409,
  });
  await test("Rebook pickup tomorrow 1PM", "POST", `/api/customer/parcels/${pD2.id}/pickup-slot`, {
    body: { date: tomorrow, hour: 13 },
    token: c1.token,
    expect: 201,
    verify: (d) => (d.steps.includes("Pickup Slot Booked Successfully") && d.parcel.slotHour === 13) || "not rebooked",
  });

  dpId2 = await moveToToday(pD2.id);
  await request("PATCH", del(pD2.id, "start"), null, tokens[dpId2]);
  await test("2nd pickup failure -> return cancelled", "PATCH", del(pD2.id, "fail"), {
    body: { reason: "CUSTOMER_NOT_AVAILABLE" },
    token: tokens[dpId2],
    expect: 200,
    verify: (d) => (d.returnCancelled === true && d.parcel.status === "DELIVERED") || "not cancelled",
  });
  await test("Cannot request a return again", "GET", `/api/customer/parcels/${pD2.id}`, {
    token: c1.token,
    expect: 200,
    verify: (d) => (!d.parcel.actions.canRequestReturn && !!d.parcel.returnCancelledAt) || JSON.stringify(d.parcel.actions),
  });

  // ===================================================================
  section("9. Customer cancels a return");
  const pD3 = await makeParcel(c1, { status: "DELIVERED", deliveredAt: new Date() });
  await request("POST", ret(pD3.id), { reason: "WRONG_ITEM", date: tomorrow, hour: 14 }, c1.token);
  const before = await prisma.parcel.findUnique({ where: { id: pD3.id } });

  await test("Other customer cannot cancel -> 404", "POST", `/api/customer/parcels/${pD3.id}/cancel-return`, {
    token: c2.token,
    expect: 404,
  });
  await test("Cancel return", "POST", `/api/customer/parcels/${pD3.id}/cancel-return`, {
    token: c1.token,
    expect: 200,
    verify: (d) => d.parcel.status === "DELIVERED" || `status ${d.parcel.status}`,
  });
  const cancelledRow = await prisma.assignment.findFirst({ where: { parcelId: pD3.id } });
  if (cancelledRow) check("Pickup assignment CANCELLED", cancelledRow.status === "CANCELLED");
  if (before.assignedToId) {
    const told = await prisma.notification.count({
      where: { userId: before.assignedToId, parcelId: pD3.id, title: "Pickup Cancelled" },
    });
    check("Pickup partner told 'Pickup Cancelled'", told === 1);
  }
  await test("Cancel again -> 409", "POST", `/api/customer/parcels/${pD3.id}/cancel-return`, {
    token: c1.token,
    expect: 409,
  });
  await test("Request again after cancel -> 409", "POST", ret(pD3.id), {
    body: { reason: "WRONG_ITEM", date: tomorrow, hour: 15 },
    token: c1.token,
    expect: 409,
  });

  // ===================================================================
  section("10. Admin views");
  await test("Returns page data", "GET", "/api/admin/returns", {
    token: adminToken,
    expect: 200,
    verify: (d) =>
      (Array.isArray(d.awaitingCollection) && Array.isArray(d.activeReturns) &&
        d.returnedToSender.some((x) => x.id === pD.id) && d.rtsReasons.CUSTOMER_RETURN) || "lists missing",
  });
  await test("Returns page as delivery person -> 403", "GET", "/api/admin/returns", { token: dp4Token, expect: 403 });
  await test("Parcels filter status=RETURNED_TO_SENDER works", "GET", "/api/admin/parcels?status=RETURNED_TO_SENDER", {
    token: adminToken,
    expect: 200,
    verify: (d) => d.parcels.every((p) => p.status === "RETURNED_TO_SENDER") || "filter wrong",
  });
  await test("Admin parcel detail shows PICKUP job type in history", "GET", `/api/admin/parcels/${pD.id}`, {
    token: adminToken,
    expect: 200,
    verify: (d) => d.parcel.assignments.some((a) => a.jobType === "PICKUP") || "jobType missing",
  });
  await test("Dashboard has 12 statuses + returns section", "GET", "/api/admin/dashboard", {
    token: adminToken,
    expect: 200,
    verify: (d) =>
      (Object.keys(d.pipeline).length === 12 && typeof d.returns?.returnedToSender === "number") || "dashboard missing returns",
  });
  await test("Job status shows overdueCollections", "GET", "/api/admin/jobs/auto-book/status", {
    token: adminToken,
    expect: 200,
    verify: (d) => typeof d.overdueCollections === "number" || "missing",
  });
}

// ---------- cleanup + summary ----------

async function cleanup() {
  if (toRestore.size) {
    await prisma.user.updateMany({ where: { id: { in: [...toRestore] } }, data: { isActive: true } }).catch(() => {});
    console.log(`\nRestored ${toRestore.size} delivery person(s).`);
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
      console.log("All Returns checks passed ✅");
    }
    console.log("==============================\n");
  }
})();