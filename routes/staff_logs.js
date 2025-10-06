const express = require("express");
const router = express.Router();
const db = require("../db");

// Middleware — Only staff can access
function requireStaff(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'staff') {
    return res.redirect('/login');
  }
  next();
}

// GET /staff_logs
router.get("/", requireStaff, async (req, res) => {
  try {
    const [logs] = await db.query(`
      SELECT 
        l.log_id,
        l.user_id,
        u.firstname,
        u.lastname,
        l.action,
        l.details,
        l.timestamp
      FROM logs_tbl l
      LEFT JOIN users_tbl u ON l.user_id = u.user_id
      WHERE l.user_role = 'staff'
      ORDER BY l.timestamp DESC
    `);

    res.render("staff_logs", {
      staff: req.session.user,
      logs,
    });
  } catch (err) {
    console.error("Error loading staff logs:", err);
    res.render("staff_logs", { staff: req.session.user, logs: [] });
  }
});

module.exports = router;
