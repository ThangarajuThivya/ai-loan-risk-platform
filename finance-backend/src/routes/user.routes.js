const router = require("express").Router();
const user = require("../controllers/user.controller")
const { verifyToken } = require("../middleware/auth.middleware");


router.get("/profile", verifyToken, user.getProfile);
router.put("/profile", verifyToken, user.updateProfile);

router.put("/passwordChange",verifyToken, user.changePassword);

module.exports =router