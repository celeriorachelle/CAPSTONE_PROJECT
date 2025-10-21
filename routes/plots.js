// -----------------------------
// GET Memorial Chapel plots
// -----------------------------
const express = require("express");
const router = express.Router();
const db = require("../db");

router.get('/memorial-chapel', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT plot_number, location, type, price, deceased_firstName, deceased_lastName, birth_date, death_date, availability, coord_x, coord_y
      FROM plot_map_tbl
      WHERE location LIKE '%Memorial Chapel%'
      GROUP BY plot_number, location, type, price, deceased_firstName, deceased_lastName, birth_date, death_date, availability, coord_x, coord_y
    `);
    console.log('[/plots/memorial-chapel] db rows count =', Array.isArray(rows) ? rows.length : typeof rows);
    if (Array.isArray(rows) && rows.length > 0) {
      try {
        console.log('[/plots/memorial-chapel] sample rows:', JSON.stringify(rows.slice(0,5)));
        console.log('[/plots/memorial-chapel] row keys:', Object.keys(rows[0]));
      } catch (err) {
        console.log('[/plots/memorial-chapel] error serializing rows for debug:', err);
      }
    }
    res.json(rows || []);
  } catch (err) {
    console.error('Error in /plots/memorial-chapel', err);
    res.status(500).json({ error: 'Database error fetching Memorial Chapel plots' });
  }
});

// -----------------------------
// GET Heritage Gardens plots
// -----------------------------
router.get('/heritage-gardens', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT plot_number, location, type, price, deceased_firstName, deceased_lastName, birth_date, death_date, availability, coord_x, coord_y
      FROM plot_map_tbl
      WHERE location LIKE '%Heritage Gardens%'
      GROUP BY plot_number, location, type, price, deceased_firstName, deceased_lastName, birth_date, death_date, availability, coord_x, coord_y
    `);
    console.log('[/plots/heritage-gardens] db rows count =', Array.isArray(rows) ? rows.length : typeof rows);
    if (Array.isArray(rows) && rows.length > 0) {
      try {
        console.log('[/plots/heritage-gardens] sample rows:', JSON.stringify(rows.slice(0,5)));
        console.log('[/plots/heritage-gardens] row keys:', Object.keys(rows[0]));
      } catch (err) {
        console.log('[/plots/heritage-gardens] error serializing rows for debug:', err);
      }
    }
    res.json(rows || []);
  } catch (err) {
    console.error('Error in /plots/heritage-gardens', err);
    res.status(500).json({ error: 'Database error fetching Heritage Gardens plots' });
  }
});

