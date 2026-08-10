const db = require("../config/db");
const bcrypt = require("bcrypt");
const { validationResult } = require("express-validator");
const userModel = require("../models/userModel");
const bankAccountModel = require("../models/bankAccountModel");
const { validateRegistration } = require("../services/bankAccount.service");

// exports.getAllCustomers = (req, res) => {
//   const sql = `
//     SELECT
//       u.user_id,
//       u.first_name,
//       u.last_name,
//       u.email,
//       u.phone,
//       u.profile_image,
//       u.status,
//       u.created_at,

//       cp.date_of_birth,
//       cp.gender,
//       cp.address,
//       cp.employment_type,
//       cp.company_name,
//       cp.monthly_income,
//       cp.monthly_expense

//     FROM users u
//     LEFT JOIN customer_profiles cp
//       ON u.user_id = cp.user_id

//     WHERE u.role = 'customer'

//     ORDER BY u.user_id DESC
//   `;

//   db.query(sql, (err, result) => {
//     if (err) {
//       console.error("GET CUSTOMERS ERROR:", err);

//       return res.status(500).json({
//         success: false,
//         message: "Failed to fetch customers.",
//         error: err.message,
//       });
//     }

//     res.status(200).json({
//       success: true,
//       totalCustomers: result.length,
//       customers: result,
//     });
//   });
// };
exports.getAllCustomers = (req, res) => {
  const customersSql = `
    SELECT
      u.user_id,
      u.first_name,
      u.last_name,
      u.email,
      u.phone,
      u.profile_image,
      u.status,
      u.created_at,

      cp.date_of_birth,
      cp.gender,
      cp.address,
      cp.employment_type,
      cp.company_name,
      cp.monthly_income,
      cp.monthly_expense,
      cp.national_id,
      cp.kyc_status,
      cp.kyc_verified_at,
      cp.kyc_notes

    FROM users u

    LEFT JOIN customer_profiles cp
      ON u.user_id = cp.user_id

    WHERE u.role = 'customer'

    ORDER BY u.user_id DESC
  `;

  const growthSql = `

    SELECT

    (
      SELECT COUNT(*)
      FROM users
      WHERE role='customer'
      AND MONTH(created_at)=MONTH(CURRENT_DATE())
      AND YEAR(created_at)=YEAR(CURRENT_DATE())

    ) AS currentMonth,


    (
      SELECT COUNT(*)
      FROM users
      WHERE role='customer'
      AND MONTH(created_at)=MONTH(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH))
      AND YEAR(created_at)=YEAR(DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH))

    ) AS lastMonth

  `;

  db.query(customersSql, (err, customers) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch customers",
        error: err.message,
      });
    }

    db.query(growthSql, (err, growth) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Failed to calculate growth",
          error: err.message,
        });
      }

      const current = growth[0].currentMonth;

      const last = growth[0].lastMonth;

      let percentage = 0;

      if (last > 0) {
        percentage = ((current - last) / last) * 100;
      } else if (current > 0) {
        percentage = 100;
      }

      const roundedPercentage = Number(percentage.toFixed(1));

      res.status(200).json({
        success: true,

        totalCustomers: customers.length,

        growth: {
          value: `${roundedPercentage > 0 ? "+" : ""}${roundedPercentage}%`,

          isPositive: roundedPercentage >= 0,
        },

        customers,
      });
    });
  });
};

// PATCH /api/admin/customers/:userId/kyc/verify (staff/admin; E2) — sign
// off on, or reject, a customer's declared NIC. Advisory only: does not
// touch loan_applications or applicationStatus.service.js/
// creditPolicy.service.js.
exports.verifyCustomerKyc = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const userId = Number(req.params.userId);
  const { kyc_status: kycStatus, kyc_notes: kycNotes } = req.body;

  try {
    const existing = await userModel.getCustomerKycStatus(userId);
    if (!existing) {
      return res.status(404).json({ message: "Customer profile not found." });
    }
    if (existing.kyc_status !== "pending") {
      return res.status(409).json({
        message: "This customer has no KYC review pending — nothing to verify or reject.",
      });
    }

    const updated = await userModel.verifyCustomerKyc(userId, {
      kycStatus,
      verifiedBy: req.user.user_id,
      notes: kycNotes,
    });
    if (!updated) {
      return res.status(409).json({
        message: "This customer's KYC has already been reviewed and cannot be changed again.",
      });
    }

    return res.status(200).json(updated);
  } catch (err) {
    console.error("VERIFY CUSTOMER KYC ERROR:", err);
    return res.status(500).json({ message: "Failed to update KYC status." });
  }
};

