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
  const staffUser = req.session.user; // staff info for logs

  const {
    deceased_firstName,
    deceased_lastName,
    birth_date,
    death_date,
    plot_number,
    location,
    type,
    price,
    item_id
  } = req.body;

  try {
    // 1️⃣ Update booking status
    await db.query(
      `UPDATE booking_tbl SET status = 'approved' WHERE booking_id = ?`,
      [bookingId]
    );

    // 2️⃣ Update plot availability if linked
    const [plotRes] = await db.query(
      `SELECT plot_id FROM booking_tbl WHERE booking_id = ?`,
      [bookingId]
    );
    if (plotRes[0] && plotRes[0].plot_id) {
      await db.query(
        `UPDATE plot_map_tbl SET availability = 'occupied' WHERE plot_id = ?`,
        [plotRes[0].plot_id]
      );
    }

    // 3️⃣ Fetch booking details (for notifications + email)
    const [bookingRows] = await db.query(
      `
      SELECT user_id, firstname, lastname, email, service_type, booking_date, visit_time, plot_id
      FROM booking_tbl WHERE booking_id = ?
      `,
      [bookingId]
    );

    if (bookingRows.length > 0) {
      const bk = bookingRows[0];
      const userId = bk.user_id;
      const clientName = `${bk.firstname} ${bk.lastname}`;
      const email = bk.email;
      const service = bk.service_type || "appointment";
      const date = bk.booking_date
        ? new Date(bk.booking_date).toLocaleDateString()
        : "";
      const time = bk.visit_time || "";

      const message = `Your ${service} booking on ${date} at ${time} has been approved. Please come at the scheduled time.`;

      // 4️⃣ If it's a burial booking, insert deceased info into plot_map_tbl
    // 4️⃣ If it's a burial booking, insert deceased info into plot_map_tbl
if (service.toLowerCase().includes("burial")) {
  // Check if the plot already exists and is linked to this user (avoid duplicates)
  const [existing] = await db.query(
    `SELECT plot_id FROM plot_map_tbl WHERE user_id = ? AND availability = 'occupied'`,
    [userId]
  );

  if (existing.length === 0) {
    await db.query(
      `INSERT INTO plot_map_tbl (
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
      `,
      [
        plot_number || "Unassigned",
        location || "Unassigned",
        type || "Standard",
        price || 0.0,
        deceased_firstName || "Unknown",
        deceased_lastName || "Unknown",
        birth_date || null,
        death_date || null,
        item_id || 1,
        userId || null
      ]
    );
  }
}

      // 5️⃣ Insert into notifications table
      await db.query(
        `
        INSERT INTO notification_tbl (user_id, booking_id, message, is_read, datestamp, plot_id)
        VALUES (?, ?, ?, 0, NOW(), ?)
        `,
        [userId, bookingId, message, bk.plot_id || null]
      );

      // 6️⃣ Send email notification (optional)
      if (email) {
        try {
          await transporter.sendMail({
            from: '"Everlasting Peace Memorial Park" <rheachellegutierrez17@gmail.com>',
            to: email,
            subject: "Your booking has been approved",
            text: message
          });
        } catch (mailErr) {
          console.error("Error sending approval email:", mailErr);
        }
      }

      // 7️⃣ Log the staff action
      await addLog({
        user_id: staffUser.user_id,
        user_role: staffUser.role,
        action: "Approved booking",
        details: `Booking ID ${bookingId} approved by staff (Client: ${clientName})`
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error approving booking (staff):", err);
    res.status(500).json({ success: false, error: "Failed to approve booking" });
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

// ---------------------------
// POST /staff_viewbookings/record-cash - Record offline cash payment for a booking
// ---------------------------
router.post('/record-cash', requireStaff, async (req, res) => {
  try {
    const { booking_id, amount, payment_type, months, monthly_amount, transaction_id } = req.body || {};
    const bookingId = Number(booking_id || 0);
    if (!bookingId || !amount || !payment_type) return res.status(400).json({ success: false, message: 'Missing fields' });

    // Fetch booking to know user and plot
    const [bkRows] = await db.query('SELECT user_id, plot_id FROM booking_tbl WHERE booking_id = ? LIMIT 1', [bookingId]);
    if (!bkRows.length) return res.status(404).json({ success: false, message: 'Booking not found' });
    const bk = bkRows[0];

    const tx = transaction_id || `CASH-${bookingId}-${Date.now()}`;

    // Insert payment row
    const monthsNum = months ? parseInt(months, 10) : null;
    const monthlyNum = monthly_amount ? parseFloat(monthly_amount) : null;
    const amt = parseFloat(amount);

    const status = (payment_type === 'fullpayment') ? 'paid' : 'active';

    await db.query(
      `INSERT INTO payment_tbl (booking_id, user_id, plot_id, amount, method, transaction_id, status, paid_at, due_date, payment_type, months, monthly_amount, total_paid)
       VALUES (?, ?, ?, ?, 'cash', ?, ?, NOW(), NULL, ?, ?, ?, ?)`,
      [bookingId, bk.user_id || null, bk.plot_id || null, amt, tx, status, payment_type, monthsNum, monthlyNum, amt]
    );

    // Update plot availability depending on full/downpayment
    if (bk.plot_id) {
      if (payment_type === 'fullpayment') {
        await db.query('UPDATE plot_map_tbl SET availability = ?, user_id = ? WHERE plot_id = ?', ['occupied', bk.user_id || null, bk.plot_id]);
      } else if (payment_type === 'downpayment') {
        await db.query('UPDATE plot_map_tbl SET availability = ?, user_id = ? WHERE plot_id = ?', ['reserved', bk.user_id || null, bk.plot_id]);
      }
    }

    // Notification + log
    const msg = `Staff recorded ${payment_type} cash payment of ₱${amt.toFixed(2)} for booking #${bookingId}`;
    await db.query('INSERT INTO notification_tbl (user_id, booking_id, title, message, created_at) VALUES (?, ?, ?, ?, NOW())', [bk.user_id || null, bookingId, 'Payment recorded', msg]);
    await addLog({ user_id: req.session.user.user_id, user_role: req.session.user.role, action: 'Record Cash Payment', details: msg });

    res.json({ success: true });
  } catch (err) {
    console.error('Error recording cash payment (staff):', err);
    res.status(500).json({ success: false });
  }
});
