// GET /api/products?collection=kryptx|merch
// Pulls live products from your Printful store (so editing a design in Printful
// updates the site automatically). Returns name, image, and purchasable variants.
const { pf } = require('../lib/printful');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const list = await pf('/store/products');
    let products = await Promise.all(
      list.map(async (p) => {
        const d = await pf(`/store/products/${p.id}`);
        const variants = (d.sync_variants || [])
          .filter((v) => !v.is_ignored)
          .map((v) => ({
            id: v.id, // sync_variant_id — what we order + fulfill against
            name: v.name,
            price: v.retail_price,
            image:
              (v.files.find((f) => f.type === 'preview') || {}).preview_url ||
              p.thumbnail_url,
          }));
        return {
          id: p.id,
          name: (d.sync_product && d.sync_product.name) || p.name,
          image: (d.sync_product && d.sync_product.thumbnail_url) || p.thumbnail_url,
          variants,
        };
      })
    );

    // optional per-page collection filter by name keywords
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
