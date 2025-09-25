const { Router } = require("express");
const router = Router();
const db = require("../db");
const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Checkout route
router.post("/checkout", async (req, res) => {
  try {
    const { plot_id, amount, user_email, user_id, option } = req.body;

    // Store payment info in session
    req.session.paymentData = { amount, option };

    // Set label for Stripe UI
    const paymentLabel = option === "downpayment" ? "Down Payment" : "Full Payment";

    // ✅ Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "php",
            product_data: {
              name: `Plot #${plot_id} - ${paymentLabel}`,
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      customer_email: user_email,
      success_url: `${process.env.BASE_URL}/bookplots/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/payment/cancel`,
    });

    res.redirect(session.url);

  } catch (err) {
    console.error("Error creating checkout:", err);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// Success route
router.get("/success", async (req, res) => {
  // No DB insert here; handled in /bookplots/success
  res.send("Payment successful!");
});

module.exports = router;
