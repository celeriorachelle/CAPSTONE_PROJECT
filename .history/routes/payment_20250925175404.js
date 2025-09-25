const { Router } = require("express");
const router = Router();
const db = require("../db");
const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Checkout route
router.post("/checkout", async (req, res) => {
  try {
    const { booking_id, plot_id, amount, user_email, user_id, option } = req.body;

    // Ensure numeric booking_id & user_id
    const normalizedBookingId = booking_id ? parseInt(booking_id) : null;
    const normalizedUserId = user_id ? parseInt(user_id) : null;

    // ✅ Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "php",
            product_data: {
              name: `Plot #${plot_id} - ${option === "down" ? "Down Payment" : "Full Payment"}`,
            },
            unit_amount: Math.round(amount * 100), // in centavos
          },
          quantity: 1,
        },
      ],
      customer_email: user_email,
      success_url: `${process.env.BASE_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/payment/cancel`,
    });

    // ✅ Insert pending payment record
    await db.query(
      `INSERT INTO payment_tbl (booking_id, user_id, amount, method, status, transaction_id, created_at, payment_type)
       VALUES (?, ?, ?, 'card', 'pending', NULL, NOW(), ?)`,
      [normalizedBookingId, normalizedUserId, amount, option === "down" ? "downpayment" : "fullpayment"]
    );

    res.redirect(session.url);
  } catch (err) {
    console.error("Error creating checkout:", err);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// Success route
router.get("/success", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.query.session_id);

    // ✅ Update last pending payment
    await db.query(
      `UPDATE payment_tbl 
       SET status = 'paid',
           transaction_id = ?,
           paid_at = NOW()
       WHERE status = 'pending'
       ORDER BY payment_id DESC 
       LIMIT 1`,
      [session.payment_intent] // Stripe PaymentIntent ID
    );

    res.send("Payment successful!");
  } catch (err) {
    console.error("Payment success error:", err);
    res.status(500).send("Error processing payment");
  }
});

module.exports = router;
