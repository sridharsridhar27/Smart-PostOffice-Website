/**
 * Step 3 API verification script (slot booking)
 * Checks: availability, booking rules, double booking, notifications,
 *         admin slot bookings view, day-full rule, role protection.
 *
 * Usage (server must be running in another terminal with `npm run dev`):
 *   node tests/verify-step3.js          -> runs tests, then deletes test data
 *   node tests/verify-step3.js --keep   -> runs tests, keeps test data in DB
 */

require("dotenv").config();
const prisma = require("../src/config/prisma");

const BASE_URL = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const KEEP_DATA = process.argv.includes("--keep");
const ADMIN = { email: "admin@postoffice.com", password: "admin123" };

let passed = 0;
let failed = 0;
const failures = [];
const createdEmails = [];
let deactivatedDpIds = [];

const stamp = Date.now();
const randomPhone = () => "9" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");

// ---------- IST date helpers (same logic as the backend) ----------

const getISTNow = () => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
};

const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ---------- HTTP helpers ----------

async function request(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE_URL + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
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
    failed++;
    failures.push(name);
    console.log(`  ❌ ${name}\n     Request failed: ${err.message}`);
    return { status: 0, data: null };
  }

  let ok = res.status === expect;
  let reason = ok ? "" : `expected status ${expect}, got ${res.status}`;

  if (ok && verify) {
    let result;
    try {
      result = verify(res.data);
    } catch (err) {
      result = `verify crashed: ${err.message}`;
    }
    if (result !== true) {
      ok = false;
      reason = result || "response data check failed";
    }
  }

  if (ok) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ❌ ${name}\n     ${reason}\n     Response: ${JSON.stringify(res.data)}`);
  }
  return res;
}

const section = (t) => console.log(`\n${t}`);

async function registerCustomer(label, area, street) {
  const c = {
    name: `Step3 ${label}`,
    email: `step3_${label.toLowerCase()}_${stamp}@test.com`,
    phone: randomPhone(),
    password: "cust123",
    addressLine: "No 9",
    areaId: area.id,
    streetId: street.id,
  };
  createdEmails.push(c.email);
  const res = await request("POST", "/api/auth/register", c);
  return { ...c, token: res.data?.token, id: res.data?.user?.id };
}

async function createParcel(adminToken, phone, suffix) {
  const res = await request(
    "POST",
    "/api/admin/parcels",
    { trackingNumber: `S3${stamp}${suffix}`, phone },
    adminToken
  );
  return res.data?.parcel;
}

// ---------- tests ----------

async function run() {
  console.log(`Testing API at ${BASE_URL}`);

  try {
    await fetch(`${BASE_URL}/api/health`);
  } catch {
    console.log("\n❌ Server is not running. Start it first with: npm run dev\n");
    process.exitCode = 1;
    return;
  }

  const now = getISTNow();
  const today = now.dateStr;
  const tomorrow = addDays(today, 1);
  const dayAfter = addDays(today, 2);

  // ===== Setup =====
  section("0. Setup");

  const adminLogin = await request("POST", "/api/auth/login", ADMIN);
  const adminToken = adminLogin.data?.token;
  const areasRes = await request("GET", "/api/areas");
  const area = areasRes.data?.areas?.find((a) => a.streets.length > 0);

  const c1 = await registerCustomer("Customer1", area, area.streets[0]);
  const c2 = await registerCustomer("Customer2", area, area.streets[0]);

  const p1 = await createParcel(adminToken, c1.phone, "A");
  const p2 = await createParcel(adminToken, c1.phone, "B");
  const p3 = await createParcel(adminToken, c2.phone, "C");

  if (adminToken && c1.token && c2.token && p1 && p2 && p3) {
    passed++;
    console.log("  ✅ Admin login, 2 customers, 3 parcels created");
  } else {
    failed++;
    failures.push("Setup");
    console.log("  ❌ Setup failed. Stopping.");
    return;
  }

  const activeDpCount = await prisma.user.count({ where: { role: "DELIVERY", isActive: true } });

  // ===== Availability =====
  section("1. Slot availability");

  await test("Availability without token -> 401", "GET", "/api/customer/slots/availability", {
    expect: 401,
  });

  await test("Availability as admin -> 403", "GET", "/api/customer/slots/availability", {
    token: adminToken,
    expect: 403,
  });

  const availBefore = await test("Availability returns today + 3 days", "GET", "/api/customer/slots/availability", {
    token: c1.token,
    expect: 200,
    verify: (d) => {
      if (d.days?.length !== 4) return `expected 4 days, got ${d.days?.length}`;
      const expected = [today, tomorrow, dayAfter, addDays(today, 3)];
      const got = d.days.map((x) => x.date);
      if (JSON.stringify(got) !== JSON.stringify(expected)) return `dates wrong: ${got.join(", ")}`;
      if (!d.days[0].isToday) return "first day should be today";
      return true;
    },
  });

  await test("Each day has 8 slots (9 AM to 5 PM)", "GET", "/api/customer/slots/availability", {
    token: c1.token,
    expect: 200,
    verify: (d) => {
      for (const day of d.days) {
        const hours = day.slots.map((s) => s.hour);
        if (JSON.stringify(hours) !== JSON.stringify([9, 10, 11, 12, 13, 14, 15, 16])) {
          return `slot hours wrong on ${day.date}`;
        }
      }
      if (d.days[1].slots[1].label !== "10:00 AM - 11:00 AM") return `label wrong: ${d.days[1].slots[1].label}`;
      return true;
    },
  });

  await test(`Day capacity = active delivery persons (${activeDpCount}) × 6`, "GET",
    "/api/customer/slots/availability", {
      token: c1.token,
      expect: 200,
      verify: (d) => d.days.every((x) => x.capacity === activeDpCount * 6) || "capacity wrong",
    });

  await test("Today's past / too-soon slots are unavailable", "GET", "/api/customer/slots/availability", {
    token: c1.token,
    expect: 200,
    verify: (d) => {
      for (const s of d.days[0].slots) {
        const tooSoon = s.hour * 60 < now.minutes + 60;
        if (tooSoon && (s.available || s.reason !== "Time passed")) {
          return `slot ${s.hour} should be 'Time passed'`;
        }
      }
      return true;
    },
  });

  await test("Tomorrow's slots are all available", "GET", "/api/customer/slots/availability", {
    token: c1.token,
    expect: 200,
    verify: (d) => {
      const day = d.days[1];
      if (day.full) return "tomorrow is already full (real bookings?)";
      return day.slots.every((s) => s.available) || "some tomorrow slots unavailable";
    },
  });

  const tomorrowBefore = availBefore.data?.days?.[1];

  // ===== Booking validation =====
  section("2. Booking validation");

  const bookPath = (id) => `/api/customer/parcels/${id}/book-slot`;

  await test("Book without token -> 401", "POST", bookPath(p1.id), {
    body: { date: tomorrow, hour: 10 },
    expect: 401,
  });

  await test("Book as admin -> 403", "POST", bookPath(p1.id), {
    body: { date: tomorrow, hour: 10 },
    token: adminToken,
    expect: 403,
  });

  await test("Invalid parcel id -> 400", "POST", bookPath("abc"), {
    body: { date: tomorrow, hour: 10 },
    token: c1.token,
    expect: 400,
  });

  await test("Invalid date format -> 400", "POST", bookPath(p1.id), {
    body: { date: "26-10-2026", hour: 10 },
    token: c1.token,
    expect: 400,
  });

  await test("Impossible date (Feb 30) -> 400", "POST", bookPath(p1.id), {
    body: { date: "2030-02-30", hour: 10 },
    token: c1.token,
    expect: 400,
  });

  await test("Past date (yesterday) -> 400", "POST", bookPath(p1.id), {
    body: { date: addDays(today, -1), hour: 10 },
    token: c1.token,
    expect: 400,
  });

  await test("Too far ahead (today + 4) -> 400", "POST", bookPath(p1.id), {
    body: { date: addDays(today, 4), hour: 10 },
    token: c1.token,
    expect: 400,
  });

  await test("Hour before 9 AM -> 400", "POST", bookPath(p1.id), {
    body: { date: tomorrow, hour: 8 },
    token: c1.token,
    expect: 400,
  });

  await test("Hour 17 (after closing) -> 400", "POST", bookPath(p1.id), {
    body: { date: tomorrow, hour: 17 },
    token: c1.token,
    expect: 400,
  });

  await test("Non-number hour -> 400", "POST", bookPath(p1.id), {
    body: { date: tomorrow, hour: "ten" },
    token: c1.token,
    expect: 400,
  });

  const tooSoonHour = [9, 10, 11, 12, 13, 14, 15, 16].find((h) => h * 60 < now.minutes + 60);
  if (tooSoonHour) {
    await test(`Today's too-soon slot (${tooSoonHour}:00) -> 400`, "POST", bookPath(p1.id), {
      body: { date: today, hour: tooSoonHour },
      token: c1.token,
      expect: 400,
    });
  } else {
    console.log("  ⏭  Skipped too-soon test (it's before 8 AM, all today's slots are open)");
  }

  await test("Book another customer's parcel -> 404", "POST", bookPath(p3.id), {
    body: { date: tomorrow, hour: 10 },
    token: c1.token,
    expect: 404,
  });

  // ===== Successful booking =====
  section("3. Successful booking");

  await test("Book tomorrow 10-11 for parcel 1", "POST", bookPath(p1.id), {
    body: { date: tomorrow, hour: 10 },
    token: c1.token,
    expect: 201,
    verify: (d) => {
      if (d.parcel?.status !== "SLOT_BOOKED") return `status should be SLOT_BOOKED, got ${d.parcel?.status}`;
      if (d.parcel?.slotHour !== 10) return "slotHour not 10";
      if (d.parcel?.slotDate?.slice(0, 10) !== tomorrow) return `slotDate wrong: ${d.parcel?.slotDate}`;
      if (d.parcel?.slotAutoBooked !== false) return "slotAutoBooked should be false";
      if (!d.parcel?.slotBookedAt) return "slotBookedAt missing";
      if (d.slot?.label !== "10:00 AM - 11:00 AM") return "slot label wrong";
      if (!d.steps?.includes("Delivery Slot Booked Successfully")) return "steps missing";
      return true;
    },
  });

  await test("Book same parcel again -> 409", "POST", bookPath(p1.id), {
    body: { date: dayAfter, hour: 11 },
    token: c1.token,
    expect: 409,
  });

  await test("Book parcel 2 in the same slot (no per-slot limit)", "POST", bookPath(p2.id), {
    body: { date: tomorrow, hour: 10 },
    token: c1.token,
    expect: 201,
  });

  await test("Customer2 books parcel 3 day-after 2-3 PM", "POST", bookPath(p3.id), {
    body: { date: dayAfter, hour: 14 },
    token: c2.token,
    expect: 201,
  });

  // ===== After booking =====
  section("4. After booking");

  await test("Customer parcel shows slot fields", "GET", `/api/customer/parcels/${p1.id}`, {
    token: c1.token,
    expect: 200,
    verify: (d) =>
      (d.parcel?.slotHour === 10 && d.parcel?.slotDate?.slice(0, 10) === tomorrow) || "slot fields missing",
  });

  await test("Status history: REGISTERED -> NOTIFIED -> SLOT_BOOKED", "GET", `/api/customer/parcels/${p1.id}`, {
    token: c1.token,
    expect: 200,
    verify: (d) => {
      const statuses = d.parcel.statusHistory.map((h) => h.status).join(",");
      return statuses === "REGISTERED,NOTIFIED,SLOT_BOOKED" || `history: ${statuses}`;
    },
  });

  await test("Customer got 'Delivery Slot Booked' notification", "GET", "/api/notifications", {
    token: c1.token,
    expect: 200,
    verify: (d) =>
      d.notifications.some((n) => n.type === "SLOT_BOOKED" && n.parcel?.id === p1.id) ||
      "slot booked notification missing",
  });

  await test("Admin got 'New Slot Booking' notification", "GET", "/api/notifications", {
    token: adminToken,
    expect: 200,
    verify: (d) =>
      d.notifications.some(
        (n) => n.type === "SLOT_BOOKED" && n.title === "New Slot Booking" && n.parcel?.id === p1.id
      ) || "admin notification missing",
  });

  await test("Availability: tomorrow booked +2, slot 10 count +2", "GET", "/api/customer/slots/availability", {
    token: c1.token,
    expect: 200,
    verify: (d) => {
      const day = d.days[1];
      if (day.booked !== tomorrowBefore.booked + 2) {
        return `booked expected ${tomorrowBefore.booked + 2}, got ${day.booked}`;
      }
      const s10 = day.slots.find((s) => s.hour === 10);
      const s10Before = tomorrowBefore.slots.find((s) => s.hour === 10);
      if (s10.bookedCount !== s10Before.bookedCount + 2) return "slot 10 count wrong";
      if (!s10.available) return "slot 10 should still be available (no per-slot limit)";
      return true;
    },
  });

  // ===== Admin slot bookings =====
  section("5. Admin slot bookings");

  await test("Slot bookings as customer -> 403", "GET", `/api/admin/slot-bookings?date=${tomorrow}`, {
    token: c1.token,
    expect: 403,
  });

  await test("Slot bookings invalid date -> 400", "GET", "/api/admin/slot-bookings?date=tomorrow", {
    token: adminToken,
    expect: 400,
  });

  await test("Slot bookings default to today", "GET", "/api/admin/slot-bookings", {
    token: adminToken,
    expect: 200,
    verify: (d) => (d.date === today && d.slots.length === 8) || `date ${d.date}, slots ${d.slots?.length}`,
  });

  await test("Tomorrow's 10-11 slot lists both parcels with customer details", "GET",
    `/api/admin/slot-bookings?date=${tomorrow}`, {
      token: adminToken,
      expect: 200,
      verify: (d) => {
        const slot = d.slots.find((s) => s.hour === 10);
        const ids = slot.parcels.map((p) => p.id);
        if (!ids.includes(p1.id) || !ids.includes(p2.id)) return "parcels missing from slot 10";
        const p = slot.parcels.find((x) => x.id === p1.id);
        if (!p.customer?.street?.name || !p.customer?.area?.name) return "customer address missing";
        if (d.capacity !== activeDpCount * 6) return "capacity wrong";
        return true;
      },
    });

  await test("Day-after's 2-3 PM slot lists parcel 3", "GET", `/api/admin/slot-bookings?date=${dayAfter}`, {
    token: adminToken,
    expect: 200,
    verify: (d) => d.slots.find((s) => s.hour === 14).parcels.some((p) => p.id === p3.id) || "parcel 3 missing",
  });

  // ===== Day full rule =====
  section("6. Day-full rule (temporarily 0 active delivery persons)");

  const p4 = await createParcel(adminToken, c2.phone, "D");

  const dps = await prisma.user.findMany({
    where: { role: "DELIVERY", isActive: true },
    select: { id: true },
  });
  deactivatedDpIds = dps.map((d) => d.id);
  await prisma.user.updateMany({ where: { id: { in: deactivatedDpIds } }, data: { isActive: false } });

  await test("All days show full when capacity is 0", "GET", "/api/customer/slots/availability", {
    token: c2.token,
    expect: 200,
    verify: (d) =>
      d.days.every((day) => day.full && day.slots.every((s) => !s.available)) || "days should be full",
  });

  await test("Booking on a full day -> 409", "POST", bookPath(p4.id), {
    body: { date: tomorrow, hour: 15 },
    token: c2.token,
    expect: 409,
  });

  await prisma.user.updateMany({ where: { id: { in: deactivatedDpIds } }, data: { isActive: true } });
  deactivatedDpIds = [];

  await test("After restoring delivery persons, booking works again", "POST", bookPath(p4.id), {
    body: { date: tomorrow, hour: 15 },
    token: c2.token,
    expect: 201,
  });
}

// ---------- cleanup + summary ----------

async function cleanup() {
  // Always restore delivery persons if a crash happened mid-test
  if (deactivatedDpIds.length) {
    await prisma.user
      .updateMany({ where: { id: { in: deactivatedDpIds } }, data: { isActive: true } })
      .catch(() => {});
    console.log("\nRestored delivery persons to active.");
  }

  if (KEEP_DATA) {
    console.log("\n(--keep) Test data left in the database.");
    return;
  }

  try {
    const users = await prisma.user.findMany({
      where: { email: { in: createdEmails } },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    const parcels = await prisma.parcel.deleteMany({ where: { customerId: { in: ids } } });
    const deletedUsers = await prisma.user.deleteMany({ where: { id: { in: ids } } });
    console.log(`\nCleanup: removed ${parcels.count} test parcels, ${deletedUsers.count} test users.`);
  } catch (err) {
    console.log(`\nCleanup failed: ${err.message}`);
  }
}

(async () => {
  try {
    await run();
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
    } else if (total > 0) {
      console.log("All Step 3 checks passed ✅");
    }
    console.log("==============================\n");
  }
})();