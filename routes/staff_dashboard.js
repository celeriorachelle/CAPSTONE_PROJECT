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

// Staff Dashboard Overview
router.get('/', requireStaff, async (req, res) => {
  try {
    // Total approved or reserved bookings
    const [bookings] = await db.query(`
      SELECT COUNT(*) AS totalBookings 
      FROM booking_tbl 
      WHERE status IN ('approved', 'reserved')
    `);

    // Pending payments
    const [pendingPayments] = await db.query(`
      SELECT COUNT(*) AS pendingPayments 
      FROM payment_tbl 
      WHERE status = 'pending'
    `);

    // Upcoming due payments (within 7 days)
    const [upcomingDue] = await db.query(`
      SELECT COUNT(*) AS upcomingDue 
      FROM payment_tbl 
      WHERE due_date IS NOT NULL 
      AND due_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)
    `);

    // Total staff actions logged
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

module.exports = router;
