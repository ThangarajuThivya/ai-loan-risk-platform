const db = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const { generateAccessToken, generateRefreshToken } = require("../utils/token");
const userModel = require("../models/userModel");
const passwordResetModel = require("../models/passwordResetModel");
const {
  generateOtp,
  hashOtp,
  compareOtp,
  OTP_EXPIRY_MINUTES,
  RESEND_COOLDOWN_SECONDS,
  MAX_ATTEMPTS,
} = require("../utils/otp");
const { sendOtpEmail } = require("../utils/mailer");

const RESET_TOKEN_PURPOSE = "password_reset";

const GENERIC_OTP_MESSAGE =
  "If an account exists for this email, an OTP has been sent.";

// Shared by forgot-password and resend-otp: generates a fresh OTP for the
// user, enforcing a cooldown between sends, and emails it.
const issueOtp = async (user) => {
  const existing = await passwordResetModel.findByUserId(user.user_id);

  if (existing) {
    const secondsSinceLastSent =
      (Date.now() - new Date(existing.last_sent_at).getTime()) / 1000;

    if (secondsSinceLastSent < RESEND_COOLDOWN_SECONDS) {
      const wait = Math.ceil(RESEND_COOLDOWN_SECONDS - secondsSinceLastSent);
      const err = new Error(
        `Please wait ${wait}s before requesting another OTP.`,
      );
      err.status = 429;
      throw err;
    }
  }

  const otp = generateOtp();
  const otpHash = await hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await passwordResetModel.upsertOtp(user.user_id, otpHash, expiresAt);
  await sendOtpEmail(user.email, otp);
};

exports.login = async (req, res) => {
  const { email, password } = req.body;

  const user = await require("../models/userModel").findUserByEmail(email);

  if (!user)
    return res.status(401).json({
      message: "Invalid Login",
    });

  const match = await bcrypt.compare(password, user.password);

  if (!match)
    return res.status(401).json({
      message: "Invalid Password",
    });

  if (user.status !== "active")
    return res.status(403).json({
      message: "This account is not active. Please contact an administrator.",
    });

  const accessToken = generateAccessToken(user);

  const refreshToken = generateRefreshToken(user);

  // save refresh token

  require("../models/userModel").saveRefreshToken(user.user_id, refreshToken);

  // HttpOnly Cookie

  res.cookie(
    "refreshToken",

    refreshToken,

    {
      httpOnly: true,

      secure: process.env.NODE_ENV === "production",

      sameSite: "strict",

      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  );

  res.json({
    message: "Login Success",

    accessToken,

    user: {
      user_id: user.user_id,

      name: user.name,

      role: user.role,
    },
  });
};

exports.refreshToken = (req, res) => {
  const token = req.cookies.refreshToken;

  if (!token)
    return res.status(401).json({
      message: "No Token",
    });

  jwt.verify(
    token,

    process.env.REFRESH_TOKEN_SECRET,

    (err, user) => {
      if (err)
        return res.status(403).json({
          message: "Invalid Token",
        });

      const accessToken = jwt.sign(
        {
          user_id: user.user_id,
          role: user.role,
          email: user.email,
        },

        process.env.ACCESS_TOKEN_SECRET,

        {
          expiresIn: "15m",
        },
      );

      res.json({
        accessToken,
      });
    },
  );
};

exports.logout = (req, res) => {
  const userId = req.user.user_id;

  require("../models/userModel").removeRefreshToken(userId);

  res.clearCookie("refreshToken");

  res.json({
    message: "Logout Success",
  });
};

exports.registerCustomer = async (req, res) => {
  console.log("BODY:", req.body);
  console.log("FILE:", req.file);
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      password,

      dateOfBirth,
      gender,
      address,

      employmentType,
      companyName,

      monthlyIncome,
      monthlyExpense,
    } = req.body;

    // Image path

    let profileImage = null;

    if (req.file) {
      profileImage = "/uploads/profile/" + req.file.filename;
    }

    // Password Hash

    const hashPassword = await bcrypt.hash(password, 10);

    // Insert User

    db.query(
      `
INSERT INTO users
(
first_name,
last_name,
email,
phone,
password,
role,
profile_image
)

VALUES(?,?,?,?,?,'customer',?)

`,

      [firstName, lastName, email, phone, hashPassword, profileImage],

      (err, result) => {
        if (err) {
          return res.status(500).json({
            success: false,
            message: "User registration failed",
            error: err.message,
          });
        }

        const userId = result.insertId;

        // Insert Customer Profile

        db.query(
          `

INSERT INTO customer_profiles

(

user_id,

date_of_birth,

gender,

address,

employment_type,

company_name,

monthly_income,

monthly_expense

)

VALUES(?,?,?,?,?,?,?,?)

`,

          [
            userId,

            dateOfBirth,

            gender,

            address,

            employmentType,

            companyName,

            monthlyIncome,

            monthlyExpense,
          ],

          (err) => {
            if (err) {
              return res.status(500).json(err);
              console.log(err);
            }

            res.status(201).json({
              message: "Customer Registration Successful",
            });
          },
        );
      },
    );
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "User registration failed",
      error: err.message,
    });
  }
};

