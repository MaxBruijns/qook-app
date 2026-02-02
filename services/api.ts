import { supabase } from '../utils/supabase'; 
import { GoogleGenAI } from "@google/genai";

const API_URL = 'https://qook-backend.onrender.com';

// 1. AFBEELDINGEN (PUUR GEMINI + SMART SAVE)
export const generateMealImage = async (mealId: string, title: string, aiPrompt: string, existingUrl?: string): Promise<string> => {
    // Gebruik de URL uit de database als die er al is (en echt een foto is)
    if (existingUrl && existingUrl.startsWith('data:image')) {
        return existingUrl;
    }

    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
        return `https://images.unsplash.com/photo-1546069901-ba9599a7e63c?q=80&w=800&auto=format&fit=crop&sig=${mealId}`;
    }

    try {
        const genAI = new GoogleGenAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        const prompt = `A professional gourmet food photography shot of ${title}. ${aiPrompt}. 4k, cinematic lighting, high quality plated dish.`;
        
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
            // Sla de foto op in de database voor de volgende keer
            if (mealId && !mealId.toString().startsWith('meal-')) {
                fetch(`${API_URL}/save-meal-image`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ meal_id: mealId, image_data: dataUrl })
                }).catch(e => console.warn("Opslaan mislukt", e));
            }
            return dataUrl;
        }
        throw new Error("Geen beelddata");

    } catch (error) {
        console.error("Gemini Image Error:", error);
        return `https://images.unsplash.com/photo-1546069901-ba9599a7e63c?q=80&w=800&auto=format&fit=crop&sig=${encodeURIComponent(title)}`;
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

    return {
        days: data.days.map((r: any, i: number) => ({
            ...r,
            id: r.id || `meal-${i}-${Math.random().toString(36).slice(2, 5)}`,
            image_url: r.image_url,
            time: r.estimated_time_minutes || 30,
            calories: r.calories_per_portion || 500
        })),
        zero_waste_report: data.zero_waste_report || 'Menu uit de bank.',
        generatedAt: new Date().toISOString()
    };
};

// 3. RECEPT DETAILS
export const generateFullRecipe = async (meal: any, prefs: any) => {
    if (meal.steps && meal.steps.length > 0 && meal.ingredients) return meal;

    const res = await fetch(`${API_URL}/get-recipe-details`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meal_id: meal.id })
    });
    const data = await res.json();
    return { ...meal, ...data.details };
};

// 4. VERVANGEN, FRIDGE, SHOPPING
export const replaceMeal = async (currentMeal: any, prefs: any, dayIndex: number, favoriteTitles: string[] = []) => {
    const res = await fetch(`${API_URL}/replace-meal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            old_meal_title: currentMeal.title,
            day_index: dayIndex,
            mode: prefs.dayModes[dayIndex] || 'premium',
            prefs: { ...prefs, user_id: prefs.user_id || 'demo-user', favorite_titles: favoriteTitles }
        })
    });
    const data = await res.json();
    return { ...data.meal, id: `replaced-${Date.now()}` };
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
        body: JSON.stringify({ meal_titles: meals.map(m => m.title), language: prefs.language })
    });
    const data = await res.json();
    return data.items.map((it: any, i: number) => ({ ...it, id: `item-${i}`, checked: false }));
};

// 5. DB FETCH
async function fetchPlanFromDB(planId: string) {
    const { data: recipes } = await supabase.from('recipes').select('*').eq('weekly_plan_id', planId).order('day_of_week', { ascending: true });
    const { data: plan } = await supabase.from('weekly_plans').select('zero_waste_report').eq('id', planId).single();
    if (!recipes) return null;
    return {
        days: recipes.map((r) => ({
            ...r,
            image_url: r.image_url,
            time: r.estimated_time_minutes || 30,
            calories: r.calories_per_portion || 500
        })),
        zero_waste_report: plan?.zero_waste_report || 'Menu uit de bank.',
        generatedAt: new Date().toISOString()
    };
}

export const generateDayPlan = async () => null;