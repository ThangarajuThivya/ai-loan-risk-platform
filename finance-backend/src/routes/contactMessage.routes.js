const express = require("express");

const router = express.Router();

const { body, query } = require("express-validator");
const contactMessageController = require("../controllers/contactMessage.controller");
const { verifyToken } = require("../middleware/auth.middleware");
const { allowRoles } = require("../middleware/role.middleware");

const STATUS_VALUES = ["open", "in_progress", "resolved"];

const STATUS_QUERY_VALIDATOR = query("status")
  .optional({ checkFalsy: true })
  .isIn([...STATUS_VALUES, "all"])
  .withMessage(`status must be one of: ${STATUS_VALUES.join(", ")}, all`);

// POST / — customer opens a new support thread.
router.post(
  "/",
  verifyToken,
  allowRoles("customer"),
  [
    body("subject").trim().isLength({ min: 3, max: 150 }).withMessage("subject must be 3-150 characters"),
    body("body").trim().isLength({ min: 10, max: 4000 }).withMessage("body must be 10-4000 characters"),
  ],
  contactMessageController.createThread
);

// GET /mine — the logged-in customer's own threads. Registered before
// "/:id" so it isn't swallowed by the param route.
router.get(
  "/mine",
  verifyToken,
  allowRoles("customer"),
  [STATUS_QUERY_VALIDATOR],
  contactMessageController.getMyThreads
);

// GET /open-count — small badge count for the staff/admin sidebar.
router.get(
  "/open-count",
  verifyToken,
  allowRoles("admin", "staff"),
  contactMessageController.getOpenThreadsCount
);

// GET / — the staff/admin shared inbox, every customer's threads.
router.get(
  "/",
  verifyToken,
  allowRoles("admin", "staff"),
  [STATUS_QUERY_VALIDATOR],
  contactMessageController.getAllThreads
);

// GET /:id — one thread + its replies (owner customer, or any staff/admin).
router.get("/:id", verifyToken, contactMessageController.getThreadById);

// POST /:id/replies — reply to a thread (owner customer, or any staff/admin).
router.post(
  "/:id/replies",
  verifyToken,
  [body("body").trim().isLength({ min: 1, max: 4000 }).withMessage("body must be 1-4000 characters")],
  contactMessageController.addReply
);

// PATCH /:id/status — staff/admin directly set a thread's status.
router.patch(
  "/:id/status",
  verifyToken,
  allowRoles("admin", "staff"),
  [body("status").isIn(STATUS_VALUES).withMessage(`status must be one of: ${STATUS_VALUES.join(", ")}`)],
  contactMessageController.updateThreadStatus
);

module.exports = router;
