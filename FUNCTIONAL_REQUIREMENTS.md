# Functional Requirements — Digital AI Loan System

## About This Document

This document lists everything the system is designed to do, written so that
no technical background is needed to read it. Each requirement is a short,
numbered statement of a capability the system provides. It is organised
**first by who is using the system** (a visitor, a customer, a staff member,
or an administrator), and **then by the area of the system** that
requirement belongs to (e.g. "Loan Application", "Repayments").

If you are reviewing this as the client: the numbering (e.g. `FR-CUS-12`) is
only there so a specific requirement can be referred to precisely in
discussion — it has no meaning beyond that.

---

## 1. Who Uses the System

| Role | Who they are | What they broadly do |
|---|---|---|
| **Visitor** | Anyone browsing the public website, not yet logged in | Learns about the bank's loan products, checks whether they might qualify, gets in touch |
| **Customer** | A registered borrower | Applies for loans, manages their loan(s), makes repayments, exchanges currency, gets support |
| **Staff** | A bank employee (loan officer / operations) | Reviews and processes applications, verifies documents, records payments, handles day-to-day currency exchange operations |
| **Administrator** | Bank management / system owner | Everything staff can do, plus configuring loan products, managing staff accounts, and viewing bank-wide performance reports |

Every registered user (customer, staff, or administrator) also gets their
own secure login, a profile page, and the ability to reset a forgotten
password by email.

---

## 2. Visitor — Public Website (No Login Required)

### 2.1 Information & Marketing

- **FR-VIS-01**: A visitor can view general information about the bank and the loan products it offers (personal, housing, vehicle, business, education, and pawning loans).
- **FR-VIS-02**: A visitor can view a summary of the bank's other services: currency exchange, AI-assisted decision tools, and multilingual support.
- **FR-VIS-03**: A visitor can browse a Frequently Asked Questions (FAQ) page maintained by the bank.
- **FR-VIS-04**: A visitor can view the website in **English, Sinhala, or Tamil**, switching at any time.

### 2.2 Self-Service Tools (No Application Created)

- **FR-VIS-05**: A visitor can use an **EMI Calculator** to estimate the monthly instalment for a loan amount, interest rate, and repayment period of their choosing.
- **FR-VIS-06**: A visitor can use an **Eligibility Checker** to get an indicative, non-binding estimate of whether they are likely to qualify for a loan and at what risk category, by entering basic financial details. This check does **not** create a real loan application and is not saved.

### 2.3 Getting in Touch & Registering

- **FR-VIS-07**: A visitor can submit a message through a **Contact / Support form**, which reaches bank staff.
- **FR-VIS-08**: A visitor can **register for a customer account** by providing their name, contact details, date of birth, address, and basic employment and income information.
- **FR-VIS-09**: A visitor can log in once registered, and can request a **password reset** (a one-time code sent to their registered email) if they forget their password.

---

## 3. Customer — Registered Borrower

### 3.1 Account & Profile

- **FR-CUS-01**: A customer can log in securely and stay signed in across a browsing session.
- **FR-CUS-02**: A customer can view and update their contact details, address, employment, and income/expense information at any time.
- **FR-CUS-03**: A customer can submit their **National Identity Card (NIC) number** for identity verification. Once bank staff have verified it, it is locked and cannot be silently changed.
- **FR-CUS-04**: Personal details that describe the customer generally (marital status, education level, occupation, employer type, years employed) are remembered on the customer's profile, so they do **not** need to be re-entered on every new loan application.
- **FR-CUS-05**: A customer can change their password at any time from their profile.

### 3.2 Applying for a Loan

- **FR-CUS-06**: A customer can browse the bank's loan products and start a new loan application, specifying the loan type, amount, purpose, and repayment period.
- **FR-CUS-07**: When starting a new application, the system **pre-fills** answers from the customer's profile and their most recent application, so the customer only needs to confirm they are still accurate rather than typing everything again.
- **FR-CUS-08**: A customer can declare a **guarantor** for the loan (if required) and/or offer **collateral** (e.g. property, vehicle, gold jewellery, fixed deposit) as security.
- **FR-CUS-09**: A customer can upload supporting documents (e.g. identity documents, proof of income) as part of their application, and re-upload a replacement if a document is rejected.
- **FR-CUS-10**: If a customer is interrupted partway through the application form, their progress is **saved automatically as a draft** and can be resumed later from where they left off.
- **FR-CUS-11**: Once submitted, the application is automatically assessed and the customer is shown an instant, plain-language explanation of the outcome (e.g. why they were placed in a particular risk category), not just a raw score.
- **FR-CUS-11a**: If the customer has borrowed from the bank before, their own repayment record with the bank (on-time payments, any missed instalments, facilities already settled) is taken into account alongside their declared details when assessing a new application — a returning customer with a good record is not scored purely on self-declared information the way a first-time applicant is.
- **FR-CUS-12**: A customer can withdraw their own application at any point before it is finalised, if they no longer wish to proceed.
- **FR-CUS-12a**: Before an application can be submitted, the customer must explicitly agree to the bank processing their personal data and checking their credit bureau (CRIB) record. The system keeps a permanent, timestamped record of exactly what was agreed to and when, and does not ask again once already agreed — unless the bank's policy text itself changes.

