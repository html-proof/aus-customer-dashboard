// Products & inventory page: catalogue stats, filterable product list with sales, and a product detail drawer.
// Relies on index.html + pages.js: $, fmt, esc, iso, charts, downloadCsv.
let prLoaded = false, prRows = [], prCursor = null, prTimer = null, prInv = true;

function prRange(days) {
  const t = new Date(), f = new Date(t - (days - 1) * 864e5);
  $('prFrom').value = iso(f); $('prTo').value = iso(t);
  document.querySelectorAll('#prSeg button').forEach(b => b.classList.toggle('on', +b.dataset.d === days));
}
const prRangeQs = () => `from=${$('prFrom').value}&to=${$('prTo').value}`;
async function prFetch(url) {
  const r = await fetch(url); const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
function prError(e) { $('prErr').textContent = 'Could not load products: ' + e.message; $('prErr').style.display = 'block'; }
const prPrice = (p) => p.priceMin === p.priceMax ? fmt(p.priceMin) : `${fmt(p.priceMin)} – ${fmt(p.priceMax)}`;
const prStock = (stock, state) => stock == null ? '<span class="mu">–</span>'
  : `<span class="pill ${state === 'out' ? 'b' : state === 'low' ? 'w' : ''}">${stock <= 0 ? 'Out of stock' : stock + ' in stock'}</span>`;
const prStatus = (s) => `<span class="pill ${s === 'ACTIVE' ? '' : 'w'}">${esc((s || '').toLowerCase())}</span>`;

async function loadProducts(force) {
  prLoaded = true;
  $('prErr').style.display = 'none'; $('prContent').classList.add('loading');
  try {
    const [s] = await Promise.all([prFetch(`/api/products/stats?${prRangeQs()}${force ? '&refresh=1' : ''}`), loadProductList(true)]);
    prInv = s.inventory;
    $('prInvNote').hidden = prInv;
    $('prStock').disabled = !prInv;
    $('prActive').textContent = s.active.toLocaleString();
    $('prDraft').textContent = s.draft ? `${s.draft} draft` : '';
    $('prUnits').textContent = s.unitsSold.toLocaleString();
    $('prSold').textContent = `${s.productsSold} different products`;
    $('prNone').textContent = s.notSelling.toLocaleString();
    $('prLow').textContent = s.lowStock ?? 'N/A';
    $('prLowNote').textContent = prInv ? `fewer than ${s.lowStockThreshold} left` : 'needs read_inventory';
    $('prOut').textContent = s.outOfStock ?? 'N/A';
  } catch (e) { prError(e); }
  $('prContent').classList.remove('loading');
}

async function loadProductList(reset) {
  const p = new URLSearchParams({ from: $('prFrom').value, to: $('prTo').value, sort: $('prSort').value });
  if ($('prSearch').value.trim()) p.set('q', $('prSearch').value.trim());
  if ($('prStatus').value) p.set('status', $('prStatus').value);
  if ($('prStock').value) p.set('stock', $('prStock').value);
  if (!reset && prCursor) p.set('after', prCursor);
  const j = await prFetch('/api/products?' + p);
  prRows = reset ? j.products : prRows.concat(j.products);
  prCursor = j.nextCursor; $('prMore').hidden = !prCursor;
  renderProductList();
}
function renderProductList() {
  // "Not selling" is filtered here because Shopify can't search products by sales
  const rows = $('prNoSales').checked ? prRows.filter(r => !r.units) : prRows;
  $('prList').innerHTML = rows.length ? rows.map(r => `<tr data-product="${esc(r.id)}" style="cursor:pointer">
      <td><div style="display:flex;gap:10px;align-items:center">${r.image ? `<img src="${esc(r.image)}&width=80" alt="" style="width:40px;height:34px;object-fit:cover;border-radius:4px">` : '<div class="ph"></div>'}
        <div><span class="on-name">${esc(r.title)}</span><br><small class="mu">${esc([r.type, r.variants != null ? r.variants + ' variant' + (r.variants === 1 ? '' : 's') : ''].filter(Boolean).join(' · '))}</small></div></div></td>
      <td>${prStatus(r.status)}</td><td class="r">${prPrice(r)}</td><td class="r">${prStock(r.stock, r.stockState)}</td>
      <td class="r">${r.units ? r.units : '<span class="mu">0</span>'}</td><td class="r"><b>${r.revenue ? fmt(r.revenue) : '<span class="mu">–</span>'}</b></td></tr>`).join('')
    : `<tr><td colspan="6" class="na">${$('prNoSales').checked && prCursor ? 'None in this batch. Press Load more to check further products.' : 'No products match these filters.'}</td></tr>`;
}

async function openProduct(id) {
  $('prDrawer').hidden = false;
  $('prDetail').innerHTML = '<div class="na">Loading product…</div>';
  try {
    const p = await prFetch(`/api/products/${encodeURIComponent(id)}?${prRangeQs()}`);
    const row = (l, v) => `<div class="lrow"><span class="mu">${l}</span><span>${v}</span></div>`;
    const multiLoc = p.variants.some(v => v.locations.length > 1);
    $('prDetail').innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
        <div style="display:flex;gap:14px;align-items:center">
          ${p.image ? `<img src="${esc(p.image)}&width=160" alt="" style="width:72px;height:60px;object-fit:cover;border-radius:6px">` : ''}
          <div><h2 style="margin:0;font-size:20px">${esc(p.title)}</h2>
            <div style="margin-top:6px">${prStatus(p.status)} ${p.inventory ? prStock(p.stock, p.stock == null ? null : p.stock <= 0 ? 'out' : '') : ''}</div></div>
        </div>
        <button class="btn" id="prClose" aria-label="Close">✕</button>
      </div>
      <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:10px;margin:20px 0">
        <div class="card" style="padding:12px"><small class="mu">Units sold</small><div style="font-size:20px;font-weight:700">${p.sales.units}</div></div>
        <div class="card" style="padding:12px"><small class="mu">Revenue</small><div style="font-size:20px;font-weight:700">${fmt(p.sales.revenue)}</div></div>
        <div class="card" style="padding:12px"><small class="mu">Days of stock left</small><div style="font-size:20px;font-weight:700">${p.daysOfStock ?? '–'}</div></div>
      </div>
      <small class="mu">Units sold and revenue are for the selected period. Days of stock left uses the last 90 days' sales pace.</small>
      <h3 style="margin:20px 0 8px;font-size:16px">Units sold per day (last 90 days · ${p.units90} total)</h3>
      <div style="height:160px"><canvas id="prChart"></canvas></div>
      <h3 style="margin:22px 0 8px;font-size:16px">Variants</h3>
      <div style="overflow:auto"><table><thead><tr><th>Variant</th><th>SKU</th><th class="r">Price</th><th class="r">Stock</th></tr></thead><tbody>
        ${p.variants.map(v => `<tr><td>${esc(v.title === 'Default Title' ? '—' : v.title)}</td><td class="mu">${esc(v.sku || '–')}</td>
          <td class="r">${fmt(v.price)}${v.compareAt && v.compareAt > v.price ? `<br><small class="mu"><s>${fmt(v.compareAt)}</s></small>` : ''}</td>
          <td class="r">${!p.inventory ? '<span class="mu">needs read_inventory</span>' : v.stock == null ? '<span class="mu">not tracked</span>' : prStock(v.stock, v.stock <= 0 ? 'out' : '')}</td></tr>
          ${multiLoc ? v.locations.map(l => `<tr><td colspan="3" class="mu" style="padding-left:24px;font-size:12px">↳ ${esc(l.name)}${l.incoming ? ` · ${l.incoming} incoming` : ''}${l.committed ? ` · ${l.committed} committed` : ''}</td><td class="r" style="font-size:12px">${l.available ?? '–'} available</td></tr>`).join('') : ''}`).join('')}
      </tbody></table></div>
      <h3 style="margin:22px 0 4px;font-size:16px">Details</h3>
      ${row('Type', esc(p.type || '–'))}${row('Vendor', esc(p.vendor || '–'))}${row('Created', new Date(p.createdAt).toLocaleDateString('en-AU'))}
      ${p.url && /^https?:\/\//.test(p.url) ? row('Online store', `<a class="on-name" href="${esc(p.url)}" target="_blank" rel="noopener">View product ↗</a>`) : ''}
      ${p.tags?.length ? `<div style="margin-top:12px">${p.tags.map(t => `<span class="scope">${esc(t)}</span>`).join('')}</div>` : ''}`;
    $('prClose').onclick = closeProduct;
    charts.prChart?.destroy();
    charts.prChart = new Chart($('prChart'), {
      type: 'bar',
      data: { labels: p.daily.map(d => new Date(d.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })), datasets: [{ data: p.daily.map(d => d.units), backgroundColor: '#13a079', borderRadius: 2 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6 } }, y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#eef2f0' } } } },
    });
  } catch (e) { $('prDetail').innerHTML = `<div class="err" style="display:block">${esc(e.message)}</div><button class="btn" onclick="closeProduct()">Close</button>`; }
}
function closeProduct() { $('prDrawer').hidden = true; }

$('prDrawer').onclick = (e) => { if (e.target === $('prDrawer')) closeProduct(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('prDrawer').hidden) closeProduct(); });
$('view-products').addEventListener('click', (e) => {
  const row = e.target.closest('[data-product]'); if (row) return openProduct(row.dataset.product);
  const q = e.target.closest('[data-quick]');
  if (!q) return;
  const [k, v] = q.dataset.quick.split(':');
  if (k === 'stock' && !prInv) return;
  $('prStatus').value = 'active';
  $('prStock').value = k === 'stock' ? v : '';
  $('prNoSales').checked = k === 'sales';
  if (k === 'stock') $('prSort').value = 'stock';
  loadProductList(true).catch(prError);
});
$('allProducts').addEventListener('click', (e) => { e.preventDefault(); document.querySelector('nav a[data-v="products"]').click(); });

document.querySelectorAll('#prSeg button').forEach(b => b.onclick = () => { prRange(+b.dataset.d); loadProducts(); });
['prFrom', 'prTo'].forEach(id => $(id).onchange = () => { document.querySelectorAll('#prSeg button').forEach(b => b.classList.remove('on')); loadProducts(); });
['prStatus', 'prStock', 'prSort'].forEach(id => $(id).onchange = () => loadProductList(true).catch(prError));
$('prNoSales').onchange = renderProductList;
$('prSearch').oninput = () => { clearTimeout(prTimer); prTimer = setTimeout(() => loadProductList(true).catch(prError), 350); };
$('prMore').onclick = () => loadProductList(false).catch(prError);
$('prRefresh').onclick = () => loadProducts(true);
$('prExport').onclick = () => downloadCsv(`pixmagic-products-${$('prFrom').value}-${$('prTo').value}.csv`,
  [['Product', 'Status', 'Type', 'Vendor', 'Variants', 'Min price', 'Max price', 'Stock', 'Units sold', 'Orders', 'Revenue'],
   ...prRows.map(r => [r.title, r.status, r.type, r.vendor, r.variants, r.priceMin, r.priceMax, r.stock ?? '', r.units, r.orders, r.revenue.toFixed(2)])]);
prRange(30);
