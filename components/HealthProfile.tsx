
import React, { useState, useEffect } from 'react';
import { UserPreferences } from '../types';
import { Button } from './Shared';
import { X, Heart, Target, Zap, Stethoscope, Activity, Calendar, ChevronDown, Info, Gauge, Users, CheckSquare, Square, Sparkles } from 'lucide-react';
import { useTranslation } from '../utils/i18n';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  preferences: UserPreferences;
  onUpdate: (prefs: UserPreferences) => void;
  userStatus: 'visitor' | 'trial' | 'premium' | 'health';
}

const HEALTH_GOALS_LIST = [
  { id: 'weight_loss', key: 'goal_weight_loss', defaultMacro: 'high_protein' },
  { id: 'muscle_gain', key: 'goal_muscle_gain', defaultMacro: 'high_protein' },
  { id: 'energy', key: 'goal_energy', defaultMacro: 'balanced' },
  { id: 'balance', key: 'goal_balance', defaultMacro: 'balanced' },
  { id: 'lower_cholesterol', key: 'goal_lower_cholesterol', defaultMacro: 'balanced' },
  { id: 'stabilize_sugar', key: 'goal_stabilize_sugar', defaultMacro: 'low_carb' },
  { id: 'lower_blood_pressure', key: 'goal_lower_blood_pressure', defaultMacro: 'balanced' }
];

const PAL_FACTORS = {
    low: 1.2,
    medium: 1.55,
    high: 1.9
};

const calculateBMR = (weight?: number, height?: number, age?: number, gender?: 'male' | 'female') => {
  if (!weight || !height || !age) return 0;
  const s = gender === 'male' ? 5 : -161;
  return Math.round((10 * weight) + (6.25 * height) - (5 * age) + s);
};

const Section = ({ title, icon: Icon, children }: any) => (
  <div className="space-y-4 mb-10">
    <h3 className="text-[10px] font-black text-kooq-sage uppercase tracking-[0.2em] flex items-center gap-2">
      <Icon size={14} /> {title}
    </h3>
    <div className="space-y-3">
      {children}
    </div>
  </div>
);

const InputRow = ({ label, value, onChange, unit, placeholder = "0" }: any) => (
  <div className="flex items-center justify-between p-4 bg-kooq-white/50 rounded-2xl border border-kooq-slate/5 transition-all focus-within:border-kooq-sage/30 focus-within:bg-white shadow-sm">
    <span className="text-sm font-bold text-kooq-dark">{label}</span>
    <div className="flex items-center gap-3">
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-24 bg-white border border-kooq-slate/10 rounded-xl px-3 py-2 text-right text-sm font-black outline-none focus:ring-2 focus:ring-kooq-sage/20 transition-all"
      />
      {unit && <span className="text-[10px] font-black text-kooq-slate uppercase w-8">{unit}</span>}
    </div>
  </div>
);

const ToggleRow = ({ label, active, onToggle }: any) => (
  <button
    onClick={onToggle}
    className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all shadow-sm ${active ? 'bg-kooq-sage/10 border-kooq-sage' : 'bg-kooq-white/50 border-transparent'}`}
  >
    <span className={`text-sm font-bold ${active ? 'text-kooq-sage' : 'text-kooq-dark'}`}>{label}</span>
    <div className={`w-10 h-6 rounded-full relative transition-colors ${active ? 'bg-kooq-sage' : 'bg-kooq-slate/20'}`}>
      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${active ? 'left-5' : 'left-1'}`}></div>
    </div>
  </button>
);

