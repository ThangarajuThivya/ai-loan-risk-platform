const db = require("../config/db");
const bcrypt = require("bcrypt");

const PROFILE_SELECT = `
  SELECT u.user_id, u.first_name, u.last_name, u.email, u.phone, u.role,
         cp.date_of_birth, cp.gender, cp.address, cp.employment_type,
         cp.company_name, cp.monthly_income, cp.monthly_expense
    FROM users u
    LEFT JOIN customer_profiles cp ON cp.user_id = u.user_id
   WHERE u.user_id = ?
`;

// GET /api/user/profile — the logged-in user's own profile. Customers get
// their customer_profiles fields joined in (null for other roles, since
// only customers have a customer_profiles row).
exports.getProfile = async (req, res) => {
  try {
    const [rows] = await db.promise().query(PROFILE_SELECT, [req.user.user_id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    return res.status(200).json({ success: true, profile: rows[0] });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch profile",
      error: err.message,
    });
  }
};

// PUT /api/user/profile — customers only. Updates contact + financial
// details that feed the risk model (address, employment, income/expenses).
// Identity fields (date_of_birth, gender) are fixed after registration —
// admin/staff have no profile-editing surface here by design (see AdminStaff
// for admin-managed name/email/phone edits on staff accounts).
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

  try {
    await db
      .promise()
      .query(`UPDATE users SET phone = ? WHERE user_id = ?`, [phone || null, userId]);
    await db.promise().query(
      `UPDATE customer_profiles
          SET address = ?, employment_type = ?, company_name = ?,
              monthly_income = ?, monthly_expense = ?
        WHERE user_id = ?`,
      [
        address || null,
        employmentType || null,
        companyName || null,
        monthlyIncome,
        monthlyExpense,
        userId,
      ],
    );

    const [rows] = await db.promise().query(PROFILE_SELECT, [userId]);
    return res.status(200).json({ success: true, profile: rows[0] });
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
