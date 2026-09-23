// Orders page: status counts, filterable list, and an order detail drawer.
// Relies on index.html + pages.js: $, fmt, esc, iso, show, downloadCsv.
let orLoaded = false, orRows = [], orCursor = null, orTimer = null;
const orLabel = (s) => esc((s || '').replace(/_/g, ' ').toLowerCase());
const orPay = (s) => {
  const bad = ['VOIDED', 'EXPIRED', 'REFUNDED'].includes(s), warn = ['PENDING', 'AUTHORIZED', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED'].includes(s);
  return `<span class="pill ${bad ? 'b' : warn ? 'w' : ''}">● ${orLabel(s)}</span>`;
};
const orFul = (s) => `<span class="pill ${s === 'FULFILLED' ? '' : 'w'}">● ${orLabel(s)}</span>`;
const orChannel = (c) => ({ web: 'Online store', pos: 'Point of sale', shopify_draft_order: 'Draft order' }[c] || c || '–');

function orRange(days) {
  const t = new Date(), f = new Date(t - (days - 1) * 864e5);
  $('orFrom').value = iso(f); $('orTo').value = iso(t);
  document.querySelectorAll('#orSeg button').forEach(b => b.classList.toggle('on', +b.dataset.d === days));
}
const orParams = () => {
  const p = new URLSearchParams({ from: $('orFrom').value, to: $('orTo').value, sort: $('orSort').value });
  if ($('orSearch').value.trim()) p.set('q', $('orSearch').value.trim());
  if ($('orPay').value) p.set('payment', $('orPay').value);
  if ($('orFul').value) p.set('fulfilment', $('orFul').value);
  if ($('orStatus').value) p.set('status', $('orStatus').value);
  $('orClear').hidden = !($('orSearch').value || $('orPay').value || $('orFul').value || $('orStatus').value);
  return p;
};
async function orFetch(url) {
  const r = await fetch(url); const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
function orError(e) { $('orErr').textContent = 'Could not load orders: ' + e.message; $('orErr').style.display = 'block'; }

async function loadOrders(force) {
  orLoaded = true;
  $('orErr').style.display = 'none'; $('orContent').classList.add('loading');
  try {
    const [s] = await Promise.all([
      orFetch(`/api/orders/stats?from=${$('orFrom').value}&to=${$('orTo').value}${force ? '&refresh=1' : ''}`),
      loadOrderList(true),
    ]);
    $('orTotal').textContent = s.total.toLocaleString(); $('orUnf').textContent = s.unfulfilled.toLocaleString();
    $('orOpenUnf').textContent = `${s.openUnfulfilled} open in total, any date`;
    $('orPend').textContent = s.pending.toLocaleString(); $('orRef').textContent = s.refunded.toLocaleString();
    $('orCan').textContent = s.cancelled.toLocaleString();
  } catch (e) { orError(e); }
  $('orContent').classList.remove('loading');
}

async function loadOrderList(reset) {
  const p = orParams();
  if (!reset && orCursor) p.set('after', orCursor);
  const j = await orFetch('/api/orders?' + p);
  orRows = reset ? j.orders : orRows.concat(j.orders);
  orCursor = j.nextCursor; $('orMore').hidden = !orCursor;
  $('orList').innerHTML = orRows.length ? orRows.map(o => `<tr data-order="${esc(o.id)}" style="cursor:pointer${o.cancelled ? ';opacity:.55' : ''}">
      <td class="on-name">${esc(o.name)}${o.cancelled ? ' <small class="bad">cancelled</small>' : ''}</td>
      <td>${new Date(o.date).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td>
      <td>${esc(o.customer || '–')}</td><td class="mu">${esc(orChannel(o.channel))}</td>
      <td>${orPay(o.payment)}</td><td>${orFul(o.fulfilment)}</td><td class="r">${o.items}</td><td class="r"><b>${fmt(o.total)}</b></td></tr>`).join('')
    : '<tr><td colspan="8" class="na">No orders match these filters.</td></tr>';
}

async function openOrder(id) {
  $('orDrawer').hidden = false;
  $('orDetail').innerHTML = '<div class="na">Loading order…</div>';
  try {
    const o = await orFetch('/api/orders/' + encodeURIComponent(id));
    const T = o.totals, row = (l, v, cls = '') => `<div class="lrow ${cls}"><span class="mu">${l}</span><span>${v}</span></div>`;
    $('orDetail').innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div><h2 style="margin:0;font-size:22px">${esc(o.name)}</h2>
          <small class="mu">${new Date(o.createdAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })} · ${esc(orChannel(o.channel))}</small>
          <div style="margin-top:8px">${orPay(o.payment)} ${orFul(o.fulfilment)}</div></div>
        <button class="btn" id="orClose" aria-label="Close">✕</button>
      </div>
      ${o.cancelledAt ? `<div class="err" style="display:block;margin-top:14px">Cancelled ${new Date(o.cancelledAt).toLocaleDateString('en-AU')}${o.cancelReason ? ' — ' + orLabel(o.cancelReason) : ''}</div>` : ''}

      <h3 style="margin:22px 0 8px;font-size:16px">Items</h3>
      ${o.items.map(li => `<div class="prow" style="grid-template-columns:44px 1fr 40px 80px">
        ${li.image ? `<img src="${esc(li.image)}&width=88" alt="">` : '<div class="ph"></div>'}
        <span>${esc(li.title)}${li.variant ? `<br><small class="mu">${esc(li.variant)}</small>` : ''}${li.sku ? `<br><small class="mu">SKU ${esc(li.sku)}</small>` : ''}</span>
        <span class="mu">×${li.qty}</span><b class="r">${fmt(li.total)}</b></div>`).join('')}

      <h3 style="margin:22px 0 4px;font-size:16px">Summary</h3>
      ${row('Subtotal', fmt(T.subtotal))}${T.discounts ? row('Discounts' + (o.discountCodes.length ? ` (${esc(o.discountCodes.join(', '))})` : ''), '−' + fmt(T.discounts)) : ''}
      ${row('Shipping', fmt(T.shipping))}${row('Tax (GST)', fmt(T.tax))}
      <div class="lrow"><b>Total</b><b>${fmt(T.total)}</b></div>${T.refunded ? row('Refunded', '<span class="bad">−' + fmt(T.refunded) + '</span>') : ''}

      <h3 style="margin:22px 0 4px;font-size:16px">Customer</h3>
      ${o.customer ? row('Name', `<a class="on-name" href="#" data-customer="${esc(o.customer.id)}">${esc(o.customer.name)}</a>`) + row('Orders placed', o.customer.orders)
        : '<div class="na">Customer details need the read_customers permission.</div>'}
      ${o.shipTo ? row('Ships to', esc(o.shipTo)) : ''}

      <h3 style="margin:22px 0 4px;font-size:16px">Fulfilment</h3>
      ${o.fulfillments.length ? o.fulfillments.map(f => row(`${orLabel(f.status)} · ${new Date(f.date).toLocaleDateString('en-AU')}`,
        f.tracking.map(t => t.url ? `<a class="on-name" href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.company || 'Track')} ${esc(t.number || '')}</a>` : esc(`${t.company || ''} ${t.number || ''}`)).join('<br>') || '–')).join('')
        : '<div class="na">Not fulfilled yet.</div>'}

      <h3 style="margin:22px 0 4px;font-size:16px">Payments</h3>
      ${o.transactions.length ? o.transactions.map(t => row(`${orLabel(t.kind)} · ${esc(t.gateway || '')}<br><small>${new Date(t.date).toLocaleString('en-AU')}</small>`,
        `${fmt(t.amount)} <span class="pill ${t.status === 'SUCCESS' ? '' : 'b'}">${orLabel(t.status)}</span>`)).join('') : '<div class="na">No transactions.</div>'}

      ${o.note ? `<h3 style="margin:22px 0 4px;font-size:16px">Note</h3><p style="margin:0">${esc(o.note)}</p>` : ''}
      ${o.tags?.length ? `<div style="margin-top:14px">${o.tags.map(t => `<span class="scope">${esc(t)}</span>`).join('')}</div>` : ''}`;
    $('orClose').onclick = closeOrder;
    const cl = $('orDetail').querySelector('[data-customer]');
    if (cl) cl.onclick = (e) => { e.preventDefault(); closeOrder(); openCustomer(cl.dataset.customer); };
  } catch (e) { $('orDetail').innerHTML = `<div class="err" style="display:block">${esc(e.message)}</div><button class="btn" onclick="closeOrder()">Close</button>`; }
}
function closeOrder() { $('orDrawer').hidden = true; }

$('orDrawer').onclick = (e) => { if (e.target === $('orDrawer')) closeOrder(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('orDrawer').hidden) closeOrder(); });
$('view-orders').addEventListener('click', (e) => {
  const row = e.target.closest('[data-order]'); if (row) return openOrder(row.dataset.order);
  const q = e.target.closest('[data-quick]');
  if (q) {
    const [k, v] = q.dataset.quick.split(':');
    $('orPay').value = k === 'payment' ? v : ''; $('orFul').value = k === 'fulfilment' ? v : ''; $('orStatus').value = k === 'status' ? v : '';
    loadOrderList(true).catch(orError);
  }
});
// Clicking an order anywhere else in the app (Overview's recent orders) opens it too
$('ordersBody').addEventListener('click', (e) => {
  const name = e.target.closest('tr')?.querySelector('.on-name')?.textContent;
  const hit = name && (data?.recentOrders || []).find(o => o.name === name);
  if (hit?.id) openOrder(hit.id);
});
$('allOrders').addEventListener('click', (e) => {
  e.preventDefault();
  document.querySelector('nav a[data-v="orders"]').click();
});

document.querySelectorAll('#orSeg button').forEach(b => b.onclick = () => { orRange(+b.dataset.d); loadOrders(); });
['orFrom', 'orTo'].forEach(id => $(id).onchange = () => { document.querySelectorAll('#orSeg button').forEach(b => b.classList.remove('on')); loadOrders(); });
['orPay', 'orFul', 'orStatus', 'orSort'].forEach(id => $(id).onchange = () => loadOrderList(true).catch(orError));
$('orSearch').oninput = () => { clearTimeout(orTimer); orTimer = setTimeout(() => loadOrderList(true).catch(orError), 350); };
$('orClear').onclick = () => { $('orSearch').value = ''; ['orPay', 'orFul', 'orStatus'].forEach(id => { $(id).value = ''; }); loadOrderList(true).catch(orError); };
$('orMore').onclick = () => loadOrderList(false).catch(orError);
$('orRefresh').onclick = () => loadOrders(true);
$('orExport').onclick = () => downloadCsv(`pixmagic-orders-${$('orFrom').value}-${$('orTo').value}.csv`,
  [['Order', 'Date', 'Customer', 'Channel', 'Payment', 'Fulfilment', 'Items', 'Total', 'Cancelled'],
   ...orRows.map(o => [o.name, o.date, o.customer || '', orChannel(o.channel), o.payment, o.fulfilment, o.items, o.total.toFixed(2), o.cancelled ? 'yes' : ''])]);
orRange(30);
