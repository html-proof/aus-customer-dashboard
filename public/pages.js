// Navigation between Overview / Marketing / Reports, plus the Marketing and Reports pages.
// Relies on helpers defined in index.html: $, fmt, iso, esc, chg, charts, cur, load.
const views = { overview: $('view-overview'), marketing: $('view-marketing'), reports: $('view-reports'), orders: $('view-orders'), products: $('view-products'), payments: $('view-payments'), journey: $('view-journey'), attention: $('view-attention'), connections: $('view-connections'), customers: $('view-customers'), settings: $('view-settings') };
let view = 'overview';
function show(v) {
  view = v;
  Object.entries(views).forEach(([k, el]) => { el.hidden = k !== v; });
  if (v === 'marketing' && !mkData) loadMk();
  if (v === 'reports' && !rpData) loadRp();
  if (v === 'orders' && !orLoaded) loadOrders(); // orders.js
  if (v === 'products' && !prLoaded) loadProducts(); // products.js
  if (v === 'payments' && !paData) loadPayments(); // payments.js
  if (v === 'journey' && !jrData) loadJourney(); // journey.js
  if (v === 'attention') loadAttention(); // attention.js
  if (v === 'connections') loadConnections(); // connections.js
  if (v === 'customers' && !cuLoaded) loadCustomers(); // customers.js
  if (v === 'settings') loadSettings(); // settings.js
}
document.querySelectorAll('nav a').forEach(a => a.onclick = () => {
  document.querySelectorAll('nav a').forEach(x => x.classList.remove('active'));
  a.classList.add('active');
  if (a.dataset.v) { show(a.dataset.v); window.scrollTo(0, 0); }
  else { show('overview'); $(a.dataset.t).scrollIntoView({ behavior: 'smooth' }); }
});

const tbl = (rows, cols, empty) => rows?.length
  ? rows.map(r => '<tr>' + cols.map((c, i) => `<td class="${i ? 'r' : ''}">${c(r)}</td>`).join('') + '</tr>').join('')
  : `<tr><td colspan="${cols.length}" class="na">${empty}</td></tr>`;
function downloadCsv(name, rows) {
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name; a.click();
}
function barChart(id, labels, sets, isMoney = true) {
  charts[id]?.destroy();
  charts[id] = new Chart($(id), {
    type: 'bar', data: { labels, datasets: sets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: sets.length > 1, position: 'bottom' }, tooltip: { callbacks: { label: c => ' ' + (isMoney ? fmt(c.parsed.y) : c.parsed.y) } } },
      scales: { y: { grid: { color: '#eef2f0' }, ticks: isMoney ? { callback: v => fmt(v) } : {} }, x: { grid: { display: false } } },
    },
  });
}
const statusBars = (m) => {
  const t = Object.values(m).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
    `<div class="frow" style="grid-template-columns:150px 1fr 50px 44px"><span>${esc(k.replace(/_/g, ' ').toLowerCase())}</span><div class="bar" style="height:10px"><i style="width:${v / t * 100}%"></i></div><b class="r">${v}</b><span class="mu">${(v / t * 100).toFixed(0)}%</span></div>`
  ).join('') || '<div class="na">No orders.</div>';
};

