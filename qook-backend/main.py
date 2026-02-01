import os
import json
import re
import traceback
import random
from datetime import datetime, timedelta # Cruciaal voor de 3-maanden check
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
GOOGLE_API_KEY = os.getenv("GEMINI_API_KEY") 

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
    dayModes: Dict[str, str] = {}
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
    image_data: str 
    language: str

# Model voor het opslaan van de AI afbeelding
class SaveImageRequest(BaseModel):
    meal_id: str
    image_data: str

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

# 1. WEEKPLAN (Database First + AI Fallback)
@app.post("/generate-weekly-plan")
async def generate_weekly_plan(prefs: UserPrefsInput):
    print(f"--- START GENEREREN VOOR {prefs.user_id} ---")
    
    # 1. GESCHIEDENIS OPHALEN (3 MAANDEN REGEL)
    exclude_titles = []
    if prefs.user_id != "demo-user":
        drie_maanden_geleden = (datetime.now() - timedelta(days=90)).isoformat()
        history = supabase.table('weekly_plans').select('id, created_at').eq('user_id', prefs.user_id).gt('created_at', drie_maanden_geleden).execute()
        if history.data:
            plan_ids = [h['id'] for h in history.data]
            recipes_history = supabase.table('recipes').select('title').in_('weekly_plan_id', plan_ids).execute()
            exclude_titles = [r['title'] for r in recipes_history.data]

    # 2. ZOEKEN IN DE RECEPTENBANK
    try:
        query = supabase.table('recipes').select('*').eq('mode', prefs.dayModes.get("0", "premium"))
        if prefs.diet and "Geen" not in prefs.diet:
            query = query.contains('diet_tags', prefs.diet)
            
        db_matches = query.execute()
        available_recipes = [r for r in db_matches.data if r['title'] not in exclude_titles]

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

    # 3. AI FALLBACK
    print("--- NIET GENOEG MATCHES: AI AANROEPEN ---")
    prompt = f"""
    ROLE: Professional Chef Qook. TASK: Generate a FULL 7-DAY MENU.
    LANG: {prefs.language}. DIET: {prefs.diet}. BUDGET: {prefs.budget}.
    EXCLUDE THESE TITLES: {exclude_titles}.
    
    OUTPUT JSON FORMAT:
    {{
        "zero_waste_report": "...",
        "days": [
            {{
                "day_number": 0,
                "title": "...",
                "short_description": "...",
                "ai_image_prompt": "detailed english photography prompt",
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
        
        if prefs.user_id == "demo-user":
            return {
                "status": "success", 
                "plan_id": "demo-temporary-id", 
                "days": days_list,
                "zero_waste_report": data.get('zero_waste_report', '') if isinstance(data, dict) else ""
            }

        plan_record = supabase.table('weekly_plans').insert({
            "user_id": prefs.user_id, "week_number": 1, "year": 2025,
            "zero_waste_report": data.get('zero_waste_report', '') if isinstance(data, dict) else ""
        }).execute()
        
        plan_id = plan_record.data[0]['id']
        
        for d in days_list:
            supabase.table('recipes').insert({
                'weekly_plan_id': plan_id,
                'title': d.get('title'),
                'short_description': d.get('short_description'),
                'ai_image_prompt': d.get('ai_image_prompt'),
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

# NIEUW: Endpoint om de AI afbeelding op te slaan in de database
@app.post("/save-meal-image")
async def save_meal_image(req: SaveImageRequest):
    try:
        print(f"--- AFBEELDING OPSLAAN VOOR MEAL: {req.meal_id} ---")
        supabase.table('recipes').update({"image_url": req.image_data}).eq('id', req.meal_id).execute()
        return {"status": "success"}
    except Exception as e:
        print(f"Fout bij opslaan afbeelding: {e}")
        return {"status": "error", "detail": str(e)}

# 2. DETAILS (Lazy Load)
@app.post("/get-recipe-details")
async def get_recipe_details(req: MealDetailRequest):
    try:
        # Check eerst of we het recept al hebben
        existing = supabase.table('recipes').select('*').eq('id', req.meal_id).execute()
        if existing.data and existing.data[0].get('ingredients'):
            return {"status": "success", "details": existing.data[0]}

        print(f"--- DETAIL GENEREREN: {req.meal_title} ---")
        prompt = f"RECIPE: {req.meal_title}. JSON: {{ 'ingredients': [...], 'steps': [...], ... }}"
        response = model.generate_content(prompt)
        details = json.loads(clean_json(response.text))
        supabase.table('recipes').update(details).eq('id', req.meal_id).execute()
        return {"status": "success", "details": details}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 3. VERVANG GERECHT
@app.post("/replace-meal")
async def replace_meal(req: ReplaceMealRequest):
    try:
        response = model.generate_content(f"Replace '{req.old_meal_title}'...")
        new_meal = json.loads(clean_json(response.text))
        return {"status": "success", "meal": new_meal}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 4. KOELKAST SCAN
@app.post("/analyze-fridge")
async def analyze_fridge(req: FridgeRequest):
    return {
        "recognizedItems": ["Tomaat", "Ei"],
        "suggestions": [{"title": "Omelet", "mode": "magic"}]
    }

# 5. SHOPPING
@app.post("/generate-shopping-list")
async def generate_shopping_list(req: ShoppingRequest):
    try:
        response = model.generate_content(f"Shopping list for: {req.meal_titles}")
        items = json.loads(clean_json(response.text))
        return {"items": items}
    except: return {"items": []}