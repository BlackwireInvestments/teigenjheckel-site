/* ============================================================
   Teigen J. Heckel storefront widget — dark/gold, framework-free.
   Drop a container on any page:
     <div id="tjh-store" data-collection="kryptx"></div>
     <script src="/store.js" defer></script>
   It pulls live products from /api/products, renders a themed grid + cart,
   and sends the cart to /api/create-checkout (your Stripe → Printful auto-fulfill).
   ============================================================ */
(function () {
  const GOLD = 'linear-gradient(120deg,#EAD9AC,#C9A961 55%,#a8884b)';
  const cart = []; // { id, name, price, qty, image }

  const css = `
  #tjh-store{--gold:#C9A961;--bone:#F2F0EB;--panel:#111116;--line:rgba(255,255,255,.10);font-family:'Manrope',system-ui,sans-serif;color:var(--bone)}
  #tjh-store .tjh-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px}
  #tjh-store .tjh-card{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;transition:.3s}
  #tjh-store .tjh-card:hover{transform:translateY(-6px);border-color:rgba(201,169,97,.5)}
  #tjh-store .tjh-card img{width:100%;aspect-ratio:1/1;object-fit:cover;background:#0d0d10;display:block}
  #tjh-store .tjh-b{padding:16px}
  #tjh-store .tjh-name{font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:600;margin:0 0 6px}
  #tjh-store .tjh-price{font-family:'JetBrains Mono',monospace;color:var(--gold);font-size:15px;margin-bottom:12px}
  #tjh-store select{width:100%;background:#0d0d10;color:var(--bone);border:1px solid var(--line);border-radius:6px;padding:9px;margin-bottom:10px;font-family:inherit}
  #tjh-store .tjh-btn{display:block;width:100%;text-align:center;cursor:pointer;border:none;border-radius:6px;padding:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;font-size:12px;background:${GOLD};color:#1a1408;font-family:inherit;transition:.2s}
  #tjh-store .tjh-btn:hover{transform:translateY(-2px)}
  #tjh-cartbar{position:fixed;right:18px;bottom:18px;z-index:9999;background:${GOLD};color:#1a1408;border:none;border-radius:99px;padding:14px 22px;font-weight:700;letter-spacing:.08em;cursor:pointer;box-shadow:0 14px 40px -12px rgba(0,0,0,.7);font-family:'Manrope',sans-serif}
  #tjh-drawer{position:fixed;top:0;right:0;height:100%;width:min(420px,92vw);background:#0b0b0e;border-left:1px solid rgba(255,255,255,.12);z-index:10000;transform:translateX(100%);transition:.3s;display:flex;flex-direction:column;color:#F2F0EB;font-family:'Manrope',sans-serif}
  #tjh-drawer.open{transform:none}
  #tjh-drawer h3{font-family:'Cormorant Garamond',serif;font-size:26px;margin:0;padding:22px;border-bottom:1px solid rgba(255,255,255,.1)}
  #tjh-drawer .tjh-items{flex:1;overflow:auto;padding:10px 22px}
  #tjh-drawer .tjh-row{display:flex;justify-content:space-between;gap:10px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.07);font-size:14px}
  #tjh-drawer .tjh-foot{padding:22px;border-top:1px solid rgba(255,255,255,.1)}
  #tjh-drawer .tjh-x{position:absolute;top:20px;right:20px;cursor:pointer;color:#9A9AA2;font-size:22px;background:none;border:none}
  #tjh-store .tjh-msg{padding:30px;text-align:center;color:#9A9AA2}`;

  function money(p) { return '$' + parseFloat(p).toFixed(2); }

  function render(root, products) {
    if (!products.length) { root.innerHTML = '<div class="tjh-msg">Products are loading from Printful. If this persists, make sure products are published in your Printful store.</div>'; return; }
    const grid = document.createElement('div'); grid.className = 'tjh-grid';
    products.forEach((p) => {
      const v0 = p.variants[0] || {};
      const card = document.createElement('div'); card.className = 'tjh-card';
      const opts = p.variants.map((v) => `<option value="${v.id}" data-price="${v.price}" data-img="${v.image || p.image}">${v.name.replace(p.name, '').replace(/^[\s\-\/]+/, '') || v.name} — ${money(v.price)}</option>`).join('');
      card.innerHTML = `
        <img src="${p.image}" alt="${p.name}">
        <div class="tjh-b">
          <p class="tjh-name">${p.name}</p>
          <div class="tjh-price">${money(v0.price || 0)}</div>
          ${p.variants.length > 1 ? `<select>${opts}</select>` : ''}
          <button class="tjh-btn">Add to cart</button>
        </div>`;
      const sel = card.querySelector('select');
      const priceEl = card.querySelector('.tjh-price');
      if (sel) sel.addEventListener('change', () => { priceEl.textContent = money(sel.selectedOptions[0].dataset.price); });
      card.querySelector('.tjh-btn').addEventListener('click', () => {
        const v = sel ? { id: sel.value, price: sel.selectedOptions[0].dataset.price, name: p.name + ' ' + sel.selectedOptions[0].text.split(' — ')[0], image: p.image } : { id: v0.id, price: v0.price, name: p.name, image: p.image };
        const ex = cart.find((c) => c.id === v.id);
        if (ex) ex.qty++; else cart.push({ ...v, qty: 1 });
        updateCart();
      });
      grid.appendChild(card);
    });
    root.innerHTML = ''; root.appendChild(grid);
  }

  let bar, drawer;
  function buildCartUI() {
    bar = document.createElement('button'); bar.id = 'tjh-cartbar'; bar.textContent = 'Cart (0)';
    bar.style.display = 'none';
    bar.onclick = () => drawer.classList.add('open');
    drawer = document.createElement('div'); drawer.id = 'tjh-drawer';
    drawer.innerHTML = `<button class="tjh-x">&times;</button><h3>Your bag</h3><div class="tjh-items"></div>
      <div class="tjh-foot"><div style="display:flex;justify-content:space-between;margin-bottom:14px"><span>Subtotal</span><strong class="tjh-sub">$0.00</strong></div>
      <button class="tjh-btn tjh-checkout">Checkout — US shipping</button>
      <p style="font-size:11px;color:#65656d;margin-top:10px;text-align:center">Secure checkout by Stripe · ships in the US</p></div>`;
    document.body.appendChild(bar); document.body.appendChild(drawer);
    drawer.querySelector('.tjh-x').onclick = () => drawer.classList.remove('open');
    drawer.querySelector('.tjh-checkout').onclick = checkout;
  }

  function updateCart() {
    const n = cart.reduce((s, c) => s + c.qty, 0);
    bar.textContent = `Cart (${n})`; bar.style.display = n ? 'block' : 'none';
    const sub = cart.reduce((s, c) => s + c.qty * parseFloat(c.price), 0);
    drawer.querySelector('.tjh-sub').textContent = money(sub);
    drawer.querySelector('.tjh-items').innerHTML = cart.map((c, i) =>
      `<div class="tjh-row"><span>${c.name} ×${c.qty}</span><span>${money(c.qty * c.price)} <button data-i="${i}" style="background:none;border:none;color:#65656d;cursor:pointer">remove</button></span></div>`).join('') || '<p style="color:#65656d;padding:20px 0">Empty.</p>';
    drawer.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => { cart.splice(+b.dataset.i, 1); updateCart(); });
  }

  async function checkout() {
    const btn = drawer.querySelector('.tjh-checkout');
    btn.textContent = 'Loading…'; btn.disabled = true;
    try {
      const r = await fetch('/api/create-checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: cart.map((c) => ({ id: c.id, qty: c.qty })) }),
      });
      const d = await r.json();
      if (d.url) window.location = d.url; else throw new Error(d.error || 'checkout failed');
    } catch (e) { alert('Checkout error: ' + e.message); btn.textContent = 'Checkout — US shipping'; btn.disabled = false; }
  }

  function init() {
    const root = document.getElementById('tjh-store');
    if (!root) return;
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    buildCartUI();
    const col = root.dataset.collection ? `?collection=${encodeURIComponent(root.dataset.collection)}` : '';
    root.innerHTML = '<div class="tjh-msg">Loading the collection…</div>';
    fetch('/api/products' + col).then((r) => r.json())
      .then((d) => render(root, d.products || []))
      .catch((e) => { root.innerHTML = '<div class="tjh-msg">Store temporarily unavailable.</div>'; console.error(e); });
  }

  if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);
})();
