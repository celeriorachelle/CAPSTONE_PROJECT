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

    // Build installment warnings and take actions for overdue >7 days
    const installmentWarnings = [];
    if (activePayments && activePayments.length > 0) {
      const now = new Date();
      // helper: convert date-string or Date to a local-midnight Date
      function toLocalDateStart(d) {
        if (!d) return null;
        if (typeof d === 'string') {
          // try YYYY-MM-DD first
          const m = d.match(/(\d{4})-(\d{2})-(\d{2})/);
          if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
          const parsed = new Date(d);
          if (!isNaN(parsed)) return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
          return null;
        }
        if (d instanceof Date) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
        return null;
      }

      for (const p of activePayments) {
        const dueStart = toLocalDateStart(p.due_date);
        if (!dueStart) continue;
        const msPerDay = 24 * 60 * 60 * 1000;
        const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const daysUntil = Math.floor((dueStart - nowStart) / msPerDay); // integer days until due

        if (daysUntil === 1) {
          installmentWarnings.push({
            type: 'dueSoon',
            payment_id: p.payment_id,
            booking_id: p.booking_id,
            amount: p.amount,
            due_date: dueStart.toISOString()
          });
        } else if (daysUntil < 0) {
          const daysOverdue = Math.floor((nowStart - dueStart) / msPerDay);
          if (daysOverdue >= 3 && daysOverdue < 7) {
            installmentWarnings.push({
              type: 'overdue3',
              payment_id: p.payment_id,
              booking_id: p.booking_id,
              amount: p.amount,
              daysOverdue
            });
          } else if (daysOverdue >= 7) {
            // release reservation: remove user ownership from booking_tbl and set status to available
            try {
              if (p.booking_id) {
                await db.query(`UPDATE booking_tbl SET user_id=NULL, status='available' WHERE booking_id=? AND status='reserved'`, [p.booking_id]);
              }
              // mark payment as defaulted/inactive
              await db.query(`UPDATE payment_tbl SET status='defaulted' WHERE payment_id=?`, [p.payment_id]);

              // fetch plot_id from payment_tbl (if present) and release it in plot_map_tbl
              try {
                const [payRows] = await db.query(`SELECT plot_id FROM payment_tbl WHERE payment_id=? LIMIT 1`, [p.payment_id]);
                const plotRow = payRows && payRows[0];
                const plotId = plotRow ? plotRow.plot_id : null;
                if (plotId) {
                  await db.query(`UPDATE plot_map_tbl SET availability='available', user_id=NULL WHERE plot_id=?`, [plotId]);
                }
              } catch (plotErr) {
                console.error('Error releasing plot in plot_map_tbl for overdue payment:', plotErr);
              }

              installmentWarnings.push({
                type: 'released',
                payment_id: p.payment_id,
                booking_id: p.booking_id,
                amount: p.amount,
                daysOverdue
              });
            } catch (releaseErr) {
              console.error('Error releasing reservation for overdue payment:', releaseErr);
            }
          }
        }
      }
    }

    console.log('✅ Final dashboard recommendations mix:', recommendations?.map(r => `${r.location} | ${r.type}`));

    res.render('userdashboard', {
      user: req.session.user,
      pendingBookings: pendingRows || [],
      reminders: activePayments || [],
      recommendations: recommendationsWithLinks || [],
      showSurvey: !hasPreferences && !hasHistory,
      alert: req.query.alert,
      installmentWarnings
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
