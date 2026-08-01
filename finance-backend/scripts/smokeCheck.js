"use strict";

/**
 * Phase 13 end-to-end smoke check (ARCHITECTURE.md §8 / SMOKE_TEST.md).
 *
 * Walks the full path across all four services with real HTTP calls: both
 * Python services' health checks, then the gateway — logging in as each of
 * the three roles and exercising the currency analytics, live rate board,
 * and FX exchange-request flows end to end (quote -> submit -> approve ->
 * settle) against a real running server + real MySQL database. This is not
 * a unit test suite (see `npm test` for that) and it is not exhaustive —
 * it is a fast, scriptable version of the manual walkthrough documented in
 * ../../SMOKE_TEST.md, intended to be run before a demo/viva to catch
 * "a service isn't running" or "a contract silently changed" before a human
 * does the same walkthrough by hand.
 *
 * Requires all four services already running (see the root README's
 * "Running all four services" guide) and `npm run migrate` already applied.
 * Does not require `npm run seed:demo` first — it creates its own throwaway
 * customer/staff accounts and its own FX exchange request — but running the
 * demo seed first means the currency/anomaly/FX-queue checks below have
 * pre-existing data to look at too, closer to how a real demo would look.
 *
 * Usage:
 *   node scripts/smokeCheck.js
 *
 * Exit code 0 if every check passed, 1 otherwise. Prints a PASS/FAIL line
 * per check plus a final summary; does not stop at the first failure (a
 * later step depending on an earlier failed step is marked SKIPPED, not
 * silently attempted with undefined data).
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const BASE_URL = process.env.SMOKE_BASE_URL || "http://localhost:5000/api";
const MODEL_URL = process.env.MODEL_URL || "http://localhost:8000";
const CURRENCY_MODEL_URL = process.env.CURRENCY_MODEL_URL || "http://localhost:8100";

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function skip(name, reason) {
  results.push({ name, ok: null, detail: reason });
  console.log(`[SKIP] ${name} — ${reason}`);
}

async function step(name, fn) {
  try {
    const detail = await fn();
    record(name, true, typeof detail === "string" ? detail : undefined);
    return { ok: true, value: detail };
  } catch (err) {
    record(name, false, err.message);
    return { ok: false, value: undefined };
  }
}

async function req(method, url, { token, body, isForm } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload = body;
  if (body && !isForm) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers, body: payload });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON body — leave json null, callers that need it will fail loudly
  }
  if (!res.ok) {
    const message = (json && json.message) || `HTTP ${res.status}`;
    const error = new Error(`${res.status} ${message}`);
    error.status = res.status;
    error.body = json;
    throw error;
  }
  return json;
}

function todayPlusDays(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function login(email, password) {
  const data = await req("POST", `${BASE_URL}/auth/login`, { body: { email, password } });
  return { token: data.accessToken, user: data.user };
}

async function ensureStaff(adminToken) {
  try {
    return await login("demo.staff@aura.com", "Demo@1234");
  } catch {
    // Demo seed hasn't been run — provision a throwaway staff account.
  }
  const email = `smoke.staff.${Date.now()}@aura.com`;
  await req("POST", `${BASE_URL}/admin/createStaff`, {
    token: adminToken,
    body: {
      firstName: "Smoke",
      lastName: "Staff",
      email,
      phone: "0770000000",
      password: "Smoke@1234",
    },
  });
  return login(email, "Smoke@1234");
}

async function ensureCustomer() {
  try {
    return await login("demo.customer@aura.com", "Demo@1234");
  } catch {
    // Demo seed hasn't been run — register a throwaway customer.
  }
  const email = `smoke.customer.${Date.now()}@aura.com`;
  const form = new FormData();
  form.append("firstName", "Smoke");
  form.append("lastName", "Customer");
  form.append("email", email);
  form.append("phone", "0770000001");
  form.append("password", "Smoke@1234");
  form.append("dateOfBirth", "1995-01-01");
  form.append("gender", "Other");
  form.append("address", "Smoke Test Address");
  form.append("employmentType", "Permanent");
  form.append("companyName", "Smoke Test Co.");
  form.append("monthlyIncome", "150000");
  form.append("monthlyExpense", "60000");
  await req("POST", `${BASE_URL}/auth/register`, { body: form, isForm: true });
  return login(email, "Smoke@1234");
}

async function main() {
  console.log(`Smoke check target: gateway=${BASE_URL} loan-model=${MODEL_URL} currency-model=${CURRENCY_MODEL_URL}\n`);

  await step("loan-risk-model /health reachable", async () => {
    const data = await req("GET", `${MODEL_URL}/health`);
    return JSON.stringify(data).slice(0, 120);
  });

  await step("currency-forecast-model /health reachable", async () => {
    const data = await req("GET", `${CURRENCY_MODEL_URL}/health`);
    return `models_loaded=${data.models_loaded}, trained=${(data.trained_currencies || []).join(",")}`;
  });

  await step("gateway reachable (public loan-products catalog)", async () => {
    const data = await req("GET", `${BASE_URL}/loans/products`);
    return `${(data.products || []).length} product(s)`;
  });

  const adminLogin = await step("login as admin", () => login("admin@aura.com", "Admin@123"));
  const adminToken = adminLogin.ok ? adminLogin.value.token : null;

  const staffLogin = adminToken
    ? await step("login as staff (demo account, else provision one)", () => ensureStaff(adminToken))
    : (skip("login as staff", "admin login failed"), { ok: false });
  const staffToken = staffLogin.ok ? staffLogin.value.token : null;

  const customerLogin = await step("login as customer (demo account, else register one)", ensureCustomer);
  const customerToken = customerLogin.ok ? customerLogin.value.token : null;

  // --- Currency analytics + live rate board, once per role ---
  const roleTokens = [
    ["customer", customerToken],
    ["staff", staffToken],
    ["admin", adminToken],
  ];

  for (const [role, token] of roleTokens) {
    if (!token) {
      skip(`[${role}] currency endpoints`, "no token (login step failed above)");
      continue;
    }
    await step(`[${role}] GET /currency/currencies`, async () => {
      const data = await req("GET", `${BASE_URL}/currency/currencies`, { token });
      return `${(data.currencies || []).length} currencies`;
    });
    await step(`[${role}] GET /currency/rates/LKR`, async () => {
      const data = await req("GET", `${BASE_URL}/currency/rates/LKR?limit=5`, { token });
      return `${(data.rates || []).length} rows`;
    });
    await step(`[${role}] GET /currency/board`, async () => {
      const data = await req("GET", `${BASE_URL}/currency/board`, { token });
      return `source=${data.source}, is_stale=${data.is_stale}`;
    });
    await step(`[${role}] GET /currency/analyze/LKR`, async () => {
      const data = await req("GET", `${BASE_URL}/currency/analyze/LKR`, { token });
      return data.outlook ? `outlook.direction=${data.outlook.direction}` : "full breakdown returned";
    });
  }

  if (staffToken) {
    await step("[staff] GET /currency/anomalies", async () => {
      const data = await req("GET", `${BASE_URL}/currency/anomalies?limit=5`, { token: staffToken });
      return `${(data.anomalies || []).length} row(s)`;
    });
  } else {
    skip("[staff] GET /currency/anomalies", "no staff token");
  }

  if (adminToken) {
    await step("[admin] GET /currency/admin/model-status", async () => {
      await req("GET", `${BASE_URL}/currency/admin/model-status`, { token: adminToken });
      return "ok";
    });
  } else {
    skip("[admin] GET /currency/admin/model-status", "no admin token");
  }

  // --- FX exchange-request lifecycle: quote -> submit -> approve -> settle ---
  let reference = null;
  if (customerToken) {
    const quote = await step("[customer] POST /currency/exchange/quote", async () => {
      const data = await req("POST", `${BASE_URL}/currency/exchange/quote`, {
        token: customerToken,
        body: { direction: "buy", currency_code: "USD", foreign_amount: 25 },
      });
      return data;
    });

    if (quote.ok) {
      const submit = await step("[customer] POST /currency/exchange/requests (submit)", async () => {
        const data = await req("POST", `${BASE_URL}/currency/exchange/requests`, {
          token: customerToken,
          body: {
            quote_id: quote.value.quote_id,
            purpose_code: "travel",
            branch: "Smoke Test Branch",
            settlement_date: todayPlusDays(3),
          },
        });
        reference = data.reference_no;
        return `reference_no=${reference}`;
      });

      if (submit.ok && reference) {
        await step("[customer] GET own request by reference", async () => {
          const data = await req("GET", `${BASE_URL}/currency/exchange/requests/${reference}`, {
            token: customerToken,
          });
          return `status=${data.status}, events=${(data.events || []).length}`;
        });
      }
    } else {
      skip("[customer] submit exchange request", "quote step failed");
    }
  } else {
    skip("[customer] FX exchange quote/submit", "no customer token");
  }

  if (reference && staffToken) {
    await step("[staff] GET /currency/exchange/admin/queue", async () => {
      const data = await req(
        "GET",
        `${BASE_URL}/currency/exchange/admin/queue?status=pending_review`,
        { token: staffToken }
      );
      return `${(data.requests || []).length} row(s) pending review`;
    });

    const approve = await step("[staff] POST review (approve)", async () => {
      const data = await req("POST", `${BASE_URL}/currency/exchange/requests/${reference}/review`, {
        token: staffToken,
        body: { action: "approve" },
      });
      return `status=${data.status}`;
    });

    if (approve.ok) {
      await step("[staff] POST settle", async () => {
        const data = await req("POST", `${BASE_URL}/currency/exchange/requests/${reference}/settle`, {
          token: staffToken,
          body: {},
        });
        return `status=${data.status}`;
      });
    } else {
      skip("[staff] settle request", "approve step failed");
    }
  } else {
    skip("[staff] review/settle exchange request", "no reference number or no staff token");
  }

  if (adminToken) {
    await step("[admin] GET /currency/exchange/admin/limits", async () => {
      await req("GET", `${BASE_URL}/currency/exchange/admin/limits`, { token: adminToken });
      return "ok";
    });
    await step("[admin] GET /currency/exchange/admin/spreads", async () => {
      await req("GET", `${BASE_URL}/currency/exchange/admin/spreads`, { token: adminToken });
      return "ok";
    });
    await step("[admin] GET /currency/exchange/admin/position", async () => {
      await req("GET", `${BASE_URL}/currency/exchange/admin/position`, { token: adminToken });
      return "ok";
    });
  } else {
    skip("[admin] FX admin config endpoints", "no admin token");
  }

  const passed = results.filter((r) => r.ok === true).length;
  const failed = results.filter((r) => r.ok === false).length;
  const skipped = results.filter((r) => r.ok === null).length;
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped (of ${results.length}).`);
  if (failed > 0) {
    console.log("\nFailed checks:");
    for (const r of results.filter((r) => r.ok === false)) {
      console.log(`  - ${r.name}: ${r.detail}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Smoke check crashed:", err);
  process.exit(1);
});
