// routes/userdashboard.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const cache = require('./redis');
const { getAIRecommendations } = require('./ai');
const { v4: uuidv4 } = require('uuid');

// helper: safe parse of cache.get return value (string or object)
function parseCacheVal(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch (e) { return v; }
  }
  return v;
}

function hasValidPreferences(prefs) {
  if (!prefs) return false;
  const locs = prefs.locations || [];
  const types = prefs.types || [];
  const minP = prefs.minPrice;
  const maxP = prefs.maxPrice;
  return (Array.isArray(locs) && locs.length > 0) ||
         (Array.isArray(types) && types.length > 0) ||
         (typeof minP === 'number' && minP > 0) ||
         (typeof maxP === 'number' && maxP < Number.MAX_SAFE_INTEGER);
}

// Middleware
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

router.get('/', requireLogin, async (req, res) => {
  const userId = req.session.user.user_id;

  try {
    // Load preferences from Redis (robust parse)
    const rawPrefs = parseCacheVal(await cache.get(`user_preferences:${userId}`));
    const preferences = rawPrefs && typeof rawPrefs === 'object' ? rawPrefs : {};

    const cacheKey = `ai_recommendations:${userId}`;
    const rawRecs = parseCacheVal(await cache.get(cacheKey));
    let recommendations = Array.isArray(rawRecs) ? rawRecs : null;

    // Count past bookings
    const [pastBookingsCount] = await db.query(
      `SELECT COUNT(*) AS count FROM booking_tbl WHERE user_id = ?`,
      [userId]
    );
    const hasHistory = pastBookingsCount[0].count > 0;
    const hasPreferences = hasValidPreferences(preferences);

    // Generate recommendations only if user has prefs or history and none cached
    if ((!recommendations || recommendations.length === 0) && (hasPreferences || hasHistory)) {
      recommendations = await getAIRecommendations(userId, preferences || {});

      // Save into cache (wrapper likely handles serialization)
      await cache.set(cacheKey, recommendations, 600); // 10 minutes TTL

      // Save in DB cache table
      const expiresAt = new Date(Date.now() + 600 * 1000)
        .toISOString().slice(0, 19).replace('T', ' ');
      await db.query(
        `INSERT INTO ai_recommendation_cache_tbl (cache_id, user_id, data, created_at, expires_at)
         VALUES (?, ?, ?, NOW(), ?)
         ON DUPLICATE KEY UPDATE data=VALUES(data), created_at=NOW(), expires_at=VALUES(expires_at)`,
        [uuidv4(), userId, JSON.stringify(recommendations), expiresAt]
      );
    }

    // Add detail link for each recommendation so front-end can redirect to the booking form
    const recommendationsWithLinks = (recommendations || []).map(r => ({
      ...r,
      detailUrl: `/book/${r.plot_id || r.plotId || r.plotNumber || ''}`
    }));

    // Fetch pending bookings for current user
    const [pendingRows] = await db.query(
      `SELECT booking_id, service_type, booking_date, status
       FROM booking_tbl
       WHERE user_id = ? AND status = 'pending'`,
      [userId]
    );

    // Fetch active installments (payments) for current user
    const [activePayments] = await db.query(
      `SELECT payment_id, booking_id, amount, due_date, status
       FROM payment_tbl
       WHERE user_id = ? AND status = 'active'`,
      [userId]
    );

    console.log('✅ Final dashboard recommendations mix:', recommendations?.map(r => `${r.location} | ${r.type}`));

    res.render('userdashboard', {
      user: req.session.user,
      pendingBookings: pendingRows || [],
      reminders: activePayments || [],
      recommendations: recommendationsWithLinks || [],
      showSurvey: !hasPreferences && !hasHistory,
      alert: req.query.alert
    });
  } catch (err) {
    console.error('Dashboard recommendation error:', err);
    res.render('userdashboard', {
      user: req.session.user,
      pendingBookings: [],
      reminders: [],
      recommendations: [],
      showSurvey: true,
      alert: req.query.alert
    });
  }
});


// Save user preferences (survey)
router.post('/save-preferences', requireLogin, async (req, res) => {
  const userId = req.session.user.user_id;
  let { locations, types, minPrice, maxPrice } = req.body;

  if (!Array.isArray(locations)) locations = locations ? [locations] : [];
  if (!Array.isArray(types)) types = types ? [types] : [];

  minPrice = Number(minPrice) || 0;
  maxPrice = Number(maxPrice) || Number.MAX_SAFE_INTEGER;

  const preferences = { locations, types, minPrice, maxPrice };

  try {
    // Save preferences to Redis
    await cache.set(`user_preferences:${userId}`, JSON.stringify(preferences), 86400);
    console.log('✅ Preferences saved for user:', userId, preferences);

    // Reset and regenerate recommendations per new flow
    await cache.del(`ai_recommendations:${userId}`);
    const regen = await getAIRecommendations(userId, preferences);
    await cache.set(`ai_recommendations:${userId}`, regen, 600);

    const expiresAt = new Date(Date.now() + 600 * 1000)
      .toISOString().slice(0, 19).replace('T', ' ');
    await db.query(
      `INSERT INTO ai_recommendation_cache_tbl (cache_id, user_id, data, created_at, expires_at)
       VALUES (?, ?, ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE data=VALUES(data), created_at=NOW(), expires_at=VALUES(expires_at)`,
      [uuidv4(), userId, JSON.stringify(regen), expiresAt]
    );

    res.redirect('/userdashboard');
  } catch (err) {
    console.error('Error saving preferences:', err);
    res.status(500).send('Failed to save preferences');
  }
});

module.exports = router;
