import React, { useEffect, useState } from 'react';
import { Meal, UserPreferences } from '../types';
import { generateFullRecipe, generateMealImage } from '../services/api';
import { Button, Badge } from './Shared';
import { Clock, Users, ArrowLeft, Heart, Wine, Utensils, Play, Loader2, Flame, Lock } from 'lucide-react';
import { useTranslation } from '../utils/i18n';

export const MealDetail: React.FC<any> = ({ 
    meal, isPremium, isFreeMeal, userPrefs, onBack, onStartCooking, onUnlock, isFavorite, onToggleFavorite 
}) => {
    const { t } = useTranslation(userPrefs.language || 'nl-NL');
    const [fullMeal, setFullMeal] = useState<any>(meal);
    const [loading, setLoading] = useState(false);
    
    // 1. Initialiseer imgUrl vanuit de meal data
    const [imgUrl, setImgUrl] = useState<string>(
        meal.image_url || meal.generated_image_url || meal.image || ''
    );

    const isLocked = !isPremium && !isFreeMeal;
    const isCulinaryMode = meal.mode === 'culinary';

    // EFFECT 1: Afbeelding laden/genereren via de centrale API service
    useEffect(() => {
        const loadImage = async () => {
            // Als we al een geldige URL hebben (geen oude Pollinations link), stop dan
            if (imgUrl && !imgUrl.includes('pollinations') && imgUrl !== '') return;

            // Roep de centrale functie aan (Gemini + DB save)
            const url = await generateMealImage(
                meal.id, 
                meal.title, 
                meal.ai_image_prompt || meal.title,
                meal.image_url
            );
            setImgUrl(url);
        };
        loadImage();
    }, [meal.id]);

    // EFFECT 2: Details (ingrediënten/stappen) laden
    useEffect(() => {
        const loadDetails = async () => {
            if (isLocked) return;
            
            // Gebruik data uit de Receptenbank als die al aanwezig is
            const hasInfo = fullMeal.ingredients && fullMeal.ingredients.length > 0 && 
                            fullMeal.steps && fullMeal.steps.length > 0;
            
            if (hasInfo) return;

            setLoading(true);
            try {
                const data = await generateFullRecipe(meal, userPrefs);
                setFullMeal({ ...fullMeal, ...data });
            } catch (e) {
                console.error("Fout bij laden receptdetails:", e);
            } finally {
                setLoading(false);
            }
        };
        loadDetails();
    }, [meal.id, isLocked]);

    return (
        <div className={`min-h-screen pb-40 ${isCulinaryMode ? 'bg-kooq-dark text-white' : 'bg-white text-kooq-dark'}`}>
            {/* Top Image Section */}
            <div className="relative h-80 md:h-[450px] overflow-hidden bg-kooq-white">
                {imgUrl ? (
                    <img 
                        src={imgUrl} 
                        className="w-full h-full object-cover animate-in fade-in duration-1000" 
                        alt={meal.title} 
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center bg-kooq-sand/10">
                        <Loader2 className="animate-spin text-kooq-sage/20" size={32} />
                    </div>
                )}
                <div className={`absolute inset-0 bg-gradient-to-t ${isCulinaryMode ? 'from-kooq-dark' : 'from-black/70'} to-transparent`} />
                
                <button 
                    onClick={onBack} 
                    className="absolute top-6 left-6 p-3 bg-white/90 backdrop-blur-md rounded-full text-kooq-dark shadow-xl z-20 active:scale-90 transition-transform"
                >
                    <ArrowLeft size={24} />
                </button>
                
                <div className="absolute bottom-10 left-6 right-6 text-white z-10">
                    <div className="flex gap-2 mb-3">
                        {isCulinaryMode && (
                            <div className="bg-kooq-clementine text-white px-3 py-1 rounded-full text-[8px] font-sans font-black uppercase tracking-[0.2em] shadow-lg flex items-center gap-1.5">
                                <Wine size={12} fill="currentColor" /> {t.chefs_edition}
                            </div>
                        )}
                    </div>
                    <h1 className="text-4xl md:text-5xl font-sans font-black tracking-tighter mb-2 leading-none">{meal.title}</h1>
                    <div className="flex gap-4 opacity-80 text-[10px] font-black uppercase tracking-widest">
                        <span className="flex items-center gap-1.5">
                            <Clock size={14}/> {meal.estimated_time_minutes || 30} MIN
                        </span>
                        <span className="flex items-center gap-1.5">
                            <Flame size={14}/> {meal.calories_per_portion || 500} KCAL
                        </span>
                    </div>
                </div>
            </div>

            <div className="max-w-4xl mx-auto px-6 pt-10">
                <p className="text-lg md:text-xl leading-relaxed mb-12 opacity-80 font-medium italic">
                    "{meal.short_description}"
                </p>

                {isLocked ? (
                    <div className="bg-kooq-dark p-10 rounded-[3rem] text-center text-white border border-white/10 shadow-2xl space-y-6">
                        <div className="w-16 h-16 bg-kooq-sage/20 rounded-2xl flex items-center justify-center mx-auto">
                            <Lock size={32} className="text-kooq-sage" />
                        </div>
                        <div className="space-y-2">
                            <h2 className="text-2xl font-black tracking-tighter">{t.unlock_now}</h2>
                            <p className="text-white/60 text-sm max-w-xs mx-auto">{t.premium_desc}</p>
                        </div>
                        <Button onClick={onUnlock} className="w-full max-w-sm mx-auto bg-kooq-sage border-none py-5 text-lg">{t.register_btn}</Button>
                    </div>
                ) : loading ? (
                    <div className="py-20 text-center flex flex-col items-center">
                        <Loader2 className="animate-spin mb-4 text-kooq-sage" size={48} />
                        <p className="font-black uppercase text-xs tracking-[0.2em] text-kooq-sage">{t.loading_recipe}</p>
                    </div>
                ) : (
                    <div className="grid md:grid-cols-2 gap-16">
                        {/* Ingrediënten Kolom */}
                        <section className="animate-in slide-in-from-bottom-4 duration-700">
                            <h3 className="text-2xl font-black mb-8 flex items-center gap-3 tracking-tighter">
                                <Utensils size={24} className="text-kooq-sage"/> {t.ingredients}
                            </h3>
                            <ul className="space-y-1">
                                {fullMeal.ingredients?.map((ing: any, i: number) => (
                                    <li key={i} className={`flex justify-between items-center py-4 border-b ${isCulinaryMode ? 'border-white/10' : 'border-kooq-slate/5'}`}>
                                        <span className="font-medium">{ing.name || ing.item}</span>
                                        <span className="font-sans font-black text-sm px-3 py-1 bg-kooq-sage/10 text-kooq-sage rounded-lg">
                                            {ing.amount} {ing.unit}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </section>

                        {/* Bereiding Kolom */}
                        <section className="animate-in slide-in-from-bottom-4 duration-700 delay-100">
                            <h3 className="text-2xl font-black mb-8 tracking-tighter">{t.preparation}</h3>
                            <div className="space-y-8">
                                {fullMeal.steps?.map((step: any, i: number) => (
                                    <div key={i} className="flex gap-6 group">
                                        <div className="w-10 h-10 bg-kooq-sage/20 rounded-2xl flex items-center justify-center font-black text-kooq-sage shrink-0 group-hover:bg-kooq-sage group-hover:text-white transition-colors duration-300">
                                            {step.step_index || i + 1}
                                        </div>
                                        <p className="text-md leading-relaxed pt-1 opacity-90">
                                            {step.user_text || step.text || step.instruction}
                                        </p>
                                    </div>
                                ))}
                            </div>
                            <Button 
                                onClick={() => onStartCooking(fullMeal)} 
                                className={`w-full mt-16 shadow-2xl py-6 rounded-[2rem] font-sans font-black text-lg uppercase tracking-widest active:scale-95 transition-all ${isCulinaryMode ? 'bg-kooq-clementine' : 'bg-kooq-dark'} text-white`}
                            >
                                <Play className="mr-3" fill="currentColor" size={24}/> {t.start_cooking}
                            </Button>
                        </section>
                    </div>
                )}
            </div>
        </div>
    );
};
