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
    // For burial records we join the booking (to get booking_id) and look up
    // the approval log that references that booking id. This is more reliable
    // than treating plot_id as the booking id.
    const query = `
      SELECT
        p.plot_id,
        p.plot_number,
        p.location,
      -- Prefer the explicit plot type stored on the plot; if it's missing
      -- but the linked booking is a burial, treat it as an 'Ossuary'. This
      -- prevents admin-created burial bookings from showing the wrong type
      -- when the plot row wasn't updated for some reason.
      CASE
        WHEN COALESCE(p.type, '') <> '' THEN p.type
        WHEN b.service_type = 'burial' THEN 'Ossuary'
        ELSE p.type
      END AS plot_type,
        p.price,
        p.deceased_firstName,
        p.deceased_lastName,
        DATE_FORMAT(p.birth_date, '%M %d, %Y') AS birth_date,
        DATE_FORMAT(p.death_date, '%M %d, %Y') AS death_date,
        p.availability,
        i.item_name,
        CONCAT(COALESCE(u.firstname, u.firstName, ''), ' ', COALESCE(u.lastname, u.lastName, '')) AS booked_by,
        (
          SELECT CONCAT(COALESCE(uu.firstname, uu.firstName, ''), ' ', COALESCE(uu.lastname, uu.lastName, ''))
          FROM logs_tbl l
          LEFT JOIN user_tbl uu ON l.user_id = uu.user_id
          WHERE l.details LIKE CONCAT('%Booking ID ', b.booking_id, '%')
            AND l.action LIKE '%Approve%'
          ORDER BY l.timestamp DESC
          LIMIT 1
        ) AS approved_by
      FROM plot_map_tbl p
      LEFT JOIN booking_tbl b ON b.plot_id = p.plot_id
      LEFT JOIN inventory_tbl i ON p.item_id = i.item_id
      LEFT JOIN user_tbl u ON p.user_id = u.user_id
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
