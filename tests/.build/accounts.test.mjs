// Accounts: registreren, inloggen, sessies, synchroniseren, blokkeren, wachtwoord vergeten, verwijderen.
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import worker from './worker.mjs';

const sqlite = new DatabaseSync(':memory:');
class Stmt { constructor(sql, args = []) { this.sql = sql; this.args = args; } bind(...a) { return new Stmt(this.sql, a); }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; } async first() { return sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async run() { sqlite.prepare(this.sql).run(...this.args); return {}; } }
const env = { DB: { prepare: s => new Stmt(s), async batch(st) { for (const s of st) await s.run(); } }, PHOTOS: {}, AI: {}, ASSETS: {}, GEMINI_API_KEY: 'k' };

const mails = [];
const realFetch = globalThis.fetch;
let jar = '';   // cookie van het "apparaat"
const call = async (path, body, { method = body === undefined ? 'GET' : 'POST', cookie = jar, headers = {}, ip = '1.1.1.1' } = {}) => {
  const res = await worker.fetch(new Request('https://qook.test' + path, { method,
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie') };
};
const cookieOf = (setCookie) => setCookie.split(';')[0];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.resend.com')) { mails.push(JSON.parse(init.body)); return new Response('{"id":"m1"}'); }
  throw new Error('onverwacht: ' + url);
};

// --- 1. Registreren -----------------------------------------------------------
let r = await call('/api/auth/register', { name: 'Max', email: 'geen-adres', password: 'lang genoeg' });
assert.equal(r.status, 400); assert.match(r.data.detail, /geldig e-mailadres/);
r = await call('/api/auth/register', { name: 'Max', email: 'max@voorbeeld.nl', password: 'kort' });
assert.equal(r.status, 400); assert.match(r.data.detail, /minimaal 8/);
r = await call('/api/auth/register', { name: '', email: 'max@voorbeeld.nl', password: 'lang genoeg' });
assert.equal(r.status, 400);

const local = { qook_prefs: JSON.stringify({ adultsCount: 2, diet: ['Geen'] }), qook_current_plan: '{"days":[]}', vreemd: 'x' };
r = await call('/api/auth/register', { name: 'Max', email: ' Max@Voorbeeld.nl ', password: 'Geheim!123', data: local });
assert.equal(r.status, 201, JSON.stringify(r.data));
assert.deepEqual([r.data.user.name, r.data.user.email, r.data.user.subscription], ['Max', 'max@voorbeeld.nl', 'premium'], 'proef = Premium');
assert.ok(r.data.user.trial_started_at);
assert.match(r.cookie, /^kooq_session=[\w-]{40,}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=5184000$/);
assert.deepEqual(Object.keys(r.data.data).sort(), ['qook_current_plan', 'qook_prefs'], 'gegevens meegenomen, onbekende sleutel genegeerd');
jar = cookieOf(r.cookie);
const stored = sqlite.prepare("SELECT password FROM users WHERE email = 'max@voorbeeld.nl'").get().password;
assert.match(stored, /^pbkdf2\$100000\$/); assert.ok(!stored.includes('Geheim'));
const token = jar.split('=')[1];
assert.ok(!sqlite.prepare('SELECT token_hash FROM sessions').all().some(s => s.token_hash === token), 'sessiesleutel alleen als hash');

r = await call('/api/auth/register', { name: 'Ander', email: 'MAX@voorbeeld.nl', password: 'Geheim!456' }, { cookie: '' });
assert.equal(r.status, 409);

// --- 2. Sessie en synchroniseren ----------------------------------------------------
r = await call('/api/auth/me');
assert.equal(r.data.user.email, 'max@voorbeeld.nl');
assert.equal(JSON.parse(r.data.data.qook_prefs.value).adultsCount, 2);
assert.equal((await call('/api/auth/me', undefined, { cookie: '' })).data.user, null);
assert.equal((await call('/api/auth/me', undefined, { cookie: 'kooq_session=verzonnen' })).data.user, null);

r = await call('/api/account/data', { items: { qook_usage: '{"replacements":1}', qook_prefs: null, hack: 'x' } }, { method: 'PUT' });
assert.equal(r.status, 200);
let me = (await call('/api/auth/me')).data;
assert.deepEqual(Object.keys(me.data).sort(), ['qook_current_plan', 'qook_usage']);
r = await call('/api/account/data', { items: { qook_current_plan: 'x'.repeat(300_001) } }, { method: 'PUT' });
assert.equal(r.status, 413);
assert.equal((await call('/api/account/data', { items: {} }, { method: 'PUT', cookie: '' })).status, 401);

// Andere website mag niets wijzigen
r = await call('/api/account/data', { items: { qook_usage: '{}' } }, { method: 'PUT', headers: { origin: 'https://kwaadaardig.example' } });
assert.equal(r.status, 403);
r = await call('/api/account/data', { items: { qook_usage: '{"ok":1}' } }, { method: 'PUT', headers: { origin: 'https://qook.test' } });
assert.equal(r.status, 200);

// Sessie verlengen als hij over de helft is
sqlite.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() + 10 * 864e5);
r = await call('/api/auth/me');
assert.match(r.cookie, /Max-Age=5184000/);
assert.ok(sqlite.prepare('SELECT expires_at e FROM sessions').get().e > Date.now() + 59 * 864e5);
// Verlopen sessie
sqlite.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1000);
assert.equal((await call('/api/auth/me')).data.user, null);

