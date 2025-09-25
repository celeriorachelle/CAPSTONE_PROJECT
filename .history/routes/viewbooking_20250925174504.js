const express = require('express');
const router = express.Router();
const db = require('../db');

// Middleware: require login
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

router.get('/', requireLogin, async (req, res) => {
  const userId = req.session.user.user_id;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  const filterType = req.query.type || ''; // optional service type filter

  try {
    // Base query: fetch all bookings with optional plot info and payment sums
    let bookingsQuery = `
      SELECT
        b.booking_id,
        b.service_type,
        b.booking_date,
        b.status AS booking_status,
        b.notes,
        pm.plot_number,
        pm.price AS total_amount,
        IFNULL(SUM(p.amount), 0) AS total_paid,
        (IFNULL(pm.price, 0) - IFNULL(SUM(p.amount), 0)) AS balance
      FROM booking_tbl b
      LEFT JOIN plot_map_tbl pm ON b.plot_id = pm.plot_id
      LEFT JOIN payment_tbl p 
        ON b.booking_id = p.booking_id AND LOWER(p.status) = 'paid'
      WHERE b.user_id = ?
    `;

    const queryParams = [userId];

    // Apply filter by service type
    if (filterType) {
      bookingsQuery += ' AND b.service_type = ?';
      queryParams.push(filterType);
    }

    bookingsQuery += `
      GROUP BY b.booking_id, b.service_type, b.booking_date, b.status, b.notes, pm.plot_number, pm.price
      ORDER BY b.booking_date DESC
      LIMIT ? OFFSET ?
    `;
    queryParams.push(limit, offset);

    // Fetch bookings
    const [bookings] = await db.query(bookingsQuery, queryParams);

    // Optional: group bookings by type for display
    const bookingsGrouped = {
      'plot': [],
      'memorial': [],
      'burial': []
    };
    bookings.forEach(b => {
      const type = b.service_type.toLowerCase();
      if (bookingsGrouped[type]) {
        // Compute payment status
        const isPlot = type === 'plot';
        const totalAmount = isPlot ? parseFloat(b.total_amount || 0) : 0;
        const totalPaid = isPlot ? parseFloat(b.total_paid || 0) : 0;
        let paymentStatus = isPlot
          ? totalPaid <= 0
            ? 'Unpaid'
            : totalPaid < totalAmount
              ? 'Partially Paid'
              : 'Fully Paid'
          : 'N/A';

        bookingsGrouped[type].push({
          ...b,
          paymentStatus
        });
      }
    });

    // Get total count for pagination
    let totalQuery = 'SELECT COUNT(*) AS total FROM booking_tbl WHERE user_id = ?';
    const totalParams = [userId];
    if (filterType) {
      totalQuery += ' AND service_type = ?';
      totalParams.push(filterType);
    }
    const [[{ total }]] = await db.query(totalQuery, totalParams);
    const totalPages = Math.ceil(total / limit);

    // Render view
    res.render('viewbookings', {
      bookingsGrouped,
      page,
      totalPages,
      limit,
      filterType
    });

  } catch (err) {
    console.error("Error fetching user bookings:", err);
    // Fallback rendering
    res.render('viewbookings', {
      bookingsGrouped: { plot: [], memorial: [], burial: [] },
      page: 1,
      totalPages: 1,
      limit: 10,
      filterType: ''
    });
  }
});

module.exports = router;
