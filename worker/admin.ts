/**
 * Qook — meldingen over recepten, eigen bezoekersstatistiek en het beheerscherm.
 *
 *  - "Klopt er iets niet?": iedereen kan een recept of foto melden. Bij 3 meldingen van verschillende
 *    mensen gaat een recept tijdelijk uit de receptenbank; bij 2 fotomeldingen wordt de foto opnieuw gemaakt.
 *  - Bezoekersstatistiek zonder cookies en zonder IP-adressen: alleen een teller per dag per pagina.
 *  - Beheer (/beheer/): overzicht van accounts, proeven, abonnementen, receptenbank en meldingen,
 *    alleen met de ADMIN_KEY.
 */
export interface AdminEnv { DB: any; ADMIN_KEY?: string }

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
  if (!page) return new Response(null, { status: 204 });
  await ensureAdminSchema(env.DB);
  await env.DB.prepare(`INSERT INTO visits (day, page, count) VALUES (?, ?, 1)
    ON CONFLICT(day, page) DO UPDATE SET count = count + 1`).bind(new Date().toISOString().slice(0, 10), page).run();
  return new Response(null, { status: 204 });
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
  const { results: visits } = await db.prepare('SELECT day, page, count FROM visits WHERE day >= ? ORDER BY day')
    .bind(iso(now - 13 * DAY_MS).slice(0, 10)).all();
  const { results: reports } = await db.prepare(`SELECT r.id, r.recipe_id, r.title, r.kind, r.message, r.status, r.created_at,
      COALESCE(x.hidden, 0) AS hidden FROM recipe_reports r LEFT JOIN recipes x ON x.id = r.recipe_id
      ORDER BY (r.status = 'open') DESC, r.created_at DESC LIMIT 60`).all();
  return { generated_at: iso(now), users, activity, bank, visits: visits || [], reports: reports || [] };
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

/** /api/admin/overview en /api/admin/action (alleen met ADMIN_KEY). */
export async function handleAdmin(req: Request, env: AdminEnv, path: string): Promise<Response | null> {
  if (path !== '/api/admin/overview' && path !== '/api/admin/action') return null;
  if (!isAdmin(req, env)) return json({ detail: 'Niet gevonden' }, 404);
  await ensureAdminSchema(env.DB);
  if (req.method === 'GET' && path === '/api/admin/overview') return json(await overview(env));
  if (req.method === 'POST' && path === '/api/admin/action') return adminAction(env, await req.json().catch(() => ({})));
  return json({ detail: 'Niet gevonden' }, 404);
}
