// Tijdelijke fototest: per deel (recept 0-2, techniek) foto's maken en de stand bewaren.
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
const sqlite = new DatabaseSync(':memory:');
class Stmt { constructor(sql, args = []) { this.sql = sql; this.args = args; } bind(...a) { return new Stmt(this.sql, a); }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; } async first() { return sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async run() { sqlite.prepare(this.sql).run(...this.args); return {}; } }
const stored = {};
let aiCalls = 0;
const env = { DB: { prepare: s => new Stmt(s), async batch(st) { for (const s of st) await s.run(); } }, ASSETS: {}, GEMINI_API_KEY: 'k',
  PHOTOS: { async put(k) { stored[k] = true; }, async get() { return null; } },
  AI: { async run() { aiCalls++; return { image: Buffer.from('plaatje').toString('base64') }; } } };
globalThis.fetch = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ prompts: ['raw onion in bowl', 'onion in pan', 'sauce in pan', 'plated pasta'] }) }] } }] }));
const call = async (q = '', method = 'POST') => (await worker.fetch(new Request('https://q.test/api/fototest' + q, { method }), env)).json();
await call('', 'GET');
const steps = JSON.stringify({ steps: [1, 2, 3, 4].map(i => ({ user_text: `Stap ${i}` })) });
for (const i of [1, 2, 3]) sqlite.prepare(`INSERT INTO recipes (id, title, data, has_image, details, details_v) VALUES (?, ?, '{}', 1, ?, 9)`).run(`r${i}`, `Gerecht ${i}`, steps);
let s = await call('?part=0');
assert.equal(s.recipes[0].steps.length, 4); assert.ok(s.recipes[0].steps.every(x => x.url)); assert.match(s.recipes[0].main, /\/api\/images\//);
s = await call('?part=1'); assert.notEqual(s.recipes[1].id, s.recipes[0].id, 'ander recept');
const before = aiCalls; s = await call('?part=0'); assert.equal(aiCalls, before, 'deel 0 niet opnieuw');
s = await call('?part=tech'); assert.equal(s.techniques.length, 6); assert.ok(s.techniques.every(t => t.url));
s = await call('', 'GET'); assert.equal(s.recipes.filter(Boolean).length, 2);
console.log('FOTOTEST: IN ORDE');
