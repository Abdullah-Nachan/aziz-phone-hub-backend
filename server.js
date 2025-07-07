// server.js
// Node.js backend for Razorpay LIVE payment verification and webhook handling
// Replace placeholders with your actual Razorpay keys and secrets

const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const cors = require('cors');
const admin = require('firebase-admin');
const app = express();
const PORT = process.env.PORT || 3000;
const nodemailer = require('nodemailer');

// === CONFIGURATION ===
const RAZORPAY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'YOUR_TEST_SECRET'; // <-- Replace with your Razorpay LIVE secret key
const RAZORPAY_WEBHOOK_SECRET = 'RAZORPAY_WEBHOOK_SECRET'; // <-- Replace with your Razorpay webhook secret

// Parse JSON bodies
app.use(bodyParser.json());
// Parse raw body for webhook signature verification
app.use('/razorpay-webhook', bodyParser.raw({ type: 'application/json' }));
app.use(cors());

// Firebase Admin SDK setup
if (!admin.apps.length) {
  let serviceAccount;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    // Decode base64 to JSON
    const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8');
    serviceAccount = JSON.parse(decoded);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    // fallback for local dev
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  }
}
const firestore = admin.firestore();

// === Razorpay Webhook Endpoint ===
app.post('/razorpay-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const crypto = require('crypto');
  const secret = 'razorpay_webhook_secret'; // same as dashboard webhook secret
  const signature = req.headers['x-razorpay-signature'];
  const rawBody = req.body;

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  if (signature === expectedSignature) {
    const event = JSON.parse(rawBody.toString());

    // ✅ Early response to Razorpay
    res.status(200).send('Webhook received');

    try {
      const payment = event.payload.payment.entity;
      const orderId = payment.notes?.order_id || payment.order_id;
      const paymentId = payment.id;
      const paymentType = payment.notes?.payment_type || 'default';

      if (!orderId) {
        console.warn('⚠️ Order ID missing in webhook payload');
        return;
      }

      const orderRef = firestore.collection('orders').doc(orderId);
      const orderDoc = await orderRef.get();

      if (!orderDoc.exists) {
        console.warn('⚠️ Order not found in Firestore:', orderId);
        return;
      }

      const paymentStatus = (paymentType === 'partial_cod_advance') ? 'advance_paid' : 'paid';

      await orderRef.set({
        paymentStatus: paymentStatus,
        paymentId: paymentId,
        paymentVerified: true,
        paymentVerifiedAt: new Date(),
        updatedAt: new Date()
      }, { merge: true });

      console.log(`✅ Payment captured and order ${orderId} marked as ${paymentStatus}`);

      // === Nodemailer: Send order confirmation email ===
      try {
        const orderData = orderDoc.data();
        const customerEmail = orderData.customerDetails?.email || orderData.email;
        const customerName = orderData.customerDetails?.firstName || 'Customer';
        if (customerEmail) {
          // Configure transporter (replace with your real credentials)
          const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
              user: 'nachanabdullah123@gmail.com', // Replace with your email
              pass: 'rpjo egcf kzls kduf'     // Replace with your app password
            }
          });

          // Compose email
          const mailOptions = {
            from: 'Aziz Phone Hub <nachanabdullah123@gmail.com>',
            to: customerEmail,
            subject: 'Order Confirmation - Aziz Phone Hub',
            text: `Dear ${customerName},\n\nYour order has been confirmed!\nOrder ID: ${orderId}\nAmount: ₹${orderData.total || ''}\n\nThank you for shopping with us!\n\nAziz Phone Hub`,
            html: `<p>Dear ${customerName},</p><p>Your order has been <b>confirmed</b>!</p><p><b>Order ID:</b> ${orderId}<br><b>Amount:</b> ₹${orderData.total || ''}</p><p>Thank you for shopping with us!<br>Aziz Phone Hub</p>`
          };

          await transporter.sendMail(mailOptions);
          console.log(`✅ Order confirmation email sent to ${customerEmail}`);
        } else {
          console.warn('⚠️ No customer email found for order', orderId);
        }
      } catch (emailErr) {
        console.error('❌ Failed to send order confirmation email:', emailErr);
      }
      // === End Nodemailer logic ===
    } catch (err) {
      console.error('❌ Webhook processing error:', err);
    }
  } else {
    console.warn('❌ Invalid webhook signature');
    res.status(400).send('Invalid signature');
  }
});


