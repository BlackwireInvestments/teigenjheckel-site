// POST /api/create-checkout   body: { items: [{ id: <sync_variant_id>, qty: <n> }] }
// Builds a Stripe Checkout Session (your Stripe), US-only shipping, server-trusted
// prices pulled from Printful. Returns { url } to redirect the buyer to Stripe.
const Stripe = require('stripe');
const { pf } = require('../lib/printful');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  try {
    const items = (req.body && req.body.items) || [];
    if (!items.length) {
      res.status(400).json({ error: 'empty cart' });
      return;
    }

    const line_items = [];
    for (const it of items) {
      // re-fetch authoritative price + name from Printful (never trust the client)
      const v = await pf(`/store/variants/${it.id}`);
      const cents = Math.round(parseFloat(v.retail_price) * 100);
      const img = (v.files.find((f) => f.type === 'preview') || {}).preview_url;
      line_items.push({
        quantity: Math.max(1, parseInt(it.qty, 10) || 1),
        price_data: {
          currency: 'usd',
          unit_amount: cents,
          product_data: { name: v.name, images: img ? [img] : [] },
        },
      });
    }

    // compact map for the fulfillment webhook (Stripe metadata cap ~500 chars)
    const pfMeta = JSON.stringify(
      items.map((i) => ({ v: i.id, q: Math.max(1, parseInt(i.qty, 10) || 1) }))
    ).slice(0, 490);

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      shipping_address_collection: { allowed_countries: ['US'] }, // US-only for now
      phone_number_collection: { enabled: true },
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            display_name: 'Standard shipping (US)',
            fixed_amount: {
              amount: parseInt(process.env.SHIP_FLAT_CENTS || '595', 10),
              currency: 'usd',
            },
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 3 },
              maximum: { unit: 'business_day', value: 8 },
            },
          },
        },
      ],
      metadata: { pf: pfMeta },
      success_url: `${origin}/?order=success`,
      cancel_url: `${origin}/?order=cancelled`,
    });

    res.status(200).json({ url: session.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
