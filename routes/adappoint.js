const express = require("express");
const router = express.Router();

// Admin Dashboard (default page)
router.get("/", (req, res) => {
  res.render("adminDashboard");
});

// Show Create Appointment Form
router.get("/appointments/create", (req, res) => {
  res.render("adminDashboard"); // same page, shows create form
});

// Handle Create Appointment
router.post("/appointments/create", (req, res) => {
  const { fullname, date, time, service, notes } = req.body;
  console.log("Admin Created Appointment:", { fullname, date, time, service, notes });

  // Save to DB later
  res.redirect("/admin/appointments/view");
});

// View Appointments Page
router.get("/appointments/view", (req, res) => {
  // Later: fetch from DB
  res.send("Here admin can see appointments with Pending/Approved/Ongoing filters");
});

module.exports = router;
