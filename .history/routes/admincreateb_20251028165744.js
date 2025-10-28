const express = require('express');
const router = express.Router();
const db = require('../db');
const { addLog } = require('./log_helper');
const nodemailer = require('nodemailer');

// Configure transporter (uses env vars EMAIL_USER and EMAIL_PASS)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  next();
}

router.get('/', requireAdmin, async (req, res) => {
  try {
    // Provide a plot selector for admin to optionally link a booking to a plot
    const [plots] = await db.query(
      `SELECT plot_id, plot_number, location, price, availability FROM plot_map_tbl WHERE availability != 'occupied' ORDER BY location, plot_number`);
    res.render('admincreateb', { plots });
  } catch (err) {
    console.error('admincreateb GET error fetching plots:', err);
    res.render('admincreateb', { plots: [] });
  }
});

// Handle admin-created appointment submissions
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { fullname, phone, email, service, date, time, notes } = req.body || {};

    if (!fullname || !phone || !service || !date || !time) {
      return res.status(400).render('admincreateb', { error: 'Please fill required fields.' });
    }

    // Split fullname into firstname / lastname
    const parts = String(fullname).trim().split(/\s+/);
    const firstname = parts.shift() || '';
    const lastname = parts.join(' ') || '';

    // Combine date and time into a single datetime string if possible
    let bookingDate = null;
    try {
      // Expecting date like YYYY-MM-DD and time like HH:MM
      bookingDate = new Date(`${date}T${time}:00`);
      // Format to MySQL DATETIME 'YYYY-MM-DD HH:MM:SS'
      const pad = (n) => String(n).padStart(2, '0');
      const y = bookingDate.getFullYear();
      const m = pad(bookingDate.getMonth() + 1);
      const d = pad(bookingDate.getDate());
      const hh = pad(bookingDate.getHours());
      const mm = pad(bookingDate.getMinutes());
      const ss = pad(bookingDate.getSeconds());
      bookingDate = `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
    } catch (e) {
      bookingDate = date; // fallback
    }

    // Try to resolve a user by email so we can link the booking
    let userId = null;
    if (email) {
      try {
        const [uRows] = await db.query('SELECT user_id FROM user_tbl WHERE email = ? LIMIT 1', [email]);
        if (Array.isArray(uRows) && uRows.length > 0) userId = uRows[0].user_id;
      } catch (e) {
        console.warn('admincreateb: failed to lookup user by email', e);
      }
    }

    // Validate plot_id if provided
    let plotId = null;
    if (req.body.plot_id) {
      const pid = Number(req.body.plot_id);
      if (!Number.isNaN(pid)) {
        // verify exists and not occupied
        const [pRows] = await db.query('SELECT plot_id, availability FROM plot_map_tbl WHERE plot_id = ? LIMIT 1', [pid]);
        if (pRows.length && pRows[0].availability !== 'occupied') {
          plotId = pid;
        } else {
          return res.status(400).render('admincreateb', { error: 'Selected plot is not available.', plots: [] });
        }
      }
    }

    // Insert booking as approved (admin-created)
    const [result] = await db.query(
      `INSERT INTO booking_tbl (user_id, firstname, lastname, email, phone, booking_date, service_type, notes, plot_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
      [userId, firstname, lastname, email || null, phone, bookingDate, service, notes || null, plotId]
    );

    const bookingId = result.insertId;

    // Create notification for the user if we can associate one
    try {
      await db.query(
        `INSERT INTO notification_tbl (user_id, booking_id, message, is_read, datestamp, plot_id)
         VALUES (?, ?, ?, 0, NOW(), ?)`,
        [userId, bookingId, 'Your appointment has been created by an administrator.', plotId]
      );
    } catch (e) {
      console.warn('admincreateb: could not create notification', e);
    }

    // Send email notification if email is available (best-effort)
    if (email && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      try {
        const mailOptions = {
          from: `Everlasting Cemetery <${process.env.EMAIL_USER}>`,
          to: email,
          subject: 'Your appointment has been scheduled',
          html: `<p>Dear ${firstname},</p>
                 <p>An appointment has been scheduled for you by an administrator.</p>
                 <p><strong>Service:</strong> ${service}</p>
                 <p><strong>Date & Time:</strong> ${bookingDate}</p>
                 <p>Booking ID: ${bookingId}</p>
                 <p>If you have questions, please contact support.</p>`
        };
        await transporter.sendMail(mailOptions);
      } catch (mailErr) {
        console.warn('admincreateb: failed to send email notification', mailErr);
      }
    }

    // Add an audit log
    try {
      await addLog({
        user_id: req.session.user.user_id,
        user_role: req.session.user.role,
        action: 'Admin created appointment',
        details: `Admin ${req.session.user.fullname || req.session.user.user_id} created appointment (${service}) for ${firstname} ${lastname} (booking_id=${bookingId})`
      });
    } catch (e) {
      console.warn('admincreateb: failed to write log', e);
    }

    // Redirect admin to the bookings list
    return res.redirect('/adminviewbookings');
  } catch (err) {
    console.error('Error creating admin appointment:', err);
    res.status(500).render('admincreateb', { error: 'Server error creating appointment.', plots: [] });
  }
});

module.exports = router;

