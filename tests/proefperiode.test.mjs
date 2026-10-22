// Proefperiode: mijlpalen, toestemming, e-mailreeks (dienst vs. aanbod), afmelden.
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
import { runTrialMails, countReused } from './engagement.mjs';

const sqlite = new DatabaseSync(':memory:');
class Stmt { constructor(sql, args = []) { this.sql = sql; this.args = args; } bind(...a) { return new Stmt(this.sql, a); }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; } async first() { return sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async run() { sqlite.prepare(this.sql).run(...this.args); return {}; } }
const env = { DB: { prepare: s => new Stmt(s), async batch(st) { for (const s of st) await s.run(); } }, PHOTOS: {}, AI: {}, ASSETS: {},
  GEMINI_API_KEY: 'k', PASSWORD_ITERATIONS: '10000', APP_URL: 'https://myqook.test' };

const mails = [];
globalThis.fetch = async (url, init) => {
  if (String(url).includes('resend')) { mails.push(JSON.parse(init.body)); return new Response('{}'); }
  const sys = JSON.parse(init.body).systemInstruction.parts[0].text;
  if (sys.includes('volledig, foutloos recept')) return ok({ ingredients: [{ name: 'Ui', amount: 1, unit: 'stuks' }, { name: 'Spinazie', amount: 200, unit: 'gram' }], steps: [{ user_text: 'x' }] });
  return ok({ days: [] });
};
const ok = (o) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] } }] }));
const post = async (path, body, cookie = '', ip = '1.1.1.1') => {
  const r = await worker.fetch(new Request('https://myqook.test/api/' + path, { method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }), env);
  return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie') };
};

// --- 1. Hergebruik tellen -----------------------------------------------------------------
assert.equal(countReused([['Ui', 'Spinazie', 'Zout'], ['ui', 'Kip', 'zout'], ['Spinazie (vers)', 'Rijst']]), 2, 'ui en spinazie, zout telt niet');

// --- 2. Registreren met en zonder toestemming -------------------------------------------------
let r = await post('auth/register', { name: 'Anna', email: 'anna@q.test', password: 'Wachtwoord1', marketing: true }, '', '2.2.2.2');
assert.equal(r.status, 201); assert.equal(r.data.user.marketing, true); assert.deepEqual(r.data.stats, {});
const anna = r.cookie.split(';')[0];
r = await post('auth/register', { name: 'Bram', email: 'bram@q.test', password: 'Wachtwoord1' }, '', '3.3.3.3');
assert.equal(r.data.user.marketing, false, 'zonder vinkje geen toestemming');
const bram = r.cookie.split(';')[0];

// --- 3. Mijlpalen ---------------------------------------------------------------------------
await worker.fetch(new Request('https://myqook.test/api/health'), env);
for (const [id, t] of [['m1', 'Spinaziesoep'], ['m2', 'Pasta met spinazie']]) {
  sqlite.prepare(`INSERT INTO recipes (id, title, data, mode) VALUES (?, ?, '{}', 'premium')`).run(id, t);
}
r = await post('shopping-list', { meals: [{ id: 'm1' }, { id: 'm2' }], servings: 2 }, anna);
assert.equal(r.status, 200);
assert.equal((await post('account/milestone', { key: 'cooked' }, anna)).status, 200);
assert.equal((await post('account/milestone', { key: 'plans' }, anna)).status, 400, 'server-mijlpalen niet vanuit de app');
const me = await worker.fetch(new Request('https://myqook.test/api/auth/me', { headers: { cookie: anna } }), env).then(x => x.json());
assert.equal(me.stats.lists, 1); assert.equal(me.stats.reused, 2, 'ui en spinazie in beide recepten'); assert.equal(me.stats.cooked, 1);

// Toestemming wijzigen in de instellingen
assert.equal((await post('account/marketing', { opt_in: true }, bram)).data.marketing, true);
assert.equal((await post('account/marketing', { opt_in: false }, bram)).data.marketing, false);

