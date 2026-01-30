import { supabase } from '../lib/supabase';

// URL backend
const API_URL = 'http://127.0.0.1:8000';

// Hulp: Foto's
export const generateMealImage = async (title: string, prompt: string) => {
    const term = prompt || title;
    return `https://image.pollinations.ai/prompt/${encodeURIComponent(term)}?width=400&height=300&nologo=true`;
};

// 1. GENERATE WEEKLY PLAN
export const generateWeeklyPlan = async (prefs: any) => {
    const res = await fetch(`${API_URL}/generate-weekly-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            user_id: prefs.user_id || 'demo-user', // Fallback voor als auth nog niet werkt in demo
            ...prefs
        })
    });
    
    if (!res.ok) throw new Error("Backend Error");
    const data = await res.json();
    return await fetchPlanFromDB(data.plan_id);
};

// 2. GET FULL RECIPE
export const generateFullRecipe = async (meal: any, prefs: any) => {
    if (meal.steps && meal.steps.length > 0) return meal;

    const res = await fetch(`${API_URL}/get-recipe-details`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            meal_id: meal.id,
            meal_title: meal.title,
            mode: meal.mode,
            adultsCount: prefs.adultsCount,
            childrenCount: prefs.childrenCount,
            language: prefs.language
        })
    });

    const data = await res.json();
    return { ...meal, ...data.details };
};

// 3. REPLACE MEAL
export const replaceMeal = async (currentMeal: any, prefs: any, dayIndex: number) => {
    const res = await fetch(`${API_URL}/replace-meal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            old_meal_title: currentMeal.title,
            day_index: dayIndex,
            mode: prefs.dayModes[dayIndex] || 'premium',
            prefs: { ...prefs, user_id: prefs.user_id || 'demo' }
        })
    });
    const data = await res.json();
    return { ...data.meal, id: currentMeal.id }; // Behoud ID
};

// 4. SCAN FRIDGE
export const analyzeFridgeImage = async (base64: string, prefs: any) => {
    const res = await fetch(`${API_URL}/analyze-fridge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_data: base64, language: prefs.language })
    });
    return await res.json();
};

// 5. SHOPPING LIST
export const generateShoppingList = async (meals: any[], prefs: any) => {
    const res = await fetch(`${API_URL}/generate-shopping-list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            meal_titles: meals.map(m => m.title),
            language: prefs.language
        })
    });
    const data = await res.json();
    return data.items.map((it: any, i: number) => ({ ...it, id: `item-${i}`, checked: false }));
};

// --- DB MAPPER ---
async function fetchPlanFromDB(planId: string) {
    const { data: recipes } = await supabase.from('recipes').select('*').eq('weekly_plan_id', planId).order('day_of_week', { ascending: true });
    const { data: plan } = await supabase.from('weekly_plans').select('zero_waste_report').eq('id', planId).single();

    if (!recipes) return null;

    return {
        days: recipes.map(r => ({
            ...r,
            ai_image_prompt: r.image_keywords // Mapping voor demo
        })),
        zero_waste_report: plan?.zero_waste_report || '',
        generatedAt: new Date().toISOString()
    };
}

// Dummy export voor demo compatibiliteit
export const generateDayPlan = async () => null;