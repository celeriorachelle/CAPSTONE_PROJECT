const express = require("express");
const router = express.Router();
const db = require("../db");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const { Parser } = require("json2csv");

// 🔒 Middleware for staff authentication
function requireStaff(req, res, next) {
  if (!req.session.user || req.session.user.role !== "staff") {
    return res.redirect("/login");
  }
  next();
}

// ======================= VIEW PAGE =======================
router.get("/", requireStaff, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = `
      SELECT 
        p.payment_id,
        CONCAT(u.firstName, ' ', u.lastName) AS clientName,
        p.amount,
        p.method,
        p.status,
        p.payment_type,
        p.paid_at,
        p.due_date
      FROM payment_tbl p
      JOIN user_tbl u ON p.user_id = u.user_id
      ORDER BY p.paid_at DESC
    `;
    const params = [];

    if (startDate && endDate) {
      query = `
        SELECT 
          p.payment_id,
          CONCAT(u.firstName, ' ', u.lastName) AS clientName,
          p.amount,
          p.method,
          p.status,
          p.payment_type,
          p.paid_at,
          p.due_date
        FROM payment_tbl p
        JOIN user_tbl u ON p.user_id = u.user_id
        WHERE DATE(p.paid_at) BETWEEN ? AND ?
        ORDER BY p.paid_at DESC
      `;
      params.push(startDate, endDate);
    }

    const [rows] = await db.query(query, params);

    // ✅ Compute total amount and record count
    const totalAmount = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const totalRecords = rows.length;

    res.render("staff_viewpaymentreports", {
      payments: rows,
      startDate,
      endDate,
      totalAmount,
      totalRecords,
    });
  } catch (err) {
    console.error("Error loading payments:", err);
    res.status(500).send("Server error");
  }
});


// ======================= EXPORT: EXCEL =======================
router.get("/export/excel", requireStaff, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = `
      SELECT 
        p.payment_id,
        CONCAT(u.firstName, ' ', u.lastName) AS clientName,
        p.amount,
        p.method,
        p.status,
        p.payment_type,
        p.paid_at,
        p.due_date
      FROM payment_tbl p
      JOIN user_tbl u ON p.user_id = u.user_id
    `;
    const params = [];

    if (startDate && endDate) {
      query += " WHERE DATE(p.paid_at) BETWEEN ? AND ?";
      params.push(startDate, endDate);
    }

    query += " ORDER BY p.paid_at DESC";
    const [rows] = await db.query(query, params);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Payment Reports");

    worksheet.columns = [
      { header: "Payment ID", key: "payment_id", width: 12 },
      { header: "Client Name", key: "clientName", width: 25 },
      { header: "Amount (₱)", key: "amount", width: 15 },
      { header: "Method", key: "method", width: 15 },
      { header: "Status", key: "status", width: 15 },
      { header: "Payment Type", key: "payment_type", width: 15 },
      { header: "Paid At", key: "paid_at", width: 20 },
      { header: "Due Date", key: "due_date", width: 20 },
    ];

    rows.forEach((r) => worksheet.addRow(r));

    // ✅ Add total at the bottom
    const total = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    worksheet.addRow([]);
    worksheet.addRow(["", "TOTAL", total]);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=payment_report.xlsx"
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Excel export error:", err);
    res.status(500).send("Error exporting Excel");
  }
});


// ======================= EXPORT: CSV =======================
router.get("/export/csv", requireStaff, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = `
      SELECT 
        p.payment_id,
        CONCAT(u.firstName, ' ', u.lastName) AS clientName,
        p.amount,
        p.method,
        p.status,
        p.payment_type,
        p.paid_at,
        p.due_date
      FROM payment_tbl p
      JOIN user_tbl u ON p.user_id = u.user_id
    `;
    const params = [];

    if (startDate && endDate) {
      query += " WHERE DATE(p.paid_at) BETWEEN ? AND ?";
      params.push(startDate, endDate);
    }

    query += " ORDER BY p.paid_at DESC";
    const [rows] = await db.query(query, params);

    const parser = new Parser();
    const csv = parser.parse(rows);

    res.header("Content-Type", "text/csv");
    res.attachment("payment_report.csv");
    res.send(csv);
  } catch (err) {
    console.error("CSV export error:", err);
    res.status(500).send("Error exporting CSV");
  }
});


// ======================= EXPORT: PDF =======================
router.get("/export/pdf", requireStaff, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = `
      SELECT 
        p.payment_id,
        CONCAT(u.firstName, ' ', u.lastName) AS clientName,
        p.amount,
        p.method,
        p.status,
        p.payment_type,
        p.paid_at,
        p.due_date
      FROM payment_tbl p
      JOIN user_tbl u ON p.user_id = u.user_id
    `;
    const params = [];

    if (startDate && endDate) {
      query += " WHERE DATE(p.paid_at) BETWEEN ? AND ?";
      params.push(startDate, endDate);
    }

    query += " ORDER BY p.paid_at DESC";
    const [rows] = await db.query(query, params);

    const total = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

    const doc = new PDFDocument({ margin: 30, size: "A4" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=payment_report.pdf");
    doc.pipe(res);

    doc.fontSize(18).text("Everlasting Peace Memorial Park", { align: "center" });
    doc.fontSize(14).text("Payment Report", { align: "center" });
    if (startDate && endDate)
      doc.text(`From ${startDate} to ${endDate}`, { align: "center" });
    doc.moveDown();

    doc.fontSize(10);
    rows.forEach((p, i) => {
      doc.text(`${i + 1}. ${p.clientName} — ₱${Number(p.amount).toLocaleString()} (${p.payment_type})`);
      doc.text(`   Method: ${p.method} | Status: ${p.status} | Paid: ${p.paid_at}`);
      doc.moveDown(0.5);
    });

    doc.moveDown();
    doc.fontSize(12).text(`Total Amount: ₱${total.toLocaleString()}`, { align: "right" });

    doc.end();
  } catch (err) {
    console.error("PDF export error:", err);
    res.status(500).send("Error exporting PDF");
  }
});

module.exports = router;
