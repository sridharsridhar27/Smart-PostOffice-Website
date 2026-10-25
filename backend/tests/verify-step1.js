/**
 * Step 1 API verification script
 * Checks: health, areas, register, login, me, area/street creation,
 *         delivery person creation, role protection, validation errors.
 *
 * Usage (server must be running in another terminal with `npm run dev`):
 *   node tests/verify-step1.js          -> runs tests, then deletes test data
 *   node tests/verify-step1.js --keep   -> runs tests, keeps test data in DB
 *
 * Needs Node.js 18+ (uses built-in fetch).
 */

require("dotenv").config();
const prisma = require("../src/config/prisma");

const BASE_URL = process.env.TEST_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
const KEEP_DATA = process.argv.includes("--keep");

const ADMIN = { email: "admin@postoffice.com", password: "admin123" };

let passed = 0;
let failed = 0;
const failures = [];

const created = { userEmails: [], areaIds: [] };

// ---------- helpers ----------

const stamp = Date.now();
const randomPhone = () => "9" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");

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

/**
 * Runs one API test.
 * verify(data) must return true, or a string explaining what is wrong.
 */
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

function section(title) {
  console.log(`\n${title}`);
}

// ---------- tests ----------

async function run() {
  console.log(`Testing API at ${BASE_URL}`);

  // Server reachable?
  try {
    await fetch(`${BASE_URL}/api/health`);
  } catch {
    console.log("\n❌ Server is not running. Start it first with: npm run dev\n");
    process.exitCode = 1;
    return;
  }

  // ===== Health =====
  section("1. Health");
  await test("GET /api/health returns ok", "GET", "/api/health", {
    expect: 200,
    verify: (d) => d.status === "ok" || "status is not 'ok'",
  });

  // ===== Areas =====
  section("2. Areas (public)");
  const areasRes = await test("GET /api/areas returns areas with streets", "GET", "/api/areas", {
    expect: 200,
    verify: (d) => {
      if (!Array.isArray(d.areas) || d.areas.length < 3) return "expected at least 3 seeded areas";
      if (!d.areas.every((a) => Array.isArray(a.streets))) return "each area should have a streets array";
      return true;
    },
  });

  const areas = areasRes.data?.areas || [];
  const area1 = areas.find((a) => a.streets.length > 0);
  const otherArea = areas.find((a) => a.id !== area1?.id && a.streets.length > 0);

  if (!area1 || !otherArea) {
    console.log("\n❌ Need at least 2 areas with streets. Run: npx prisma db seed\n");
    process.exitCode = 1;
    return;
  }

  const street1 = area1.streets[0];
  const wrongStreet = otherArea.streets[0];

  // ===== Customer registration =====
  section("3. Customer registration");

  const customer = {
    name: "Test Customer",
    email: `customer_${stamp}@test.com`,
    phone: randomPhone(),
    password: "cust123",
    addressLine: "No 12",
    areaId: area1.id,
    streetId: street1.id,
  };
  created.userEmails.push(customer.email);

  await test("Register customer (valid)", "POST", "/api/auth/register", {
    body: customer,
    expect: 201,
    verify: (d) => {
      if (!d.token) return "no token returned";
      if (d.user?.role !== "CUSTOMER") return "role should be CUSTOMER";
      if (d.user?.area?.id !== area1.id) return "area not linked correctly";
      if (d.user?.street?.id !== street1.id) return "street not linked correctly";
      if ("password" in d.user) return "password must NOT be returned";
      return true;
    },
  });

  await test("Register with same phone -> 409", "POST", "/api/auth/register", {
    body: { ...customer, email: `other_${stamp}@test.com` },
    expect: 409,
  });

  await test("Register with same email -> 409", "POST", "/api/auth/register", {
    body: { ...customer, phone: randomPhone() },
    expect: 409,
  });

  await test("Register with street from another area -> 400", "POST", "/api/auth/register", {
    body: { ...customer, email: `x1_${stamp}@test.com`, phone: randomPhone(), streetId: wrongStreet.id },
    expect: 400,
  });

  await test("Register with missing fields -> 400", "POST", "/api/auth/register", {
    body: { name: "No Details" },
    expect: 400,
  });

  await test("Register with invalid phone -> 400", "POST", "/api/auth/register", {
    body: { ...customer, email: `x2_${stamp}@test.com`, phone: "12345" },
    expect: 400,
  });

  await test("Register with short password -> 400", "POST", "/api/auth/register", {
    body: { ...customer, email: `x3_${stamp}@test.com`, phone: randomPhone(), password: "123" },
    expect: 400,
  });

  // ===== Login =====
  section("4. Login");

  const adminLogin = await test("Login as admin", "POST", "/api/auth/login", {
    body: ADMIN,
    expect: 200,
    verify: (d) => (d.token && d.user?.role === "ADMIN") || "expected token and role ADMIN",
  });
  const adminToken = adminLogin.data?.token;

  await test("Login with wrong password -> 401", "POST", "/api/auth/login", {
    body: { email: ADMIN.email, password: "wrongpass" },
    expect: 401,
  });

  await test("Login with unknown email -> 401", "POST", "/api/auth/login", {
    body: { email: `nobody_${stamp}@test.com`, password: "whatever" },
    expect: 401,
  });

  await test("Login with missing fields -> 400", "POST", "/api/auth/login", {
    body: {},
    expect: 400,
  });

  const customerLogin = await test("Login as customer (email is case-insensitive)", "POST", "/api/auth/login", {
    body: { email: customer.email.toUpperCase(), password: customer.password },
    expect: 200,
    verify: (d) => d.user?.role === "CUSTOMER" || "role should be CUSTOMER",
  });
  const customerToken = customerLogin.data?.token;

  if (!adminToken || !customerToken) {
    console.log("\n❌ Could not get admin/customer tokens, stopping protected-route tests.\n");
    return;
  }

  // ===== Me =====
  section("5. GET /api/auth/me");

  await test("Me without token -> 401", "GET", "/api/auth/me", { expect: 401 });

  await test("Me with invalid token -> 401", "GET", "/api/auth/me", {
    token: "invalid.token.value",
    expect: 401,
  });

  await test("Me as admin", "GET", "/api/auth/me", {
    token: adminToken,
    expect: 200,
    verify: (d) => d.user?.role === "ADMIN" || "role should be ADMIN",
  });

  await test("Me as customer shows area & street names", "GET", "/api/auth/me", {
    token: customerToken,
    expect: 200,
    verify: (d) =>
      (d.user?.area?.name === area1.name && d.user?.street?.name === street1.name) ||
      "area/street names missing or wrong",
  });

  // ===== Area creation =====
  section("6. Create area (admin only)");

  const newAreaName = `Test Area ${stamp}`;

  await test("Create area without token -> 401", "POST", "/api/areas", {
    body: { name: newAreaName },
    expect: 401,
  });

  await test("Create area as customer -> 403", "POST", "/api/areas", {
    body: { name: newAreaName },
    token: customerToken,
    expect: 403,
  });

  await test("Create area with empty name -> 400", "POST", "/api/areas", {
    body: { name: "   " },
    token: adminToken,
    expect: 400,
  });

  const areaRes = await test("Create area as admin", "POST", "/api/areas", {
    body: { name: newAreaName },
    token: adminToken,
    expect: 201,
    verify: (d) => d.area?.name === newAreaName || "area name mismatch",
  });
  const newAreaId = areaRes.data?.area?.id;
  if (newAreaId) created.areaIds.push(newAreaId);

  await test("Create duplicate area -> 409", "POST", "/api/areas", {
    body: { name: newAreaName },
    token: adminToken,
    expect: 409,
  });

  // ===== Street creation =====
  section("7. Create street (admin only)");

  if (newAreaId) {
    await test("Create street as customer -> 403", "POST", `/api/areas/${newAreaId}/streets`, {
      body: { name: "Church Street" },
      token: customerToken,
      expect: 403,
    });

    await test("Create street as admin", "POST", `/api/areas/${newAreaId}/streets`, {
      body: { name: "Church Street" },
      token: adminToken,
      expect: 201,
      verify: (d) => d.street?.areaId === newAreaId || "street not linked to area",
    });

    await test("Create duplicate street in same area -> 409", "POST", `/api/areas/${newAreaId}/streets`, {
      body: { name: "Church Street" },
      token: adminToken,
      expect: 409,
    });

    await test("Same street name in a different area is allowed", "POST", `/api/areas/${area1.id}/streets`, {
      body: { name: `Church Street ${stamp}` },
      token: adminToken,
      expect: 201,
    });

    await test("New area appears in GET /api/areas with its street", "GET", "/api/areas", {
      expect: 200,
      verify: (d) => {
        const a = d.areas.find((x) => x.id === newAreaId);
        if (!a) return "new area not in list";
        if (!a.streets.some((s) => s.name === "Church Street")) return "new street not in area";
        return true;
      },
    });
  }

  await test("Create street in non-existent area -> 404", "POST", "/api/areas/999999/streets", {
    body: { name: "Ghost Street" },
    token: adminToken,
    expect: 404,
  });

  await test("Create street with empty name -> 400", "POST", `/api/areas/${area1.id}/streets`, {
    body: { name: "" },
    token: adminToken,
    expect: 400,
  });

  // ===== Delivery persons =====
  section("8. Delivery persons (admin only)");

  const dp = {
    name: "Test Delivery Person",
    email: `dp_${stamp}@test.com`,
    phone: randomPhone(),
    password: "dp1234",
    homeAreaId: area1.id,
  };
  created.userEmails.push(dp.email);

  await test("Create delivery person as customer -> 403", "POST", "/api/admin/delivery-persons", {
    body: dp,
    token: customerToken,
    expect: 403,
  });

  await test("Create delivery person with non-existent home area -> 404", "POST", "/api/admin/delivery-persons", {
    body: { ...dp, email: `dpx_${stamp}@test.com`, phone: randomPhone(), homeAreaId: 999999 },
    token: adminToken,
    expect: 404,
  });

  await test("Create delivery person as admin", "POST", "/api/admin/delivery-persons", {
    body: dp,
    token: adminToken,
    expect: 201,
    verify: (d) => {
      if (d.deliveryPerson?.role !== "DELIVERY") return "role should be DELIVERY";
      if (d.deliveryPerson?.homeArea?.id !== area1.id) return "home area not linked";
      if ("password" in d.deliveryPerson) return "password must NOT be returned";
      return true;
    },
  });

  await test("Create delivery person with same phone -> 409", "POST", "/api/admin/delivery-persons", {
    body: { ...dp, email: `dpy_${stamp}@test.com` },
    token: adminToken,
    expect: 409,
  });

  const dpLogin = await test("Login as delivery person", "POST", "/api/auth/login", {
    body: { email: dp.email, password: dp.password },
    expect: 200,
    verify: (d) => d.user?.role === "DELIVERY" || "role should be DELIVERY",
  });
  const dpToken = dpLogin.data?.token;

  if (dpToken) {
    await test("Delivery person cannot access admin routes -> 403", "GET", "/api/admin/delivery-persons", {
      token: dpToken,
      expect: 403,
    });
  }

  await test("List delivery persons as admin includes new one", "GET", "/api/admin/delivery-persons", {
    token: adminToken,
    expect: 200,
    verify: (d) =>
      d.deliveryPersons?.some((p) => p.email === dp.email) || "new delivery person not in list",
  });

  // ===== Misc =====
  section("9. Misc");

  await test("Unknown route -> 404", "GET", "/api/does-not-exist", { expect: 404 });
}

// ---------- cleanup + summary ----------

async function cleanup() {
  if (KEEP_DATA) {
    console.log("\n(--keep) Test data left in the database.");
    return;
  }

  try {
    const users = await prisma.user.deleteMany({
      where: { email: { in: created.userEmails } },
    });

    // Extra streets created in seeded areas during tests
    const streets = await prisma.street.deleteMany({
      where: { name: { endsWith: String(stamp) } },
    });

    // Deleting the test area also deletes its streets (onDelete: Cascade)
    const areasDeleted = await prisma.area.deleteMany({
      where: { id: { in: created.areaIds } },
    });

    console.log(
      `\nCleanup: removed ${users.count} test users, ${areasDeleted.count} test areas, ${streets.count} extra streets.`
    );
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
      console.log("All Step 1 checks passed ✅");
    }
    console.log("==============================\n");
  }
})();