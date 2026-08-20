# Non-Functional Requirements — Digital AI Loan System

## About This Document

Where [FUNCTIONAL_REQUIREMENTS.md](FUNCTIONAL_REQUIREMENTS.md) lists **what**
the system does, this document lists **how well** it is expected to do it —
the qualities that apply across every feature rather than to one screen or
one role: how secure it is, how it behaves when something goes wrong, how
fast it feels to use, how easy it is to keep working on, and so on.

Each requirement is a short, numbered statement, grouped by the quality it
describes. As with the functional requirements, the numbering (e.g.
`NFR-SEC-04`) exists only so a specific requirement can be referred to
precisely in discussion — it has no meaning beyond that.

Every requirement below is either something the system **already does**
(and is described the way it actually behaves today, not aspirationally),
or is explicitly marked as a **target** where no measurement yet exists.
Known gaps are listed honestly in the Notes section at the end, in the same
spirit as the functional requirements document — this is a final-year
academic project, not a live production bank, and it is more useful to say
plainly what has not been built than to imply otherwise.

---

## 1. How These Requirements Are Organised

| Category | What it covers |
|---|---|
| **Security** | Protecting accounts, data, payments, and secrets from misuse |
| **Performance & Responsiveness** | How quickly the system reacts to what a user does |
| **Reliability & Fault Tolerance** | What happens when a dependency (AI model, payment provider, email) is slow, down, or unconfigured |
| **Availability** | How dependably the system can be reached and used |
| **Scalability & Capacity** | How the system would cope with more users or more data |
| **Usability & Accessibility** | How understandable and forgiving the system is to use |
| **Localization** | Working correctly in English, Sinhala, and Tamil |
| **Maintainability & Testability** | How safely the system can keep being changed |
| **Compatibility & Interoperability** | How the system's own parts, and outside systems, talk to each other |
| **Compliance & Legal** | Sri Lankan data-protection and finance-leasing obligations |
| **Auditability & Data Integrity** | Whether records can be trusted and traced after the fact |
| **Observability** | Whether the system's own health can be seen from inside it |

---

## 2. Security

- **NFR-SEC-01**: Every password is stored as a **bcrypt hash**; the plain password is never retained anywhere, including in the database or in logs.
- **NFR-SEC-02**: A user's login session is a **short-lived access token**, held only in the browser's memory (never in storage that persists after the tab closes), paired with a **long-lived refresh token** in an `httpOnly`, `sameSite` cookie that JavaScript cannot read — limiting the damage a cross-site scripting bug could do.
- **NFR-SEC-03**: Every non-public action is checked against the caller's role (customer / staff / admin) on the server, not just hidden in the interface — so a customer cannot reach a staff action by guessing a URL.
- **NFR-SEC-04**: All traffic between the browser and the system carries standard protective headers (via `helmet`), and cross-origin requests are restricted to the application's own front-end address.
- **NFR-SEC-05**: A forgotten-password reset uses a one-time code that is itself hashed at rest, expires after a short window, and is locked out after a capped number of incorrect attempts.
- **NFR-SEC-06**: Card payment details are never transmitted to or stored by the bank's own systems — a customer paying online is redirected to the payment provider's (Stripe) own secure page, which keeps the bank's servers entirely outside the scope of card-data-security rules that would otherwise apply.
- **NFR-SEC-07**: Every incoming payment confirmation is cryptographically verified as genuinely coming from the payment provider before it is allowed to affect a loan balance; a confirmation that fails this check is rejected outright.
- **NFR-SEC-08**: The amount charged for any online repayment is always calculated by the system itself from the customer's real, current balance — never taken from a number typed into a request — so it cannot be manipulated to under-pay.
- **NFR-SEC-09**: A payment can never be applied to a loan twice, even if the same confirmation is mistakenly delivered more than once, enforced both in the application logic and as a hard rule in the database itself.
- **NFR-SEC-10**: Every file a user uploads (identity documents, proof of income, compliance documents) is size- and file-type-restricted, stored under a randomised name outside any publicly reachable folder, and can only ever be retrieved by its owner or by authorised staff — never by guessing a link.
- **NFR-SEC-11**: All data entered by a user through any form is validated on the server before it is accepted or acted on, regardless of what the browser itself allowed through.
- **NFR-SEC-12**: A locked currency-exchange quote is a signed, time-limited token rather than something stored and trusted at face value, so it cannot be replayed or altered after it expires.
- **NFR-SEC-13**: All secret credentials (API keys, database password, token-signing secrets) live only on the server and are never sent to, or visible from, the browser — and are excluded from version control.
- **NFR-SEC-14**: Once a customer's national identity number has been verified by staff, it is locked against silent edits — any change requires re-verification, so a verified identity can never quietly become an unverified one.
- **NFR-SEC-15**: When a document image is sent to an external AI service for automatic reading, this happens only for that specific, isolated purpose, using a key that lives only on the server, and the result is always advisory-only — never something that decides an outcome by itself (see also NFR-CMP-02).

