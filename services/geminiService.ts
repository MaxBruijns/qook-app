
import { GoogleGenAI, Type } from "@google/genai";
import { UserPreferences, WeeklyPlan, Meal, ShoppingItem, FridgeScanResult } from "../types";

const MODEL_PRO = 'gemini-3-pro-preview';
const MODEL_FAST = 'gemini-3-flash-preview';
const MODEL_IMAGE = 'gemini-2.5-flash-image';

let generationQueue = Promise.resolve();

export const generateMealImage = async (title: string, aiPrompt: string): Promise<string> => {
  const cacheKey = `qook_img_${btoa(encodeURIComponent(title + aiPrompt)).slice(0, 32)}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) return cached;

  return new Promise((resolve) => {
    generationQueue = generationQueue.then(async () => {
      try {
        await new Promise(r => setTimeout(r, 1200));
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
          model: MODEL_IMAGE,
          contents: { 
            parts: [{ text: `A professional food photography shot of ${title}. ${aiPrompt}. 4k, cinematic lighting.` }] 
          },
          config: { imageConfig: { aspectRatio: "1:1" } }
        });

        const parts = response.candidates?.[0]?.content?.parts || [];
        let dataUrl = '';
        for (const part of parts) {
          if (part.inlineData?.data) {
            dataUrl = `data:image/png;base64,${part.inlineData.data}`;
            break;
          }
        }

        if (dataUrl) {
          try { 
            localStorage.setItem(cacheKey, dataUrl);
          } catch (e) {
            console.warn("Storage quota hit, clearing some image cache");
            Object.keys(localStorage).forEach(key => {
              if (key.startsWith('qook_img_')) localStorage.removeItem(key);
            });
            try { localStorage.setItem(cacheKey, dataUrl); } catch (e2) {}
          }
          resolve(dataUrl);
        } else {
          throw new Error("No image data");
        }
      } catch (error) {
        resolve(`https://images.unsplash.com/photo-1546069901-ba9599a7e63c?q=80&w=800&auto=format&fit=crop&sig=${encodeURIComponent(title)}`);
      }
    });
  });
};

const WINE_PAIRING_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    type: { type: Type.STRING },
    description: { type: Type.STRING }
  },
  required: ['type', 'description']
};

const MEAL_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    short_description: { type: Type.STRING },
    ai_image_prompt: { type: Type.STRING },
    estimated_time_minutes: { type: Type.INTEGER },
    difficulty: { type: Type.STRING },
    calories_per_portion: { type: Type.INTEGER },
    chefs_hack: { type: Type.STRING },
    wine_pairing: WINE_PAIRING_SCHEMA,
    plating_tips: { type: Type.STRING, description: "Professional plating tips specifically for culinary mode." },
    mode: { type: Type.STRING, description: "'premium' of 'culinary'" }
  },
  required: ['title', 'short_description', 'ai_image_prompt', 'estimated_time_minutes', 'difficulty', 'calories_per_portion', 'mode']
};

