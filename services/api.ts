import { supabase } from '../utils/supabase'; 
import { GoogleGenAI } from "@google/genai";

const BACKEND_URL = 'https://qook-backend.onrender.com';
// We gebruiken het model uit je demo
const MODEL_IMAGE = 'gemini-2.0-flash'; 

let generationQueue = Promise.resolve();

// 1. DE FOTO MOTOR (GEBASEERD OP JE DEMO LOGICA)
export const generateMealImage = async (mealId: string, title: string, aiPrompt: string, existingUrl?: string): Promise<string> => {
    // A. Gebruik database URL als die er al is (GRATIS)
    if (existingUrl && existingUrl.startsWith('data:image')) return existingUrl;

    // B. Gebruik LocalStorage Cache (DEMO LOGICA)
    const cacheKey = `qook_img_${mealId}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) return cached;

    return new Promise((resolve) => {
        generationQueue = generationQueue.then(async () => {
            try {
                const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
                if (!apiKey) throw new Error("Key missing");

                // CORRECTE BROWSER INITIALISATIE
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
                    // C. SMART SAVE: Sla op in DB (Zodat het voor ALTIJD gratis is na nu)
                    if (mealId && !mealId.toString().startsWith('meal-')) {
                        fetch(`${API_URL}/save-meal-image`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ meal_id: mealId, image_data: dataUrl })
                        });
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

// 2. WEEKPLAN GENEREREN
export const generateWeeklyPlan = async (prefs: any, favoriteTitles: string[] = []) => {
    const res = await fetch(`${API_URL}/generate-weekly-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...prefs, user_id: prefs.user_id || 'demo-user', favorite_titles: favoriteTitles })
    });
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

// 3. RECEPT DETAILS
export const generateFullRecipe = async (meal: any, prefs: any) => {
    if (meal.steps && meal.steps.length > 0) return meal;
    const res = await fetch(`${API_URL}/get-recipe-details`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            meal_id: meal.id, meal_title: meal.title, mode: meal.mode,
            adultsCount: prefs.adultsCount, childrenCount: prefs.childrenCount, language: prefs.language
        })
    });
    const data = await res.json();
    return { ...meal, ...data.details };
};

// ... replaceMeal, analyzeFridge, generateShoppingList blijven hetzelfde (roepen BACKEND aan)