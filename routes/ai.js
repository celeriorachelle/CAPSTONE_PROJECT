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
    // 1️⃣ Fetch all past bookings for this user
    const [pastBookings] = await db.query(`
      SELECT p.plot_id, p.location, p.type
      FROM booking_tbl b
      JOIN plot_map_tbl p ON b.plot_id = p.plot_id
      WHERE b.user_id = ?
    `, [userId]);

    // Count how many times the user booked each location|type
    const bookingCountMap = {};
    pastBookings.forEach(r => {
      const key = `${r.location}|${r.type}`;
      bookingCountMap[key] = (bookingCountMap[key] || 0) + 1;
    });

    // 2️⃣ Fetch only available plots
    const [plots] = await db.query(`
      SELECT plot_id, plot_number, location, type, price, availability
      FROM plot_map_tbl
      WHERE LOWER(availability) = 'available'
      ORDER BY location, plot_number
    `);

    // 3️⃣ Compute match scores and attach past booking count
    const recommendations = plots.map(plot => {
      let score = 0;

      // Preference matching with trim
      if (preferences.locations?.length > 0) {
        if (preferences.locations.some(loc => loc.trim().toLowerCase() === plot.location.trim().toLowerCase())) {
          score += 3;
        }
      }
      if (preferences.types?.length > 0) {
        if (preferences.types.some(t => t.trim().toLowerCase() === plot.type.trim().toLowerCase())) {
          score += 2;
        }
      }
      if (preferences.minPrice && preferences.maxPrice) {
        if (plot.price >= preferences.minPrice && plot.price <= preferences.maxPrice) {
          score += 1;
        }
      }

      // Past bookings weight
      const key = `${plot.location}|${plot.type}`;
      const pastCount = bookingCountMap[key] || 0;

      return {
        ...plot,
        matchScore: score,
        pastBookingCount: pastCount
      };
    });

    // 4️⃣ Sort by combined score (preference + past booking)
    recommendations.sort((a, b) => {
      const combinedA = (a.matchScore || 0) + (a.pastBookingCount || 0);
      const combinedB = (b.matchScore || 0) + (b.pastBookingCount || 0);
      return combinedB - combinedA;
    });

    // 5️⃣ Highlight top 3 as Best Match
    const top3Ids = recommendations.slice(0, 3).map(p => p.plot_id);
    const finalRecs = recommendations.slice(0, 10).map(p => ({
      ...p,
      isBestMatch: top3Ids.includes(p.plot_id)
    }));

    return finalRecs;

  } catch (err) {
    console.error('AI Recommendation Error:', err);
    return [];
  }
}


module.exports = { getAIRecommendations };
