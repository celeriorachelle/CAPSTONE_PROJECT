// ai.js
const db = require('../db');

/* helpers:
   - normalize pref arrays (accepts array, comma-string, or JSON-string)
   - token-based matching to allow partial & multi-word matches
*/
function normalizePrefArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(v => String(v || '').trim()).filter(Boolean);
  if (typeof val === 'string') {
    // try parse JSON array first
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed.map(String).map(s => s.trim()).filter(Boolean);
    } catch (e) { /* not JSON */ }
    // fallback: comma split
    return val.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

function normalizeTokens(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function tokensIntersect(a, b) {
  if (!a || !b) return false;
  const setB = new Set(b);
  return a.some(x => setB.has(x));
}

async function getAIRecommendations(userId, preferences = {}) {
  try {
    // 👇 added for debugging
    console.log('AI RECOMM: user', userId, 'preferences received:', preferences);

    // 1) Fetch user's past bookings
    const [pastBookings] = await db.query(`
      SELECT p.location, p.type
      FROM booking_tbl b
      JOIN plot_map_tbl p ON b.plot_id = p.plot_id
      WHERE b.user_id = ?
    `, [userId]);
    const hasHistory = pastBookings.length > 0;

    // booking frequency map
    const bookingCountMap = {};
    pastBookings.forEach(r => {
      const key = `${r.location.trim().toLowerCase()}|${r.type.trim().toLowerCase()}`;
      bookingCountMap[key] = (bookingCountMap[key] || 0) + 1;
    });

    // 2) Fetch available plots
    const [plots] = await db.query(`
      SELECT plot_id, plot_number, location, type, price, availability
      FROM plot_map_tbl
      WHERE LOWER(availability) = 'available'
    `);

    // 👇 added for debugging
    console.log('AI RECOMM: total available plots:', plots.length);

    // 3) Normalize preferences (robust)
    const prefLocations = normalizePrefArray(preferences.locations).map(s => s.toLowerCase());
    const prefTypes = normalizePrefArray(preferences.types).map(s => s.toLowerCase());
    const minPrice = Number(preferences.minPrice) || 0;
    const maxPrice = Number(preferences.maxPrice) || Number.MAX_SAFE_INTEGER;

    // If user has neither prefs nor history, nothing to recommend
    if (prefLocations.length === 0 && prefTypes.length === 0 && !hasHistory) {
      console.log('AI RECOMM: No prefs or history → returning []');
      return [];
    }

    // scoring weights (tunable)
    const WEIGHTS = {
      locationPref: 5,
      typePref: 4,
      priceMatch: 2,
      bookingType: 2,
      bookingLocation: 2,
      freqCap: 3
    };

const results = plots.map(plot => {
  const plotLocNorm = String(plot.location || '').trim().toLowerCase();
  const plotTypeNorm = String(plot.type || '').trim().toLowerCase();
  const plotLocTokens = normalizeTokens(plot.location);
  const plotTypeTokens = normalizeTokens(plot.type);
  const key = `${plotLocNorm}|${plotTypeNorm}`;

  let score = 0;
  let locMatches = 0;
  let typeMatches = 0;

  // ✅ Flexible token-based location matching
  prefLocations.forEach(pl => {
    const plTokens = normalizeTokens(pl);
    if (
      plotLocNorm.includes(pl.toLowerCase()) ||
      tokensIntersect(plTokens, plotLocTokens)
    ) locMatches++;
  });

  // ✅ Flexible token-based type matching
  prefTypes.forEach(pt => {
    const ptTokens = normalizeTokens(pt);
    if (
      plotTypeNorm.includes(pt.toLowerCase()) ||
      tokensIntersect(ptTokens, plotTypeTokens)
    ) typeMatches++;
  });

  // ✅ Only score if any match exists
  if (locMatches === 0 && typeMatches === 0) return null;

  // Weighted scoring
  if (locMatches > 0) score += locMatches * WEIGHTS.locationPref;
  if (typeMatches > 0) score += typeMatches * WEIGHTS.typePref;
  if (plot.price >= minPrice && plot.price <= maxPrice)
    score += WEIGHTS.priceMatch;

  if (hasHistory) {
    if (pastBookings.some(b => b.type.trim().toLowerCase() === plotTypeNorm))
      score += WEIGHTS.bookingType;
    if (pastBookings.some(b => b.location.trim().toLowerCase() === plotLocNorm))
      score += WEIGHTS.bookingLocation;
    score += Math.min(bookingCountMap[key] || 0, WEIGHTS.freqCap);
  }

  return { ...plot, score };
});

const filtered = results.filter(p => p && p.score > 0);

// 👇 added for debugging
console.log('AI RECOMM results count:', filtered.length);

// ✅ OPTION 2: Balance results per preference group
const groups = {};
filtered.forEach(p => {
  const key = `${p.location}|${p.type}`;
  if (!groups[key]) groups[key] = [];
  groups[key].push(p);
});

// sort each group and take top 2 per group
let mixed = [];
Object.values(groups).forEach(arr => {
  arr.sort((a, b) => b.score - a.score);
  mixed = mixed.concat(arr.slice(0, 2)); // take top 2 per group
});

// merge all, sort again, and take top 5 overall
mixed.sort((a, b) => b.score - a.score);
const top5 = mixed.slice(0, 5);

// Mark best 3 (for highlighting in UI)
const top3Ids = top5.slice(0, 3).map(p => p.plot_id);
console.log('AI RECOMM top5 plot IDs:', top3Ids);

return top5.map(p => ({
  ...p,
  isBestMatch: top3Ids.includes(p.plot_id)
}));

  } catch (err) {
    console.error('AI Recommendation Error:', err);
    return [];
  }
}


module.exports = { getAIRecommendations };