// PATCH /api/admin/customers/:userId (admin; K3) — edit a customer's basic
// contact details and declared monthly income on their behalf. Mirrors
// updateStaff below field-for-field; the one difference is monthlyIncome,
// which lives on customer_profiles rather than users (staff have no
// customer_profiles row at all).
exports.updateCustomer = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const userId = Number(req.params.userId);
  const { firstName, lastName, email, phone, monthlyIncome } = req.body;

  try {
    const existing = await userModel.findUserByEmail(email);
    if (existing && existing.user_id !== userId) {
      return res.status(409).json({ message: "An account with that email already exists." });
    }

    const updated = await userModel.updateCustomer(userId, {
      firstName,
      lastName,
      email,
      phone,
      monthlyIncome,
    });
    if (!updated) {
      return res.status(404).json({ message: "Customer account not found." });
    }

    const customer = await userModel.findCustomerById(userId);
    return res.status(200).json(customer);
  } catch (err) {
    console.error("UPDATE CUSTOMER ERROR:", err);
    return res.status(500).json({ message: "Failed to update customer." });
  }
};

// PATCH /api/admin/customers/:userId/status (admin; K3) — activate,
// deactivate, or suspend a customer account. Mirrors updateStaffStatus.
exports.updateCustomerStatus = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const userId = Number(req.params.userId);
  const { status } = req.body;

  try {
    const updated = await userModel.updateCustomerStatus(userId, status);
    if (!updated) {
      return res.status(404).json({ message: "Customer account not found." });
    }

    const customer = await userModel.findCustomerById(userId);
    return res.status(200).json(customer);
  } catch (err) {
    console.error("UPDATE CUSTOMER STATUS ERROR:", err);
    return res.status(500).json({ message: "Failed to update customer status." });
  }
};

// DELETE /api/admin/customers/:userId — permanently remove a customer
// account, alongside the existing activate/deactivate/suspend above.
//
// GUARDED, unlike deleteStaff. Every table a customer's own records live in
// (loan_applications, loan_accounts, lease_applications, lease_agreements,
// bank_accounts, ...) cascades off `users(user_id)`, and everything hanging
// off THOSE — repayment history, adverse-action records, decision-matrix
// rows — cascades again. Deleting a customer who ever applied for credit
// would silently erase that trail, which is exactly the record a lender is
// expected to be able to produce later. So a customer with any loan or
// lease application on file cannot be hard-deleted here; deactivate/suspend
// is the correct action for them, and permanent deletion is left for
// accounts that never went further than registering (duplicates, test
// signups, abandoned signups) — where CASCADE only ever removes the shell:
// drafts, consents, an unopened bank account.
exports.deleteCustomer = async (req, res) => {
  const userId = Number(req.params.userId);

  try {
    const customer = await userModel.findCustomerById(userId);
    if (!customer) {
      return res.status(404).json({ message: "Customer account not found." });
    }

    const counts = await userModel.countCustomerFinancialRecords(userId);
    if (counts.loanApplications > 0 || counts.leaseApplications > 0) {
      const parts = [];
      if (counts.loanApplications > 0) {
        parts.push(`${counts.loanApplications} loan application${counts.loanApplications === 1 ? "" : "s"}`);
      }
      if (counts.leaseApplications > 0) {
        parts.push(`${counts.leaseApplications} lease application${counts.leaseApplications === 1 ? "" : "s"}`);
      }
      return res.status(409).json({
        message:
          `This account has ${parts.join(" and ")} on file. Permanently deleting it would ` +
          `also erase that history, which we're expected to keep for audit purposes — ` +
          `deactivate or suspend the account instead.`,
      });
    }

    const deleted = await userModel.deleteCustomerPermanently(userId);
    if (!deleted) {
      return res.status(404).json({ message: "Customer account not found." });
    }
    return res.status(204).send();
  } catch (err) {
    console.error("DELETE CUSTOMER ERROR:", err);
    return res.status(500).json({ message: "Failed to delete customer account." });
  }
};

// GET /api/admin/customers/:userId/bank-accounts (staff/admin; 039) — every
// account this customer holds with the bank, live and closed.
exports.listCustomerBankAccounts = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  try {
    const accounts = await bankAccountModel.listByUserId(Number(req.params.userId));
    return res.status(200).json({ accounts });
  } catch (err) {
    console.error("LIST CUSTOMER BANK ACCOUNTS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch bank accounts." });
  }
};

