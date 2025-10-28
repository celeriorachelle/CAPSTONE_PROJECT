const express = require("express");
const router = express.Router();
const db = require("../db");
const nodemailer = require("nodemailer");
const { addLog } = require("./log_helper"); // <-- import log helper

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
    await db.query(
      `UPDATE payment_tbl SET status = 'paid' WHERE booking_id = ?`,
      [bookingId]
    );

    // Get client name
    const [rows] = await db.query(`
      SELECT COALESCE(u.firstname, b.firstname) AS firstname,
             COALESCE(u.lastname, b.lastname) AS lastname
      FROM booking_tbl b
      LEFT JOIN user_tbl u ON b.user_id = u.user_id
      WHERE b.booking_id = ?
    `, [bookingId]);
    const clientName = rows.length > 0 ? `${rows[0].firstname || ''} ${rows[0].lastname || ''}`.trim() : 'Client';

    await db.query(
      `INSERT INTO logs_tbl (user_id, user_role, action, details, timestamp)
       VALUES (?, 'staff', 'Confirm Payment', CONCAT('Payment confirmed for booking ID: ', ?, ' (Client: ', ?, ')'), NOW())`,
      [staffId, bookingId, clientName]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Error confirming payment:", err);
    res.status(500).json({ success: false });
  }
});

// ================================
// POST /staff_viewbookings/approve/:id - Approve a booking + notify user + log
// ================================
router.post("/approve/:id", requireStaff, async (req, res) => {
  const bookingId = req.params.id;
  const staffId = req.session.user.id;

  try {
    // 1️⃣ Update booking status
    await db.query(`UPDATE booking_tbl SET status = 'approved' WHERE booking_id = ?`, [bookingId]);

    // 2️⃣ Fetch booking details
    const [rows] = await db.query(`
      SELECT 
        COALESCE(u.email, b.email) AS email,
        COALESCE(u.firstname, b.firstname) AS firstname,
        COALESCE(u.lastname, b.lastname) AS lastname,
        b.user_id,
        b.service_type,
        b.deceased_firstName,
        b.deceased_lastName,
        b.birth_date,
        b.death_date,
        b.item_id,
        b.plot_number,
        b.location,
        b.type,
        b.price
      FROM booking_tbl b
      LEFT JOIN user_tbl u ON b.user_id = u.user_id
      WHERE b.booking_id = ?
    `, [bookingId]);

    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Booking not found' });

    const booking = rows[0];
    const clientName = `${booking.firstname || ''} ${booking.lastname || ''}`.trim();

    // 3️⃣ Insert deceased info into plot_map_tbl for burial services
    if (booking.service_type && booking.service_type.toLowerCase().includes('burial')) {
      await db.query(`
        INSERT INTO plot_map_tbl (
          plot_number,
          location,
          type,
          price,
          deceased_firstName,
          deceased_lastName,
          birth_date,
          death_date,
          item_id,
          availability,
          user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'occupied', ?)
      `, [
        booking.plot_number || 'Unassigned',
        booking.location || 'Unassigned',
        booking.type || 'Standard',
        booking.price || 0,
        booking.deceased_firstName || 'Unknown',
        booking.deceased_lastName || 'Unknown',
        booking.birth_date || null,
        booking.death_date || null,
        booking.item_id || 1,
        booking.user_id || null
      ]);
    }

    // 4️⃣ Send notifications (same as before)
    const message = `Hello ${booking.firstname || 'Client'}, your booking #${bookingId} has been approved.`;

    if (booking.user_id) {
      await db.query(`INSERT INTO notification_tbl (user_id, booking_id, message) VALUES (?, ?, ?)`,
        [booking.user_id, bookingId, message]);
    }

    if (booking.email) {
      await transporter.sendMail({
        from: 'Everlasting Peace Memorial Park <rheachellegutierrez17@gmail.com>',
        to: booking.email,
        subject: 'Booking Approved',
        text: message
      });
    }

    // 5️⃣ Log staff action
    await addLog({
      user_id: staffId,
      user_role: 'staff',
      action: 'Approved Booking',
      details: `Booking ID ${bookingId} approved by staff (Client: ${clientName})${booking.service_type.toLowerCase().includes('burial') ? ' — Deceased info saved in plot_map_tbl' : ''}`
    });

    res.json({ success: true, deceasedSaved: booking.service_type.toLowerCase().includes('burial') });


  } catch (err) {
    console.error("Error approving booking:", err);
    res.status(500).json({ success: false, error: 'Failed to approve booking' });
  }
});

// ================================
// POST /staff_viewbookings/reject/:id - Reject a booking + notify user + log
// ================================
router.post("/reject/:id", requireStaff, async (req, res) => {
  const bookingId = req.params.id;
  const staffId = req.session.user.id;

  try {
    // Update booking status
    await db.query(
      `UPDATE booking_tbl SET status = 'cancelled' WHERE booking_id = ?`,
      [bookingId]
    );

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

    let clientName = 'Client';
    if (rows.length > 0) {
      const client = rows[0];
      clientName = `${client.firstname || ''} ${client.lastname || ''}`.trim();

      const message = `Hello ${client.firstname || 'Client'}, your booking #${bookingId} has been rejected.`;

      // Send notification to DB
      if (client.user_id) {
        await db.query(`
          INSERT INTO notification_tbl (user_id, booking_id, message)
          VALUES (?, ?, ?)
        `, [client.user_id, bookingId, message]);
      }

      // Send email
      if (client.email) {
        await transporter.sendMail({
          from: 'Everlasting Peace Memorial Park <rheachellegutierrez17@gmail.com>',
          to: client.email,
          subject: 'Booking Rejected',
          text: message
        });
      }
    }

    // Add log for staff action with client name
    await addLog({
      user_id: staffId,
      user_role: 'staff',
      action: 'Rejected Booking',
      details: `Booking ID ${bookingId} rejected by staff (Client: ${clientName})`
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Error rejecting booking:", err);
    res.status(500).json({ success: false, error: 'Failed to reject booking' });
  }
});

// ================================
// POST /staff_viewbookings/notify/:id - Manual notification (already exists)
// ================================
router.post("/notify/:id", requireStaff, async (req, res) => {
  const bookingId = req.params.id;
  const { message } = req.body || {};
  if (!message || !message.trim()) {
    return res.status(400).json({ success: false, error: 'Message required' });
  }
  try {
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
    const clientName = `${client.firstname || ''} ${client.lastname || ''}`.trim() || 'Client';

    if (client.user_id) {
      await db.query(`
        INSERT INTO notification_tbl (user_id, booking_id, message)
        VALUES (?, ?, ?)
      `, [client.user_id, bookingId, message]);
    }

    if (client.email) {
      await transporter.sendMail({
        from: 'Everlasting Peace Memorial Park <rheachellegutierrez17@gmail.com>',
        to: client.email,
        subject: 'Notification from Everlasting Peace Memorial Park',
        text: message
      });
    }

    // Log staff notification with client name
    await addLog({
      user_id: req.session.user.id,
      user_role: 'staff',
      action: 'Sent Notification',
      details: `Notification sent for booking ID ${bookingId} to client (${clientName}): "${message}"`
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Error sending notification:", err);
    res.status(500).json({ success: false, error: 'Failed to send notification' });
  }
});

module.exports = router;
