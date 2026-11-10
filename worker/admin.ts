/**
 * Qook — meldingen over recepten, eigen bezoekersstatistiek en het beheerscherm.
 *
 *  - "Klopt er iets niet?": iedereen kan een recept of foto melden. Bij 3 meldingen van verschillende
 *    mensen gaat een recept tijdelijk uit de receptenbank; bij 2 fotomeldingen wordt de foto opnieuw gemaakt.
 *  - Bezoekersstatistiek zonder cookies en zonder IP-adressen: alleen een teller per dag per pagina.
 *  - Beheer (/beheer/): overzicht van accounts, proeven, abonnementen, receptenbank en meldingen,
 *    alleen met de ADMIN_KEY.
 */
import { BillingEnv, billingReady, revenueOverview, reconcile, ensureColumns } from './billing';
import { ensureEngagementSchema } from './engagement';

export interface AdminEnv extends BillingEnv { DB: any; ADMIN_KEY?: string }

const DAY_MS = 864e5;
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

const REPORT_KINDS = ['recept', 'ingredienten', 'foto', 'allergie', 'anders'];
const HIDE_AFTER = 3;        // meldingen (verschillende mensen) voordat een recept uit de bank gaat
const NEW_PHOTO_AFTER = 2;   // fotomeldingen voordat de foto opnieuw gemaakt wordt

let ready: Promise<void> | null = null;
export function ensureAdminSchema(db: any) {
  ready ||= db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS recipe_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT, recipe_id TEXT NOT NULL, title TEXT, kind TEXT NOT NULL, message TEXT,
      who TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL)`),
    db.prepare('CREATE INDEX IF NOT EXISTS reports_recipe ON recipe_reports(recipe_id, status)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS visits (day TEXT NOT NULL, page TEXT NOT NULL, count INTEGER NOT NULL,
      PRIMARY KEY (day, page))`),
    db.prepare('CREATE TABLE IF NOT EXISTS admin_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)'),
  ]).then(() => undefined).catch((e: any) => { ready = null; throw e; });
  return ready;
}

