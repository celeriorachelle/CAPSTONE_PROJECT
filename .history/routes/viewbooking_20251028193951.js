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
  const page = parseInt(req.query.page) || 1;      // current page
  const limit = parseInt(req.query.limit) || 10;   // rows per page
  const offset = (page - 1) * limit;
  const filterType = req.query.type || '';         // booking type filter

  try {
    // Base query - include latest payment row per booking so front-end can show
    // payment method/type without additional queries.
    let bookingsQuery = `
      SELECT b.*, p.type AS plot_type, p.plot_number, p.location,
             lp.method AS payment_method, lp.payment_type AS payment_type, lp.total_paid
      FROM booking_tbl b
      LEFT JOIN plot_map_tbl p ON b.plot_id = p.plot_id
      LEFT JOIN (
        SELECT p1.* FROM payment_tbl p1
        WHERE p1.payment_id IN (
          SELECT MAX(p2.payment_id) FROM payment_tbl p2 GROUP BY p2.booking_id
        )
      ) lp ON b.booking_id = lp.booking_id
      WHERE b.user_id = ?
    `;

    const queryParams = [userId];

    // Apply filter if type is selected
    if (filterType) {
      bookingsQuery += ' AND b.service_type = ?';
      queryParams.push(filterType);
    }

    bookingsQuery += ' ORDER BY b.booking_date DESC LIMIT ? OFFSET ?';
    queryParams.push(limit, offset);

    // Fetch bookings
    const [bookings] = await db.query(bookingsQuery, queryParams);

    // Group bookings by type
    const bookingsGrouped = {
      'plot-booking': [],
      'memorial': [],
      'burial': []
    };
    bookings.forEach(b => {
      if (bookingsGrouped[b.service_type]) {
        bookingsGrouped[b.service_type].push(b);
      }
    });

    // Total count for pagination
    let totalQuery = 'SELECT COUNT(*) AS total FROM booking_tbl WHERE user_id = ?';
    const totalParams = [userId];
    if (filterType) {
      totalQuery += ' AND service_type = ?';
      totalParams.push(filterType);
    }

    const [[{ total }]] = await db.query(totalQuery, totalParams);
    const totalPages = Math.ceil(total / limit);

    // Render the page
    res.render('viewbooking', {
      bookingsGrouped,
      page,
      totalPages,
      limit,
      filterType
    });

  } catch (err) {
    console.error(err);
    // Render fallback in case of error
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
