import { supabase } from '../utils/supabase'; 
import { GoogleGenAI } from "@google/genai";

const API_URL = 'https://qook-backend.onrender.com';

// 1. BEELDGENERATIE VIA GEMINI + SMART SAVE
export const generateMealImage = async (mealId: string, title: string, aiPrompt: string, existingUrl?: string): Promise<string> => {
    // Stap 1: Als er al een echte foto in de database staat, gebruik die direct (GRATIS)
    // We negeren oude Pollinations links
    if (existingUrl && existingUrl.startsWith('http') && !existingUrl.includes('pollinations')) {
        return existingUrl;
    }

    try {
        const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
        if (!apiKey) throw new Error("VITE_GEMINI_API_KEY ontbreekt in Vercel settings");

        const genAI = new GoogleGenAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        const prompt = `A professional gourmet food photography shot of ${title}. ${aiPrompt}. 4k, cinematic lighting, high quality plated dish, culinary masterpiece.`;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        
        const parts = (response as any).candidates?.[0]?.content?.parts || [];
        let dataUrl = '';
        
        for (const part of parts) {
            if (part.inlineData?.data) {
                dataUrl = `data:image/png;base64,${part.inlineData.data}`;
                break;
            }
        }

        if (dataUrl) {
            // Stap 2: SMART SAVE - Sla de foto op in de database voor de volgende keer
            if (mealId && !mealId.toString().startsWith('meal-') && mealId !== 'reused-from-bank') {
                fetch(`${API_URL}/save-meal-image`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ meal_id: mealId, image_data: dataUrl })
                }).catch(err => console.error("Kon image niet vastleggen in bank:", err));
            }
            return dataUrl;
        }

        throw new Error("Geen beelddata ontvangen");

    } catch (error) {
        console.error("Gemini Image Error:", error);
        // Fallback naar een kwalitatieve Unsplash foto als Gemini faalt
        return `https://images.unsplash.com/photo-1546069901-ba9599a7e63c?q=80&w=800&auto=format&fit=crop`;
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
                id: r.id || `meal-${i}-${Math.random().toString(36).slice(2, 5)}`,
                // Wis oude pollinations links zodat de MealCard een nieuwe Gemini foto aanvraagt
                image_url: (r.image_url && r.image_url.includes('pollinations')) ? null : r.image_url,
                time: r.estimated_time_minutes || 30,
                calories: r.calories_per_portion || 500,
                estimated_time_minutes: r.estimated_time_minutes || 30,
                calories_per_portion: r.calories_per_portion || 500
            })),
            zero_waste_report: data.zero_waste_report || 'Geselecteerd uit de Qook receptenbank.',
            generatedAt: new Date().toISOString()
        };
    }

    // Voor ingelogde gebruikers die een nieuw plan opslaan
    return await fetchPlanFromDB(data.plan_id);
};

// 3. VOLLEDIG RECEPT OPHALEN
export const generateFullRecipe = async (meal: any, prefs: any) => {
    // Gebruik data uit de bank als die al compleet is
    if (meal.steps && meal.steps.length > 0 && meal.ingredients && meal.ingredients.length > 0) {
        return meal;
    }

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

// 4. OVERIGE FUNCTIES
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

// 5. DATABASE FETCH HULPFUNCTIE (Synchroniseert ook hier de velden)
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
            // Opschonen van eventuele oude Pollinations links
            image_url: (r.image_url && r.image_url.includes('pollinations')) ? null : r.image_url,
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