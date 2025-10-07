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

// GET /staff_installments
router.get("/", requireStaff, async (req, res) => {
  try {
    const [installments] = await db.query(`
      SELECT 
        p.payment_id AS id,
        p.booking_id,
        CONCAT(b.firstname, ' ', b.lastname) AS clientName,
        b.email,
        b.phone,
        p.amount,
        p.status,
        p.payment_type,
        p.due_date,
        DATEDIFF(p.due_date, CURDATE()) AS days_left
      FROM payment_tbl p
      LEFT JOIN booking_tbl b ON p.booking_id = b.booking_id
      WHERE p.status IN ('pending', 'partial')
      ORDER BY p.due_date ASC
    `);

    res.render("staff_installments", {
      staff: req.session.user,
      installments,
    });
  } catch (err) {
    console.error("Error loading installments:", err);
    res.render("staff_installments", { staff: req.session.user, installments: [] });
  }
});

// POST /staff_installments/remind/:id — send payment reminder
router.post("/remind/:id", requireStaff, async (req, res) => {
  const paymentId = req.params.id;
  const staffId = req.session.user.id;

  try {
    // Get client info for logging and notification
    const [client] = await db.query(
      `SELECT b.user_id, CONCAT(b.firstname, ' ', b.lastname) AS name, p.due_date
       FROM payment_tbl p
       JOIN booking_tbl b ON p.booking_id = b.booking_id
       WHERE p.payment_id = ?`,
      [paymentId]
    );

    if (!client[0]) return res.status(404).json({ success: false });

    const clientName = client[0].name;
    const dueDate = new Date(client[0].due_date).toLocaleDateString();

    // Log this reminder
    await db.query(
      `INSERT INTO logs_tbl (user_id, user_role, action, details, timestamp)
       VALUES (?, 'staff', 'Payment Reminder Sent', CONCAT('Reminder sent to ${clientName} (due date: ${dueDate})'), NOW())`,
      [staffId]
    );

    // Optionally: insert into notification_tbl if exists
    // await db.query(`INSERT INTO notification_tbl (...) VALUES (...)`);

    res.json({ success: true });
  } catch (err) {
    console.error("Error sending reminder:", err);
    res.status(500).json({ success: false });
  }
});

module.exports = router;
