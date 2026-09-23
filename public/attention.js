// Needs attention page + sidebar badge. Relies on: $, fmt, esc, openOrder (orders.js), openProduct (products.js).
let atData = null;
const AT_ICON = { high: '🔴', medium: '🟠', low: '🟢' };

async function loadAttention(force) {
  $('atErr').style.display = 'none'; $('atContent').classList.add('loading');
  try {
    const r = await fetch('/api/attention' + (force ? '?refresh=1' : ''));
    const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText);
    atData = j; renderAttention(j); setBadge(j);
  } catch (e) { $('atErr').textContent = 'Could not load checks: ' + e.message; $('atErr').style.display = 'block'; }
  $('atContent').classList.remove('loading');
}
function setBadge(d) {
  const n = d.summary.high + d.summary.medium;
  $('atBadge').hidden = !n; $('atBadge').textContent = n > 99 ? '99+' : n;
  if (window.updateBell) updateBell(d);
}

function atItem(i) {
  const clickable = i.kind === 'order' || i.kind === 'product';
  const attrs = clickable ? `data-kind="${i.kind}" data-id="${esc(i.id)}" style="cursor:pointer"` : '';
  const right = [
    i.amount != null ? `<b>${fmt(i.amount)}</b>` : '',
    i.age != null ? `<small class="mu">${i.age === 0 ? 'today' : i.age + 'd ago'}</small>` : '',
    i.kind === 'checkout' && i.url ? `<button class="btn" data-copy="${esc(i.url)}" style="padding:5px 10px">Copy link</button>` : '',
  ].filter(Boolean).join(' ');
  return `<div class="lrow" ${attrs}>
    <span>${clickable ? `<span class="on-name">${esc(i.label)}</span>` : `<b>${esc(i.label)}</b>`}
      ${i.note ? `<span class="pill ${i.urgent ? 'b' : 'w'}" style="margin-left:6px">${esc(i.note)}</span>` : ''}
      ${i.sub ? `<br><small class="mu">${esc(i.sub)}</small>` : ''}</span>
    <span style="text-align:right;white-space:nowrap">${right}</span></div>`;
}

function renderAttention(d) {
  $('atHigh').textContent = d.summary.high; $('atMed').textContent = d.summary.medium; $('atLow').textContent = d.summary.low;
  $('atUpdated').textContent = 'Checked ' + new Date(d.generatedAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  const open = d.checks.filter(c => c.count > 0), clear = d.checks.filter(c => !c.count);
  $('atList').innerHTML = open.length ? open.map(c => {
    const total = c.items.reduce((s, i) => s + (i.amount || 0), 0);
    return `<div class="card" style="margin-bottom:14px;border-left:4px solid ${c.severity === 'high' ? 'var(--red)' : c.severity === 'medium' ? 'var(--or)' : 'var(--g2)'}">
      <h3 style="align-items:center"><span>${AT_ICON[c.severity]} ${esc(c.title)} <span class="pill ${c.severity === 'high' ? 'b' : c.severity === 'medium' ? 'w' : ''}">${c.count}</span></span>
        ${total ? `<span class="mu" style="font-weight:400;font-size:13px">${fmt(total)}</span>` : ''}</h3>
      <p class="mu" style="margin:-6px 0 8px;font-size:13px">${esc(c.action)}</p>
      <details ${c.severity === 'high' ? 'open' : ''}><summary style="cursor:pointer;color:var(--g);font-weight:500;font-size:13px">Show ${c.items.length === c.count ? 'all ' + c.count : c.items.length + ' of ' + c.count}</summary>
        <div style="max-height:360px;overflow:auto;margin-top:6px">${c.items.map(atItem).join('')}</div></details></div>`;
  }).join('') : '<div class="card"><h3>🎉 Nothing needs your attention right now</h3><p class="mu" style="margin:0">All orders are moving, payments are in, and stock is healthy.</p></div>';

  $('atClearWrap').hidden = !clear.length;
  $('atClear').innerHTML = clear.map(c => `<div class="lrow"><span>${c.unavailable ? '<span class="mu">○</span>' : '<span class="ok">✔</span>'} ${esc(c.title)}</span>
    <small class="mu" style="max-width:55%;text-align:right">${c.unavailable ? 'Not checked: ' + esc(c.unavailable) : 'Nothing to do'}</small></div>`).join('');
}

$('view-attention').addEventListener('click', async (e) => {
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    e.stopPropagation();
    try { await navigator.clipboard.writeText(copy.dataset.copy); copy.textContent = 'Copied ✓'; }
    catch { prompt('Copy this recovery link:', copy.dataset.copy); }
    return setTimeout(() => { copy.textContent = 'Copy link'; }, 2000);
  }
  const row = e.target.closest('[data-kind]');
  if (!row) return;
  if (row.dataset.kind === 'order') openOrder(row.dataset.id);
  if (row.dataset.kind === 'product') openProduct(row.dataset.id);
});
$('atRefresh').onclick = () => loadAttention(true);

// Sidebar badge: check shortly after start-up, then every 5 minutes
setTimeout(() => fetch('/api/attention').then(r => r.ok ? r.json() : null).then(d => d && setBadge(d)).catch(() => {}), 3000);
setInterval(() => { if (!document.hidden) fetch('/api/attention').then(r => r.ok ? r.json() : null).then(d => d && (setBadge(d), view === 'attention' && renderAttention(d))).catch(() => {}); }, 300000);
