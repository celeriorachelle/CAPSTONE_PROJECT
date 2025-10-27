const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: 'localhost',   
  user: 'root',            
  password: 'Rachellemay1022@',            
  database: 'capstone_everlasting', 
  waitForConnections: true,
  
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool;
