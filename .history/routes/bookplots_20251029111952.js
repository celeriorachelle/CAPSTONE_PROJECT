const express = require('express');
const router = express.Router();
const db = require('../db');
const cache = require('./redis'); // Redis wrapper
const { getAIRecommendations } = require('./ai');
const { v4: uuidv4 } = require('uuid');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fs = require('fs');
const path = require('path');

// Middleware: require login
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

  router.get('/', requireLogin, async (req, res) => {
    const userId = req.session.user.user_id;

    try {
      // robust parse for preferences and cache values
      const rawPrefs = await cache.get(`user_preferences:${userId}`);
      let userPreferences;
      if (rawPrefs == null) userPreferences = {};
      else if (typeof rawPrefs === 'string') {
        try { userPreferences = JSON.parse(rawPrefs); } catch (e) { userPreferences = {}; }
      } else userPreferences = rawPrefs;

      const cacheKey = `ai_recommendations:${userId}`;
      const rawRecs = await cache.get(cacheKey);
      const recommendations = (() => {
        if (!rawRecs) return null;
        if (Array.isArray(rawRecs)) return rawRecs;
        if (typeof rawRecs === 'string') {
          try { const parsed = JSON.parse(rawRecs); return Array.isArray(parsed) ? parsed : null; } catch (e) { return null; }
        }
        return null;
      })();

      // Check booking history
      const [pastBookingsCount] = await db.query(
        `SELECT COUNT(*) AS count FROM booking_tbl WHERE user_id = ?`,
        [userId]
      );
      const hasHistory = pastBookingsCount[0].count > 0;

      // Check if preferences actually contain selections
      const hasPreferences = userPreferences && (
        (Array.isArray(userPreferences.locations) && userPreferences.locations.length > 0) ||
        (Array.isArray(userPreferences.types) && userPreferences.types.length > 0) ||
        (typeof userPreferences.minPrice === 'number' && userPreferences.minPrice > 0) ||
        (typeof userPreferences.maxPrice === 'number' && userPreferences.maxPrice < Number.MAX_SAFE_INTEGER)
      );

      let finalRecommendations = recommendations;
      if ((!finalRecommendations || finalRecommendations.length === 0) && (hasPreferences || hasHistory)) {
        const aiRecs = await getAIRecommendations(userId, userPreferences || {});
        finalRecommendations = aiRecs;

        await cache.set(cacheKey, finalRecommendations, 600);
        const expiresAt = new Date(Date.now() + 600 * 1000)
          .toISOString().slice(0, 19).replace('T', ' ');
        await db.query(`
          INSERT INTO ai_recommendation_cache_tbl (cache_id, user_id, data, created_at, expires_at)
          VALUES (?, ?, ?, NOW(), ?)
          ON DUPLICATE KEY UPDATE data=VALUES(data), created_at=NOW(), expires_at=VALUES(expires_at)
        `, [uuidv4(), userId, JSON.stringify(finalRecommendations), expiresAt]);
      } else if (!finalRecommendations) {
        finalRecommendations = [];
      }
    console.log('📊 BOOKPLOTS - Loaded userPreferences:', userPreferences);

      // Fetch available plots (pagination)
      const page = parseInt(req.query.page) || 1;
      const limit = 10;
      const [countRows] = await db.query(
        `SELECT COUNT(DISTINCT plot_number) AS total FROM plot_map_tbl`
      );
      const totalPlots = countRows[0].total;
      const offset = (page - 1) * limit;

      const [rows] = await db.query(
        `SELECT t.plot_id, t.plot_number, t.location, t.type, t.price, t.availability
        FROM plot_map_tbl t
        JOIN (
          SELECT plot_number, MIN(plot_id) AS min_id
          FROM plot_map_tbl
          GROUP BY plot_number
        ) x ON x.min_id = t.plot_id
        ORDER BY t.location, t.plot_number
        LIMIT ? OFFSET ?`,
        [limit, offset]
      );

      const plots = rows.map(p => ({
        ...p,
        availability: (p.availability || 'available').toLowerCase()
      }));

      res.render('bookplots', {
        title: 'Book Plots',
        recommendations: finalRecommendations || [],
        plots,
        currentPage: page,
        totalPages: Math.ceil(totalPlots / limit)
      });

    } catch (err) {
      console.error('Error in bookplots route:', err);
      res.render('bookplots', {
        title: 'Book Plots',
        recommendations: [],
        plots: [],
        currentPage: 1,
        totalPages: 1
      });
    }
  });


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
      cancel_url: `${process.env.BASE_URL}/bookplots/cancel`,
      client_reference_id: String(req.session.user.user_id),
      metadata: {
        user_id: String(req.session.user.user_id),
        plot_id: String(plot_id),
        option: String(option || ''),
        payment_type: String(payment_type || ''),
        months: String(months || ''),
        monthly_amount: String(monthly_amount || ''),
        amount: String(amount)
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
    const userId = session.client_reference_id || (req.session.user && req.session.user.user_id);

    // Retrieve bookingData, selectedPlot, and paymentData from session
    const bookingData = req.session.bookingData;
    let plot = req.session.selectedPlot;
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

    // Fallback: if selectedPlot missing, try Stripe metadata
    const md = session.metadata || {};
    if (!plot && md.plot_id) {
      const [pRows] = await db.query("SELECT * FROM plot_map_tbl WHERE plot_id = ?", [md.plot_id]);
      if (Array.isArray(pRows) && pRows.length > 0) {
        plot = pRows[0];
      }
    }

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
        [userId, bookingId, 'Your plot booking has been submitted and approved.', plot.plot_id]
      );
      // Create staff notification for new booking
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
        const [userData] = await db.query('SELECT firstName, lastName FROM user_tbl WHERE user_id = ? LIMIT 1', [userId]);
        const userName = userData.length ? `${userData[0].firstName} ${userData[0].lastName}` : 'A user';
        const staffMsg = `New booking from ${userName} for Plot #${plot.plot_number} (${bookingData.serviceType})`;
        await db.query(
          `INSERT INTO staff_notifications (ref_id, user_id, message, datestamp) VALUES (?, ?, ?, NOW())`,
          [bookingId, userId, staffMsg]
        );
      } catch (staffErr) {
        console.error('Error creating staff notification for booking:', staffErr);
      }
      // Clear booking and plot session data
      req.session.bookingData = null;
      req.session.selectedPlot = null;
    }
    await cache.del(`ai_recommendations:${userId}`);

  // Optional: also clear DB cache version
  await db.query(`DELETE FROM ai_recommendation_cache_tbl WHERE user_id = ?`, [userId]);

    // 3️⃣ Insert payment record linked to booking
    let transactionId = null;
    let paidAt = null;
    let finalAmount = normalizedPaymentData ? normalizedPaymentData.amount : null;
    if (bookingId && paymentData) {
      const paymentMethod = paymentData.option === 'downpayment' ? 'downpayment' : 'fullpayment';
      const paymentStatus = paymentMethod === 'downpayment' ? 'active' : 'paid';

      // PATCH: Mark previous 'active' payment as 'paid' before inserting new 'active' payment
      if (paymentStatus === 'active') {
        // Only for installment payments, not full payment
        await db.query(
          `UPDATE payment_tbl SET status = 'paid' WHERE booking_id = ? AND status = 'active'`,
          [bookingId]
        );
      }

      const [paymentResult] = await db.query(
        `INSERT INTO payment_tbl
          (booking_id, user_id, plot_id, amount, method, transaction_id, status, paid_at, due_date, payment_type, months, monthly_amount, total_paid)
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?)`,
        [
          bookingId,
          userId,
          (plot && plot.plot_id) ? plot.plot_id : null,
          normalizedPaymentData.amount,
          'card',
          session.payment_intent,
          paymentStatus,
          normalizedPaymentData.due_date || null,
          normalizedPaymentData.payment_type,
          normalizedPaymentData.months || null,
          normalizedPaymentData.monthly_amount || null,
          normalizedPaymentData.amount
        ]
      );
      // Create notification for successful payment
      const paymentId = paymentResult.insertId;
      await db.query(
        `INSERT INTO notification_tbl (user_id, booking_id, payment_id, message, is_read, datestamp, plot_id)
         VALUES (?, ?, ?, ?, 0, NOW(), ?)`,
        [userId, bookingId, paymentId, 'Your payment has been received successfully.', plot.plot_id]
      );

      // Capture transaction id and paid_at from the inserted payment row
      transactionId = session.payment_intent || null;
      try {
        const [paidRows] = await db.query('SELECT paid_at FROM payment_tbl WHERE payment_id = ?', [paymentId]);
        if (Array.isArray(paidRows) && paidRows.length > 0) {
          paidAt = paidRows[0].paid_at;
        }
      } catch (e) {
        console.warn('Could not retrieve paid_at:', e);
      }

      // Clear payment session data
      req.session.paymentData = null;
      // Mark plot owner as current user (on successful payment)
      if (plot && plot.plot_id) {
        await db.query('UPDATE plot_map_tbl SET user_id = ? WHERE plot_id = ?', [userId, plot.plot_id]);
      }
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
    } else if (plot && normalizedPaymentData && typeof normalizedPaymentData.amount === 'number') {
      // If booking was not created for any reason, still reflect availability based on payment amount
      const amountPaid = normalizedPaymentData.amount;
      const availability = amountPaid >= plot.price
        ? 'occupied'
        : amountPaid >= plot.price * 0.2
          ? 'reserved'
          : (plot.availability || 'available');
      await db.query('UPDATE plot_map_tbl SET availability = ?, user_id = ? WHERE plot_id = ?', [availability, userId, plot.plot_id]);

      // Fallback transaction/time values when no payment row was inserted
      if (!transactionId) transactionId = session.payment_intent || null;
      if (!paidAt) paidAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    }

    // 5️⃣ Render success page
    res.render('payment_success', { bookingId, amount: finalAmount, transaction_id: transactionId, paid_at: paidAt });

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


