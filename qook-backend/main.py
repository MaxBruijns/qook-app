
Copy

import os
import json
import re
import traceback
import asyncio
import httpx
from datetime import datetime
from typing import List, Dict, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from openai import AsyncOpenAI
from supabase import create_client, Client
from dotenv import load_dotenv
 
load_dotenv()
app = FastAPI()
 
# --- CLIENTS ---
supabase: Client = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
openai = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
 
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
 
# --- MODELS ---
TEXT_MODEL = "gpt-5.4-mini"        # Menu, recepten, vervangen, koelkast
IMAGE_MODEL = "dall-e-3"           # Maaltijdfoto's
 
# --- PYDANTIC MODELS ---
class UserPrefsInput(BaseModel):
    user_id: str
    adultsCount: int = 2
    childrenCount: int = 0
    diet: List[str] = []
    budget: str = "Normaal"
    dayModes: Dict[str, str] = {}
    language: str = "nl-NL"
    generationHistory: List[str] = []
    favorite_titles: List[str] = []
    zeroWasteLevel: int = 50
 
class ReplaceMealInput(BaseModel):
    meal_id: str
    meal_title: str
    day_index: int
    user_id: str
    diet: List[str] = []
    budget: str = "Normaal"
    language: str = "nl-NL"
    exclude_titles: List[str] = []
    favorite_titles: List[str] = []
    mode: str = "premium"
 
class ShoppingListInput(BaseModel):
    meals: List[dict]
    adultsCount: int = 2
    childrenCount: int = 0
    language: str = "nl-NL"
 
class FridgeScanInput(BaseModel):
    image_data: str
    language: str = "nl-NL"
 
# --- IMAGE HELPER ---
async def generate_and_store_image(recipe_id: str, title: str, prompt: str) -> str:
    """Genereert DALL-E 3 afbeelding en slaat op in Supabase Storage. Eenmalig per gerecht."""
    try:
        # Check of afbeelding al bestaat
        existing = supabase.table("recipes").select("image_url").eq("id", recipe_id).execute()
        if existing.data and existing.data[0].get("image_url"):
            url = existing.data[0]["image_url"]
            if url and not "pollinations" in url:
                return url
    except Exception:
        pass
 
    try:
        full_prompt = (
            f"Professional food photography of {title}. "
            f"{prompt}. "
            "Natural lighting, shallow depth of field, white plate, "
            "restaurant quality plating, clean background. "
            "No text, no watermarks, no people."
        )
 
        # Genereer met DALL-E 3
        response = await openai.images.generate(
            model=IMAGE_MODEL,
            prompt=full_prompt,
            n=1,
            size="1024x1024",
            quality="standard",
            response_format="url",
        )
        temp_url = response.data[0].url
 
        # Download afbeelding (DALL-E URLs verlopen na 1 uur)
        async with httpx.AsyncClient(timeout=30) as client:
            img_response = await client.get(temp_url)
            img_bytes = img_response.content
 
        # Upload naar Supabase Storage
        file_path = f"meals/{recipe_id}.jpg"
        supabase.storage.from_("meal-images").upload(
            file_path,
            img_bytes,
            {"content-type": "image/jpeg", "upsert": "true"}
        )
 
        public_url = supabase.storage.from_("meal-images").get_public_url(file_path)
 
        # Sla URL op in database
        supabase.table("recipes").update({"image_url": public_url}).eq("id", recipe_id).execute()
 
        return public_url
 
    except Exception as e:
        print(f"Afbeelding generatie mislukt voor {title}: {e}")
        # Fallback: vaste food foto
        fallbacks = [
            "https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?w=800",
            "https://images.pexels.com/photos/1279330/pexels-photo-1279330.jpeg?w=800",
            "https://images.pexels.com/photos/699953/pexels-photo-699953.jpeg?w=800",
            "https://images.pexels.com/photos/2338407/pexels-photo-2338407.jpeg?w=800",
            "https://images.pexels.com/photos/1640772/pexels-photo-1640772.jpeg?w=800",
            "https://images.pexels.com/photos/6287525/pexels-photo-6287525.jpeg?w=800",
            "https://images.pexels.com/photos/3763847/pexels-photo-3763847.jpeg?w=800",
        ]
        return fallbacks[hash(title) % len(fallbacks)]
 
 
