var express = require('express');
var router = express.Router();
var db = require('../db');

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

router.get('/', requireLogin, async (req, res) => {
  const userId = req.session.user.user_id;
  const page = parseInt(req.query.page) || 1;              // current page
  const limit = parseInt(req.query.limit) || 10;           // rows per page
  const offset = (page - 1) * limit;

  try {
    // Paginated bookings
    const [bookings] = await db.query(
      `SELECT b.*, p.type AS plot_type, p.plot_number, p.location
       FROM booking_tbl b
       LEFT JOIN plot_map_tbl p ON b.plot_id = p.plot_id
       WHERE b.user_id = ?
       ORDER BY b.booking_date DESC
       LIMIT ? OFFSET ?`,
      [userId, limit, offset]
    );

    // Total count for pagination
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM booking_tbl WHERE user_id = ?`,
      [userId]
    );

    const totalPages = Math.ceil(total / limit);

    res.render('viewbooking', { bookings, page, totalPages, limit });
  } catch (err) {
    console.error(err);
    res.render('viewbooking', { bookings: [], page: 1, totalPages: 1, limit: 10 });
  }
});

module.exports = router;