export const HealthProfile: React.FC<Props> = ({ isOpen, onClose, preferences, onUpdate, userStatus }) => {
  const { t } = useTranslation(preferences.language);
  const [localPrefs, setLocalPrefs] = useState<UserPreferences>(preferences);
  const [showUnlockBanner, setShowUnlockBanner] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLocalPrefs({
          ...preferences,
          gender: preferences.gender || 'female',
          activityLevel: preferences.activityLevel || 'medium',
          macro_ratio: preferences.macro_ratio || 'balanced',
          participatingMembers: preferences.participatingMembers || { partner: true, children: [] }
      });
      
      // If goals are not set yet, assume this is the first "Unlock" open
      if (!preferences.goals || preferences.goals.length === 0) {
          setShowUnlockBanner(true);
      } else {
          setShowUnlockBanner(false);
      }
    }
  }, [preferences, isOpen]);

  useEffect(() => {
    const bmr = calculateBMR(localPrefs.weight, localPrefs.height, localPrefs.age, localPrefs.gender);
    const pal = PAL_FACTORS[localPrefs.activityLevel || 'medium'];
    const tdee = Math.round(bmr * pal);
    
    let target = tdee;
    const currentGoal = localPrefs.goals?.[0];

    if (currentGoal === 'weight_loss') target = Math.round(tdee - 500);
    else if (currentGoal === 'muscle_gain') target = Math.round(tdee + 300);

    let suggestedMacro = localPrefs.macro_ratio;
    const goalConfig = HEALTH_GOALS_LIST.find(g => g.id === currentGoal);
    if (goalConfig) suggestedMacro = goalConfig.defaultMacro as any;
    
    if (target !== localPrefs.dailyCalorieTarget || bmr !== localPrefs.bmr || suggestedMacro !== localPrefs.macro_ratio) {
        setLocalPrefs(prev => ({ 
            ...prev, 
            bmr, 
            dailyCalorieTarget: target,
            macro_ratio: suggestedMacro
        }));
    }
  }, [localPrefs.weight, localPrefs.height, localPrefs.age, localPrefs.gender, localPrefs.activityLevel, localPrefs.goals]);

  if (!isOpen) return null;

  const handleSave = () => {
    onUpdate(localPrefs);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] bg-white animate-in slide-in-from-right duration-500 overflow-y-auto no-scrollbar font-sans">
      <div className="sticky top-0 bg-white/80 backdrop-blur-md z-30 p-6 border-b border-kooq-slate/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-kooq-sage text-white rounded-xl shadow-lg"><Heart size={20} fill="currentColor" /></div>
          <h2 className="text-xl font-black text-kooq-dark tracking-tight">Health Dashboard</h2>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-kooq-white rounded-full transition-colors"><X size={24} /></button>
      </div>

      <div className="p-6 max-w-2xl mx-auto pb-32">
        {/* CONGRATS BANNER */}
        {showUnlockBanner && (
          <div className="mb-8 p-8 bg-kooq-sage text-white rounded-[2.5rem] shadow-2xl animate-in slide-in-from-top-4 duration-700 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-48 h-48 bg-white/20 blur-3xl -translate-y-1/2 translate-x-1/2"></div>
            <div className="relative z-10 flex gap-4 items-start">
              <div className="shrink-0 w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center shadow-inner">
                  <Sparkles size={28} fill="currentColor" />
              </div>
              <div className="space-y-2">
                  <h3 className="text-xl font-black leading-tight">Gefeliciteerd! Qook Health is ontgrendeld.</h3>
                  <p className="text-sm font-medium opacity-90 leading-relaxed">
                    Vul de gegevens in om je weekmenu te personaliseren. Je vindt dit dashboard later altijd terug onder de instellingenknop.
                  </p>
              </div>
            </div>
          </div>
        )}

        {/* 1. HOOFDDOEL (Strategy) */}
        <div className="mb-10 p-8 bg-kooq-dark rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-kooq-sage opacity-10 blur-[100px] -translate-y-1/2 translate-x-1/2"></div>
            <div className="relative z-10 space-y-6">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Target size={16} className="text-kooq-sage" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-kooq-sage">1. Hoofddoel</span>
                    </div>
                </div>
                
                <div className="relative">
                    <select 
                        value={localPrefs.goals?.[0] || ''}
                        onChange={(e) => setLocalPrefs({ ...localPrefs, goals: [e.target.value] })}
                        className="w-full bg-white/10 border-2 border-white/10 rounded-2xl px-5 py-4 text-lg font-black appearance-none outline-none focus:border-kooq-sage transition-all cursor-pointer pr-12"
                    >
                        <option value="" disabled className="text-kooq-dark">Selecteer jouw focus...</option>
                        {HEALTH_GOALS_LIST.map(g => (
                            <option key={g.id} value={g.id} className="text-kooq-dark">{(t as any)[g.key] || g.id}</option>
                        ))}
                    </select>
                    <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" size={20} />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white/5 p-5 rounded-3xl border border-white/10">
                        <span className="block text-[8px] font-black text-white/40 uppercase tracking-widest mb-1">Dagelijks Doel</span>
                        <div className="flex items-baseline gap-1">
                            <span className="text-3xl font-black text-kooq-sage">{localPrefs.dailyCalorieTarget || '--'}</span>
                            <span className="text-[10px] font-black text-white/60">kcal</span>
                        </div>
                    </div>
                    <div className="bg-white/5 p-5 rounded-3xl border border-white/10">
                        <span className="block text-[8px] font-black text-white/40 uppercase tracking-widest mb-1">Energieverbruik</span>
                        <div className="flex items-baseline gap-1 text-white/80">
                            <span className="text-xl font-black">{Math.round((localPrefs.bmr || 0) * PAL_FACTORS[localPrefs.activityLevel || 'medium'])}</span>
                            <span className="text-[10px] font-black uppercase">TDEE</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        {/* 2. LICHAAMSOUW (Body Stats) */}
        <Section title="2. Lichaamsbouw" icon={Activity}>
          <div className="mb-4">
              <label className="block text-[10px] font-black text-kooq-slate uppercase tracking-widest mb-3 px-1 opacity-70">Geslacht</label>
              <div className="grid grid-cols-2 gap-2">
                {['male', 'female'].map(g => (
                  <button key={g} onClick={() => setLocalPrefs({ ...localPrefs, gender: g as any })} className={`p-3 rounded-xl text-[10px] font-black uppercase border-2 transition-all ${localPrefs.gender === g ? 'bg-kooq-dark text-white border-kooq-dark shadow-md' : 'bg-kooq-white/50 border-transparent text-kooq-slate'}`}>
                    {g === 'male' ? 'Man' : 'Vrouw'}
                  </button>
                ))}
              </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <InputRow label="Leeftijd" value={localPrefs.age} unit="jaar" onChange={(v: any) => setLocalPrefs({ ...localPrefs, age: v ? parseInt(v) : undefined })} />
            <InputRow label="Lengte" value={localPrefs.height} unit="cm" onChange={(v: any) => setLocalPrefs({ ...localPrefs, height: v ? parseInt(v) : undefined })} />
            <InputRow label="Gewicht" value={localPrefs.weight} unit="kg" onChange={(v: any) => setLocalPrefs({ ...localPrefs, weight: v ? parseFloat(v) : undefined })} />
          </div>
          <div className="mt-6">
              <label className="block text-[10px] font-black text-kooq-slate uppercase tracking-widest mb-3 px-1 opacity-70">Dagelijkse Activiteit</label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(PAL_FACTORS) as Array<keyof typeof PAL_FACTORS>).map(lvl => (
                  <button key={lvl} onClick={() => setLocalPrefs({ ...localPrefs, activityLevel: lvl })} className={`p-4 rounded-2xl flex flex-col items-center gap-1 border-2 transition-all ${localPrefs.activityLevel === lvl ? 'bg-kooq-dark text-white border-kooq-dark shadow-md' : 'bg-kooq-white/50 border-transparent text-kooq-slate'}`}>
                    <span className="text-[10px] font-black uppercase">{lvl === 'low' ? 'Laag' : lvl === 'medium' ? 'Actief' : 'Intens'}</span>
                  </button>
                ))}
              </div>
          </div>
        </Section>

        {/* 3. GEZIN (Family) */}
        <Section title="3. Gezin & Gezins-Health" icon={Users}>
            <div className="p-6 bg-kooq-sage/5 border border-kooq-sage/20 rounded-3xl space-y-4">
                <p className="text-[10px] font-black text-kooq-sage uppercase tracking-widest mb-2 opacity-80">Wie doen er mee aan de Health-doelen?</p>
                <div className="space-y-3">
                    <button 
                        onClick={() => setLocalPrefs({ ...localPrefs, participatingMembers: { ...localPrefs.participatingMembers, partner: !localPrefs.participatingMembers?.partner } })}
                        className="w-full flex items-center justify-between p-4 bg-white rounded-2xl border border-kooq-sage/10 transition-all hover:bg-kooq-sage/5"
                    >
                        <div className="flex items-center gap-3">
                            {localPrefs.participatingMembers?.partner ? <CheckSquare className="text-kooq-sage" /> : <Square className="text-kooq-slate/20" />}
                            <span className="text-sm font-bold text-kooq-dark">Partner</span>
                        </div>
                        <span className="text-[10px] font-black text-kooq-sage bg-white px-2 py-1 rounded-lg border border-kooq-sage/10 uppercase">Hetzelfde bord</span>
                    </button>
                    {localPrefs.childrenCount > 0 && (
                        <button 
                            onClick={() => setLocalPrefs({ ...localPrefs, participatingMembers: { ...localPrefs.participatingMembers, children: [!(localPrefs.participatingMembers?.children?.[0])] } })}
                            className="w-full flex items-center justify-between p-4 bg-white rounded-2xl border border-kooq-sage/10 transition-all hover:bg-kooq-sage/5"
                        >
                            <div className="flex items-center gap-3">
                                {localPrefs.participatingMembers?.children?.[0] ? <CheckSquare className="text-kooq-sage" /> : <Square className="text-kooq-slate/20" />}
                                <span className="text-sm font-bold text-kooq-dark">Kinderen ({localPrefs.childrenCount}x)</span>
                            </div>
                            <span className="text-[10px] font-black text-kooq-clementine bg-white px-2 py-1 rounded-lg border border-kooq-clementine/10 uppercase">Kindvriendelijk</span>
                        </button>
                    )}
                </div>
                <div className="pt-2">
                    <p className="text-[9px] text-kooq-slate font-medium italic">De Chef's Hacks in het menu helpen je om voor de niet-deelnemers een normale portie op te dienen.</p>
                </div>
            </div>
        </Section>

        {/* 4. MEDISCHE FOCUS */}
        <Section title="Medische Focus" icon={Stethoscope}>
          <div className="space-y-2">
              <ToggleRow label="Focus op lage Glykemische Index" active={localPrefs.glycemicFocus} onToggle={() => setLocalPrefs({ ...localPrefs, glycemicFocus: !localPrefs.glycemicFocus })} />
              <ToggleRow label="Zoutarm dieet" active={localPrefs.sodiumLimit} onToggle={() => setLocalPrefs({ ...localPrefs, sodiumLimit: !localPrefs.sodiumLimit })} />
              <ToggleRow label="Cholesterolbeperkend" active={localPrefs.cholesterolManagement} onToggle={() => setLocalPrefs({ ...localPrefs, cholesterolManagement: !localPrefs.cholesterolManagement })} />
          </div>
        </Section>
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-6 bg-white/95 backdrop-blur-md border-t border-kooq-slate/10 z-20">
        <div className="max-w-2xl mx-auto flex gap-4">
          <Button onClick={onClose} variant="ghost" className="flex-1 py-4 font-bold border border-kooq-slate/10">Annuleren</Button>
          <Button onClick={handleSave} className="flex-1 py-4 bg-kooq-dark text-white font-black shadow-2xl">Optimaliseer Menu</Button>
        </div>
      </div>
    </div>
  );
};
