var express = require('express');
var router = express.Router();
const db = require('../db');

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

/* GET home page. */
router.get('/', requireLogin, async function(req, res, next) {
  try {
    // Fetch all plots from the database
    const [plots] = await db.query(`
      SELECT plot_id, plot_number, location, status, type, price, 
             deceased_firstName, deceased_lastName, birth_date, death_date 
      FROM plot_map_tbl 
      ORDER BY location, plot_number
    `);

    // Transform status from numeric to string
    const transformedPlots = plots.map(plot => ({
      ...plot,
      status: plot.status === 0 ? 'available' : plot.status === 1 ? 'occupied' : 'reserved'
    }));

    // Group plots by location for easier frontend handling
    const plotsByLocation = {};
    transformedPlots.forEach(plot => {
      if (!plotsByLocation[plot.location]) {
        plotsByLocation[plot.location] = [];
      }
      plotsByLocation[plot.location].push(plot);
    });

    console.log('Plots fetched:', transformedPlots.length);
    console.log('Sample plot:', transformedPlots[0]);

    res.render('bookplots', { 
      title: 'Book Plots',
      plots: transformedPlots,
      plotsByLocation: plotsByLocation
    });
  } catch (error) {
    console.error('Error fetching plots:', error);
    res.render('bookplots', { 
      title: 'Book Plots',
      plots: [],
      plotsByLocation: {},
      error: 'Unable to load plot data'
    });
  }
});

module.exports = router;