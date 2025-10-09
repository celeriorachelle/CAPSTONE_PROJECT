const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db');
const { addLog } = require('../routes/log_helper'); // ✅ import helper

// -------------------------
// LOGIN PAGE
// -------------------------
router.get('/', (req, res) => {
  res.render('login', { 
    success: req.query.success || null,
    error: null
  });
});

// -------------------------
// LOGOUT
// -------------------------
router.get('/logout', async (req, res) => {
  try {
    if (req.session.user) {
      // ✅ Add logout log entry
      await addLog(
        req.session.user.user_id,
        req.session.user.role,
        'Logout',
        `${req.session.user.email} logged out`
      );
    }

    req.session.destroy(err => {
      if (err) {
        console.error('Logout error:', err);
        return res.redirect('/');
      }
      res.clearCookie('connect.sid');
      res.redirect('/login');
    });
  } catch (err) {
    console.error('Error logging logout:', err);
    res.redirect('/login');
  }
});

// -------------------------
// LOGIN (POST)
// -------------------------
router.post('/', async (req, res) => {
  const email = (req.body.username || '').trim();
  const password = (req.body.password || '');

  try {
    // ✅ Fetch user from database
    const [rows] = await db.query(
      'SELECT user_id, firstName, lastName, email, password_hash, role FROM user_tbl WHERE email = ? LIMIT 1',
      [email]
    );

    if (rows.length === 0) {
      return res.render('login', { error: 'No account with that email address found.', success: null });
    }

    const user = rows[0];

    // ✅ Compare password
    const ok = await bcrypt.compare(password, user.password_hash || '');
    if (!ok) {
      return res.render('login', { error: 'Incorrect password. Please try again.', success: null });
    }

    // ✅ Store user info in session
      req.session.user = {
      user_id: user.user_id, // use "user_id" instead of "id"
      email: user.email,
      name: user.firstName,
      role: user.role
    };


    // Handle "Remember me"
    if (req.body.remember_me) {
      req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30;
    } else {
      req.session.cookie.expires = false;
    }

    // ✅ Add log entry for successful login
    await addLog(
      user.user_id,
      user.role,
      'Login',
      `${user.firstName} ${user.lastName} (${user.role}) logged in`
    );

    // Redirect based on role
    if (user.role === 'admin') {
      return res.redirect('/admin');
    } else if (user.role === 'staff') {
      return res.redirect('/staff_dashboard');
    } else {
      return res.redirect('/userdashboard');
    }
  } catch (error) {
    console.error('Login database query error:', error);
    return res.render('login', { error: 'An internal error occurred. Please try again.', success: null });
  }
});

module.exports = router;
