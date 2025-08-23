const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db');

router.get('/', (req, res) => {
  res.render('register', { error: null, formData: {} });
});

router.post('/', async (req, res) => {
  const { firstname, lastname, email, phone, password, confirm_password, role } = req.body;
  const formData = { firstname, lastname, email, phone, role };
  let error = null;

  // 1. Validate First and Last name
  const nameRegex = /^[A-Za-z\- ]+$/;
  if (!nameRegex.test(firstname) || !nameRegex.test(lastname)) {
    error = 'First and Last names can only contain letters, dashes (-), and spaces.';
    return res.render('register', { error, formData });
  }

  // 2. Email contains '@'
  if (!email.includes('@')) {
    error = 'Email address must contain @ symbol.';
    return res.render('register', { error, formData });
  }

  // 3. Phone validation
  if (!/^09\d{9}$/.test(phone)) {
    error = "Phone number must start with '09' and be exactly 11 digits.";
    return res.render('register', { error, formData });
  }

  // 4. Password confirmation
  if (password !== confirm_password) {
    error = 'Passwords do not match.';
    return res.render('register', { error, formData });
  }

  try {
    // Hash the password
    const password_hash = await bcrypt.hash(password, 10);
    
    // Insert user into DB
    const sql = `INSERT INTO user_tbl (firstName, lastName, email, contact_number, password_hash) VALUES (?, ?, ?, ?, ?)`;
    await db.query(sql, [firstname, lastname, email, phone, password_hash || 'user']);
    
    // Redirect to login or success page
    res.redirect('/login');
  } catch (e) {
    error = 'Registration failed. Email may already be used.';
    res.render('register', { error, formData });
  }
});

module.exports = router;