---

## 3. Performance & Responsiveness

- **NFR-PERF-01**: Self-service tools that don't require saving anything (the EMI Calculator, the Eligibility Checker) respond to changed inputs immediately, without a full page reload.
- **NFR-PERF-02**: An in-progress loan or lease application is auto-saved as a draft in the background, without interrupting or blocking the customer as they continue filling in the form.
- **NFR-PERF-03**: A submitted loan application receives its automated risk assessment and outcome explanation as part of the same request/response cycle the customer is already waiting on — there is no separate "check back later" step for a result that is, in practice, computed in well under a second by the risk model.
- **NFR-PERF-04**: The loan-risk model's accuracy is measured, not assumed: on a 22,500-row held-out test set (evaluated 2026-08-08), it achieves a macro ROC-AUC of **0.9124** and a calibration error of **0.0021** between predicted and actual default rates at the decile level — the figure the system's own risk-based pricing depends on being honest. This report regenerates automatically on every retrain, so it can never drift from the model actually shipped.
- **NFR-PERF-05**: Live currency exchange rates refresh on an hourly schedule rather than continuously — this is a deliberate, disclosed freshness target for a rate board, not a trading system, and every currency figure is labelled with which "plane" (live rate vs. model forecast) and vintage it came from, so a user is never misled into thinking an hourly figure is real-time.
- **NFR-PERF-06 (target, not yet measured)**: No formal load testing or response-time benchmarking of the API gateway under concurrent users has been carried out; performance figures under real multi-user load are therefore not yet known (see Notes).

---

## 4. Reliability & Fault Tolerance

- **NFR-REL-01**: The three optional external dependencies — the AI explanation service (Gemini), the payment provider (Stripe), and the live FX rate feed — are each allowed to be slow, unreachable, or entirely unconfigured without breaking anything else in the system.
- **NFR-REL-02**: If the AI explanation service is unavailable or not configured, the system falls back to a deterministic, rule-based explanation instead of failing the request — a customer or staff member always gets a plain-language explanation, generated one way or another.
- **NFR-REL-03**: If the payment provider is not configured, the online-payment option is simply hidden; every other part of the system (recording an offline payment, viewing a schedule, downloading a receipt) continues to work exactly as normal.
- **NFR-REL-04**: If a payment confirmation's automatic delivery (webhook) never arrives — for example, because of a network issue — the customer's own return to the confirmation page independently reconciles the payment directly with the provider, so the payment is never silently lost even without that delivery.
- **NFR-REL-05**: If either AI microservice (loan risk, currency forecasting) is down, only the specific features that depend on it fail (with a clear, recognisable error) — authentication, browsing, applications, document management, and every other part of the system continue to work normally, because no other part of the system depends on either AI service being up.
- **NFR-REL-06**: A staff member's fee waiver, late-fee waiver, or manual override of an automated recommendation always requires a recorded reason before it takes effect, so an exception can never be applied silently.

---

## 5. Availability

- **NFR-AVL-01**: The system's five parts (front-end, API gateway, two AI microservices, database) are architecturally independent processes that can, in principle, be started, stopped, and updated separately without taking the whole system down at once.
- **NFR-AVL-02 (known limitation)**: The system currently runs as an unclustered set of local-development processes with a single instance of each component — there is no load balancing, automatic failover, or redundancy configured for any part of it today (see Notes).

---

## 6. Scalability & Capacity

- **NFR-SCA-01**: User sessions carry no server-side state (authentication is a self-contained token, not a session stored in memory or a database), so the API gateway does not require "sticky sessions" and could, in principle, be run as more than one instance without users being routed back to a specific server.
- **NFR-SCA-02**: Database access goes through a connection pool rather than opening a fresh connection per request, so the system does not exhaust database connections under moderate concurrent use.
- **NFR-SCA-03**: Each AI microservice is a stateless "features-in, prediction-out" function with no database of its own, so additional instances could be added behind the gateway without any data to keep in sync between them.
- **NFR-SCA-04 (known limitation)**: None of the above has been exercised under real concurrent load or multiple deployed instances — statelessness is a design property that has been built in, not a scaling claim that has been tested (see Notes).

