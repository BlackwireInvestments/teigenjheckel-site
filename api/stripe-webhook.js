// POST /api/stripe-webhook  — Stripe calls this when a payment completes.
// Verifies the signature, then creates + CONFIRMS a Printful order (auto-fulfill).
// Needs the raw request body for signature verification (bodyParser disabled below).
const Stripe = require('stripe');
const { pf } = require('../lib/printful');

function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handler(req, res) {
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  let event;
  try {
    const buf = await rawBody(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    res.status(400).send(`Webhook signature verification failed: ${e.message}`);
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    try {
      const full = await stripe.checkout.sessions.retrieve(s.id);
      const ship = full.shipping_details || full.customer_details;
      const a = ship.address;
      const items = JSON.parse(full.metadata.pf || '[]').map((i) => ({
        sync_variant_id: i.v,
        quantity: i.q,
      }));
      // confirm=1 submits the order straight to production = automatic fulfillment
      await pf('/orders?confirm=1', {
        method: 'POST',
        body: JSON.stringify({
          external_id: full.id,
          shipping: 'STANDARD',
          recipient: {
            name: ship.name,
            address1: a.line1,
            address2: a.line2 || '',
            city: a.city,
            state_code: a.state,
            country_code: a.country,
            zip: a.postal_code,
            email: full.customer_details.email,
            phone: full.customer_details.phone || '',
          },
          items,
        }),
      });
    } catch (e) {
      console.error('Printful fulfillment error:', e.message);
      res.status(500).send('fulfillment failed');
      return;
    }
  }

  res.status(200).json({ received: true });
}

module.exports = handler;
// keep Stripe's raw body intact for signature verification
module.exports.config = { api: { bodyParser: false } };
