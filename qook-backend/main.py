import os
import json
import re
import traceback
from typing import List, Dict, Optional, Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai
from google.generativeai.types import HarmCategory, HarmBlockThreshold
from supabase import create_client, Client
from dotenv import load_dotenv
load_dotenv()

app = FastAPI()

# --- KEYS ---
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
GOOGLE_API_KEY = os.getenv("GEMINI_API_KEY") # Zorg dat deze naam matcht met je .env.local

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
genai.configure(api_key=GOOGLE_API_KEY)

# Config
generation_config = { "temperature": 0.7, "max_output_tokens": 8192, "response_mime_type": "application/json" }
safety_settings = { HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE }
model = genai.GenerativeModel(model_name="gemini-2.0-flash", generation_config=generation_config, safety_settings=safety_settings)

app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

# --- MODELS ---
class UserPrefsInput(BaseModel):
    user_id: str
    adultsCount: int = 2
    childrenCount: int = 0
    diet: List[str] = []
    budget: str = 'Normaal'
    dayModes: Dict[str, str] = {} # {"0": "premium", "5": "culinary"}
    zeroWasteLevel: int = 50
    language: str = 'nl-NL'
    generationHistory: List[str] = []
    
class MealDetailRequest(BaseModel):
    meal_id: str
    meal_title: str
    mode: str = 'premium'
    adultsCount: int = 2
    childrenCount: int = 0
    language: str = 'nl-NL'

class ReplaceMealRequest(BaseModel):
    old_meal_title: str
    day_index: int
    mode: str
    prefs: UserPrefsInput

class ShoppingRequest(BaseModel):
    meal_titles: List[str]
    language: str

class FridgeRequest(BaseModel):
    image_data: str # Base64
    language: str

# --- HELPERS ---
def clean_json(text):
    text = re.sub(r'```json\s*|\s*```', '', text).strip()
    if not text.endswith("]") and not text.endswith("}"):
        last_brace = text.rfind("}")
        if last_brace != -1: text = text[:last_brace+1] + "]"
    return text

# --- ENDPOINTS ---

@app.post("/check-subscription")
async def check_subscription(data: dict):
    return {"status": "active", "tier": "trial"}

@app.post("/chat")
async def chat_assistant(data: dict):
    try:
        chat_model = genai.GenerativeModel("gemini-2.0-flash") 
        response = chat_model.generate_content(f"Context: {data.get('context')}. User: {data.get('message')}. Answer briefly.")
        return {"reply": response.text}
    except: return {"reply": "..."}

# 1. WEEKPLAN (Jouw Demo Logica)
@app.post("/generate-weekly-plan")
async def generate_weekly_plan(prefs: UserPrefsInput):
    print(f"--- GENEREREN VOOR {prefs.user_id} ---")
    
    modes_desc = ", ".join([f"Day {d}: {m}" for d, m in prefs.dayModes.items()])
    
    prompt = f"""
    ROLE: Chef Qook. TASK: Generate 7-DAY MENU (Day 0-6).
    LANG: {prefs.language}.
    
    AGENDA: {modes_desc} (Default: premium).
    ZERO-WASTE: {prefs.zeroWasteLevel}%. Include 'zero_waste_report'.
    PREFS: Diet: {prefs.diet}, Household: {prefs.adultsCount}+{prefs.childrenCount}, Budget: {prefs.budget}.

    OUTPUT JSON:
    {{
        "zero_waste_report": "...",
        "days": [
            {{
                "day_number": 0,
                "title": "...",
                "short_description": "...",
                "ai_image_prompt": "english keywords...",
                "estimated_time_minutes": 30,
                "difficulty": "Medium",
                "calories_per_portion": 600,
                "mode": "premium"
            }}
            ... (7 days)
        ]
    }}
    """
    
    try:
        response = model.generate_content(prompt)
        data = json.loads(clean_json(response.text))
        
        # Opslaan
        plan = supabase.table('weekly_plans').insert({
            "user_id": prefs.user_id, "week_number": 1, "year": 2025,
            "zero_waste_report": data.get('zero_waste_report', '')
        }).execute()
        plan_id = plan.data[0]['id']
        
        for d in data.get('days', []):
            supabase.table('recipes').insert({
                'weekly_plan_id': plan_id,
                'day_of_week': str(d.get('day_number')),
                'title': d.get('title'),
                'short_description': d.get('short_description'),
                'image_keywords': d.get('ai_image_prompt'),
                'estimated_time_minutes': d.get('estimated_time_minutes'),
                'difficulty': d.get('difficulty'),
                'calories_per_portion': d.get('calories_per_portion'),
                'mode': d.get('mode')
            }).execute()

        return {"status": "success", "plan_id": plan_id}
    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

