/**
 * Field definitions for the two leasing counterparty registers (L17).
 *
 * Declared once, in data, because the same fields are rendered in three
 * places — the admin register page, the edit dialog, and the quick-add popover
 * in the staff review queue — and three hand-written copies of the same form
 * is how a field ends up saved on one screen and silently dropped on another.
 *
 * `adminOnly` is the important flag. It marks the fields that decide WHERE
 * PURCHASE MONEY GOES, which staff may not set; the server enforces the same
 * rule in leaseRegister.service.js and is the real gate. Hiding them here is
 * so the UI doesn't offer a control whose input would be discarded.
 */

export const DEALER_FIELDS = [
  { name: "name", label: "Dealer name", required: true, placeholder: "Sandaru Motor Company (Pvt) Ltd" },
  { name: "business_reg_no", label: "Business registration no.", placeholder: "PV-84213" },
  { name: "contact_person", label: "Contact person", placeholder: "Dilan Wickramasinghe" },
  { name: "phone", label: "Phone", placeholder: "0112345601" },
  { name: "email", label: "Email", type: "email", placeholder: "sales@example.lk" },
  { name: "address", label: "Address", textarea: true, placeholder: "No. 214, Nawala Road, Rajagiriya" },
  {
    name: "bank_name",
    label: "Bank",
    adminOnly: true,
    group: "banking",
    placeholder: "Bank of Ceylon",
  },
  { name: "bank_branch", label: "Branch", adminOnly: true, group: "banking", placeholder: "Rajagiriya" },
  {
    name: "bank_account_no",
    label: "Account number",
    adminOnly: true,
    group: "banking",
    placeholder: "0000110022334",
  },
  {
    name: "account_holder",
    label: "Account holder",
    adminOnly: true,
    group: "banking",
    placeholder: "Exactly as it appears on the account",
  },
];

export const VALUER_FIELDS = [
  { name: "name", label: "Valuer name", required: true, placeholder: "K. A. Sriyani Gunawardena" },
  { name: "license_no", label: "Licence number", placeholder: "IVSL/2016/1184" },
  { name: "phone", label: "Phone", placeholder: "0771234501" },
  { name: "email", label: "Email", type: "email", placeholder: "valuer@example.lk" },
];

/** A blank form for the given field set. */
export const emptyForm = (fields) =>
  Object.fromEntries(fields.map((f) => [f.name, ""]));

/** Populate a form from an API row, coercing nulls to empty strings. */
export const formFrom = (fields, row) =>
  Object.fromEntries(fields.map((f) => [f.name, row?.[f.name] ?? ""]));

/**
 * Trim, and send blanks as null rather than "" — the express-validator
 * chains use `optional({ checkFalsy: true })`, so an empty string is skipped
 * rather than rejected, but null is what the column should actually hold.
 */
export const toPayload = (fields, form, { includeAdminOnly = true } = {}) => {
  const payload = {};
  for (const f of fields) {
    if (f.adminOnly && !includeAdminOnly) continue;
    const value = String(form[f.name] ?? "").trim();
    payload[f.name] = value === "" ? null : value;
  }
  return payload;
};

/** The client-side half of the required-name rule; the server has the other. */
export const validate = (fields, form) => {
  const errors = {};
  for (const f of fields) {
    if (f.required && String(form[f.name] ?? "").trim().length < 2) {
      errors[f.name] = `${f.label} is required.`;
    }
  }
  const email = String(form.email ?? "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Enter a valid email address.";
  }
  return errors;
};
