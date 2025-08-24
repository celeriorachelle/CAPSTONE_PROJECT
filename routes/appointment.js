const express = require('express');
const router = express.Router();

// In-memory notification log
const notifications = [];

// Mock email/SMS sending
async function sendEmail(email, subject, message) { console.log(`Email sent to ${email}`); return true; }
async function sendSMS(phone, message) { console.log(`SMS sent to ${phone}`); return true; }

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

router.get('/', requireLogin, (req, res) => {
  res.render('appointment'); 
});

router.post('/create', async (req, res) => {
  const { fullname, email, phone, service, date, time, notes } = req.body;
  const message = `Hello ${fullname}, your appointment for ${service} on ${date} at ${time} has been received.`;

  try {
    if (email) {
      await sendEmail(email, 'Appointment Confirmation', message);
      notifications.push({ user_name: fullname, email, type: 'email', message, created_at: new Date() });
    }
    if (phone) {
      await sendSMS(phone, message);
      notifications.push({ user_name: fullname, phone, type: 'sms', message, created_at: new Date() });
    }

    // Redirect to notification page after booking
    res.redirect('/notification');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error creating appointment.');
  }
});

// Route to expose notifications
router.get('/notifications', (req, res) => {
  res.json(notifications);
});

module.exports = router;
