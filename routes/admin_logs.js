const { Router } = require('express');
const router = Router();
const db = require('../db');

// Middleware: allow only admins
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.redirect("/login");
  }
  next();
}

// ✅ Fetch logs for admin_logs.ejs
router.get("/", requireAdmin, async (req, res) => {
  try {
    const [logs] = await db.query(`
      SELECT 
        l.log_id,
        CONCAT(u.firstName, ' ', u.lastName) AS user_name,
        u.role AS user_role,
        l.action,
        l.details,
        DATE_FORMAT(l.timestamp, '%Y-%m-%d %H:%i:%s') AS timestamp
      FROM logs_tbl l
      LEFT JOIN user_tbl u ON l.user_id = u.user_id
      ORDER BY l.timestamp DESC
    `);

    res.render("admin_logs", { logs });
  } catch (err) {
    console.error("Error loading logs:", err);
    res.status(500).send("Error loading logs");
  }
});

// ✅ Route to clear all logs
router.post("/clear", requireAdmin, async (req, res) => {
  try {
    await db.query("TRUNCATE TABLE logs_tbl");
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to clear logs" });
  }
});

module.exports = router;
