const express = require('express');
const router = express.Router();
const db = require('../db');

// Middleware: require login
function requireLogin(req, res, next) {
  if (!req.session || !req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  next();
}

// GET /adminviewapp
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
        IFNULL(SUM(CASE WHEN LOWER(p.status) = 'paid' THEN p.amount ELSE 0 END), 0) AS totalPaid
      FROM booking_tbl b
      LEFT JOIN plot_map_tbl pm ON b.plot_id = pm.plot_id
      LEFT JOIN payment_tbl p ON b.booking_id = p.booking_id
      GROUP BY
        b.booking_id,
        b.firstname,
        b.lastname,
        b.booking_date,
        b.visit_time,
        b.service_type,
        b.status,
        b.notes,
        b.phone,
        b.email,
        b.generated_at,
        pm.plot_id,
        pm.plot_number,
        pm.location,
        pm.availability,
        pm.price
      ORDER BY b.booking_date DESC
    `);

    const appointments = rows.map(r => {
      const isPlot = r.service?.toLowerCase().includes('plot');
      const totalAmount = isPlot ? parseFloat(r.plotPrice || 0) : 0;
      const totalPaid = isPlot ? parseFloat(r.totalPaid || 0) : 0;
      const minDownPayment = +(totalAmount * 0.2).toFixed(2);

      // Compute payment status
      let paymentStatus = isPlot
        ? (totalPaid <= 0
            ? 'Unpaid'
            : totalPaid < totalAmount
              ? 'Partially Paid'
              : 'Fully Paid')
        : 'N/A';

      // Compute display status for admin
      let displayStatus = r.booking_status;
      if (isPlot) {
        if (totalPaid >= totalAmount && totalAmount > 0) displayStatus = 'occupied';
        else if (totalPaid >= minDownPayment && totalPaid < totalAmount) displayStatus = 'reserved';
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
        displayStatus,
      };
    });

    // Compute dashboard stats
    const stats = {
      totalAppointments: appointments.length,
      pendingCount: appointments.filter(a => a.displayStatus.toLowerCase() === 'pending').length,
      reservedCount: appointments.filter(a => a.displayStatus.toLowerCase() === 'reserved').length,
      fullyPaidCount: appointments.filter(a => a.paymentStatus === 'Fully Paid').length,
    };

    res.render('adminviewapp', { appointments, stats });

  } catch (err) {
    console.error("Error fetching admin appointments:", err);
    res.status(500).send('Failed to fetch appointments');
  }
});

// POST /adminviewapp/reject/:id
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

module.exports = router;
