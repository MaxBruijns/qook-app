/**
 * KOOQ — alles in één Cloudflare Worker.
 *
 *  - Serveert de website (map ./dist, gebouwd door Vite).
 *  - /api/*  : de backend. Volgt de AI-logica van het oorspronkelijke
 *              AI Studio-ontwerp (9 januari), maar dan veilig op de server.
 *  - Tekst   : Google Gemini via GEMINI_API_KEY.
 *  - Foto's  : Workers AI (FLUX schnell), één keer per gerecht, bewaard in R2 (als webp).
 *  - Data    : D1-database met de receptenbank.
 *
 * Receptenbank:
 *  - Elke 20 minuten vult een geplande taak (cron) de bank aan: nieuwe gerechten per
 *    categorie, volledige recepten en foto's. Zo hoeft de AI bij een verzoek bijna niets
 *    meer te maken.
 *  - Een weekmenu wordt eerst uit de bank samengesteld; de AI maakt alleen wat ontbreekt.
 *
 * Instellingen (Cloudflare → Worker → Settings → Variables and Secrets):
 *  - GEMINI_API_KEY (secret, verplicht)
 *  - TEXT_MODEL     (optioneel, standaard gemini-3.5-flash-lite) — weekmenu, vervangen, chat
 *  - RECIPE_MODEL   (optioneel, standaard gemini-3.8-flash) — volledige recepten (1x per gerecht)
 *  - ADMIN_KEY      (optioneel, secret) — maakt POST /api/admin/seed mogelijk (handmatig aanvullen)
 *  - SEED_DETAILS_PER_RUN / SEED_IMAGES_PER_RUN (optioneel) — hoeveel per cron-ronde
 *  - PASSWORD_ITERATIONS, RESEND_API_KEY, MAIL_FROM (optioneel) — accounts, zie worker/auth.ts
 */

import { handleAuth, currentUser, tierOf } from './auth';
import { Actor, BANK_ONLY, ROUTE_ACTIONS, LimitError, checkLimit, countUse, cleanupCounters } from './limits';
import { recordMilestone, countReused, runTrialMails, unsubscribe, cleanupInactiveAccounts, Milestone } from './engagement';
import { handleAdmin, reportRecipe, countVisit, dailyAdminTasks, tally } from './admin';
import { handleBilling } from './billing';
import { handleExternal } from './external';

interface Env {
  DB: any;            // D1-database (receptenbank)
  PHOTOS: any;        // R2-bucket (maaltijdfoto's)
  AI: any;            // Workers AI
  ASSETS: any;        // De gebouwde website
  IMAGES?: any;       // Cloudflare Images (verkleinen naar webp)
  GEMINI_API_KEY: string;
  TEXT_MODEL?: string;
  RECIPE_MODEL?: string;
  ADMIN_KEY?: string;
  APP_URL?: string;    // adres van de site voor links in e-mails (standaard het workers.dev-adres)
  SEED_DETAILS_PER_RUN?: string;
  SEED_IMAGES_PER_RUN?: string;
  PASSWORD_ITERATIONS?: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  LIMITS?: string;     // 'off' = geen limieten en volledige AI (alleen voor testen)
  // Stripe (zie worker/billing.ts)
  STRIPE_SECRET_KEY?: string; STRIPE_WEBHOOK_SECRET?: string; STRIPE_PRICE_BASIC_YEAR?: string;
  STRIPE_PRICE_PREMIUM_MONTH?: string; STRIPE_PRICE_PREMIUM_YEAR?: string;
  STRIPE_PRICE_CULINARY_MONTH?: string; STRIPE_PRICE_CULINARY_YEAR?: string;
}

const FULL_ACCESS: Actor = { tier: 'premium', who: 'test' };
/** AI mag gerechten bijmaken voor wie alleen uit de bank krijgt — maar met een daglimiet. */
async function allowFallback(env: Env, actor?: Actor) {
  if (!actor || !BANK_ONLY.has(actor.tier)) return;
  await checkLimit(env.DB, actor, 'fallback');
  await countUse(env.DB, actor, 'fallback');
}
const bankOnly = (actor?: Actor) => !!actor && BANK_ONLY.has(actor.tier);

type Ctx = { waitUntil(p: Promise<any>): void } | undefined;

const IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';
/** Volledige recepten worden voor dit aantal personen bewaard; de app rekent om. */
const BASE_SERVINGS = 4;

// ---------------------------------------------------------------------------
// Hulpfuncties
// ---------------------------------------------------------------------------
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

class ApiError extends Error {
  constructor(public status: number, message: string, public retry = false) { super(message); }
}

const LANGS: Record<string, string> = { nl: 'Nederlands', en: 'Engels', de: 'Duits', fr: 'Frans', es: 'Spaans' };
const langName = (code = 'nl') => LANGS[String(code).toLowerCase().slice(0, 2)] || 'Engels';

const parseJson = (text: string) => {
  let t = (text || '').trim();
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(t);
};

const list = (a: any) => (Array.isArray(a) ? a : []);
const errMsg = (e: any) => String(e?.message || e).slice(0, 200);

/** Werk dat na het antwoord doorloopt (alleen als Cloudflare een context meegeeft). */
const background = (ctx: Ctx, p: () => Promise<any>) => {
  if (ctx?.waitUntil) ctx.waitUntil(p().catch(e => console.warn('Achtergrondtaak mislukt:', errMsg(e))));
};

// ---------------------------------------------------------------------------
// Gemini (met tijdslimiet en één herhaalpoging)
// ---------------------------------------------------------------------------
const DEFAULT_TEXT_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_RECIPE_MODEL = 'gemini-3.8-flash';

interface AiOpts { timeoutMs?: number; retries?: number }

async function aiJson(env: Env, system: string, prompt: string, temperature = 0.8, imageB64?: string,
                      modelOverride?: string, opts: AiOpts = {}): Promise<any> {
  if (!env.GEMINI_API_KEY) throw new ApiError(500, 'GEMINI_API_KEY ontbreekt in de Worker-instellingen');
  const model = modelOverride || env.TEXT_MODEL || DEFAULT_TEXT_MODEL;
  const parts: any[] = [];
  if (imageB64) parts.push({ inline_data: { mime_type: 'image/jpeg', data: imageB64 } });
  parts.push({ text: prompt });

  const generationConfig: any = { responseMimeType: 'application/json', temperature };
  if (model.startsWith('gemini-2.5-flash')) generationConfig.thinkingConfig = { thinkingBudget: 0 };
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    generationConfig,
  });

  const timeoutMs = opts.timeoutMs ?? 40000;
  const retries = opts.retries ?? 1;
  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await aiOnce(env, model, body, timeoutMs);
    } catch (e: any) {
      lastErr = e;
      const retryable = !(e instanceof ApiError) || e.retry;
      if (!retryable || attempt === retries) break;
      console.warn(`AI-poging ${attempt + 1} mislukt (${errMsg(e)}), nog een keer`);
    }
  }
  if (lastErr instanceof ApiError) throw lastErr;
  if (lastErr?.name === 'TimeoutError' || lastErr?.name === 'AbortError') {
    throw new ApiError(504, 'De AI reageerde te traag. Probeer het nog eens.');
  }
  console.error('AI niet bereikbaar', errMsg(lastErr));
  throw new ApiError(502, 'AI-fout');
}

async function aiOnce(env: Env, model: string, body: string, timeoutMs: number) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    console.error('Gemini-fout', res.status, (await res.text()).slice(0, 500));
    if (res.status === 429) throw new ApiError(429, 'De AI is even druk (daglimiet bereikt). Probeer het later opnieuw.');
    throw new ApiError(502, 'AI-fout', res.status >= 500);
  }
  const data: any = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('');
  try {
    return parseJson(text);
  } catch {
    console.error('Geen geldige JSON van Gemini:', text.slice(0, 500));
    throw new ApiError(502, 'AI gaf een onleesbaar antwoord, probeer opnieuw', true);
  }
}

// ---------------------------------------------------------------------------
// Vaste lijsten: hoofdingrediënt, keuken, dieet
// (Vaste waarden maken de variatieregels betrouwbaar: geen "hert = rundvlees" meer.)
// ---------------------------------------------------------------------------
const normTitle = (t: any) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const normWord = (w: any) => normTitle(w).split(' ')[0] || '';

const MAINS = ['kip', 'kalkoen', 'eend', 'rundvlees', 'varkensvlees', 'gehakt', 'lamsvlees', 'wild', 'zalm', 'witvis',
  'tonijn', 'vis', 'zeevruchten', 'peulvruchten', 'tofu', 'ei', 'kaas', 'paddenstoelen', 'groenten', 'aardappel', 'pasta', 'rijst'];

/** Volgorde is belangrijk: specifiek vóór algemeen. Getest op genormaliseerde tekst (kleine letters, geen accenten). */
const MAIN_SYNONYMS: [RegExp, string][] = [
  [/gehakt|burger|kofta|kefta|bal(len|letjes)\b/, 'gehakt'],
  [/kalkoen/, 'kalkoen'],
  [/\beend|eendenborst/, 'eend'],
  [/kip|hoen|poulet|chicken/, 'kip'],
  [/garnal|gamba|scampi|kreeft|krab|mossel|oester|coquille|jakobsschelp|inktvis|calamar|octopus|zeevrucht|schaaldier|schelpdier/, 'zeevruchten'],
  [/zalm/, 'zalm'],
  [/tonijn/, 'tonijn'],
  [/kabeljauw|zeebaars|\bschol|tilapia|pangasius|\bheek\b|koolvis|zeeduivel|dorade|zeebrasem|witvis|wijting|schelvis|snoekbaars|\btong\b|tarbot|griet|poon|hake|\bcod\b/, 'witvis'],
  [/makreel|haring|forel|sardine|sardien|ansjovis|paling|\bvis\b|fish/, 'vis'],
  [/\bhert|\bree\b|reebout|reerug|everzwijn|fazant|parelhoen|konijn|\bhazen|\bhaas\b|\bwild\b|venison/, 'wild'],
  [/\blam\b|lams|lamb/, 'lamsvlees'],
  [/rund|biefstuk|ossenhaas|entrecote|ribeye|rib eye|steak|sukade|kalf|beef|tournedos|ossenstaart|stoofvlees|riblap/, 'rundvlees'],
  [/varken|\bspek|\bham\b|worst|chorizo|pancetta|speklap|karbonade|saucijs|pork|procureur|hamlap|spareribs|varkenshaas|schnitzel|prosciutto/, 'varkensvlees'],
  [/bonen|\bboon|kikkererwt|linze|\berwt|peulvrucht|edamame|falafel|dahl|dal\b|lentil|chickpea|bean/, 'peulvruchten'],
  [/tofu|tempeh|seitan/, 'tofu'],
  [/^eieren$|^ei$|\beieren\b|\bei\b|\begg|omelet|frittata|shakshuka/, 'ei'],
  [/kaas|halloumi|feta|mozzarella|ricotta|paneer|burrata|parmezaan|brie|camembert|gorgonzola|cheese/, 'kaas'],
  [/paddenstoel|champignon|shiitake|oesterzwam|truffel|mushroom/, 'paddenstoelen'],
  [/zoete aardappel|bataat|groente|bloemkool|broccoli|pompoen|aubergine|courgette|spinazie|\bkool\b|wortel|prei|paprika|tomaat|venkel|biet|asperge|vegetable/, 'groenten'],
  [/aardappel|krieler|potato/, 'aardappel'],
  [/pasta|spaghetti|penne|noedel|noodle|gnocchi|lasagne|tagliatelle|macaroni|\bmie\b|ravioli|orzo/, 'pasta'],
  [/rijst|risotto|couscous|quinoa|bulgur|rice/, 'rijst'],
];

function canonMain(v: any): string {
  const n = normTitle(v);
  if (!n) return '';
  if (MAINS.includes(n)) return n;
  for (const [re, main] of MAIN_SYNONYMS) if (re.test(n)) return main;
  return n.split(' ')[0].slice(0, 20);
}

const CUISINES = ['Hollands', 'Belgisch', 'Frans', 'Italiaans', 'Spaans', 'Portugees', 'Grieks', 'Mediterraan', 'Brits',
  'Duits', 'Scandinavisch', 'Oost-Europees', 'Midden-Oosters', 'Marokkaans', 'Afrikaans', 'Indiaas', 'Chinees', 'Japans',
  'Koreaans', 'Thais', 'Vietnamees', 'Indonesisch', 'Mexicaans', 'Latijns-Amerikaans', 'Amerikaans', 'Fusion'];

const CUISINE_SYNONYMS: [RegExp, string][] = [
  [/nederlands|dutch|oudhollands/, 'Hollands'],
  [/vlaams/, 'Belgisch'],
  [/turks|libanees|perzisch|iraans|israelisch|arabisch|syrisch|levant/, 'Midden-Oosters'],
  [/noord afrikaans|tunesisch|algerijns/, 'Marokkaans'],
  [/ethiopisch|west afrikaans|zuid afrikaans|senegalees/, 'Afrikaans'],
  [/surinaams|caribisch|peruaans|braziliaans|argentijns|cubaans|colombiaans|latin/, 'Latijns-Amerikaans'],
  [/tex mex|mexican/, 'Mexicaans'],
  [/zweeds|noors|deens|fins|nordic/, 'Scandinavisch'],
  [/pools|hongaars|russisch|oekraiens|tsjechisch/, 'Oost-Europees'],
  [/engels|iers|schots|british/, 'Brits'],
  [/oostenrijks|zwitsers|german/, 'Duits'],
  [/bbq|american|cajun|southern/, 'Amerikaans'],
  [/italian/, 'Italiaans'], [/french/, 'Frans'], [/spanish/, 'Spaans'], [/greek/, 'Grieks'],
  [/indian|pakistaans|sri lankaans/, 'Indiaas'], [/chinese|kantonees|sichuan/, 'Chinees'], [/japanese/, 'Japans'],
  [/korean/, 'Koreaans'], [/thai/, 'Thais'], [/vietnamese/, 'Vietnamees'], [/maleis|indonesian/, 'Indonesisch'],
  [/mediterranean/, 'Mediterraan'], [/fusion|modern|internationaal/, 'Fusion'],
];

