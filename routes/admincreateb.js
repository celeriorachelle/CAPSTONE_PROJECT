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
    const { firstName, lastName, phone, email, service, date, time, notes, plot_id, payment_method, payment_option, deceased_firstName, deceased_lastName, birth_date, death_date, months } = req.body || {};

    // Require time only for memorial and burial
    if (!firstName || !lastName || !phone || !service || !date || ((service === 'memorial' || service === 'burial') && !time)) {
      return res.status(400).render('admincreateb', { error: 'Please fill required fields.', plots: await (async () => { const [ps] = await db.query(`SELECT plot_id, plot_number, location, price, availability FROM plot_map_tbl WHERE availability != 'occupied' ORDER BY location, plot_number`); return ps; })(), form: req.body });
    }

    const firstname = firstName.trim();
    const lastname = lastName.trim();
    const bookingDate = date || null;
    const visitTime = time || null;
    let userId = null;
    if (email) {
      try {
        const [uRows] = await db.query('SELECT user_id FROM user_tbl WHERE email = ? LIMIT 1', [email]);
        if (Array.isArray(uRows) && uRows.length > 0) userId = uRows[0].user_id;
      } catch (e) { userId = null; }
    }

    // Get plot price if plot_id is provided
    let plotId = null, plotPrice = 0;
    if (plot_id) {
      const pid = Number(plot_id);
      if (!Number.isNaN(pid)) {
        const [pRows] = await db.query('SELECT plot_id, price, availability FROM plot_map_tbl WHERE plot_id = ? LIMIT 1', [pid]);
        if (pRows.length && pRows[0].availability !== 'occupied') {
          plotId = pid;
          plotPrice = Number(pRows[0].price) || 0;
        } else {
          return res.status(400).render('admincreateb', { error: 'Selected plot is not available.', plots: await (async () => { const [ps] = await db.query(`SELECT plot_id, plot_number, location, price, availability FROM plot_map_tbl WHERE availability != 'occupied' ORDER BY location, plot_number`); return ps; })(), form: req.body });
        }
      }
    }

    // Burial: require deceased details
    if (service === 'burial') {
      if (!deceased_firstName || !deceased_lastName || !birth_date || !death_date) {
        return res.status(400).render('admincreateb', { error: 'Please provide deceased details for burial.', plots: await (async () => { const [ps] = await db.query(`SELECT plot_id, plot_number, location, price, availability FROM plot_map_tbl WHERE availability != 'occupied' ORDER BY location, plot_number`); return ps; })(), form: req.body });
      }
    }

    // Insert booking
    let bookingId = null;
    if (service === 'plot' || service === 'burial') {
      // Insert booking (approved)
      const [result] = await db.query(
        `INSERT INTO booking_tbl (plot_id, user_id, firstname, lastname, phone, visit_time, booking_date, service_type, notes, generated_at, email, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, 'approved')`,
        [plotId, userId, firstname, lastname, phone, visitTime, bookingDate, service, notes || null, email || null]
      );
      bookingId = result.insertId;
      // Payment logic
      if (payment_method === 'cash') {
        let amount = plotPrice;
        let paymentType = 'fullpayment';
        let status = 'paid';
        let dueDate = null;
        let monthsVal = null;
        let monthlyAmount = null;
        let totalPaid = plotPrice;
        if (payment_option === 'downpayment') {
          paymentType = 'downpayment';
          status = 'active';
          amount = Math.round(plotPrice * 0.2 * 100) / 100;
          dueDate = new Date();
          dueDate.setDate(dueDate.getDate() + 30);
          monthsVal = parseInt(months, 10) || 0;
          monthlyAmount = monthsVal > 0 ? Math.round(((plotPrice - amount) / monthsVal) * 100) / 100 : null;
          totalPaid = amount;
        }
        const txId = `CASH-${bookingId}-${Date.now()}`;
        await db.query(
          `INSERT INTO payment_tbl (booking_id, user_id, amount, method, transaction_id, status, paid_at, due_date, payment_type, months, monthly_amount, plot_id, total_paid)
           VALUES (?, ?, ?, 'cash', ?, ?, NOW(), ?, ?, ?, ?, ?, ?)`,
          [bookingId, userId, amount, txId, status, dueDate ? dueDate.toISOString().slice(0, 19).replace('T', ' ') : null, paymentType, monthsVal, monthlyAmount, plotId, totalPaid]
        );
        // Update plot availability
        if (plotId) {
          await db.query('UPDATE plot_map_tbl SET availability = ? WHERE plot_id = ?', [paymentType === 'fullpayment' ? 'occupied' : 'reserved', plotId]);
        }
      }
      // Burial: update deceased info
      if (service === 'burial' && plotId) {
        await db.query(
          `UPDATE plot_map_tbl SET deceased_firstName = ?, deceased_lastName = ?, birth_date = ?, death_date = ? WHERE plot_id = ?`,
          [deceased_firstName, deceased_lastName, birth_date, death_date, plotId]
        );
      }
    } else if (service === 'memorial') {
      // Insert memorial booking (no plot/payment)
      const [result] = await db.query(
        `INSERT INTO booking_tbl (plot_id, user_id, firstname, lastname, phone, visit_time, booking_date, service_type, notes, generated_at, email, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, 'approved')`,
        [null, userId, firstname, lastname, phone, visitTime, bookingDate, service, notes || null, email || null]
      );
      bookingId = result.insertId;
    }
    // Redirect admin to the bookings list
    return res.redirect('/adminviewbookings');
  } catch (err) {
    console.error('Error creating admin appointment:', err);
    res.status(500).render('admincreateb', { error: 'Server error creating appointment.', plots: [] });
  }
});

module.exports = router;

