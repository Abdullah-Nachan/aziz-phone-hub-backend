// server.js
// Node.js backend for Razorpay LIVE payment verification and webhook handling
// Replace placeholders with your actual Razorpay keys and secrets

const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3000;

// === CONFIGURATION ===
const RAZORPAY_SECRET = 'RAZORPAY_LIVE_SECRET_KEY'; // <-- Replace with your Razorpay LIVE secret key
const RAZORPAY_WEBHOOK_SECRET = 'RAZORPAY_WEBHOOK_SECRET'; // <-- Replace with your Razorpay webhook secret

// Parse JSON bodies
app.use(bodyParser.json());
// Parse raw body for webhook signature verification
app.use('/razorpay-webhook', bodyParser.raw({ type: 'application/json' }));

// === Manual Payment Verification Endpoint ===
app.post('/verify-payment', (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderData } = req.body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ success: false, message: 'Missing payment details.' });
  }
  // Generate signature
  const generated_signature = crypto
    .createHmac('sha256', RAZORPAY_SECRET)
    .update(razorpay_order_id + '|' + razorpay_payment_id)
    .digest('hex');
  if (generated_signature === razorpay_signature) {
    // Payment is verified
    // TODO: Save order to database, send notification/email here
    console.log('Payment verified for order:', orderData?.orderId || razorpay_order_id);
    res.json({ success: true, message: 'Payment verified successfully.' });
  } else {
    res.json({ success: false, message: 'Payment verification failed.' });
  }
});

// === Razorpay Webhook Endpoint ===
app.post('/razorpay-webhook', (req, res) => {
  // Razorpay sends the signature in headers
  const webhookSignature = req.headers['x-razorpay-signature'];
  const rawBody = req.body; // Buffer
  // Verify webhook signature
  const expectedSignature = crypto
    .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  if (webhookSignature === expectedSignature) {
    // Webhook is verified
    const event = JSON.parse(rawBody.toString());
    console.log('Webhook event:', event.event);
    // TODO: Handle event types (payment.captured, order.paid, etc.)
    // TODO: Send yourself a notification/email here if needed
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 