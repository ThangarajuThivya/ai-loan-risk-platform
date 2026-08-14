"use strict";

/**
 * Cross-document validation — pure, deterministic, no I/O. Takes the field
 * bundles produced by documentExtraction.service.js's `extractFields` (one
 * bundle per document, keyed by document type) plus the applicant's
 * declared data, and checks them against each other.
 *
 * Every extracted field bundle uses documentExtraction.service.js's
 * `{ value, snippet, confidence } | null` shape. A few bundle fields this
 * validator reads are not produced by any extractor yet (national_id.name,
 * payslip.*, bank_statement.recurring_salary_credit,
 * vehicle_invoice/valuation_report/release_letter.chassis_number) — they
 * are part of this validator's own input contract, forward-compatible with
 * extractors that don't exist yet, and simply treated as missing (checks
 * are skipped, not failed) until they are supplied.
 *
 * Output is a flat list of findings:
 *   { code, severity, message, fields }
 * severity is one of "info" | "warning" | "blocker". A rule that has
 * enough data to run always emits exactly one finding (info on pass,
 * warning/blocker on fail); a rule with insufficient data emits nothing —
 * this service never guesses.
 *
 * Severity policy:
 *   - blocker: the check directly bears on identity or collateral fraud/
 *     integrity (NIC-derived DOB/gender mismatch, chassis number mismatch
 *     across vehicle documents, lease collateral not owned by the
 *     applicant). These are showstoppers an underwriter must resolve
 *     before proceeding.
 *   - warning: the check is corroborative but individually noisy (fuzzy
 *     name matching, payslip arithmetic, statutory rate corroboration,
 *     income corroboration) — formatting differences, OCR error, or
 *     ordinary payroll variance can trigger these without anything being
 *     actually wrong, so they need a human look rather than an automatic
 *     block.
 *   - info: the check ran and corroborated, recorded for audit trail.
 */

const { crossCheckNic } = require("./nicValidation.service");

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Unwrap a documentExtraction.service.js field ({value,...} | null) to its value. */
function unwrap(field) {
  return field ? field.value : null;
}

function finding(code, severity, message, fields) {
  return { code, severity, message, fields };
}

// ---------------------------------------------------------------------------
// Fuzzy name matching
// ---------------------------------------------------------------------------

/**
 * Below this similarity score, two names are treated as not matching.
 * Chosen so that a missing middle initial, swapped token order, or an
 * initial standing in for a full given name doesn't fail the match, but a
 * name that is materially different does. Tuned rather than derived —
 * documented here so it can be revisited.
 */
const NAME_MATCH_THRESHOLD = 0.6;

