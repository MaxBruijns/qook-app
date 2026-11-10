/**
 * Qook — betalen via Stripe (iDEAL, kaart en wat in Stripe aan staat).
 *
 * Werkt pas als deze instellingen er zijn (Cloudflare → Variables and Secrets):
 *  - STRIPE_SECRET_KEY        (secret, begint met sk_live_ of sk_test_)
 *  - STRIPE_WEBHOOK_SECRET    (secret, begint met whsec_; webhook naar https://<domein>/api/billing/webhook)
 *  - STRIPE_PRICE_BASIC_YEAR, STRIPE_PRICE_PREMIUM_MONTH, STRIPE_PRICE_PREMIUM_YEAR,
 *    STRIPE_PRICE_CULINARY_MONTH, STRIPE_PRICE_CULINARY_YEAR   (prijs-ID's uit Stripe, beginnen met price_)
 *
 *  - Afsluiten: Stripe Checkout (betaalpagina van Stripe; wij zien geen betaalgegevens).
 *  - Opzeggen, betaalmethode wijzigen, facturen: Stripe-klantportaal (net zo makkelijk als afsluiten).
 *  - De webhook houdt het abonnement in Qook gelijk aan Stripe.
 */
export interface BillingEnv {
  DB: any;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_BASIC_YEAR?: string;
  STRIPE_PRICE_PREMIUM_MONTH?: string;
  STRIPE_PRICE_PREMIUM_YEAR?: string;
  STRIPE_PRICE_CULINARY_MONTH?: string;
  STRIPE_PRICE_CULINARY_YEAR?: string;
}

type Tier = 'basic' | 'premium' | 'culinary';
type Plan = 'basic_year' | 'premium_month' | 'premium_year' | 'culinary_month' | 'culinary_year';

const PLAN_ENV: Record<Plan, keyof BillingEnv> = {
  basic_year: 'STRIPE_PRICE_BASIC_YEAR',
  premium_month: 'STRIPE_PRICE_PREMIUM_MONTH',
  premium_year: 'STRIPE_PRICE_PREMIUM_YEAR',
  culinary_month: 'STRIPE_PRICE_CULINARY_MONTH',
  culinary_year: 'STRIPE_PRICE_CULINARY_YEAR',
};
const planTier = (p: Plan): Tier => p.split('_')[0] as Tier;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export const billingReady = (env: BillingEnv) => !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET)
  && (Object.values(PLAN_ENV) as (keyof BillingEnv)[]).some(k => !!env[k]);

const availablePlans = (env: BillingEnv) => (Object.keys(PLAN_ENV) as Plan[]).filter(p => !!env[PLAN_ENV[p]]);

/** Welk abonnement hoort bij deze Stripe-prijs? */
export function tierForPrice(env: BillingEnv, priceId: string): Tier | null {
  for (const p of Object.keys(PLAN_ENV) as Plan[]) if (env[PLAN_ENV[p]] === priceId) return planTier(p);
  return null;
}

let ready: Promise<void> | null = null;
export function ensureColumns(db: any) {
  ready ||= (async () => {
    const { results } = await db.prepare('PRAGMA table_info(users)').all();
    const have = new Set((results || []).map((r: any) => r.name));
    for (const name of ['stripe_customer_id', 'stripe_subscription_id']) {
      if (have.has(name)) continue;
      try { await db.prepare(`ALTER TABLE users ADD COLUMN ${name} TEXT`).run(); }
      catch (e: any) { if (!/duplicate column/i.test(String(e?.message))) throw e; }
    }
  })().catch((e: any) => { ready = null; throw e; });
  return ready;
}

/** Stripe-API: formulier-codering, ook voor geneste velden (line_items[0][price]). */
function form(data: Record<string, any>, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export async function stripe(env: BillingEnv, path: string, data?: Record<string, any>) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: data ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded',
      'stripe-version': '2024-06-20' },
    body: data ? form(data) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Stripe-fout', res.status, body?.error?.message);
    throw new Error(body?.error?.message || 'Stripe reageerde niet');
  }
  return body;
}

