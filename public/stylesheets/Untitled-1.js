// Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER, // your email
    pass: process.env.EMAIL_PASS, // your app password
  },
});

router.get("/success", async (req, res) => {
  try {
    const paymentData = req.session.paymentData;
    if (paymentData) {
      // -------------------- Existing logic --------------------
      if (paymentData.due_date) {
        const newDueDate = new Date(paymentData.due_date);
        newDueDate.setDate(newDueDate.getDate() + 30);
        await db.query(
          `UPDATE payment_tbl SET due_date = ? WHERE booking_id = ?`,
          [newDueDate.toISOString().slice(0, 10), paymentData.booking_id]
        );
      }

      if (paymentData.booking_id && paymentData.user_id) {
        try {
          await db.query(
            `UPDATE booking_tbl SET status = 'approved' WHERE booking_id = ?`,
            [paymentData.booking_id]
          );
          await db.query(
            `INSERT INTO notification_tbl (user_id, booking_id, message, is_read, datestamp, plot_id)
             VALUES (?, ?, ?, 0, NOW(), ?)`,
            [paymentData.user_id, paymentData.booking_id, 'Your plot booking is approved! Thanks for choose Everlasting', paymentData.plot_id || null]
          );
          await addLog({
            user_id: paymentData.user_id,
            user_role: req.session.user?.role || "user",
            action: "Payment Success & Booking Approved",
            details: `User ${paymentData.user_email} payment succeeded for Plot #${paymentData.plot_id} (₱${paymentData.amount || paymentData.monthly_amount}). Booking ${paymentData.booking_id} approved.`,
          });
        } catch (approveErr) {
          console.error('Error auto-approving booking after payment:', approveErr);
        }
      }

      // -------------------- Generate and send receipt --------------------
      // Fetch booking and plot details
      const [bookingRows] = await db.query(
        `SELECT b.booking_id, b.user_id, u.fullname AS user_name, u.email AS user_email, 
                pm.plot_number, pm.location, pm.price 
         FROM booking_tbl b
         JOIN user_tbl u ON b.user_id = u.user_id
         JOIN plot_map_tbl pm ON b.plot_id = pm.plot_id
         WHERE b.booking_id = ? LIMIT 1`,
        [paymentData.booking_id]
      );

      if (bookingRows.length) {
        const booking = bookingRows[0];
        const receiptData = {
          booking_id: booking.booking_id,
          user_name: booking.user_name,
          user_email: booking.user_email,
          plot_number: booking.plot_number,
          plot_location: booking.location,
          amount: paymentData.amount || paymentData.monthly_amount,
          payment_type: paymentData.payment_type,
          date: new Date().toLocaleDateString("en-PH"),
        };

        // Render receipt EJS to HTML
        const receiptHtml = await ejs.renderFile(
          path.join(__dirname, "../views/receipt.ejs"),
          { receipt: receiptData }
        );

        // Send receipt via email
        await transporter.sendMail({
          from: `"Everlasting Cemetery" <${process.env.EMAIL_USER}>`,
          to: receiptData.user_email,
          subject: `Receipt for Payment - Plot #${receiptData.plot_number}`,
          html: receiptHtml,
        });
      }

      delete req.session.paymentData;

      // Render success page
      res.render("payment_success");
    }
  } catch (err) {
    console.error("Error logging payment success or sending receipt:", err);
    res.status(500).send("Payment success, but log or receipt not recorded.");
  }
});