require("dotenv").config();
require("./config/db");
const app = require("./app");
const seedAdmin = require("./seeds/seedAdmin");
const rateFeed = require("./services/rateFeed.service");
const fxExpirySweep = require("./services/fxExpirySweep.service");
const offerExpiry = require("./services/offerExpiry.service");
const lateFeeSweep = require("./services/lateFeeSweep.service");
const leaseReminderSweep = require("./services/leaseReminderSweep.service");
const PORT = process.env.PORT || 5000;
(async() =>{
    await seedAdmin();
    app.listen(PORT, () => {
        console.log(`Server Running on Port ${PORT}`);
    });
    // Live currency rate feed (Phase 7) — starts an immediate pull, then
    // polls on an interval. Never blocks server startup or crashes the
    // process on provider failure; see rateFeed.service.js.
    const feedIntervalMs = process.env.CURRENCY_RATE_FEED_INTERVAL_MS
        ? Number(process.env.CURRENCY_RATE_FEED_INTERVAL_MS)
        : undefined;
    rateFeed.scheduleRateFeed(feedIntervalMs);
    // FX exchange-request expiry sweep (Phase 10) — auto-expires
    // 'pending_review' requests no staff member has actioned within the
    // review SLA. See fxExpirySweep.service.js.
    fxExpirySweep.scheduleExpirySweep();
    // Loan-offer expiry sweep (C1) — lapses offers past their expires_at so
    // dead offers stop showing an Accept button. See offerExpiry.service.js.
    offerExpiry.scheduleOfferExpirySweep();
    // Late-fee sweep (C5) — charges a one-time penalty on installments
    // overdue past their grace period. See lateFeeSweep.service.js.
    lateFeeSweep.scheduleLateFeeSweep();
    // Lease reminders (L16) — rentals due and overdue, quotations about to
    // lapse, unpaid signing amounts, and leases stalled on OUR side. Every
    // notice is deduped by a UNIQUE key in the schema, so the sweep is safe
    // to run at any frequency and keeps no state between runs. See
    // leaseReminderSweep.service.js.
    leaseReminderSweep.scheduleLeaseReminderSweep();
})()