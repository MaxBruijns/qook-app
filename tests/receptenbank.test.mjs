// Snelheid & receptenbank: vaste lijsten, migratie, vooraf vullen, kiezen uit de bank,
// vervangen, boodschappen in code, chat-dieet, tijdslimiet/herhaalpoging, webp-foto's.
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import worker, { __t } from './worker.mjs';
const { canonMain, canonCuisine, cleanTitle, aggregateShopping, canonDietList } = __t;

// --- 1. Vaste lijsten en nette titels ---------------------------------------
assert.equal(canonMain('hert'), 'wild');
assert.equal(canonMain('Hertenbiefstuk'), 'wild');
assert.equal(canonMain('zeebaars'), 'witvis');
assert.equal(canonMain('kabeljauw'), 'witvis');
assert.equal(canonMain('witte bonen'), 'peulvruchten');
assert.equal(canonMain('kipfilet'), 'kip');
assert.equal(canonMain('calamari'), 'zeevruchten');
assert.equal(canonMain('ossenhaas'), 'rundvlees');
assert.equal(canonMain('lamskotelet'), 'lamsvlees');
assert.equal(canonMain('Zalm'), 'zalm');
assert.equal(canonMain(''), '');
assert.equal(canonCuisine('indiaas'), 'Indiaas');
assert.equal(canonCuisine('Turks'), 'Midden-Oosters');
assert.equal(canonCuisine('Nederlands'), 'Hollands');
assert.equal(cleanTitle('Kip Tikka Masala Met Naanbrood'), 'Kip tikka masala met naanbrood');
assert.equal(cleanTitle('Beef Wellington'), 'Beef Wellington');
assert.equal(cleanTitle('pasta pesto met kip'), 'Pasta pesto met kip');
assert.deepEqual(canonDietList(['vegetarisch', 'glutenvrij']), ['Vegetarisch', 'Glutenarm']);
assert.deepEqual(canonDietList([]), ['Geen']);
assert.deepEqual(canonDietList(['geen']), ['Geen']);

// --- 2. Boodschappen optellen ------------------------------------------------
const shop = aggregateShopping([
  { factor: 1, details: { ingredients: [
    { name: 'Kipfilet', amount: 600, unit: 'gram', category: 'Vlees, vis & vega' },
    { name: 'Knoflook', amount: 3, unit: 'tenen' }, { name: 'Olijfolie', amount: 2, unit: 'eetlepel' },
    { name: 'Kokosmelk', amount: 400, unit: 'ml' }, { name: 'Zout', amount: 0, unit: 'naar smaak' },
    { name: 'Rode ui', amount: 1.5, unit: 'stuks' } ] } },
  { factor: 1, details: { ingredients: [
    { name: 'kipfilet', amount: 520, unit: 'g' }, { name: 'Knoflook', amount: 4, unit: 'teen' },
    { name: 'Olijfolie', amount: 100, unit: 'ml' }, { name: 'Rode ui', amount: 2, unit: 'stuk' },
    { name: 'Komijn', amount: 1, unit: 'theelepel' } ] } },
]);
const S = Object.fromEntries(shop.map(i => [i.name, i]));
assert.deepEqual([S.Kipfilet.amount, S.Kipfilet.unit], [1.2, 'kg'], '1120 g -> 1,2 kg');
assert.deepEqual([S.Knoflook.amount, S.Knoflook.unit], [1, 'bol'], '7 tenen -> 1 bol');
assert.deepEqual([S.Olijfolie.amount, S.Olijfolie.unit], [150, 'ml'], '100 ml + 2 el');
assert.deepEqual([S['Rode ui'].amount, S['Rode ui'].unit], [4, 'stuks'], '3,5 uien -> 4');
assert.deepEqual([S.Komijn.amount, S.Komijn.unit, S.Komijn.category], [1, 'theelepel', 'Voorraadkast: heb je dit nog in huis?']);
assert.equal(S.Olijfolie.category, 'Voorraadkast: heb je dit nog in huis?');
assert.equal(S.Kokosmelk.category, 'Conserven & sauzen', 'blik/pak kopen: gewoon op de lijst');
assert.equal(shop.at(-1).category, 'Voorraadkast: heb je dit nog in huis?', 'voorraadkast onderaan');
// Restjes: in welke dagen een ingrediënt terugkomt
const withDays = aggregateShopping([
  { factor: 1, day: 0, details: { ingredients: [{ name: 'Bloemkool', amount: 1, unit: 'stuk' }, { name: 'Zalm', amount: 300, unit: 'gram' }, { name: 'Zout', amount: 0, unit: 'naar smaak' }] } },
  { factor: 1, day: 3, details: { ingredients: [{ name: 'bloemkool', amount: 0.5, unit: 'stuk' }, { name: 'Zout', amount: 0, unit: 'naar smaak' }] } },
]);
const D = Object.fromEntries(withDays.map(i => [i.name, i]));
assert.deepEqual(D.Bloemkool.used_in, [0, 3]); assert.equal(D.Bloemkool.amount, 2, '1,5 bloemkool -> 2 kopen');
assert.equal(D.Zalm.used_in, undefined, 'maar in één gerecht');
assert.equal(D.Zout.used_in, undefined, 'voorraadkast niet');
assert.deepEqual([S.Zout.amount, S.Zout.unit], [0, '']);
assert.equal(shop[0].category, 'Groente & fruit', 'gesorteerd op winkelvolgorde');
assert.ok(shop.findIndex(i => i.name === 'Kipfilet') < shop.findIndex(i => i.name === 'Kokosmelk'));

