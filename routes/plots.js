// routes/plots.js
const express = require("express");
const router = express.Router();
const db = require("../db");

// ✅ GET all plots (for map rendering)

router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT plot_number, location, type, availability, deceased_firstName, deceased_lastName, coord_x, coord_y
      FROM plot_map_tbl
      WHERE coord_x IS NOT NULL AND coord_y IS NOT NULL
    `);
    res.json(rows);
  } catch (error) {
    console.error("Error fetching plots:", error);
    res.status(500).json({ error: "Database error" });
  }
});


// ✅ SEARCH endpoint — now more flexible and null-safe
router.get("/search", async (req, res) => {
  let { firstName, middleName, lastName, yearBorn, yearDied } = req.query;

  firstName = firstName?.trim();
  middleName = middleName?.trim();
  lastName = lastName?.trim();

  let sql = `
    SELECT * FROM plot_map_tbl 
    WHERE 1=1
  `;
  const params = [];

  // 🧭 Partial match (case-insensitive)
  if (firstName) {
    sql += " AND LOWER(deceased_firstName) LIKE LOWER(?)";
    params.push(`%${firstName}%`);
  }
  if (middleName) {
    sql += " AND (deceased_middleName IS NOT NULL AND LOWER(deceased_middleName) LIKE LOWER(?))";
    params.push(`%${middleName}%`);
  }
  if (lastName) {
    sql += " AND LOWER(deceased_lastName) LIKE LOWER(?)";
    params.push(`%${lastName}%`);
  }

  // 🕰️ Handle years (if date is not null)
  if (yearBorn) {
    sql += " AND birth_date IS NOT NULL AND YEAR(birth_date) = ?";
    params.push(yearBorn);
  }
  if (yearDied) {
    sql += " AND death_date IS NOT NULL AND YEAR(death_date) = ?";
    params.push(yearDied);
  }

  // 🧩 If no filters, limit to prevent huge fetch
  if (params.length === 0) {
    sql += " LIMIT 50";
  }

  try {
    const [rows] = await db.query(sql, params);
    if (!rows.length) console.log("⚠️ No plots found for search filters:", req.query);
    res.json(rows);
  } catch (error) {
    console.error("❌ Error searching plots:", error);
    res.status(500).json({ error: "Database error" });
  }
});

module.exports = router;
