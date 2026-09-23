// Payments & refunds page. Relies on index.html + pages.js + orders.js: $, fmt, esc, iso, charts, tbl, downloadCsv, openOrder.
let paData = null;

function paRange(days) {
  const t = new Date(), f = new Date(t - (days - 1) * 864e5);
  $('paFrom').value = iso(f); $('paTo').value = iso(t);
  document.querySelectorAll('#paSeg button').forEach(b => b.classList.toggle('on', +b.dataset.d === days));
}

async function loadPayments(force) {
  $('paErr').style.display = 'none'; $('paContent').classList.add('loading');
  try {
    const r = await fetch(`/api/payments?from=${$('paFrom').value}&to=${$('paTo').value}${force ? '&refresh=1' : ''}`);
    const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText);
    paData = j; renderPayments(j);
  } catch (e) { $('paErr').textContent = 'Could not load payments: ' + e.message; $('paErr').style.display = 'block'; }
  $('paContent').classList.remove('loading');
}

const paDate = (d) => new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
const paOrder = (r) => `<a href="#" class="on-name" data-order-id="${esc(r.id)}">${esc(r.order)}</a>`;

function renderPayments(d) {
  const T = d.totals;
  $('paCollected').textContent = fmt(T.collected);
  $('paSuccess').textContent = T.successRate == null ? '' : `${T.successRate.toFixed(1)}% of payment attempts succeeded`;
  $('paRefunded').textContent = fmt(T.refunded);
  $('paRefRate').textContent = `${T.refundCount} refund${T.refundCount === 1 ? '' : 's'}${T.refundRate == null ? '' : ` · ${T.refundRate.toFixed(1)}% of collected`}`;
  $('paNet').textContent = fmt(T.net);
  $('paFailed').textContent = T.failedCount;
  $('paAwait').textContent = T.awaitingCount ?? d.awaiting.length;
  $('paAwaitAmt').textContent = d.awaiting.length ? `${fmt(T.awaitingAmount)} in this period` : '';

  charts.paDaily?.destroy();
  charts.paDaily = new Chart($('paDaily'), {
    type: 'bar',
    data: { labels: d.daily.map(x => new Date(x.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })),
      datasets: [
        { label: 'Collected', data: d.daily.map(x => +x.collected.toFixed(2)), backgroundColor: '#0f7a5c', borderRadius: 3 },
        { label: 'Refunded', data: d.daily.map(x => -x.refunded.toFixed(2)), backgroundColor: '#e03d3d', borderRadius: 3 },
      ] },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(Math.abs(c.parsed.y))}` } } },
      scales: { x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { stacked: true, grid: { color: '#eef2f0' }, ticks: { callback: v => fmt(v) } } } },
  });

  const max = Math.max(1, ...d.gateways.map(g => g.collected));
  $('paGateways').innerHTML = d.gateways.length ? d.gateways.map(g => `
    <div style="margin:12px 0"><div style="display:flex;justify-content:space-between"><b>${esc(g.name)}</b><b>${fmt(g.collected)}</b></div>
    <div class="bar" style="height:10px;margin:6px 0"><i style="width:${g.collected / max * 100}%"></i></div>
    <small class="mu">${g.count} payment${g.count === 1 ? '' : 's'} · ${T.collected ? (g.collected / T.collected * 100).toFixed(0) : 0}% of total${g.refunded ? ` · ${fmt(g.refunded)} refunded` : ''}</small></div>`).join('')
    : '<div class="na">No payments in this period.</div>';

  $('paRefunds').innerHTML = tbl(d.refunds, [paOrder, r => paDate(r.date), r => `<span class="mu">${esc(r.note || '–')}</span>`, r => `<b class="bad">−${fmt(r.amount)}</b>`], 'No refunds in this period. 🎉');
  $('paFails').innerHTML = tbl(d.failed, [paOrder, r => paDate(r.date), r => esc(r.gateway), r => `<span class="pill b">${esc((r.error || r.kind || 'failed').replace(/_/g, ' ').toLowerCase())}</span>`, r => fmt(r.amount)], 'No failed payments in this period.');
  $('paAwaiting').innerHTML = tbl(d.awaiting, [paOrder, r => paDate(r.date), r => `<b>${fmt(r.amount)}</b>`], 'Nothing waiting to be captured.');

  const P = d.payouts;
  $('paPayouts').innerHTML = !P ? '<div class="na">Payout data needs the <b>read_shopify_payments_payouts</b> permission (and the store must use Shopify Payments). Add it to the app\'s access scopes to see your balance and bank deposits here.</div>'
    : `<div class="lrow"><span>Current balance</span><b>${fmt(P.balance)}</b></div>
       <table style="margin-top:8px"><thead><tr><th>Date</th><th>Status</th><th class="r">Fees</th><th class="r">Deposited</th></tr></thead><tbody>
       ${tbl(P.payouts, [r => paDate(r.date), r => `<span class="pill ${r.status === 'PAID' ? '' : 'w'}">${esc(r.status.toLowerCase().replace(/_/g, ' '))}</span>`, r => `<span class="mu">${r.fees ? fmt(r.fees) : '–'}</span>`, r => `<b>${fmt(r.net)}</b>`], 'No payouts yet.')}</tbody></table>`;
}

$('view-payments').addEventListener('click', (e) => {
  const a = e.target.closest('[data-order-id]');
  if (a) { e.preventDefault(); openOrder(a.dataset.orderId); }
});
document.querySelectorAll('#paSeg button').forEach(b => b.onclick = () => { paRange(+b.dataset.d); loadPayments(); });
['paFrom', 'paTo'].forEach(id => $(id).onchange = () => { document.querySelectorAll('#paSeg button').forEach(b => b.classList.remove('on')); loadPayments(); });
$('paRefresh').onclick = () => loadPayments(true);
$('paExport').onclick = () => paData && downloadCsv(`pixmagic-payments-${paData.range.from}-${paData.range.to}.csv`, [
  ['Summary'], ['Collected', paData.totals.collected.toFixed(2)], ['Refunded', paData.totals.refunded.toFixed(2)], ['Net', paData.totals.net.toFixed(2)], [],
  ['Date', 'Collected', 'Refunded'], ...paData.daily.map(x => [x.date, x.collected.toFixed(2), x.refunded.toFixed(2)]), [],
  ['Payment method', 'Payments', 'Collected', 'Refunded'], ...paData.gateways.map(g => [g.name, g.count, g.collected.toFixed(2), g.refunded.toFixed(2)]), [],
  ['Refund order', 'Date', 'Amount', 'Note'], ...paData.refunds.map(r => [r.order, r.date, r.amount.toFixed(2), r.note || '']), [],
  ['Failed order', 'Date', 'Method', 'Error', 'Amount'], ...paData.failed.map(r => [r.order, r.date, r.gateway, r.error || r.kind, r.amount.toFixed(2)]),
]);
paRange(30);
