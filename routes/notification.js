const express = require('express');
const router = express.Router();
const appointmentRouter = require('./appointment'); // to access notifications array

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

router.get('/', requireLogin, (req, res) => {
  res.render('notification', { notifications: appointmentRouter.notifications || [] });
});

module.exports = router;
