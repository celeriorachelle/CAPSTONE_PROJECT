var express = require('express');
var router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

/* GET home page. */
router.get('/', requireLogin, function(req, res, next) {
  res.render('bookplots', { title: 'Book Plots' });
});

module.exports = router;