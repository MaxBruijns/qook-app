/**
 * KOOQ — alles in één Cloudflare Worker.
 *
 *  - Serveert de website (map ./dist, gebouwd door Vite).
 *  - /api/*  : de backend.
 *  - Tekst   : Google Gemini (gratis tier) via GEMINI_API_KEY.
 *  - Foto's  : Workers AI (FLUX schnell), één keer per gerecht, bewaard in R2.
 *  - Data    : D1-database met de receptenbank.
 *
 * Instellingen (Cloudflare → Worker → Settings → Variables and Secrets):
 *  - GEMINI_API_KEY (secret, verplicht)
 *  - TEXT_MODEL     (optioneel, standaard gemini-2.5-flash)
 */

interface Env {
  DB: any;            // D1-database (receptenbank)
  PHOTOS: any;        // R2-bucket (maaltijdfoto's)
  AI: any;            // Workers AI
  ASSETS: any;        // De gebouwde website
  GEMINI_API_KEY: string;
  TEXT_MODEL?: string;
}

const IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';

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

const langName = (code = 'nl') => {
  const c = code.toLowerCase();
  if (c.startsWith('nl')) return 'Dutch';
  if (c.startsWith('de')) return 'German';
  if (c.startsWith('fr')) return 'French';
  if (c.startsWith('es')) return 'Spanish';
  return 'English';
};

const parseJson = (text: string) => {
  let t = (text || '').trim();
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(t);
};

