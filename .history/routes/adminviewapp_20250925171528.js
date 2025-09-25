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
    const [rows] = await db.query(`
      SELECT 
        b.booking_id AS id,
        CONCAT(b.firstname, ' ', b.lastname) AS clientName,
        b.booking_date AS date,
        b.visit_time AS time,
        b.service_type AS service,
        b.status AS booking_status,
        b.notes,
        b.phone,
        b.email,
        b.generated_at AS createdAt,
        pm.plot_id,
        pm.plot_number,
        pm.location,
        pm.availability,
        COALESCE(pm.price, 0) AS plotPrice,
        IFNULL(SUM(p.amount), 0) AS totalPaid
      FROM booking_tbl b
      LEFT JOIN plot_map_tbl pm ON b.plot_id = pm.plot_id
      LEFT JOIN payment_tbl p ON b.booking_id = p.booking_id
      GROUP BY b.booking_id
      ORDER BY b.booking_date DESC
    `);

    // Separate lists
    const plotBookings = [];
    const burialMemorialBookings = [];

    rows.forEach(r => {
      const isPlot = isPlotService(r.service);
      const isBurialOrMemorial = r.service?.toLowerCase().includes('burial') 
                                || r.service?.toLowerCase().includes('memorial');

      const totalAmount = isPlot ? parseFloat(r.plotPrice || 0) : 0;
      const totalPaid = isPlot ? parseFloat(r.totalPaid || 0) : 0;
      const minDownPayment = +(totalAmount * 0.2).toFixed(2);

      let paymentStatus = isPlot ? 
        (totalPaid <= 0 ? 'Unpaid' : totalPaid < totalAmount ? 'Partially Paid' : 'Fully Paid') 
        : 'N/A';

      let displayStatus = r.booking_status;
      if (isPlot) {
        if (totalPaid >= totalAmount && totalAmount > 0) displayStatus = 'occupied';
        else if (totalPaid >= minDownPayment && totalPaid < totalAmount) displayStatus = 'reserved';
      }

      const record = {
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
        displayStatus,
      };

      if (isPlot) plotBookings.push(record);
      else if (isBurialOrMemorial) burialMemorialBookings.push(record);
    });

    res.render('adminviewapp', { plotBookings, burialMemorialBookings });

  } catch (err) {
    console.error("Error fetching admin appointments:", err);
    res.status(500).send('Failed to fetch appointments');
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
router.get('/installment/reminders', requireLogin, async (req, res) => {
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
    res.render('installment_reminders', { 
  reminders: rows.map(r => ({
    ...r,
    plot_number: r.plot_number || 'N/A',
    location: r.location || 'N/A'
  }))
});

});



module.exports = router;
