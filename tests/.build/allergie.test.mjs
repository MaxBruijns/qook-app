// Allergie-veiligheid: gerechten met een allergeen in het recept komen niet in het menu, ook als het label klopt.
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
const sqlite = new DatabaseSync(':memory:');
class Stmt { constructor(sql, args = []) { this.sql = sql; this.args = args; } bind(...a) { return new Stmt(this.sql, a); }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; } async first() { return sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async run() { sqlite.prepare(this.sql).run(...this.args); return {}; } }
const env = { DB: { prepare: s => new Stmt(s), async batch(st) { for (const s of st) await s.run(); } }, PHOTOS: {}, AI: {}, ASSETS: {}, GEMINI_API_KEY: 'k' };
let systems = [];
globalThis.fetch = async (_u, init) => { const sys = JSON.parse(init.body).systemInstruction.parts[0].text; systems.push(sys);
  const n = Number((sys.match(/Je maakt (\d+) gerecht/) || [])[1] || 1);
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ days: Array.from({ length: n }, (_, i) => ({ title: `Ai${systems.length}x${i}`, main_ingredient: ['kip','zalm','ei','tofu','kaas','wild','eend'][i], cuisine: ['Frans','Thais','Grieks','Japans','Indiaas','Hollands','Mexicaans'][i] })) }) }] } }] })); };
await worker.fetch(new Request('https://q/api/health'), env);
const ins = (id, title, tags, ingredients, details = true) => sqlite.prepare(`INSERT INTO recipes (id, title, data, details, mode, main, cuisine, diet_tags, kid, minutes, details_v)
  VALUES (?, ?, ?, ?, 'premium', ?, ?, ?, 1, 30, ?)`).run(id, title, JSON.stringify({ title }), details ? JSON.stringify({ v: 4, ingredients: ingredients.map(name => ({ name })) }) : null,
  ['kip','zalm','ei','tofu','kaas','wild','eend','gehakt','rundvlees','witvis','peulvruchten','zeevruchten'][Number(id.slice(1)) % 12], ['Frans','Thais','Grieks','Japans','Indiaas','Hollands','Mexicaans','Chinees','Spaans','Marokkaans'][Number(id.slice(1)) % 10], tags, details ? 4 : 0);
// 12 veilige glutenvrije gerechten, 5 met verkeerd label (pasta/sojasaus), 5 zonder recept
for (let i = 0; i < 12; i++) ins(`g${i}`, `Veiliggerecht x${i}`, ',glutenvrij,', ['rijst', 'bloemkool', 'tamari', 'maizena']);
for (let i = 12; i < 17; i++) ins(`g${i}`, `Foutlabel x${i}`, ',glutenvrij,', ['spaghetti', 'ui']);
for (let i = 17; i < 22; i++) ins(`g${i}`, `Zonderrecept x${i}`, ',glutenvrij,', [], false);
const prefs = { language: 'nl-NL', region: 'NL', diet: ['Glutenarm'], cookingTime: '45', weekendCookingTime: 'unlimited', dayModes: {} };
for (let k = 0; k < 3; k++) {
  const r = await (await worker.fetch(new Request('https://q/api/weekly-plan', { method: 'POST', headers: { 'cf-connecting-ip': `1.2.3.${k}` }, body: JSON.stringify({ prefs }) }), env)).json();
  assert.equal(r.days.length, 7);
  assert.ok(!r.days.some(d => /Foutlabel|Zonderrecept/.test(d.title)), JSON.stringify(r.days.map(d => d.title)));
}
// AI-opdracht bevat de strikte allergieregel
systems = [];
await worker.fetch(new Request('https://q/api/weekly-plan', { method: 'POST', headers: { 'cf-connecting-ip': '5.5.5.5' }, body: JSON.stringify({ prefs: { ...prefs, region: 'US' } }) }), env);
assert.match(systems[0], /ALLERGIE \(STRIKT[^\n]*geen gluten/);
console.log('ALLERGIE-VEILIGHEID: ALLE TESTS GESLAAGD');