// Works for every role (customer/admin/staff) — email is unique across the
// single `users` table, so no role branching is needed.
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  try {
    const user = await userModel.findUserByEmail(email);

    // Don't reveal whether the email exists.
    if (!user) {
      return res.status(200).json({ message: GENERIC_OTP_MESSAGE });
    }

    await issueOtp(user);

    return res.status(200).json({ message: GENERIC_OTP_MESSAGE });
  } catch (error) {
    if (error.status === 429) {
      return res.status(429).json({ message: error.message });
    }
    console.error("FORGOT PASSWORD ERROR:", error);
    return res.status(500).json({ message: "Failed to process request" });
  }
};

exports.resendOtp = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  try {
    const user = await userModel.findUserByEmail(email);

    if (!user) {
      return res.status(200).json({ message: GENERIC_OTP_MESSAGE });
    }

    await issueOtp(user);

    return res.status(200).json({ message: GENERIC_OTP_MESSAGE });
  } catch (error) {
    if (error.status === 429) {
      return res.status(429).json({ message: error.message });
    }
    console.error("RESEND OTP ERROR:", error);
    return res.status(500).json({ message: "Failed to process request" });
  }
};

exports.verifyOtp = async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ message: "Email and OTP are required" });
  }

  try {
    const user = await userModel.findUserByEmail(email);

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    const record = await passwordResetModel.findByUserId(user.user_id);

    if (!record) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    if (record.attempts >= MAX_ATTEMPTS) {
      return res.status(429).json({
        message: "Too many attempts. Please request a new OTP.",
      });
    }

    if (new Date(record.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    const match = await compareOtp(otp, record.otp_hash);

    if (!match) {
      await passwordResetModel.incrementAttempts(user.user_id);
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    await passwordResetModel.markVerified(user.user_id);

    const resetToken = jwt.sign(
      {
        user_id: user.user_id,
        email: user.email,
        purpose: RESET_TOKEN_PURPOSE,
      },
      process.env.RESET_TOKEN_SECRET,
      { expiresIn: "10m" },
    );

    return res.status(200).json({
      message: "OTP verified",
      resetToken,
    });
  } catch (error) {
    console.error("VERIFY OTP ERROR:", error);
    return res.status(500).json({ message: "Failed to verify OTP" });
  }
};

exports.resetPassword = async (req, res) => {
  const { resetToken, newPassword } = req.body;

  if (!resetToken || !newPassword) {
    return res
      .status(400)
      .json({ message: "Reset token and new password are required" });
  }

  if (newPassword.length < 8) {
    return res
      .status(400)
      .json({ message: "Password must be at least 8 characters" });
  }

  let payload;
  try {
    payload = jwt.verify(resetToken, process.env.RESET_TOKEN_SECRET);
  } catch (error) {
    return res.status(400).json({ message: "Invalid or expired reset token" });
  }

  if (payload.purpose !== RESET_TOKEN_PURPOSE) {
    return res.status(400).json({ message: "Invalid or expired reset token" });
  }

  try {
    const record = await passwordResetModel.findByUserId(payload.user_id);

    if (!record || !record.verified) {
      return res.status(400).json({ message: "Invalid or expired reset token" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await userModel.updateUserPassword(payload.user_id, hashedPassword);
    await passwordResetModel.deleteByUserId(payload.user_id);

    return res.status(200).json({ message: "Password reset successful" });
  } catch (error) {
    console.error("RESET PASSWORD ERROR:", error);
    return res.status(500).json({ message: "Failed to reset password" });
  }
};
