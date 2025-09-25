const express = require('express');
const router = express.Router();
const bodyParser = require('body-parser');
const db = require('../db');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Stripe webhook endpoint
router.post(
  '/webhook',
  bodyParser.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('❌ Webhook signature verification failed:', err.message);
      return res.sendStatus(400);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      const bookingId = session.metadata.booking_id;
      const userId = session.metadata.user_id;
      const amount = session.amount_total / 100; // in PHP

      try {
        await db.query(
          `INSERT INTO payment_tbl 
           (booking_id, user_id, amount, payment_date, method, status) 
           VALUES (?, ?, ?, NOW(), 'Stripe', 'paid')`,
          [bookingId, userId, amount]
        );

        console.log(`✅ Payment recorded for booking ${bookingId}, user ${userId}, ₱${amount}`);
      } catch (dbErr) {
        console.error('❌ Failed to insert payment into DB:', dbErr);
      }
    }

    res.sendStatus(200);
  }
);

module.exports = router;
