const db = require("../config/db");
const bcrypt = require("bcrypt");
const { isValidNic } = require("../services/collateralGuarantor.service");
const { CATEGORY_VALUES } = require("../services/mlClient.service");
const bankAccountModel = require("../models/bankAccountModel");

// customer_profiles.beneficiary_* is deliberately absent since migration 039.
// Those columns still exist (backfilled, not dropped) but the customer's bank
// account is no longer something they declare on their profile — it is issued
// by the bank and lives in bank_accounts. See getProfile's `accounts` below.
const PROFILE_SELECT = `
  SELECT u.user_id, u.first_name, u.last_name, u.email, u.phone, u.role,
         cp.date_of_birth, cp.gender, cp.address, cp.employment_type,
         cp.company_name, cp.monthly_income, cp.monthly_expense,
         cp.national_id, cp.kyc_status, cp.kyc_verified_at, cp.kyc_notes,
         cp.marital_status, cp.education_level, cp.occupation,
         cp.employer_category, cp.years_employed
    FROM users u
    LEFT JOIN customer_profiles cp ON cp.user_id = u.user_id
   WHERE u.user_id = ?
`;

// GET /api/user/profile — the logged-in user's own profile. Customers get
// their customer_profiles fields joined in (null for other roles, since
// only customers have a customer_profiles row), plus their bank accounts
// with this bank (039) for the read-only "Your accounts with us" panel.
exports.getProfile = async (req, res) => {
  try {
    const [rows] = await db.promise().query(PROFILE_SELECT, [req.user.user_id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    // Only customers hold accounts here; skipping the query for staff/admin
    // keeps this a single round trip for them.
    const accounts =
      req.user.role === "customer" ? await bankAccountModel.listByUserId(req.user.user_id) : [];
    return res.status(200).json({ success: true, profile: rows[0], accounts });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch profile",
      error: err.message,
    });
  }
};