// --- 4. E-mailreeks --------------------------------------------------------------------------
assert.deepEqual(await runTrialMails(env), { sent: 0, skipped: 'e-mail niet ingesteld' }, 'zonder Resend gebeurt er niets');
env.RESEND_API_KEY = 're_test'; env.MAIL_FROM = 'Qook <hallo@myqook.test>';
const setDay = (email, day) => sqlite.prepare('UPDATE users SET trial_started_at = ? WHERE email = ?').run(new Date(Date.now() - day * 864e5 - 3600e3).toISOString(), email);
const kinds = () => sqlite.prepare('SELECT u.email, l.kind FROM email_log l JOIN users u ON u.id = l.user_id ORDER BY l.kind').all().map(x => `${x.email.split('@')[0]}:${x.kind}`);

// Dag 0: welkom voor iedereen (dienstbericht)
await runTrialMails(env);
assert.equal(mails.length, 2); assert.ok(mails.every(m => m.subject.startsWith('Welkom')));
assert.ok(mails.every(m => m.text.includes('https://myqook.test/app/')));
assert.ok(!mails.some(m => m.headers), 'welkom is geen reclame: geen afmeldkop');
await runTrialMails(env);
assert.equal(mails.length, 2, 'niet dubbel');

// Dag 2: Bram heeft nog geen lijst maar geen toestemming -> niets; Anna heeft al een lijst -> geen activatiemail
setDay('anna@q.test', 2); setDay('bram@q.test', 2);
await runTrialMails(env);
assert.equal(mails.length, 2);

// Dag 6: Anna krijgt haar week in cijfers
setDay('anna@q.test', 6);
await runTrialMails(env);
assert.equal(mails.length, 3);
const value = mails.at(-1);
assert.equal(value.subject, 'Jouw eerste week met Qook');
assert.match(value.text, /1 boodschappenlijst gemaakt/); assert.match(value.text, /2 ingrediënten in meer dan één gerecht/);
assert.match(value.text, /Afmelden: https:\/\/myqook\.test\/api\/email\/unsubscribe\?t=/);
assert.ok(value.headers['List-Unsubscribe']);

// Dag 13: Anna krijgt alleen "stopt morgen" (aanbod van dag 11 wordt overgeslagen, niet twee mails tegelijk)
setDay('anna@q.test', 13); setDay('bram@q.test', 13);
await runTrialMails(env);
const last2 = mails.slice(-2).map(m => m.subject);
assert.deepEqual(last2, ['Je proefperiode stopt morgen', 'Je proefperiode stopt morgen'], 'dienstbericht ook naar Bram');
await runTrialMails(env);
assert.equal(mails.length, 5, 'aanbod van dag 11 niet alsnog');

// Betaald -> geen verkoopmails meer
await post('account/subscription', { tier: 'premium' }, anna);
setDay('anna@q.test', 18);
setDay('bram@q.test', 18);
await runTrialMails(env);
assert.equal(mails.length, 5, 'Anna betaalt, Bram heeft geen toestemming');

// Afmelden via de link
await post('account/marketing', { opt_in: true }, bram);
await runTrialMails(env);
assert.equal(mails.length, 6); assert.equal(mails.at(-1).subject, 'Je kookt nu met Qook Gratis');
const token = mails.at(-1).text.match(/unsubscribe\?t=([\w-]+)/)[1];
const page = await worker.fetch(new Request(`https://myqook.test/api/email/unsubscribe?t=${token}`), env);
assert.match(await page.text(), /Je bent afgemeld/);
assert.equal(sqlite.prepare("SELECT marketing_opt_in m FROM users WHERE email = 'bram@q.test'").get().m, 0);

// Account verwijderen ruimt alles op
await post('account/delete', { password: 'Wachtwoord1' }, anna);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM user_milestones").get().n, 0);

console.log('PROEFPERIODE: ALLE TESTS GESLAAGD', kinds().join(' '));
