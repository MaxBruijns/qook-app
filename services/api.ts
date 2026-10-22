// Alle AI-aanroepen lopen via de KOOQ-backend: dezelfde Cloudflare Worker
// die ook deze website serveert (/api/...). Er staat hier bewust GEEN
// API-sleutel: die staat alleen op de server.
const API_URL = '/api';

const post = async (path: string, body: any) => {
    const res = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Serverfout ${res.status}`);
    }
    return res.json();
};

const normalizeMeal = (m: any) => ({
    ...m,
    time: m.estimated_time_minutes || 30,
    calories: m.calories_per_portion || 500,
    image_url: m.image_url || null,
});

// --- WEEKPLAN ---
export const generateWeeklyPlan = async (prefs: any, favoriteTitles: string[] = []) => {
    const data = await post('/generate-weekly-plan', {
        ...prefs,
        user_id: prefs.user_id || 'demo-user',
        favorite_titles: favoriteTitles,
    });
    return {
        days: data.days.map(normalizeMeal),
        zero_waste_report: data.zero_waste_report,
        generatedAt: new Date().toISOString(),
    };
};

// --- RECEPTDETAILS ---
export const generateFullRecipe = async (meal: any, _prefs?: any) => {
    if (meal.steps && meal.steps.length > 0) return meal;
    try {
        const data = await post('/get-recipe-details', { meal_id: meal.id });
        return { ...meal, ...data.details };
    } catch {
        return meal;
    }
};

// --- MAALTIJDFOTO ---
// Eerst de opgeslagen foto; anders vraagt de backend er één keer één aan.
const FALLBACKS = [
    'https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&w=800',
    'https://images.pexels.com/photos/1279330/pexels-photo-1279330.jpeg?auto=compress&w=800',
    'https://images.pexels.com/photos/699953/pexels-photo-699953.jpeg?auto=compress&w=800',
    'https://images.pexels.com/photos/2338407/pexels-photo-2338407.jpeg?auto=compress&w=800',
    'https://images.pexels.com/photos/1640772/pexels-photo-1640772.jpeg?auto=compress&w=800',
];

export const generateMealImage = async (
    mealId: string,
    title: string,
    _prompt?: string,
    existingUrl?: string
): Promise<string> => {
    if (existingUrl && (existingUrl.startsWith('/api/images/') ||
        (existingUrl.startsWith('http') && !existingUrl.includes('pollinations')))) {
        return existingUrl;
    }
    if (mealId && !String(mealId).startsWith('tmp_')) {
        try {
            const data = await post('/generate-image', { recipe_id: mealId });
            if (data.url) return data.url;
        } catch (e) {
            console.warn('Foto ophalen mislukt, standaardfoto gebruikt:', e);
        }
    }
    return FALLBACKS[(title || '').length % FALLBACKS.length];
};

// --- KOELKASTSCAN ---
// Telefoonfoto's zijn vaak 3-5 MB; verkleinen tot max 1024px houdt de scan snel.
const shrinkImage = (base64: string, maxSize = 1024): Promise<string> =>
    new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext('2d');
            if (!ctx) return resolve(base64);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
        };
        img.onerror = () => resolve(base64);
        img.src = `data:image/jpeg;base64,${base64}`;
    });

export const analyzeFridgeImage = async (base64: string, prefs: any) => {
    try {
        const data = await post('/analyze-fridge', {
            image_data: await shrinkImage(base64),
            language: prefs?.language || 'nl-NL',
            diet: prefs?.diet || [],
        });
        return { ...data, suggestions: (data.suggestions || []).map(normalizeMeal) };
    } catch (e) {
        console.error('Koelkastscan mislukt:', e);
        return { recognizedItems: [], suggestions: [] };
    }
};

// --- BOODSCHAPPENLIJST ---
export const generateShoppingList = async (meals: any[], prefs?: any) => {
    try {
        const data = await post('/generate-shopping-list', {
            meals: meals.map(m => ({ title: m.title, ingredients: m.ingredients || [] })),
            adultsCount: prefs?.adultsCount || 2,
            childrenCount: prefs?.childrenCount || 0,
            language: prefs?.language || 'nl-NL',
        });
        return data.items || [];
    } catch (e) {
        console.error('Boodschappenlijst mislukt:', e);
        return [];
    }
};

// --- MAALTIJD VERVANGEN ---
export const replaceMeal = async (oldMeal: any, prefs: any, dayIndex: number, favoriteTitles: string[] = []) => {
    const data = await post('/replace-meal', {
        meal_id: oldMeal.id,
        meal_title: oldMeal.title,
        day_index: dayIndex,
        user_id: prefs?.user_id || 'demo-user',
        diet: prefs?.diet || [],
        budget: prefs?.budget || 'Normaal',
        language: prefs?.language || 'nl-NL',
        exclude_titles: prefs?.generationHistory || [],
        favorite_titles: favoriteTitles,
        mode: oldMeal.mode || 'premium',
    });
    return normalizeMeal(data.meal);
};

// --- CHAT MET DE SOUS-CHEF ---
export const sendChatMessage = async (params: {
    messages: { sender: string; text: string }[];
    message: string;
    userStatus: string;
    currentView: string;
    language: string;
    diet: string[];
}): Promise<{ reply: string; diet: string[] | null }> => {
    const data = await post('/chat', {
        messages: params.messages,
        message: params.message,
        user_status: params.userStatus,
        current_view: params.currentView,
        language: params.language,
        diet: params.diet,
    });
    return { reply: data.reply || '', diet: data.diet || null };
};
