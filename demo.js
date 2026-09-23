// Static demo mode: when window.DEMO is true, every /api/* request is answered in the browser
// with deterministic sample data for a fictional Australian store. Nothing reaches the network.
(function () {
  if (!window.DEMO) return;

  // ---------- Seeded PRNG ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  let rnd = mulberry32(20240613);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const round2 = (n) => Math.round(n * 100) / 100;
  const weighted = (pairs) => { let t = pairs.reduce((s, p) => s + p[1], 0), r = rnd() * t; for (const [v, w] of pairs) { if ((r -= w) < 0) return v; } return pairs[0][0]; };

  const TZ = 'Australia/Melbourne';
  const DAY = 864e5;
  const ymd = (d) => d.toISOString().slice(0, 10);
  const today = ymd(new Date());
  const addDays = (s, n) => ymd(new Date(new Date(s + 'T00:00:00Z').getTime() + n * DAY));
  const ageDays = (iso) => Math.floor((Date.now() - new Date(iso)) / DAY);
  const daysAgo = (n) => addDays(today, -n);
  const pct = (a, b) => (b ? ((a - b) / b) * 100 : null);

  // ---------- Catalogue ----------
  const PRODUCTS = [
    ['Custom Pet Portrait Canvas', 'Canvas prints', 89, 149, ['Small 30x40cm', 'Medium 50x70cm', 'Large 70x100cm'], 9],
    ['Family Photo Canvas', 'Canvas prints', 79, 139, ['Small 30x40cm', 'Medium 50x70cm', 'Large 70x100cm'], 7],
    ['Personalised Star Map Print', 'Posters', 49, 69, ['A3', 'A2'], 6],
    ['Framed Wedding Photo Print', 'Framed prints', 99, 179, ['Oak frame', 'Black frame', 'White frame'], 5],
    ['Photo Collage Poster', 'Posters', 39, 59, ['A3', 'A2'], 5],
    ['Custom Photo Mug', 'Gifts', 29, 29, ['Default Title'], 6],
    ['Acrylic Photo Block', 'Gifts', 59, 89, ['Small', 'Large'], 4],
    ['Metal Wall Art Print', 'Metal prints', 119, 219, ['40x60cm', '60x90cm'], 3],
    ['Hardcover Photo Book', 'Photo books', 69, 99, ['20 pages', '40 pages'], 4],
    ['Custom Jigsaw Puzzle', 'Gifts', 45, 45, ['500 pieces'], 3],
    ['Baby Milestone Canvas', 'Canvas prints', 79, 119, ['Small 30x40cm', 'Medium 50x70cm'], 3],
    ['Photo Cushion Cover', 'Gifts', 39, 39, ['Default Title'], 2],
    ['Aussie Beach Landscape Print', 'Posters', 35, 55, ['A3', 'A2'], 2],
    ['Gift Card', 'Gift cards', 50, 200, ['$50', '$100', '$200'], 2],
    ['Custom Photo Calendar 2027', 'Gifts', 34, 34, ['Default Title'], 1.5],
    ['Canvas Hanging Kit', 'Accessories', 12, 12, ['Default Title'], 1],
    ['Retro Polaroid Print Set', 'Posters', 25, 25, ['Set of 24'], 0], // not selling
    ['Floating Frame (Draft)', 'Framed prints', 129, 129, ['Default Title'], 0],
  ].map(([title, type, min, max, variants, w], i) => ({
    id: String(8100000000 + i * 137), title, type, vendor: 'PixMagic', min, max, variantNames: variants, weight: w,
    status: i === 17 ? 'DRAFT' : 'ACTIVE', createdAt: new Date(Date.now() - (700 - i * 23) * DAY).toISOString(),
  }));
  // Deterministic stock levels: a few out / low to make "Needs attention" interesting
  const STOCK = [42, 35, null, 3, 60, 0, 12, 2, 28, null, 4, 0, 80, null, 25, 150, 40, 10];
  PRODUCTS.forEach((p, i) => {
    p.stock = STOCK[i];
    p.variants = p.variantNames.map((v, j) => {
      const price = p.variantNames.length === 1 ? p.min : round2(p.min + (p.max - p.min) * (j / (p.variantNames.length - 1)));
      const stock = p.stock == null ? null : Math.floor(p.stock / p.variantNames.length) + (j === 0 ? p.stock % p.variantNames.length : 0);
      return { title: v, sku: `PM-${String(i + 1).padStart(3, '0')}-${j + 1}`, price, compareAt: j === 0 && i % 4 === 0 ? round2(price * 1.25) : null, stock };
    });
  });
  const sellable = PRODUCTS.filter(p => p.weight > 0);

  // ---------- Customers ----------
  const FIRST = ['Olivia', 'Charlotte', 'Amelia', 'Isla', 'Mia', 'Ava', 'Grace', 'Chloe', 'Sophie', 'Ruby', 'Zoe', 'Matilda', 'Harper', 'Evie', 'Lily',
    'Oliver', 'Jack', 'Noah', 'William', 'Leo', 'Henry', 'Thomas', 'Lachlan', 'Cooper', 'Hudson', 'Liam', 'Ethan', 'Mason', 'Archie', 'Harrison',
    'Priya', 'Wei', 'Aisha', 'Mei', 'Arjun', 'Hannah', 'Jessica', 'Emily', 'Sarah', 'Daniel', 'Josh', 'Sam', 'Kate', 'Tahlia', 'Brodie'];
  const LAST = ['Smith', 'Jones', 'Williams', 'Brown', 'Wilson', 'Taylor', 'Johnson', 'White', 'Martin', 'Anderson', 'Thompson', 'Nguyen', 'Thomas', 'Walker',
    'Harris', 'Lee', 'Ryan', 'Robinson', 'Kelly', 'King', 'Davis', 'Wright', 'Evans', 'Roberts', 'Green', 'Hall', 'Wood', 'Jackson', 'Clarke', 'Patel',
    'Chen', 'Wang', 'Singh', 'Murphy', 'O\'Brien', 'Campbell', 'Mitchell', 'Hughes', 'McDonald', 'Kennedy'];
  const CITIES = [['Melbourne', 'VIC', 24], ['Sydney', 'NSW', 26], ['Brisbane', 'QLD', 14], ['Perth', 'WA', 9], ['Adelaide', 'SA', 7], ['Gold Coast', 'QLD', 4],
    ['Geelong', 'VIC', 3], ['Newcastle', 'NSW', 3], ['Canberra', 'ACT', 3], ['Hobart', 'TAS', 2], ['Sunshine Coast', 'QLD', 2], ['Wollongong', 'NSW', 2],
    ['Ballarat', 'VIC', 1], ['Bendigo', 'VIC', 1], ['Townsville', 'QLD', 1], ['Cairns', 'QLD', 1], ['Darwin', 'NT', 1], ['Launceston', 'TAS', 1]];
  const DOMAINS = ['gmail.com', 'outlook.com', 'bigpond.com', 'icloud.com', 'yahoo.com.au', 'hotmail.com', 'optusnet.com.au'];
  const START = `${new Date().getFullYear() - 2}-01-01`;
  const startMs = new Date(START + 'T00:00:00Z').getTime();
  const spanDays = Math.round((Date.now() - startMs) / DAY);

  const CUSTOMERS = [];
  for (let i = 0; i < 6000; i++) {
    const first = pick(FIRST), last = pick(LAST), city = weighted(CITIES.map(c => [c, c[2]]));
    const created = new Date(startMs - int(0, 200) * DAY + Math.pow(rnd(), 0.8) * spanDays * DAY);
    CUSTOMERS.push({
      id: String(6200000000 + i * 71), name: `${first} ${last}`,
      email: `${first}.${last}${int(1, 99)}`.toLowerCase().replace(/'/g, '') + '@' + pick(DOMAINS),
      phone: rnd() < 0.7 ? `+61 4${int(10, 99)} ${int(100, 999)} ${int(100, 999)}` : null,
      city: city[0], province: city[1], createdAt: created.toISOString(),
      subscribed: rnd() < 0.55, tags: rnd() < 0.12 ? ['VIP'] : rnd() < 0.1 ? ['wholesale'] : [],
      loyal: rnd() < 0.08, orders: [],
    });
  }
  CUSTOMERS.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // ---------- Orders ----------
  const SOURCES = [['google', 34], ['instagram', 18], ['facebook', 16], ['Direct', 14], ['klaviyo', 8], ['tiktok', 5], ['pinterest', 3], ['bing', 2]];
  const CAMPAIGNS = { google: 'google-shopping-au', instagram: 'ig-pet-portraits', facebook: 'fb-mothers-day', klaviyo: 'newsletter-weekly', tiktok: 'tt-ugc-canvas' };
  const LANDING = ['/', '/products/custom-pet-portrait-canvas', '/collections/canvas-prints', '/products/personalised-star-map-print', '/collections/gifts', '/pages/sale', '/products/family-photo-canvas'];
  const CODES = [['WELCOME10', 0.10], ['PETLOVE15', 0.15], ['EOFY20', 0.20], ['FREESHIP', 0], ['VIP25', 0.25]];
  const GATEWAYS = [['Shopify Payments', 70], ['PayPal', 14], ['Afterpay', 12], ['Gift card', 2], ['Manual', 2]];
  const SEASON = [0.85, 0.8, 0.9, 0.95, 1.25, 1.05, 1.0, 0.95, 1.0, 1.1, 1.45, 1.9]; // Mother's Day (May), Black Friday, Christmas
  const DOW = [0.9, 1.05, 1.0, 1.0, 1.05, 1.0, 0.95];

  const ORDERS = [];
  let orderNo = 1001, nElig = 0;
  const loyal = [];
  for (let d = 0; d <= spanDays; d++) {
    const day = addDays(START, d);
    const dt = new Date(day + 'T00:00:00Z');
    const growth = 0.55 + 0.9 * (d / spanDays);
    let lambda = 11 * growth * SEASON[dt.getUTCMonth()] * DOW[dt.getUTCDay()];
    if (day === today) lambda *= Math.min(1, (new Date().getHours() + 1) / 24);
    const n = Math.max(0, Math.round(lambda + (rnd() - 0.5) * lambda * 0.7));
    while (nElig < CUSTOMERS.length && CUSTOMERS[nElig].createdAt.slice(0, 10) <= day) { if (CUSTOMERS[nElig].loyal) loyal.push(CUSTOMERS[nElig]); nElig++; }
    const eligible = CUSTOMERS.slice(0, nElig);
    for (let k = 0; k < n; k++) {
      const hour = weighted([[7, 2], [8, 3], [9, 4], [10, 5], [11, 5], [12, 6], [13, 6], [14, 5], [15, 5], [16, 5], [17, 5], [18, 6], [19, 8], [20, 9], [21, 8], [22, 5], [23, 2], [0, 1], [6, 1]]);
      const created = new Date(`${day}T${String(hour).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}+10:00`);
      if (created > new Date()) continue;
      let cust = null;
      if (eligible.length && rnd() < 0.95) {
        cust = rnd() < 0.2 && loyal.length ? pick(loyal) : eligible[Math.floor(Math.pow(rnd(), 0.5) * eligible.length)];
      }
      const lines = [];
      const nLines = weighted([[1, 70], [2, 22], [3, 8]]);
      for (let l = 0; l < nLines; l++) {
        const p = weighted(sellable.map(x => [x, x.weight]));
        const v = pick(p.variants), qty = weighted([[1, 85], [2, 12], [3, 3]]);
        if (lines.some(x => x.product === p)) continue;
        lines.push({ product: p, title: p.title, variant: v.title, sku: v.sku, qty, unit: v.price, total: round2(v.price * qty) });
      }
      const subtotal = round2(lines.reduce((s, l) => s + l.total, 0));
      const code = rnd() < 0.18 ? pick(CODES) : null;
      const discount = code ? round2(subtotal * code[1]) : 0;
      const shipping = subtotal >= 99 || (code && code[0] === 'FREESHIP') ? 0 : 9.95;
      const total = round2(subtotal - discount + shipping);
      const tax = round2(total / 11);
      const age = (Date.now() - created) / DAY;
      const r = rnd();
      let payment = 'PAID', fulfilment = age > 3 ? 'FULFILLED' : age > 1 ? weighted([['FULFILLED', 6], ['UNFULFILLED', 3], ['PARTIALLY_FULFILLED', 1]]) : 'UNFULFILLED';
      let refunded = 0, cancelled = null;
      if (r < 0.03) { refunded = total; payment = 'REFUNDED'; }
      else if (r < 0.06) { refunded = round2(total * 0.3); payment = 'PARTIALLY_REFUNDED'; }
      else if (r < 0.075) { cancelled = new Date(created.getTime() + 3600e3).toISOString(); payment = 'VOIDED'; fulfilment = 'UNFULFILLED'; }
      else if (r < 0.085 && age < 10) { payment = 'PENDING'; fulfilment = 'UNFULFILLED'; }
      else if (r < 0.095 && age < 8) { payment = 'AUTHORIZED'; fulfilment = 'UNFULFILLED'; }
      if (payment === 'PAID' && age > 3 && age < 12 && rnd() < 0.04) fulfilment = 'UNFULFILLED'; // overdue to ship
      const src = weighted(SOURCES);
      const gateway = weighted(GATEWAYS);
      const o = {
        id: String(5500000000 + orderNo * 13), name: '#' + orderNo++, createdAt: created.toISOString(), day,
        cancelledAt: cancelled, payment, fulfilment, total, refunded, subtotal, discount, shipping, tax,
        code: code ? code[0] : null, customer: cust, lines, gateway,
        channel: weighted([['web', 92], ['pos', 5], ['shopify_draft_order', 3]]),
        src, campaign: CAMPAIGNS[src] && rnd() < 0.6 ? CAMPAIGNS[src] : null, landing: pick(LANDING),
        daysToConversion: weighted([[0, 45], [1, 12], [2, 8], [3, 6], [5, 8], [7, 5], [14, 7], [25, 4], [45, 5]]),
        visits: int(1, 7), failedAttempt: rnd() < 0.03, risk: rnd() < 0.01,
        shipTo: cust ? `${cust.city}, ${cust.province}, AU` : `${pick(CITIES)[0]}, AU`,
      };
      if (cust) { o.customerOrderIndex = cust.orders.length + 1; cust.orders.push(o); }
      ORDERS.push(o);
    }
  }
  ORDERS.reverse(); // newest first
  const ORDER_BY_ID = new Map(ORDERS.map(o => [o.id, o]));
  const CUST_BY_ID = new Map(CUSTOMERS.map(c => [c.id, c]));
  const PROD_BY_ID = new Map(PRODUCTS.map(p => [p.id, p]));

  // Abandoned checkouts: ~ 2.5x orders' worth of carts, deterministic by day
  const ABANDONED = [];
  for (let d = 0; d < 120; d++) {
    const day = daysAgo(d), n = int(3, 9);
    for (let k = 0; k < n; k++) {
      const p = pick(sellable), c = rnd() < 0.6 ? pick(CUSTOMERS) : null, qty = weighted([[1, 8], [2, 2]]);
      ABANDONED.push({ name: '#C' + (90000 + ABANDONED.length), date: new Date(new Date(day + 'T12:00:00+10:00').getTime() + int(-10, 10) * 3600e3).toISOString(),
        value: round2(p.min * qty + (p.min < 99 ? 9.95 : 0)), customer: c ? c.name : null, items: [`${qty}× ${p.title}`],
        url: `https://pixmagic.com.au/checkouts/demo${90000 + ABANDONED.length}/recover` });
    }
  }

  // ---------- In-memory state for write actions ----------
  const DEMO_USER = { email: 'demo@pixmagic.com.au', name: 'Demo Admin', role: 'admin', createdAt: new Date(Date.now() - 200 * DAY).toISOString() };
  let settings = { refreshSeconds: 60, lowStockThreshold: 5, shipWithinDays: 2, defaultPeriod: 'month', compareByDefault: true, sessionHours: 12 };
  let users = [DEMO_USER,
    { email: 'jess@pixmagic.com.au', name: 'Jess Nguyen', role: 'admin', createdAt: new Date(Date.now() - 150 * DAY).toISOString() },
    { email: 'sam@pixmagic.com.au', name: 'Sam Walker', role: 'viewer', createdAt: new Date(Date.now() - 60 * DAY).toISOString() }];
  let expenses = [
    ['Klaviyo', 'Email', 75, 'monthly'], ['Judge.me Reviews', 'App', 15, 'monthly'], ['Printful Integration', 'Fulfilment', 0, 'monthly'],
    ['Shopify Plan (Grow)', 'Platform', 1260, 'yearly'], ['Canva Pro', 'Design', 20, 'monthly'], ['Google Workspace', 'Email', 21.6, 'monthly'],
  ].map(([name, category, monthly, billing], i) => ({ id: (0xa1b2c3d4e500 + i).toString(16), name, category, monthly, billing, addedAt: new Date(Date.now() - (90 - i * 7) * DAY).toISOString() }));
  let audit = [
    [2, 'Signed in', ''], [5, 'Changed preferences', 'lowStockThreshold: 3 → 5'], [26, 'Added app expense', 'Canva Pro (20 monthly)'],
    [50, 'Added team member', 'sam@pixmagic.com.au as viewer'], [75, 'Reconnected to Shopify and cleared cache', ''], [140, 'Added team member', 'jess@pixmagic.com.au as admin'],
  ].map(([h, action, detail]) => ({ at: new Date(Date.now() - h * 3600e3).toISOString(), actor: DEMO_USER.email, action, detail }));
  const log = (action, detail = '') => audit.unshift({ at: new Date().toISOString(), actor: DEMO_USER.email, action, detail: String(detail) });

  const SCOPES = ['read_orders', 'read_all_orders', 'read_products', 'read_customers', 'read_inventory', 'read_reports', 'read_shopify_payments_payouts', 'read_marketing_events'];
  const SHOP = { name: 'PixMagic (Demo)', currency: 'AUD', timezone: TZ, country: 'AU', domain: 'pixmagic-demo.myshopify.com' };

  // ---------- Helpers ----------
  const inRange = (o, from, to) => o.day >= from && o.day <= to;
  const ordersIn = (from, to) => ORDERS.filter(o => inRange(o, from, to));
  const valid = (list) => list.filter(o => !o.cancelledAt);
  const series = (from, n, byDay) => Array.from({ length: n }, (_, i) => { const d = addDays(from, i); return { date: d, value: round2(byDay[d] || 0) }; });
  const spanOf = (from, to) => Math.round((new Date(to) - new Date(from)) / DAY) + 1;
  const salesByProduct = (list) => {
    const m = {};
    for (const o of valid(list)) for (const l of o.lines) {
      const k = l.product.id; m[k] ||= { units: 0, revenue: 0, orders: 0 };
      m[k].units += l.qty; m[k].revenue += l.total; m[k].orders++;
    }
    return m;
  };
  function summarise(list) {
    const v = valid(list);
    const sales = v.reduce((s, o) => s + o.total - o.refunded, 0);
    const byDay = {};
    for (const o of v) byDay[o.day] = (byDay[o.day] || 0) + o.total;
    const custs = new Set(v.filter(o => o.customer).map(o => o.customer));
    const returning = [...custs].filter(c => c.orders.length > 1).length;
    return { sales, orders: v.length, aov: v.length ? sales / v.length : 0, byDay, customers: custs.size || null, returning, returningPct: custs.size ? returning / custs.size * 100 : null };
  }
  const stockState = (s) => s == null ? null : s <= 0 ? 'out' : s < settings.lowStockThreshold ? 'low' : 'ok';
  const cursorPage = (rows, after, size = 50) => {
    const start = after ? parseInt(after, 10) || 0 : 0;
    return { page: rows.slice(start, start + size), nextCursor: start + size < rows.length ? String(start + size) : null };
  };
  const group = (list, keyFn) => {
    const m = {};
    for (const o of list) { const k = keyFn(o) || 'Unknown'; m[k] ||= { name: k, orders: 0, sales: 0 }; m[k].orders++; m[k].sales += o.total; }
    return Object.values(m).sort((a, b) => b.sales - a.sales);
  };
  const channelName = (c) => c === 'web' ? 'Online store' : c === 'pos' ? 'Point of sale' : c;
  // Visitor funnel derived from orders, deterministic per day
  const funnelDay = (day, purchased) => {
    const r = mulberry32(parseInt(day.replace(/-/g, ''), 10));
    const visitors = Math.round(purchased / (0.019 + r() * 0.012)) + 40;
    const checkoutStarted = Math.round(purchased * (1.9 + r() * 0.5));
    return { visitors, addedToCart: Math.round(checkoutStarted * (2.1 + r() * 0.5)), checkoutStarted, purchased };
  };
  const funnelRange = (from, to) => {
    const counts = {};
    for (const o of valid(ordersIn(from, to))) counts[o.day] = (counts[o.day] || 0) + 1;
    const daily = Array.from({ length: spanOf(from, to) }, (_, i) => { const d = addDays(from, i); return { date: d, ...funnelDay(d, counts[d] || 0) }; })
      .filter(x => x.date <= today);
    const total = daily.reduce((t, x) => ({ visitors: t.visitors + x.visitors, addedToCart: t.addedToCart + x.addedToCart, checkoutStarted: t.checkoutStarted + x.checkoutStarted, purchased: t.purchased + x.purchased }),
      { visitors: 0, addedToCart: 0, checkoutStarted: 0, purchased: 0 });
    return { total, daily };
  };
  const monthlyCost = () => expenses.reduce((s, e) => s + (e.billing === 'yearly' ? e.monthly / 12 : e.monthly), 0);
  const sales30 = () => valid(ordersIn(daysAgo(29), today)).reduce((s, o) => s + o.total, 0);
  const CAMPAIGN_LIST = [
    ['Spring Sale — 20% off canvas', 'EMAIL', 'ACTIVE', 6], ['New arrivals: metal prints', 'EMAIL', 'COMPLETED', 19], ['Father\'s Day gift guide', 'EMAIL', 'COMPLETED', 30],
    ['Pet portraits — Instagram', 'SOCIAL', 'ACTIVE', 41], ['Google Shopping — AU', 'SEARCH', 'ACTIVE', 88], ['EOFY clearance', 'EMAIL', 'COMPLETED', 90], ['Winter warmers bundle', 'EMAIL', 'COMPLETED', 110],
  ].map(([title, marketingChannelType, status, d]) => ({ title, status, createdAt: new Date(Date.now() - d * DAY).toISOString(), marketingChannelType, utmParameters: null }));

  // ---------- Endpoint builders ----------
  function overview(from, to) {
    const days = spanOf(from, to), pFrom = addDays(from, -days), pTo = addDays(from, -1);
    const cur = ordersIn(from, to), prev = ordersIn(pFrom, pTo);
    const c = summarise(cur), p = summarise(prev);
    const prod = {};
    for (const o of valid(cur)) for (const l of o.lines) {
      prod[l.product.id] ||= { title: l.title, units: 0, revenue: 0, image: null };
      prod[l.product.id].units += l.qty; prod[l.product.id].revenue += l.total;
    }
    const prodTotal = Object.values(prod).reduce((s, x) => s + x.revenue, 0);
    const failed = cur.filter(o => o.payment === 'VOIDED').length;
    const lowStock = PRODUCTS.filter(x => x.status === 'ACTIVE' && x.stock != null && x.stock < settings.lowStockThreshold).length;
    const abandoned = ABANDONED.filter(a => a.date.slice(0, 10) >= from && a.date.slice(0, 10) <= to).length;
    return {
      shop: SHOP, range: { from, to, prevFrom: pFrom, prevTo: pTo }, scopes: SCOPES,
      kpis: {
        sales: c.sales, salesChange: pct(c.sales, p.sales), aov: c.aov, aovChange: pct(c.aov, p.aov),
        orders: c.orders, ordersChange: pct(c.orders, p.orders), returningPct: c.returningPct,
        returningChange: c.returningPct != null && p.returningPct != null ? c.returningPct - p.returningPct : null,
      },
      trend: { current: series(from, days, c.byDay), previous: series(pFrom, days, p.byDay) },
      journey: funnelRange(from, to).total,
      recentOrders: cur.slice(0, 8).map(o => ({ id: o.id, name: o.name, customer: o.customer?.name || null, date: o.createdAt, payment: o.payment, fulfilment: o.fulfilment, total: o.total })),
      bestSellers: Object.values(prod).sort((a, b) => b.units - a.units).slice(0, 5).map(x => ({ ...x, share: prodTotal ? x.revenue / prodTotal * 100 : 0 })),
      payments: { total: cur.length, paid: cur.filter(o => ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'PARTIALLY_PAID'].includes(o.payment)).length, failed, refunded: cur.filter(o => o.refunded > 0).length },
      customers: { total: c.customers, new: c.customers ? c.customers - c.returning : null, returning: c.customers ? c.returning : null },
      attention: { lowStock, abandoned, failed },
      health: { shopify: 'connected', analytics: 'connected', email: 'connected', expenses: expenses.length ? 'connected' : 'not connected' },
      fetchedAt: new Date().toISOString(),
    };
  }

  function marketing(from, to) {
    const orders = valid(ordersIn(from, to));
    const discounted = orders.filter(o => o.code);
    const codes = {};
    for (const o of discounted) { codes[o.code] ||= { code: o.code, uses: 0, sales: 0, discount: 0 }; codes[o.code].uses++; codes[o.code].sales += o.total; codes[o.code].discount += o.discount; }
    return {
      range: { from, to },
      totals: { orders: orders.length, sales: orders.reduce((s, o) => s + o.total, 0), discountedOrders: discounted.length,
        discountTotal: orders.reduce((s, o) => s + o.discount, 0), abandoned: ABANDONED.filter(a => a.date.slice(0, 10) >= from && a.date.slice(0, 10) <= to).length },
      channels: group(orders, o => channelName(o.channel)),
      sources: group(orders, o => o.src),
      utmCampaigns: group(orders.filter(o => o.campaign), o => o.campaign),
      discountCodes: Object.values(codes).sort((a, b) => b.uses - a.uses),
      campaigns: CAMPAIGN_LIST,
    };
  }

  function reports(year) {
    const monthly = (y) => {
      const m = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, orders: 0, sales: 0, refunds: 0 }));
      for (const o of valid(ordersIn(`${y}-01-01`, `${y}-12-31`))) { const i = +o.day.slice(5, 7) - 1; m[i].orders++; m[i].sales += o.total; m[i].refunds += o.refunded; }
      return m;
    };
    const v = valid(ordersIn(`${year}-01-01`, `${year}-12-31`));
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => ({ day, orders: 0, sales: 0 }));
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: 0 }));
    for (const o of v) {
      const d = new Date(new Date(o.createdAt).toLocaleString('en-US', { timeZone: TZ }));
      dow[d.getDay()].orders++; dow[d.getDay()].sales += o.total; hours[d.getHours()].orders++;
    }
    const prod = {}, custs = {};
    for (const o of v) {
      for (const l of o.lines) { prod[l.product.id] ||= { title: l.title, units: 0, revenue: 0, orders: 0 }; prod[l.product.id].units += l.qty; prod[l.product.id].revenue += l.total; prod[l.product.id].orders++; }
      if (o.customer) { custs[o.customer.id] ||= { name: o.customer.name, orders: 0, sales: 0 }; custs[o.customer.id].orders++; custs[o.customer.id].sales += o.total; }
    }
    const statusCount = (f) => v.reduce((m, o) => (m[o[f]] = (m[o[f]] || 0) + 1, m), {});
    return {
      year, currency: 'AUD', monthly: monthly(year), monthlyPrev: monthly(year - 1), dayOfWeek: dow, hours,
      products: Object.values(prod).sort((a, b) => b.revenue - a.revenue),
      topCustomers: Object.values(custs).sort((a, b) => b.sales - a.sales).slice(0, 20),
      financialStatus: statusCount('payment'), fulfilmentStatus: statusCount('fulfilment'),
    };
  }

  function listOrders(q) {
    let rows = ordersIn(q.from, q.to);
    const pay = { paid: ['PAID'], pending: ['PENDING'], authorized: ['AUTHORIZED'], refunded: ['REFUNDED', 'PARTIALLY_REFUNDED'], voided: ['VOIDED'] }[q.payment];
    if (pay) rows = rows.filter(o => pay.includes(o.payment));
    const ful = { unfulfilled: ['UNFULFILLED'], partial: ['PARTIALLY_FULFILLED'], fulfilled: ['FULFILLED'] }[q.fulfilment];
    if (ful) rows = rows.filter(o => ful.includes(o.fulfilment));
    if (q.status === 'cancelled') rows = rows.filter(o => o.cancelledAt);
    if (q.status === 'open') rows = rows.filter(o => !o.cancelledAt && o.fulfilment !== 'FULFILLED');
    if (q.status === 'closed') rows = rows.filter(o => !o.cancelledAt && o.fulfilment === 'FULFILLED');
    const text = (q.q || '').trim().toLowerCase();
    if (text) rows = /^#?\d+$/.test(text) ? rows.filter(o => o.name.includes(text.replace('#', '')))
      : rows.filter(o => (o.customer?.name || '').toLowerCase().includes(text) || (o.customer?.email || '').includes(text) || o.lines.some(l => l.title.toLowerCase().includes(text)));
    if (q.sort === 'total') rows = [...rows].sort((a, b) => b.total - a.total);
    if (q.sort === 'number') rows = [...rows].sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
    const { page, nextCursor } = cursorPage(rows, q.after);
    return {
      orders: page.map(o => ({ id: o.id, name: o.name, date: o.createdAt, cancelled: !!o.cancelledAt, customer: o.customer?.name || null,
        payment: o.payment, fulfilment: o.fulfilment, channel: o.channel, items: o.lines.reduce((s, l) => s + l.qty, 0), total: o.total })),
      nextCursor,
    };
  }

  function orderStats(from, to) {
    const r = ordersIn(from, to);
    return {
      total: r.length, unfulfilled: r.filter(o => o.fulfilment === 'UNFULFILLED' && !o.cancelledAt).length,
      pending: r.filter(o => ['PENDING', 'AUTHORIZED'].includes(o.payment)).length,
      refunded: r.filter(o => ['REFUNDED', 'PARTIALLY_REFUNDED'].includes(o.payment)).length,
      cancelled: r.filter(o => o.cancelledAt).length,
      openUnfulfilled: ORDERS.filter(o => o.fulfilment === 'UNFULFILLED' && !o.cancelledAt).length,
    };
  }

  function orderDetail(id) {
    const o = ORDER_BY_ID.get(id); if (!o) return null;
    const txDate = new Date(new Date(o.createdAt).getTime() + 60e3).toISOString();
    const tx = [];
    if (o.failedAttempt) tx.push({ kind: 'SALE', status: 'FAILURE', gateway: o.gateway, date: o.createdAt, amount: o.total });
    if (o.payment === 'AUTHORIZED') tx.push({ kind: 'AUTHORIZATION', status: 'SUCCESS', gateway: o.gateway, date: txDate, amount: o.total });
    else if (o.payment !== 'PENDING') tx.push({ kind: 'SALE', status: 'SUCCESS', gateway: o.gateway, date: txDate, amount: o.total });
    if (o.payment === 'VOIDED') tx.push({ kind: 'VOID', status: 'SUCCESS', gateway: o.gateway, date: o.cancelledAt, amount: o.total });
    if (o.refunded) tx.push({ kind: 'REFUND', status: 'SUCCESS', gateway: o.gateway, date: new Date(new Date(o.createdAt).getTime() + 4 * DAY).toISOString(), amount: o.refunded });
    const shipped = o.fulfilment !== 'UNFULFILLED';
    return {
      id: o.id, name: o.name, createdAt: o.createdAt, cancelledAt: o.cancelledAt, cancelReason: o.cancelledAt ? 'CUSTOMER' : null,
      closedAt: o.fulfilment === 'FULFILLED' ? new Date(new Date(o.createdAt).getTime() + 2 * DAY).toISOString() : null,
      payment: o.payment, fulfilment: o.fulfilment, note: o.lines[0].product.type === 'Canvas prints' && o.total > 150 ? 'Please check photo resolution before printing.' : null,
      tags: o.code === 'VIP25' ? ['VIP'] : [], channel: o.channel, discountCodes: o.code ? [o.code] : [], currency: 'AUD',
      totals: { subtotal: o.subtotal, shipping: o.shipping, tax: o.tax, discounts: o.discount, total: o.total, refunded: o.refunded },
      customer: o.customer ? { id: o.customer.id, name: o.customer.name, orders: o.customer.orders.length } : null,
      shipTo: o.shipTo,
      items: o.lines.map(l => ({ title: l.title, variant: l.variant === 'Default Title' ? null : l.variant, qty: l.qty, sku: l.sku, image: null, unit: l.unit, total: l.total })),
      fulfillments: shipped ? [{ status: o.fulfilment === 'FULFILLED' ? 'Delivered' : 'In transit', date: new Date(new Date(o.createdAt).getTime() + DAY).toISOString(),
        tracking: [{ company: 'Australia Post', number: '33LPA' + o.id.slice(-8), url: null }] }] : [],
      transactions: tx,
    };
  }

  function productRow(p, sales) {
    const s = sales[p.id] || { units: 0, revenue: 0, orders: 0 };
    return { id: p.id, title: p.title, status: p.status, type: p.type, vendor: p.vendor, image: null, variants: p.variants.length,
      priceMin: p.min, priceMax: p.max, stock: p.stock, stockState: stockState(p.stock), ...s };
  }
  function listProducts(q) {
    const t = settings.lowStockThreshold;
    let rows = PRODUCTS.slice();
    if (['active', 'draft', 'archived'].includes(q.status)) rows = rows.filter(p => p.status === q.status.toUpperCase());
    if (q.stock === 'out') rows = rows.filter(p => p.stock != null && p.stock <= 0);
    if (q.stock === 'low') rows = rows.filter(p => p.stock != null && p.stock > 0 && p.stock < t);
    const text = (q.q || '').trim().toLowerCase();
    if (text) rows = rows.filter(p => (p.title + ' ' + p.type).toLowerCase().includes(text));
    if (q.sort === 'stock') rows.sort((a, b) => (a.stock ?? 1e9) - (b.stock ?? 1e9));
    else if (q.sort === 'newest' || q.sort === 'updated') rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    else rows.sort((a, b) => a.title.localeCompare(b.title));
    const sales = salesByProduct(ordersIn(q.from, q.to));
    const { page, nextCursor } = cursorPage(rows, q.after);
    return { inventory: true, lowStockThreshold: t, products: page.map(p => productRow(p, sales)), nextCursor };
  }
  function productStats(from, to) {
    const t = settings.lowStockThreshold, active = PRODUCTS.filter(p => p.status === 'ACTIVE');
    const rows = Object.values(salesByProduct(ordersIn(from, to)));
    return { inventory: true, lowStockThreshold: t, active: active.length, draft: PRODUCTS.filter(p => p.status === 'DRAFT').length,
      outOfStock: active.filter(p => p.stock != null && p.stock <= 0).length, lowStock: active.filter(p => p.stock != null && p.stock > 0 && p.stock < t).length,
      unitsSold: rows.reduce((s, r) => s + r.units, 0), productsSold: rows.length, notSelling: Math.max(0, active.length - rows.length) };
  }
  function productDetail(id, from, to) {
    const p = PROD_BY_ID.get(id); if (!p) return null;
    const since = daysAgo(89), byDay = {};
    for (const o of valid(ordersIn(since, today))) for (const l of o.lines) if (l.product === p) byDay[o.day] = (byDay[o.day] || 0) + l.qty;
    const daily = Array.from({ length: 90 }, (_, i) => { const d = addDays(since, i); return { date: d, units: byDay[d] || 0 }; });
    const units90 = daily.reduce((a, x) => a + x.units, 0);
    return {
      id, title: p.title, status: p.status, type: p.type, vendor: p.vendor, tags: [p.type.toLowerCase(), 'personalised'], createdAt: p.createdAt,
      url: null, image: null, inventory: true, stock: p.stock,
      sales: salesByProduct(ordersIn(from, to))[id] || { units: 0, revenue: 0, orders: 0 }, daily, units90,
      daysOfStock: p.stock != null && units90 > 0 ? Math.round(p.stock / (units90 / 90)) : null,
      variants: p.variants.map(v => ({ title: v.title, sku: v.sku, price: v.price, compareAt: v.compareAt, stock: v.stock,
        locations: v.stock == null ? [] : [{ name: 'Melbourne Warehouse', available: v.stock, committed: Math.min(2, v.stock), incoming: v.stock < 5 ? 20 : 0, on_hand: v.stock + Math.min(2, v.stock) }] })),
    };
  }

  function customerRow(c) {
    return { id: c.id, name: c.name, email: c.email, phone: c.phone, orders: c.orders.length, spent: round2(c.orders.filter(o => !o.cancelledAt).reduce((s, o) => s + o.total - o.refunded, 0)),
      createdAt: c.createdAt, tags: c.tags, state: 'ENABLED', location: `${c.city}, ${c.province}, AU` };
  }
  function listCustomers(q) {
    let rows = CUSTOMERS.slice();
    const text = (q.q || '').trim().toLowerCase();
    if (text) rows = rows.filter(c => (c.name + ' ' + c.email + ' ' + c.city).toLowerCase().includes(text));
    if (q.sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
    else if (q.sort === 'updated') rows.sort((a, b) => (b.orders[b.orders.length - 1]?.createdAt || b.createdAt).localeCompare(a.orders[a.orders.length - 1]?.createdAt || a.createdAt));
    else rows.reverse();
    const { page, nextCursor } = cursorPage(rows, q.after);
    return { customers: page.map(customerRow), nextCursor, contactAllowed: true };
  }
  function customerStats(from, to) {
    const withOrders = CUSTOMERS.filter(c => c.orders.length > 0).length;
    const returning = CUSTOMERS.filter(c => c.orders.length > 1).length;
    const since = daysAgo(365), spend = {};
    for (const o of valid(ordersIn(since, to))) if (o.customer) {
      const k = o.customer.id; spend[k] ||= { id: k, name: o.customer.name, orders: 0, spent: 0, last: o.createdAt };
      spend[k].orders++; spend[k].spent += o.total; if (o.createdAt > spend[k].last) spend[k].last = o.createdAt;
    }
    const buyers = Object.values(spend), totalSpent = buyers.reduce((s, b) => s + b.spent, 0);
    return {
      total: CUSTOMERS.length, newInRange: CUSTOMERS.filter(c => c.createdAt.slice(0, 10) >= from && c.createdAt.slice(0, 10) <= to).length,
      returning, withOrders, subscribed: CUSTOMERS.filter(c => c.subscribed).length,
      returningRate: withOrders ? returning / withOrders * 100 : null, avgSpend12m: buyers.length ? totalSpent / buyers.length : null,
      buyers12m: buyers.length, lapsed: buyers.filter(b => Date.now() - new Date(b.last) > 180 * DAY).length,
      topSpenders: buyers.sort((a, b) => b.spent - a.spent).slice(0, 10),
    };
  }
  function customerDetail(id) {
    const c = CUST_BY_ID.get(id); if (!c) return null;
    const orders = c.orders.slice().reverse().slice(0, 25).map(o => ({ name: o.name, date: o.createdAt, payment: o.payment, fulfilment: o.fulfilment, total: o.total,
      items: o.lines.slice(0, 5).map(l => `${l.qty}× ${l.title}`) }));
    return { ...customerRow(c), note: c.tags.includes('VIP') ? 'Repeat buyer — include a handwritten thank-you card.' : null, orderHistory: orders,
      avgOrder: orders.length ? orders.reduce((s, o) => s + o.total, 0) / orders.length : null,
      firstOrder: orders.at(-1)?.date || null, lastOrder: orders[0]?.date || null };
  }

  function payments(from, to) {
    const days = spanOf(from, to);
    const daily = Object.fromEntries(Array.from({ length: days }, (_, i) => [addDays(from, i), { collected: 0, refunded: 0 }]));
    const gateways = {}, failed = [], refunds = [], awaiting = [];
    let collected = 0, refunded = 0, attempts = 0, successes = 0;
    for (const o of ordersIn(from, to)) {
      const g = o.gateway;
      gateways[g] ||= { name: g, collected: 0, refunded: 0, count: 0 };
      if (o.failedAttempt) { attempts++; failed.push({ id: o.id, order: o.name, date: o.createdAt, amount: o.total, gateway: g, kind: 'SALE', error: pick(['CARD_DECLINED', 'INSUFFICIENT_FUNDS', 'EXPIRED_CARD', 'INCORRECT_CVC']) }); }
      if (o.payment === 'PENDING') continue;
      attempts++; successes++;
      if (o.payment === 'AUTHORIZED') { awaiting.push({ id: o.id, order: o.name, date: o.createdAt, amount: o.total }); continue; }
      collected += o.total; gateways[g].collected += o.total; gateways[g].count++; if (daily[o.day]) daily[o.day].collected += o.total;
      if (o.refunded) {
        const rd = new Date(new Date(o.createdAt).getTime() + 4 * DAY).toISOString(), rk = rd.slice(0, 10);
        if (rk <= to) {
          refunded += o.refunded; gateways[g].refunded += o.refunded; if (daily[rk]) daily[rk].refunded += o.refunded;
          refunds.push({ id: o.id, order: o.name, date: rd, amount: o.refunded, note: o.payment === 'REFUNDED' ? 'Damaged in transit' : 'Print colour not as expected — partial refund', orderTotal: o.total });
        }
      }
    }
    const byDate = (a, b) => b.date.localeCompare(a.date);
    const payouts = Array.from({ length: 10 }, (_, i) => {
      const d = daysAgo(i * 3 + 1), gross = valid(ordersIn(addDays(d, -3), addDays(d, -1))).filter(o => o.gateway === 'Shopify Payments').reduce((s, o) => s + o.total, 0);
      const fees = round2(gross * 0.0175 + 0.3 * 10);
      return { date: new Date(d + 'T09:00:00+10:00').toISOString(), status: i === 0 ? 'IN_TRANSIT' : 'PAID', net: round2(gross - fees), gross: round2(gross), fees };
    });
    return {
      range: { from, to },
      totals: { collected, refunded, net: collected - refunded, refundRate: collected ? refunded / collected * 100 : null, refundCount: refunds.length, failedCount: failed.length,
        successRate: attempts ? successes / attempts * 100 : null, awaitingCount: ORDERS.filter(o => o.payment === 'AUTHORIZED' && !o.cancelledAt).length,
        awaitingAmount: awaiting.reduce((s, a) => s + a.amount, 0) },
      daily: Object.entries(daily).map(([date, v]) => ({ date, ...v })),
      gateways: Object.values(gateways).filter(g => g.count || g.refunded).sort((a, b) => b.collected - a.collected),
      refunds: refunds.sort(byDate), failed: failed.sort(byDate), awaiting: awaiting.sort(byDate),
      payouts: { balance: 1843.27, payouts },
    };
  }

  function journey(from, to) {
    const { total, daily } = funnelRange(from, to);
    const r = mulberry32(parseInt(from.replace(/-/g, ''), 10) ^ parseInt(to.replace(/-/g, ''), 10));
    const srcShare = [['google', 0.38], ['Direct', 0.2], ['instagram', 0.15], ['facebook', 0.12], ['tiktok', 0.06], ['pinterest', 0.04], ['bing', 0.03], ['klaviyo', 0.02]];
    const devShare = [['mobile', 0.68], ['desktop', 0.27], ['tablet', 0.05]];
    const split = (arr, convAdj) => arr.map(([name, s], i) => {
      const visitors = Math.round(total.visitors * s * (0.9 + r() * 0.2));
      return { name, visitors, purchases: Math.round(total.purchased * s * convAdj[i % convAdj.length]) };
    });
    const orders = valid(ordersIn(from, to));
    const buckets = [['Same day', 0, 0], ['1–3 days', 1, 3], ['4–7 days', 4, 7], ['8–30 days', 8, 30], ['30+ days', 31, Infinity]].map(([label, lo, hi]) => ({ label, lo, hi, orders: 0, sales: 0 }));
    const first = {}, last = {}, landing = {};
    const add = (m, k, amt) => { m[k] ||= { name: k, orders: 0, sales: 0 }; m[k].orders++; m[k].sales += amt; };
    let newBuyers = 0, repeat = 0, daysSum = 0, visitsSum = 0;
    for (const o of orders) {
      const b = buckets.find(b => o.daysToConversion >= b.lo && o.daysToConversion <= b.hi); b.orders++; b.sales += o.total;
      daysSum += o.daysToConversion; visitsSum += o.visits;
      if (o.customerOrderIndex === 1) newBuyers++; else if (o.customerOrderIndex > 1) repeat++;
      add(first, o.src, o.total); add(last, o.visits > 2 && o.src !== 'klaviyo' && o.name.charCodeAt(o.name.length - 1) % 3 === 0 ? 'klaviyo' : o.src, o.total); add(landing, o.landing, o.total);
    }
    const top = (m, n = 8) => Object.values(m).sort((a, b) => b.orders - a.orders).slice(0, n);
    const ab = ABANDONED.filter(a => a.date.slice(0, 10) >= from && a.date.slice(0, 10) <= to);
    return {
      range: { from, to }, analytics: true, funnel: total, daily,
      sources: split(srcShare, [1.1, 1.3, 0.8, 0.9, 0.6, 0.7, 1.0, 2.5]).sort((a, b) => b.visitors - a.visitors),
      devices: split(devShare, [0.85, 1.4, 0.9]),
      orders: { total: orders.length, newBuyers, repeat, avgDaysToBuy: orders.length ? daysSum / orders.length : null, avgVisitsToBuy: orders.length ? visitsSum / orders.length : null,
        timeToBuy: buckets.map(({ label, orders, sales }) => ({ label, orders, sales })), firstTouch: top(first), lastTouch: top(last), landingPages: top(landing) },
      abandoned: { count: ab.length, value: ab.reduce((s, a) => s + a.value, 0), list: ab.slice(0, 50) },
    };
  }

  function attention() {
    const ship = settings.shipWithinDays, low = settings.lowStockThreshold;
    const oItem = (o) => ({ kind: 'order', id: o.id, label: o.name, amount: o.total, age: ageDays(o.createdAt), date: o.createdAt,
      sub: [o.customer?.name, o.payment.toLowerCase().replace(/_/g, ' '), o.fulfilment.toLowerCase().replace(/_/g, ' ')].filter(Boolean).join(' · ') });
    const open = ORDERS.filter(o => !o.cancelledAt);
    const sales30 = salesByProduct(ordersIn(daysAgo(29), today));
    const stockItems = (fn) => {
      const items = PRODUCTS.filter(p => p.status === 'ACTIVE' && p.stock != null && fn(p.stock)).map(p => {
        const sold = sales30[p.id]?.units || 0, perDay = sold / 30;
        return { kind: 'product', id: p.id, label: p.title, stock: p.stock, sold30: sold,
          sub: `${p.stock <= 0 ? 'Out of stock' : p.stock + ' left'} · ${sold} sold in last 30 days`,
          note: perDay > 0 && p.stock > 0 ? `~${Math.max(1, Math.round(p.stock / perDay))} days left` : null, urgent: sold > 0 };
      }).sort((a, b) => b.sold30 - a.sold30);
      return { count: items.length, items };
    };
    const list = (items) => ({ count: items.length, items });
    const capture = open.filter(o => o.payment === 'AUTHORIZED').map(oItem).map(i => ({ ...i, urgent: i.age >= 5, note: i.age >= 5 ? `expires in ~${Math.max(0, 7 - i.age)} day(s)` : null }));
    const abandoned = ABANDONED.filter(a => a.date.slice(0, 10) >= daysAgo(7));
    const checks = [
      { key: 'overdue', severity: 'high', title: `Paid orders not shipped after ${ship}+ days`, action: 'Fulfil these orders in Shopify, or contact the customer about the delay.',
        ...list(open.filter(o => o.payment === 'PAID' && ['UNFULFILLED', 'PARTIALLY_FULFILLED'].includes(o.fulfilment) && o.day < daysAgo(ship)).map(oItem)) },
      { key: 'capture', severity: capture.some(i => i.urgent) ? 'high' : 'medium', title: 'Payments authorised but not captured', action: 'Capture payment in Shopify. Authorisations usually expire after 7 days and the money is lost.', ...list(capture) },
      { key: 'risk', severity: 'high', title: 'High fraud-risk orders waiting to ship', action: 'Review the fraud analysis on each order in Shopify before fulfilling.',
        ...list(open.filter(o => o.risk && o.fulfilment === 'UNFULFILLED').map(oItem)) },
      { key: 'disputes', severity: 'high', title: 'Chargebacks needing a response', action: 'Submit evidence in Shopify Payments before the due date.',
        ...list(open.filter(o => o.payment === 'PAID' && o.day <= daysAgo(20)).slice(0, 1).map(o => ({ kind: 'order', id: o.id, label: o.name, amount: o.total, sub: 'product not received',
          note: `evidence due ${new Date(Date.now() + 5 * DAY).toLocaleDateString('en-AU')}`, urgent: true }))) },
      { key: 'failed', severity: 'medium', title: 'Failed payments not yet resolved (last 7 days)', action: 'Send the customer a payment link or check with the payment provider.',
        ...list(ORDERS.filter(o => o.failedAttempt && o.day >= daysAgo(7) && ['PENDING', 'VOIDED'].includes(o.payment)).map(o => ({ kind: 'order', id: o.id, label: o.name, amount: o.total, age: ageDays(o.createdAt), sub: `${o.gateway} · card declined` }))) },
      { key: 'pending', severity: 'medium', title: 'Payment pending for 3+ days', action: 'Check whether the bank transfer or deferred payment has arrived, then mark as paid or follow up.',
        ...list(open.filter(o => o.payment === 'PENDING' && o.day < daysAgo(3)).map(oItem)) },
      { key: 'outofstock', severity: 'high', title: 'Active products out of stock', action: 'Reorder or restock, or set these to "continue selling" / hide them from the store.', ...stockItems(s => s <= 0) },
      { key: 'lowstock', severity: 'medium', title: `Active products running low (under ${low})`, action: 'Reorder soon, starting with the fastest sellers.', ...stockItems(s => s > 0 && s < low) },
      { key: 'abandoned', severity: 'low', title: 'Abandoned checkouts (last 7 days)', action: 'Send a recovery email or copy the checkout link to the shopper.',
        count: abandoned.length, items: abandoned.slice().sort((a, b) => b.value - a.value).slice(0, 25).map(c => ({ kind: 'checkout', label: c.name, amount: c.value, age: ageDays(c.date), url: c.url,
          sub: [c.customer, c.items.join(', ')].filter(Boolean).join(' · ') })) },
      { key: 'scopes', severity: 'low', title: 'Shopify permissions missing', action: 'Add these to the app\'s access scopes in the Shopify Dev Dashboard, release a new version, and approve it in the store admin. Some dashboard sections stay empty until then.', count: 0, items: [] },
    ];
    const rank = { high: 0, medium: 1, low: 2 };
    checks.sort((a, b) => (b.count > 0) - (a.count > 0) || rank[a.severity] - rank[b.severity] || b.count - a.count);
    const openC = checks.filter(c => c.count > 0 && c.key !== 'scopes');
    const sum = (sev) => openC.filter(c => c.severity === sev).reduce((s, c) => s + c.count, 0);
    return { checks, generatedAt: new Date().toISOString(), summary: { high: sum('high'), medium: sum('medium'), low: sum('low') } };
  }

  function connections() {
    const mc = monthlyCost(), s30 = sales30();
    return {
      shopify: { status: 'connected', shop: SHOP.domain, name: SHOP.name, apiVersion: '2025-10', scopes: SCOPES, missing: [], tokenExpires: new Date(Date.now() + 20 * 3600e3).toISOString() },
      visitors: { status: 'connected', sessions7d: funnelRange(daysAgo(6), today).total.visitors },
      email: { status: 'connected', subscribers: CUSTOMERS.filter(c => c.subscribed).length, campaigns: CAMPAIGN_LIST.filter(c => c.marketingChannelType === 'EMAIL'), marketingScope: true, customersScope: true },
      whatsapp: { status: 'not connected' },
      expenses: { status: expenses.length ? 'connected' : 'not connected', items: expenses, monthlyCost: mc, sales30: s30, pctOfSales: s30 ? mc / s30 * 100 : null },
      currency: 'AUD',
    };
  }

  // ---------- Router ----------
  const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
  const needPw = (pw) => { if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, 'Password must be at least 10 characters.'); };

  function route(method, url, body) {
    const p = url.pathname.replace(/^.*?(\/api\/)/, '/api/');
    const g = (k) => url.searchParams.get(k);
    const from = validDate(g('from')) ? g('from') : today.slice(0, 8) + '01';
    const to = validDate(g('to')) ? g('to') : today;

    if (p === '/api/setup-status') return { needsSetup: false };
    if (p === '/api/login' || p === '/api/setup') return { user: DEMO_USER };
    if (p === '/api/logout') return { ok: true };
    if (p === '/api/me') return { user: { email: DEMO_USER.email, name: DEMO_USER.name, role: DEMO_USER.role }, settings };
    if (p === '/api/overview') return overview(from, to);
    if (p === '/api/marketing') return marketing(from, to);
    if (p === '/api/reports') { const y = parseInt(g('year'), 10); return reports(y >= 2000 && y <= 2100 ? y : new Date().getFullYear()); }
    if (p === '/api/orders') return listOrders({ from, to, q: g('q'), payment: g('payment'), fulfilment: g('fulfilment'), status: g('status'), sort: g('sort'), after: g('after') });
    if (p === '/api/orders/stats') return orderStats(from, to);
    let m = p.match(/^\/api\/orders\/(\d+)$/);
    if (m) { const o = orderDetail(m[1]); if (!o) throw new HttpError(404, 'Order not found'); return o; }
    if (p === '/api/attention') return attention();
    if (p === '/api/journey') return journey(from, to);
    if (p === '/api/payments') return payments(from, to);
    if (p === '/api/products') return listProducts({ from, to, q: g('q'), status: g('status'), stock: g('stock'), sort: g('sort'), after: g('after') });
    if (p === '/api/products/stats') return productStats(from, to);
    m = p.match(/^\/api\/products\/(\d+)$/);
    if (m) { const d = productDetail(m[1], from, to); if (!d) throw new HttpError(404, 'Product not found'); return d; }
    if (p === '/api/customers') return listCustomers({ q: g('q'), sort: g('sort'), after: g('after') });
    if (p === '/api/customers/stats') return customerStats(from, to);
    m = p.match(/^\/api\/customers\/(\d+)$/);
    if (m) { const c = customerDetail(m[1]); if (!c) throw new HttpError(404, 'Customer not found'); return c; }

    if (p === '/api/settings' && method === 'GET') return { settings, connection: { ok: true, shop: SHOP.domain, apiVersion: '2025-10', scopes: SCOPES,
      tokenExpires: new Date(Date.now() + 20 * 3600e3).toISOString(), name: SHOP.name, currency: 'AUD', timezone: TZ } };
    if (p === '/api/settings' && method === 'PUT') {
      const n = (v, min, max) => { v = parseInt(v, 10); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null; };
      const s = { ...settings };
      if (body.refreshSeconds != null) s.refreshSeconds = n(body.refreshSeconds, 15, 3600) ?? s.refreshSeconds;
      if (body.lowStockThreshold != null) s.lowStockThreshold = n(body.lowStockThreshold, 0, 10000) ?? s.lowStockThreshold;
      if (body.shipWithinDays != null) s.shipWithinDays = n(body.shipWithinDays, 0, 60) ?? s.shipWithinDays;
      if (body.sessionHours != null) s.sessionHours = n(body.sessionHours, 1, 720) ?? s.sessionHours;
      if (['day', 'month', 'year'].includes(body.defaultPeriod)) s.defaultPeriod = body.defaultPeriod;
      if (typeof body.compareByDefault === 'boolean') s.compareByDefault = body.compareByDefault;
      const changed = Object.keys(s).filter(k => s[k] !== settings[k]).map(k => `${k}: ${settings[k]} → ${s[k]}`);
      if (changed.length) log('Changed preferences', changed.join(', '));
      settings = s; return { settings };
    }
    if (p === '/api/cache/clear') { log('Reconnected to Shopify and cleared cache'); return { ok: true }; }
    if (p === '/api/password') { needPw(body.next); log('Changed own password'); return { ok: true }; }
    if (p === '/api/connections') return connections();
    if (p === '/api/expenses' && method === 'POST') {
      const name = String(body.name || '').trim().slice(0, 80), amount = Math.round(parseFloat(body.monthly) * 100) / 100;
      if (!name) throw new HttpError(400, 'Enter the app or service name.');
      if (!Number.isFinite(amount) || amount < 0 || amount > 1e6) throw new HttpError(400, 'Enter a valid monthly cost.');
      const e = { id: Math.floor(rnd() * 0xffffffffffff).toString(16).padStart(12, '0'), name, monthly: amount, category: String(body.category || 'App').slice(0, 40),
        billing: body.billing === 'yearly' ? 'yearly' : 'monthly', addedAt: new Date().toISOString() };
      expenses.push(e); log('Added app expense', `${e.name} (${e.monthly} ${e.billing})`); return { expense: e };
    }
    m = p.match(/^\/api\/expenses\/([a-f0-9]{12})$/);
    if (m && method === 'DELETE') {
      const e = expenses.find(x => x.id === m[1]); if (!e) throw new HttpError(400, 'Expense not found.');
      expenses = expenses.filter(x => x !== e); log('Removed app expense', e.name); return { ok: true };
    }
    if (p === '/api/audit') return { entries: audit.slice(0, 200) };
    if (p === '/api/users') {
      if (method === 'POST') {
        const email = String(body.email || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
        if (users.some(u => u.email === email)) throw new HttpError(400, 'A user with that email already exists.');
        needPw(body.password);
        const u = { email, name: String(body.name || '').trim() || email, role: body.role === 'admin' ? 'admin' : 'viewer', createdAt: new Date().toISOString() };
        users.push(u); log('Added team member', `${u.email} as ${u.role}`); return { user: u };
      }
      return { users };
    }
    m = p.match(/^\/api\/users\/(.+)\/password$/);
    if (m && method === 'POST') {
      const email = decodeURIComponent(m[1]).toLowerCase();
      if (email === DEMO_USER.email) throw new HttpError(400, 'Use "Change your password" for your own account.');
      needPw(body.password); log('Reset password', email); return { ok: true };
    }
    m = p.match(/^\/api\/users\/(.+)$/);
    if (m) {
      const email = decodeURIComponent(m[1]).toLowerCase(), u = users.find(x => x.email === email);
      if (!u) throw new HttpError(400, 'User not found.');
      if (email === DEMO_USER.email) throw new HttpError(400, 'You can\'t change your own account here.');
      if (method === 'DELETE') { users = users.filter(x => x !== u); log('Removed team member', email); return { ok: true }; }
      if (method === 'PUT') { u.role = body.role === 'admin' ? 'admin' : 'viewer'; log('Changed role', `${email} → ${u.role}`); return { user: u }; }
    }
    throw new HttpError(404, 'Not found');
  }

  // ---------- fetch override ----------
  const realFetch = window.fetch ? window.fetch.bind(window) : null;
  const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async function (input, init = {}) {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, location.href);
    const isApi = url.origin === location.origin ? /\/api\//.test(url.pathname) : /^\/api\//.test(raw);
    if (!isApi && !/(^|\/)api\//.test(raw)) return realFetch(input, init);
    const method = (init.method || (input && input.method) || 'GET').toUpperCase();
    let body = {};
    try { body = init.body ? JSON.parse(init.body) : {}; } catch { return json(400, { error: 'Invalid JSON' }); }
    await new Promise(r => setTimeout(r, 120 + Math.random() * 180)); // feel like a network call
    try { return json(200, route(method, url, body)); }
    catch (e) { return json(e.status || 500, { error: e.message }); }
  };
  window.__demoRoute = route; // handy for debugging in the console
})();
