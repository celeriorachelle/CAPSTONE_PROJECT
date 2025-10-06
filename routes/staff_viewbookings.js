const express = require("express");
const router = express.Router();
const db = require("../db");

// Middleware — Only staff can access
function requireStaff(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'staff') {
    return res.redirect('/login');
  }
  next();
}

// GET /staff_viewbookings
router.get("/", requireStaff, async (req, res) => {
  try {
    const [bookings] = await db.query(`
      SELECT 
        b.booking_id AS id,
        CONCAT(b.firstname, ' ', b.lastname) AS clientName,
        b.booking_date AS date,
        b.status,
        b.email,
        b.phone,
        b.service_type AS service,
        p.amount,
        p.status AS payment_status,
        p.due_date
      FROM booking_tbl b
      LEFT JOIN payment_tbl p ON b.booking_id = p.booking_id
      ORDER BY b.booking_date DESC
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

// POST /staff_viewbookings/confirm/:id — confirm payment
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

module.exports = router;
