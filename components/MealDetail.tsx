import React, { useEffect, useState } from 'react';
import { Meal, UserPreferences } from '../types';
import { generateFullRecipe } from '../services/api';
import { Button, Badge, Card } from './Shared';
import { Clock, Flame, ArrowLeft, Lock, Utensils, Play, Check, Heart, Wine, Plus, Coffee, Sparkles, User, Mail, Key, Users, Zap, Star, Package, Layout, Wrench, Loader2 } from 'lucide-react';
import { useTranslation } from '../utils/i18n';

interface Props {
    meal: Meal;
    isPremium: boolean;
    isFreeMeal: boolean;
    userPrefs: UserPreferences;
    onBack: () => void;
    onStartCooking: (meal: Meal) => void;
    onShowPaywall: () => void;
    onToggleList: (mealId: string, checked: boolean) => void;
    isSelected: boolean;
    onSelectSuggestion: (meal: Meal) => void;
    isFavorite: boolean;
    onToggleFavorite: () => void;
    selectedMealIds: Set<string>;
    onUnlock: () => void;
}

export const MealDetail: React.FC<Props> = ({ 
    meal, isPremium, isFreeMeal, userPrefs, onBack, onStartCooking, onShowPaywall, onToggleList, isSelected, onSelectSuggestion, isFavorite, onToggleFavorite, selectedMealIds, onUnlock
}) => {
    const { t } = useTranslation(userPrefs.language || 'nl-NL');
    
    const [fullMeal, setFullMeal] = useState<Meal>(meal);
    const [loading, setLoading] = useState(false);
    
    // 1. BEELD LOGICA (Met fallback naar Pollinations als alles ontbreekt)
    const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(meal.title + " gourmet food photography, cinematic lighting")}?width=800&height=600&nologo=true`;
    const [imgUrl, setImgUrl] = useState<string>(
        meal.image_url || meal.generated_image_url || meal.image || fallbackUrl
    );
    
    // 2. DISPLAY CONSTANTS (Fallbacks voor DB vs AI veldnamen)
    const displayTime = fullMeal.estimated_time_minutes || (fullMeal as any).time || 30;
    const displayKcal = fullMeal.calories_per_portion || (fullMeal as any).calories || 500;
    const servings = fullMeal.servings || userPrefs.adultsCount + userPrefs.childrenCount || 2;

    const isCulinaryMode = meal.mode === 'culinary';
    const isLocked = !isPremium && !isFreeMeal;

    // EFFECT 1: Update lokale state als de prop verandert
    useEffect(() => {
        setFullMeal(meal);
        const photo = meal.image_url || meal.generated_image_url || meal.image || fallbackUrl;
        setImgUrl(photo);
    }, [meal]);

    // EFFECT 2: Smart Save & Fetch Details
    useEffect(() => {
        const fetchDetails = async () => {
            if (isLocked) return;

            // SMART SAVE: Als de afbeelding een Pollinations link is, sla hem op in de DB
            if (!meal.image_url && imgUrl.includes('pollinations') && !meal.id.toString().startsWith('meal-')) {
                fetch('https://qook-backend.onrender.com/save-meal-image', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ meal_id: meal.id, image_data: imgUrl })
                }).catch(err => console.error("Kon afbeelding niet opslaan in bank", err));
            }

            // FETCH DETAILS: Alleen als we nog geen stappen of ingrediënten hebben
            const hasDetails = fullMeal.steps && fullMeal.steps.length > 0 && fullMeal.ingredients && fullMeal.ingredients.length > 0;
            if (hasDetails) return;
            
            setLoading(true);
            try {
                const detailed = await generateFullRecipe(meal, userPrefs);
                setFullMeal(prev => ({ ...prev, ...detailed }));
            } catch (e) {
                console.error("Failed to load recipe details", e);
            } finally {
                setLoading(false);
            }
        };
        fetchDetails();
    }, [meal.id, isLocked]);

    return (
        <div className={`min-h-screen pb-40 animate-in slide-in-from-right-10 duration-500 relative ${isCulinaryMode ? 'bg-kooq-dark' : 'bg-white'}`}>
            {/* Header / Cover Image */}
            <div className="relative h-72 md:h-96 w-full overflow-hidden bg-kooq-white">
                <img src={imgUrl} className="w-full h-full object-cover" alt={meal.title} />
                <div className={`absolute inset-0 bg-gradient-to-t ${isCulinaryMode ? 'from-kooq-dark via-kooq-dark/20' : 'from-black/60'} to-transparent`}></div>
                
                <button onClick={onBack} className={`absolute top-6 left-6 p-3 ${isCulinaryMode ? 'bg-white/10 text-white' : 'bg-white/90 text-kooq-dark'} backdrop-blur-md rounded-full shadow-lg z-10 transition-transform active:scale-90`}>
                    <ArrowLeft size={24} />
                </button>
                
                <button 
                    onClick={onToggleFavorite}
                    className={`absolute top-6 right-6 p-3 ${isCulinaryMode ? 'bg-white/10' : 'bg-white/90'} backdrop-blur-md rounded-full shadow-lg z-10 transition-all active:scale-90`}
                >
                    <Heart size={24} className={isFavorite ? 'text-red-500 fill-current' : isCulinaryMode ? 'text-white' : 'text-kooq-dark'} />
                </button>

                <div className="absolute bottom-16 left-6 right-6 text-white">
                     <div className="flex gap-2 mb-3">
                        {isFreeMeal && userPrefs.subscriptionStatus === 'free' && <Badge variant="free">{t.free_this_week}</Badge>}
                        {isCulinaryMode && <div className="bg-kooq-clementine text-white px-3 py-1 rounded-full text-[8px] font-sans font-black uppercase tracking-[0.2em] shadow-lg flex items-center gap-1.5"><Wine size={12} fill="currentColor" /> {t.chefs_edition}</div>}
                        {meal.mode === 'magic' && <Badge variant="free">{t.choice_scan_title}</Badge>}
                     </div>
                     <h1 className="text-4xl font-sans font-black tracking-tighter leading-none mb-2">{meal.title}</h1>
                     <div className="flex items-center gap-4 opacity-70 text-[10px] font-sans font-black uppercase tracking-widest">
                        <span className="flex items-center gap-1.5"><Clock size={14} /> {displayTime} {t.unit_min}</span>
                        <span className="flex items-center gap-1.5"><Users size={14} /> {servings} {t.adults.toLowerCase()}</span>
                        <span className="flex items-center gap-1.5"><Flame size={14} /> {displayKcal} {t.unit_kcal}</span>
                     </div>
                </div>
            </div>

            {/* Content Section */}
            <div className={`max-w-4xl mx-auto -mt-10 relative ${isCulinaryMode ? 'bg-kooq-dark text-white' : 'bg-white'} rounded-t-[3rem] px-6 md:px-12 pt-10 shadow-2xl`}>
                <p className={`text-lg leading-relaxed mb-10 font-medium ${isCulinaryMode ? 'text-white/80' : 'text-kooq-slate'}`}>{meal.short_description}</p>

                {/* Wine Pairing */}
                {isCulinaryMode && fullMeal.wine_pairing && !isLocked && (
                    <div className="bg-white/5 backdrop-blur-xl p-8 rounded-[2.5rem] mb-10 border border-white/10 shadow-2xl relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-kooq-clementine opacity-20 blur-3xl -translate-y-1/2 translate-x-1/2"></div>
                        <div className="relative z-10 flex gap-6 items-center">
                            <div className="w-16 h-16 bg-kooq-clementine text-white rounded-2xl flex items-center justify-center shrink-0 shadow-lg group-hover:scale-110 transition-transform">
                                <Wine size={32} fill="currentColor" />
                            </div>
                            <div>
                                <h4 className="text-[10px] font-sans font-black text-kooq-clementine uppercase tracking-[0.3em] mb-1">{t.sommelier_suggestion}</h4>
                                <p className="text-xl font-sans font-black mb-1 text-white tracking-tighter">{fullMeal.wine_pairing.type}</p>
                                <p className="text-sm text-white/70 italic leading-snug">"{fullMeal.wine_pairing.description}"</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Plating Tips */}
                {isCulinaryMode && fullMeal.plating_tips && !isLocked && (
                    <div className="bg-kooq-clementine/10 p-8 rounded-[2.5rem] mb-10 border border-kooq-clementine/20 shadow-sm relative overflow-hidden group">
                        <div className="relative z-10 flex gap-6 items-center">
                            <div className="w-16 h-16 bg-kooq-dark text-kooq-clementine rounded-2xl flex items-center justify-center shrink-0 shadow-md group-hover:rotate-12 transition-transform">
                                <Layout size={32} />
                            </div>
                            <div>
                                <h4 className="text-[10px] font-sans font-black text-kooq-clementine uppercase tracking-[0.3em] mb-1">{t.plating_presentation}</h4>
                                <p className="text-sm text-white/90 leading-relaxed font-medium italic">"{fullMeal.plating_tips}"</p>
                            </div>
                        </div>
                    </div>
                )}

                {isLocked ? (
                    <div className={`${isCulinaryMode ? 'bg-white/5 border-white/10' : 'bg-kooq-dark'} p-8 rounded-[2.5rem] text-white text-center space-y-6 animate-in slide-in-from-bottom-4 shadow-2xl border`}>
                        <div className="w-16 h-16 bg-kooq-sage rounded-2xl flex items-center justify-center mx-auto shadow-lg"><Lock size={32} /></div>
                        <div>
                            <h2 className="text-2xl font-sans font-black mb-2 tracking-tighter">{t.unlock_now}</h2>
                            <p className="text-white/60 font-medium max-w-sm mx-auto mb-8">{t.premium_desc}</p>
                            <Button onClick={onUnlock} className="bg-kooq-sage border-none w-full max-w-sm mx-auto py-6 text-xl">{t.register_btn} & {t.unlock_now}</Button>
                        </div>
                    </div>
                ) : (
                    <>
                        {loading ? (
                            <div className="flex flex-col items-center py-24">
                                <Loader2 size={48} className={`mb-6 ${isCulinaryMode ? 'text-kooq-clementine' : 'text-kooq-sage'} animate-spin`} />
                                <p className={`${isCulinaryMode ? 'text-white/40' : 'text-kooq-slate'} font-sans font-black tracking-widest uppercase text-xs`}>{t.loading_recipe}</p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-12">
                                <div className="grid md:grid-cols-2 gap-12">
                                    {/* Ingredients */}
                                    <section>
                                        <div className="space-y-12">
                                            <div>
                                                <h3 className={`text-2xl font-sans font-black mb-6 flex items-center gap-3 tracking-tighter ${isCulinaryMode ? 'text-white' : 'text-kooq-dark'}`}>
                                                    <Utensils size={24} className={isCulinaryMode ? 'text-kooq-clementine' : 'text-kooq-sage'} /> {t.ingredients}
                                                </h3>
                                                <ul className="space-y-4">
                                                    {fullMeal.ingredients?.map((ing, i) => (
                                                        <li key={i} className={`flex justify-between items-center py-3 border-b ${isCulinaryMode ? 'border-white/10' : 'border-kooq-slate/10'} group`}>
                                                            <span className={`font-medium transition-colors ${isCulinaryMode ? 'text-white/80 group-hover:text-kooq-clementine' : 'text-kooq-dark group-hover:text-kooq-sage'}`}>{ing.name}</span>
                                                            <span className={`font-sans font-black px-3 py-1 rounded-lg text-sm border ${isCulinaryMode ? 'bg-white/5 text-kooq-clementine border-white/10' : 'bg-kooq-white text-kooq-slate border-kooq-slate/5'}`}>
                                                                {ing.amount} {ing.unit}
                                                            </span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        </div>
                                    </section>

                                    {/* Preparation Steps */}
                                    <section>
                                        <h3 className={`text-2xl font-sans font-black mb-6 tracking-tighter ${isCulinaryMode ? 'text-white' : 'text-kooq-dark'}`}>{t.preparation}</h3>
                                        <div className="space-y-8">
                                            {fullMeal.steps?.map((step) => (
                                                <div key={step.step_index} className="flex gap-6 group">
                                                    <div className={`flex-shrink-0 w-10 h-10 rounded-2xl flex items-center justify-center font-sans font-black text-lg transition-all duration-300 ${
                                                        isCulinaryMode 
                                                        ? 'bg-kooq-clementine/20 text-kooq-clementine group-hover:bg-kooq-clementine group-hover:text-white' 
                                                        : 'bg-kooq-sand/20 text-kooq-dark group-hover:bg-kooq-sage/20 group-hover:text-kooq-sage'
                                                    }`}>
                                                        {step.step_index}
                                                    </div>
                                                    <p className={`leading-relaxed font-medium pt-1.5 ${isCulinaryMode ? 'text-white/90' : 'text-kooq-dark'}`}>{step.user_text}</p>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="mt-12">
                                            <Button onClick={() => onStartCooking(fullMeal)} className={`w-full shadow-xl ${isCulinaryMode ? 'bg-kooq-clementine' : 'bg-kooq-dark'} text-white justify-center text-lg font-sans font-black tracking-widest rounded-3xl active:scale-95 transition-transform uppercase py-6`}>
                                                <Play size={24} fill="currentColor"/> {t.start_cooking}
                                            </Button>
                                        </div>
                                    </section>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};
