const express = require("express");
const router = express.Router();
const db = require("../db");
const nodemailer = require("nodemailer");

// 📧 Gmail transporter (for optional email alerts)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "rheachellegutierrez17@gmail.com",
    pass: "cpflmrprhngxnsxo", // Gmail App Password
  },
});

// 🔒 Require Login
function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect("/login");
  }
  next();
}

// ✅ Fetch Notifications JSON for dropdown
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

// ✅ Get unread count for badge
router.get("/unread/count", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.user_id;
    const [rows] = await db.query(
      "SELECT COUNT(*) AS count FROM notification_tbl WHERE user_id = ? AND is_read = 0",
      [userId]
    );
    res.json({ count: rows[0].count });
  } catch (err) {
    console.error("Error fetching unread count:", err);
    res.status(500).json({ message: "Error fetching unread count" });
  }
});

// ✅ Mark all as read
router.post("/mark-read", requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.user_id;
    await db.query(
      "UPDATE notification_tbl SET is_read = 1 WHERE user_id = ? AND is_read = 0",
      [userId]
    );
    res.sendStatus(200);
  } catch (err) {
    console.error("Error marking notifications as read:", err);
    res.status(500).send("Error marking as read");
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

// ✅ Function for sending new notifications (can be reused)
async function sendNotification(user_id, message, email = null) {
  try {
    await db.query("INSERT INTO notification_tbl (user_id, message) VALUES (?, ?)", [
      user_id,
      message,
    ]);
    console.log("📩 Notification saved for user:", user_id, "-", message);

    // Optional: Email notification
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

