/**
 * KOOQ — alles in één Cloudflare Worker.
 *
 *  - Serveert de website (map ./dist, gebouwd door Vite).
 *  - /api/*  : de backend. Volgt de AI-logica van het oorspronkelijke
 *              AI Studio-ontwerp (9 januari), maar dan veilig op de server.
 *  - Tekst   : Google Gemini via GEMINI_API_KEY.
 *  - Foto's  : Workers AI (FLUX schnell), één keer per gerecht, bewaard in R2.
 *  - Data    : D1-database met de receptenbank.
 *
 * Instellingen (Cloudflare → Worker → Settings → Variables and Secrets):
 *  - GEMINI_API_KEY (secret, verplicht)
 *  - TEXT_MODEL     (optioneel, standaard gemini-3.5-flash-lite) — weekmenu, vervangen, chat
 *  - RECIPE_MODEL   (optioneel, standaard gemini-3.8-flash) — volledige recepten (1x per gerecht)
 */

interface Env {
  DB: any;            // D1-database (receptenbank)
  PHOTOS: any;        // R2-bucket (maaltijdfoto's)
  AI: any;            // Workers AI
  ASSETS: any;        // De gebouwde website
  GEMINI_API_KEY: string;
  TEXT_MODEL?: string;
  RECIPE_MODEL?: string;
}

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
  constructor(public status: number, message: string) { super(message); }
}

const LANGS: Record<string, string> = { nl: 'Nederlands', en: 'Engels', de: 'Duits', fr: 'Frans', es: 'Spaans' };
const langName = (code = 'nl') => LANGS[code.toLowerCase().slice(0, 2)] || 'Engels';

const parseJson = (text: string) => {
  let t = (text || '').trim();
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(t);
};

const list = (a: any) => (Array.isArray(a) ? a : []);

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------
const DEFAULT_TEXT_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_RECIPE_MODEL = 'gemini-3.8-flash';

async function aiJson(env: Env, system: string, prompt: string, temperature = 0.8, imageB64?: string,
                      modelOverride?: string): Promise<any> {
  if (!env.GEMINI_API_KEY) throw new ApiError(500, 'GEMINI_API_KEY ontbreekt in de Worker-instellingen');
  const model = modelOverride || env.TEXT_MODEL || DEFAULT_TEXT_MODEL;
  const parts: any[] = [];
  if (imageB64) parts.push({ inline_data: { mime_type: 'image/jpeg', data: imageB64 } });
  parts.push({ text: prompt });

  const generationConfig: any = { responseMimeType: 'application/json', temperature };
  if (model.startsWith('gemini-2.5-flash')) generationConfig.thinkingConfig = { thinkingBudget: 0 };

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig,
    }),
  });
  if (!res.ok) {
    console.error('Gemini-fout', res.status, (await res.text()).slice(0, 500));
    throw new ApiError(res.status === 429 ? 429 : 502,
      res.status === 429 ? 'De AI is even druk (daglimiet bereikt). Probeer het later opnieuw.' : 'AI-fout');
  }
  const data: any = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('');
  try {
    return parseJson(text);
  } catch {
    console.error('Geen geldige JSON van Gemini:', text.slice(0, 500));
    throw new ApiError(502, 'AI gaf een onleesbaar antwoord, probeer opnieuw');
  }
}

