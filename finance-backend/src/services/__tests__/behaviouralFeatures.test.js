"use strict";

/**
 * Runnable test script for behavioural credit features and the model-field
 * mapper (v2 risk model).
 *   node src/services/__tests__/behaviouralFeatures.test.js
 * Exits non-zero on the first failed assertion.
 *
 * The load-bearing tests in here are the PRECEDENCE ones. The mapper layers
 * four sources — neutral default, behavioural observation, applicant
 * declaration, hard profile fact — and getting that order wrong is silent:
 * the model still returns a plausible number, it is just computed from the
 * wrong input. Nothing else in the system would catch it.
 *
 * Second load-bearing case: `previous_defaults` must reach the model as
 * `number_of_defaults`. In v1 the declared value was sent under a field name
 * the model measurably ignored (0.00009 probability swing across its full
 * range) while the field carrying ~38% of the model's gain was hardcoded to
 * zero. A customer declaring "I have defaulted twice" changed nothing.
 */

const assert = require("assert");
const {
  deriveBehaviouralFeatures,
  reconcileDeclaredCribScore,
  shrink,
  SHRINKAGE_STRENGTH,
  PRIORS,
  CRIB_CEILING_BY_DEFAULTS,
} = require("../behaviouralFeatures.service");
const {
  mapProfileToModelFields,
  normalizeEmploymentType,
  NEUTRAL_DEFAULTS,
  EMPLOYMENT_TYPE_FALLBACK,
} = require("../mlClient.service");

