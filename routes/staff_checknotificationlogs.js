const express = require("express");
const router = express.Router();
const db = require("../db"); // mysql2/promise connection

// 🛡️ Staff-only middleware
function requireStaff(req, res, next) {
  if (!req.session.user || req.session.user.role !== "staff") {
    return res.redirect("/login");
  }
  next();
}

// 📜 Display all notifications with optional date filtering
router.get("/", requireStaff, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let sql = `
      SELECT 
        n.notif_id,
        n.user_id,
        n.booking_id,
        n.payment_id,
        n.plot_id,
        n.message,
        n.is_read,
        n.datestamp,
        CONCAT(u.firstName, ' ', u.lastName) AS fullName,
        u.email
      FROM notification_tbl n
      LEFT JOIN user_tbl u ON n.user_id = u.user_id
    `;
    const params = [];

    // ✅ Apply date filter if present
    if (startDate && endDate) {
      sql += ` WHERE DATE(n.datestamp) BETWEEN ? AND ? `;
      params.push(startDate, endDate);
    }

    sql += ` ORDER BY n.datestamp DESC`;

    const [results] = await db.query(sql, params);

    res.render("staff_checknotificationlogs", {
      notifications: results,
      user: req.session.user,
      startDate: startDate || "",
      endDate: endDate || "",
    });
  } catch (err) {
    console.error("❌ Error fetching notifications:", err);
    res.status(500).send("Database error");
  }
});

// ✅ Mark single notification as read
router.post("/markAsRead/:id", requireStaff, async (req, res) => {
  try {
    const { id } = req.params;
    await db.query(`UPDATE notification_tbl SET is_read = 1 WHERE notif_id = ?`, [id]);
    res.json({ message: "Notification marked as read." });
  } catch (err) {
    console.error("❌ Error marking notification as read:", err);
    res.status(500).json({ message: "Error updating notification." });
  }
});

// ✅ Mark all as read
router.post("/markAllAsRead", requireStaff, async (req, res) => {
  try {
    await db.query(`UPDATE notification_tbl SET is_read = 1 WHERE is_read = 0`);
    res.json({ message: "All notifications marked as read." });
  } catch (err) {
    console.error("❌ Error marking all as read:", err);
    res.status(500).json({ message: "Error updating all notifications." });
  }
});

module.exports = router;
