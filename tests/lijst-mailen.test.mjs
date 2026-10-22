// Boodschappenlijst mailen naar het eigen account.
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
const sqlite = new DatabaseSync(':memory:');
class Stmt { constructor(sql, args = []) { this.sql = sql; this.args = args; } bind(...a) { return new Stmt(this.sql, a); }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; } async first() { return sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async run() { sqlite.prepare(this.sql).run(...this.args); return {}; } }
const env = { DB: { prepare: s => new Stmt(s), async batch(st) { for (const s of st) await s.run(); } }, PHOTOS: {}, AI: {}, ASSETS: {}, GEMINI_API_KEY: 'k', PASSWORD_ITERATIONS: '10000' };
const mails = [];
globalThis.fetch = async (url, init) => { mails.push(JSON.parse(init.body)); return new Response('{}'); };
const post = async (path, body, cookie = '') => { const r = await worker.fetch(new Request('https://q.test/api/' + path, { method: 'POST',
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }), env); return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie') }; };
const reg = await post('auth/register', { name: 'Max', email: 'max@q.test', password: 'Wachtwoord1' });
const c = reg.cookie.split(';')[0];
const sections = [{ title: 'Groente & fruit', items: [{ name: 'Bloemkool <b>', amount: '1 stuk' }] }, { title: 'Leeg', items: [] }];
assert.equal((await post('account/email-list', { sections }, c)).status, 501, 'zonder e-mailinstelling');
env.RESEND_API_KEY = 'x'; env.MAIL_FROM = 'Qook <hallo@q.test>';
assert.equal((await post('account/email-list', { sections })).status, 401, 'alleen met account');
const r = await post('account/email-list', { sections }, c);
assert.equal(r.status, 200); assert.equal(r.data.to, 'max@q.test');
assert.deepEqual(mails[0].to, ['max@q.test']);
assert.match(mails[0].text, /GROENTE & FRUIT\n\[ \] Bloemkool <b> – 1 stuk/);
assert.match(mails[0].html, /Bloemkool &lt;b&gt;/); assert.doesNotMatch(mails[0].html, /Leeg/);
assert.equal((await post('account/email-list', { sections: [] }, c)).status, 400);
for (let i = 0; i < 9; i++) await post('account/email-list', { sections }, c);
assert.equal((await post('account/email-list', { sections }, c)).status, 429, 'max 10 per dag');
console.log('LIJST MAILEN: ALLE TESTS GESLAAGD');
