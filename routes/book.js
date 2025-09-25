const express = require('express');
const router = express.Router();
const db = require('../db'); // DB connection

// Middleware to require login
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

// GET /book → Booking Form
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

    res.render('book', { 
      title: 'Booking Form', 
      bookingData: null,
      bookings: userBookings
    });
  } catch (err) {
    console.error('Error fetching bookings:', err);
    res.render('book', { 
      title: 'Booking Form', 
      bookingData: null,
      bookings: [] 
    });
  }
});

// POST /book → Submit booking
router.post('/', requireLogin, async (req, res) => {
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

  const userId = req.session.user.user_id;

  const validServices = ['plot-booking', 'memorial', 'burial'];
  if (!validServices.includes(bookingData.serviceType)) {
    return res.render('book', { 
      title: 'Booking Form', 
      error: 'Please select a valid service type.', 
      bookingData, 
      bookings: [] 
    });
  }

  // Validate booking date for all types
  if (!bookingData.bookingDate) {
    return res.render('book', {
      title: 'Booking Form',
      error: 'Please select a booking date.',
      bookingData,
      bookings: []
    });
  }

  // Validate visit time for Memorial/Burial
  if ((bookingData.serviceType === 'memorial' || bookingData.serviceType === 'burial') &&
      !bookingData.visitTime) {
    return res.render('book', {
      title: 'Booking Form',
      error: 'Please select a visit time for Memorial/Burial service.',
      bookingData,
      bookings: []
    });
  }

  try {
    // Double booking check only for Memorial/Burial
    if (bookingData.serviceType === 'memorial' || bookingData.serviceType === 'burial') {
      const [existing] = await db.query(
        `SELECT * FROM booking_tbl
         WHERE booking_date = ? AND visit_time = ? AND service_type = ? AND status != 'cancelled'`,
        [bookingData.bookingDate, bookingData.visitTime, bookingData.serviceType]
      );

      if (existing.length > 0) {
        return res.render('book', {
          title: 'Booking Form',
          error: 'This time slot is already booked. Please choose another schedule.',
          bookingData,
          bookings: []
        });
      }
    }

    // Plot Booking: store all data in session, do not insert yet
    if (bookingData.serviceType === 'plot-booking') {
      req.session.bookingData = bookingData;
      return res.redirect('/bookplots');
    }

    // Insert booking for Memorial/Burial
    await db.query(
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

    const [userBookings] = await db.query(
      `SELECT b.*, p.type AS plot_type, p.plot_number, p.location
       FROM booking_tbl b
       LEFT JOIN plot_map_tbl p ON b.plot_id = p.plot_id
       WHERE b.user_id = ?
       ORDER BY b.booking_date DESC`,
      [userId]
    );

    res.render('book', {
      title: 'Booking Form',
      bookingData: null,
      success: 'Your booking has been submitted and is pending approval.',
      bookings: userBookings
    });

  } catch (err) {
    console.error('Error saving booking:', err);
    res.render('book', {
      title: 'Booking Form',
      error: 'Failed to create booking. Please try again.',
      bookingData,
      bookings: []
    });
  }
});

module.exports = router;
