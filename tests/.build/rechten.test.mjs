// Rechten per abonnement op de server: bank-only voor bezoeker/gratis/basic/proef, limieten, proef = Premium.
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import worker from './worker.mjs';

const sqlite = new DatabaseSync(':memory:');
class Stmt { constructor(sql, args = []) { this.sql = sql; this.args = args; } bind(...a) { return new Stmt(this.sql, a); }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; } async first() { return sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async run() { sqlite.prepare(this.sql).run(...this.args); return {}; } }
const env = { DB: { prepare: s => new Stmt(s), async batch(st) { for (const s of st) await s.run(); } }, PHOTOS: {}, AI: {}, ASSETS: {},
  GEMINI_API_KEY: 'k', PASSWORD_ITERATIONS: '10000' };

let calls = [];
const ok = (o) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] } }] }));
let gen = 0;
globalThis.fetch = async (url, init) => {
  const sys = JSON.parse(init.body).systemInstruction.parts[0].text;
  calls.push(sys);
  if (sys.includes('BESTAANDE recepten')) return ok({ picks: [0, 1, 2, 3, 4, 5, 6], zero_waste_report: 'zw' });
  if (sys.includes('7-daags menu')) { const n = (sys.match(/Je maakt (\d+) gerecht/) || [])[1] || 7;
    return ok({ days: Array.from({ length: Number(n) }, () => ({ title: `Nieuwgerecht${gen++}x`, main_ingredient: ['kip', 'zalm', 'tofu', 'ei', 'kaas', 'gehakt', 'wild'][gen % 7], cuisine: ['Frans', 'Thais', 'Indiaas', 'Grieks', 'Japans', 'Hollands', 'Mexicaans'][gen % 7] })) }); }
  if (sys.includes('vervangt een specifiek gerecht')) return ok({ title: `Vervanger${gen++}x`, main_ingredient: 'eend', cuisine: 'Frans' });
  if (sys.includes('koelkast')) return ok({ recognizedItems: ['ei'], suggestions: [] });
  if (sys.includes('Sous-chef')) return ok({ reply: 'ok', diet: null });
  throw new Error('onverwacht');
};
const post = async (path, body, { cookie = '', ip = '9.9.9.9' } = {}) => {
  const r = await worker.fetch(new Request('https://q.test/api/' + path, { method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }), env);
  return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie') };
};
const prefs = { language: 'nl-NL', region: 'NL', diet: ['Geen'], cookingTime: '45', weekendCookingTime: 'unlimited', dayModes: {} };

// --- 1. Lege bank: bezoeker krijgt AI-aanvulling, maar max 2x per dag ---------------
calls = [];
let r = await post('weekly-plan', { prefs });
assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.days.length, 7);
assert.equal(calls.length, 1, 'één AI-aanroep voor de hele week (bank leeg)');
r = await post('weekly-plan', { prefs, history: r.data.days.map(d => ({ title: d.title, weeksAgo: 0 })) });
assert.equal(r.status, 200);
// derde keer: de bank heeft nu 14 gerechten, maar deze zijn net gegeten -> AI nodig -> daglimiet
r = await post('weekly-plan', { prefs, history: (await sqlite.prepare('SELECT title FROM recipes').all()).map(x => ({ title: x.title, weeksAgo: 0 })) });
assert.equal(r.status, 503); assert.match(r.data.detail, /even geen nieuwe gerechten/);

// --- 2. Gevulde bank: bezoeker krijgt menu zonder AI -------------------------------
const MAINS = ['kip', 'rundvlees', 'varkensvlees', 'zalm', 'witvis', 'peulvruchten', 'tofu', 'ei', 'kaas', 'gehakt', 'wild', 'zeevruchten'];
const CUIS = ['Hollands', 'Italiaans', 'Indiaas', 'Thais', 'Mexicaans', 'Frans', 'Japans', 'Grieks', 'Chinees', 'Marokkaans'];
for (let n = 0; n < 60; n++) {
  const mode = n % 4 === 0 ? 'culinary' : 'premium';
  sqlite.prepare(`INSERT INTO recipes (id, title, data, mode, main, cuisine, diet_tags, kid, minutes) VALUES (?, ?, ?, ?, ?, ?, ',', 1, ?)`)
    .run(`b${n}`, `Bankgerecht x${n}`, JSON.stringify({ title: `Bankgerecht x${n}`, short_description: 'lekker', main_ingredient: MAINS[n % 12], cuisine: CUIS[n % 10] }),
      mode, MAINS[n % 12], CUIS[n % 10], 20 + (n % 3) * 10);
}
calls = [];
r = await post('weekly-plan', { prefs }, { ip: '8.8.8.8' });
assert.equal(r.status, 200); assert.equal(calls.length, 0, 'geen AI: alles uit de bank');
assert.ok(r.data.days.every(d => d.id && d.title));
await post('weekly-plan', { prefs }, { ip: '8.8.8.8' });
await post('weekly-plan', { prefs }, { ip: '8.8.8.8' });
r = await post('weekly-plan', { prefs }, { ip: '8.8.8.8' });
assert.equal(r.status, 402, 'bezoeker: max 3 menu\'s per dag per adres'); assert.equal(r.data.limit, true);

