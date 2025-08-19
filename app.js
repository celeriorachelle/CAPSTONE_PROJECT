var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
var appointmentRouter = require('./routes/appointment');
var mapsRouter = require('./routes/maps');
var settingsRouter = require('./routes/settings');
var userhomeRouter = require('./routes/userhome');
var notificationRouter = require('./routes/notification');
var loginRouter = require('./routes/login');
var registerRouter = require('./routes/register'); 
var adminRouter = require('./routes/admin'); 
var supportRouter = require('./routes/support');

const { register } = require('module');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/appointment', appointmentRouter);
app.use('/maps', mapsRouter);  
app.use('/settings', settingsRouter);
app.use('/userhome', userhomeRouter);
app.use('/notification', notificationRouter);
app.use('/login', loginRouter);
app.use ('/register', registerRouter);
app.use('/admin', adminRouter); 
app.use('/support', supportRouter);

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
