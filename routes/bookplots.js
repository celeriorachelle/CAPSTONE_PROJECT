const express = require('express');
const router = express.Router();
const db = require('../db');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Middleware to require login
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

// --------------------------
// 1️⃣ Show Plot Selection
router.get('/', requireLogin, async (req, res) => {
  if (!req.session.bookingData) return res.redirect('/book');

  try {
    const [plots] = await db.query(`
      SELECT plot_id, plot_number, location, type, price,
             deceased_firstName, deceased_lastName, birth_date, death_date, availability
      FROM plot_map_tbl
      ORDER BY location, plot_number
    `);

    const transformedPlots = plots.map(plot => ({
      ...plot,
      availability: (plot.availability || 'available').toLowerCase()
    }));

    const plotsByLocation = {};
    transformedPlots.forEach(plot => {
      if (!plotsByLocation[plot.location]) plotsByLocation[plot.location] = [];
      plotsByLocation[plot.location].push(plot);
    });

    res.render('bookplots', { 
      title: 'Book Plots',
      plots: transformedPlots,
      plotsByLocation,
      stripeKey: process.env.STRIPE_PUBLISHABLE_KEY ||'sk_test_51SA5nICTTPxbpgoS6z1sxKYnoTdVWTWvpMmH8jfVfgPVzKxTnJMpM7WoaY7VfNqxGRkLme3wsggpws27CJVN797Z009z2yRfSy'
    });

  } catch (error) {
    console.error(error);
    res.render('bookplots', { plots: [], plotsByLocation: {} });
  }
});

