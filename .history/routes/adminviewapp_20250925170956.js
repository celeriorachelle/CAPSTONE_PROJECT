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
     * Helper to decide if a service type is a plot booking
     */
    function isPlotService(serviceType) {
      if (!serviceType) return false;
      return serviceType.toString().toLowerCase().includes('plot');
    }

    /**
     * Base route /adminviewapp
     * Shows all bookings + computed payment/plot info
     */
    router.get('/', requireLogin, async (req, res) => {
      try {
      // routes/adminviewapp.js
        const [rows] = await db.query(`
      SELECT 
        b.booking_id AS id,
        CONCAT(b.firstname, ' ', b.lastname) AS clientName,
        b.booking_date AS date,
        b.visit_time AS time,
        b.service_type AS service,
        b.status AS booking_status,   -- ✅ alias booking_tbl.status
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
        pm.plot_id,
        pm.plot_number,
        pm.location,
        pm.availability   -- ✅ needed for installments.ejs
      FROM booking_tbl b
      LEFT JOIN payment_tbl p ON b.booking_id = p.booking_id
      LEFT JOIN plot_map_tbl pm ON b.plot_id = pm.plot_id
      GROUP BY b.booking_id
      ORDER BY b.booking_date DESC
    `);



      const enriched = rows.map(r => {
      const totalAmount = parseFloat(r.totalAmount || 0);
      const totalPaid = parseFloat(r.totalPaid || 0);
      const minDownPayment = +(totalAmount * 0.2).toFixed(2);

      let paymentStatus = 'Unpaid';
      if (totalPaid <= 0) paymentStatus = 'Unpaid';
      else if (totalPaid < totalAmount) paymentStatus = 'Partially Paid';
      else paymentStatus = 'Fully Paid';

      let displayStatus = r.booking_status; // ✅ fixed alias
      if (isPlotService(r.service)) {
        if (totalPaid >= totalAmount && totalAmount > 0) {
          displayStatus = 'occupied';
        } else if (totalPaid >= minDownPayment && totalPaid < totalAmount) {
          displayStatus = 'reserved';
        }
      }

    return {
  id: r.id,
  service: r.service,
  bookingStatus: r.booking_status,
  clientName: r.clientName,
  date: r.date,
  time: r.time,
  notes: r.notes,
  phone: r.phone,
  email: r.email,
  createdAt: r.createdAt,
  totalAmount,
  totalPaid,
  minDownPayment,
  paymentStatus,
  plot_id: r.plot_id,
  plot_number: r.plot_number,
  location: r.location,
  availability: r.availability,
  displayStatus
};
    });


    // compute simple stats for top cards
    const stats = {
      totalAppointments: enriched.length,
      pendingCount: enriched.filter(x => x.displayStatus === 'pending').length,
      reservedCount: enriched.filter(x => x.displayStatus === 'reserved').length,
      fullyPaidCount: enriched.filter(x => x.paymentStatus === 'Fully Paid').length
    };

    // Convert dates to JS Date objects for EJS where needed
    enriched.forEach(e => {
      e.createdAt = e.createdAt ? new Date(e.createdAt) : null;
      e.date = e.date ? new Date(e.date) : null;
    });

    res.render('adminviewapp', { appointments: enriched, stats });
  } catch (err) {
    console.error("Error fetching admin appointments:", err);
    res.status(500).send('Failed to fetch appointments');
  }
});

/**
 * Approve booking (ONLY for non-plot services).
 * Plot bookings are reserved automatically based on payments, so staff should not "approve" them here.
 */
