
const express = require('express');
const router = express.Router();

// Home page
router.get('/', (req, res) => {
  res.render('index'); 
});

// Schedule Visit page
router.get('/appointment', (req, res) => {
  res.render('appointment'); // Make sure you have schedule-visit.ejs
});

// Request Info page
router.get('/maps', (req, res) => {
  res.render('maps'); // Make sure you have request-info.ejs
});

module.exports = router;
