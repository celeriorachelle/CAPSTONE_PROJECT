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
    // 🟢 Fetch only the latest 'active' payment record for each plot to represent the current installment status.
    const [installments] = await db.query(`
      SELECT
        p.payment_id AS id,
        p.booking_id,
        p.user_id,
        p.amount,
        p.method,
        p.transaction_id,
        p.status,
        p.paid_at,
        p.due_date,
        p.payment_type,
        p.months,
        p.monthly_amount,
        p.plot_id,
        p.total_paid,
        CONCAT(u.firstName, ' ', u.lastName) AS clientName,
        u.email,
        DATEDIFF(p.due_date, CURDATE()) AS days_left
      FROM payment_tbl p
      INNER JOIN (
        SELECT plot_id, MAX(paid_at) AS max_paid_at 
        FROM payment_tbl
        WHERE status = 'active' AND plot_id IS NOT NULL
        GROUP BY plot_id
      ) AS latest ON p.plot_id = latest.plot_id AND p.paid_at = latest.max_paid_at
      JOIN user_tbl u ON p.user_id = u.user_id
      WHERE p.status = 'active'
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

// ✅ Completion Email + Notification
router.post("/completed_notify/:id", requireStaff, async (req, res) => {
  const paymentId = req.params.id;
  const { to, subject, message } = req.body;
  const staff = req.session.user;

  try {
    const [rows] = await db.query(
      `SELECT p.payment_id, p.booking_id, u.user_id, CONCAT(u.firstName, ' ', u.lastName) AS name, u.email
       FROM payment_tbl p
       JOIN user_tbl u ON p.user_id = u.user_id
       WHERE p.payment_id = ?`,
      [paymentId]
    );

    if (!rows.length) return res.json({ success: false, message: "Payment not found." });
    const client = rows[0];

    await transporter.sendMail({
      from: `"Everlasting Peace Memorial Park" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html: `<p>${message.replace(/\n/g, "<br>")}</p>`,
    });

    await db.query(
      `INSERT INTO notification_tbl (user_id, booking_id, payment_id, message, is_read, datestamp)
       VALUES (?, ?, ?, ?, 0, NOW())`,
      [client.user_id, client.booking_id, paymentId, message]
    );

    await db.query(
      `INSERT INTO logs_tbl (user_id, user_role, action, details, timestamp)
       VALUES (?, 'staff', 'Completion Notice Sent', ?, NOW())`,
      [staff.user_id, `Completion notice sent to ${client.name}`]
    );

    res.json({ success: true, message: "✅ Completion email and notification sent successfully!" });
  } catch (err) {
    console.error("❌ Error sending completion notice:", err);
    res.json({ success: false, message: "Failed to send completion notice." });
  }
});

