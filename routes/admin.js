const express = require('express');
const router = express.Router();
const db = require('../db'); // Make sure db.js exports your MySQL pool

// Middleware to require admin access
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  next();
}

router.get('/', requireAdmin, async (req, res) => {
  try {
    // --- Query 1: Today’s appointments ---
    const [todayAppointments] = await db.query(`
      SELECT COUNT(*) AS count 
      FROM booking_tbl 
      WHERE DATE(booking_date) = CURDATE()
    `);

    // --- Query 2: Pending requests ---
    const [pendingRequests] = await db.query(`
      SELECT COUNT(*) AS count 
      FROM booking_tbl 
      WHERE status = 'pending'
    `);

    // --- Query 3: Available plots ---
    const [availablePlots] = await db.query(`
      SELECT COUNT(*) AS count 
      FROM plot_map_tbl 
      WHERE availability = 'available'
    `);

    // --- Query 4: Registered families (users) ---
    const [registeredFamilies] = await db.query(`
      SELECT COUNT(*) AS count 
      FROM user_tbl 
      WHERE role = 'user'
    `);

    // Pass data to EJS
    res.render('admin', {
      user: req.session.user,
      todayAppointments: todayAppointments[0].count,
      pendingRequests: pendingRequests[0].count,
      availablePlots: availablePlots[0].count,
      registeredFamilies: registeredFamilies[0].count
    });
  } catch (err) {
    console.error('Error loading admin dashboard:', err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
