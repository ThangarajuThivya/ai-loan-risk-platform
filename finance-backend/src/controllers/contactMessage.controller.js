"use strict";

/**
 * Contact/support messaging controller — a lightweight support-ticket
 * system for authenticated users. A customer opens a thread; staff and
 * admin share one inbox with identical capabilities (see
 * contactMessageModel.js for the status state machine). Follows the same
 * routes -> controller -> model shape as loan.controller.js /
 * fxExchange.controller.js.
 */

const { validationResult } = require("express-validator");

const contactMessageModel = require("../models/contactMessageModel");
const notificationModel = require("../models/notificationModel");

function notifyCustomer(userId, title, message) {
  notificationModel.create({ userId, title, message }).catch((err) => {
    console.error("CONTACT MESSAGE NOTIFICATION ERROR:", err.message);
  });
}

function serializeThread(row) {
  if (!row) return null;
  return {
    id: row.id,
    customer_id: row.customer_id,
    subject: row.subject,
    status: row.status,
    last_message_at: row.last_message_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(row.first_name !== undefined
      ? {
          customer: {
            user_id: row.customer_id,
            first_name: row.first_name,
            last_name: row.last_name,
            email: row.email,
          },
        }
      : {}),
  };
}

function serializeReply(row) {
  return {
    id: row.id,
    thread_id: row.thread_id,
    sender_id: row.sender_id,
    sender_role: row.sender_role,
    sender_name: row.sender_id ? `${row.first_name || ""} ${row.last_name || ""}`.trim() : null,
    body: row.body,
    created_at: row.created_at,
  };
}

function isThreadParticipant(thread, user) {
  const isOwner = thread.customer_id === user.user_id;
  const isStaffOrAdmin = user.role === "admin" || user.role === "staff";
  return isOwner || isStaffOrAdmin;
}

exports.createThread = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }
  try {
    const thread = await contactMessageModel.createThread({
      customerId: req.user.user_id,
      subject: req.body.subject.trim(),
      body: req.body.body.trim(),
    });
    return res.status(201).json({ thread: serializeThread(thread) });
  } catch (err) {
    console.error("CREATE CONTACT MESSAGE THREAD ERROR:", err);
    return res.status(500).json({ message: "Failed to create message." });
  }
};

exports.getMyThreads = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }
  try {
    const rows = await contactMessageModel.findThreadsByCustomerId(req.user.user_id, {
      status: req.query.status,
    });
    return res.status(200).json({ threads: rows.map(serializeThread) });
  } catch (err) {
    console.error("GET MY CONTACT MESSAGE THREADS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch messages." });
  }
};

exports.getAllThreads = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }
  try {
    const rows = await contactMessageModel.findAllThreads({
      status: req.query.status,
      q: req.query.q,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    return res.status(200).json({ threads: rows.map(serializeThread) });
  } catch (err) {
    console.error("GET ALL CONTACT MESSAGE THREADS ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch messages." });
  }
};

exports.getOpenThreadsCount = async (req, res) => {
  try {
    const count = await contactMessageModel.countOpenThreads();
    return res.status(200).json({ count });
  } catch (err) {
    console.error("GET OPEN CONTACT MESSAGE COUNT ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch message count." });
  }
};

exports.getThreadById = async (req, res) => {
  const threadId = Number(req.params.id);
  try {
    const thread = await contactMessageModel.findThreadById(threadId);
    if (!thread) {
      return res.status(404).json({ message: "Thread not found." });
    }
    if (!isThreadParticipant(thread, req.user)) {
      return res.status(403).json({ message: "Permission denied" });
    }
    const replies = await contactMessageModel.findRepliesByThreadId(threadId);
    return res.status(200).json({
      thread: serializeThread(thread),
      replies: replies.map(serializeReply),
    });
  } catch (err) {
    console.error("GET CONTACT MESSAGE THREAD ERROR:", err);
    return res.status(500).json({ message: "Failed to fetch message." });
  }
};

exports.addReply = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }
  const threadId = Number(req.params.id);
  try {
    const thread = await contactMessageModel.findThreadById(threadId);
    if (!thread) {
      return res.status(404).json({ message: "Thread not found." });
    }
    if (!isThreadParticipant(thread, req.user)) {
      return res.status(403).json({ message: "Permission denied" });
    }

    const result = await contactMessageModel.addReply({
      threadId,
      senderId: req.user.user_id,
      senderRole: req.user.role,
      body: req.body.body.trim(),
    });
    if (result.notFound) {
      return res.status(404).json({ message: "Thread not found." });
    }

    if (req.user.role !== "customer") {
      notifyCustomer(
        thread.customer_id,
        "New Reply on Your Support Message",
        `Support replied to "${thread.subject}".`
      );
    }

    const [updatedThread, replies] = await Promise.all([
      contactMessageModel.findThreadById(threadId),
      contactMessageModel.findRepliesByThreadId(threadId),
    ]);
    return res.status(201).json({
      thread: serializeThread(updatedThread),
      replies: replies.map(serializeReply),
    });
  } catch (err) {
    console.error("ADD CONTACT MESSAGE REPLY ERROR:", err);
    return res.status(500).json({ message: "Failed to send reply." });
  }
};

exports.updateThreadStatus = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: "Invalid request.", errors: errors.array() });
  }
  const threadId = Number(req.params.id);
  try {
    const result = await contactMessageModel.updateStatus({
      threadId,
      status: req.body.status,
    });
    if (result.notFound) {
      return res.status(404).json({ message: "Thread not found." });
    }

    if (req.body.status === "resolved") {
      const thread = await contactMessageModel.findThreadById(threadId);
      notifyCustomer(
        result.customerId,
        "Your Support Message Was Resolved",
        `"${thread.subject}" has been marked as resolved.`
      );
    }

    const thread = await contactMessageModel.findThreadById(threadId);
    return res.status(200).json({ thread: serializeThread(thread) });
  } catch (err) {
    console.error("UPDATE CONTACT MESSAGE STATUS ERROR:", err);
    return res.status(500).json({ message: "Failed to update status." });
  }
};
