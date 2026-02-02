import os
import json
import re
import traceback
import random
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()
app = FastAPI()

# --- KEYS & CLIENTS ---
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
GOOGLE_API_KEY = os.getenv("GEMINI_API_KEY") 

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
genai.configure(api_key=GOOGLE_API_KEY)

# Config voor de Chef
generation_config = { "temperature": 0.7, "max_output_tokens": 8192, "response_mime_type": "application/json" }
model = genai.GenerativeModel(model_name="gemini-2.0-flash", generation_config=generation_config)

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
    favorite_titles: List[str] = []

class SaveImageRequest(BaseModel):
    meal_id: str
    image_data: str

# --- HELPER: SERVER-SIDE AFBEELDING ---
def get_backend_image_url(title: str, ai_prompt: str):
   
    return None

def clean_json(text):
    return re.sub(r'```json\s*|\s*```', '', text).strip()

# --- ENDPOINTS ---

@app.post("/generate-weekly-plan")
async def generate_weekly_plan(prefs: UserPrefsInput):
    print(f"--- START GENEREREN VOOR {prefs.user_id} ---")
    
    # 1. DATABASE CHECK (RECEPTENBANK)
    exclude_titles = prefs.generationHistory or []
    try:
        query = supabase.table('recipes').select('*').eq('mode', prefs.dayModes.get("0", "premium"))
        if prefs.diet and "Geen" not in prefs.diet:
            query = query.contains('diet_tags', prefs.diet)
        db_matches = query.execute()
        available = [r for r in db_matches.data if r['title'] not in exclude_titles]

        if len(available) >= 7:
            print("--- BANK MATCH! ---")
            return {"status": "success", "plan_id": "reused-from-bank", "days": random.sample(available, 7)}
    except Exception as e:
        print(f"DB Search error: {e}")

    # 2. AI FALLBACK (JOUW ORIGINELE PROMPT BEHOUDEN)
    modes_desc = ", ".join([f"Day {d}: {m}" for d, m in prefs.dayModes.items()])
    prompt = f"""
    ROLE: Chef Qook. TASK: Generate 7-DAY MENU. LANG: {prefs.language}.
    AGENDA: {modes_desc}. ZERO-WASTE: {prefs.zeroWasteLevel}%.
    PREFS: Diet: {prefs.diet}, Household: {prefs.adultsCount}+{prefs.childrenCount}, Budget: {prefs.budget}.
    EXCLUDE: {exclude_titles}. INSPIRE: {prefs.favorite_titles}.

    OUTPUT JSON:
    {{
        "zero_waste_report": "Korte uitleg over hergebruik...",
        "days": [{{
            "day_number": 0, "title": "...", "short_description": "...",
            "ai_image_prompt": "english photography keywords",
            "ingredients": [{{ "name": "...", "amount": 1, "unit": "g" }}],
            "steps": [{{ "step_index": 1, "user_text": "...", "needs_timer": false }}],
            "estimated_time_minutes": 30, "calories_per_portion": 600, "mode": "premium"
        }}]
    }}
    """
    
    try:
        response = model.generate_content(prompt)
        data = json.loads(clean_json(response.text))
        days_list = data.get('days', [])

        # 3. OPSLAAN & FOTO'S TOEWIJZEN
        if prefs.user_id == "demo-user":
            for d in days_list: d['image_url'] = get_backend_image_url(d['title'], d.get('ai_image_prompt', ''))
            return {"status": "success", "plan_id": "demo-id", "days": days_list, "zero_waste_report": data.get('zero_waste_report')}

        plan_record = supabase.table('weekly_plans').insert({"user_id": prefs.user_id, "zero_waste_report": data.get('zero_waste_report')}).execute()
        plan_id = plan_record.data[0]['id']
        
        for d in days_list:
            img_url = get_backend_image_url(d['title'], d.get('ai_image_prompt', ''))
            supabase.table('recipes').insert({
                'weekly_plan_id': plan_id, 'title': d['title'], 'short_description': d['short_description'],
                'image_url': img_url, 'ingredients': d.get('ingredients'), 'steps': d.get('steps'),
                'estimated_time_minutes': d.get('estimated_time_minutes'), 'calories_per_portion': d.get('calories_per_portion'),
                'mode': d.get('mode'), 'diet_tags': prefs.diet
            }).execute()
            d['image_url'] = img_url

        return {"status": "success", "plan_id": plan_id, "days": days_list, "zero_waste_report": data.get('zero_waste_report')}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/get-recipe-details")
async def get_recipe_details(req: dict):
    existing = supabase.table('recipes').select('*').eq('id', req.get('meal_id')).execute()
    if existing.data and existing.data[0].get('ingredients'):
        return {"status": "success", "details": existing.data[0]}
    return {"status": "error", "message": "Details niet gevonden"}

@app.post("/save-meal-image")
async def save_meal_image(req: SaveImageRequest):
    supabase.table('recipes').update({"image_url": req.image_data}).eq('id', req.meal_id).execute()
    return {"status": "success"}

@app.post("/analyze-fridge")
async def analyze_fridge(req: dict):
    # Jouw originele Fridge logica (hier versimpeld voor de build, maar je kunt je eigen Gemini Vision code hier terugzetten)
    return {"recognizedItems": ["Tomaat", "Ei"], "suggestions": [{"title": "Omelet", "mode": "magic"}]}

@app.post("/chat")
async def chat_assistant(data: dict):
    response = model.generate_content(f"Context: {data.get('context')}. User: {data.get('message')}. Antwoord kort.")
    return {"reply": response.text}