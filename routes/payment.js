const { Router } = require("express");
const router = Router();
const db = require("../db");
const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { addLog } = require("./log_helper");
const multer = require('multer');
const upload = multer();

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
      // Update due_date by adding 30 days
      if (paymentData.due_date) {
        const newDueDate = new Date(paymentData.due_date);
        newDueDate.setDate(newDueDate.getDate() + 30);
        await db.query(
          `UPDATE payment_tbl SET due_date = ? WHERE booking_id = ?`,
          [newDueDate.toISOString().slice(0, 10), paymentData.booking_id]
        );
      }
      // Log successful payment
      await addLog({
        user_id: paymentData.user_id,
        user_role: req.session.user?.role || "user",
        action: "Installment Payment Success",
        details: `User ${paymentData.user_email} completed an installment for Plot #${paymentData.plot_id} (₱${paymentData.monthly_amount}).`,
      });
      delete req.session.paymentData;
    }
    res.send("Payment successful!");
  } catch (err) {
    console.error("Error logging payment success:", err);
    res.status(500).send("Payment success, but log not recorded.");
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
      delete req.session.paymentData;
    }
    res.render('payment_success');
  } catch (err) {
    console.error("Error logging installment payment success:", err);
    res.status(500).send("Installment payment success, but log not recorded.");
  }
});

module.exports = router;