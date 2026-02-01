import { supabase } from '../utils/supabase'; 
import { GoogleGenAI } from "@google/genai";

const API_URL = 'https://qook-backend.onrender.com';

// 1. BEELDGENERATIE VIA GEMINI (BETAALDE KWALITEIT) + SMART SAVE
export const generateMealImage = async (mealId: string, title: string, aiPrompt: string, existingUrl?: string): Promise<string> => {
    // Stap 1: Als er al een echte foto in de database staat, gebruik die direct (GRATIS)
    if (existingUrl && (existingUrl.startsWith('data:image') || existingUrl.startsWith('http')) && !existingUrl.includes('pollinations')) {
        return existingUrl;
    }

    try {
        // Gebruik de VITE_ prefix sleutel uit Vercel
        const genAI = new GoogleGenAI(import.meta.env.VITE_GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        const prompt = `A professional gourmet food photography shot of ${title}. ${aiPrompt}. 4k, cinematic lighting, high quality plated dish, culinary masterpiece.`;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        
        // Haal de base64 data uit de respons
        const parts = (response as any).candidates?.[0]?.content?.parts || [];
        let dataUrl = '';
        
        for (const part of parts) {
            if (part.inlineData?.data) {
                dataUrl = `data:image/png;base64,${part.inlineData.data}`;
                break;
            }
        }

        if (dataUrl) {
            // Stap 2: SMART SAVE - Sla de betaalde foto op in de database voor toekomstig gratis gebruik
            // We slaan alleen op als het een 'echt' recept-id is (geen tijdelijk demo-id)
            if (mealId && !mealId.toString().startsWith('meal-')) {
                fetch(`${API_URL}/save-meal-image`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ meal_id: mealId, image_data: dataUrl })
                }).catch(err => console.error("Kon image niet vastleggen in bank:", err));
            }
            return dataUrl;
        }

        throw new Error("Geen beelddata ontvangen van Gemini");

    } catch (error) {
        console.error("Gemini Image Error:", error);
        // Fallback naar een mooie algemene keuken-foto als Gemini limieten raakt
        return `https://images.unsplash.com/photo-1543353071-873f17a7a088?q=80&w=800&auto=format&fit=crop`;
    }
};

// 2. WEEKPLAN GENEREREN
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

    // Als de data direct van de AI komt (demo) of direct uit de bank (reused)
    if (data.plan_id === "demo-temporary-id" || data.plan_id === "reused-from-bank") {
        return {
            days: data.days.map((r: any, i: number) => ({
                ...r,
                // Zorg dat alle ID's en veldnamen kloppen voor de frontend
                id: r.id || `meal-${i}-${Math.random().toString(36).slice(2, 5)}`,
                time: r.estimated_time_minutes || 30,
                calories: r.calories_per_portion || 500,
                estimated_time_minutes: r.estimated_time_minutes || 30,
                calories_per_portion: r.calories_per_portion || 500
            })),
            zero_waste_report: data.zero_waste_report || 'Geselecteerd uit de Qook receptenbank.',
            generatedAt: new Date().toISOString()
        };
    }

    return await fetchPlanFromDB(data.plan_id);
};

// 3. VOLLEDIG RECEPT OPHALEN
export const generateFullRecipe = async (meal: any, prefs: any) => {
    // Als de stappen er al zijn (uit de bank), AI niet aanroepen (Bespaart geld!)
    if (meal.steps && meal.steps.length > 0) return meal;

    const res = await fetch(`${API_URL}/get-recipe-details`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            meal_id: meal.id,
            meal_title: meal.title,
            mode: meal.mode || 'premium',
            adultsCount: prefs.adultsCount,
            childrenCount: prefs.childrenCount,
            language: prefs.language
        })
    });

    const data = await res.json();
    return { ...meal, ...data.details };
};

// 4. OVERIGE BACKEND FUNCTIES
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
        days: recipes.map((r) => ({
            ...r,
            time: r.estimated_time_minutes || 30,
            calories: r.calories_per_portion || 500,
            estimated_time_minutes: r.estimated_time_minutes || 30,
            calories_per_portion: r.calories_per_portion || 500
        })),
        zero_waste_report: plan?.zero_waste_report || 'Plan geladen uit receptenbank.',
        generatedAt: new Date().toISOString()
    };
}

export const generateDayPlan = async () => null;