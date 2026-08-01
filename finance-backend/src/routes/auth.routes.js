const router = require("express").Router();
const upload=require("../config/multer");
const auth = require("../controllers/auth.controller");

const { verifyToken } = require("../middleware/auth.middleware");

router.post(

"/register",

upload.single("profileImage"),

auth.registerCustomer

);


router.post("/login", auth.login);

router.post("/refresh", auth.refreshToken);

router.post(
  "/logout",

  verifyToken,

  auth.logout,
);

router.get("/me", verifyToken, (req, res) => {
  res.json({
    user: req.user,
  });
});

router.post("/forgot-password", auth.forgotPassword);

router.post("/resend-otp", auth.resendOtp);

router.post("/verify-otp", auth.verifyOtp);

router.post("/reset-password", auth.resetPassword);

module.exports = router;
