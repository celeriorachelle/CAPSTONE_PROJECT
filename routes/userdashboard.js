const { Router } = require('express');
const router = Router();
const cache = require('./redis');
const { getAIRecommendations } = require('./ai');

// middleware to ensure logged in
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

router.get('/', requireLogin, async (req, res) => {
  const userId = req.session.user.user_id;

  // Fetch preferences
  let preferences = await cache.get(`user_preferences:${userId}`);
  if (preferences && typeof preferences === 'string') preferences = JSON.parse(preferences);

  const isNewUser = !preferences;

  let recommendations = [];
  const cacheKey = `ai_recommendations:${userId}`;

  if (preferences) {
    // Fetch cached recommendations
    recommendations = await cache.get(cacheKey);
    if (recommendations && typeof recommendations === 'string') recommendations = JSON.parse(recommendations);

    if (!recommendations || recommendations.length === 0) {
      recommendations = await getAIRecommendations(userId, preferences);
      recommendations = recommendations.slice(0, 3); // do not re-sort
      await cache.set(cacheKey, JSON.stringify(recommendations), 86400); // cache 1 day
    }
  }

  res.render('userdashboard', {
    user: req.session.user,
    pendingBookings: [],
    reminders: [],
    recommendations,
    showSurvey: isNewUser
  });
});


// ✅ Save preferences to cache only
router.post('/save-preferences', requireLogin, async (req, res) => {
  let { locations, types, minPrice, maxPrice } = req.body;

  // Ensure arrays even if user selects only one option
  if (!Array.isArray(locations)) locations = locations ? [locations] : [];
  if (!Array.isArray(types)) types = types ? [types] : [];

  // Convert price inputs to numbers
  minPrice = Number(minPrice) || 10000;
  maxPrice = Number(maxPrice) || 100000;

  const userId = req.session.user.user_id;

  // Store in Redis cache (TTL optional)
  await cache.set(`user_preferences:${userId}`, {
    locations,
    types,
    minPrice,
    maxPrice
  }, 86400); // 1 day TTL, remove TTL if you want it persistent

  res.redirect('/userdashboard'); // reload dashboard
});

module.exports = router;
