const db = require("../config/db");
const notificationModel = require("../models/notificationModel");

// PATCH /api/notifications/read-all (K4) — mark every one of the caller's
// own notifications as read. Previously the "Mark all read" button only
// updated local React state, so a page reload always showed everything as
// unread again.
exports.markAllRead = async (req, res) => {
  try {
    await notificationModel.markAllRead(req.user.user_id);
    return res.status(204).send();
  } catch (err) {
    console.error("MARK ALL NOTIFICATIONS READ ERROR:", err);
    return res.status(500).json({ message: "Failed to mark notifications as read." });
  }
};

exports.getNotifications = (req, res) => {
  const userId = req.user.user_id;

  console.log(userId);

  // Database Query

  db.query(
    "SELECT * FROM notifications WHERE user_id=?",

    [userId],

    (err, result) => {
      res.json(result);
    },
  );
};
 