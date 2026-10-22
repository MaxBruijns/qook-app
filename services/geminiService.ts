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
// hier rekenen we de hoeveelheden om naar dit huishouden.
const roundAmount = (n: number) => {
  if (!isFinite(n) || n <= 0) return n;
  if (n >= 100) return Math.round(n / 5) * 5;
  if (n >= 10) return Math.round(n);
  return Math.round(n * 4) / 4;
};

export const generateFullRecipe = async (meal: Meal, prefs: UserPreferences): Promise<Meal> => {
  const servings = servingsOf(prefs);
  const data = await post('/full-recipe', {
    meal: { id: meal.id, title: meal.title, mode: meal.mode, short_description: meal.short_description,
            ai_image_prompt: meal.ai_image_prompt, calories_per_portion: meal.calories_per_portion },
    language: prefs?.language || 'nl-NL',
  });
  const factor = servings / (data.base_servings || servings);
  const ingredients = (data.ingredients || []).map((i: any) => ({
    ...i, amount: roundAmount((Number(i.amount) || 0) * factor),
  }));
  const { base_servings, ...rest } = data;
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
