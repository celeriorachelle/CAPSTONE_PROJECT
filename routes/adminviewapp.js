// routes/adminviewapp.js
const express = require('express');
const router = express.Router();
const db = require('../db'); // your DB connection

// GET /adminviewapp
router.get('/', async (req, res) => {
  try {
    const [bookings] = await db.query(`
    SELECT 
      booking_id AS id,
      CONCAT(firstname, ' ', lastname) AS clientName,
      booking_date AS date,
      visit_time AS time,
      service_type AS service,
      status,
      notes,
      phone,
      email,
      generated_at AS createdAt
    FROM booking_tbl
    ORDER BY booking_date DESC
  `);


    // Pass mapped bookings to your EJS
    res.render('adminviewapp', { appointments: bookings });

  } catch (err) {
    console.error(err);
    // If error, send empty array so front-end doesn't break
    res.render('adminviewapp', { appointments: [] });
  }
});

// POST /adminviewapp/approve/:id
router.post('/approve/:id', async (req, res) => {
  const bookingId = req.params.id;

  try {
    // Update booking status only
    await db.query(
      `UPDATE booking_tbl SET status = 'approved' WHERE booking_id = ?`,
      [bookingId]
    );

    // Fetch user info for notification
    const [booking] = await db.query(
      `SELECT user_id, service_type, booking_date 
       FROM booking_tbl WHERE booking_id = ?`,
      [bookingId]
    );

    if (booking[0]) {
      const userId = booking[0].user_id;
      const service = booking[0].service_type;
      const date = new Date(booking[0].booking_date).toLocaleDateString();

      const message = `Your ${service} booking on ${date} has been approved. Please visit the cemetery office.`;

      await db.query(
        `INSERT INTO notification_tbl (user_id, booking_id, message, is_read, datestamp) 
         VALUES (?, ?, ?, 0, NOW())`,
        [userId, bookingId, message]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to approve booking' });
  }
});


// POST /adminviewapp/reject/:id
router.post('/reject/:id', async (req, res) => {
  const bookingId = req.params.id;

  try {
    await db.query(
      `UPDATE booking_tbl SET status = 'cancelled' WHERE booking_id = ?`,
      [bookingId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to reject booking' });
  }
});
module.exports = router;