export const generateWeeklyPlan = async (prefs: UserPreferences, favoriteTitles: string[] = []): Promise<WeeklyPlan> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const modesDescription = Object.entries(prefs.dayModes)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([day, mode]) => `Day ${day}: ${mode}`)
    .join(', ');

  const history = prefs.generationHistory?.join(', ') || 'Geen';
  const favoritesStr = favoriteTitles.join(', ') || 'Nog geen favorieten';

  const systemInstruction = `
    Je bent de culinaire motor van Qook (KOOQ). 
    Je genereert een 7-daags menu (0-6).
    
    AGENDA (STRIKT VOLGEN):
    ${modesDescription}
    
    STRIKTE VARIATIE REGELS:
    - VERMIJD de volgende gerechten (EXCLUDE): ${history}. Dit zijn gerechten die de gebruiker al gepland heeft. Wees creatief en kom met iets nieuws.
    - INSPIRE: De gebruiker houdt van gerechten zoals: ${favoritesStr}. Gebruik deze lijst om de smaakvoorkeuren te begrijpen (bijv. voorkeur voor Italiaans, pittig, of lichte salades) en genereer NIEUWE gerechten in diezelfde sfeer.
    - NOOIT een gerecht letterlijk herhalen uit de geschiedenis.

    ZERO-WASTE INSTRUCTIE:
    - Zero-Waste Level: ${prefs.zeroWasteLevel}% (0 = maximale variatie, 100 = maximale efficiency/hergebruik ingrediënten).
    - Bij een hoog level: Gebruik grote ingrediënten (bloemkool, zak spinazie, hele kip) in meerdere gerechten verspreid over de week om verspilling te voorkomen.
    - Schrijf een kort 'zero_waste_report' waarin je uitlegt hoe je deze week verspilling voorkomt.
    
    MODUS RICHTLIJNEN:
    - 'premium': Toegankelijke, gezonde en smaakvolle doordeweekse gerechten. focus op eenvoud en dagelijks gemak.
    - 'culinary': LUXE Gastronomie. Focus op presentatie, verfijnde smaken en techniek.
    
    VOORWAARDEN:
    - Dieet: ${prefs.diet.join(', ')}
    - Huishouden: ${prefs.adultsCount} volw, ${prefs.childrenCount} kind.
    - Budget: ${prefs.budget}.
    - VARIATIE: Zorg dat elk gerecht UNIEK is in ingrediënten, tenzij het Zero-Waste level hoog is.
  `;

  const response = await ai.models.generateContent({
    model: MODEL_FAST,
    contents: "Genereer het weekmenu en het zero-waste rapport.",
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          days: { type: Type.ARRAY, items: MEAL_SCHEMA },
          zero_waste_report: { type: Type.STRING, description: "Korte uitleg over hoe verspilling deze week wordt voorkomen." }
        },
        required: ['days', 'zero_waste_report']
      }
    }
  });

  const data = JSON.parse(response.text || '{}');
  const servings = prefs.adultsCount + prefs.childrenCount;

  return {
    days: (data.days || []).map((m: any, i: number) => ({
      ...m,
      servings,
      id: `meal-${i}-${Math.random().toString(36).slice(2, 7)}`,
      mode: (prefs.dayModes[i] || 'premium') 
    })),
    zero_waste_report: data.zero_waste_report,
    generatedAt: new Date().toISOString()
  };
};

export const replaceMeal = async (currentMeal: Meal, prefs: UserPreferences, dayIndex: number, favoriteTitles: string[] = []): Promise<Meal> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const targetMode = prefs.dayModes[dayIndex] || 'premium';
    const maxTime = dayIndex >= 5 ? prefs.weekendCookingTime : prefs.cookingTime;
    const history = prefs.generationHistory?.join(', ') || 'Geen';
    const favoritesStr = favoriteTitles.join(', ') || 'Nog geen favorieten';
    
    const systemInstruction = `
      Je vervangt een specifiek gerecht in een weekmenu.
      STRIKTE RICHTLIJNEN VOOR MODE "${targetMode}".
      VARIATIE: Het nieuwe gerecht MOET wezenlijk anders zijn dan "${currentMeal.title}" en mag NIET voorkomen in de geschiedenis: ${history}.
      SMAAKVOORKEUR: De gebruiker vindt dit lekker: ${favoritesStr}. Gebruik dit als inspiratie voor de stijl van het nieuwe gerecht.
      VOORKEUREN: Dieet: ${prefs.diet.join(', ')}. Tijd: Maximaal ${maxTime} min. Budget: ${prefs.budget}.
    `;

    const response = await ai.models.generateContent({
        model: MODEL_FAST,
        contents: `Vervang "${currentMeal.title}" door een nieuw gerecht in de modus ${targetMode}.`,
        config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema: MEAL_SCHEMA
        }
    });
    
    const data = JSON.parse(response.text || '{}');
    return { 
      ...data, 
      servings: prefs.adultsCount + prefs.childrenCount, 
      id: `replaced-${Date.now()}`, 
      mode: targetMode 
    };
};

