// Signed-in user, Settings page, and app start-up (applies saved preferences, starts live refresh).
// Relies on index.html + pages.js: $, esc, setPeriod, load, loadMk, view, tbl.
let me = null, prefs = null, refreshTimer = null;

async function api(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
function flash(msg, isErr) {
  const el = $(isErr ? 'stErr' : 'stOk'), other = $(isErr ? 'stOk' : 'stErr');
  other.style.display = 'none'; el.textContent = msg; el.style.display = 'block';
  clearTimeout(flash.t); flash.t = setTimeout(() => { el.style.display = 'none'; }, 5000);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function startRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (document.hidden) return;
    if (view === 'overview') load(); else if (view === 'marketing') loadMk();
  }, (prefs?.refreshSeconds || 60) * 1000);
}

// ---- Settings page ----
async function loadSettings() {
  try {
    const { settings, connection: c } = await api('/api/settings');
    prefs = settings;
    $('stPeriod').value = settings.defaultPeriod; $('stRefresh').value = settings.refreshSeconds;
    $('stLow').value = settings.lowStockThreshold; $('stSession').value = settings.sessionHours;
    $('stShip').value = settings.shipWithinDays;
    $('stCompare').checked = settings.compareByDefault;
    $('stPrefs').querySelectorAll('input,select').forEach(el => { el.disabled = me.role !== 'admin'; });

    const needed = ['read_orders', 'read_all_orders', 'read_products', 'read_customers', 'read_inventory', 'read_reports', 'read_marketing_events'];
    const has = (s) => c.scopes?.includes(s) || c.scopes?.includes(s.replace('read_', 'write_'));
    $('stConn').innerHTML = !c.ok
      ? `<div class="lrow"><span>Status</span><b class="bad">● Not connected</b></div><div class="na">${esc(c.error)}</div>`
      : `<div class="lrow"><span>Status</span><b class="ok">● Connected</b></div>
         <div class="lrow"><span>Store</span><b>${esc(c.name || '')} <span class="mu">(${esc(c.shop)})</span></b></div>
         <div class="lrow"><span>Currency / timezone</span><span>${esc(c.currency || '')} · ${esc(c.timezone || '')}</span></div>
         <div class="lrow"><span>API version</span><span>${esc(c.apiVersion)}</span></div>
         <div class="lrow"><span>Access token renews</span><span>${new Date(c.tokenExpires).toLocaleString('en-AU')} (automatic)</span></div>
         <div style="margin-top:12px"><b style="font-size:13px">Permissions</b><div>${needed.map(s =>
           `<span class="scope" style="${has(s) ? '' : 'background:#fde8e8;color:var(--red)'}">${has(s) ? '✔' : '✖'} ${s}</span>`).join('')}</div>
         ${needed.some(s => !has(s)) ? '<div class="na">Red permissions are missing. Add them to the app\'s access scopes in the Shopify Dev Dashboard, release a new version, and approve it in the store admin.</div>' : ''}</div>`;

    if (me.role === 'admin') {
      const { users } = await api('/api/users');
      $('stUsers').innerHTML = users.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td>
        <td><select data-role="${esc(u.email)}" ${u.email === me.email ? 'disabled' : ''}>
          <option value="viewer" ${u.role === 'viewer' ? 'selected' : ''}>Viewer</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option></select></td>
        <td class="r" style="white-space:nowrap">${u.email === me.email ? '<span class="mu">You</span>' : `<button class="btn" data-reset="${esc(u.email)}">Reset password</button> <button class="btn" data-del="${esc(u.email)}">Remove</button>`}</td></tr>`).join('');
      $('stUsers').querySelectorAll('[data-reset]').forEach(b => b.onclick = async () => {
        const pw = prompt(`New temporary password for ${b.dataset.reset} (at least 10 characters).\nThey'll be signed out everywhere; share it with them privately.`);
        if (pw == null) return;
        try { await api('/api/users/' + encodeURIComponent(b.dataset.reset) + '/password', { method: 'POST', body: JSON.stringify({ password: pw }) }); flash('Password reset. Ask them to change it after signing in.'); loadAudit(); }
        catch (e) { flash(e.message, true); }
      });
      loadAudit();
      $('stUsers').querySelectorAll('[data-role]').forEach(s => s.onchange = async () => {
        try { await api('/api/users/' + encodeURIComponent(s.dataset.role), { method: 'PUT', body: JSON.stringify({ role: s.value }) }); flash('Role updated.'); }
        catch (e) { flash(e.message, true); loadSettings(); }
      });
      $('stUsers').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        if (!confirm(`Remove ${b.dataset.del}? They will be signed out immediately.`)) return;
        try { await api('/api/users/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' }); flash('Team member removed.'); loadSettings(); }
        catch (e) { flash(e.message, true); }
      });
    }
  } catch (e) { flash('Could not load settings: ' + e.message, true); }
}

async function loadAudit() {
  try {
    const { entries } = await api('/api/audit');
    $('stAudit').innerHTML = tbl(entries, [
      r => `<span style="white-space:nowrap">${new Date(r.at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>`,
      r => esc(r.actor), r => esc(r.action), r => `<small class="mu">${esc(r.detail)}</small>`,
    ], 'No activity yet.');
    $('stAudit').querySelectorAll('td.r').forEach(td => td.classList.remove('r')); // tbl right-aligns non-first columns
  } catch (e) { $('stAudit').innerHTML = `<tr><td colspan="4" class="na">${esc(e.message)}</td></tr>`; }
}

$('stPrefs').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const { settings } = await api('/api/settings', { method: 'PUT', body: JSON.stringify({
      defaultPeriod: $('stPeriod').value, refreshSeconds: $('stRefresh').value, lowStockThreshold: $('stLow').value, shipWithinDays: $('stShip').value,
      sessionHours: $('stSession').value, compareByDefault: $('stCompare').checked }) });
    prefs = settings; startRefresh(); flash('Preferences saved.');
  } catch (err) { flash(err.message, true); }
};
$('stReconnect').onclick = async () => {
  try { await api('/api/cache/clear', { method: 'POST' }); flash('Reconnected to Shopify and cleared cached data.'); loadSettings(); }
  catch (e) { flash(e.message, true); }
};
$('stAddUser').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('/api/users', { method: 'POST', body: JSON.stringify({ name: $('nuName').value, email: $('nuEmail').value, password: $('nuPass').value, role: $('nuRole').value }) });
    e.target.reset(); flash('Team member added. Share the temporary password with them privately and ask them to change it.'); loadSettings();
  } catch (err) { flash(err.message, true); }
};
$('stPw').onsubmit = async (e) => {
  e.preventDefault();
  if ($('pwNew').value !== $('pwNew2').value) return flash('New passwords don\'t match.', true);
  try {
    await api('/api/password', { method: 'POST', body: JSON.stringify({ current: $('pwCur').value, next: $('pwNew').value }) });
    e.target.reset(); flash('Password updated. Your other sessions were signed out.');
  } catch (err) { flash(err.message, true); }
};
$('logoutBtn').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.href = 'login.html'; };

// ---- Start-up ----
(async () => {
  try {
    const j = await api('/api/me');
    me = j.user; prefs = j.settings;
  } catch { return; } // 401 already redirects to login
  $('meName').textContent = me.name;
  $('meRole').textContent = me.role === 'admin' ? 'Admin' : 'Viewer';
  $('meAv').textContent = me.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.body.classList.toggle('viewer', me.role !== 'admin');
  $('cmp').checked = prefs.compareByDefault;
  setPeriod(prefs.defaultPeriod);
  load();
  startRefresh();
})();
