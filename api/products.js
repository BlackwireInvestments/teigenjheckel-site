// GET /api/products?collection=kryptx|merch
// Pulls live products from your Printful store. Self-contained (no shared import).
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    if (!process.env.PRINTFUL_TOKEN) {
      res.status(200).json({ products: [], note: 'PRINTFUL_TOKEN not set yet' });
      return;
    }
    const list = await pf('/store/products');
    let products = await Promise.all(
      list.map(async (p) => {
        const d = await pf(`/store/products/${p.id}`);
        const variants = (d.sync_variants || [])
          .filter((v) => !v.is_ignored)
          .map((v) => ({
            id: v.id,
            name: v.name,
            price: v.retail_price,
            image: (v.files.find((f) => f.type === 'preview') || {}).preview_url || p.thumbnail_url,
          }));
        return {
          id: p.id,
          name: (d.sync_product && d.sync_product.name) || p.name,
          image: (d.sync_product && d.sync_product.thumbnail_url) || p.thumbnail_url,
          variants,
        };
      })
    );
    const c = String(req.query.collection || '').toLowerCase();
    if (c) {
      const keys = { kryptx: ['kryptx'], merch: ['teigen', 'gsd', 'obsessed'] }[c] || [c];
      products = products.filter((p) => keys.some((k) => p.name.toLowerCase().includes(k)));
    }
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
    res.status(200).json({ products });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
