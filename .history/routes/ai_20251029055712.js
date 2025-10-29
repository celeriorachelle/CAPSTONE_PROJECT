// ai.js
const db = require('../db');

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
    // Normalize preferences
    const prefLocations = normalizePrefArray(preferences.locations).map(s => s.toLowerCase());
    const prefTypes = normalizePrefArray(preferences.types).map(s => s.toLowerCase());
    const minPrice = Number(preferences.minPrice) || 0;
    const maxPrice = Number(preferences.maxPrice) || Number.MAX_SAFE_INTEGER;

    // Fetch user's past bookings (most recent first)
    const [bookings] = await db.query(`
      SELECT b.booking_id, p.plot_id, p.plot_number, p.location, p.type, p.price
      FROM booking_tbl b
      JOIN plot_map_tbl p ON b.plot_id = p.plot_id
      WHERE b.user_id = ?
      ORDER BY b.booking_id DESC
    `, [userId]);

    const hasHistory = bookings.length > 0;
    const lastBooking = hasHistory ? bookings[0] : null;

    // Frequency map across history
    const freq = {};
    bookings.forEach(r => {
      const key = `${String(r.location||'').trim().toLowerCase()}|${String(r.type||'').trim().toLowerCase()}`;
      freq[key] = (freq[key] || 0) + 1;
    });

    // Candidate plots: available and dedup by plot_number
    const [plots] = await db.query(`
      SELECT t.plot_id, t.plot_number, t.location, t.type, t.price, t.availability
      FROM plot_map_tbl t
      JOIN (
        SELECT plot_number, MIN(plot_id) AS min_id
        FROM plot_map_tbl
        WHERE LOWER(availability) = 'available'
        GROUP BY plot_number
      ) x ON x.min_id = t.plot_id
      WHERE LOWER(t.availability) = 'available'
    `);

    // If new user with no prefs and no history → return empty; caller shows survey
    if (!hasHistory && prefLocations.length === 0 && prefTypes.length === 0) {
      return [];
    }

    // scoring weights
    const WEIGHTS = {
      locationPref: 5,
      typePref: 4,
      priceMatch: 2,
      relatedLocation: 3,
      relatedType: 3,
      bookingType: 2,
      bookingLocation: 2,
      freqCap: 3
    };

    const lastLocNorm = lastBooking ? String(lastBooking.location||'').trim().toLowerCase() : null;
    const lastTypeNorm = lastBooking ? String(lastBooking.type||'').trim().toLowerCase() : null;

    const scored = plots.map(plot => {
      const plotLocNorm = String(plot.location||'').trim().toLowerCase();
      const plotTypeNorm = String(plot.type||'').trim().toLowerCase();
      const plotLocTokens = normalizeTokens(plot.location);
      const plotTypeTokens = normalizeTokens(plot.type);

      let score = 0;
      let locMatches = 0;
      let typeMatches = 0;

      // preference matching
      prefLocations.forEach(pl => {
        const plTokens = normalizeTokens(pl);
        if (plotLocNorm.includes(pl.toLowerCase()) || tokensIntersect(plTokens, plotLocTokens)) locMatches++;
      });
      prefTypes.forEach(pt => {
        const ptTokens = normalizeTokens(pt);
        if (plotTypeNorm.includes(pt.toLowerCase()) || tokensIntersect(ptTokens, plotTypeTokens)) typeMatches++;
      });

      const hasPrefMatch = (locMatches > 0) || (typeMatches > 0);
      const hasRelatedMatch = hasHistory && ((lastLocNorm && plotLocNorm === lastLocNorm) || (lastTypeNorm && plotTypeNorm === lastTypeNorm));

      // flow-based filtering
      if (!hasHistory) {
        if (!hasPrefMatch) return null;
      } else {
        if (!hasPrefMatch && !hasRelatedMatch) return null;
      }

      if (locMatches > 0) score += locMatches * WEIGHTS.locationPref;
      if (typeMatches > 0) score += typeMatches * WEIGHTS.typePref;
      if (plot.price >= minPrice && plot.price <= maxPrice) score += WEIGHTS.priceMatch;

      if (hasHistory) {
        if (lastLocNorm && plotLocNorm === lastLocNorm) score += WEIGHTS.relatedLocation;
        if (lastTypeNorm && plotTypeNorm === lastTypeNorm) score += WEIGHTS.relatedType;

        if (bookings.some(b => String(b.type||'').trim().toLowerCase() === plotTypeNorm))
          score += WEIGHTS.bookingType;
        if (bookings.some(b => String(b.location||'').trim().toLowerCase() === plotLocNorm))
          score += WEIGHTS.bookingLocation;

        const key = `${plotLocNorm}|${plotTypeNorm}`;
        score += Math.min(freq[key] || 0, WEIGHTS.freqCap);
      }

      return { ...plot, score };
    }).filter(Boolean);

    // Preference-balanced selection to avoid duplicates when multiple prefs
    // Build per-preference-pair buckets using original user preference order
    function matchesLocPref(plot, locPref) {
      const plotLocNorm = String(plot.location||'').toLowerCase();
      const locTokens = normalizeTokens(locPref);
      const plotLocTokens = normalizeTokens(plot.location);
      return plotLocNorm.includes(locPref.toLowerCase()) || tokensIntersect(locTokens, plotLocTokens);
    }
    function matchesTypePref(plot, typePref) {
      const plotTypeNorm = String(plot.type||'').toLowerCase();
      const typeTokens = normalizeTokens(typePref);
      const plotTypeTokens = normalizeTokens(plot.type);
      return plotTypeNorm.includes(typePref.toLowerCase()) || tokensIntersect(typeTokens, plotTypeTokens);
    }

    // Prepare buckets
    const pairBuckets = []; // [{key, items:[]}] where key is loc|type
    const locOnlyBuckets = []; // [{loc, items:[]}] when no types selected
    const typeOnlyBuckets = []; // [{type, items:[]}] when no locations selected

    // Sort scored pool once by score desc
    const sortedPool = [...scored].sort((a,b) => b.score - a.score);

    if (prefLocations.length > 0 && prefTypes.length > 0) {
      // Create pair buckets in user-specified order (round-robin over cartesian)
      for (const locPref of prefLocations) {
        for (const typePref of prefTypes) {
          const key = `${locPref}|${typePref}`;
          const items = sortedPool.filter(p => matchesLocPref(p, locPref) && matchesTypePref(p, typePref));
          if (items.length > 0) pairBuckets.push({ key, items });
        }
      }
    }

    if (prefLocations.length > 0 && prefTypes.length === 0) {
      for (const locPref of prefLocations) {
        const items = sortedPool.filter(p => matchesLocPref(p, locPref));
        if (items.length > 0) locOnlyBuckets.push({ loc: locPref, items });
      }
    }

    if (prefTypes.length > 0 && prefLocations.length === 0) {
      for (const typePref of prefTypes) {
        const items = sortedPool.filter(p => matchesTypePref(p, typePref));
        if (items.length > 0) typeOnlyBuckets.push({ type: typePref, items });
      }
    }

    const selected = [];
    const seenPlotNumbers = new Set();
    const seenPairs = new Set(); // track location|type to promote diversity
    function pairKey(p) { return `${p.location}|${p.type}`; }

    // Helper to pick next item from a bucket honoring uniqueness
    function pickFromBucket(bucket) {
      while (bucket.items.length > 0) {
        const cand = bucket.items.shift();
        const pk = pairKey(cand);
        if (!seenPlotNumbers.has(cand.plot_number) && !seenPairs.has(pk)) {
          selected.push(cand);
          seenPlotNumbers.add(cand.plot_number);
          seenPairs.add(pk);
          return true;
        }
      }
      return false;
    }

    // Round-robin across pair buckets first (strongest match to both loc and type)
    let idx = 0;
    while (selected.length < 5 && pairBuckets.length > 0) {
      const bIndex = idx % pairBuckets.length;
      const b = pairBuckets[bIndex];
      pickFromBucket(b);
      // enforce max 1 selection per pair bucket to avoid duplicates
      pairBuckets.splice(bIndex, 1);
      if (pairBuckets.length === 0) break;
      idx++;
    }

    // Then fill with loc-only buckets if needed (1 per loc)
    idx = 0;
    while (selected.length < 5 && locOnlyBuckets.length > 0) {
      const bIndex = idx % locOnlyBuckets.length;
      const b = locOnlyBuckets[bIndex];
      // allow pick if pair not used yet
      pickFromBucket(b);
      // remove bucket to enforce 1-per-loc in this phase
      locOnlyBuckets.splice(bIndex, 1);
      if (locOnlyBuckets.length === 0) break;
      idx++;
    }

    // Then type-only buckets (1 per type)
    idx = 0;
    while (selected.length < 5 && typeOnlyBuckets.length > 0) {
      const bIndex = idx % typeOnlyBuckets.length;
      const b = typeOnlyBuckets[bIndex];
      pickFromBucket(b);
      typeOnlyBuckets.splice(bIndex, 1);
      if (typeOnlyBuckets.length === 0) break;
      idx++;
    }

    // Two-phase fallback from the overall pool (already sorted):
    // Phase 1: prefer unseen pairs
    for (const p of sortedPool) {
      if (selected.length >= 5) break;
      const pk = pairKey(p);
      if (!seenPlotNumbers.has(p.plot_number) && !seenPairs.has(pk)) {
        selected.push(p);
        seenPlotNumbers.add(p.plot_number);
        seenPairs.add(pk);
      }
    }
    // Phase 2: if still short, allow duplicates of pairs but keep unique plot_numbers
    for (const p of sortedPool) {
      if (selected.length >= 5) break;
      if (!seenPlotNumbers.has(p.plot_number)) {
        selected.push(p);
        seenPlotNumbers.add(p.plot_number);
      }
    }

    const top = selected.slice(0, 5);
    const top3Ids = top.slice(0, 3).map(p => p.plot_id);
    return top.map(p => ({ ...p, isBestMatch: top3Ids.includes(p.plot_id) }));

  } catch (err) {
    console.error('AI Recommendation Error:', err);
    return [];
  }
}


module.exports = { getAIRecommendations };
