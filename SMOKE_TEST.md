# End-to-End Smoke Check

Phase 13 (see `ARCHITECTURE.md` §8). A repeatable check that all four
services genuinely work together — not just that each module's own tests
pass in isolation — before a demo/viva. Two parts:

1. **`finance-backend/scripts/smokeCheck.js`** — scripted, hits real HTTP
   endpoints across the gateway and both Python services with real JWTs for
   all three roles, including a full FX exchange quote → submit → approve →
   settle lifecycle. Fast (a few seconds) and safe to re-run.
2. **Manual browser walkthrough** (below) — the scripted check proves the
   API layer works; it does not click through the actual React UI. A human
   pass in a real browser is still needed to catch rendering bugs, and is
   the only way to check the parts of the brief a script can't (does a chart
   render, does a toast look right, does a confirm modal close). This was
   **not run by the AI session that wrote this document** — no system
   Chromium/Firefox was available in that sandbox and `playwright install`
   could not reach its CDN (a limitation already recorded in
   `ARCHITECTURE.md` §8/§9.6) — so the checklist below is
   written from the code, not verified against actual rendered pixels. Run
   it yourself before a live demo.

---

## Part 1 — start everything

Follow the [root README's run guide](README.md#running-all-four-services-local-dev):
MySQL migrated, both Python services, the gateway, and the frontend, in that
order. Optionally run `npm run seed:demo` (from `finance-backend/`) first so
there's believable data to look at instead of an empty app.

## Part 2 — scripted check

```bash
cd finance-backend
npm run smoke
```

**Result of the last run against this branch (2026-07-27, all four services
running locally, `npm run seed:demo` already applied):** all 29 checks
passed — both Python services' `/health`, the public loan-product catalog,
login for admin/staff/customer (admin via the seeded default account, staff
and customer via the demo-seed accounts), every currency-analytics endpoint
for all three roles, the live rate board, the anomaly log, the admin
model-status view, and a full fresh FX exchange lifecycle (quote → submit →
staff approve → staff settle) plus the admin limits/spreads/position
endpoints. Nothing failed; nothing needed to be skipped.

The script exits non-zero if anything fails and prints which checks and
why — re-run it after pulling changes or before a demo to catch a service
that isn't running, a migration that wasn't applied, or a contract that
silently changed, before a human repeats the same walkthrough by hand.

## Part 3 — manual browser walkthrough (per role)

Log in at `http://localhost:5173/login`. Default admin:
`admin@aura.com` / `Admin@123`; demo staff/customer (if `npm run seed:demo`
was run): `demo.staff@aura.com` / `demo.customer@aura.com`, both
`Demo@1234`.

### Customer

- [ ] `/dashboard/currency` — currency picker, simplified outlook, rate/
      forecast chart (historical + live series, date-range presets), live
      buy/sell rate board.
- [ ] `/dashboard/currency/exchange` — pick a tradable currency, watch the
      quote lock and countdown, fill purpose/branch/settlement date, review
      step shows the exact locked rate, submit → success screen with a
      reference number.
- [ ] `/dashboard/currency/exchange/requests` — the new request appears;
      status/currency filters work.
- [ ] `/dashboard/currency/exchange/requests/:ref` — audit timeline shows a
      "Submitted by customer" event; cancel button visible only while
      `pending_review`.

### Staff

- [ ] Currency tab — full forecast/trend/volatility breakdown, anomaly log,
      multi-currency compare chart.
- [ ] FX Exchange tab — the review queue shows the customer's new request
      (default filter `pending_review`, oldest first); open the detail
      drawer — customer summary, locked quote, decision-support panel (no
      approve/reject language in it); approve it, confirm the optimistic UI
      update, then settle it.

### Admin

- [ ] Currency Analytics tab — model/cache status, toggle a currency
      inactive and back, force a cache refresh, Rate Charts sub-tab.
- [ ] FX Exchange tab — Spreads (edit one, confirm modal, live buy/sell
      preview), Limits (edit the global or a per-currency override), Position
      (chart + breakdown table), Audit (same queue component, `status=all`,
      shows every request including the one just settled above), Rate Feed
      (manual refresh button, last-refresh timestamp).

**Note anything that doesn't match this checklist here, with the date and
what you saw**, so this file stays an honest record rather than a checklist
that's assumed to still pass:

> _(no manual browser run recorded yet as of Phase 13 — see the caveat at
> the top of this file)_
