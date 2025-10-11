const express = require('express');
const router = express.Router();
const db = require('../db');
const { addLog } = require('./log_helper');

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

// GET /book
router.get('/', requireLogin, async (req, res) => {
  const userId = req.session.user.user_id;
  try {
    const [userBookings] = await db.query(
      `SELECT b.*, p.type AS plot_type, p.plot_number, p.location
       FROM booking_tbl b
       LEFT JOIN plot_map_tbl p ON b.plot_id = p.plot_id
       WHERE b.user_id = ?
       ORDER BY b.booking_date DESC`,
      [userId]
    );

    res.render('book', { title: 'Booking Form', bookingData: null, bookings: userBookings });
  } catch (err) {
    console.error('Error fetching bookings:', err);
    res.render('book', { title: 'Booking Form', bookingData: null, bookings: [] });
  }
});

// POST /book → Submit booking
router.post('/', requireLogin, async (req, res) => {
  const userId = req.session.user.user_id;
  const userRole = req.session.user.role;

  const bookingData = {
    firstname: req.body.firstname,
    lastname: req.body.lastname,
    email: req.body.email,
    phone: req.body.phone,
    serviceType: req.body.serviceType,
    visitTime: req.body.visitTime || null,
    bookingDate: req.body.bookingDate || null,
    notes: req.body.notes || null
  };

  const validServices = ['plot-booking', 'memorial', 'burial'];
  if (!validServices.includes(bookingData.serviceType)) {
    return res.render('book', { title: 'Booking Form', error: 'Please select a valid service type.', bookingData, bookings: [] });
  }

  if (!bookingData.bookingDate) {
    return res.render('book', { title: 'Booking Form', error: 'Please select a booking date.', bookingData, bookings: [] });
  }

  if ((bookingData.serviceType === 'memorial' || bookingData.serviceType === 'burial') && !bookingData.visitTime) {
    return res.render('book', { title: 'Booking Form', error: 'Please select a visit time.', bookingData, bookings: [] });
  }

  try {
    if (bookingData.serviceType === 'memorial' || bookingData.serviceType === 'burial') {
      const [existing] = await db.query(
        `SELECT * FROM booking_tbl WHERE booking_date = ? AND visit_time = ? AND service_type = ? AND status != 'cancelled'`,
        [bookingData.bookingDate, bookingData.visitTime, bookingData.serviceType]
      );
      if (existing.length > 0) {
        return res.render('book', { title: 'Booking Form', error: 'This time slot is already booked.', bookingData, bookings: [] });
      }
    }

    if (bookingData.serviceType === 'plot-booking') {
      req.session.bookingData = bookingData;

      // Log plot booking session start
      await addLog({
        user_id: userId,
        user_role: userRole,
        action: 'Start Plot Booking',
        details: `User started plot booking session for ${bookingData.firstname} ${bookingData.lastname}`
      });

      return res.redirect('/bookplots');
    }

    // Insert booking for Memorial/Burial
    const [result] = await db.query(
      `INSERT INTO booking_tbl (user_id, firstname, lastname, email, phone, booking_date, visit_time, service_type, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [userId, bookingData.firstname, bookingData.lastname, bookingData.email, bookingData.phone, bookingData.bookingDate, bookingData.visitTime, bookingData.serviceType, bookingData.notes]
    );
    const bookingId = result.insertId;

    // Create notification
    await db.query(
      `INSERT INTO notification_tbl (user_id, booking_id, message, is_read, datestamp, plot_id)
       VALUES (?, ?, ?, 0, NOW(), NULL)`,
      [userId, bookingId, 'Your booking has been submitted and is pending approval.']
    );

    // ✅ Log booking creation
    await addLog({
      user_id: userId,
      user_role: userRole,
      action: 'Create Booking',
      details: `Created ${bookingData.serviceType} booking for ${bookingData.firstname} ${bookingData.lastname}, Booking ID: ${bookingId}`
    });

    const [userBookings] = await db.query(
      `SELECT b.*, p.type AS plot_type, p.plot_number, p.location
       FROM booking_tbl b
       LEFT JOIN plot_map_tbl p ON b.plot_id = p.plot_id
       WHERE b.user_id = ?
       ORDER BY b.booking_date DESC`,
      [userId]
    );

    res.render('book', { title: 'Booking Form', bookingData: null, success: 'Your booking has been submitted and is pending approval.', bookings: userBookings });
  } catch (err) {
    console.error('Error saving booking:', err);
    res.render('book', { title: 'Booking Form', error: 'Failed to create booking. Please try again.', bookingData, bookings: [] });
  }
});

module.exports = router;