// Vervangen als bezoeker: uit de bank, zonder AI
calls = [];
r = await post('replace-meal', { prefs: { ...prefs, currentWeek: [] }, dayIndex: 1, currentMeal: { id: 'b1', title: 'Bankgerecht x1' } }, { ip: '8.8.8.8' });
assert.equal(r.status, 200); assert.equal(calls.length, 0);

// --- 3. Proefaccount: Premium-rechten, maar alles uit de bank -----------------------
r = await post('auth/register', { name: 'Proef', email: 'proef@q.test', password: 'Wachtwoord1' }, { ip: '7.7.7.7' });
assert.equal(r.status, 201); assert.equal(r.data.user.subscription, 'premium'); assert.ok(r.data.user.trial_started_at);
const trial = r.cookie.split(';')[0];
calls = [];
r = await post('weekly-plan', { prefs, tasteProfile: 'x' }, { cookie: trial });
assert.equal(r.status, 200); assert.equal(calls.length, 0, 'proef: geen AI-keuze');
r = await post('weekly-plan', { prefs }, { cookie: trial });
assert.equal(r.status, 200);
r = await post('weekly-plan', { prefs }, { cookie: trial });
assert.equal(r.status, 200);
r = await post('weekly-plan', { prefs }, { cookie: trial });
assert.equal(r.status, 402, 'proef: 3 per week (eerste + automatisch + 1 extra)'); assert.match(r.data.detail, /1x per week/);
for (let i = 0; i < 10; i++) {
  r = await post('replace-meal', { prefs: { ...prefs, currentWeek: [] }, dayIndex: 2, currentMeal: { id: 'b2', title: 'Bankgerecht x2' } }, { cookie: trial });
  assert.equal(r.status, 200, 'proef: ruim vervangen');
}
assert.equal(calls.length, 0);
r = await post('fridge-scan', { image: 'QUJD', prefs }, { cookie: trial });
assert.equal(r.status, 200);
r = await post('fridge-scan', { image: 'QUJD', prefs }, { cookie: trial });
assert.equal(r.status, 402, 'proef: 1 scan per week'); assert.match(r.data.detail, /koelkastscan/);

// Proef voorbij -> gratis (3 vervangingen per week)
sqlite.prepare("UPDATE users SET trial_started_at = ? WHERE email = 'proef@q.test'").run(new Date(Date.now() - 15 * 864e5).toISOString());
const me = await worker.fetch(new Request('https://q.test/api/auth/me', { headers: { cookie: trial } }), env).then(x => x.json());
assert.equal(me.user.subscription, 'free'); assert.equal(me.user.trial_started_at, null);
let codes = [];
for (let i = 0; i < 4; i++) codes.push((await post('replace-meal', { prefs: { ...prefs, currentWeek: [] }, dayIndex: 2, currentMeal: { id: 'b2', title: 'Bankgerecht x2' } }, { cookie: trial })).status);
assert.deepEqual(codes, [200, 200, 200, 402]);

// --- 4. Basic: elke week automatisch, niet zelf (max 2 per week op de server) ---------
await post('account/subscription', { tier: 'basic' }, { cookie: trial });
r = await post('weekly-plan', { prefs }, { cookie: trial });
assert.equal(r.status, 200);
r = await post('weekly-plan', { prefs }, { cookie: trial });
assert.equal(r.status, 200);
r = await post('weekly-plan', { prefs }, { cookie: trial });
assert.equal(r.status, 402); assert.match(r.data.detail, /elke week automatisch/);

// --- 5. Premium: AI stemt het menu af -------------------------------------------------
await post('account/subscription', { tier: 'premium' }, { cookie: trial });
calls = [];
r = await post('weekly-plan', { prefs }, { cookie: trial });
assert.equal(r.status, 200);
assert.ok(calls.some(c => c.includes('BESTAANDE recepten')), 'premium: AI-keuze uit de bank');
for (let i = 0; i < 6; i++) assert.equal((await post('fridge-scan', { image: 'QUJD', prefs }, { cookie: trial })).status, 200, 'premium: onbeperkt scannen');

// --- 6. Chat-limiet bezoeker ------------------------------------------------------------
codes = [];
for (let i = 0; i < 6; i++) codes.push((await post('chat', { messages: [], message: 'hoi' }, { ip: '6.6.6.6' })).status);
assert.deepEqual(codes, [200, 200, 200, 200, 200, 402]);

// --- 7. Opruimen van oude tellers --------------------------------------------------------
sqlite.prepare("INSERT INTO usage_counters (key, count, expires_at) VALUES ('oud', 1, 0)").run();
await worker.scheduled({}, { ...env, GEMINI_API_KEY: '' }, { waitUntil: () => {} });
await new Promise(r => setTimeout(r, 20));
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM usage_counters WHERE key = 'oud'").get().n, 0);

console.log('RECHTEN PER ABONNEMENT: ALLE TESTS GESLAAGD');