---

## 7. Usability & Accessibility

- **NFR-USE-01**: Every automated decision a customer sees (a risk category, a decline, an offer) is shown with a plain-language explanation of *why*, not a raw score or code, so a non-technical customer can understand their own outcome without contacting the bank.
- **NFR-USE-02**: A multi-step process that can't be finished in one sitting (a loan application, a vehicle lease application) is resumable from where the user left off, rather than forcing them to start again.
- **NFR-USE-03**: At every step of a vehicle lease, the customer and staff both see a single, plain-language answer to "what happens next, and whose turn is it?" — not just a status code.
- **NFR-USE-04**: Data the customer has already provided (profile details, prior application answers) is pre-filled on a new application for confirmation, rather than asked for a second time.
- **NFR-USE-05 (known limitation)**: No formal accessibility audit (e.g. against WCAG) has been carried out on the front-end; accessibility beyond standard semantic HTML and the component library's own defaults is not a verified property of the system (see Notes).

---

## 8. Localization

- **NFR-I18N-01**: Every public-facing and customer-facing screen — marketing pages, the eligibility checker, registration, the full customer portal including the vehicle leasing journey — is available in **English, Sinhala, and Tamil**, switchable at any time without losing the user's place.
- **NFR-I18N-02**: Translation is applied at the **headline level** by deliberate policy: interface labels, instructions, and system-generated messages are translated, while staff/admin tooling and data that originates in the database (loan product names, most FAQ entries, notification content) remain in English. This is a documented design boundary, not an oversight, because translating database-sourced or notification content would mean storing structured keys and parameters throughout the system rather than prose.
- **NFR-I18N-03**: Changing language never re-submits a form or discards data the user has already entered.

---

## 9. Maintainability & Testability

- **NFR-MNT-01**: The system's four codebases (front-end, API gateway, loan-risk model, currency-forecast model) each own a distinct responsibility and communicate only over REST/JSON — none of them reaches directly into another's database or internals — so any one of them can be modified, tested, or replaced without the others needing to change.
- **NFR-MNT-02**: The API gateway's business logic is covered by **43 automated test files** (recommendation logic, credit policy, decision matrix, fee/interest calculation, repayment and amortisation math, leasing lifecycle, FX quoting/compliance/inventory, consent, document validation, OCR extraction, and more), run with a single `npm test` command.
- **NFR-MNT-03**: The loan-risk model carries **35 automated test cases** covering its EMI maths against hand-computed values, consistency between training-time and serving-time feature calculation, risk-band thresholds, and every dataset-generation defect a prior version of the model shipped with — so a future change to the model cannot silently reintroduce a defect that was already found and fixed once.
- **NFR-MNT-04**: The document-recognition (OCR) feature has its own evaluation harness, run against both synthetic and real sample documents, to catch a regression in extraction accuracy before it reaches a real applicant's document.
- **NFR-MNT-05 (known limitation)**: There is no automated continuous-integration pipeline configured for this repository — the test suites above are run manually rather than gating every change automatically (see Notes).

---

## 10. Compatibility & Interoperability

- **NFR-COM-01**: The front-end communicates with the system exclusively through the API gateway's REST/JSON interface — it never calls either AI microservice, the database, or an external provider (Stripe, Gemini) directly, so the gateway can change what it talks to behind the scenes without the front-end needing to change.
- **NFR-COM-02**: Every service in the system exposes a basic health-check endpoint, so its reachability can be verified independently of the others.
- **NFR-COM-03 (known limitation)**: No specific minimum browser version or legacy-browser support target has been defined; the front-end is built against current evergreen browser capabilities without a documented compatibility floor (see Notes).

---

## 11. Compliance & Legal

