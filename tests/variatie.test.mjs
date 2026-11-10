// Variatie over weken: 8 weken, favorieten na 4 weken (max 1/week), duim omlaag nooit,
// hoofdingrediënt max 2x, keuken max 3x per week.
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import worker, { __t } from './worker.mjs';
const { buildVariety, conflictReason } = __t;

// --- 1. Regels -----------------------------------------------------------
const v = buildVariety({
  history: [
    { title: 'Lasagne bolognese', weeksAgo: 3, cuisine: 'Italiaans' },
    { title: 'Nasi goreng', weeksAgo: 9, cuisine: 'Aziatisch' },
    { title: 'Pad thai met garnalen', weeksAgo: 2, cuisine: 'Aziatisch' },
    { title: 'Risotto met paddenstoelen', weeksAgo: 5, cuisine: 'Italiaans' },
    { title: 'Pasta pesto', weeksAgo: 1, cuisine: 'Italiaans' },
  ],
  favoriteTitles: ['Pad thai met garnalen', 'Risotto met paddenstoelen', 'Chili con carne'],
  dislikedTitles: ['Zalm met dille'],
}, {});
assert.ok(v.blocked.includes('Lasagne bolognese'), 'gewoon gerecht 3 weken geleden: geblokkeerd');
assert.ok(!v.blocked.includes('Nasi goreng'), 'gewoon gerecht 9 weken geleden: mag weer');
assert.ok(v.blocked.includes('Pad thai met garnalen'), 'favoriet 2 weken geleden: nog niet');
assert.ok(!v.blocked.includes('Risotto met paddenstoelen'), 'favoriet 5 weken geleden: mag weer');
assert.ok(v.blocked.includes('Zalm met dille'), 'duim omlaag: nooit');
assert.deepEqual(v.favoritesAllowed, ['Risotto met paddenstoelen', 'Chili con carne']);
assert.match(v.recentCuisines, /Italiaans 1x/); assert.match(v.recentCuisines, /Aziatisch 1x/); assert.doesNotMatch(v.recentCuisines, /2x/);

const legacy = buildVariety({}, { generationHistory: ['Oude stamppot'] });
assert.ok(legacy.blocked.includes('Oude stamppot'), 'oude app-versie: titels tellen als recent');

const week = [
  { title: 'Kip tikka', main_ingredient: 'kip', cuisine: 'Indiaas' },
  { title: 'Kipsaté', main_ingredient: 'Kip', cuisine: 'Aziatisch' },
  { title: 'Risotto met paddenstoelen', main_ingredient: 'rijst', cuisine: 'Italiaans' },
];
assert.match(conflictReason({ title: 'Kip pesto', main_ingredient: 'kip' }, week, v), /hoofdingrediënt/);
assert.match(conflictReason({ title: 'Chili con carne', main_ingredient: 'rundvlees' }, week, v), /favoriet/);
assert.match(conflictReason({ title: 'Lasagne bolognese al forno', main_ingredient: 'gehakt' }, week, v), /recent gegeten/);
assert.match(conflictReason({ title: 'Zalm met verse dille', main_ingredient: 'zalm' }, week, v), /afgekeurd/);
assert.match(conflictReason({ title: 'Penne arrabbiata', cuisine: 'italiaans' }, [...week, { title: 'Pizza', cuisine: 'Italiaans' }, { title: 'Gnocchi', cuisine: 'Italiaans' }], v), /keuken/);
assert.equal(conflictReason({ title: 'Nasi goreng', main_ingredient: 'rijst', cuisine: 'Aziatisch' }, week, v), null);

