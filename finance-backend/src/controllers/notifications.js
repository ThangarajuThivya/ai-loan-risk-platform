const db = require("../config/db");

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
 