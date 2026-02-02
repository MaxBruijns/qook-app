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

# --- KEYS ---
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
GOOGLE_API_KEY = os.getenv("GEMINI_API_KEY") 

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
genai.configure(api_key=GOOGLE_API_KEY)
model = genai.GenerativeModel('gemini-1.5-flash')

app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

class UserPrefsInput(BaseModel):
    user_id: str
    adultsCount: int = 2
    childrenCount: int = 0
    diet: List[str] = []
    budget: str = 'Normaal'
    dayModes: Dict[str, str] = {}
    language: str = 'nl-NL'
    generationHistory: List[str] = []
    favorite_titles: List[str] = []

class SaveImageRequest(BaseModel):
    meal_id: str
    image_data: str

def get_backend_image_url(title: str, ai_prompt: str):
    seed = random.randint(1, 999999)
    # We gebruiken een stabiele fallback link die uniek is per zaadje
    return f"https://image.pollinations.ai/prompt/{title.replace(' ', '%20')}?width=800&height=600&nologo=true&seed={seed}"

@app.post("/generate-weekly-plan")
async def generate_weekly_plan(prefs: UserPrefsInput):
    print(f"--- START GENEREREN VOOR {prefs.user_id} ---")
    
    # 1. DATABASE CHECK (RECEPTENBANK)
    exclude_titles = prefs.generationHistory or []
    try:
        # We halen de mode op voor de eerste dag
        current_mode = prefs.dayModes.get("0", "premium")
        
        # We doen een simpele query om te kijken of er gerechten zijn
        query = supabase.table('recipes').select('*').eq('mode', current_mode)
        
        # Alleen filteren op dieet als het geen 'Geen' is en prefs.diet een lijst is
        if prefs.diet and len(prefs.diet) > 0 and "Geen" not in prefs.diet:
            query = query.contains('diet_tags', prefs.diet)
        
        db_matches = query.execute()
        
        if db_matches.data:
            available = [r for r in db_matches.data if r['title'] not in exclude_titles]
            if len(available) >= 7:
                print(f"--- BANK MATCH GEVONDEN: {len(available)} stuks ---")
                return {
                    "status": "success", 
                    "plan_id": "reused", 
                    "days": random.sample(available, 7),
                    "zero_waste_report": "Geselecteerd uit de bank."
                }
    except Exception as db_err:
        print(f"DEBUG: Database zoekopdracht overgeslagen: {db_err}")

    # 2. AI GENERATIE (BACKUP)
    print("--- AI AANROEPEN ---")
    prompt = f"Genereer een 7-daags menu voor {prefs.diet} in {prefs.language}. JSON format met 'days' lijst. Gebruik 'user_text' voor stappen."
    
    try:
        response = model.generate_content(prompt)
        # Verwijder markdown en parse JSON
        clean_text = re.sub(r'```json\s*|\s*```', '', response.text).strip()
        data = json.loads(clean_text)
        days_list = data.get('days', [])

        # 3. AFBEELDINGEN TOEVOEGEN & OPSLAAN
        # Voor de demo user sturen we direct terug met gegenereerde links
        if prefs.user_id == "demo-user":
            for d in days_list:
                d['image_url'] = get_backend_image_url(d['title'], d.get('ai_image_prompt', ''))
            return {"status": "success", "plan_id": "demo-id", "days": days_list}

        # Voor echte users slaan we het plan op
        plan_record = supabase.table('weekly_plans').insert({"user_id": prefs.user_id}).execute()
        plan_id = plan_record.data[0]['id']
        
        for d in days_list:
            img_url = get_backend_image_url(d['title'], d.get('ai_image_prompt', ''))
            supabase.table('recipes').insert({
                'weekly_plan_id': plan_id,
                'title': d['title'],
                'image_url': img_url,
                'ingredients': d.get('ingredients'),
                'steps': d.get('steps'),
                'mode': d.get('mode', 'premium'),
                'diet_tags': prefs.diet
            }).execute()
            d['image_url'] = img_url

        return {"status": "success", "plan_id": plan_id, "days": days_list}
    except Exception as e:
        print(f"AI Error: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/get-recipe-details")
async def get_recipe_details(req: dict):
    existing = supabase.table('recipes').select('*').eq('id', req.get('meal_id')).execute()
    return {"status": "success", "details": existing.data[0] if existing.data else {}}

@app.post("/save-meal-image")
async def save_meal_image(req: SaveImageRequest):
    supabase.table('recipes').update({"image_url": req.image_data}).eq('id', req.meal_id).execute()
    return {"status": "success"}

@app.post("/analyze-fridge")
async def analyze_fridge(req: dict):
    return {"recognizedItems": [], "suggestions": []}

@app.post("/chat")
async def chat_assistant(data: dict):
    response = model.generate_content(f"User: {data.get('message')}")
    return {"reply": response.text}