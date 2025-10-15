// 📂 routes/admin_logs.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { addLog } = require('./log_helper');

// ✅ Middleware: restrict to admin users
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  next();
}

// ✅ GET logs with optional filters (role + date range)
router.get('/', requireAdmin, async (req, res) => {
  const { role, startDate, endDate } = req.query;

  let query = `
    SELECT 
      l.*, 
      COALESCE(CONCAT(u.firstName, ' ', u.lastName), 'Unknown User') AS user_name
    FROM logs_tbl l
    LEFT JOIN user_tbl u ON l.user_id = u.user_id
    WHERE 1=1
  `;

  const params = [];

  if (role && role !== 'all') {
    query += ' AND l.user_role = ?';
    params.push(role);
  }

  if (startDate && endDate) {
    query += ' AND DATE(l.timestamp) BETWEEN ? AND ?';
    params.push(startDate, endDate);
  }

  query += ' ORDER BY l.timestamp DESC';

  try {
    const [logs] = await db.query(query, params);
    res.render('admin_logs', {
      logs,
      filters: { role: role || 'all', startDate: startDate || '', endDate: endDate || '' },
    });
  } catch (err) {
    console.error('Error fetching logs:', err);
    res.render('admin_logs', { logs: [], filters: {} });
  }
});

// ✅ Clear all logs
router.post('/clear', requireAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM logs_tbl');
    await addLog({
      user_id: req.session.user.user_id,
      user_role: 'admin',
      action: 'Clear Logs',
      details: 'Admin cleared all activity logs.'
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Error clearing logs:', err);
    res.json({ success: false });
  }
});

module.exports = router;