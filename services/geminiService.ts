import { GoogleGenAI } from "@google/genai";
import { UserPreferences, WeeklyPlan, Meal, ShoppingItem, FridgeScanResult } from "../types";

const BACKEND_URL = 'https://qook-backend.onrender.com';
const MODEL_IMAGE = 'gemini-2.0-flash-image'; 

let generationQueue = Promise.resolve();

// 1. BEELDGENERATIE + AUTOMATISCH OPSLAAN IN DB
export const generateMealImage = async (mealId: string, title: string, aiPrompt: string): Promise<string> => {
  const cacheKey = `qook_img_${mealId}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) return cached;

  return new Promise((resolve) => {
    generationQueue = generationQueue.then(async () => {
      try {
        await new Promise(r => setTimeout(r, 1200));
        const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
          model: MODEL_IMAGE,
          contents: { 
            parts: [{ text: `A professional food photography shot of ${title}. ${aiPrompt}. 4k, cinematic lighting.` }] 
          },
          config: { imageConfig: { aspectRatio: "1:1" } }
        });

        const parts = (response as any).candidates?.[0]?.content?.parts || [];
        let dataUrl = '';
        for (const part of parts) {
          if (part.inlineData?.data) {
            dataUrl = `data:image/png;base64,${part.inlineData.data}`;
            break;
          }
        }

        if (dataUrl) {
          // SMART SAVE: Stuur de gegenereerde foto naar de backend om de bank te vullen
          if (mealId && !mealId.toString().startsWith('meal-')) {
            fetch(`${BACKEND_URL}/save-meal-image`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ meal_id: mealId, image_data: dataUrl })
            }).catch(err => console.error("Kon image niet opslaan in bank:", err));
          }

          try { localStorage.setItem(cacheKey, dataUrl); } catch (e) {}
          resolve(dataUrl);
        } else {
          throw new Error("No image data");
        }
      } catch (error) {
        // Fallback naar Pollinations (gratis/snel) als Gemini Image limiet bereikt is
        resolve(`https://image.pollinations.ai/prompt/${encodeURIComponent(title + " gourmet food")}?width=800&height=800&nologo=true`);
      }
    });
  });
};

// 2. WEEKMENU GENEREREN (Via Backend)
export const generateWeeklyPlan = async (prefs: UserPreferences): Promise<WeeklyPlan> => {
  const response = await fetch(`${BACKEND_URL}/generate-weekly-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  });

  if (!response.ok) throw new Error('Backend Error');
  const data = await response.json();

  return {
    id: data.plan_id,
    days: (data.days || []).map((m: any, i: number) => ({
      ...m,
      // Fallbacks voor data uit database vs data van AI
      id: m.id || `meal-${i}-${Math.random().toString(36).slice(2, 7)}`,
      servings: prefs.adultsCount + prefs.childrenCount,
      estimated_time_minutes: m.estimated_time_minutes || m.time || 30,
      calories_per_portion: m.calories_per_portion || m.calories || 500
    })),
    zero_waste_report: data.zero_waste_report,
    generatedAt: new Date().toISOString()
  };
};

// 3. VOLLEDIG RECEPT OPHALEN
export const generateFullRecipe = async (meal: Meal, prefs: UserPreferences): Promise<Meal> => {
  // Als we de details al hebben, AI niet lastigvallen
  if (meal.steps && meal.steps.length > 0) return meal;

  const response = await fetch(`${BACKEND_URL}/get-recipe-details`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      meal_id: meal.id,
      meal_title: meal.title,
      mode: meal.mode || 'premium',
      adultsCount: prefs.adultsCount,
      childrenCount: prefs.childrenCount,
      language: prefs.language
    }),
  });
  
  if (!response.ok) throw new Error('Fout bij ophalen receptdetails');
  const data = await response.json();
  return { ...meal, ...data.details };
};

// 4. OVERIGE BACKEND FUNCTIES
export const replaceMeal = async (currentMeal: Meal, prefs: UserPreferences, dayIndex: number): Promise<Meal> => {
    const response = await fetch(`${BACKEND_URL}/replace-meal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            old_meal_title: currentMeal.title,
            day_index: dayIndex,
            mode: prefs.dayModes[dayIndex] || 'premium',
            prefs: prefs
        }),
    });
    const data = await response.json();
    return { ...data.meal, id: `replaced-${Date.now()}` };
};

export const generateShoppingList = async (meals: Meal[], prefs: UserPreferences): Promise<ShoppingItem[]> => {
    const response = await fetch(`${BACKEND_URL}/generate-shopping-list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            meal_titles: meals.map(m => m.title),
            language: prefs.language
        }),
    });
    const data = await response.json();
    return data.items.map((it: any, i: number) => ({ ...it, id: `it-${i}`, checked: false }));
};

export const analyzeFridgeImage = async (base64: string, prefs: UserPreferences): Promise<FridgeScanResult> => {
  const response = await fetch(`${BACKEND_URL}/analyze-fridge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_data: base64, language: prefs.language }),
  });
  return await response.json();
};