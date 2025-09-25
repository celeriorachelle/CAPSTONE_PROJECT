const express = require('express');
const router = express.Router();
const db = require('../db');

// Middleware to require login
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

router.get('/', requireLogin, async (req, res) => {
  const userId = req.session.user.user_id;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  const filterType = req.query.type || '';

  try {
    // Fetch bookings with payment info
    let query = `
      SELECT 
          b.booking_id,
          b.firstname,
          b.lastname,
          b.email,
          b.phone,
          b.booking_date,
          b.visit_time,
          b.service_type,
          b.status AS booking_status,
          b.notes,
          pm.plot_number,
          pm.location,
          pm.type AS plot_type,
          pm.price AS total_amount,
          IFNULL(SUM(p.amount), 0) AS total_paid
      FROM booking_tbl b
      LEFT JOIN plot_map_tbl pm ON b.plot_id = pm.plot_id
      LEFT JOIN payment_tbl p ON b.booking_id = p.booking_id
      WHERE b.user_id = ?
    `;
    const params = [userId];

    if (filterType) {
      query += ' AND b.service_type = ?';
      params.push(filterType);
    }

    query += `
      GROUP BY b.booking_id
      ORDER BY b.booking_date DESC
      LIMIT ? OFFSET ?
    `;
    params.push(limit, offset);

    const [rows] = await db.query(query, params);

    // Transform bookings for display
    const bookingsGrouped = {
      'plot-booking': [],
      'memorial': [],
      'burial': []
    };

    rows.forEach(r => {
      const isPlot = r.service_type?.toLowerCase() === 'plot-booking';
      let paymentStatus = 'N/A';
      let displayStatus = r.booking_status;

      if (isPlot) {
        const minDownPayment = +(r.total_amount * 0.2 || 0).toFixed(2);
        const totalPaid = parseFloat(r.total_paid || 0);
        const totalAmount = parseFloat(r.total_amount || 0);

        if (totalPaid <= 0) paymentStatus = 'Unpaid';
        else if (totalPaid < totalAmount) paymentStatus = 'Partially Paid';
        else paymentStatus = 'Fully Paid';

        if (totalPaid >= totalAmount) displayStatus = 'occupied';
        else if (totalPaid >= minDownPayment) displayStatus = 'reserved';
      }

      const booking = {
        id: r.booking_id,
        clientName: `${r.firstname} ${r.lastname}`,
        email: r.email,
        phone: r.phone,
        date: r.booking_date,
        time: r.visit_time,
        service: r.service_type,
        notes: r.notes,
        plot_number: r.plot_number,
        location: r.location,
        plot_type: r.plot_type,
        totalAmount: r.total_amount || 0,
        totalPaid: r.total_paid || 0,
        paymentStatus,
        displayStatus
      };

      if (bookingsGrouped[r.service_type]) {
        bookingsGrouped[r.service_type].push(booking);
      }
    });

    // Total count for pagination
    let countQuery = 'SELECT COUNT(*) AS total FROM booking_tbl WHERE user_id = ?';
    const countParams = [userId];
    if (filterType) {
      countQuery += ' AND service_type = ?';
      countParams.push(filterType);
    }

    const [[{ total }]] = await db.query(countQuery, countParams);
    const totalPages = Math.ceil(total / limit);

    res.render('viewbooking', {
      bookingsGrouped,
      page,
      totalPages,
      limit,
      filterType
    });

  } catch (err) {
    console.error(err);
    res.render('viewbooking', {
      bookingsGrouped: { 'plot-booking': [], 'memorial': [], 'burial': [] },
      page: 1,
      totalPages: 1,
      limit: 10,
      filterType: ''
    });
  }
});

module.exports = router;
