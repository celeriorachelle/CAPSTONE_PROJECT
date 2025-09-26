require("dotenv").config();

var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var session = require('express-session');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
var mapsRouter = require('./routes/maps');
var settingsRouter = require('./routes/settings');
var notificationRouter = require('./routes/notification');
var loginRouter = require('./routes/login');
var registerRouter = require('./routes/register'); 
var adminRouter = require('./routes/admin'); 
var supportRouter = require('./routes/support');
var bookRouter = require('./routes/book');
var bookplotsRouter = require('./routes/bookplots');
var viewbookingRouter = require('./routes/viewbooking');
var burialrecordRouter = require('./routes/burialrecord');
var admincreatebRouter = require('./routes/admincreateb');
var adminviewappRouter = require('./routes/adminviewapp');
var forgotpassRouter = require('./routes/forgotpass');
var profileRouter = require('./routes/profile'); 
var admin_inventoryRouter = require('./routes/admin_inventory');
var admin_logsRouter = require('./routes/admin_logs');
var userdashboardRouter = require('./routes/userdashboard');
var paymentRouter = require('./routes/payment');
var installment_remindersRouter = require('./routes/installment_reminders');

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
// const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;


const { register } = require('module');


var app = express();

const bodyParser = require("body-parser");

app.post("/webhook", bodyParser.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    const bookingId = session.metadata.booking_id;
    const userId = session.metadata.user_id;
    const amount = session.amount_total / 100; // Stripe uses cents

    try {
      const db = require("./db"); // import your DB connection

      // Insert into payment_tbl
      await db.query(
        `INSERT INTO payment_tbl 
         (booking_id, user_id, amount, payment_date, method, status) 
         VALUES (?, ?, ?, NOW(), 'Stripe', 'paid')`,
        [bookingId, userId, amount]
      );

      console.log(`Payment recorded for booking ${bookingId}, user ${userId}, ₱${amount}`);
    } catch (dbErr) {
      console.error("Failed to insert payment into DB:", dbErr);
    }
  }

  res.json({ received: true });
});


// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: 'superSecretKey123',
    resave: false,
    saveUninitialized: false,
    cookie: { 
      secure: false,
      maxAge: 1000 * 60 * 60
    }
  })
);

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/maps', mapsRouter);  
app.use('/settings', settingsRouter);
app.use('/notification', notificationRouter);
app.use('/login', loginRouter);
app.use ('/register', registerRouter);
app.use('/admin', adminRouter); 
app.use('/support', supportRouter);
app.use('/book', bookRouter);
app.use('/bookplots', bookplotsRouter);
app.use('/viewbooking', viewbookingRouter);
app.use('/burialrecord', burialrecordRouter);
app.use('/admincreateb', admincreatebRouter);
app.use('/adminviewapp', adminviewappRouter);
app.use('/forgotpass', forgotpassRouter);
app.use('/profile', profileRouter);
app.use('/admin_inventory', admin_inventoryRouter);
app.use('/admin_logs', admin_logsRouter);
app.use('/userdashboard', userdashboardRouter);
app.use('/payment', paymentRouter);
app.use('/installment_reminders', installment_remindersRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
