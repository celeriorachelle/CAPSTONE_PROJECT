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
        const md = session.metadata || {};
        const plotId = md.plot_id || null;
        const opt = (md.option || md.payment_type || '').toString().toLowerCase();
        const paymentType = opt === 'downpayment' ? 'downpayment' : 'fullpayment';
        const months = md.months ? Number(md.months) : null;
        const monthly_amount = md.monthly_amount ? Number(md.monthly_amount) : null;
        const tx = session.payment_intent || session.id || null;

        await db.query(
          `INSERT INTO payment_tbl (booking_id, user_id, plot_id, amount, method, transaction_id, status, paid_at, due_date, payment_type, months, monthly_amount, total_paid)
           VALUES (?, ?, ?, ?, ?, ?, 'paid', NOW(), NULL, ?, ?, ?, ?)`,
          [bookingId, userId, plotId, amount, 'card', tx, paymentType, months, monthly_amount, amount]
        );

        console.log(`✅ Payment recorded for booking ${bookingId}, user ${userId}, ₱${amount} (type=${paymentType})`);
      } catch (dbErr) {
        console.error('❌ Failed to insert payment into DB:', dbErr);
      }
    }

    res.sendStatus(200);
  }
);

module.exports = router;
