import { supabase } from '../utils/supabase'; 

const API_URL = 'https://qook-backend.onrender.com';

// 1. AFBEELDING GENEREREN & OPSLAAN
export const generateMealImage = async (mealId: string, title: string, prompt: string) => {
    const term = prompt || title;
    const generatedUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(term + " gourmet food photography, high quality, plated, cinematic lighting")}?width=800&height=600&nologo=true`;

    // Optioneel: Stuur de URL terug naar de backend om hem op te slaan in de receptenbank
    // zodat hij de volgende keer direct uit de DB komt.
    if (mealId && !mealId.startsWith('meal-')) {
        fetch(`${API_URL}/save-meal-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ meal_id: mealId, image_data: generatedUrl })
        }).catch(err => console.error("Fout bij opslaan image naar bank:", err));
    }

    return generatedUrl;
};

// 2. WEEKPLAN GENEREREN
export const generateWeeklyPlan = async (prefs: any, favoriteTitles: string[] = []) => {
    const res = await fetch(`${API_URL}/generate-weekly-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            user_id: prefs.user_id || 'demo-user',
            ...prefs,
            favorite_titles: favoriteTitles // Voeg deze regel toe
        })
    });
    
    if (!res.ok) throw new Error("Backend Error");
    const data = await res.json();

    // Als de data direct van de AI komt (demo) of direct uit de bank (reused)
    if (data.plan_id === "demo-temporary-id" || data.plan_id === "reused-from-bank") {
        return {
            days: data.days.map((r: any) => {
                const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(r.title + " gourmet food photography")}?width=800&height=600&nologo=true`;
                return {
                    ...r,
                    // Zorg dat alle mogelijke veldnamen gevuld zijn voor het Dashboard
                    image_url: r.image_url || fallbackUrl,
                    generated_image_url: r.image_url || fallbackUrl,
                    image: r.image_url || fallbackUrl,
                    time: r.estimated_time_minutes || 30,
                    calories: r.calories_per_portion || 500,
                    estimated_time_minutes: r.estimated_time_minutes || 30,
                    calories_per_portion: r.calories_per_portion || 500
                };
            }),
            zero_waste_report: data.zero_waste_report || 'Geselecteerd uit de Qook receptenbank.',
            generatedAt: new Date().toISOString()
        };
    }

    // Voor ingelogde gebruikers die een nieuw opgeslagen plan laden
    return await fetchPlanFromDB(data.plan_id);
};

// 3. RECEPT DETAILS
export const generateFullRecipe = async (meal: any, prefs: any) => {
    // Als we de stappen al hebben (omdat ze uit de bank komen), hoeven we de AI niet aan te roepen!
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

// 4. OVERIGE FUNCTIES (REMAIN THE SAME)
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

// 5. DATABASE FETCH HULPFUNCTIE
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
        days: recipes.map((r) => {
            const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(r.title + " gourmet food photography")}?width=800&height=600&nologo=true`;
            return {
                ...r,
                image_url: r.image_url || fallbackUrl,
                generated_image_url: r.image_url || fallbackUrl,
                image: r.image_url || fallbackUrl,
                time: r.estimated_time_minutes || 30,
                calories: r.calories_per_portion || 500,
                estimated_time_minutes: r.estimated_time_minutes || 30,
                calories_per_portion: r.calories_per_portion || 500
            };
        }),
        zero_waste_report: plan?.zero_waste_report || 'Plan geladen uit receptenbank.',
        generatedAt: new Date().toISOString()
    };
}

export const generateDayPlan = async () => null;