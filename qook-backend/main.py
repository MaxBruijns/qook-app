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
from google.generativeai.types import HarmCategory, HarmBlockThreshold
from supabase import create_client, Client
from dotenv import load_dotenv

# Laad omgevingsvariabelen
load_dotenv()

app = FastAPI()

# --- CONFIGURATIE & KEYS ---
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
GOOGLE_API_KEY = os.getenv("GEMINI_API_KEY") 

# Initialiseer clients
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
genai.configure(api_key=GOOGLE_API_KEY)

# AI Model Instellingen
generation_config = { 
    "temperature": 0.7, 
    "max_output_tokens": 8192, 
    "response_mime_type": "application/json" 
}
safety_settings = { 
    HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE 
}
model = genai.GenerativeModel(
    model_name="gemini-2.0-flash", 
    generation_config=generation_config, 
    safety_settings=safety_settings
)

# CORS instellingen voor Vercel en lokaal gebruik
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In productie kun je dit beperken tot je Vercel-URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- DATAMODELLEN (PYDANTIC) ---

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

class MealDetailRequest(BaseModel):
    meal_id: str
    meal_title: str
    mode: str = 'premium'
    adultsCount: int = 2
    childrenCount: int = 0
    language: str = 'nl-NL'

class SaveImageRequest(BaseModel):
    meal_id: str
    image_data: str

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
    """Verwijdert markdown code blocks uit AI response."""
    text = re.sub(r'```json\s*|\s*```', '', text).strip()
    return text

# --- API ENDPOINTS ---

# 1. GENEREREN WEEKMENU (Database First -> AI Fallback)
@app.post("/generate-weekly-plan")
async def generate_weekly_plan(prefs: UserPrefsInput):
    print(f"--- START GENERATIE VOOR: {prefs.user_id} ---")
    
    # A. GESCHIEDENIS & FAVORIETEN FILTER
    exclude_titles = prefs.generationHistory or []
    favorite_titles = prefs.favorite_titles or []

    # B. STAP 1: PROBEER DATABASE (RECEPTENBANK)
    try:
        # We zoeken gerechten die matchen met de gevraagde modus (default premium)
        current_mode = prefs.dayModes.get("0", "premium")
        query = supabase.table('recipes').select('*').eq('mode', current_mode)
        
        # Filter op dieet (als niet 'Geen')
        if prefs.diet and "Geen" not in prefs.diet:
            query = query.contains('diet_tags', prefs.diet)
            
        db_matches = query.execute()
        
        # Filter op 3-maanden regel: NIET in geschiedenis OF WEL in favorieten
        available = [
            r for r in db_matches.data 
            if r['title'] not in exclude_titles or r['title'] in favorite_titles
        ]

        if len(available) >= 7:
            print(f"--- MATCH IN BANK! {len(available)} recepten gevonden. ---")
            return {
                "status": "success", 
                "plan_id": "reused-from-bank", 
                "days": random.sample(available, 7),
                "zero_waste_report": "Geselecteerd uit de Qook receptenbank."
            }
    except Exception as e:
        print(f"Database zoekfout: {e}")

    # C. STAP 2: AI FALLBACK (Geen match in bank)
    print("--- GEEN MATCH IN BANK: AI AANROEPEN ---")
    prompt = f"""
    ROLE: Professional Chef Qook. TASK: Generate a 7-DAY MENU.
    LANG: {prefs.language}. DIET: {prefs.diet}. BUDGET: {prefs.budget}.
    STRICT EXCLUDE (Already eaten): {exclude_titles}.
    STRICT INSPIRE (User loves): {favorite_titles}.

    Provide FULL recipe details for each day.
    JSON FORMAT:
    {{
        "zero_waste_report": "...",
        "days": [
            {{
                "day_number": 0,
                "title": "...",
                "short_description": "...",
                "ai_image_prompt": "professional food photography shot, english keywords",
                "ingredients": [{{ "name": "...", "amount": 1, "unit": "g" }}],
                "steps": [{{ "step_index": 1, "user_text": "...", "needs_timer": false }}],
                "supplies": ["pan", "mes"],
                "estimated_time_minutes": 30,
                "calories_per_portion": 600,
                "mode": "premium",
                "diet_tags": {prefs.diet}
            }}
        ]
    }}
    """
    
    try:
        response = model.generate_content(prompt)
        data = json.loads(clean_json(response.text))
        days_list = data if isinstance(data, list) else data.get('days', [])

        # D. OPSLAAN (Alleen voor geregistreerde users)
        if prefs.user_id == "demo-user":
            return {"status": "success", "plan_id": "demo-temporary-id", "days": days_list}

        # Voor ingelogde users maken we een record aan
        plan_record = supabase.table('weekly_plans').insert({
            "user_id": prefs.user_id, "week_number": 1, "year": 2025,
            "zero_waste_report": data.get('zero_waste_report', '') if isinstance(data, dict) else ""
        }).execute()
        
        plan_id = plan_record.data[0]['id']
        
        # Sla nieuwe recepten op in de 'Bank'
        for d in days_list:
            supabase.table('recipes').insert({
                'weekly_plan_id': plan_id,
                'title': d.get('title'),
                'short_description': d.get('short_description'),
                'ai_image_prompt': d.get('ai_image_prompt'),
                'ingredients': d.get('ingredients'),
                'steps': d.get('steps'),
                'supplies': d.get('supplies'),
                'estimated_time_minutes': d.get('estimated_time_minutes'),
                'calories_per_portion': d.get('calories_per_portion'),
                'mode': d.get('mode'),
                'diet_tags': prefs.diet
            }).execute()

        return {"status": "success", "plan_id": plan_id, "days": days_list}

    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

