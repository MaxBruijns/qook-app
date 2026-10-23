// End-to-end test: originele app-functies (geminiService) -> Worker -> nagebootste Cloudflare + Gemini.
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import worker from './worker.mjs';

// --- Cloudflare nabootsen ---
const sqlite = new DatabaseSync(':memory:');
class Stmt {
  constructor(sql, args = []) { this.sql = sql; this.args = args; }
  bind(...a) { return new Stmt(this.sql, a); }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; }
  async first() { return sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async run() { sqlite.prepare(this.sql).run(...this.args); return { success: true }; }
}
const DB = { prepare: s => new Stmt(s), async batch(st) { for (const s of st) await s.run(); } };
const r2 = new Map();
const PHOTOS = { async put(k, v) { r2.set(k, v); }, async get(k) { return r2.has(k) ? { body: r2.get(k) } : null; } };
let aiCalls = 0;
const AI = { async run(_m, input) { aiCalls++; assert.match(input.prompt, /professional food photography shot of/); await new Promise(r => setTimeout(r, 20)); return { image: Buffer.from('jpeg').toString('base64') }; } };
const env = { DB, PHOTOS, AI, ASSETS: { fetch: () => new Response('app') }, GEMINI_API_KEY: 'k', LIMITS: 'off' };

// --- Browser nabootsen ---
const ls = new Map();
globalThis.localStorage = { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, String(v)) };
globalThis.Image = class { set src(_) { setTimeout(() => this.onerror && this.onerror()); } };

// --- Gemini nabootsen ---
let gemini = 0, lastSystem = '', lastUser = null, reply;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('/api')) return worker.fetch(new Request('https://kooq.test' + url, init), env);
  assert.match(String(url), /generativelanguage/);
  gemini++;
  const body = JSON.parse(init.body);
  lastSystem = body.systemInstruction.parts[0].text; lastUser = body.contents[0].parts;
  const r = reply(body);
  if (r instanceof Response) return r;
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(r) }] } }] }));
};

const svc = await import('./service.mjs');
const meal = (t, x = {}) => ({ title: t, short_description: 'lekker', ai_image_prompt: 'on a plate', estimated_time_minutes: 25, difficulty: 'Makkelijk', calories_per_portion: 550, chefs_hack: 'tip', wine_pairing: { type: 'Rioja', description: 'past' }, plating_tips: 'netjes', mode: 'premium', ...x });
const prefs = { language: 'nl-NL', adultsCount: 2, childrenCount: 1, diet: ['Vegetarisch'], budget: 'Normaal', cookingTime: '30', weekendCookingTime: 'unlimited', zeroWasteLevel: 70,
  dayModes: { 0: 'premium', 1: 'premium', 2: 'premium', 3: 'premium', 4: 'premium', 5: 'culinary', 6: 'culinary' }, generationHistory: ['Oude lasagne'] };

// 1. Weekmenu
const titles = ['Pasta pesto', 'Groene curry', 'Linzensoep', 'Frittata', 'Shakshuka', 'Risotto', 'Wellington'];
reply = () => ({ zero_waste_report: 'spinazie 2x', days: titles.map(t => meal(t)) });
const plan = await svc.generateWeeklyPlan(prefs, ['Favoriet X']);
assert.equal(plan.days.length, 7);
assert.equal(plan.zero_waste_report, 'spinazie 2x');
assert.ok(plan.generatedAt);
assert.equal(plan.days[0].servings, 3);
assert.equal(plan.days[0].mode, 'premium'); assert.equal(plan.days[5].mode, 'culinary');
assert.ok(plan.days.every(d => d.id && d.wine_pairing && d.difficulty));
assert.equal(plan.days[0].generated_image_url, undefined);
assert.match(lastSystem, /Day 5: culinary/); assert.match(lastSystem, /Weekprofiel/); assert.match(lastSystem, /Oude lasagne/); assert.match(lastSystem, /Favoriet X/);
assert.match(lastSystem, /Vegetarisch/); assert.match(lastSystem, /70%/); assert.match(lastSystem, /Nederlands/);

// 2. Foto: één keer, gecachet, ook bij gelijktijdige aanvragen
const [u1, u2] = await Promise.all([svc.generateMealImage('Pasta pesto', 'x'), svc.generateMealImage('Pasta pesto', 'x')]);
assert.equal(u1, `/api/images/${plan.days[0].id}.jpg`); assert.equal(u2, u1);
assert.equal(aiCalls, 1);
assert.equal(await svc.generateMealImage('Pasta pesto', 'x'), u1);
assert.equal(aiCalls, 1);
const img = await worker.fetch(new Request(`https://kooq.test${u1}`), env);
assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/jpeg');
// Geen foto: geen stockfoto van iets anders, maar null (het scherm toont een neutrale plek).
assert.equal(await svc.generateMealImage('Onbekend gerecht', 'x'), null);
assert.equal(svc.realPhoto('/api/ext/unsplash/photo-1546069901-ba9599a7e63c?w=800'), undefined, 'oude stockfoto genegeerd');
assert.equal(svc.realPhoto('/api/images/abc.jpg'), '/api/images/abc.jpg');
assert.equal(aiCalls, 1, 'geen foto voor gerechten buiten de bank');

// 3. Nieuw menu met bekend gerecht -> hergebruik incl. foto
// (andere gebruiker: eigen geschiedenis is leeg, het gerecht staat wel in de gedeelde receptenbank)
ls.delete('qook_meal_history');
reply = () => ({ zero_waste_report: '', days: [meal('Pasta pesto'), meal('Nieuw'), meal('Andijviestamppot'), meal('Tomatensoep'), meal('Bami goreng'), meal('Sushi bowl'), meal('Paella')] });
const plan2 = await svc.generateWeeklyPlan(prefs);
assert.equal(plan2.days[0].id, plan.days[0].id);
assert.equal(plan2.days[0].generated_image_url, u1);