// PUT /api/user/profile — customers only. Updates contact + financial
// details that feed the risk model (address, employment, income/expenses),
// plus the customer's own NIC (E2).
// Identity fields (date_of_birth, gender) are fixed after registration —
// admin/staff have no profile-editing surface here by design (see AdminStaff
// for admin-managed name/email/phone edits on staff accounts). A verified
// NIC joins that same "fixed" category — see the kyc_status==='verified'
// check below.
exports.updateProfile = async (req, res) => {
  if (req.user.role !== "customer") {
    return res.status(403).json({
      success: false,
      message: "Profile editing is only available for customer accounts.",
    });
  }

  const userId = req.user.user_id;
  const {
    phone,
    address,
    employmentType,
    companyName,
    monthlyIncome,
    monthlyExpense,
    nationalId,
    maritalStatus,
    educationLevel,
    occupation,
    employerCategory,
    yearsEmployed,
  } = req.body;

  if (monthlyIncome === undefined || monthlyExpense === undefined) {
    return res.status(400).json({
      success: false,
      message: "monthlyIncome and monthlyExpense are required",
    });
  }
  if (Number(monthlyIncome) < 0 || Number(monthlyExpense) < 0) {
    return res.status(400).json({
      success: false,
      message: "monthlyIncome and monthlyExpense must be zero or greater",
    });
  }
  if (nationalId !== undefined && nationalId !== null && nationalId !== "" && !isValidNic(nationalId)) {
    return res.status(400).json({
      success: false,
      message: "nationalId must be a valid Sri Lankan NIC (9 digits + V/X, or 12 digits)",
    });
  }
  // H2 — all optional, same categorical values the loan wizard validates
  // against (mlClient.service.js CATEGORY_VALUES, the risk model's own
  // trained categories).
  if (maritalStatus && !CATEGORY_VALUES.marital_status.includes(maritalStatus)) {
    return res.status(400).json({ success: false, message: "Invalid maritalStatus." });
  }
  if (educationLevel && !CATEGORY_VALUES.education_level.includes(educationLevel)) {
    return res.status(400).json({ success: false, message: "Invalid educationLevel." });
  }
  if (occupation && !CATEGORY_VALUES.occupation.includes(occupation)) {
    return res.status(400).json({ success: false, message: "Invalid occupation." });
  }
  if (employerCategory && !CATEGORY_VALUES.employer_category.includes(employerCategory)) {
    return res.status(400).json({ success: false, message: "Invalid employerCategory." });
  }
  if (
    yearsEmployed !== undefined &&
    yearsEmployed !== null &&
    yearsEmployed !== "" &&
    (Number(yearsEmployed) < 0 || Number(yearsEmployed) > 50 || !Number.isInteger(Number(yearsEmployed)))
  ) {
    return res.status(400).json({
      success: false,
      message: "yearsEmployed must be an integer between 0 and 50.",
    });
  }
  try {
    const [existingRows] = await db
      .promise()
      .query(`SELECT national_id, kyc_status FROM customer_profiles WHERE user_id = ?`, [userId]);
    const existing = existingRows[0] || {};
    const newNationalId = nationalId ? nationalId.trim().toUpperCase() : existing.national_id || null;
    const nicChanged = newNationalId !== (existing.national_id || null);

    // A verified identity is locked, same as DOB/gender — changing it
    // requires staff to re-open review some other way, not a silent
    // self-service overwrite of a confirmed identity.
    if (nicChanged && existing.kyc_status === "verified") {
      return res.status(409).json({
        success: false,
        message: "Your identity has already been verified and cannot be changed.",
      });
    }

    await db
      .promise()
      .query(`UPDATE users SET phone = ? WHERE user_id = ?`, [phone || null, userId]);

    if (nicChanged) {
      // Any real change to the NIC re-opens review — clears whatever
      // verdict (pending/verified/rejected) was previously recorded.
      await db.promise().query(
        `UPDATE customer_profiles
            SET address = ?, employment_type = ?, company_name = ?,
                monthly_income = ?, monthly_expense = ?, national_id = ?,
                kyc_status = ?, kyc_verified_by = NULL, kyc_verified_at = NULL, kyc_notes = NULL,
                marital_status = ?, education_level = ?, occupation = ?,
                employer_category = ?, years_employed = ?
          WHERE user_id = ?`,
        [
          address || null,
          employmentType || null,
          companyName || null,
          monthlyIncome,
          monthlyExpense,
          newNationalId,
          newNationalId ? "pending" : null,
          maritalStatus || null,
          educationLevel || null,
          occupation || null,
          employerCategory || null,
          yearsEmployed !== undefined && yearsEmployed !== "" ? Number(yearsEmployed) : null,
          userId,
        ],
      );
    } else {
      // Unrelated field edits (address/income/etc.) must never disturb an
      // existing kyc_status — only a genuine NIC change does that.
      await db.promise().query(
        `UPDATE customer_profiles
            SET address = ?, employment_type = ?, company_name = ?,
                monthly_income = ?, monthly_expense = ?,
                marital_status = ?, education_level = ?, occupation = ?,
                employer_category = ?, years_employed = ?
          WHERE user_id = ?`,
        [
          address || null,
          employmentType || null,
          companyName || null,
          monthlyIncome,
          monthlyExpense,
          maritalStatus || null,
          educationLevel || null,
          occupation || null,
          employerCategory || null,
          yearsEmployed !== undefined && yearsEmployed !== "" ? Number(yearsEmployed) : null,
          userId,
        ],
      );
    }

    const [rows] = await db.promise().query(PROFILE_SELECT, [userId]);
    const accounts = await bankAccountModel.listByUserId(userId);
    return res.status(200).json({ success: true, profile: rows[0], accounts });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to update profile",
      error: err.message,
    });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const { currentPassword, newPassword } = req.body;

    if (!userId || !currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    // Get current password

    db.query(
      "SELECT password FROM users WHERE user_id=?",
      [userId],

      async (err, result) => {
        if (err) {
          return res.status(500).json({
            success: false,
            message: "Database error",
            error: err.message,
          });
        }

        if (result.length === 0) {
          return res.status(404).json({
            success: false,
            message: "User not found",
          });
        }

        const storedPassword = result[0].password;

        // Check old password

        const isMatch = await bcrypt.compare(currentPassword, storedPassword);

        if (!isMatch) {
          return res.status(400).json({
            success: false,
            message: "Current password is incorrect",
          });
        }

        // Hash new password

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password

        db.query(
          `
          UPDATE users
          SET password=?
          WHERE user_id=?
          `,
          [hashedPassword, userId],

          (err) => {
            if (err) {
              return res.status(500).json({
                success: false,
                message: "Password update failed",
                error: err.message,
              });
            }

            res.status(200).json({
              success: true,
              message: "Password changed successfully",
            });
          },
        );
      },
    );
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
