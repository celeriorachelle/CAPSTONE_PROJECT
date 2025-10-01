// routes/payment_history.js
const express = require("express");
const router = express.Router();
const db = require("../db");

// Payment History page
router.get("/", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect("/login");
    }

    const userId = req.session.user.user_id;

    // 1. Fetch all payments with plot info
    const [payments] = await db.query(
      `SELECT p.*, pm.plot_number, pm.location
       FROM payment_tbl p
       JOIN booking_tbl b ON p.booking_id = b.booking_id
       LEFT JOIN plot_map_tbl pm ON b.plot_id = pm.plot_id
       WHERE p.user_id = ?
       ORDER BY p.paid_at DESC`,
      [userId]
    );

    // 2. Fetch current active installment (downpayment + installments)
    const [installmentRows] = await db.query(
      `SELECT b.booking_id, pm.plot_number, pm.location, pm.price AS total_price,
              COALESCE(SUM(p.amount),0) AS total_paid,
              MIN(CASE WHEN p.status = 'pending' THEN p.due_date END) AS next_due_date
       FROM booking_tbl b
       JOIN plot_map_tbl pm ON b.plot_id = pm.plot_id
       LEFT JOIN payment_tbl p ON b.booking_id = p.booking_id
       WHERE b.user_id = ?
       GROUP BY b.booking_id
       HAVING total_paid < pm.price
       ORDER BY b.booking_id DESC
       LIMIT 1`,
      [userId]
    );

    let currentInstallment = null;
    let installmentProgress = 0;

    if (installmentRows.length > 0) {
      currentInstallment = installmentRows[0];
      installmentProgress = Math.round(
        (currentInstallment.total_paid / currentInstallment.total_price) * 100
      );
    }

    res.render("payment_history", {
      payments,
      currentInstallment,
      installmentProgress,
      user: req.session.user
    });

  } catch (err) {
    console.error("Error fetching payment history:", err);
    res.status(500).send("Server error while loading payment history.");
  }
});

module.exports = router;