# --- WEEKPLAN GENERATIE ---
@app.post("/generate-weekly-plan")
async def generate_weekly_plan(prefs: UserPrefsInput):
    print(f"--- KOOQ: weekplan generatie voor {prefs.user_id} ---")
 
    exclude_titles = prefs.generationHistory or []
    modes_desc = ", ".join([f"Dag {d}: {m}" for d, m in prefs.dayModes.items()])
    lang = "Dutch" if "nl" in prefs.language else "English"
 
    system_prompt = (
        f"You are Chef Qook (KOOQ), an expert meal planner. "
        f"Generate a 7-day weekly menu in {lang}. "
        "Return ONLY valid JSON, no markdown, no explanation."
    )
 
    user_prompt = f"""Generate a 7-day menu with these requirements:
- Language: {lang}
- Diet: {prefs.diet}
- Budget: {prefs.budget}
- Household: {prefs.adultsCount} adults, {prefs.childrenCount} children
- Zero-waste level: {prefs.zeroWasteLevel}%
- Day modes: {modes_desc} (culinary = luxury chef-level, premium = comfortable)
- NEVER use these dishes: {exclude_titles}
- Use these as style inspiration: {prefs.favorite_titles}
 
Return this exact JSON structure:
{{
    "zero_waste_report": "Brief explanation of ingredient reuse and waste reduction",
    "days": [{{
        "day_number": 0,
        "title": "Dish name in {lang}",
        "short_description": "Appealing 1-sentence description",
        "ai_image_prompt": "English photography prompt for this specific dish",
        "ingredients": [{{"name": "...", "amount": 0, "unit": "..."}}],
        "steps": [{{"step_index": 1, "user_text": "Clear instruction in {lang}", "needs_timer": false, "timer_seconds": null}}],
        "estimated_time_minutes": 30,
        "calories_per_portion": 600,
        "mode": "premium"
    }}]
}}"""
 
    try:
        response = await openai.chat.completions.create(
            model=TEXT_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.8,
        )
 
        data = json.loads(response.choices[0].message.content)
        days_list = data.get("days", [])
 
        # Opslaan in Supabase en afbeeldingen genereren
        if prefs.user_id != "demo-user":
            plan_rec = supabase.table("weekly_plans").insert({
                "user_id": prefs.user_id,
                "zero_waste_report": data.get("zero_waste_report")
            }).execute()
            p_id = plan_rec.data[0]["id"]
 
            for d in days_list:
                # Check of gerecht al in receptenbank staat
                existing = supabase.table("recipes").select("id, image_url").ilike("title", d["title"]).execute()
 
                if existing.data:
                    recipe_id = existing.data[0]["id"]
                    d["id"] = recipe_id
                    d["image_url"] = existing.data[0].get("image_url") or ""
                else:
                    # Nieuw recept opslaan
                    recipe_rec = supabase.table("recipes").insert({
                        "title": d["title"],
                        "short_description": d.get("short_description"),
                        "ai_image_prompt": d.get("ai_image_prompt"),
                        "ingredients": d.get("ingredients"),
                        "steps": d.get("steps"),
                        "mode": d.get("mode"),
                        "diet_tags": prefs.diet,
                        "estimated_time_minutes": d.get("estimated_time_minutes"),
                        "calories_per_portion": d.get("calories_per_portion"),
                    }).execute()
                    recipe_id = recipe_rec.data[0]["id"]
                    d["id"] = recipe_id
                    d["image_url"] = ""
 
                    # Afbeelding genereren op de achtergrond (non-blocking)
                    asyncio.create_task(
                        generate_and_store_image(recipe_id, d["title"], d.get("ai_image_prompt", ""))
                    )
 
                # Koppel aan weekplan
                supabase.table("plan_meals").insert({
                    "plan_id": p_id,
                    "recipe_id": recipe_id,
                    "day_index": d.get("day_number", 0),
                }).execute()
 
        return {
            "status": "success",
            "days": days_list,
            "zero_waste_report": data.get("zero_waste_report", "")
        }
 
    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))
 
 
# --- MAALTIJD VERVANGEN ---
@app.post("/replace-meal")
async def replace_meal(req: ReplaceMealInput):
    print(f"--- KOOQ: maaltijd vervangen: {req.meal_title} ---")
 
    lang = "Dutch" if "nl" in req.language else "English"
 
    system_prompt = (
        f"You are Chef Qook (KOOQ). Generate ONE replacement meal in {lang}. "
        "Return ONLY valid JSON, no markdown."
    )
 
    user_prompt = f"""Generate a replacement for day {req.day_index} meal.
- Language: {lang}
- Diet: {req.diet}
- Budget: {req.budget}
- Mode: {req.mode} (culinary = luxury, premium = comfortable)
- NEVER use these dishes: {req.exclude_titles}
- Style inspiration: {req.favorite_titles}
- Replace: {req.meal_title}
 
Return this exact JSON:
{{
    "title": "New dish name",
    "short_description": "Appealing description",
    "ai_image_prompt": "English photography prompt",
    "ingredients": [{{"name": "...", "amount": 0, "unit": "..."}}],
    "steps": [{{"step_index": 1, "user_text": "...", "needs_timer": false, "timer_seconds": null}}],
    "estimated_time_minutes": 30,
    "calories_per_portion": 600,
    "mode": "{req.mode}"
}}"""
 
    try:
        response = await openai.chat.completions.create(
            model=TEXT_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.9,
        )
 
        meal = json.loads(response.choices[0].message.content)
 
        # Opslaan in receptenbank
        if req.user_id != "demo-user":
            recipe_rec = supabase.table("recipes").insert({
                "title": meal["title"],
                "short_description": meal.get("short_description"),
                "ai_image_prompt": meal.get("ai_image_prompt"),
                "ingredients": meal.get("ingredients"),
                "steps": meal.get("steps"),
                "mode": meal.get("mode"),
                "diet_tags": req.diet,
                "estimated_time_minutes": meal.get("estimated_time_minutes"),
                "calories_per_portion": meal.get("calories_per_portion"),
            }).execute()
            recipe_id = recipe_rec.data[0]["id"]
            meal["id"] = recipe_id
            meal["image_url"] = ""
 
            # Afbeelding op achtergrond genereren
            asyncio.create_task(
                generate_and_store_image(recipe_id, meal["title"], meal.get("ai_image_prompt", ""))
            )
 
        return {"status": "success", "meal": meal}
 
    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))
 
 