### 3.3 Tracking an Application & Receiving a Decision

- **FR-CUS-13**: A customer can view the current status of every application they have submitted (e.g. under review, more information requested, approved, declined, offer accepted, disbursed) at any time.
- **FR-CUS-14**: A customer can view the full history of status changes for their application, so they can see exactly when and how it progressed.
- **FR-CUS-15**: If bank staff need more information, the customer is notified and can respond directly within the system; the application then automatically returns to review.
- **FR-CUS-16**: If an application is declined, the customer is shown the specific, standardised reason(s) for the decision — not just a generic rejection.
- **FR-CUS-17**: A customer can download an official, formatted **decision letter (PDF)** confirming an approval or rejection.
- **FR-CUS-18**: When approved, a customer can view their **loan offer** in full (amount, interest rate, monthly instalment, total repayable, and how long the offer remains valid) and choose to **accept** or **decline** it.
- **FR-CUS-18a**: A loan offer clearly discloses any **fees and charges** (e.g. processing fee, documentation fee, credit-life insurance), the **exact amount the customer will actually receive** after those fees are deducted, and the **true annual cost of the loan including fees** (effective APR) alongside the loan's headline interest rate — so the customer can see the real cost, not just the advertised rate.

### 3.4 Their Bank Account for Disbursement

- **FR-CUS-19**: When a customer accepts a loan offer, the bank **automatically opens an account** in their name to receive the disbursed funds — the customer does not need to provide banking details manually, since this is a single-bank platform and the account is naturally with this bank.
- **FR-CUS-20**: A customer can view every account the bank holds in their name (account number, branch, and status) from their profile at any time.

### 3.5 Managing an Active Loan & Making Repayments

- **FR-CUS-21**: A customer can view their full **repayment schedule** for a disbursed loan, showing every instalment, its due date, how much of it is principal versus interest, and whether it has been paid, part-paid, or is still due.
- **FR-CUS-22**: A customer can see their current **outstanding balance**, and — if they are behind on payments — a clear warning showing how much is overdue and for how long.
- **FR-CUS-23**: A customer can see the exact figure required to **settle their loan early in full**, including any interest saving from paying early, calculated automatically and always kept up to date.
- **FR-CUS-24**: A customer can **pay online by card** — either their next instalment, a full early settlement, or a custom amount of their choosing — through a secure, industry-standard payment page (processed via Stripe). Card details are never seen or stored by the bank's own systems.
- **FR-CUS-25**: The amount a customer is charged is always determined by the system itself from their actual loan balance, never simply by what is typed into the payment box, so it is not possible to under-pay by mistake or manipulation.
- **FR-CUS-26**: Every payment made — online or in person — is confirmed to the customer immediately, and their balance, schedule, and loan status update automatically the moment it is confirmed.
- **FR-CUS-27**: A customer can download an official **payment receipt (PDF)** for any payment made, showing exactly how the payment was split across interest, fees, and principal.
- **FR-CUS-28**: A customer can view a running history of every payment they have made against a loan.
- **FR-CUS-29**: A customer can download a full **loan statement** (CSV/spreadsheet format) for their own records.

### 3.6 Currency Exchange

- **FR-CUS-30**: A customer can view live, up-to-date foreign exchange rates offered by the bank.
- **FR-CUS-31**: A customer can request a locked, time-limited **quote** to buy or sell a foreign currency at a guaranteed rate.
- **FR-CUS-32**: A customer can submit a currency exchange request against a live quote, upload any required supporting/compliance documents, and track its status through to settlement.
- **FR-CUS-33**: A customer can cancel their own exchange request while it is still awaiting review.
- **FR-CUS-34**: A customer can view the full history of their currency exchange requests.

### 3.7 Notifications & Support

- **FR-CUS-35**: A customer receives an **in-app notification** for every significant event on their account (e.g. a decision made, an offer issued, a payment received, a loan disbursed, an account opened).
- **FR-CUS-36**: A customer receives an **email** for the most important events (e.g. application decisions), even if they are not logged in at the time.
- **FR-CUS-37**: A customer can open a **support conversation** with the bank directly from within the system and continue the conversation as a message thread, rather than only through the public contact form.
- **FR-CUS-38**: A customer can use the entire customer portal in **English, Sinhala, or Tamil**.