/** Stripe-klant bij het account (één keer aangemaakt). */
async function customerFor(env: BillingEnv, user: any) {
  if (user.stripe_customer_id) return user.stripe_customer_id;
  const c = await stripe(env, 'customers', { email: user.email, name: user.name, metadata: { user_id: user.id } });
  await env.DB.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').bind(c.id, user.id).run();
  return c.id;
}

/** Afrekenen: geeft de link naar de betaalpagina van Stripe. */
async function checkout(req: Request, env: BillingEnv, user: any, b: any) {
  const plan = b.plan as Plan;
  const price = PLAN_ENV[plan] ? env[PLAN_ENV[plan]] : undefined;
  if (!price) return json({ detail: 'Dit abonnement is (nog) niet beschikbaar.' }, 400);
  if (user.stripe_subscription_id && ['basic', 'premium', 'culinary'].includes(user.subscription)) {
    return json({ detail: 'Je hebt al een abonnement. Wijzigen of opzeggen doe je via "Abonnement beheren".' }, 409);
  }
  const origin = new URL(req.url).origin;
  const session = await stripe(env, 'checkout/sessions', {
    mode: 'subscription',
    customer: await customerFor(env, user),
    client_reference_id: user.id,
    line_items: [{ price, quantity: 1 }],
    success_url: `${origin}/app/?betaald=1`,
    cancel_url: `${origin}/app/?betaald=0`,
    locale: 'nl',
    allow_promotion_codes: 'true',
    custom_text: { submit: { message: 'Je abonnement start direct. Herroep je binnen 14 dagen, dan betaal je alleen voor de dagen dat je Qook gebruikte. Opzeggen kan altijd in de app.' } },
    billing_address_collection: 'auto',
    metadata: { user_id: user.id, plan },
    subscription_data: { metadata: { user_id: user.id, plan } },
  });
  return json({ url: session.url });
}

/** Klantportaal van Stripe: opzeggen, betaalmethode wijzigen, facturen. */
async function portal(req: Request, env: BillingEnv, user: any) {
  if (!user.stripe_customer_id) return json({ detail: 'Je hebt nog geen betaald abonnement.' }, 400);
  const s = await stripe(env, 'billing_portal/sessions', { customer: user.stripe_customer_id, return_url: `${new URL(req.url).origin}/app/` });
  return json({ url: s.url });
}

// ---------------------------------------------------------------------------
// Webhook: Stripe meldt wijzigingen; wij zetten het abonnement in Qook gelijk.
// ---------------------------------------------------------------------------
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');