# --- BOODSCHAPPENLIJST ---
@app.post("/generate-shopping-list")
async def generate_shopping_list(req: ShoppingListInput):
    print(f"--- KOOQ: boodschappenlijst voor {len(req.meals)} maaltijden ---")
 
    lang = "Dutch" if "nl" in req.language else "English"
    meals_text = "\n".join([f"- {m.get('title')}: {json.dumps(m.get('ingredients', []))}" for m in req.meals])
 
    system_prompt = (
        f"You are Chef Qook. Generate a combined shopping list in {lang}. "
        "Combine duplicate ingredients, round up amounts. "
        "Return ONLY valid JSON."
    )
 
    user_prompt = f"""Create a shopping list for {req.adultsCount} adults and {req.childrenCount} children.
Meals and their ingredients:
{meals_text}
 
Return this exact JSON:
{{
    "categories": [{{
        "name": "Category name (e.g. Groenten, Vlees, Zuivel)",
        "items": [{{
            "name": "ingredient name",
            "amount": 0,
            "unit": "g/ml/stuks/etc",
            "checked": false
        }}]
    }}]
}}"""
 
    try:
        response = await openai.chat.completions.create(
            model=TEXT_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
        )
 
        data = json.loads(response.choices[0].message.content)
 
        # Flatten naar items lijst zoals frontend verwacht
        items = []
        for cat in data.get("categories", []):
            for item in cat.get("items", []):
                items.append({
                    "id": f"{item['name']}_{len(items)}",
                    "name": item["name"],
                    "amount": item.get("amount", ""),
                    "unit": item.get("unit", ""),
                    "category": cat["name"],
                    "checked": False
                })
 
        return {"status": "success", "items": items}
 
    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))
 
 
# --- KOELKAST SCAN ---
@app.post("/analyze-fridge")
async def analyze_fridge(data: FridgeScanInput):
    print("--- KOOQ: koelkast scan ---")
 
    lang = "Dutch" if "nl" in data.language else "English"
 
    try:
        response = await openai.chat.completions.create(
            model="gpt-4o",  # Vision vereist gpt-4o, niet mini
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{data.image_data}"
                        }
                    },
                    {
                        "type": "text",
                        "text": f"""Analyze this fridge photo. List all visible ingredients and suggest 3 meals in {lang}.
Return ONLY this JSON:
{{
    "recognizedItems": ["ingredient1", "ingredient2"],
    "suggestions": [{{
        "id": "scan_1",
        "title": "Dish name",
        "short_description": "Brief description",
        "estimated_time_minutes": 20,
        "calories_per_portion": 450,
        "mode": "magic",
        "uses_ingredients": ["ingredient1"],
        "ingredients": [{{"name": "...", "amount": 0, "unit": "..."}}],
        "steps": [{{"step_index": 1, "user_text": "...", "needs_timer": false}}]
    }}]
}}"""
                    }
                ]
            }],
            response_format={"type": "json_object"},
            max_tokens=1500,
        )
 
        result = json.loads(response.choices[0].message.content)
        return result
 
    except Exception as e:
        print(traceback.format_exc())
        # Fallback als scan mislukt
        return {
            "recognizedItems": [],
            "suggestions": []
        }
 
 
# --- RECEPT DETAILS ---
@app.post("/get-recipe-details")
async def get_recipe_details(req: dict):
    try:
        res = supabase.table("recipes").select("*").eq("id", req.get("meal_id")).execute()
        return {"status": "success", "details": res.data[0] if res.data else {}}
    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))
 
 
# --- AFBEELDING GENEREREN (directe aanroep) ---
@app.post("/generate-image")
async def generate_image(req: dict):
    recipe_id = req.get("recipe_id")
    title = req.get("title", "")
    prompt = req.get("prompt", "")
 
    if not recipe_id or not title:
        raise HTTPException(status_code=400, detail="recipe_id en title zijn verplicht")
 
    try:
        url = await generate_and_store_image(recipe_id, title, prompt)
        return {"status": "success", "url": url}
    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))
 
 
# --- HEALTH CHECK ---
@app.get("/health")
async def health():
    return {"status": "ok", "model": TEXT_MODEL}