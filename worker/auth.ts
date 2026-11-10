/**
 * KOOQ — accounts: registreren, inloggen, uitloggen, gegevens synchroniseren,
 * wachtwoord vergeten en account verwijderen.
 *
 *  - Wachtwoorden: PBKDF2-SHA256 met een eigen salt per gebruiker (nooit leesbaar opgeslagen).
 *  - Sessies: willekeurige sleutel in een HttpOnly-cookie; in de database staat alleen de hash.
 *  - Te veel foute pogingen: tijdelijk geblokkeerd (per e-mailadres en per IP-adres).
 *  - Proefperiode: 14 dagen met Premium-functies (gerechten uit de receptenbank), daarna gratis.
 *  - Gegevens: de app bewaart instellingen, weekmenu, favorieten, smaakprofiel en geschiedenis
 *    per account, zodat ze op elk apparaat hetzelfde zijn.
 *
 * Instellingen (optioneel):
 *  - PASSWORD_ITERATIONS: rekenwerk per wachtwoord (standaard 100000, het maximum van Cloudflare).
 *  - RESEND_API_KEY + MAIL_FROM: e-mail versturen voor "wachtwoord vergeten" (vereist een eigen domein).
 */

export interface AuthEnv {
  DB: any;
  PASSWORD_ITERATIONS?: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
}

const COOKIE = 'kooq_session';
const SESSION_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ITERATIONS = 100000;           // bovengrens van PBKDF2 in Cloudflare Workers
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;                 // begrenst het rekenwerk per poging
const RESET_MINUTES = 60;
const TRIAL_DAYS = 14;

/** Gegevens die de app per account bewaart (dezelfde namen als in de browser). */
export const SYNC_KEYS = ['qook_prefs', 'qook_current_plan', 'qook_favorites', 'qook_favorite_meals', 'qook_usage',
  'qook_taste', 'qook_meal_history', 'qook_pantry_have', 'qook_shop_order'];
const MAX_VALUE_BYTES = 300_000;

class AuthError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
let schemaReady: Promise<void> | null = null;
export function ensureAuthSchema(env: AuthEnv) {
  if (!schemaReady) {
    schemaReady = env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL DEFAULT '',
        password TEXT NOT NULL,
        subscription TEXT NOT NULL DEFAULT 'trial',
        trial_started_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_login_at TEXT
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)'),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_data (
        user_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, key)
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS auth_attempts (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        reset_at INTEGER NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS password_resets (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )`),
    ]).then(() => undefined).catch((e: any) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

// ---------------------------------------------------------------------------
// Cryptografie
// ---------------------------------------------------------------------------
const enc = new TextEncoder();
const toB64 = (b: ArrayBuffer | Uint8Array) => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64url = (b: Uint8Array) => toB64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
}

const iterations = (env: AuthEnv) => {
  const n = Number(env.PASSWORD_ITERATIONS);
  return n >= 10000 ? Math.min(MAX_ITERATIONS, Math.floor(n)) : MAX_ITERATIONS;
};

async function pbkdf2(password: string, salt: Uint8Array, iter: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}

async function hashPassword(env: AuthEnv, password: string) {
  const iter = iterations(env);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${iter}$${toB64(salt)}$${toB64(await pbkdf2(password, salt, iter))}`;
}

/** Vergelijkt zonder vroegtijdig te stoppen (geen informatie via de tijdsduur). */
function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function verifyPassword(stored: string, password: string) {
  const [kind, iter, salt, hash] = String(stored).split('$');
  if (kind !== 'pbkdf2' || !iter || !salt || !hash) return false;
  return sameBytes(await pbkdf2(password, fromB64(salt), Number(iter)), fromB64(hash));
}

// Nep-hash voor onbekende e-mailadressen, zodat de tijdsduur niet verraadt of een account bestaat.
let dummyHash: Promise<string> | null = null;

// ---------------------------------------------------------------------------
// Controles
// ---------------------------------------------------------------------------
const normEmail = (e: any) => String(e || '').trim().toLowerCase();
const validEmail = (e: string) => e.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

function checkPassword(p: any) {
  const s = String(p || '');
  if (s.length < MIN_PASSWORD) throw new AuthError(400, `Kies een wachtwoord van minimaal ${MIN_PASSWORD} tekens.`);
  if (s.length > MAX_PASSWORD) throw new AuthError(400, 'Dit wachtwoord is te lang.');
  return s;
}

const clientIp = (req: Request) => req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'onbekend';

