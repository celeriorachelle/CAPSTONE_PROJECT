const express = require('express');
const router = express.Router();
const appointmentRouter = require('./appointment'); // to access notifications array

router.get('/', (req, res) => {
  res.render('notification', { notifications: appointmentRouter.notifications || [] });
});

module.exports = router;
