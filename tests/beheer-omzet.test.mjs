// Beheer: gebruikers zoeken en acties, omzet uit Stripe, dagelijkse controle Stripe ↔ Qook.
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
import { dailyAdminTasks } from './admin.mjs';
const sqlite = new DatabaseSync(':memory:');
class Stmt { constructor(sql, args = []) { this.sql = sql; this.args = args; } bind(...a) { return new Stmt(this.sql, a); }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; } async first() { return sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async run() { sqlite.prepare(this.sql).run(...this.args); return {}; } }
const env = { DB: { prepare: s => new Stmt(s), async batch(st) { for (const s of st) await s.run(); } }, PHOTOS: {}, AI: {}, ASSETS: {},
  GEMINI_API_KEY: 'k', PASSWORD_ITERATIONS: '10000', ADMIN_KEY: 'geheim' };
const now = Math.floor(Date.now() / 1000);
const SUBS = [
  { id: 'sub_a', customer: 'cus_a', status: 'active', created: now - 5 * 86400, current_period_end: now + 10 * 86400, cancel_at_period_end: false, items: { data: [{ price: { id: 'price_pm', unit_amount: 499, recurring: { interval: 'month' } } }] } },
  { id: 'sub_b', customer: 'cus_b', status: 'active', created: now - 90 * 86400, current_period_end: now + 200 * 86400, cancel_at_period_end: true, items: { data: [{ price: { id: 'price_py', unit_amount: 3999, recurring: { interval: 'year' } } }] } },
  { id: 'sub_c', customer: 'cus_c', status: 'past_due', created: now - 40 * 86400, current_period_start: now - 3 * 86400, current_period_end: now + 27 * 86400, items: { data: [{ price: { id: 'price_pm', unit_amount: 499, recurring: { interval: 'month' } } }] } },
  { id: 'sub_d', customer: 'cus_d', status: 'canceled', created: now - 60 * 86400, canceled_at: now - 3600, items: { data: [{ price: { id: 'price_pm', unit_amount: 499, recurring: { interval: 'month' } } }] } },
];
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/v1/subscriptions')) return Response.json({ data: SUBS, has_more: false });
  if (u.includes('/v1/invoices')) return Response.json({ data: [{ id: 'in_1', created: now - 86400, amount_paid: 499 }, { id: 'in_2', created: now - 2 * 86400, amount_paid: 3999 }], has_more: false });
  return Response.json({});
};
const admin = (path, body) => worker.fetch(new Request('https://q.test/api/admin/' + path, { method: body ? 'POST' : 'GET',
  headers: { 'x-admin-key': 'geheim', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env).then(async r => ({ status: r.status, data: await r.json() }));
const reg = (name, email) => worker.fetch(new Request('https://q.test/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, email, password: 'Wachtwoord1' }) }), env);
for (const [n, e] of [['Anna', 'anna@q.test'], ['Bram', 'bram@q.test'], ['Cor', 'cor@q.test']]) await reg(n, e);

// Gebruikers zoeken
let r = await admin('users?q=bram');
assert.equal(r.data.users.length, 1); assert.equal(r.data.users[0].status, 'proef'); assert.equal(r.data.users[0].trial_days_left, 14);
assert.equal((await admin('users?q=')).data.users.length, 3);
const bram = r.data.users[0].id;
// Abonnement geven en proef verlengen
assert.equal((await admin('user', { id: bram, action: 'grant', tier: 'premium' })).status, 200);
assert.equal((await admin('users?q=bram')).data.users[0].status, 'premium');
assert.equal((await admin('user', { id: bram, action: 'grant', tier: 'goud' })).status, 400);
const anna = (await admin('users?q=anna')).data.users[0].id;
sqlite.prepare("UPDATE users SET trial_started_at = ? WHERE id = ?").run(new Date(Date.now() - 13 * 864e5).toISOString(), anna);
await admin('user', { id: anna, action: 'extend_trial' });
assert.equal((await admin('users?q=anna')).data.users[0].trial_days_left, 8, '1 dag over + 7');
await admin('user', { id: anna, action: 'verify' });
assert.equal((await admin('users?q=anna')).data.users[0].email_verified, 1);

// Omzet: uit zolang Stripe niet is ingesteld
assert.deepEqual((await admin('revenue')).data, { enabled: false });
assert.equal((await admin('overview')).data.billing, false);
Object.assign(env, { STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec', STRIPE_PRICE_PREMIUM_MONTH: 'price_pm', STRIPE_PRICE_PREMIUM_YEAR: 'price_py' });
r = await admin('revenue');
assert.equal(r.data.enabled, true);
assert.equal(r.data.active, 3, 'actief + loopt af + mislukte betaling');
assert.equal(r.data.mrr_cents, Math.round(499 + 3999 / 12 + 499));
assert.deepEqual(r.data.per_plan, { 'Premium (maand)': 2, 'Premium (jaar)': 1 });
assert.equal(r.data.cancelling, 1); assert.equal(r.data.past_due.length, 1); assert.equal(r.data.canceled_this_month >= 1, true);
assert.deepEqual(r.data.renewals_30d, { count: 2, amount_cents: 998 });
const thisMonth = new Date().toISOString().slice(0, 7);
assert.equal(Object.keys(r.data.months).length, 6);
assert.ok(r.data.months[thisMonth].amount >= 499);

// Dagelijkse controle: Anna heeft in Stripe premium (cus_a) maar Qook weet het niet; Cor had premium maar Stripe niet meer
sqlite.prepare("UPDATE users SET stripe_customer_id = 'cus_a' WHERE email = 'anna@q.test'").run();
sqlite.prepare("UPDATE users SET stripe_customer_id = 'cus_d', subscription = 'premium' WHERE email = 'cor@q.test'").run();
const res = await dailyAdminTasks(env);
assert.equal(res.fixed.length, 2);
assert.deepEqual(res.fixed.map(f => [f.email, f.to]).sort(), [['anna@q.test', 'premium'], ['cor@q.test', 'free']]);
assert.equal(res.unknown_customers, 2, 'cus_b en cus_c hebben geen account in deze test');
assert.equal(await dailyAdminTasks(env), null, 'één keer per dag');
assert.equal((await admin('overview')).data.reconcile.fixed.length, 2);
r = await admin('reconcile', {});
assert.equal(r.data.fixed.length, 0, 'nu alles gelijk');
assert.equal((await worker.fetch(new Request('https://q.test/api/admin/users'), env)).status, 404, 'zonder sleutel niets');
console.log('BEHEER EN OMZET: ALLE TESTS GESLAAGD');