function canonCuisine(v: any): string {
  const n = normTitle(v);
  if (!n) return '';
  for (const c of CUISINES) if (normTitle(c) === n) return c;
  for (const [re, c] of CUISINE_SYNONYMS) if (re.test(n)) return c;
  for (const c of CUISINES) if (n.includes(normTitle(c))) return c;
  const s = String(v).trim().slice(0, 30);
  return s[0].toUpperCase() + s.slice(1);
}

/** De keukenprofielen uit de onboarding, vertaald naar keukens uit de vaste lijst. */
const KITCHEN_CUISINES: Record<string, string[]> = {
  'Klassiek Europees': ['Frans', 'Italiaans', 'Spaans', 'Brits', 'Duits', 'Belgisch'],
  'Mediterrane & Midden-Oosters': ['Grieks', 'Mediterraan', 'Spaans', 'Italiaans', 'Midden-Oosters', 'Marokkaans', 'Portugees'],
  'Aziatisch – Chinees': ['Chinees'],
  'Aziatisch – Japans': ['Japans', 'Koreaans'],
  'Aziatisch – Zuid/Oost': ['Thais', 'Vietnamees', 'Indonesisch', 'Indiaas'],
  'Latijns-Amerikaans': ['Mexicaans', 'Latijns-Amerikaans'],
  'Noord-Amerikaans & BBQ': ['Amerikaans'],
  'Noord- & West-Europees': ['Hollands', 'Belgisch', 'Brits', 'Duits', 'Scandinavisch', 'Frans'],
  'Afrikaans': ['Afrikaans', 'Marokkaans'],
  'Fusion & Modern': ['Fusion'],
  'Italiaans': ['Italiaans'],
};
const preferredCuisines = (profiles: any) =>
  new Set(list(profiles).flatMap((p: string) => KITCHEN_CUISINES[p] || [canonCuisine(p)]).map(normWord));

const DIET_TAGS = ['vegetarisch', 'vegan', 'pescotarisch', 'glutenvrij', 'lactosevrij', 'notenvrij', 'halal', 'lowcarb'];
const DIET_TAG_SYNONYMS: Record<string, string> = {
  veganistisch: 'vegan', vegetarian: 'vegetarisch', vega: 'vegetarisch', pescatarisch: 'pescotarisch',
  pescetarisch: 'pescotarisch', glutenarm: 'glutenvrij', glutenfree: 'glutenvrij', lactosearm: 'lactosevrij',
  zuivelvrij: 'lactosevrij', notenallergie: 'notenvrij', koolhydraatarm: 'lowcarb', keto: 'lowcarb',
};

function canonDietTags(a: any): string[] {
  const tags = new Set<string>();
  for (const t of list(a)) {
    const n = normTitle(t).replace(/ /g, '');
    const tag = DIET_TAGS.includes(n) ? n : DIET_TAG_SYNONYMS[n];
    if (tag) tags.add(tag);
  }
  if (tags.has('vegan')) tags.add('vegetarisch');
  if (tags.has('vegetarisch')) tags.add('pescotarisch');
  return DIET_TAGS.filter(t => tags.has(t));
}

/** Dieet van de gebruiker → labels voor de receptenbank. Onbekende diëten (Keto, Paleo, "Anders"): bank niet gebruiken. */
const USER_DIET_TAGS: Record<string, string> = {
  Vegetarisch: 'vegetarisch', Vegan: 'vegan', Pescotarisch: 'pescotarisch', Halal: 'halal', Glutenarm: 'glutenvrij',
  Lactosevrij: 'lactosevrij', Notenvrij: 'notenvrij', 'Low-carb': 'lowcarb',
};
function userDiet(prefs: any): { ok: boolean; tags: string[] } {
  const tags: string[] = [];
  for (const d of list(prefs.diet)) {
    if (!d || d === 'Geen') continue;
    const tag = USER_DIET_TAGS[d];
    if (!tag) return { ok: false, tags: [] };
    tags.push(tag);
  }
  if (prefs.customDiet && String(prefs.customDiet).trim()) return { ok: false, tags: [] };
  return { ok: true, tags };
}

/** Dieetkeuzes zoals de instellingen ze kennen (de chat gaf soms "vegetarisch" met kleine letter). */
const DIET_OPTIONS = ['Vegetarisch', 'Vegan', 'Pescotarisch', 'Halal', 'Glutenarm', 'Lactosevrij', 'Keto', 'Paleo', 'Notenvrij', 'Low-carb'];
const DIET_OPTION_SYNONYMS: Record<string, string> = {
  veganistisch: 'Vegan', vegetarian: 'Vegetarisch', vega: 'Vegetarisch', pescatarisch: 'Pescotarisch', pescetarisch: 'Pescotarisch',
  glutenvrij: 'Glutenarm', glutenfree: 'Glutenarm', lactosearm: 'Lactosevrij', zuivelvrij: 'Lactosevrij',
  koolhydraatarm: 'Low-carb', notenallergie: 'Notenvrij',
};
function canonDietList(a: any): string[] {
  const out: string[] = [];
  for (const d of list(a)) {
    const n = normTitle(d).replace(/ /g, '');
    if (!n || n === 'geen' || n === 'none') continue;
    const hit = DIET_OPTIONS.find(o => normTitle(o).replace(/ /g, '') === n) || DIET_OPTION_SYNONYMS[n];
    const s = String(d).trim();
    out.push(hit || s[0].toUpperCase() + s.slice(1));
  }
  return out.length ? [...new Set(out)] : ['Geen'];
}

