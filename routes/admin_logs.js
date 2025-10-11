const express = require('express');
const router = express.Router();
const { getAllLogs } = require('./log_helper'); 
const db = require('../db');

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.redirect('/login');
  }
  next();
}

// View logs
router.get('/', requireAdmin, async (req, res) => {
  try {
    const logs = await getAllLogs();
    res.render('admin_logs', { logs });
  } catch (err) {
    console.error('Error fetching logs:', err);
    res.status(500).send('Failed to load logs');
  }
});

// Clear all logs
router.post('/clear', requireAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM logs_tbl');
    res.json({ success: true });
  } catch (err) {
    console.error('Error clearing logs:', err);
    res.status(500).json({ success: false });
  }
});

module.exports = router;
