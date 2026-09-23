// App chrome: popup menus, notification bell, store menu, timezone selector, mobile nav, and the date range picker.
// Relies on index.html: $, esc, fmt, icon, applyIcons.

// ---------- Display timezone ----------
// Every date on the page is formatted with toLocale*String; we inject the chosen timeZone there once.
const TZ_KEY = 'pm_tz';
const TZ_OPTIONS = [
  ['store', 'Store timezone'], ['Australia/Melbourne', 'Melbourne'], ['Australia/Sydney', 'Sydney'], ['Australia/Brisbane', 'Brisbane'],
  ['Australia/Adelaide', 'Adelaide'], ['Australia/Perth', 'Perth'], ['Australia/Hobart', 'Hobart'], ['Australia/Darwin', 'Darwin'],
  ['Pacific/Auckland', 'Auckland'], ['UTC', 'UTC'], ['local', 'This device'],
];
const tzPref = (() => { try { return localStorage.getItem(TZ_KEY) || 'store'; } catch { return 'store'; } })();
let displayTz = tzPref === 'store' || tzPref === 'local' ? null : tzPref;
for (const m of ['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString']) {
  const orig = Date.prototype[m];
  Date.prototype[m] = function (loc, opts) {
    if (!displayTz || (opts && opts.timeZone)) return orig.call(this, loc, opts);
    return orig.call(this, loc, { ...(opts || {}), timeZone: displayTz });
  };
}
function tzAbbrev(tz) {
  try { return new Intl.DateTimeFormat('en-AU', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || ''; }
  catch { return ''; }
}
function fillTzSelect(storeTz) {
  $('tzSel').innerHTML = TZ_OPTIONS.map(([v, l]) => {
    const tz = v === 'store' ? storeTz : v === 'local' ? Intl.DateTimeFormat().resolvedOptions().timeZone : v;
    const label = v === 'store' && storeTz ? storeTz.split('/').pop().replace(/_/g, ' ') : l;
    const note = [tz ? tzAbbrev(tz) : '', v === 'store' ? 'store' : ''].filter(Boolean).join(', ');
    return `<option value="${v}" ${v === tzPref ? 'selected' : ''}>${esc(label)}${note ? ` (${note})` : ''}</option>`;
  }).join('');
}
$('tzSel').onchange = () => { try { localStorage.setItem(TZ_KEY, $('tzSel').value); } catch {} location.reload(); };
fillTzSelect(null);

// Called by render() once the shop is known
window.onShopInfo = (shop) => {
  if (tzPref === 'store' && displayTz !== shop.timezone) { displayTz = shop.timezone; }
  if (!onShopInfo.done) { fillTzSelect(shop.timezone); onShopInfo.done = true; }
  // Flag emoji don't render on Windows, so draw the Australian flag; other countries get a country-code badge
  document.querySelector('#storeBtn .flag').innerHTML = shop.country === 'AU' ? AU_FLAG
    : `<span class="av" style="width:30px;height:22px;border-radius:4px;font-size:10px">${esc(shop.country || '')}</span>`;
  const handle = (shop.domain || '').replace('.myshopify.com', '');
  $('storeMenu').innerHTML = `
    <div style="padding:12px;border-bottom:1px solid var(--line)"><b>${esc(shop.name)}</b><br>
      <small class="mu">${esc(shop.domain || '')}<br>${esc(shop.currency)} · ${esc(shop.timezone)}</small></div>
    ${handle ? `<a class="mi" href="https://admin.shopify.com/store/${encodeURIComponent(handle)}" target="_blank" rel="noopener">${icon('external', 16)}Open Shopify admin</a>` : ''}
    <button class="mi" data-go="connections">${icon('link', 16)}Data connections</button>
    <div style="padding:10px 12px;border-top:1px solid var(--line)"><small class="mu">This dashboard is connected to one store.</small></div>`;
};

const AU_FLAG = `<svg width="30" height="20" viewBox="0 0 60 40" aria-label="Australia" style="border-radius:3px;display:block">
  <rect width="60" height="40" fill="#012169"/>
  <path d="M0 0l30 20M30 0L0 20" stroke="#fff" stroke-width="4"/><path d="M0 0l30 20M30 0L0 20" stroke="#E4002B" stroke-width="1.6"/>
  <path d="M15 0v20M0 10h30" stroke="#fff" stroke-width="6"/><path d="M15 0v20M0 10h30" stroke="#E4002B" stroke-width="3.6"/>
  <g fill="#fff"><circle cx="15" cy="30" r="3.4"/><circle cx="45" cy="33" r="1.8"/><circle cx="39" cy="19" r="1.8"/><circle cx="45" cy="8" r="1.8"/><circle cx="51" cy="16" r="1.8"/><circle cx="48" cy="22" r="1"/></g></svg>`;
document.querySelector('#storeBtn .flag').innerHTML = AU_FLAG;

// ---------- Popup menus ----------
const MENUS = [['storeBtn', 'storeMenu'], ['bellBtn', 'bellMenu'], ['meAv', 'meMenu']];
function closeMenus(except) { MENUS.forEach(([, m]) => { if (m !== except) $(m).hidden = true; }); }
MENUS.forEach(([b, m]) => $(b).addEventListener('click', (e) => {
  e.stopPropagation();
  const open = $(m).hidden;
  closeMenus(m); $(m).hidden = !open;
  if (open && m === 'bellMenu') loadBell();
}));
document.addEventListener('click', (e) => { if (!e.target.closest('.menu')) closeMenus(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenus(); closeNav(); } });

// Any element with data-go="view" navigates like the sidebar
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]');
  if (!g) return;
  e.preventDefault(); closeMenus(); closeNav();
  document.querySelector(`nav a[data-v="${g.dataset.go}"]`)?.click();
});
$('privLink').addEventListener('click', (e) => { e.preventDefault(); document.querySelector('nav a[data-v="settings"]').click(); closeNav(); });

