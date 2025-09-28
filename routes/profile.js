const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db');

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

// GET Profile (prefill form data)
router.get('/', requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.user_id;
    const [rows] = await db.query(
      'SELECT firstName, lastName, email, contact_number FROM user_tbl WHERE user_id = ? LIMIT 1',
      [userId]
    );

    const formData = rows && rows[0] ? {
      firstname: rows[0].firstName || '',
      lastname: rows[0].lastName || '',
      email: rows[0].email || '',
      phone: rows[0].contact_number || ''
    } : { firstname: '', lastname: '', email: '', phone: '' };

    res.render('profile', {
      error: null,
      success: null,
      formData
    });
  } catch (err) {
    console.error('Profile GET error:', err);
    res.render('profile', { error: 'Failed to load profile information.', success: null, formData: {} });
  }
});

// POST Update Profile (name, email, phone, optional password)
router.post('/', requireLogin, async (req, res) => {
  const userId = req.session.user.user_id;
  const { firstname = '', lastname = '', email = '', phone = '', password = '', confirm_password = '' } = req.body;

  const formData = { firstname, lastname, email, phone };

  try {
    // Basic validations
    if (!firstname.trim() || !lastname.trim()) {
      return res.render('profile', { error: 'First and Last name are required.', success: null, formData });
    }
    if (!email.includes('@')) {
      return res.render('profile', { error: 'Email address must contain @ symbol.', success: null, formData });
    }

    if (phone && !/^09\d{9}$/.test(phone)) {
      return res.render('profile', { error: "Phone number must start with '09' and be exactly 11 digits.", success: null, formData });
    }

    if ((password || confirm_password) && password !== confirm_password) {
      return res.render('profile', { error: 'Passwords do not match.', success: null, formData });
    }

    // Fetch current email
    const [currentRows] = await db.query('SELECT email FROM user_tbl WHERE user_id = ? LIMIT 1', [userId]);
    const currentEmail = (currentRows && currentRows[0]) ? currentRows[0].email : '';

    // If email changed, ensure uniqueness
    if (email !== currentEmail) {
      const [dupe] = await db.query('SELECT user_id FROM user_tbl WHERE email = ? LIMIT 1', [email]);
      if (dupe && dupe.length > 0) {
        return res.render('profile', { error: 'Email already in use by another account.', success: null, formData });
      }
    }

    // Build update
    const params = [firstname.trim(), lastname.trim(), email.trim(), phone.trim(), userId];
    let sql = 'UPDATE user_tbl SET firstName = ?, lastName = ?, email = ?, contact_number = ? WHERE user_id = ?';

    if (password) {
      const hash = await bcrypt.hash(password, 10);
      sql = 'UPDATE user_tbl SET firstName = ?, lastName = ?, email = ?, contact_number = ?, password_hash = ? WHERE user_id = ?';
      params.splice(4, 0, hash); // insert hash before userId
      params.push(); // ensure final order remains
    }

    // Adjust params order if password included
    const finalParams = password ? [firstname.trim(), lastname.trim(), email.trim(), phone.trim(), params[4], userId] : params;

    await db.query(sql, finalParams);

    // Update session values used in UI
    req.session.user.email = email.trim();
    req.session.user.name = firstname.trim();

    res.render('profile', { success: 'Profile updated successfully.', error: null, formData: { firstname, lastname, email, phone } });
  } catch (err) {
    console.error('Profile POST error:', err);
    res.render('profile', { error: 'Failed to update profile. Please try again.', success: null, formData });
  }
});

module.exports = router;
