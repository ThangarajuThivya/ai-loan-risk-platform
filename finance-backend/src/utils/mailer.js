const nodemailer = require("nodemailer");

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

const smtpConfigured = SMTP_HOST && SMTP_USER && SMTP_PASS;

const transporter = smtpConfigured
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      secure: Number(SMTP_PORT) === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    })
  : null;

exports.sendOtpEmail = async (to, otp) => {
  const subject = "Your Aura AI Loan verification code";
  const text = `Your one-time password (OTP) is ${otp}. It expires in 10 minutes. If you did not request this, you can ignore this email.`;

  if (!transporter) {
    // No SMTP configured (local/dev) — log the OTP so the flow stays testable.
    console.log(`[mailer] SMTP not configured — OTP for ${to}: ${otp}`);
    return;
  }

  await transporter.sendMail({
    from: SMTP_FROM || SMTP_USER,
    to,
    subject,
    text,
  });
};

// G2 — email for the "major" loan application status transitions
// (applicationStatus.service.js EMAIL_NOTIFIED_STATUSES). Reuses the same
// {title, message} shape buildNotification() already produces for the
// in-app notification, as the email subject/body — one copy, two channels.
exports.sendApplicationStatusEmail = async (to, { title, message }) => {
  if (!transporter) {
    // No SMTP configured (local/dev) — log it so the flow stays testable.
    console.log(`[mailer] SMTP not configured — application status email to ${to}: ${title} — ${message}`);
    return;
  }

  await transporter.sendMail({
    from: SMTP_FROM || SMTP_USER,
    to,
    subject: title,
    text: message,
  });
};
