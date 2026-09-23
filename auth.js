// Users, sessions and dashboard settings, stored as JSON files in ./data
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA = path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true });
const USERS_FILE = path.join(DATA, 'users.json');
const SETTINGS_FILE = path.join(DATA, 'settings.json');

const readJson = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2), { mode: 0o600 });

// ---- Settings ----
const DEFAULT_SETTINGS = { refreshSeconds: 60, lowStockThreshold: 5, shipWithinDays: 2, defaultPeriod: 'month', compareByDefault: true, sessionHours: 12 };
function getSettings() { return { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, {}) }; }
function saveSettings(input) {
  const s = getSettings();
  const n = (v, min, max) => { v = parseInt(v, 10); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null; };
  if (input.refreshSeconds != null) s.refreshSeconds = n(input.refreshSeconds, 15, 3600) ?? s.refreshSeconds;
  if (input.lowStockThreshold != null) s.lowStockThreshold = n(input.lowStockThreshold, 0, 10000) ?? s.lowStockThreshold;
  if (input.shipWithinDays != null) s.shipWithinDays = n(input.shipWithinDays, 0, 60) ?? s.shipWithinDays;
  if (input.sessionHours != null) s.sessionHours = n(input.sessionHours, 1, 720) ?? s.sessionHours;
  if (['day', 'month', 'year'].includes(input.defaultPeriod)) s.defaultPeriod = input.defaultPeriod;
  if (typeof input.compareByDefault === 'boolean') s.compareByDefault = input.compareByDefault;
  writeJson(SETTINGS_FILE, s);
  return s;
}

// ---- Users (scrypt-hashed passwords) ----
const getUsers = () => readJson(USERS_FILE, []);
const saveUsers = (u) => writeJson(USERS_FILE, u);
const publicUser = (u) => ({ email: u.email, name: u.name, role: u.role, createdAt: u.createdAt });
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const validEmail = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Password must be at least 10 characters.';
  return null;
}
function createUser({ email, name, password, role }) {
  email = String(email || '').trim().toLowerCase();
  if (!validEmail(email)) throw new Error('Enter a valid email address.');
  const pwErr = checkPassword(password); if (pwErr) throw new Error(pwErr);
  const users = getUsers();
  if (users.some(u => u.email === email)) throw new Error('A user with that email already exists.');
  const salt = crypto.randomBytes(16).toString('hex');
  const user = { email, name: String(name || '').trim().slice(0, 80) || email, role: role === 'admin' ? 'admin' : 'viewer', salt, hash: hash(password, salt), createdAt: new Date().toISOString() };
  users.push(user); saveUsers(users);
  return publicUser(user);
}
function verify(email, password) {
  const u = getUsers().find(x => x.email === String(email || '').trim().toLowerCase());
  if (!u || typeof password !== 'string') { hash('dummy-password', 'dummy-salt'); return null; } // equalise timing
  const ok = crypto.timingSafeEqual(Buffer.from(hash(password, u.salt), 'hex'), Buffer.from(u.hash, 'hex'));
  return ok ? u : null;
}
function changePassword(email, current, next) {
  if (!verify(email, current)) throw new Error('Current password is incorrect.');
  const err = checkPassword(next); if (err) throw new Error(err);
  const users = getUsers(); const u = users.find(x => x.email === email);
  u.salt = crypto.randomBytes(16).toString('hex'); u.hash = hash(next, u.salt);
  saveUsers(users);
  for (const [t, s] of sessions) if (s.email === email) sessions.delete(t); // sign out other sessions
}
function deleteUser(email, actingEmail) {
  if (email === actingEmail) throw new Error('You can\'t remove your own account.');
  const users = getUsers(); const target = users.find(u => u.email === email);
  if (!target) throw new Error('User not found.');
  if (target.role === 'admin' && users.filter(u => u.role === 'admin').length === 1) throw new Error('Can\'t remove the last admin.');
  saveUsers(users.filter(u => u.email !== email));
  for (const [t, s] of sessions) if (s.email === email) sessions.delete(t);
}
function setRole(email, role, actingEmail) {
  const users = getUsers(); const u = users.find(x => x.email === email);
  if (!u) throw new Error('User not found.');
  if (email === actingEmail && role !== 'admin') throw new Error('You can\'t remove your own admin role.');
  u.role = role === 'admin' ? 'admin' : 'viewer'; saveUsers(users);
  return publicUser(u);
}

