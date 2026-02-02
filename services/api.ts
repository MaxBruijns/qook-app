import { supabase } from '../utils/supabase'; 

const API_URL = 'https://qook-backend.onrender.com';

// 1. AFBEELDINGEN (Backend levert nu de URL, dit is alleen een fallback)
export const generateMealImage = async (mealId: string, title: string, prompt: string, existingUrl?: string): Promise<string> => {
    // Gebruik de URL die de backend heeft klaargezet
    if (existingUrl && !existingUrl.includes('pollinations')) return existingUrl;
    
    // Als er echt niets is, een nette Unsplash fallback op basis van de titel
    return `https://images.unsplash.com/photo-1546069901-ba9599a7e63c?q=80&w=800&auto=format&fit=crop&sig=${mealId}`;
};

// 2. WEEKPLAN GENEREREN (Database First + AI Fallback)
export const generateWeeklyPlan = async (prefs: any, favoriteTitles: string[] = []) => {
    const res = await fetch(`${API_URL}/generate-weekly-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ...prefs,
            user_id: prefs.user_id || 'demo-user',
            favorite_titles: favoriteTitles,
            generationHistory: prefs.generationHistory || []
        })
    });
    
    if (!res.ok) throw new Error("Backend Error");
    const data = await res.json();

    // Mapping logica voor demo/reused plannen om veldnamen gelijk te trekken
    if (data.plan_id === "demo-id" || data.plan_id === "reused") {
        return {
            days: data.days.map((r: any, i: number) => ({
                ...r,
                id: r.id || `meal-${i}-${Math.random().toString(36).slice(2, 5)}`,
                time: r.estimated_time_minutes || 30,
                calories: r.calories_per_portion || 500,
                estimated_time_minutes: r.estimated_time_minutes || 30,
                calories_per_portion: r.calories_per_portion || 500
            })),
            zero_waste_report: data.zero_waste_report || 'Menu van de Chef.',
            generatedAt: new Date().toISOString()
        };
    }

    // Voor ingelogde gebruikers die een nieuw plan opslaan
    return await fetchPlanFromDB(data.plan_id);
};

// 3. VOLLEDIG RECEPT OPHALEN
export const generateFullRecipe = async (meal: any, prefs: any) => {
    // Als de database-bank het recept al compleet heeft (stappen aanwezig), gebruik die!
    if (meal.steps && meal.steps.length > 0) return meal;

    const res = await fetch(`${API_URL}/get-recipe-details`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meal_id: meal.id })
    });

    const data = await res.json();
    if (data.status === "error") throw new Error(data.message);
    
    return { ...meal, ...data.details };
};

// 4. GERECHT VERVANGEN
export const replaceMeal = async (currentMeal: any, prefs: any, dayIndex: number) => {
    const res = await fetch(`${API_URL}/replace-meal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            old_meal_title: currentMeal.title,
            day_index: dayIndex,
            mode: prefs.dayModes[dayIndex] || 'premium',
            prefs: { ...prefs, user_id: prefs.user_id || 'demo-user' }
        })
    });
    const data = await res.json();
    return { ...data.meal, id: currentMeal.id };
};

// 5. KOELKAST SCAN (Analyze Fridge)
export const analyzeFridgeImage = async (base64: string, prefs: any) => {
    const res = await fetch(`${API_URL}/analyze-fridge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            image_data: base64, 
            language: prefs.language 
        })
    });
    if (!res.ok) throw new Error("Fridge Scan Error");
    return await res.json();
};

// 6. BOODSCHAPPENLIJST
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

// 7. HULPFUNCTIE: PLAN LADEN UIT DB
async function fetchPlanFromDB(planId: string) {
    const { data: recipes, error: rError } = await supabase
        .from('recipes')
        .select('*')
        .eq('weekly_plan_id', planId)
        .order('day_of_week', { ascending: true });

    if (!recipes || rError) return null;

    const { data: plan } = await supabase
        .from('weekly_plans')
        .select('zero_waste_report')
        .eq('id', planId)
        .single();

    return {
        days: recipes.map((r) => ({
            ...r,
            time: r.estimated_time_minutes || 30,
            calories: r.calories_per_portion || 500,
            estimated_time_minutes: r.estimated_time_minutes || 30,
            calories_per_portion: r.calories_per_portion || 500
        })),
        zero_waste_report: plan?.zero_waste_report || 'Menu uit de bank.',
        generatedAt: new Date().toISOString()
    };
}

export const generateDayPlan = async () => null;