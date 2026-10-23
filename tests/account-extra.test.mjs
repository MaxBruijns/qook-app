// Account: e-mailadres bevestigen, wachtwoord wijzigen, gegevens downloaden.
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
import { cleanupInactiveAccounts } from './engagement.mjs';
const sqlite = new DatabaseSync(':memory:');
class Stmt { constructor(sql, args = []) { this.sql = sql; this.args = args; } bind(...a) { return new Stmt(this.sql, a); }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; } async first() { return sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async run() { sqlite.prepare(this.sql).run(...this.args); return {}; } }
const env = { DB: { prepare: s => new Stmt(s), async batch(st) { for (const s of st) await s.run(); } }, PHOTOS: {}, AI: {}, ASSETS: {},
  GEMINI_API_KEY: 'k', PASSWORD_ITERATIONS: '10000', RESEND_API_KEY: 'x', MAIL_FROM: 'Qook <hallo@q.test>' };
const mails = [];
globalThis.fetch = async (url, init) => { mails.push(JSON.parse(init.body)); return new Response('{}'); };
const req = (path, { method = 'GET', body, cookie } = {}) => worker.fetch(new Request('https://q.test' + path, { method,
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }), env);

// Registreren -> bevestigingsmail
let r = await req('/api/auth/register', { method: 'POST', body: { name: 'Max', email: 'max@q.test', password: 'Wachtwoord1', data: { qook_prefs: '{"adultsCount":2}' } } });
const c1 = r.headers.get('set-cookie').split(';')[0];
assert.equal((await r.json()).user.verified, false);
assert.equal(mails.length, 1); assert.match(mails[0].subject, /Bevestig/);
const link = mails[0].text.match(/https:\/\/q\.test(\/api\/auth\/verify\?t=[\w-]+)/)[1];
r = await req(link);
assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/app/?verified=1');
assert.equal((await (await req('/api/auth/me', { cookie: c1 })).json()).user.verified, true);
r = await req(link);
assert.equal(r.headers.get('location'), '/app/?verified=0', 'link maar één keer');
r = await req('/api/account/verify-email', { method: 'POST', body: {}, cookie: c1 });
assert.equal((await r.json()).verified, true, 'al bevestigd: geen nieuwe mail');

// Wachtwoord wijzigen: ander apparaat uitgelogd, dit apparaat niet
const c2 = (await req('/api/auth/login', { method: 'POST', body: { email: 'max@q.test', password: 'Wachtwoord1' } })).headers.get('set-cookie').split(';')[0];
assert.equal((await req('/api/account/password', { method: 'POST', body: { current: 'fout', password: 'NieuwWachtwoord2' }, cookie: c1 })).status, 401);
assert.equal((await req('/api/account/password', { method: 'POST', body: { current: 'Wachtwoord1', password: 'kort' }, cookie: c1 })).status, 400);
assert.equal((await req('/api/account/password', { method: 'POST', body: { current: 'Wachtwoord1', password: 'NieuwWachtwoord2' }, cookie: c1 })).status, 200);
assert.ok((await (await req('/api/auth/me', { cookie: c1 })).json()).user, 'dit apparaat blijft ingelogd');
assert.equal((await (await req('/api/auth/me', { cookie: c2 })).json()).user, null, 'ander apparaat uitgelogd');
assert.equal((await req('/api/auth/login', { method: 'POST', body: { email: 'max@q.test', password: 'NieuwWachtwoord2' } })).status, 200);

// Gegevens downloaden
r = await req('/api/account/export', { cookie: c1 });
assert.match(r.headers.get('content-disposition'), /attachment; filename="qook-gegevens-/);
const exp = await r.json();
assert.equal(exp.account.email, 'max@q.test'); assert.equal(exp.account.email_verified, true);
assert.equal(exp.app_data.qook_prefs.adultsCount, 2);
assert.ok(!JSON.stringify(exp).includes('pbkdf2'), 'geen wachtwoord(hash) in de export');
assert.equal((await req('/api/account/export')).status, 401);

// Nieuw account zonder e-mailinstelling: geen bevestigingsmail, geen fout
delete env.RESEND_API_KEY;
r = await req('/api/auth/register', { method: 'POST', body: { name: 'Bo', email: 'bo@q.test', password: 'Wachtwoord1' } });
assert.equal(r.status, 201); assert.equal(mails.length, 1);
// Accounts die lang niet gebruikt zijn: waarschuwen na 23 maanden, verwijderen na 24
env.RESEND_API_KEY = 'x';
const ago = (months) => new Date(Date.now() - months * 30 * 864e5).toISOString().replace('T', ' ').slice(0, 19);
sqlite.prepare("UPDATE users SET last_login_at = ? WHERE email = 'max@q.test'").run(ago(23.5));
sqlite.prepare("UPDATE users SET last_login_at = ?, created_at = ? WHERE email = 'bo@q.test'").run(ago(25), ago(25));
const before = mails.length;
let res = await cleanupInactiveAccounts(env);
assert.deepEqual(res, { warned: 1, deleted: 1 });
assert.match(mails.at(-1).subject, /over een maand verwijderd/); assert.equal(mails.length, before + 1);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM users WHERE email = 'bo@q.test'").get().n, 0);
res = await cleanupInactiveAccounts(env);
assert.equal(res.warned, 0, 'maar één waarschuwing');
console.log('ACCOUNT-EXTRA: ALLE TESTS GESLAAGD');