---

## 4. Bank Staff

Everything a staff member can see or do is limited to their operational
role — staff do not have access to system-wide configuration, which is
reserved for administrators (Section 5).

### 4.1 Reviewing & Deciding on Loan Applications

- **FR-STF-01**: A staff member can view a queue of all loan applications, filterable by status, so they can prioritise their work.
- **FR-STF-02**: For any application, a staff member can view the applicant's declared details, the AI-generated risk assessment (probability of default, risk category, and outcome breakdown), and a plain-language explanation of that assessment.
- **FR-STF-02a**: Alongside the risk assessment, a staff member can see how much of it is based on the applicant's own repayment record with the bank versus assumed values for a first-time applicant ("thin file") — so a clean record is never mistaken for a record that simply doesn't exist yet.
- **FR-STF-02b**: If an applicant declares a credit bureau (CRIB) score that is inconsistent with the defaults or arrears already on their application (e.g. a very high score alongside multiple declared defaults), the system flags this contradiction to the reviewing staff member rather than accepting the declared score at face value.
- **FR-STF-03**: In addition to the AI risk score, every application is automatically checked against the bank's own fixed lending rules (e.g. affordability limits, minimum age); staff can see clearly whether these rules are met before making a decision.
- **FR-STF-04**: The system provides staff with an automatic **recommendation** (approve, decline, or refer for manual review), which staff always review and can override — recording a reason whenever they do.
- **FR-STF-05**: A staff member can move an application forward through its lifecycle: request more information from the applicant, approve, decline, or (once approved) issue a formal loan offer.
- **FR-STF-06**: When declining an application, a staff member must select from the bank's standardised list of decline reasons, ensuring every rejection is properly justified and recorded.
- **FR-STF-07**: A staff member can re-issue or renegotiate a loan offer on an already-approved application (for example, if the original offer has expired).
- **FR-STF-07a**: When issuing or re-issuing a loan offer, a staff member can **waive an individual fee** (e.g. the processing fee) as a goodwill gesture, but must record a reason for doing so — the waiver and its reason become a permanent part of the offer's record.
- **FR-STF-08**: A staff member can view the complete history/audit trail of every status change and decision made on an application, including who made it and when.
- **FR-STF-09**: A staff member can look up how much total exposure the bank already has to a specific guarantor (i.e. how many other loans they are already guaranteeing), before relying on them again.
- **FR-STF-10**: A staff member can run a quick, standalone **risk calculator** for a hypothetical applicant (e.g. to advise a walk-in customer) without creating a real application.

### 4.2 Verifying Documents, Identity & Security

- **FR-STF-11**: A staff member can review documents uploaded by an applicant and mark each as verified or rejected (with a reason).
- **FR-STF-12**: A staff member can verify or reject a customer's submitted NIC/identity, updating their verified status.
- **FR-STF-13**: A staff member can verify or reject a pledged piece of collateral before it is relied upon in a lending decision.

### 4.3 Disbursement & Bank Accounts

- **FR-STF-14**: A staff member can mark an accepted loan as **disbursed**, at which point the loan becomes active and its repayment schedule begins.
- **FR-STF-15**: Before disbursing, a staff member can see exactly which account the funds will be sent to (opened automatically, or already on file).
- **FR-STF-16**: If a customer already holds an account at the bank from before this system existed, a staff member can register that existing account against the customer's record, so it is used instead of a new one being created.

### 4.4 Repayments

- **FR-STF-17**: A staff member can record a repayment received in person or by other offline means (cash, bank transfer, cheque, standing order), specifying the amount, date, and method.
- **FR-STF-18**: The system automatically applies every payment to the right instalment(s) — oldest due first — and correctly splits it between fees, interest, and principal, without staff having to calculate this manually.
- **FR-STF-19**: A staff member can waive an outstanding late fee on a specific instalment, recording a note explaining why.
- **FR-STF-20**: A staff member can view and download the receipt for any payment, whether it was made online by the customer or recorded manually by staff.
- **FR-STF-21**: A staff member can view a customer's complete repayment history and current standing (on-time, overdue, or settled) at a glance.

### 4.5 Customer Directory

- **FR-STF-22**: A staff member can search for and view registered customers and their loan application history.

### 4.6 Currency Exchange Operations

- **FR-STF-23**: A staff member can view live currency rates and analytics.
- **FR-STF-24**: A staff member can view a queue of customer currency exchange requests awaiting review, including current stock availability for the currency requested.
- **FR-STF-25**: A staff member can approve, reject, or counter-offer a currency exchange request, and settle it once funds/documents are in order.

### 4.7 Customer Support

