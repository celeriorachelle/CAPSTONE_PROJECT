const express = require('express');
const router = express.Router();
const db = require('../db');

// Middleware — Only staff can access
function requireStaff(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'staff') {
    return res.redirect('/login');
  }
  next();
}

// 🟢 Staff Dashboard Overview
router.get('/', requireStaff, async (req, res) => {
  try {
    const [bookings] = await db.query(`
      SELECT COUNT(*) AS totalBookings 
      FROM booking_tbl 
      WHERE status IN ('approved', 'reserved')
    `);

    const [pendingPayments] = await db.query(`
      SELECT COUNT(*) AS pendingPayments 
      FROM payment_tbl 
      WHERE status = 'pending'
    `);

    const [upcomingDue] = await db.query(`
      SELECT COUNT(*) AS upcomingDue 
      FROM payment_tbl 
      WHERE due_date IS NOT NULL 
      AND due_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)
    `);

    const [logs] = await db.query(`
      SELECT COUNT(*) AS totalLogs 
      FROM logs_tbl 
      WHERE user_role = 'staff'
    `);

    res.render('staff_dashboard', {
      staff: req.session.user,
      stats: {
        totalBookings: bookings[0].totalBookings || 0,
        pendingPayments: pendingPayments[0].pendingPayments || 0,
        upcomingDue: upcomingDue[0].upcomingDue || 0,
        totalLogs: logs[0].totalLogs || 0
      }
    });
  } catch (err) {
    console.error('Error loading staff dashboard:', err);
    res.status(500).send('Error loading staff dashboard');
  }
});

// 🟢 Notifications (bookings + payments)
router.get('/notifications/json', requireStaff, async (req, res) => {
  try {
    // Ensure staff_notifications table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS staff_notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ref_id INT,
        user_id INT,
        message VARCHAR(255),
        datestamp DATETIME,
        is_read BOOLEAN DEFAULT 0
      )
    `);

    const [existing] = await db.query(`SELECT message FROM staff_notifications`);

    // Fetch new booking notifications with plot details
    const [bookings] = await db.query(`
      SELECT 
        b.booking_id AS id, 
        b.user_id,
        CONCAT('New booking: Plot #', pm.plot_number, ' by ', u.firstName, ' ', u.lastName) AS message,
        b.generated_at AS datestamp
      FROM booking_tbl b
      JOIN plot_map_tbl pm ON b.plot_id = pm.plot_id
      JOIN user_tbl u ON b.user_id = u.user_id
      WHERE b.status IN ('pending', 'reserved', 'approved')
      ORDER BY b.generated_at DESC
      LIMIT 5
    `);

    // Fetch payment notifications with plot and payment details
    const [payments] = await db.query(`
      SELECT 
        p.payment_id AS id, 
        p.user_id,
        CONCAT(
          CASE 
            WHEN p.payment_type = 'fullpayment' THEN 'Full payment'
            ELSE 'Down payment'
          END,
          ' received: Plot #', pm.plot_number, 
          ' - ₱', FORMAT(p.amount, 2),
          ' by ', u.firstName, ' ', u.lastName
        ) AS message,
        p.paid_at AS datestamp
      FROM payment_tbl p
      JOIN user_tbl u ON p.user_id = u.user_id
      JOIN booking_tbl b ON p.booking_id = b.booking_id
      JOIN plot_map_tbl pm ON b.plot_id = pm.plot_id
      WHERE (p.payment_type = 'fullpayment' OR p.payment_type = 'downpayment')
        AND p.paid_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      ORDER BY p.paid_at DESC
      LIMIT 5
    `);

    const all = [...bookings, ...payments]
      .sort((a, b) => new Date(b.datestamp) - new Date(a.datestamp))
      .slice(0, 10);

    // Insert new unseen notifications
    for (const n of all) {
      if (!existing.find(e => e.message === n.message)) {
        await db.query(
          `INSERT INTO staff_notifications (ref_id, user_id, message, datestamp) VALUES (?, ?, ?, ?)`,
          [n.id, n.user_id, n.message, n.datestamp]
        );
      }
    }

    const [finalData] = await db.query(`SELECT * FROM staff_notifications ORDER BY datestamp DESC LIMIT 10`);
    res.json(finalData);
  } catch (err) {
    console.error('Error fetching notifications for staff:', err);
    res.status(500).json({ message: 'Error fetching staff notifications' });
  }
});

// 🟢 Mark as Read
router.post('/notifications/mark-read/:id', requireStaff, async (req, res) => {
  try {
    await db.query(`UPDATE staff_notifications SET is_read = 1 WHERE id = ?`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error marking notification as read:', err);
    res.status(500).json({ message: 'Error marking as read' });
  }
});

module.exports = router;
