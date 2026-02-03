import { supabase } from '../utils/supabase'; 

const API_URL = 'https://qook-backend.onrender.com';

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
    const data = await res.json();
    return {
        days: data.days.map((r: any) => ({
            ...r,
            time: r.estimated_time_minutes || 30,
            calories: r.calories_per_portion || 500
        })),
        zero_waste_report: data.zero_waste_report,
        generatedAt: new Date().toISOString()
    };
};

export const generateFullRecipe = async (meal: any) => {
    // Gebruik data uit de bank als die er al is
    if (meal.steps && meal.steps.length > 0) return meal;
    const res = await fetch(`${API_URL}/get-recipe-details`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meal_id: meal.id })
    });
    const data = await res.json();
    return { ...meal, ...data.details };
};

export const generateMealImage = async (mealId: string, title: string, prompt: string, existingUrl?: string) => {
    return existingUrl || `https://images.unsplash.com/photo-1546069901-ba9599a7e63c?q=80&w=800&auto=format&fit=crop`;
};

export const analyzeFridgeImage = async (base64: string, prefs: any) => {
    const res = await fetch(`${API_URL}/analyze-fridge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_data: base64, language: prefs.language })
    });
    return await res.json();
};

export const generateShoppingList = async (meals: any[]) => {
    // Boodschappenlijst logica via backend
    return []; 
};

export const replaceMeal = async () => null;