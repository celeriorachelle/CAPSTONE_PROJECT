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
// ✅ Notification count (real unread count)
router.get("/notification/count", requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT COUNT(*) AS count 
      FROM notification_tbl n
      LEFT JOIN booking_tbl b ON n.booking_id = b.booking_id
      LEFT JOIN payment_tbl p ON n.payment_id = p.payment_id
      WHERE n.is_read = 0
    `);
    res.json({ count: rows[0].count || 0 });
  } catch (err) {
    console.error("Error fetching notification count:", err);
    res.status(500).json({ count: 0 });
  }
});




// ✅ Latest bookings & downpayments (for dropdown)
// ✅ Combined notification list (booking + payments)
router.get("/notification/list", requireAdmin, async (req, res) => {
  try {
    const [bookings] = await db.query(`
      SELECT 
        n.notif_id AS id,
        n.is_read,
        CONCAT(b.firstname, ' ', b.lastname) AS full_name,
        b.booking_date,
        b.service_type,
        b.status,
        n.datestamp AS created_at,
        'booking' AS type,
        NULL AS amount
      FROM notification_tbl n
      LEFT JOIN booking_tbl b ON n.booking_id = b.booking_id
      WHERE n.booking_id IS NOT NULL
    `);

    const [payments] = await db.query(`
      SELECT 
        n.notif_id AS id,
        n.is_read,
        CONCAT(u.firstName, ' ', u.lastName) AS full_name,
        p.paid_at AS created_at,
        p.status,
        p.amount,
        CASE 
          WHEN p.payment_type = 'downpayment' THEN 'downpayment'
          ELSE 'fullpayment'
        END AS type
      FROM notification_tbl n
      LEFT JOIN payment_tbl p ON n.payment_id = p.payment_id
      LEFT JOIN user_tbl u ON p.user_id = u.user_id
      WHERE n.payment_id IS NOT NULL
    `);

    const combined = [...bookings, ...payments].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );

    res.json(combined.slice(0, 10)); // return latest 10
  } catch (err) {
    console.error("Error fetching notification list:", err);
    res.status(500).json([]);
  }
});

// ✅ Mark notification as read
router.post("/notification/mark-read/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await db.query("UPDATE notification_tbl SET is_read = 1 WHERE notif_id = ?", [id]);
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

// ------- Admin view: Notification logs page -------
router.get('/checknotificationlogs', requireAdmin, async (req, res) => {
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

    if (startDate && endDate) {
      sql += ` WHERE DATE(n.datestamp) BETWEEN ? AND ? `;
      params.push(startDate, endDate);
    }

    sql += ` ORDER BY n.datestamp DESC`;

    const [results] = await db.query(sql, params);

    res.render('admin_checknotificationlogs', {
      notifications: results,
      user: req.session.user,
      startDate: startDate || '',
      endDate: endDate || '',
    });
  } catch (err) {
    console.error('Error loading admin notification logs:', err);
    res.status(500).send('Server error');
  }
});

// POST /admin/notification/markAllAsRead - mark all notifications as read
router.post('/notification/markAllAsRead', requireAdmin, async (req, res) => {
  try {
    await db.query(`UPDATE notification_tbl SET is_read = 1 WHERE is_read = 0`);
    res.json({ message: 'All notifications marked as read.' });
  } catch (err) {
    console.error('Error marking all notifications as read:', err);
    res.status(500).json({ message: 'Error updating notifications.' });
  }
});


module.exports = router;