// The vocabulary the model was trained on. Duplicated here on purpose: if
// loan-risk-model/src/config.py ever changes it, this test should fail rather
// than quietly follow along.
const MODEL_EMPLOYMENT_TYPES = [
  "Permanent",
  "Contract",
  "Self-Employed",
  "Government",
];

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const closeTo = (actual, expected, tol, label) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${label}: expected ~${expected}, got ${actual} (tolerance ${tol})`
  );

/** A findBorrowerCreditHistory-shaped row. */
const history = (o = {}) => ({
  total_accounts: 0,
  active_accounts: 0,
  closed_accounts: 0,
  written_off_accounts: 0,
  highest_principal: 0,
  total_installments: 0,
  overdue_installments: 0,
  paid_installments: 0,
  outstanding_principal: 0,
  scheduled_principal: 0,
  late_installments: 0,
  application_count: 0,
  restructured_facilities: 0,
  ...o,
});

// ---------------------------------------------------------------------------
console.log("deriveBehaviouralFeatures — a customer with no record");

check("null history is a thin file, not a crash", () => {
  const { fields, meta } = deriveBehaviouralFeatures(null);
  assert.strictEqual(meta.has_internal_history, false);
  assert.strictEqual(meta.is_thin_file, true);
  assert.strictEqual(fields.number_of_defaults, null);
});

check("a customer with no record reports UNKNOWN, not an average", () => {
  const { fields } = deriveBehaviouralFeatures(history());
  // This is the load-bearing assertion of the whole module.
  //
  // Zero utilisation and zero overdue instalments would read as a PERFECT
  // customer; a population-average 0.85 punctuality would read as a reliable
  // one. Both are claims about somebody nobody has ever observed. The model
  // is trained with these fields absent and learns a default branch for
  // missing values, so null is the honest input — and measurably so: before
  // this change an applicant declaring three defaults still scored "Low Risk"
  // because the fabricated block insisted everything else was fine.
  for (const f of [
    "credit_utilization",
    "avg_repayment_behaviour",
    "overdue_installments",
    "historical_delinquencies",
    "number_of_defaults",
    "active_facilities",
    "settled_loans",
  ]) {
    assert.strictEqual(fields[f], null, `${f} should be null for a thin file`);
  }
});

check("evidence_weight is 0 when nothing has been observed", () => {
  const { meta } = deriveBehaviouralFeatures(history());
  assert.strictEqual(meta.evidence_weight, 0);
});

// ---------------------------------------------------------------------------
console.log("deriveBehaviouralFeatures — hard counts are never softened");

check("a written-off facility becomes a default, at full weight", () => {
  const { fields } = deriveBehaviouralFeatures(
    history({ total_accounts: 2, written_off_accounts: 1, closed_accounts: 1 })
  );
  // Not shrunk toward a prior: a charge-off is a fact, not an estimate.
  assert.strictEqual(fields.number_of_defaults, 1);
});

check("overdue instalments pass through exactly", () => {
  const { fields } = deriveBehaviouralFeatures(
    history({ total_accounts: 1, active_accounts: 1, overdue_installments: 4 })
  );
  assert.strictEqual(fields.overdue_installments, 4);
});

check("late instalments become historical delinquencies", () => {
  const { fields } = deriveBehaviouralFeatures(
    history({ total_accounts: 1, total_installments: 24, late_installments: 5 })
  );
  assert.strictEqual(fields.historical_delinquencies, 5);
});

check("account statuses map to active/settled counts", () => {
  const { fields } = deriveBehaviouralFeatures(
    history({ total_accounts: 5, active_accounts: 2, closed_accounts: 3 })
  );
  assert.strictEqual(fields.active_facilities, 2);
  assert.strictEqual(fields.settled_loans, 3);
  assert.strictEqual(fields.existing_loans, 2);
});

// ---------------------------------------------------------------------------
console.log("deriveBehaviouralFeatures — punctuality");

check("a spotless long record approaches, but never fakes, perfection", () => {
  const { fields } = deriveBehaviouralFeatures(
    history({
      total_accounts: 2,
      total_installments: 60,
      paid_installments: 60,
      late_installments: 0,
    })
  );
  assert.ok(
    fields.avg_repayment_behaviour > PRIORS.avg_repayment_behaviour,
    "a clean record should beat the neutral prior"
  );
  assert.ok(fields.avg_repayment_behaviour < 1.0, "shrinkage must keep it under 1");
});

check("a bad record drags punctuality below the prior", () => {
  const { fields } = deriveBehaviouralFeatures(
    history({
      total_accounts: 1,
      total_installments: 24,
      paid_installments: 24,
      late_installments: 18,
    })
  );
  assert.ok(fields.avg_repayment_behaviour < PRIORS.avg_repayment_behaviour);
});

check("punctuality is judged on CONCLUDED instalments only", () => {
  // Three months into a five-year loan: 57 instalments are not yet due.
  // Counting them as on-time would manufacture a spotless record out of a
  // loan that has barely started.
  const early = deriveBehaviouralFeatures(
    history({
      total_accounts: 1,
      total_installments: 60,
      paid_installments: 3,
      late_installments: 0,
    })
  );
  const finished = deriveBehaviouralFeatures(
    history({
      total_accounts: 1,
      total_installments: 60,
      paid_installments: 60,
      late_installments: 0,
    })
  );
  assert.ok(
    finished.fields.avg_repayment_behaviour >
      early.fields.avg_repayment_behaviour,
    "a completed clean loan must outrank one three payments in"
  );
});

check("more history means more weight on the customer's own record", () => {
  const thin = deriveBehaviouralFeatures(
    history({ total_accounts: 1, total_installments: 2, paid_installments: 2 })
  );
  const thick = deriveBehaviouralFeatures(
    history({ total_accounts: 3, total_installments: 90, paid_installments: 90 })
  );
  assert.ok(thick.meta.evidence_weight > thin.meta.evidence_weight);
});

// ---------------------------------------------------------------------------
console.log("deriveBehaviouralFeatures — utilisation");

check("utilisation reflects how much of the schedule is still owed", () => {
  const { fields } = deriveBehaviouralFeatures(
    history({
      total_accounts: 4,
      active_accounts: 4,
      total_installments: 48,
      scheduled_principal: 1_000_000,
      outstanding_principal: 800_000,
    })
  );
  // 80% drawn, shrunk toward the 30% prior with 4 facilities against k=2.
  assert.ok(fields.credit_utilization > PRIORS.credit_utilization);
  assert.ok(fields.credit_utilization <= 80);
});

check("a nearly-repaid book reads as low utilisation", () => {
  const { fields } = deriveBehaviouralFeatures(
    history({
      total_accounts: 4,
      active_accounts: 4,
      scheduled_principal: 1_000_000,
      outstanding_principal: 50_000,
    })
  );
  assert.ok(fields.credit_utilization < PRIORS.credit_utilization);
});

check("utilisation stays within 0..100 even on absurd input", () => {
  const { fields } = deriveBehaviouralFeatures(
    history({
      total_accounts: 1,
      active_accounts: 1,
      scheduled_principal: 1,
      outstanding_principal: 999_999_999,
    })
  );
  assert.ok(fields.credit_utilization >= 0 && fields.credit_utilization <= 100);
});

// ---------------------------------------------------------------------------
console.log("shrink");

check("no observations returns the prior exactly", () => {
  assert.strictEqual(shrink(1.0, 0.85, 0), 0.85);
});

check("equal weight at exactly k observations", () => {
  closeTo(shrink(1.0, 0.0, SHRINKAGE_STRENGTH), 0.5, 1e-9, "half-way blend");
});

check("converges on the observed value as evidence accumulates", () => {
  closeTo(shrink(1.0, 0.0, 10_000), 1.0, 1e-3, "large-n limit");
});

check("a non-finite observation falls back to the prior", () => {
  assert.strictEqual(shrink(NaN, 0.85, 50), 0.85);
});

// ---------------------------------------------------------------------------
console.log("mapProfileToModelFields — source precedence");

const profile = {
  age: 34,
  employment_type: "Permanent",
  monthly_income: 150000,
  monthly_expense: 90000,
};
const loanRequest = {
  requested_amount: 1_000_000,
  tenure_months: 36,
  interest_rate: 15,
};

check("with nothing known, unknown fields reach the model as null", () => {
  const f = mapProfileToModelFields(profile, loanRequest, {}, {});
  assert.strictEqual(f.credit_utilization, null);
  assert.strictEqual(f.number_of_defaults, null);
  assert.strictEqual(f.avg_repayment_behaviour, null);
  assert.strictEqual(f.crib_score, null);
});

check("a declaration alone is still a fact, not unknown", () => {
  const f = mapProfileToModelFields(profile, loanRequest, {
    previous_defaults: 2,
  });
  assert.strictEqual(f.number_of_defaults, 2);
});

check("an observation alone is still a fact, not unknown", () => {
  const f = mapProfileToModelFields(profile, loanRequest, {}, {
    number_of_defaults: 1,
  });
  assert.strictEqual(f.number_of_defaults, 1);
});

check("fields with a genuine real-world zero are NOT nulled", () => {
  // "No guarantor pledged" is a fact, not an absence of information — unlike
  // "we have never seen this customer's repayment record".
  const f = mapProfileToModelFields(profile, loanRequest, {}, {});
  assert.strictEqual(f.guarantor_exposure, 0);
  assert.strictEqual(f.guarantor_defaults, 0);
});

check("a behavioural observation beats the neutral default", () => {
  const f = mapProfileToModelFields(
    profile,
    loanRequest,
    {},
    { credit_utilization: 72, overdue_installments: 3 }
  );
  assert.strictEqual(f.credit_utilization, 72);
  assert.strictEqual(f.overdue_installments, 3);
});

check("an applicant declaration beats a behavioural observation", () => {
  // Our record is a lower bound — the applicant can see facilities at other
  // institutions that we cannot.
  const f = mapProfileToModelFields(
    profile,
    loanRequest,
    { crib_score: 620 },
    { crib_score: 700 }
  );
  assert.strictEqual(f.crib_score, 620);
});

check("a blank declaration does NOT clobber a behavioural value", () => {
  const f = mapProfileToModelFields(
    profile,
    loanRequest,
    { crib_score: "" },
    { credit_utilization: 65 }
  );
  assert.strictEqual(f.credit_utilization, 65);
  assert.strictEqual(f.crib_score, NEUTRAL_DEFAULTS.crib_score);
});

// ---------------------------------------------------------------------------
console.log("mapProfileToModelFields — the v1 defaults defect");

check("a declared previous_defaults reaches number_of_defaults", () => {
  const f = mapProfileToModelFields(profile, loanRequest, {
    previous_defaults: 2,
  });
  assert.strictEqual(f.number_of_defaults, 2);
});

check("the retired previous_defaults field is no longer sent", () => {
  const f = mapProfileToModelFields(profile, loanRequest, {
    previous_defaults: 2,
  });
  assert.ok(
    !("previous_defaults" in f),
    "previous_defaults must not be sent — the v2 model has no such input"
  );
});

check("declared and observed defaults take the worse, never the sum", () => {
  // Summing would double-count the same charge-off the customer declared.
  const f = mapProfileToModelFields(
    profile,
    loanRequest,
    { previous_defaults: 1 },
    { number_of_defaults: 1 }
  );
  assert.strictEqual(f.number_of_defaults, 1);
});

check("an observed default survives an applicant declaring none", () => {
  const f = mapProfileToModelFields(
    profile,
    loanRequest,
    { previous_defaults: 0 },
    { number_of_defaults: 2 }
  );
  assert.strictEqual(f.number_of_defaults, 2);
});

check("a declared default survives an empty internal record", () => {
  const f = mapProfileToModelFields(
    profile,
    loanRequest,
    { previous_defaults: 3 },
    { number_of_defaults: 0 }
  );
  assert.strictEqual(f.number_of_defaults, 3);
});

// ---------------------------------------------------------------------------
console.log("mapProfileToModelFields — protected attributes and derived fields");

check("gender is never sent to the model", () => {
  const f = mapProfileToModelFields(
    { ...profile, gender: "Female" },
    loanRequest,
    {}
  );
  assert.ok(
    !("gender" in f),
    "gender is a protected attribute and must not reach a credit model"
  );
});

check("derived features are never sent — the model computes them", () => {
  const f = mapProfileToModelFields(profile, loanRequest, {});
  for (const derived of [
    "emi",
    "debt_to_income_ratio",
    "expense_ratio",
    "disposable_income",
    "guarantor_risk_score",
    "financial_stability_score",
    "repayment_consistency_score",
    "loan_burden_ratio",
  ]) {
    assert.ok(!(derived in f), `${derived} must not be sent by the gateway`);
  }
});

check("savings_ratio is derived from real income and expense", () => {
  const f = mapProfileToModelFields(profile, loanRequest, {});
  closeTo(f.savings_ratio, (150000 - 90000) / 150000, 1e-9, "savings_ratio");
});

check("the request's own loan terms always win", () => {
  const f = mapProfileToModelFields(profile, loanRequest, {}, {});
  assert.strictEqual(f.loan_amount, 1_000_000);
  assert.strictEqual(f.loan_tenure_months, 36);
  assert.strictEqual(f.interest_rate, 15);
});

// ---------------------------------------------------------------------------
console.log("reconcileDeclaredCribScore — an unverifiable claim vs. the file");

check("a clean file's high score is left completely alone", () => {
  const r = reconcileDeclaredCribScore(880, {
    number_of_defaults: 0,
    overdue_installments: 0,
  });
  assert.strictEqual(r.score, 880);
  assert.strictEqual(r.capped, false);
});

check("a modest score is never raised toward the ceiling", () => {
  const r = reconcileDeclaredCribScore(410, {
    number_of_defaults: 0,
    overdue_installments: 0,
  });
  assert.strictEqual(r.score, 410);
  assert.strictEqual(r.capped, false);
});

check("declaring 900 alongside three defaults is capped", () => {
  const r = reconcileDeclaredCribScore(900, {
    number_of_defaults: 3,
    overdue_installments: 0,
  });
  assert.ok(r.capped, "a self-contradictory declaration must be capped");
  assert.strictEqual(r.score, CRIB_CEILING_BY_DEFAULTS[3]);
  assert.strictEqual(r.declared, 900, "the original claim must be preserved");
});

check("the ceiling falls monotonically as defaults accumulate", () => {
  const scores = [0, 1, 2, 3, 5].map(
    (d) =>
      reconcileDeclaredCribScore(900, {
        number_of_defaults: d,
        overdue_installments: 0,
      }).score
  );
  for (let i = 1; i < scores.length; i += 1) {
    assert.ok(scores[i] <= scores[i - 1], `ceiling rose at ${i} defaults`);
  }
});

check("heavy arrears cap the score even with no recorded default", () => {
  const r = reconcileDeclaredCribScore(880, {
    number_of_defaults: 0,
    overdue_installments: 7,
  });
  assert.ok(r.capped);
  assert.ok(r.score < 880);
});

check("the stricter of the two ceilings wins", () => {
  const r = reconcileDeclaredCribScore(900, {
    number_of_defaults: 3, // ceiling 470
    overdue_installments: 1, // ceiling 720
  });
  assert.strictEqual(r.score, 470);
});

check("no declaration stays null rather than becoming the ceiling", () => {
  const r = reconcileDeclaredCribScore(null, {
    number_of_defaults: 3,
    overdue_installments: 6,
  });
  assert.strictEqual(r.score, null);
  assert.strictEqual(r.capped, false);
});

check("the cap reaches the model through the mapper", () => {
  const f = mapProfileToModelFields(
    profile,
    loanRequest,
    { crib_score: 900, previous_defaults: 3 },
    {}
  );
  assert.ok(
    f.crib_score <= CRIB_CEILING_BY_DEFAULTS[3],
    `expected the capped score, got ${f.crib_score}`
  );
  assert.strictEqual(f.number_of_defaults, 3);
});

check("an honest applicant is unaffected end-to-end", () => {
  const f = mapProfileToModelFields(
    profile,
    loanRequest,
    { crib_score: 815, previous_defaults: 0 },
    {}
  );
  assert.strictEqual(f.crib_score, 815);
});

check("observed defaults cap a declaration even when none were declared", () => {
  const f = mapProfileToModelFields(
    profile,
    loanRequest,
    { crib_score: 900, previous_defaults: 0 },
    { number_of_defaults: 2 }
  );
  assert.strictEqual(f.crib_score, CRIB_CEILING_BY_DEFAULTS[2]);
});

// ---------------------------------------------------------------------------
console.log("normalizeEmploymentType — two vocabularies that never matched");

check("EVERY registration option maps into the model's vocabulary", () => {
  // The regression this guards: Register.jsx offers a taxonomy the model has
  // never known, and v1's OneHotEncoder(handle_unknown='ignore') swallowed the
  // mismatch — making employment_type a dead feature for real customers. Once
  // the model started validating its inputs, the same mismatch became a hard
  // 422 on every single assessment.
  const registrationOptions = [
    "Salaried Employee",
    "Self Employed",
    "Business Owner",
    "Student",
    "Unemployed",
  ];
  for (const option of registrationOptions) {
    const mapped = normalizeEmploymentType(option);
    assert.ok(
      MODEL_EMPLOYMENT_TYPES.includes(mapped),
      `${option} mapped to ${mapped}, which the model does not accept`
    );
  }
});

check("legacy free text already in the database is handled", () => {
  for (const legacy of ["employed", "Private Sector", "Government Sector"]) {
    assert.ok(MODEL_EMPLOYMENT_TYPES.includes(normalizeEmploymentType(legacy)));
  }
});

check("the model's own values pass through unchanged", () => {
  for (const t of MODEL_EMPLOYMENT_TYPES) {
    assert.strictEqual(normalizeEmploymentType(t), t);
  }
});

check("matching ignores case and surrounding whitespace", () => {
  assert.strictEqual(normalizeEmploymentType("  self employed "), "Self-Employed");
  assert.strictEqual(normalizeEmploymentType("SALARIED EMPLOYEE"), "Permanent");
});

check("a salaried job maps to permanent, a business owner to self-employed", () => {
  assert.strictEqual(normalizeEmploymentType("Salaried Employee"), "Permanent");
  assert.strictEqual(normalizeEmploymentType("Business Owner"), "Self-Employed");
});

check("missing or unrecognised never throws and never escapes the vocabulary", () => {
  // A new registration option must degrade the score, not break the
  // assessment with a validation error.
  for (const bad of [null, undefined, "", "Gig Worker", 42, "  "]) {
    const mapped = normalizeEmploymentType(bad);
    assert.ok(
      MODEL_EMPLOYMENT_TYPES.includes(mapped),
      `${JSON.stringify(bad)} produced ${mapped}`
    );
  }
});

check("the fallback is conservative, not the most favourable option", () => {
  // Permanent has the LOWEST observed default rate in the training data, so
  // defaulting an unknown to it would quietly flatter the applicant.
  assert.strictEqual(EMPLOYMENT_TYPE_FALLBACK, "Contract");
  assert.notStrictEqual(EMPLOYMENT_TYPE_FALLBACK, "Permanent");
});

check("the mapper only ever sends a valid employment_type", () => {
  for (const raw of [
    "Salaried Employee", "Self Employed", "Business Owner",
    "Student", "Unemployed", "employed", null, "Gig Worker",
  ]) {
    const f = mapProfileToModelFields(
      { ...profile, employment_type: raw },
      loanRequest,
      {}
    );
    assert.ok(
      MODEL_EMPLOYMENT_TYPES.includes(f.employment_type),
      `profile "${raw}" produced ${f.employment_type}`
    );
  }
});

console.log(`\n${passed} passed`);
