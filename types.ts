
export type Region = 'NL' | 'BE' | 'DE' | 'US' | 'UK' | 'FR' | 'ES';
export type UnitSystem = 'metric' | 'imperial';
export type Diet = 'Geen' | 'Vegetarisch' | 'Vegan' | 'Pescotarisch' | 'Halal' | 'Keto' | 'Paleo' | 'Glutenarm' | 'Lactosevrij' | 'Notenvrij' | 'Low-carb' | 'Anders';
export type Budget = 'Laag' | 'Normaal' | 'Luxe';
export type CookingTime = '15' | '30' | '45' | 'unlimited';
export type SubscriptionStatus = 'free' | 'basic' | 'premium' | 'culinary';
export type DayMode = 'premium' | 'culinary' | 'magic';

export interface UserPreferences {
  name?: string;
  region: Region;
  language: string;
  units: UnitSystem;
  adultsCount: number;
  childrenCount: number;
  diet: string[];
  customDiet?: string;
  budget: Budget;
  cookingTime: CookingTime;
  weekendCookingTime: CookingTime;
  kitchenProfiles: string[];
  weekProfile: string; 
  hasOnboarded: boolean;
  subscriptionStatus: SubscriptionStatus;
  trialStartedAt?: string; 
  favoriteIds?: string[];
  generationHistory?: string[]; // Titels van alle ooit geplande gerechten voor variatie
  zeroWasteLevel: number;
  partyGuests: number;
  dayModes: Record<number, DayMode>;
  gender?: 'male' | 'female';
  activityLevel?: 'low' | 'medium' | 'high';
  macro_ratio?: 'balanced' | 'high_protein' | 'low_carb';
  participatingMembers?: { partner: boolean; children: boolean[] };
  goals?: string[];
  weight?: number;
  height?: number;
  age?: number;
  dailyCalorieTarget?: number;
  bmr?: number;
  glycemicFocus?: boolean;
  sodiumLimit?: boolean;
  cholesterolManagement?: boolean;
  caloriePreference?: string;
}

export interface Usage {
  replacements: number;
  scans: number;
  fullRegenerations: number;
  lastRegenerationReset?: string; // ISO String
  week: number;
}

export interface Ingredient {
  name: string;
  amount: number;
  unit: string;
}

export interface Step {
  step_index: number;
  short_title?: string;
  user_text: string;
  estimated_duration_seconds: number;
  needs_timer: boolean;
}

export interface Nutrition {
  calories: number;
}

export interface Meal {
  id: string;
  title: string;
  short_description: string;
  selection_reason?: string; 
  ai_image_prompt: string; 
  generated_image_url?: string; 
  estimated_time_minutes: number;
  difficulty: 'Makkelijk' | 'Gemiddeld' | 'Gevorderd';
  calories_per_portion: number;
  servings?: number; 
  ingredients?: Ingredient[];
  steps?: Step[];
  supplies?: string[];
  nutrition?: Nutrition;
  wine_pairing?: {
    type: string;
    description: string;
  };
  plating_tips?: string;
  mode: DayMode;
}

export interface WeeklyPlan {
  days: Meal[];
  zero_waste_report?: string;
  generatedAt?: string; // ISO timestamp van generatie
}

export interface DayPlan {
  targetCalories: number;
  totalCalories: number;
  breakfast: Meal;
  lunch: Meal;
  dinner: Meal;
  snacks: Meal[];
}

export interface ShoppingItem {
  id: string;
  name: string;
  amount: number;
  unit: string;
  category: string;
  checked: boolean;
}

export interface FridgeScanResult {
  recognizedItems: string[];
  suggestions: Meal[];
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  isSystem?: boolean;
}
