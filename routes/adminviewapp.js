const express = require('express');
const router = express.Router();
const db = require('../db'); // your db connection (mysql2/promise)
const nodemailer = require('nodemailer');
const { addLog } = require('./log_helper'); // <-- Import the log helper

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

// ================================
// Middleware: Require Admin Login
// ================================
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  next();
}

// ================================
// GET /adminviewapp - View all bookings
// ================================
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

// ================================
// POST /adminviewapp/approve/:id - Approve a booking
// ================================
router.post('/approve/:id', requireAdmin, async (req, res) => {
  const bookingId = req.params.id;
  const adminUser = req.session.user; // admin info for logging
  try {
    // 1️⃣ Update booking status
    await db.query(`UPDATE booking_tbl SET status = 'approved' WHERE booking_id = ?`, [bookingId]);

    // 2️⃣ Update plot availability if linked
    const [plotRes] = await db.query(`SELECT plot_id FROM booking_tbl WHERE booking_id = ?`, [bookingId]);
    if (plotRes[0] && plotRes[0].plot_id) {
      await db.query(`UPDATE plot_map_tbl SET availability = 'occupied' WHERE plot_id = ?`, [plotRes[0].plot_id]);
    }

    // 3️⃣ Fetch booking details for notification/email
    const [bookingRows] = await db.query(`
      SELECT user_id, firstname, lastname, email, service_type, booking_date, visit_time, plot_id
      FROM booking_tbl WHERE booking_id = ?
    `, [bookingId]);

    if (bookingRows.length > 0) {
      const bk = bookingRows[0];
      const userId = bk.user_id;
      const clientName = `${bk.firstname} ${bk.lastname}`;
      const email = bk.email;
      const service = bk.service_type || 'appointment';
      const date = bk.booking_date ? new Date(bk.booking_date).toLocaleDateString() : '';
      const time = bk.visit_time || '';

      const message = `Your ${service} booking on ${date} at ${time} has been approved. Please come at the scheduled time.`;

      // 4️⃣ Insert into notifications table
      await db.query(`
        INSERT INTO notification_tbl (user_id, booking_id, message, is_read, datestamp, plot_id)
        VALUES (?, ?, ?, 0, NOW(), ?)
      `, [userId, bookingId, message, bk.plot_id || null]);

      // 5️⃣ Send email notification (optional)
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

      // ✅ Log the admin action with client name
      await addLog({
        user_id: adminUser.user_id,
        user_role: adminUser.role,
        action: 'Approved booking',
        details: `Booking ID ${bookingId} approved by admin (Client: ${clientName})`
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error approving booking:', err);
    res.status(500).json({ success: false, error: 'Failed to approve booking' });
  }
});

// ================================
// POST /adminviewapp/reject/:id - Reject a booking
// ================================
router.post('/reject/:id', requireAdmin, async (req, res) => {
  const bookingId = req.params.id;
  const adminUser = req.session.user; // admin info for logging
  try {
    // 1️⃣ Update booking status
    await db.query(`UPDATE booking_tbl SET status = 'cancelled' WHERE booking_id = ?`, [bookingId]);

    // 2️⃣ Fetch booking details for notification/email
    const [bookingRows] = await db.query(`
      SELECT user_id, firstname, lastname, email, service_type, booking_date, visit_time, plot_id
      FROM booking_tbl WHERE booking_id = ?
    `, [bookingId]);

    if (bookingRows.length > 0) {
      const bk = bookingRows[0];
      const userId = bk.user_id;
      const clientName = `${bk.firstname} ${bk.lastname}`;
      const email = bk.email;
      const service = bk.service_type || 'appointment';
      const date = bk.booking_date ? new Date(bk.booking_date).toLocaleDateString() : '';
      const time = bk.visit_time || '';

      const message = `We're sorry — your ${service} booking on ${date} at ${time} has been declined/cancelled. Please contact the office for assistance.`;

      // 3️⃣ Insert into notifications table
      await db.query(`
        INSERT INTO notification_tbl (user_id, booking_id, message, is_read, datestamp, plot_id)
        VALUES (?, ?, ?, 0, NOW(), ?)
      `, [userId, bookingId, message, bk.plot_id || null]);

      // 4️⃣ Optionally free up the plot (set back to 'available')
      if (bk.plot_id) {
        await db.query(`UPDATE plot_map_tbl SET availability = 'available' WHERE plot_id = ?`, [bk.plot_id]);
      }

      // 5️⃣ Send rejection email
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

      // ✅ Log the admin action with client name
      await addLog({
        user_id: adminUser.user_id,
        user_role: adminUser.role,
        action: 'Rejected booking',
        details: `Admin ${adminUser.firstname} ${adminUser.lastname} rejected booking ID ${bookingId} for client ${clientName}`
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error rejecting booking:', err);
    res.status(500).json({ success: false, error: 'Failed to reject booking' });
  }
});

// ================================
// POST /adminviewapp/notify/:id - Manual notification
// ================================
router.post('/notify/:id', requireAdmin, async (req, res) => {
  const bookingId = req.params.id;
  const { message } = req.body || {};
  const adminUser = req.session.user; // admin info for logging

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
    const clientName = `${bk.firstname} ${bk.lastname}`;
    const email = bk.email;

    // Insert notification
    await db.query(`
      INSERT INTO notification_tbl (user_id, booking_id, message, is_read, datestamp, plot_id)
      VALUES (?, ?, ?, 0, NOW(), ?)
    `, [userId, bookingId, message, bk.plot_id || null]);

    // Optional: send email
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

    // ✅ Log the admin action with client name
    await addLog({
      user_id: adminUser.user_id,
      user_role: adminUser.role,
      action: 'Sent notification',
      details: `Admin sent notification for booking ID ${bookingId} to client ${clientName}: "${message}"`
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Error sending admin notification:', err);
    res.status(500).json({ success: false, error: 'Failed to send notification' });
  }
});

module.exports = router;
