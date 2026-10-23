import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
const sqlite = new DatabaseSync(':memory:');
class Stmt { constructor(sql, args = []) { this.sql = sql; this.args = args; } bind(...a) { return new Stmt(this.sql, a); }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; } async first() { return sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async run() { sqlite.prepare(this.sql).run(...this.args); return {}; } }
const env = { DB: { prepare: s => new Stmt(s), async batch(st) { for (const s of st) await s.run(); } }, PHOTOS: {}, AI: {}, ASSETS: {}, GEMINI_API_KEY: 'k', LIMITS: 'off' };
const systems = [];
globalThis.fetch = async (url, init) => { const b = JSON.parse(init.body); systems.push(b.systemInstruction.parts[0].text);
  const s = systems.at(-1);
  const out = s.includes('7-daags') ? { days: ['Stamppot', 'Lasagne', 'Curry', 'Tacos', 'Paella', 'Ramen', 'Moussaka'].map(t => ({ title: t })) } : s.includes('vervangt') ? { title: 'B' } : s.includes('volledig') ? { ingredients: [], steps: [] } : { recognizedItems: [], suggestions: [] };
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] })); };
const post = (p, body) => worker.fetch(new Request('https://k/api/' + p, { method: 'POST', body: JSON.stringify(body) }), env);
await post('weekly-plan', { prefs: { region: 'BE', dayModes: {} } });
await post('replace-meal', { prefs: { diet: ['Keto'] }, currentMeal: { title: 'x' } }); // Keto: niet uit de bank
await post('full-recipe', { meal: { title: 'Kip supreme', mode: 'culinary' }, region: 'NL' });
await post('fridge-scan', { image: 'QUJD', prefs: { region: 'DE' } });
assert.equal(systems.length, 4);
assert.match(systems[0], /gewone supermarkt in België/);
assert.match(systems[1], /gewone supermarkt in Nederland/);
assert.match(systems[2], /kip supreme \(bij de poelier; of kipfilet\)/);
assert.match(systems[3], /gewone supermarkt in Duitsland/);
console.log('BESCHIKBAARHEID: ALLE TESTS GESLAAGD');
