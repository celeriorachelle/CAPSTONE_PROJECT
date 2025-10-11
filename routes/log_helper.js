const db = require('../db');

// Add a log entry
async function addLog({ user_id, user_role, action, details }) {
  try {
    await db.query(
      'INSERT INTO logs_tbl (user_id, user_role, action, details) VALUES (?, ?, ?, ?)',
      [user_id || null, user_role || 'Unknown', action, details]
    );
  } catch (err) {
    console.error('Error adding log:', err);
  }
}

// Get all logs
async function getAllLogs() {
  const [rows] = await db.query(
    `SELECT 
       l.log_id, 
       COALESCE(CONCAT(u.firstName, ' ', u.lastName), 'Unknown User') AS user_name,
       l.user_role, 
       l.action, 
       l.details, 
       l.timestamp
     FROM logs_tbl l
     LEFT JOIN user_tbl u ON l.user_id = u.user_id
     ORDER BY l.timestamp DESC`
  );
  return rows;
}

module.exports = { addLog, getAllLogs };