// ✅ SMS version (connected to Traccar)
router.post("/completed_sms/:id", requireStaff, async (req, res) => {
  try {
    const paymentId = req.params.id;

    // Fetch client info
    const [rows] = await db.query(
      `SELECT 
         u.firstName, 
         u.lastName, 
         u.contact_number,
         p.payment_type
       FROM user_tbl u
       JOIN payment_tbl p ON u.user_id = p.user_id
       WHERE p.payment_id = ?`,
      [paymentId]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Client not found." });
    }

    const client = rows[0];
    let phoneNumber = client.contact_number.replace(/\s+/g, "");
    if (phoneNumber.startsWith("0")) {
      phoneNumber = "+63" + phoneNumber.slice(1);
    }

    const message = 
`Dear ${client.firstName} ${client.lastName},

Congratulations! Your ${client.payment_type} has been fully paid.

Thank you for trusting Everlasting Peace Memorial Park.`;

    // Send via Traccar
    const response = await axios.post(
      TRACCAR_SMS_BASE_URL,
      {
        to: phoneNumber,
        message: message,
      },
      {
        headers: {
          Authorization: TRACCAR_SMS_TOKEN,
          "Content-Type": "application/json",
        },
        timeout: SMS_TIMEOUT,
      }
    );

    console.log("✅ Completion SMS sent:", response.data);

    // Log SMS sending
    await db.query(
      `INSERT INTO logs_tbl (user_id, user_role, action, details, timestamp)
       VALUES (?, 'staff', 'SMS Completion Notice Sent', ?, NOW())`,
      [req.session.user.user_id, `Sent SMS completion notice to ${client.firstName} (${phoneNumber})`]
    );

    return res.json({ success: true, message: "📩 SMS completion notice sent successfully via Traccar!" });
  } catch (err) {
    console.error("❌ SMS sending error:", err);
    res.json({ success: false, message: "Failed to send completion SMS." });
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

// 🆕 AUTO UPDATE NEXT DUE DATE LOGIC
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
    const newTotal = Number(payment.total_paid || 0) + Number(payment.amount);
    let nextDueDate = new Date(payment.due_date);
    nextDueDate.setMonth(nextDueDate.getMonth() + 1);
    const fullAmount = payment.monthly_amount * payment.months;
    const isComplete = newTotal >= fullAmount;

    if (isComplete) {
      await db.query(`UPDATE payment_tbl SET status = 'Completed' WHERE payment_id = ?`, [paymentId]);
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
// 📱 TRACCAR SMS REMINDER FEATURE
// ==========================
const axios = require("axios");
const TRACCAR_SMS_BASE_URL = process.env.TRACCAR_SMS_BASE_URL;
const TRACCAR_SMS_TOKEN = process.env.TRACCAR_SMS_TOKEN;
const SMS_TIMEOUT = process.env.TRACCAR_SMS_TIMEOUT_MS || 15000;

// ✅ Send SMS reminder via Traccar
router.post("/sms/:id", requireStaff, async (req, res) => {
  try {
    const installmentId = req.params.id;
    const [rows] = await db.query(
      `SELECT 
         u.firstName, u.lastName, u.contact_number,
         p.payment_type, p.amount, p.due_date
       FROM user_tbl u
       JOIN payment_tbl p ON u.user_id = p.user_id
       WHERE p.payment_id = ?`,
      [installmentId]
    );

    if (!rows.length)
      return res.status(404).json({ success: false, message: "Client not found." });

    const client = rows[0];
    let phoneNumber = client.contact_number.replace(/\s+/g, "");
    if (phoneNumber.startsWith("0")) phoneNumber = "+63" + phoneNumber.slice(1);

    const paymentType = client.payment_type || "installment payment";
    const amount = client.amount ? Number(client.amount).toLocaleString("en-PH") : "0.00";
    const dueDate = client.due_date
      ? new Date(client.due_date).toLocaleDateString("en-PH", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "a future date";

    const message = 
`Dear ${client.firstName} ${client.lastName},

This is a reminder that your ${paymentType} of PHP${amount} is due on ${dueDate}.

Please log in to our website and go to Payment History, then click the "Pay Here" button to pay your due amount.

Please make your payment promptly.

Thank you,
Everlasting Peace Memorial Park`;

    const response = await axios.post(
      TRACCAR_SMS_BASE_URL,
      { to: phoneNumber, message: message },
      {
        headers: {
          Authorization: TRACCAR_SMS_TOKEN,
          "Content-Type": "application/json",
        },
        timeout: SMS_TIMEOUT,
      }
    );

    console.log("✅ SMS sent:", response.data);

    await db.query(
      `INSERT INTO logs_tbl (user_id, user_role, action, details, timestamp)
       VALUES (?, 'staff', 'SMS Reminder Sent', ?, NOW())`,
      [req.session.user.user_id, `Sent SMS reminder to ${client.firstName} (${phoneNumber})`]
    );

    return res.json({ success: true, message: "SMS sent successfully via Traccar SMS Gateway!" });
  } catch (error) {
    console.error("SMS gateway failed:", error);
    return res.status(500).json({ success: false, message: "Failed to send SMS.", error: error.message });
  }
});
// ⚠️ 3-DAY WARNING
// 🟠 3-DAY WARNING (Email + SMS with same message)
router.post("/send_warning/:id", requireStaff, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT u.user_id, u.email, u.contact_number, CONCAT(u.firstName, ' ', u.lastName) AS name,
             p.booking_id, p.payment_id, p.amount, p.due_date
      FROM payment_tbl p
      JOIN user_tbl u ON p.user_id = u.user_id
      WHERE p.payment_id = ?`, [req.params.id]);

    if (!rows.length) return res.json({ success: false, message: "Payment not found." });
    const c = rows[0];

    // 📨 Message Content (same for Email & SMS)
    const subject = "⚠️ PAYMENT REMINDER: 3 Days Remaining to Avoid Revocation";
    const message = `
Dear ${c.name},

This is a reminder that your installment payment of PHP${Number(c.amount).toLocaleString()} is now overdue by **3 days**.

Please settle your payment immediately to avoid release of your plot reservation.

If payment is not received within 7 days, your plot reservation will be revoked as per Everlasting Peace Memorial Park's policy.

Sincerely,  
Everlasting Peace Memorial Park
`;

    // ✅ Send EMAIL
    await transporter.sendMail({
      from: `"Everlasting Peace Memorial Park" <${process.env.SMTP_USER}>`,
      to: c.email,
      subject,
      text: message,
    });

    // ✅ Send SMS (same message)
    let phoneNumber = c.contact_number.replace(/\s+/g, "");
    if (phoneNumber.startsWith("0")) phoneNumber = "+63" + phoneNumber.slice(1);

    try {
      const response = await axios.post(
        TRACCAR_SMS_BASE_URL,
        { to: phoneNumber, message },
        {
          headers: {
            Authorization: TRACCAR_SMS_TOKEN,
            "Content-Type": "application/json",
          },
          timeout: SMS_TIMEOUT,
        }
      );
      console.log("✅ 3-Day Warning SMS sent:", response.data);
    } catch (smsErr) {
      console.error("❌ SMS sending error (3-Day Warning):", smsErr.message);
    }

    // ✅ Save Notification & Log
    await db.query(`
      INSERT INTO notification_tbl (user_id, booking_id, payment_id, message, is_read, datestamp)
      VALUES (?, ?, ?, ?, 0, NOW())`,
      [c.user_id, c.booking_id, c.payment_id, message]
    );

    await db.query(`
      INSERT INTO logs_tbl (user_id, user_role, action, details, timestamp)
      VALUES (?, 'staff', '3-Day Warning Sent', ?, NOW())`,
      [req.session.user.user_id, `3-Day Warning sent to ${c.name} (Email + SMS)`]
    );

    res.json({ success: true, message: "⚠️ 3-Day Warning (Email + SMS) sent successfully!" });
  } catch (err) {
    console.error("❌ Warning error:", err);
    res.json({ success: false, message: "Failed to send 3-day warning." });
  }
});


// 🔴 7-DAY FINAL WARNING
// 🔴 7-DAY FINAL WARNING (Email + SMS)
// 🔴 7-DAY FINAL WARNING (Email + SMS with same message)
router.post("/send_final_warning/:id", requireStaff, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT u.user_id, u.email, u.contact_number, CONCAT(u.firstName, ' ', u.lastName) AS name,
             p.booking_id, p.payment_id, p.amount, p.due_date
      FROM payment_tbl p
      JOIN user_tbl u ON p.user_id = u.user_id
      WHERE p.payment_id = ?`, [req.params.id]);

    if (!rows.length) return res.json({ success: false, message: "Payment not found." });
    const c = rows[0];

    // 📨 Message Content (same for Email & SMS)
    const subject = "❗ NOTICE: Plot Reservation Revoked";
    const message = `
Dear ${c.name},

We regret to inform you that your installment payment of PHP${Number(c.amount).toLocaleString()} was not received within the required time frame.

As a result, your plot reservation has been **revoked** in accordance with Everlasting Peace Memorial Park's policy.

If you wish to reinstate or apply for a new plot, please visit our office to discuss available options.

Sincerely,  
Everlasting Peace Memorial Park
`;

    // ✅ Send EMAIL
    await transporter.sendMail({
      from: `"Everlasting Peace Memorial Park" <${process.env.SMTP_USER}>`,
      to: c.email,
      subject,
      text: message,
    });

    // ✅ Send SMS (same message)
    let phoneNumber = c.contact_number.replace(/\s+/g, "");
    if (phoneNumber.startsWith("0")) phoneNumber = "+63" + phoneNumber.slice(1);

    try {
      const response = await axios.post(
        TRACCAR_SMS_BASE_URL,
        { to: phoneNumber, message },
        {
          headers: {
            Authorization: TRACCAR_SMS_TOKEN,
            "Content-Type": "application/json",
          },
          timeout: SMS_TIMEOUT,
        }
      );
      console.log("✅ Final Warning SMS sent:", response.data);
    } catch (smsErr) {
      console.error("❌ SMS sending error (Final Warning):", smsErr.message);
    }

    // ✅ Save Notification & Log
    await db.query(`
      INSERT INTO notification_tbl (user_id, booking_id, payment_id, message, is_read, datestamp)
      VALUES (?, ?, ?, ?, 0, NOW())`,
      [c.user_id, c.booking_id, c.payment_id, message]
    );

    await db.query(`
      INSERT INTO logs_tbl (user_id, user_role, action, details, timestamp)
      VALUES (?, 'staff', 'Final Warning Sent', ?, NOW())`,
      [req.session.user.user_id, `Final Warning sent to ${c.name} (Email + SMS)`]
    );

    res.json({ success: true, message: "🚨 Final Warning (Email + SMS) sent successfully!" });
  } catch (err) {
    console.error("❌ Final warning error:", err);
    res.json({ success: false, message: "Failed to send final warning." });
  }
});

// ✅ FIXED: Merge all duplicate downpayments before updating due date
router.post("/updateDueDate/:id", requireStaff, async (req, res) => {
  const paymentId = req.params.id;
  const staff = req.session.user;

  try {
    // Get main payment info
    const [payments] = await db.query(
      `SELECT payment_id, user_id, amount, payment_type, due_date, status
       FROM payment_tbl
       WHERE payment_id = ?`,
      [paymentId]
    );

    if (!payments.length)
      return res.json({ success: false, message: "Payment not found." });

    const payment = payments[0];

    // 🟢 Find all downpayments of this user that are still active
    const [duplicates] = await db.query(
      `SELECT payment_id, amount, due_date
       FROM payment_tbl
       WHERE user_id = ? AND payment_type = 'downpayment' AND status != 'Completed'
       ORDER BY due_date ASC`,
      [payment.user_id]
    );

    if (duplicates.length > 1) {
      // Merge all duplicate amounts
      const totalAmount = duplicates.reduce((sum, p) => sum + Number(p.amount), 0);
      const keepId = duplicates[0].payment_id; // Keep the oldest one
      const deleteIds = duplicates.slice(1).map(p => p.payment_id);

      // Extend due date 1 month from now
      const newDueDate = new Date();
      newDueDate.setMonth(newDueDate.getMonth() + 1);

      // Update the oldest payment record
      await db.query(
        `UPDATE payment_tbl 
         SET amount = ?, due_date = ?, status = 'Pending' 
         WHERE payment_id = ?`,
        [totalAmount, newDueDate, keepId]
      );

      // Delete the extra duplicates
      if (deleteIds.length > 0) {
        await db.query(
          `DELETE FROM payment_tbl WHERE payment_id IN (?)`,
          [deleteIds]
        );
      }

      // Log
      await db.query(
        `INSERT INTO logs_tbl (user_id, user_role, action, details, timestamp)
         VALUES (?, 'staff', 'Merged Duplicate Downpayments', ?, NOW())`,
        [staff.user_id, `Merged ${duplicates.length} payments for user ${payment.user_id}`]
      );

      return res.json({
        success: true,
        message: `Merged ${duplicates.length} duplicate downpayments into one record.`,
      });
    } else {
      // No duplicates — just extend due date
      const newDueDate = new Date();
      newDueDate.setMonth(newDueDate.getMonth() + 1);

      await db.query(
        `UPDATE payment_tbl SET due_date = ?, status = 'Ongoing' WHERE payment_id = ?`,
        [newDueDate, paymentId]
      );

      await db.query(
        `INSERT INTO logs_tbl (user_id, user_role, action, details, timestamp)
         VALUES (?, 'staff', 'Marked as Paid', ?, NOW())`,
        [staff.user_id, `Marked payment #${paymentId} as paid`]
      );

      res.json({ success: true, message: "Due date updated successfully!" });
    }
  } catch (err) {
    console.error("❌ Error merging payments:", err);
    res.json({ success: false, message: "Server error while merging payments." });
  }
});


module.exports = router;