// ---- Sessions: kept on disk (only a SHA-256 of each token) so a restart doesn't sign everyone out ----
const SESSIONS_FILE = path.join(DATA, 'sessions.json');
const tokenKey = (t) => crypto.createHash('sha256').update(t).digest('hex');
const sessions = new Map(Object.entries(readJson(SESSIONS_FILE, {})).filter(([, s]) => s.expires > Date.now()));
let saveTimer = null;
function persistSessions() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    for (const [k, s] of sessions) if (s.expires < Date.now()) sessions.delete(k);
    writeJson(SESSIONS_FILE, Object.fromEntries(sessions));
  }, 200);
}
// Wrap delete so every removal (logout, password change, user removal) is saved
const _delete = sessions.delete.bind(sessions);
sessions.delete = (k) => { const r = _delete(k); persistSessions(); return r; };

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(tokenKey(token), { email: user.email, expires: Date.now() + getSettings().sessionHours * 3600e3 });
  persistSessions();
  return token;
}
function getSessionUser(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)pm_session=([a-f0-9]{64})/);
  if (!m) return null;
  const key = tokenKey(m[1]);
  const s = sessions.get(key);
  if (!s || s.expires < Date.now()) { if (s) sessions.delete(key); return null; }
  const u = getUsers().find(x => x.email === s.email);
  return u ? { ...publicUser(u), token: key } : null;
}

// ---- Admin password reset ----
function resetPassword(email, password) {
  const err = checkPassword(password); if (err) throw new Error(err);
  const users = getUsers(); const u = users.find(x => x.email === email);
  if (!u) throw new Error('User not found.');
  u.salt = crypto.randomBytes(16).toString('hex'); u.hash = hash(password, u.salt);
  saveUsers(users);
  for (const [k, s] of sessions) if (s.email === email) sessions.delete(k);
}

// ---- Activity log (append-only JSON lines) ----
const AUDIT_FILE = path.join(DATA, 'audit.log');
function audit(actor, action, detail = '') {
  const line = JSON.stringify({ at: new Date().toISOString(), actor: actor || 'system', action, detail: String(detail).slice(0, 300) });
  fs.appendFileSync(AUDIT_FILE, line + '\n', { mode: 0o600 });
}
function getAudit(limit = 200) {
  try {
    return fs.readFileSync(AUDIT_FILE, 'utf8').trim().split('\n').filter(Boolean).slice(-limit).reverse().map(l => JSON.parse(l));
  } catch { return []; }
}

// ---- App expenses (entered manually: Shopify doesn't expose other apps' bills) ----
const EXPENSES_FILE = path.join(DATA, 'expenses.json');
const getExpenses = () => readJson(EXPENSES_FILE, []);
function addExpense({ name, monthly, category, billing }) {
  name = String(name || '').trim().slice(0, 80);
  const amount = Math.round(parseFloat(monthly) * 100) / 100;
  if (!name) throw new Error('Enter the app or service name.');
  if (!Number.isFinite(amount) || amount < 0 || amount > 1e6) throw new Error('Enter a valid monthly cost.');
  const e = { id: crypto.randomBytes(6).toString('hex'), name, monthly: amount,
    category: String(category || 'App').slice(0, 40), billing: billing === 'yearly' ? 'yearly' : 'monthly', addedAt: new Date().toISOString() };
  const all = getExpenses(); all.push(e); writeJson(EXPENSES_FILE, all);
  return e;
}
function deleteExpense(id) {
  const all = getExpenses(); const e = all.find(x => x.id === id);
  if (!e) throw new Error('Expense not found.');
  writeJson(EXPENSES_FILE, all.filter(x => x.id !== id));
  return e;
}
const sessionCookie = (token, secure, maxAgeSec) =>
  `pm_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;

// ---- Brute-force protection: 5 failed logins per IP+email per 15 min ----
const attempts = new Map();
function tooManyAttempts(key) {
  const a = attempts.get(key);
  return a && a.count >= 5 && Date.now() - a.first < 15 * 60e3;
}
function recordFailure(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > 15 * 60e3) attempts.set(key, { count: 1, first: Date.now() });
  else a.count++;
}

module.exports = {
  getSettings, saveSettings, getUsers, createUser, verify, changePassword, deleteUser, setRole, publicUser,
  sessions, createSession, getSessionUser, sessionCookie, tooManyAttempts, recordFailure, attempts,
  resetPassword, audit, getAudit, getExpenses, addExpense, deleteExpense,
};