export const generateFullRecipe = async (meal: Meal, prefs: UserPreferences): Promise<Meal> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const servings = prefs.adultsCount + prefs.childrenCount;

  const response = await ai.models.generateContent({
    model: MODEL_PRO,
    contents: `Volledig recept voor: ${meal.title}. Modus: ${meal.mode}.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          ingredients: { 
            type: Type.ARRAY, 
            items: { 
              type: Type.OBJECT, 
              properties: { 
                name: { type: Type.STRING }, 
                amount: { type: Type.NUMBER }, 
                unit: { type: Type.STRING } 
              }, 
              required: ['name', 'amount', 'unit'] 
            } 
          },
          steps: { 
            type: Type.ARRAY, 
            items: { 
              type: Type.OBJECT, 
              properties: { 
                step_index: { type: Type.INTEGER }, 
                user_text: { type: Type.STRING }, 
                needs_timer: { type: Type.BOOLEAN },
                timer_label: { type: Type.STRING, description: "Wat wordt er getimed? Bijv. 'Pasta koken' of 'Biefstuk rusten'." },
                estimated_duration_seconds: { type: Type.INTEGER, description: "Seconden voor de timer." }
              }, 
              required: ['step_index', 'user_text', 'needs_timer'] 
            } 
          },
          supplies: { type: Type.ARRAY, items: { type: Type.STRING } },
          nutrition: { type: Type.OBJECT, properties: { calories: { type: Type.NUMBER } }, required: ['calories'] },
          plating_tips: { type: Type.STRING },
          wine_pairing: WINE_PAIRING_SCHEMA
        },
        required: ['ingredients', 'steps', 'supplies', 'nutrition']
      },
      systemInstruction: `
        STRIKTE TIMER REGELS:
        1. NOOIT een timer voor de oven (ovens hebben eigen timers).
        2. NOOIT een timer voor voorbereiding (snijden, wassen, afmeten).
        3. NOOIT een timer voor 'voorverwarmen'.
        4. ALLEEN een timer voor actieve kookprocessen op het fornuis (koken, sudderen, bakken) of passieve processen (rusten, marineren) waar de exacte tijd essentieel is voor de kwaliteit.
        5. De 'timer_label' moet kort en bondig beschrijven wat er gebeurt.
      `
    }
  });
  const data = JSON.parse(response.text || '{}');
  return { ...meal, servings, ...data };
};

export const generateShoppingList = async (meals: Meal[], prefs: UserPreferences): Promise<ShoppingItem[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: MODEL_FAST,
    contents: `Shopping list for: ${meals.map(m => m.title).join(', ')}.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: { 
          type: Type.OBJECT, 
          properties: { 
            name: { type: Type.STRING }, 
            amount: { type: Type.NUMBER }, 
            unit: { type: Type.STRING }, 
            category: { type: Type.STRING } 
          }, 
          required: ['name', 'amount', 'unit', 'category'] 
        }
      }
    }
  });
  return JSON.parse(response.text || '[]').map((it: any, i: number) => ({ ...it, id: `it-${i}`, checked: false }));
};

export const analyzeFridgeImage = async (base64: string, prefs: UserPreferences): Promise<FridgeScanResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: MODEL_FAST,
    contents: { 
      parts: [
        { inlineData: { mimeType: 'image/jpeg', data: base64 } }, 
        { text: "Suggest 3 meals." }
      ] 
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          recognizedItems: { type: Type.ARRAY, items: { type: Type.STRING } },
          suggestions: { type: Type.ARRAY, items: MEAL_SCHEMA }
        },
        required: ['recognizedItems', 'suggestions']
      }
    }
  });
  const data = JSON.parse(response.text || '{}');
  return { 
    recognizedItems: data.recognizedItems || [], 
    suggestions: (data.suggestions || []).map((m: any, i: number) => ({ 
      ...m, 
      servings: prefs.adultsCount + prefs.childrenCount, 
      id: `scan-${i}`, 
      mode: 'magic' 
    })) 
  };
};
