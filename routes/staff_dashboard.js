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
    const [bookings] = await db.query(`
      SELECT booking_id AS id, 
             CONCAT('New booking by ', firstname, ' ', lastname) AS message, 
             generated_at AS datestamp
      FROM booking_tbl
      WHERE status IN ('pending', 'reserved', 'approved')
      ORDER BY generated_at DESC
      LIMIT 5
    `);

    const [payments] = await db.query(`
      SELECT p.payment_id AS id, 
             CONCAT('Client paid ', p.payment_type, ' installment (', u.firstName, ' ', u.lastName, ')') AS message, 
             p.paid_at AS datestamp
      FROM payment_tbl p
      JOIN user_tbl u ON p.user_id = u.user_id
      WHERE p.status = 'paid' OR p.payment_type = 'downpayment'
      ORDER BY p.paid_at DESC
      LIMIT 5
    `);

    const all = [...bookings, ...payments].sort(
      (a, b) => new Date(b.datestamp) - new Date(a.datestamp)
    );

    res.json(all.slice(0, 10));
  } catch (err) {
    console.error('Error fetching notifications for staff:', err);
    res.status(500).json({ message: 'Error fetching staff notifications' });
  }
});

module.exports = router;
