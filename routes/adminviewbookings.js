const express = require('express');
const router = express.Router();
const db = require('../db');
const { addLog } = require('./log_helper');
const nodemailer = require('nodemailer');
require('dotenv').config();

// ---------------------------
// Middleware for admin-only access
// ---------------------------
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  next();
}

// ================================
// Nodemailer setup
// ================================
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'rheachellegutierrez17@gmail.com', // replace with your email
    pass: 'cpflmrprhngxnsxo' // Gmail App Password (not your real password)
  }
});

// ---------------------------
// GET /adminviewbookings
// ---------------------------
router.get('/', requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        b.booking_id AS id,
        COALESCE(u.firstName, b.firstname) AS firstName,
        COALESCE(u.lastName, b.lastname) AS lastName,
        COALESCE(u.email, b.email) AS email,
        COALESCE(u.contact_number, b.phone) AS phone,
        b.service_type AS service,
        b.booking_date AS bookingDate,
        b.status AS bookingStatus,
        p.payment_type AS paymentType,
        p.status AS paymentStatus,
        p.amount,
        p.due_date AS dueDate,
        pm.plot_number AS plotNumber,
        pm.location,
        pm.type AS plotType,
        b.user_id
      FROM booking_tbl b
      LEFT JOIN user_tbl u ON b.user_id = u.user_id
      LEFT JOIN payment_tbl p ON b.booking_id = p.booking_id
      LEFT JOIN plot_map_tbl pm ON b.plot_id = pm.plot_id
      ORDER BY b.booking_id DESC
    `);

    res.render('adminviewbookings', { bookings: rows });
  } catch (err) {
    console.error('❌ Error fetching bookings:', err);
    res.status(500).send('Error loading bookings');
  }
});

// ---------------------------
// POST /adminviewbookings/send-reminder/:id
// ---------------------------
router.post('/send-reminder/:id', requireAdmin, async (req, res) => {
  try {
    const bookingId = req.params.id;
    const { message } = req.body;

    const [rows] = await db.query(`
      SELECT
        COALESCE(u.email, b.email) AS email,
        COALESCE(u.firstName, b.firstname) AS firstName,
        COALESCE(u.lastName, b.lastname) AS lastName,
        b.user_id
      FROM booking_tbl b
      LEFT JOIN user_tbl u ON b.user_id = u.user_id
      WHERE b.booking_id = ?
    `, [bookingId]);

    if (rows.length === 0) {
      return res.json({ success: false, message: 'Booking not found' });
    }

    const client = rows[0];

    await transporter.sendMail({
      from: `"Everlasting Peace Memorial Park" <${process.env.EMAIL_USER}>`,
      to: client.email,
      subject: "Reminder from Everlasting Peace Memorial Park",
      text: message || `Dear ${client.firstName}, this is a friendly reminder from Everlasting Peace Memorial Park.`
    });

    if (client.user_id) {
      await db.query(`
        INSERT INTO notification_tbl (user_id, booking_id, message)
        VALUES (?, ?, ?)
      `, [client.user_id, bookingId, message || `Dear ${client.firstName}, this is a friendly reminder regarding your booking.`]);
    }

    await addLog(req.session.user.user_id, `Sent reminder email and notification to ${client.email} for booking #${bookingId}`);

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error sending reminder:', err);
    res.json({ success: false, message: 'Failed to send email.' });
  }
});

// ---------------------------
// POST /adminviewbookings/send-auto-reminder/:id
// ---------------------------
router.post('/send-auto-reminder/:id', requireAdmin, async (req, res) => {
  try {
    const bookingId = req.params.id;

    const [rows] = await db.query(`
      SELECT 
        COALESCE(u.email, b.email) AS email,
        COALESCE(u.firstName, b.firstname) AS firstName,
        COALESCE(u.lastName, b.lastname) AS lastName,
        p.due_date,
        b.user_id
      FROM booking_tbl b
      LEFT JOIN user_tbl u ON b.user_id = u.user_id
      LEFT JOIN payment_tbl p ON b.booking_id = p.booking_id
      WHERE b.booking_id = ?
    `, [bookingId]);

    if (rows.length === 0) {
      return res.json({ success: false, message: 'Booking not found' });
    }

    const client = rows[0];
    const dueDate = client.due_date ? new Date(client.due_date).toLocaleDateString() : 'Unknown';
    const message = `Dear ${client.firstName} ${client.lastName},\n\nThis is an reminder that your payment for your booking is due on ${dueDate}. Please make sure to complete your payment before the due date.\n\nJust Log in to our website and go to Payment History then click the "Pay Here" button to pay your due amount.\n\nThank you,\nEverlasting Peace Memorial Park.`;

    await transporter.sendMail({
      from: `"Everlasting Peace Memorial Park" <${process.env.EMAIL_USER}>`,
      to: client.email,
      subject: "Payment Due Reminder",
      text: message
    });

    if (client.user_id) {
      await db.query(`
        INSERT INTO notification_tbl (user_id, booking_id, message)
        VALUES (?, ?, ?)
      `, [client.user_id, bookingId, message]);
    }

    await addLog(req.session.user.user_id, `Sent automatic due date reminder to ${client.email} for booking #${bookingId}`);

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Error sending automatic reminder:', err);
    res.json({ success: false, message: 'Failed to send automatic reminder.' });
  }
});

module.exports = router;
