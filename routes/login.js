const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db');
const { addLog } = require('./log_helper');

// Login page
router.get('/', (req, res) => {
  // If user already logged in, handle optional redirect param first
  if (req.session && req.session.user) {
    const redirectTo = req.query.redirect;
    if (redirectTo && typeof redirectTo === 'string' && redirectTo.startsWith('/')) {
      return res.redirect(redirectTo);
    }
    const role = req.session.user.role;
    if (role === 'admin') return res.redirect('/admin');
    if (role === 'staff') return res.redirect('/staff_dashboard');
    return res.redirect('/userdashboard');
  }

  // Prevent browsers from caching the login page so Back button won't show a usable cached form
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  res.render('login', { success: req.query.success || null, error: null, redirect: req.query.redirect || '' });
});

// ✅ Logout route with logging
router.get('/logout', async (req, res) => {
  const user = req.session.user;
  if (user) {
    await addLog({
      user_id: user.user_id,
      user_role: user.role,
      action: 'Logout',
      details: `${user.role} ${user.name} logged out.`,
    });
  }

  req.session.destroy(err => {
    if (err) {
      console.error('Logout error:', err);
      return res.redirect('/');
    }
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});

// ✅ Login post
router.post('/', async (req, res) => {
  const email = (req.body.username || '').trim();
  const password = (req.body.password || '');

  try {
    const [rows] = await db.query(
      'SELECT user_id, firstName, lastName, email, password_hash, role FROM user_tbl WHERE email = ? LIMIT 1',
      [email]
    );

    if (rows.length === 0)
      return res.render('login', { error: 'No account with that email address found.', success: null, redirect: req.body.redirect || req.query.redirect || '' });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash || '');
    if (!ok)
      return res.render('login', { error: 'Incorrect password. Please try again.', success: null, redirect: req.body.redirect || req.query.redirect || '' });

    req.session.user = {
      user_id: user.user_id,
      email: user.email,
      name: user.firstName,
      role: user.role
    };

    // Remember me
    req.body.remember_me
      ? (req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30)
      : (req.session.cookie.expires = false);

    // ✅ Log the login event
    await addLog({
      user_id: user.user_id,
      user_role: user.role,
      action: 'Login',
      details: `${user.role} ${user.firstName} logged in.`,
    });

    // Redirect to intended URL if provided and safe
    const redirectTo = req.body.redirect || req.query.redirect;
    if (redirectTo && typeof redirectTo === 'string' && redirectTo.startsWith('/')) {
      return res.redirect(redirectTo);
    }

    // Fallback: role-based redirect
    if (user.role === 'admin') return res.redirect('/admin');
    if (user.role === 'staff') return res.redirect('/staff_dashboard');
    return res.redirect('/userdashboard');

  } catch (error) {
    console.error('Login error:', error);
    res.render('login', { error: 'An internal error occurred. Please try again.', success: null, redirect: req.body.redirect || req.query.redirect || '' });
  }
});

module.exports = router;