// === Health Check ===
app.get('/', (req, res) => {
  res.send('Razorpay verification backend is running.');
});

// Add Razorpay order creation endpoint for frontend
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_g1q57RmuF0n22s',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'YOUR_TEST_SECRET',
});

app.post('/create-order', async (req, res) => {
  const { amount, currency } = req.body;
  try {
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // in paise
      currency: currency || 'INR',
      payment_capture: 1 // Auto-capture payments immediately
    });
    res.json(order);
  } catch (err) {
    console.error('Error creating Razorpay order:', err);
    res.status(500).json({ error: err.message });
  }
});

// === Firestore Listener for New Orders (Admin Notification) ===
firestore.collection('orders').onSnapshot(snapshot => {
  snapshot.docChanges().forEach(async change => {
    if (change.type === 'added') {
      const order = change.doc.data();
      // Only notify if not already notified
      if (!order.adminNotified) {
        try {
          const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
              user: 'nachanabdullah123@gmail.com', // your email
              pass: 'rpjo egcf kzls kduf' // your app password
            }
          });

          // Prefer order-details.customerDetails, else personal-details
          const orderDetails = order['order-details'] || {};
          const personalDetails = order['personal-details'] || {};
          const customer = orderDetails.customerDetails || personalDetails || {};
          const address = customer || {};

          // Prefer order-details.createdAt, else updatedAt, else now
          const orderDate = orderDetails.createdAt
            ? new Date(orderDetails.createdAt).toLocaleString()
            : (order.updatedAt ? order.updatedAt : new Date().toLocaleString());

          const items = Array.isArray(order.items) ? order.items : [];

          const itemsHtml = items.length
            ? `<ul>` + items.map(item =>
                `<li>${item.name || ''} (x${item.quantity || 1}) - ₹${item.price || ''}</li>`
              ).join('') + `</ul>`
            : 'No items listed.';

          const mailOptions = {
            from: 'Aziz Phone Hub <nachanabdullah123@gmail.com>',
            to: 'azizsphonehub@gmail.com',
            subject: `New Order Received - ${change.doc.id}`,
            text: `A new order has been placed.\n\nOrder ID: ${change.doc.id}\nOrder Date: ${orderDate}\n\nCustomer Name: ${customer.firstName || ''} ${customer.lastName || ''}\nPhone: ${customer.phone || ''}\nEmail: ${customer.email || ''}\nAddress: ${address.address || ''}, ${address.address2 || ''}, ${address.city || ''}, ${address.state || ''}, ${address.zip || ''}, ${address.country || ''}\n\nItems:\n${items.map(item => `${item.name || ''} (x${item.quantity || 1}) - ₹${item.price || ''}`).join('\n')}\n\nTotal: ₹${order.total}\nPayment Method: ${order.paymentMethod || ''}\n\nCheck Firestore for full details.`,
            html: `<h3>New Order Received</h3>
              <p><b>Order ID:</b> ${change.doc.id}</p>
              <p><b>Order Date:</b> ${orderDate}</p>
              <h4>Customer Details</h4>
              <p>
                <b>Name:</b> ${customer.firstName || ''} ${customer.lastName || ''}<br>
                <b>Phone:</b> ${customer.phone || ''}<br>
                <b>Email:</b> ${customer.email || ''}<br>
                <b>Address:</b> ${address.address || ''}, ${address.address2 || ''}, ${address.city || ''}, ${address.state || ''}, ${address.zip || ''}, ${address.country || ''}<br>
              </p>
              <h4>Order Items</h4>
              ${itemsHtml}
              <p>
                <b>Total:</b> ₹${order.total}<br>
                <b>Payment Method:</b> ${order.paymentMethod || ''}<br>
              </p>
              <p>Check Firestore for full details.</p>`
          };

          await transporter.sendMail(mailOptions);
          console.log('Admin notified for new order:', change.doc.id);

          // Mark as notified to avoid duplicate emails
          await change.doc.ref.update({ adminNotified: true });
        } catch (err) {
          console.error('❌ Failed to send admin order email:', err);
        }
      }
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});