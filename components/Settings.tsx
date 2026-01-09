
import React, { useState, useEffect } from 'react';
import { UserPreferences, Region, Diet, Budget, CookingTime, DayMode } from '../types';
import { Button } from './Shared';
import { X, Trash2, Heart, Check, Minus, Plus, Leaf, Users, Layout, Utensils, Clock, Banknote, Globe, Languages, MapPin, Lock, Stethoscope, Target, Zap, Settings, ChevronRight, Wine, Wand2, Crown, AlertTriangle, ChevronDown } from 'lucide-react';
import { useTranslation, getSortedKitchenProfiles } from '../utils/i18n';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  preferences: UserPreferences;
  onUpdate: (prefs: UserPreferences) => void;
  onReset: () => void;
  onUnlock: () => void; 
  userStatus: 'visitor' | 'trial' | 'premium' | 'culinary' | 'basic' | 'free';
  onShowPaywall: (mode: 'premium' | 'culinary') => void;
}

const REGIONS: { val: Region, label: string }[] = [
    { val: 'NL', label: 'Nederland' }, 
    { val: 'BE', label: 'België' }, 
    { val: 'DE', label: 'Duitsland' }, 
    { val: 'FR', label: 'Frankrijk' }, 
    { val: 'ES', label: 'Spanje' }, 
    { val: 'UK', label: 'Verenigd Koninkrijk' }, 
    { val: 'US', label: 'Verenigde Staten' }
];

const LANGUAGES = [
    { val: 'nl-NL', label: 'Nederlands' },
    { val: 'en-US', label: 'English' },
    { val: 'de-DE', label: 'Deutsch' },
    { val: 'fr-FR', label: 'Français' },
    { val: 'es-ES', label: 'Español' }
];

const Section = ({ title, icon: Icon, children, isLocked, handleLockedClick, userStatus }: any) => (
  <section className="space-y-4 pt-8 border-t border-kooq-slate/10 first:pt-0 first:border-0 relative">
      <h3 className="text-2xl font-sans font-black text-kooq-dark tracking-tighter uppercase flex items-center gap-2">
          {Icon && <Icon size={24} className="text-kooq-sage"/>} {title}
      </h3>
      <div className="space-y-3">
          {children}
      </div>
      {isLocked && (
        <div 
            onClick={handleLockedClick}
            className="absolute inset-0 z-20 cursor-pointer flex items-center justify-center bg-transparent group"
        >
            <div className="bg-white/95 p-3 rounded-2xl shadow-xl flex items-center gap-2 transform group-hover:scale-105 transition-transform border border-kooq-sage/20">
                <Lock size={16} className="text-kooq-sage" />
                <span className="text-[10px] font-sans font-black text-kooq-dark uppercase tracking-widest">
                    {userStatus === 'visitor' ? 'ontgrendel deze keuzeoptie' : 'Deze keuzeoptie ontgrendelen'}
                </span>
            </div>
        </div>
      )}
  </section>
);

const SmallStylizedIcon = ({ children }: { children?: React.ReactNode }) => (
  <div className="w-6 h-6 bg-kooq-sage rounded-lg flex items-center justify-center text-white shrink-0 shadow-sm border border-white/20">
    {children}
  </div>
);