/** Telt pogingen per sleutel; boven het maximum binnen het venster: geblokkeerd. */
async function tooMany(env: AuthEnv, key: string, max: number) {
  const row = await env.DB.prepare('SELECT count, reset_at FROM auth_attempts WHERE key = ?').bind(key).first();
  return !!row && row.reset_at > Date.now() && row.count >= max;
}
async function countAttempt(env: AuthEnv, key: string, windowMin: number) {
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO auth_attempts (key, count, reset_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN reset_at <= ? THEN 1 ELSE count + 1 END,
      reset_at = CASE WHEN reset_at <= ? THEN excluded.reset_at ELSE reset_at END`)
    .bind(key, now + windowMin * 60000, now, now).run();
}
const clearAttempts = (env: AuthEnv, key: string) => env.DB.prepare('DELETE FROM auth_attempts WHERE key = ?').bind(key).run();

/** Aanvragen van een andere website weigeren (extra bescherming naast SameSite-cookies). */
function sameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === new URL(req.url).host; } catch { return false; }
}

// ---------------------------------------------------------------------------
// Sessies
// ---------------------------------------------------------------------------
function readCookie(req: Request, name: string) {
  const header = req.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

const sessionCookie = (token: string, maxAgeSec: number) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;

async function createSession(env: AuthEnv, userId: string) {
  const token = randomToken();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), userId, Date.now() + SESSION_DAYS * DAY_MS).run();
  return sessionCookie(token, SESSION_DAYS * 24 * 3600);
}

/** Ingelogde gebruiker bij deze aanvraag (of null). Verlengt de sessie als die over de helft is. */
export async function currentUser(req: Request, env: AuthEnv): Promise<{ user: any; refresh?: string } | null> {
  const token = readCookie(req, COOKIE);
  if (!token || token.length > 100) return null;
  await ensureAuthSchema(env);
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(`SELECT s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?`).bind(hash).first();
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run();
    return null;
  }
  let refresh: string | undefined;
  if (row.expires_at - Date.now() < (SESSION_DAYS / 2) * DAY_MS) {
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(Date.now() + SESSION_DAYS * DAY_MS, hash).run();
    refresh = sessionCookie(token, SESSION_DAYS * 24 * 3600);
  }
  return { user: row, refresh };
}

/**
 * Rechten van een gebruiker op dit moment. Een nieuw account krijgt 14 dagen proef met
 * Premium-functies (gerechten uit de receptenbank); daarna zonder betaling terug naar gratis.
 */
export function tierOf(u: any): 'visitor' | 'free' | 'basic' | 'trial' | 'premium' | 'culinary' {
  if (!u) return 'visitor';
  if (u.subscription === 'trial') {
    const ends = new Date(u.trial_started_at || 0).getTime() + TRIAL_DAYS * DAY_MS;
    return Date.now() <= ends ? 'trial' : 'free';
  }
  return ['free', 'basic', 'premium', 'culinary'].includes(u.subscription) ? u.subscription : 'free';
}

/** Voor de app: een proefperiode is "premium" met een startdatum (zo toont de app de resterende dagen). */
const publicUser = (u: any) => {
  const tier = tierOf(u);
  return {
    name: u.name, email: u.email,
    subscription: tier === 'trial' ? 'premium' : tier,
    trial_started_at: tier === 'trial' ? u.trial_started_at : null,
  };
};

async function loadData(env: AuthEnv, userId: string) {
  const { results } = await env.DB.prepare('SELECT key, value, updated_at FROM user_data WHERE user_id = ?').bind(userId).all();
  const data: Record<string, { value: string; updated_at: number }> = {};
  for (const r of results || []) data[r.key] = { value: r.value, updated_at: Number(r.updated_at) };
  return data;
}

/** Bewaart gegevens uit de app; alleen bekende sleutels en begrensde grootte. */
async function saveData(env: AuthEnv, userId: string, items: any) {
  if (!items || typeof items !== 'object') throw new AuthError(400, 'Geen gegevens ontvangen');
  const now = Date.now();
  const stmts: any[] = [];
  for (const [key, value] of Object.entries(items)) {
    if (!SYNC_KEYS.includes(key)) continue;
    if (value === null) {
      stmts.push(env.DB.prepare('DELETE FROM user_data WHERE user_id = ? AND key = ?').bind(userId, key));
      continue;
    }
    const v = String(value);
    if (enc.encode(v).length > MAX_VALUE_BYTES) throw new AuthError(413, `Te veel gegevens voor ${key}`);
    stmts.push(env.DB.prepare(`INSERT INTO user_data (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(userId, key, v, now));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return now;
}

// ---------------------------------------------------------------------------
// E-mail (wachtwoord vergeten) via Resend — alleen als het is ingesteld
// ---------------------------------------------------------------------------
const mailReady = (env: AuthEnv) => !!(env.RESEND_API_KEY && env.MAIL_FROM);

async function sendMail(env: AuthEnv, to: string, subject: string, text: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    console.error('Mail versturen mislukt', res.status, (await res.text()).slice(0, 300));
    throw new AuthError(502, 'De e-mail kon niet verstuurd worden. Probeer het later opnieuw.');
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
async function register(req: Request, env: AuthEnv, b: any) {
  const ip = clientIp(req);
  if (await tooMany(env, `reg:${ip}`, 10)) throw new AuthError(429, 'Te veel nieuwe accounts vanaf dit adres. Probeer het later opnieuw.');
  const email = normEmail(b.email);
  if (!validEmail(email)) throw new AuthError(400, 'Vul een geldig e-mailadres in.');
  const name = String(b.name || '').trim().slice(0, 80);
  if (!name) throw new AuthError(400, 'Vul je naam in.');
  const password = checkPassword(b.password);

  const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (exists) throw new AuthError(409, 'Er bestaat al een account met dit e-mailadres. Log in of kies "Wachtwoord vergeten".');

  const id = crypto.randomUUID();
  const trial = new Date().toISOString();
  try {
    await env.DB.prepare(`INSERT INTO users (id, email, name, password, subscription, trial_started_at, last_login_at)
      VALUES (?, ?, ?, ?, 'trial', ?, CURRENT_TIMESTAMP)`).bind(id, email, name, await hashPassword(env, password), trial).run();
  } catch (e: any) {
    if (/unique/i.test(String(e?.message))) throw new AuthError(409, 'Er bestaat al een account met dit e-mailadres.');
    throw e;
  }
  await countAttempt(env, `reg:${ip}`, 60);
  // Wat de bezoeker al in de app had (instellingen, weekmenu, ...) gaat mee naar het account.
  if (b.data && typeof b.data === 'object') await saveData(env, id, b.data).catch(e => console.warn('Gegevens meenemen mislukt', e?.message));
  const user = { id, email, name, subscription: 'trial', trial_started_at: trial };
  return json({ user: publicUser(user), data: await loadData(env, id) }, 201, { 'set-cookie': await createSession(env, id) });
}

async function login(req: Request, env: AuthEnv, b: any) {
  const email = normEmail(b.email);
  const password = String(b.password || '').slice(0, MAX_PASSWORD);
  const ip = clientIp(req);
  if (await tooMany(env, `login:${email}`, 8) || await tooMany(env, `ip:${ip}`, 30)) {
    throw new AuthError(429, 'Te veel inlogpogingen. Wacht een kwartier en probeer het opnieuw.');
  }
  const user = email ? await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first() : null;
  let ok = false;
  if (user) ok = await verifyPassword(user.password, password);
  else {
    dummyHash ||= hashPassword(env, 'geen-account');
    await verifyPassword(await dummyHash, password);
  }
  if (!user || !ok) {
    await countAttempt(env, `login:${email}`, 15);
    await countAttempt(env, `ip:${ip}`, 15);
    throw new AuthError(401, 'E-mailadres of wachtwoord klopt niet.');
  }
  await clearAttempts(env, `login:${email}`);
  // Sterkere instelling dan bij het aanmaken? Dan het wachtwoord meteen opnieuw versleutelen.
  const storedIter = Number(String(user.password).split('$')[1]) || 0;
  const updates = [env.DB.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').bind(user.id)];
  if (storedIter < iterations(env)) {
    updates.push(env.DB.prepare('UPDATE users SET password = ? WHERE id = ?').bind(await hashPassword(env, password), user.id));
  }
  await env.DB.batch(updates);
  return json({ user: publicUser(user), data: await loadData(env, user.id) }, 200, { 'set-cookie': await createSession(env, user.id) });
}

async function logout(req: Request, env: AuthEnv) {
  const token = readCookie(req, COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
}

async function forgot(req: Request, env: AuthEnv, b: any) {
  if (!mailReady(env)) {
    throw new AuthError(501, 'Wachtwoord herstellen via e-mail is nog niet beschikbaar. Neem contact met ons op.');
  }
  const email = normEmail(b.email);
  const ip = clientIp(req);
  if (await tooMany(env, `forgot:${ip}`, 5) || await tooMany(env, `forgot:${email}`, 3)) {
    throw new AuthError(429, 'Er is al een e-mail verstuurd. Kijk in je inbox (en spam) of probeer het later opnieuw.');
  }
  await countAttempt(env, `forgot:${ip}`, 60);
  await countAttempt(env, `forgot:${email}`, 60);
  const user = validEmail(email) ? await env.DB.prepare('SELECT id, name FROM users WHERE email = ?').bind(email).first() : null;
  if (user) {
    const token = randomToken();
    await env.DB.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(await sha256Hex(token), user.id, Date.now() + RESET_MINUTES * 60000).run();
    const link = `${new URL(req.url).origin}/app/?reset=${token}`;
    await sendMail(env, email, 'Nieuw wachtwoord voor Qook',
      `Hoi ${user.name || ''},\n\nJe hebt gevraagd om een nieuw wachtwoord voor Qook. Kies een nieuw wachtwoord via deze link ` +
      `(${RESET_MINUTES} minuten geldig):\n\n${link}\n\nHeb je dit niet zelf gevraagd? Dan kun je deze e-mail negeren.\n\nGroet,\nQook`);
  }
  // Altijd hetzelfde antwoord, zodat niet te zien is of een e-mailadres een account heeft.
  return json({ ok: true });
}

async function resetPassword(env: AuthEnv, b: any) {
  const password = checkPassword(b.password);
  const hash = await sha256Hex(String(b.token || ''));
  const row = await env.DB.prepare('SELECT user_id, expires_at FROM password_resets WHERE token_hash = ?').bind(hash).first();
  if (!row || row.expires_at < Date.now()) throw new AuthError(400, 'Deze link is verlopen of al gebruikt. Vraag een nieuwe aan.');
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password = ? WHERE id = ?').bind(await hashPassword(env, password), row.user_id),
    env.DB.prepare('DELETE FROM password_resets WHERE user_id = ?').bind(row.user_id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.user_id),   // overal uitloggen
  ]);
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(row.user_id).first();
  return json({ user: publicUser(user), data: await loadData(env, row.user_id) }, 200, { 'set-cookie': await createSession(env, row.user_id) });
}

async function deleteAccount(env: AuthEnv, user: any, b: any) {
  if (!(await verifyPassword(user.password, String(b.password || '').slice(0, MAX_PASSWORD)))) {
    throw new AuthError(401, 'Wachtwoord klopt niet.');
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM user_data WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM password_resets WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
}

/** Afhandeling van /api/auth/* en /api/account/*. Geeft null terug voor andere paden. */
export async function handleAuth(req: Request, env: AuthEnv, path: string): Promise<Response | null> {
  if (!path.startsWith('/api/auth/') && !path.startsWith('/api/account/')) return null;
  try {
    await ensureAuthSchema(env);
    if (req.method !== 'GET' && !sameOrigin(req)) throw new AuthError(403, 'Niet toegestaan');
    const body: any = req.method === 'GET' ? {} : await req.json().catch(() => ({}));

    if (req.method === 'POST' && path === '/api/auth/register') return await register(req, env, body);
    if (req.method === 'POST' && path === '/api/auth/login') return await login(req, env, body);
    if (req.method === 'POST' && path === '/api/auth/logout') return await logout(req, env);
    if (req.method === 'POST' && path === '/api/auth/forgot') return await forgot(req, env, body);
    if (req.method === 'POST' && path === '/api/auth/reset') return await resetPassword(env, body);
    if (req.method === 'GET' && path === '/api/auth/config') return json({ password_reset: mailReady(env) });

    const session = await currentUser(req, env);
    const headers: Record<string, string> = session?.refresh ? { 'set-cookie': session.refresh } : {};
    if (req.method === 'GET' && path === '/api/auth/me') {
      if (!session) return json({ user: null });
      return json({ user: publicUser(session.user), data: await loadData(env, session.user.id) }, 200, headers);
    }
    if (!session) throw new AuthError(401, 'Je bent niet (meer) ingelogd.');
    if (req.method === 'PUT' && path === '/api/account/data') {
      return json({ ok: true, updated_at: await saveData(env, session.user.id, body.items) }, 200, headers);
    }
    if (req.method === 'POST' && path === '/api/account/subscription') {
      // Tijdelijk, tot de betaling (Stripe) er is: de gekozen abonnementsvorm onthouden.
      const tier = String(body.tier || '');
      if (!['free', 'basic', 'premium', 'culinary'].includes(tier)) throw new AuthError(400, 'Onbekend abonnement');
      await env.DB.prepare('UPDATE users SET subscription = ?, trial_started_at = NULL WHERE id = ?').bind(tier, session.user.id).run();
      return json({ ok: true, subscription: tier }, 200, headers);
    }
    if (req.method === 'POST' && path === '/api/account/delete') return await deleteAccount(env, session.user, body);
    return json({ detail: 'Niet gevonden' }, 404);
  } catch (e: any) {
    if (e instanceof AuthError) return json({ detail: e.message }, e.status);
    console.error(path, e?.stack || e);
    return json({ detail: 'Er ging iets mis op de server' }, 500);
  }
}
