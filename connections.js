// Data connections page: Shopify, visitor tracking, email, WhatsApp, and manually entered app expenses.
// Relies on: $, esc, fmt, tbl, me (settings.js).
const cnBadge = (s) => s === 'connected' ? '<span class="pill">● Connected</span>'
  : s === 'setup needed' ? '<span class="pill w">● Setup needed</span>' : '<span class="pill b">● Not connected</span>';
const cnRow = (l, v) => `<div class="lrow"><span class="mu">${l}</span><span style="text-align:right">${v}</span></div>`;

async function loadConnections(force) {
  $('cnErr').style.display = 'none'; $('cnContent').classList.add('loading');
  try {
    const r = await fetch('/api/connections' + (force ? '?refresh=1' : ''));
    const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText);
    renderConnections(j);
  } catch (e) { $('cnErr').textContent = 'Could not check connections: ' + e.message; $('cnErr').style.display = 'block'; }
  $('cnContent').classList.remove('loading');
}

function renderConnections(d) {
  cur = d.currency || cur;
  const S = d.shopify;
  $('cnShopStatus').innerHTML = cnBadge(S.status);
  $('cnShop').innerHTML = cnRow('Store', `${esc(S.name || '')} <span class="mu">(${esc(S.shop)})</span>`) + cnRow('API version', esc(S.apiVersion))
    + cnRow('Access token renews', `${new Date(S.tokenExpires).toLocaleString('en-AU')} · automatic`)
    + `<div style="margin-top:10px"><small class="mu">Permissions</small><div>${S.scopes.map(s => `<span class="scope">✔ ${esc(s)}</span>`).join('')}
       ${S.missing.map(s => `<span class="scope" style="background:#fde8e8;color:var(--red)">✖ ${esc(s)}</span>`).join('')}</div></div>
       ${S.missing.length ? '<div class="na">Add the red permissions in the Shopify Dev Dashboard → your app → Versions → access scopes, release, then approve in the store admin.</div>' : ''}`;

  const V = d.visitors;
  $('cnVisStatus').innerHTML = cnBadge(V.status);
  $('cnVis').innerHTML = V.status === 'connected'
    ? cnRow('Sessions, last 7 days', `<b>${V.sessions7d.toLocaleString()}</b>`) + '<div class="na">Powers the visitor funnel, traffic sources and devices on Overview and Customer journey.</div>'
    : '<div class="na">Visitor numbers come from Shopify Analytics. Add the <b>read_reports</b> permission to the app, then press Re-check. Nothing needs installing on the store: Shopify already records sessions.</div>';

  const E = d.email;
  $('cnMailStatus').innerHTML = cnBadge(E.status);
  $('cnMail').innerHTML = cnRow('Email subscribers', E.subscribers == null ? '<span class="mu">needs read_customers</span>' : `<b>${E.subscribers.toLocaleString()}</b>`)
    + cnRow('Email campaigns found', E.campaigns == null ? '<span class="mu">needs read_marketing_events</span>' : `<b>${E.campaigns.length}</b>`)
    + (E.campaigns?.length ? `<div style="margin-top:8px">${E.campaigns.slice(0, 5).map(c => `<div class="lrow"><span>${esc(c.title)}</span><small class="mu">${esc((c.status || '').toLowerCase())} · ${new Date(c.createdAt).toLocaleDateString('en-AU')}</small></div>`).join('')}</div>` : '')
    + '<div class="na">Reads email subscribers and campaigns recorded in Shopify (Shopify Email, and apps like Klaviyo that report to Shopify).</div>';

  $('cnWaStatus').innerHTML = cnBadge(d.whatsapp.status);
  $('cnWa').innerHTML = `<div class="na" style="line-height:1.6">WhatsApp isn't connected. Shopify doesn't hold WhatsApp data, so this needs a separate link to the
    <b>WhatsApp Business Platform</b> (Meta) or the WhatsApp app you use with Shopify. To set it up you'd need a WhatsApp Business account,
    and from Meta: a <b>phone number ID</b> and a <b>permanent access token</b>. Put these in the server's <code>.env</code> file, never on this page,
    and ask for the connection to be built.</div>`;

  const X = d.expenses;
  $('cnExpStatus').innerHTML = cnBadge(X.status);
  $('cnExpTotal').textContent = fmt(X.monthlyCost);
  $('cnExpSales').textContent = fmt(X.sales30);
  $('cnExpPct').textContent = X.pctOfSales == null ? '–' : X.pctOfSales.toFixed(1) + '%';
  const admin = me?.role === 'admin';
  $('cnExpList').innerHTML = tbl(X.items, [
    r => `<b>${esc(r.name)}</b>`, r => `<span class="mu">${esc(r.category)}</span>`, r => `${fmt(r.monthly)} <small class="mu">/${r.billing === 'yearly' ? 'yr' : 'mo'}</small>`,
    r => fmt(r.billing === 'yearly' ? r.monthly / 12 : r.monthly),
    r => admin ? `<button class="btn" data-exdel="${esc(r.id)}" style="padding:5px 10px">Remove</button>` : '',
  ], 'No app expenses added yet.');
}

$('cnRefresh').onclick = () => loadConnections(true);
$('cnExpForm').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const r = await fetch('/api/expenses', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: $('exName').value, category: $('exCat').value, monthly: $('exAmt').value, billing: $('exBill').value }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error);
    e.target.reset(); loadConnections(true);
  } catch (err) { $('cnErr').textContent = err.message; $('cnErr').style.display = 'block'; }
};
$('cnExpList').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-exdel]'); if (!b) return;
  if (!confirm('Remove this expense?')) return;
  const r = await fetch('/api/expenses/' + b.dataset.exdel, { method: 'DELETE' });
  if (r.ok) loadConnections(true); else { $('cnErr').textContent = (await r.json()).error; $('cnErr').style.display = 'block'; }
});