/** Controleert de handtekening van Stripe (HMAC-SHA256 over "tijd.inhoud", max 5 minuten oud). */
export async function verifyStripeSignature(secret: string, header: string, payload: string, now = Date.now()) {
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=') as [string, string]).filter(p => p.length === 2));
  const sigs = header.split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length || Math.abs(now / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`)));
  return sigs.some(s => s.length === expected.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ expected.charCodeAt(i)), 0) === 0);
}

async function setSubscription(env: BillingEnv, sub: any) {
  const customer = String(sub.customer || '');
  const user = await env.DB.prepare('SELECT id FROM users WHERE stripe_customer_id = ?').bind(customer).first()
    || (sub.metadata?.user_id ? await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(sub.metadata.user_id).first() : null);
  if (!user) { console.warn('Stripe: geen gebruiker voor klant', customer); return; }
  const priceId = sub.items?.data?.[0]?.price?.id;
  const active = ['active', 'trialing', 'past_due'].includes(sub.status);   // past_due: Stripe probeert nog te innen
  const tier = active ? tierForPrice(env, priceId) : null;
  await env.DB.prepare(`UPDATE users SET subscription = ?, stripe_subscription_id = ?, stripe_customer_id = COALESCE(stripe_customer_id, ?),
      trial_started_at = CASE WHEN ? = 'free' THEN trial_started_at ELSE NULL END WHERE id = ?`)
    .bind(tier || 'free', active ? sub.id : null, customer, tier || 'free', user.id).run();
}

async function webhook(req: Request, env: BillingEnv) {
  const payload = await req.text();
  if (!(await verifyStripeSignature(env.STRIPE_WEBHOOK_SECRET!, req.headers.get('stripe-signature') || '', payload))) {
    return json({ detail: 'Ongeldige handtekening' }, 400);
  }
  const event = JSON.parse(payload);
  const obj = event.data?.object || {};
  switch (event.type) {
    case 'checkout.session.completed':
      if (obj.subscription) await setSubscription(env, await stripe(env, `subscriptions/${obj.subscription}`));
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await setSubscription(env, obj);
      break;
  }
  return json({ received: true });
}

/**
 * /api/billing/*. `getUser` geeft de ingelogde gebruiker (of null).
 */
export async function handleBilling(req: Request, env: BillingEnv, path: string,
                                    getUser: () => Promise<any>): Promise<Response | null> {
  if (!path.startsWith('/api/billing/')) return null;
  if (path === '/api/billing/config') return json({ enabled: billingReady(env), plans: billingReady(env) ? availablePlans(env) : [] });
  if (!billingReady(env)) return json({ detail: 'Betalen is nog niet beschikbaar.' }, 501);
  await ensureColumns(env.DB);
  if (req.method === 'POST' && path === '/api/billing/webhook') return webhook(req, env);
  const user = await getUser();
  if (!user) return json({ detail: 'Log eerst in.' }, 401);
  const origin = req.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(req.url).host) return json({ detail: 'Niet toegestaan' }, 403);
  try {
    if (req.method === 'POST' && path === '/api/billing/checkout') return await checkout(req, env, user, await req.json().catch(() => ({})));
    if (req.method === 'POST' && path === '/api/billing/portal') return await portal(req, env, user);
  } catch (e: any) {
    return json({ detail: 'Betalen lukte even niet. Probeer het zo opnieuw.' }, 502);
  }
  return json({ detail: 'Niet gevonden' }, 404);
}

// ---------------------------------------------------------------------------
// Omzetoverzicht en dagelijkse controle (voor het beheerscherm)
// ---------------------------------------------------------------------------
const PLAN_LABEL: Record<Plan, string> = { basic_year: 'Basic (jaar)', premium_month: 'Premium (maand)', premium_year: 'Premium (jaar)',
  culinary_month: 'Culinair (maand)', culinary_year: 'Culinair (jaar)' };
export function planForPrice(env: BillingEnv, priceId: string): Plan | null {
  for (const p of Object.keys(PLAN_ENV) as Plan[]) if (env[PLAN_ENV[p]] === priceId) return p;
  return null;
}

/** Alle abonnementen uit Stripe (hoogstens 1000). */
export async function listSubscriptions(env: BillingEnv) {
  const all: any[] = [];
  let after = '';
  for (let page = 0; page < 10; page++) {
    const r = await stripe(env, `subscriptions?status=all&limit=100${after ? `&starting_after=${after}` : ''}`);
    all.push(...(r.data || []));
    if (!r.has_more || !r.data?.length) break;
    after = r.data[r.data.length - 1].id;
  }
  return all;
}

const ACTIVE = new Set(['active', 'trialing', 'past_due']);

export async function revenueOverview(env: BillingEnv, now = Date.now()) {
  if (!billingReady(env)) return { enabled: false };
  const subs = await listSubscriptions(env);
  const d = new Date(now);
  const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
  const in30 = now / 1000 + 30 * 86400;
  const perPlan: Record<string, number> = {};
  let mrr = 0, cancelling = 0, newThisMonth = 0, canceledThisMonth = 0, renewCount = 0, renewAmount = 0;
  const pastDue: any[] = [];
  for (const sub of subs) {
    const price = sub.items?.data?.[0]?.price || {};
    const plan = planForPrice(env, price.id);
    const amount = Number(price.unit_amount) || 0;
    if (sub.created >= monthStart && sub.status !== 'incomplete' && sub.status !== 'incomplete_expired') newThisMonth++;
    if (sub.canceled_at && sub.canceled_at >= monthStart) canceledThisMonth++;
    if (!ACTIVE.has(sub.status)) continue;
    const label = plan ? PLAN_LABEL[plan] : (price.nickname || 'Onbekende prijs');
    perPlan[label] = (perPlan[label] || 0) + 1;
    mrr += price.recurring?.interval === 'year' ? amount / 12 : amount;
    if (sub.cancel_at_period_end) cancelling++;
    else if (sub.current_period_end && sub.current_period_end <= in30) { renewCount++; renewAmount += amount; }
    if (sub.status === 'past_due') pastDue.push({ customer: sub.customer, since: sub.current_period_start });
  }
  // Betaalde facturen per maand (laatste 6 maanden).
  const from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 5, 1) / 1000;
  const months: Record<string, { amount: number; count: number }> = {};
  for (let i = 5; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7);
    months[m] = { amount: 0, count: 0 };
  }
  let after = '';
  for (let page = 0; page < 10; page++) {
    const r = await stripe(env, `invoices?status=paid&limit=100&created[gte]=${from}${after ? `&starting_after=${after}` : ''}`);
    for (const inv of r.data || []) {
      const m = new Date(inv.created * 1000).toISOString().slice(0, 7);
      if (months[m] && inv.amount_paid > 0) { months[m].amount += inv.amount_paid; months[m].count++; }
    }
    if (!r.has_more || !r.data?.length) break;
    after = r.data[r.data.length - 1].id;
  }
  const active = Object.values(perPlan).reduce((a, b) => a + b, 0);
  return {
    enabled: true, currency: 'eur', active, per_plan: perPlan, mrr_cents: Math.round(mrr), cancelling,
    new_this_month: newThisMonth, canceled_this_month: canceledThisMonth,
    renewals_30d: { count: renewCount, amount_cents: renewAmount },
    past_due: pastDue, months,
  };
}

/** Stripe en de Qook-database gelijk houden (dagelijks): verschillen rechtzetten en melden. */
export async function reconcile(env: BillingEnv) {
  if (!billingReady(env)) return null;
  await ensureColumns(env.DB);
  const subs = await listSubscriptions(env);
  const byCustomer = new Map<string, { tier: Tier; id: string }>();
  for (const sub of subs) {
    if (!ACTIVE.has(sub.status)) continue;
    const tier = tierForPrice(env, sub.items?.data?.[0]?.price?.id);
    if (tier) byCustomer.set(String(sub.customer), { tier, id: sub.id });
  }
  const { results } = await env.DB.prepare(`SELECT id, email, subscription, stripe_customer_id FROM users WHERE stripe_customer_id IS NOT NULL`).all();
  const fixed: any[] = [];
  const known = new Set<string>();
  for (const u of results || []) {
    known.add(u.stripe_customer_id);
    const want = byCustomer.get(u.stripe_customer_id);
    const tier = want?.tier || 'free';
    const current = u.subscription === 'trial' ? 'free' : u.subscription;
    if (current === tier) continue;
    // Zonder actief Stripe-abonnement: alleen terugzetten als het account een betaald abonnement had.
    if (!want && !['basic', 'premium', 'culinary'].includes(u.subscription)) continue;
    await env.DB.prepare('UPDATE users SET subscription = ?, stripe_subscription_id = ? WHERE id = ?').bind(tier, want?.id || null, u.id).run();
    fixed.push({ email: u.email, from: u.subscription, to: tier });
  }
  const unknown = [...byCustomer.keys()].filter(c => !known.has(c)).length;
  return { at: new Date().toISOString(), checked: (results || []).length, fixed, unknown_customers: unknown };
}