// Approve booking route
router.post('/approve/:id', requireLogin, async (req, res) => {
  const bookingId = req.params.id;

  try {
    const [rows] = await db.query(`
      SELECT b.booking_id, b.user_id, b.service_type, b.booking_date,
             COALESCE(pm.price, 0) AS totalAmount,
             IFNULL(SUM(CASE WHEN p.status = 'paid' THEN p.amount ELSE 0 END), 0) AS totalPaid,
             pm.plot_id
      FROM booking_tbl b
      LEFT JOIN plot_map_tbl pm ON b.plot_id = pm.plot_id
      LEFT JOIN payment_tbl p ON b.booking_id = p.booking_id
      WHERE b.booking_id = ?
      GROUP BY b.booking_id
    `, [bookingId]);

    const booking = rows[0];
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

    const serviceType = booking.service_type?.toLowerCase() || '';

    // For plot bookings, do NOT allow manual approval
    if (serviceType.includes('plot') || serviceType.includes('burial')) {
      return res.status(400).json({
        success: false,
        error: 'Plot or burial bookings are reserved/approved automatically based on payments. Do not approve manually.'
      });
    }

    // Allowed ENUM values for status
    const allowedStatuses = ['pending', 'approved', 'cancelled', 'reserved', 'occupied'];
    const newStatus = 'approved';

    if (!allowedStatuses.includes(newStatus)) {
      return res.status(400).json({ success: false, error: 'Invalid status value' });
    }

    // Update status for non-plot service
    await db.query(`UPDATE booking_tbl SET status = ? WHERE booking_id = ?`, [newStatus, bookingId]);

    // Send notification
    const formattedDate = booking.booking_date ? new Date(booking.booking_date).toLocaleDateString() : 'your scheduled date';
    const message = `Your ${booking.service_type} request on ${formattedDate} has been approved.`;

    await db.query(
      `INSERT INTO notification_tbl (user_id, booking_id, message, is_read, datestamp) VALUES (?, ?, ?, 0, NOW())`,
x      [booking.user_id, bookingId, message]
    );

    res.json({ success: true });

  } catch (err) {
    console.error("Error approving booking:", err);
    res.status(500).json({ success: false, error: 'Failed to approve booking' });
  }
});

/**
 * Reject / Cancel booking
 * - If plot booking already has payments, do NOT allow cancel via this route.
 * - Staff must refund payments first (separate flow), then cancel.
 */
router.post('/reject/:id', requireLogin, async (req, res) => {
  const bookingId = req.params.id;

  try {
    const [rows] = await db.query(`
      SELECT IFNULL(SUM(CASE WHEN p.status='paid' THEN p.amount ELSE 0 END),0) AS totalPaid
      FROM booking_tbl b
      LEFT JOIN payment_tbl p ON b.booking_id = p.booking_id
      WHERE b.booking_id = ?
      GROUP BY b.booking_id
    `, [bookingId]);

    const totalPaid = rows[0] ? parseFloat(rows[0].totalPaid || 0) : 0;

    if (totalPaid > 0) {
      return res.status(400).json({
        success: false,
        error: 'Booking has payments. Please process refund or handle payments before cancelling the booking.'
      });
    }

    await db.query(`UPDATE booking_tbl SET status = 'cancelled' WHERE booking_id = ?`, [bookingId]);

    res.json({ success: true });
  } catch (err) {
    console.error("Error rejecting booking:", err);
    res.status(500).json({ success: false, error: 'Failed to reject booking' });
  }
});

// View upcoming/overdue installments
router.get('/installments/reminders', requireLogin, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        b.booking_id,
        CONCAT(b.firstname, ' ', b.lastname) AS clientName,
        pm.plot_number,
        pm.location,
        p.amount,
        p.status,
        p.due_date
      FROM payment_tbl p
      JOIN booking_tbl b ON p.booking_id = b.booking_id
      LEFT JOIN plot_map_tbl pm ON b.plot_id = pm.plot_id
      WHERE p.status = 'pending'
        AND p.due_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)
      ORDER BY p.due_date ASC
    `);

    // render must match the actual filename: installment_reminders.ejs
    res.render('installment_reminders', { reminders: rows });
  } catch (err) {
    console.error("Error fetching installment reminders:", err);
    res.status(500).send("Failed to fetch installment reminders");
  }
});



module.exports = router;
