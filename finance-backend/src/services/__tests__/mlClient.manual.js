"use strict";

/**
 * Manual smoke test for the ML client — no test runner, hits the live model.
 *   node src/services/__tests__/mlClient.manual.js
 *
 * Requires the Python risk model running:
 *   (in loan-risk-model/)  uvicorn api.main:app --port 8000
 *
 * It builds a customer_profiles-shaped profile that mirrors the README sample
 * applicant (34yo, 185k salary, 125k expenses, permanent employment), maps it +
 * a loan request into the 35 raw model fields, prints them, then POSTs to
 * /predict and prints the risk result.
 */

require("dotenv").config();
const {
  mapProfileToModelFields,
  predictRisk,
  MODEL_URL,
} = require("../mlClient.service");

// A stored profile as it would come from the customer_profiles table. Only the
// columns that table actually has — the mapper fills the rest with neutral
// defaults. DOB chosen to give age ~34 (see loan-risk-model/README sample).
const sampleProfile = {
  date_of_birth: "1992-01-15",
  gender: "Male",
  employment_type: "Permanent",
  monthly_income: 185000,
  monthly_expense: 125000,
};

// The loan the customer is applying for (mirrors the README sample amounts).
const sampleLoanRequest = {
  requested_amount: 2500000,
  tenure_months: 36,
  interest_rate: 14.5,
};

async function main() {
  const fields = mapProfileToModelFields(sampleProfile, sampleLoanRequest);

  const count = Object.keys(fields).length;
  console.log(`Mapped ${count} raw model fields (expected 35):\n`);
  console.log(JSON.stringify(fields, null, 2));

  if (count !== 35) {
    console.error(`\n✗ Expected 35 fields, got ${count}.`);
    process.exit(1);
  }

  console.log(`\nCalling ${MODEL_URL}/predict ...\n`);
  try {
    const result = await predictRisk(fields);
    console.log("Risk result:");
    console.log(JSON.stringify(result, null, 2));
    console.log(
      `\n✓ risk_label=${result.risk_label} (${result.risk_category})`
    );
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
}

main();
