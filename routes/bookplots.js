const express = require('express');
const router = express.Router();
const db = require('../db');

// Middleware to require login
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

// GET /bookplots → Show Plot Selection
router.get('/', requireLogin, async (req, res) => {
  if (!req.session.bookingData) return res.redirect('/book');

  try {
    const [plots] = await db.query(`
      SELECT plot_id, plot_number, location, status, type, price,
             deceased_firstName, deceased_lastName, birth_date, death_date
      FROM plot_map_tbl
      ORDER BY location, plot_number
    `);

    // Use status as-is from DB (assumes strings 'available', 'occupied', 'reserved')
    const transformedPlots = plots.map(plot => ({
      ...plot,
      status: plot.status.toLowerCase() // optional: normalize casing
    }));
    // Group plots by location
    const plotsByLocation = {};
    transformedPlots.forEach(plot => {
      if (!plotsByLocation[plot.location]) plotsByLocation[plot.location] = [];
      plotsByLocation[plot.location].push(plot);
    });

    res.render('bookplots', { 
      title: 'Book Plots',
      plots: transformedPlots,
      plotsByLocation
    });
  } catch (error) {
    console.error(error);
    res.render('bookplots', { plots: [], plotsByLocation: {} });
  }
});

router.post('/selectplot/:plotId', requireLogin, async (req, res) => {
  const plotId = req.params.plotId;
  const bookingData = req.session.bookingData;

  if (!bookingData) return res.status(400).send('No booking data in session');

  try {
    const notes = bookingData.notes || null;

    // Save booking as pending
    await db.query(
      `INSERT INTO booking_tbl
        (user_id, item_id, firstname, lastname, email, phone, visit_time, booking_date, service_type, notes, plot_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        req.session.user.user_id,
        null,
        bookingData.firstname,
        bookingData.lastname,
        bookingData.email,
        bookingData.phone,
        bookingData.visitTime,
        bookingData.bookingDate,
        bookingData.serviceType,
        notes,
        plotId
      ]
    );

    // Mark the plot as occupied
    await db.query(
      `UPDATE plot_map_tbl SET status = 'available' WHERE plot_id = ?`,
      [plotId]
    );

    // Save plotId in session for receipt
    req.session.bookingData.plotId = plotId;

    res.redirect('/bookplots/receipt');
  } catch (err) {
    console.error('Error saving booking:', err);
    res.status(500).send('Failed to save booking');
  }
});


// GET /bookplots/receipt → Show booking receipt (pending)
router.get('/receipt', requireLogin, async (req, res) => {
  const bookingData = req.session.bookingData;

  if (!bookingData || !bookingData.plotId) return res.redirect('/book');

  try {
    const [booking] = await db.query(
      `SELECT * FROM booking_tbl
       WHERE email = ? AND plot_id = ? AND status = 'pending'
       LIMIT 1`,
      [bookingData.email, bookingData.plotId]
    );

    if (!booking[0]) {
      return res.send('Your booking is either already approved by admin or does not exist.');
    }

    // Just show the booking; do NOT mark it as approved
    res.render('receipt', { booking: booking[0] });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to fetch booking receipt');
  }
});

module.exports = router;