// ---------------------------------------------------------------------------
// Gemini (tekst + koelkastfoto)
// ---------------------------------------------------------------------------
async function aiJson(env: Env, system: string, prompt: string, temperature = 0.7, imageB64?: string): Promise<any> {
  if (!env.GEMINI_API_KEY) throw new ApiError(500, 'GEMINI_API_KEY ontbreekt in de Worker-instellingen');
  const model = env.TEXT_MODEL || 'gemini-2.5-flash';
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
    const body = await res.text();
    console.error('Gemini-fout', res.status, body.slice(0, 500));
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
// ---------------------------------------------------------------------------
let schemaReady: Promise<void> | null = null;
function ensureSchema(env: Env) {
  if (!schemaReady) {
    schemaReady = env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS recipes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        short_description TEXT,
        ai_image_prompt TEXT,
        ingredients TEXT,
        steps TEXT,
        mode TEXT,
        diet_tags TEXT,
        estimated_time_minutes INTEGER,
        calories_per_portion INTEGER,
        has_image INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS recipes_title ON recipes(title)'),
    ]).then(() => undefined).catch((e: any) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

const imageUrl = (id: string) => `/api/images/${id}.jpg`;

function rowToMeal(row: any) {
  return {
    id: row.id,
    title: row.title,
    short_description: row.short_description,
    ai_image_prompt: row.ai_image_prompt,
    ingredients: row.ingredients ? JSON.parse(row.ingredients) : [],
    steps: row.steps ? JSON.parse(row.steps) : [],
    mode: row.mode,
    estimated_time_minutes: row.estimated_time_minutes,
    calories_per_portion: row.calories_per_portion,
    image_url: row.has_image ? imageUrl(row.id) : null,
  };
}

/** Bewaart gerechten in de receptenbank; bestaande titels worden hergebruikt (incl. foto). */
async function saveRecipes(env: Env, meals: any[], diet: string[]) {
  await ensureSchema(env);
  const titles = meals.map(m => String(m.title || '').trim()).filter(Boolean);
  const existing = new Map<string, any>();
  if (titles.length) {
    const q = `SELECT id, title, has_image FROM recipes WHERE title IN (${titles.map(() => '?').join(',')})`;
    const { results } = await env.DB.prepare(q).bind(...titles).all();
    for (const r of results || []) existing.set(r.title, r);
  }

  const inserts: any[] = [];
  for (const m of meals) {
    m.title = String(m.title || '').trim();
    const found = existing.get(m.title);
    if (found) {
      m.id = found.id;
      m.image_url = found.has_image ? imageUrl(found.id) : null;
      continue;
    }
    m.id = crypto.randomUUID();
    m.image_url = null;
    existing.set(m.title, { id: m.id, has_image: 0 });
    inserts.push(env.DB.prepare(
      `INSERT INTO recipes (id, title, short_description, ai_image_prompt, ingredients, steps, mode,
        diet_tags, estimated_time_minutes, calories_per_portion) VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      m.id, m.title, m.short_description ?? null, m.ai_image_prompt ?? null,
      JSON.stringify(m.ingredients || []), JSON.stringify(m.steps || []), m.mode ?? null,
      JSON.stringify(diet || []), Number(m.estimated_time_minutes) || null, Number(m.calories_per_portion) || null,
    ));
  }
  if (inserts.length) await env.DB.batch(inserts);
  return meals;
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

async function createImage(env: Env, recipeId: string): Promise<string> {
  await ensureSchema(env);
  const recipe: any = await env.DB.prepare('SELECT id, title, ai_image_prompt, has_image FROM recipes WHERE id = ?')
    .bind(recipeId).first();
  if (!recipe) throw new ApiError(404, 'Recept niet gevonden');
  if (recipe.has_image) return imageUrl(recipe.id);

  const prompt =
    `Professional food photography of ${recipe.title}. ${recipe.ai_image_prompt || ''} ` +
    'Plated dish seen from a 45 degree angle, natural window light, shallow depth of field, ' +
    'restaurant-quality plating on a ceramic plate, appetizing, realistic. No text, no watermark, no people, no hands.';
  const out: any = await env.AI.run(IMAGE_MODEL, { prompt: prompt.slice(0, 2000), steps: 6 });
  if (!out?.image) throw new ApiError(502, 'Geen afbeelding ontvangen van Workers AI');

  await env.PHOTOS.put(`meals/${recipe.id}.jpg`, base64ToBytes(out.image), {
    httpMetadata: { contentType: 'image/jpeg' },
  });
  await env.DB.prepare('UPDATE recipes SET has_image = 1 WHERE id = ?').bind(recipe.id).run();
  return imageUrl(recipe.id);
}

function getOrCreateImage(env: Env, recipeId: string) {
  let p = inflight.get(recipeId);
  if (!p) {
    p = createImage(env, recipeId).finally(() => inflight.delete(recipeId));
    inflight.set(recipeId, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------
const MEAL_SCHEMA = `{
  "title": "Dish name",
  "short_description": "Appealing one-sentence description",
  "ai_image_prompt": "Short English description of how the plated dish looks",
  "ingredients": [{"name": "...", "amount": 0, "unit": "..."}],
  "steps": [{"step_index": 1, "user_text": "...", "needs_timer": false, "estimated_duration_seconds": 0}],
  "estimated_time_minutes": 30,
  "calories_per_portion": 600,
  "mode": "premium"
}`;

const CHEF_SYSTEM =
  'You are Chef Qook, the culinary engine of the KOOQ meal-planning app. ' +
  'You write realistic, tasty home-cooking recipes. Always answer with valid JSON only.';

const lastN = (arr: any, n: number) => (Array.isArray(arr) ? arr.slice(-n) : []);

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------
async function weeklyPlan(env: Env, b: any) {
  const dayModes: Record<string, string> = b.dayModes || {};
  const modes = Object.entries(dayModes).map(([d, m]) => `day ${d}: ${m}`).join(', ') || 'all days: premium';
  const prompt = `Create a 7-day dinner menu. Write all text in ${langName(b.language)} (ai_image_prompt in English).
- Diet: ${JSON.stringify(b.diet || [])}
- Budget: ${b.budget || 'Normaal'}
- Household: ${b.adultsCount ?? 2} adults, ${b.childrenCount ?? 0} children (ingredient amounts for the whole household)
- Zero-waste level: ${b.zeroWasteLevel ?? 50}% (higher = reuse ingredients across days)
- Day modes: ${modes} ('culinary' = chef-level, 'premium' = easy comfort food)
- NEVER use these dishes: ${JSON.stringify(lastN(b.generationHistory, 60))}
- Style inspiration (favorites): ${JSON.stringify(b.favorite_titles || [])}

Return JSON: {"zero_waste_report": "short explanation of ingredient reuse", "days": [7 objects with "day_number" (0-6) plus these fields: ${MEAL_SCHEMA}]}`;

  const data = await aiJson(env, CHEF_SYSTEM, prompt, 0.9);
  const days = (data.days || []).slice(0, 7);
  days.forEach((d: any, i: number) => {
    d.day_number ??= i;
    if (dayModes[String(i)]) d.mode = dayModes[String(i)];
  });
  await saveRecipes(env, days, b.diet || []);
  return { status: 'success', days, zero_waste_report: data.zero_waste_report || '' };
}

async function replaceMeal(env: Env, b: any) {
  const mode = b.mode || 'premium';
  const prompt = `Create ONE replacement dinner for "${b.meal_title}". Write text in ${langName(b.language)} (ai_image_prompt in English).
- Diet: ${JSON.stringify(b.diet || [])}
- Budget: ${b.budget || 'Normaal'}
- Mode: ${mode} ('culinary' = chef-level, 'premium' = easy comfort food)
- Must be clearly different from: ${JSON.stringify([b.meal_title, ...lastN(b.exclude_titles, 60)])}
- Style inspiration: ${JSON.stringify(b.favorite_titles || [])}

Return JSON exactly in this shape: ${MEAL_SCHEMA}`;
  const meal = await aiJson(env, CHEF_SYSTEM, prompt, 1.0);
  meal.mode = mode;
  await saveRecipes(env, [meal], b.diet || []);
  return { status: 'success', meal };
}

async function shoppingList(env: Env, b: any) {
  const meals = Array.isArray(b.meals) ? b.meals : [];
  const list = meals.map((m: any) => `- ${m.title}: ${JSON.stringify(m.ingredients || [])}`).join('\n');
  const prompt = `Combine these recipes into one shopping list in ${langName(b.language)}.
Merge duplicate ingredients, add up amounts, round to practical shop quantities,
and group by supermarket category (e.g. Groente & fruit, Vlees & vis, Zuivel, Voorraad).
Recipes:
${list}

Return JSON: {"categories": [{"name": "...", "items": [{"name": "...", "amount": 0, "unit": "..."}]}]}`;
  const data = await aiJson(env, CHEF_SYSTEM, prompt, 0.2);
  const items: any[] = [];
  for (const cat of data.categories || []) {
    for (const it of cat.items || []) {
      items.push({
        id: `item_${items.length}`, name: it.name || '', amount: it.amount ?? '',
        unit: it.unit || '', category: cat.name || '', checked: false,
      });
    }
  }
  return { status: 'success', items };
}

async function analyzeFridge(env: Env, b: any) {
  if (!b.image_data) throw new ApiError(400, 'Geen foto ontvangen');
  const prompt = `Look at this photo of a fridge or ingredients. List the ingredients you can clearly see,
then suggest 3 dinners that mainly use them. Write text in ${langName(b.language)} (ai_image_prompt in English).
Diet: ${JSON.stringify(b.diet || [])}.

Return JSON: {"recognizedItems": ["..."], "suggestions": [3 objects in this shape: ${MEAL_SCHEMA}]}`;
  const data = await aiJson(env, CHEF_SYSTEM, prompt, 0.6, b.image_data);
  const suggestions = (data.suggestions || []).slice(0, 3);
  suggestions.forEach((s: any) => { s.mode = 'magic'; });
  await saveRecipes(env, suggestions, b.diet || []);
  return { recognizedItems: data.recognizedItems || [], suggestions };
}

async function chat(env: Env, b: any) {
  const history = lastN(b.messages, 12)
    .map((m: any) => `${m.sender === 'assistant' ? 'Chef' : 'User'}: ${m.text || ''}`).join('\n');
  const system =
    'You are the Qook sous-chef inside a meal-planning app. Be friendly, professional, short and practical. ' +
    `Answer in ${langName(b.language)}. User status: ${b.user_status}. Current screen: ${b.current_view}. ` +
    `Current diet preferences: ${JSON.stringify(b.diet || [])}. Always answer with valid JSON only.`;
  const prompt = `Conversation so far:
${history}
User: ${b.message || ''}

If the user clearly asks to change their diet preferences, put the complete new list in "diet"; otherwise "diet" is null.
Return JSON: {"reply": "your answer", "diet": null}`;
  const data = await aiJson(env, system, prompt, 0.7);
  return { reply: data.reply || '', diet: Array.isArray(data.diet) ? data.diet : null };
}

async function recipeDetails(env: Env, b: any) {
  await ensureSchema(env);
  const row = b.meal_id ? await env.DB.prepare('SELECT * FROM recipes WHERE id = ?').bind(String(b.meal_id)).first() : null;
  return { status: 'success', details: row ? rowToMeal(row) : {} };
}

async function serveImage(env: Env, name: string) {
  const obj = await env.PHOTOS.get(`meals/${name}`);
  if (!obj) return new Response('Niet gevonden', { status: 404 });
  return new Response(obj.body, {
    headers: {
      'content-type': 'image/jpeg',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const POST_ROUTES: Record<string, (env: Env, body: any) => Promise<any>> = {
  '/api/generate-weekly-plan': weeklyPlan,
  '/api/replace-meal': replaceMeal,
  '/api/generate-shopping-list': shoppingList,
  '/api/analyze-fridge': analyzeFridge,
  '/api/chat': chat,
  '/api/get-recipe-details': recipeDetails,
  '/api/generate-image': async (env, b) => ({ status: 'success', url: await getOrCreateImage(env, String(b.recipe_id || '')) }),
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      if (request.method === 'GET' && path.startsWith('/api/images/')) {
        return serveImage(env, path.slice('/api/images/'.length));
      }
      if (request.method === 'GET' && path === '/api/health') {
        await ensureSchema(env);
        return json({
          status: 'ok',
          text_model: env.TEXT_MODEL || 'gemini-2.5-flash',
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
      console.error(path, e?.stack || e);
      const status = e instanceof ApiError ? e.status : 500;
      return json({ detail: e instanceof ApiError ? e.message : 'Er ging iets mis op de server' }, status);
    }
  },
};
