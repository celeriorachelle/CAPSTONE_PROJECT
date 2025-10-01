const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');

// Middleware to ensure user is logged in
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

// Configure multer for avatar upload (to public/uploads)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "../public/uploads")),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `avatar_${req.session.user.user_id}${ext}`);
  }
});
const upload = multer({ storage });

// GET settings page
// GET settings page
router.get('/', requireLogin, (req, res) => {
  const settingsData = {
    darkMode: req.session.settings?.darkMode || false,
    notifications: req.session.settings?.notifications || true,
    avatar: req.session.settings?.avatar || req.session.user.avatar || '/images/g.png'
  };
  
  res.render('settings', { 
    formData: settingsData,
    success: null, // <-- ensure success is always defined
    error: null    // optional, if you want error messages
  });
});


// POST settings page (save in session)
router.post('/', requireLogin, (req, res) => {
  const { darkMode, notifications } = req.body;

  req.session.settings = {
    darkMode: darkMode === 'on',
    notifications: notifications === 'on',
    avatar: req.session.settings?.avatar || req.session.user.avatar || '/images/g.png'
  };

  res.render('settings', {
    formData: req.session.settings,
    success: "Settings saved successfully (temporary)."
  });
});

// POST avatar upload
router.post('/update-avatar', requireLogin, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.redirect('/settings');

  // Save new avatar path in session
  const avatarPath = "/uploads/" + req.file.filename;
  req.session.settings = req.session.settings || {};
  req.session.settings.avatar = avatarPath;

  res.redirect('/settings');
});

module.exports = router;
