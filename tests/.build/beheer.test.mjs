// Meldingen over recepten, bezoekersteller en het beheerscherm.
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
const sqlite = new DatabaseSync(':memory:');
class Stmt { constructor(sql, args = []) { this.sql = sql; this.args = args; } bind(...a) { return new Stmt(this.sql, a); }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; } async first() { return sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async run() { sqlite.prepare(this.sql).run(...this.args); return {}; } }
const env = { DB: { prepare: s => new Stmt(s), async batch(st) { for (const s of st) await s.run(); } }, PHOTOS: {}, AI: {}, ASSETS: {}, GEMINI_API_KEY: 'k', PASSWORD_ITERATIONS: '10000' };
globalThis.fetch = async () => new Response('{}');
const req = (path, { method = 'GET', body, ip = '1.1.1.1', headers = {} } = {}) => worker.fetch(new Request('https://q.test' + path, { method,
  headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...headers }, body: body ? JSON.stringify(body) : undefined }), env);

await req('/api/health');
sqlite.prepare(`INSERT INTO recipes (id, title, data, mode, main, cuisine, diet_tags, minutes, has_image, details_v) VALUES ('r1', 'Soep', '{}', 'premium', 'groenten', 'Hollands', ',', 30, 1, 4)`).run();

// Melden
assert.equal((await req('/api/report', { method: 'POST', body: { recipe_id: 'bestaat-niet' } })).status, 404);
assert.equal((await req('/api/report', { method: 'POST', body: { recipe_id: 'r1', kind: 'foto', message: 'dit is taart' } })).status, 200);
assert.equal((await req('/api/report', { method: 'POST', body: { recipe_id: 'r1', kind: 'foto' } })).status, 200, 'dubbel van dezelfde: geen tweede melding');
assert.equal(sqlite.prepare("SELECT has_image h FROM recipes WHERE id = 'r1'").get().h, 1, 'één melding: foto blijft');
await req('/api/report', { method: 'POST', body: { recipe_id: 'r1', kind: 'foto' }, ip: '2.2.2.2' });
assert.equal(sqlite.prepare("SELECT has_image h FROM recipes WHERE id = 'r1'").get().h, 0, 'twee mensen: nieuwe foto');
for (const ip of ['3.3.3.3', '4.4.4.4']) await req('/api/report', { method: 'POST', body: { recipe_id: 'r1', kind: 'recept' }, ip });
assert.equal(sqlite.prepare("SELECT hidden h FROM recipes WHERE id = 'r1'").get().h, 0);
await req('/api/report', { method: 'POST', body: { recipe_id: 'r1', kind: 'ingredienten' }, ip: '5.5.5.5' });
assert.equal(sqlite.prepare("SELECT hidden h FROM recipes WHERE id = 'r1'").get().h, 1, 'drie mensen: uit de bank');

// Bezoek tellen
for (let i = 0; i < 3; i++) await req('/api/v', { method: 'POST', body: { p: 'landing' } });
await req('/api/v', { method: 'POST', body: { p: 'app' } });
assert.equal((await req('/api/v', { method: 'POST', body: { p: 'iets' } })).status, 204);
assert.deepEqual(sqlite.prepare('SELECT page, count FROM visits ORDER BY page').all().map(r => [r.page, r.count]), [['app', 1], ['landing', 3]]);

// Beheer: zonder sleutel onzichtbaar
assert.equal((await req('/api/admin/overview')).status, 404);
env.ADMIN_KEY = 'geheim';
assert.equal((await req('/api/admin/overview', { headers: { 'x-admin-key': 'fout' } })).status, 404);
await req('/api/auth/register', { method: 'POST', body: { name: 'A', email: 'a@q.test', password: 'Wachtwoord1' } });
const ov = await (await req('/api/admin/overview', { headers: { 'x-admin-key': 'geheim' } })).json();
assert.equal(ov.users.total, 1); assert.equal(ov.users.trial_active, 1); assert.equal(ov.users.new_7d, 1);
assert.equal(ov.bank.hidden, 1); assert.ok(ov.reports.length >= 4); assert.equal(ov.visits.length, 2);
let r = await req('/api/admin/action', { method: 'POST', body: { action: 'unhide', recipe_id: 'r1' }, headers: { 'x-admin-key': 'geheim' } });
assert.equal(r.status, 200); assert.equal(sqlite.prepare("SELECT hidden h FROM recipes WHERE id = 'r1'").get().h, 0);
await req('/api/admin/action', { method: 'POST', body: { action: 'resolve', recipe_id: 'r1' }, headers: { 'x-admin-key': 'geheim' } });
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM recipe_reports WHERE status = 'open'").get().n, 0);
await req('/api/admin/action', { method: 'POST', body: { action: 'new_recipe', recipe_id: 'r1' }, headers: { 'x-admin-key': 'geheim' } });
assert.equal(sqlite.prepare("SELECT details_v v FROM recipes WHERE id = 'r1'").get().v, 0);

// Allergiemelding: direct uit de bank
await req('/api/report', { method: 'POST', body: { recipe_id: 'r1', kind: 'allergie', message: 'bevat noten' }, ip: '9.9.9.9' });
assert.equal(sqlite.prepare("SELECT hidden h FROM recipes WHERE id = 'r1'").get().h, 1);
console.log('BEHEER: ALLE TESTS GESLAAGD');
