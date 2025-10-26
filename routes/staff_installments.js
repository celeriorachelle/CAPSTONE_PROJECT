 const express = require("express");
const router = express.Router();
const db = require("../db");
const nodemailer = require("nodemailer");

// Middleware: staff only
function requireStaff(req, res, next) {
  if (!req.session.user || req.session.user.role !== "staff") {
    return res.redirect("/login");
  }
  next();
}

// Gmail transporter setup
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_USER || "rheachellegutierrez17@gmail.com",
    pass: process.env.SMTP_PASS || "cpflmrprhngxnsxo", // App password
  },
});

// ✅ Get all installments
router.get("/", requireStaff, async (req, res) => {
  try {
    const [installments] = await db.query(`
      SELECT 
        p.payment_id AS id,
        CONCAT(u.firstName, ' ', u.lastName) AS clientName,
        u.email AS email,
        p.amount, p.status, p.payment_type, p.due_date,
        DATEDIFF(p.due_date, CURDATE()) AS days_left
      FROM payment_tbl p
      JOIN user_tbl u ON p.user_id = u.user_id
      WHERE p.payment_type = 'downpayment'
      ORDER BY p.due_date ASC
    `);

    res.render("staff_installments", { staff: req.session.user, installments });
  } catch (err) {
    console.error("❌ Error loading installments:", err);
    res.render("staff_installments", { staff: req.session.user, installments: [] });
  }
});