// 4. Volledig recept: omgerekend naar 3 personen, daarna uit de bank
reply = () => ({ ingredients: [{ name: 'Pasta', amount: 400, unit: 'g' }, { name: 'Ei', amount: 4, unit: 'st' }],
  steps: [{ step_index: 1, user_text: 'Kook de pasta', needs_timer: true, timer_label: 'Pasta koken', estimated_duration_seconds: 600 }],
  supplies: ['Pan'], nutrition: { calories: 560 }, plating_tips: 'draai', wine_pairing: { type: 'Soave', description: 'fris' } });
const g0 = gemini;
const full = await svc.generateFullRecipe(plan.days[0], prefs);
assert.equal(full.servings, 3);
assert.deepEqual(full.ingredients.map(i => i.amount), [300, '3']);
assert.equal(full.steps[0].timer_label, 'Pasta koken');
assert.deepEqual(full.supplies, ['Pan']);
assert.equal(full.wine_pairing.type, 'Soave');
assert.equal(full.base_servings, undefined);
assert.equal(full.title, 'Pasta pesto');
assert.match(lastSystem, /NOOIT een timer voor de oven/); assert.match(lastSystem, /4 personen/);
const full2 = await svc.generateFullRecipe(plan.days[0], { ...prefs, adultsCount: 4, childrenCount: 2 });
assert.equal(gemini, g0 + 1, 'tweede keer uit de bank');
assert.deepEqual(full2.ingredients.map(i => i.amount), [600, '6']);

// 5. Vervangen: modus volgt de dag
reply = () => meal('Truffel risotto');
const rep = await svc.replaceMeal(plan.days[6], prefs, 6, []);
assert.equal(rep.mode, 'culinary'); assert.equal(rep.servings, 3); assert.ok(rep.id);
assert.match(lastSystem, /Wellington/); assert.match(lastSystem, /Maximaal unlimited min/);

// 6. Boodschappenlijst gebruikt het bewaarde recept, omgerekend
// Linzensoep is nog niet geopend: het recept wordt eerst gemaakt, daarna telt de code alles op.
reply = () => ({ ingredients: [{ name: 'Linzen', amount: 300, unit: 'gram', category: 'Pasta, rijst & granen' },
  { name: 'Ei', amount: 2, unit: 'stuks' }, { name: 'Olijfolie', amount: 2, unit: 'eetlepel' }, { name: 'Zout', amount: 0, unit: 'naar smaak' }],
  steps: [{ user_text: 'Kook' }] });
const g1 = gemini;
const shop = await svc.generateShoppingList([plan.days[0], plan.days[2]], prefs);
assert.equal(gemini, g1 + 1, 'alleen het ontbrekende recept');
const byName = Object.fromEntries(shop.map(i => [i.name, i]));
assert.deepEqual([byName.Pasta.amount, byName.Pasta.unit], [300, 'gram']);
assert.deepEqual([byName.Linzen.amount, byName.Linzen.unit, byName.Linzen.category], [225, 'gram', 'Pasta, rijst & granen']);
assert.deepEqual([byName.Ei.amount, byName.Ei.unit], [5, 'stuks'], '3 + 1,5 eieren -> 5 kopen');
assert.deepEqual([byName.Olijfolie.amount, byName.Olijfolie.unit], [2, 'eetlepels']);
assert.equal(byName.Zout.amount, 0);
assert.equal(shop[0].id, 'it-0'); assert.equal(shop[0].checked, false);

// 7. Koelkastscan
reply = (b) => { assert.equal(b.contents[0].parts[0].inline_data.data, 'QUJD'); return { recognizedItems: ['Ei', 'Spinazie'], suggestions: [meal('Omelet'), meal('Quiche'), meal('Salade')] }; };
const scan = await svc.analyzeFridgeImage('QUJD', prefs);
assert.deepEqual(scan.recognizedItems, ['Ei', 'Spinazie']);
assert.equal(scan.suggestions.length, 3); assert.equal(scan.suggestions[0].mode, 'magic'); assert.ok(scan.suggestions[0].id);
assert.equal(await svc.generateMealImage('Omelet', 'x'), `/api/images/${scan.suggestions[0].id}.jpg`);

// 8. Chat
reply = () => ({ reply: 'Top, vegan dan!', diet: ['Vegan'] });
const c = await svc.sendChatMessage({ messages: [{ sender: 'assistant', text: 'Hoi' }], message: 'Maak het vegan', userStatus: 'visitor', currentView: 'dashboard', language: 'nl-NL', diet: [] });
assert.deepEqual(c, { reply: 'Top, vegan dan!', diet: ['Vegan'] });

// 9. Fouten
reply = () => new Response('quota', { status: 429 });
await assert.rejects(svc.generateWeeklyPlan(prefs), /daglimiet/);
assert.deepEqual(await svc.analyzeFridgeImage('QUJD', prefs), { recognizedItems: [], suggestions: [] });
const h = await (await worker.fetch(new Request('https://kooq.test/api/health'), env)).json();
assert.equal(h.gemini_key, 'ingesteld');
assert.equal((await worker.fetch(new Request('https://kooq.test/'), env).then(r => r.text())), 'app');

console.log(`ALLE TESTS GESLAAGD — Gemini-aanroepen: ${gemini}, foto's gegenereerd: ${aiCalls}, recepten in bank: ${sqlite.prepare('SELECT COUNT(*) n FROM recipes').get().n}`);
