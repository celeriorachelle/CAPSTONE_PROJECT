const express = require("express");
const router = express.Router();
const db = require("../db");

// For export (install first: npm install exceljs pdfkit)
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const path = require("path");

// ------------------- Reports Page -------------------
router.get("/", async (req, res) => {
  try {
    // read optional date filters from query string
    // expected format: YYYY-MM-DD
    const { startDate, endDate } = req.query;

    // Helper: whether date filter is provided and valid-ish
    const useDateFilter = startDate && endDate;

    // Prepare date sanitized values (we'll pass as params). No direct string interpolation.
    // If no filter provided, we'll use the current month behavior for the "month" KPIs,
    // but for broader reports we'll use all data.
    let bookingsThisMonth, paymentsThisMonth, outstanding, avgPayment;
    let bookings = [];
    let payments = [];
    let statusCounts = [];
    let serviceVsPlot = [];
    let popularPlots = [];
    let mostPopularPlot = null;
    let topClients = [];

    // ---------------- KPIs ----------------
    if (useDateFilter) {
      // Count bookings in provided date range
      [bookingsThisMonth] = await db.query(
        `SELECT COUNT(*) AS total
         FROM booking_tbl
         WHERE booking_date BETWEEN ? AND ?`,
        [startDate, endDate]
      );

      // Sum payments in provided date range (use DATE(paid_at) to compare)
      [paymentsThisMonth] = await db.query(
        `SELECT IFNULL(SUM(amount), 0) AS total
         FROM payment_tbl
         WHERE DATE(paid_at) BETWEEN ? AND ?`,
        [startDate, endDate]
      );

      // outstanding (pending) - we will keep global pending count for clarity (not strictly date-bound)
      // but if you prefer to filter by due_date or paid_at you can change here.
      [outstanding] = await db.query(
        `SELECT COUNT(*) AS total
         FROM payment_tbl
         WHERE status = 'pending'`
      );

      // average payment in range
      [avgPayment] = await db.query(
        `SELECT IFNULL(AVG(amount),0) AS avg
         FROM payment_tbl
         WHERE DATE(paid_at) BETWEEN ? AND ?`,
        [startDate, endDate]
      );
    } else {
      // Original behavior: KPIs for current month
      [bookingsThisMonth] = await db.query(`
        SELECT COUNT(*) AS total 
        FROM booking_tbl 
        WHERE MONTH(booking_date) = MONTH(CURRENT_DATE())
        AND YEAR(booking_date) = YEAR(CURRENT_DATE())
      `);

      [paymentsThisMonth] = await db.query(`
        SELECT IFNULL(SUM(amount),0) AS total 
        FROM payment_tbl 
        WHERE MONTH(paid_at) = MONTH(CURRENT_DATE())
        AND YEAR(paid_at) = YEAR(CURRENT_DATE())
      `);

      [outstanding] = await db.query(`
        SELECT COUNT(*) AS total 
        FROM payment_tbl 
        WHERE status = 'pending'
      `);

      [avgPayment] = await db.query(`
        SELECT IFNULL(AVG(amount),0) AS avg 
        FROM payment_tbl
      `);
    }

    // ---------------- Bookings per month ----------------
    // If date filter provided, group by month names within the range.
    if (useDateFilter) {
      [bookings] = await db.query(
        `SELECT DATE_FORMAT(booking_date, '%Y-%m') AS month, COUNT(*) AS total
         FROM booking_tbl
         WHERE booking_date BETWEEN ? AND ?
         GROUP BY DATE_FORMAT(booking_date, '%Y-%m')
         ORDER BY DATE_FORMAT(booking_date, '%Y-%m')`,
        [startDate, endDate]
      );

      // convert YYYY-MM to more friendly label (e.g., "2025-10")
      bookings = bookings.map(r => ({ month: r.month, total: r.total }));
    } else {
      [bookings] = await db.query(`
        SELECT MONTHNAME(booking_date) AS month, COUNT(*) AS total
        FROM booking_tbl
        GROUP BY MONTH(booking_date), MONTHNAME(booking_date)
        ORDER BY MONTH(booking_date)
      `);
    }

    // ---------------- Payments per month ----------------
    if (useDateFilter) {
      [payments] = await db.query(
        `SELECT DATE_FORMAT(paid_at, '%Y-%m') AS month, IFNULL(SUM(amount),0) AS total
         FROM payment_tbl
         WHERE DATE(paid_at) BETWEEN ? AND ?
         GROUP BY DATE_FORMAT(paid_at, '%Y-%m')
         ORDER BY DATE_FORMAT(paid_at, '%Y-%m')`,
        [startDate, endDate]
      );
      payments = payments.map(r => ({ month: r.month, total: r.total }));
    } else {
      [payments] = await db.query(`
        SELECT MONTHNAME(paid_at) AS month, IFNULL(SUM(amount),0) AS total
        FROM payment_tbl
        GROUP BY MONTH(paid_at), MONTHNAME(paid_at)
        ORDER BY MONTH(paid_at)
      `);
    }

    // ---------------- Bookings by status ----------------
    if (useDateFilter) {
      [statusCounts] = await db.query(
        `SELECT status, COUNT(*) AS total
         FROM booking_tbl
         WHERE booking_date BETWEEN ? AND ?
         GROUP BY status`,
        [startDate, endDate]
      );
    } else {
      [statusCounts] = await db.query(`
        SELECT status, COUNT(*) AS total 
        FROM booking_tbl 
        GROUP BY status
      `);
    }

    // ---------------- Service vs Plot ----------------
    try {
      if (useDateFilter) {
        [serviceVsPlot] = await db.query(
          `SELECT service_type AS type, COUNT(*) AS total 
           FROM booking_tbl 
           WHERE booking_date BETWEEN ? AND ?
           GROUP BY service_type`,
          [startDate, endDate]
        );
      } else {
        [serviceVsPlot] = await db.query(`
          SELECT service_type AS type, COUNT(*) AS total 
          FROM booking_tbl 
          GROUP BY service_type
        `);
      }
    } catch (err) {
      console.log("Skipping Service vs Plot report (no service_type column)");
      serviceVsPlot = [];
    }

    // ---------------- Popular Plots ----------------
    try {
      if (useDateFilter) {
        [popularPlots] = await db.query(
          `SELECT plot_type, COUNT(*) AS total 
           FROM booking_tbl 
           WHERE plot_type IS NOT NULL
             AND booking_date BETWEEN ? AND ?
           GROUP BY plot_type
           ORDER BY total DESC`,
          [startDate, endDate]
        );
      } else {
        [popularPlots] = await db.query(`
          SELECT plot_type, COUNT(*) AS total 
          FROM booking_tbl 
          WHERE plot_type IS NOT NULL
          GROUP BY plot_type
          ORDER BY total DESC
        `);
      }
    } catch (err) {
      console.log("Skipping Popular Plots report (no plot_type column)");
      popularPlots = [];
    }

    // ---------------- Most Popular Plot Type (KPI) ----------------
    try {
      if (useDateFilter) {
        const [popularType] = await db.query(
          `SELECT plot_type, COUNT(*) AS total
           FROM booking_tbl
           WHERE plot_type IS NOT NULL
             AND booking_date BETWEEN ? AND ?
           GROUP BY plot_type
           ORDER BY total DESC
           LIMIT 1`,
          [startDate, endDate]
        );
        mostPopularPlot = popularType[0]?.plot_type || null;
      } else {
        const [popularType] = await db.query(`
          SELECT plot_type, COUNT(*) AS total
          FROM booking_tbl
          WHERE plot_type IS NOT NULL
          GROUP BY plot_type
          ORDER BY total DESC
          LIMIT 1
        `);
        mostPopularPlot = popularType[0]?.plot_type || null;
      }
    } catch (err) {
      mostPopularPlot = null;
    }

    // ---------------- Top Clients ----------------
    // Use user_tbl columns firstName/lastName (matches your CREATE TABLE)
    if (useDateFilter) {
      [topClients] = await db.query(
        `SELECT CONCAT(u.firstName, ' ', u.lastName) AS client_name, IFNULL(SUM(p.amount),0) AS total
         FROM payment_tbl p
         JOIN user_tbl u ON p.user_id = u.user_id
         WHERE DATE(p.paid_at) BETWEEN ? AND ?
         GROUP BY u.user_id, u.firstName, u.lastName
         ORDER BY total DESC
         LIMIT 5`,
        [startDate, endDate]
      );
    } else {
      [topClients] = await db.query(
        `SELECT CONCAT(u.firstName, ' ', u.lastName) AS client_name, IFNULL(SUM(p.amount),0) AS total
         FROM payment_tbl p
         JOIN user_tbl u ON p.user_id = u.user_id
         GROUP BY u.user_id, u.firstName, u.lastName
         ORDER BY total DESC
         LIMIT 5`
      );
    }

    // render page
    res.render("reports", {
      totalBookingsThisMonth: bookingsThisMonth[0]?.total || 0,
      totalPaymentsThisMonth: Number(paymentsThisMonth[0]?.total) || 0,
      outstandingBalances: outstanding[0]?.total || 0,
      avgPayment: Number(avgPayment[0]?.avg) || 0,
      mostPopularPlot,
      bookings,
      payments,
      statusCounts,
      serviceVsPlot,
      popularPlots,
      topClients,
      // pass back start/end so the form can be prefilled
      startDate: startDate || "",
      endDate: endDate || "",
    });

  } catch (err) {
    console.error("Error generating reports:", err);
    res.status(500).send("Error generating reports");
  }
});

// ------------------- Export to Excel -------------------
router.get("/export/excel", async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Admin Reports");

    sheet.addRow(["Report", "Value"]);
    sheet.addRow(["Total Bookings This Month", "100"]); // example
    sheet.addRow(["Total Payments This Month", "₱50000"]);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=reports.xlsx");

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Excel export error:", err);
    res.status(500).send("Error exporting to Excel");
  }
});

// ------------------- Export to PDF -------------------
router.get("/export/pdf", async (req, res) => {
  try {
    const doc = new PDFDocument();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=reports.pdf");

    doc.pipe(res);

    doc.fontSize(18).text("Admin Reports", { align: "center" });
    doc.moveDown();

    doc.fontSize(12).text("📌 This is a sample PDF report.");
    doc.text("➡ You can add charts and detailed data here.");

    doc.end();
  } catch (err) {
    console.error("PDF export error:", err);
    res.status(500).send("Error exporting to PDF");
  }
});

module.exports = router;
