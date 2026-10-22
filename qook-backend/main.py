"""
KOOQ backend (FastAPI op Render).

Tekst-AI  : Google Gemini (gratis tier) of OpenAI — kies met env AI_PROVIDER.
Foto's    : Cloudflare Workers AI (FLUX schnell, gratis tier), eenmalig per
            gerecht gegenereerd en opgeslagen in Supabase Storage.

Environment variables (Render):
  SUPABASE_URL, SUPABASE_KEY          verplicht (gebruik de service_role key)
  GEMINI_API_KEY                      verplicht als AI_PROVIDER=gemini (standaard)
  OPENAI_API_KEY                      alleen nodig als AI_PROVIDER=openai
  CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN                voor maaltijdfoto's
  AI_PROVIDER    (optioneel)          "gemini" (standaard) of "openai"
  TEXT_MODEL     (optioneel)          bv. "gemini-2.5-flash" of "gpt-5.4-mini"
"""

import os
import json
import base64
import asyncio
import traceback
from typing import List, Dict, Optional, Any

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

supabase: Client = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))

# ---------------------------------------------------------------------------
# AI-PROVIDER: de enige plek waar gekozen wordt welke AI de tekst maakt.
# Overstappen naar OpenAI = in Render AI_PROVIDER=openai + OPENAI_API_KEY zetten.
# ---------------------------------------------------------------------------
AI_PROVIDER = os.getenv("AI_PROVIDER", "gemini").lower()
DEFAULT_MODELS = {"gemini": "gemini-2.5-flash", "openai": "gpt-5.4-mini"}
TEXT_MODEL = os.getenv("TEXT_MODEL") or DEFAULT_MODELS.get(AI_PROVIDER, "gemini-2.5-flash")

CF_ACCOUNT_ID = os.getenv("CLOUDFLARE_ACCOUNT_ID")
CF_API_TOKEN = os.getenv("CLOUDFLARE_API_TOKEN")
CF_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell"
IMAGE_BUCKET = "meal-images"

FALLBACK_IMAGES = [
    "https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&w=800",
    "https://images.pexels.com/photos/1279330/pexels-photo-1279330.jpeg?auto=compress&w=800",
    "https://images.pexels.com/photos/699953/pexels-photo-699953.jpeg?auto=compress&w=800",
    "https://images.pexels.com/photos/2338407/pexels-photo-2338407.jpeg?auto=compress&w=800",
    "https://images.pexels.com/photos/1640772/pexels-photo-1640772.jpeg?auto=compress&w=800",
]

if AI_PROVIDER == "openai":
    from openai import AsyncOpenAI
    _openai = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
else:
    from google import genai
    from google.genai import types as gtypes
    _gemini = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))


