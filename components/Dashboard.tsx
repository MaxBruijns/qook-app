
import React, { useState, useEffect } from 'react';
import { Meal, WeeklyPlan, DayMode, SubscriptionStatus, Usage } from '../types';
import { Card, Badge, Button } from './Shared';
import { Clock, Flame, ShoppingBag, Sparkles, Check, Lock, Zap, Leaf, RefreshCw, Wine, Wand2, Crown, Star, Loader2, ChevronDown, ChevronUp, UtensilsCrossed, AlertCircle, Info, X } from 'lucide-react';
import { useTranslation } from '../utils/i18n';
import { generateMealImage } from '../services/geminiService';

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
    
    // 1. Gebruik direct de URL uit de API-mapper
    const imgUrl = meal.generated_image_url || meal.image_url || meal.image;
    
    // 2. Geen laadtijd meer nodig voor AI
    const loading = false; 

    // 3. Afgeleide variabelen
    const isMealSelected = selectedMealIds.has(meal.id);
    const isCulinary = meal.mode === 'culinary';
    const isMagic = meal.mode === 'magic';
    const dayName = (showDayLabel && dayIndex !== undefined) ? t[`day_short_${dayIndex}`] : null;

    const hasLimit = userStatus === 'basic' || userStatus === 'free';
    const isReplacementLocked = hasLimit && replacementsUsed >= 3;
    const remaining = 3 - replacementsUsed;

    return (
        <Card 
            className={`flex flex-col h-full group overflow-hidden relative transition-all duration-700 border-2 ${
                isCulinary 
                ? 'border-kooq-clementine/30 shadow-[0_20px_40px_-15px_rgba(243,165,103,0.15)] bg-kooq-dark ring-1 ring-white/5' 
                : isMagic 
                ? 'border-kooq-sage/30 bg-kooq-sage/5' 
                : 'border-white/50 bg-white shadow-sm'
            } ${isLocked ? 'hover:shadow-none' : 'hover:translate-y-[-4px] hover:shadow-xl'} ${isReplacing ? 'opacity-50 pointer-events-none' : ''}`} 
            onClick={() => !isReplacing && onClick(meal)}
        >
            {isLocked && (
                <div className="absolute inset-0 z-20 bg-kooq-dark/40 backdrop-blur-[3px] flex flex-col items-center justify-center p-6 text-center group-hover:bg-kooq-dark/50 transition-colors duration-300">
                    <div className="bg-white/95 backdrop-blur-md p-5 rounded-2xl shadow-2xl flex flex-col items-center gap-3 transform group-hover:scale-105 transition-transform">
                        <div className="w-10 h-10 bg-kooq-sage/10 rounded-full flex items-center justify-center text-kooq-sage">
                            <Lock size={20} />
                        </div>
                        <span className="text-[10px] font-sans font-black uppercase tracking-[0.2em] text-kooq-dark">Ontgrendelen</span>
                    </div>
                </div>
            )}
            
            {isReplacing && ( 
                <div className="absolute inset-0 z-30 bg-white/40 backdrop-blur-sm flex items-center justify-center">
                    <RefreshCw size={32} className="text-kooq-sage animate-spin" />
                </div> 
            )}
            
            <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 pointer-events-none items-start">
                {dayName && (
                    <div className={`px-4 py-1.5 rounded-full text-[10px] font-sans font-black shadow-sm border ${
                        isCulinary 
                        ? 'bg-kooq-clementine text-white border-white/20' 
                        : 'bg-white/90 backdrop-blur-md text-kooq-dark border-kooq-slate/5'
                    }`}>
                        {dayName}
                    </div>
                )}
                {isCulinary && (
                    <div className="bg-kooq-dark/80 backdrop-blur-md text-kooq-clementine px-4 py-1.5 rounded-full text-[8px] font-sans font-black uppercase tracking-[0.2em] shadow-lg flex items-center gap-2 border border-kooq-clementine/20">
                        <Wine size={12} fill="currentColor" /> {t.chefs_edition}
                    </div>
                )}
            </div>

            {!isLocked && onReplace && dayIndex !== undefined && (
                <div className="absolute top-4 right-4 z-20 flex flex-col items-end gap-2">
                    <button 
                        onClick={(e) => { e.stopPropagation(); onReplace(meal, dayIndex); }} 
                        className={`group/btn h-10 px-4 rounded-full flex items-center gap-2 shadow-lg transition-all active:scale-95 ${
                            isReplacementLocked 
                            ? 'bg-kooq-slate/20 text-kooq-slate cursor-not-allowed border border-kooq-slate/10' 
                            : isCulinary 
                            ? 'bg-white/10 hover:bg-kooq-clementine text-white backdrop-blur-md border border-white/20'
                            : 'bg-white/95 backdrop-blur-md text-kooq-dark hover:bg-kooq-sage hover:text-white border border-white'
                        }`}
                        disabled={isReplacing}
                    >
                        {isReplacementLocked ? <Lock size={14} /> : <RefreshCw size={14} className="group-hover/btn:rotate-180 transition-transform duration-700" />}
                        <span className="text-[9px] font-sans font-black uppercase tracking-widest">
                            {isReplacementLocked ? t.limit_reached : `${t.replace_btn} ${hasLimit ? `(${remaining})` : ''}`}
                        </span>
                    </button>
                </div>
            )}

            <div className={`relative h-60 overflow-hidden ${isCulinary ? 'bg-kooq-dark' : 'bg-kooq-sand/10'}`}>
                {loading ? (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-kooq-white/50">
                        <Loader2 size={32} className="text-kooq-sage animate-spin" />
                    </div>
                ) : ( 
                    <>
                        <img 
                            src={imgUrl!} 
                            alt={meal.title} 
                            className={`w-full h-full object-cover transition-transform duration-[2000ms] group-hover:scale-110 ${isCulinary ? 'opacity-80' : ''}`} 
                        />
                        {isCulinary && (
                            <div className="absolute inset-0 bg-gradient-to-t from-kooq-dark via-transparent to-transparent opacity-80" />
                        )}
                    </>
                )}
            </div>

            <div className={`p-8 flex flex-col flex-grow transition-colors relative ${isCulinary ? 'bg-kooq-dark text-white' : 'bg-white text-kooq-dark'}`}>
                {isCulinary && (
                    <div className="absolute top-0 right-0 w-32 h-32 bg-kooq-clementine opacity-[0.03] blur-3xl pointer-events-none" />
                )}
                
                <h3 className={`text-2xl font-sans font-black mb-2 leading-[1.1] tracking-tighter ${isCulinary ? 'text-white italic' : 'text-kooq-dark'}`}>
                    {meal.title}
                </h3>
                <p className={`text-xs mb-6 line-clamp-2 font-medium leading-relaxed opacity-70 ${isCulinary ? 'text-white/70' : 'text-kooq-slate'}`}>
                    {meal.short_description}
                </p>
                
                <div className="flex items-center gap-5 text-[10px] font-sans font-black mb-6">
                    <span className="flex items-center gap-2">
                        <Clock size={16} className={isCulinary ? 'text-kooq-clementine' : 'text-kooq-sage'}/> 
                        {meal.estimated_time_minutes} {t.unit_min.toUpperCase()}
                    </span>
                    <span className="flex items-center gap-2">
                        <Flame size={16} className={isCulinary ? 'text-white/40' : 'text-kooq-clementine'}/> 
                        {meal.calories_per_portion} {t.unit_kcal.toUpperCase()}
                    </span>
                </div>

                {!isLocked && (
                    <div className={`mt-auto pt-6 border-t ${isCulinary ? 'border-white/10' : 'border-kooq-slate/5'}`} onClick={e => e.stopPropagation()}>
                        <label className="flex items-center justify-between cursor-pointer select-none group/label">
                            <div className="flex items-center gap-3" onClick={() => onToggleShopItem(meal.id, !isMealSelected)}>
                                <div className={`w-7 h-7 rounded-xl border-2 flex items-center justify-center transition-all duration-300 ${
                                    isMealSelected 
                                    ? isCulinary ? 'bg-kooq-clementine border-kooq-clementine text-white shadow-[0_0_15px_rgba(243,165,103,0.4)]' : 'bg-kooq-sage border-kooq-sage text-white' 
                                    : isCulinary ? 'border-white/20 bg-white/5' : 'border-kooq-slate/10 bg-kooq-white'
                                }`}>
                                    {isMealSelected && <Check size={16} className="stroke-[4]" />}
                                </div>
                                <span className={`text-[10px] font-sans font-black uppercase tracking-tight transition-colors ${
                                    isMealSelected 
                                    ? isCulinary ? 'text-kooq-clementine' : 'text-kooq-sage' 
                                    : isCulinary ? 'text-white/40 group-hover/label:text-white' : 'text-kooq-slate group-hover/label:text-kooq-dark'
                                }`}>
                                    {isMealSelected ? t.selected : t.on_list}
                                </span>
                            </div>
                            {!isMealSelected && isCulinary && <Star size={12} className="text-kooq-clementine/40" />}
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
  
  const isCulinarySubscriber = userStatus === 'culinary';
  const isTrialActive = (userStatus === 'free') || (userStatus === 'basic' && !!trialStartedAt);
  const isVisitor = userStatus === 'free';
  const hasPayingStatus = userStatus === 'premium' || userStatus === 'culinary' || userStatus === 'basic';

  // Use the ID of the first meal as a proxy for the unique plan ID
  const planId = plan.days[0]?.id || 'initial';

  // Reset report visibility when a new plan is loaded
  useEffect(() => {
    if (planId !== reportDismissedFor) {
      // Logic for showing report automatically is handled by the render check below
    }
  }, [planId]);

  return (
    <div className="p-6 pb-32 max-w-7xl mx-auto space-y-12">
      {isTrialActive && (
        <div className="bg-kooq-sage/10 border border-kooq-sage/20 rounded-[2rem] p-6 flex flex-col md:flex-row items-center justify-between gap-6 animate-in slide-in-from-top-4 duration-500">
            <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-kooq-sage rounded-2xl flex items-center justify-center text-white shadow-lg">
                    <Sparkles size={24} />
                </div>
                <div>
                    <h3 className="text-lg font-sans font-black text-kooq-dark tracking-tighter leading-tight">{isVisitor ? t.discover_free : t.trial_active_badge}</h3>
                    <p className="text-[10px] font-sans font-black text-kooq-slate uppercase tracking-widest opacity-70">{t.premium_features_limit}</p>
                </div>
            </div>
            <div className="flex gap-4">
                <div className="bg-white px-5 py-3 rounded-2xl shadow-sm border border-kooq-slate/5 text-center min-w-[120px]">
                    <span className="block text-[8px] font-sans font-black text-kooq-slate uppercase tracking-widest mb-1">{t.replacements_label}</span>
                    <span className="text-xl font-sans font-black text-kooq-dark tracking-tighter">{Math.max(0, 3 - usage.replacements)} <span className="text-xs opacity-40">{t.remaining}</span></span>
                </div>
                <div className="bg-white px-5 py-3 rounded-2xl shadow-sm border border-kooq-slate/5 text-center min-w-[120px]">
                    <span className="block text-[8px] font-sans font-black text-kooq-slate uppercase tracking-widest mb-1">{t.scans_label}</span>
                    <span className="text-xl font-sans font-black text-kooq-dark tracking-tighter">{Math.max(0, 1 - usage.scans)} <span className="text-xs opacity-40">{t.remaining}</span></span>
                </div>
            </div>
            <Button 
                onClick={isVisitor ? onUnlock : onShowPaywall} 
                className="px-8 py-4 font-sans font-black text-xs uppercase tracking-widest"
            >
                {isVisitor ? t.unlock_week_menu : t.upgrade_unlimited}
            </Button>
        </div>
      )}

      {/* Zero-Waste Report Section - Only show if not dismissed for this plan */}
      {hasPayingStatus && plan?.zero_waste_report && reportDismissedFor !== planId && (
        <div className="bg-white rounded-[2.5rem] p-8 border border-kooq-sage/20 shadow-xl animate-in slide-in-from-left duration-700 relative overflow-hidden flex flex-col md:flex-row items-center gap-8">
            <div className="absolute top-0 left-0 w-32 h-32 bg-kooq-sage/5 blur-3xl pointer-events-none" />
            
            {/* Dismiss Button */}
            <button 
                onClick={() => setReportDismissedFor(planId)}
                className="absolute top-6 right-6 p-2 text-kooq-slate/30 hover:text-kooq-slate hover:bg-kooq-slate/5 rounded-full transition-all"
            >
                <X size={20} />
            </button>

            <div className="w-20 h-20 bg-kooq-sage/10 text-kooq-sage rounded-3xl flex items-center justify-center shrink-0">
                <Leaf size={40} className="animate-bounce" />
            </div>
            <div className="space-y-3 flex-1">
                <div className="flex items-center gap-2">
                    <h3 className="text-2xl font-sans font-black text-kooq-dark tracking-tighter">Zero-Waste Rapport</h3>
                    <div className="bg-kooq-sage/20 text-kooq-sage px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest">Intelligent</div>
                </div>
                <p className="text-sm font-medium text-kooq-slate leading-relaxed italic pr-8">
                    "{plan.zero_waste_report}"
                </p>
                <div className="pt-2 flex items-center gap-4">
                    <div className="flex items-center gap-1.5 text-[9px] font-black text-kooq-sage uppercase tracking-widest">
                        <Check size={12} /> Maximale hergebruik
                    </div>
                    <div className="flex items-center gap-1.5 text-[9px] font-black text-kooq-sage uppercase tracking-widest">
                        <Check size={12} /> Geen loze verpakkingen
                    </div>
                </div>
            </div>
        </div>
      )}

      {isCulinarySubscriber && (
        <section ref={agendaRef} className="transition-all duration-700">
            {!isAgendaExpanded ? (
                <button 
                    onClick={() => setIsAgendaExpanded(true)}
                    className="w-full bg-kooq-dark text-white rounded-[2.5rem] p-8 border border-white/5 shadow-2xl flex items-center justify-between group transition-all hover:scale-[1.01] hover:shadow-kooq-clementine/5 active:scale-95 relative overflow-hidden"
                >
                    <div className="absolute top-0 right-0 w-64 h-64 bg-kooq-clementine opacity-5 blur-[100px] -translate-y-1/2 translate-x-1/2" />
                    <div className="flex items-center gap-6 relative z-10">
                        <div className="w-16 h-16 bg-kooq-dark text-kooq-clementine rounded-[1.5rem] border border-white/10 flex items-center justify-center shadow-2xl group-hover:rotate-6 transition-transform">
                            <Wine size={32} fill="currentColor" />
                        </div>
                        <div className="text-left">
                            <h2 className="text-2xl font-sans font-black tracking-tighter text-white group-hover:text-kooq-clementine transition-colors">{t.agenda_title}</h2>
                            <p className="text-[10px] font-sans font-black text-white/40 uppercase tracking-[0.3em]">{t.agenda_subtitle}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 bg-white/5 px-6 py-3 rounded-2xl text-[10px] font-sans font-black uppercase tracking-[0.2em] border border-white/10 group-hover:bg-white/10 transition-colors">
                        <ChevronDown size={14} className="group-hover:translate-y-0.5 transition-transform" />
                    </div>
                </button>
            ) : (
                <div className="bg-kooq-dark rounded-[3rem] p-10 border border-white/10 shadow-3xl animate-in fade-in zoom-in duration-500 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-96 h-96 bg-kooq-sage opacity-5 blur-[120px] -translate-y-1/2 -translate-x-1/2" />
                    <div className="absolute bottom-0 right-0 w-96 h-96 bg-kooq-clementine opacity-5 blur-[120px] translate-y-1/2 translate-x-1/2" />
                    
                    <div className="flex items-center justify-between mb-10 relative z-10">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-kooq-clementine/10 rounded-2xl flex items-center justify-center text-kooq-clementine">
                                <Wine size={24} fill="currentColor" />
                            </div>
                            <h2 className="text-3xl font-sans font-black text-white tracking-tighter">{t.agenda_title}</h2>
                        </div>
                        <button onClick={() => setIsAgendaExpanded(false)} className="text-white/40 hover:text-white p-3 rounded-full hover:bg-white/5 transition-colors">
                            <ChevronUp size={28} />
                        </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-7 gap-4 mb-10 relative z-10">
                        {[0,1,2,3,4,5,6].map(i => (
                            <div key={i} className="space-y-4">
                                <div className="text-center text-[11px] font-sans font-black text-white/30 uppercase tracking-[0.3em]">{t[`day_short_${i}`]}</div>
                                <div className="flex flex-col gap-3">
                                    {(['premium', 'culinary'] as DayMode[]).map(mode => (
                                        <button 
                                            key={mode} 
                                            onClick={() => onUpdateDayMode(i, mode)} 
                                            className={`h-14 rounded-2xl flex items-center justify-center transition-all border-2 ${
                                                dayModes[i] === mode 
                                                ? mode === 'culinary' 
                                                    ? 'bg-kooq-dark border-kooq-clementine text-kooq-clementine shadow-[0_0_20px_rgba(243,165,103,0.2)]' 
                                                    : 'bg-kooq-sage border-kooq-sage text-white shadow-[0_0_20px_rgba(148,183,157,0.2)]' 
                                                : 'bg-white/5 border-transparent text-white/20 hover:bg-white/10 hover:text-white/40'
                                            }`}
                                        >
                                            <div className="flex flex-col items-center gap-1">
                                                {mode === 'culinary' ? <Wine size={14} /> : <Crown size={14} />}
                                                <span className="text-[8px] font-sans font-black uppercase tracking-widest">{mode === 'culinary' ? t.plan_culinary.toUpperCase() : t.plan_premium.toUpperCase()}</span>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="flex flex-col sm:flex-row justify-center pt-8 border-t border-white/10 gap-4 relative z-10">
                        <Button onClick={() => setIsAgendaExpanded(false)} variant="ghost" className="h-14 px-10 text-white/60 hover:text-white font-sans font-black text-[10px] uppercase tracking-[0.3em]">{t.cancel}</Button>
                        <Button onClick={() => { onRegenerate(); setIsAgendaExpanded(false); }} className="h-14 px-12 bg-kooq-clementine text-white shadow-2xl shadow-kooq-clementine/20 font-sans font-black text-[10px] uppercase tracking-[0.3em]"> 
                            <RefreshCw size={18} className="mr-2" /> {t.regenerate_menu} 
                        </Button>
                    </div>
                </div>
            )}
        </section>
      )}

      <section>
          <div className="mb-10 flex items-end justify-between border-b border-kooq-slate/10 pb-6">
              <div>
                  <h2 className="text-4xl font-sans font-black text-kooq-dark tracking-tighter leading-none mb-3">
                      {t.week_menu}
                  </h2>
                  <p className="text-[10px] font-sans font-black text-kooq-sage uppercase tracking-[0.3em]">{t.personalized_for_you}</p>
              </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-6 gap-10">
              {plan.days.map((meal: Meal, idx: number) => (
                  <div key={meal.id} className={idx < 3 ? "col-span-1 md:col-span-2" : "col-span-1 md:col-span-3"}>
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

      {selectedMealIds.size > 0 && (
          <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-40 w-full max-w-md px-6 animate-in slide-in-from-bottom-10 duration-700">
              <button 
                  onClick={onGenerateList} 
                  className="w-full bg-kooq-sage text-white shadow-[0_30px_60px_-15px_rgba(148,183,157,0.4)] h-20 rounded-[2rem] text-lg font-sans font-black tracking-tight border-2 border-white/10 flex items-center justify-center gap-4 group active:scale-95 transition-all overflow-hidden uppercase"
              >
                  <div className="absolute inset-0 bg-gradient-to-r from-white/20 via-transparent to-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
                  <ShoppingBag size={28} className="group-hover:rotate-12 transition-transform" /> 
                  {t.create_shop_list} ({selectedMealIds.size})
              </button>
          </div>
      )}
    </div>
  );
}
Dashboard.MealCard = MealCard;