// ---------- Notification bell (uses the Needs attention checks) ----------
window.updateBell = (d) => {
  const n = d.summary.high + d.summary.medium;
  $('bellDot').hidden = !n;
  const open = d.checks.filter(c => c.count > 0 && c.key !== 'scopes');
  $('bellMenu').innerHTML = `<div style="padding:12px;border-bottom:1px solid var(--line)"><b>Notifications</b></div>` +
    (open.length ? open.slice(0, 6).map(c => `<button class="mi" data-go="attention" style="align-items:flex-start">
        <span style="width:8px;height:8px;border-radius:50%;margin-top:6px;flex:none;background:${c.severity === 'high' ? 'var(--red)' : c.severity === 'medium' ? 'var(--or)' : 'var(--g2)'}"></span>
        <span><b>${c.count}</b> · ${esc(c.title)}</span></button>`).join('')
      : '<div class="na" style="padding:12px">You\'re all caught up. 🎉</div>') +
    `<button class="mi" data-go="attention" style="border-top:1px solid var(--line);color:var(--g);font-weight:600">Open Needs attention ${icon('arrowR', 16)}</button>`;
};
async function loadBell() {
  if (!$('bellMenu').innerHTML) $('bellMenu').innerHTML = '<div class="na" style="padding:12px">Checking…</div>';
  try { const r = await fetch('/api/attention'); if (r.ok) updateBell(await r.json()); } catch {}
}

// ---------- Mobile navigation ----------
function closeNav() { document.body.classList.remove('nav-open'); $('scrim').hidden = true; }
$('menuBtn').onclick = () => { document.body.classList.add('nav-open'); $('scrim').hidden = false; };
$('menuClose').onclick = closeNav; $('scrim').onclick = closeNav;
document.querySelectorAll('nav a').forEach(a => a.addEventListener('click', closeNav));

// ---------- Compare toggle ----------
$('cmpLabel').addEventListener('click', (e) => {
  if (e.target.id === 'cmp') return;
  e.preventDefault(); $('cmp').checked = !$('cmp').checked; $('cmp').dispatchEvent(new Event('change'));
});

// ---------- Date range picker (two months, range selection, Cancel/Apply) ----------
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const todayStr = () => iso(new Date());
function rangeLabel(a, b) {
  if (!a || !b) return 'Select dates';
  const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number);
  if (a === b) return `${d1} ${MON[m1 - 1]} ${y1}`;
  if (y1 === y2 && m1 === m2) return `${d1}–${d2} ${MON[m1 - 1]} ${y1}`;
  if (y1 === y2) return `${d1} ${MON[m1 - 1]} – ${d2} ${MON[m2 - 1]} ${y1}`;
  return `${d1} ${MON[m1 - 1]} ${y1} – ${d2} ${MON[m2 - 1]} ${y2}`;
}

