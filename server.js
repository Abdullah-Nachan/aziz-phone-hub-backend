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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});