// ---------------- Marketing ----------------
let mkData = null;
function mkRange(days) {
  const t = new Date(), f = new Date(t - (days - 1) * 864e5);
  $('mkFrom').value = iso(f); $('mkTo').value = iso(t);
  document.querySelectorAll('#mkSeg button').forEach(b => b.classList.toggle('on', +b.dataset.d === days));
}
async function loadMk(force) {
  $('mkContent').classList.add('loading'); $('mkErr').style.display = 'none';
  try {
    const r = await fetch(`/api/marketing?from=${$('mkFrom').value}&to=${$('mkTo').value}${force ? '&refresh=1' : ''}`);
    const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText);
    mkData = j; renderMk(j);
  } catch (e) { $('mkErr').textContent = 'Could not load marketing data: ' + e.message; $('mkErr').style.display = 'block'; }
  $('mkContent').classList.remove('loading');
}
function renderMk(d) {
  const T = d.totals;
  $('mkSales').textContent = fmt(T.sales);
  $('mkDisc').textContent = T.discountedOrders;
  $('mkDiscPct').textContent = T.orders ? `${(T.discountedOrders / T.orders * 100).toFixed(0)}% of ${T.orders} orders` : '';
  $('mkDiscAmt').textContent = fmt(T.discountTotal);
  $('mkAband').textContent = T.abandoned ?? 'N/A';

  const max = Math.max(1, ...(d.sources || []).map(x => x.sales));
  $('mkSources').innerHTML = !d.sources ? '<div class="na">Traffic source data isn\'t available for this app.</div>'
    : !d.sources.length ? '<div class="na">No orders in this period.</div>'
    : d.sources.slice(0, 8).map(x => `<div class="frow" style="grid-template-columns:130px 1fr 90px 40px"><span>${esc(x.name)}</span><div class="bar" style="height:12px"><i style="width:${x.sales / max * 100}%"></i></div><b class="r">${fmt(x.sales)}</b><span class="mu">${x.orders}</span></div>`).join('');

  charts.mkChannels?.destroy();
  charts.mkChannels = new Chart($('mkChannels'), {
    type: 'doughnut',
    data: { labels: d.channels.map(c => c.name), datasets: [{ data: d.channels.map(c => +c.sales.toFixed(2)), backgroundColor: ['#0f7a5c', '#6fd3ac', '#b8e6d3', '#e8a317', '#8aa39a', '#0f5c46'], borderWidth: 0 }] },
    options: { maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: c => ' ' + c.label + ': ' + fmt(c.parsed) } } } },
  });

  $('mkCodes').innerHTML = tbl(d.discountCodes, [r => `<span class="on-name">${esc(r.code)}</span>`, r => r.uses, r => fmt(r.sales), r => fmt(r.discount)], 'No discount codes used in this period.');
  $('mkUtm').innerHTML = !d.utmCampaigns ? '<tr><td colspan="3" class="na">UTM data isn\'t available for this app.</td></tr>'
    : tbl(d.utmCampaigns, [r => esc(r.name), r => r.orders, r => fmt(r.sales)], 'No orders from tagged (UTM) campaigns in this period.');
  $('mkCampaigns').innerHTML = !d.campaigns ? '<div class="na">Grant the app <b>read_marketing_events</b> to list your Shopify marketing activities.</div>'
    : !d.campaigns.length ? '<div class="na">No marketing activities recorded in Shopify.</div>'
    : '<table><thead><tr><th>Activity</th><th>Channel</th><th>Status</th><th class="r">Created</th></tr></thead><tbody>' +
      d.campaigns.map(c => `<tr><td>${esc(c.title)}</td><td>${esc((c.marketingChannelType || '').toLowerCase())}</td><td><span class="pill">${esc((c.status || '').toLowerCase())}</span></td><td class="r">${new Date(c.createdAt).toLocaleDateString('en-AU')}</td></tr>`).join('') + '</tbody></table>';
}
document.querySelectorAll('#mkSeg button').forEach(b => b.onclick = () => { mkRange(+b.dataset.d); loadMk(); });
['mkFrom', 'mkTo'].forEach(id => $(id).onchange = () => { document.querySelectorAll('#mkSeg button').forEach(b => b.classList.remove('on')); loadMk(); });
$('mkRefresh').onclick = () => loadMk(true);
$('mkExport').onclick = () => mkData && downloadCsv(`pixmagic-marketing-${mkData.range.from}-${mkData.range.to}.csv`, [
  ['Source', 'Orders', 'Sales'], ...(mkData.sources || []).map(x => [x.name, x.orders, x.sales.toFixed(2)]), [],
  ['Channel', 'Orders', 'Sales'], ...mkData.channels.map(x => [x.name, x.orders, x.sales.toFixed(2)]), [],
  ['Discount code', 'Uses', 'Sales', 'Discount'], ...mkData.discountCodes.map(x => [x.code, x.uses, x.sales.toFixed(2), x.discount.toFixed(2)]),
]);
mkRange(30);

