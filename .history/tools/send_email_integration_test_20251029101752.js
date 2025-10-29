const nodemailer = require('nodemailer');

async function run() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  const to = process.env.TEST_EMAIL;

  if (!user || !pass) {
    console.error('EMAIL_USER and EMAIL_PASS must be set in environment.');
    process.exit(2);
  }
  if (!to) {
    console.error('TEST_EMAIL environment variable not set. Set TEST_EMAIL to receive the test email.');
    process.exit(2);
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }
  });

  try {
    console.log('Verifying transporter...');
    await transporter.verify();
    console.log('Transporter verified. Sending test email to', to);
    const info = await transporter.sendMail({
      from: `"Everlasting Cemetery" <${user}>`,
      to: to,
      subject: 'Integration Test Email - Everlasting Cemetery',
      text: 'This is a test email sent by tools/send_email_integration_test.js to verify SMTP connectivity.'
    });
    console.log('Email sent successfully:', info && info.messageId ? info.messageId : info);
    process.exit(0);
  } catch (err) {
    console.error('SMTP test failed:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

run();
