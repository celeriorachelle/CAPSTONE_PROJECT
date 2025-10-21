const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db');

router.get('/', (req, res) => {
  res.render('register', { error: null, formData: {} });
});

router.post('/', async (req, res) => {
  const { firstname, lastname, email, phone, address, password, confirm_password } = req.body;
  const formData = { firstname, lastname, email, phone, address };
  const role = 'user';
  let error = null;

  // 1. Validate required fields
  if (!firstname || !lastname || !email || !phone || !address || !password || !confirm_password) {
    error = 'All fields are required.';
    return res.render('register', { error, formData });
  }

  // 2. Validate First and Last name
  const nameRegex = /^[A-Za-z\- ]+$/;
  if (!nameRegex.test(firstname) || !nameRegex.test(lastname)) {
    error = 'First and Last names can only contain letters, dashes (-), and spaces.';
    return res.render('register', { error, formData });
  }

  // 3. Email contains '@'
  if (!email.includes('@')) {
    error = 'Email address must contain @ symbol.';
    return res.render('register', { error, formData });
  }

  // 4. Phone validation
  if (!/^09\d{9}$/.test(phone)) {
    error = "Phone number must start with '09' and be exactly 11 digits.";
    return res.render('register', { error, formData });
  }

  // 5. Password confirmation and strength
  if (password !== confirm_password) {
    error = 'Passwords do not match.';
    return res.render('register', { error, formData });
  }

  // Enforce strong password: at least 8 chars, one uppercase, one lowercase, one digit, one special char
  const strongPwRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-={}\[\]|;:'",.<>/?`~]).{8,}$/;
  if (!strongPwRegex.test(password)) {
    error = 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.';
    return res.render('register', { error, formData });
  }

  try {
    // 6. Check if email already exists
    const [existing] = await db.query(`SELECT * FROM user_tbl WHERE email = ?`, [email]);
    if (existing.length > 0) {
      error = 'Email already exists. Please use another email.';
      return res.render('register', { error, formData });
    }

    // 7. Hash the password using a sufficient work factor
    const password_hash = await bcrypt.hash(password, 12);

    // 8. Insert user into DB (with address)
    const sql = `
      INSERT INTO user_tbl (firstName, lastName, email, contact_number, address, password_hash, role)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    await db.query(sql, [firstname, lastname, email, phone, address, password_hash, role]);

    // 9. Redirect to login or success page
    res.redirect('/login');
  } catch (e) {
    console.error(e); // log the actual error
    error = 'Registration failed due to a server error.';
    res.render('register', { error, formData });
  }
});

module.exports = router;
