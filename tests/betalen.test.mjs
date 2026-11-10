// Betalen via Stripe: afrekenen, webhook (met handtekening), opzeggen, klantportaal.
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import worker from './worker.mjs';
import { verifyStripeSignature } from './billing.mjs';
const sqlite = new DatabaseSync(':memory:');
class Stmt { constructor(sql, args = []) { this.sql = sql; this.args = args; } bind(...a) { return new Stmt(this.sql, a); }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; } async first() { return sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async run() { sqlite.prepare(this.sql).run(...this.args); return {}; } }
const env = { DB: { prepare: s => new Stmt(s), async batch(st) { for (const s of st) await s.run(); } }, PHOTOS: {}, AI: {}, ASSETS: {}, GEMINI_API_KEY: 'k', PASSWORD_ITERATIONS: '10000' };
const calls = [];
globalThis.fetch = async (url, init) => {
  const u = String(url); calls.push({ u, body: init?.body ? String(init.body) : '' });
  if (u.endsWith('/v1/customers')) return Response.json({ id: 'cus_1' });
  if (u.endsWith('/v1/checkout/sessions')) return Response.json({ id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' });
  if (u.endsWith('/v1/billing_portal/sessions')) return Response.json({ url: 'https://billing.stripe.com/p/1' });
  if (u.includes('/v1/subscriptions/sub_1')) return Response.json({ id: 'sub_1', customer: 'cus_1', status: 'active', items: { data: [{ price: { id: 'price_pm' } }] } });
  throw new Error('onverwacht ' + u);
};
const req = (path, { method = 'GET', body, cookie, headers = {}, raw } = {}) => worker.fetch(new Request('https://q.test' + path, { method,
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: raw ?? (body ? JSON.stringify(body) : undefined) }), env);
const sign = (payload, secret = 'whsec_test', t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;

// Uit: niets beschikbaar, oude manier van abonnement kiezen werkt nog
assert.deepEqual(await (await req('/api/billing/config')).json(), { enabled: false, plans: [] });
const reg = await req('/api/auth/register', { method: 'POST', body: { name: 'Max', email: 'max@q.test', password: 'Wachtwoord1' } });
const c = reg.headers.get('set-cookie').split(';')[0];
assert.equal((await req('/api/billing/checkout', { method: 'POST', body: { plan: 'premium_month' }, cookie: c })).status, 501);

// Aan
Object.assign(env, { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_test', STRIPE_PRICE_BASIC_YEAR: 'price_by',
  STRIPE_PRICE_PREMIUM_MONTH: 'price_pm', STRIPE_PRICE_PREMIUM_YEAR: 'price_py' });
assert.deepEqual((await (await req('/api/billing/config')).json()).plans, ['basic_year', 'premium_month', 'premium_year']);
assert.equal((await req('/api/account/subscription', { method: 'POST', body: { tier: 'culinary' }, cookie: c })).status, 402, 'gratis upgraden kan niet meer');
assert.equal((await req('/api/billing/checkout', { method: 'POST', body: { plan: 'premium_month' } })).status, 401);
assert.equal((await req('/api/billing/checkout', { method: 'POST', body: { plan: 'culinary_year' }, cookie: c })).status, 400, 'prijs niet ingesteld');
let r = await req('/api/billing/checkout', { method: 'POST', body: { plan: 'premium_month' }, cookie: c });
assert.equal((await r.json()).url, 'https://checkout.stripe.com/c/cs_1');
const sess = new URLSearchParams(calls.find(x => x.u.endsWith('checkout/sessions')).body);
assert.equal(sess.get('mode'), 'subscription'); assert.equal(sess.get('customer'), 'cus_1'); assert.equal(sess.get('line_items[0][price]'), 'price_pm');
assert.equal(sess.get('success_url'), 'https://q.test/app/?betaald=1'); assert.equal(sess.get('allow_promotion_codes'), 'true');
assert.equal(sqlite.prepare("SELECT stripe_customer_id s FROM users").get().s, 'cus_1');

// Webhook: verkeerde handtekening geweigerd
const done = JSON.stringify({ type: 'checkout.session.completed', data: { object: { subscription: 'sub_1', customer: 'cus_1' } } });
assert.equal((await req('/api/billing/webhook', { method: 'POST', raw: done, headers: { 'stripe-signature': sign(done, 'fout') } })).status, 400);
assert.equal((await req('/api/billing/webhook', { method: 'POST', raw: done, headers: { 'stripe-signature': sign(done, 'whsec_test', Math.floor(Date.now() / 1000) - 600) } })).status, 400, 'te oud');
assert.equal((await req('/api/billing/webhook', { method: 'POST', raw: done, headers: { 'stripe-signature': sign(done) } })).status, 200);
let me = await (await req('/api/auth/me', { cookie: c })).json();
assert.equal(me.user.subscription, 'premium'); assert.equal(me.user.trial_started_at, null, 'geen proef meer'); assert.equal(me.user.billing, true);
assert.equal((await req('/api/billing/checkout', { method: 'POST', body: { plan: 'premium_year' }, cookie: c })).status, 409, 'niet dubbel afsluiten');

// Overstap naar jaar, en opzeggen
const upd = JSON.stringify({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', items: { data: [{ price: { id: 'price_by' } }] } } } });
await req('/api/billing/webhook', { method: 'POST', raw: upd, headers: { 'stripe-signature': sign(upd) } });
assert.equal((await (await req('/api/auth/me', { cookie: c })).json()).user.subscription, 'basic');
const del = JSON.stringify({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled', items: { data: [{ price: { id: 'price_by' } }] } } } });
await req('/api/billing/webhook', { method: 'POST', raw: del, headers: { 'stripe-signature': sign(del) } });
me = await (await req('/api/auth/me', { cookie: c })).json();
assert.equal(me.user.subscription, 'free');

// Klantportaal (opzeggen, facturen)
r = await req('/api/billing/portal', { method: 'POST', body: {}, cookie: c });
assert.equal((await r.json()).url, 'https://billing.stripe.com/p/1');
assert.ok(await verifyStripeSignature('whsec_test', sign('x'), 'x'));
console.log('BETALEN: ALLE TESTS GESLAAGD');