- **NFR-CMP-01**: Before an assessment can be run on their application, a customer must explicitly consent to their personal data being processed and their credit history being checked; the system keeps a permanent, timestamped record of exactly what was agreed to and when, in line with Sri Lanka's Personal Data Protection Act No. 9 of 2022.
- **NFR-CMP-02**: Because a document image sent for automatic reading may contain personal data (an identity number, a bank account number, a salary figure) processed by a third-party AI service, this processing is kept strictly advisory — it never finalises a decision on its own — and is designed as an isolated, swappable component so a future self-hosted alternative could take its place without changing anything else in the system, should that be required for data-residency reasons.
- **NFR-CMP-03**: The vehicle lease agreement document is worded consistently with the disclosures required under Sri Lanka's Finance Leasing Act, and is explicit about what it is (a statement of terms following an accepted quotation) rather than implying a witnessed signature that never took place.
- **NFR-CMP-04**: A loan offer disloses its fees, the exact net amount the customer will receive after those fees, and the true annual cost of borrowing (effective APR) alongside the headline interest rate — not just the advertised rate — so a customer's consent to an offer is genuinely informed.

---

## 12. Auditability & Data Integrity

- **NFR-AUD-01**: Every significant decision or status change on a loan or lease — a credit decision, an offer, a disbursement, a payment, a document verification — is permanently recorded with who made it and when, and this record is never edited or deleted after the fact.
- **NFR-AUD-02**: Every currency figure the system shows is tagged with where it came from — a live market rate or a trained model's forecast — so the two are never silently merged into a single number that looks more certain than it is.
- **NFR-AUD-03**: A discretionary action that reduces what a customer owes (a fee waiver, a late-fee waiver) is only ever recorded together with the staff member's reason, and that reason becomes a permanent part of the record — it cannot be applied invisibly.
- **NFR-AUD-04**: A staff member's manual override of the system's own automated recommendation is recorded as an override, with a reason, distinctly from an application that was simply approved in line with the recommendation.

---

## 13. Observability

- **NFR-OBS-01**: An administrator can see, from inside the system, whether the AI risk-assessment model is currently reachable and how fresh the data behind it is, rather than needing to check server logs directly.
- **NFR-OBS-02**: An administrator can see the operational status (model/cache freshness) of the currency-forecasting service in the same way.
- **NFR-OBS-03 (known limitation)**: Beyond the health/status views above, there is no centralised, searchable application logging or alerting system — diagnosing an issue outside of what the admin health views already surface currently depends on reading a service's own console output directly (see Notes).

---

## Notes

The following are honest, current gaps rather than requirements the system
already meets — listed here for the same reason
[FUNCTIONAL_REQUIREMENTS.md](FUNCTIONAL_REQUIREMENTS.md) lists what was
deliberately left out of scope: so nothing above is mistaken for a claim
about capability that doesn't yet exist.

- **No load or performance testing has been conducted.** There is no measured figure for response time or throughput under concurrent users, and no numeric performance target (e.g. "95% of requests under Xms") has been set, because none has yet been validated against real load (NFR-PERF-06).
- **No request rate limiting exists on any endpoint.** Login attempts, the password-reset OTP, and every other endpoint have no request-throttling protection beyond the OTP's own attempt cap (NFR-SEC-05) — a general-purpose rate limiter (e.g. `express-rate-limit`) has not been added.
- **The system runs as a single, unclustered instance of each component**, with no load balancer, automatic failover, or redundancy — a crash of any one process currently means that process's functionality is unavailable until it is restarted manually (NFR-AVL-02).
- **No containerisation or deployment automation exists** (no Dockerfile, no CI/CD pipeline, no `docker-compose`) — every service is started manually following the steps in README.md, and the front-end's API address is hard-coded rather than read from an environment variable, which would need to change before a real multi-environment deployment.
- **No formal accessibility audit** (e.g. WCAG conformance testing) has been performed on the front-end (NFR-USE-05).
- **No penetration testing or third-party security audit** has been carried out; the security properties listed in Section 2 describe the system's own design and implementation, not an independent assessment of it.
- **No automated database backup or disaster-recovery procedure** exists for the MySQL database.
- **No centralised logging, metrics, or alerting system** is in place beyond the admin-facing health/status views described in Section 13 (NFR-OBS-03); diagnosing an issue currently means reading a service's own console output.
- **No maker-checker (dual authorisation) control** exists for high-value decisions — a single staff member's approval, offer, or disbursement action is final, with no second-reviewer sign-off step (this mirrors a gap already noted in ARCHITECTURE.md §13).
- **The loan-risk model's training data is synthetic**, not real applicant history — so the accuracy figures in NFR-PERF-04, while genuinely measured, describe performance on a synthetic dataset, not a validated real-world accuracy claim.
