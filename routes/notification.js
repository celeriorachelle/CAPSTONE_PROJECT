const express = require('express');
const router = express.Router();
const db = require('../db');

// Middleware
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

// Fetch notifications as JSON
router.get('/json', requireLogin, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM notification_tbl WHERE user_id = ? ORDER BY datestamp DESC',
      [req.session.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching notifications:', err);
    res.json([]);
  }
});

// Mark notifications as read
router.post('/mark-read', requireLogin, async (req, res) => {
  try {
    await db.query(
      'UPDATE notification_tbl SET `read` = 1 WHERE user_id = ?',
      [req.session.user.user_id]   // ✅ use user_id (same as in bookings)
    );
    res.sendStatus(200);
  } catch (err) {
    console.error('Error marking notifications read:', err);
    res.sendStatus(500);
  }
});


module.exports = router;