/** "Kip Tikka Masala Met Naan" → "Kip tikka masala met naan". Korte namen (Beef Wellington) blijven staan. */
function cleanTitle(t: any): string {
  let s = String(t || '').replace(/\s+/g, ' ').trim().replace(/^["'“]+|["'”]+$/g, '').trim();
  if (!s) return '';
  const words = s.split(' ');
  const isCap = (w: string) => /^[A-ZÀ-Þ][a-zà-ÿ]/.test(w);
  const rest = words.slice(1).filter(w => /^[A-Za-zÀ-ÿ]/.test(w));
  if (words.length >= 3 && rest.length >= 2 && rest.filter(isCap).length / rest.length > 0.6) {
    s = [words[0], ...words.slice(1).map(w => (isCap(w) ? w[0].toLowerCase() + w.slice(1) : w))].join(' ');
  }
  return s[0].toUpperCase() + s.slice(1);
}

/** Gerecht van de AI opschonen: vaste waarden, nette titel, juiste modus. */
function cleanMeal(m: any, mode?: string) {
  const out: any = { ...(m || {}) };
  out.title = cleanTitle(out.title);
  const main = canonMain(out.main_ingredient);
  if (main) out.main_ingredient = main; else delete out.main_ingredient;
  const cuisine = canonCuisine(out.cuisine);
  if (cuisine) out.cuisine = cuisine; else delete out.cuisine;
  out.diet_tags = canonDietTags(out.diet_tags);
  out.kid_friendly = out.kid_friendly === true || out.kid_friendly === 'true';
  const t = Number(out.estimated_time_minutes);
  if (t > 0) out.estimated_time_minutes = Math.round(t);
  if (mode) out.mode = mode;
  return out;
}

// ---------------------------------------------------------------------------
// Receptenbank (D1)
//   data    = het gerecht (overzichtsvelden)
//   details = volledig recept (ingrediënten, stappen, ...), voor BASE_SERVINGS personen
//   overige kolommen = om snel te kunnen zoeken (modus, hoofdingrediënt, keuken, dieet, ...)
// ---------------------------------------------------------------------------
/** Versie van de receptregels. Recepten vanaf MIN_RECIPE_VERSION worden hergebruikt. */
const RECIPE_VERSION = 4;
const MIN_RECIPE_VERSION = 3;

const EXTRA_COLUMNS: [string, string][] = [
  ['mode', 'TEXT'], ['main', 'TEXT'], ['cuisine', 'TEXT'], ['diet_tags', 'TEXT'], ['kid', 'INTEGER NOT NULL DEFAULT 0'],
  ['minutes', 'INTEGER'], ['details_v', 'INTEGER NOT NULL DEFAULT 0'], ['seed_cat', 'TEXT'], ['uses', 'INTEGER NOT NULL DEFAULT 0'], ['hidden', 'INTEGER NOT NULL DEFAULT 0'],
];

let schemaReady: Promise<void> | null = null;
function ensureSchema(env: Env) {
  if (!schemaReady) schemaReady = migrate(env).catch((e: any) => { schemaReady = null; throw e; });
  return schemaReady;
}

async function migrate(env: Env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS recipes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    data TEXT NOT NULL,
    details TEXT,
    has_image INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  const { results } = await env.DB.prepare('PRAGMA table_info(recipes)').all();
  const have = new Set((results || []).map((r: any) => r.name));
  const missing = EXTRA_COLUMNS.filter(([name]) => !have.has(name));
  for (const [name, type] of missing) {
    try {
      await env.DB.prepare(`ALTER TABLE recipes ADD COLUMN ${name} ${type}`).run();
    } catch (e) {
      if (!/duplicate column/i.test(errMsg(e))) throw e; // tegelijk door een andere aanvraag toegevoegd
    }
  }
  const stmts = [
    env.DB.prepare('CREATE INDEX IF NOT EXISTS recipes_title ON recipes(title)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS recipes_mode ON recipes(mode)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS recipes_seed ON recipes(seed_cat)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS worker_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)'),
  ];
  if (missing.length) {
    // Eenmalig: bestaande gerechten doorzoekbaar maken.
    stmts.push(env.DB.prepare(`UPDATE recipes SET
      mode = json_extract(data, '$.mode'),
      main = lower(json_extract(data, '$.main_ingredient')),
      cuisine = json_extract(data, '$.cuisine'),
      minutes = json_extract(data, '$.estimated_time_minutes'),
      details_v = COALESCE(json_extract(details, '$.v'), 0)
      WHERE mode IS NULL`));
  }
  await env.DB.batch(stmts);
}

const imageUrl = (id: string) => `/api/images/${id}.jpg`;

const SUMMARY_FIELDS = ['title', 'short_description', 'ai_image_prompt', 'main_ingredient', 'cuisine', 'estimated_time_minutes',
  'difficulty', 'calories_per_portion', 'diet_tags', 'kid_friendly', 'chefs_hack', 'wine_pairing', 'plating_tips', 'mode'];

/** Bewaart gerechten in de bank. Bestaande titels worden hergebruikt (incl. foto en volledig recept). */
async function saveRecipes(env: Env, meals: any[], seedCat?: string) {
  await ensureSchema(env);
  meals = meals.filter(Boolean);
  if (!meals.length) return meals;
  meals.forEach(m => { m.title = String(m.title || '').trim() || 'Gerecht'; });
  const titles = [...new Set(meals.map(m => m.title))];
  const existing = new Map<string, any>();
  const { results } = await env.DB.prepare(
    `SELECT id, title, has_image FROM recipes WHERE title IN (${titles.map(() => '?').join(',')})`
  ).bind(...titles).all();
  for (const r of results || []) existing.set(r.title, r);

  const inserts: any[] = [];
  for (const m of meals) {
    const found = existing.get(m.title);
    if (found) {
      m.id = found.id;
      m.image_url = found.has_image ? imageUrl(found.id) : null;
      continue;
    }
    m.id = crypto.randomUUID();
    m.image_url = null;
    existing.set(m.title, { id: m.id, has_image: 0 });
    const data: any = {};
    for (const k of SUMMARY_FIELDS) if (m[k] !== undefined) data[k] = m[k];
    const tags = canonDietTags(m.diet_tags);
    inserts.push(env.DB.prepare(`INSERT INTO recipes (id, title, data, mode, main, cuisine, diet_tags, kid, minutes, seed_cat)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      m.id, m.title, JSON.stringify(data), m.mode || null, canonMain(m.main_ingredient) || null,
      canonCuisine(m.cuisine) || null, tags.length ? `,${tags.join(',')},` : ',', m.kid_friendly ? 1 : 0,
      Number(m.estimated_time_minutes) || null, seedCat || null));
  }
  if (inserts.length) await env.DB.batch(inserts);
  return meals;
}

async function findRecipe(env: Env, id?: string, title?: string) {
  await ensureSchema(env);
  if (id) {
    const row = await env.DB.prepare('SELECT * FROM recipes WHERE id = ?').bind(String(id)).first();
    if (row) return row;
  }
  if (title) return env.DB.prepare('SELECT * FROM recipes WHERE title = ? LIMIT 1').bind(String(title).trim()).first();
  return null;
}

/** Gerechten uit de bank ophalen zoals de app ze verwacht. */
async function loadMeals(env: Env, ids: string[]) {
  const out = new Map<string, any>();
  if (!ids.length) return out;
  const { results } = await env.DB.prepare(
    `SELECT id, title, data, has_image FROM recipes WHERE id IN (${ids.map(() => '?').join(',')})`
  ).bind(...ids).all();
  for (const r of results || []) {
    out.set(r.id, { ...JSON.parse(r.data || '{}'), id: r.id, title: r.title, image_url: r.has_image ? imageUrl(r.id) : null });
  }
  await env.DB.prepare(`UPDATE recipes SET uses = uses + 1 WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).run();
  return out;
}

// ---------------------------------------------------------------------------
// Maaltijdfoto's (Workers AI -> webp -> R2), één keer per gerecht
// ---------------------------------------------------------------------------
const inflight = new Map<string, Promise<string>>();
const IMAGE_WIDTH = 800;

function base64ToBytes(b64: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Verkleinen naar 800px webp (±80 KB i.p.v. ±740 KB). Lukt dat niet, dan het origineel. */
async function toWebp(env: Env, bytes: Uint8Array): Promise<{ body: Uint8Array; type: string }> {
  if (!env.IMAGES) return { body: bytes, type: 'image/jpeg' };
  try {
    const result = await env.IMAGES.input(new Response(bytes).body)
      .transform({ width: IMAGE_WIDTH })
      .output({ format: 'image/webp', quality: 80 });
    const body = new Uint8Array(await result.response().arrayBuffer());
    return body.length ? { body, type: 'image/webp' } : { body: bytes, type: 'image/jpeg' };
  } catch (e) {
    console.warn('Verkleinen mislukt, origineel bewaard:', errMsg(e));
    return { body: bytes, type: 'image/jpeg' };
  }
}

// Status van het foto's maken: lukt het even niet (bijv. dagbudget Workers AI op),
// dan pauzeren we tot het budget weer vrij is in plaats van elke aanvraag te laten mislukken.
async function readState(env: Env, key: string): Promise<any> {
  const row: any = await env.DB.prepare('SELECT value FROM worker_state WHERE key = ?').bind(key).first().catch(() => null);
  try { return row ? JSON.parse(row.value) : null; } catch { return null; }
}
async function writeState(env: Env, key: string, value: any) {
  await env.DB.prepare('INSERT INTO worker_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, JSON.stringify(value)).run().catch(() => {});
}
export function imagePauseFor(message: string, now = Date.now()): number | null {
  if (/4006|daily free allocation|neurons?\b|quota|exceeded/i.test(message)) {
    const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) + 5 * 60_000;
  }
  if (/429|rate.?limit|too many|capacity|overloaded/i.test(message)) return now + 10 * 60_000;
  return null;
}
async function imagesPaused(env: Env): Promise<number | null> {
  const st = await readState(env, 'images');
  return st?.paused_until && st.paused_until > Date.now() ? st.paused_until : null;
}

async function createImage(env: Env, recipe: any): Promise<string> {
  if (recipe.has_image) return imageUrl(recipe.id);
  if (await imagesPaused(env)) throw new ApiError(503, 'Foto\'s maken lukt even niet; later opnieuw');
  const data = JSON.parse(recipe.data || '{}');
  // Zelfde opbouw als het origineel, aangevuld voor een realistische foodfoto.
  const prompt =
    `A professional food photography shot of ${recipe.title}. ${data.ai_image_prompt || ''}. ` +
    '4k, cinematic lighting. Plated dish, appetizing, realistic. No text, no watermark, no people, no hands.';
  let out: any;
  try {
    out = await env.AI.run(IMAGE_MODEL, { prompt: prompt.slice(0, 2000), steps: 6 });
    if (!out?.image) throw new Error('Geen afbeelding ontvangen van Workers AI');
  } catch (e) {
    const message = errMsg(e).slice(0, 300);
    const paused_until = imagePauseFor(message);
    console.error('Foto maken mislukt:', message);
    await writeState(env, 'images', { last_error: message, at: new Date().toISOString(), paused_until });
    throw new ApiError(503, 'Foto\'s maken lukt even niet; later opnieuw');
  }
  const { body, type } = await toWebp(env, base64ToBytes(out.image));
  await env.PHOTOS.put(`meals/${recipe.id}.jpg`, body, { httpMetadata: { contentType: type } });
  await env.DB.prepare('UPDATE recipes SET has_image = 1 WHERE id = ?').bind(recipe.id).run();
  return imageUrl(recipe.id);
}

function imageOnce(env: Env, recipe: any) {
  let p = inflight.get(recipe.id);
  if (!p) {
    p = createImage(env, recipe).finally(() => inflight.delete(recipe.id));
    inflight.set(recipe.id, p);
  }
  return p;
}

async function getOrCreateImage(env: Env, b: any) {
  const recipe = await findRecipe(env, b.recipe_id, b.title);
  if (!recipe) throw new ApiError(404, 'Recept staat niet in de receptenbank');
  return { status: 'success', url: await imageOnce(env, recipe) };
}

async function serveImage(env: Env, name: string, ctx: Ctx) {
  const key = `meals/${name}`;
  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response('Niet gevonden', { status: 404 });
  const headers = { 'cache-control': 'public, max-age=31536000, immutable' };
  const type = obj.httpMetadata?.contentType || 'image/jpeg';
  if (type === 'image/jpeg' && env.IMAGES) {
    // Oude, grote foto: één keer verkleinen en de kleine versie bewaren.
    const { body, type: newType } = await toWebp(env, new Uint8Array(await obj.arrayBuffer()));
    if (newType === 'image/webp') background(ctx, () => env.PHOTOS.put(key, body, { httpMetadata: { contentType: newType } }));
    return new Response(body, { headers: { ...headers, 'content-type': newType } });
  }
  return new Response(obj.body, { headers: { ...headers, 'content-type': type } });
}

// ---------------------------------------------------------------------------
// Prompts (overgenomen uit het oorspronkelijke ontwerp)
// ---------------------------------------------------------------------------
const MEAL_SHAPE = `{
  "title": "naam van het gerecht in gewone zinsopbouw: alleen het eerste woord en eigennamen met hoofdletter, bv. 'Kip tikka masala met naanbrood'",
  "short_description": "aantrekkelijke omschrijving in één zin",
  "ai_image_prompt": "korte Engelse beschrijving van hoe het opgemaakte bord eruitziet",
  "estimated_time_minutes": 30,
  "difficulty": "Makkelijk | Gemiddeld | Gevorderd",
  "calories_per_portion": 600,
  "main_ingredient": "precies één uit: ${MAINS.join(', ')}",
  "cuisine": "precies één uit: ${CUISINES.join(', ')}",
  "diet_tags": ["alle die echt van toepassing zijn uit: ${DIET_TAGS.join(', ')}"],
  "kid_friendly": true
}
UITLEG VELDEN:
- main_ingredient is het eiwit of hoofdbestanddeel. Hert, ree, fazant, konijn = wild. Kabeljauw, zeebaars, schol,
  heek = witvis. Makreel, forel, haring = vis. Garnalen, mosselen, inktvis = zeevruchten. Bonen, kikkererwten,
  linzen = peulvruchten. Vegetarisch zonder duidelijk eiwit: groenten, pasta, rijst of aardappel.
- kid_friendly: true als kinderen van 4-12 jaar het lusten: mild (niet pittig), geen alcohol, herkenbaar.`;

/** In de looproute van een gemiddelde Nederlandse supermarkt: groente bij de ingang, diepvries als laatste. */
const SHOP_CATEGORIES = ['Groente & fruit', 'Brood & bakkerij', 'Vlees, vis & vega', 'Zuivel, kaas & eieren',
  'Pasta, rijst & granen', 'Conserven & sauzen', 'Kruiden & specerijen', 'Olie, azijn & bakproducten', 'Diepvries', 'Overig'];

const FULL_RECIPE_SHAPE = `{
  "ingredients": [{"name": "...", "amount": 0, "unit": "gram | ml | stuks | eetlepel | theelepel | teen | bosje | blik | snufje | naar smaak", "category": "precies één uit: ${SHOP_CATEGORIES.join(' | ')}"}],
  "steps": [{"step_index": 1, "user_text": "...", "needs_timer": false, "timer_label": "...", "estimated_duration_seconds": 0}],
  "supplies": ["benodigd keukengerei"],
  "nutrition": {"calories": 0},
  "chefs_hack": "één slimme kooktip",
  "plating_tips": "...",
  "wine_pairing": {"type": "...", "description": "..."}
}`;

const RECIPE_RULES = `KWALITEITSREGELS (controleer je recept hierop voordat je antwoordt):
1. Elk ingrediënt uit de lijst wordt in de stappen gebruikt, en elk ingrediënt dat in de stappen voorkomt staat in de lijst,
   met dezelfde naam (dus niet "olie" in de lijst en "olijfolie" in de stappen).
2. Hoeveelheden kloppen met de stappen: wordt iets op twee plekken gebruikt, dan is de totale hoeveelheid daarop berekend.
3. Noem de oven ALLEEN als het gerecht echt in de oven gaat. Zo ja: temperatuur en tijd in de stap.
4. Geef bij bakken, koken, grillen en sudderen altijd een concrete tijd of een duidelijk teken van gaarheid.
5. De laatste stap is altijd het opdienen: hoe alles op het bord komt, inclusief sauzen en garnering.
6. Gebruik praktische keukenmaten: hele stuks waar logisch (1 citroen, 2 tenen knoflook), kruiden in bosjes of
   eetlepels, kleine hoeveelheden in theelepels. Zout en peper als unit "naar smaak" met amount 0.
   Vlees, vis, groente, pasta, rijst en zuivel in gram of ml (niet in stuks), behalve wat je per stuk koopt
   (ui, ei, paprika, citroen, kipfilet per stuk mag ook in gram).
7. Correcte spelling en grammatica in het Nederlands (enkelvoud bij 1: "1 eetlepel").
8. Benodigdheden bevat alleen keukengerei dat in de stappen echt gebruikt wordt.
9. Noem in de stappen GEEN hoeveelheden (geen grammen, milliliters of aantallen), want de app rekent de
   ingrediëntenlijst om naar het huishouden en de stappen niet. Verwijs naar het ingrediënt ("de boter",
   "de bouillon") en bij verdelen naar een deel ("de helft van de boter", "de rest van de tijm").
   Temperaturen en tijden mogen wel.
10. Geef elk ingrediënt een supermarktcategorie uit de vaste lijst (voor de boodschappenlijst).`;

const TIMER_RULES = `STRIKTE TIMER REGELS:
1. NOOIT een timer voor de oven (ovens hebben eigen timers).
2. NOOIT een timer voor voorbereiding (snijden, wassen, afmeten).
3. NOOIT een timer voor 'voorverwarmen'.
4. ALLEEN een timer voor actieve kookprocessen op het fornuis (koken, sudderen, bakken) of passieve processen (rusten, marineren) waar de exacte tijd essentieel is voor de kwaliteit.
5. De 'timer_label' moet kort en bondig beschrijven wat er gebeurt.`;

const MODE_RULES = `MODUS RICHTLIJNEN:
- 'premium': Toegankelijke, gezonde en smaakvolle doordeweekse gerechten. Focus op eenvoud en dagelijks gemak.
- 'culinary': LUXE Gastronomie. Focus op presentatie, verfijnde smaken en techniek.`;

const joinOr = (a: any, fallback: string) => (list(a).length ? list(a).join(', ') : fallback);

const COUNTRIES: Record<string, string> = { NL: 'Nederland', BE: 'België', DE: 'Duitsland', FR: 'Frankrijk',
  ES: 'Spanje', UK: 'het Verenigd Koninkrijk', US: 'de Verenigde Staten' };
const countryName = (region?: string) => COUNTRIES[String(region || 'NL').toUpperCase()] || 'Nederland';

/** Beschikbaarheid: gewone supermarkt, behalve bij culinair (dan met alternatief). */
const availabilityRules = (region?: string) => `BESCHIKBAARHEID VAN INGREDIËNTEN (${countryName(region)}):
- 'premium' en 'magic': gebruik ALLEEN ingrediënten die in een gewone supermarkt in ${countryName(region)} te koop zijn.
- 'culinary': speciale ingrediënten (poelier, slager, visboer, kaasspeciaalzaak, toko) mogen, maar zet in de
  ingrediëntnaam waar je het koopt en een supermarktalternatief, bijvoorbeeld:
  "kip supreme (bij de poelier; of kipfilet)" of "verse morieljes (bij de groenteboer; of kastanjechampignons)".`;

/** Smaakprofiel als extra blok in de AI-opdracht (leeg als er nog niets geleerd is). */
const tasteBlock = (profile: any) => {
  const p = typeof profile === 'string' ? profile.trim().slice(0, 1200) : '';
  return p
    ? `SMAAKPROFIEL (geleerd uit eerdere keuzes van deze gebruiker, weegt zwaar mee):
${p}
Stem de gerechten hierop af, maar blijf verrassen: ongeveer 1 op de 7 gerechten mag iets nieuws zijn dat goed bij dit profiel past.`
    : '';
};

const WEEK_PROFILE_RULES: Record<string, string> = {
  family_mix: 'Gezinsmix: gezond, gevarieerd en geliefd door iedereen; herkenbare gerechten die ook kinderen lusten.',
  world_explorer: 'Wereldontdekker: elke dag een andere wereldkeuken, nooit twee keer dezelfde keuken in een week.',
  quick_easy: 'Snel & makkelijk: doordeweeks hoogstens 30 minuten, weinig stappen en weinig afwas.',
  kid_friendly: 'KINDVRIENDELIJK (STRIKT): milde smaken, niet pittig, geen alcohol in het gerecht, geen rauwe vis, geen luxe of '
    + 'exotische onderdelen (zoals foie gras, oesters, truffel, wild); herkenbare ingrediënten die kinderen lusten. Zet kid_friendly op true.',
  surprise: 'Verrassing: een avontuurlijke, gevarieerde mix gekozen door de chef.',
};

// ---------------------------------------------------------------------------
// Besparing: één keer per week boodschappen, weinig weggooien
// ---------------------------------------------------------------------------
/** Zero-waste-stand die bij het budget hoort (de gebruiker kan hem zelf aanpassen, maar niet onder 40%). */
const BUDGET_ZERO_WASTE: Record<string, number> = { Laag: 80, Normaal: 65, Luxe: 50 };
const MIN_ZERO_WASTE = 40;
function zeroWaste(prefs: any) {
  const own = Number(prefs.zeroWasteLevel);
  const level = prefs.zeroWasteLevel !== undefined && prefs.zeroWasteLevel !== null && Number.isFinite(own)
    ? own : BUDGET_ZERO_WASTE[prefs.budget] ?? 65;
  return Math.min(100, Math.max(MIN_ZERO_WASTE, Math.round(level)));
}

const BUDGET_RULES: Record<string, string> = {
  Laag: 'Laag: goedkope basis (peulvruchten, kip, eieren, seizoensgroente, aardappel, rijst, pasta), huismerkproducten, '
    + 'weinig losse kruiden of specerijen die je maar één keer gebruikt, geen dure stukken vlees of vis.',
  Normaal: 'Normaal: gangbare supermarktproducten, af en toe iets bijzonders.',
  Luxe: 'Luxe: hoogwaardige ingrediënten mogen (betere stukken vlees, verse vis), maar zonder halve verpakkingen die overblijven.',
};

/** De kern van Qook: één keer per week boodschappen doen (op dag 0) en zo min mogelijk weggooien. */
const weeklyShoppingRules = (prefs: any) => `BOODSCHAPPEN 1x PER WEEK (de kern van Qook: besparen en niets weggooien):
- De gebruiker doet op dag 0 boodschappen voor de hele week.
- Bederfelijk (verse vis, schaaldieren, gehakt, kip, bladgroente, verse kruiden, zacht fruit) vroeg in de week;
  houdbaar (kool, wortel, ui, aardappel, pompoen, peulvruchten, blik, diepvries, harde kaas) later in de week.
- Zero-waste ${zeroWaste(prefs)}% (hoe hoger, hoe meer hergebruik): wat anders halfvol overblijft (rest van de prei,
  room, zak spinazie, bosje kruiden, halve bloemkool) komt terug in een ÁNDER gerecht later in de week.
  Hergebruik nooit zo dat de week eentonig wordt: elk gerecht blijft duidelijk anders.`;

/** Hoe snel het hoofdingrediënt bederft (hoger = eerder in de week koken). */
const PERISHABILITY: Record<string, number> = {
  zeevruchten: 5, witvis: 5, zalm: 5, vis: 5, tonijn: 4, gehakt: 4, kip: 4, kalkoen: 4, eend: 3, paddenstoelen: 3,
  rundvlees: 3, varkensvlees: 3, lamsvlees: 3, wild: 3, groenten: 2, tofu: 2, kaas: 1, ei: 1,
  aardappel: 0, peulvruchten: 0, pasta: 0, rijst: 0,
};

/** Binnen dagen met dezelfde modus en kooktijd: bederfelijke gerechten eerst. */
function orderByFreshness(days: any[], plans: DayPlan[]) {
  const groups = new Map<string, number[]>();
  plans.forEach((p, i) => { const k = `${p.mode}|${p.maxTime}`; groups.set(k, [...(groups.get(k) || []), i]); });
  const out = [...days];
  const score = (m: any) => PERISHABILITY[canonMain(m?.main_ingredient)] ?? 2;
  for (const idx of groups.values()) {
    const meals = idx.map(i => days[i]).sort((a, c) => score(c) - score(a));
    idx.forEach((i, k) => { out[i] = meals[k]; });
  }
  return out;
}

/** Bij allergie/intolerantie: een strikte regel (ook verborgen bronnen zoals sauzen en bouillon). */
function allergyRule(prefs: any) {
  const map: Record<string, string> = { Glutenarm: 'gluten (ook geen sojasaus, paneermeel, bouillonblokjes met tarwe)',
    Lactosevrij: 'melk en zuivel (ook geen boter, room, kaas)', Notenvrij: 'noten en pinda (ook geen pesto, satésaus)' };
  const items = list(prefs.diet).map((d: string) => map[d]).filter(Boolean);
  return items.length ? `\n- ALLERGIE (STRIKT, ook in sauzen en bouillon): geen ${items.join('; geen ')}.` : '';
}

/** Voorkeuren uit de onboarding en instellingen. */
function conditionsBlock(prefs: any) {
  const kitchens = list(prefs.kitchenProfiles);
  return `VOORWAARDEN:
- Dieet: ${joinOr(prefs.diet, 'Geen')}${prefs.customDiet ? ` (${String(prefs.customDiet).slice(0, 200)})` : ''}${allergyRule(prefs)}
- Huishouden: ${prefs.adultsCount ?? 2} volwassenen, ${prefs.childrenCount ?? 0} kinderen.
- Budget: ${BUDGET_RULES[prefs.budget] || BUDGET_RULES.Normaal}
- Weekprofiel: ${WEEK_PROFILE_RULES[prefs.weekProfile] || WEEK_PROFILE_RULES.surprise}${kitchens.length ? `
- Favoriete keukens: ${kitchens.join(', ')}. Kies vooral hieruit, maar wissel binnen de week af.` : ''}`;
}

// ---------------------------------------------------------------------------
// Dubbele gerechten voorkomen
// ---------------------------------------------------------------------------
const STOPWORDS = new Set(['met', 'en', 'van', 'de', 'het', 'een', 'in', 'op', 'uit', 'aan', 'bij', 'voor', 'with', 'and', 'the', 'of']);
const titleWords = (t: any) => new Set(normTitle(t).split(' ').filter(w => w.length > 2 && !STOPWORDS.has(w)));

// Woorden tellen als gelijk bij exacte match of als het ene woord het andere bevat
// ("bospaddenstoelensaus" bevat "paddenstoelensaus").
const sameWord = (x: string, y: string) => x === y || (Math.min(x.length, y.length) >= 5 && (x.includes(y) || y.includes(x)));

/** Maakt een snelle controle "lijkt deze titel op een van deze titels?" (lijst wordt één keer voorbereid). */
function dupMatcher(others: any[]) {
  const prepared = others.map(o => ({ n: normTitle(o), w: [...titleWords(o)] })).filter(p => p.n);
  const exact = new Set(prepared.map(p => p.n));
  return (title: any) => {
    const n = normTitle(title);
    if (!n) return false;
    if (exact.has(n)) return true;
    const a = [...titleWords(title)];
    if (!a.length) return false;
    return prepared.some(p => {
      if (!p.w.length) return false;
      const shared = a.filter(w => p.w.some(v => sameWord(w, v))).length;
      return shared / Math.min(a.length, p.w.length) >= 0.75;
    });
  };
}
const matcherCache = new WeakMap<any[], (t: any) => boolean>();
const matcherFor = (arr: any[]) => {
  let m = matcherCache.get(arr);
  if (!m) { m = dupMatcher(arr); matcherCache.set(arr, m); }
  return m;
};

/** Zelfde gerecht als een van de andere? Exact gelijk, of grotendeels dezelfde woorden. */
const isDuplicate = (title: any, others: any[]) => dupMatcher(others)(title);

// ---------------------------------------------------------------------------
// Variatie over weken heen
//   - gewone gerechten: niet terug binnen 8 weken
//   - favorieten: na 4 weken weer toegestaan, max. 1 per week
//   - duim omlaag: nooit meer
//   - per week: elk hoofdingrediënt max. 2x, elke keuken max. 3x (bij het kiezen uit de bank max. 2x)
// ---------------------------------------------------------------------------
const NORMAL_WEEKS = 8;
const FAVORITE_WEEKS = 4;
const MAX_SAME_MAIN = 2;
const MAX_SAME_CUISINE = 3;

interface Variety {
  blocked: string[];            // mag deze week niet terugkomen
  favorites: string[];          // alle favorieten van de gebruiker
  favoritesAllowed: string[];   // favorieten die weer mogen (lang genoeg geleden)
  recentCuisines: string;       // "Italiaans 4x, Aziatisch 3x" (laatste 3 weken)
  recentCuisineNames?: string[];
}

function buildVariety(b: any, prefs: any): Variety {
  let history = list(b.history).filter((h: any) => h && h.title)
    .map((h: any) => ({ title: String(h.title), weeksAgo: Number(h.weeksAgo) || 0, cuisine: h.cuisine }));
  if (!history.length) {
    // Oudere app-versie: alleen titels zonder datum, behandel als recent.
    history = list(prefs.generationHistory).slice(-60).map((t: any) => ({ title: String(t), weeksAgo: 0, cuisine: undefined }));
  }
  const favorites = list(b.favoriteTitles).map(String);
  const disliked = list(b.dislikedTitles).map(String);
  const isFav = matcherFor(favorites);

  const blocked = [...disliked];
  for (const h of history) {
    const window = isFav(h.title) ? FAVORITE_WEEKS : NORMAL_WEEKS;
    if (h.weeksAgo < window) blocked.push(h.title);
  }
  const blockedMatch = dupMatcher(blocked);
  const favoritesAllowed = favorites.filter(f => !blockedMatch(f));

  const counts: Record<string, number> = {};
  for (const h of history) if (h.weeksAgo < 3 && h.cuisine) {
    const c = String(h.cuisine);
    counts[c] = (counts[c] || 0) + 1;
  }
  const top = Object.entries(counts).sort((a, c) => c[1] - a[1]).slice(0, 4);
  const recentCuisines = top.map(([c, n]) => `${c} ${n}x`).join(', ');
  return {
    blocked: [...new Set(blocked)].slice(-150), favorites, favoritesAllowed, recentCuisines,
    recentCuisineNames: top.filter(([, n]) => n >= 3).map(([c]) => c),
  };
}

function varietyRules(v: Variety) {
  return `- NIET GEBRUIKEN (recent gegeten of afgekeurd, ook geen varianten hiervan): ${joinOr(v.blocked, 'Geen')}.
- FAVORIETEN die weer mogen terugkomen (hoogstens 1 deze week): ${joinOr(v.favoritesAllowed, 'Geen')}.
- Elk hoofdingrediënt hoogstens ${MAX_SAME_MAIN}x per week; hoogstens 2 gerechten uit dezelfde keuken.${v.recentCuisines ? `
- De afgelopen weken veel: ${v.recentCuisines}. Kies vooral andere keukens.` : ''}`;
}

/** Waarom past dit gerecht niet in de week? null = het past. */
function conflictReason(meal: any, week: any[], v: Variety): string | null {
  const title = meal?.title;
  if (!normTitle(title)) return 'geen naam';
  if (isDuplicate(title, week.map(m => m.title))) return 'staat al in deze week';
  if (matcherFor(v.blocked)(title)) return 'recent gegeten of afgekeurd';
  const isFav = matcherFor(v.favorites);
  if (isFav(title) && week.some(m => isFav(m.title))) return 'al een favoriet deze week';
  const main = normWord(meal?.main_ingredient);
  if (main && week.filter(m => normWord(m.main_ingredient) === main).length >= MAX_SAME_MAIN) {
    return `hoofdingrediënt ${meal.main_ingredient} al ${MAX_SAME_MAIN}x deze week`;
  }
  const cuisine = normWord(meal?.cuisine);
  if (cuisine && week.filter(m => normWord(m.cuisine) === cuisine).length >= MAX_SAME_CUISINE) {
    return `keuken ${meal.cuisine} al ${MAX_SAME_CUISINE}x deze week`;
  }
  return null;
}

/** Vervanger mag niet zowel hetzelfde hoofdingrediënt als dezelfde keuken hebben (Kip madras → Kip tikka masala). */
function tooSimilar(meal: any, current?: any) {
  if (!current) return false;
  const a = normWord(meal?.main_ingredient), b = normWord(current.main_ingredient);
  const c = normWord(meal?.cuisine), d = normWord(current.cuisine);
  return !!(a && b && c && d && a === b && c === d);
}

// ---------------------------------------------------------------------------
// Weekplanning
// ---------------------------------------------------------------------------
interface DayPlan { mode: string; bankMode: string; maxTime: number; rawTime: any }

const timeLimit = (v: any) => { const n = Number(v); return n > 0 ? n : 999; };
const fmtTime = (n: number) => (n >= 999 ? 'onbeperkt' : `${n} min`);

function dayPlans(prefs: any): DayPlan[] {
  const quick = prefs.weekProfile === 'quick_easy';
  const modes = prefs.dayModes || {};
  return Array.from({ length: 7 }, (_, i) => {
    const mode = modes[String(i)] || 'premium';
    const rawTime = i >= 5 ? (prefs.weekendCookingTime ?? 'unlimited') : (prefs.cookingTime ?? '30');
    let maxTime = timeLimit(rawTime);
    if (quick && i < 5) maxTime = Math.min(maxTime, 30);
    return { mode, bankMode: mode === 'culinary' ? 'culinary' : 'premium', maxTime, rawTime };
  });
}

/** De bank bevat Nederlandse recepten voor de Nederlandse/Belgische supermarkt. */
const bankUsable = (prefs: any) =>
  String(prefs.language || 'nl').toLowerCase().startsWith('nl') &&
  ['NL', 'BE'].includes(String(prefs.region || 'NL').toUpperCase()) && userDiet(prefs).ok;

/** Minimaal zoveel bruikbare gerechten in de bank voordat we eruit kiezen (anders te weinig keus). */
const MIN_POOL = 10;

interface Candidate {
  id: string; title: string; mode: string; main_ingredient: string; cuisine: string;
  kid: boolean; minutes: number; score: number; ingredients?: string;
}

/** De belangrijkste ingrediënten van een gerecht (zonder zout, peper, olie en water), voor de AI-keuze. */
const STAPLE = /^(zout|zeezout|peper|zwarte peper|water|olie|olijfolie|zonnebloemolie|boter|suiker)$/;
function shortIngredients(raw: any) {
  if (!raw) return '';
  return String(raw).split('|').map(n => n.replace(/\(.*?\)/g, '').trim().toLowerCase())
    .filter(n => n && !STAPLE.test(n)).slice(0, 7).join(', ');
}

async function bankCandidates(env: Env, prefs: any, modes: string[], limit: number): Promise<Candidate[]> {
  await ensureSchema(env);
  const diet = userDiet(prefs);
  const where = [`mode IN (${modes.map(() => '?').join(',')})`, 'hidden = 0'];   // gemelde recepten niet
  const args: any[] = [...modes];
  for (const t of diet.tags) { where.push('diet_tags LIKE ?'); args.push(`%,${t},%`); }
  if (prefs.weekProfile === 'kid_friendly') where.push(`(kid = 1 OR mode = 'culinary')`);
  // Allergie of intolerantie: alleen gerechten waarvan we het volledige recept kennen (en dus kunnen controleren).
  const allergyTags = diet.tags.filter(t => ALLERGENS[t]);
  if (allergyTags.length) where.push(`details_v >= ${MIN_RECIPE_VERSION}`);
  const { results } = await env.DB.prepare(
    `SELECT id, title, mode, main, cuisine, kid, minutes, has_image, details_v,
       CASE WHEN details_v >= ${MIN_RECIPE_VERSION} THEN (SELECT group_concat(json_extract(j.value, '$.name'), '|')
         FROM json_each(recipes.details, '$.ingredients') j) END AS ingr
     FROM recipes
     WHERE ${where.join(' AND ')} ORDER BY RANDOM() LIMIT ${Number(limit) || 100}`
  ).bind(...args).all();
  const safe = (r: any) => !allergyTags.length || !hasAllergen(String(r.ingr || ''), allergyTags);
  return (results || []).filter(safe).map((r: any) => ({
    id: r.id, title: r.title, mode: r.mode, main_ingredient: r.main || '', cuisine: r.cuisine || '',
    kid: !!r.kid, minutes: Number(r.minutes) || 30, ingredients: shortIngredients(r.ingr),
    score: (r.has_image ? 0.5 : 0) + (Number(r.details_v) >= MIN_RECIPE_VERSION ? 0.5 : 0),
  }));
}

/**
 * Extra controle bij allergie/intolerantie: de dieetlabels komen van de AI; daarom ook de ingrediënten
 * van het recept nalopen. Liever een gerecht te veel weglaten dan een fout.
 */
const ALLERGENS: Record<string, { bad: RegExp; ok?: RegExp }> = {
  glutenvrij: {
    bad: /tarwe|\bbloem\b|\bmeel\b|tarwemeel|speltmeel|roggemeel|volkorenmeel|pasta|spaghetti|penne|lasagne|tagliatelle|macaroni|noedel|noodle|\bmie\b|brood|wrap|tortilla|pita|naan|couscous|bulgur|gerst|rogge|spelt|paneermeel|panko|bladerdeeg|deeg|sojasaus|ketjap|seitan|\bbier|orzo|gnocchi|crouton|beschuit|cracker|bouillonblok/,
    ok: /glutenvrij|gluten free|rijstnoedel|rijstpapier|maizena|maisbloem|rijstebloem|rijstmeel|boekweit|tamari/,
  },
  lactosevrij: {
    bad: /melk|room|boter|kaas|yoghurt|kwark|creme fraiche|mascarpone|ricotta|mozzarella|parmezaan|parmigiano|pecorino|feta|halloumi|burrata|ghee|zuivel|\bwei\b/,
    ok: /lactosevrij|plantaardig|kokos|amandelmelk|havermelk|sojamelk|rijstmelk|haverroom|sojaroom|pindakaas|pindaboter|vegan/,
  },
  notenvrij: {
    bad: /noot|noten|amandel|cashew|pinda|hazelno|walno|pecan|pistache|macadamia|pijnboompit|pesto|marsepein|praline|nougat|sate ?saus|satesaus/,
    ok: /nootmuskaat|notenvrij/,
  },
};
function hasAllergen(ingredientNames: string, tags: string[]) {
  return ingredientNames.split('|').some(raw => {
    const n = normTitle(raw);
    return tags.some(t => ALLERGENS[t] && ALLERGENS[t].bad.test(n) && !(ALLERGENS[t].ok?.test(n)));
  });
}

/** Volgorde van voorkeur: keukenvoorkeur, kindvriendelijk, favoriet, niet te vaak dezelfde keuken + toeval. */
function scoreCandidates(rows: Candidate[], prefs: any, v: Variety) {
  const liked = preferredCuisines(prefs.kitchenProfiles);
  const recent = new Set(list(v.recentCuisineNames).map(normWord));
  const kids = (Number(prefs.childrenCount) || 0) > 0 || prefs.weekProfile === 'family_mix';
  const fav = matcherFor(v.favoritesAllowed);
  for (const r of rows) {
    const c = normWord(r.cuisine);
    r.score += Math.random() * 2 + (liked.has(c) ? 3 : 0) + (kids && r.kid ? 1.5 : 0)
      + (fav(r.title) ? 1 : 0) - (recent.has(c) ? 1 : 0);
  }
  return rows.sort((a, b) => b.score - a.score);
}

const fitsDay = (c: Candidate, p: DayPlan) => c.mode === p.bankMode && c.minutes <= p.maxTime + 5;

/** Strengere variatie bij het kiezen uit de bank (wereldontdekker: elke keuken 1x). */
function capsOk(c: any, week: any[], prefs: any) {
  const cap = prefs.weekProfile === 'world_explorer' ? 1 : 2;
  const cu = normWord(c.cuisine);
  return !cu || week.filter(m => normWord(m.cuisine) === cu).length < cap;
}

/** Laat de AI uit een korte lijst kiezen (smaakprofiel, zero-waste). Snel: alleen nummers terug. */
async function aiPick(env: Env, prefs: any, b: any, v: Variety, plans: DayPlan[], shortlist: Candidate[]) {
  const agenda = plans.map((p, i) => `Dag ${i}: ${p.bankMode}, hoogstens ${fmtTime(p.maxTime)}`).join('\n');
  const system = `Je bent de chef van Qook en stelt een weekmenu samen uit BESTAANDE recepten.
Kies voor elke dag (0-6) precies één nummer uit de lijst. Schrijf in het ${langName(prefs.language)}.

AGENDA (STRIKT):
${agenda}

REGELS:
- Alleen een gerecht met de juiste modus en binnen de tijd van die dag. Nooit een nummer twee keer.
- Elk hoofdingrediënt hoogstens ${MAX_SAME_MAIN}x; wissel keukens af.
- FAVORIETEN die weer mogen (hoogstens 1): ${joinOr(v.favoritesAllowed, 'Geen')}.
${conditionsBlock(prefs)}
${tasteBlock(prefs.tasteProfile)}

${weeklyShoppingRules(prefs)}
- Kijk daarvoor naar de ingrediënten achter elk gerecht: kies gerechten die verse ingrediënten delen.
Schrijf een kort 'zero_waste_report' (1-2 zinnen) over hoe deze week verspilling voorkomt.

Antwoord uitsluitend met JSON: {"picks": [7 nummers, voor dag 0 t/m 6], "zero_waste_report": "..."}`;
  const lines = shortlist.map((c, i) =>
    `${i} | ${c.title} | ${c.mode} | ${c.cuisine || '-'} | ${c.main_ingredient || '-'} | ${c.minutes} min${c.kid ? ' | kindvriendelijk' : ''}`
    + (c.ingredients ? ` | ${c.ingredients}` : ''));
  const data = await aiJson(env, system, `GERECHTEN:\n${lines.join('\n')}`, 0.4, undefined, undefined,
    { timeoutMs: 20000, retries: 0 });
  return { picks: list(data.picks).map(Number), report: typeof data.zero_waste_report === 'string' ? data.zero_waste_report : '' };
}

/** Weekmenu uit de receptenbank. Dagen zonder geschikt gerecht blijven leeg (null). */
async function pickFromBank(env: Env, prefs: any, b: any, v: Variety, plans: DayPlan[], onlyBank = false) {
  const modes = [...new Set(plans.map(p => p.bankMode))];
  const rows = scoreCandidates(await bankCandidates(env, prefs, modes, 160), prefs, v);
  const pool: Candidate[] = [];
  for (const c of rows) {
    if (!conflictReason(c, [], v)) pool.push(c);
    if (pool.length >= 60) break;
  }
  // Wie alleen uit de bank krijgt, gebruikt alles wat er is; anders pas bij genoeg keus.
  if (!pool.length || (!onlyBank && pool.length < MIN_POOL)) return null;

  const week: (Candidate | null)[] = Array(7).fill(null);
  const ok = (c: Candidate, i: number) => {
    const chosen = week.filter(Boolean) as Candidate[];
    return fitsDay(c, plans[i]) && !chosen.includes(c) && !conflictReason(c, chosen, v) && capsOk(c, chosen, prefs);
  };

  // Korte lijst voor de AI: de beste kandidaten per benodigde modus.
  const shortlist = modes.flatMap(m => pool.filter(c => c.mode === m).slice(0, m === 'culinary' ? 12 : 30));
  let report = '';
  if (!onlyBank) try {
    const r = await aiPick(env, prefs, b, v, plans, shortlist);
    report = r.report;
    r.picks.slice(0, 7).forEach((n, i) => {
      const c = shortlist[n];
      if (c && ok(c, i)) week[i] = c;
    });
  } catch (e) {
    console.warn('AI-keuze uit de bank mislukt, keuze op score:', errMsg(e));
  }

  // Rest aanvullen: dagen met de minste keus eerst.
  const options = (i: number) => pool.filter(c => fitsDay(c, plans[i])).length;
  const open = [...Array(7).keys()].filter(i => !week[i]).sort((a, c) => options(a) - options(c));
  for (const i of open) {
    const c = pool.find(x => ok(x, i));
    if (c) week[i] = c;
  }
  return { week, report };
}

async function weeklyPlan(env: Env, b: any, ctx?: Ctx, actor?: Actor) {
  const prefs = b.prefs || {};
  const v = buildVariety(b, prefs);
  const plans = dayPlans(prefs);
  const days: any[] = Array(7).fill(null);
  let report = '';

  if (bankUsable(prefs)) {
    try {
      const picked = await pickFromBank(env, prefs, b, v, plans, bankOnly(actor));
      if (picked) {
        const meals = await loadMeals(env, picked.week.filter(Boolean).map(c => c!.id));
        picked.week.forEach((c, i) => { if (c && meals.has(c.id)) days[i] = { ...meals.get(c.id), mode: plans[i].mode }; });
        report = picked.report;
      }
    } catch (e) {
      console.error('Receptenbank niet bruikbaar, de AI maakt het menu:', errMsg(e));
    }
  }

  const gaps = days.map((m, i) => (m ? -1 : i)).filter(i => i >= 0);
  if (gaps.length) {
    await allowFallback(env, actor);
    const r = await generateForDays(env, prefs, b, v, plans, gaps, days);
    if (!report) report = r.report;
  }

  const ordered = orderByFreshness(days, plans);
  await saveRecipes(env, ordered);
  background(ctx, () => prewarm(env, ordered, prefs));
  return { days: ordered, zero_waste_report: report };
}

/** De AI maakt gerechten voor de lege dagen (bij een lege bank: de hele week). */
async function generateForDays(env: Env, prefs: any, b: any, v: Variety, plans: DayPlan[], gaps: number[], days: any[]) {
  const planned = days.filter(Boolean);
  const agenda = gaps.map(i => `Day ${i}: ${plans[i].mode}, hoogstens ${fmtTime(plans[i].maxTime)}`).join('\n');
  const wantReport = gaps.length >= 4;

  const system = `Je bent de culinaire motor van Qook (KOOQ).
Je maakt ${gaps.length} gerecht(en) voor een 7-daags menu (dagen 0-6). Schrijf alle teksten in het ${langName(prefs.language)} (ai_image_prompt in het Engels).

AGENDA (STRIKT VOLGEN, in deze volgorde):
${agenda}
${planned.length ? `
AL GEPLAND DEZE WEEK (niet herhalen, ook geen varianten; tel mee voor de variatieregels):
${planned.map(m => `- ${m.title} (${m.main_ingredient || '?'}, ${m.cuisine || '?'})`).join('\n')}
` : ''}
STRIKTE VARIATIE REGELS:
${varietyRules(v)}
- INSPIRE: De gebruiker houdt van gerechten zoals: ${joinOr(b.favoriteTitles, 'Nog geen favorieten')}. Gebruik deze lijst om de smaakvoorkeuren te begrijpen en genereer vooral NIEUWE gerechten in diezelfde sfeer.

${weeklyShoppingRules(prefs)}${wantReport ? `
- Schrijf een kort 'zero_waste_report' waarin je uitlegt hoe je deze week verspilling voorkomt.` : ''}

${MODE_RULES}
${availabilityRules(prefs.region)}

${tasteBlock(prefs.tasteProfile)}

${conditionsBlock(prefs)}
- VARIATIE: Zorg dat elk gerecht UNIEK is in ingrediënten, tenzij het Zero-Waste level hoog is.

Antwoord uitsluitend met JSON: {${wantReport ? '"zero_waste_report": "...", ' : ''}"days": [${gaps.length} gerecht(en) in de volgorde van de agenda, elk in deze vorm: ${MEAL_SHAPE}]}`;

  const data = await aiJson(env, system, 'Genereer de gerechten.', 0.9);
  const out = list(data.days);

  // Harde controle: geen dubbele gerechten, niets dat recent gegeten of afgekeurd is,
  // maximaal 1 favoriet, elk hoofdingrediënt max 2x en elke keuken max 3x per week.
  const rejected: Record<number, any> = {};
  const redo: number[] = [];
  gaps.forEach((dayIdx, k) => {
    const m = out[k] ? cleanMeal(out[k], plans[dayIdx].mode) : null;
    const tooLong = m && Number(m.estimated_time_minutes) > plans[dayIdx].maxTime + 10 ? 'kooktijd te lang' : null;
    const reason = m ? conflictReason(m, days.filter(Boolean), v) || tooLong : 'ontbreekt';
    if (!reason) { days[dayIdx] = m; return; }
    console.warn(`Dag ${dayIdx}: "${m?.title || '-'}" afgekeurd (${reason}), wordt vervangen`);
    if (m) rejected[dayIdx] = m;
    redo.push(dayIdx);
  });

  if (redo.length) {
    // Tegelijk vervangen in plaats van na elkaar (scheelt minuten).
    const settled = days.filter(Boolean);
    const results = await Promise.all(redo.map(i =>
      generateOneMeal(env, prefs, i, settled, v, b.favoriteTitles, rejected[i]?.title || '')
        .catch(e => { console.error(`Dag ${i}: geen geldig alternatief gevonden`, errMsg(e)); return null; })));
    for (let k = 0; k < redo.length; k++) {
      const i = redo[k];
      let m = results[k];
      if (m && conflictReason(m, days.filter(Boolean), v)) {
        // Twee vervangers tegelijk kozen iets gelijkaardigs: deze nog één keer opnieuw.
        m = await generateOneMeal(env, prefs, i, days.filter(Boolean), v, b.favoriteTitles, m.title).catch(() => null);
      }
      days[i] = m || rejected[i] || null;
    }
  }
  if (days.some(d => !d)) throw new ApiError(502, 'Het weekmenu kon niet compleet gemaakt worden. Probeer het nog eens.');
  return { report: typeof data.zero_waste_report === 'string' ? data.zero_waste_report : '' };
}

/** Eén gerecht voor een dag dat in de week past (max. 2 pogingen). */
async function generateOneMeal(env: Env, prefs: any, dayIndex: number, weekOthers: any[], v: Variety,
                               favoriteTitles: any, currentTitle = '', current?: any): Promise<any> {
  const targetMode = (prefs.dayModes || {})[String(dayIndex)] || 'premium';
  const maxTime = dayIndex >= 5 ? prefs.weekendCookingTime : prefs.cookingTime;
  const weekTitles = weekOthers.map(m => m.title).filter(Boolean);
  const countBy = (key: string) => {
    const c: Record<string, number> = {};
    for (const m of weekOthers) { const k = m[key]; if (k) c[k] = (c[k] || 0) + 1; }
    return c;
  };
  const fullMains = Object.entries(countBy('main_ingredient')).filter(([, n]) => n >= MAX_SAME_MAIN).map(([k]) => k);
  const fullCuisines = Object.entries(countBy('cuisine')).filter(([, n]) => n >= MAX_SAME_CUISINE - 1).map(([k]) => k);
  const vReplace: Variety = { ...v, blocked: [...v.blocked, ...(currentTitle ? [currentTitle] : [])] };
  const differ = current?.main_ingredient && current?.cuisine
    ? `\nANDERS DAN HET HUIDIGE GERECHT (STRIKT): kies een ander hoofdingrediënt dan "${current.main_ingredient}" of een andere keuken dan "${current.cuisine}", liefst allebei.`
    : '';

  const system = (lastReason?: string) => `Je vervangt een specifiek gerecht in een weekmenu. Schrijf in het ${langName(prefs.language)} (ai_image_prompt in het Engels).
STRIKTE RICHTLIJNEN VOOR MODE "${targetMode}".
${MODE_RULES}
${availabilityRules(prefs.region)}
VARIATIE: Het nieuwe gerecht MOET wezenlijk anders zijn dan "${currentTitle}".${differ}
${varietyRules(vReplace)}
DEZE WEEK STAAT AL GEPLAND (NOOIT HETZELFDE OF EEN VARIANT DAARVAN KIEZEN, OOK GEEN ANDER HOOFDINGREDIËNT-PLUS-SAUS-COMBINATIE DIE EROP LIJKT): ${joinOr(weekTitles, 'Geen')}.${fullMains.length ? `
NIET ALS HOOFDINGREDIËNT (komt deze week al vaak voor): ${fullMains.join(', ')}.` : ''}${fullCuisines.length ? `
LIEVER NIET UIT DEZE KEUKEN: ${fullCuisines.join(', ')}.` : ''}${lastReason ? `
LET OP: je vorige voorstel werd afgekeurd (${lastReason}). Kies nu een duidelijk ander hoofdingrediënt en een andere bereidingswijze.` : ''}
SMAAKVOORKEUR: De gebruiker vindt dit lekker: ${joinOr(favoriteTitles, 'Nog geen favorieten')}. Gebruik dit als inspiratie voor de stijl van het nieuwe gerecht.
VOORKEUREN: Dieet: ${joinOr(prefs.diet, 'Geen')}. Tijd: Maximaal ${maxTime || '30'} min. Budget: ${prefs.budget || 'Normaal'}.
BOODSCHAPPEN: de gebruiker doet 1x per week boodschappen; ${dayIndex >= 4 ? 'dit is laat in de week, kies dus bij voorkeur houdbare ingrediënten (verse vis of gehakt alleen als diepvriesvariant)' : 'kies bij voorkeur ingrediënten die goed passen bij de rest van de week'}.
${conditionsBlock(prefs)}
${tasteBlock(prefs.tasteProfile)}
Antwoord uitsluitend met JSON in deze vorm: ${MEAL_SHAPE}`;

  let lastReason: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const meal = cleanMeal(await aiJson(env, system(lastReason),
      `Vervang "${currentTitle}" door een nieuw gerecht in de modus ${targetMode}.`, 1.0), targetMode);
    lastReason = conflictReason(meal, weekOthers, vReplace)
      || (tooSimilar(meal, current) ? 'zelfde hoofdingrediënt én keuken als het huidige gerecht' : null) || undefined;
    if (!lastReason) return meal;
    console.warn(`Voorstel "${meal.title}" afgekeurd: ${lastReason}`);
  }
  throw new ApiError(409, 'Er kon geen ander gerecht gevonden worden dat nog niet in je week staat. Probeer het nog eens.');
}

/** Hoofdingrediënt en keuken van het gerecht dat vervangen wordt (uit de app of uit de bank). */
async function currentMealInfo(env: Env, cm: any) {
  const info: any = { title: String(cm?.title || ''), main_ingredient: canonMain(cm?.main_ingredient), cuisine: canonCuisine(cm?.cuisine) };
  if ((!info.main_ingredient || !info.cuisine) && (cm?.id || cm?.title)) {
    const row = await findRecipe(env, cm.id, cm.title).catch(() => null);
    if (row) {
      const d = JSON.parse(row.data || '{}');
      info.main_ingredient ||= canonMain(row.main || d.main_ingredient);
      info.cuisine ||= canonCuisine(row.cuisine || d.cuisine);
    }
  }
  return info;
}

async function replaceFromBank(env: Env, prefs: any, plan: DayPlan, others: any[], v: Variety, current: any) {
  const rows = scoreCandidates(await bankCandidates(env, prefs, [plan.bankMode], 80), prefs, v);
  const fits = rows.filter(c => fitsDay(c, plan) && !conflictReason(c, others, v) && capsOk(c, others, prefs) && !tooSimilar(c, current));
  if (!fits.length) return null;
  // Gerechten die al een foto hebben eerst (de volgorde verder gelijk), zodat een
  // vervangen gerecht direct een echte foto toont.
  const ordered = [...fits.filter(c => c.has_image), ...fits.filter(c => !c.has_image)];
  const pick = ordered[Math.floor(Math.random() * Math.min(3, ordered.length))];
  const meal = (await loadMeals(env, [pick.id])).get(pick.id);
  return meal ? { ...meal, mode: plan.mode } : null;
}

async function replaceMeal(env: Env, b: any, ctx?: Ctx, actor?: Actor) {
  const prefs = b.prefs || {};
  const dayIndex = Math.min(6, Math.max(0, Number(b.dayIndex) || 0));
  const current = await currentMealInfo(env, b.currentMeal);
  const week = list(prefs.currentWeek).length
    ? list(prefs.currentWeek)
    : list(prefs.currentWeekTitles).map((t: any) => ({ title: t }));
  const others = week.filter((_: any, i: number) => i !== dayIndex);
  const v = buildVariety(b, prefs);

  let meal: any = null;
  if (bankUsable(prefs)) {
    const vReplace = { ...v, blocked: [...v.blocked, current.title].filter(Boolean) };
    meal = await replaceFromBank(env, prefs, dayPlans(prefs)[dayIndex], others, vReplace, current)
      .catch(e => { console.warn('Vervangen uit de bank mislukt:', errMsg(e)); return null; });
  }
  if (!meal) {
    await allowFallback(env, actor);
    meal = await generateOneMeal(env, prefs, dayIndex, others, v, b.favoriteTitles, current.title, current);
  }
  await saveRecipes(env, [meal]);
  background(ctx, () => prewarm(env, [meal], prefs));
  return meal;
}

// ---------------------------------------------------------------------------
// Volledige recepten: één keer gemaakt per gerecht, daarna uit de bank
// ---------------------------------------------------------------------------
const detailsInflight = new Map<string, Promise<any>>();

function storedDetails(row: any) {
  if (!row?.details) return null;
  try {
    const s = JSON.parse(row.details);
    return (Number(s.v) || 0) >= MIN_RECIPE_VERSION ? s : null;
  } catch { return null; }
}

/** Volledig recept uit de bank, of één keer laten maken (gelijktijdige aanvragen wachten op dezelfde). */
function ensureDetails(env: Env, row: any, opts: { language?: string; region?: string; meal?: any } = {}): Promise<any> {
  const stored = storedDetails(row);
  if (stored) return Promise.resolve(stored);
  let p = detailsInflight.get(row.id);
  if (!p) {
    p = makeDetails(env, row, opts).finally(() => detailsInflight.delete(row.id));
    detailsInflight.set(row.id, p);
  }
  return p;
}

async function makeDetails(env: Env, row: any, { language, region, meal }: { language?: string; region?: string; meal?: any }) {
  const summary = { ...(meal || {}), ...JSON.parse(row.data || '{}') };
  const system = `Je bent een ervaren chef en schrijft een volledig, foutloos recept voor thuiskoks.
Schrijf in het ${langName(language)}. Hoeveelheden voor ${BASE_SERVINGS} personen.
${RECIPE_RULES}
${availabilityRules(region)}
${TIMER_RULES}
Antwoord uitsluitend met JSON in deze vorm: ${FULL_RECIPE_SHAPE}`;
  const prompt = `Volledig recept voor: ${row.title}. Modus: ${summary.mode || row.mode || 'premium'}.
Omschrijving: ${summary.short_description || ''}`;
  let details: any;
  try {
    details = await aiJson(env, system, prompt, 0.5, undefined, env.RECIPE_MODEL || DEFAULT_RECIPE_MODEL,
      { timeoutMs: 45000, retries: 0 });
  } catch (e) {
    // Beter model niet beschikbaar of druk: val terug op het standaardmodel.
    console.error('Receptmodel mislukt, terugval op standaardmodel', errMsg(e));
    details = await aiJson(env, system, prompt, 0.5);
  }
  const clean = {
    v: RECIPE_VERSION,
    ingredients: list(details.ingredients).map((i: any) => ({
      name: String(i?.name || '').trim(), amount: Number(i?.amount) || 0, unit: String(i?.unit || '').trim(),
      ...(SHOP_CATEGORIES.includes(i?.category) ? { category: i.category } : {}),
    })).filter((i: any) => i.name),
    steps: list(details.steps).map((s: any, i: number) => ({ ...s, step_index: s.step_index ?? i + 1 })),
    supplies: list(details.supplies),
    nutrition: details.nutrition || { calories: summary.calories_per_portion || 0 },
    ...(details.chefs_hack ? { chefs_hack: details.chefs_hack } : {}),
    ...(details.plating_tips ? { plating_tips: details.plating_tips } : {}),
    ...(details.wine_pairing ? { wine_pairing: details.wine_pairing } : {}),
  };
  await env.DB.prepare('UPDATE recipes SET details = ?, details_v = ? WHERE id = ?')
    .bind(JSON.stringify(clean), RECIPE_VERSION, row.id).run();
  return clean;
}

async function fullRecipe(env: Env, b: any) {
  const meal = b.meal || {};
  let row = await findRecipe(env, meal.id, meal.title);
  if (!row) {
    if (!meal.title) throw new ApiError(400, 'Geen gerecht opgegeven');
    const [saved] = await saveRecipes(env, [{ ...meal, title: String(meal.title).trim() }]);
    row = await findRecipe(env, saved.id);
  }
  const details = await ensureDetails(env, row, { language: b.language, region: b.region, meal });
  return { ...details, base_servings: BASE_SERVINGS };
}

/** Na een nieuw weekmenu alvast de volledige recepten maken, zodat openen en boodschappen direct gaan. */
async function prewarm(env: Env, meals: any[], prefs: any) {
  const ids = meals.filter(Boolean).map(m => m.id).filter(Boolean);
  if (!ids.length) return;
  const { results } = await env.DB.prepare(
    `SELECT * FROM recipes WHERE id IN (${ids.map(() => '?').join(',')}) AND details_v < ?`
  ).bind(...ids, MIN_RECIPE_VERSION).all();
  await Promise.allSettled((results || []).slice(0, 4).map((row: any) =>
    ensureDetails(env, row, { language: prefs.language, region: prefs.region })));
}

// ---------------------------------------------------------------------------
// Boodschappenlijst: optellen in code (betrouwbaar en direct), met winkelhoeveelheden
// ---------------------------------------------------------------------------
type UnitInfo = { kind: 'g' | 'ml' | 'spoon' | 'count' | 'taste'; mult: number; count?: string };

const COUNT_UNIT: [RegExp, string][] = [
  [/^(st|stk|stuks?|pieces?|piece|x)$/, 'stuk'], [/^(teen|tenen|teentjes?|cloves?)$/, 'teen'], [/^bosj?e?s?$/, 'bosje'],
  [/^blik(ken|je|jes)?$/, 'blik'], [/^(pot|potten|potje|potjes)$/, 'pot'], [/^zakj?e?s?$/, 'zakje'],
  [/^(takje|takjes|takken|tak)$/, 'takje'], [/^(plak|plakken|plakje|plakjes)$/, 'plak'], [/^(bol|bollen)$/, 'bol'],
  [/^(pak|pakken|pakje|pakjes)$/, 'pak'], [/^(stengel|stengels)$/, 'stengel'], [/^(blaadje|blaadjes|blad)$/, 'blaadje'],
];
const PLURAL: Record<string, string> = { stuk: 'stuks', teen: 'tenen', bosje: 'bosjes', blik: 'blikken', pot: 'potten',
  zakje: 'zakjes', takje: 'takjes', plak: 'plakken', bol: 'bollen', pak: 'pakken', stengel: 'stengels', blaadje: 'blaadjes',
  eetlepel: 'eetlepels', theelepel: 'theelepels' };
const unitName = (u: string, n: number) => (n > 1 ? PLURAL[u] || u : u);

function unitInfo(unit: any): UnitInfo {
  const u = normTitle(unit).replace(/ /g, '');
  if (!u) return { kind: 'count', mult: 1, count: 'stuk' };
  if (/^(g|gr|gram|grammen)$/.test(u)) return { kind: 'g', mult: 1 };
  if (/^(kg|kilo|kilogram)$/.test(u)) return { kind: 'g', mult: 1000 };
  if (/^(ml|milliliter)$/.test(u)) return { kind: 'ml', mult: 1 };
  if (/^cl$/.test(u)) return { kind: 'ml', mult: 10 };
  if (/^dl$/.test(u)) return { kind: 'ml', mult: 100 };
  if (/^(l|liter)$/.test(u)) return { kind: 'ml', mult: 1000 };
  if (/^(cup|cups|kop|kopje|kopjes)$/.test(u)) return { kind: 'ml', mult: 240 };
  if (/^(el|eetlepels?|tbsp)$/.test(u)) return { kind: 'spoon', mult: 15 };
  if (/^(tl|theelepels?|tsp)$/.test(u)) return { kind: 'spoon', mult: 5 };
  if (/naarsmaak|snuf|scheut|beetje|handje|optioneel|mespunt|toetje|garnering/.test(u)) return { kind: 'taste', mult: 0 };
  for (const [re, name] of COUNT_UNIT) if (re.test(u)) return { kind: 'count', mult: 1, count: name };
  return { kind: 'count', mult: 1, count: u };
}

/** Naar boven afronden op een winkelmaat. */
const roundUp = (n: number, step: number) => Math.ceil(n / step - 1e-9) * step;
function shopGrams(g: number) {
  if (g >= 1000) return { amount: Math.round(roundUp(g, 100) / 100) / 10, unit: 'kg' };
  return { amount: g < 50 ? roundUp(g, 5) : g < 250 ? roundUp(g, 25) : roundUp(g, 50), unit: 'gram' };
}
function shopMl(ml: number) {
  if (ml >= 1000) return { amount: Math.round(roundUp(ml, 100) / 100) / 10, unit: 'liter' };
  return { amount: ml < 100 ? roundUp(ml, 10) : ml < 500 ? roundUp(ml, 50) : roundUp(ml, 100), unit: 'ml' };
}

const CATEGORY_GUESS: [RegExp, string][] = [
  [/diepvries|bevroren/, 'Diepvries'],
  [/rode peper|groene peper|chilipeper|jalapeno|verse gember|\bgember\b|lente ?ui|bosui|basilicum|peterselie|koriander|munt\b|bieslook|dille|dragon|kervel/, 'Groente & fruit'],
  [/\bzout\b|zeezout|zwarte peper|witte peper|^peper|cayenne|komijn|paprikapoeder|kerrie|curry ?poeder|kaneel|nootmuskaat|oregano|gedroogde|kurkuma|garam|ras el|zaatar|sumak|kardemom|steranijs|vanille|chilivlok|kruidenmix|laurier|\btijm\b|rozemarijn|specerij|venkelzaad|mosterdzaad/, 'Kruiden & specerijen'],
  [/olie|azijn|\bbloem\b|maizena|suiker|bakpoeder|\bgist\b|paneermeel|panko|cacao|chocola|zetmeel/, 'Olie, azijn & bakproducten'],
  [/blik|tomatenpuree|passata|saus|bouillon|fond|kokosmelk|pesto|ketjap|sojasaus|mosterd|mayonaise|ketchup|kikkererwt|bonen|pindakaas|sambal|vissaus|tahin|honing|\bjam\b|olijven|kappertjes|siroop|wijn|curry ?pasta|miso/, 'Conserven & sauzen'],
  [/melk|room|boter|kaas|yoghurt|kwark|\bei\b|eieren|creme|mascarpone|ricotta|mozzarella|feta|parmezaan|halloumi|burrata|zuivel/, 'Zuivel, kaas & eieren'],
  [/kip|rund|varken|gehakt|spek|\bham\b|worst|\blam|biefstuk|zalm|\bvis\b|kabeljauw|garnal|tonijn|mossel|tofu|tempeh|filet|eend|kalkoen|chorizo|pancetta|haas|makreel|forel|inktvis|vlees|schnitzel|seitan/, 'Vlees, vis & vega'],
  [/pasta|spaghetti|penne|rijst|noedel|noodle|\bmie\b|couscous|quinoa|bulgur|linzen|gnocchi|lasagne|tagliatelle|havermout|orzo|polenta/, 'Pasta, rijst & granen'],
  [/brood|wrap|tortilla|pita|naan|stokbrood|ciabatta|croissant|bladerdeeg|deeg|broodje|crouton/, 'Brood & bakkerij'],
  [/ui\b|uien|knoflook|tomaat|tomaten|paprika|courgette|aubergine|wortel|prei|kool|broccoli|spinazie|sla\b|rucola|komkommer|avocado|citroen|limoen|sinaasappel|appel|peer|aardappel|champignon|paddenstoel|bonen|pompoen|venkel|selderij|biet|asperge|mais|erwt|radijs|fruit|groente|bes|druif|mango|ananas|banaan|gember|peul|spruit|andijvie|witlof|postelein/, 'Groente & fruit'],
];
function guessCategory(name: string) {
  const n = normTitle(name);
  for (const [re, cat] of CATEGORY_GUESS) if (re.test(n)) return cat;
  return 'Overig';
}

interface ShopAcc { name: string; category: string; g: number; ml: number; spoonMl: number; counts: Record<string, number>; days: Set<number> }

/** Wat de meeste mensen al in huis hebben: apart onderaan, zodat je niet dubbel koopt. */
const PANTRY_CATEGORY = 'Voorraadkast: heb je dit nog in huis?';
const PANTRY_CATS = new Set(['Kruiden & specerijen', 'Olie, azijn & bakproducten']);
const isPantry = (a: ShopAcc) => PANTRY_CATS.has(a.category)
  || (a.g === 0 && a.ml === 0 && !Object.keys(a.counts).length && a.category === 'Conserven & sauzen');

function aggregateShopping(recipes: { details: any; factor: number; day?: number }[]) {
  const acc = new Map<string, ShopAcc>();
  for (const { details, factor, day } of recipes) {
    for (const ing of list(details?.ingredients)) {
      const rawName = String(ing.name || '').trim();
      const key = normTitle(rawName.replace(/\(.*?\)/g, ''));
      if (!key) continue;
      let a = acc.get(key);
      if (!a) {
        a = { name: rawName[0].toUpperCase() + rawName.slice(1), category: ing.category || guessCategory(rawName),
              g: 0, ml: 0, spoonMl: 0, counts: {}, days: new Set() };
        acc.set(key, a);
      }
      if (typeof day === 'number') a.days.add(day);
      const u = unitInfo(ing.unit);
      const n = (Number(ing.amount) || 0) * u.mult * factor;
      if (u.kind === 'g') a.g += n;
      else if (u.kind === 'ml') a.ml += n;
      else if (u.kind === 'spoon') a.spoonMl += n;
      else if (u.kind === 'count' && n > 0) a.counts[u.count!] = (a.counts[u.count!] || 0) + n;
    }
  }

  const items: { name: string; amount: number; unit: string; category: string; used_in?: number[] }[] = [];
  for (const [key, a] of acc) {
    const category = isPantry(a) ? PANTRY_CATEGORY : a.category;
    // In welke dagen dit terugkomt (alleen zinvol bij meer dan één gerecht): "ma · do".
    const usedIn = a.days.size > 1 && category !== PANTRY_CATEGORY ? [...a.days].sort((x, y) => x - y) : undefined;
    const push = (amount: number, unit: string) => items.push({ name: a.name, amount, unit, category, ...(usedIn ? { used_in: usedIn } : {}) });
    const before = items.length;
    if (a.g > 0) { const r = shopGrams(a.g); push(r.amount, r.unit); }
    if (a.ml > 0) { const r = shopMl(a.ml + a.spoonMl); push(r.amount, r.unit); }
    else if (a.spoonMl > 0) {
      // Kleine hoeveelheden (olie, sojasaus, specerijen): in lepels.
      if (a.spoonMl >= 15) { const n = roundUp(a.spoonMl / 15, 1); push(n, unitName('eetlepel', n)); }
      else { const n = roundUp(a.spoonMl / 5, 1); push(n, unitName('theelepel', n)); }
    }
    for (const [unit, total] of Object.entries(a.counts)) {
      if (unit === 'teen' && /knoflook/.test(key)) { const n = roundUp(total / 10, 1); push(n, unitName('bol', n)); continue; }
      const n = roundUp(total, 1);
      push(n, unitName(unit, n));
    }
    if (items.length === before) push(0, ''); // zout, peper, naar smaak: alleen de naam
  }
  const order = (c: string) => { if (c === PANTRY_CATEGORY) return 100; const i = SHOP_CATEGORIES.indexOf(c); return i < 0 ? 99 : i; };
  items.sort((x, y) => order(x.category) - order(y.category) || x.name.localeCompare(y.name, 'nl'));
  return items;
}

async function shoppingList(env: Env, b: any, _ctx?: Ctx, actor?: Actor) {
  const servings = Math.max(1, Number(b.servings) || 2);
  const meals = list(b.meals).slice(0, 14);
  const rows = await Promise.all(meals.map((m: any) => findRecipe(env, m.id, m.title)));
  // Ontbrekende recepten tegelijk laten maken, zodat de lijst altijd klopt.
  const details = await Promise.all(rows.map((row: any, i: number) => (row
    ? ensureDetails(env, row, { language: b.language, region: b.region, meal: meals[i] })
      .catch(e => { console.error('Recept voor boodschappenlijst mislukt:', row.title, errMsg(e)); return null; })
    : Promise.resolve(null))));
  const ok = details.filter(Boolean);
  if (meals.length && !ok.length) throw new ApiError(503, 'De recepten konden nu niet geladen worden. Probeer het zo nog eens.');

  const dayOf = (m: any) => (Number.isInteger(m?.day) && m.day >= 0 && m.day <= 6 ? m.day : undefined);
  const items: any[] = aggregateShopping(details.map((d: any, i: number) => (d ? { details: d, factor: servings / BASE_SERVINGS, day: dayOf(meals[i]) } : null)).filter(Boolean) as any);
  // Hoeveel ingrediënten in meer dan één gerecht terugkomen: voor "zoveel hergebruik" in de proefbanner.
  if (actor) await recordMilestone(env.DB, actor.who, 'reused',
    countReused(ok.map((d: any) => list(d.ingredients).map((i: any) => String(i.name || ''))))).catch(() => {});
  meals.forEach((m: any, i: number) => {
    if (!details[i]) items.push({ name: `${m.title || 'Gerecht'} (recept volgt, nog aanvullen)`, amount: 0, unit: '', category: 'Overig' });
  });
  return items.map((it, i) => ({ ...it, id: `it-${i}`, checked: false }));
}

// ---------------------------------------------------------------------------
// Overige endpoints
// ---------------------------------------------------------------------------
async function analyzeFridge(env: Env, b: any) {
  if (!b.image) throw new ApiError(400, 'Geen foto ontvangen');
  const prefs = b.prefs || {};
  const system = `Je bekijkt een foto van een koelkast of ingrediënten. Benoem wat je duidelijk ziet en stel 3 gerechten voor
die vooral die ingrediënten gebruiken. Schrijf in het ${langName(prefs.language)} (ai_image_prompt in het Engels).
Dieet: ${joinOr(prefs.diet, 'Geen')}.
${availabilityRules(prefs.region)}
Antwoord uitsluitend met JSON: {"recognizedItems": ["..."], "suggestions": [3 gerechten in deze vorm: ${MEAL_SHAPE}]}`;
  const data = await aiJson(env, system, 'Suggest 3 meals.', 0.6, b.image);
  const suggestions = list(data.suggestions).slice(0, 3).map((m: any) => cleanMeal(m, 'magic'));
  await saveRecipes(env, suggestions);
  return { recognizedItems: list(data.recognizedItems), suggestions };
}

async function chat(env: Env, b: any) {
  const history = list(b.messages).slice(-12)
    .map((m: any) => `${m.sender === 'assistant' ? 'Chef' : 'Gebruiker'}: ${m.text || ''}`).join('\n');
  const system = `Je bent de culinaire motor achter de Qook-app.
Je plant weekmenu's en fungeert als een intelligente Sous-chef.
Je bent professioneel, kort en bondig. Antwoord in het ${langName(b.language)}.
[USER_STATUS]: ${b.userStatus}
[CURRENT_SCREEN]: ${b.currentView}
[HUIDIG DIEET]: ${joinOr(b.diet, 'Geen')}
Als de gebruiker duidelijk zijn dieet wil aanpassen, zet dan de volledige nieuwe lijst in "diet" (alleen waarden uit:
${DIET_OPTIONS.join(', ')}; lege lijst = geen dieet); anders is "diet" null.
Antwoord uitsluitend met JSON: {"reply": "...", "diet": null}`;
  const data = await aiJson(env, system, `${history}\nGebruiker: ${b.message || ''}`, 0.7);
  return { reply: data.reply || '', diet: Array.isArray(data.diet) ? canonDietList(data.diet) : null };
}

const SIGNAL_LABELS: Record<string, string> = {
  liked: 'duim omhoog na koken (sterk positief)',
  favorite: 'als favoriet bewaard (sterk positief)',
  cooked: 'gekookt (positief)',
  shopping: 'op boodschappenlijst gezet (licht positief)',
  replaced: 'weggeklikt / vervangen (licht negatief)',
  disliked: 'duim omlaag na koken (sterk negatief)',
};

/** Vat de keuzes van een gebruiker samen tot een kort smaakprofiel. */
async function tasteProfile(env: Env, b: any) {
  const events = list(b.events).slice(-60)
    .filter((e: any) => e && typeof e.title === 'string' && SIGNAL_LABELS[e.kind])
    .map((e: any) => `- ${String(e.title).slice(0, 120)}: ${SIGNAL_LABELS[e.kind]}`);
  const previous = typeof b.previousProfile === 'string' ? b.previousProfile.slice(0, 1200) : '';
  if (!events.length) return { profile: previous };

  const system = `Je analyseert de kookkeuzes van een gebruiker van de Qook-app en schrijft een kort smaakprofiel
in het ${langName(b.language)}, dat een chef gebruikt om toekomstige weekmenu's beter af te stemmen.

REGELS:
- Maximaal 80 woorden, in korte puntjes ("- ...").
- Alleen culinaire smaak: keukens, smaken (pittig, fris, romig), ingrediënten die wel/niet in de smaak vallen,
  type gerechten (ovenschotel, soep, salade), gewenste moeite en kooktijd.
- Sterke signalen wegen zwaarder dan lichte. Nieuwe signalen wegen zwaarder dan oude.
- Trek GEEN conclusies over gezondheid, allergieën, geloof, gewicht of andere persoonlijke kenmerken.
- Neem bruikbare punten uit het vorige profiel over, tenzij nieuwe keuzes ze tegenspreken.
- Schrijf alleen wat uit de keuzes blijkt; verzin niets.
Antwoord uitsluitend met JSON: {"profile": "..."}`;
  const prompt = `VORIG PROFIEL:\n${previous || '(nog geen)'}\n\nKEUZES (oud naar nieuw):\n${events.join('\n')}`;
  const data = await aiJson(env, system, prompt, 0.3);
  return { profile: typeof data.profile === 'string' ? data.profile.slice(0, 1200) : previous };
}

// ---------------------------------------------------------------------------
// Receptenbank vooraf vullen (cron elke 20 minuten, of handmatig via /api/admin/seed)
// ---------------------------------------------------------------------------
const SEED_BATCH = 8;
const SEED_CATEGORIES = [
  { id: 'hollands', mode: 'premium', target: 35, brief: 'Hollandse en Belgische huiskeuken en Noord-Europese klassiekers (stamppot, ovenschotels, soepen, stoofpotten, Noordzeevis), modern en gezond uitgevoerd' },
  { id: 'europees', mode: 'premium', target: 35, brief: 'Italiaanse, Franse, Spaanse en Griekse gerechten voor doordeweeks' },
  { id: 'wereld', mode: 'premium', target: 40, brief: 'toegankelijke wereldkeuken: Indiaas, Thais, Chinees, Japans, Koreaans, Vietnamees, Indonesisch, Mexicaans, Midden-Oosters, Marokkaans' },
  { id: 'kind', mode: 'premium', target: 30, brief: 'kindvriendelijk: milde smaken (niet pittig), herkenbare ingrediënten, ook lekker voor ouders; kid_friendly true' },
  { id: 'vega', mode: 'premium', target: 40, brief: 'vegetarisch (ongeveer een derde ook vegan), vol van smaak en voedzaam' },
  { id: 'snel', mode: 'premium', target: 30, brief: 'snel: klaar in hoogstens 20 minuten, weinig afwas' },
  { id: 'vis', mode: 'premium', target: 25, brief: 'vis en zeevruchten, gevarieerde vissoorten' },
  { id: 'culinair', mode: 'culinary', target: 30, brief: 'klassieke Franse en Europese haute cuisine voor het weekend' },
  { id: 'culinair_wereld', mode: 'culinary', target: 25, brief: 'verfijnde wereldkeuken (Japans, Thais, Midden-Oosters, Peruaans, Koreaans)' },
  { id: 'culinair_vega', mode: 'culinary', target: 20, brief: 'verfijnde vegetarische gerechten' },
];

async function seedNewMeals(env: Env) {
  const { results } = await env.DB.prepare(
    'SELECT seed_cat, COUNT(*) AS n FROM recipes WHERE seed_cat IS NOT NULL GROUP BY seed_cat').all();
  const counts: Record<string, number> = {};
  for (const r of results || []) counts[r.seed_cat] = Number(r.n) || 0;
  const open = SEED_CATEGORIES.filter(c => (counts[c.id] || 0) < c.target)
    .sort((a, c) => (counts[a.id] || 0) / a.target - (counts[c.id] || 0) / c.target);
  const cat = open[0];
  if (!cat) return { category: null, added: 0 };

  const { results: existing } = await env.DB.prepare('SELECT title, seed_cat FROM recipes WHERE mode = ?').bind(cat.mode).all();
  const titles = (existing || []).map((r: any) => r.title);
  const sameCat = (existing || []).filter((r: any) => r.seed_cat === cat.id).map((r: any) => r.title).slice(-80);
  const system = `Je vult de receptenbank van Qook (KOOQ), een kook-app voor Nederland en België.
Bedenk ${SEED_BATCH} NIEUWE, uiteenlopende gerechten in de categorie: ${cat.brief}.
Modus: ${cat.mode}. Schrijf in het Nederlands (ai_image_prompt in het Engels).
${MODE_RULES}
${availabilityRules('NL')}
- Varieer in hoofdingrediënt, keuken en bereidingswijze. Realistische kooktijden.
- Al in deze categorie (niet herhalen, ook geen varianten): ${joinOr(sameCat, 'nog niets')}.
Antwoord uitsluitend met JSON: {"meals": [${SEED_BATCH} gerechten in deze vorm: ${MEAL_SHAPE}]}`;
  const data = await aiJson(env, system, `Bedenk ${SEED_BATCH} nieuwe gerechten.`, 1.0, undefined, undefined, { timeoutMs: 60000 });
  const known = dupMatcher(titles);
  const fresh: any[] = [];
  for (const raw of list(data.meals)) {
    const m = cleanMeal(raw, cat.mode);
    if (!m.title || known(m.title) || isDuplicate(m.title, fresh.map(f => f.title))) continue;
    fresh.push(m);
  }
  await saveRecipes(env, fresh, cat.id);
  return { category: cat.id, added: fresh.length };
}

async function seedRound(env: Env, opts: { details?: number; images?: number } = {}) {
  await ensureSchema(env);
  const nDetails = opts.details ?? (Number(env.SEED_DETAILS_PER_RUN) >= 0 ? Number(env.SEED_DETAILS_PER_RUN) : 2);
  const nImages = opts.images ?? (Number(env.SEED_IMAGES_PER_RUN) >= 0 ? Number(env.SEED_IMAGES_PER_RUN) : 1);
  const stats: any = { category: null, added: 0, details: 0, images: 0, errors: [] as string[] };
  let geminiOk = true;

  // 1. Nieuwe gerechten voor de categorie die het verst achterloopt.
  try {
    Object.assign(stats, await seedNewMeals(env));
  } catch (e: any) {
    stats.errors.push(`gerechten: ${errMsg(e)}`);
    if (e?.status === 429) geminiOk = false;
  }

  // 2. Volledige recepten (meest gebruikte gerechten eerst).
  if (geminiOk && nDetails > 0) {
    const { results } = await env.DB.prepare(
      `SELECT * FROM recipes WHERE details_v < ? AND mode IN ('premium', 'culinary')
       ORDER BY uses DESC, created_at LIMIT ?`).bind(MIN_RECIPE_VERSION, nDetails).all();
    const done = await Promise.allSettled((results || []).map((row: any) => ensureDetails(env, row, { language: 'nl', region: 'NL' })));
    stats.details = done.filter(d => d.status === 'fulfilled').length;
    for (const d of done) if (d.status === 'rejected') stats.errors.push(`recept: ${errMsg(d.reason)}`);
  }

  // 3. Foto's (Workers AI heeft een eigen dagbudget; daarom weinig per ronde).
  if (nImages > 0 && !(await imagesPaused(env))) {
    const { results } = await env.DB.prepare(
      `SELECT * FROM recipes WHERE has_image = 0 AND mode IN ('premium', 'culinary')
       ORDER BY uses DESC, created_at LIMIT ?`).bind(nImages).all();
    const done = await Promise.allSettled((results || []).map((row: any) => imageOnce(env, row)));
    stats.images = done.filter(d => d.status === 'fulfilled').length;
    for (const d of done) if (d.status === 'rejected') stats.errors.push(`foto: ${errMsg(d.reason)}`);
  }
  return stats;
}

async function photoStatus(env: Env) {
  const st = await readState(env, 'images');
  if (!st) return 'ok';
  const paused = st.paused_until && st.paused_until > Date.now();
  return { paused_until: paused ? new Date(st.paused_until).toISOString() : null, last_error: st.last_error, at: st.at };
}

async function bankStats(env: Env) {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN details_v >= ? THEN 1 ELSE 0 END) AS with_recipe,
      SUM(has_image) AS with_photo,
      SUM(CASE WHEN seed_cat IS NOT NULL THEN 1 ELSE 0 END) AS seeded
    FROM recipes`).bind(MIN_RECIPE_VERSION).first();
  return { total: Number(r?.total) || 0, with_recipe: Number(r?.with_recipe) || 0,
           with_photo: Number(r?.with_photo) || 0, seeded: Number(r?.seeded) || 0,
           seed_target: SEED_CATEGORIES.reduce((s, c) => s + c.target, 0) };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
/** Mijlpalen voor de proefbanner en de e-mails (alleen ingelogde gebruikers, alleen aantallen). */
const MILESTONE_ROUTES: Record<string, Milestone> = {
  '/api/weekly-plan': 'plans', '/api/shopping-list': 'lists', '/api/full-recipe': 'recipes',
  '/api/replace-meal': 'replaced', '/api/fridge-scan': 'scans',
};

const POST_ROUTES: Record<string, (env: Env, body: any, ctx?: Ctx, actor?: Actor) => Promise<any>> = {
  '/api/weekly-plan': weeklyPlan,
  '/api/replace-meal': replaceMeal,
  '/api/full-recipe': fullRecipe,
  '/api/shopping-list': shoppingList,
  '/api/fridge-scan': analyzeFridge,
  '/api/chat': chat,
  '/api/meal-image': getOrCreateImage,
  '/api/taste-profile': tasteProfile,
};

export default {
  async fetch(request: Request, env: Env, ctx?: Ctx): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);

    const external = await handleExternal(request, path, ctx);
    if (external) return external;
    const billing = await handleBilling(request, env as any, path,
      async () => (await currentUser(request, env).catch(() => null))?.user || null);
    if (billing) return billing;
    const auth = await handleAuth(request, env, path);
    if (auth) return auth;

    try {
      if (request.method === 'GET' && path.startsWith('/api/images/')) {
        return await serveImage(env, path.slice('/api/images/'.length), ctx);
      }
      if (request.method === 'GET' && path === '/api/health') {
        await ensureSchema(env);
        return json({
          status: 'ok',
          text_model: env.TEXT_MODEL || DEFAULT_TEXT_MODEL,
          recipe_model: env.RECIPE_MODEL || DEFAULT_RECIPE_MODEL,
          gemini_key: env.GEMINI_API_KEY ? 'ingesteld' : 'ONTBREEKT',
          database: 'ok',
          images: env.IMAGES ? 'webp' : 'origineel',
          recipe_bank: await bankStats(env),
          photo_status: await photoStatus(env),
        });
      }
      const admin = await handleAdmin(request, env, path);
      if (admin) return admin;
      if (request.method === 'POST' && path === '/api/v') return await countVisit(env, await request.json().catch(() => ({})));
      if (request.method === 'POST' && path === '/api/report') {
        await ensureSchema(env);
        const session = await currentUser(request, env).catch(() => null);
        const who = session ? `u:${session.user.id}` : `ip:${request.headers.get('cf-connecting-ip') || 'onbekend'}`;
        return await reportRecipe(env, who, await request.json().catch(() => ({})));
      }
      if (path === '/api/email/unsubscribe' && (request.method === 'GET' || request.method === 'POST')) {
        return await unsubscribe(env, new URL(request.url).searchParams.get('t') || '');
      }
      if (request.method === 'POST' && path === '/api/admin/seed') {
        if (!env.ADMIN_KEY || request.headers.get('x-admin-key') !== env.ADMIN_KEY) return json({ detail: 'Niet gevonden' }, 404);
        const body: any = await request.json().catch(() => ({}));
        const stats = await seedRound(env, { details: body.details, images: body.images });
        return json({ ...stats, recipe_bank: await bankStats(env) });
      }
      const handler = POST_ROUTES[path];
      if (request.method === 'POST' && handler) {
        const body = await request.json().catch(() => ({}));
        // Wie is dit (account of IP-adres) en welke rechten horen erbij?
        let actor = FULL_ACCESS;
        if (env.LIMITS !== 'off') {
          const session = await currentUser(request, env).catch(() => null);
          actor = session
            ? { tier: tierOf(session.user), who: `u:${session.user.id}` }
            : { tier: 'visitor', who: `ip:${request.headers.get('cf-connecting-ip') || 'onbekend'}` };
        }
        const action = env.LIMITS !== 'off' ? ROUTE_ACTIONS[path] : undefined;
        if (action) await checkLimit(env.DB, actor, action);
        const result = await handler(env, body, ctx, actor);
        if (action) await countUse(env.DB, actor, action);
        if (path === '/api/fridge-scan') await tally(env as any, actor.tier === 'visitor' ? 'scan_bezoeker' : 'scan_lid').catch(() => {});
        const milestone = MILESTONE_ROUTES[path];
        if (milestone) await recordMilestone(env.DB, actor.who, milestone).catch(e => console.warn('Mijlpaal mislukt', errMsg(e)));
        return json(result);
      }
      return json({ detail: 'Niet gevonden' }, 404);
    } catch (e: any) {
      if (e instanceof LimitError) return json({ detail: e.message, limit: true }, e.status);
      const status = e instanceof ApiError ? e.status : 500;
      if (status >= 500 || status === 429) console.error(path, e?.stack || e);
      return json({ detail: e instanceof ApiError ? e.message : 'Er ging iets mis op de server' }, status);
    }
  },

  /** Geplande taak: receptenbank aanvullen. */
  async scheduled(_controller: any, env: Env, ctx: Ctx) {
    const run = seedRound(env).then(s => console.log('Receptenbank aangevuld:', JSON.stringify(s)))
      .finally(() => cleanupCounters(env.DB).catch(() => {}))
      .finally(() => runTrialMails(env).then(r => { if (r.sent) console.log('Proef-e-mails:', JSON.stringify(r)); })
        .catch(e => console.warn('Proef-e-mails mislukt', errMsg(e))))
      .finally(() => cleanupInactiveAccounts(env).catch(e => console.warn('Opruimen accounts mislukt', errMsg(e))))
      .finally(() => dailyAdminTasks(env as any).catch(e => console.warn('Stripe-controle mislukt', errMsg(e))));
    if (ctx?.waitUntil) ctx.waitUntil(run); else await run;
  },
};
