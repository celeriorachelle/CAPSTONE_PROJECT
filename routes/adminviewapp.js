
// routes/adminviewapp.js
const express = require('express');
const router = express.Router();
const db = require('../db'); // your db connection (mysql2/promise)
const nodemailer = require('nodemailer');

// Make sure express app uses `app.use(express.json())` and `app.use(express.urlencoded({ extended: true }))`

// Nodemailer transporter (use your credentials or move to .env)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'rheachellegutierrez17@gmail.com', // replace if needed
    pass: 'cpflmrprhngxnsxo' // use App Password or env var
  }
});

// Middleware to require admin login
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  next();
}

// GET /adminviewapp
router.get('/', requireAdmin, async (req, res) => {
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

    res.render('adminviewapp', { appointments: bookings });
  } catch (err) {
    console.error('Error fetching bookings:', err);
    res.render('adminviewapp', { appointments: [] });
  }
});

// POST /adminviewapp/approve/:id
router.post('/approve/:id', requireAdmin, async (req, res) => {
  const bookingId = req.params.id;
  try {
    // Update booking status
    await db.query(`UPDATE booking_tbl SET status = 'approved' WHERE booking_id = ?`, [bookingId]);

    // update plot status if exists
    const [plotRes] = await db.query(`SELECT plot_id FROM booking_tbl WHERE booking_id = ?`, [bookingId]);
    if (plotRes[0] && plotRes[0].plot_id) {
      await db.query(`UPDATE plot_map_tbl SET status = 'occupied' WHERE plot_id = ?`, [plotRes[0].plot_id]);
    }

    // fetch booking details to notify user
    const [bookingRows] = await db.query(`
      SELECT user_id, firstname, lastname, email, service_type, booking_date, visit_time, plot_id
      FROM booking_tbl WHERE booking_id = ?
    `, [bookingId]);

    if (bookingRows.length > 0) {
      const bk = bookingRows[0];
      const userId = bk.user_id;
      const email = bk.email;
      const service = bk.service_type || 'appointment';
      const date = bk.booking_date ? new Date(bk.booking_date).toLocaleDateString() : '';
      const time = bk.visit_time || '';

      const message = `Your ${service} booking on ${date} at ${time} has been approved. Please come at the scheduled time.`;

      // insert notification
      await db.query(`
        INSERT INTO notification_tbl (user_id, booking_id, message, is_read, datestamp, plot_id)
        VALUES (?, ?, ?, 0, NOW(), ?)
      `, [userId, bookingId, message, bk.plot_id || null]);

      // optional: send email if present
      if (email) {
        try {
          await transporter.sendMail({
            from: '"Everlasting Peace Memorial Park" <rheachellegutierrez17@gmail.com>',
            to: email,
            subject: 'Your booking has been approved',
            text: message
          });
        } catch (mailErr) {
          console.error('Error sending approval email:', mailErr);
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error approving booking:', err);
    res.status(500).json({ success: false, error: 'Failed to approve booking' });
  }
});

// POST /adminviewapp/reject/:id
router.post('/reject/:id', requireAdmin, async (req, res) => {
  const bookingId = req.params.id;
  try {
    // Update status
    await db.query(`UPDATE booking_tbl SET status = 'cancelled' WHERE booking_id = ?`, [bookingId]);

    // fetch booking details for notification
    const [bookingRows] = await db.query(`
      SELECT user_id, firstname, lastname, email, service_type, booking_date, visit_time
      FROM booking_tbl WHERE booking_id = ?
    `, [bookingId]);

    if (bookingRows.length > 0) {
      const bk = bookingRows[0];
      const userId = bk.user_id;
      const email = bk.email;
      const service = bk.service_type || 'appointment';
      const date = bk.booking_date ? new Date(bk.booking_date).toLocaleDateString() : '';
      const time = bk.visit_time || '';

      const message = `We're sorry — your ${service} booking on ${date} at ${time} has been declined/cancelled. Please contact the office for assistance.`;

      await db.query(`
        INSERT INTO notification_tbl (user_id, booking_id, message, is_read, datestamp)
        VALUES (?, ?, ?, 0, NOW())
      `, [userId, bookingId, message]);

      if (email) {
        try {
          await transporter.sendMail({
            from: '"Everlasting Peace Memorial Park" <rheachellegutierrez17@gmail.com>',
            to: email,
            subject: 'Your booking was declined',
            text: message
          });
        } catch (mailErr) {
          console.error('Error sending rejection email:', mailErr);
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error rejecting booking:', err);
    res.status(500).json({ success: false, error: 'Failed to reject booking' });
  }
});

// POST /adminviewapp/notify/:id  -> admin manual notify (custom message)
router.post('/notify/:id', requireAdmin, async (req, res) => {
  const bookingId = req.params.id;
  const { message } = req.body || {};
  if (!message || !message.trim()) {
    return res.status(400).json({ success: false, error: 'Message required' });
  }

  try {
    const [bookingRows] = await db.query(`
      SELECT user_id, firstname, lastname, email, booking_date, visit_time, plot_id
      FROM booking_tbl WHERE booking_id = ?
    `, [bookingId]);

    if (bookingRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    const bk = bookingRows[0];
    const userId = bk.user_id;
    const email = bk.email;

    // Save to notifications
    await db.query(`
      INSERT INTO notification_tbl (user_id, booking_id, message, is_read, datestamp, plot_id)
      VALUES (?, ?, ?, 0, NOW(), ?)
    `, [userId, bookingId, message, bk.plot_id || null]);

    // optional: send email
    if (email) {
      try {
        await transporter.sendMail({
          from: '"Everlasting Peace Memorial Park" <rheachellegutierrez17@gmail.com>',
          to: email,
          subject: 'Notification from Everlasting Peace Memorial Park',
          text: message
        });
      } catch (mailErr) {
        console.error('Error sending notify email:', mailErr);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error sending admin notification:', err);
    res.status(500).json({ success: false, error: 'Failed to send notification' });
  }
});

module.exports = router;

