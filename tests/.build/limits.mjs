/**
 * KOOQ — rechten per abonnement, gecontroleerd op de server.
 *
 *  - Bezoeker (niet ingelogd), Gratis, Basic en Proefperiode: weekmenu's en vervangingen komen uit de
 *    receptenbank (vrijwel geen AI-kosten). Alleen als de bank echt niets passends heeft, maakt de AI
 *    iets — met een daglimiet.
 *  - Premium en Culinair: de AI stemt het menu af op het smaakprofiel en vult aan waar nodig.
 *  - Weekmenu: iedereen 1x per week automatisch; Premium/Culinair/proef 1x per week extra (plus speling).
 *  - Per actie een limiet per dag of week. De app laat dezelfde grenzen netjes zien; dit is het vangnet.
 */
/** Wie alleen uit de receptenbank krijgt (geen AI-afstemming). */
export const BANK_ONLY = new Set(['visitor', 'free', 'basic', 'trial']);
const LIMITS = {
    //            weekmenu      vervangen      koelkastscan   chat          AI-aanvulling
    visitor: { plan: [3, 'day'], replace: [5, 'week'], scan: [1, 'week'], chat: [5, 'day'], fallback: [2, 'day'] },
    free: { plan: [2, 'week'], replace: [3, 'week'], scan: [1, 'week'], chat: [5, 'day'], fallback: [2, 'day'] },
    basic: { plan: [2, 'week'], replace: [3, 'week'], scan: [1, 'week'], chat: [10, 'day'], fallback: [3, 'day'] },
    trial: { plan: [3, 'week'], replace: [40, 'day'], scan: [1, 'week'], chat: [10, 'day'], fallback: [3, 'day'] },
    premium: { plan: [3, 'week'], replace: [60, 'day'], scan: [20, 'day'], chat: [50, 'day'], fallback: [20, 'day'] },
    culinary: { plan: [3, 'week'], replace: [60, 'day'], scan: [20, 'day'], chat: [100, 'day'], fallback: [20, 'day'] },
};
const MESSAGES = {
    plan: 'Je krijgt elke week automatisch een nieuw weekmenu. Met Premium kun je daarnaast 1x per week zelf een nieuw '
        + 'menu laten maken; losse gerechten vervangen kan altijd.',
    replace: 'Je hebt je vervangingen voor deze week gebruikt. Met Premium vervang je onbeperkt.',
    scan: 'Je hebt je koelkastscan voor deze week gebruikt. Met Premium scan je onbeperkt.',
    chat: 'Je hebt vandaag al veel met de sous-chef gepraat. Morgen kan het weer.',
    fallback: 'Er zijn even geen nieuwe gerechten beschikbaar die bij je voorkeuren passen. Probeer het morgen opnieuw.',
};
export class LimitError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
const DAY_MS = 864e5;
const periodId = (p, now = Date.now()) => p === 'day' ? new Date(now).toISOString().slice(0, 10)
    // Weken beginnen op maandag (1 januari 1970 was een donderdag).
    : `w${Math.floor((now / DAY_MS + 3) / 7)}`;
const periodEnd = (p, now = Date.now()) => p === 'day' ? (Math.floor(now / DAY_MS) + 1) * DAY_MS
    : (Math.floor((now / DAY_MS + 3) / 7) + 1) * 7 * DAY_MS - 3 * DAY_MS;
let ready = null;
function ensureTable(db) {
    ready ||= db.prepare(`CREATE TABLE IF NOT EXISTS usage_counters (
      key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL)`).run()
        .then(() => undefined).catch((e) => { ready = null; throw e; });
    return ready;
}
const keyFor = (actor, action) => {
    const [, period] = LIMITS[actor.tier][action];
    // Per abonnement apart geteld: na een upgrade begin je met een schone lei.
    return `${actor.who}|${actor.tier}|${action}|${periodId(period)}`;
};
/** Mag dit nog? Gooit een LimitError (402) als de grens bereikt is. */
export async function checkLimit(db, actor, action) {
    await ensureTable(db);
    const [max] = LIMITS[actor.tier][action];
    const row = await db.prepare('SELECT count FROM usage_counters WHERE key = ?').bind(keyFor(actor, action)).first();
    if (row && row.count >= max)
        throw new LimitError(action === 'fallback' ? 503 : 402, MESSAGES[action]);
}
/** Eén keer gebruikt (na een gelukte actie). */
export async function countUse(db, actor, action) {
    await ensureTable(db);
    const [, period] = LIMITS[actor.tier][action];
    await db.prepare(`INSERT INTO usage_counters (key, count, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET count = count + 1`).bind(keyFor(actor, action), periodEnd(period)).run();
}
/** Opruimen van verlopen tellers (vanuit de geplande taak). */
export async function cleanupCounters(db) {
    await ensureTable(db);
    await db.prepare('DELETE FROM usage_counters WHERE expires_at < ?').bind(Date.now() - DAY_MS).run();
}
/** Welke actie hoort bij welke route. */
export const ROUTE_ACTIONS = {
    '/api/weekly-plan': 'plan',
    '/api/replace-meal': 'replace',
    '/api/fridge-scan': 'scan',
    '/api/chat': 'chat',
};