def _parse_json(text: str) -> Any:
    text = (text or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
    return json.loads(text)


async def ai_json(system: str, prompt: str, temperature: float = 0.7,
                  image_b64: Optional[str] = None) -> Any:
    """Stuurt een prompt (optioneel met foto) naar de gekozen AI en geeft JSON terug."""
    if AI_PROVIDER == "openai":
        content: Any = prompt
        if image_b64:
            content = [
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
                {"type": "text", "text": prompt},
            ]
        resp = await _openai.chat.completions.create(
            model=TEXT_MODEL,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": content}],
            response_format={"type": "json_object"},
            temperature=temperature,
        )
        return _parse_json(resp.choices[0].message.content)

    parts: List[Any] = []
    if image_b64:
        parts.append(gtypes.Part.from_bytes(data=base64.b64decode(image_b64), mime_type="image/jpeg"))
    parts.append(prompt)
    config_kwargs: Dict[str, Any] = dict(
        system_instruction=system,
        response_mime_type="application/json",
        temperature=temperature,
    )
    if TEXT_MODEL.startswith("gemini-2.5-flash"):
        # Snel en goedkoop: geen 'denktijd' nodig voor gestructureerde JSON.
        config_kwargs["thinking_config"] = gtypes.ThinkingConfig(thinking_budget=0)
    resp = await _gemini.aio.models.generate_content(
        model=TEXT_MODEL, contents=parts, config=gtypes.GenerateContentConfig(**config_kwargs)
    )
    return _parse_json(resp.text)


def lang_name(code: str) -> str:
    code = (code or "nl").lower()
    for prefix, name in (("nl", "Dutch"), ("de", "German"), ("fr", "French"), ("es", "Spanish")):
        if code.startswith(prefix):
            return name
    return "English"


# ---------------------------------------------------------------------------
# RECEPTENBANK (Supabase)
# ---------------------------------------------------------------------------
BASE_RECIPE_COLUMNS = [
    "title", "short_description", "ingredients", "steps", "mode", "diet_tags",
    "estimated_time_minutes", "calories_per_portion",
]


def save_recipe(meal: dict, diet: List[str]) -> Optional[str]:
    """Slaat een gerecht op in de receptenbank (of hergebruikt een bestaand gerecht).
    Geeft het recept-id terug, of None als opslaan niet lukt."""
    try:
        existing = (supabase.table("recipes").select("id, image_url")
                    .eq("title", meal["title"]).limit(1).execute())
        if existing.data:
            row = existing.data[0]
            if row.get("image_url"):
                meal["image_url"] = row["image_url"]
            return row["id"]
    except Exception:
        print(traceback.format_exc())

    row = {k: meal.get(k) for k in BASE_RECIPE_COLUMNS}
    row["diet_tags"] = diet or []
    try:
        res = supabase.table("recipes").insert({**row, "ai_image_prompt": meal.get("ai_image_prompt")}).execute()
        return res.data[0]["id"]
    except Exception as e:
        # Kolom ai_image_prompt bestaat nog niet? Dan zonder opslaan (zie supabase_setup.sql).
        if "ai_image_prompt" not in str(e):
            print(traceback.format_exc())
            return None
    try:
        res = supabase.table("recipes").insert(row).execute()
        return res.data[0]["id"]
    except Exception:
        print(traceback.format_exc())
        return None


def attach_recipe_id(meal: dict, diet: List[str], fallback_id: str) -> dict:
    meal["id"] = save_recipe(meal, diet) or fallback_id
    meal.setdefault("image_url", None)
    return meal


# ---------------------------------------------------------------------------
# MAALTIJDFOTO'S (Cloudflare FLUX -> Supabase Storage), eenmalig per gerecht
# ---------------------------------------------------------------------------
_inflight: Dict[str, asyncio.Task] = {}


async def _cloudflare_image(prompt: str) -> bytes:
    url = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/run/{CF_IMAGE_MODEL}"
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            url,
            headers={"Authorization": f"Bearer {CF_API_TOKEN}"},
            json={"prompt": prompt[:2000], "steps": 6},
        )
    resp.raise_for_status()
    body = resp.json()
    image_b64 = (body.get("result") or {}).get("image") or body.get("image")
    if not image_b64:
        raise RuntimeError(f"Cloudflare gaf geen afbeelding terug: {str(body)[:300]}")
    return base64.b64decode(image_b64)


async def _generate_and_store(recipe_id: str) -> str:
    rec = supabase.table("recipes").select("*").eq("id", recipe_id).limit(1).execute()
    if not rec.data:
        raise HTTPException(status_code=404, detail="Recept niet gevonden")
    recipe = rec.data[0]
    if recipe.get("image_url"):
        return recipe["image_url"]

    if not (CF_ACCOUNT_ID and CF_API_TOKEN):
        raise RuntimeError("CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN ontbreken")

    dish = recipe.get("ai_image_prompt") or recipe["title"]
    prompt = (
        f"Professional food photography of {recipe['title']}. {dish}. "
        "Plated dish seen from a 45 degree angle, natural window light, shallow depth of field, "
        "restaurant-quality plating on a ceramic plate, appetizing, realistic. "
        "No text, no watermark, no people, no hands."
    )
    img_bytes = await _cloudflare_image(prompt)

    path = f"meals/{recipe_id}.jpg"
    supabase.storage.from_(IMAGE_BUCKET).upload(
        path, img_bytes, {"content-type": "image/jpeg", "upsert": "true"}
    )
    public_url = supabase.storage.from_(IMAGE_BUCKET).get_public_url(path)
    supabase.table("recipes").update({"image_url": public_url}).eq("id", recipe_id).execute()
    return public_url


async def get_or_create_image(recipe_id: str) -> str:
    # Voorkomt dubbel genereren als kaart én detailpagina tegelijk vragen.
    task = _inflight.get(recipe_id)
    if task is None:
        task = asyncio.create_task(_generate_and_store(recipe_id))
        _inflight[recipe_id] = task
        task.add_done_callback(lambda _t: _inflight.pop(recipe_id, None))
    return await task


