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

// ✅ Notification count (recent 24 hours) - singular route
router.get("/notification/count", requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT COUNT(*) AS count 
      FROM booking_tbl
      WHERE generated_at >= NOW() - INTERVAL 1 DAY
    `);
    res.json({ count: rows[0].count });
  } catch (err) {
    console.error("Error fetching notification count:", err);
    res.status(500).json({ count: 0 });
  }
});

// ✅ Latest bookings (for dropdown) - singular route
router.get("/notification/list", requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        b.booking_id, 
        CONCAT(b.firstname, ' ', b.lastname) AS full_name,
        b.booking_date,
        b.service_type,
        b.status,
        b.generated_at,
        p.status AS payment_status
      FROM booking_tbl b
      LEFT JOIN payment_tbl p ON b.booking_id = p.booking_id
      ORDER BY b.generated_at DESC
      LIMIT 5
    `);
    res.json(rows);
  } catch (err) {
    console.error("Error fetching notification list:", err);
    res.status(500).json([]);
  }
});

module.exports = router;