// --- 3. Inloggen ---------------------------------------------------------------------
r = await call('/api/auth/login', { email: 'max@voorbeeld.nl', password: 'fout-wachtwoord' }, { cookie: '' });
assert.equal(r.status, 401); assert.match(r.data.detail, /klopt niet/);
r = await call('/api/auth/login', { email: 'onbekend@voorbeeld.nl', password: 'Geheim!123' }, { cookie: '' });
assert.equal(r.status, 401, 'zelfde melding voor onbekend adres');
r = await call('/api/auth/login', { email: 'MAX@voorbeeld.nl', password: 'Geheim!123' }, { cookie: '' });
assert.equal(r.status, 200); assert.ok(r.data.data.qook_usage);
jar = cookieOf(r.cookie);

// Te veel foute pogingen -> geblokkeerd, ook met het goede wachtwoord
for (let i = 0; i < 8; i++) await call('/api/auth/login', { email: 'max@voorbeeld.nl', password: 'fout' + i }, { cookie: '', ip: '2.2.2.' + i });
r = await call('/api/auth/login', { email: 'max@voorbeeld.nl', password: 'Geheim!123' }, { cookie: '' });
assert.equal(r.status, 429);
sqlite.prepare("UPDATE auth_attempts SET reset_at = ? WHERE key = 'login:max@voorbeeld.nl'").run(Date.now() - 1);
r = await call('/api/auth/login', { email: 'max@voorbeeld.nl', password: 'Geheim!123' }, { cookie: '' });
assert.equal(r.status, 200, 'na een kwartier weer toegestaan');

// Sterkere instelling -> wachtwoord bij inloggen opnieuw versleuteld
env.PASSWORD_ITERATIONS = '20000';
await call('/api/auth/register', { name: 'Kiona', email: 'k@voorbeeld.nl', password: 'Wachtwoord1' }, { cookie: '', ip: '3.3.3.3' });
assert.match(sqlite.prepare("SELECT password p FROM users WHERE email = 'k@voorbeeld.nl'").get().p, /^pbkdf2\$20000\$/);
delete env.PASSWORD_ITERATIONS;
r = await call('/api/auth/login', { email: 'k@voorbeeld.nl', password: 'Wachtwoord1' }, { cookie: '' });
assert.equal(r.status, 200);
assert.match(sqlite.prepare("SELECT password p FROM users WHERE email = 'k@voorbeeld.nl'").get().p, /^pbkdf2\$100000\$/);
assert.equal((await call('/api/auth/login', { email: 'k@voorbeeld.nl', password: 'Wachtwoord1' }, { cookie: '' })).status, 200);

// Proefperiode voorbij -> gratis; gekozen abonnement wordt onthouden
sqlite.prepare("UPDATE users SET trial_started_at = ? WHERE email = 'max@voorbeeld.nl'").run(new Date(Date.now() - 15 * 864e5).toISOString());
assert.equal((await call('/api/auth/me')).data.user.subscription, 'free');
assert.equal((await call('/api/account/subscription', { tier: 'culinary' })).status, 200);
assert.equal((await call('/api/auth/me')).data.user.subscription, 'culinary');
assert.equal((await call('/api/account/subscription', { tier: 'gratis-alles' })).status, 400);

// Uitloggen
r = await call('/api/auth/logout', {});
assert.match(r.cookie, /Max-Age=0/);
assert.equal((await call('/api/auth/me')).data.user, null, 'sessie is echt weg');

// --- 4. Wachtwoord vergeten -----------------------------------------------------------
assert.equal((await call('/api/auth/config')).data.password_reset, false);
r = await call('/api/auth/forgot', { email: 'max@voorbeeld.nl' }, { cookie: '' });
assert.equal(r.status, 501);
env.RESEND_API_KEY = 're_test'; env.MAIL_FROM = 'Qook <noreply@qook.test>';
assert.equal((await call('/api/auth/config')).data.password_reset, true);
r = await call('/api/auth/forgot', { email: 'niemand@voorbeeld.nl' }, { cookie: '' });
assert.equal(r.status, 200); assert.equal(mails.length, 0, 'geen mail, wel hetzelfde antwoord');
r = await call('/api/auth/forgot', { email: 'Max@voorbeeld.nl' }, { cookie: '' });
assert.equal(r.status, 200); assert.equal(mails.length, 1);
assert.equal(mails[0].to[0], 'max@voorbeeld.nl');
const link = mails[0].text.match(/https:\/\/qook\.test\/app\/\?reset=([\w-]+)/);
assert.ok(link, mails[0].text);
// Ingelogd op een ander apparaat -> na herstel overal uitgelogd
const other = cookieOf((await call('/api/auth/login', { email: 'max@voorbeeld.nl', password: 'Geheim!123' }, { cookie: '' })).cookie);
r = await call('/api/auth/reset', { token: link[1], password: 'kort' }, { cookie: '' });
assert.equal(r.status, 400);
r = await call('/api/auth/reset', { token: link[1], password: 'NieuwGeheim!9' }, { cookie: '' });
assert.equal(r.status, 200); assert.equal(r.data.user.email, 'max@voorbeeld.nl'); assert.ok(r.cookie);
assert.equal((await call('/api/auth/me', undefined, { cookie: other })).data.user, null);
assert.equal((await call('/api/auth/reset', { token: link[1], password: 'NogEenKeer!1' }, { cookie: '' })).status, 400, 'link maar één keer bruikbaar');
assert.equal((await call('/api/auth/login', { email: 'max@voorbeeld.nl', password: 'Geheim!123' }, { cookie: '' })).status, 401);
r = await call('/api/auth/login', { email: 'max@voorbeeld.nl', password: 'NieuwGeheim!9' }, { cookie: '' });
assert.equal(r.status, 200);
jar = cookieOf(r.cookie);