/** Uppercase, strip punctuation, collapse whitespace, split into tokens. */
function nameTokens(name) {
  return String(name || "")
    .toUpperCase()
    .replace(/[.,]/g, " ")
    .replace(/[^A-Z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** 1.0 for an exact token match, 0.8 when one token is a single-letter initial of the other (e.g. "K" vs "KAMAL"), else 0. */
function tokenSimilarity(a, b) {
  if (a === b) return 1;
  if (a.length === 1 && b.length > 1 && b[0] === a) return 0.8;
  if (b.length === 1 && a.length > 1 && a[0] === b) return 0.8;
  return 0;
}

/**
 * Order-insensitive name similarity: greedily pair each token in the
 * shorter name with its best-scoring unused token in the longer name, sum
 * the scores, and normalize by the longer name's token count (so an unmatched
 * extra token in the longer name still costs something).
 * @returns {number} 0..1
 */
function nameMatchScore(nameA, nameB) {
  const tokensA = nameTokens(nameA);
  const tokensB = nameTokens(nameB);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const [shorter, longer] = tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
  const usedLonger = new Array(longer.length).fill(false);
  let total = 0;

  for (const tok of shorter) {
    let bestIndex = -1;
    let bestScore = 0;
    for (let i = 0; i < longer.length; i += 1) {
      if (usedLonger[i]) continue;
      const score = tokenSimilarity(tok, longer[i]);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    if (bestIndex !== -1) {
      usedLonger[bestIndex] = true;
      total += bestScore;
    }
  }

  return total / longer.length;
}

function namePairFinding(codePrefix, labelA, nameA, labelB, nameB, fieldA, fieldB) {
  if (!nameA || !nameB) return null;
  const score = nameMatchScore(nameA, nameB);
  if (score >= NAME_MATCH_THRESHOLD) {
    return finding(
      `${codePrefix}_match`,
      "info",
      `${labelA} ("${nameA}") and ${labelB} ("${nameB}") match (score ${score.toFixed(2)}).`,
      [fieldA, fieldB]
    );
  }
  return finding(
    `${codePrefix}_mismatch`,
    "warning",
    `${labelA} ("${nameA}") and ${labelB} ("${nameB}") do not appear to match (score ${score.toFixed(2)}, threshold ${NAME_MATCH_THRESHOLD}).`,
    [fieldA, fieldB]
  );
}

// ---------------------------------------------------------------------------
// 3.1 Payslip arithmetic
// ---------------------------------------------------------------------------

/** LKR tolerance for gross - deductions = net, to absorb rounding. */
const ARITHMETIC_TOLERANCE_LKR = 1;

/** Statutory contribution rates and the tolerance used to judge "approximately". */
const EPF_EMPLOYEE_RATE = 0.08;
const EPF_EMPLOYER_RATE = 0.12;
const ETF_EMPLOYER_RATE = 0.03;
/** A rate is "consistent" if within 10% relative or Rs. 5 absolute of the statutory expectation, whichever is larger — absorbs rounding on small basic salaries without being so loose it stops meaning anything. */
const RATE_TOLERANCE_RATIO = 0.1;
const RATE_TOLERANCE_MIN_LKR = 5;

function validatePayslipArithmetic(payslip) {
  const gross = unwrap(payslip?.gross_salary);
  const totalDeductions = unwrap(payslip?.total_deductions);
  const net = unwrap(payslip?.net_salary);
  if (gross === null || totalDeductions === null || net === null) return null;

  const expectedNet = gross - totalDeductions;
  const diff = Math.abs(expectedNet - net);
  const fields = ["payslip.gross_salary", "payslip.total_deductions", "payslip.net_salary"];

  if (diff <= ARITHMETIC_TOLERANCE_LKR) {
    return finding(
      "payslip_arithmetic_consistent",
      "info",
      `Gross (${gross}) minus total deductions (${totalDeductions}) equals net (${net}).`,
      fields
    );
  }
  return finding(
    "payslip_arithmetic_mismatch",
    "warning",
    `Gross (${gross}) minus total deductions (${totalDeductions}) = ${expectedNet}, which does not match the stated net (${net}).`,
    fields
  );
}

function validateStatutoryRate(basic, actual, expectedRate, code, label, actualFieldName) {
  if (basic === null || actual === null) return null;
  const expected = basic * expectedRate;
  const tolerance = Math.max(expected * RATE_TOLERANCE_RATIO, RATE_TOLERANCE_MIN_LKR);
  const diff = Math.abs(expected - actual);
  const fields = ["payslip.basic_salary", actualFieldName];

  if (diff <= tolerance) {
    return finding(
      `${code}_corroborated`,
      "info",
      `${label} (${actual}) is consistent with ${(expectedRate * 100).toFixed(0)}% of basic salary (${basic}).`,
      fields
    );
  }
  return finding(
    `${code}_inconsistent`,
    "warning",
    `${label} (${actual}) is not consistent with ${(expectedRate * 100).toFixed(0)}% of basic salary (${basic}); expected approximately ${expected.toFixed(2)}.`,
    fields
  );
}

function validatePayslip(payslip) {
  if (!payslip) return [];
  const basic = unwrap(payslip.basic_salary);
  const findings = [validatePayslipArithmetic(payslip)];

  findings.push(
    validateStatutoryRate(
      basic,
      unwrap(payslip.epf_employee),
      EPF_EMPLOYEE_RATE,
      "epf_employee_rate",
      "EPF employee contribution",
      "payslip.epf_employee"
    )
  );
  findings.push(
    validateStatutoryRate(
      basic,
      unwrap(payslip.epf_employer),
      EPF_EMPLOYER_RATE,
      "epf_employer_rate",
      "EPF employer contribution",
      "payslip.epf_employer"
    )
  );
  findings.push(
    validateStatutoryRate(
      basic,
      unwrap(payslip.etf_employer),
      ETF_EMPLOYER_RATE,
      "etf_employer_rate",
      "ETF employer contribution",
      "payslip.etf_employer"
    )
  );

  return findings.filter(Boolean);
}

// ---------------------------------------------------------------------------
// 3.2 Cross-document identity (fuzzy name matching)
// ---------------------------------------------------------------------------

function validateIdentityNames(extracted, declared) {
  const nicName = unwrap(extracted?.national_id?.name);
  const payslipName = unwrap(extracted?.payslip?.employee_name);
  const bankStatementName = unwrap(extracted?.bank_statement?.account_holder);
  const registeredAccountHolder = declared?.bankAccountHolderName || null;

  const sources = [
    { key: "nic", label: "Name on NIC", name: nicName, field: "national_id.name" },
    { key: "payslip", label: "Name on payslip", name: payslipName, field: "payslip.employee_name" },
    {
      key: "bank_statement",
      label: "Name on bank statement",
      name: bankStatementName,
      field: "bank_statement.account_holder",
    },
    {
      key: "registered_account",
      label: "Registered bank account holder",
      name: registeredAccountHolder,
      field: "declared.bankAccountHolderName",
    },
  ].filter((s) => s.name);

  const findings = [];
  for (let i = 0; i < sources.length; i += 1) {
    for (let j = i + 1; j < sources.length; j += 1) {
      const a = sources[i];
      const b = sources[j];
      const f = namePairFinding(`identity_name_${a.key}_${b.key}`, a.label, a.name, b.label, b.name, a.field, b.field);
      if (f) findings.push(f);
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 3.3 NIC-derived identity facts
// ---------------------------------------------------------------------------

function validateNicDerivedIdentity(extracted, declared) {
  const nic = unwrap(extracted?.national_id?.national_id)?.nic;
  if (!nic) return [];

  const result = crossCheckNic(nic, {
    declaredDob: declared?.dateOfBirth,
    declaredGender: declared?.gender,
  });
  if (!result.parsed.valid) return [];

  const findings = [];

  if (declared?.dateOfBirth) {
    findings.push(
      result.dobMismatch
        ? finding(
            "nic_dob_mismatch",
            "blocker",
            `NIC-derived date of birth (${result.parsed.dateOfBirth}) does not match the declared date of birth (${declared.dateOfBirth}).`,
            ["national_id.national_id", "declared.dateOfBirth"]
          )
        : finding(
            "nic_dob_match",
            "info",
            `NIC-derived date of birth (${result.parsed.dateOfBirth}) matches the declared date of birth.`,
            ["national_id.national_id", "declared.dateOfBirth"]
          )
    );
  }

  if (declared?.gender) {
    findings.push(
      result.genderMismatch
        ? finding(
            "nic_gender_mismatch",
            "blocker",
            `NIC-derived gender (${result.parsed.gender}) does not match the declared gender (${declared.gender}).`,
            ["national_id.national_id", "declared.gender"]
          )
        : finding(
            "nic_gender_match",
            "info",
            `NIC-derived gender (${result.parsed.gender}) matches the declared gender.`,
            ["national_id.national_id", "declared.gender"]
          )
    );
  }

  return findings;
}

// ---------------------------------------------------------------------------
// 3.4 Income corroboration
// ---------------------------------------------------------------------------

/** Relative tolerance for comparing two income figures — payroll rounding, mid-month raises, and partial-month bank credits mean an exact match is not expected. */
const INCOME_TOLERANCE_RATIO = 0.1;

function incomePairFinding(labelA, amountA, fieldA, labelB, amountB, fieldB) {
  if (amountA === null || amountB === null) return null;
  const larger = Math.max(Math.abs(amountA), Math.abs(amountB));
  const diff = Math.abs(amountA - amountB);
  const tolerance = larger * INCOME_TOLERANCE_RATIO;
  const fields = [fieldA, fieldB];

  if (diff <= tolerance) {
    return finding(
      "income_corroboration_match",
      "info",
      `${labelA} (${amountA}) and ${labelB} (${amountB}) are consistent (within ${(INCOME_TOLERANCE_RATIO * 100).toFixed(0)}%).`,
      fields
    );
  }
  return finding(
    "income_corroboration_mismatch",
    "warning",
    `${labelA} (${amountA}) and ${labelB} (${amountB}) differ by more than ${(INCOME_TOLERANCE_RATIO * 100).toFixed(0)}%.`,
    fields
  );
}

function validateIncomeCorroboration(extracted, declared) {
  const payslipNet = unwrap(extracted?.payslip?.net_salary);
  const bankCredit = unwrap(extracted?.bank_statement?.recurring_salary_credit);
  const declaredIncome = typeof declared?.monthlyIncome === "number" ? declared.monthlyIncome : null;

  const findings = [];
  const f1 = incomePairFinding(
    "Payslip net salary",
    payslipNet,
    "payslip.net_salary",
    "Recurring bank salary credit",
    bankCredit,
    "bank_statement.recurring_salary_credit"
  );
  if (f1) findings.push(f1);

  const f2 = incomePairFinding(
    "Payslip net salary",
    payslipNet,
    "payslip.net_salary",
    "Income declared to the risk model",
    declaredIncome,
    "declared.monthlyIncome"
  );
  if (f2) findings.push(f2);

  const f3 = incomePairFinding(
    "Recurring bank salary credit",
    bankCredit,
    "bank_statement.recurring_salary_credit",
    "Income declared to the risk model",
    declaredIncome,
    "declared.monthlyIncome"
  );
  if (f3) findings.push(f3);

  return findings;
}

// ---------------------------------------------------------------------------
// 3.5 Lease-specific chassis chain
// ---------------------------------------------------------------------------

function normalizeChassis(v) {
  return String(v || "").replace(/[\s-]/g, "").toUpperCase();
}

function validateChassisChain(extracted) {
  const sources = [
    { key: "cr_copy", field: "cr_copy.chassis_number", value: unwrap(extracted?.cr_copy?.chassis_number) },
    {
      key: "vehicle_invoice",
      field: "vehicle_invoice.chassis_number",
      value: unwrap(extracted?.vehicle_invoice?.chassis_number),
    },
    {
      key: "valuation_report",
      field: "valuation_report.chassis_number",
      value: unwrap(extracted?.valuation_report?.chassis_number),
    },
    {
      key: "release_letter",
      field: "release_letter.chassis_number",
      value: unwrap(extracted?.release_letter?.chassis_number),
    },
  ].filter((s) => s.value);

  if (sources.length < 2) return [];

  const normalized = sources.map((s) => ({ ...s, norm: normalizeChassis(s.value) }));
  const mismatched = normalized.filter((s) => s.norm !== normalized[0].norm);
  const fields = normalized.map((s) => s.field);

  if (mismatched.length === 0) {
    return [
      finding(
        "chassis_number_consistent",
        "info",
        `Chassis number "${normalized[0].value}" matches across ${normalized.map((s) => s.key).join(", ")}.`,
        fields
      ),
    ];
  }

  return [
    finding(
      "chassis_number_mismatch",
      "blocker",
      `Chassis number is not consistent across documents: ${normalized.map((s) => `${s.key}="${s.value}"`).join(", ")}.`,
      fields
    ),
  ];
}

// ---------------------------------------------------------------------------
// 3.6 Encumbrance
// ---------------------------------------------------------------------------

function validateEncumbrance(extracted, declared) {
  if (!declared?.isLease) return [];
  const absoluteOwner = unwrap(extracted?.cr_copy?.absolute_owner);
  if (!absoluteOwner?.name || !declared?.fullName) return [];

  const score = nameMatchScore(absoluteOwner.name, declared.fullName);
  const fields = ["cr_copy.absolute_owner", "declared.fullName"];

  if (score >= NAME_MATCH_THRESHOLD) {
    return [
      finding(
        "no_encumbrance_detected",
        "info",
        `Absolute owner on the CR copy ("${absoluteOwner.name}") matches the applicant.`,
        fields
      ),
    ];
  }
  return [
    finding(
      "encumbrance_absolute_owner_not_applicant",
      "blocker",
      `Absolute owner on the CR copy ("${absoluteOwner.name}") is not the applicant ("${declared.fullName}")${
        absoluteOwner.likelyFinanceCompany ? " and appears to be a finance company, indicating an existing encumbrance" : ""
      }.`,
      fields
    ),
  ];
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Run all cross-document validation rules against a set of extracted
 * document field bundles and the applicant's declared data.
 * @param {Object} args
 * @param {Object} args.extracted field bundles keyed by document type (see file header for expected shape)
 * @param {Object} args.declared applicant-declared data: fullName, dateOfBirth, gender, monthlyIncome, bankAccountHolderName, isLease
 * @returns {Array<{code: string, severity: 'info'|'warning'|'blocker', message: string, fields: string[]}>}
 */
function validateApplication({ extracted = {}, declared = {} } = {}) {
  return [
    ...validatePayslip(extracted.payslip),
    ...validateIdentityNames(extracted, declared),
    ...validateNicDerivedIdentity(extracted, declared),
    ...validateIncomeCorroboration(extracted, declared),
    ...validateChassisChain(extracted),
    ...validateEncumbrance(extracted, declared),
  ];
}

module.exports = {
  validateApplication,
  nameMatchScore,
  NAME_MATCH_THRESHOLD,
};
