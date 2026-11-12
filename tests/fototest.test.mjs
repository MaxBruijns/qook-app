// De fototest is beëindigd: het eindpunt bestaat niet meer en de cron ruimt testfoto's en stand op.
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
const sqlite = new DatabaseSync(':memory:');
class Stmt { constructor(sql, args = []) { this.sql = sql; this.args = args; } bind(...a) { return new Stmt(this.sql, a); }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; } async first() { return sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async run() { sqlite.prepare(this.sql).run(...this.args); return {}; } }
const objects = new Set(['meals/fototest-a-1.jpg', 'meals/fototest-tech-x.jpg', 'meals/r1.jpg']);
let lists = 0;
const env = { DB: { prepare: s => new Stmt(s), async batch(st) { for (const s of st) await s.run(); } }, ASSETS: {}, AI: {},
  PHOTOS: { async list({ prefix }) { lists++; return { objects: [...objects].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; },
            async delete(keys) { for (const k of [].concat(keys)) objects.delete(k); }, async get() { return null; }, async put() {} } };
globalThis.fetch = async () => { throw new Error('geen netwerk'); };
await worker.fetch(new Request('https://q.test/api/health'), env);
const r = await worker.fetch(new Request('https://q.test/api/fototest', { method: 'POST' }), env);
assert.notEqual(r.status, 200, 'eindpunt is weg');
sqlite.prepare(`INSERT INTO worker_state (key, value) VALUES ('fototest', '{"recipes":[]}')`).run();
const waits = []; await worker.scheduled({}, env, { waitUntil: p => waits.push(p) }); await Promise.allSettled(waits);
await new Promise(r => setTimeout(r, 50));
assert.deepEqual([...objects], ['meals/r1.jpg'], 'alleen testfoto\'s weg');
assert.equal(sqlite.prepare(`SELECT COUNT(*) n FROM worker_state WHERE key = 'fototest'`).get().n, 0);
const before = lists; await worker.scheduled({}, env, { waitUntil: p => waits.push(p) }); await Promise.allSettled(waits); await new Promise(r => setTimeout(r, 50));
assert.equal(lists, before, 'daarna geen werk meer');
console.log('FOTOTEST OPGERUIMD: IN ORDE');
