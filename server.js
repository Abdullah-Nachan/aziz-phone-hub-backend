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

// === Manual Payment Verification Endpoint ===
app.post('/verify-payment', async (req, res) => {
  console.log('verify-payment req.body:', req.body); // Log incoming request for debugging
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderData, customerDetails } = req.body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ success: false, message: 'Missing payment details.' });
  }
  if (!orderData || !orderData.orderId) {
    return res.status(400).json({ success: false, message: 'Missing orderData or orderId.' });
  }
  // Generate signature
  const generated_signature = crypto
    .createHmac('sha256', RAZORPAY_SECRET)
    .update(razorpay_order_id + '|' + razorpay_payment_id)
    .digest('hex');
  if (generated_signature === razorpay_signature) {
    // Payment is verified
    try {
      // Save order to Firestore
      const orderDoc = {
        'order-details': orderData,
        'personal-details': customerDetails,
        paymentId: razorpay_payment_id,
        paymentStatus: 'completed',
        updatedAt: new Date()
      };
      await firestore.collection('orders').doc(orderData.orderId).set(orderDoc, { merge: true });
      res.json({ success: true, message: 'Payment verified and order saved.' });
    } catch (err) {
      console.error('Error saving order to Firestore:', err);
      res.status(500).json({ success: false, message: 'Payment verified but failed to save order.', error: err.message });
    }
  } else {
    res.json({ success: false, message: 'Payment verification failed.' });
  }
});

// === Razorpay Webhook Endpoint ===
app.post('/razorpay-webhook', (req, res) => {
  const webhookSignature = req.headers['x-razorpay-signature'];
  const rawBody = req.body; // Buffer
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET || RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  if (webhookSignature === expectedSignature) {
    const event = JSON.parse(rawBody.toString());
    console.log('Webhook event received:', event.event);
    // Log the full event for debugging
    console.log('Event payload:', JSON.stringify(event, null, 2));
    // Handle important events
    if (event.event === 'payment.captured') {
      console.log('Payment captured for payment_id:', event.payload.payment.entity.id);
      // TODO: Update order status in your database here
    } else if (event.event === 'order.paid') {
      console.log('Order paid for order_id:', event.payload.order.entity.id);
      // TODO: Update order status in your database here
    }
    // You can add more event handlers as needed
    res.status(200).json({ status: 'ok' });
  } else {
    console.warn('Invalid webhook signature');
    res.status(400).json({ status: 'invalid signature' });
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
    });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 