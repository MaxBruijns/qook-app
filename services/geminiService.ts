// KOOQ AI-service.
//
// Dezelfde functies als in het oorspronkelijke AI Studio-ontwerp, zodat de
// schermen ongewijzigd blijven. Het verschil: alle AI loopt nu via de eigen
// backend (Cloudflare Worker op /api). Er staat GEEN API-sleutel in de app.
import { UserPreferences, WeeklyPlan, Meal, ShoppingItem, FridgeScanResult } from "../types";
import { getTasteProfile, getTasteState, needsProfileRefresh, setTasteProfile } from "../utils/tasteProfile";

const API = '/api';

const post = async (path: string, body: any) => {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Serverfout ${res.status}`);
  }
  return res.json();
};

const servingsOf = (prefs?: UserPreferences) =>
  Math.max(1, (prefs?.adultsCount ?? 2) + (prefs?.childrenCount ?? 0));

/** Gerecht uit de backend klaarmaken voor de schermen. */
const toMeal = (m: any, servings: number, mode?: string): Meal => ({
  ...m,
  servings,
  mode: (mode || m.mode || 'premium') as any,
  generated_image_url: m.image_url || m.generated_image_url || undefined,
});

const FALLBACK_IMAGE = (title: string) =>
  `https://images.unsplash.com/photo-1546069901-ba9599a7e63c?q=80&w=800&auto=format&fit=crop&sig=${encodeURIComponent(title)}`;

// --- MAALTIJDFOTO ---------------------------------------------------------
// De backend maakt per gerecht één keer een foto en bewaart die.
export const generateMealImage = async (title: string, aiPrompt: string): Promise<string> => {
  const cacheKey = `qook_img_${btoa(encodeURIComponent(title)).slice(0, 32)}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached && !cached.startsWith('data:')) return cached;
  } catch {}

  try {
    const { url } = await post('/meal-image', { title, prompt: aiPrompt });
    if (url) {
      try { localStorage.setItem(cacheKey, url); } catch {}
      return url;
    }
  } catch (e) {
    console.warn('Foto ophalen mislukt, standaardfoto gebruikt:', e);
  }
  return FALLBACK_IMAGE(title);
};

// --- SMAAKPROFIEL ---------------------------------------------------------
// Vat de recente keuzes samen tot een kort profiel. Mislukt dit, dan gaat
// het weekmenu gewoon door met het vorige profiel.
const refreshTasteProfile = async (language: string): Promise<string> => {
  const current = getTasteProfile();
  if (!needsProfileRefresh()) return current;
  try {
    const { events } = getTasteState();
    const data = await post('/taste-profile', { events: events.slice(-60), previousProfile: current, language });
    if (typeof data.profile === 'string') {
      setTasteProfile(data.profile, true);
      return data.profile;
    }
  } catch (e) {
    console.warn('Smaakprofiel bijwerken mislukt:', e);
  }
  return current;
};

// --- WEEKMENU -------------------------------------------------------------
export const generateWeeklyPlan = async (prefs: UserPreferences, favoriteTitles: string[] = []): Promise<WeeklyPlan> => {
  const tasteProfile = await refreshTasteProfile(prefs?.language || 'nl-NL');
  const data = await post('/weekly-plan', { prefs: { ...prefs, tasteProfile }, favoriteTitles });
  const servings = servingsOf(prefs);
  return {
    days: (data.days || []).map((m: any, i: number) => toMeal(m, servings, prefs.dayModes?.[i] || 'premium')),
    zero_waste_report: data.zero_waste_report,
    generatedAt: new Date().toISOString(),
  };
};

// --- GERECHT VERVANGEN ----------------------------------------------------
export const replaceMeal = async (currentMeal: Meal, prefs: UserPreferences, dayIndex: number, favoriteTitles: string[] = []): Promise<Meal> => {
  const data = await post('/replace-meal', {
    currentMeal: { id: currentMeal.id, title: currentMeal.title },
    prefs: { ...prefs, tasteProfile: getTasteProfile() }, dayIndex, favoriteTitles,
  });
  return toMeal(data, servingsOf(prefs), prefs.dayModes?.[dayIndex] || 'premium');
};

// --- VOLLEDIG RECEPT ------------------------------------------------------
// De backend bewaart elk recept één keer (voor een vast aantal personen);
// hier rekenen we de hoeveelheden om naar dit huishouden, in keukenmaten.
const NOT_SCALED = /naar smaak|snufje|scheutje|beetje|handje|optioneel/i;
const COUNT_UNITS = /^(st|stuks?|stuk|teen|tenen|teentjes?|bosjes?|blik(ken)?|pot(ten)?|zakjes?|plakjes?|plakken|takjes?|blaadjes?|eetlepels?|theelepels?|el|tl|kopjes?|pieces?|cloves?|tbsp|tsp|cups?)$/i;

const HALF_UNITS = /^(eetlepels?|theelepels?|el|tl|bosjes?|kopjes?|blik(ken)?|tbsp|tsp|cups?)$/i;
const HALVABLE = /citroen|limoen|sinaasappel|\bui\b|uien|paprika|avocado|komkommer|courgette|aubergine|kool|broccoli|pompoen|meloen|ananas|mango|venkel|prei/i;

const FRACTIONS: Record<number, string> = { 0.25: '¼', 0.5: '½', 0.75: '¾' };

/** 1.5 -> "1½", 0.5 -> "½", 2 -> "2" */
const withFraction = (n: number): string => {
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 4) / 4;
  if (frac === 1) return String(whole + 1);
  const f = FRACTIONS[frac] || '';
  return whole === 0 ? (f || '0') : `${whole}${f}`;
};

/** Enkelvoud t/m 1, meervoud daarboven: "1 eetlepel", "2 eetlepels", "½ stuk", "3 tenen". */
const PLURALS: Record<string, string> = { stuk: 'stuks', teen: 'tenen', eetlepel: 'eetlepels', theelepel: 'theelepels',
  bosje: 'bosjes', blik: 'blikken', pot: 'potten', zakje: 'zakjes', plakje: 'plakjes', takje: 'takjes', kopje: 'kopjes' };
const SINGULARS: Record<string, string> = Object.fromEntries(Object.entries(PLURALS).map(([a, b]) => [b, a]));
const countUnit = (unit: string, v: number) => {
  const u = unit.toLowerCase();
  if (v <= 1) return SINGULARS[u] || unit;
  return PLURALS[u] || unit;
};

export const scaleIngredient = (ing: any, factor: number) => {
  const unit = String(ing.unit || '').trim();
  const amount = Number(ing.amount) || 0;
  // Zout, peper, "naar smaak": niet omrekenen en geen getal tonen.
  if (NOT_SCALED.test(unit) || NOT_SCALED.test(String(ing.name || '')) || amount <= 0) {
    return { ...ing, amount: '', unit: unit || 'naar smaak' };
  }
  const n = amount * factor;
  if (COUNT_UNITS.test(unit) || !unit) {
    // Lepels, bosjes en groente/fruit dat je kunt halveren: in halven.
    // Al het andere (eieren, tenen knoflook, zalmfilets): hele aantallen, minimaal 1.
    const halvesOk = HALF_UNITS.test(unit) || HALVABLE.test(String(ing.name || ''));
    const v = halvesOk ? Math.max(0.5, Math.round(n * 2) / 2) : Math.max(1, Math.round(n));
    return { ...ing, amount: withFraction(v), unit: countUnit(unit, v) };
  }
  // Gram, ml en dergelijke: afronden op logische maten.
  let v: number;
  if (n < 10) v = Math.max(1, Math.round(n));
  else if (n < 100) v = Math.round(n / 5) * 5;
  else if (n < 500) v = Math.round(n / 10) * 10;
  else v = Math.round(n / 50) * 50;
  return { ...ing, amount: v, unit };
};

export const generateFullRecipe = async (meal: Meal, prefs: UserPreferences): Promise<Meal> => {
  const servings = servingsOf(prefs);
  const data = await post('/full-recipe', {
    meal: { id: meal.id, title: meal.title, mode: meal.mode, short_description: meal.short_description,
            ai_image_prompt: meal.ai_image_prompt, calories_per_portion: meal.calories_per_portion },
    language: prefs?.language || 'nl-NL',
  });
  const factor = servings / (data.base_servings || servings);
  const ingredients = (data.ingredients || []).map((i: any) => scaleIngredient(i, factor));
  const { base_servings, v, ...rest } = data;
  return { ...meal, servings, ...rest, ingredients };
};

// --- BOODSCHAPPENLIJST ----------------------------------------------------
export const generateShoppingList = async (meals: Meal[], prefs: UserPreferences): Promise<ShoppingItem[]> => {
  return post('/shopping-list', {
    meals: meals.map(m => ({ id: m.id, title: m.title })),
    servings: servingsOf(prefs),
    language: prefs?.language || 'nl-NL',
  });
};

// --- KOELKASTSCAN ---------------------------------------------------------
// Telefoonfoto's zijn vaak 3-5 MB; verkleinen tot max 1024px houdt de scan snel.
const shrinkImage = (base64: string, maxSize = 1024): Promise<string> =>
  new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(base64);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.onerror = () => resolve(base64);
    img.src = `data:image/jpeg;base64,${base64}`;
  });

export const analyzeFridgeImage = async (base64: string, prefs: UserPreferences): Promise<FridgeScanResult> => {
  try {
    const data = await post('/fridge-scan', { image: await shrinkImage(base64), prefs });
    const servings = servingsOf(prefs);
    return {
      recognizedItems: data.recognizedItems || [],
      suggestions: (data.suggestions || []).map((m: any) => toMeal(m, servings, 'magic')),
    };
  } catch (e) {
    console.error('Koelkastscan mislukt:', e);
    return { recognizedItems: [], suggestions: [] };
  }
};

// --- CHAT MET DE SOUS-CHEF ------------------------------------------------
export const sendChatMessage = async (params: {
  messages: { sender: string; text: string }[];
  message: string;
  userStatus: string;
  currentView: string;
  language: string;
  diet: string[];
}): Promise<{ reply: string; diet: string[] | null }> => {
  const data = await post('/chat', params);
  return { reply: data.reply || '', diet: data.diet || null };
};
