import { supabase } from '../utils/supabase'; 
import { GoogleGenAI } from "@google/genai";

const API_URL = 'https://qook-backend.onrender.com';
const MODEL_IMAGE = 'gemini-2.0-flash'; 

let generationQueue = Promise.resolve();

// 1. AFBEELDING GENEREREN (GEMINI) + SMART SAVE
export const generateMealImage = async (mealId: string, title: string, aiPrompt: string, existingUrl?: string): Promise<string> => {
    if (existingUrl && existingUrl.startsWith('data:image')) return existingUrl;

    const cacheKey = `qook_img_${mealId}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) return cached;

    return new Promise((resolve) => {
        generationQueue = generationQueue.then(async () => {
            try {
                const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
                if (!apiKey) throw new Error("Key missing");

                const genAI = new GoogleGenAI(apiKey);
                const model = genAI.getGenerativeModel({ model: MODEL_IMAGE });
                
                const prompt = `A professional food photography shot of ${title}. ${aiPrompt}. 4k, cinematic lighting, high quality plated dish.`;
                
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
                    if (mealId && !mealId.toString().startsWith('meal-')) {
                        fetch(`${API_URL}/save-meal-image`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ meal_id: mealId, image_data: dataUrl })
                        }).catch(e => console.warn("Opslaan image mislukt", e));
                    }
                    localStorage.setItem(cacheKey, dataUrl);
                    resolve(dataUrl);
                } else {
                    throw new Error("No data");
                }
            } catch (error) {
                console.error("Image Gen Error:", error);
                resolve(`https://images.unsplash.com/photo-1546069901-ba9599a7e63c?q=80&w=800&auto=format&fit=crop`);
            }
        });
    });
};

// 2. WEEKPLAN GENEREREN (DATABASE FIRST)
export const generateWeeklyPlan = async (prefs: any, favoriteTitles: string[] = []) => {
    const res = await fetch(`${API_URL}/generate-weekly-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            ...prefs, 
            user_id: prefs.user_id || 'demo-user', 
            favorite_titles: favoriteTitles 
        })
    });
    
    if (!res.ok) throw new Error("Backend Error");
    const data = await res.json();

    return {
        days: data.days.map((r: any, i: number) => ({
            ...r,
            id: r.id || `meal-${i}-${Math.random().toString(36).slice(2, 5)}`,
            time: r.estimated_time_minutes || 30,
            calories: r.calories_per_portion || 500
        })),
        zero_waste_report: data.zero_waste_report,
        generatedAt: new Date().toISOString()
    };
};

// 3. VOLLEDIG RECEPT OPHALEN
export const generateFullRecipe = async (meal: any, prefs: any) => {
    if (meal.steps && meal.steps.length > 0) return meal;
    const res = await fetch(`${API_URL}/get-recipe-details`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            meal_id: meal.id, meal_title: meal.title, mode: meal.mode || 'premium',
            adultsCount: prefs.adultsCount, childrenCount: prefs.childrenCount, language: prefs.language
        })
    });
    const data = await res.json();
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
            prefs: { ...prefs, user_id: prefs.user_id || 'demo' }
        })
    });
    const data = await res.json();
    return { ...data.meal, id: currentMeal.id };
};

// 5. KOELKAST SCAN (DEZE ONTBRAAK!)
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

export const generateDayPlan = async () => null;