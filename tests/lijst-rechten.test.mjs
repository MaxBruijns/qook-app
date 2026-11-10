// Boodschappenlijst per abonnement: bezoeker en Gratis alleen het open gerecht,
// proef en betaalde abonnementen precies de geselecteerde gerechten.
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import worker from './worker.mjs';

const sqlite = new DatabaseSync(':memory:');
class Stmt { constructor(sql, args = []) { this.sql = sql; this.args = args; } bind(...a) { return new Stmt(this.sql, a); }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; } async first() { return sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async run() { sqlite.prepare(this.sql).run(...this.args); return {}; } }
const env = { DB: { prepare: s => new Stmt(s), async batch(st) { for (const s of st) await s.run(); } }, PHOTOS: {}, AI: {}, ASSETS: {},
  GEMINI_API_KEY: 'k', PASSWORD_ITERATIONS: '10000' };
const ingr = ['Courgette', 'Feta', 'Linzen'];
globalThis.fetch = async (url, init) => {
  const text = JSON.stringify(JSON.parse(init.body).contents);
  const i = Number((text.match(/Gerecht (\d)/) || [])[1]);
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
    ingredients: [{ name: ingr[i], amount: 1, unit: 'stuks' }], steps: [{ user_text: 'x' }] }) }] } }] }));
};
const post = async (path, body, cookie = '', ip = '1.1.1.1') => {
  const r = await worker.fetch(new Request('https://q.test/api/' + path, { method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }), env);
  return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie') };
};
await worker.fetch(new Request('https://q.test/api/health'), env);
ingr.forEach((_, i) => sqlite.prepare(`INSERT INTO recipes (id, title, data, mode) VALUES (?, ?, '{}', 'premium')`).run(`m${i}`, `Gerecht ${i}`));
const names = (r) => r.data.map(i => i.name).sort();
const meals = [{ id: 'm0', day: 0 }, { id: 'm1', day: 1 }, { id: 'm2', day: 2 }];

// Bezoeker: alleen het eerste (open) gerecht.
let r = await post('shopping-list', { meals, servings: 2 });
assert.equal(r.status, 200, JSON.stringify(r.data)); assert.deepEqual(names(r), ['Courgette']);

// Proef (= Premium): alle geselecteerde gerechten.
r = await post('auth/register', { name: 'A', email: 'a@q.test', password: 'Wachtwoord1' }, '', '2.2.2.2');
const a = r.cookie.split(';')[0];
r = await post('shopping-list', { meals, servings: 2 }, a);
assert.deepEqual(names(r), ['Courgette', 'Feta', 'Linzen']);
r = await post('shopping-list', { meals: [meals[1]], servings: 2 }, a);
assert.deepEqual(names(r), ['Feta'], 'alleen wat geselecteerd is');

// Proef voorbij -> Gratis: weer alleen het open gerecht.
sqlite.prepare(`UPDATE users SET trial_started_at = '2020-01-01T00:00:00Z'`).run();
r = await post('shopping-list', { meals, servings: 2 }, a);
assert.deepEqual(names(r), ['Courgette']);

// Basic: de geselecteerde gerechten.
sqlite.prepare(`UPDATE users SET subscription = 'basic'`).run();
r = await post('shopping-list', { meals, servings: 2 }, a);
assert.deepEqual(names(r), ['Courgette', 'Feta', 'Linzen']);
console.log('LIJST-RECHTEN: ALLE TESTS GESLAAGD');
