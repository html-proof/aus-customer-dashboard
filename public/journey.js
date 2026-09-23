// Customer journey page. Relies on index.html + pages.js: $, fmt, esc, iso, charts, tbl, barChart, downloadCsv.
let jrData = null, jrTouch = 'first';

function jrRange(days) {
  const t = new Date(), f = new Date(t - (days - 1) * 864e5);
  $('jrFrom').value = iso(f); $('jrTo').value = iso(t);
  document.querySelectorAll('#jrSeg button').forEach(b => b.classList.toggle('on', +b.dataset.d === days));
}
async function loadJourney(force) {
  $('jrErr').style.display = 'none'; $('jrContent').classList.add('loading');
  try {
    const r = await fetch(`/api/journey?from=${$('jrFrom').value}&to=${$('jrTo').value}${force ? '&refresh=1' : ''}`);
    const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText);
    jrData = j; renderJourney(j);
  } catch (e) { $('jrErr').textContent = 'Could not load customer journey: ' + e.message; $('jrErr').style.display = 'block'; }
  $('jrContent').classList.remove('loading');
}
const jrPct = (a, b) => (b ? (a / b * 100) : 0);
const jrNA = '<div class="na">Needs the <b>read_reports</b> analytics permission.</div>';

function renderJourney(d) {
  const F = d.funnel, O = d.orders;
  $('jrNoAnalytics').hidden = d.analytics;
  $('jrVisitors').textContent = F ? F.visitors.toLocaleString() : 'N/A';
  $('jrConv').textContent = F ? jrPct(F.purchased, F.visitors).toFixed(2) + '%' : 'N/A';
  $('jrDays').textContent = O.avgDaysToBuy == null ? '–' : O.avgDaysToBuy.toFixed(1);
  $('jrVisits').textContent = O.avgVisitsToBuy == null ? '' : `${O.avgVisitsToBuy.toFixed(1)} visits on average`;
  $('jrNew').textContent = O.newBuyers;
  $('jrRepeat').textContent = `${O.repeat} repeat order${O.repeat === 1 ? '' : 's'}`;
  $('jrAband').textContent = d.abandoned ? d.abandoned.count : 'N/A';
  $('jrAbandVal').textContent = d.abandoned ? `${fmt(d.abandoned.value)} left in carts` : '';

  // Funnel with step-to-step drop-off
  $('jrFunnel').innerHTML = !F ? jrNA : [['Visitors', F.visitors], ['Added to cart', F.addedToCart], ['Checkout started', F.checkoutStarted], ['Purchased', F.purchased]]
    .map(([label, v], i, a) => {
      const drop = i ? 100 - jrPct(v, a[i - 1][1]) : null;
      return `<div class="frow" style="grid-template-columns:120px 70px 1fr 50px"><span>${label}</span><b class="r">${v.toLocaleString()}</b>
        <div class="bar"><i style="width:${jrPct(v, F.visitors)}%"></i></div><span class="mu">${jrPct(v, F.visitors).toFixed(0)}%</span></div>
        ${drop != null ? `<div class="mu" style="font-size:12px;margin:-8px 0 0 132px">↓ ${drop.toFixed(0)}% dropped off</div>` : ''}`;
    }).join('');

  charts.jrDaily?.destroy();
  if (!d.daily) $('jrDailyWrap').innerHTML = jrNA;
  else {
    if (!$('jrDaily')) $('jrDailyWrap').innerHTML = '<canvas id="jrDaily"></canvas>';
    charts.jrDaily = new Chart($('jrDaily'), {
      type: 'line',
      data: { labels: d.daily.map(x => new Date(x.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })),
        datasets: [{ label: 'Conversion rate', data: d.daily.map(x => +jrPct(x.purchased, x.visitors).toFixed(2)), borderColor: '#0f7a5c', backgroundColor: '#13a07922', fill: true, tension: .35, pointRadius: 0, borderWidth: 2 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.parsed.y}% · ${d.daily[c.dataIndex].visitors} visitors` } } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6 } }, y: { beginAtZero: true, ticks: { callback: v => v + '%' }, grid: { color: '#eef2f0' } } } },
    });
  }

  $('jrSources').innerHTML = !d.sources ? `<tr><td colspan="4">${jrNA}</td></tr>`
    : tbl(d.sources, [r => esc(r.name), r => r.visitors.toLocaleString(), r => r.purchases, r => jrPct(r.purchases, r.visitors).toFixed(2) + '%'], 'No visitors in this period.');
  const dv = d.devices, dmax = Math.max(1, ...(dv || []).map(x => x.visitors));
  $('jrDevices').innerHTML = !dv ? jrNA : !dv.length ? '<div class="na">No visitors in this period.</div>' : dv.map(x => `
    <div style="margin:12px 0"><div style="display:flex;justify-content:space-between"><b>${esc(x.name.charAt(0).toUpperCase() + x.name.slice(1))}</b><span>${x.visitors.toLocaleString()} visitors</span></div>
    <div class="bar" style="height:10px;margin:6px 0"><i style="width:${x.visitors / dmax * 100}%"></i></div>
    <small class="mu">${x.purchases} purchases · ${jrPct(x.purchases, x.visitors).toFixed(2)}% conversion</small></div>`).join('');

  barChart('jrTime', O.timeToBuy.map(b => b.label), [{ data: O.timeToBuy.map(b => b.orders), backgroundColor: '#13a079', borderRadius: 4 }], false);
  renderTouch();
  $('jrLanding').innerHTML = tbl(O.landingPages, [r => `<span title="${esc(r.name)}">${esc(r.name)}</span>`, r => r.orders, r => fmt(r.sales)], 'No landing page data for this period.');

  $('jrAbandList').innerHTML = !d.abandoned ? '<tr><td colspan="4" class="na">Abandoned checkouts aren\'t available for this app.</td></tr>'
    : tbl(d.abandoned.list, [
        r => `<b>${esc(r.name)}</b><br><small class="mu">${new Date(r.date).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}${r.customer ? ' · ' + esc(r.customer) : ''}</small>`,
        r => `<small>${esc(r.items.join(', '))}</small>`, r => `<b>${fmt(r.value)}</b>`,
        r => r.url ? `<button class="btn" data-copy="${esc(r.url)}" style="padding:6px 10px">Copy link</button>` : ''], 'No abandoned checkouts in this period. 🎉');
}
function renderTouch() {
  const rows = jrData?.orders[jrTouch === 'first' ? 'firstTouch' : 'lastTouch'];
  $('jrTouchBody').innerHTML = tbl(rows, [r => esc(r.name), r => r.orders, r => fmt(r.sales)], 'No order source data for this period.');
}

$('jrTouch').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  jrTouch = b.dataset.t;
  document.querySelectorAll('#jrTouch button').forEach(x => x.classList.toggle('on', x === b));
  renderTouch();
});
$('view-journey').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-copy]'); if (!b) return;
  try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied ✓'; }
  catch { prompt('Copy this recovery link:', b.dataset.copy); }
  setTimeout(() => { b.textContent = 'Copy link'; }, 2000);
});
document.querySelectorAll('#jrSeg button').forEach(b => b.onclick = () => { jrRange(+b.dataset.d); loadJourney(); });
['jrFrom', 'jrTo'].forEach(id => $(id).onchange = () => { document.querySelectorAll('#jrSeg button').forEach(b => b.classList.remove('on')); loadJourney(); });
$('jrRefresh').onclick = () => loadJourney(true);
$('jrExport').onclick = () => {
  if (!jrData) return;
  const d = jrData, F = d.funnel;
  downloadCsv(`pixmagic-journey-${d.range.from}-${d.range.to}.csv`, [
    ...(F ? [['Funnel step', 'Sessions'], ['Visitors', F.visitors], ['Added to cart', F.addedToCart], ['Checkout started', F.checkoutStarted], ['Purchased', F.purchased], []] : []),
    ...(d.daily ? [['Date', 'Visitors', 'Added to cart', 'Checkout', 'Purchased'], ...d.daily.map(x => [x.date, x.visitors, x.addedToCart, x.checkoutStarted, x.purchased]), []] : []),
    ...(d.sources ? [['Traffic source', 'Visitors', 'Purchases'], ...d.sources.map(x => [x.name, x.visitors, x.purchases]), []] : []),
    ['Time to buy', 'Orders', 'Sales'], ...d.orders.timeToBuy.map(b => [b.label, b.orders, b.sales.toFixed(2)]), [],
    ['First-visit source', 'Orders', 'Sales'], ...d.orders.firstTouch.map(x => [x.name, x.orders, x.sales.toFixed(2)]), [],
    ['Landing page', 'Orders', 'Sales'], ...d.orders.landingPages.map(x => [x.name, x.orders, x.sales.toFixed(2)]),
  ]);
};
jrRange(30);
