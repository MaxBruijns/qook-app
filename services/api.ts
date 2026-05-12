
Copy

import { supabase } from '../utils/supabase';
 
const API_URL = 'https://qook-backend.onrender.com';
 
// --- WEEKPLAN GENEREREN ---
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
 
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Server error: ${res.status}`);
    }
 
    const data = await res.json();
 
    return {
        days: data.days.map((r: any) => ({
            ...r,
            id: r.id || `day_${r.day_number}_${Date.now()}`,
            time: r.estimated_time_minutes || 30,
            calories: r.calories_per_portion || 500,
            image_url: r.image_url || null,
            generated_image_url: r.image_url || null,
        })),
        zero_waste_report: data.zero_waste_report,
        generatedAt: new Date().toISOString()
    };
};
 
// --- VOLLEDIGE RECEPT DETAILS ---
export const generateFullRecipe = async (meal: any) => {
    // Gebruik data uit de bank als die er al is
    if (meal.steps && meal.steps.length > 0) return meal;
 
    const res = await fetch(`${API_URL}/get-recipe-details`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meal_id: meal.id })
    });
 
    if (!res.ok) return meal;
 
    const data = await res.json();
    return { ...meal, ...data.details };
};
 
// --- MAALTIJDFOTO OPHALEN ---
// Haalt de bestaande URL op uit Supabase, of vraagt backend om te genereren
export const generateMealImage = async (
    mealId: string,
    title: string,
    prompt: string,
    existingUrl?: string
): Promise<string> => {
    // Als er al een geldige URL is (niet pollinations), gebruik die
    if (existingUrl && existingUrl.startsWith('http') && !existingUrl.includes('pollinations')) {
        return existingUrl;
    }
 
    // Vraag backend om afbeelding te genereren en opslaan
    try {
        const res = await fetch(`${API_URL}/generate-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recipe_id: mealId,
                title: title,
                prompt: prompt
            })
        });
 
        if (res.ok) {
            const data = await res.json();
            return data.url;
        }
    } catch (e) {
        console.warn('Afbeelding ophalen mislukt, fallback gebruiken:', e);
    }
 
    // Fallback: vaste food foto
    const fallbacks = [
        'https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?w=800',
        'https://images.pexels.com/photos/1279330/pexels-photo-1279330.jpeg?w=800',
        'https://images.pexels.com/photos/699953/pexels-photo-699953.jpeg?w=800',
        'https://images.pexels.com/photos/2338407/pexels-photo-2338407.jpeg?w=800',
        'https://images.pexels.com/photos/1640772/pexels-photo-1640772.jpeg?w=800',
    ];
    return fallbacks[Math.abs(title.charCodeAt(0)) % fallbacks.length];
};
 
// --- KOELKAST SCAN ---
export const analyzeFridgeImage = async (base64: string, prefs: any) => {
    const res = await fetch(`${API_URL}/analyze-fridge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            image_data: base64,
            language: prefs.language || 'nl-NL'
        })
    });
 
    if (!res.ok) {
        return { recognizedItems: [], suggestions: [] };
    }
 
    return await res.json();
};
 
// --- BOODSCHAPPENLIJST ---
export const generateShoppingList = async (meals: any[], prefs?: any) => {
    const res = await fetch(`${API_URL}/generate-shopping-list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            meals: meals,
            adultsCount: prefs?.adultsCount || 2,
            childrenCount: prefs?.childrenCount || 0,
            language: prefs?.language || 'nl-NL'
        })
    });
 
    if (!res.ok) return [];
 
    const data = await res.json();
    return data.items || [];
};
 
// --- MAALTIJD VERVANGEN ---
export const replaceMeal = async (
    oldMeal: any,
    prefs: any,
    dayIndex: number,
    favoriteTitles: string[] = []
) => {
    const res = await fetch(`${API_URL}/replace-meal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            meal_id: oldMeal.id,
            meal_title: oldMeal.title,
            day_index: dayIndex,
            user_id: prefs.user_id || 'demo-user',
            diet: prefs.diet || [],
            budget: prefs.budget || 'Normaal',
            language: prefs.language || 'nl-NL',
            exclude_titles: prefs.generationHistory || [],
            favorite_titles: favoriteTitles,
            mode: oldMeal.mode || 'premium'
        })
    });
 
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Vervangen mislukt: ${res.status}`);
    }
 
    const data = await res.json();
    return {
        ...data.meal,
        id: data.meal.id || `replaced_${Date.now()}`,
        time: data.meal.estimated_time_minutes || 30,
        calories: data.meal.calories_per_portion || 500,
        image_url: data.meal.image_url || null,
        generated_image_url: data.meal.image_url || null,
    };
};