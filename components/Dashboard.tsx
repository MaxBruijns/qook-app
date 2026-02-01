import React, { useState, useEffect } from 'react';
import { Meal, WeeklyPlan, DayMode, SubscriptionStatus, Usage } from '../types';
import { Card, Badge, Button } from './Shared';
import { Clock, Flame, ShoppingBag, Sparkles, Check, Lock, RefreshCw, Wine, Star, Loader2, ChevronDown, ChevronUp, Leaf, X } from 'lucide-react';
import { useTranslation } from '../utils/i18n';

// Sub-component voor een individueel gerecht
export const MealCard: React.FC<{ 
    meal: Meal, 
    dayIndex?: number,
    onClick: (m: Meal) => void, 
    selectedMealIds: Set<string>, 
    onToggleShopItem: (id: string, s: boolean) => void, 
    onReplace?: (m: Meal, idx: number) => void,
    t: any,
    isLocked?: boolean,
    language: string,
    isReplacing?: boolean,
    showDayLabel?: boolean,
    userStatus?: SubscriptionStatus,
    replacementsUsed?: number
}> = ({ meal, dayIndex, onClick, selectedMealIds, onToggleShopItem, onReplace, t, isLocked, language, isReplacing, showDayLabel = true, userStatus, replacementsUsed = 0 }) => {
    
    // 1. AFBEELDING LOGICA
    // We kijken eerst in de database (image_url), dan naar de AI-prompt generatie
    const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(meal.title + " gourmet food photography, high quality, cinematic lighting")}?width=800&height=600&nologo=true`;
    const imgUrl = meal.image_url || meal.generated_image_url || meal.image || fallbackUrl;
    
    // 2. DATA FALLBACKS (Voor compatibiliteit tussen DB en AI namen)
    const displayTime = meal.estimated_time_minutes || (meal as any).time || 30;
    const displayKcal = meal.calories_per_portion || (meal as any).calories || 500;

    // 3. SMART SAVE: Als de foto gegenereerd is maar nog niet in de DB staat, sla hem op in de bank
    useEffect(() => {
        if (!meal.image_url && imgUrl.includes('pollinations') && !meal.id.toString().startsWith('meal-')) {
            fetch('https://qook-backend.onrender.com/save-meal-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ meal_id: meal.id, image_data: imgUrl })
            }).catch(err => console.error("Kon afbeelding niet opslaan in receptenbank:", err));
        }
    }, [meal.id, imgUrl]);

    const isMealSelected = selectedMealIds.has(meal.id);
    const isCulinary = meal.mode === 'culinary';
    const dayName = (showDayLabel && dayIndex !== undefined) ? t[`day_short_${dayIndex}`] : null;

    const hasLimit = userStatus === 'basic' || userStatus === 'free';
    const isReplacementLocked = hasLimit && replacementsUsed >= 3;
    const remaining = 3 - replacementsUsed;

    return (
        <Card 
            className={`group relative flex flex-col h-full transition-all duration-500 overflow-hidden rounded-[2.5rem] border-2 ${
                isCulinary 
                ? 'border-kooq-clementine/20 hover:border-kooq-clementine/40 shadow-xl' 
                : 'border-kooq-slate/5 hover:border-kooq-sage/20 shadow-lg'
            }`} 
            onClick={() => !isReplacing && onClick(meal)}
        >
            {isLocked && (
                <div className="absolute inset-0 z-20 bg-kooq-dark/40 backdrop-blur-[3px] flex flex-col items-center justify-center p-6 text-center">
                    <div className="bg-white/95 p-5 rounded-2xl shadow-2xl flex flex-col items-center gap-3">
                        <Lock size={20} className="text-kooq-sage" />
                        <span className="text-[10px] font-sans font-black uppercase tracking-widest text-kooq-dark">Ontgrendelen</span>
                    </div>
                </div>
            )}
            
            {isReplacing && ( 
                <div className="absolute inset-0 z-30 bg-white/60 backdrop-blur-sm flex items-center justify-center">
                    <RefreshCw size={32} className="text-kooq-sage animate-spin" />
                </div> 
            )}
            
            <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 items-start">
                {dayName && (
                    <div className={`px-4 py-1.5 rounded-full text-[10px] font-sans font-black shadow-sm ${
                        isCulinary ? 'bg-kooq-clementine text-white' : 'bg-white/90 text-kooq-dark'
                    }`}>
                        {dayName}
                    </div>
                )}
            </div>

            <div className="relative h-60 overflow-hidden bg-kooq-sand/10">
                <img 
                    src={imgUrl} 
                    alt={meal.title} 
                    className={`w-full h-full object-cover transition-transform duration-[2000ms] group-hover:scale-110 ${isCulinary ? 'opacity-90' : ''}`} 
                />
                {isCulinary && <div className="absolute inset-0 bg-gradient-to-t from-kooq-dark/80 to-transparent" />}
            </div>

            <div className={`p-8 flex flex-col flex-grow relative ${isCulinary ? 'bg-kooq-dark text-white' : 'bg-white text-kooq-dark'}`}>
                <h3 className="text-2xl font-sans font-black mb-2 leading-[1.1] tracking-tighter">
                    {meal.title}
                </h3>
                <p className="text-xs mb-6 line-clamp-2 font-medium opacity-70">
                    {meal.short_description}
                </p>
                
                <div className="flex items-center gap-5 text-[10px] font-sans font-black mb-6">
                    <span className="flex items-center gap-2">
                        <Clock size={16} className="text-kooq-sage"/> 
                        {displayTime} {t.unit_min.toUpperCase()}
                    </span>
                    <span className="flex items-center gap-2">
                        <Flame size={16} className="text-kooq-clementine"/> 
                        {displayKcal} {t.unit_kcal.toUpperCase()}
                    </span>
                </div>

                {!isLocked && (
                    <div className="mt-auto pt-6 border-t border-kooq-slate/5" onClick={e => e.stopPropagation()}>
                        <label className="flex items-center justify-between cursor-pointer group/label">
                            <div className="flex items-center gap-3" onClick={() => onToggleShopItem(meal.id, !isMealSelected)}>
                                <div className={`w-7 h-7 rounded-xl border-2 flex items-center justify-center transition-all ${
                                    isMealSelected 
                                    ? 'bg-kooq-sage border-kooq-sage text-white' 
                                    : 'border-kooq-slate/10 bg-kooq-white'
                                }`}>
                                    {isMealSelected && <Check size={16} className="stroke-[4]" />}
                                </div>
                                <span className={`text-[10px] font-sans font-black uppercase tracking-tight ${isMealSelected ? 'text-kooq-sage' : 'text-kooq-slate'}`}>
                                    {isMealSelected ? t.selected : t.on_list}
                                </span>
                            </div>
                        </label>
                    </div>
                )}
            </div>
        </Card>
    );
};

export default function Dashboard({ plan, userStatus, trialStartedAt, onUnlock, onMealSelect, selectedMealIds, onToggleShopItem, onGenerateList, onReplaceMeal, language, dayModes, onUpdateDayMode, onRegenerate, replacingId, onShowPaywall, agendaRef, usage }: { plan: WeeklyPlan, userStatus: SubscriptionStatus, trialStartedAt?: string, onUnlock: () => void, onMealSelect: (m: Meal) => void, selectedMealIds: Set<string>, onToggleShopItem: (id: string, s: boolean) => void, onGenerateList: () => void, onReplaceMeal: (m: Meal, idx: number) => void, language: string, dayModes: Record<number, DayMode>, onUpdateDayMode: (idx: number, mode: DayMode) => void, onRegenerate: () => void, replacingId: string | null, onShowPaywall: () => void, agendaRef: React.RefObject<HTMLElement | null>, usage: Usage }) {
  const { t } = useTranslation(language);
  const [isAgendaExpanded, setIsAgendaExpanded] = useState(false);
  const [reportDismissedFor, setReportDismissedFor] = useState<string | null>(null);
  
  const isTrialActive = (userStatus === 'free') || (userStatus === 'basic' && !!trialStartedAt);
  const hasPayingStatus = userStatus === 'premium' || userStatus === 'culinary' || userStatus === 'basic';
  const planId = plan?.days?.[0]?.id || 'initial';

  // VEILIGHEIDSCHECK: Als plan null is (door backend error), toon een laadscherm of error
  if (!plan || !plan.days) {
    return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-10">
            <Loader2 size={48} className="text-kooq-sage animate-spin mb-4" />
            <h2 className="text-2xl font-sans font-black text-kooq-dark">Recepten laden uit de bank...</h2>
        </div>
    );
  }

  return (
    <div className="p-6 pb-32 max-w-7xl mx-auto space-y-12">
      {/* Trial / Info Banner */}
      {isTrialActive && (
        <div className="bg-kooq-sage/10 border border-kooq-sage/20 rounded-[2rem] p-6 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4">
                <Sparkles size={24} className="text-kooq-sage" />
                <div>
                    <h3 className="text-lg font-sans font-black text-kooq-dark">{userStatus === 'free' ? t.discover_free : t.trial_active_badge}</h3>
                    <p className="text-[10px] font-sans font-black text-kooq-slate uppercase tracking-widest opacity-70">Dagelijkse limieten actief</p>
                </div>
            </div>
            <div className="flex gap-4">
                <div className="bg-white px-5 py-2 rounded-2xl border border-kooq-slate/5 text-center min-w-[100px]">
                    <span className="block text-[8px] font-sans font-black text-kooq-slate uppercase">{t.replacements_label}</span>
                    <span className="text-lg font-sans font-black">{Math.max(0, 3 - usage.replacements)}</span>
                </div>
            </div>
            <Button onClick={userStatus === 'free' ? onUnlock : onShowPaywall} className="px-8 py-3 font-sans font-black text-xs uppercase tracking-widest">
                {userStatus === 'free' ? t.unlock_week_menu : t.upgrade_unlimited}
            </Button>
        </div>
      )}

      {/* Zero-Waste Report */}
      {hasPayingStatus && plan.zero_waste_report && reportDismissedFor !== planId && (
        <div className="bg-white rounded-[2.5rem] p-8 border border-kooq-sage/20 shadow-xl relative flex flex-col md:flex-row items-center gap-8">
            <button onClick={() => setReportDismissedFor(planId)} className="absolute top-6 right-6 p-2 text-kooq-slate/30 hover:text-kooq-slate transition-all">
                <X size={20} />
            </button>
            <div className="w-16 h-16 bg-kooq-sage/10 text-kooq-sage rounded-2xl flex items-center justify-center shrink-0">
                <Leaf size={32} />
            </div>
            <div className="space-y-2 flex-1">
                <h3 className="text-xl font-sans font-black text-kooq-dark tracking-tighter">Zero-Waste Rapport</h3>
                <p className="text-sm font-medium text-kooq-slate leading-relaxed italic pr-8">"{plan.zero_waste_report}"</p>
            </div>
        </div>
      )}

      {/* Weekmenu Grid */}
      <section>
          <div className="mb-10 flex flex-col border-b border-kooq-slate/10 pb-6">
              <h2 className="text-4xl font-sans font-black text-kooq-dark tracking-tighter mb-2">
                  {t.week_menu}
              </h2>
              <p className="text-[10px] font-sans font-black text-kooq-sage uppercase tracking-[0.3em]">{t.personalized_for_you}</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-6 gap-10">
              {plan.days.map((meal: Meal, idx: number) => (
                  <div key={meal.id || idx} className={idx < 3 ? "col-span-1 md:col-span-2" : "col-span-1 md:col-span-3"}>
                      <MealCard 
                        meal={meal} 
                        dayIndex={idx} 
                        onClick={(m) => (userStatus === 'free' && idx > 0) ? onUnlock() : onMealSelect(m)} 
                        selectedMealIds={selectedMealIds} 
                        onToggleShopItem={onToggleShopItem} 
                        onReplace={onReplaceMeal} 
                        t={t} 
                        language={language} 
                        isLocked={userStatus === 'free' && idx > 0} 
                        isReplacing={replacingId === meal.id} 
                        userStatus={userStatus}
                        replacementsUsed={(userStatus === 'basic' || userStatus === 'free') ? usage.replacements : 0}
                      />
                  </div>
              ))}
          </div>
      </section>

      {/* Boodschappenlijst Floating Action Button */}
      {selectedMealIds.size > 0 && (
          <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-40 w-full max-w-md px-6">
              <button 
                  onClick={onGenerateList} 
                  className="w-full bg-kooq-sage text-white shadow-2xl h-16 rounded-full text-lg font-sans font-black flex items-center justify-center gap-4 active:scale-95 transition-all uppercase"
              >
                  <ShoppingBag size={24} /> 
                  {t.create_shop_list} ({selectedMealIds.size})
              </button>
          </div>
      )}
    </div>
  );
}
Dashboard.MealCard = MealCard;
