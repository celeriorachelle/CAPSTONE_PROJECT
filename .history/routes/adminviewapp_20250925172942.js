// routes/adminviewapp.js
const express = require('express');
const router = express.Router();
const db = require('../db'); // DB connection

// Middleware: require login
function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }
  next();
}

/**
 * Base route /adminviewapp
 * Shows all bookings + payments + plot data
 */
router.get('/', requireLogin, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        b.booking_id AS id,
        CONCAT(b.firstname, ' ', b.lastname) AS clientName,
        b.booking_date AS date,
        b.visit_time AS time,
        b.service_type AS service,
        b.status,
        b.notes,
        b.phone,
        b.email,
        b.generated_at AS createdAt,
        IFNULL(SUM(p.amount), 0) AS totalPaid,
        COALESCE(pm.price, 0) AS totalAmount,
        (COALESCE(pm.price, 0) * 0.2) AS minDownPayment,
        CASE 
          WHEN IFNULL(SUM(p.amount), 0) >= COALESCE(pm.price, 0) THEN 1
          ELSE 0
        END AS isFullyPaid,
        (COALESCE(pm.price, 0) - IFNULL(SUM(p.amount), 0)) AS remaining,
        pm.plot_number,
        pm.location
      FROM booking_tbl b
      LEFT JOIN payment_tbl p ON b.booking_id = p.booking_id
      LEFT JOIN plot_map_tbl pm ON b.plot_id = pm.plot_id
      GROUP BY b.booking_id
      ORDER BY b.booking_date DESC
    `);

    // Convert dates for rendering
    rows.forEach(apt => {
      apt.createdAt = apt.createdAt ? new Date(apt.createdAt) : null;
      apt.date = apt.date ? new Date(apt.date) : null;
    });

    res.render('adminviewapp', { appointments: rows });
  } catch (err) {
    console.error("Error fetching admin appointments:", err);
    res.status(500).send('Failed to fetch appointments');
  }
});

/**
 * Approve booking
 */
router.post('/approve/:id', requireLogin, async (req, res) => {
  const bookingId = req.params.id;

  try {
    const [bookingRows] = await db.query(
      `SELECT b.booking_id, b.status, b.user_id, b.plot_id, b.service_type, b.booking_date,
              IFNULL(SUM(p.amount), 0) AS totalPaid,
              COALESCE(pm.price, 0) AS totalAmount
       FROM booking_tbl b
       LEFT JOIN payment_tbl p ON b.booking_id = p.booking_id
       LEFT JOIN plot_map_tbl pm ON b.plot_id = pm.plot_id
       WHERE b.booking_id = ?
       GROUP BY b.booking_id`,
      [bookingId]
    );

    if (!bookingRows[0]) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    const booking = bookingRows[0];
    const minDownPayment = booking.totalAmount * 0.2;

    if (booking.service_type === 'plot_booking') {
      // Require downpayment before approval
      if (booking.totalPaid < minDownPayment) {
        return res.status(400).json({
          success: false,
          error: `Cannot approve. Minimum downpayment of PHP ${minDownPayment.toFixed(2)} required.`
        });
      }

      // Approve booking
      await db.query(`UPDATE booking_tbl SET status = 'approved' WHERE booking_id = ?`, [bookingId]);

      // Update plot availability
      if (booking.totalPaid < booking.totalAmount) {
        await db.query(`UPDATE plot_map_tbl SET availability = 'reserved' WHERE plot_id = ?`, [booking.plot_id]);
      } else {
        await db.query(`UPDATE plot_map_tbl SET availability = 'occupied' WHERE plot_id = ?`, [booking.plot_id]);
      }
    } else {
      // For burial/memorial services
      await db.query(`UPDATE booking_tbl SET status = 'approved' WHERE booking_id = ?`, [bookingId]);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error approving booking:", err);
    res.status(500).json({ success: false, error: 'Failed to approve booking' });
  }
});

/**
 * Reject booking
 */
router.post('/reject/:id', requireLogin, async (req, res) => {
  const bookingId = req.params.id;

  try {
    await db.query(`UPDATE booking_tbl SET status = 'cancelled' WHERE booking_id = ?`, [bookingId]);
    res.json({ success: true });
  } catch (err) {
    console.error("Error rejecting booking:", err);
    res.status(500).json({ success: false, error: 'Failed to reject booking' });
  }
});

module.exports = router;
