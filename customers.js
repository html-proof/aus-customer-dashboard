// Customers page: stats, searchable list, top spenders, and a detail drawer with order history.
// Relies on index.html + pages.js: $, fmt, esc, ini, tbl, downloadCsv.
let cuLoaded = false, cuRows = [], cuCursor = null, cuSearchTimer = null;
const since = (d) => new Date(d).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' });

async function cuFetch(url) {
  const r = await fetch(url); const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
function cuScopeMissing(missing) {
  $('cuScope').hidden = !missing; $('cuContent').hidden = missing;
  $('cuExport').disabled = missing;
}

async function loadCustomers(force) {
  cuLoaded = true;
  $('cuErr').style.display = 'none'; $('cuContent').classList.add('loading');
  const t = new Date(), from = new Date(t.getFullYear(), t.getMonth(), 1).toLocaleDateString('en-CA');
  try {
    const [stats] = await Promise.all([
      cuFetch(`/api/customers/stats?from=${from}&to=${t.toLocaleDateString('en-CA')}${force ? '&refresh=1' : ''}`),
      loadList(true),
    ]);
    if (stats.scopeMissing) return cuScopeMissing(true);
    cuScopeMissing(false);
    $('cuTotal').textContent = stats.total.toLocaleString();
    $('cuNew').textContent = `+${stats.newInRange} new this month`;
    $('cuRate').textContent = stats.returningRate == null ? '–' : stats.returningRate.toFixed(0) + '%';
    $('cuRet').textContent = `${stats.returning.toLocaleString()} of ${stats.withOrders.toLocaleString()} buyers ordered 2+ times`;
    $('cuAvg').textContent = fmt(stats.avgSpend12m);
    $('cuBuyers').textContent = `${stats.buyers12m} buyers in the last 12 months`;
    $('cuLapsed').textContent = stats.lapsed;
    $('cuSubs').textContent = stats.subscribed == null ? '' : `${stats.subscribed.toLocaleString()} subscribed to email`;
    const max = Math.max(1, ...stats.topSpenders.map(s => s.spent));
    $('cuTop').innerHTML = stats.topSpenders.length ? stats.topSpenders.map(s =>
      `<div class="frow" style="grid-template-columns:30px 1fr 1fr 80px;cursor:pointer" data-open="${esc(s.id)}">
        <span class="av">${esc(ini(s.name))}</span><span>${esc(s.name)}<br><small class="mu">${s.orders} order${s.orders === 1 ? '' : 's'}</small></span>
        <div class="bar" style="height:10px"><i style="width:${s.spent / max * 100}%"></i></div><b class="r">${fmt(s.spent)}</b></div>`).join('')
      : '<div class="na">No customer orders in the last 12 months.</div>';
  } catch (e) { $('cuErr').textContent = 'Could not load customers: ' + e.message; $('cuErr').style.display = 'block'; }
  $('cuContent').classList.remove('loading');
}

async function loadList(reset) {
  const q = $('cuSearch').value.trim(), sort = $('cuSort').value;
  const j = await cuFetch(`/api/customers?sort=${sort}${q ? '&q=' + encodeURIComponent(q) : ''}${!reset && cuCursor ? '&after=' + encodeURIComponent(cuCursor) : ''}`);
  if (j.scopeMissing) return j;
  cuRows = reset ? j.customers : cuRows.concat(j.customers);
  cuCursor = j.nextCursor;
  $('cuMore').hidden = !cuCursor;
  $('cuList').innerHTML = cuRows.length ? cuRows.map(c => `<tr data-open="${esc(c.id)}" style="cursor:pointer">
      <td><div style="display:flex;gap:10px;align-items:center"><span class="av">${esc(ini(c.name))}</span>
        <div><span class="on-name">${esc(c.name || 'Unnamed customer')}</span>${c.email ? `<br><small class="mu">${esc(c.email)}</small>` : ''}</div></div></td>
      <td>${esc(c.location || '–')}</td><td class="r">${c.orders}</td><td class="r">${fmt(c.spent)}</td><td class="r mu">${since(c.createdAt)}</td></tr>`).join('')
    : `<tr><td colspan="5" class="na">${q ? 'No customers match your search.' : 'No customers yet.'}</td></tr>`;
  return j;
}

async function openCustomer(id) {
  $('cuDrawer').hidden = false;
  $('cuDetail').innerHTML = '<div class="na">Loading customer…</div>';
  try {
    const c = await cuFetch('/api/customers/' + encodeURIComponent(id));
    const pill = (s, good) => `<span class="pill ${good ? '' : 'w'}">${esc((s || '').replace(/_/g, ' ').toLowerCase())}</span>`;
    $('cuDetail').innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div style="display:flex;gap:12px;align-items:center"><span class="av" style="width:44px;height:44px;font-size:14px;background:var(--g);color:#fff">${esc(ini(c.name))}</span>
          <div><h2 style="margin:0;font-size:20px">${esc(c.name || 'Unnamed customer')}</h2><small class="mu">Customer since ${since(c.createdAt)}</small></div></div>
        <button class="btn" id="cuClose" aria-label="Close">✕</button>
      </div>
      <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:10px;margin:20px 0">
        <div class="card" style="padding:12px"><small class="mu">Orders</small><div style="font-size:20px;font-weight:700">${c.orders}</div></div>
        <div class="card" style="padding:12px"><small class="mu">Total spent</small><div style="font-size:20px;font-weight:700">${fmt(c.spent)}</div></div>
        <div class="card" style="padding:12px"><small class="mu">Avg order</small><div style="font-size:20px;font-weight:700">${fmt(c.avgOrder)}</div></div>
      </div>
      <div class="lrow"><span class="mu">Email</span><span>${c.email ? esc(c.email) : '<span class="mu">hidden — needs protected data access</span>'}</span></div>
      <div class="lrow"><span class="mu">Phone</span><span>${esc(c.phone || '–')}</span></div>
      <div class="lrow"><span class="mu">Location</span><span>${esc(c.location || '–')}</span></div>
      <div class="lrow"><span class="mu">Last order</span><span>${c.lastOrder ? new Date(c.lastOrder).toLocaleDateString('en-AU') : '–'}</span></div>
      ${c.tags?.length ? `<div class="lrow"><span class="mu">Tags</span><span>${c.tags.map(t => `<span class="scope">${esc(t)}</span>`).join('')}</span></div>` : ''}
      ${c.note ? `<div class="lrow"><span class="mu">Note</span><span style="max-width:70%;text-align:right">${esc(c.note)}</span></div>` : ''}
      <h3 style="margin:22px 0 8px;font-size:16px">Order history</h3>
      ${c.orderHistory.length ? `<table><thead><tr><th>Order</th><th>Date</th><th>Status</th><th class="r">Total</th></tr></thead><tbody>${c.orderHistory.map(o => `
        <tr><td class="on-name" title="${esc(o.items.join(', '))}">${esc(o.name)}<br><small class="mu" style="font-weight:400">${esc(o.items.slice(0, 2).join(', '))}</small></td>
        <td>${new Date(o.date).toLocaleDateString('en-AU')}</td><td>${pill(o.payment, o.payment === 'PAID')} ${pill(o.fulfilment, o.fulfilment === 'FULFILLED')}</td>
        <td class="r">${fmt(o.total)}</td></tr>`).join('')}</tbody></table>` : '<div class="na">No orders yet.</div>'}`;
    $('cuClose').onclick = closeCustomer;
  } catch (e) { $('cuDetail').innerHTML = `<div class="err" style="display:block">${esc(e.message)}</div><button class="btn" onclick="closeCustomer()">Close</button>`; }
}
function closeCustomer() { $('cuDrawer').hidden = true; }

$('cuDrawer').onclick = (e) => { if (e.target === $('cuDrawer')) closeCustomer(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('cuDrawer').hidden) closeCustomer(); });
$('view-customers').addEventListener('click', (e) => { const row = e.target.closest('[data-open]'); if (row) openCustomer(row.dataset.open); });
$('cuSearch').oninput = () => { clearTimeout(cuSearchTimer); cuSearchTimer = setTimeout(() => loadList(true).catch(e => { $('cuErr').textContent = e.message; $('cuErr').style.display = 'block'; }), 350); };
$('cuSort').onchange = () => loadList(true);
$('cuMore').onclick = () => loadList(false);
$('cuRefresh').onclick = () => loadCustomers(true);
$('cuExport').onclick = () => downloadCsv(`pixmagic-customers-${new Date().toLocaleDateString('en-CA')}.csv`,
  [['Name', 'Email', 'Location', 'Orders', 'Total spent', 'Customer since', 'Tags'],
   ...cuRows.map(c => [c.name, c.email || '', c.location || '', c.orders, c.spent.toFixed(2), c.createdAt.slice(0, 10), (c.tags || []).join('; ')])]);