// --- 5. Account verwijderen ----------------------------------------------------------
assert.equal((await call('/api/account/delete', { password: 'fout' })).status, 401);
r = await call('/api/account/delete', { password: 'NieuwGeheim!9' });
assert.equal(r.status, 200);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM users WHERE email = 'max@voorbeeld.nl'").get().n, 0);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM user_data").get().n, 0);
assert.equal((await call('/api/auth/me')).data.user, null);

// --- 6. De app: twee apparaten -------------------------------------------------------------
globalThis.fetch = async (url, init = {}) => {
  if (!String(url).startsWith('/api')) throw new Error('onverwacht');
  const headers = { ...(init.headers || {}), ...(jar ? { cookie: jar } : {}) };
  const res = await worker.fetch(new Request('https://qook.test' + url, { ...init, headers }), env);
  const sc = res.headers.get('set-cookie');
  if (sc) jar = /Max-Age=0/.test(sc) ? '' : cookieOf(sc);
  return res;
};
const makeStorage = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem(k, v) { m.set(k, String(v)); },
  removeItem(k) { m.delete(k); }, clear() { m.clear(); }, _m: m }; };

// Apparaat 1: bezoeker met instellingen maakt een account
jar = '';
globalThis.localStorage = makeStorage();
localStorage.setItem('qook_prefs', JSON.stringify({ adultsCount: 3, subscriptionStatus: 'free' }));
localStorage.setItem('qook_favorites', '["a"]');
const dev1 = await import('./account.mjs?apparaat1');
assert.equal(await dev1.bootstrapAccount(), null);
const u = await dev1.register('Max', 'max@voorbeeld.nl', 'Geheim!123');
assert.equal(u.subscription, 'premium'); assert.ok(u.trial_started_at);
assert.equal(JSON.parse(localStorage.getItem('qook_prefs')).name, 'Max');
// Wijziging in de app -> naar het account
localStorage.setItem('qook_favorites', '["a","b"]');
await dev1.flush();
me = (await call('/api/auth/me')).data;
assert.equal(me.data.qook_favorites.value, '["a","b"]');
assert.equal(JSON.parse(me.data.qook_prefs.value).adultsCount, 3);
const dev1Storage = localStorage, dev1Jar = jar;

// Apparaat 2: ander weekmenu, logt in -> account is leidend, eigen extra's gaan mee
jar = '';
globalThis.localStorage = makeStorage();
localStorage.setItem('qook_prefs', JSON.stringify({ adultsCount: 1 }));
localStorage.setItem('qook_meal_history', '[{"title":"Soep"}]');
const dev2 = await import('./account.mjs?apparaat2');
await dev2.bootstrapAccount();
await dev2.login('max@voorbeeld.nl', 'Geheim!123');
assert.equal(JSON.parse(localStorage.getItem('qook_prefs')).adultsCount, 3, 'instellingen van het account');
assert.equal(localStorage.getItem('qook_favorites'), '["a","b"]');
me = (await call('/api/auth/me')).data;
assert.equal(me.data.qook_meal_history.value, '[{"title":"Soep"}]', 'geschiedenis van dit apparaat meegenomen');
localStorage.setItem('qook_current_plan', '{"days":["nieuw"]}');
await dev2.flush();

// Apparaat 1 opent de app opnieuw -> haalt het nieuwe weekmenu op
await new Promise(r => setTimeout(r, 5));
globalThis.localStorage = dev1Storage; jar = dev1Jar;
const dev1b = await import('./account.mjs?apparaat1-herstart');
const again = await dev1b.bootstrapAccount();
assert.equal(again.email, 'max@voorbeeld.nl');
assert.equal(localStorage.getItem('qook_current_plan'), '{"days":["nieuw"]}');

// Uitloggen wist de persoonlijke gegevens van het apparaat
await dev1b.logout();
assert.equal(localStorage.getItem('qook_prefs'), null);
assert.equal(dev1b.getAccount(), null);
assert.equal((await call('/api/auth/me')).data.user, null);

console.log('ACCOUNTS: ALLE TESTS GESLAAGD');
