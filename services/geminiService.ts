import { UserPreferences, WeeklyPlan, Meal, ShoppingItem, FridgeScanResult } from "../types";

const BACKEND_URL = 'https://qook-backend.onrender.com';

// 1. WEEKMENU GENEREREN
export const generateWeeklyPlan = async (prefs: UserPreferences): Promise<WeeklyPlan> => {
  const response = await fetch(`${BACKEND_URL}/generate-weekly-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  });

  if (!response.ok) throw new Error('Backend Error');
  const data = await response.json();

  return {
    days: (data.days || []).map((m: any, i: number) => ({
      ...m,
      id: m.id || `meal-${i}-${Math.random().toString(36).slice(2, 7)}`,
      servings: prefs.adultsCount + prefs.childrenCount,
    })),
    zero_waste_report: data.zero_waste_report,
    generatedAt: new Date().toISOString()
  };
};

// 2. VOLLEDIG RECEPT OPHALEN (Voor MealDetail.tsx)
export const generateFullRecipe = async (meal: Meal, prefs: UserPreferences): Promise<Meal> => {
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
  
  // We voegen de details toe aan het bestaande meal object
  return { ...meal, ...data.details };
};

// 3. GERECHT VERVANGEN
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

// 4. BOODSCHAPPENLIJST
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

// 5. KOELKAST SCAN
export const analyzeFridgeImage = async (base64: string, prefs: UserPreferences): Promise<FridgeScanResult> => {
  const response = await fetch(`${BACKEND_URL}/analyze-fridge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_data: base64, language: prefs.language }),
  });
  return await response.json();
};

// 6. AFBEELDINGEN (Fallback naar Unsplash voor stabiliteit)
export const generateMealImage = async (title: string): Promise<string> => {
  return `https://images.unsplash.com/photo-1546069901-ba9599a7e63c?q=80&w=800&auto=format&fit=crop&sig=${encodeURIComponent(title)}`;
};
