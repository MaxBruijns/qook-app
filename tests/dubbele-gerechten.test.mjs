import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import worker, { __t } from './worker.mjs';
const { isDuplicate: dup } = __t;
// Vergelijking
assert.ok(dup('Kip supreme met romige bospaddenstoelensaus', ['Kip supreme met romige bospaddenstoelensaus']));
assert.ok(dup('Kip Supreme met romige bospaddenstoelen-saus!', ['kip supreme met romige bospaddenstoelensaus']));
assert.ok(dup('Kip supreme met paddenstoelensaus', ['Kip supreme met romige bospaddenstoelensaus']));
assert.ok(dup('Romige kip supreme met bospaddenstoelen', ['Kip supreme met romige bospaddenstoelensaus']));
assert.ok(!dup('Kip tandoori met rijst', ['Kip teriyaki met rijst']));
assert.ok(!dup('Gnocchi met spinazie en gorgonzola', ['Kip supreme met romige bospaddenstoelensaus']));
assert.ok(!dup('Oosterse roerbak met biefstukreepjes', ['Gekarameliseerde varkenshaas met honing-mosterdsaus']));
assert.ok(!dup('Pasta pesto', ['Pasta carbonara']));

const sqlite = new DatabaseSync(':memory:');
class Stmt { constructor(sql, args = []) { this.sql = sql; this.args = args; } bind(...a) { return new Stmt(this.sql, a); }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; } async first() { return sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async run() { sqlite.prepare(this.sql).run(...this.args); return {}; } }
const env = { DB: { prepare: s => new Stmt(s), async batch(st) { for (const s of st) await s.run(); } }, PHOTOS: {}, AI: {}, ASSETS: {}, GEMINI_API_KEY: 'k', LIMITS: 'off' };
let queue = [], systems = [];
globalThis.fetch = async (_u, init) => { systems.push(JSON.parse(init.body).systemInstruction.parts[0].text);
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(queue.shift()) }] } }] })); };
const post = async (p, body) => { const r = await worker.fetch(new Request('https://k/api/' + p, { method: 'POST', body: JSON.stringify(body) }), env); return { status: r.status, data: await r.json() }; };
const week = ['Kip supreme met romige bospaddenstoelensaus', 'Gnocchi met spinazie', 'Roerbak met biefstuk', 'Varkenshaas met honingsaus', 'Linzensoep', 'Risotto', 'Zalm'];

// 1. Vervangen maandag: AI stelt dinsdag-gerecht voor -> tweede poging met waarschuwing
queue = [{ title: 'Kip supreme met paddenstoelensaus' }, { title: 'Shakshuka met feta' }];
let r = await post('replace-meal', { prefs: { currentWeekTitles: ['Pasta pesto', ...week.slice(0, 6)] }, dayIndex: 0, currentMeal: { title: 'Pasta pesto' } });
assert.equal(r.status, 200); assert.equal(r.data.title, 'Shakshuka met feta');
assert.match(systems[0], /DEZE WEEK STAAT AL GEPLAND.*Kip supreme met romige bospaddenstoelensaus/s);
assert.doesNotMatch(systems[0], /je vorige voorstel werd afgekeurd/); assert.match(systems[1], /je vorige voorstel werd afgekeurd/);

// 2. Blijft de AI dubbel voorstellen -> nette foutmelding, niets opgeslagen
// (regio buiten NL/BE: geen receptenbank, dus de AI moet het doen)
queue = [{ title: 'Gnocchi met spinazie' }, { title: 'Gnocchi met verse spinazie' }];
r = await post('replace-meal', { prefs: { currentWeekTitles: week, region: 'US' }, dayIndex: 0, currentMeal: { title: week[0] } });
assert.equal(r.status, 409); assert.match(r.data.detail, /geen ander gerecht/);

// 3. Weekmenu met een dubbel gerecht -> dat ene wordt automatisch vervangen
systems = [];
queue = [{ days: [...week.slice(0, 6), 'Kip supreme met paddenstoelensaus'].map(t => ({ title: t })) }, { title: 'Pad thai met tofu' }];
r = await post('weekly-plan', { prefs: { dayModes: {} } });
assert.equal(r.data.days.length, 7); assert.equal(r.data.days[6].title, 'Pad thai met tofu');
assert.equal(new Set(r.data.days.map(d => d.id)).size, 7, 'zeven verschillende recepten');
assert.equal(systems.length, 2);
console.log('GEEN DUBBELE GERECHTEN: ALLE TESTS GESLAAGD');
