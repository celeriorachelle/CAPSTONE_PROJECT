const express = require('express');
const router = express.Router();
const db = require('../db');
const { addLog } = require('./log_helper');

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  next();
}

router.get('/', requireAdmin, (req, res) => {
  res.render('admincreateb'); 
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

    // Insert booking as approved (admin-created)
    const [result] = await db.query(
      `INSERT INTO booking_tbl (user_id, firstname, lastname, email, phone, booking_date, service_type, notes, plot_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'approved')`,
      [userId, firstname, lastname, email || null, phone, bookingDate, service, notes || null]
    );

    const bookingId = result.insertId;

    // Create notification for the user if we can associate one
    try {
      await db.query(
        `INSERT INTO notification_tbl (user_id, booking_id, message, is_read, datestamp, plot_id)
         VALUES (?, ?, ?, 0, NOW(), NULL)`,
        [userId, bookingId, 'Your appointment has been created by an administrator.']
      );
    } catch (e) {
      console.warn('admincreateb: could not create notification', e);
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

    // Render the page with success message
    res.render('admincreateb', { success: true, bookingId });
  } catch (err) {
    console.error('Error creating admin appointment:', err);
    res.status(500).render('admincreateb', { error: 'Server error creating appointment.' });
  }
});

module.exports = router;