// ---------------- Reports ----------------
let rpData = null;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
for (let y = new Date().getFullYear(); y >= new Date().getFullYear() - 6; y--) $('rpYear').add(new Option(y, y));
async function loadRp(force) {
  $('rpContent').classList.add('loading'); $('rpErr').style.display = 'none';
  try {
    const r = await fetch(`/api/reports?year=${$('rpYear').value}${force ? '&refresh=1' : ''}`);
    const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText);
    rpData = j; renderRp(j);
  } catch (e) { $('rpErr').textContent = 'Could not load reports: ' + e.message; $('rpErr').style.display = 'block'; }
  $('rpContent').classList.remove('loading');
}
function renderRp(d) {
  cur = d.currency;
  const sum = (a, k) => a.reduce((s, m) => s + m[k], 0);
  const s = sum(d.monthly, 'sales'), ps = sum(d.monthlyPrev, 'sales');
  const o = sum(d.monthly, 'orders'), po = sum(d.monthlyPrev, 'orders');
  const vsYear = (v) => chg(v).replace('previous period', String(d.year - 1));
  $('rpSales').textContent = fmt(s); $('rpSalesChg').innerHTML = ps ? vsYear((s - ps) / ps * 100) : '';
  $('rpOrders').textContent = o; $('rpOrdersChg').innerHTML = po ? vsYear((o - po) / po * 100) : '';
  $('rpRefunds').textContent = fmt(sum(d.monthly, 'refunds'));
  const best = d.monthly.reduce((b, m) => (m.sales > b.sales ? m : b), d.monthly[0]);
  $('rpBest').textContent = best.sales ? MONTHS[best.month - 1] : '–';

  barChart('rpMonthly', MONTHS, [
    { label: String(d.year), data: d.monthly.map(m => +m.sales.toFixed(2)), backgroundColor: '#0f7a5c', borderRadius: 4 },
    { label: String(d.year - 1), data: d.monthlyPrev.map(m => +m.sales.toFixed(2)), backgroundColor: '#b8e6d3', borderRadius: 4 },
  ]);
  barChart('rpDow', d.dayOfWeek.map(x => x.day), [{ data: d.dayOfWeek.map(x => +x.sales.toFixed(2)), backgroundColor: '#13a079', borderRadius: 4 }]);
  barChart('rpHours', d.hours.map(h => h.hour + ':00'), [{ data: d.hours.map(h => h.orders), backgroundColor: '#6fd3ac', borderRadius: 3 }], false);

  $('rpProducts').innerHTML = tbl(d.products, [r => esc(r.title), r => r.units, r => r.orders, r => fmt(r.revenue)], 'No product sales this year.');
  $('rpCustomers').innerHTML = !d.topCustomers ? '<tr><td colspan="3" class="na">Add the <b>read_customers</b> scope to see top customers.</td></tr>'
    : tbl(d.topCustomers, [r => esc(r.name), r => r.orders, r => fmt(r.sales)], 'No customer orders this year.');
  $('rpFin').innerHTML = statusBars(d.financialStatus);
  $('rpFul').innerHTML = statusBars(d.fulfilmentStatus);
}
$('rpYear').onchange = () => loadRp();
$('rpRefresh').onclick = () => loadRp(true);
document.querySelectorAll('[data-csv]').forEach(b => b.onclick = () => {
  if (!rpData) return;
  const y = rpData.year, k = b.dataset.csv;
  if (k === 'monthly') downloadCsv(`pixmagic-monthly-${y}.csv`, [['Month', `Sales ${y}`, `Orders ${y}`, `Refunds ${y}`, `Sales ${y - 1}`, `Orders ${y - 1}`],
    ...rpData.monthly.map((m, i) => [MONTHS[i], m.sales.toFixed(2), m.orders, m.refunds.toFixed(2), rpData.monthlyPrev[i].sales.toFixed(2), rpData.monthlyPrev[i].orders])]);
  if (k === 'products') downloadCsv(`pixmagic-products-${y}.csv`, [['Product', 'Units', 'Orders', 'Revenue'], ...rpData.products.map(p => [p.title, p.units, p.orders, p.revenue.toFixed(2)])]);
  if (k === 'customers' && rpData.topCustomers) downloadCsv(`pixmagic-customers-${y}.csv`, [['Customer', 'Orders', 'Spent'], ...rpData.topCustomers.map(c => [c.name, c.orders, c.sales.toFixed(2)])]);
});