// --------------------------
// 2️⃣ Show Payment Option Page
// --------------------------
// 2️⃣ Show Payment Option Page
router.get('/option/:plotId', requireLogin, async (req, res) => {
  const plotId = req.params.plotId;
  const userId = req.session.user.user_id;

  try {
    const [rows] = await db.query(
      "SELECT * FROM plot_map_tbl WHERE plot_id = ?",
      [plotId]
    );
    if (rows.length === 0) return res.status(404).send('Plot not found');

    const plot = rows[0];
    // Store selected plot info in session
    req.session.selectedPlot = plot;

    res.render('payment_option', {  
      plot,
      user: req.session.user,
      bookingData: req.session.bookingData,
      stripeKey: process.env.STRIPE_PUBLISHABLE_KEY || 'sk_test_51SA5nICTTPxbpgoS6z1sxKYnoTdVWTWvpMmH8jfVfgPVzKxTnJMpM7WoaY7VfNqxGRkLme3wsggpws27CJVN797Z009z2yRfSy'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});


// --------------------------
// 3️⃣ Create Stripe Checkout Session
router.post('/create-checkout-session', requireLogin, async (req, res) => {
      const {
        booking_id,
        user_id,
        plot_id,
        amount,
        option,
        payment_type,
        months,
        monthly_amount
      } = req.body;

      req.session.paymentData = {
        booking_id,
        user_id,
        plot_id,
        amount,
        option,
        payment_type,
        months,
        monthly_amount
      };

  try {
    const [rows] = await db.query("SELECT * FROM plot_map_tbl WHERE plot_id = ?", [plot_id]);
    if (rows.length === 0) return res.status(404).json({ error: "Plot not found" });

    const plot = rows[0];
    const minAmount = plot.price * 0.2;

    if (amount < minAmount) return res.status(400).json({ error: `Minimum payment is PHP ${minAmount}` });
    if (amount > plot.price) return res.status(400).json({ error: `Amount cannot exceed total price of PHP ${plot.price}` });

    // Use correct label for Stripe UI
    const paymentLabel = option === 'downpayment' ? 'Down Payment' : 'Full Payment';

    // Pass payment option to success_url
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'php',
          product_data: {
            name: `Plot #${plot.plot_number} (${paymentLabel})`
          },
          unit_amount: Math.round(amount * 100)
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: `${process.env.BASE_URL}/bookplots/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/bookplots/cancel`
    });

    res.json({ id: session.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// --------------------------
// 4️⃣ Stripe Success Page

// --------------------------
// Stripe Success Page
router.get('/success', async (req, res) => {
  try {
    const session_id = req.query.session_id;
    // 1️⃣ Retrieve Stripe session
    const session = await stripe.checkout.sessions.retrieve(session_id);
    // 2️⃣ Use metadata from session to get booking and plot info
    const userId = session.client_reference_id || (req.session.user && req.session.user.user_id);

    // Retrieve bookingData, selectedPlot, and paymentData from session
    const bookingData = req.session.bookingData;
    const plot = req.session.selectedPlot;
    const paymentData = req.session.paymentData;
    // Normalize possible array fields from form submission
    const norm = (v) => (Array.isArray(v) ? v[0] : v);
    const normalizedPaymentData = paymentData ? {
      ...paymentData,
      amount: paymentData.amount != null ? parseFloat(norm(paymentData.amount)) : null,
      payment_type: paymentData.payment_type != null ? norm(paymentData.payment_type) : null,
      months: paymentData.months != null ? parseInt(norm(paymentData.months), 10) : null,
      monthly_amount: paymentData.monthly_amount != null ? parseFloat(norm(paymentData.monthly_amount)) : null,
      due_date: paymentData.due_date ? norm(paymentData.due_date) : null,
    } : null;

    // Insert booking row only if all session objects exist
    let bookingId = null;
    if (bookingData && plot && paymentData) {
      const [result] = await db.query(
        `INSERT INTO booking_tbl
         (user_id, firstname, lastname, email, phone, booking_date, service_type, notes, plot_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          userId,
          bookingData.firstname,
          bookingData.lastname,
          bookingData.email,
          bookingData.phone,
          bookingData.bookingDate,
          bookingData.serviceType,
          bookingData.notes,
          plot.plot_id
        ]
      );
      bookingId = result.insertId;
      // Create notification for successful plot booking
      await db.query(
        `INSERT INTO notification_tbl (user_id, booking_id, message, is_read, datestamp, plot_id)
         VALUES (?, ?, ?, 0, NOW(), ?)`,
        [userId, bookingId, 'Your plot booking has been submitted and is pending approval.', plot.plot_id]
      );
      // Clear booking and plot session data
      req.session.bookingData = null;
      req.session.selectedPlot = null;
    }

    // 3️⃣ Insert payment record linked to booking
    if (bookingId && paymentData) {
      const paymentMethod = paymentData.option === 'downpayment' ? 'downpayment' : 'fullpayment';
     const [paymentResult] = await db.query(
        `INSERT INTO payment_tbl
          (booking_id, user_id, amount, method, transaction_id, status, paid_at, due_date, payment_type, months, monthly_amount)
        VALUES (?, ?, ?, ?, ?, 'paid', NOW(), ?, ?, ?, ?)`,
        [
          bookingId,                     // booking_id (freshly created above)
          userId,                        // user_id (from session/stripe)
          normalizedPaymentData.amount,  // amount
          'card',                        // method
          session.payment_intent,        // transaction_id
          normalizedPaymentData.due_date || null,  // due_date
          normalizedPaymentData.payment_type,      // payment_type
          normalizedPaymentData.months || null,    // months
          normalizedPaymentData.monthly_amount || null // monthly_amount
        ]
      );
      // Create notification for successful payment
      const paymentId = paymentResult.insertId;
      await db.query(
        `INSERT INTO notification_tbl (user_id, booking_id, payment_id, message, is_read, datestamp, plot_id)
         VALUES (?, ?, ?, ?, 0, NOW(), ?)`,
        [userId, bookingId, paymentId, 'Your payment has been received successfully.', plot.plot_id]
      );
      // Clear payment session data
      req.session.paymentData = null;
    }

    // 4️⃣ Update booking status and plot availability
    if (bookingId) {
      await db.query(
        `UPDATE booking_tbl b
         JOIN plot_map_tbl p ON b.plot_id = p.plot_id
         LEFT JOIN (
           SELECT booking_id, SUM(amount) AS totalPaid
           FROM payment_tbl
           GROUP BY booking_id
         ) pay ON b.booking_id = pay.booking_id
         SET b.status = CASE
             WHEN pay.totalPaid >= p.price THEN 'approved'
             WHEN pay.totalPaid >= p.price*0.2 THEN 'approved'
             ELSE 'pending'
         END,
         p.availability = CASE
             WHEN pay.totalPaid >= p.price THEN 'occupied'
             WHEN pay.totalPaid >= p.price*0.2 THEN 'reserved'
             ELSE 'available'
         END
         WHERE b.booking_id = ?`,
        [bookingId]
      );
    }

    // 5️⃣ Render success page
    res.render('payment_success', { bookingId, amount: normalizedPaymentData ? normalizedPaymentData.amount : null });

  } catch (error) {
    console.error('Payment success error:', error);
    res.status(500).send('Something went wrong');
  }
});


// --------------------------
// 5️⃣ View Installments
// bookplots.js
router.get('/installments/:bookingId', requireLogin, async (req, res) => {
  const bookingId = req.params.bookingId;

  try {
    const [bookingRows] = await db.query(
      `SELECT b.booking_id, b.plot_id, b.status AS booking_status, 
              pm.price, pm.availability
       FROM booking_tbl b
       JOIN plot_map_tbl pm ON b.plot_id = pm.plot_id
       WHERE b.booking_id = ?`,
      [bookingId]
    );

    if (bookingRows.length === 0) return res.status(404).send('Booking not found');

    const booking = bookingRows[0];

    const [payments] = await db.query(
      `SELECT * FROM payment_tbl WHERE booking_id = ? ORDER BY paid_at ASC`,
      [bookingId]
    );

    const totalPaid = payments.reduce((sum, pay) => sum + parseFloat(pay.amount), 0);
    const remaining = booking.price - totalPaid;

    res.render('installments', { booking, payments, totalPaid, remaining });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to fetch installments');
  }
});


module.exports = router;
