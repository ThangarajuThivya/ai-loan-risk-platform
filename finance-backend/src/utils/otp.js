const bcrypt = require("bcrypt");

const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_ATTEMPTS = 5;

exports.OTP_EXPIRY_MINUTES = OTP_EXPIRY_MINUTES;
exports.RESEND_COOLDOWN_SECONDS = RESEND_COOLDOWN_SECONDS;
exports.MAX_ATTEMPTS = MAX_ATTEMPTS;

exports.generateOtp = () => {
  const min = 10 ** (OTP_LENGTH - 1);
  const max = 10 ** OTP_LENGTH - 1;
  return String(Math.floor(min + Math.random() * (max - min + 1)));
};

exports.hashOtp = (otp) => bcrypt.hash(otp, 10);

exports.compareOtp = (otp, hash) => bcrypt.compare(otp, hash);
