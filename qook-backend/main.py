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
    print(f"--- START GENEREREN VOOR {prefs.user_id} ---")
    
    # 1. GESCHIEDENIS OPHALEN (3 MAANDEN REGEL)
    exclude_titles = []
    if prefs.user_id != "demo-user":
        drie_maanden_geleden = (datetime.now() - timedelta(days=90)).isoformat()
        # We halen de plannen van de laatste 90 dagen op voor deze gebruiker
        history = supabase.table('weekly_plans').select('id, created_at').eq('user_id', prefs.user_id).gt('created_at', drie_maanden_geleden).execute()
        if history.data:
            plan_ids = [h['id'] for h in history.data]
            recipes_history = supabase.table('recipes').select('title').in_('weekly_plan_id', plan_ids).execute()
            exclude_titles = [r['title'] for r in recipes_history.data]

    # 2. ZOEKEN IN DE RECEPTENBANK (DATABASE FIRST)
    try:
        # Zoek gerechten die matchen met de gevraagde 'mode' (bijv. premium)
        query = supabase.table('recipes').select('*').eq('mode', prefs.dayModes.get("0", "premium"))
        
        # Filter op dieet als dat is opgegeven
        if prefs.diet and "Geen" not in prefs.diet:
            query = query.contains('diet_tags', prefs.diet)
            
        db_matches = query.execute()
        
        # Filter resultaten op de 3-maanden regel
        available_recipes = [r for r in db_matches.data if r['title'] not in exclude_titles]

        # Hebben we genoeg (7 stuks) in onze eigen bank?
        if len(available_recipes) >= 7:
            print("--- BANK MATCH! AI NIET NODIG ---")
            selected = random.sample(available_recipes, 7)
            return {
                "status": "success",
                "plan_id": "reused-from-bank",
                "days": selected,
                "zero_waste_report": "Geselecteerd uit uw persoonlijke receptenbank."
            }
    except Exception as e:
        print(f"Zoekfout in bank: {e}")

    # 3. AI FALLBACK (ALS DE BANK LEEG IS OF NIET GENOEG MATCHES HEEFT)
    print("--- NIET GENOEG MATCHES: AI AANROEPEN ---")
    
    prompt = f"""
    ROLE: Professional Chef Qook. TASK: Generate a FULL 7-DAY MENU.
    LANG: {prefs.language}. DIET: {prefs.diet}. BUDGET: {prefs.budget}.
    EXCLUDE THESE TITLES: {exclude_titles}.
    
    IMPORTANT: Provide FULL recipe details for each day so we can store them.
    OUTPUT JSON FORMAT:
    {{
        "zero_waste_report": "...",
        "days": [
            {{
                "day_number": 0,
                "title": "...",
                "short_description": "...",
                "ingredients": [{{ "name": "...", "amount": 1, "unit": "g" }}],
                "steps": [{{ "step_index": 1, "user_text": "...", "needs_timer": false }}],
                "estimated_time_minutes": 30,
                "difficulty": "Medium",
                "calories_per_portion": 600,
                "wine_pairing": {{ "type": "...", "description": "..." }},
                "diet_tags": {prefs.diet},
                "mode": "premium"
            }}
        ]
    }}
    """
    
    try:
        response = model.generate_content(prompt)
        data = json.loads(clean_json(response.text))
        days_list = data if isinstance(data, list) else data.get('days', [])
        
        # 4. OPSLAAN IN DATABASE (VOOR DE VOLGENDE KEER)
        # We maken een geldig UUID voor de demo-user zodat de database niet crasht
        db_user_id = prefs.user_id if prefs.user_id != "demo-user" else "00000000-0000-0000-0000-000000000000"
        
        plan_record = supabase.table('weekly_plans').insert({
            "user_id": db_user_id, "week_number": 1, "year": 2025,
            "zero_waste_report": data.get('zero_waste_report', '') if isinstance(data, dict) else ""
        }).execute()
        
        plan_id = plan_record.data[0]['id']
        
        # Sla elk nieuw AI-recept op in de 'bank'
        for d in days_list:
            supabase.table('recipes').insert({
                'weekly_plan_id': plan_id,
                'title': d.get('title'),
                'short_description': d.get('short_description'),
                'ingredients': d.get('ingredients'),
                'steps': d.get('steps'),
                'estimated_time_minutes': d.get('estimated_time_minutes'),
                'difficulty': d.get('difficulty'),
                'calories_per_portion': d.get('calories_per_portion'),
                'mode': d.get('mode'),
                'diet_tags': prefs.diet,
                'wine_pairing': d.get('wine_pairing')
            }).execute()

        return {"status": "success", "plan_id": plan_id, "days": days_list}

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