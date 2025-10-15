// 📂 routes/log_helper.js
const db = require('../db');

// ✅ Add a new log entry
async function addLog({ user_id, user_role, action, details }) {
  try {
    await db.query(
      `INSERT INTO logs_tbl (user_id, user_role, action, details, timestamp)
       VALUES (?, ?, ?, ?, NOW())`,
      [user_id, user_role, action, details]
    );
  } catch (err) {
    console.error("Error adding log:", err);
  }
}

module.exports = { addLog };