# 2. OPSLAAN AI AFBEELDING IN DB (Smart Save)
@app.post("/save-meal-image")
async def save_meal_image(req: SaveImageRequest):
    try:
        print(f"--- AFBEELDING VASTLEGGEN VOOR RECEPT: {req.meal_id} ---")
        # Update het image_url veld in de recepten tabel
        supabase.table('recipes').update({"image_url": req.image_data}).eq('id', req.meal_id).execute()
        return {"status": "success"}
    except Exception as e:
        print(f"Fout bij opslaan image: {e}")
        return {"status": "error", "detail": str(e)}

# 3. RECEPT DETAILS (Lazy Load)
@app.post("/get-recipe-details")
async def get_recipe_details(req: MealDetailRequest):
    try:
        # Check eerst of de bank het al compleet heeft
        existing = supabase.table('recipes').select('*').eq('id', req.meal_id).execute()
        if existing.data and existing.data[0].get('ingredients') and existing.data[0].get('steps'):
            return {"status": "success", "details": existing.data[0]}

        # Zo niet: Laat AI het recept invullen
        print(f"--- DETAILS AANVULLEN: {req.meal_title} ---")
        prompt = f"Geef het volledige recept voor {req.meal_title} in JSON. Gebruik exact 'ingredients' en 'steps' met 'user_text'."
        response = model.generate_content(prompt)
        details = json.loads(clean_json(response.text))
        
        # Sla op in DB voor de volgende keer
        supabase.table('recipes').update(details).eq('id', req.meal_id).execute()
        return {"status": "success", "details": details}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 4. CHAT ASSISTANT
@app.post("/chat")
async def chat_assistant(data: dict):
    try:
        chat_model = genai.GenerativeModel("gemini-2.0-flash") 
        response = chat_model.generate_content(
            f"Context: {data.get('context')}. User: {data.get('message')}. Antwoord kort als Chef Qook."
        )
        return {"reply": response.text}
    except: 
        return {"reply": "De chef is even bezig met een ander gerecht..."}

# 5. GERECHT VERVANGEN
@app.post("/replace-meal")
async def replace_meal(req: ReplaceMealRequest):
    try:
        prompt = f"Vervang '{req.old_meal_title}' door een nieuw gerecht. Mode: {req.mode}. Dieet: {req.prefs.diet}."
        response = model.generate_content(prompt)
        new_meal = json.loads(clean_json(response.text))
        return {"status": "success", "meal": new_meal}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 6. BOODSCHAPPENLIJST
@app.post("/generate-shopping-list")
async def generate_shopping_list(req: ShoppingRequest):
    try:
        prompt = f"Maak een gecombineerde boodschappenlijst voor: {', '.join(req.meal_titles)}."
        response = model.generate_content(prompt)
        items = json.loads(clean_json(response.text))
        return {"items": items}
    except: 
        return {"items": []}

# 7. KOELKAST SCAN
@app.post("/analyze-fridge")
async def analyze_fridge(req: FridgeRequest):
    # Basis mock voor koelkast scan
    return {
        "recognizedItems": ["Tomaat", "Ei", "Basilicum"],
        "suggestions": [
            {"title": "Verse Omelet", "short_description": "Met tomaat en basilicum.", "estimated_time_minutes": 10, "mode": "magic"}
        ]
    }

@app.post("/check-subscription")
async def check_subscription(data: dict):
    return {"status": "active", "tier": "trial"}