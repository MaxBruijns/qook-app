
import React, { useState, useEffect } from 'react';
import { UserPreferences, Region, Budget } from '../types';
import { Button } from './Shared';
import { 
  ChevronRight, 
  ChevronLeft, 
  Check, 
  Plus, 
  Minus, 
  Banknote, 
  Layout, 
  Sparkles, 
  Utensils, 
  Zap, 
  Users, 
  Clock, 
  Globe, 
  Baby
} from 'lucide-react';
import { useTranslation, detectUserLocale, getSortedKitchenProfiles } from '../utils/i18n';

interface Props {
  onComplete: (prefs: UserPreferences) => void;
}

const STEPS = ['people', 'cooking_times', 'budget', 'week_profile', 'profiles'];

export const Onboarding: React.FC<Props> = ({ onComplete }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [prefs, setPrefs] = useState<UserPreferences>(() => {
    const { region, language } = detectUserLocale();
    return {
      region,
      language,
      units: 'metric',
      adultsCount: 2,
      childrenCount: 0,
      diet: ['Geen'],
      budget: 'Normaal',
      cookingTime: '30',
      weekendCookingTime: 'unlimited',
      kitchenProfiles: [],
      weekProfile: 'surprise',
      caloriePreference: 'medium',
      hasOnboarded: false,
      subscriptionStatus: 'free',
      zeroWasteLevel: 50,
      partyGuests: 0,
      dayModes: {
        0: 'premium', 1: 'premium', 2: 'premium', 3: 'premium', 
        4: 'premium', 5: 'culinary', 6: 'culinary'
      }
    };
  });

  const { t } = useTranslation(prefs.language);

  useEffect(() => {
    if (STEPS[stepIndex] === 'profiles' && prefs.kitchenProfiles.length === 0) {
      const suggestions: string[] = [];
      if (['NL', 'BE', 'DE'].includes(prefs.region)) {
        suggestions.push('Noord- & West-Europees', 'Klassiek Europees');
      } else if (['FR', 'ES', 'IT'].includes(prefs.region)) {
        suggestions.push('Mediterrane & Midden-Oosters', 'Klassiek Europees');
      }
      if (prefs.weekProfile === 'world_explorer') {
        suggestions.push('Aziatisch – Zuid/Oost', 'Latijns-Amerikaans', 'Afrikaans');
      } else if (prefs.weekProfile === 'quick_easy') {
        suggestions.push('Fusion & Modern', 'Italiaans');
      }
      setPrefs(prev => ({ ...prev, kitchenProfiles: Array.from(new Set(suggestions)) }));
    }
  }, [stepIndex, prefs.region, prefs.weekProfile]);

  const next = () => {
    if (stepIndex < STEPS.length - 1) {
      setStepIndex(stepIndex + 1);
    } else {
      onComplete({ 
        ...prefs, 
        hasOnboarded: true,
        trialStartedAt: new Date().toISOString()
      });
    }
  };

  const prev = () => {
    if (stepIndex > 0) {
      setStepIndex(stepIndex - 1);
    }
  };

  const StepIcon = ({ children }: { children?: React.ReactNode }) => (
    <div className="relative w-12 h-12 mx-auto mb-3 flex items-center justify-center shrink-0">
        <div className="absolute inset-0 border-[2px] border-kooq-sage/30 rounded-xl"></div>
        <div className="absolute inset-0 border-t-[2px] border-kooq-sage rounded-xl animate-[spin_8s_linear_infinite]"></div>
        <div className="w-8 h-8 bg-kooq-sage rounded-lg flex items-center justify-center text-white shadow-lg z-10 font-sans font-black text-lg">
            {children}
        </div>
    </div>
  );

  const Counter = ({ label, value, onChange }: { label: string, value: number, onChange: (val: number) => void }) => (
    <div className="flex flex-col items-center gap-1 bg-white p-3 rounded-2xl shadow-sm border border-kooq-slate/10 flex-1 min-w-[120px]">
        <span className="text-[10px] font-sans font-black text-kooq-slate uppercase tracking-widest mb-1">{label}</span>
        <div className="flex items-center gap-3">
            <button 
                onClick={() => onChange(Math.max(0, value - 1))}
                className="w-10 h-10 rounded-full border-2 border-kooq-slate/10 flex items-center justify-center text-kooq-slate hover:bg-kooq-slate/5 transition-colors"
            >
                <Minus size={16} />
            </button>
            <span className="text-2xl font-sans font-black text-kooq-dark w-6 text-center">{value}</span>
            <button 
                onClick={() => onChange(Math.min(12, value + 1))}
                className="w-10 h-10 rounded-full bg-kooq-sage text-white flex items-center justify-center hover:bg-opacity-90 transition-all shadow-lg active:scale-90"
            >
                <Plus size={16} />
            </button>
        </div>
    </div>
  );

  const renderStep = () => {
    switch (STEPS[stepIndex]) {
      case 'people':
        return (
          <div className="space-y-4 animate-in slide-in-from-bottom-4 duration-300 flex flex-col items-center">
            <StepIcon>Q</StepIcon>
            <div className="text-center space-y-1">
                <h2 className="text-2xl font-sans font-black text-kooq-dark px-2 leading-tight tracking-tighter">{t.how_many_people}</h2>
                <p className="text-kooq-slate text-xs font-medium opacity-70">{t.benefit_basic_1 || "Direct aangepaste hoeveelheden."}</p>
            </div>
            <div className="flex gap-2 w-full max-w-sm">
              <Counter label={t.adults} value={prefs.adultsCount} onChange={(val) => setPrefs({...prefs, adultsCount: val})} />
              <Counter label={t.children} value={prefs.childrenCount} onChange={(val) => setPrefs({...prefs, childrenCount: val})} />
            </div>
            <div className="w-full max-w-xs pt-2">
                <Button onClick={next} disabled={prefs.adultsCount + prefs.childrenCount === 0} className="w-full py-5 text-sm font-sans font-black tracking-widest shadow-xl uppercase">
                    {t.next_step} <ChevronRight size={18}/>
                </Button>
            </div>
          </div>
        );

      case 'cooking_times':
         return (
          <div className="space-y-4 animate-in slide-in-from-right duration-300 flex flex-col items-center">
            <StepIcon><Clock size={20} /></StepIcon>
            <div className="space-y-4 w-full max-w-sm px-2">
              <h2 className="text-2xl font-sans font-black text-kooq-dark text-center leading-tight tracking-tighter px-2">{t.time_pref_title}</h2>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { val: '15', label: t.max_15 },
                  { val: '30', label: t.around_30 },
                  { val: '45', label: t.max_45 },
                  { val: 'unlimited', label: t.unlimited }
                ].map(opt => (
                  <button
                    key={opt.val}
                    onClick={() => setPrefs({...prefs, cookingTime: opt.val as any})}
                    className={`p-4 rounded-xl text-center transition-all border-2 ${
                      prefs.cookingTime === opt.val
                      ? 'bg-kooq-sage text-white shadow-md border-kooq-sage'
                      : 'bg-white text-kooq-slate border-kooq-slate/10 hover:border-kooq-sage/30 shadow-sm'
                    } text-[10px] font-sans font-black uppercase tracking-tighter`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="w-full h-px bg-kooq-slate/10 max-w-[120px] my-4"></div>
            <div className="space-y-4 w-full max-w-sm px-2">
              <h2 className="text-2xl font-sans font-black text-kooq-dark text-center leading-tight tracking-tighter px-2">{t.time_pref_weekend_title}</h2>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { val: '15', label: t.max_15 },
                  { val: '30', label: t.around_30 },
                  { val: '45', label: t.max_45 },
                  { val: 'unlimited', label: t.unlimited }
                ].map(opt => (
                  <button
                    key={opt.val}
                    onClick={() => setPrefs({...prefs, weekendCookingTime: opt.val as any})}
                    className={`p-4 rounded-xl text-center transition-all border-2 ${
                      prefs.weekendCookingTime === opt.val
                      ? 'bg-kooq-sage text-white shadow-md border-kooq-sage'
                      : 'bg-white text-kooq-slate border-kooq-slate/10 hover:border-kooq-sage/30 shadow-sm'
                    } text-[10px] font-sans font-black uppercase tracking-tighter`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 w-full max-w-xs mt-6">
                <Button onClick={prev} variant="ghost" className="flex-1 py-4"><ChevronLeft size={18}/></Button>
                <Button onClick={next} className="flex-[3] py-4 text-sm font-sans font-black uppercase tracking-widest shadow-xl">{t.next_step}</Button>
            </div>
          </div>
        );

      case 'budget':
        return (
            <div className="space-y-4 animate-in slide-in-from-right duration-300 flex flex-col items-center">
                <StepIcon><Banknote size={20} /></StepIcon>
                <div className="text-center space-y-2 mb-2">
                    <h2 className="text-2xl font-sans font-black text-kooq-dark leading-tight tracking-tighter px-2">{t.budget}</h2>
                    <p className="text-kooq-slate text-[11px] font-medium leading-relaxed px-6 opacity-80">
                        {t.budget_main_desc}
                    </p>
                </div>
                <div className="grid grid-cols-1 gap-2 w-full max-w-xs px-2">
                    {(['Laag', 'Normaal', 'Luxe'] as Budget[]).map(b => (
                        <button
                            key={b}
                            onClick={() => setPrefs({...prefs, budget: b})}
                            className={`p-5 rounded-2xl flex flex-col items-center justify-center text-center transition-all border-2 relative ${
                                prefs.budget === b
                                ? 'bg-kooq-sage text-white shadow-md border-kooq-sage scale-[1.02]'
                                : 'bg-white text-kooq-dark border-kooq-slate/10 hover:border-kooq-sage/50 shadow-sm'
                            }`}
                        >
                            <span className="text-xl font-sans font-black tracking-tighter leading-none mb-1">
                                {(t as any)[`budget_${b}`] || b}
                            </span>
                            <span className={`text-[8px] font-sans font-black uppercase tracking-wider leading-tight px-4 ${prefs.budget === b ? 'text-white/60' : 'text-kooq-slate'}`}>
                                {(t as any)[`budget_${b}_desc`]}
                            </span>
                            {prefs.budget === b && (
                                <div className="absolute top-3 right-4 text-white">
                                    <Check size={18} className="stroke-[3]" />
                                </div>
                            )}
                        </button>
                    ))}
                </div>
                <div className="flex gap-2 w-full max-w-xs mt-4">
                    <Button onClick={prev} variant="ghost" className="flex-1 py-4"><ChevronLeft size={18}/></Button>
                    <Button onClick={next} className="flex-[3] py-4 text-sm font-sans font-black uppercase tracking-widest shadow-xl">{t.next_step}</Button>
                </div>
            </div>
        );

      case 'week_profile':
        return (
          <div className="space-y-4 animate-in slide-in-from-right duration-300 flex flex-col items-center">
            <StepIcon><Layout size={20} /></StepIcon>
            <div className="text-center space-y-1">
                <h2 className="text-2xl font-sans font-black text-kooq-dark leading-tight tracking-tighter px-2">{t.week_profile_title}</h2>
                <p className="text-kooq-slate text-[9px] font-sans font-black uppercase tracking-widest px-4 opacity-60">{t.week_profile_desc}</p>
            </div>
            <div className="grid grid-cols-1 gap-2 w-full max-w-sm px-2">
                {[
                    { id: 'family_mix', key: 'profile_family_mix', icon: <Utensils size={14} />, descKey: 'profile_family_mix_desc' },
                    { id: 'world_explorer', key: 'profile_world_explorer', icon: <Sparkles size={14} />, descKey: 'profile_world_explorer_desc' },
                    { id: 'quick_easy', key: 'profile_quick_easy', icon: <Zap size={14} />, descKey: 'profile_quick_easy_desc' },
                    { id: 'kid_friendly', key: 'profile_kid_friendly', icon: <Baby size={14} />, descKey: 'profile_kid_friendly_desc' },
                    { id: 'surprise', key: 'profile_surprise', icon: <Sparkles size={14} />, descKey: 'profile_surprise_desc' }
                ].map(p => (
                    <button
                        key={p.id}
                        onClick={() => setPrefs({...prefs, weekProfile: p.id})}
                        className={`p-4 rounded-xl flex flex-col items-center justify-center gap-1 text-center border-2 transition-all ${
                            prefs.weekProfile === p.id
                            ? 'bg-kooq-sage text-white border-kooq-sage shadow-md scale-[1.02]'
                            : 'bg-white text-kooq-dark border-kooq-slate/10 hover:border-kooq-sage/50 shadow-sm'
                        }`}
                    >
                        <div className="flex items-center gap-2 mb-1">
                            <div className={prefs.weekProfile === p.id ? 'text-white' : 'text-kooq-sage opacity-60'}>
                                {p.icon}
                            </div>
                            <span className="font-sans font-black text-sm uppercase tracking-tighter">{(t as any)[p.key] || p.id}</span>
                        </div>
                        <span className={`text-[8px] font-sans font-black uppercase tracking-wider leading-tight ${prefs.weekProfile === p.id ? 'text-white/60' : 'text-kooq-slate opacity-70'}`}>
                            {(t as any)[p.descKey]}
                        </span>
                    </button>
                ))}
            </div>
            <div className="flex gap-2 w-full max-w-xs mt-2">
                <Button onClick={prev} variant="ghost" className="flex-1 py-4"><ChevronLeft size={18}/></Button>
                <Button onClick={next} className="flex-[3] py-4 text-sm font-sans font-black uppercase tracking-widest shadow-xl">{t.next_step}</Button>
            </div>
          </div>
        );

      case 'profiles':
        const profiles = getSortedKitchenProfiles(prefs.region);

        return (
          <div className="space-y-4 animate-in slide-in-from-right duration-300 flex flex-col items-center">
            <StepIcon><Globe size={20} /></StepIcon>
            <div className="text-center space-y-2 mb-2">
                <h2 className="text-2xl font-sans font-black text-kooq-dark leading-tight tracking-tighter px-2">{t.kitchen_profiles}</h2>
                <p className="text-kooq-slate text-[11px] font-medium leading-relaxed px-6 opacity-80">
                    {t.kitchen_profiles_subtitle}
                </p>
            </div>
            <div className="grid grid-cols-2 gap-1.5 w-full max-w-sm px-2 max-h-[35vh] overflow-y-auto no-scrollbar py-1">
              {profiles.map(p => (
                <button
                  key={p.val}
                  onClick={() => setPrefs({...prefs, kitchenProfiles: prefs.kitchenProfiles.includes(p.val) ? prefs.kitchenProfiles.filter(x => x !== p.val) : [...prefs.kitchenProfiles, p.val]})}
                  className={`px-2 py-3 rounded-xl text-[9px] font-sans font-black uppercase tracking-tighter transition-all border-2 text-center flex items-center justify-center relative overflow-hidden ${
                    prefs.kitchenProfiles.includes(p.val)
                    ? 'bg-kooq-sage text-white shadow-md border-kooq-sage'
                    : 'bg-white text-kooq-dark border-kooq-slate/10 hover:border-kooq-sage/50 shadow-sm'
                  }`}
                >
                  {(t as any)[p.key] || p.val}
                  {prefs.kitchenProfiles.includes(p.val) && <div className="absolute top-1 right-1"><Check size={8} /></div>}
                </button>
              ))}
            </div>
            <div className="flex gap-2 w-full max-w-xs mt-2">
                <Button onClick={prev} variant="ghost" className="flex-1 py-4"><ChevronLeft size={18}/></Button>
                <Button onClick={next} className="flex-[3] py-4 text-sm font-sans font-black uppercase tracking-widest shadow-2xl bg-kooq-sage">{t.finish}</Button>
            </div>
          </div>
        );
      
      default: return null;
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-kooq-white overflow-hidden">
      <div className="absolute inset-0 z-0 transition-opacity duration-1000">
        <img src="https://images.unsplash.com/photo-1543353071-873f17a7a088?q=80&w=2070&auto=format&fit=crop" className="w-full h-full object-cover" alt="Background"/>
        <div className="absolute inset-0 bg-gradient-to-b from-white/40 via-white/10 to-white/40 backdrop-blur-[0.5px]"></div>
      </div>
      <div className="w-full max-w-md bg-white/40 p-5 rounded-[2.5rem] relative z-10 backdrop-blur-xl border border-white/30 shadow-2xl flex flex-col justify-between min-h-[500px] max-h-[90vh] overflow-hidden">
        <div className="flex-1 flex flex-col justify-center">
            {renderStep()}
        </div>
        <div className="flex justify-center gap-1.5 mt-6 pb-2">
            {STEPS.map((_, i) => (
                <div key={i} className={`h-1.5 rounded-full transition-all duration-500 ${i === stepIndex ? 'w-6 bg-kooq-sage shadow-[0_0_8px_rgba(148,183,157,0.4)]' : 'w-1.5 bg-kooq-slate/20'}`} />
            ))}
        </div>
      </div>
    </div>
  );
};
