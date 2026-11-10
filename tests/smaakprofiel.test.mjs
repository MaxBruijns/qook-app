// Test van de leerlus: signalen -> smaakprofiel -> weekmenu/vervangen.
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import worker from './worker.mjs';

const sqlite = new DatabaseSync(':memory:');
class Stmt {
  constructor(sql, args = []) { this.sql = sql; this.args = args; }
  bind(...a) { return new Stmt(this.sql, a); }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; }
  async first() { return sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async run() { sqlite.prepare(this.sql).run(...this.args); return { success: true }; }
}
const env = { DB: { prepare: s => new Stmt(s), async batch(st) { for (const s of st) await s.run(); } },
  PHOTOS: { async put() {}, async get() { return null; } }, AI: { async run() { return { image: 'AA==' }; } },
  ASSETS: { fetch: () => new Response('app') }, GEMINI_API_KEY: 'k', LIMITS: 'off' };

const ls = new Map();
globalThis.localStorage = { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, String(v)) };

const calls = [];
let uniq = 0; // teller die nooit terug naar 0 gaat, voor unieke gerechtnamen
let profileReply = { profile: '- houdt van Aziatisch en pittig\n- laat vis liggen' };
let profileFails = false;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('/api')) return worker.fetch(new Request('https://kooq.test' + url, init), env);
  const body = JSON.parse(init.body);
  const system = body.systemInstruction.parts[0].text;
  const user = body.contents[0].parts.map(p => p.text || '').join('');
  calls.push({ system, user });
  let out;
  if (system.includes('kort smaakprofiel')) {
    if (profileFails) return new Response('x', { status: 500 });
    out = profileReply;
  } else if (system.includes('7-daags menu')) {
    out = { zero_waste_report: '', days: (uniq++, 'abcdefg').split('').map(c => ({ title: `Recept${uniq}${c}`, mode: 'premium' })) };
  } else {
    out = { title: `Vervanger${uniq++}`, mode: 'premium' };
  }
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }));
};

const taste = await import('./taste.mjs');
const svc = await import('./service.mjs');
const prefs = { language: 'nl-NL', adultsCount: 2, childrenCount: 0, diet: [], dayModes: { 0: 'premium' }, generationHistory: [] };
const last = (pred) => [...calls].reverse().find(pred);

// 1. Zonder signalen: geen profielaanroep, geen profielblok
await svc.generateWeeklyPlan(prefs);
assert.equal(calls.length, 1);
assert.doesNotMatch(calls[0].system, /SMAAKPROFIEL/);

// 2. Signalen verzamelen; dubbel binnen een uur telt één keer
taste.recordTaste('Thaise curry', 'liked');
taste.recordTaste('Thaise curry', 'liked');
taste.recordTaste('Zalm uit de oven', 'disliked');
taste.recordTaste('Pad thai', 'favorite');
taste.recordTaste('Kibbeling', 'replaced');
taste.recordTaste(undefined, 'cooked');
assert.equal(taste.getTasteState().events.length, 4);
assert.ok(taste.needsProfileRefresh());

// 3. Nieuw weekmenu: eerst profiel samenvatten, daarna menu met profiel
calls.length = 0;
await svc.generateWeeklyPlan(prefs);
assert.equal(calls.length, 2);
assert.match(calls[0].system, /GEEN conclusies over gezondheid/);
assert.match(calls[0].user, /Thaise curry: duim omhoog/);
assert.match(calls[0].user, /Zalm uit de oven: duim omlaag/);
assert.match(calls[0].user, /Kibbeling: weggeklikt/);
assert.match(calls[1].system, /SMAAKPROFIEL[\s\S]*houdt van Aziatisch/);
assert.equal(taste.getTasteProfile(), profileReply.profile);
assert.equal(taste.getTasteState().eventsSinceProfile, 0);

// 4. Volgend menu zonder nieuwe signalen: geen nieuwe samenvatting, wel profiel mee
calls.length = 0;
await svc.generateWeeklyPlan(prefs);
assert.equal(calls.length, 1);
assert.match(calls[0].system, /houdt van Aziatisch/);

// 5. Vervangen neemt het profiel ook mee
await svc.replaceMeal({ id: 'x', title: 'Iets' }, prefs, 0, []);
assert.match(last(c => c.system.includes('vervangt')).system, /SMAAKPROFIEL[\s\S]*laat vis liggen/);

// 6. Na 3 nieuwe signalen: vorig profiel gaat mee naar de nieuwe samenvatting
taste.recordTaste('Ramen', 'cooked'); taste.recordTaste('Ramen', 'shopping'); taste.recordTaste('Kip tandoori', 'liked');
calls.length = 0;
profileReply = { profile: '- Aziatisch, ook Indiaas\n- geen vis' };
await svc.generateWeeklyPlan(prefs);
assert.equal(calls.length, 2);
assert.match(calls[0].user, /VORIG PROFIEL:\n- houdt van Aziatisch/);
assert.match(calls[1].system, /ook Indiaas/);

// 7. Profiel samenvatten mislukt -> weekmenu gaat door met vorig profiel
taste.recordTaste('X', 'liked'); taste.recordTaste('Y', 'liked'); taste.recordTaste('Z', 'liked');
profileFails = true;
calls.length = 0;
const plan = await svc.generateWeeklyPlan(prefs);
assert.equal(plan.days.length, 7);
assert.match(last(c => c.system.includes('7-daags')).system, /ook Indiaas/);
assert.ok(taste.needsProfileRefresh(), 'blijft staan voor de volgende keer');
profileFails = false;

// 8. Handmatig aanpassen en wissen (instellingen)
taste.setTasteProfile('- alleen vegetarisch Italiaans');
calls.length = 0; taste.clearTaste();
assert.equal(taste.getTasteProfile(), '');
assert.equal(taste.getTasteState().events.length, 0);
await svc.generateWeeklyPlan(prefs);
assert.equal(calls.length, 1); assert.doesNotMatch(calls[0].system, /SMAAKPROFIEL/);

// 9. Backend negeert onzin-signalen en begrenst invoer
const r = await worker.fetch(new Request('https://kooq.test/api/taste-profile', { method: 'POST',
  body: JSON.stringify({ events: [{ title: 'A', kind: 'hack' }, { title: 5, kind: 'liked' }], previousProfile: 'oud' }) }), env);
assert.deepEqual(await r.json(), { profile: 'oud' });

console.log('LEERLUS: ALLE TESTS GESLAAGD');