// -----------------------------
// GET Veterans Memorial plots
// -----------------------------
router.get('/veterans-memorial', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT plot_number, location, type, price, deceased_firstName, deceased_lastName, birth_date, death_date, availability, coord_x, coord_y
      FROM plot_map_tbl
      WHERE location LIKE '%Veterans Memorial%'
      GROUP BY plot_number, location, type, price, deceased_firstName, deceased_lastName, birth_date, death_date, availability, coord_x, coord_y
    `);
    console.log('[/plots/veterans-memorial] db rows count =', Array.isArray(rows) ? rows.length : typeof rows);
    if (Array.isArray(rows) && rows.length > 0) {
      try {
        console.log('[/plots/veterans-memorial] sample rows:', JSON.stringify(rows.slice(0,5)));
        console.log('[/plots/veterans-memorial] row keys:', Object.keys(rows[0]));
      } catch (err) {
        console.log('[/plots/veterans-memorial] error serializing rows for debug:', err);
      }
    }
    res.json(rows || []);
  } catch (err) {
    console.error('Error in /plots/veterans-memorial', err);
    res.status(500).json({ error: 'Database error fetching Veterans Memorial plots' });
  }
});

// -----------------------------
// GET Serenity Columbarium plots
// -----------------------------
router.get('/serenity-columbarium', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT plot_number, location, type, price, deceased_firstName, deceased_lastName, birth_date, death_date, availability, coord_x, coord_y
      FROM plot_map_tbl
      WHERE location LIKE '%Serenity Columbarium%'
      GROUP BY plot_number, location, type, price, deceased_firstName, deceased_lastName, birth_date, death_date, availability, coord_x, coord_y
    `);
    console.log('[/plots/serenity-columbarium] db rows count =', Array.isArray(rows) ? rows.length : typeof rows);
    if (Array.isArray(rows) && rows.length > 0) {
      try {
        console.log('[/plots/serenity-columbarium] sample rows:', JSON.stringify(rows.slice(0,5)));
        console.log('[/plots/serenity-columbarium] row keys:', Object.keys(rows[0]));
      } catch (err) {
        console.log('[/plots/serenity-columbarium] error serializing rows for debug:', err);
      }
    }
    res.json(rows || []);
  } catch (err) {
    console.error('Error in /plots/serenity-columbarium', err);
    res.status(500).json({ error: 'Database error fetching Serenity Columbarium plots' });
  }
});

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
// GET Family Estates plots
// -----------------------------
router.get('/family-estates', async (req, res) => {
  try {
    // Fetch only the specified fields, grouped by plot_number
    const [rows] = await db.query(`
      SELECT plot_number, location, type, price, deceased_firstName, deceased_lastName, birth_date, death_date, availability
      FROM plot_map_tbl
      WHERE location LIKE '%Family Estates%'
      GROUP BY plot_number, location, type, price, deceased_firstName, deceased_lastName, birth_date, death_date, availability
    `);
    console.log('[/plots/family-estates] db rows count =', Array.isArray(rows) ? rows.length : typeof rows);
    if (Array.isArray(rows) && rows.length > 0) {
      try {
        console.log('[/plots/family-estates] sample rows:', JSON.stringify(rows.slice(0,5)));
        console.log('[/plots/family-estates] row keys:', Object.keys(rows[0]));
      } catch (err) {
        console.log('[/plots/family-estates] error serializing rows for debug:', err);
      }
    }
    res.json(rows || []);
  } catch (err) {
    console.error('Error in /plots/family-estates', err);
    res.status(500).json({ error: 'Database error fetching Family Estates plots' });
  }
});

// -----------------------------
// Sample Family Estates (UI testing only)
// -----------------------------
router.get('/family-estates-sample', (req, res) => {
  const sample = [
    {
      plot_id: 1001,
      plot_number: 'FE-01',
      location: 'Family Estates',
      type: 'Family',
      price: 50000,
      deceased_firstName: null,
      deceased_lastName: null,
      birth_date: null,
      death_date: null,
      item_id: null,
      availability: 'Available',
      user_id: null,
      coord_x: 1450,
      coord_y: 980
    },
    {
      plot_id: 1002,
      plot_number: 'FE-02',
      location: 'Family Estates',
      type: 'Family',
      price: 55000,
      deceased_firstName: 'John',
      deceased_lastName: 'Doe',
      birth_date: '1950-01-01',
      death_date: '2020-01-01',
      item_id: null,
      availability: 'Occupied',
      user_id: 12,
      coord_x: 1500,
      coord_y: 1020
    },
    {
      plot_id: 1003,
      plot_number: 'FE-03',
      location: 'Family Estates',
      type: 'Family',
      price: 52000,
      deceased_firstName: null,
      deceased_lastName: null,
      birth_date: null,
      death_date: null,
      item_id: null,
      availability: 'Available',
      user_id: null,
      coord_x: 1600,
      coord_y: 900
    }
  ];
  res.json(sample);
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

// -----------------------------
// Debug endpoints (inspect DB contents)
// -----------------------------
router.get('/debug/locations', async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT location, COUNT(*) as cnt FROM plot_map_tbl GROUP BY location ORDER BY cnt DESC`);
    console.log('[/plots/debug/locations] rows=', rows.length);
    res.json(rows);
  } catch (err) {
    console.error('Error in /plots/debug/locations', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/debug/family-like', async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT plot_id, plot_number, location, coord_x, coord_y, availability FROM plot_map_tbl WHERE location LIKE '%Family%' LIMIT 200`);
    console.log('[/plots/debug/family-like] rows=', rows.length);
    res.json(rows);
  } catch (err) {
    console.error('Error in /plots/debug/family-like', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/debug/all', async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT plot_id, plot_number, location, coord_x, coord_y, availability FROM plot_map_tbl LIMIT 200`);
    console.log('[/plots/debug/all] rows=', rows.length);
    res.json(rows);
  } catch (err) {
    console.error('Error in /plots/debug/all', err);
    res.status(500).json({ error: 'Database error' });
  }
});


module.exports = router;
