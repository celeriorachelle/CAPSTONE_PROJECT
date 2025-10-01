// routes/reports.js
const express = require("express");
const router = express.Router();
const pool = require("../db"); // adjust path if needed

router.get("/", async (req, res) => {
  try {
    // Payments per month
   // Payments per month
    const [paymentReports] = await pool.query(`
    SELECT 
        MONTH(paid_at) AS month_num, 
        MONTHNAME(MIN(paid_at)) AS month, 
        SUM(amount) AS total
    FROM payment_tbl
    WHERE status = 'paid'
    GROUP BY MONTH(paid_at)
    ORDER BY MONTH(paid_at)
    `);


    // Bookings per month
   // Bookings per month
        const [bookingReports] = await pool.query(`
        SELECT 
            MONTH(booking_date) AS month_num, 
            MONTHNAME(MIN(booking_date)) AS month, 
            COUNT(*) AS total
        FROM booking_tbl
        GROUP BY MONTH(booking_date)
        ORDER BY MONTH(booking_date)
        `);

    // Bookings by status
    const [statusCounts] = await pool.query(`
      SELECT status, COUNT(*) AS total
      FROM booking_tbl
      GROUP BY status
    `);

    // Ensure all 12 months are present
    const allMonths = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];

    const bookings = allMonths.map((m, i) => {
      const found = bookingReports.find(b => b.month_num === i + 1);
      return { month: m, total: found ? found.total : 0 };
    });

    const payments = allMonths.map((m, i) => {
      const found = paymentReports.find(p => p.month_num === i + 1);
      return { month: m, total: found ? parseFloat(found.total) : 0 };
    });

    res.render("reports", { payments, bookings, statusCounts });
  } catch (err) {
    console.error("Error generating reports:", err);
    res.status(500).send("Error generating reports");
  }
});

module.exports = router;
