/**
 * Qook — de proefperiode goed laten landen.
 *
 *  - Mijlpalen per account (weekmenu's, boodschappenlijsten, hergebruikte ingrediënten, gekookt):
 *    alleen aantallen, geen externe tracking. De app toont ze in de proefbanner.
 *  - E-mailreeks tijdens en na de proef, verstuurd door de geplande taak:
 *      dienstberichten (welkom, proef stopt) altijd;
 *      tips en aanbiedingen alleen met toestemming (vinkje bij registratie of in instellingen),
 *      met afmeldlink in elke mail.
 *    Er gaat pas iets de deur uit als e-mail is ingesteld (RESEND_API_KEY + MAIL_FROM).
 */
import { MailEnv, mailReady, sendMail } from './mail';

export interface EngagementEnv extends MailEnv { DB: any; APP_URL?: string }

const DAY_MS = 864e5;
const TRIAL_DAYS = 14;
const DEFAULT_URL = 'https://qook-app.max-5ff.workers.dev';
const MAILS_PER_RUN = 40;

/** Het aanbod aan het einde van de proef. Pas dit aan als er een korting komt. */
export const TRIAL_OFFER = 'Kies je voor een jaar Premium, dan betaal je €39,99: €3,33 per maand, een derde minder dan per maand.';

export const MILESTONES = ['plans', 'lists', 'recipes', 'replaced', 'scans', 'cooked', 'liked', 'reused'] as const;
export type Milestone = typeof MILESTONES[number];
const CLIENT_MILESTONES = new Set(['cooked', 'liked']);

let ready: Promise<void> | null = null;
export function ensureEngagementSchema(db: any) {
  if (!ready) ready = migrate(db).catch((e: any) => { ready = null; throw e; });
  return ready;
}

