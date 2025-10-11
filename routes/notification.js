const express = require("express");
const router = express.Router();
const db = require("../db");
const nodemailer = require("nodemailer");

// 📧 Gmail transporter (optional email alert)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "rheachellegutierrez17@gmail.com",
    pass: "cpflmrprhngxnsxo", // Gmail App Password
  },
});

// 🔒 Middleware to check login
function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect("/login");
  }
  next();
}

// ✅ Fetch all notifications (JSON)
router.get("/json", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.user_id;
    const [rows] = await db.query(
      `SELECT * FROM notification_tbl WHERE user_id = ? ORDER BY datestamp DESC`,
      [userId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Error fetching notifications:", err);
    res.status(500).json({ message: "Error fetching notifications" });
  }
});

// ✅ Unread count for bell icon
router.get("/unread/count", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.user_id;
    const [rows] = await db.query(
      `SELECT COUNT(*) AS count FROM notification_tbl WHERE user_id = ? AND is_read = 0`,
      [userId]
    );
    res.json({ count: rows[0].count || 0 });
  } catch (err) {
    console.error("Error fetching unread count:", err);
    res.status(500).json({ message: "Error fetching unread count" });
  }
});

// ✅ Mark all notifications as read
router.post("/mark-read", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.user_id;
    await db.query(
      `UPDATE notification_tbl SET is_read = 1 WHERE user_id = ? AND is_read = 0`,
      [userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Error marking notifications as read:", err);
    res.status(500).json({ success: false });
  }
});

// ✅ Mark single as read
router.post("/mark-read/:id", requireLogin, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session.user.user_id;
    await db.query(
      `UPDATE notification_tbl SET is_read = 1 WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Error marking single as read:", err);
    res.status(500).json({ success: false });
  }
});

// ✅ Mark single as unread
router.post("/mark-unread/:id", requireLogin, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session.user.user_id;
    await db.query(
      `UPDATE notification_tbl SET is_read = 0 WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Error marking single as unread:", err);
    res.status(500).json({ success: false });
  }
});

// ✅ Render Notifications Page
router.get("/", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.user_id;
    const [notifications] = await db.query(
      `SELECT * FROM notification_tbl WHERE user_id = ? ORDER BY datestamp DESC`,
      [userId]
    );
    res.render("notification", { notifications });
  } catch (err) {
    console.error("Error rendering notifications:", err);
    res.status(500).send("Internal Server Error");
  }
});

// ✅ Helper function to send notification
async function sendNotification(user_id, message, email = null) {
  try {
    await db.query(
      `INSERT INTO notification_tbl (user_id, message, is_read) VALUES (?, ?, 0)`,
      [user_id, message]
    );
    console.log("📩 Notification saved:", user_id, message);

    if (email) {
      await transporter.sendMail({
        from: '"Everlasting Peace Memorial Park" <rheachellegutierrez17@gmail.com>',
        to: email,
        subject: "New Notification",
        text: message,
      });
    }
  } catch (err) {
    console.error("Error sending notification:", err);
  }
}

module.exports = router;
