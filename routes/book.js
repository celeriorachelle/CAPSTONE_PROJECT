// 📂 routes/book.js
const express = require('express');
const router = express.Router();
const db = require('../db'); // DB connection
const { addLog } = require('./log_helper'); // ✅ Integrated from ver2: Logging helper

// ✅ Middleware to require login
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

// ✅ GET /book → Booking Form
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

// Render booking form for a given plot id
router.get('/:plotId(\\d+)', requireLogin, async (req, res) => {
  const plotId = req.params.plotId;
  try {
    const [rows] = await db.query('SELECT * FROM plot_map_tbl WHERE plot_id = ?', [plotId]);
    if (!rows.length) return res.status(404).send('Plot not found');
    const plot = rows[0];
    res.render('book', { plot, user: req.session.user });
  } catch (err) {
    console.error('Error loading booking form:', err);
    res.status(500).send('Server error');
  }
});

// ✅ POST /book → Submit booking
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

    // Plot Booking: store data in session, do not insert yet
    if (bookingData.serviceType === 'plot-booking') {
      req.session.bookingData = bookingData;
      return res.redirect('/bookplots');
    }

    // Burial: verify ownership and redirect to deceased details form
    if (bookingData.serviceType === 'burial') {
      const [ownedPlots] = await db.query(
        `SELECT plot_id FROM plot_map_tbl WHERE user_id = ? LIMIT 1`,
        [userId]
      );

      if (!ownedPlots || ownedPlots.length === 0) {
        return res.redirect('/userdashboard?alert=' + encodeURIComponent("It seems that you currently don't have any plot yet, book a plot first."));
      }

      req.session.burialBookingData = bookingData;
      req.session.burialPlotId = ownedPlots[0].plot_id;

      return res.redirect('/book/burial-details');
    }

    // ✅ Insert booking for Memorial
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
    const bookingId = result.insertId;

    // ✅ Create notification for successful booking
    await db.query(
      `INSERT INTO notification_tbl (user_id, booking_id, message, is_read, datestamp, plot_id)
       VALUES (?, ?, ?, 0, NOW(), NULL)`,
      [userId, bookingId, 'Your booking has been submitted and is pending approval.']
    );

    // ✅ Log the booking (Memorial)
    await addLog({
      user_id: userId,
      user_role: req.session.user.role,
      action: 'Booking',
      details: `${req.session.user.role} ${req.session.user.name} booked a ${bookingData.serviceType} on ${bookingData.bookingDate}.`
    });

    // Fetch updated bookings list
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

// Handle booking form submission - store bookingData in session and redirect to payment option page
router.post('/submit', requireLogin, async (req, res) => {
  try {
    const bookingData = {
      firstname: req.body.firstname,
      lastname: req.body.lastname,
      email: req.body.email,
      phone: req.body.phone,
      bookingDate: req.body.bookingDate,
      serviceType: req.body.serviceType || 'plot_booking',
      notes: req.body.notes || ''
    };
    // plotId should be submitted as hidden field
    const plotId = req.body.plot_id;
    if (!plotId) return res.status(400).send('Missing plot id');

    // store bookingData and selected plot id in session then redirect to payment option
    req.session.bookingData = bookingData;
    // Keep selectedPlot minimal so bookplots.option can fetch full record
    req.session.selectedPlot = { plot_id: plotId };

    res.redirect(`/bookplots/option/${plotId}`);
  } catch (err) {
    console.error('Error submitting booking form:', err);
    res.status(500).send('Failed to submit booking');
  }
});

// ✅ Burial details routes
router.get('/burial-details', requireLogin, async (req, res) => {
  const bookingData = req.session.burialBookingData;
  if (!bookingData) return res.redirect('/book');
  res.render('burial_details', {
    title: 'Burial Details',
    bookingData
  });
});

router.post('/burial-details', requireLogin, async (req, res) => {
  const userId = req.session.user.user_id;
  const { deceased_firstName, deceased_lastName, birth_date, death_date } = req.body;

  const bookingData = req.session.burialBookingData;
  let plotId = req.session.burialPlotId;

  if (!bookingData) {
    return res.redirect('/book');
  }

  if (!deceased_firstName || !deceased_lastName || !birth_date || !death_date) {
    return res.render('burial_details', {
      title: 'Burial Details',
      bookingData,
      error: 'All deceased information fields are required.'
    });
  }

  try {
    if (!plotId) {
      const [owned] = await db.query(`SELECT plot_id FROM plot_map_tbl WHERE user_id = ? LIMIT 1`, [userId]);
      if (!owned || owned.length === 0) {
        return res.redirect('/userdashboard?alert=' + encodeURIComponent("It seems that you currently don't have any plot yet, book a plot first."));
      }
      plotId = owned[0].plot_id;
    }

    // Update plot with deceased info
    await db.query(
      `UPDATE plot_map_tbl
       SET deceased_firstName = ?, deceased_lastName = ?, birth_date = ?, death_date = ?
       WHERE plot_id = ? AND user_id = ?`,
      [deceased_firstName, deceased_lastName, birth_date, death_date, plotId, userId]
    );

    // Insert burial booking
    const [result] = await db.query(
      `INSERT INTO booking_tbl
       (user_id, firstname, lastname, email, phone, booking_date, visit_time, service_type, notes, plot_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'burial', ?, ?, 'pending')`,
      [
        userId,
        bookingData.firstname,
        bookingData.lastname,
        bookingData.email,
        bookingData.phone,
        bookingData.bookingDate,
        bookingData.visitTime,
        bookingData.notes,
        plotId
      ]
    );
    const bookingId = result.insertId;

    // ✅ Create notification for burial booking
    await db.query(
      `INSERT INTO notification_tbl (user_id, booking_id, message, is_read, datestamp, plot_id)
       VALUES (?, ?, ?, 0, NOW(), ?)`,
      [userId, bookingId, 'Your burial booking has been submitted and is pending approval.', plotId]
    );

    // ✅ Log the burial booking
    await addLog({
      user_id: userId,
      user_role: req.session.user.role,
      action: 'Booking',
      details: `${req.session.user.role} ${req.session.user.name} booked a burial for ${deceased_firstName} ${deceased_lastName}.`
    });

    // Clear session vars for burial flow
    req.session.burialBookingData = null;
    req.session.burialPlotId = null;

    // Fetch updated bookings list
    const [userBookings] = await db.query(
      `SELECT b.*, p.type AS plot_type, p.plot_number, p.location
       FROM booking_tbl b
       LEFT JOIN plot_map_tbl p ON b.plot_id = p.plot_id
       WHERE b.user_id = ?
       ORDER BY b.booking_date DESC`,
      [userId]
    );

    return res.render('book', {
      title: 'Booking Form',
      bookingData: null,
      success: 'Your burial booking and deceased details have been submitted.',
      bookings: userBookings
    });
  } catch (err) {
    console.error('Error saving burial details:', err);
    return res.render('burial_details', {
      title: 'Burial Details',
      bookingData,
      error: 'Failed to save burial details. Please try again.'
    });
  }
});

module.exports = router;

