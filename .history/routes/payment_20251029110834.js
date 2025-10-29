const { Router } = require("express");
const router = Router();
const db = require("../db");
const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { addLog } = require("./log_helper");
const multer = require('multer');
const upload = multer();

const nodemailer = require("nodemailer");
const ejs = require("ejs");
const path = require("path");
const PDFDocument = require('pdfkit');
const crypto = require('crypto');

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER, // your email
    pass: process.env.EMAIL_PASS, // your app password
  },
});

// Helper: generate a simple PDF receipt buffer from receipt data
const generateReceiptPdf = (data) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      // Header
      doc.fontSize(18).text('Everlasting Cemetery - Payment Receipt', { align: 'center' });
      doc.moveDown(1);

      // Receipt meta
      doc.fontSize(12).text(`Receipt Date: ${data.date}`);
      doc.text(`Receipt #: R-${data.booking_id}-${Date.now()}`);
      doc.moveDown(0.5);

      // User
      doc.fontSize(13).text(`Billed To: ${data.user_name} <${data.user_email}>`);
      doc.moveDown(0.5);

      // Booking & plot
      doc.fontSize(12).text(`Booking ID: ${data.booking_id}`);
      doc.text(`Plot Number: ${data.plot_number}`);
      if (data.plot_location) doc.text(`Plot Location: ${data.plot_location}`);
      doc.moveDown(0.5);

      // Amount table-like
      doc.fontSize(12).text(`Payment Type: ${data.payment_type || 'N/A'}`);
      doc.fontSize(14).text(`Amount Paid: ₱${Number(data.amount).toFixed(2)}`, { underline: true });
      doc.moveDown(1);

      // Footer / thank you
      doc.fontSize(11).text('Thank you for your payment. Please keep this receipt for your records.', { align: 'left' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};

// Checkout route
router.post("/checkout", async (req, res) => {
  try {
    const {
      booking_id,
      user_id,
      plot_id,
      amount,
      user_email,
      option,
      payment_type,
      months,
      monthly_amount,
      due_date,
    } = req.body;

    // Normalize potential duplicate field names (e.g., months from select + hidden)
    const norm = (v) => (Array.isArray(v) ? v[0] : v);
    const n_booking_id = norm(booking_id);
    const n_user_id = norm(user_id);
    const n_plot_id = norm(plot_id);
    const n_amount = parseFloat(norm(amount));
    const n_user_email = norm(user_email);
    const n_option = norm(option);
    const n_payment_type = norm(payment_type);
    const n_months = norm(months);
    const n_monthly_amount = norm(monthly_amount);
    const n_due_date = norm(due_date);

    // Coerce installment fields to NULL for full payment
    const isFull = n_option === "fullpayment";
    const final_months = isFull ? null : (n_months ? parseInt(n_months, 10) : null);
    const final_due_date = isFull ? null : (n_due_date || null);
    const final_monthly_amount = isFull ? null : (n_monthly_amount ? parseFloat(n_monthly_amount) : null);

    // Store payment info in session
    req.session.paymentData = {
      booking_id: n_booking_id,
      user_id: n_user_id,
      plot_id: n_plot_id,
      amount: n_amount,
      user_email: n_user_email,
      option: n_option,
      payment_type: n_option === "downpayment" ? "downpayment" : "fullpayment",
      months: final_months,
      monthly_amount: final_monthly_amount,
      due_date: final_due_date,
    };

    // Set label for Stripe UI
    const paymentLabel = n_option === "downpayment" ? "Down Payment" : "Full Payment";

    // Check for active installment if downpayment
    if (n_option === "downpayment") {
      const [activeRows] = await db.query(
        `SELECT * FROM payment_tbl WHERE user_id = ? AND status = 'active'`,
        [n_user_id]
      );
      // Allow payment if booking_id matches the active installment
      if (activeRows.length > 0) {
        const activeBooking = activeRows[0].booking_id;
        if (activeBooking !== n_booking_id) {
          return res.status(400).json({ error: "You currently have an active installment, please complete your current installment before making another transaction" });
        }
        // else: allow payment for current installment
      }
    }

    // ✅ Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "php",
            product_data: {
              name: `Plot #${n_plot_id} - ${paymentLabel}`,
            },
            unit_amount: Math.round(n_amount * 100),
          },
          quantity: 1,
        },
      ],
      customer_email: n_user_email,
      success_url: `${process.env.BASE_URL}/bookplots/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/payment/cancel`,
    });

    // ✅ Add log for payment initiation
    await addLog({
      user_id: n_user_id,
      user_role: req.session.user?.role || "user",
      action: "Payment Initiated",
      details: `User ${n_user_email} started a ${paymentLabel.toLowerCase()} for Plot #${n_plot_id} (₱${n_amount}).`,
    });

    // Respond with JSON containing Stripe session URL for fetch/AJAX
    res.json({ url: session.url });
  } catch (err) {
    console.error("Error creating checkout:", err);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// Success route
router.get("/success", async (req, res) => {
  try {
    const paymentData = req.session.paymentData;
    if (paymentData) {
      // -------------------- Existing logic --------------------
      if (paymentData.due_date) {
        const newDueDate = new Date(paymentData.due_date);
        newDueDate.setDate(newDueDate.getDate() + 30);
        await db.query(
          `UPDATE payment_tbl SET due_date = ? WHERE booking_id = ?`,
          [newDueDate.toISOString().slice(0, 10), paymentData.booking_id]
        );
      }

      if (paymentData.booking_id && paymentData.user_id) {
        try {
          await db.query(
            `UPDATE booking_tbl SET status = 'approved' WHERE booking_id = ?`,
            [paymentData.booking_id]
          );
          await db.query(
            `INSERT INTO notification_tbl (user_id, booking_id, message, is_read, datestamp, plot_id)
             VALUES (?, ?, ?, 0, NOW(), ?)`,
            [paymentData.user_id, paymentData.booking_id, 'Your plot booking is approved! Thanks for choose Everlasting', paymentData.plot_id || null]
          );
          await addLog({
            user_id: paymentData.user_id,
            user_role: req.session.user?.role || "user",
            action: "Payment Success & Booking Approved",
            details: `User ${paymentData.user_email} payment succeeded for Plot #${paymentData.plot_id} (₱${paymentData.amount || paymentData.monthly_amount}). Booking ${paymentData.booking_id} approved.`,
          });
        } catch (approveErr) {
          console.error('Error auto-approving booking after payment:', approveErr);
        }
      }

      // -------------------- Generate and send receipt --------------------
      // Fetch booking and plot details
      const [bookingRows] = await db.query(
        `SELECT b.*, CONCAT(u.firstName, ' ', u.lastName) AS user_name, u.email AS user_email, 
                pm.plot_number, pm.location, pm.price 
         FROM booking_tbl b
         JOIN user_tbl u ON b.user_id = u.user_id
         JOIN plot_map_tbl pm ON b.plot_id = pm.plot_id
         WHERE b.booking_id = ? LIMIT 1`,
        [paymentData.booking_id]
      );

      if (bookingRows.length) {
        const booking = bookingRows[0];
        // Build receipt data used for PDF/attachment
        const receiptData = {
          booking_id: booking.booking_id,
          user_name: booking.user_name || `${booking.firstname || ''} ${booking.lastname || ''}`.trim(),
          user_email: booking.email || booking.user_email,
          plot_number: booking.plot_number,
          plot_location: booking.location,
          amount: paymentData.amount || paymentData.monthly_amount,
          payment_type: paymentData.payment_type,
          date: new Date().toLocaleDateString("en-PH"),
        };

        // Render receipt EJS (the template expects a `booking` object)
        const receiptHtml = await ejs.renderFile(
          path.join(__dirname, "../views/receipt.ejs"),
          { booking }
        );

        // Send receipt via email (attach generated PDF)
        const pdfBuffer = await generateReceiptPdf(receiptData);
        const token = generateReceiptToken(receiptData.booking_id);
        const downloadUrl = `${process.env.BASE_URL}/payment/receipt/${receiptData.booking_id}?token=${encodeURIComponent(token)}`;
        const fullHtml = receiptHtml + `<p><a href="${downloadUrl}">Download receipt (PDF)</a></p>`;

        await transporter.sendMail({
          from: `"Everlasting Cemetery" <${process.env.EMAIL_USER}>`,
          to: receiptData.user_email,
          subject: `Receipt for Payment - Plot #${receiptData.plot_number}`,
          html: fullHtml,
          attachments: [
            {
              filename: `receipt-${receiptData.booking_id}.pdf`,
              content: pdfBuffer,
              contentType: 'application/pdf'
            }
          ]
        });
        // Notify staff about this payment (create table if not exists then insert)
        try {
          await db.query(`
            CREATE TABLE IF NOT EXISTS staff_notifications (
              id INT AUTO_INCREMENT PRIMARY KEY,
              ref_id INT,
              user_id INT,
              message VARCHAR(255),
              datestamp DATETIME,
              is_read BOOLEAN DEFAULT 0
            )
          `);
          const staffMsg = `User ${receiptData.user_name || receiptData.user_email} paid ${receiptData.payment_type || 'payment'} for Plot #${receiptData.plot_number} (₱${Number(receiptData.amount).toFixed(2)})`;
          await db.query(
            `INSERT INTO staff_notifications (ref_id, user_id, message, datestamp) VALUES (?, ?, ?, NOW())`,
            [receiptData.booking_id, booking.user_id || paymentData.user_id, staffMsg]
          );
        } catch (staffNotifyErr) {
          console.error('Failed to insert staff notification (success):', staffNotifyErr);
        }
        }

      // Prepare locals for template (defensive: ensure amount/tx/paid_at are provided)
      const amountVal = paymentData.amount != null ? paymentData.amount : (paymentData.monthly_amount != null ? paymentData.monthly_amount : null);
      const txVal = null; // no transaction id available in this flow
      const paidAtVal = new Date().toISOString().slice(0, 19).replace('T', ' ');

      delete req.session.paymentData;

      // Render success page with consistent locals
      res.render("payment_success", { bookingId: paymentData.booking_id, amount: amountVal, transaction_id: txVal, paid_at: paidAtVal });
    }
  } catch (err) {
    console.error("Error logging payment success or sending receipt:", err);
    res.status(500).send("Payment success, but log or receipt not recorded.");
  }
});

// ✅ Added route for "Continue Payment"
router.get("/continue/:booking_id", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");

    // Fetch booking, plot info, and user email
    const [rows] = await db.query(
      `SELECT 
        b.*, 
        pm.plot_number, 
        pm.location, 
        pm.price AS total_price,
        u.email AS user_email
       FROM booking_tbl b
       JOIN plot_map_tbl pm ON b.plot_id = pm.plot_id
       JOIN user_tbl u ON b.user_id = u.user_id
       WHERE b.booking_id = ?`,
      [req.params.booking_id]
    );

    if (!rows.length) {
      return res.status(404).send("Booking not found");
    }

    // Fetch monthly_amount and due_date from payment_tbl
    const [paymentRows] = await db.query(
      `SELECT monthly_amount, due_date FROM payment_tbl WHERE booking_id = ? LIMIT 1`,
      [req.params.booking_id]
    );
    if (paymentRows.length) {
      rows[0].monthly_amount = paymentRows[0].monthly_amount;
      rows[0].due_date = paymentRows[0].due_date;
    } else {
      rows[0].monthly_amount = null;
      rows[0].due_date = null;
    }

    res.render("payment_continue", { booking: rows[0] });
  } catch (err) {
    console.error("Error fetching booking data:", err);
    res.status(500).send("Server error while loading payment continuation page");
  }
});