# ---------------------------------------------------------------------------
# REQUEST MODELLEN
# ---------------------------------------------------------------------------
class UserPrefsInput(BaseModel):
    user_id: str = "demo-user"
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
    meal_id: Optional[str] = None
    meal_title: str
    day_index: int = 0
    user_id: str = "demo-user"
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
    diet: List[str] = []


class ImageInput(BaseModel):
    recipe_id: str


class ChatInput(BaseModel):
    messages: List[dict] = []          # [{sender: 'user'|'assistant', text: '...'}]
    message: str
    user_status: str = "visitor"
    current_view: str = "dashboard"
    language: str = "nl-NL"
    diet: List[str] = []


MEAL_SCHEMA = """{
  "title": "Dish name",
  "short_description": "Appealing one-sentence description",
  "ai_image_prompt": "Short English description of how the plated dish looks",
  "ingredients": [{"name": "...", "amount": 0, "unit": "..."}],
  "steps": [{"step_index": 1, "user_text": "...", "needs_timer": false, "estimated_duration_seconds": 0}],
  "estimated_time_minutes": 30,
  "calories_per_portion": 600,
  "mode": "premium"
}"""

CHEF_SYSTEM = (
    "You are Chef Qook, the culinary engine of the KOOQ meal-planning app. "
    "You write realistic, tasty home-cooking recipes. Always answer with valid JSON only."
)


# ---------------------------------------------------------------------------
# ENDPOINTS
# ---------------------------------------------------------------------------
@app.post("/generate-weekly-plan")
async def generate_weekly_plan(prefs: UserPrefsInput):
    lang = lang_name(prefs.language)
    modes = ", ".join(f"day {d}: {m}" for d, m in prefs.dayModes.items()) or "all days: premium"
    prompt = f"""Create a 7-day dinner menu. Write all text in {lang} (ai_image_prompt in English).
- Diet: {prefs.diet or 'none'}
- Budget: {prefs.budget}
- Household: {prefs.adultsCount} adults, {prefs.childrenCount} children (ingredient amounts for the whole household)
- Zero-waste level: {prefs.zeroWasteLevel}% (higher = reuse ingredients across days)
- Day modes: {modes} ('culinary' = chef-level, 'premium' = easy comfort food)
- NEVER use these dishes: {prefs.generationHistory[-60:]}
- Style inspiration (favorites): {prefs.favorite_titles}

Return JSON: {{"zero_waste_report": "short explanation of ingredient reuse", "days": [7 objects with "day_number" (0-6) plus these fields: {MEAL_SCHEMA}]}}"""

    try:
        data = await ai_json(CHEF_SYSTEM, prompt, temperature=0.9)
    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(status_code=502, detail=f"AI-fout: {e}")

    days = data.get("days", [])[:7]
    for i, d in enumerate(days):
        d.setdefault("day_number", i)
        mode = prefs.dayModes.get(str(i))
        if mode:
            d["mode"] = mode
        attach_recipe_id(d, prefs.diet, fallback_id=f"tmp_{i}_{abs(hash(d.get('title', '')))}")

    if prefs.user_id != "demo-user":
        try:
            supabase.table("weekly_plans").insert({
                "user_id": prefs.user_id, "zero_waste_report": data.get("zero_waste_report")
            }).execute()
        except Exception:
            print(traceback.format_exc())

    return {"status": "success", "days": days, "zero_waste_report": data.get("zero_waste_report", "")}


@app.post("/replace-meal")
async def replace_meal(req: ReplaceMealInput):
    lang = lang_name(req.language)
    prompt = f"""Create ONE replacement dinner for "{req.meal_title}". Write text in {lang} (ai_image_prompt in English).
- Diet: {req.diet or 'none'}
- Budget: {req.budget}
- Mode: {req.mode} ('culinary' = chef-level, 'premium' = easy comfort food)
- Must be clearly different from: {[req.meal_title] + req.exclude_titles[-60:]}
- Style inspiration: {req.favorite_titles}

Return JSON exactly in this shape: {MEAL_SCHEMA}"""
    try:
        meal = await ai_json(CHEF_SYSTEM, prompt, temperature=1.0)
    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(status_code=502, detail=f"AI-fout: {e}")
    meal["mode"] = req.mode
    attach_recipe_id(meal, req.diet, fallback_id=f"tmp_r_{abs(hash(meal.get('title', '')))}")
    return {"status": "success", "meal": meal}