// --- 3. Nagebootste Cloudflare ----------------------------------------------
const sqlite = new DatabaseSync(':memory:');
class Stmt { constructor(sql, args = []) { this.sql = sql; this.args = args; } bind(...a) { return new Stmt(this.sql, a); }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; } async first() { return sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async run() { sqlite.prepare(this.sql).run(...this.args); return {}; } }
const r2 = new Map();
let aiImages = 0, transforms = 0;
const IMAGES = { input: () => ({ transform: (o) => { assert.equal(o.width, 800); return { output: async (o2) => {
  assert.equal(o2.format, 'image/webp'); transforms++; return { response: () => new Response('WEBP') }; } }; } }) };
const env = {
  DB: { prepare: s => new Stmt(s), async batch(st) { for (const s of st) await s.run(); } },
  PHOTOS: { async put(k, v, o) { r2.set(k, { body: v, type: o?.httpMetadata?.contentType }); },
            async get(k) { const o = r2.get(k); return o ? { body: o.body, httpMetadata: { contentType: o.type }, arrayBuffer: async () => new Uint8Array(o.body).buffer } : null; } },
  AI: { async run() { aiImages++; return { image: Buffer.from('jpeg').toString('base64') }; } },
  IMAGES, ASSETS: {}, GEMINI_API_KEY: 'k', LIMITS: 'off',
};

