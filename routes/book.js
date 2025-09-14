const express = require('express');
const router = express.Router();
const db = require('../db'); // DB connection

// Middleware to require login
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

// GET /book → Booking Form
router.get('/', requireLogin, (req, res) => {
  res.render('book', { title: 'Booking Form' });
});

router.post('/', requireLogin, async (req, res) => {
  const bookingData = {
    firstname: req.body.firstname,
    lastname: req.body.lastname,
    email: req.body.email,
    phone: req.body.phone,
    visitTime: req.body.visitTime,
    bookingDate: req.body.bookingDate,
    serviceType: req.body.serviceType,
    notes: req.body.notes || null
  };

  const userId = req.session.user.user_id;

  try {
    // Check if booking already exists for this user/date/service
    const [existing] = await db.query(
      'SELECT * FROM booking_tbl WHERE user_id = ? AND booking_date = ? AND service_type = ?',
      [userId, bookingData.bookingDate, bookingData.serviceType]
    );

    if (existing.length > 0) {
      return res.send('You already have a booking for this date/service.');
    }

    // Store booking data in session only
    req.session.bookingData = bookingData;

    // Redirect to plot selection if required
    if (bookingData.serviceType === 'plot-booking') {
      return res.redirect('/bookplots');
    }

    // For other services, insert booking directly
      const [result] = await db.query(
        `INSERT INTO booking_tbl
          (user_id, firstname, lastname, email, phone, booking_date, visit_time, service_type, notes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          userId,
          bookingData.firstname,
          bookingData.lastname,
          bookingData.email,
          bookingData.phone,
          bookingData.bookingDate,
          bookingData.visitTime,
          bookingData.serviceType,
          bookingData.notes
        ]
      );

    res.redirect('/dashboard');

  } catch (err) {
    console.error('Error saving booking:', err);
    res.send('Failed to create booking');
  }
});


// Fetch notifications as JSON for frontend
router.get('/json', requireLogin, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM notification_tbl WHERE user_id = ? ORDER BY datestamp DESC',
      [req.session.user.user_id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching notifications:', err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});


module.exports = router;