// Installment Checkout route (no active installment check)
router.post("/installment-checkout", upload.none(), async (req, res) => {
  try {
    // Debug: log all received fields
    console.log('Received fields:', req.body);
    const norm = (v) => (Array.isArray(v) ? v[0] : v);
    const booking_id = norm(req.body.booking_id);
    const user_id = norm(req.body.user_id);
    const plot_id = norm(req.body.plot_id);
    const user_email = norm(req.body.user_email);
    // Validate user_email
    if (!user_email || typeof user_email !== "string" || !user_email.includes("@")) {
      return res.status(400).json({ error: "Invalid or missing user email address." });
    }
    // Fetch monthly_amount and due_date from payment_tbl
    const [paymentRows] = await db.query(
      `SELECT monthly_amount, due_date FROM payment_tbl WHERE booking_id = ? LIMIT 1`,
      [booking_id]
    );
    let monthly_amount = paymentRows.length ? paymentRows[0].monthly_amount : 0;
    let current_due_date = paymentRows.length ? paymentRows[0].due_date : null;
    // Create Stripe session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "php",
            product_data: {
              name: `Plot #${plot_id} - Installment Payment`,
            },
            unit_amount: Math.round(monthly_amount * 100),
          },
          quantity: 1,
        },
      ],
      customer_email: user_email,
      success_url: `${process.env.BASE_URL}/payment/installment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/payment/cancel`,
    });
    // Store payment info in session
    req.session.paymentData = {
      booking_id,
      user_id,
      plot_id,
      user_email,
      monthly_amount,
      due_date: current_due_date,
    };
    // Log payment initiation
    await addLog({
      user_id,
      user_role: req.session.user?.role || "user",
      action: "Installment Payment Initiated",
      details: `User ${user_email} started an installment for Plot #${plot_id} (₱${monthly_amount}).`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error("Error creating installment checkout:", err);
    res.status(500).json({ error: "Failed to create installment checkout session" });
  }
});

