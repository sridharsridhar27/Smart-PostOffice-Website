/**
 * Step 2 API verification script
 * Checks: customer lookup, parcel scan/register, auto notification,
 *         admin parcel list/detail, customer parcels, notification APIs,
 *         role protection and validation errors.
 *
 * Usage (server must be running in another terminal with `npm run dev`):
 *   node tests/verify-step2.js          -> runs tests, then deletes test data
 *   node tests/verify-step2.js --keep   -> runs tests, keeps test data in DB
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

const stamp = Date.now();
const randomPhone = () => "9" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");

// ---------- helpers ----------

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
    name: `Step2 ${label}`,
    email: `step2_${label.toLowerCase()}_${stamp}@test.com`,
    phone: randomPhone(),
    password: "cust123",
    addressLine: "No 7",
    areaId: area.id,
    streetId: street.id,
  };
  createdEmails.push(c.email);
  const res = await request("POST", "/api/auth/register", c);
  return { ...c, token: res.data?.token, id: res.data?.user?.id };
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

  // ===== Setup =====
  section("0. Setup");

  const adminLogin = await test("Login as admin", "POST", "/api/auth/login", {
    body: ADMIN,
    expect: 200,
  });
  const adminToken = adminLogin.data?.token;

  const areasRes = await request("GET", "/api/areas");
  const area = areasRes.data?.areas?.find((a) => a.streets.length > 0);
  if (!adminToken || !area) {
    console.log("\n❌ Setup failed (admin login or areas). Stopping.\n");
    process.exitCode = 1;
    return;
  }

  const c1 = await registerCustomer("Customer1", area, area.streets[0]);
  const c2 = await registerCustomer("Customer2", area, area.streets[0]);

  if (c1.token && c2.token) {
    passed++;
    console.log("  ✅ Two test customers registered");
  } else {
    failed++;
    failures.push("Register test customers");
    console.log("  ❌ Could not register test customers. Stopping.");
    return;
  }

  const dpLogin = await request("POST", "/api/auth/login", {
    email: "dp1@postoffice.com",
    password: "dp1234",
  });
  const dpToken = dpLogin.data?.token;

  // ===== Customer lookup =====
  section("1. Customer lookup by phone (admin)");

  await test("Lookup without token -> 401", "GET", `/api/admin/customers/lookup?phone=${c1.phone}`, {
    expect: 401,
  });

  await test("Lookup as customer -> 403", "GET", `/api/admin/customers/lookup?phone=${c1.phone}`, {
    token: c1.token,
    expect: 403,
  });

  await test("Lookup with invalid phone -> 400", "GET", "/api/admin/customers/lookup?phone=123", {
    token: adminToken,
    expect: 400,
  });

  await test("Lookup unknown phone -> 404", "GET", "/api/admin/customers/lookup?phone=6000000001", {
    token: adminToken,
    expect: 404,
  });

  await test("Lookup delivery person's phone -> 404 (customers only)", "GET",
    "/api/admin/customers/lookup?phone=9100000001", {
      token: adminToken,
      expect: 404,
    });

  await test("Lookup registered customer", "GET", `/api/admin/customers/lookup?phone=${c1.phone}`, {
    token: adminToken,
    expect: 200,
    verify: (d) => {
      if (d.customer?.name !== "Step2 Customer1") return "wrong customer returned";
      if (!d.customer?.area?.name || !d.customer?.street?.name) return "area/street missing";
      if ("password" in d.customer) return "password must NOT be returned";
      return true;
    },
  });

  // ===== Parcel registration =====
  section("2. Parcel scan & register (admin)");

  const tn1 = `tn${stamp}a`; // lowercase on purpose -> should be saved uppercase
  const tn2 = `TN${stamp}B`;

  await test("Register parcel as customer -> 403", "POST", "/api/admin/parcels", {
    body: { trackingNumber: tn1, phone: c1.phone },
    token: c1.token,
    expect: 403,
  });

  await test("Missing tracking number -> 400", "POST", "/api/admin/parcels", {
    body: { phone: c1.phone },
    token: adminToken,
    expect: 400,
  });

  await test("Missing phone -> 400", "POST", "/api/admin/parcels", {
    body: { trackingNumber: tn1 },
    token: adminToken,
    expect: 400,
  });

  await test("Invalid tracking number characters -> 400", "POST", "/api/admin/parcels", {
    body: { trackingNumber: "AB#12$", phone: c1.phone },
    token: adminToken,
    expect: 400,
  });

  await test("Invalid parcel type -> 400", "POST", "/api/admin/parcels", {
    body: { trackingNumber: tn1, phone: c1.phone, parcelType: "HUGE" },
    token: adminToken,
    expect: 400,
  });

  await test("Negative weight -> 400", "POST", "/api/admin/parcels", {
    body: { trackingNumber: tn1, phone: c1.phone, weight: -2 },
    token: adminToken,
    expect: 400,
  });

  await test("Unknown customer phone -> 404", "POST", "/api/admin/parcels", {
    body: { trackingNumber: tn1, phone: "6000000001" },
    token: adminToken,
    expect: 404,
  });

  const p1Res = await test("Register parcel (valid, defaults)", "POST", "/api/admin/parcels", {
    body: { trackingNumber: tn1, phone: c1.phone, senderName: "Amazon" },
    token: adminToken,
    expect: 201,
    verify: (d) => {
      const p = d.parcel;
      if (p?.trackingNumber !== tn1.toUpperCase()) return "tracking number should be saved in uppercase";
      if (p?.status !== "NOTIFIED") return `status should be NOTIFIED, got ${p?.status}`;
      if (p?.parcelType !== "SMALL") return "default parcelType should be SMALL";
      if (p?.customer?.id !== c1.id) return "linked to wrong customer";
      if (!Array.isArray(d.steps) || d.steps.length !== 2) return "steps list missing";
      return true;
    },
  });
  const p1Id = p1Res.data?.parcel?.id;

  await test("Same tracking number again (different case) -> 409", "POST", "/api/admin/parcels", {
    body: { trackingNumber: tn1.toUpperCase(), phone: c1.phone },
    token: adminToken,
    expect: 409,
  });

  const p2Res = await test("Register second parcel (LARGE, 2.5kg)", "POST", "/api/admin/parcels", {
    body: { trackingNumber: tn2, phone: c1.phone, parcelType: "LARGE", weight: "2.5" },
    token: adminToken,
    expect: 201,
    verify: (d) =>
      (d.parcel?.parcelType === "LARGE" && d.parcel?.weight === 2.5) || "type/weight not saved correctly",
  });
  const p2Id = p2Res.data?.parcel?.id;

  // ===== Admin parcel list & detail =====
  section("3. Admin parcel list & detail");

  await test("List parcels includes new parcels", "GET", "/api/admin/parcels", {
    token: adminToken,
    expect: 200,
    verify: (d) => {
      const ids = d.parcels.map((p) => p.id);
      return (ids.includes(p1Id) && ids.includes(p2Id)) || "new parcels not in list";
    },
  });

  await test("Filter by status=NOTIFIED", "GET", "/api/admin/parcels?status=NOTIFIED", {
    token: adminToken,
    expect: 200,
    verify: (d) =>
      (d.parcels.every((p) => p.status === "NOTIFIED") && d.parcels.some((p) => p.id === p1Id)) ||
      "filter not working",
  });

  await test("Invalid status filter -> 400", "GET", "/api/admin/parcels?status=LOST", {
    token: adminToken,
    expect: 400,
  });

  await test("Search by tracking number (lowercase)", "GET", `/api/admin/parcels?search=${tn2.toLowerCase()}`, {
    token: adminToken,
    expect: 200,
    verify: (d) => (d.parcels.length === 1 && d.parcels[0].id === p2Id) || "search by tracking failed",
  });

  await test("Search by customer phone", "GET", `/api/admin/parcels?search=${c1.phone}`, {
    token: adminToken,
    expect: 200,
    verify: (d) => d.parcels.length === 2 || `expected 2 parcels, got ${d.parcels.length}`,
  });

  await test("Parcel detail has status history (REGISTERED -> NOTIFIED)", "GET", `/api/admin/parcels/${p1Id}`, {
    token: adminToken,
    expect: 200,
    verify: (d) => {
      const h = d.parcel?.statusHistory || [];
      if (h.length !== 2) return `expected 2 history entries, got ${h.length}`;
      if (h[0].status !== "REGISTERED" || h[1].status !== "NOTIFIED") return "history order wrong";
      if (h[0].changedBy?.role !== "ADMIN") return "REGISTERED entry should be by admin";
      return true;
    },
  });

  await test("Parcel detail not found -> 404", "GET", "/api/admin/parcels/999999", {
    token: adminToken,
    expect: 404,
  });

  await test("Parcel detail invalid id -> 400", "GET", "/api/admin/parcels/abc", {
    token: adminToken,
    expect: 400,
  });

  // ===== Notifications =====
  section("4. Notifications (bell)");

  await test("Notifications without token -> 401", "GET", "/api/notifications", { expect: 401 });

  await test("Customer1 unread count = 2", "GET", "/api/notifications/unread-count", {
    token: c1.token,
    expect: 200,
    verify: (d) => d.unreadCount === 2 || `expected 2, got ${d.unreadCount}`,
  });

  const notifRes = await test("Customer1 notification list", "GET", "/api/notifications", {
    token: c1.token,
    expect: 200,
    verify: (d) => {
      if (d.notifications.length !== 2) return `expected 2 notifications, got ${d.notifications.length}`;
      const n = d.notifications.find((x) => x.parcel?.id === p1Id);
      if (!n) return "notification for parcel 1 missing";
      if (n.type !== "PARCEL_ARRIVED") return "type should be PARCEL_ARRIVED";
      if (!n.message.includes(tn1.toUpperCase())) return "message should contain tracking number";
      if (n.isRead) return "should be unread";
      return true;
    },
  });
  const c1NotifId = notifRes.data?.notifications?.[0]?.id;

  await test("Customer2 has 0 notifications", "GET", "/api/notifications/unread-count", {
    token: c2.token,
    expect: 200,
    verify: (d) => d.unreadCount === 0 || `expected 0, got ${d.unreadCount}`,
  });

  if (c1NotifId) {
    await test("Customer2 cannot mark Customer1's notification -> 404", "PATCH",
      `/api/notifications/${c1NotifId}/read`, {
        token: c2.token,
        expect: 404,
      });

    await test("Customer1 marks one notification as read", "PATCH", `/api/notifications/${c1NotifId}/read`, {
      token: c1.token,
      expect: 200,
    });

    await test("Customer1 unread count = 1", "GET", "/api/notifications/unread-count", {
      token: c1.token,
      expect: 200,
      verify: (d) => d.unreadCount === 1 || `expected 1, got ${d.unreadCount}`,
    });
  }

  await test("Mark invalid id -> 400", "PATCH", "/api/notifications/abc/read", {
    token: c1.token,
    expect: 400,
  });

  await test("Customer1 mark all as read", "PATCH", "/api/notifications/read-all", {
    token: c1.token,
    expect: 200,
    verify: (d) => d.updated === 1 || `expected 1 updated, got ${d.updated}`,
  });

  await test("Customer1 unread count = 0", "GET", "/api/notifications/unread-count", {
    token: c1.token,
    expect: 200,
    verify: (d) => d.unreadCount === 0 || `expected 0, got ${d.unreadCount}`,
  });

  await test("Admin can use notification API too", "GET", "/api/notifications/unread-count", {
    token: adminToken,
    expect: 200,
  });

  if (dpToken) {
    await test("Delivery person can use notification API too", "GET", "/api/notifications", {
      token: dpToken,
      expect: 200,
    });
  }

  // ===== Customer parcels =====
  section("5. Customer parcels");

  await test("Customer1 sees own 2 parcels", "GET", "/api/customer/parcels", {
    token: c1.token,
    expect: 200,
    verify: (d) => d.parcels.length === 2 || `expected 2, got ${d.parcels.length}`,
  });

  await test("Customer2 sees 0 parcels", "GET", "/api/customer/parcels", {
    token: c2.token,
    expect: 200,
    verify: (d) => d.parcels.length === 0 || `expected 0, got ${d.parcels.length}`,
  });

  await test("Customer1 parcel detail with history", "GET", `/api/customer/parcels/${p1Id}`, {
    token: c1.token,
    expect: 200,
    verify: (d) => d.parcel?.statusHistory?.length === 2 || "history missing",
  });

  await test("Customer2 cannot view Customer1's parcel -> 404", "GET", `/api/customer/parcels/${p1Id}`, {
    token: c2.token,
    expect: 404,
  });

  await test("Admin cannot use customer route -> 403", "GET", "/api/customer/parcels", {
    token: adminToken,
    expect: 403,
  });

  if (dpToken) {
    await test("Delivery person cannot register parcels -> 403", "POST", "/api/admin/parcels", {
      body: { trackingNumber: `X${stamp}`, phone: c1.phone },
      token: dpToken,
      expect: 403,
    });
  }
}

// ---------- cleanup + summary ----------

async function cleanup() {
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

    // Parcels first (history + notifications cascade), then users
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
      console.log("All Step 2 checks passed ✅");
    }
    console.log("==============================\n");
  }
})();