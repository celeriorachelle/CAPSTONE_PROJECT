const express = require('express');
const router = express.Router();
const db = require('../db'); // mysql2/promise or similar

// Middleware to require login
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

// GET Burial Records
router.get('/', requireLogin, async (req, res) => {
  try {
    const query = `
      SELECT 
        p.plot_id,
        p.plot_number,
        p.location,
        p.type AS plot_type,
        p.price,
        p.deceased_firstName,
        p.deceased_lastName,
        DATE_FORMAT(p.birth_date, '%M %d, %Y') AS birth_date,
        DATE_FORMAT(p.death_date, '%M %d, %Y') AS death_date,
        p.availability,
        i.item_name,
        CONCAT(u.firstName, ' ', u.lastName) AS booked_by,
        s.fullname AS approved_by -- staff who approved
      FROM plot_map_tbl p
      LEFT JOIN inventory_tbl i ON p.item_id = i.item_id
      LEFT JOIN user_tbl u ON p.user_id = u.user_id
      LEFT JOIN (
        SELECT l.details, CONCAT(u.firstName, ' ', u.lastName) AS fullname
        FROM logs_tbl l
        INNER JOIN user_tbl u ON l.user_id = u.user_id
        WHERE l.action = 'Approved Booking'
      ) s ON s.details LIKE CONCAT('%Booking ID ', p.plot_id, '%')
      WHERE p.availability = 'occupied'
      ORDER BY p.death_date DESC
    `;

    const [burialRecords] = await db.query(query);
    res.render('burialrecord', { burialRecords, user: req.session.user });
  } catch (error) {
    console.error('Error fetching burial records:', error);
    res.status(500).send('Error fetching burial records');
  }
});

module.exports = router;