# 2. DETAILS (Lazy Load)
@app.post("/get-recipe-details")
async def get_recipe_details(req: MealDetailRequest):
    print(f"--- DETAIL: {req.meal_title} ---")
    prompt = f"""
    RECIPE: {req.meal_title}. MODE: {req.mode}. LANG: {req.language}.
    JSON: {{ "ingredients": [{{ "name": "...", "amount": 1, "unit": "kg" }}], "steps": [{{ "step_index": 1, "user_text": "...", "needs_timer": false }}], "supplies": [], "plating_tips": "...", "chefs_hack": "...", "wine_pairing": {{ "type": "...", "description": "..." }} }}
    """
    try:
        response = model.generate_content(prompt)
        details = json.loads(clean_json(response.text))
        supabase.table('recipes').update(details).eq('id', req.meal_id).execute()
        return {"status": "success", "details": details}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 3. VERVANG GERECHT
@app.post("/replace-meal")
async def replace_meal(req: ReplaceMealRequest):
    print(f"--- REPLACE: {req.old_meal_title} ---")
    prompt = f"""
    TASK: Suggest NEW meal to replace "{req.old_meal_title}".
    MODE: {req.mode}. LANG: {req.prefs.language}. DIET: {req.prefs.diet}.
    OUTPUT JSON (Same format as weekly plan day object): {{ "title": "...", ... }}
    """
    try:
        response = model.generate_content(prompt)
        new_meal = json.loads(clean_json(response.text))
        return {"status": "success", "meal": new_meal}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 4. KOELKAST SCAN
@app.post("/analyze-fridge")
async def analyze_fridge(req: FridgeRequest):
    print("--- FRIDGE SCAN ---")
    vision_model = genai.GenerativeModel('gemini-1.5-flash') # Vision model
    prompt = f"Analyze image. List ingredients. Suggest 3 meals (JSON). LANG: {req.language}. OUTPUT: {{ 'recognizedItems': [], 'suggestions': [ {{title...}} ] }}"
    # (Image handling vereist iets meer code voor base64 decoding, voor nu mocken we de response om 500 te voorkomen)
    # In productie: decodeer base64 -> parts -> generate
    return {
        "recognizedItems": ["Tomaat", "Ei", "Kaas"],
        "suggestions": [
            {"title": "Omelet", "short_description": "Snel en lekker", "calories_per_portion": 300, "estimated_time_minutes": 10, "difficulty": "Easy", "mode": "magic"},
            {"title": "Salade", "short_description": "Fris", "calories_per_portion": 200, "estimated_time_minutes": 5, "difficulty": "Easy", "mode": "magic"}
        ]
    }

# 5. SHOPPING
@app.post("/generate-shopping-list")
async def generate_shopping_list(req: ShoppingRequest):
    prompt = f"Shopping list for: {', '.join(req.meal_titles)}. Lang: {req.language}. JSON List: [{{name, amount, unit, category}}]"
    try:
        response = model.generate_content(prompt)
        items = json.loads(clean_json(response.text))
        return {"items": items}
    except: return {"items": []}