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

// PATCH /api/notifications/read-all (K4) — mark all of the caller's own
// notifications as read. See controllers/notifications.js markAllRead.
router.patch(
"/read-all",
verifyToken,
notification.markAllRead
);


module.exports = router;