/** Melding over een recept of foto. */
export async function reportRecipe(env: AdminEnv, who: string, b: any) {
  await ensureAdminSchema(env.DB);
  const recipeId = String(b.recipe_id || '').slice(0, 64);
  const kind = REPORT_KINDS.includes(b.kind) ? b.kind : 'anders';
  if (!recipeId) return json({ detail: 'Geen recept opgegeven' }, 400);
  const recipe = await env.DB.prepare('SELECT id, title FROM recipes WHERE id = ?').bind(recipeId).first();
  if (!recipe) return json({ detail: 'Recept niet gevonden' }, 404);
  const today = await env.DB.prepare('SELECT COUNT(*) AS n FROM recipe_reports WHERE who = ? AND created_at > ?')
    .bind(who, Date.now() - DAY_MS).first();
  if (Number(today?.n) >= 10) return json({ detail: 'Je hebt vandaag al veel gemeld. Dank je wel!' }, 429);
  const dup = await env.DB.prepare(`SELECT id FROM recipe_reports WHERE who = ? AND recipe_id = ? AND kind = ? AND status = 'open'`)
    .bind(who, recipeId, kind).first();
  if (!dup) {
    await env.DB.prepare(`INSERT INTO recipe_reports (recipe_id, title, kind, message, who, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(recipeId, recipe.title, kind, String(b.message || '').slice(0, 1000), who, Date.now()).run();
  }
  // Automatisch ingrijpen bij meerdere meldingen van verschillende mensen.
  const { results } = await env.DB.prepare(`SELECT kind, COUNT(DISTINCT who) AS n FROM recipe_reports
    WHERE recipe_id = ? AND status = 'open' GROUP BY kind`).bind(recipeId).all();
  const byKind: Record<string, number> = {};
  let total = 0;
  for (const r of results || []) { byKind[r.kind] = Number(r.n); total += Number(r.n); }
  if ((byKind.foto || 0) >= NEW_PHOTO_AFTER) {
    await env.DB.prepare('UPDATE recipes SET has_image = 0 WHERE id = ?').bind(recipeId).run();
    await env.DB.prepare(`UPDATE recipe_reports SET status = 'nieuwe foto' WHERE recipe_id = ? AND kind = 'foto' AND status = 'open'`).bind(recipeId).run();
  }
  if (total - (byKind.foto || 0) >= HIDE_AFTER || (byKind.allergie || 0) >= 1) {
    // Allergie: direct uit de bank tot iemand het nakijkt (liever voorzichtig).
    await env.DB.prepare('UPDATE recipes SET hidden = 1 WHERE id = ?').bind(recipeId).run();
  }
  return json({ ok: true });
}

/** Bezoek tellen: geen cookie, geen IP-adres, alleen een teller per dag per pagina. */
export async function countVisit(env: AdminEnv, b: any) {
  const page = ['landing', 'app'].includes(b?.p) ? b.p : null;
  if (page) await tally(env, page);
  return new Response(null, { status: 204 });
}

/** Teller per dag (bezoek, scans). Geen persoonsgegevens. */
export async function tally(env: AdminEnv, page: string) {
  await ensureAdminSchema(env.DB);
  await env.DB.prepare(`INSERT INTO visits (day, page, count) VALUES (?, ?, 1)
    ON CONFLICT(day, page) DO UPDATE SET count = count + 1`).bind(new Date().toISOString().slice(0, 10), page).run();
}

const isAdmin = (req: Request, env: AdminEnv) => !!env.ADMIN_KEY && req.headers.get('x-admin-key') === env.ADMIN_KEY;

async function count(db: any, sql: string, ...args: any[]) {
  const r = await db.prepare(sql).bind(...args).first().catch(() => null);
  return Number(r?.n) || 0;
}

/** Cijfers voor het beheerscherm. */
async function overview(env: AdminEnv) {
  const db = env.DB;
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const trialStart = iso(now - 14 * DAY_MS);
  const users = {
    total: await count(db, 'SELECT COUNT(*) AS n FROM users'),
    new_7d: await count(db, 'SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', iso(now - 7 * DAY_MS).replace('T', ' ').slice(0, 19)),
    new_30d: await count(db, 'SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', iso(now - 30 * DAY_MS).replace('T', ' ').slice(0, 19)),
    trial_active: await count(db, `SELECT COUNT(*) AS n FROM users WHERE subscription = 'trial' AND trial_started_at >= ?`, trialStart),
    trial_ended_unpaid: await count(db, `SELECT COUNT(*) AS n FROM users WHERE subscription = 'trial' AND trial_started_at < ?`, trialStart),
    basic: await count(db, `SELECT COUNT(*) AS n FROM users WHERE subscription = 'basic'`),
    premium: await count(db, `SELECT COUNT(*) AS n FROM users WHERE subscription = 'premium'`),
    culinary: await count(db, `SELECT COUNT(*) AS n FROM users WHERE subscription = 'culinary'`),
    marketing_opt_in: await count(db, 'SELECT COUNT(*) AS n FROM users WHERE marketing_opt_in = 1'),
    verified: await count(db, 'SELECT COUNT(*) AS n FROM users WHERE email_verified = 1'),
  };
  const activity = {
    lists_total: await count(db, `SELECT COALESCE(SUM(count), 0) AS n FROM user_milestones WHERE key = 'lists'`),
    plans_total: await count(db, `SELECT COALESCE(SUM(count), 0) AS n FROM user_milestones WHERE key = 'plans'`),
    active_7d: await count(db, 'SELECT COUNT(DISTINCT user_id) AS n FROM user_milestones WHERE last_at > ?', now - 7 * DAY_MS),
  };
  const bank = {
    total: await count(db, 'SELECT COUNT(*) AS n FROM recipes'),
    with_recipe: await count(db, 'SELECT COUNT(*) AS n FROM recipes WHERE details_v >= 3'),
    with_photo: await count(db, 'SELECT COUNT(*) AS n FROM recipes WHERE has_image = 1'),
    hidden: await count(db, 'SELECT COUNT(*) AS n FROM recipes WHERE hidden = 1'),
  };
  const { results: visits } = await db.prepare(`SELECT day, page, count FROM visits WHERE day >= ? AND page IN ('landing', 'app') ORDER BY day`)
    .bind(iso(now - 13 * DAY_MS).slice(0, 10)).all();
  // Koelkastscan als ingang: scans door bezoekers en wie zich daarna registreerde (30 dagen).
  const since30 = iso(now - 30 * DAY_MS);
  const paidTiers = `('basic', 'premium', 'culinary')`;
  const scan = {
    visitor_scans_30d: await count(db, `SELECT COALESCE(SUM(count), 0) AS n FROM visits WHERE page = 'scan_bezoeker' AND day >= ?`, since30.slice(0, 10)),
    member_scans_30d: await count(db, `SELECT COALESCE(SUM(count), 0) AS n FROM visits WHERE page = 'scan_lid' AND day >= ?`, since30.slice(0, 10)),
    signups_30d: await count(db, `SELECT COUNT(*) AS n FROM users WHERE signup_source = 'scan' AND created_at >= ?`, since30.replace('T', ' ').slice(0, 19)),
    signups_total: await count(db, `SELECT COUNT(*) AS n FROM users WHERE signup_source = 'scan'`),
    paying_total: await count(db, `SELECT COUNT(*) AS n FROM users WHERE signup_source = 'scan' AND subscription IN ${paidTiers}`),
  };
  const { results: reports } = await db.prepare(`SELECT r.id, r.recipe_id, r.title, r.kind, r.message, r.status, r.created_at,
      COALESCE(x.hidden, 0) AS hidden FROM recipe_reports r LEFT JOIN recipes x ON x.id = r.recipe_id
      ORDER BY (r.status = 'open') DESC, r.created_at DESC LIMIT 60`).all().catch(() => ({ results: [] }));
  const rec = await db.prepare(`SELECT value FROM admin_state WHERE key = 'reconcile'`).first().catch(() => null);
  return { generated_at: iso(now), users, activity, bank, scan, visits: visits || [], reports: reports || [],
    billing: billingReady(env), reconcile: rec ? JSON.parse(rec.value) : null };
}

/** Actie vanuit het beheerscherm op een gemeld recept. */
async function adminAction(env: AdminEnv, b: any) {
  const db = env.DB;
  const recipeId = String(b.recipe_id || '');
  if (!recipeId) return json({ detail: 'Geen recept' }, 400);
  switch (b.action) {
    case 'resolve': await db.prepare(`UPDATE recipe_reports SET status = 'opgelost' WHERE recipe_id = ? AND status = 'open'`).bind(recipeId).run(); break;
    case 'hide': await db.prepare('UPDATE recipes SET hidden = 1 WHERE id = ?').bind(recipeId).run(); break;
    case 'unhide': await db.prepare('UPDATE recipes SET hidden = 0 WHERE id = ?').bind(recipeId).run(); break;
    case 'new_photo': await db.prepare('UPDATE recipes SET has_image = 0 WHERE id = ?').bind(recipeId).run(); break;
    case 'new_recipe': await db.prepare('UPDATE recipes SET details = NULL, details_v = 0 WHERE id = ?').bind(recipeId).run(); break;
    default: return json({ detail: 'Onbekende actie' }, 400);
  }
  return json({ ok: true });
}

/** Gebruikers zoeken op e-mail of naam (leeg = de nieuwste). */
async function findUsers(env: AdminEnv, q: string) {
  await ensureEngagementSchema(env.DB);
  await ensureColumns(env.DB);
  const like = `%${q.trim().toLowerCase().slice(0, 100)}%`;
  const { results } = await env.DB.prepare(`SELECT u.id, u.name, u.email, u.subscription, u.trial_started_at, u.created_at,
      u.last_login_at, u.email_verified, u.marketing_opt_in, u.stripe_customer_id,
      (SELECT COALESCE(SUM(CASE WHEN key = 'plans' THEN count END), 0) FROM user_milestones m WHERE m.user_id = u.id) AS plans,
      (SELECT COALESCE(SUM(CASE WHEN key = 'lists' THEN count END), 0) FROM user_milestones m WHERE m.user_id = u.id) AS lists
    FROM users u WHERE lower(u.email) LIKE ? OR lower(u.name) LIKE ? ORDER BY u.created_at DESC LIMIT 25`).bind(like, like).all();
  return (results || []).map((u: any) => {
    const trialLeft = u.subscription === 'trial' && u.trial_started_at
      ? Math.max(0, 14 - Math.floor((Date.now() - new Date(u.trial_started_at).getTime()) / DAY_MS)) : null;
    return { ...u, status: u.subscription === 'trial' ? (trialLeft ? 'proef' : 'gratis (proef voorbij)') : u.subscription, trial_days_left: trialLeft };
  });
}

/** Handmatige acties op een gebruiker (bijv. testers een abonnement geven of de proef verlengen). */
async function userAction(env: AdminEnv, b: any) {
  const id = String(b.id || '');
  const user = await env.DB.prepare('SELECT id, subscription, trial_started_at FROM users WHERE id = ?').bind(id).first();
  if (!user) return json({ detail: 'Gebruiker niet gevonden' }, 404);
  switch (b.action) {
    case 'extend_trial': {
      // 7 dagen erbij; was de proef al voorbij, dan een nieuwe week vanaf nu.
      const start = user.subscription === 'trial' && user.trial_started_at ? new Date(user.trial_started_at).getTime() : Date.now() - 14 * DAY_MS;
      const newStart = Math.max(start, Date.now() - 14 * DAY_MS) + 7 * DAY_MS;
      await env.DB.prepare(`UPDATE users SET subscription = 'trial', trial_started_at = ? WHERE id = ?`).bind(new Date(newStart).toISOString(), id).run();
      break;
    }
    case 'grant':
      if (!['free', 'basic', 'premium', 'culinary'].includes(b.tier)) return json({ detail: 'Onbekend abonnement' }, 400);
      await env.DB.prepare('UPDATE users SET subscription = ?, trial_started_at = NULL WHERE id = ?').bind(b.tier, id).run();
      break;
    case 'verify':
      await env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(id).run();
      break;
    default: return json({ detail: 'Onbekende actie' }, 400);
  }
  return json({ ok: true });
}

/** Eén keer per dag: Stripe en de database vergelijken (vanuit de geplande taak). */
export async function dailyAdminTasks(env: AdminEnv, now = Date.now()) {
  if (!billingReady(env)) return null;
  await ensureAdminSchema(env.DB);
  const today = new Date(now).toISOString().slice(0, 10);
  const last = await env.DB.prepare(`SELECT value FROM admin_state WHERE key = 'reconcile'`).first();
  if (last && JSON.parse(last.value).at?.slice(0, 10) === today) return null;
  const result = await reconcile(env);
  if (result) await env.DB.prepare(`INSERT INTO admin_state (key, value) VALUES ('reconcile', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify(result)).run();
  return result;
}

const ADMIN_PATHS = ['/api/admin/overview', '/api/admin/action', '/api/admin/revenue', '/api/admin/users', '/api/admin/user', '/api/admin/reconcile'];

/** /api/admin/* (alleen met ADMIN_KEY). */
export async function handleAdmin(req: Request, env: AdminEnv, path: string): Promise<Response | null> {
  if (!ADMIN_PATHS.includes(path)) return null;
  if (!isAdmin(req, env)) return json({ detail: 'Niet gevonden' }, 404);
  await ensureAdminSchema(env.DB);
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  try {
    if (req.method === 'GET' && path === '/api/admin/overview') return json(await overview(env));
    if (req.method === 'POST' && path === '/api/admin/action') return adminAction(env, body);
    if (req.method === 'GET' && path === '/api/admin/revenue') return json(await revenueOverview(env));
    if (req.method === 'GET' && path === '/api/admin/users') return json({ users: await findUsers(env, new URL(req.url).searchParams.get('q') || '') });
    if (req.method === 'POST' && path === '/api/admin/user') return userAction(env, body);
    if (req.method === 'POST' && path === '/api/admin/reconcile') {
      await env.DB.prepare(`DELETE FROM admin_state WHERE key = 'reconcile'`).run();
      return json(await dailyAdminTasks(env) || { enabled: false });
    }
  } catch (e: any) {
    console.error('Beheer', path, e?.message || e);
    return json({ detail: 'Ophalen lukte niet: ' + String(e?.message || e).slice(0, 120) }, 502);
  }
  return json({ detail: 'Niet gevonden' }, 404);
}
