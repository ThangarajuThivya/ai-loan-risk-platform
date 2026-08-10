"use strict";

const express = require("express");

const router = express.Router();

const notification = require("../controllers/notifications");
const { verifyToken } = require("../middleware/auth.middleware");

// Every route here is scoped to the CALLER inside the model — there is no
// user id in any path or body, so one account can never read or clear
// another's notifications regardless of what a client sends.

// GET /api/notifications/my-notifications?limit=&offset=&category=&unread=1
router.get("/my-notifications", verifyToken, notification.getNotifications);

// GET /api/notifications/unread-count — total plus a per-category breakdown.
router.get("/unread-count", verifyToken, notification.getUnreadCount);

// PATCH /api/notifications/read-all?category= (K4)
router.patch("/read-all", verifyToken, notification.markAllRead);

// PATCH /api/notifications/:id/read — clear one, for the click-through path.
// Declared AFTER /read-all so "read-all" is never parsed as an :id.
router.patch("/:id/read", verifyToken, notification.markRead);

module.exports = router;
