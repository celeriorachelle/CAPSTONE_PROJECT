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
    // ---- KPIs ----
    const [bookingsThisMonth] = await db.query(`
      SELECT COUNT(*) AS total 
      FROM booking_tbl 
      WHERE MONTH(booking_date) = MONTH(CURRENT_DATE())
      AND YEAR(booking_date) = YEAR(CURRENT_DATE())
    `);

    const [paymentsThisMonth] = await db.query(`
      SELECT SUM(amount) AS total 
      FROM payment_tbl 
      WHERE MONTH(paid_at) = MONTH(CURRENT_DATE())
      AND YEAR(paid_at) = YEAR(CURRENT_DATE())
    `);

    const [outstanding] = await db.query(`
      SELECT COUNT(*) AS total 
      FROM payment_tbl 
      WHERE status = 'pending'
    `);

    const [avgPayment] = await db.query(`
      SELECT AVG(amount) AS avg 
      FROM payment_tbl
    `);

    // ---- Bookings per month ----
    const [bookings] = await db.query(`
      SELECT MONTHNAME(booking_date) AS month, COUNT(*) AS total
      FROM booking_tbl
      GROUP BY MONTH(booking_date), MONTHNAME(booking_date)
      ORDER BY MONTH(booking_date)
    `);

    // ---- Payments per month ----
    const [payments] = await db.query(`
      SELECT MONTHNAME(paid_at) AS month, SUM(amount) AS total
      FROM payment_tbl
      GROUP BY MONTH(paid_at), MONTHNAME(paid_at)
      ORDER BY MONTH(paid_at)
    `);

    // ---- Bookings by status ----
    const [statusCounts] = await db.query(`
      SELECT status, COUNT(*) AS total 
      FROM booking_tbl 
      GROUP BY status
    `);

    // ---- Service vs Plot ----
    let [serviceVsPlot] = [[]];
    try {
      [serviceVsPlot] = await db.query(`
        SELECT service_type AS type, COUNT(*) AS total 
        FROM booking_tbl 
        GROUP BY service_type
      `);
    } catch (err) {
      console.log("Skipping Service vs Plot report (no service_type column)");
      serviceVsPlot = [];
    }

    // ---- Popular Plots ----
    let [popularPlots] = [[]];
    try {
      [popularPlots] = await db.query(`
        SELECT plot_type, COUNT(*) AS total 
        FROM booking_tbl 
        WHERE plot_type IS NOT NULL
        GROUP BY plot_type
      `);
    } catch (err) {
      console.log("Skipping Popular Plots report (no plot_type column)");
      popularPlots = [];
    }

    // ---- Most Popular Plot Type (KPI) ----
    let mostPopularPlot = null;
    try {
      const [popularType] = await db.query(`
        SELECT plot_type, COUNT(*) AS total
        FROM booking_tbl
        WHERE plot_type IS NOT NULL
        GROUP BY plot_type
        ORDER BY total DESC
        LIMIT 1
      `);
      mostPopularPlot = popularType[0]?.plot_type || null;
    } catch (err) {
      mostPopularPlot = null;
    }

    // ---- Top Clients ----
    const [topClients] = await db.query(`
      SELECT CONCAT(u.firstname, ' ', u.lastname) AS client_name, SUM(p.amount) AS total
      FROM payment_tbl p
      JOIN user_tbl u ON p.user_id = u.user_id
      GROUP BY u.user_id, u.firstname, u.lastname
      ORDER BY total DESC
      LIMIT 5
    `);

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
