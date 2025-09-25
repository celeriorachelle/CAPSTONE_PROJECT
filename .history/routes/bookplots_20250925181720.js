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

router.get('/option/:plotId', requireLogin, async (req, res) => {
  const plotId = req.params.plotId;
  const userId = req.session.user.user_id;

  try {
    // Get plot info
    const [plotRows] = await db.query("SELECT * FROM plot_map_tbl WHERE plot_id = ?", [plotId]);
    if (plotRows.length === 0) return res.status(404).send('Plot not found');
    const plot = plotRows[0];

    // Check if booking exists
    const [bookingRows] = await db.query(
      "SELECT * FROM booking_tbl WHERE plot_id = ? AND user_id = ? LIMIT 1",
      [plotId, userId]
    );

    let bookingId;
    if (bookingRows.length > 0) {
      bookingId = bookingRows[0].booking_id;
    } else {
      // Create full booking
      const [result] = await db.query(
        `INSERT INTO booking_tbl 
         (user_id, plot_id, service_type, status, booking_date, visit_time, created_at)
         VALUES (?, ?, 'plot-booking', 'pending', NOW(), '09:00', NOW())`,
        [userId, plotId]
      );
      bookingId = result.insertId;
    }

    res.render('payment_option', {
      plot,
      bookingId,
      user: req.session.user,
      stripeKey: process.env.STRIPE_PUBLISHABLE_KEY
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});



router.post('/create-checkout-session', requireLogin, async (req, res) => {
  const { plot_id, amount, booking_id } = req.body;
  const userId = req.session.user.user_id;

  try {
    const [plotRows] = await db.query("SELECT * FROM plot_map_tbl WHERE plot_id = ?", [plot_id]);
    if (plotRows.length === 0) return res.status(404).json({ error: "Plot not found" });

    const plot = plotRows[0];
    const minAmount = plot.price * 0.2;

    if (amount < minAmount) return res.status(400).json({ error: `Minimum payment is PHP ${minAmount}` });
    if (amount > plot.price) return res.status(400).json({ error: `Amount cannot exceed total price of PHP ${plot.price}` });

    // Create Stripe session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'php',
          product_data: {
            name: `Plot #${plot.plot_number} (${amount >= plot.price ? 'Full Payment' : 'Down Payment'})`
          },
          unit_amount: Math.round(amount * 100)
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: `${process.env.BASE_URL}/bookplots/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/bookplots/cancel`,
      client_reference_id: userId,
      metadata: {
        booking_id: booking_id,
        plot_id: plot_id,
        service_type: 'plot-booking'
      }
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
    const bookingId = session.metadata.booking_id;
    const plotId = session.metadata.plot_id;
    const amount = session.amount_total / 100;

    // 3️⃣ Insert payment record linked to booking
    await db.query(
      `INSERT INTO payment_tbl
        (booking_id, user_id, amount, method, transaction_id, status, paid_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'paid', NOW(), NOW())`,
      [
        bookingId,
        session.client_reference_id,
        amount,
        session.payment_method_types[0] || 'card',
        session.payment_intent
      ]
    );

    // 4️⃣ Update booking status and plot availability
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

    // 5️⃣ Render success page
    res.render('payment_success', { bookingId, amount });

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