// Installment Success route
router.get("/installment-success", async (req, res) => {
  try {
    const paymentData = req.session.paymentData;
    if (paymentData) {
      // Get previous payment record for this plot_id
      const [prevPayments] = await db.query(
        `SELECT due_date, total_paid FROM payment_tbl WHERE plot_id = ? ORDER BY paid_at DESC LIMIT 1`,
        [paymentData.plot_id]
      );
      let prevDueDate = prevPayments.length ? prevPayments[0].due_date : paymentData.due_date;
      let prevTotalPaid = prevPayments.length ? Number(prevPayments[0].total_paid) : 0;
      // Calculate new due_date and total_paid
      const newDueDate = prevDueDate ? new Date(prevDueDate) : new Date();
      newDueDate.setDate(newDueDate.getDate() + 30);
      const newTotalPaid = prevTotalPaid + Number(paymentData.monthly_amount);
      // Insert new payment record (fix column count)
      const [insertResult] = await db.query(
        `INSERT INTO payment_tbl (booking_id, user_id, plot_id, amount, method, transaction_id, status, paid_at, due_date, payment_type, months, monthly_amount, total_paid)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?)`,
        [
          paymentData.booking_id,
          paymentData.user_id,
          paymentData.plot_id,
          paymentData.monthly_amount,
          'card',
          req.query.session_id || null,
          'active',
          newDueDate.toISOString().slice(0, 10),
          paymentData.payment_type || 'downpayment',
          paymentData.months || null,
          paymentData.monthly_amount,
          newTotalPaid
        ]
      );
      const newPaymentId = insertResult.insertId;
  console.log('Installment-success: inserted payment id=', newPaymentId);
  console.log('Installment-success: paymentData snapshot=', paymentData);
      // Log successful payment
      await addLog({
        user_id: paymentData.user_id,
        user_role: req.session.user?.role || "user",
        action: "Installment Payment Success",
        details: `User ${paymentData.user_email} completed an installment for Plot #${paymentData.plot_id} (₱${paymentData.monthly_amount}).`,
      });
      // Check if total_paid equals price, then update status and availability
      const [checkRows] = await db.query(
        `SELECT pt.total_paid, pm.price FROM payment_tbl pt JOIN plot_map_tbl pm ON pt.plot_id = pm.plot_id WHERE pt.payment_id = ? LIMIT 1`,
        [newPaymentId]
      );
      if (checkRows.length && Number(checkRows[0].total_paid) >= Number(checkRows[0].price)) {
        await db.query(
          `UPDATE plot_map_tbl SET availability = 'occupied' WHERE plot_id = ?`,
          [paymentData.plot_id]
        );
        await db.query(
          `UPDATE payment_tbl SET status = 'paid' WHERE plot_id = ?`,
          [paymentData.plot_id]
        );
      }

      // Attempt to fetch booking/user/plot details and email a PDF receipt for the installment
      try {
        const [bookingRows] = await db.query(
          `SELECT b.*, CONCAT(u.firstName, ' ', u.lastName) AS user_name, u.email AS user_email, pm.plot_number, pm.location, pm.price
           FROM booking_tbl b
           JOIN user_tbl u ON b.user_id = u.user_id
           JOIN plot_map_tbl pm ON b.plot_id = pm.plot_id
           WHERE b.booking_id = ? LIMIT 1`,
          [paymentData.booking_id]
        );
        if (bookingRows.length) {
          const booking = bookingRows[0];
          const receiptData = {
            booking_id: booking.booking_id,
            user_name: booking.user_name || `${booking.firstname || ''} ${booking.lastname || ''}`.trim(),
            user_email: booking.email || booking.user_email,
            plot_number: booking.plot_number,
            plot_location: booking.location,
            amount: paymentData.monthly_amount || paymentData.amount,
            payment_type: paymentData.payment_type || 'downpayment',
            date: new Date().toLocaleDateString('en-PH')
          };

          const receiptHtml = await ejs.renderFile(path.join(__dirname, '../views/receipt.ejs'), { booking });
          const pdfBuffer = await generateReceiptPdf(receiptData);
          const token = generateReceiptToken(receiptData.booking_id);
          const downloadUrl = `${process.env.BASE_URL}/payment/receipt/${receiptData.booking_id}?token=${encodeURIComponent(token)}`;
          const fullHtml = receiptHtml + `<p><a href="${downloadUrl}">Download receipt (PDF)</a></p>`;
          await transporter.sendMail({
            from: `"Everlasting Cemetery" <${process.env.EMAIL_USER}>`,
            to: receiptData.user_email,
            subject: `Receipt for Payment - Plot #${receiptData.plot_number}`,
            html: fullHtml,
            attachments: [{ filename: `receipt-${receiptData.booking_id}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]
          });
          // Notify staff about this installment payment
          try {
            await db.query(`
              CREATE TABLE IF NOT EXISTS staff_notifications (
                id INT AUTO_INCREMENT PRIMARY KEY,
                ref_id INT,
                user_id INT,
                message VARCHAR(255),
                datestamp DATETIME,
                is_read BOOLEAN DEFAULT 0
              )
            `);
            const staffMsg = `User ${receiptData.user_name || receiptData.user_email} paid ${receiptData.payment_type || 'installment'} for Plot #${receiptData.plot_number} (₱${Number(receiptData.amount).toFixed(2)})`;
            await db.query(`INSERT INTO staff_notifications (ref_id, user_id, message, datestamp) VALUES (?, ?, ?, NOW())`, [receiptData.booking_id, booking.user_id || paymentData.user_id, staffMsg]);
          } catch (sErr) {
            console.error('Failed to insert staff notification (installment):', sErr);
          }
        }
      } catch (mailErr) {
        console.error('Failed to generate/send installment receipt email:', mailErr);
      }
      // Prepare locals for template
      let amountVal = paymentData.monthly_amount != null ? paymentData.monthly_amount : (paymentData.amount != null ? paymentData.amount : null);
      let txVal = req.query.session_id || null;
      let paidAtVal = new Date().toISOString().slice(0,19).replace('T',' ');

      // Fallback: fetch the newly inserted payment row to populate missing locals
      try {
        const [newRows] = await db.query(
          `SELECT payment_id, amount, transaction_id, paid_at FROM payment_tbl WHERE payment_id = ? LIMIT 1`,
          [newPaymentId]
        );
        console.log('Installment-success: fetched inserted payment row:', newRows);
        if (newRows.length) {
          const nr = newRows[0];
          if (amountVal == null && nr.amount != null) amountVal = Number(nr.amount);
          if (!txVal && nr.transaction_id) txVal = nr.transaction_id;
          if ((!paidAtVal || paidAtVal === '') && nr.paid_at) {
            const d = new Date(nr.paid_at);
            paidAtVal = d.toISOString().slice(0,19).replace('T',' ');
          }
        }
      } catch (fetchErr) {
        console.error('Failed to fetch inserted payment row for fallback locals:', fetchErr);
      }

      console.log('Installment-success: locals before render ->', { amountVal, txVal, paidAtVal });

      delete req.session.paymentData;
      res.render('payment_success', { bookingId: paymentData.booking_id, amount: amountVal, transaction_id: txVal, paid_at: paidAtVal });
    }
  } catch (err) {
    console.error("Error logging installment payment success:", err);
    res.status(500).send("Installment payment success, but log not recorded.");
  }
});

module.exports = router;

// Serve downloadable receipt PDF for a booking (authorized users only)
router.get('/receipt/:booking_id', async (req, res) => {
  try {
    const bookingId = req.params.booking_id;
    const [rows] = await db.query(
      `SELECT b.booking_id, b.user_id, CONCAT(u.firstName, ' ', u.lastName) AS user_name, u.email AS user_email, pm.plot_number, pm.location
       FROM booking_tbl b
       JOIN user_tbl u ON b.user_id = u.user_id
       JOIN plot_map_tbl pm ON b.plot_id = pm.plot_id
       WHERE b.booking_id = ? LIMIT 1`,
      [bookingId]
    );
    if (!rows.length) return res.status(404).send('Booking not found');
    const booking = rows[0];

    // Authorization: allow booking owner or admin, or allow a valid signed token
    const sessionUser = req.session.user;
    const token = req.query.token;
    if (!sessionUser || (sessionUser.user_id !== booking.user_id && sessionUser.role !== 'admin')) {
      // If token provided, verify it
      if (!token) return res.status(403).send('Not authorized to download this receipt');
      const vt = verifyReceiptToken(token);
      if (!vt.ok || String(vt.bookingId) !== String(bookingId)) {
        return res.status(403).send('Not authorized to download this receipt');
      }
    }

    const receiptData = {
      booking_id: booking.booking_id,
      user_name: booking.user_name,
      user_email: booking.user_email,
      plot_number: booking.plot_number,
      plot_location: booking.location,
      amount: req.query.amount || null,
      payment_type: req.query.payment_type || null,
      date: new Date().toLocaleDateString('en-PH')
    };

    const pdfBuffer = await generateReceiptPdf(receiptData);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=receipt-${booking.booking_id}.pdf`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Error generating downloadable receipt:', err);
    res.status(500).send('Failed to generate receipt');
  }
});

// Token helpers for downloadable receipt links (signed, short-lived)
const RECEIPT_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const getReceiptSecret = () => process.env.RECEIPT_TOKEN_SECRET || process.env.EMAIL_USER || 'change_this_secret';

function generateReceiptToken(bookingId) {
  const secret = getReceiptSecret();
  const exp = Math.floor(Date.now() / 1000) + RECEIPT_TTL_SECONDS;
  const data = `${bookingId}:${exp}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('hex');
  const token = Buffer.from(data).toString('base64') + '.' + sig;
  return token;
}

function verifyReceiptToken(token) {
  try {
    const secret = getReceiptSecret();
    const parts = String(token).split('.');
    if (parts.length !== 2) return { ok: false };
    const data = Buffer.from(parts[0], 'base64').toString('utf8');
    const sig = parts[1];
    const expected = crypto.createHmac('sha256', secret).update(data).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return { ok: false };
    const [bookingId, expStr] = data.split(':');
    const exp = parseInt(expStr, 10);
    if (isNaN(exp) || Math.floor(Date.now() / 1000) > exp) return { ok: false };
    return { ok: true, bookingId };
  } catch (err) {
    return { ok: false };
  }
}