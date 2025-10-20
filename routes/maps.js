// routes/plots.js
const express = require("express");
const router = express.Router();
const db = require("../db");

// ✅ GET all plots (for rendering the map)
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        plot_number,
        location,
        type,
        availability,
        deceased_firstName,
        deceased_middleName,
        deceased_lastName,
        birth_date,
        death_date,
        coord_x,
        coord_y
      FROM plot_map_tbl
      WHERE coord_x IS NOT NULL 
        AND coord_y IS NOT NULL
    `);
    res.json(rows);
  } catch (error) {
    console.error("❌ Error fetching plots:", error);
    res.status(500).json({ error: "Database error while fetching plots." });
  }
});


// ✅ GET a single plot info (by coordinate — used for coordinate helper)
router.get("/by-coord", async (req, res) => {
  const { x, y } = req.query;
  if (!x || !y) {
    return res.status(400).json({ error: "Missing coordinates (x, y)" });
  }

  try {
    const [rows] = await db.query(
      `SELECT 
        plot_number,
        location,
        type,
        availability,
        deceased_firstName,
        deceased_middleName,
        deceased_lastName,
        birth_date,
        death_date,
        coord_x,
        coord_y
      FROM plot_map_tbl
      WHERE coord_x = ? AND coord_y = ?
      LIMIT 1`,
      [x, y]
    );

    if (rows.length === 0) {
      return res.json({ message: "No plot found at these coordinates." });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error("❌ Error fetching plot by coordinate:", error);
    res.status(500).json({ error: "Database error while fetching plot info." });
  }
});


// ✅ SEARCH endpoint (for the map’s search bar)
router.get("/search", async (req, res) => {
  let { firstName, middleName, lastName, yearBorn, yearDied } = req.query;

  firstName = firstName?.trim();
  middleName = middleName?.trim();
  lastName = lastName?.trim();

  let sql = `
    SELECT 
      plot_number,
      location,
      type,
      availability,
      deceased_firstName,
      deceased_middleName,
      deceased_lastName,
      birth_date,
      death_date,
      coord_x,
      coord_y
    FROM plot_map_tbl
    WHERE 1=1
  `;
  const params = [];

  // 🧭 Name filters (case-insensitive)
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

  // 🕰️ Year filters
  if (yearBorn) {
    sql += " AND birth_date IS NOT NULL AND YEAR(birth_date) = ?";
    params.push(yearBorn);
  }
  if (yearDied) {
    sql += " AND death_date IS NOT NULL AND YEAR(death_date) = ?";
    params.push(yearDied);
  }

  // 🧩 Prevent giant queries
  if (params.length === 0) sql += " LIMIT 50";

  try {
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (error) {
    console.error("❌ Error searching plots:", error);
    res.status(500).json({ error: "Database error while searching plots." });
  }
});


// ✅ (Optional) GET single plot by ID
router.get("/:plot_number", async (req, res) => {
  const { plot_number } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT 
        plot_number,
        location,
        type,
        availability,
        deceased_firstName,
        deceased_middleName,
        deceased_lastName,
        birth_date,
        death_date,
        coord_x,
        coord_y
      FROM plot_map_tbl
      WHERE plot_number = ?`,
      [plot_number]
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "Plot not found." });
    res.json(rows[0]);
  } catch (error) {
    console.error("❌ Error fetching plot by number:", error);
    res.status(500).json({ error: "Database error while fetching plot by ID." });
  }
});

module.exports = router;