@app.post("/generate-shopping-list")
async def generate_shopping_list(req: ShoppingListInput):
    lang = lang_name(req.language)
    meals_text = "\n".join(f"- {m.get('title')}: {json.dumps(m.get('ingredients', []), ensure_ascii=False)}"
                           for m in req.meals)
    prompt = f"""Combine these recipes into one shopping list in {lang}.
Merge duplicate ingredients, add up amounts, round to practical shop quantities,
and group by supermarket category (e.g. Groente & fruit, Vlees & vis, Zuivel, Voorraad).
Recipes:
{meals_text}

Return JSON: {{"categories": [{{"name": "...", "items": [{{"name": "...", "amount": 0, "unit": "..."}}]}}]}}"""
    try:
        data = await ai_json(CHEF_SYSTEM, prompt, temperature=0.2)
    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(status_code=502, detail=f"AI-fout: {e}")

    items = []
    for cat in data.get("categories", []):
        for it in cat.get("items", []):
            items.append({
                "id": f"item_{len(items)}",
                "name": it.get("name", ""),
                "amount": it.get("amount", ""),
                "unit": it.get("unit", ""),
                "category": cat.get("name", ""),
                "checked": False,
            })
    return {"status": "success", "items": items}


@app.post("/analyze-fridge")
async def analyze_fridge(req: FridgeScanInput):
    lang = lang_name(req.language)
    prompt = f"""Look at this photo of a fridge or ingredients. List the ingredients you can clearly see,
then suggest 3 dinners that mainly use them. Write text in {lang} (ai_image_prompt in English).
Diet: {req.diet or 'none'}.

Return JSON: {{"recognizedItems": ["..."], "suggestions": [3 objects in this shape: {MEAL_SCHEMA}]}}"""
    try:
        data = await ai_json(CHEF_SYSTEM, prompt, temperature=0.6, image_b64=req.image_data)
    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(status_code=502, detail=f"AI-fout: {e}")

    suggestions = data.get("suggestions", [])[:3]
    for i, s in enumerate(suggestions):
        s["mode"] = "magic"
        attach_recipe_id(s, req.diet, fallback_id=f"tmp_scan_{i}_{abs(hash(s.get('title', '')))}")
    return {"recognizedItems": data.get("recognizedItems", []), "suggestions": suggestions}


@app.post("/chat")
async def chat(req: ChatInput):
    lang = lang_name(req.language)
    history = "\n".join(
        f"{'Chef' if m.get('sender') == 'assistant' else 'User'}: {m.get('text', '')}"
        for m in req.messages[-12:]
    )
    system = (
        "You are the Qook sous-chef inside a meal-planning app. Be friendly, professional, short and practical. "
        f"Answer in {lang}. User status: {req.user_status}. Current screen: {req.current_view}. "
        f"Current diet preferences: {req.diet or 'none'}. Always answer with valid JSON only."
    )
    prompt = f"""Conversation so far:
{history}
User: {req.message}

If the user clearly asks to change their diet preferences, put the complete new list in "diet"; otherwise "diet" is null.
Return JSON: {{"reply": "your answer", "diet": null}}"""
    try:
        data = await ai_json(system, prompt, temperature=0.7)
    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(status_code=502, detail=f"AI-fout: {e}")
    return {"reply": data.get("reply", ""), "diet": data.get("diet")}


@app.post("/get-recipe-details")
async def get_recipe_details(req: dict):
    meal_id = req.get("meal_id")
    if not meal_id or str(meal_id).startswith("tmp_"):
        return {"status": "success", "details": {}}
    try:
        res = supabase.table("recipes").select("*").eq("id", meal_id).limit(1).execute()
        return {"status": "success", "details": res.data[0] if res.data else {}}
    except Exception:
        print(traceback.format_exc())
        return {"status": "success", "details": {}}


@app.post("/generate-image")
async def generate_image(req: ImageInput):
    """Geeft de opgeslagen foto terug, of maakt hem één keer aan.
    Werkt alleen voor gerechten die in de receptenbank staan, zodat er nooit
    onbeperkt foto's gegenereerd kunnen worden."""
    if req.recipe_id.startswith("tmp_"):
        raise HTTPException(status_code=404, detail="Recept staat niet in de receptenbank")
    try:
        return {"status": "success", "url": await get_or_create_image(req.recipe_id)}
    except HTTPException:
        raise
    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(status_code=502, detail=f"Foto genereren mislukt: {e}")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "ai_provider": AI_PROVIDER,
        "text_model": TEXT_MODEL,
        "images": "cloudflare" if (CF_ACCOUNT_ID and CF_API_TOKEN) else "niet ingesteld",
    }
