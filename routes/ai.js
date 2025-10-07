// ai.js
const db = require('../db');

/**
 * Get AI recommendations for a user
 * @param {number} userId
 * @param {object} preferences
 * @returns {Promise<Array>} top 10 recommended plots (top 3 highlighted)
 */
async function getAIRecommendations(userId, preferences = {}) {
  try {
    // Fetch all past bookings for this user
    const [pastBookings] = await db.query(`
      SELECT p.plot_id, p.location, p.type
      FROM booking_tbl b
      JOIN plot_map_tbl p ON b.plot_id = p.plot_id
      WHERE b.user_id = ?
    `, [userId]);

    // Map to count how many times user booked each location|type
    const bookingCountMap = {};
    pastBookings.forEach(r => {
      const key = `${r.location.trim().toLowerCase()}|${r.type.trim().toLowerCase()}`;
      bookingCountMap[key] = (bookingCountMap[key] || 0) + 1;
    });

    // Fetch all available plots
    const [plots] = await db.query(`
      SELECT plot_id, plot_number, location, type, price, availability
      FROM plot_map_tbl
      WHERE LOWER(availability) = 'available'
      ORDER BY location, plot_number
    `);

    // Normalize preferences from user input
    const prefLocations = (preferences.locations || []).map(loc => loc.trim().toLowerCase());
    const prefTypes = (preferences.types || []).map(t => t.trim().toLowerCase());
    const minPrice = preferences.minPrice || 0;
    const maxPrice = preferences.maxPrice || Number.MAX_SAFE_INTEGER;

    // Helper to normalize strings for loose matching
    const cleanString = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Filter plots by preferences (partial match)
    const filteredPlots = plots.filter(plot => {
      const loc = cleanString(plot.location);
      const type = cleanString(plot.type);
      const price = plot.price;

      const locMatch = prefLocations.length === 0 || prefLocations.some(prefLoc => loc.includes(cleanString(prefLoc)));
      const typeMatch = prefTypes.length === 0 || prefTypes.some(prefType => type.includes(cleanString(prefType)));
      const priceMatch = price >= minPrice && price <= maxPrice;

      return locMatch && typeMatch && priceMatch;
    });

    // If no filtered plots, fall back to top 10 available plots
    const recommendedPlots = filteredPlots.length > 0 ? filteredPlots : plots.slice(0, 10);

    // Compute scores and attach past booking count
    const recommendations = recommendedPlots.map(plot => {
      const loc = cleanString(plot.location);
      const type = cleanString(plot.type);
      let score = 0;

      if (prefLocations.some(prefLoc => loc.includes(cleanString(prefLoc)))) score += 3;
      if (prefTypes.some(prefType => type.includes(cleanString(prefType)))) score += 2;
      if (plot.price >= minPrice && plot.price <= maxPrice) score += 1;

      const pastCount = bookingCountMap[`${plot.location.trim().toLowerCase()}|${plot.type.trim().toLowerCase()}`] || 0;

      return {
        ...plot,
        matchScore: score,
        pastBookingCount: pastCount
      };
    });

    // Exclude plots with zero preference match score
    const filteredRecommendations = recommendations.filter(r => r.matchScore > 0);

    // Sort by weighted combined score
    filteredRecommendations.sort((a, b) => {
      const scoreA = (a.matchScore || 0) * 10 + Math.min(a.pastBookingCount || 0, 5);
      const scoreB = (b.matchScore || 0) * 10 + Math.min(b.pastBookingCount || 0, 5);
      return scoreB - scoreA;
    });

    // Get top 3 to mark as Best Match
    const top3Ids = filteredRecommendations.slice(0, 3).map(p => p.plot_id);

    // Return top 10 recommendations with Best Match flag
    return filteredRecommendations.slice(0, 10).map(p => ({
      ...p,
      isBestMatch: top3Ids.includes(p.plot_id),
    }));

  } catch (err) {
    console.error('AI Recommendation Error:', err);
    return [];
  }
}

module.exports = { getAIRecommendations };