// --- 2. Weekmenu van begin tot eind --------------------------------------
const sqlite = new DatabaseSync(':memory:');
class Stmt { constructor(sql, args = []) { this.sql = sql; this.args = args; } bind(...a) { return new Stmt(this.sql, a); }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; } async first() { return sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async run() { sqlite.prepare(this.sql).run(...this.args); return {}; } }
const env = { DB: { prepare: s => new Stmt(s), async batch(st) { for (const s of st) await s.run(); } }, PHOTOS: {}, AI: {}, ASSETS: {}, GEMINI_API_KEY: 'k', LIMITS: 'off' };
let queue = [], systems = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('/api')) return worker.fetch(new Request('https://k' + url, init), env);
  systems.push(JSON.parse(init.body).systemInstruction.parts[0].text);
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(queue.shift()) }] } }] }));
};
const M = (title, main, cuisine) => ({ title, main_ingredient: main, cuisine });
queue = [
  { zero_waste_report: '', days: [
    M('Kip tikka masala', 'kip', 'Indiaas'),
    M('Lasagne bolognese', 'gehakt', 'Italiaans'),      // recent gegeten
    M('Kipsaté met rijst', 'kip', 'Aziatisch'),
    M('Kip pesto pasta', 'kip', 'Italiaans'),           // 3e keer kip
    M('Chili con carne', 'rundvlees', 'Mexicaans'),     // favoriet 1 (mag)
    M('Risotto met paddenstoelen', 'rijst', 'Italiaans'), // favoriet 2 (te veel)
    M('Zalm met dille', 'zalm', 'Hollands'),            // duim omlaag
  ] },
  // Correcties lopen tegelijk: eerst één voorstel per dag (1, 3, 5, 6), daarna de herkansing.
  M('Shakshuka', 'ei', 'Midden-Oosters'),             // vervangt lasagne
  M('Kip kerrie', 'kip', 'Hollands'),                 // poging 1 voor dag 3: weer kip -> afgekeurd
  M('Gado gado', 'tofu', 'Aziatisch'),                // vervangt risotto
  M('Kabeljauw met mosterdsaus', 'kabeljauw', 'Hollands'), // vervangt zalm
  M('Linzensoep', 'linzen', 'Midden-Oosters'),        // poging 2 voor dag 3
];
const r = await (await worker.fetch(new Request('https://k/api/weekly-plan', { method: 'POST', body: JSON.stringify({
  prefs: { dayModes: {} }, favoriteTitles: ['Chili con carne', 'Risotto met paddenstoelen', 'Pad thai met garnalen'],
  history: [{ title: 'Lasagne bolognese', weeksAgo: 2 }, { title: 'Pad thai met garnalen', weeksAgo: 1 }],
  dislikedTitles: ['Zalm met dille'],
}) }), env)).json();
const titles = r.days.map(d => d.title);
// Volgorde op houdbaarheid (1x per week boodschappen): kip en vlees eerst, peulvruchten later; weekend: vis eerst.
assert.deepEqual(titles, ['Kip tikka masala', 'Kipsaté met rijst', 'Chili con carne', 'Shakshuka', 'Linzensoep', 'Kabeljauw met mosterdsaus', 'Gado gado']);
assert.match(systems[0], /NIET GEBRUIKEN[^\n]*Lasagne bolognese[^\n]*Zalm met dille|NIET GEBRUIKEN[^\n]*Zalm met dille[^\n]*Lasagne bolognese/);
assert.match(systems[0], /FAVORIETEN die weer mogen[^\n]*Chili con carne/);
assert.doesNotMatch(systems[0].split('FAVORIETEN die weer mogen')[1].split('\n')[0], /Pad thai/);
assert.match(systems.find(s => s.includes('vorige voorstel werd afgekeurd')), /hoofdingrediënt kip/);
assert.ok(r.days.every(d => d.id), 'alles opgeslagen');
assert.equal(r.days[4].main_ingredient, 'peulvruchten', 'linzen -> vaste lijst');
assert.equal(r.days[5].main_ingredient, 'witvis', 'kabeljauw -> witvis');

// --- 3. Geschiedenis in de app ---------------------------------------------
const ls = new Map([['qook_prefs', JSON.stringify({ generationHistory: ['Oude stamppot'] })]]);
globalThis.localStorage = { getItem: k => ls.get(k) ?? null, setItem: (k, val) => ls.set(k, String(val)) };
const hist = await import('./history.mjs');
assert.deepEqual(hist.getRecentHistory().map(h => [h.title, h.weeksAgo]), [['Oude stamppot', 2]], 'overstap van oude geschiedenis');
hist.recordPlanned([{ title: 'Shakshuka', cuisine: 'Midden-Oosters' }, { title: '' }]);
const recent = hist.getRecentHistory();
assert.deepEqual(recent.map(h => [h.title, h.weeksAgo]), [['Oude stamppot', 2], ['Shakshuka', 0]]);
const stored = JSON.parse(ls.get('qook_meal_history'));
stored.push({ title: 'Heel oud', date: new Date(Date.now() - 20 * 7 * 864e5).toISOString() });
ls.set('qook_meal_history', JSON.stringify(stored));
assert.ok(!hist.getRecentHistory().some(h => h.title === 'Heel oud'), 'ouder dan 12 weken niet meesturen');

// Service stuurt geschiedenis + afgekeurde gerechten mee en onthoudt het nieuwe menu
const taste = await import('./taste.mjs');
taste.recordTaste('Zalm met dille', 'disliked');
taste.recordTaste('Kip pesto', 'disliked'); taste.recordTaste('Kip pesto', 'liked');
const svc = await import('./service.mjs');
let sent;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) === '/api/weekly-plan') { sent = JSON.parse(init.body); return new Response(JSON.stringify({ days: [M('Bami goreng', 'kip', 'Aziatisch')] })); }
  return realFetch(url, init);
};
await svc.generateWeeklyPlan({ dayModes: {} });
assert.ok(sent.history.some(h => h.title === 'Shakshuka'));
assert.deepEqual(sent.dislikedTitles, ['Zalm met dille'], 'laatste keuze telt (kip pesto later wel lekker)');
assert.ok(hist.getRecentHistory().some(h => h.title === 'Bami goreng'), 'nieuw menu onthouden');

console.log('VARIATIE OVER WEKEN: ALLE TESTS GESLAAGD');
