const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db');

router.get('/', (req, res) => {
  res.render('login', { 
    success: req.query.success || null,  // pass success from query string
    error: null                          // ensure error is defined
  });
});

// Logout route
router.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Logout error:', err);
      return res.redirect('/');
    }
    res.clearCookie('connect.sid'); // optional: clear cookie
    res.redirect('/login');
  });
});


router.post('/', async (req, res) => {
  const email = (req.body.username || '').trim();
  const password = (req.body.password || '');

  try {
    const [rows] = await db.query(
      'SELECT user_id, firstName, lastName, email, password_hash, role FROM user_tbl WHERE email = ? LIMIT 1',
      [email]
    );

    if (rows.length === 0) {
      return res.render('login', { error: 'No account with that email address found.', success: null });
    }

    const user = rows[0];

    // Compare password
    const ok = await bcrypt.compare(password, user.password_hash || '');
    if (!ok) {
      return res.render('login', { error: 'Incorrect password. Please try again.', success: null });
    }

    // Store user info in session
    req.session.user = {
      user_id: user.user_id,
      email: user.email,
      name: user.firstName,
      role: user.role
    };

    // Handle "Remember me"
    if (req.body.remember_me) {
      req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30; // 30 days
    } else {
      req.session.cookie.expires = false; // session cookie
    }

    // Redirect based on role
    if (user.role === 'admin') {
      return res.redirect('/admin');
    } else {
      return res.redirect('/');
    }
  } catch (error) {
    console.error('Login database query error:', error);
    return res.render('login', { error: 'An internal error occurred. Please try again.', success: null });
  }
});

module.exports = router;

