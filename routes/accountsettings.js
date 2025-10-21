const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db');
const multer = require("multer");
const path = require("path");
const fs = require('fs');

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Middleware to require login
function requireLogin(req,res,next){
  if(!req.session.user) return res.redirect('/login');
  next();
}

// Multer config for avatar upload
const storage = multer.diskStorage({
  destination:(req,file,cb)=>cb(null,uploadDir),
  filename:(req,file,cb)=>{cb(null,`avatar_${req.session.user.user_id}_${Date.now()}${path.extname(file.originalname)}`);} 
});

// only accept image files
function fileFilter (req, file, cb) {
  if (file.mimetype && file.mimetype.startsWith('image/')) cb(null, true);
  else cb(new Error('Only image files are allowed'), false);
}

const upload = multer({ storage, fileFilter });

// GET account settings
router.get('/', requireLogin, async(req,res)=>{
  try{
    const userId = req.session.user.user_id;
    const [rows] = await db.query(
      'SELECT firstName,lastName,email,contact_number,address,avatar FROM user_tbl WHERE user_id=? LIMIT 1',
      [userId]
    );
    const row = rows[0]||{};
    const formData = {
      firstname: row.firstName || '',
      lastname: row.lastName || '',
      email: row.email || '',
      phone: row.contact_number || '',
      address: row.address || '',
      avatar: row.avatar || '/images/g.png'
    };
    res.render('accountsettings',{formData,error:null,success:null});
  }catch(err){
    console.error(err);
    res.render('accountsettings',{formData:{},error:'Failed to load account settings.',success:null});
  }
});

// POST update profile
router.post('/', requireLogin, async(req,res)=>{
  const userId = req.session.user.user_id;
  const {firstname,lastname,email,phone,address,password,confirm_password} = req.body;
  const formData = {firstname,lastname,email,phone,address};
  try{
    if((password||confirm_password) && password!==confirm_password)
      return res.render('accountsettings',{formData,error:'Passwords do not match',success:null});

    let sql, params;
    if(password){
      const hash = await bcrypt.hash(password,10);
      sql = `UPDATE user_tbl SET firstName=?,lastName=?,email=?,contact_number=?,address=?,password_hash=? WHERE user_id=?`;
      params = [firstname,lastname,email,phone,address,hash,userId];
    }else{
      sql = `UPDATE user_tbl SET firstName=?,lastName=?,email=?,contact_number=?,address=? WHERE user_id=?`;
      params = [firstname,lastname,email,phone,address,userId];
    }

    await db.query(sql, params);
    req.session.user.name = firstname;
    res.render('accountsettings',{formData,error:null,success:'Profile updated successfully.'});
  }catch(err){
    console.error(err);
    res.render('accountsettings',{formData,error:'Failed to update profile.',success:null});
  }
});

// POST avatar update
router.post("/update-avatar", requireLogin, upload.single("avatar"), async(req,res)=>{
  try{
    if(!req.file) return res.redirect("/accountsettings");
    const avatarPath = "/uploads/"+req.file.filename;

    // fetch previous avatar to remove file if stored in uploads
    try{
      const [rows] = await db.query("SELECT avatar FROM user_tbl WHERE user_id=? LIMIT 1", [req.session.user.user_id]);
      const prev = rows && rows[0] && rows[0].avatar ? rows[0].avatar : null;
      await db.query("UPDATE user_tbl SET avatar=? WHERE user_id=?", [avatarPath, req.session.user.user_id]);

      // delete previous file if in uploads and not the default image
      if (prev && prev.startsWith('/uploads/') && prev !== '/images/g.png'){
        const prevFull = path.join(__dirname, '..', 'public', prev.replace(/^[\/]+/, ''));
        fs.unlink(prevFull, (err)=>{
          if (err) console.warn('Failed to delete old avatar:', err);
        });
      }

      // set session avatar with a cache-busting query param so redirected page shows the new image immediately
      req.session.user.avatar = avatarPath + "?t=" + Date.now();
      res.redirect("/accountsettings");
    }catch(dbErr){
      console.error(dbErr);
      // if DB update failed, remove the uploaded file to avoid orphan
      const uploadedFull = path.join(uploadDir, req.file.filename);
      fs.unlink(uploadedFull, ()=>{});
      res.redirect("/accountsettings");
    }

  }catch(err){
    console.error(err);
    res.redirect("/accountsettings");
  }
});

// DELETE account
router.post('/delete-account', requireLogin, async(req,res)=>{
  try{
    await db.query('DELETE FROM user_tbl WHERE user_id=?',[req.session.user.user_id]);
    req.session.destroy();
    res.redirect('/goodbye');
  }catch(err){
    console.error(err);
    res.redirect('/accountsettings');
  }
});

module.exports = router;
