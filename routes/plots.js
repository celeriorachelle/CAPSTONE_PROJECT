const express = require("express");
const router = express.Router();
const db = require("../db");

// -----------------------------
// Update plot coordinates
// -----------------------------
router.post('/update-coord', async (req, res) => {
  const { plot_number, coord_x, coord_y } = req.body;
  if (!plot_number || coord_x === undefined || coord_y === undefined) {
    return res.status(400).json({ success: false, error: "Missing parameters" });
  }
  try {
    await db.query(
      "UPDATE plot_map_tbl SET coord_x = ?, coord_y = ? WHERE plot_number = ?",
      [coord_x, coord_y, plot_number]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Database update failed" });
  }
});

// -----------------------------
// GET all plots
// -----------------------------
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT * FROM plot_map_tbl WHERE coord_x IS NOT NULL AND coord_y IS NOT NULL`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error fetching plots" });
  }
});

// -----------------------------
// GET single plot by coordinates
// -----------------------------
router.get("/by-coord", async (req, res) => {
  const { x, y } = req.query;
  if (!x || !y) return res.status(400).json({ error: "Missing coordinates" });

  try {
    const [rows] = await db.query(`SELECT * FROM plot_map_tbl WHERE coord_x = ? AND coord_y = ? LIMIT 1`, [x, y]);
    res.json(rows[0] || { message: "No plot found" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// -----------------------------
// GET plots within polygon bounds
// -----------------------------
router.get("/in-bounds", async (req, res) => {
  const { latMin, latMax, lngMin, lngMax } = req.query;
  if (!latMin || !latMax || !lngMin || !lngMax) {
    return res.status(400).json({ error: "Missing bounds" });
  }

  try {
    // Note: coord_y = latitude, coord_x = longitude
    const [rows] = await db.query(
      `SELECT * FROM plot_map_tbl
       WHERE coord_y BETWEEN ? AND ? AND coord_x BETWEEN ? AND ?`,
      [latMin, latMax, lngMin, lngMax]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error fetching plots in bounds" });
  }
});

// -----------------------------
// Search plots
// -----------------------------
router.get("/search", async (req, res) => {
  let { firstName, middleName, lastName, yearBorn, yearDied } = req.query;
  firstName = firstName?.trim();
  middleName = middleName?.trim();
  lastName = lastName?.trim();

  let sql = `SELECT * FROM plot_map_tbl WHERE 1=1`;
  const params = [];

  if (firstName) { sql += " AND LOWER(deceased_firstName) LIKE LOWER(?)"; params.push(`%${firstName}%`); }
  if (middleName) { sql += " AND (deceased_middleName IS NOT NULL AND LOWER(deceased_middleName) LIKE LOWER(?))"; params.push(`%${middleName}%`); }
  if (lastName) { sql += " AND LOWER(deceased_lastName) LIKE LOWER(?)"; params.push(`%${lastName}%`); }
  if (yearBorn) { sql += " AND birth_date IS NOT NULL AND YEAR(birth_date) = ?"; params.push(yearBorn); }
  if (yearDied) { sql += " AND death_date IS NOT NULL AND YEAR(death_date) = ?"; params.push(yearDied); }

  if (params.length === 0) sql += " LIMIT 50";

  try {
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error while searching" });
  }
});

// -----------------------------
// GET plot by plot_number
// -----------------------------
router.get("/:plot_number", async (req, res) => {
  const { plot_number } = req.params;
  try {
    const [rows] = await db.query(`SELECT * FROM plot_map_tbl WHERE plot_number = ?`, [plot_number]);
    res.json(rows[0] || { message: "Plot not found" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});
router.get("/in-bounds", async (req, res) => {
  let { latMin, latMax, lngMin, lngMax } = req.query;
  if (!latMin || !latMax || !lngMin || !lngMax) {
    return res.status(400).json({ error: "Missing bounds" });
  }

  // Convert to numbers
  latMin = parseFloat(latMin);
  latMax = parseFloat(latMax);
  lngMin = parseFloat(lngMin);
  lngMax = parseFloat(lngMax);

  // Normalize bounds
  const south = Math.min(latMin, latMax);
  const north = Math.max(latMin, latMax);
  const west  = Math.min(lngMin, lngMax);
  const east  = Math.max(lngMin, lngMax);

  try {
    const [rows] = await db.query(
      `SELECT * FROM plot_map_tbl
       WHERE coord_y BETWEEN ? AND ?
         AND coord_x BETWEEN ? AND ?`,
      [south, north, west, east]
    );
    res.json(rows);
  } catch (err) {
    console.error("Error fetching plots in bounds:", err);
    res.status(500).json({ error: "Database error fetching plots in bounds" });
  }
});


module.exports = router;