async function migrate(db: any) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS user_milestones (
      user_id TEXT NOT NULL, key TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, value INTEGER NOT NULL DEFAULT 0,
      first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, PRIMARY KEY (user_id, key))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS email_log (
      user_id TEXT NOT NULL, kind TEXT NOT NULL, sent_at INTEGER NOT NULL, PRIMARY KEY (user_id, kind))`),
  ]);
  // Toestemming voor tips/aanbiedingen en een afmeldsleutel bij de gebruikers.
  const { results } = await db.prepare('PRAGMA table_info(users)').all();
  const have = new Set((results || []).map((r: any) => r.name));
  for (const [name, type] of [['marketing_opt_in', 'INTEGER NOT NULL DEFAULT 0'], ['unsub_token', 'TEXT']]) {
    if (have.has(name)) continue;
    try { await db.prepare(`ALTER TABLE users ADD COLUMN ${name} ${type}`).run(); }
    catch (e: any) { if (!/duplicate column/i.test(String(e?.message))) throw e; }
  }
}

/** Mijlpaal bijhouden (alleen voor ingelogde gebruikers). value = laatste waarde, bv. aantal hergebruikte ingrediënten. */
export async function recordMilestone(db: any, who: string | undefined, key: Milestone, value?: number) {
  if (!who || !who.startsWith('u:')) return;
  await ensureEngagementSchema(db);
  const now = Date.now();
  await db.prepare(`INSERT INTO user_milestones (user_id, key, count, value, first_at, last_at) VALUES (?, ?, 1, ?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET count = count + 1,
      value = CASE WHEN excluded.value > value THEN excluded.value ELSE value END, last_at = excluded.last_at`)
    .bind(who.slice(2), key, Math.max(0, Math.round(value || 0)), now, now).run();
}

export const isClientMilestone = (k: any): k is Milestone => CLIENT_MILESTONES.has(k);

export async function loadStats(db: any, userId: string) {
  await ensureEngagementSchema(db);
  const { results } = await db.prepare('SELECT key, count, value FROM user_milestones WHERE user_id = ?').bind(userId).all();
  const stats: Record<string, number> = {};
  for (const r of results || []) stats[r.key] = r.key === 'reused' ? Number(r.value) : Number(r.count);
  return stats;
}

/** Hoeveel ingrediënten in meer dan één recept van de lijst voorkomen (= hergebruik). */
export function countReused(recipeIngredientNames: string[][]) {
  const norm = (n: string) => n.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-zà-ÿ ]/g, ' ').replace(/\s+/g, ' ').trim();
  const STAPLE = /^(zout|peper|zwarte peper|water|olie|olijfolie|zonnebloemolie|boter|suiker|bloem)$/;
  const seen = new Map<string, number>();
  for (const names of recipeIngredientNames) {
    for (const n of new Set(names.map(norm).filter(n => n && !STAPLE.test(n)))) seen.set(n, (seen.get(n) || 0) + 1);
  }
  return [...seen.values()].filter(c => c > 1).length;
}

// ---------------------------------------------------------------------------
// E-mailreeks
// ---------------------------------------------------------------------------
interface MailStep {
  kind: string;
  day: number;                 // vanaf hoeveel dagen na de start van de proef
  until: number;               // tot (niet meer sturen als het te laat is)
  marketing: boolean;          // alleen met toestemming
  when?: (u: any, s: Record<string, number>) => boolean;
  subject: (u: any, s: Record<string, number>) => string;
  body: (u: any, s: Record<string, number>, url: string) => string;
}

const inTrial = (u: any) => u.subscription === 'trial';
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const STEPS: MailStep[] = [
  {
    kind: 'welcome', day: 0, until: 3, marketing: false,
    subject: () => 'Welkom bij Qook: zo haal je het meeste uit je proef',
    body: (u, _s, url) => `Hoi ${u.name},

Welkom bij Qook! De komende 14 dagen heb je alle Premium-functies.

Zo begin je:
1. Open je weekmenu en vervang wat je niet lekker vindt (zo vaak je wilt).
2. Tik op "Weekboodschappen": alles voor de hele week op één lijst, in de volgorde van de winkel.
3. Vink onder "Heb je dit nog in huis?" af wat je al hebt. Dat onthoudt Qook voor de volgende keer.

Naar je weekmenu: ${url}/app/

Eet smakelijk,
Qook`,
  },
  {
    kind: 'activate', day: 2, until: 6, marketing: true, when: (u, s) => inTrial(u) && !s.lists,
    subject: () => 'Je eerste weekboodschappen in één keer',
    body: (u, _s, url) => `Hoi ${u.name},

Je hebt nog geen boodschappenlijst gemaakt. Dat is waar Qook je het meeste tijd en geld bespaart:
één keer per week naar de winkel, met precies de hoeveelheden die je nodig hebt.

Open je weekmenu en tik op "Weekboodschappen": ${url}/app/

Groet,
Qook`,
  },
  {
    kind: 'value', day: 6, until: 10, marketing: true, when: (u, s) => inTrial(u) && !!(s.plans || s.lists),
    subject: () => 'Jouw eerste week met Qook',
    body: (u, s, url) => `Hoi ${u.name},

Je eerste week zit erop. Dit heb je tot nu toe gedaan:
- ${plural(s.plans || 0, 'weekmenu', "weekmenu's")} gemaakt
- ${plural(s.lists || 0, 'boodschappenlijst', 'boodschappenlijsten')} gemaakt${s.reused ? `
- ${plural(s.reused, 'ingrediënt', 'ingrediënten')} in meer dan één gerecht gebruikt, dus niets half laten liggen` : ''}${s.cooked ? `
- ${plural(s.cooked, 'keer', 'keer')} met de kookassistent gekookt` : ''}

Tip: geef na het koken een duim omhoog of omlaag. Dan wordt je menu elke week beter.

${url}/app/

Groet,
Qook`,
  },
  {
    kind: 'offer', day: 11, until: 14, marketing: true, when: inTrial,
    subject: () => 'Nog 3 dagen Premium',
    body: (u, s, url) => `Hoi ${u.name},

Je proefperiode loopt over 3 dagen af. Daarna ga je verder met Qook Gratis:
nog steeds elke week een menu, maar maar 1 volledig recept en 3 vervangingen per week.

Met Premium houd je onbeperkt vervangen, elke week een extra weekmenu en een menu dat zich aanpast aan jullie smaak.
${TRIAL_OFFER}
${s.lists ? `
Je hebt al ${plural(s.lists, 'boodschappenlijst', 'boodschappenlijsten')} met Qook gemaakt. Ga zo door: ` : '\nKies je abonnement: '}${url}/app/

Groet,
Qook`,
  },
  {
    kind: 'ending', day: 13, until: 15, marketing: false, when: inTrial,
    subject: () => 'Je proefperiode stopt morgen',
    body: (u, _s, url) => `Hoi ${u.name},

Morgen stopt je gratis proefperiode van Qook Premium. Je hoeft niets te doen: je gaat vanzelf verder met Qook Gratis en er wordt niets afgeschreven.

Wil je Premium houden? Kies je abonnement in de app: ${url}/app/

Groet,
Qook`,
  },
  {
    kind: 'winback', day: 17, until: 30, marketing: true, when: inTrial,   // nog 'trial' in de database = niet betaald
    subject: () => 'Je kookt nu met Qook Gratis',
    body: (u, _s, url) => `Hoi ${u.name},

Je proef is voorbij en je gebruikt nu Qook Gratis. Je krijgt nog steeds elke week een menu en een boodschappenlijst.

Mis je het onbeperkt vervangen en de recepten voor de hele week? ${TRIAL_OFFER}

${url}/app/

Groet,
Qook`,
  },
];

const randomToken = () => {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Eén ronde van de e-mailreeks (vanuit de geplande taak). */
export async function runTrialMails(env: EngagementEnv, now = Date.now()) {
  if (!mailReady(env)) return { sent: 0, skipped: 'e-mail niet ingesteld' };
  await ensureEngagementSchema(env.DB);
  const url = (env.APP_URL || DEFAULT_URL).replace(/\/$/, '');
  // Alleen accounts die nog in of net na de proef zitten (subscription 'trial' = nog niet betaald).
  const { results } = await env.DB.prepare(
    `SELECT id, name, email, subscription, trial_started_at, marketing_opt_in, unsub_token FROM users
     WHERE subscription = 'trial' AND trial_started_at IS NOT NULL`).all();
  let sent = 0;
  const errors: string[] = [];
  for (const u of results || []) {
    if (sent >= MAILS_PER_RUN) break;
    const day = Math.floor((now - new Date(u.trial_started_at).getTime()) / DAY_MS);
    const due = STEPS.filter(s => day >= s.day && day < s.until && (!s.marketing || u.marketing_opt_in));
    if (!due.length) continue;
    const { results: log } = await env.DB.prepare('SELECT kind FROM email_log WHERE user_id = ?').bind(u.id).all();
    const done = new Set((log || []).map((l: any) => l.kind));
    const stats = await loadStats(env.DB, u.id);
    // Per ronde hoogstens één mail per gebruiker: de laatste die van toepassing is.
    const step = due.filter(s => !done.has(s.kind) && (!s.when || s.when(u, stats))).pop();
    if (!step) continue;
    let token = u.unsub_token;
    if (!token) {
      token = randomToken();
      await env.DB.prepare('UPDATE users SET unsub_token = ? WHERE id = ?').bind(token, u.id).run();
    }
    const unsubscribeUrl = `${url}/api/email/unsubscribe?t=${token}`;
    const text = step.body(u, stats, url) + (step.marketing
      ? `\n\n—\nJe krijgt deze e-mail omdat je tips en aanbiedingen van Qook wilt ontvangen. Afmelden: ${unsubscribeUrl}`
      : '');
    try {
      await sendMail(env, u.email, step.subject(u, stats), text, step.marketing ? { unsubscribeUrl } : {});
      // Gemiste eerdere stappen niet alsnog sturen.
      await env.DB.batch(due.filter(s => !done.has(s.kind) && STEPS.indexOf(s) <= STEPS.indexOf(step))
        .map(s => env.DB.prepare('INSERT OR IGNORE INTO email_log (user_id, kind, sent_at) VALUES (?, ?, ?)').bind(u.id, s.kind, now)));
      sent++;
    } catch (e: any) {
      errors.push(`${step.kind}: ${String(e?.message || e).slice(0, 100)}`);
    }
  }
  return { sent, errors };
}

/** Afmelden via de link in de e-mail (werkt zonder inloggen). */
export async function unsubscribe(env: EngagementEnv, token: string) {
  await ensureEngagementSchema(env.DB);
  if (token && token.length >= 20) {
    await env.DB.prepare('UPDATE users SET marketing_opt_in = 0 WHERE unsub_token = ?').bind(token).run();
  }
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Afgemeld – Qook</title>
<body style="font-family:system-ui,sans-serif;background:#F5F7F4;color:#2A3338;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px">
<main style="max-width:420px;text-align:center"><h1 style="font-size:1.5rem">Je bent afgemeld</h1>
<p>Je krijgt geen tips en aanbiedingen meer van Qook. Berichten over je account (zoals een nieuw wachtwoord) blijven we wel sturen.</p>
<p><a href="/app/" style="color:#5E8A69">Naar Qook</a></p></main></body>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
