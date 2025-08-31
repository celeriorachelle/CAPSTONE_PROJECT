const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');

// GET forgot password form
router.get('/', (req, res) => {
    res.render('forgotpass', { showReset: false });
});

// POST email to send verification link
router.post('/', async (req, res) => {
    const email = (req.body.email || '').trim();

    try {
        const [rows] = await db.query('SELECT user_id FROM user_tbl WHERE email = ?', [email]);
        if (rows.length === 0) {
            return res.render('forgotpass', { showReset: false, error: 'Email not found.' });
        }

        const user = rows[0];

        // Generate a token
        const token = crypto.randomBytes(20).toString('hex');
        const expire = new Date(Date.now() + 3600000); // 1 hour expiration

        // Save token in DB
        await db.query(
            'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
            [user.user_id, token, expire]
        );

        // Send email
        const transporter = nodemailer.createTransport({
            service: 'gmail', // replace with your email provider
            auth: {
                user: 'rachellecelerio19@gmail.com',
                pass: 'thie zqlb mvss yiln'
            }
        });

        const resetLink = `http://${req.headers.host}/forgotpass/reset/${token}`;

        await transporter.sendMail({
            to: email,
            from: 'no-reply@cemetery.com',
            subject: 'Password Reset',
            text: `Click this link to reset your password: ${resetLink}`
        });

        res.render('forgotpass', { showReset: false, success: 'Verification link sent to your email.' });

    } catch (error) {
        console.error(error);
        res.render('forgotpass', { showReset: false, error: 'An error occurred. Please try again.' });
    }
});

// GET reset page (from email link)
router.get('/reset/:token', async (req, res) => {
    const token = req.params.token;

    try {
        const [rows] = await db.query(
            'SELECT user_id, expires_at FROM password_reset_tokens WHERE token = ?',
            [token]
        );

        if (rows.length === 0 || new Date() > rows[0].expires_at) {
            return res.render('forgotpass', { showReset: false, error: 'Password reset link is invalid or expired.' });
        }

        // Render page with new password form
        res.render('forgotpass', { showReset: true, token, success: 'Enter your new password below.' });
    } catch (error) {
        console.error(error);
        res.render('forgotpass', { showReset: false, error: 'An error occurred.' });
    }
});

// POST new password
router.post('/reset/:token', async (req, res) => {
    const { password } = req.body;
    const token = req.params.token;

    try {
        const [rows] = await db.query(
            'SELECT user_id FROM password_reset_tokens WHERE token = ?',
            [token]
        );

        if (rows.length === 0) {
            return res.render('forgotpass', { showReset: false, error: 'Token invalid or expired.' });
        }

        const userId = rows[0].user_id;
        const hash = await bcrypt.hash(password, 10);

        await db.query('UPDATE user_tbl SET password_hash = ? WHERE user_id = ?', [hash, userId]);

        // Remove token
        await db.query('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId]);

        // ✅ Redirect to /login with success message
        return res.redirect('/login?success=Password changed successfully');
    } catch (error) {
        console.error(error);
        res.render('forgotpass', { showReset: false, error: 'An error occurred.' });
    }
});


module.exports = router;
