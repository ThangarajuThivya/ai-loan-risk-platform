const express = require("express");

const router = express.Router();

const db = require("../config/db");
const notification = require("../controllers/notifications");
const { verifyToken } = require("../middleware/auth.middleware");

router.get(
"/my-notifications",
verifyToken,
notification.getNotifications
);


module.exports = router;