// PixMagic Insights — live Shopify dashboard backend (no dependencies, Node 18+)
const http = require('http');
const fs = require('fs');
const path = require('path');
const auth = require('./auth');

// ---- .env loader ----
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const SHOP = (process.env.SHOPIFY_SHOP || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-10';
const PORT = process.env.PORT || 3000;

if (!SHOP || !CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing SHOPIFY_SHOP / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET in .env (see .env.example)');
  process.exit(1);
}

// ---- Token with automatic renewal (client credentials grant, ~24h lifetime) ----
let token = null, tokenExpires = 0, tokenScopes = [];
async function getToken() {
  if (token && Date.now() < tokenExpires - 5 * 60 * 1000) return token;
  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Token request failed (${res.status}): ${JSON.stringify(data)}`);
  token = data.access_token;
  tokenExpires = Date.now() + (data.expires_in || 86399) * 1000;
  tokenScopes = (data.scope || '').split(',').filter(Boolean);
  console.log(`[auth] new token, scopes: ${tokenScopes.join(', ')}`);
  return token;
}
const hasScope = (s) => tokenScopes.includes(s) || tokenScopes.includes(s.replace('read_', 'write_'));

async function gql(query, variables = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await getToken() },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 401) { token = null; continue; }
    if (res.status === 429) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
    const data = await res.json();
    const throttled = data.errors?.some(e => e.extensions?.code === 'THROTTLED');
    if (throttled) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
    if (data.errors) throw new Error(data.errors.map(e => e.message).join('; '));
    return data.data;
  }
  throw new Error('Shopify API: too many retries');
}

// ---- Small cache so auto-refresh doesn't hammer the API ----
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}

// ---- Data fetchers ----
async function fetchShop() {
  const d = await gql(`{ shop { name currencyCode ianaTimezone myshopifyDomain billingAddress { countryCodeV2 } } }`);
  return d.shop;
}

async function fetchOrders(fromISO, toISO) {
  const withCustomer = hasScope('read_customers');
  const q = `query($cursor:String,$q:String){ orders(first:250, after:$cursor, query:$q, sortKey:CREATED_AT, reverse:true){
    pageInfo{ hasNextPage endCursor }
    nodes{ id name createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus
      totalPriceSet{ shopMoney{ amount currencyCode } }
      totalRefundedSet{ shopMoney{ amount } }
      ${withCustomer ? 'customer{ id displayName numberOfOrders createdAt }' : ''}
      lineItems(first:50){ nodes{ title quantity product{ id featuredMedia{ preview{ image{ url } } } }
        originalTotalSet{ shopMoney{ amount } } } } } } }`;
  const all = [];
  let cursor = null;
  const filter = `created_at:>='${fromISO}' AND created_at:<='${toISO}'`;
  do {
    const d = await gql(q, { cursor, q: filter });
    all.push(...d.orders.nodes);
    cursor = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null;
  } while (cursor && all.length < 25000);
  return all;
}

async function fetchAbandoned(fromISO, toISO) {
  try {
    const d = await gql(`query($q:String){ abandonedCheckoutsCount(query:$q){ count } }`,
      { q: `created_at:>='${fromISO}' AND created_at:<='${toISO}'` });
    return d.abandonedCheckoutsCount.count;
  } catch (e) { return null; }
}

async function fetchLowStock() {
  if (!hasScope('read_inventory')) return null;
  try {
    const t = auth.getSettings().lowStockThreshold;
    const d = await gql(`{ products(first:50, query:"inventory_total:<${t} AND status:active"){ nodes{ title totalInventory } } }`);
    return d.products.nodes;
  } catch (e) { return null; }
}

async function fetchJourney(from, to) {
  // ShopifyQL sessions funnel (needs read_reports / analytics access)
  try {
    const d = await gql(`query($q:String!){ shopifyqlQuery(query:$q){ tableData{ columns{ name } rows } parseErrors } }`, {
      q: `FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout SINCE ${from} UNTIL ${to}`,
    });
    const t = d.shopifyqlQuery?.tableData;
    if (!t || !t.rows?.length) return null;
    const row = Array.isArray(t.rows[0]) ? t.rows[0] : Object.values(t.rows[0]);
    const n = row.map(Number);
    return { visitors: n[0], addedToCart: n[1], checkoutStarted: n[2], purchased: n[3] };
  } catch (e) { return null; }
}

// ---- Metrics ----
const money = (s) => parseFloat(s?.shopMoney?.amount || 0);
function dayKey(iso, tz) { return new Date(iso).toLocaleDateString('en-CA', { timeZone: tz }); }

function summarise(orders, tz) {
  const valid = orders.filter(o => !o.cancelledAt);
  const sales = valid.reduce((s, o) => s + money(o.totalPriceSet) - money(o.totalRefundedSet), 0);
  const byDay = {};
  for (const o of valid) { const k = dayKey(o.createdAt, tz); byDay[k] = (byDay[k] || 0) + money(o.totalPriceSet); }
  const custs = new Map();
  for (const o of valid) if (o.customer) custs.set(o.customer.id, o.customer);
  const returning = [...custs.values()].filter(c => c.numberOfOrders > 1).length;
  return {
    sales, orders: valid.length, aov: valid.length ? sales / valid.length : 0, byDay,
    customers: custs.size || null, returning: custs.size ? returning : null,
    returningPct: custs.size ? (returning / custs.size) * 100 : null,
  };
}

const pct = (a, b) => (b ? ((a - b) / b) * 100 : null);

async function buildOverview(from, to) {
  const shop = await cached('shop', 3600e3, fetchShop);
  const tz = shop.ianaTimezone;
  const days = Math.round((new Date(to) - new Date(from)) / 864e5) + 1;
  const pFrom = new Date(new Date(from) - days * 864e5).toISOString().slice(0, 10);
  const pTo = new Date(new Date(from) - 864e5).toISOString().slice(0, 10);
  const iso = (d, end) => `${d}T${end ? '23:59:59' : '00:00:00'}`;

  const [cur, prev, abandoned, lowStock, journey] = await Promise.all([
    fetchOrders(iso(from), iso(to, 1)),
    fetchOrders(iso(pFrom), iso(pTo, 1)),
    fetchAbandoned(iso(from), iso(to, 1)),
    cached('lowstock', 300e3, fetchLowStock),
    fetchJourney(from, to),
  ]);
  const c = summarise(cur, tz), p = summarise(prev, tz);

  // best sellers
  const prod = {};
  for (const o of cur) if (!o.cancelledAt) for (const li of o.lineItems.nodes) {
    const k = li.product?.id || li.title;
    prod[k] ||= { title: li.title, units: 0, revenue: 0, image: li.product?.featuredMedia?.preview?.image?.url || null };
    prod[k].units += li.quantity; prod[k].revenue += money(li.originalTotalSet);
  }
  const prodTotal = Object.values(prod).reduce((s, x) => s + x.revenue, 0);
  const bestSellers = Object.values(prod).sort((a, b) => b.units - a.units).slice(0, 5)
    .map(x => ({ ...x, share: prodTotal ? (x.revenue / prodTotal) * 100 : 0 }));

  // payments
  const st = (s) => cur.filter(o => o.displayFinancialStatus === s).length;
  const paid = cur.filter(o => ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'PARTIALLY_PAID'].includes(o.displayFinancialStatus)).length;
  const failed = st('VOIDED') + st('EXPIRED');
  const refunded = cur.filter(o => money(o.totalRefundedSet) > 0).length;

  // new vs returning
  let newC = null, retC = null;
  if (c.customers) { retC = c.returning; newC = c.customers - c.returning; }

  // trend series (fill every day)
  const series = (fromD, n, byDay) => Array.from({ length: n }, (_, i) => {
    const d = new Date(new Date(fromD).getTime() + i * 864e5).toISOString().slice(0, 10);
    return { date: d, value: +(byDay[d] || 0).toFixed(2) };
  });

  return {
    shop: { name: shop.name, currency: shop.currencyCode, timezone: tz, country: shop.billingAddress?.countryCodeV2, domain: shop.myshopifyDomain },
    range: { from, to, prevFrom: pFrom, prevTo: pTo },
    scopes: tokenScopes,
    kpis: {
      sales: c.sales, salesChange: pct(c.sales, p.sales),
      aov: c.aov, aovChange: pct(c.aov, p.aov),
      orders: c.orders, ordersChange: pct(c.orders, p.orders),
      returningPct: c.returningPct, returningChange: c.returningPct != null && p.returningPct != null ? c.returningPct - p.returningPct : null,
    },
    trend: { current: series(from, days, c.byDay), previous: series(pFrom, days, p.byDay) },
    journey,
    recentOrders: cur.slice(0, 8).map(o => ({
      id: o.id.split('/').pop(), name: o.name, customer: o.customer?.displayName || null, date: o.createdAt,
      payment: o.displayFinancialStatus, fulfilment: o.displayFulfillmentStatus, total: money(o.totalPriceSet),
    })),
    bestSellers,
    payments: { total: cur.length, paid, failed, refunded },
    customers: { total: c.customers, new: newC, returning: retC },
    attention: { lowStock: lowStock ? lowStock.length : null, abandoned, failed },
    health: await (async () => {
      const c = await cached('connections', 600e3, buildConnections).catch(() => null);
      return {
        shopify: 'connected',
        analytics: journey || c?.visitors.status === 'connected' ? 'connected' : 'setup needed',
        email: c?.email.status || 'not connected',
        expenses: c?.expenses.status || 'not connected',
      };
    })(),
    fetchedAt: new Date().toISOString(),
  };
}

// ---- Marketing ----
async function fetchMarketingOrders(fromISO, toISO) {
  const build = (journey) => `query($cursor:String,$q:String){ orders(first:250, after:$cursor, query:$q){
    pageInfo{ hasNextPage endCursor }
    nodes{ createdAt cancelledAt sourceName discountCodes
      totalPriceSet{ shopMoney{ amount } } totalDiscountsSet{ shopMoney{ amount } }
      ${journey ? 'customerJourneySummary{ firstVisit{ source referrerUrl utmParameters{ source medium campaign } } }' : ''} } } }`;
  const run = async (journey) => {
    const all = []; let cursor = null;
    do {
      const d = await gql(build(journey), { cursor, q: `created_at:>='${fromISO}' AND created_at:<='${toISO}'` });
      all.push(...d.orders.nodes);
      cursor = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null;
    } while (cursor && all.length < 25000);
    return all;
  };
  try { return { orders: await run(true), journey: true }; }
  catch (e) { return { orders: await run(false), journey: false }; }
}

async function fetchCampaigns() {
  try {
    const d = await gql(`{ marketingActivities(first:25, reverse:true){ nodes{ title status createdAt
      marketingChannelType utmParameters{ campaign source medium } } } }`);
    return d.marketingActivities.nodes;
  } catch (e) { return null; }
}

function group(orders, keyFn) {
  const m = {};
  for (const o of orders) {
    const k = keyFn(o) || 'Unknown';
    m[k] ||= { name: k, orders: 0, sales: 0 };
    m[k].orders++; m[k].sales += money(o.totalPriceSet);
  }
  return Object.values(m).sort((a, b) => b.sales - a.sales);
}

async function buildMarketing(from, to) {
  const { orders: raw, journey } = await fetchMarketingOrders(`${from}T00:00:00`, `${to}T23:59:59`);
  const orders = raw.filter(o => !o.cancelledAt);
  const [abandoned, campaigns] = await Promise.all([fetchAbandoned(`${from}T00:00:00`, `${to}T23:59:59`), fetchCampaigns()]);
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
  const discounted = orders.filter(o => o.discountCodes?.length);
  const codes = {};
  for (const o of discounted) for (const c of o.discountCodes) {
    codes[c] ||= { code: c, uses: 0, sales: 0, discount: 0 };
    codes[c].uses++; codes[c].sales += money(o.totalPriceSet); codes[c].discount += money(o.totalDiscountsSet);
  }
  return {
    range: { from, to },
    totals: {
      orders: orders.length, sales: orders.reduce((s, o) => s + money(o.totalPriceSet), 0),
      discountedOrders: discounted.length, discountTotal: orders.reduce((s, o) => s + money(o.totalDiscountsSet), 0),
      abandoned,
    },
    channels: group(orders, o => o.sourceName === 'web' ? 'Online store' : o.sourceName === 'pos' ? 'Point of sale' : o.sourceName),
    sources: journey ? group(orders, o => o.customerJourneySummary?.firstVisit?.utmParameters?.source
      || host(o.customerJourneySummary?.firstVisit?.referrerUrl) || o.customerJourneySummary?.firstVisit?.source || 'Direct') : null,
    utmCampaigns: journey ? group(orders.filter(o => o.customerJourneySummary?.firstVisit?.utmParameters?.campaign),
      o => o.customerJourneySummary.firstVisit.utmParameters.campaign) : null,
    discountCodes: Object.values(codes).sort((a, b) => b.uses - a.uses),
    campaigns,
  };
}

// ---- Reports ----
async function buildReports(year) {
  const shop = await cached('shop', 3600e3, fetchShop);
  const tz = shop.ianaTimezone;
  const [cur, prev] = await Promise.all([
    fetchOrders(`${year}-01-01T00:00:00`, `${year}-12-31T23:59:59`),
    fetchOrders(`${year - 1}-01-01T00:00:00`, `${year - 1}-12-31T23:59:59`),
  ]);
  const monthly = (orders) => {
    const m = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, orders: 0, sales: 0, refunds: 0 }));
    for (const o of orders) if (!o.cancelledAt) {
      const i = +dayKey(o.createdAt, tz).slice(5, 7) - 1;
      m[i].orders++; m[i].sales += money(o.totalPriceSet); m[i].refunds += money(o.totalRefundedSet);
    }
    return m;
  };
  const valid = cur.filter(o => !o.cancelledAt);
  const dow = Array.from({ length: 7 }, (_, i) => ({ day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i], orders: 0, sales: 0 }));
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: 0 }));
  for (const o of valid) {
    const d = new Date(new Date(o.createdAt).toLocaleString('en-US', { timeZone: tz }));
    dow[d.getDay()].orders++; dow[d.getDay()].sales += money(o.totalPriceSet); hours[d.getHours()].orders++;
  }
  const prod = {};
  for (const o of valid) for (const li of o.lineItems.nodes) {
    const k = li.product?.id || li.title;
    prod[k] ||= { title: li.title, units: 0, revenue: 0, orders: 0 };
    prod[k].units += li.quantity; prod[k].revenue += money(li.originalTotalSet); prod[k].orders++;
  }
  const custs = {};
  for (const o of valid) if (o.customer) {
    custs[o.customer.id] ||= { name: o.customer.displayName, orders: 0, sales: 0 };
    custs[o.customer.id].orders++; custs[o.customer.id].sales += money(o.totalPriceSet);
  }
  const statusCount = (f) => valid.reduce((m, o) => (m[o[f]] = (m[o[f]] || 0) + 1, m), {});
  return {
    year, currency: shop.currencyCode,
    monthly: monthly(cur), monthlyPrev: monthly(prev),
    dayOfWeek: dow, hours,
    products: Object.values(prod).sort((a, b) => b.revenue - a.revenue),
    topCustomers: hasScope('read_customers') ? Object.values(custs).sort((a, b) => b.sales - a.sales).slice(0, 20) : null,
    financialStatus: statusCount('displayFinancialStatus'),
    fulfilmentStatus: statusCount('displayFulfillmentStatus'),
  };
}


// ---- Customers (needs read_customers; email/phone also need protected customer data approval) ----
const CUSTOMER_FIELDS = (contact) => `id displayName ${contact ? 'email phone' : ''} numberOfOrders createdAt tags state
  amountSpent{ amount currencyCode } defaultAddress{ city province countryCodeV2 }`;
let contactAllowed = true;
async function customerQuery(build) {
  if (contactAllowed) {
    try { return await gql(build(true)); }
    catch (e) { if (!/access|denied|protected/i.test(e.message)) throw e; contactAllowed = false; }
  }
  return gql(build(false));
}
const custSearch = (s) => String(s || '').replace(/["\\]/g, '').slice(0, 100);
const customerRow = (c) => ({
  id: c.id.split('/').pop(), name: c.displayName, email: c.email || null, phone: c.phone || null,
  orders: +c.numberOfOrders, spent: money({ shopMoney: c.amountSpent }), createdAt: c.createdAt, tags: c.tags, state: c.state,
  location: [c.defaultAddress?.city, c.defaultAddress?.province, c.defaultAddress?.countryCodeV2].filter(Boolean).join(', ') || null,
});

async function listCustomers({ q, sort, after }) {
  const sortKey = { newest: 'CREATED_AT', updated: 'UPDATED_AT', name: 'NAME' }[sort] || 'CREATED_AT';
  const reverse = sort !== 'name';
  const filter = custSearch(q);
  const d = await customerQuery((contact) => `{ customers(first:50, sortKey:${sortKey}, reverse:${reverse}
    ${after ? `, after:${JSON.stringify(after)}` : ''}${filter ? `, query:${JSON.stringify(filter)}` : ''}){
    pageInfo{ hasNextPage endCursor } nodes{ ${CUSTOMER_FIELDS(contact)} } } }`);
  return { customers: d.customers.nodes.map(customerRow), nextCursor: d.customers.pageInfo.hasNextPage ? d.customers.pageInfo.endCursor : null, contactAllowed };
}

async function customerStats(from, to) {
  const count = async (q) => {
    const d = await gql(`query($q:String){ customersCount(query:$q){ count } }`, { q });
    return d.customersCount.count;
  };
  const [total, newInRange, returning, subscribed] = await Promise.all([
    count(null), count(`created_at:>='${from}' AND created_at:<='${to}T23:59:59'`),
    count('orders_count:>1'), count('email_subscription_status:SUBSCRIBED').catch(() => null),
  ]);
  const withOrders = await count('orders_count:>0');

  // Top spenders + locations from the last 12 months of orders
  const since = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const orders = (await cached(`orders12m:${since}`, 300e3, () => fetchOrders(`${since}T00:00:00`, `${to}T23:59:59`))).filter(o => !o.cancelledAt && o.customer);
  const spend = {};
  for (const o of orders) {
    const k = o.customer.id;
    spend[k] ||= { id: k.split('/').pop(), name: o.customer.displayName, orders: 0, spent: 0, last: o.createdAt };
    spend[k].orders++; spend[k].spent += money(o.totalPriceSet);
    if (o.createdAt > spend[k].last) spend[k].last = o.createdAt;
  }
  const buyers = Object.values(spend);
  const totalSpent = buyers.reduce((s, b) => s + b.spent, 0);
  const lapsed = buyers.filter(b => Date.now() - new Date(b.last) > 180 * 864e5).length;
  return {
    total, newInRange, returning, withOrders, subscribed,
    returningRate: withOrders ? (returning / withOrders) * 100 : null,
    avgSpend12m: buyers.length ? totalSpent / buyers.length : null,
    buyers12m: buyers.length, lapsed,
    topSpenders: buyers.sort((a, b) => b.spent - a.spent).slice(0, 10),
  };
}

async function customerDetail(id) {
  const gid = `gid://shopify/Customer/${id}`;
  const d = await customerQuery((contact) => `{ customer(id:${JSON.stringify(gid)}){ ${CUSTOMER_FIELDS(contact)} note
    orders(first:25, reverse:true, sortKey:CREATED_AT){ nodes{ name createdAt displayFinancialStatus displayFulfillmentStatus
      totalPriceSet{ shopMoney{ amount } } lineItems(first:5){ nodes{ title quantity } } } } } }`);
  if (!d.customer) return null;
  const orders = d.customer.orders.nodes.map(o => ({
    name: o.name, date: o.createdAt, payment: o.displayFinancialStatus, fulfilment: o.displayFulfillmentStatus,
    total: money(o.totalPriceSet), items: o.lineItems.nodes.map(li => `${li.quantity}× ${li.title}`),
  }));
  return { ...customerRow(d.customer), note: d.customer.note, orderHistory: orders,
    avgOrder: orders.length ? orders.reduce((s, o) => s + o.total, 0) / orders.length : null,
    firstOrder: orders.at(-1)?.date || null, lastOrder: orders[0]?.date || null };
}

// ---- Orders page ----
const ORDER_STATUS = {
  payment: { paid: 'financial_status:paid', pending: 'financial_status:pending', authorized: 'financial_status:authorized',
    refunded: 'financial_status:refunded OR financial_status:partially_refunded', voided: 'financial_status:voided' },
  fulfilment: { unfulfilled: 'fulfillment_status:unfulfilled', partial: 'fulfillment_status:partial', fulfilled: 'fulfillment_status:shipped' },
};
function orderFilter({ from, to, q, payment, fulfilment, status }) {
  const parts = [`created_at:>='${from}T00:00:00' AND created_at:<='${to}T23:59:59'`];
  if (ORDER_STATUS.payment[payment]) parts.push(`(${ORDER_STATUS.payment[payment]})`);
  if (ORDER_STATUS.fulfilment[fulfilment]) parts.push(`(${ORDER_STATUS.fulfilment[fulfilment]})`);
  if (['open', 'closed', 'cancelled'].includes(status)) parts.push(`status:${status}`);
  const text = String(q || '').replace(/["'\\()]/g, '').trim().slice(0, 100);
  if (text) parts.push(/^#?\d+$/.test(text) ? `name:${text.replace('#', '')}` : `"${text}"`);
  return parts.join(' AND ');
}

async function listOrders(params) {
  const sortKey = { newest: 'CREATED_AT', total: 'TOTAL_PRICE', number: 'ORDER_NUMBER' }[params.sort] || 'CREATED_AT';
  const withCustomer = hasScope('read_customers');
  const d = await gql(`query($q:String,$after:String){ orders(first:50, after:$after, query:$q, sortKey:${sortKey}, reverse:true){
    pageInfo{ hasNextPage endCursor }
    nodes{ id name createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus sourceName
      totalPriceSet{ shopMoney{ amount } } currentSubtotalLineItemsQuantity
      ${withCustomer ? 'customer{ displayName }' : ''} } } }`, { q: orderFilter(params), after: params.after || null });
  return {
    orders: d.orders.nodes.map(o => ({
      id: o.id.split('/').pop(), name: o.name, date: o.createdAt, cancelled: !!o.cancelledAt, customer: o.customer?.displayName || null,
      payment: o.displayFinancialStatus, fulfilment: o.displayFulfillmentStatus, channel: o.sourceName,
      items: o.currentSubtotalLineItemsQuantity, total: money(o.totalPriceSet),
    })),
    nextCursor: d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null,
  };
}

async function orderStats(from, to) {
  const base = `created_at:>='${from}T00:00:00' AND created_at:<='${to}T23:59:59'`;
  const count = async (extra) => {
    const d = await gql(`query($q:String){ ordersCount(query:$q, limit:null){ count } }`, { q: extra ? `${base} AND ${extra}` : base });
    return d.ordersCount.count;
  };
  const [total, unfulfilled, pending, refunded, cancelled, openUnfulfilled] = await Promise.all([
    count(), count('fulfillment_status:unfulfilled AND -status:cancelled'), count('(financial_status:pending OR financial_status:authorized)'),
    count('(financial_status:refunded OR financial_status:partially_refunded)'), count('status:cancelled'),
    // Every unfulfilled open order regardless of date: the actual to-do list
    gql(`{ ordersCount(query:"fulfillment_status:unfulfilled AND status:open", limit:null){ count } }`).then(d => d.ordersCount.count),
  ]);
  return { total, unfulfilled, pending, refunded, cancelled, openUnfulfilled };
}

async function orderDetail(id) {
  const gid = `gid://shopify/Order/${id}`;
  const withCustomer = hasScope('read_customers');
  const build = (address) => `query($id:ID!){ order(id:$id){ name createdAt processedAt cancelledAt cancelReason closedAt
    displayFinancialStatus displayFulfillmentStatus note tags sourceName discountCodes
    subtotalPriceSet{ shopMoney{ amount } } totalShippingPriceSet{ shopMoney{ amount } } totalTaxSet{ shopMoney{ amount } }
    totalDiscountsSet{ shopMoney{ amount } } totalPriceSet{ shopMoney{ amount currencyCode } } totalRefundedSet{ shopMoney{ amount } }
    ${withCustomer ? 'customer{ id displayName numberOfOrders }' : ''}
    ${address ? 'shippingAddress{ city province countryCodeV2 }' : ''}
    lineItems(first:100){ nodes{ title variantTitle quantity sku image{ url }
      originalUnitPriceSet{ shopMoney{ amount } } discountedTotalSet{ shopMoney{ amount } } } }
    fulfillments{ status createdAt displayStatus trackingInfo{ company number url } }
    transactions(first:20){ kind status gateway createdAt amountSet{ shopMoney{ amount } } } } }`;
  let d;
  try { d = await gql(build(true), { id: gid }); }
  catch (e) { if (!/access|denied|protected/i.test(e.message)) throw e; d = await gql(build(false), { id: gid }); }
  const o = d.order;
  if (!o) return null;
  return {
    id, name: o.name, createdAt: o.createdAt, cancelledAt: o.cancelledAt, cancelReason: o.cancelReason, closedAt: o.closedAt,
    payment: o.displayFinancialStatus, fulfilment: o.displayFulfillmentStatus, note: o.note, tags: o.tags, channel: o.sourceName,
    discountCodes: o.discountCodes, currency: o.totalPriceSet.shopMoney.currencyCode,
    totals: { subtotal: money(o.subtotalPriceSet), shipping: money(o.totalShippingPriceSet), tax: money(o.totalTaxSet),
      discounts: money(o.totalDiscountsSet), total: money(o.totalPriceSet), refunded: money(o.totalRefundedSet) },
    customer: o.customer ? { id: o.customer.id.split('/').pop(), name: o.customer.displayName, orders: +o.customer.numberOfOrders } : null,
    shipTo: o.shippingAddress ? [o.shippingAddress.city, o.shippingAddress.province, o.shippingAddress.countryCodeV2].filter(Boolean).join(', ') : null,
    items: o.lineItems.nodes.map(li => ({ title: li.title, variant: li.variantTitle, qty: li.quantity, sku: li.sku, image: li.image?.url || null,
      unit: money(li.originalUnitPriceSet), total: money(li.discountedTotalSet) })),
    fulfillments: o.fulfillments.map(f => ({ status: f.displayStatus || f.status, date: f.createdAt,
      tracking: f.trackingInfo.map(t => ({ company: t.company, number: t.number, url: /^https?:\/\//.test(t.url || '') ? t.url : null })) })),
    transactions: o.transactions.map(t => ({ kind: t.kind, status: t.status, gateway: t.gateway, date: t.createdAt, amount: money(t.amountSet) })),
  };
}

// ---- Products & inventory ----
const ordersInRange = (from, to) => cached(`ord:${from}:${to}`, 120e3, () => fetchOrders(`${from}T00:00:00`, `${to}T23:59:59`));
function salesByProduct(orders) {
  const m = {};
  for (const o of orders) if (!o.cancelledAt) for (const li of o.lineItems.nodes) {
    const k = li.product?.id; if (!k) continue;
    m[k] ||= { units: 0, revenue: 0, orders: 0 };
    m[k].units += li.quantity; m[k].revenue += money(li.originalTotalSet); m[k].orders++;
  }
  return m;
}
const productQueryText = ({ q, status, stock }) => {
  const t = auth.getSettings().lowStockThreshold;
  const parts = [];
  if (['active', 'draft', 'archived'].includes(status)) parts.push(`status:${status}`);
  if (stock === 'out') parts.push('inventory_total:<=0');
  if (stock === 'low') parts.push(`inventory_total:>0 AND inventory_total:<${t}`);
  const text = String(q || '').replace(/["'\\()]/g, '').trim().slice(0, 100);
  if (text) parts.push(`"${text}"`);
  return parts.join(' AND ') || null;
};

async function listProducts(params) {
  const inv = hasScope('read_inventory');
  const sortKey = { title: 'TITLE', updated: 'UPDATED_AT', newest: 'CREATED_AT', stock: inv ? 'INVENTORY_TOTAL' : 'TITLE' }[params.sort] || 'TITLE';
  const reverse = ['updated', 'newest'].includes(params.sort);
  const d = await gql(`query($q:String,$after:String){ products(first:50, after:$after, query:$q, sortKey:${sortKey}, reverse:${reverse}){
    pageInfo{ hasNextPage endCursor }
    nodes{ id title status productType vendor ${inv ? 'totalInventory tracksInventory' : ''}
      featuredMedia{ preview{ image{ url } } } variantsCount{ count }
      priceRangeV2{ minVariantPrice{ amount } maxVariantPrice{ amount } } } } }`,
    { q: params.stock && !inv ? null : productQueryText(params), after: params.after || null });
  const sales = salesByProduct(await ordersInRange(params.from, params.to));
  const t = auth.getSettings().lowStockThreshold;
  return {
    inventory: inv, lowStockThreshold: t,
    products: d.products.nodes.map(p => {
      const s = sales[p.id] || { units: 0, revenue: 0, orders: 0 };
      const stock = inv && p.tracksInventory ? p.totalInventory : null;
      return {
        id: p.id.split('/').pop(), title: p.title, status: p.status, type: p.productType, vendor: p.vendor,
        image: p.featuredMedia?.preview?.image?.url || null, variants: p.variantsCount?.count ?? null,
        priceMin: +p.priceRangeV2.minVariantPrice.amount, priceMax: +p.priceRangeV2.maxVariantPrice.amount,
        stock, stockState: stock == null ? null : stock <= 0 ? 'out' : stock < t ? 'low' : 'ok', ...s,
      };
    }),
    nextCursor: d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null,
  };
}

async function productStats(from, to) {
  const inv = hasScope('read_inventory');
  const t = auth.getSettings().lowStockThreshold;
  const count = (q) => gql(`query($q:String){ productsCount(query:$q, limit:null){ count } }`, { q }).then(d => d.productsCount.count);
  const [active, draft, out, low, orders] = await Promise.all([
    count('status:active'), count('status:draft'),
    inv ? count('status:active AND inventory_total:<=0') : null,
    inv ? count(`status:active AND inventory_total:>0 AND inventory_total:<${t}`) : null,
    ordersInRange(from, to),
  ]);
  const sales = salesByProduct(orders);
  const rows = Object.values(sales);
  return {
    inventory: inv, lowStockThreshold: t, active, draft, outOfStock: out, lowStock: low,
    unitsSold: rows.reduce((s, r) => s + r.units, 0), productsSold: rows.length,
    notSelling: Math.max(0, active - rows.length),
  };
}

async function productDetail(id, from, to) {
  const inv = hasScope('read_inventory');
  const gid = `gid://shopify/Product/${id}`;
  const d = await gql(`query($id:ID!){ product(id:$id){ id title status productType vendor tags createdAt onlineStoreUrl
    ${inv ? 'totalInventory tracksInventory' : ''} featuredMedia{ preview{ image{ url } } }
    variants(first:100){ nodes{ id title sku price compareAtPrice ${inv ? `inventoryQuantity
      inventoryItem{ tracked inventoryLevels(first:10){ nodes{ location{ name } quantities(names:["available","committed","incoming","on_hand"]){ name quantity } } } }` : ''} } } } }`, { id: gid });
  const p = d.product;
  if (!p) return null;
  const shop = await cached('shop', 3600e3, fetchShop);
  // 90-day daily units for this product, plus its sales in the selected range
  const since = new Date(Date.now() - 89 * 864e5).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const [recent, ranged] = await Promise.all([ordersInRange(since, today), ordersInRange(from, to)]);
  const byDay = {}, variantSales = {};
  for (const o of recent) if (!o.cancelledAt) for (const li of o.lineItems.nodes) if (li.product?.id === gid) {
    const k = dayKey(o.createdAt, shop.ianaTimezone); byDay[k] = (byDay[k] || 0) + li.quantity;
  }
  const s = salesByProduct(ranged)[gid] || { units: 0, revenue: 0, orders: 0 };
  const daily = Array.from({ length: 90 }, (_, i) => {
    const k = new Date(Date.now() - (89 - i) * 864e5).toISOString().slice(0, 10);
    return { date: k, units: byDay[k] || 0 };
  });
  const units90 = daily.reduce((a, x) => a + x.units, 0);
  const stock = inv && p.tracksInventory ? p.totalInventory : null;
  return {
    id, title: p.title, status: p.status, type: p.productType, vendor: p.vendor, tags: p.tags, createdAt: p.createdAt,
    url: p.onlineStoreUrl, image: p.featuredMedia?.preview?.image?.url || null, inventory: inv, stock,
    sales: s, daily, units90,
    // Days of stock left at the last-90-day sales pace
    daysOfStock: stock != null && units90 > 0 ? Math.round(stock / (units90 / 90)) : null,
    variants: p.variants.nodes.map(v => ({
      title: v.title, sku: v.sku, price: +v.price, compareAt: v.compareAtPrice ? +v.compareAtPrice : null,
      stock: inv && v.inventoryItem?.tracked ? v.inventoryQuantity : null,
      locations: inv ? (v.inventoryItem?.inventoryLevels.nodes || []).map(l => ({
        name: l.location.name, ...Object.fromEntries(l.quantities.map(q => [q.name, q.quantity])),
      })) : [],
    })),
  };
}

// ---- Payments & refunds ----
const GATEWAYS = { shopify_payments: 'Shopify Payments', paypal: 'PayPal', afterpay: 'Afterpay', manual: 'Manual', gift_card: 'Gift card', bogus: 'Test gateway', cash: 'Cash' };
const gatewayName = (g) => GATEWAYS[g] || (g ? g.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Unknown');

async function fetchPaymentOrders(from, to) {
  // updated_at catches refunds/captures in the period on orders placed earlier
  const q = `query($cursor:String,$q:String){ orders(first:100, after:$cursor, query:$q){
    pageInfo{ hasNextPage endCursor }
    nodes{ id name createdAt displayFinancialStatus totalPriceSet{ shopMoney{ amount } }
      transactions(first:25){ kind status gateway createdAt errorCode amountSet{ shopMoney{ amount } } }
      refunds(first:10){ createdAt note totalRefundedSet{ shopMoney{ amount } } } } } }`;
  const all = []; let cursor = null;
  do {
    const d = await gql(q, { cursor, q: `updated_at:>='${from}T00:00:00' AND updated_at:<='${to}T23:59:59'` });
    all.push(...d.orders.nodes);
    cursor = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null;
  } while (cursor && all.length < 25000);
  return all;
}

async function fetchPayouts() {
  try {
    const d = await gql(`{ shopifyPaymentsAccount{ balance{ amount currencyCode }
      payouts(first:10, reverse:true){ nodes{ issuedAt status net{ amount } summary{ chargesGross{ amount } refundsFeeGross{ amount } chargesFee{ amount } } } } } }`);
    const a = d.shopifyPaymentsAccount;
    if (!a) return null;
    return {
      balance: a.balance.reduce((s, b) => s + +b.amount, 0),
      payouts: a.payouts.nodes.map(p => ({ date: p.issuedAt, status: p.status, net: +p.net.amount,
        gross: +(p.summary?.chargesGross?.amount || 0), fees: +(p.summary?.chargesFee?.amount || 0) })),
    };
  } catch (e) { return null; }
}

async function buildPayments(from, to) {
  const shop = await cached('shop', 3600e3, fetchShop);
  const tz = shop.ianaTimezone;
  const inRange = (d) => { const k = dayKey(d, tz); return k >= from && k <= to; };
  const [orders, payouts, awaitingCount] = await Promise.all([
    fetchPaymentOrders(from, to), fetchPayouts(),
    gql(`{ ordersCount(query:"financial_status:authorized AND -status:cancelled", limit:null){ count } }`).then(d => d.ordersCount.count).catch(() => null),
  ]);

  const days = Math.round((new Date(to) - new Date(from)) / 864e5) + 1;
  const daily = Object.fromEntries(Array.from({ length: days }, (_, i) =>
    [new Date(new Date(from).getTime() + i * 864e5).toISOString().slice(0, 10), { collected: 0, refunded: 0 }]));
  const gateways = {}, failed = [], refunds = [], awaiting = [];
  let collected = 0, refunded = 0, attempts = 0, successes = 0;

  for (const o of orders) {
    const oid = o.id.split('/').pop();
    for (const t of o.transactions) {
      if (!inRange(t.createdAt)) continue;
      const amt = money(t.amountSet), k = dayKey(t.createdAt, tz);
      const isCharge = ['SALE', 'CAPTURE'].includes(t.kind);
      if (isCharge || t.kind === 'AUTHORIZATION') {
        attempts++;
        if (t.status === 'SUCCESS') successes++;
      }
      if (['FAILURE', 'ERROR'].includes(t.status)) {
        failed.push({ id: oid, order: o.name, date: t.createdAt, amount: amt, gateway: gatewayName(t.gateway), kind: t.kind, error: t.errorCode });
        continue;
      }
      if (t.status !== 'SUCCESS') continue;
      const g = gatewayName(t.gateway);
      gateways[g] ||= { name: g, collected: 0, refunded: 0, count: 0 };
      if (isCharge) { collected += amt; gateways[g].collected += amt; gateways[g].count++; if (daily[k]) daily[k].collected += amt; }
      if (t.kind === 'REFUND') { refunded += amt; gateways[g].refunded += amt; if (daily[k]) daily[k].refunded += amt; }
    }
    for (const r of o.refunds) if (inRange(r.createdAt))
      refunds.push({ id: oid, order: o.name, date: r.createdAt, amount: money(r.totalRefundedSet), note: r.note || null, orderTotal: money(o.totalPriceSet) });
    if (o.displayFinancialStatus === 'AUTHORIZED')
      awaiting.push({ id: oid, order: o.name, date: o.createdAt, amount: money(o.totalPriceSet) });
  }
  const byDate = (a, b) => b.date.localeCompare(a.date);
  return {
    range: { from, to },
    totals: {
      collected, refunded, net: collected - refunded,
      refundRate: collected ? (refunded / collected) * 100 : null,
      refundCount: refunds.length, failedCount: failed.length,
      successRate: attempts ? (successes / attempts) * 100 : null,
      awaitingCount, awaitingAmount: awaiting.reduce((s, a) => s + a.amount, 0),
    },
    daily: Object.entries(daily).map(([date, v]) => ({ date, ...v })),
    gateways: Object.values(gateways).sort((a, b) => b.collected - a.collected),
    refunds: refunds.sort(byDate), failed: failed.sort(byDate), awaiting: awaiting.sort(byDate),
    payouts,
  };
}

// ---- Customer journey ----
// ShopifyQL (needs read_reports). Returns rows as objects keyed by column name, or null if unavailable.
async function shopifyql(query) {
  try {
    const d = await gql(`query($q:String!){ shopifyqlQuery(query:$q){ tableData{ columns{ name } rows } parseErrors } }`, { q: query });
    const r = d.shopifyqlQuery;
    if (!r || r.parseErrors?.length || !r.tableData) return null;
    const cols = r.tableData.columns.map(c => c.name);
    const rows = typeof r.tableData.rows === 'string' ? JSON.parse(r.tableData.rows) : r.tableData.rows;
    return rows.map(row => Array.isArray(row) ? Object.fromEntries(cols.map((c, i) => [c, row[i]])) : row);
  } catch (e) { return null; }
}
const FUNNEL = 'sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout';
const funnelRow = (r) => r && ({
  visitors: +r.sessions || 0, addedToCart: +r.sessions_with_cart_additions || 0,
  checkoutStarted: +r.sessions_that_reached_checkout || 0, purchased: +r.sessions_that_completed_checkout || 0,
});

async function fetchJourneyOrders(from, to) {
  const build = (full) => `query($cursor:String,$q:String){ orders(first:100, after:$cursor, query:$q){
    pageInfo{ hasNextPage endCursor }
    nodes{ createdAt cancelledAt totalPriceSet{ shopMoney{ amount } }
      customerJourneySummary{ ready daysToConversion customerOrderIndex ${full ? 'momentsCount{ count }' : ''}
        firstVisit{ source sourceType landingPage referrerUrl utmParameters{ source medium campaign } }
        lastVisit{ source sourceType landingPage } } } } }`;
  const run = async (full) => {
    const all = []; let cursor = null;
    do {
      const d = await gql(build(full), { cursor, q: `created_at:>='${from}T00:00:00' AND created_at:<='${to}T23:59:59'` });
      all.push(...d.orders.nodes);
      cursor = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null;
    } while (cursor && all.length < 25000);
    return all;
  };
  try { return await run(true); } catch (e) { return run(false); }
}

async function fetchAbandonedList(from, to) {
  const withCustomer = hasScope('read_customers');
  try {
    const d = await gql(`query($q:String){ abandonedCheckouts(first:100, reverse:true, query:$q){ nodes{ id name createdAt
      totalPriceSet{ shopMoney{ amount } } abandonedCheckoutUrl ${withCustomer ? 'customer{ displayName }' : ''}
      lineItems(first:3){ nodes{ title quantity } } } } }`, { q: `created_at:>='${from}T00:00:00' AND created_at:<='${to}T23:59:59'` });
    return d.abandonedCheckouts.nodes.map(c => ({
      name: c.name, date: c.createdAt, value: money(c.totalPriceSet), customer: c.customer?.displayName || null,
      items: c.lineItems.nodes.map(li => `${li.quantity}× ${li.title}`),
      url: /^https:\/\//.test(c.abandonedCheckoutUrl || '') ? c.abandonedCheckoutUrl : null,
    }));
  } catch (e) { return null; }
}

async function buildJourney(from, to) {
  const range = `SINCE ${from} UNTIL ${to}`;
  const [total, daily, sources, devices, orders, abandoned] = await Promise.all([
    shopifyql(`FROM sessions SHOW ${FUNNEL} ${range}`),
    shopifyql(`FROM sessions SHOW ${FUNNEL} TIMESERIES day ${range}`),
    shopifyql(`FROM sessions SHOW sessions, sessions_that_completed_checkout GROUP BY referrer_source ${range} ORDER BY sessions DESC LIMIT 10`),
    shopifyql(`FROM sessions SHOW sessions, sessions_that_completed_checkout GROUP BY session_device_type ${range} ORDER BY sessions DESC`),
    fetchJourneyOrders(from, to),
    fetchAbandonedList(from, to),
  ]);

  // Order-based journey (works without analytics access)
  const valid = orders.filter(o => !o.cancelledAt && o.customerJourneySummary?.ready !== false && o.customerJourneySummary);
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
  const src = (v) => v?.utmParameters?.source || v?.source || host(v?.referrerUrl) || 'Direct';
  const buckets = [['Same day', 0, 0], ['1–3 days', 1, 3], ['4–7 days', 4, 7], ['8–30 days', 8, 30], ['30+ days', 31, Infinity]]
    .map(([label, lo, hi]) => ({ label, lo, hi, orders: 0, sales: 0 }));
  const first = {}, last = {}, landing = {};
  let newBuyers = 0, repeat = 0, daysSum = 0, daysN = 0, momentsSum = 0, momentsN = 0;
  for (const o of valid) {
    const j = o.customerJourneySummary, amt = money(o.totalPriceSet);
    if (j.daysToConversion != null) {
      daysSum += j.daysToConversion; daysN++;
      const b = buckets.find(b => j.daysToConversion >= b.lo && j.daysToConversion <= b.hi);
      if (b) { b.orders++; b.sales += amt; }
    }
    if (j.momentsCount?.count != null) { momentsSum += j.momentsCount.count; momentsN++; }
    if (j.customerOrderIndex === 1) newBuyers++; else if (j.customerOrderIndex > 1) repeat++;
    const add = (m, k) => { m[k] ||= { name: k, orders: 0, sales: 0 }; m[k].orders++; m[k].sales += amt; };
    add(first, src(j.firstVisit)); add(last, src(j.lastVisit || j.firstVisit));
    const lp = j.firstVisit?.landingPage;
    if (lp) { let path; try { path = new URL(lp).pathname; } catch { path = lp; } add(landing, path.slice(0, 80)); }
  }
  const top = (m, n = 8) => Object.values(m).sort((a, b) => b.orders - a.orders).slice(0, n);

  return {
    range: { from, to },
    analytics: !!total,
    funnel: funnelRow(total?.[0]),
    daily: daily ? daily.map(r => ({ date: String(r.day || r.date || '').slice(0, 10), ...funnelRow(r) })) : null,
    sources: sources ? sources.map(r => ({ name: r.referrer_source || 'Direct', visitors: +r.sessions || 0, purchases: +r.sessions_that_completed_checkout || 0 })) : null,
    devices: devices ? devices.map(r => ({ name: r.session_device_type || 'Other', visitors: +r.sessions || 0, purchases: +r.sessions_that_completed_checkout || 0 })) : null,
    orders: {
      total: valid.length, newBuyers, repeat,
      avgDaysToBuy: daysN ? daysSum / daysN : null, avgVisitsToBuy: momentsN ? momentsSum / momentsN : null,
      timeToBuy: buckets.map(({ label, orders, sales }) => ({ label, orders, sales })),
      firstTouch: top(first), lastTouch: top(last), landingPages: top(landing),
    },
    abandoned: abandoned && { count: abandoned.length, value: abandoned.reduce((s, a) => s + a.value, 0), list: abandoned.slice(0, 50) },
  };
}

// ---- Needs attention ----
const REQUIRED_SCOPES = ['read_orders', 'read_all_orders', 'read_products', 'read_customers', 'read_inventory', 'read_reports', 'read_shopify_payments_payouts', 'read_marketing_events'];
const ageDays = (iso) => Math.floor((Date.now() - new Date(iso)) / 864e5);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

async function attentionOrders(q, n = 50) {
  const d = await gql(`query($q:String){ orders(first:${n}, query:$q, sortKey:CREATED_AT){ nodes{ id name createdAt
    displayFinancialStatus displayFulfillmentStatus totalPriceSet{ shopMoney{ amount } }
    ${hasScope('read_customers') ? 'customer{ displayName }' : ''} } } }`, { q });
  return d.orders.nodes.map(o => ({
    kind: 'order', id: o.id.split('/').pop(), label: o.name, amount: money(o.totalPriceSet), age: ageDays(o.createdAt), date: o.createdAt,
    sub: [o.customer?.displayName, o.displayFinancialStatus?.toLowerCase().replace(/_/g, ' '), o.displayFulfillmentStatus?.toLowerCase().replace(/_/g, ' ')].filter(Boolean).join(' · '),
  }));
}
// Run one check; if Shopify refuses (missing scope etc.), mark it unavailable instead of failing the page
async function check(def, fn) {
  try { return { ...def, ...(await fn()) }; }
  catch (e) { return { ...def, count: 0, items: [], unavailable: e.message.slice(0, 160) }; }
}

async function buildAttention() {
  const s = auth.getSettings();
  const ship = s.shipWithinDays, low = s.lowStockThreshold;
  const inv = hasScope('read_inventory');

  const checks = await Promise.all([
    check({ key: 'overdue', severity: 'high', title: `Paid orders not shipped after ${ship}+ days`, action: 'Fulfil these orders in Shopify, or contact the customer about the delay.' }, async () => {
      const items = await attentionOrders(`status:open AND (fulfillment_status:unfulfilled OR fulfillment_status:partial) AND financial_status:paid AND created_at:<'${daysAgo(ship)}'`);
      return { count: items.length, items };
    }),
    check({ key: 'capture', severity: 'high', title: 'Payments authorised but not captured', action: 'Capture payment in Shopify. Authorisations usually expire after 7 days and the money is lost.' }, async () => {
      const items = (await attentionOrders('status:open AND financial_status:authorized')).map(i => ({ ...i, urgent: i.age >= 5, note: i.age >= 5 ? `expires in ~${Math.max(0, 7 - i.age)} day(s)` : null }));
      return { count: items.length, items, severity: items.some(i => i.urgent) ? 'high' : 'medium' };
    }),
    check({ key: 'risk', severity: 'high', title: 'High fraud-risk orders waiting to ship', action: 'Review the fraud analysis on each order in Shopify before fulfilling.' }, async () => {
      const items = await attentionOrders('status:open AND fulfillment_status:unfulfilled AND risk_level:high');
      return { count: items.length, items };
    }),
    check({ key: 'disputes', severity: 'high', title: 'Chargebacks needing a response', action: 'Submit evidence in Shopify Payments before the due date.' }, async () => {
      const d = await gql(`{ shopifyPaymentsAccount{ disputes(first:25, query:"status:needs_response"){ nodes{ id status evidenceDueBy
        amount{ amount } reasonDetails{ reason } order{ id name } } } } }`);
      const items = (d.shopifyPaymentsAccount?.disputes.nodes || []).map(x => ({
        kind: x.order ? 'order' : 'none', id: x.order?.id.split('/').pop(), label: x.order?.name || 'Dispute', amount: +x.amount.amount,
        sub: (x.reasonDetails?.reason || '').toLowerCase().replace(/_/g, ' '),
        note: x.evidenceDueBy ? `evidence due ${new Date(x.evidenceDueBy).toLocaleDateString('en-AU')}` : null, urgent: true,
      }));
      return { count: items.length, items };
    }),
    check({ key: 'failed', severity: 'medium', title: 'Failed payments not yet resolved (last 7 days)', action: 'Send the customer a payment link or check with the payment provider.' }, async () => {
      const orders = await fetchPaymentOrders(daysAgo(7), new Date().toISOString().slice(0, 10));
      const items = [];
      for (const o of orders) {
        if (['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(o.displayFinancialStatus)) continue; // customer retried successfully
        const f = o.transactions.find(t => ['FAILURE', 'ERROR'].includes(t.status) && ageDays(t.createdAt) <= 7);
        if (f) items.push({ kind: 'order', id: o.id.split('/').pop(), label: o.name, amount: money(f.amountSet), age: ageDays(f.createdAt),
          sub: `${gatewayName(f.gateway)} · ${(f.errorCode || 'failed').toLowerCase().replace(/_/g, ' ')}` });
      }
      return { count: items.length, items };
    }),
    check({ key: 'pending', severity: 'medium', title: 'Payment pending for 3+ days', action: 'Check whether the bank transfer or deferred payment has arrived, then mark as paid or follow up.' }, async () => {
      const items = await attentionOrders(`status:open AND financial_status:pending AND created_at:<'${daysAgo(3)}'`);
      return { count: items.length, items };
    }),
    check({ key: 'outofstock', severity: 'high', title: 'Active products out of stock', action: 'Reorder or restock, or set these to "continue selling" / hide them from the store.' }, async () => {
      if (!inv) throw new Error('Needs the read_inventory permission.');
      return stockItems('inventory_total:<=0');
    }),
    check({ key: 'lowstock', severity: 'medium', title: `Active products running low (under ${low})`, action: 'Reorder soon, starting with the fastest sellers.' }, async () => {
      if (!inv) throw new Error('Needs the read_inventory permission.');
      return stockItems(`inventory_total:>0 AND inventory_total:<${low}`);
    }),
    check({ key: 'abandoned', severity: 'low', title: 'Abandoned checkouts (last 7 days)', action: 'Send a recovery email or copy the checkout link to the shopper.' }, async () => {
      const list = await fetchAbandonedList(daysAgo(7), new Date().toISOString().slice(0, 10));
      if (!list) throw new Error('Abandoned checkouts are not available for this app.');
      const items = list.sort((a, b) => b.value - a.value).slice(0, 25).map(c => ({
        kind: 'checkout', label: c.name, amount: c.value, age: ageDays(c.date), url: c.url, sub: [c.customer, c.items.join(', ')].filter(Boolean).join(' · '),
      }));
      return { count: list.length, items };
    }),
  ]);

  const missing = REQUIRED_SCOPES.filter(sc => !hasScope(sc));
  checks.push({ key: 'scopes', severity: 'low', title: 'Shopify permissions missing', action: 'Add these to the app\'s access scopes in the Shopify Dev Dashboard, release a new version, and approve it in the store admin. Some dashboard sections stay empty until then.',
    count: missing.length, items: missing.map(sc => ({ kind: 'none', label: sc, sub: '' })) });

  const rank = { high: 0, medium: 1, low: 2 };
  checks.sort((a, b) => (b.count > 0) - (a.count > 0) || rank[a.severity] - rank[b.severity] || b.count - a.count);
  const open = checks.filter(c => c.count > 0 && c.key !== 'scopes');
  return {
    checks, generatedAt: new Date().toISOString(),
    summary: { high: open.filter(c => c.severity === 'high').reduce((s, c) => s + c.count, 0),
      medium: open.filter(c => c.severity === 'medium').reduce((s, c) => s + c.count, 0),
      low: open.filter(c => c.severity === 'low').reduce((s, c) => s + c.count, 0) },
  };
}

async function stockItems(filter) {
  const d = await gql(`{ products(first:50, sortKey:INVENTORY_TOTAL, query:"status:active AND ${filter}"){ nodes{ id title totalInventory tracksInventory } } }`);
  const sales = salesByProduct(await ordersInRange(daysAgo(29), new Date().toISOString().slice(0, 10)));
  const items = d.products.nodes.filter(p => p.tracksInventory).map(p => {
    const sold = sales[p.id]?.units || 0;
    const perDay = sold / 30;
    return {
      kind: 'product', id: p.id.split('/').pop(), label: p.title, stock: p.totalInventory, sold30: sold,
      sub: `${p.totalInventory <= 0 ? 'Out of stock' : p.totalInventory + ' left'} · ${sold} sold in last 30 days`,
      note: perDay > 0 && p.totalInventory > 0 ? `~${Math.max(1, Math.round(p.totalInventory / perDay))} days left` : null,
      urgent: sold > 0,
    };
  }).sort((a, b) => b.sold30 - a.sold30); // best sellers first: they cost the most when they run out
  return { count: items.length, items };
}

// ---- Data connections ----
async function buildConnections() {
  await getToken();
  const today = new Date().toISOString().slice(0, 10);
  const [shop, visitors, emailActs, subscribers, orders30] = await Promise.all([
    cached('shop', 3600e3, fetchShop).catch(() => null),
    shopifyql(`FROM sessions SHOW sessions SINCE ${daysAgo(6)} UNTIL ${today}`),
    gql(`{ marketingActivities(first:50, reverse:true){ nodes{ title status createdAt marketingChannelType } } }`)
      .then(d => d.marketingActivities.nodes.filter(a => a.marketingChannelType === 'EMAIL')).catch(() => null),
    hasScope('read_customers')
      ? gql(`{ customersCount(query:"email_subscription_status:SUBSCRIBED", limit:null){ count } }`).then(d => d.customersCount.count).catch(() => null)
      : null,
    ordersInRange(daysAgo(29), today).catch(() => []),
  ]);
  const expenses = auth.getExpenses();
  const monthlyCost = expenses.reduce((s, e) => s + (e.billing === 'yearly' ? e.monthly / 12 : e.monthly), 0);
  const sales30 = orders30.filter(o => !o.cancelledAt).reduce((s, o) => s + money(o.totalPriceSet), 0);
  return {
    shopify: { status: 'connected', shop: SHOP, name: shop?.name, apiVersion: API_VERSION, scopes: tokenScopes,
      missing: REQUIRED_SCOPES.filter(s => !hasScope(s)), tokenExpires: new Date(tokenExpires).toISOString() },
    visitors: { status: visitors ? 'connected' : 'setup needed', sessions7d: visitors ? +(visitors[0]?.sessions || 0) : null },
    email: {
      status: emailActs?.length || subscribers != null ? 'connected' : 'not connected',
      subscribers, campaigns: emailActs ? emailActs.slice(0, 10) : null,
      marketingScope: hasScope('read_marketing_events'), customersScope: hasScope('read_customers'),
    },
    whatsapp: { status: 'not connected' },
    expenses: { status: expenses.length ? 'connected' : 'not connected', items: expenses, monthlyCost, sales30,
      pctOfSales: sales30 ? (monthlyCost / sales30) * 100 : null },
    currency: shop?.currencyCode || 'AUD',
  };
}

// ---- HTTP server ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const PUBLIC_PATHS = new Set(['/login.html', '/api/login', '/api/setup', '/api/setup-status']);
const SECURE_COOKIE = process.env.COOKIE_SECURE === 'true';

class UserError extends Error {}
const send = (res, status, obj, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
};
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 1e5) { reject(new UserError('Request too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(new UserError('Invalid JSON')); } });
  });
}
function rangeParams(url) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    from: validDate(url.searchParams.get('from')) ? url.searchParams.get('from') : today.slice(0, 8) + '01',
    to: validDate(url.searchParams.get('to')) ? url.searchParams.get('to') : today,
    force: url.searchParams.get('refresh') === '1',
  };
}
// auth.js throws plain Errors for validation problems; surface those as 400s
const userCall = (fn) => { try { return fn(); } catch (e) { throw new UserError(e.message); } };
const cookieFor = (t) => auth.sessionCookie(t, SECURE_COOKIE, auth.getSettings().sessionHours * 3600);

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  try {
    // Block cross-site state-changing requests
    if (req.method !== 'GET' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
      return send(res, 403, { error: 'Cross-origin request blocked' });

    // ---- Public: first-run setup + login ----
    if (p === '/api/setup-status') return send(res, 200, { needsSetup: auth.getUsers().length === 0 });
    if (p === '/api/setup' && req.method === 'POST') {
      if (auth.getUsers().length) return send(res, 403, { error: 'Setup already completed.' });
      const b = await readBody(req);
      const u = userCall(() => auth.createUser({ ...b, role: 'admin' }));
      auth.audit(u.email, 'Created the admin account');
      return send(res, 200, { user: u }, { 'Set-Cookie': cookieFor(auth.createSession(u)) });
    }
    if (p === '/api/login' && req.method === 'POST') {
      const b = await readBody(req);
      const key = `${req.socket.remoteAddress}|${String(b.email || '').toLowerCase()}`;
      if (auth.tooManyAttempts(key)) return send(res, 429, { error: 'Too many failed attempts. Try again in 15 minutes.' });
      const u = auth.verify(b.email, b.password);
      if (!u) {
        auth.recordFailure(key);
        if (auth.tooManyAttempts(key)) auth.audit(null, 'Sign-in locked after repeated failures', `${String(b.email || '').slice(0, 80)} from ${req.socket.remoteAddress}`);
        return send(res, 401, { error: 'Incorrect email or password.' });
      }
      auth.attempts.delete(key);
      auth.audit(u.email, 'Signed in');
      return send(res, 200, { user: auth.publicUser(u) }, { 'Set-Cookie': cookieFor(auth.createSession(u)) });
    }

    // ---- Everything else requires a session ----
    const user = auth.getSessionUser(req);
    if (!user && !PUBLIC_PATHS.has(p)) {
      if (p.startsWith('/api/')) return send(res, 401, { error: 'Not signed in' });
      res.writeHead(302, { Location: '/login.html' }); return res.end();
    }
    const isAdmin = () => {
      if (user.role === 'admin') return true;
      send(res, 403, { error: 'Only admins can do this.' }); return false;
    };

    if (p === '/api/logout' && req.method === 'POST') {
      auth.sessions.delete(user.token);
      return send(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie('', SECURE_COOKIE, 0) });
    }
    if (p === '/api/me') return send(res, 200, { user: { email: user.email, name: user.name, role: user.role }, settings: auth.getSettings() });

    if (p === '/api/overview') {
      const { from, to, force } = rangeParams(url);
      const key = `ov:${from}:${to}`;
      if (force) cache.delete(key);
      return send(res, 200, await cached(key, 60e3, () => buildOverview(from, to)));
    }
    if (p === '/api/marketing') {
      const { from, to, force } = rangeParams(url);
      return send(res, 200, await cached(`mk:${from}:${to}`, force ? 0 : 60e3, () => buildMarketing(from, to)));
    }
    if (p === '/api/reports') {
      const y = parseInt(url.searchParams.get('year'), 10);
      const year = y >= 2000 && y <= 2100 ? y : new Date().getFullYear();
      return send(res, 200, await cached(`rp:${year}`, url.searchParams.get('refresh') === '1' ? 0 : 300e3, () => buildReports(year)));
    }

    // ---- Orders ----
    if (p === '/api/orders') {
      const { from, to } = rangeParams(url);
      const g = (k) => url.searchParams.get(k);
      return send(res, 200, await listOrders({ from, to, q: g('q'), payment: g('payment'), fulfilment: g('fulfilment'), status: g('status'), sort: g('sort'), after: g('after') }));
    }
    if (p === '/api/orders/stats') {
      const { from, to, force } = rangeParams(url);
      return send(res, 200, await cached(`os:${from}:${to}`, force ? 0 : 60e3, () => orderStats(from, to)));
    }
    const om = p.match(/^\/api\/orders\/(\d+)$/);
    if (om) {
      const o = await orderDetail(om[1]);
      return o ? send(res, 200, o) : send(res, 404, { error: 'Order not found' });
    }

    // ---- Needs attention ----
    if (p === '/api/attention') {
      await getToken();
      return send(res, 200, await cached('attention', url.searchParams.get('refresh') === '1' ? 0 : 120e3, buildAttention));
    }

    // ---- Customer journey ----
    if (p === '/api/journey') {
      const { from, to, force } = rangeParams(url);
      return send(res, 200, await cached(`jr:${from}:${to}`, force ? 0 : 120e3, () => buildJourney(from, to)));
    }

    // ---- Payments ----
    if (p === '/api/payments') {
      const { from, to, force } = rangeParams(url);
      return send(res, 200, await cached(`pay:${from}:${to}`, force ? 0 : 60e3, () => buildPayments(from, to)));
    }

    // ---- Products ----
    if (p === '/api/products') {
      await getToken();
      const { from, to } = rangeParams(url);
      const g = (k) => url.searchParams.get(k);
      return send(res, 200, await listProducts({ from, to, q: g('q'), status: g('status'), stock: g('stock'), sort: g('sort'), after: g('after') }));
    }
    if (p === '/api/products/stats') {
      await getToken();
      const { from, to, force } = rangeParams(url);
      return send(res, 200, await cached(`ps:${from}:${to}`, force ? 0 : 120e3, () => productStats(from, to)));
    }
    const pm = p.match(/^\/api\/products\/(\d+)$/);
    if (pm) {
      await getToken();
      const { from, to } = rangeParams(url);
      const d = await productDetail(pm[1], from, to);
      return d ? send(res, 200, d) : send(res, 404, { error: 'Product not found' });
    }

    // ---- Customers ----
    if (p.startsWith('/api/customers')) {
      await getToken();
      if (!hasScope('read_customers')) return send(res, 200, { scopeMissing: true });
      if (p === '/api/customers') {
        const after = url.searchParams.get('after') || null;
        return send(res, 200, await listCustomers({ q: url.searchParams.get('q'), sort: url.searchParams.get('sort'), after }));
      }
      if (p === '/api/customers/stats') {
        const { from, to, force } = rangeParams(url);
        return send(res, 200, await cached(`cs:${from}:${to}`, force ? 0 : 120e3, () => customerStats(from, to)));
      }
      const cm = p.match(/^\/api\/customers\/(\d+)$/);
      if (cm) {
        const c = await customerDetail(cm[1]);
        return c ? send(res, 200, c) : send(res, 404, { error: 'Customer not found' });
      }
    }

    // ---- Settings ----
    if (p === '/api/settings' && req.method === 'GET') {
      let conn;
      try {
        await getToken();
        conn = { ok: true, shop: SHOP, apiVersion: API_VERSION, scopes: tokenScopes, tokenExpires: new Date(tokenExpires).toISOString() };
      } catch (e) { conn = { ok: false, shop: SHOP, apiVersion: API_VERSION, error: e.message }; }
      const shop = conn.ok ? await cached('shop', 3600e3, fetchShop).catch(() => null) : null;
      return send(res, 200, { settings: auth.getSettings(), connection: { ...conn, name: shop?.name, currency: shop?.currencyCode, timezone: shop?.ianaTimezone } });
    }
    if (p === '/api/settings' && req.method === 'PUT') {
      if (!isAdmin()) return;
      const before = auth.getSettings();
      const s = auth.saveSettings(await readBody(req));
      const changed = Object.keys(s).filter(k => s[k] !== before[k]).map(k => `${k}: ${before[k]} → ${s[k]}`);
      if (changed.length) auth.audit(user.email, 'Changed preferences', changed.join(', '));
      cache.delete('lowstock'); cache.delete('attention');
      return send(res, 200, { settings: s });
    }
    if (p === '/api/cache/clear' && req.method === 'POST') {
      if (!isAdmin()) return;
      cache.clear(); token = null;
      auth.audit(user.email, 'Reconnected to Shopify and cleared cache');
      return send(res, 200, { ok: true });
    }
    if (p === '/api/password' && req.method === 'POST') {
      const b = await readBody(req);
      userCall(() => auth.changePassword(user.email, b.current, b.next));
      auth.audit(user.email, 'Changed own password');
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookieFor(auth.createSession(user)) });
    }

    // ---- Data connections & app expenses ----
    if (p === '/api/connections') {
      return send(res, 200, await cached('connections', url.searchParams.get('refresh') === '1' ? 0 : 600e3, buildConnections));
    }
    if (p === '/api/expenses' && req.method === 'POST') {
      if (!isAdmin()) return;
      const b = await readBody(req);
      const e = userCall(() => auth.addExpense(b));
      cache.delete('connections');
      auth.audit(user.email, 'Added app expense', `${e.name} (${e.monthly} ${e.billing})`);
      return send(res, 200, { expense: e });
    }
    const em = p.match(/^\/api\/expenses\/([a-f0-9]{12})$/);
    if (em && req.method === 'DELETE') {
      if (!isAdmin()) return;
      const e = userCall(() => auth.deleteExpense(em[1]));
      cache.delete('connections');
      auth.audit(user.email, 'Removed app expense', e.name);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/audit') {
      if (!isAdmin()) return;
      return send(res, 200, { entries: auth.getAudit(200) });
    }

    // ---- Users (admin only) ----
    if (p === '/api/users') {
      if (!isAdmin()) return;
      if (req.method === 'GET') return send(res, 200, { users: auth.getUsers().map(auth.publicUser) });
      if (req.method === 'POST') {
        const b = await readBody(req);
        const u = userCall(() => auth.createUser(b));
        auth.audit(user.email, 'Added team member', `${u.email} as ${u.role}`);
        return send(res, 200, { user: u });
      }
    }
    const rm = p.match(/^\/api\/users\/(.+)\/password$/);
    if (rm && req.method === 'POST') {
      if (!isAdmin()) return;
      const email = decodeURIComponent(rm[1]).toLowerCase();
      if (email === user.email) return send(res, 400, { error: 'Use "Change your password" for your own account.' });
      const b = await readBody(req);
      userCall(() => auth.resetPassword(email, b.password));
      auth.audit(user.email, 'Reset password', email);
      return send(res, 200, { ok: true });
    }
    const um = p.match(/^\/api\/users\/(.+)$/);
    if (um) {
      if (!isAdmin()) return;
      const email = decodeURIComponent(um[1]).toLowerCase();
      if (req.method === 'DELETE') {
        userCall(() => auth.deleteUser(email, user.email));
        auth.audit(user.email, 'Removed team member', email);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'PUT') {
        const b = await readBody(req);
        const u = userCall(() => auth.setRole(email, b.role, user.email));
        auth.audit(user.email, 'Changed role', `${email} → ${u.role}`);
        return send(res, 200, { user: u });
      }
    }
    if (p.startsWith('/api/')) return send(res, 404, { error: 'Not found' });

    // ---- Static files ----
    const pub = path.join(__dirname, 'public');
    const file = path.join(pub, p === '/' ? 'index.html' : path.normalize(p));
    if (!file.startsWith(pub + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    if (p === '/login.html' && user) { res.writeHead(302, { Location: '/' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (e instanceof UserError) return send(res, 400, { error: e.message });
    console.error(e);
    send(res, 500, { error: e.message });
  }
}).listen(PORT, () => console.log(`PixMagic Insights running at http://localhost:${PORT}`));