// Oude database (vóór deze versie) met één gerecht
sqlite.exec(`CREATE TABLE recipes (id TEXT PRIMARY KEY, title TEXT NOT NULL, data TEXT NOT NULL, details TEXT,
  has_image INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
sqlite.prepare(`INSERT INTO recipes (id, title, data, details) VALUES ('old', 'Oude curry', ?, ?)`)
  .run(JSON.stringify({ mode: 'premium', main_ingredient: 'Kip', cuisine: 'Indiaas', estimated_time_minutes: 25 }), JSON.stringify({ v: 3, ingredients: [] }));

// Gemini-nabootsing: antwoord op basis van de opdracht
let calls = [], seedNo = 0, pickReply = null, failNext = 0, genReply = null;
const MAINS = ['kip', 'rundvlees', 'varkensvlees', 'zalm', 'witvis', 'peulvruchten', 'tofu', 'ei', 'kaas', 'gehakt', 'wild', 'zeevruchten'];
const CUIS = ['Hollands', 'Italiaans', 'Indiaas', 'Thais', 'Mexicaans', 'Frans', 'Japans', 'Grieks', 'Chinees', 'Marokkaans'];
const WORDS = ['appel', 'bosui', 'citroen', 'dragon', 'ementaler', 'framboos', 'gember', 'hazelnoot', 'ijsbergsla', 'jeneverbes', 'kappertjes',
  'limoen', 'mango', 'nootmuskaat', 'olijven', 'pompoen', 'quinoa', 'rozemarijn', 'salie', 'tijm', 'uitjes', 'venkel', 'walnoot', 'yuzu', 'zuurkool'];
const ok = (out) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }));
globalThis.fetch = async (url, init) => {
  if (init?.signal?.aborted) throw init.signal.reason;
  const sys = JSON.parse(init.body).systemInstruction.parts[0].text;
  const user = JSON.parse(init.body).contents[0].parts.at(-1).text;
  calls.push({ sys, user, model: String(url).match(/models\/([^:]+):/)[1] });
  if (failNext > 0) { failNext--; return new Response('kapot', { status: 503 }); }
  if (sys.includes('receptenbank van Qook')) {
    const mode = /Modus: (\w+)/.exec(sys)[1];
    const kids = sys.includes('kindvriendelijk');
    const veg = sys.includes('vegetarisch (ongeveer') || sys.includes('vegetarische gerechten');
    return ok({ meals: Array.from({ length: 8 }, () => {
      const n = seedNo++;
      return { title: `Schotel x${n}${WORDS[n % 25]}`,
        short_description: 'lekker', ai_image_prompt: 'plate', estimated_time_minutes: 15 + (n % 4) * 10,
        main_ingredient: veg ? ['peulvruchten', 'tofu', 'ei', 'kaas'][n % 4] : MAINS[n % MAINS.length],
        cuisine: CUIS[n % CUIS.length], diet_tags: veg ? ['vegetarisch'] : [], kid_friendly: kids || n % 3 === 0, mode };
    }) });
  }
  if (sys.includes('BESTAANDE recepten')) return pickReply ? pickReply(user) : new Response('x', { status: 500 });
  if (sys.includes('volledig, foutloos recept')) return ok({ ingredients: [{ name: 'Ui', amount: 1, unit: 'stuks', category: 'Groente & fruit' }], steps: [{ user_text: 'Serveer' }] });
  if (sys.includes('7-daags menu')) return ok(genReply(sys));
  if (sys.includes('vervangt een specifiek gerecht')) return ok(genReply(sys));
  if (sys.includes('Sous-chef')) return ok({ reply: 'Prima', diet: ['vegetarisch'] });
  throw new Error('onverwachte opdracht');
};
const post = async (p, body, ctx) => { const r = await worker.fetch(new Request('https://k/api/' + p, { method: 'POST', body: JSON.stringify(body) }), env, ctx);
  return { status: r.status, data: await r.json() }; };

// --- 4. Migratie ------------------------------------------------------------
let h = await (await worker.fetch(new Request('https://k/api/health'), env)).json();
assert.equal(h.recipe_bank.total, 1);
assert.equal(h.recipe_bank.with_recipe, 1, 'oud recept (v3) blijft bruikbaar');
const old = sqlite.prepare("SELECT mode, main, cuisine, minutes, details_v FROM recipes WHERE id = 'old'").get();
assert.deepEqual({ ...old }, { mode: 'premium', main: 'kip', cuisine: 'Indiaas', minutes: 25, details_v: 3 });
assert.equal(h.images, 'webp');

// --- 5. Vooraf vullen (cron) ------------------------------------------------
let waits = [];
await worker.scheduled({}, env, { waitUntil: p => waits.push(p) });
await Promise.all(waits);
let n = sqlite.prepare('SELECT COUNT(*) n FROM recipes WHERE seed_cat IS NOT NULL').get().n;
assert.equal(n, 8, 'eerste ronde: 8 nieuwe gerechten');
assert.equal(calls.filter(c => c.model === 'gemini-3.8-flash').length, 2, '2 volledige recepten per ronde');
assert.equal(aiImages, 1, '1 foto per ronde');
const photo = [...r2.values()][0];
assert.equal(photo.type, 'image/webp'); assert.equal(transforms, 1);
const firstCat = sqlite.prepare('SELECT DISTINCT seed_cat c FROM recipes WHERE seed_cat IS NOT NULL').get().c;

// Admin-route: zonder sleutel onzichtbaar, met sleutel een ronde
let r = await post('admin/seed', {});
assert.equal(r.status, 404);
env.ADMIN_KEY = 'geheim';
for (let i = 0; i < 9; i++) {
  const res = await worker.fetch(new Request('https://k/api/admin/seed', { method: 'POST', headers: { 'x-admin-key': 'geheim' }, body: JSON.stringify({ details: 0, images: 0 }) }), env);
  assert.equal(res.status, 200);
}
const cats = sqlite.prepare('SELECT seed_cat c, COUNT(*) n FROM recipes WHERE seed_cat IS NOT NULL GROUP BY seed_cat').all();
assert.equal(cats.length, 10, 'elke categorie is aan de beurt geweest (laagste vulgraad eerst)');
assert.ok(cats.every(c => c.n === 8));
const seeded = sqlite.prepare("SELECT title, mode, main, cuisine, diet_tags, kid FROM recipes WHERE seed_cat = 'vega'").all();
assert.ok(seeded.every(s => s.diet_tags.includes(',vegetarisch,') && s.diet_tags.includes(',pescotarisch,')), 'vegetarisch => ook pescotarisch');
assert.ok(sqlite.prepare("SELECT COUNT(*) n FROM recipes WHERE seed_cat = 'kind' AND kid = 1").get().n === 8);
const firstPrompt = calls.find(c => c.sys.includes('receptenbank van Qook')).sys;
assert.match(firstPrompt, /precies één uit: kip, kalkoen/);
// Dubbele titel uit de AI wordt niet nogmaals opgeslagen
seedNo = 0;
await post('admin/seed', {}).catch(() => {});
await worker.fetch(new Request('https://k/api/admin/seed', { method: 'POST', headers: { 'x-admin-key': 'geheim' }, body: JSON.stringify({ details: 0, images: 0 }) }), env);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM recipes WHERE seed_cat IS NOT NULL').get().n, 80, 'herhaalde titels geweigerd');
seedNo = 1000;

// --- 6. Weekmenu uit de bank ------------------------------------------------
const prefs = { language: 'nl-NL', region: 'NL', adultsCount: 2, childrenCount: 0, diet: ['Geen'], cookingTime: '45',
  weekendCookingTime: 'unlimited', weekProfile: 'surprise', kitchenProfiles: [], zeroWasteLevel: 70,
  dayModes: { 0: 'premium', 1: 'premium', 2: 'premium', 3: 'premium', 4: 'premium', 5: 'culinary', 6: 'culinary' }, tasteProfile: '- houdt van pittig' };
const blockedTitle = sqlite.prepare("SELECT title FROM recipes WHERE mode = 'premium' LIMIT 1").get().title;

// 6a. AI kiest uit de korte lijst
calls = [];
let shortlist;
pickReply = (user) => { shortlist = user.split('\n').slice(1).map(l => l.split(' | ')); const prem = shortlist.map((l, i) => [l, i]).filter(([l]) => l[2] === 'premium').map(([, i]) => i);
  const cul = shortlist.map((l, i) => [l, i]).filter(([l]) => l[2] === 'culinary').map(([, i]) => i);
  return ok({ picks: [prem[0], prem[1], prem[2], prem[3], prem[4], cul[0], cul[1]], zero_waste_report: 'Ui komt drie keer terug.' }); };
const hadDetails = new Set(sqlite.prepare('SELECT title FROM recipes WHERE details_v >= 3').all().map(x => x.title));
const ctxWaits = [];
r = await post('weekly-plan', { prefs, history: [{ title: blockedTitle, weeksAgo: 1 }], favoriteTitles: [], dislikedTitles: [] }, { waitUntil: p => ctxWaits.push(p) });
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(r.data.days.length, 7);
assert.equal(calls.filter(c => !c.sys.includes('volledig, foutloos recept')).length, 1, 'maar één AI-aanroep voor het menu (de keuze)');
assert.match(calls[0].sys, /houdt van pittig/); assert.match(calls[0].sys, /Dag 5: culinary/);
assert.match(calls[0].sys, /BOODSCHAPPEN 1x PER WEEK/); assert.match(calls[0].sys, /Zero-waste 70%/);
for (const l of shortlist) {
  if (hadDetails.has(l[1])) assert.match(l.join(' | '), /\| ui$/, 'ingrediënten van gerechten met recept staan erbij');
}
assert.ok(!shortlist.some(l => l[1] === blockedTitle), 'recent gegeten staat niet op de lijst');
assert.equal(r.data.zero_waste_report, 'Ui komt drie keer terug.');
assert.deepEqual(r.data.days.map(d => d.mode), ['premium', 'premium', 'premium', 'premium', 'premium', 'culinary', 'culinary']);
assert.deepEqual(r.data.days.slice(0, 5).map(d => d.title), [0, 1, 2, 3, 4].map(i => r.data.days[i].title));
assert.ok(r.data.days.every(d => d.id && d.title && d.short_description));
const premRows = r.data.days.slice(0, 5).map(d => sqlite.prepare('SELECT mode, minutes, uses FROM recipes WHERE id = ?').get(d.id));
assert.ok(premRows.every(x => x.mode === 'premium' && x.minutes <= 50 && x.uses === 1));
const FRESH = { zeevruchten: 5, witvis: 5, zalm: 5, vis: 5, tonijn: 4, gehakt: 4, kip: 4, kalkoen: 4, eend: 3, paddenstoelen: 3, rundvlees: 3, varkensvlees: 3, lamsvlees: 3, wild: 3, groenten: 2, tofu: 2, kaas: 1, ei: 1, aardappel: 0, peulvruchten: 0, pasta: 0, rijst: 0 };
const fresh = r.data.days.slice(0, 5).map(d => FRESH[d.main_ingredient] ?? 2);
assert.deepEqual(fresh, [...fresh].sort((a, b) => b - a), 'bederfelijk eerst in de week');
await Promise.all(ctxWaits);
const warmed = r.data.days.map(d => sqlite.prepare('SELECT details_v FROM recipes WHERE id = ?').get(d.id).details_v);
assert.ok(warmed.filter(v => v >= 3).length >= 4, 'recepten alvast gemaakt op de achtergrond');

// 6a2. Budget bepaalt de standaard zero-waste; nooit onder 40%
calls = [];
await post('weekly-plan', { prefs: { ...prefs, zeroWasteLevel: undefined, budget: 'Laag' }, history: [] });
assert.match(calls[0].sys, /Zero-waste 80%/); assert.match(calls[0].sys, /goedkope basis/);
calls = [];
await post('weekly-plan', { prefs: { ...prefs, zeroWasteLevel: 10, budget: 'Luxe' }, history: [] });
assert.match(calls[0].sys, /Zero-waste 40%/); assert.match(calls[0].sys, /hoogwaardige ingrediënten/);

// 6b. AI-keuze mislukt -> keuze op score, nog steeds 7 gerechten zonder extra AI
calls = []; pickReply = null;
r = await post('weekly-plan', { prefs, history: [], favoriteTitles: [], dislikedTitles: [] });
assert.equal(r.status, 200); assert.equal(r.data.days.length, 7); assert.equal(calls.length, 1);
const mains = r.data.days.map(d => d.main_ingredient);
for (const m of new Set(mains)) assert.ok(mains.filter(x => x === m).length <= 2, 'hoofdingrediënt max 2x');
const cuis = r.data.days.map(d => d.cuisine);
for (const c of new Set(cuis)) assert.ok(cuis.filter(x => x === c).length <= 2, 'keuken max 2x bij kiezen uit de bank');

// 6c. Kindvriendelijk: alleen kindvriendelijke doordeweekse gerechten
r = await post('weekly-plan', { prefs: { ...prefs, weekProfile: 'kid_friendly' }, history: [] });
for (const d of r.data.days.slice(0, 5)) assert.equal(sqlite.prepare('SELECT kid FROM recipes WHERE id = ?').get(d.id).kid, 1, d.title);

// 6d. Wereldontdekker: elke keuken maar 1x
r = await post('weekly-plan', { prefs: { ...prefs, weekProfile: 'world_explorer' }, history: [] });
assert.equal(new Set(r.data.days.map(d => d.cuisine)).size, 7);

// 6e. Vegetarisch: alleen vegetarisch; culinair vega is er ook
r = await post('weekly-plan', { prefs: { ...prefs, diet: ['Vegetarisch'] }, history: [] });
assert.equal(r.status, 200, JSON.stringify(r.data));
for (const d of r.data.days) assert.match(sqlite.prepare('SELECT diet_tags FROM recipes WHERE id = ?').get(d.id).diet_tags, /,vegetarisch,/);

// 6f. Keto (niet in de bank) -> de AI maakt het hele menu; onboarding-keuzes gaan mee
calls = [];
genReply = () => ({ zero_waste_report: 'zw', days: ['Keto biefstuk', 'Bloemkoolrijst met kip', 'Zalm met spinazie', 'Omelet met spek', 'Courgetti bolognese', 'Eend met sinaasappel', 'Lamsrack met kruidenkorst']
  .map((t, i) => ({ title: t, main_ingredient: ['rundvlees', 'kip', 'zalm', 'ei', 'gehakt', 'eend', 'lamsvlees'][i], cuisine: CUIS[i] })) });
r = await post('weekly-plan', { prefs: { ...prefs, diet: ['Keto'], weekProfile: 'kid_friendly', kitchenProfiles: ['Italiaans'] }, history: [] });
assert.equal(r.status, 200); assert.equal(calls.length, 1);
assert.match(calls[0].sys, /KINDVRIENDELIJK \(STRIKT\)/); assert.match(calls[0].sys, /Favoriete keukens: Italiaans/);
assert.match(calls[0].sys, /Day 0: premium, hoogstens 45 min/); assert.match(calls[0].sys, /Day 6: culinary, hoogstens onbeperkt/);

// 6g. Te weinig culinaire gerechten in de bank -> AI vult alleen die dagen
sqlite.exec("UPDATE recipes SET mode = 'culinary_off' WHERE mode = 'culinary'");
calls = []; pickReply = null;
genReply = (sys) => { assert.match(sys, /AL GEPLAND DEZE WEEK/); return { days: [{ title: 'Eendenborst met kersensaus', main_ingredient: 'eendenborst', cuisine: 'Frans' }, { title: 'Lamsrack met kruidenkorst', main_ingredient: 'lamsrack', cuisine: 'Italiaans' }] }; };
r = await post('weekly-plan', { prefs, history: [] });
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(calls.length, 2, 'keuze + 2 culinaire gerechten in één aanroep');
assert.match(calls[1].sys, /2 gerecht\(en\)/);
assert.deepEqual(r.data.days.slice(5).map(d => [d.title, d.mode, d.main_ingredient]), [['Eendenborst met kersensaus', 'culinary', 'eend'], ['Lamsrack met kruidenkorst', 'culinary', 'lamsvlees']]);
sqlite.exec("UPDATE recipes SET mode = 'culinary' WHERE mode = 'culinary_off'");

// --- 7. Vervangen ------------------------------------------------------------
// 7a. Uit de bank: geen AI, niet hetzelfde hoofdingrediënt én keuken, niet al in de week
const week = r.data.days;
calls = [];
const cur = week[2];
for (let i = 0; i < 5; i++) {
  r = await post('replace-meal', { prefs: { ...prefs, currentWeek: week.map(m => ({ title: m.title, main_ingredient: m.main_ingredient, cuisine: m.cuisine })) },
    dayIndex: 2, currentMeal: { id: cur.id, title: cur.title }, history: [] });
  assert.equal(r.status, 200);
  assert.notEqual(r.data.title, cur.title);
  assert.ok(!(r.data.main_ingredient === cur.main_ingredient && r.data.cuisine === cur.cuisine), 'echt anders');
  assert.ok(!week.some(m => m.title === r.data.title));
  assert.equal(r.data.mode, 'premium');
}
assert.equal(calls.length, 0, 'vervangen uit de bank zonder AI');

// 7b. Via de AI (bank niet bruikbaar): Kip madras -> Kip tikka masala wordt geweigerd
calls = [];
const replies = [{ title: 'Kip tikka masala', main_ingredient: 'kip', cuisine: 'Indiaas' }, { title: 'Kip saté', main_ingredient: 'kip', cuisine: 'Indonesisch' }];
genReply = () => replies.shift();
r = await post('replace-meal', { prefs: { ...prefs, diet: ['Paleo'], currentWeek: [] }, dayIndex: 1,
  currentMeal: { title: 'Kip madras', main_ingredient: 'kip', cuisine: 'Indiaas' } });
assert.equal(r.status, 200); assert.equal(r.data.title, 'Kip saté'); assert.equal(calls.length, 2);
assert.match(calls[0].sys, /ander hoofdingrediënt dan "kip" of een andere keuken dan "Indiaas"/);
assert.match(calls[1].sys, /zelfde hoofdingrediënt én keuken/);

// --- 8. Chat: dieet in de juiste schrijfwijze --------------------------------
r = await post('chat', { messages: [], message: 'ik eet geen vlees meer', diet: ['Geen'] });
assert.deepEqual(r.data.diet, ['Vegetarisch']);

// --- 9. Tijdslimiet en herhaalpoging -------------------------------------------
// 9a. Serverfout bij Gemini -> één keer opnieuw
calls = []; failNext = 1;
r = await post('chat', { messages: [], message: 'hoi' });
assert.equal(r.status, 200); assert.equal(calls.length, 2);
// 9b. Twee keer te traag -> nette melding (geen eindeloos wachten)
const realTimeout = AbortSignal.timeout;
AbortSignal.timeout = () => AbortSignal.abort(new DOMException('te traag', 'TimeoutError'));
r = await post('chat', { messages: [], message: 'hoi' });
assert.equal(r.status, 504); assert.match(r.data.detail, /te traag/);
// 9c. Eerste keer te traag, tweede keer goed
let first = true;
AbortSignal.timeout = (ms) => { if (first) { first = false; return AbortSignal.abort(new DOMException('te traag', 'TimeoutError')); } return realTimeout(ms); };
r = await post('chat', { messages: [], message: 'hoi' });
assert.equal(r.status, 200);
AbortSignal.timeout = realTimeout;

// --- 10. Foto's: oude jpg wordt bij opvragen webp --------------------------------
r2.set('meals/oud.jpg', { body: new Uint8Array([1, 2, 3]), type: 'image/jpeg' });
const bg = [];
const img = await worker.fetch(new Request('https://k/api/images/oud.jpg'), env, { waitUntil: p => bg.push(p) });
assert.equal(img.headers.get('content-type'), 'image/webp');
await Promise.all(bg);
assert.equal(r2.get('meals/oud.jpg').type, 'image/webp', 'kleine versie bewaard');
const env2 = { ...env, IMAGES: undefined };
r2.set('meals/oud2.jpg', { body: new Uint8Array([1]), type: 'image/jpeg' });
assert.equal((await worker.fetch(new Request('https://k/api/images/oud2.jpg'), env2)).headers.get('content-type'), 'image/jpeg');

h = await (await worker.fetch(new Request('https://k/api/health'), env)).json();
console.log('Receptenbank:', JSON.stringify(h.recipe_bank));
console.log('SNELHEID & RECEPTENBANK: ALLE TESTS GESLAAGD');