// JSON endpoint to fetch AI recommendations (used by front-end auto-refresh)
router.get('/ai-recommendations', requireLogin, async (req, res) => {
  const userId = req.session.user.user_id;
  try {
    const cacheKey = `ai_recommendations:${userId}`;
    const raw = await cache.get(cacheKey);
    let recs = null;
    if (raw) {
      if (Array.isArray(raw)) recs = raw;
      else if (typeof raw === 'string') {
        try { recs = JSON.parse(raw); } catch (e) { recs = null; }
      }
    }

    if (!recs || recs.length === 0) {
      // Load preferences
      const rawPrefs = await cache.get(`user_preferences:${userId}`);
      let prefs = {};
      if (rawPrefs) {
        if (typeof rawPrefs === 'string') {
          try { prefs = JSON.parse(rawPrefs); } catch (e) { prefs = {}; }
        } else if (typeof rawPrefs === 'object') {
          prefs = rawPrefs;
        }
      }
      recs = await getAIRecommendations(userId, prefs || {});
      await cache.set(cacheKey, recs, 600);
    }

    // Ensure array
    res.json({ recommendations: Array.isArray(recs) ? recs : [] });
  } catch (err) {
    console.error('AI rec JSON endpoint error:', err);
    res.json({ recommendations: [] });
  }
});

// Endpoint to save receipt image (base64) to public/images/receipts
router.post('/save-receipt', async (req, res) => {
  try {
    const { imageData, filename } = req.body || {};
    if (!imageData || typeof imageData !== 'string') return res.status(400).json({ error: 'No image data provided' });

    const receiptsDir = path.join(__dirname, '..', 'public', 'images', 'receipts');
    fs.mkdirSync(receiptsDir, { recursive: true });

    const base64 = imageData.split(',')[1] || imageData;
    const buffer = Buffer.from(base64, 'base64');
    const safeName = (filename && String(filename).replace(/[^a-zA-Z0-9-_\.]/g, '_')) || `receipt_${Date.now()}`;
    const filePath = path.join(receiptsDir, `${safeName}.png`);

    fs.writeFileSync(filePath, buffer);

    // Return public path
    const publicPath = `/images/receipts/${safeName}.png`;
    res.json({ success: true, path: publicPath });
  } catch (err) {
    console.error('Failed to save receipt:', err);
    res.status(500).json({ error: 'Failed to save receipt' });
  }
});

module.exports = router;