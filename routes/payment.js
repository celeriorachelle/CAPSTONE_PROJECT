const { Router } = require("express");
const router = Router();
const db = require("../db");
const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { addLog } = require("./log_helper"); // ✅ Added for activity logs

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
      if (activeRows.length > 0) {
        return res.status(400).json({ error: "You currently have an active installment, please complete your current installment before making another transaction" });
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
      // ✅ Log successful payment
      await addLog({
        user_id: paymentData.user_id,
        user_role: req.session.user?.role || "user",
        action: "Payment Success",
        details: `User ${paymentData.user_email} completed a ${paymentData.option} for Plot #${paymentData.plot_id} (₱${paymentData.amount}).`,
      });

      // Optionally clear paymentData after logging
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

    const [rows] = await db.query(
      `SELECT 
        b.*, 
        pm.plot_number, 
        pm.location, 
        pm.price AS total_price
       FROM booking_tbl b
       JOIN plot_map_tbl pm ON b.plot_id = pm.plot_id
       WHERE b.booking_id = ?`,
      [req.params.booking_id]
    );

    if (!rows.length) {
      return res.status(404).send("Booking not found");
    }

    res.render("payment_continue", { booking: rows[0] });
  } catch (err) {
    console.error("Error fetching booking data:", err);
    res.status(500).send("Server error while loading payment continuation page");
  }
});

module.exports = router;