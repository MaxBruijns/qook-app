// Gratis koelkastscan als ingang: bezoeker scant 1x per week, registratie na de scan wordt
// bijgehouden, en het beheerscherm toont scans, registraties en wie daarvan betaalt.
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import worker from './worker.mjs';

const sqlite = new DatabaseSync(':memory:');
class Stmt { constructor(sql, args = []) { this.sql = sql; this.args = args; } bind(...a) { return new Stmt(this.sql, a); }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; } async first() { return sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async run() { sqlite.prepare(this.sql).run(...this.args); return {}; } }
const env = { DB: { prepare: s => new Stmt(s), async batch(st) { for (const s of st) await s.run(); } }, PHOTOS: {}, AI: {}, ASSETS: {},
  GEMINI_API_KEY: 'k', PASSWORD_ITERATIONS: '10000', ADMIN_KEY: 'geheim' };
const ok = (o) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] } }] }));
let n = 0;
globalThis.fetch = async () => ok({ recognizedItems: ['ei', 'feta', 'courgette'],
  suggestions: [1, 2, 3].map(i => ({ title: `Restjesgerecht ${n}-${i}`, main_ingredient: 'ei', cuisine: 'Grieks' })) });
const call = async (path, { body, ip = '7.7.7.7', cookie = '', admin = false } = {}) => {
  const r = await worker.fetch(new Request('https://q.test' + path, { method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(cookie ? { cookie } : {}), ...(admin ? { 'x-admin-key': 'geheim' } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env);
  return { status: r.status, data: await r.json().catch(() => ({})), cookie: r.headers.get('set-cookie') };
};
const prefs = { language: 'nl-NL', region: 'NL', diet: ['Geen'] };

// Bezoeker: één gratis scan per week, met herkende ingrediënten en 3 voorstellen.
let r = await call('/api/fridge-scan', { body: { image: 'QUJD', prefs } });
assert.equal(r.status, 200); assert.deepEqual(r.data.recognizedItems, ['ei', 'feta', 'courgette']); assert.equal(r.data.suggestions.length, 3);
r = await call('/api/fridge-scan', { body: { image: 'QUJD', prefs } });
assert.equal(r.status, 402, 'tweede scan deze week: eerst registreren');
// Andere bezoekers
for (const ip of ['1.0.0.1', '1.0.0.2', '1.0.0.3']) { n++; assert.equal((await call('/api/fridge-scan', { body: { image: 'QUJD', prefs }, ip })).status, 200); }

// Registreren na de scan: bron wordt bewaard; een onbekende bron niet.
r = await call('/api/auth/register', { body: { name: 'Sanne', email: 'sanne@q.test', password: 'Wachtwoord1', source: 'scan' } });
assert.equal(r.status, 201);
const sanne = r.cookie.split(';')[0];
await call('/api/auth/register', { body: { name: 'Piet', email: 'piet@q.test', password: 'Wachtwoord1', source: 'hack', marketing: true }, ip: '1.0.0.9' });
await call('/api/auth/register', { body: { name: 'Kees', email: 'kees@q.test', password: 'Wachtwoord1' }, ip: '1.0.0.8' });
const src = Object.fromEntries(sqlite.prepare('SELECT email, signup_source s, marketing_opt_in m FROM users').all().map(u => [u.email, [u.s, u.m]]));
assert.deepEqual(src['sanne@q.test'], ['scan', 0]);
assert.deepEqual(src['piet@q.test'], [null, 1], 'onbekende bron genegeerd, toestemming wel bewaard');
assert.deepEqual(src['kees@q.test'][0], null);

// Na registratie (proef = Premium) mag Sanne meer scannen; telt als scan door een lid.
n++; assert.equal((await call('/api/fridge-scan', { body: { image: 'QUJD', prefs }, cookie: sanne })).status, 200);

// Een van de scanners gaat betalen.
sqlite.prepare(`UPDATE users SET subscription = 'premium' WHERE email = 'sanne@q.test'`).run();

// Beheer: scans door bezoekers, registraties na scan, betalend.
r = await call('/api/admin/overview', { admin: true });
assert.equal(r.status, 200);
assert.deepEqual(r.data.scan, { visitor_scans_30d: 4, member_scans_30d: 1, signups_30d: 1, signups_total: 1, paying_total: 1 });
assert.ok(r.data.visits.every(v => ['landing', 'app'].includes(v.page)), 'scans niet in de bezoekgrafiek');
console.log('GRATIS SCAN: ALLE TESTS GESLAAGD');
