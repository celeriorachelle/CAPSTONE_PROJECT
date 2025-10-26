// 📂 routes/admin.js
const express = require("express");
const router = express.Router();
const db = require("../db");

// ✅ Middleware: restrict to admin users
function requireAdmin(req, res, next) {
  if (!req.session.user || !req.session.user.role || req.session.user.role !== "admin") {
    return res.redirect("/login");
  }
  next();
}

// ✅ Admin Dashboard
router.get("/", requireAdmin, async (req, res) => {
  try {
    const [todayAppointments] = await db.query(`
      SELECT COUNT(*) AS count 
      FROM booking_tbl 
      WHERE DATE(booking_date) = CURDATE()
    `);

    const [pendingRequests] = await db.query(`
      SELECT COUNT(*) AS count 
      FROM booking_tbl 
      WHERE status = 'pending'
    `);

    const [availablePlots] = await db.query(`
      SELECT COUNT(*) AS count 
      FROM plot_map_tbl 
      WHERE availability = 'available'
    `);

    const [registeredFamilies] = await db.query(`
      SELECT COUNT(*) AS count 
      FROM user_tbl 
      WHERE role = 'user'
    `);

    res.render("admin", {
      user: req.session.user,
      todayAppointments: todayAppointments[0].count,
      pendingRequests: pendingRequests[0].count,
      availablePlots: availablePlots[0].count,
      registeredFamilies: registeredFamilies[0].count,
    });
  } catch (err) {
    console.error("Error loading admin dashboard:", err);
    res.status(500).send("Server error");
  }
});

// ✅ Notification count (recent 24 hours)
router.get("/notification/count", requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT COUNT(*) AS count 
      FROM booking_tbl
      WHERE generated_at >= NOW() - INTERVAL 1 DAY
    `);

    const [payments] = await db.query(`
      SELECT COUNT(*) AS count
      FROM payment_tbl
      WHERE paid_at >= NOW() - INTERVAL 1 DAY
    `);

    res.json({ count: rows[0].count + payments[0].count });
  } catch (err) {
    console.error("Error fetching notification count:", err);
    res.status(500).json({ count: 0 });
  }
});

// ✅ Latest bookings & downpayments (for dropdown)
router.get("/notification/list", requireAdmin, async (req, res) => {
  try {
    const [bookings] = await db.query(`
      SELECT 
        b.booking_id AS id,
        CONCAT(b.firstname, ' ', b.lastname) AS full_name,
        b.booking_date,
        b.service_type,
        b.status,
        b.generated_at AS created_at,
        'booking' AS type,
        NULL AS amount
      FROM booking_tbl b
      ORDER BY b.generated_at DESC
      LIMIT 5
    `);

    const [payments] = await db.query(`
      SELECT 
        p.payment_id AS id,
        CONCAT(u.firstName, ' ', u.lastName) AS full_name,
        p.paid_at AS created_at,
        p.status,
        p.amount,
        'downpayment' AS type
      FROM payment_tbl p
      JOIN user_tbl u ON p.user_id = u.user_id
      WHERE p.payment_type = 'downpayment'
      ORDER BY p.paid_at DESC
      LIMIT 5
    `);

    // Combine and sort both lists (latest first)
    const combined = [...bookings, ...payments].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );

    // Limit to 5 most recent combined notifications
    const recent = combined.slice(0, 5);

    res.json(recent);
  } catch (err) {
    console.error("Error fetching notification list:", err);
    res.status(500).json([]);
  }
});
// ✅ Mark specific notification as read (for admin)
router.post("/notification/mark-read/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await db.query(`UPDATE notification_tbl SET is_read = 1 WHERE notif_id = ?`, [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Error marking as read:", err);
    res.status(500).json({ success: false });
  }
});

// ✅ Mark specific notification as unread (optional)
router.post("/notification/mark-unread/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await db.query(`UPDATE notification_tbl SET is_read = 0 WHERE notif_id = ?`, [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Error marking as unread:", err);
    res.status(500).json({ success: false });
  }
});


module.exports = router;