// POST /api/admin/customers/:userId/bank-accounts (staff/admin; 039) —
// register an account the customer already holds at a branch but that this
// platform never issued.
//
// Without this, a long-standing walk-in customer who applies online looks
// brand-new to bankAccountModel.findOrOpenWithin and has a SECOND account
// issued to them at offer acceptance. This is the one path where an account
// number is typed rather than derived, and it is staff-only precisely
// because staff can check it against core banking first — the customer
// cannot, which is why they have no equivalent form.
exports.registerCustomerBankAccount = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }

  const userId = Number(req.params.userId);
  const {
    branch,
    account_number: accountNumber,
    account_holder: accountHolder,
  } = req.body;

  const check = validateRegistration({ branch, accountNumber, accountHolder });
  if (!check.valid) {
    return res.status(400).json({ message: check.message });
  }

  try {
    const customer = await userModel.getCustomerKycStatus(userId);
    if (!customer) {
      return res.status(404).json({ message: "Customer profile not found." });
    }

    const account = await bankAccountModel.registerExisting({
      userId,
      branch,
      accountNumber,
      accountHolder,
      openedBy: req.user.user_id,
    });
    return res.status(201).json(account);
  } catch (err) {
    if (err.message === "DUPLICATE_ACCOUNT_NUMBER") {
      return res.status(409).json({
        message: "That account number is already on file.",
      });
    }
    console.error("REGISTER CUSTOMER BANK ACCOUNT ERROR:", err);
    return res.status(500).json({ message: "Failed to register the bank account." });
  }
};

// POST /api/admin/createStaff (admin) — staff have no self-service signup;
// only an admin can provision a staff account.
exports.createStaff = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: "Invalid request.",
      errors: errors.array(),
    });
  }

  const { firstName, lastName, email, phone, password } = req.body;

  try {
    const existing = await userModel.findUserByEmail(email);
    if (existing) {
      return res.status(409).json({
        message: "An account with that email already exists.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = await userModel.createStaff({
      firstName,
      lastName,
      email,
      phone,
      hashedPassword,
    });

    return res.status(201).json({
      user_id: userId,
      first_name: firstName,
      last_name: lastName,
      email,
      phone: phone || null,
      role: "staff",
      status: "active",
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "An account with that email already exists.",
      });
    }
    console.error("CREATE STAFF ERROR:", err);
    return res.status(500).json({ message: "Failed to create staff account." });
  }
};

// GET /api/admin/staff (admin) — list staff accounts.
exports.getAllStaff = async (req, res) => {
  try {
    const staff = await userModel.findAllStaff();
    return res.status(200).json({ staff });
  } catch (err) {
    console.error("GET STAFF ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch staff accounts." });
  }
};

// PUT /api/admin/staff/:id (admin) — edit a staff account's details.
exports.updateStaff = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: "Invalid request.",
      errors: errors.array(),
    });
  }

  const staffId = Number(req.params.id);
  const { firstName, lastName, email, phone } = req.body;

  try {
    const existing = await userModel.findUserByEmail(email);
    if (existing && existing.user_id !== staffId) {
      return res.status(409).json({
        message: "An account with that email already exists.",
      });
    }

    const updated = await userModel.updateStaff(staffId, {
      firstName,
      lastName,
      email,
      phone,
    });
    if (!updated) {
      return res.status(404).json({ message: "Staff account not found." });
    }

    const staff = await userModel.findStaffById(staffId);
    return res.status(200).json(staff);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "An account with that email already exists.",
      });
    }
    console.error("UPDATE STAFF ERROR:", err);
    return res.status(500).json({ message: "Failed to update staff account." });
  }
};

// PATCH /api/admin/staff/:id/status (admin) — activate/deactivate a staff account.
exports.updateStaffStatus = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: "Invalid request.",
      errors: errors.array(),
    });
  }

  const staffId = Number(req.params.id);
  const { status } = req.body;

  try {
    const updated = await userModel.updateStaffStatus(staffId, status);
    if (!updated) {
      return res.status(404).json({ message: "Staff account not found." });
    }

    const staff = await userModel.findStaffById(staffId);
    return res.status(200).json(staff);
  } catch (err) {
    console.error("UPDATE STAFF STATUS ERROR:", err);
    return res.status(500).json({ message: "Failed to update staff status." });
  }
};

// DELETE /api/admin/staff/:id (admin) — remove a staff account.
exports.deleteStaff = async (req, res) => {
  const staffId = Number(req.params.id);
  try {
    const deleted = await userModel.deleteStaff(staffId);
    if (!deleted) {
      return res.status(404).json({ message: "Staff account not found." });
    }
    return res.status(204).send();
  } catch (err) {
    console.error("DELETE STAFF ERROR:", err);
    return res.status(500).json({ message: "Failed to delete staff account." });
  }
};