const SettingRow = ({ label, icon: Icon, children }: { label: string, icon?: any, children?: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-4 bg-white/70 px-4 py-3 rounded-2xl border border-kooq-slate/10 shadow-sm min-h-[64px] backdrop-blur-md">
      <span className="text-sm font-bold text-kooq-slate flex items-center gap-3">
          {Icon && <SmallStylizedIcon><Icon size={14}/></SmallStylizedIcon>} 
          <span className="uppercase tracking-wider text-[11px] font-sans font-black">{label}</span>
      </span>
      <div className="flex items-center">
          {children}
      </div>
  </div>
);

const CounterControls = ({ value, onChange }: { value: number, onChange: (v: number) => void }) => (
  <div className="flex items-center gap-4">
      <button onClick={() => onChange(Math.max(0, value - 1))} className="w-9 h-9 rounded-full border border-kooq-slate/20 flex items-center justify-center text-kooq-slate hover:bg-white transition-colors"><Minus size={16} /></button>
      <span className="text-base font-sans font-black text-kooq-dark w-5 text-center">{value}</span>
      <button onClick={() => onChange(value + 1)} className="w-9 h-9 rounded-full bg-kooq-sage text-white flex items-center justify-center hover:bg-opacity-90 transition-colors shadow-sm"><Plus size={16} /></button>
  </div>
);

export const SettingsModal: React.FC<Props> = ({ isOpen, onClose, preferences, onUpdate, onReset, onUnlock, userStatus, onShowPaywall }) => {
  const { t } = useTranslation(preferences.language);
  const [localPrefs, setLocalPrefs] = useState<UserPreferences>(preferences);
  const [showWarning, setShowWarning] = useState(false);

  useEffect(() => {
    if (isOpen) {
        setLocalPrefs(preferences);
    }
  }, [preferences, isOpen]);

  if (!isOpen) return null;

  const handleSaveAttempt = () => {
    // Determine if critical preferences changed that require full regen
    const criticalChanged = 
        JSON.stringify(localPrefs.diet) !== JSON.stringify(preferences.diet) ||
        localPrefs.budget !== preferences.budget ||
        localPrefs.weekProfile !== preferences.weekProfile ||
        localPrefs.adultsCount !== preferences.adultsCount ||
        localPrefs.childrenCount !== preferences.childrenCount ||
        localPrefs.region !== preferences.region ||
        localPrefs.zeroWasteLevel !== preferences.zeroWasteLevel;

    if (criticalChanged) {
        setShowWarning(true);
    } else {
        onUpdate(localPrefs);
        onClose();
    }
  };

  const confirmSave = () => {
    onUpdate(localPrefs);
    setShowWarning(false);
    onClose();
  };

  const handleLockedClick = () => {
    if (userStatus === 'visitor' || userStatus === 'free') onUnlock();
    else onShowPaywall('culinary');
  };

  const toggleDiet = (val: string) => {
    const current = localPrefs.diet || [];
    if (current.includes(val)) setLocalPrefs({ ...localPrefs, diet: current.filter(d => d !== val) });
    else setLocalPrefs({ ...localPrefs, diet: [...current, val] });
  };

  const dietOptions = [
    { val: 'Vegetarisch', key: 'diet_Vegetarisch' }, { val: 'Vegan', key: 'diet_Vegan' }, { val: 'Pescotarisch', key: 'diet_Pescotarisch' },
    { val: 'Halal', key: 'diet_Halal' }, { val: 'Glutenarm', key: 'diet_Glutenarm' }, { val: 'Lactosevrij', key: 'diet_Lactosevrij' },
    { val: 'Keto', key: 'diet_Keto' }, { val: 'Paleo', key: 'diet_Paleo' }, { val: 'Notenvrij', key: 'diet_Notenvrij' }, { val: 'Low-carb', key: 'diet_Lowcarb' }
  ];

  const weekStructures = [
    { id: 'family_mix', key: 'profile_family_mix', descKey: 'profile_family_mix_desc' }, 
    { id: 'world_explorer', key: 'profile_world_explorer', descKey: 'profile_world_explorer_desc' },
    { id: 'quick_easy', key: 'profile_quick_easy', descKey: 'profile_quick_easy_desc' }, 
    { id: 'kid_friendly', key: 'profile_kid_friendly', descKey: 'profile_kid_friendly_desc' }, 
    { id: 'surprise', key: 'profile_surprise', descKey: 'profile_surprise_desc' }
  ];

  const isPayingMember = userStatus === 'premium' || userStatus === 'culinary' || userStatus === 'basic';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-kooq-dark/70 backdrop-blur-sm animate-in fade-in duration-200">
      
      {/* Warning Modal */}
      {showWarning && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-kooq-dark/40 backdrop-blur-md">
              <div className="bg-white rounded-[2rem] p-8 max-sm w-full shadow-2xl space-y-6 text-center animate-in zoom-in duration-300">
                  <div className="w-16 h-16 bg-kooq-clementine/10 text-kooq-clementine rounded-2xl flex items-center justify-center mx-auto">
                    <AlertTriangle size={32} />
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-xl font-sans font-black text-kooq-dark tracking-tighter">Nieuw weekmenu?</h4>
                    <p className="text-sm text-kooq-slate font-medium leading-relaxed">
                        Let op: bij het opslaan stelt de sous-chef een volledig nieuw menu voor je samen. Je huidige selectie komt te vervallen.
                    </p>
                  </div>
                  <div className="flex flex-col gap-3">
                    <Button onClick={confirmSave} className="w-full py-4 font-sans font-black tracking-widest uppercase">Menu vernieuwen</Button>
                    <Button onClick={() => setShowWarning(false)} variant="ghost" className="w-full font-bold">Terug naar voorkeuren</Button>
                  </div>
              </div>
          </div>
      )}

      <div className="bg-white rounded-[2.5rem] max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-white/10 relative">
        <div className="absolute inset-0 z-0">
            <img src="https://images.unsplash.com/photo-1543353071-873f17a7a088?q=80&w=2070&auto=format&fit=crop" className="w-full h-full object-cover opacity-20" alt="Settings background" />
        </div>

        <div className="px-6 py-5 border-b border-kooq-slate/10 flex items-center justify-between bg-white/80 backdrop-blur-md relative z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-kooq-sage text-white rounded-xl shadow-md"><Settings size={20}/></div>
            <h2 className="text-2xl font-sans font-black text-kooq-dark tracking-tighter uppercase">VOORKEUREN</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-kooq-slate/10 rounded-full text-kooq-slate transition-colors"><X size={24} /></button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-10 no-scrollbar relative z-10">
             <Section title={t.diet} icon={Utensils}>
                <div className="grid grid-cols-2 gap-2">
                    {dietOptions.map(d => (
                        <button key={d.val} onClick={() => toggleDiet(d.val)} className={`px-3 py-2.5 rounded-xl text-[10px] font-sans font-black uppercase tracking-widest transition-all border-2 ${(localPrefs.diet || []).includes(d.val) ? 'bg-kooq-sage text-white border-kooq-sage shadow-sm' : 'bg-white/80 backdrop-blur-sm text-kooq-slate border-kooq-slate/10 hover:border-kooq-sage/30'}`}>
                            {(t as any)[d.key] || d.val}
                        </button>
                    ))}
                </div>
             </Section>

             {isPayingMember && (
                <Section title={t.zero_waste_title} icon={Leaf}>
                    <div className="bg-white/60 backdrop-blur-md p-6 rounded-3xl border border-kooq-slate/10 shadow-inner">
                        <div className="space-y-2 mb-6">
                            <h4 className="text-sm font-sans font-black text-kooq-dark uppercase tracking-tight">Efficiency vs Variatie</h4>
                            <p className="text-[11px] text-kooq-slate font-medium leading-relaxed opacity-70">
                                Stel in hoe agressief de Chef ingrediënten moet hergebruiken. Een hoger percentage betekent minder verschillende boodschappen en minimale verspilling.
                            </p>
                        </div>
                        <div className="flex justify-between text-[9px] font-sans font-black text-kooq-slate uppercase tracking-widest mb-4">
                            <span>{t.zero_waste_variety}</span>
                            <span>{t.zero_waste_efficiency}</span>
                        </div>
                        <input type="range" min="0" max="100" step="10" value={localPrefs.zeroWasteLevel} onChange={(e) => setLocalPrefs({...localPrefs, zeroWasteLevel: parseInt(e.target.value)})} className="w-full h-3 bg-kooq-sage/20 rounded-lg appearance-none cursor-pointer accent-kooq-sage shadow-sm" />
                        <div className="mt-4 text-center text-xs font-sans font-black text-kooq-sage tracking-wider uppercase">{localPrefs.zeroWasteLevel}% Hergebruik</div>
                    </div>
                </Section>
             )}

             <Section title={t.people} icon={Users}>
                <div className="grid grid-cols-1 gap-3">
                    <SettingRow label={t.adults} icon={Users}>
                        <CounterControls value={localPrefs.adultsCount} onChange={(v) => setLocalPrefs({...localPrefs, adultsCount: v})} />
                    </SettingRow>
                    <SettingRow label={t.children} icon={Users}>
                        <CounterControls value={localPrefs.childrenCount} onChange={(v) => setLocalPrefs({...localPrefs, childrenCount: v})} />
                    </SettingRow>
                </div>
             </Section>

             <Section title={t.cooking_time} icon={Clock}>
                <div className="space-y-3">
                    <SettingRow label={t.time}>
                        <div className="relative">
                            <select 
                                value={localPrefs.cookingTime} 
                                onChange={(e) => setLocalPrefs({...localPrefs, cookingTime: e.target.value as CookingTime})} 
                                className="bg-kooq-slate/5 border-none rounded-xl text-xs font-sans font-black py-2 pl-4 pr-10 focus:ring-2 focus:ring-kooq-sage/20 tracking-wider appearance-none cursor-pointer text-right uppercase text-kooq-dark"
                            >
                                <option value="15" className="bg-white">{t.time_15}</option>
                                <option value="30" className="bg-white">{t.time_30}</option>
                                <option value="45" className="bg-white">{t.time_45}</option>
                                <option value="unlimited" className="bg-white">{t.time_unlimited}</option>
                            </select>
                            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-kooq-slate pointer-events-none" size={14} />
                        </div>
                    </SettingRow>
                    <SettingRow label={t.time_weekend}>
                        <div className="relative">
                            <select 
                                value={localPrefs.weekendCookingTime} 
                                onChange={(e) => setLocalPrefs({...localPrefs, weekendCookingTime: e.target.value as CookingTime})} 
                                className="bg-kooq-slate/5 border-none rounded-xl text-xs font-sans font-black py-2 pl-4 pr-10 focus:ring-2 focus:ring-kooq-sage/20 tracking-wider appearance-none cursor-pointer text-right uppercase text-kooq-dark"
                            >
                                <option value="15" className="bg-white">{t.time_15}</option>
                                <option value="30" className="bg-white">{t.time_30}</option>
                                <option value="45" className="bg-white">{t.time_45}</option>
                                <option value="unlimited" className="bg-white">{t.time_unlimited}</option>
                            </select>
                            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-kooq-slate pointer-events-none" size={14} />
                        </div>
                    </SettingRow>
                </div>
             </Section>

             <Section title={t.budget} icon={Banknote}>
                <p className="text-[11px] font-medium text-kooq-slate leading-relaxed mb-4 opacity-70">
                    {t.budget_main_desc}
                </p>
                <div className="grid grid-cols-1 gap-2">
                    {(['Laag', 'Normaal', 'Luxe'] as Budget[]).map(b => (
                        <button key={b} onClick={() => setLocalPrefs({...localPrefs, budget: b})} className={`py-4 px-6 rounded-2xl flex flex-col items-start text-left border-2 transition-all ${localPrefs.budget === b ? 'bg-kooq-sage text-white border-kooq-sage shadow-sm' : 'bg-white/80 backdrop-blur-sm text-kooq-dark border-kooq-slate/10'}`}>
                            <span className="text-lg font-sans font-black uppercase tracking-tighter">{(t as any)[`budget_${b}`] || b}</span>
                            <span className={`text-[8px] font-sans font-black uppercase tracking-wider leading-tight ${localPrefs.budget === b ? 'text-white/60' : 'text-kooq-slate'}`}>{(t as any)[`budget_${b}_desc`]}</span>
                        </button>
                    ))}
                </div>
             </Section>

             <Section title={t.week_profile_title} icon={Layout}>
                <p className="text-[11px] font-medium text-kooq-slate leading-relaxed mb-4 opacity-70">
                    {t.week_profile_desc}
                </p>
                 <div className="grid grid-cols-1 gap-2">
                    {weekStructures.map(p => (
                        <button key={p.id} onClick={() => setLocalPrefs({...localPrefs, weekProfile: p.id})} className={`py-4 px-6 rounded-2xl flex flex-col items-start text-left border-2 transition-all ${localPrefs.weekProfile === p.id ? 'bg-kooq-sage text-white border-kooq-sage shadow-sm' : 'bg-white/80 backdrop-blur-sm text-kooq-dark border-kooq-slate/10'}`}>
                            <span className="text-lg font-sans font-black uppercase tracking-tighter">{(t as any)[p.key] || p.id}</span>
                            <span className={`text-[8px] font-sans font-black uppercase tracking-wider leading-tight ${localPrefs.weekProfile === p.id ? 'text-white/60' : 'text-kooq-slate'}`}>{(t as any)[p.descKey]}</span>
                        </button>
                    ))}
                 </div>
             </Section>

             <Section title={t.kitchen_profiles} icon={Globe}>
                <p className="text-[11px] font-medium text-kooq-slate leading-relaxed mb-4 opacity-70">
                    {t.kitchen_profiles_subtitle}
                </p>
                <div className="grid grid-cols-2 gap-2">
                    {getSortedKitchenProfiles(localPrefs.region).map(p => (
                        <button key={p.val} onClick={() => {
                            const current = localPrefs.kitchenProfiles || [];
                            const next = current.includes(p.val) ? current.filter(x => x !== p.val) : [...current, p.val];
                            setLocalPrefs({ ...localPrefs, kitchenProfiles: next });
                        }} className={`px-3 py-2.5 rounded-xl text-[10px] font-sans font-black uppercase tracking-widest transition-all border-2 ${localPrefs.kitchenProfiles.includes(p.val) ? 'bg-kooq-sage text-white border-kooq-sage shadow-sm' : 'bg-white/80 backdrop-blur-sm text-kooq-slate border-kooq-slate/10 hover:border-kooq-sage/30'}`}>
                            {(t as any)[p.key] || p.val}
                        </button>
                    ))}
                </div>
             </Section>

             <Section title="Taal & Regio" icon={Globe}>
                <div className="space-y-3">
                    <SettingRow label={t.region} icon={MapPin}>
                        <div className="relative">
                            <select value={localPrefs.region} onChange={(e) => setLocalPrefs({...localPrefs, region: e.target.value as Region})} className="bg-kooq-slate/5 border-none rounded-xl text-xs font-sans font-black py-2 pl-4 pr-10 focus:ring-2 focus:ring-kooq-sage/20 tracking-wider appearance-none cursor-pointer text-right min-w-[120px] uppercase text-kooq-dark">
                                {REGIONS.map(r => <option key={r.val} value={r.val} className="bg-white">{r.label}</option>)}
                            </select>
                            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-kooq-slate pointer-events-none" size={14} />
                        </div>
                    </SettingRow>
                    <SettingRow label={t.language} icon={Languages}>
                        <div className="relative">
                            <select value={localPrefs.language} onChange={(e) => setLocalPrefs({...localPrefs, language: e.target.value})} className="bg-kooq-slate/5 border-none rounded-xl text-xs font-sans font-black py-2 pl-4 pr-10 focus:ring-2 focus:ring-kooq-sage/20 tracking-wider appearance-none cursor-pointer text-right min-w-[120px] uppercase text-kooq-dark">
                                {LANGUAGES.map(l => <option key={l.val} value={l.val} className="bg-white">{l.label}</option>)}
                            </select>
                            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-kooq-slate pointer-events-none" size={14} />
                        </div>
                    </SettingRow>
                </div>
             </Section>

             <section className="pt-8 border-t border-kooq-slate/10">
                 <button onClick={() => confirm(t.confirm_reset) && onReset()} className="flex items-center gap-3 text-red-500 hover:text-red-600 text-[10px] font-sans font-black tracking-widest transition-all w-full justify-center py-4 border border-red-50 rounded-2xl hover:bg-red-50 uppercase"><Trash2 size={18} /> {t.reset}</button>
             </section>
        </div>
        <div className="p-6 md:p-8 border-t border-kooq-slate/10 bg-white/90 backdrop-blur-md flex gap-4 relative z-10">
             <Button onClick={onClose} variant="ghost" className="flex-1 py-4">Annuleren</Button>
             <Button onClick={handleSaveAttempt} className="flex-[2] shadow-lg py-4">Opslaan & Vernieuwen</Button>
        </div>
      </div>
    </div>
  );
};