// ✅ Fetch single payment details
router.get("/:id", requireStaff, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.payment_id, p.amount, p.due_date, p.payment_type, u.email, CONCAT(u.firstName, ' ', u.lastName) AS name
       FROM payment_tbl p
       JOIN user_tbl u ON p.user_id = u.user_id
       WHERE p.payment_id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json({ payment: rows[0] });
  } catch (err) {
    console.error("❌ Error fetching payment:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Manual/Automatic Reminder Send
router.post("/remind/:id", requireStaff, async (req, res) => {
  const paymentId = req.params.id;
  const { sendType, subject, html, to } = req.body;
  const staff = req.session.user;

  try {
    const [rows] = await db.query(
      `SELECT p.payment_id, p.amount, p.due_date, p.payment_type, p.booking_id, u.user_id, CONCAT(u.firstName, ' ', u.lastName) AS name, u.email
       FROM payment_tbl p
       JOIN user_tbl u ON p.user_id = u.user_id
       WHERE p.payment_id = ?`,
      [paymentId]
    );
    if (!rows.length) return res.json({ success: false, message: "Payment not found." });

    const client = rows[0];
    const dueDate = new Date(client.due_date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    // Prepare mail
    const mailOptions = {
      from: `"Everlasting Peace Memorial Park" <${process.env.SMTP_USER || "rheachellegutierrez17@gmail.com"}>`,
      to: to || client.email,
      subject: subject || `Payment Reminder: ${client.payment_type} due ${dueDate}`,
      html: html || `
        <p>Dear ${client.name},</p>
        <p>This is a reminder that your <strong>${client.payment_type}</strong> of ₱${Number(client.amount).toLocaleString()} is due on ${dueDate}.</p>
        <p>Just Log in to our website and go to Payment History then click the "Pay Here" button to pay your due amount.</p>
        <p>Please make your payment promptly.</p>
        <p>Thank you,<br>Everlasting Peace Memorial Park</p>
      `,
    };

    await transporter.sendMail(mailOptions);

    // Insert notification
    await db.query(
      `INSERT INTO notification_tbl (user_id, booking_id, payment_id, message, is_read, datestamp)
       VALUES (?, ?, ?, ?, 0, NOW())`,
      [
        client.user_id,
        client.booking_id,
        client.payment_id,
        `Reminder: Your ${client.payment_type} of ₱${Number(client.amount).toLocaleString()} is due on ${dueDate}.`,
      ]
    );

    // Log staff action
    await db.query(
      `INSERT INTO logs_tbl (user_id, user_role, action, details, timestamp)
       VALUES (?, 'staff', 'Payment Reminder Sent', ?, NOW())`,
      [staff.user_id, `Reminder sent to ${client.name} (${sendType})`]
    );

    res.json({ success: true, message: "Email and notification sent successfully!" });
  } catch (err) {
    console.error("❌ Error sending reminder:", err);
    res.json({ success: false, message: "Failed to send reminder." });
  }
});

// 🆕 AUTO UPDATE NEXT DUE DATE LOGIC (when payment is made)
router.post("/updateDueDate/:id", requireStaff, async (req, res) => {
  const paymentId = req.params.id;
  const staff = req.session.user;

  try {
    const [rows] = await db.query(
      `SELECT payment_id, booking_id, user_id, due_date, months, monthly_amount, total_paid, amount
       FROM payment_tbl WHERE payment_id = ?`,
      [paymentId]
    );

    if (!rows.length) return res.json({ success: false, message: "Payment not found." });

    const payment = rows[0];

    // compute total paid + current payment
    const newTotal = Number(payment.total_paid || 0) + Number(payment.amount);
    let nextDueDate = new Date(payment.due_date);

    // add 1 month
    nextDueDate.setMonth(nextDueDate.getMonth() + 1);

    // if fully paid (reached months * monthly_amount), mark completed
    const fullAmount = payment.monthly_amount * payment.months;
    const isComplete = newTotal >= fullAmount;

    if (isComplete) {
      await db.query(
        `UPDATE payment_tbl SET status = 'Completed' WHERE payment_id = ?`,
        [paymentId]
      );

      await db.query(
        `INSERT INTO notification_tbl (user_id, booking_id, payment_id, message, is_read, datestamp)
         VALUES (?, ?, ?, ?, 0, NOW())`,
        [
          payment.user_id,
          payment.booking_id,
          payment.payment_id,
          `Congratulations! Your installment plan is now fully paid.`,
        ]
      );

      await db.query(
        `INSERT INTO logs_tbl (user_id, user_role, action, details, timestamp)
         VALUES (?, 'staff', 'Installment Completed', ?, NOW())`,
        [staff.user_id, `Client has completed all installment payments.`]
      );

      return res.json({ success: true, message: "Installment completed successfully!" });
    } else {
      await db.query(
        `UPDATE payment_tbl SET due_date = ?, total_paid = ?, status = 'Ongoing' WHERE payment_id = ?`,
        [nextDueDate, newTotal, paymentId]
      );

      await db.query(
        `INSERT INTO notification_tbl (user_id, booking_id, payment_id, message, is_read, datestamp)
         VALUES (?, ?, ?, ?, 0, NOW())`,
        [
          payment.user_id,
          payment.booking_id,
          payment.payment_id,
          `Thank you for your payment! Your next due date is on ${nextDueDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.`,
        ]
      );

      await db.query(
        `INSERT INTO logs_tbl (user_id, user_role, action, details, timestamp)
         VALUES (?, 'staff', 'Installment Updated', ?, NOW())`,
        [staff.user_id, `Updated next due date for Payment ID ${paymentId}`]
      );

      return res.json({ success: true, message: "Next due date updated successfully!" });
    }
  } catch (err) {
    console.error("❌ Error updating due date:", err);
    res.json({ success: false, message: "Failed to update due date." });
  }
});

// ==========================
// 📱 TWILIO SMS REMINDER FEATURE
// ==========================
const axios = require("axios");
const SEMAPHORE_API_KEY = process.env.SEMAPHORE_API_KEY;


// ✅ SMS Reminder Route
// ✅ SMS Reminder Route
router.post("/sms/:id", requireStaff, async (req, res) => {
  try {
    const installmentId = req.params.id;

    // 🔍 Get client info
    const [rows] = await db.query(
      `SELECT u.firstName, u.lastName, u.contact_number, p.booking_id
       FROM user_tbl u
       JOIN payment_tbl p ON u.user_id = p.user_id
       WHERE p.payment_id = ?`,
      [installmentId]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Client not found." });
    }

    const client = rows[0];
    let phoneNumber = client.contact_number;

    // ✅ Convert to 09 -> +639 format
    if (phoneNumber.startsWith("0")) {
      phoneNumber = "+63" + phoneNumber.slice(1);
    }

    // 🧠 Message content
    const messageBody = `Hello ${client.firstName}, this is a reminder for your installment payment at Everlasting Peace Memorial Park. Thank you.`;

    // 📤 Send SMS via Semaphore
    const response = await axios.post("https://api.semaphore.co/api/v4/messages", {
      apikey: SEMAPHORE_API_KEY,
      number: phoneNumber,
      message: messageBody,
      sendername: "EPMemorial"
    });

    console.log("✅ SMS sent successfully:", response.data);

    // 🧾 Log action
    await db.query(
      `INSERT INTO logs_tbl (user_id, user_role, action, details, timestamp)
       VALUES (?, 'staff', 'SMS Reminder Sent', ?, NOW())`,
      [req.session.user.user_id, `Sent SMS reminder to ${client.firstName} (${phoneNumber})`]
    );

    res.json({ success: true, message: "SMS sent successfully via Semaphore!" });
  } catch (error) {
    console.error("❌ Error sending SMS:", error);
    res.status(500).json({ success: false, message: "Failed to send SMS.", error: error.message });
  }
});



module.exports = router;
