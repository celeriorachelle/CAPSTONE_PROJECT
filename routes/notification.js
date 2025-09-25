// routes/notifications.js
const express = require("express");
const router = express.Router();
const db = require("../db"); // DB connection
const nodemailer = require("nodemailer");

// Middleware: require login
function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect("/login");
  }
  next();
}
// ✅ Configure Nodemailer Transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER || "202201747@cityofmalabonuniversity.edu.ph",
    pass: process.env.EMAIL_PASS || "tddliodmukqijtiw",
  },
});

/**
 * Send installment reminder (in-app + email)
 */
router.post("/send-reminder", requireLogin, async (req, res) => {
  const { booking_id } = req.body;

  try {
    // Fetch booking + client details
    const [rows] = await db.query(
      `SELECT b.booking_id, b.user_id, CONCAT(b.firstname, ' ', b.lastname) AS clientName,
              b.email, b.phone, pm.plot_number, pm.location
       FROM booking_tbl b
       LEFT JOIN plot_map_tbl pm ON b.plot_id = pm.plot_id
       WHERE b.booking_id = ?`,
      [booking_id]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).send("Booking not found");
    }

    const booking = rows[0];

    // ✅ In-app notification
    const message = `Reminder: Your installment for plot ${booking.plot_number || "-"} (${booking.location || "-"}) is due soon.`;
    await db.query(
      `INSERT INTO notification_tbl (user_id, booking_id, message, is_read, datestamp)
       VALUES (?, ?, ?, 0, NOW())`,
      [booking.user_id, booking.booking_id, message]
    );

    // ✅ Email reminder
    if (booking.email) {
      const mailOptions = {
        from: `"Everlasting Peace Memorial Park" <${process.env.EMAIL_USER}>`,
        to: booking.email,
        subject: "Installment Payment Reminder",
        html: `
          <p>Dear ${booking.clientName},</p>
          <p>This is a friendly reminder that your installment for 
          <strong>Plot ${booking.plot_number || "-"} (${booking.location || "-"})</strong> 
          is due soon.</p>
          <p>Please ensure payment is completed to avoid cancellation of your reservation.</p>
          <br>
          <p>Thank you,</p>
          <p><strong>Everlasting Peace Memorial Park</strong></p>
        `,
      };

      await transporter.sendMail(mailOptions);
      console.log(`📧 Reminder email sent to ${booking.clientName} (${booking.email})`);
    }

    res.redirect("/adminviewapp/installments/reminders");
  } catch (err) {
    console.error("Error sending reminder:", err);
    res.status(500).send("Failed to send reminder");
  }
});

module.exports = router;