- **FR-STF-26**: A staff member can view and respond to all customer support conversations from a shared inbox.
- **FR-STF-27**: A staff member can update the status of a support conversation (e.g. mark it resolved).
- **FR-STF-28**: A staff member can publish and edit Frequently Asked Questions shown to the public.

### 4.8 Account

- **FR-STF-29**: A staff member has their own profile page and can update their own contact details and password.

---

## 5. Administrator

An administrator can do everything a staff member can do (Section 4), plus
the following, which control how the whole system is configured and how
the bank's overall lending and currency book is performing.

### 5.1 Managing Staff

- **FR-ADM-01**: An administrator can create new staff accounts (staff do not sign themselves up).
- **FR-ADM-02**: An administrator can edit a staff member's details, and activate, suspend, or remove a staff account.

### 5.2 Configuring Loan Products

- **FR-ADM-03**: An administrator can add a new loan product to the catalogue (name, interest rate, allowed amounts, and repayment terms).
- **FR-ADM-04**: An administrator can edit the terms of an existing loan product.
- **FR-ADM-05**: An administrator can remove a loan product, provided no existing applications depend on it.
- **FR-ADM-05a**: An administrator can configure the **fees and charges** for each loan product (e.g. a processing fee as a percentage of the loan amount, or a fixed documentation fee), including minimum/maximum limits where applicable. Changing a product's fees only affects new offers going forward — it never changes what an existing customer was already quoted.

### 5.3 Bank-Wide Reporting & Oversight

- **FR-ADM-06**: An administrator can view a **portfolio dashboard** summarising the bank's entire loan book: approval rates, total disbursed volume, and the proportion of loans that are overdue by 30/60/90+ days.
- **FR-ADM-07**: An administrator can view how the loan book is distributed across products and risk categories.
- **FR-ADM-08**: An administrator can monitor the health and version of the AI risk-assessment model, including whether it is currently reachable and how fresh its supporting data is.

### 5.4 Currency & Foreign Exchange Configuration

- **FR-ADM-09**: An administrator can activate or deactivate individual currencies offered for exchange.
- **FR-ADM-10**: An administrator can set exchange limits and the bank's profit margin (spread) for each currency.
- **FR-ADM-11**: An administrator can view and adjust the bank's foreign currency stock/inventory levels, and view a full movement history for audit purposes.
- **FR-ADM-12**: An administrator can view the bank's overall net foreign currency exposure across all currencies at any time.
- **FR-ADM-13**: An administrator can force an immediate refresh of live exchange rates and underlying analysis, rather than waiting for the scheduled update.
- **FR-ADM-14**: An administrator can generate and export financial reports on currency exchange activity (transaction volumes, revenue earned from spreads) over any date range.

### 5.5 System & Bank Settings

- **FR-ADM-15**: An administrator can configure the bank's own identity details (name, main branch) as shown throughout the system.

---

## 6. Requirements That Apply Across the Whole System

These are not tied to one role — they describe qualities and behaviours
that every part of the system is expected to have.

- **FR-GEN-01**: The system is available in **English, Sinhala, and Tamil** throughout every customer- and public-facing screen.
- **FR-GEN-02**: Every user's password is stored securely and is never visible to bank staff or administrators, including within the system itself.
- **FR-GEN-03**: A user who forgets their password can reset it themselves via a one-time code sent to their registered email, without needing to contact support.
- **FR-GEN-04**: Every significant decision or status change made on a loan (approval, rejection, offer, disbursement, payment) is permanently recorded with who made it and when, creating a full audit trail that cannot be silently altered afterwards.
- **FR-GEN-05**: A user only ever sees data and actions relevant to their own role — a customer cannot see another customer's information, and only administrators can access system configuration.
- **FR-GEN-06**: Users receive timely notifications (in-app, and by email for major events) about anything requiring their attention or confirming an action has taken place.
- **FR-GEN-07**: Card payment information is handled entirely by a trusted, independent, industry-standard payment provider (Stripe) — it is never stored on, or visible to, the bank's own systems.

---

## Notes

- This document describes **what the system does**, not how it is built —
  it deliberately avoids technical terms so it can be reviewed and agreed
  with anyone, regardless of technical background.
- A few capabilities that were explored during development are **not**
  included above because they are not yet part of the system: joint/
  co-borrower applications, loan top-ups or restructuring, repayment
  frequencies other than monthly, product-specific workflows for
  pawning (gold appraisal/auction) and leasing (asset/residual value) beyond
  treating them as standard instalment loans, withdrawing a consent once
  given (a customer can only give a fresh, up-to-date consent — see
  FR-CUS-12a), and refunding a loan fee once charged (an early settlement
  recalculates interest owed, but never refunds a processing/documentation/
  insurance fee already deducted). These can be scoped as future additions
  if needed.