// ---------------------------------------------------------------------------
// Receptenbank (D1)
//   data    = het gerecht (overzichtsvelden uit het weekmenu)
//   details = volledig recept (ingrediënten, stappen, ...), voor BASE_SERVINGS personen
// ---------------------------------------------------------------------------
let schemaReady: Promise<void> | null = null;
function ensureSchema(env: Env) {
  if (!schemaReady) {
    schemaReady = env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS recipes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        data TEXT NOT NULL,
        details TEXT,
        has_image INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS recipes_title ON recipes(title)'),
    ]).then(() => undefined).catch((e: any) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

const imageUrl = (id: string) => `/api/images/${id}.jpg`;

const SUMMARY_FIELDS = ['title', 'short_description', 'ai_image_prompt', 'estimated_time_minutes', 'difficulty',
  'calories_per_portion', 'chefs_hack', 'wine_pairing', 'plating_tips', 'mode'];

/** Bewaart gerechten in de bank. Bestaande titels worden hergebruikt (incl. foto en volledig recept). */
async function saveRecipes(env: Env, meals: any[]) {
  await ensureSchema(env);
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
    inserts.push(env.DB.prepare('INSERT INTO recipes (id, title, data) VALUES (?, ?, ?)')
      .bind(m.id, m.title, JSON.stringify(data)));
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

// ---------------------------------------------------------------------------
// Maaltijdfoto's (Workers AI -> R2), één keer per gerecht
// ---------------------------------------------------------------------------
const inflight = new Map<string, Promise<string>>();

function base64ToBytes(b64: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function createImage(env: Env, recipe: any): Promise<string> {
  if (recipe.has_image) return imageUrl(recipe.id);
  const data = JSON.parse(recipe.data || '{}');
  // Zelfde opbouw als het origineel, aangevuld voor een realistische foodfoto.
  const prompt =
    `A professional food photography shot of ${recipe.title}. ${data.ai_image_prompt || ''}. ` +
    '4k, cinematic lighting. Plated dish, appetizing, realistic. No text, no watermark, no people, no hands.';
  const out: any = await env.AI.run(IMAGE_MODEL, { prompt: prompt.slice(0, 2000), steps: 6 });
  if (!out?.image) throw new ApiError(502, 'Geen afbeelding ontvangen van Workers AI');
  await env.PHOTOS.put(`meals/${recipe.id}.jpg`, base64ToBytes(out.image), {
    httpMetadata: { contentType: 'image/jpeg' },
  });
  await env.DB.prepare('UPDATE recipes SET has_image = 1 WHERE id = ?').bind(recipe.id).run();
  return imageUrl(recipe.id);
}

async function getOrCreateImage(env: Env, b: any) {
  const recipe = await findRecipe(env, b.recipe_id, b.title);
  if (!recipe) throw new ApiError(404, 'Recept staat niet in de receptenbank');
  let p = inflight.get(recipe.id);
  if (!p) {
    p = createImage(env, recipe).finally(() => inflight.delete(recipe.id));
    inflight.set(recipe.id, p);
  }
  return { status: 'success', url: await p };
}

// ---------------------------------------------------------------------------
// Prompts (overgenomen uit het oorspronkelijke ontwerp)
// ---------------------------------------------------------------------------
const MEAL_SHAPE = `{
  "title": "naam van het gerecht",
  "short_description": "aantrekkelijke omschrijving in één zin",
  "ai_image_prompt": "korte Engelse beschrijving van hoe het opgemaakte bord eruitziet",
  "estimated_time_minutes": 30,
  "difficulty": "Makkelijk | Gemiddeld | Gevorderd",
  "calories_per_portion": 600,
  "chefs_hack": "één slimme kooktip",
  "wine_pairing": {"type": "wijnsoort", "description": "waarom deze wijn past"},
  "plating_tips": "professionele opmaaktips (vooral voor culinary)",
  "mode": "premium of culinary"
}`;

/** Verhoog dit als de receptregels veranderen: oudere bewaarde recepten worden dan opnieuw gemaakt. */
const RECIPE_VERSION = 3;

const FULL_RECIPE_SHAPE = `{
  "ingredients": [{"name": "...", "amount": 0, "unit": "gram | ml | stuks | eetlepel | theelepel | teen | bosje | snufje | naar smaak"}],
  "steps": [{"step_index": 1, "user_text": "...", "needs_timer": false, "timer_label": "...", "estimated_duration_seconds": 0}],
  "supplies": ["benodigd keukengerei"],
  "nutrition": {"calories": 0},
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
7. Correcte spelling en grammatica in het Nederlands (enkelvoud bij 1: "1 eetlepel").
8. Benodigdheden bevat alleen keukengerei dat in de stappen echt gebruikt wordt.
9. Noem in de stappen GEEN hoeveelheden (geen grammen, milliliters of aantallen), want de app rekent de
   ingrediëntenlijst om naar het huishouden en de stappen niet. Verwijs naar het ingrediënt ("de boter",
   "de bouillon") en bij verdelen naar een deel ("de helft van de boter", "de rest van de tijm").
   Temperaturen en tijden mogen wel.`;

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

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------
async function weeklyPlan(env: Env, b: any) {
  const prefs = b.prefs || {};
  const dayModes: Record<string, string> = prefs.dayModes || {};
  const modes = Object.entries(dayModes).sort(([a], [c]) => Number(a) - Number(c))
    .map(([d, m]) => `Day ${d}: ${m}`).join(', ');

  const system = `Je bent de culinaire motor van Qook (KOOQ).
Je genereert een 7-daags menu (0-6). Schrijf alle teksten in het ${langName(prefs.language)} (ai_image_prompt in het Engels).

AGENDA (STRIKT VOLGEN):
${modes}

STRIKTE VARIATIE REGELS:
- VERMIJD de volgende gerechten (EXCLUDE): ${joinOr(list(prefs.generationHistory).slice(-100), 'Geen')}. Dit zijn gerechten die de gebruiker al gepland heeft. Wees creatief en kom met iets nieuws.
- INSPIRE: De gebruiker houdt van gerechten zoals: ${joinOr(b.favoriteTitles, 'Nog geen favorieten')}. Gebruik deze lijst om de smaakvoorkeuren te begrijpen en genereer NIEUWE gerechten in diezelfde sfeer.
- NOOIT een gerecht letterlijk herhalen uit de geschiedenis.

ZERO-WASTE INSTRUCTIE:
- Zero-Waste Level: ${prefs.zeroWasteLevel ?? 50}% (0 = maximale variatie, 100 = maximale efficiency/hergebruik ingrediënten).
- Bij een hoog level: Gebruik grote ingrediënten (bloemkool, zak spinazie, hele kip) in meerdere gerechten verspreid over de week om verspilling te voorkomen.
- Schrijf een kort 'zero_waste_report' waarin je uitlegt hoe je deze week verspilling voorkomt.

${MODE_RULES}
${availabilityRules(prefs.region)}

${tasteBlock(prefs.tasteProfile)}

VOORWAARDEN:
- Dieet: ${joinOr(prefs.diet, 'Geen')}
- Huishouden: ${prefs.adultsCount ?? 2} volw, ${prefs.childrenCount ?? 0} kind.
- Budget: ${prefs.budget || 'Normaal'}.
- Kooktijd: doordeweeks maximaal ${prefs.cookingTime || '30'} min, weekend ${prefs.weekendCookingTime || 'unlimited'}.
- VARIATIE: Zorg dat elk gerecht UNIEK is in ingrediënten, tenzij het Zero-Waste level hoog is.

Antwoord uitsluitend met JSON: {"zero_waste_report": "...", "days": [7 gerechten in deze vorm: ${MEAL_SHAPE}]}`;

  const data = await aiJson(env, system, 'Genereer het weekmenu en het zero-waste rapport.', 0.9);
  const days = list(data.days).slice(0, 7);
  days.forEach((m: any, i: number) => { m.mode = dayModes[String(i)] || 'premium'; });
  await saveRecipes(env, days);
  return { days, zero_waste_report: data.zero_waste_report || '' };
}

async function replaceMeal(env: Env, b: any) {
  const prefs = b.prefs || {};
  const dayIndex = Number(b.dayIndex) || 0;
  const targetMode = (prefs.dayModes || {})[String(dayIndex)] || 'premium';
  const maxTime = dayIndex >= 5 ? prefs.weekendCookingTime : prefs.cookingTime;
  const currentTitle = b.currentMeal?.title || '';

  const system = `Je vervangt een specifiek gerecht in een weekmenu. Schrijf in het ${langName(prefs.language)} (ai_image_prompt in het Engels).
STRIKTE RICHTLIJNEN VOOR MODE "${targetMode}".
${MODE_RULES}
${availabilityRules(prefs.region)}
VARIATIE: Het nieuwe gerecht MOET wezenlijk anders zijn dan "${currentTitle}" en mag NIET voorkomen in de geschiedenis: ${joinOr(list(prefs.generationHistory).slice(-100), 'Geen')}.
SMAAKVOORKEUR: De gebruiker vindt dit lekker: ${joinOr(b.favoriteTitles, 'Nog geen favorieten')}. Gebruik dit als inspiratie voor de stijl van het nieuwe gerecht.
VOORKEUREN: Dieet: ${joinOr(prefs.diet, 'Geen')}. Tijd: Maximaal ${maxTime || '30'} min. Budget: ${prefs.budget || 'Normaal'}.
${tasteBlock(prefs.tasteProfile)}
Antwoord uitsluitend met JSON in deze vorm: ${MEAL_SHAPE}`;

  const meal = await aiJson(env, system, `Vervang "${currentTitle}" door een nieuw gerecht in de modus ${targetMode}.`, 1.0);
  meal.mode = targetMode;
  await saveRecipes(env, [meal]);
  return meal;
}

/** Volledig recept: één keer gemaakt per gerecht, daarna uit de bank. Altijd voor BASE_SERVINGS personen. */
async function fullRecipe(env: Env, b: any) {
  const meal = b.meal || {};
  let recipe = await findRecipe(env, meal.id, meal.title);
  if (recipe?.details) {
    const stored = JSON.parse(recipe.details);
    if (stored.v === RECIPE_VERSION) return { ...stored, base_servings: BASE_SERVINGS };
  }

  const summary = recipe ? JSON.parse(recipe.data || '{}') : meal;
  const system = `Je bent een ervaren chef en schrijft een volledig, foutloos recept voor thuiskoks.
Schrijf in het ${langName(b.language)}. Hoeveelheden voor ${BASE_SERVINGS} personen.
${RECIPE_RULES}
${availabilityRules(b.region)}
${TIMER_RULES}
Antwoord uitsluitend met JSON in deze vorm: ${FULL_RECIPE_SHAPE}`;
  const prompt = `Volledig recept voor: ${meal.title}. Modus: ${meal.mode || summary.mode || 'premium'}.
Omschrijving: ${summary.short_description || meal.short_description || ''}`;
  let details: any;
  try {
    details = await aiJson(env, system, prompt, 0.5, undefined, env.RECIPE_MODEL || DEFAULT_RECIPE_MODEL);
  } catch (e) {
    // Beter model niet beschikbaar of druk: val terug op het standaardmodel.
    console.error('Receptmodel mislukt, terugval op standaardmodel', e);
    details = await aiJson(env, system, prompt, 0.5);
  }
  const clean = {
    v: RECIPE_VERSION,
    ingredients: list(details.ingredients),
    steps: list(details.steps).map((s: any, i: number) => ({ ...s, step_index: s.step_index ?? i + 1 })),
    supplies: list(details.supplies),
    nutrition: details.nutrition || { calories: meal.calories_per_portion || 0 },
    ...(details.plating_tips ? { plating_tips: details.plating_tips } : {}),
    ...(details.wine_pairing ? { wine_pairing: details.wine_pairing } : {}),
  };

  if (!recipe && meal.title) {
    await saveRecipes(env, [{ ...meal }]);
    recipe = await findRecipe(env, undefined, meal.title);
  }
  if (recipe) {
    await env.DB.prepare('UPDATE recipes SET details = ? WHERE id = ?').bind(JSON.stringify(clean), recipe.id).run();
  }
  return { ...clean, base_servings: BASE_SERVINGS };
}

async function shoppingList(env: Env, b: any) {
  const servings = Number(b.servings) || 2;
  const lines: string[] = [];
  for (const m of list(b.meals).slice(0, 14)) {
    const recipe = await findRecipe(env, m.id, m.title);
    const details = recipe?.details ? JSON.parse(recipe.details) : null;
    if (details?.ingredients?.length) {
      const factor = servings / BASE_SERVINGS;
      const ing = details.ingredients.map((i: any) =>
        `${Math.round((Number(i.amount) || 0) * factor * 10) / 10} ${i.unit} ${i.name}`).join('; ');
      lines.push(`- ${m.title}: ${ing}`);
    } else {
      lines.push(`- ${m.title} (schat zelf de ingrediënten in)`);
    }
  }
  const system = `Je maakt een boodschappenlijst in het ${langName(b.language)} voor ${servings} personen.
Voeg dubbele ingrediënten samen, tel hoeveelheden op en rond af naar praktische winkelhoeveelheden.
Gebruik supermarktcategorieën (bijv. Groente & fruit, Vlees & vis, Zuivel, Voorraad).
Antwoord uitsluitend met een JSON-array: [{"name": "...", "amount": 0, "unit": "...", "category": "..."}]`;
  const data = await aiJson(env, system, `Shopping list for:\n${lines.join('\n')}`, 0.2);
  const items = Array.isArray(data) ? data : list(data.items);
  return items.map((it: any, i: number) => ({
    name: it.name || '', amount: Number(it.amount) || 0, unit: it.unit || '', category: it.category || '',
    id: `it-${i}`, checked: false,
  }));
}

async function analyzeFridge(env: Env, b: any) {
  if (!b.image) throw new ApiError(400, 'Geen foto ontvangen');
  const prefs = b.prefs || {};
  const system = `Je bekijkt een foto van een koelkast of ingrediënten. Benoem wat je duidelijk ziet en stel 3 gerechten voor
die vooral die ingrediënten gebruiken. Schrijf in het ${langName(prefs.language)} (ai_image_prompt in het Engels).
Dieet: ${joinOr(prefs.diet, 'Geen')}.
${availabilityRules(prefs.region)}
Antwoord uitsluitend met JSON: {"recognizedItems": ["..."], "suggestions": [3 gerechten in deze vorm: ${MEAL_SHAPE}]}`;
  const data = await aiJson(env, system, 'Suggest 3 meals.', 0.6, b.image);
  const suggestions = list(data.suggestions).slice(0, 3);
  suggestions.forEach((m: any) => { m.mode = 'magic'; });
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
Als de gebruiker duidelijk zijn dieet wil aanpassen, zet dan de volledige nieuwe lijst in "diet"; anders is "diet" null.
Antwoord uitsluitend met JSON: {"reply": "...", "diet": null}`;
  const data = await aiJson(env, system, `${history}\nGebruiker: ${b.message || ''}`, 0.7);
  return { reply: data.reply || '', diet: Array.isArray(data.diet) ? data.diet : null };
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

async function serveImage(env: Env, name: string) {
  const obj = await env.PHOTOS.get(`meals/${name}`);
  if (!obj) return new Response('Niet gevonden', { status: 404 });
  return new Response(obj.body, {
    headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' },
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const POST_ROUTES: Record<string, (env: Env, body: any) => Promise<any>> = {
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
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      if (request.method === 'GET' && path.startsWith('/api/images/')) {
        return serveImage(env, path.slice('/api/images/'.length));
      }
      if (request.method === 'GET' && path === '/api/health') {
        await ensureSchema(env);
        return json({
          status: 'ok',
          text_model: env.TEXT_MODEL || DEFAULT_TEXT_MODEL,
          recipe_model: env.RECIPE_MODEL || DEFAULT_RECIPE_MODEL,
          gemini_key: env.GEMINI_API_KEY ? 'ingesteld' : 'ONTBREEKT',
          database: 'ok',
        });
      }
      const handler = POST_ROUTES[path];
      if (request.method === 'POST' && handler) {
        const body = await request.json().catch(() => ({}));
        return json(await handler(env, body));
      }
      return json({ detail: 'Niet gevonden' }, 404);
    } catch (e: any) {
      const status = e instanceof ApiError ? e.status : 500;
      if (status >= 500 || status === 429) console.error(path, e?.stack || e);
      return json({ detail: e instanceof ApiError ? e.message : 'Er ging iets mis op de server' }, status);
    }
  },
};
