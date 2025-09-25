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
// routes/adminviewapp.js
router.get('/', requireLogin, async (req, res) => {
  try {
  const [rows] = await db.query(`
  SELECT 
    b.booking_id AS id,
    CONCAT(b.firstname,' ',b.lastname) AS clientName,
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
    pm.price AS plotPrice,
    COALESCE(tp.totalPaid, 0) AS totalPaid
  FROM booking_tbl b
  LEFT JOIN plot_map_tbl pm ON b.plot_id = pm.plot_id
  LEFT JOIN (
      SELECT booking_id, SUM(amount) AS totalPaid
      FROM payment_tbl
      GROUP BY booking_id
  ) tp ON tp.booking_id = b.booking_id
  ORDER BY b.booking_date DESC
`);


   const appointments = rows.map(r => {
  const isPlot = r.service?.toLowerCase().includes('plot');
  const totalAmount = isPlot ? parseFloat(r.plotPrice || 0) : 0;
  const totalPaid = isPlot ? parseFloat(r.totalPaid || 0) : 0;
  const minDownPayment = +(totalAmount * 0.2).toFixed(2);

  let paymentStatus = isPlot
    ? (totalPaid <= 0
        ? 'Unpaid'
        : totalPaid < totalAmount
          ? 'Partially Paid'
          : 'Fully Paid')
    : 'N/A';

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


    // compute stats for the EJS
    const stats = {
      totalAppointments: appointments.length,
      pendingCount: appointments.filter(a => a.displayStatus === 'pending').length,
      reservedCount: appointments.filter(a => a.displayStatus === 'reserved').length,
      fullyPaidCount: appointments.filter(a => a.paymentStatus === 'Fully Paid').length,
    };
    res.render('adminviewapp', { appointments, stats });

  } catch (err) {
    console.error("Error fetching admin appointments:", err);
    res.status(500).send('Failed to fetch appointments  ');
  }
});

router.get('/installment_reminders', requireLogin, async (req, res) => {
  try {
    // Fetch all plot bookings with payments
    const [rows] = await db.query(`
      SELECT 
        b.booking_id AS id,
        CONCAT(b.firstname,' ',b.lastname) AS clientName,
        b.booking_date AS date,
        b.visit_time AS time,
        b.service_type AS service,
        b.status AS booking_status,
        pm.plot_number,
        pm.location,
        pm.price AS plotPrice,
        COALESCE(tp.totalPaid, 0) AS totalPaid
      FROM booking_tbl b
      LEFT JOIN plot_map_tbl pm ON b.plot_id = pm.plot_id
      LEFT JOIN (
        SELECT booking_id, SUM(amount) AS totalPaid
        FROM payment_tbl
        GROUP BY booking_id
      ) tp ON tp.booking_id = b.booking_id
      WHERE b.service_type LIKE '%plot%'
    `);

    const reminders = rows
      .map(r => {
        const totalAmount = parseFloat(r.plotPrice || 0);
        const totalPaid = parseFloat(r.totalPaid || 0);
        if (totalPaid >= totalAmount) return null; // skip fully paid
        return {
          id: r.id,
          clientName: r.clientName,
          date: r.date,
          time: r.time,
          plot_number: r.plot_number,
          location: r.location,
          totalAmount,
          totalPaid,
          balance: totalAmount - totalPaid,
        };
      })
      .filter(r => r !== null);

    res.render('installment_reminders', { reminders });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching installment reminders");
  }
});



module.exports = router;
