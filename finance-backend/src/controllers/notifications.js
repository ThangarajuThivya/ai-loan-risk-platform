"use strict";

const notificationModel = require("../models/notificationModel");

/**
 * GET /api/notifications/my-notifications
 *
 * BOUNDED, unlike the `SELECT * FROM notifications WHERE user_id = ?` this
 * replaces. That returned every notification a user had ever received —
 * already 4,000+ rows on this database before leasing added any — on every
 * single dashboard load, and a reminder sweep only grows that. The response
 * is still a bare array so the existing callers keep working unchanged; the
 * counts and paging live on their own endpoints.
 *
 * Query: ?limit= &offset= &category= &unread=1
 */
exports.getNotifications = async (req, res) => {
  try {
    const rows = await notificationModel.findForUser(req.user.user_id, {
      limit: req.query.limit,
      offset: req.query.offset,
      category: req.query.category,
      unreadOnly: req.query.unread === "1" || req.query.unread === "true",
    });
    return res.status(200).json(rows);
  } catch (err) {
    console.error("GET NOTIFICATIONS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch notifications." });
  }
};

/**
 * GET /api/notifications/unread-count
 *
 * Totals plus a per-category breakdown, so a portal can badge leasing
 * separately from lending — someone with eleven unread FX notices should
 * not see their lease tab flagged.
 */
exports.getUnreadCount = async (req, res) => {
  try {
    const counts = await notificationModel.countUnread(req.user.user_id);
    return res.status(200).json(counts);
  } catch (err) {
    console.error("UNREAD NOTIFICATION COUNT ERROR:", err);
    return res.status(500).json({ message: "Failed to count notifications." });
  }
};

/**
 * PATCH /api/notifications/read-all (K4) — mark the caller's notifications
 * read. `?category=` narrows it: reading your leasing notices should not
 * silently clear unrelated FX ones you have not looked at.
 */
exports.markAllRead = async (req, res) => {
  try {
    await notificationModel.markAllRead(req.user.user_id, req.query.category);
    return res.status(204).send();
  } catch (err) {
    console.error("MARK ALL NOTIFICATIONS READ ERROR:", err);
    return res.status(500).json({ message: "Failed to mark notifications as read." });
  }
};

/**
 * PATCH /api/notifications/:id/read — the click-through path.
 *
 * Opening the lease a notice points at should clear THAT notice and nothing
 * else. Scoped by user_id in the model, so an id belonging to another
 * account cannot be touched — a 404 rather than a silent no-op, because
 * "that isn't yours" and "that doesn't exist" should look identical from
 * outside.
 */
exports.markRead = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid notification id." });
    }
    const updated = await notificationModel.markRead(req.user.user_id, id);
    if (!updated) return res.status(404).json({ message: "Notification not found." });
    return res.status(204).send();
  } catch (err) {
    console.error("MARK NOTIFICATION READ ERROR:", err);
    return res.status(500).json({ message: "Failed to mark the notification as read." });
  }
};
