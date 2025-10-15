const express = require("express");
const router = express.Router();
const db = require("../db");
const nodemailer = require("nodemailer");

// Middleware — Only staff can access
function requireStaff(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'staff') {
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
    user: 'rheachellegutierrez17@gmail.com',
    pass: 'cpflmrprhngxnsxo'
  }
});

// ================================
// GET /staff_viewbookings - View all bookings
// ================================
router.get("/", requireStaff, async (req, res) => {
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

    res.render("staff_viewbookings", {
      staff: req.session.user,
      bookings,
    });
  } catch (err) {
    console.error("Error loading staff bookings:", err);
    res.render("staff_viewbookings", {
      staff: req.session.user,
      bookings: [],
    });
  }
});

// ================================
// POST /staff_viewbookings/confirm/:id — confirm payment
// ================================
router.post("/confirm/:id", requireStaff, async (req, res) => {
  const bookingId = req.params.id;
  const staffId = req.session.user.id;

  try {
    // Update payment status
    await db.query(
      `UPDATE payment_tbl SET status = 'paid' WHERE booking_id = ?`,
      [bookingId]
    );

    // Log this action
    await db.query(
      `INSERT INTO logs_tbl (user_id, user_role, action, details, timestamp)
       VALUES (?, 'staff', 'Confirm Payment', CONCAT('Payment confirmed for booking ID: ', ?), NOW())`,
      [staffId, bookingId]
    );

    // Notify client (optional if you have a notification table)
    res.json({ success: true });
  } catch (err) {
    console.error("Error confirming payment:", err);
    res.status(500).json({ success: false });
  }
});

// ================================
// POST /staff_viewbookings/approve/:id - Approve a booking
// ================================
router.post("/approve/:id", requireStaff, async (req, res) => {
  const bookingId = req.params.id;
  try {
    await db.query(
      `UPDATE booking_tbl SET status = 'approved' WHERE booking_id = ?`,
      [bookingId]
    );
    // Notification/email logic (optional)
    res.json({ success: true });
  } catch (err) {
    console.error("Error approving booking:", err);
    res.status(500).json({ success: false, error: 'Failed to approve booking' });
  }
});

// ================================
// POST /staff_viewbookings/reject/:id - Reject a booking
// ================================
router.post("/reject/:id", requireStaff, async (req, res) => {
  const bookingId = req.params.id;
  try {
    await db.query(
      `UPDATE booking_tbl SET status = 'cancelled' WHERE booking_id = ?`,
      [bookingId]
    );
    // Notification/email logic (optional)
    res.json({ success: true });
  } catch (err) {
    console.error("Error rejecting booking:", err);
    res.status(500).json({ success: false, error: 'Failed to reject booking' });
  }
});

// ================================
// POST /staff_viewbookings/notify/:id - Manual notification
// ================================
router.post("/notify/:id", requireStaff, async (req, res) => {
  const bookingId = req.params.id;
  const { message } = req.body || {};
  if (!message || !message.trim()) {
    return res.status(400).json({ success: false, error: 'Message required' });
  }
  try {
    // Get client info
    const [rows] = await db.query(`
      SELECT COALESCE(u.email, b.email) AS email,
             COALESCE(u.firstname, b.firstname) AS firstname,
             COALESCE(u.lastname, b.lastname) AS lastname,
             b.user_id
      FROM booking_tbl b
      LEFT JOIN user_tbl u ON b.user_id = u.user_id
      WHERE b.booking_id = ?
    `, [bookingId]);

    if (rows.length === 0) {
      return res.json({ success: false, message: 'Booking not found' });
    }
    const client = rows[0];

    // Send email
    await transporter.sendMail({
      from: 'Everlasting Peace Memorial Park <rheachellegutierrez17@gmail.com>',
      to: client.email,
      subject: 'Notification from Everlasting Peace Memorial Park',
      text: message
    });

    // Add notification to notification_tbl
    if (client.user_id) {
      await db.query(`
        INSERT INTO notification_tbl (user_id, booking_id, message)
        VALUES (?, ?, ?)
      `, [client.user_id, bookingId, message]);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error sending notification:", err);
    res.status(500).json({ success: false, error: 'Failed to send notification' });
  }
});

module.exports = router;
