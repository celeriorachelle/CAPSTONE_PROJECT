const db = require('../db');

// ✅ Universal function for logging user or admin actions
async function addLog(userId, role, action, details) {
  try {
    await db.query(
      `INSERT INTO logs_tbl (user_id, role, action, details, timestamp)
       VALUES (?, ?, ?, ?, NOW())`,
      [userId, role, action, details]
    );
  } catch (err) {
    console.error('Error adding log:', err);
  }
}

module.exports = { addLog };
