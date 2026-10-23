import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
const sqlite = new DatabaseSync(':memory:');
class Stmt { constructor(sql, args = []) { this.sql = sql; this.args = args; } bind(...a) { return new Stmt(this.sql, a); }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; } async first() { return sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async run() { sqlite.prepare(this.sql).run(...this.args); return {}; } }
const env = { DB: { prepare: s => new Stmt(s), async batch(st) { for (const s of st) await s.run(); } }, PHOTOS: {}, AI: {}, ASSETS: {}, GEMINI_API_KEY: 'k', LIMITS: 'off' };
const models = []; let fail38 = false;
globalThis.fetch = async (url, init) => {
  const model = String(url).match(/models\/([^:]+):/)[1]; models.push(model);
  const sys = JSON.parse(init.body).systemInstruction.parts[0].text;
  if (model === 'gemini-3.8-flash' && fail38) return new Response('{"error":"unavailable"}', { status: 503 });
  assert.match(sys, /De laatste stap is altijd het opdienen/); assert.match(sys, /Noem de oven ALLEEN/); assert.match(sys, /Noem in de stappen GEEN hoeveelheden/);
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ ingredients: [{ name: 'zalm', amount: 4, unit: 'stuks' }], steps: [{ user_text: 'bak' }], supplies: ['pan'] }) }] } }] }));
};
const call = async (meal) => (await worker.fetch(new Request('https://k/api/full-recipe', { method: 'POST', body: JSON.stringify({ meal }) }), env)).json();
// Oud recept (zonder versie) in de bank
await worker.fetch(new Request('https://k/api/health'), env);
sqlite.prepare("INSERT INTO recipes (id,title,data,details) VALUES ('r1','Zalm','{\"short_description\":\"Sappige zalm\"}','{\"ingredients\":[{\"name\":\"zeezoet\"}]}')").run();
let r = await call({ id: 'r1', title: 'Zalm' });
assert.equal(models.at(-1), 'gemini-3.8-flash', 'beter model voor recepten'); assert.equal(r.v, 4); assert.match(JSON.stringify(models), /3.8/); assert.equal(r.ingredients[0].name, 'zalm');
assert.equal(JSON.parse(sqlite.prepare("SELECT details FROM recipes WHERE id='r1'").get().details).v, 4, 'oude versie overschreven');
const n = models.length; r = await call({ id: 'r1', title: 'Zalm' }); assert.equal(models.length, n, 'nieuwe versie uit de bank');
// Terugval als 3.8 niet beschikbaar is
fail38 = true; r = await call({ title: 'Pasta' });
assert.deepEqual(models.slice(-2), ['gemini-3.8-flash', 'gemini-3.5-flash-lite']); assert.equal(r.v, 4);
const h = await (await worker.fetch(new Request('https://k/api/health'), env)).json();
assert.equal(h.recipe_model, 'gemini-3.8-flash'); assert.equal(h.text_model, 'gemini-3.5-flash-lite');
console.log('RECEPTKWALITEIT: ALLE TESTS GESLAAGD');
