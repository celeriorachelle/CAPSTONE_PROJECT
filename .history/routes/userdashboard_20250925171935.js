const { Router } = require('express');
const router = Router();
const db = require('../db');

// middleware to ensure logged in
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

router.get('/', requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.user_id;

    // fetch pending bookings
    const [pendingBookings] = await db.query(
      'SELECT booking_id, service_type, booking_date, status FROM booking_tbl WHERE user_id = ? AND status = "Pending"',
      [userId]
    );

    // fetch upcoming installment reminders (next 7 days)
    const [reminders] = await db.query(
      `SELECT amount, due_date 
       FROM payment_tbl 
       WHERE user_id = ? 
         AND status = 'pending'
         AND due_date <= DATE_ADD(NOW(), INTERVAL 7 DAY)
       ORDER BY due_date ASC`,
      [userId]
    );

    // sample AI recommendations (dummy for now)
    const recommendations = [
      { plot_name: 'Lot A1', category: 'Family Lot', price: 12000 },
      { plot_name: 'Niche B3', category: 'Columbarium', price: 8000 },
      { plot_name: 'Garden C5', category: 'Memorial Garden', price: 10000 },
    ];

    res.render('userdashboard', {
      user: req.session.user,
      pendingBookings,
      reminders,
      recommendations
    });
  } catch (err) {
    console.error('Error loading dashboard:', err);
    res.status(500).send('Server Error');
  }
});


module.exports = router;
