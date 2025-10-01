const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../db');
const multer = require("multer");
const path = require("path");

// Middleware to require login
function requireLogin(req,res,next){
  if(!req.session.user) return res.redirect('/login');
  next();
}

// Multer config for avatar upload
const storage = multer.diskStorage({
  destination:(req,file,cb)=>cb(null,"public/uploads/"),
  filename:(req,file,cb)=>{cb(null,`avatar_${req.session.user.user_id}${path.extname(file.originalname)}`);}
});
const upload = multer({ storage });

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
    await db.query("UPDATE user_tbl SET avatar=? WHERE user_id=?", [avatarPath, req.session.user.user_id]);
    req.session.user.avatar = avatarPath;
    res.redirect("/accountsettings");
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