function attachRangePicker(fromId, toId) {
  const from = $(fromId), to = $(toId);
  if (!from || !to) return;
  from.hidden = to.hidden = true;
  // Remove the "to" label that sat between the two inputs
  for (let n = from.nextSibling; n && n !== to; n = n.nextSibling) if (n.nodeType === 1 && n.textContent.trim() === 'to') n.hidden = true;
  const wrap = document.createElement('div');
  wrap.className = 'pop-wrap';
  wrap.innerHTML = `<button type="button" class="btn dp-btn" aria-haspopup="dialog"><span class="kt">${icon('calendar', 18)}<span class="dp-label"></span></span>${icon('chevron', 16)}</button>
    <div class="dp" role="dialog" aria-label="Choose dates" hidden></div>`;
  to.after(wrap);
  const btn = wrap.querySelector('.dp-btn'), pop = wrap.querySelector('.dp'), label = wrap.querySelector('.dp-label');
  let start, end, view; // view = [year, month] of the left calendar

  const syncLabel = () => { const t = rangeLabel(from.value, to.value); if (label.textContent !== t) label.textContent = t; };
  syncLabel(); setInterval(syncLabel, 400); // other code sets .value directly (presets), so keep the label in step

  function monthHtml(y, m, side) {
    const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate(), today = todayStr();
    let cells = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => `<div class="dow">${d}</div>`).join('');
    cells += '<div></div>'.repeat(first);
    for (let d = 1; d <= days; d++) {
      const k = ymd(y, m, d), e = end || start;
      const cls = [start && e && k >= start && k <= e ? 'in' : '', k === start ? 'start' : '', k === e ? 'end' : '', k === today ? 'today' : ''].join(' ');
      cells += `<button type="button" class="dp-day ${cls}" data-d="${k}" ${k > today ? 'disabled' : ''}><span>${d}</span></button>`;
    }
    return `<div class="dp-month"><div class="dp-head">
      ${side === 'L' ? `<button type="button" class="iconbtn" data-nav="-1" aria-label="Previous month">${icon('chevronL', 18)}</button>` : '<span></span>'}
      <span>${MONTH_LONG[m]} ${y}</span>
      ${side === 'R' ? `<button type="button" class="iconbtn" data-nav="1" aria-label="Next month">${icon('chevronR', 18)}</button>` : '<span></span>'}
      </div><div class="dp-grid">${cells}</div></div>`;
  }
  function draw() {
    const [y, m] = view, ny = m === 11 ? y + 1 : y, nm = (m + 1) % 12;
    pop.innerHTML = `<div class="dp-months">${monthHtml(y, m, 'L')}${monthHtml(ny, nm, 'R')}</div>
      <div class="dp-foot"><b>${start ? rangeLabel(start, end || start) : 'Pick a start date'}</b>
      <span style="display:flex;gap:8px"><button type="button" class="btn" data-act="cancel">Cancel</button>
      <button type="button" class="btn pri" data-act="apply" ${start ? '' : 'disabled'}>Apply</button></span></div>`;
  }
  function open() {
    closeAllPickers(pop);
    start = from.value; end = to.value;
    const [y, m] = (end || todayStr()).split('-').map(Number);
    view = [y, m - 1]; // selected end month on the left, next month on the right (as in the design)
    draw(); pop.hidden = false;
  }
  btn.addEventListener('click', (e) => { e.stopPropagation(); pop.hidden ? open() : (pop.hidden = true); });
  pop.addEventListener('click', (e) => {
    e.stopPropagation();
    const nav = e.target.closest('[data-nav]'), day = e.target.closest('[data-d]'), act = e.target.closest('[data-act]');
    if (nav) { let [y, m] = view; m += +nav.dataset.nav; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } view = [y, m]; return draw(); }
    if (day) {
      const d = day.dataset.d;
      if (!start || end) { start = d; end = null; } else if (d < start) { start = d; } else { end = d; }
      return draw();
    }
    if (act?.dataset.act === 'cancel') { pop.hidden = true; }
    if (act?.dataset.act === 'apply') {
      from.value = start; to.value = end || start; pop.hidden = true; syncLabel();
      to.dispatchEvent(new Event('change')); // page handlers reload on change
    }
  });
  wrap.openPicker = open;
  return wrap;
}
const pickers = [];
function closeAllPickers(except) { pickers.forEach(w => { const p = w.querySelector('.dp'); if (p !== except) p.hidden = true; }); }
document.addEventListener('click', (e) => { if (!e.target.closest('.dp')) closeAllPickers(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllPickers(); });

[['from', 'to'], ['mkFrom', 'mkTo'], ['orFrom', 'orTo'], ['prFrom', 'prTo'], ['paFrom', 'paTo'], ['jrFrom', 'jrTo']]
  .forEach(([f, t]) => { const w = attachRangePicker(f, t); if (w) pickers.push(w); });

// Overview "Custom" opens the calendar
document.querySelector('#seg [data-p="custom"]').addEventListener('click', (e) => { e.stopPropagation(); pickers[0]?.openPicker(); });
