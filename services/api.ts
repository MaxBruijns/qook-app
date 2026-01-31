import { supabase } from '../utils/supabase'; 

const API_URL = 'https://qook-backend.onrender.com';

export const generateMealImage = async (title: string, prompt: string) => {
    const term = prompt || title;
    return `https://image.pollinations.ai/prompt/${encodeURIComponent(term + " gourmet food photography, high quality, plated")}?width=800&height=600&nologo=true`;
};

export const generateWeeklyPlan = async (prefs: any) => {
    const res = await fetch(`${API_URL}/generate-weekly-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            user_id: prefs.user_id || 'demo-user',
            ...prefs
        })
    });
    
    if (!res.ok) throw new Error("Backend Error");
    const data = await res.json();

    if (data.plan_id === "demo-temporary-id" || data.plan_id === "reused-from-bank") {
        return {
            days: data.days.map((r: any) => ({
                ...r,
                image_url: r.image_url || `https://image.pollinations.ai/prompt/${encodeURIComponent(r.title + " gourmet food photography, high quality, plated")}?width=800&height=600&nologo=true`,
                ai_image_prompt: r.ai_image_prompt || r.title
            })),
            zero_waste_report: data.zero_waste_report || 'Geselecteerd uit de Qook receptenbank.',
            generatedAt: new Date().toISOString()
        };
    }

    return await fetchPlanFromDB(data.plan_id);
};

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
    return { ...data.meal, id: currentMeal.id };
};

export const analyzeFridgeImage = async (base64: string, prefs: any) => {
    const res = await fetch(`${API_URL}/analyze-fridge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_data: base64, language: prefs.language })
    });
    return await res.json();
};

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

// services/api.ts
async function fetchPlanFromDB(planId: string) {
    const { data: recipes, error: rError } = await supabase
        .from('recipes')
        .select('*')
        .eq('weekly_plan_id', planId)
        .order('day_of_week', { ascending: true });

    const { data: plan } = await supabase
        .from('weekly_plans')
        .select('zero_waste_report')
        .eq('id', planId)
        .single();

    if (!recipes || rError) return null;

    return {
        days: recipes.map((r) => {
            // Als de database NULL geeft voor image_url, maken we hier de link:
            const generatedUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(r.title + " gourmet food photography, high quality, cinematic lighting")}?width=800&height=600&nologo=true`;

            return {
                ...r, // Behoudt ingrediënten en stappen
                // We vullen alle mogelijke namen zodat het Dashboard altijd beeld heeft
                image_url: r.image_url || generatedUrl,
                generated_image_url: r.image_url || generatedUrl,
                image: r.image_url || generatedUrl,
                
                // Zorg dat tijd en kcal ook namen hebben die de frontend begrijpt
                estimated_time_minutes: r.estimated_time_minutes || 30,
                calories_per_portion: r.calories_per_portion || 500,
                time: r.estimated_time_minutes || 30,
                calories: r.calories_per_portion || 500
            };
        }),
        zero_waste_report: plan?.zero_waste_report || 'Plan geladen uit receptenbank.',
        generatedAt: new Date().toISOString()
    };
}

export const generateDayPlan = async () => null;