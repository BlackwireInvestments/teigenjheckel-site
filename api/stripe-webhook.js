// POST /api/stripe-webhook — Stripe calls this on payment completion.
// Verifies signature, then creates + CONFIRMS a Printful order (auto-fulfill).
const Stripe = require('stripe');
const PF_BASE = 'https://api.printful.com';
function pfHeaders() {
  const h = { Authorization: `Bearer ${process.env.PRINTFUL_TOKEN}`, 'Content-Type': 'application/json' };
  if (process.env.PRINTFUL_STORE_ID) h['X-PF-Store-Id'] = process.env.PRINTFUL_STORE_ID;
  return h;
}
async function pf(path, opts = {}) {
  const r = await fetch(PF_BASE + path, { ...opts, headers: { ...pfHeaders(), ...(opts.headers || {}) } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Printful ${r.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data.result;
}
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
      const items = JSON.parse(full.metadata.pf || '[]').map((i) => ({ sync_variant_id: i.v, quantity: i.q }));
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
module.exports.config = { api: { bodyParser: false } };
