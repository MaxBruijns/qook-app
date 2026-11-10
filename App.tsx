import React, { useState, useEffect, useRef } from 'react';
import { Onboarding } from './components/Onboarding';
import Dashboard from './components/Dashboard';
import { MealDetail } from './components/MealDetail';
import { CookingMode } from './components/CookingMode';
import { ShoppingList } from './components/ShoppingList';
import { ChatAssistant } from './components/Chat';
import { Header, PaywallModal, Button } from './components/Shared';
import { SettingsModal } from './components/Settings';
import { FavoritesView } from './components/FavoritesView';
import { UserPreferences, WeeklyPlan, Meal, ShoppingItem, FridgeScanResult, SubscriptionStatus, DayMode, Usage } from './types';
import { generateWeeklyPlan, generateShoppingList, analyzeFridgeImage, replaceMeal } from './services/geminiService';
import { useTranslation, detectUserLocale } from './utils/i18n';
import { recordTaste } from './utils/tasteProfile';
import { AccountUser, getAccount, login, register, logout, deleteAccount, resetAccountData, saveSubscription, passwordResetAvailable, requestPasswordReset, resetPassword } from './utils/account';
import { Calendar, Camera, ArrowRight, User, Mail, Lock, ArrowLeft, Globe, ChevronDown, Check, PartyPopper, Loader2, Info } from 'lucide-react';

function getWeekNumber(d: Date) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    var weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return weekNo;
}

// Voorraadkast op de boodschappenlijst: wat je afvinkt ("heb ik al"), onthouden we voor de volgende keer.
const PANTRY_KEY = 'qook_pantry_have';
const isPantryItem = (i: ShoppingItem) => i.category?.startsWith('Voorraadkast');
const pantryHave = (): string[] => { try { return JSON.parse(localStorage.getItem(PANTRY_KEY) || '[]'); } catch { return []; } };
const rememberPantry = (name: string, have: boolean) => {
    const key = name.toLowerCase();
    const next = pantryHave().filter(n => n !== key);
    if (have) next.push(key);
    try { localStorage.setItem(PANTRY_KEY, JSON.stringify(next.slice(-200))); } catch {}
};
const allMealIds = (p: WeeklyPlan | null) => new Set((p?.days || []).map(m => m.id));

const stripImages = (p: WeeklyPlan): WeeklyPlan => ({
    ...p,
    days: p.days.map(m => ({ ...m, generated_image_url: undefined }))
});

type AuthMode = 'login' | 'register' | 'forgot' | 'reset';

const AuthView: React.FC<{ mode: AuthMode, resetToken?: string, onSwitch: (m: AuthMode) => void, onBack: () => void, onSuccess: (user: AccountUser, mode: AuthMode) => void, t: any }> = ({ mode, resetToken, onSwitch, onBack, onSuccess, t }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [resetAvailable, setResetAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    setError(''); setInfo('');
    if (mode === 'forgot') passwordResetAvailable().then(setResetAvailable);
  }, [mode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setInfo('');
    if ((mode === 'register' || mode === 'reset') && password.length < 8) { setError(t.password_min); return; }
    setLoading(true);
    try {
        if (mode === 'login') onSuccess(await login(email, password), mode);
        else if (mode === 'register') onSuccess(await register(name, email, password), mode);
        else if (mode === 'reset') onSuccess(await resetPassword(resetToken || '', password), mode);
        else { await requestPasswordReset(email); setInfo(t.forgot_sent); }
    } catch (err: any) {
        setError(err?.message || t.auth_error);
    } finally {
        setLoading(false);
    }
  };

  const title = mode === 'login' ? t.welcome_back : mode === 'register' ? t.join_qook : mode === 'forgot' ? t.forgot_password : t.new_password;
  const button = mode === 'login' ? t.login_btn : mode === 'register' ? t.register_btn : mode === 'forgot' ? t.send_link : t.save_password;
  const showEmail = mode !== 'reset';
  const showPassword = mode !== 'forgot';

  return (
    <div className="min-h-screen relative flex flex-col items-center justify-center p-6 bg-kooq-white overflow-hidden">
        <div className="absolute inset-0 z-0 opacity-20">
            <img src="https://images.unsplash.com/photo-1556910103-1c02745aae4d?q=80&w=2070&auto=format&fit=crop" className="w-full h-full object-cover" alt="" />
        </div>
        <div className="relative z-10 w-full max-w-md space-y-8 animate-in fade-in zoom-in duration-500">
            <button onClick={onBack} className="flex items-center gap-2 text-kooq-slate font-bold mb-4 hover:text-kooq-dark transition-colors"><ArrowLeft size={18}/> {t.cancel}</button>
            <div className="bg-white/90 backdrop-blur-xl p-8 rounded-[2.5rem] shadow-2xl border border-white/50 space-y-6">
                <div className="text-center space-y-2">
                    <div className="w-16 h-16 bg-kooq-sage rounded-2xl flex items-center justify-center text-white mx-auto shadow-lg mb-4 font-sans font-black text-2xl">Q</div>
                    <h2 className="text-3xl font-sans font-black text-kooq-dark tracking-tighter">{title}</h2>
                    {mode === 'forgot' && <p className="text-sm text-kooq-slate">{t.forgot_intro}</p>}
                </div>
                {mode === 'forgot' && resetAvailable === false ? (
                    <p className="text-sm text-kooq-slate text-center leading-relaxed">{t.forgot_unavailable}</p>
                ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                    {mode === 'register' && (
                        <div className="space-y-1.5 animate-in slide-in-from-top-2 duration-300">
                            <label className="text-[10px] font-sans font-black text-kooq-slate uppercase tracking-widest px-1">{t.first_name}</label>
                            <div className="relative">
                                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-kooq-slate/40" size={18} />
                                <input type="text" required autoComplete="given-name" value={name} onChange={e => setName(e.target.value)} className="w-full pl-12 pr-4 py-4 bg-kooq-white border-none rounded-2xl outline-none focus:ring-2 focus:ring-kooq-sage/20 font-medium" placeholder={t.name_placeholder} />
                            </div>
                        </div>
                    )}
                    {showEmail && (
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-sans font-black text-kooq-slate uppercase tracking-widest px-1">{t.email_label}</label>
                        <div className="relative">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-kooq-slate/40" size={18} />
                            <input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full pl-12 pr-4 py-4 bg-kooq-white border-none rounded-2xl outline-none focus:ring-2 focus:ring-kooq-sage/20 font-medium" />
                        </div>
                    </div>
                    )}
                    {showPassword && (
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-sans font-black text-kooq-slate uppercase tracking-widest px-1">{mode === 'reset' ? t.new_password : t.password_label}</label>
                        <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-kooq-slate/40" size={18} />
                            <input type="password" required minLength={mode === 'login' ? undefined : 8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} className="w-full pl-12 pr-4 py-4 bg-kooq-white border-none rounded-2xl outline-none focus:ring-2 focus:ring-kooq-sage/20 font-medium" />
                        </div>
                        {mode !== 'login' && <p className="text-[11px] text-kooq-slate px-1">{t.password_min}</p>}
                    </div>
                    )}
                    {mode === 'login' && <div className="text-right"><button type="button" onClick={() => onSwitch('forgot')} className="text-xs font-sans font-black text-kooq-slate hover:text-kooq-dark">{t.forgot_password}</button></div>}
                    {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</p>}
                    {info && <p className="text-sm text-kooq-dark bg-kooq-sage/10 rounded-xl px-4 py-3">{info}</p>}
                    <Button disabled={loading} className="w-full py-5 text-lg font-sans font-black rounded-2xl shadow-xl active:scale-95 transition-all">
                        {loading ? <Loader2 className="animate-spin" /> : button}
                    </Button>
                </form>
                )}
                <div className="text-center pt-4">
                    {mode === 'forgot' || mode === 'reset' ? (
                        <button onClick={() => onSwitch('login')} className="text-sm font-sans font-black text-kooq-dark underline underline-offset-4">{t.back_to_login}</button>
                    ) : (
                    <button onClick={() => onSwitch(mode === 'login' ? 'register' : 'login')} className="text-sm text-kooq-slate font-medium">
                        {mode === 'login' ? t.no_account : t.has_account} <span className="font-sans font-black text-kooq-dark underline underline-offset-4 ml-1">{mode === 'login' ? t.register_btn : t.login_btn}</span>
                    </button>
                    )}
                </div>
            </div>
        </div>
    </div>
  );
};

export default function App() {
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [userStatus, setUserStatus] = useState<SubscriptionStatus>('free');
  // Link uit de e-mail "wachtwoord vergeten": /?reset=<sleutel>
  const [resetToken] = useState(() => new URLSearchParams(window.location.search).get('reset') || '');
  const [view, setView] = useState<'choice' | 'onboarding' | 'dashboard' | 'favorites' | 'meal-detail' | 'cooking' | 'shopping' | 'scan-results' | AuthMode>(resetToken ? 'reset' : 'choice');
  const [account] = useState<AccountUser | null>(() => getAccount());
  const [selectedMeal, setSelectedMeal] = useState<Meal | null>(null);
  const [selectedMealIds, setSelectedMealIds] = useState<Set<string>>(new Set());
  const [shoppingList, setShoppingList] = useState<ShoppingItem[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  // Favoriete gerechten zelf bewaren, zodat ze ook na een nieuw weekmenu blijven bestaan.
  const [favoriteMeals, setFavoriteMeals] = useState<Meal[]>(() => {
    try { return JSON.parse(localStorage.getItem('qook_favorite_meals') || '[]'); } catch { return []; }
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [showTrialSuccess, setShowTrialSuccess] = useState(false);
  const [isLangDropdownOpen, setIsLangDropdownOpen] = useState(false);
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false);
  const [usage, setUsage] = useState<Usage>(() => {
    const saved = localStorage.getItem('qook_usage');
    if (saved) return JSON.parse(saved);
    return { replacements: 0, scans: 0, fullRegenerations: 0, week: getWeekNumber(new Date()) };
  });
  const [loading, setLoading] = useState(false);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [loadingType, setLoadingType] = useState<'plan' | 'list' | 'scan'>('plan');
  const [scanResult, setScanResult] = useState<FridgeScanResult | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const agendaRef = useRef<HTMLElement>(null);
  const locale = detectUserLocale();
  const currentLang = preferences?.language || locale.language;
  const { t } = useTranslation(currentLang);

  const defaultDayModes: Record<number, DayMode> = {
    0: 'premium', 1: 'premium', 2: 'premium', 3: 'premium', 
    4: 'premium', 5: 'culinary', 6: 'culinary'
  };

  useEffect(() => {
    const init = async () => {
      try {
        if (window.aistudio && !(await window.aistudio.hasSelectedApiKey())) {
            await window.aistudio.openSelectKey();
        }
      } catch (e) {}

      const savedUsage = localStorage.getItem('qook_usage');
      const currentWeek = getWeekNumber(new Date());
      if (savedUsage) {
          let parsed: Usage = JSON.parse(savedUsage);
          const now = new Date();
          // Alles telt per week: vervangingen, scans en het ene extra weekmenu (Premium/Culinair/proef).
          if (parsed.week === currentWeek) {
              setUsage({ ...parsed, fullRegenerations: parsed.fullRegenerations || 0 });
          } else {
              setUsage({ replacements: 0, scans: 0, fullRegenerations: 0, week: currentWeek, lastRegenerationReset: now.toISOString() });
          }
      }

      const savedFavs = localStorage.getItem('qook_favorites');
      const favIds: string[] = savedFavs ? JSON.parse(savedFavs) : [];
      setFavoriteIds(favIds);

      const saved = localStorage.getItem('qook_prefs');
      if (saved) {
        let p: UserPreferences = JSON.parse(saved);
        if (!p.dayModes) p.dayModes = defaultDayModes;
        if (!p.generationHistory) p.generationHistory = [];
        setPreferences(p);
        setUserStatus(p.subscriptionStatus || 'free');
        const savedPlan = localStorage.getItem('qook_current_plan');
        if (savedPlan) {
            const parsedPlan: WeeklyPlan = JSON.parse(savedPlan);
            setPlan(parsedPlan);
            setSelectedMealIds(allMealIds(parsedPlan)); // standaard de hele week: één keer boodschappen
            
            // Check for 7-day auto-refresh
            if (parsedPlan.generatedAt) {
                const genDate = new Date(parsedPlan.generatedAt);
                const diffDays = (new Date().getTime() - genDate.getTime()) / (1000 * 3600 * 24);
                if (diffDays >= 7) {
                    setIsAutoRefreshing(true);
                    triggerRegeneration(p, true);
                }
            }
        }
      } else {
        const defaultPrefs: UserPreferences = {
          region: locale.region as any,
          language: locale.language,
          units: 'metric',
          adultsCount: 2,
          childrenCount: 0,
          diet: ['Geen'],
          budget: 'Normaal',
          cookingTime: '30',
          weekendCookingTime: 'unlimited',
          kitchenProfiles: [],
          weekProfile: 'surprise',
          hasOnboarded: false,
          subscriptionStatus: 'free',
          zeroWasteLevel: 65,
          partyGuests: 0,
          dayModes: defaultDayModes,
          generationHistory: []
        };
        setPreferences(defaultPrefs);
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (usage) {
        localStorage.setItem('qook_usage', JSON.stringify(usage));
    }
  }, [usage]);

  // Rechten: iedereen krijgt elke week automatisch een nieuw weekmenu. Premium/Culinair (ook in de proef)
  // mogen daarnaast 1x per week zelf een nieuw menu laten maken. Het eerste menu (onboarding) mag altijd.
  const isPremiumLike = userStatus === 'premium' || userStatus === 'culinary';
  const canRegenerateNow = () => !plan || (isPremiumLike && usage.fullRegenerations < 1);

  /** Nieuwe voorkeuren (instellingen, chat): direct een nieuw menu als dat mag, anders vanaf volgende week. */
  const applyPrefs = (p: UserPreferences, regen = true) => {
    setPreferences(p);
    localStorage.setItem('qook_prefs', JSON.stringify(p));
    if (!regen) return;
    if (canRegenerateNow()) triggerRegeneration(p);
    else alert(t.prefs_next_week);
  };

  /** Fout van de server: limiet bereikt -> abonnementen tonen, anders een melding. */
  const handleApiError = (err: any, fallbackText: string) => {
    if (err?.status === 402) { setShowPaywall(true); return; }
    alert(`${fallbackText} ${err?.message || ''}`.trim());
  };

  const triggerRegeneration = async (prefsOverride?: UserPreferences, isAuto = false, force = false) => {
    const activePrefs = prefsOverride || preferences;
    if (!activePrefs) return;
    const countsAsExtra = !isAuto && !force && !!plan;   // eerste menu en upgrade tellen niet mee

    if (!isAuto && !force && !canRegenerateNow()) {
        if (isPremiumLike) alert(t.limit_reached_alert);
        else setShowPaywall(true);
        return;
    }

    setLoadingType('plan');
    if (!isAuto) setLoading(true);
    
    try {
        // Get favorite titles for inspiration
        const favMeals = allFavoriteMeals();
        const favTitles = favMeals.map(m => m.title);

        const p = await generateWeeklyPlan(activePrefs, favTitles);
        setPlan(p);
        setSelectedMealIds(allMealIds(p)); // standaard de hele week: één keer boodschappen
        localStorage.setItem('qook_current_plan', JSON.stringify(stripImages(p)));
        
        // Update generation history with the 7 new meal titles
        const newHistory = [...(activePrefs.generationHistory || [])];
        p.days.forEach(m => {
          if (!newHistory.includes(m.title)) newHistory.push(m.title);
        });
        
        // Limit history to 100 items (~3 months)
        const cappedHistory = newHistory.slice(-100);
        const updatedPrefs = { ...activePrefs, generationHistory: cappedHistory };
        setPreferences(updatedPrefs);
        localStorage.setItem('qook_prefs', JSON.stringify(updatedPrefs));

        if (!isAuto) {
            if (countsAsExtra) setUsage(u => ({ ...u, fullRegenerations: u.fullRegenerations + 1 }));
            setView('dashboard');
        } else {
            setIsAutoRefreshing(false);
        }
    } catch (err) { 
        console.error("Plan generation failed:", err);
        if (!isAuto) handleApiError(err, 'Het weekmenu kon niet worden gemaakt.');
    } finally { 
        setLoading(false); 
    }
  };

  const handleAuthSuccess = (user: AccountUser, mode: AuthMode) => {
    if (mode !== 'register') {
        // Inloggen: de gegevens van het account staan nu op dit apparaat; opnieuw starten laadt ze.
        window.location.replace('/');
        return;
    }
    const updatedPrefs = { 
        ...preferences!, 
        name: user.name,
        subscriptionStatus: user.subscription as SubscriptionStatus,
        trialStartedAt: user.trial_started_at || undefined
    };
    setPreferences(updatedPrefs);
    setUserStatus(user.subscription as SubscriptionStatus);
    localStorage.setItem('qook_prefs', JSON.stringify(updatedPrefs));
    setShowTrialSuccess(true);
  };

  const handleLogout = async () => {
    await logout();
    window.location.replace('/');
  };

  const handleDeleteAccount = async (password: string) => {
    try {
        await deleteAccount(password);
        alert(t.account_deleted);
        window.location.replace('/');
    } catch (e: any) {
        alert(e?.message || t.auth_error);
    }
  };

  // Zoek een gerecht op id in alles wat de app op dit moment kent.
  const findMeal = (mealId: string): Meal | undefined =>
      plan?.days.find(m => m.id === mealId)
      || scanResult?.suggestions.find(m => m.id === mealId)
      || favoriteMeals.find(m => m.id === mealId)
      || (selectedMeal?.id === mealId ? selectedMeal : undefined);

  const allFavoriteMeals = (): Meal[] => {
      const stored = favoriteMeals.filter(m => favoriteIds.includes(m.id));
      const fromPlan = (plan?.days || []).filter(m => favoriteIds.includes(m.id) && !stored.some(s => s.id === m.id));
      return [...stored, ...fromPlan];
  };

  const toggleFavorite = (mealId: string) => {
      const adding = !favoriteIds.includes(mealId);
      const meal = findMeal(mealId);
      if (adding && meal) recordTaste(meal.title, 'favorite');
      setFavoriteMeals(prev => {
          const next = adding
              ? (meal ? [...prev.filter(m => m.id !== mealId), { ...meal, generated_image_url: meal.generated_image_url?.startsWith('data:') ? undefined : meal.generated_image_url }] : prev)
              : prev.filter(m => m.id !== mealId);
          try { localStorage.setItem('qook_favorite_meals', JSON.stringify(next)); } catch {}
          return next;
      });
      setFavoriteIds(prev => {
          const next = prev.includes(mealId) ? prev.filter(id => id !== mealId) : [...prev, mealId];
          localStorage.setItem('qook_favorites', JSON.stringify(next));
          return next;
      });
  };

  // Gerecht op de boodschappenlijst zetten of eraf halen (en onthouden als smaaksignaal).
  const toggleShopItem = (id: string, s: boolean) => {
      const n = new Set(selectedMealIds);
      s ? n.add(id) : n.delete(id);
      setSelectedMealIds(n);
      if (s) recordTaste(findMeal(id)?.title, 'shopping');
  };

  const handleAgendaClick = () => {
    if (userStatus !== 'culinary') setShowPaywall(true);
    else {
        setView('dashboard');
        setTimeout(() => agendaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  };

  // Fixed: handleStartCooking was missing, causing reference errors in MealDetail
  const handleStartCooking = (meal: Meal) => {
    recordTaste(meal.title, 'cooked');
    setSelectedMeal(meal);
    setView('cooking');
  };

  const setLanguage = (lang: string) => {
    if (preferences) {
        const updated = { ...preferences, language: lang };
        setPreferences(updated);
        localStorage.setItem('qook_prefs', JSON.stringify(updated));
    } else {
        const mockPrefs: UserPreferences = {
            region: locale.region,
            language: lang,
            units: 'metric',
            adultsCount: 2,
            childrenCount: 0,
            diet: ['Geen'],
            budget: 'Normaal',
            cookingTime: '30',
            weekendCookingTime: 'unlimited',
            kitchenProfiles: [],
            weekProfile: 'surprise',
            hasOnboarded: false,
            subscriptionStatus: 'free',
            zeroWasteLevel: 65,
            partyGuests: 0,
            dayModes: defaultDayModes,
            generationHistory: []
        };
        setPreferences(mockPrefs);
    }
    setIsLangDropdownOpen(false);
  };

  const isBottomActionVisible = (view === 'dashboard' && selectedMealIds.size > 0) || view === 'cooking' || view === 'shopping' || view === 'onboarding';

  if (loading) {
    const loadingTitle = loadingType === 'list' ? t.loading_list : loadingType === 'scan' ? t.loading_scan : t.loading_plan;
    return (
      <div className="min-h-screen relative flex flex-col items-center justify-center p-6 text-center overflow-hidden">
        <div className="absolute inset-0 z-0">
            <img src="https://images.unsplash.com/photo-1556910103-1c02745aae4d?q=80&w=2070&auto=format&fit=crop" className="w-full h-full object-cover" alt="" />
            <div className="absolute inset-0 bg-kooq-white/75 backdrop-blur-sm"></div>
        </div>
        <div className="relative z-10">
            <div className="w-16 h-16 border-4 border-kooq-sage border-t-transparent rounded-full animate-spin mb-8 mx-auto"></div>
            <h2 className="text-3xl font-sans font-black text-kooq-dark tracking-tighter">{loadingTitle}</h2>
        </div>
      </div>
    );
  }

  if (view === 'choice') {
    const supportedLangs = [
        { code: 'nl-NL', label: 'Nederlands' },
        { code: 'en-US', label: 'English' },
        { code: 'de-DE', label: 'Deutsch' },
        { code: 'fr-FR', label: 'Français' },
        { code: 'es-ES', label: 'Español' }
    ];

    return (
      <div className="min-h-screen relative flex flex-col items-center justify-center p-6 bg-kooq-white text-center overflow-hidden">
        <div className="absolute top-6 right-6 z-50">
            <div className="relative">
                <button 
                    onClick={() => setIsLangDropdownOpen(!isLangDropdownOpen)} 
                    className="bg-white/80 backdrop-blur-md px-4 py-2 rounded-full shadow-lg flex items-center gap-2 text-kooq-dark hover:bg-white transition-all active:scale-95 border border-white/50"
                >
                    <Globe size={18} className="text-kooq-sage" />
                    <span className="text-[10px] font-sans font-black uppercase tracking-widest">{currentLang.split('-')[0]}</span>
                    <ChevronDown size={14} className={`transition-transform duration-300 ${isLangDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {isLangDropdownOpen && (
                    <div className="absolute top-full mt-2 right-0 bg-white/95 backdrop-blur-xl rounded-[1.5rem] shadow-2xl border border-kooq-slate/5 py-2 w-40 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300">
                        {supportedLangs.map((l) => (
                            <button
                                key={l.code}
                                onClick={() => setLanguage(l.code)}
                                className={`w-full px-5 py-3 text-left text-xs font-sans font-black uppercase tracking-widest hover:bg-kooq-sage/10 transition-colors flex items-center justify-between ${currentLang === l.code ? 'text-kooq-sage' : 'text-kooq-dark/60'}`}
                            >
                                {l.label}
                                {currentLang === l.code && <Check size={12} />}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>

        <div className="absolute inset-0 z-0 transition-opacity duration-1000">
            <img src="https://images.unsplash.com/photo-1543353071-873f17a7a088?q=80&w=2070&auto=format&fit=crop" className="w-full h-full object-cover scale-105 opacity-85" alt="Welcome Background" />
            <div className="absolute inset-0 bg-gradient-to-b from-white/40 via-transparent to-white/40 backdrop-blur-[0.5px]"></div>
        </div>
        <div className="relative z-10 max-w-lg w-full space-y-12">
          <div className="space-y-4 animate-in fade-in zoom-in duration-700">
            <div className="w-24 h-24 bg-kooq-sage rounded-[2.5rem] flex items-center justify-center text-white mx-auto shadow-2xl"><span className="text-5xl font-sans font-black">Q</span></div>
            <h1 className="text-4xl font-sans font-black text-kooq-dark tracking-tighter">{t.welcome_title}</h1>
            <p className="text-lg font-sans font-black text-kooq-dark drop-shadow-sm">{t.welcome_subtitle}<br/>{t.welcome_tagline}</p>
          </div>
          <div className="space-y-4 animate-in slide-in-from-bottom-8 duration-1000">
            <button onClick={() => plan ? setView('dashboard') : setView('onboarding')} className="w-full group bg-white/95 backdrop-blur-md p-7 rounded-[2.5rem] flex items-center text-left gap-6 border border-white shadow-xl hover:shadow-2xl transition-all active:scale-[0.98]">
              <div className="w-16 h-16 bg-kooq-sage/10 text-kooq-sage rounded-2xl flex items-center justify-center"><Calendar size={32} /></div>
              <div className="flex-1">
                  <h3 className="text-xl font-sans font-black tracking-tighter text-kooq-dark">{t.choice_plan_title}</h3>
                  <p className="text-sm text-kooq-slate font-medium opacity-90">{t.choice_plan_desc}</p>
              </div>
              <ArrowRight className="text-kooq-slate/30 group-hover:text-kooq-sage transition-colors" size={24} />
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="w-full group bg-white/95 backdrop-blur-md p-7 rounded-[2.5rem] flex items-center text-left gap-6 border border-white shadow-xl hover:shadow-2xl transition-all active:scale-[0.98]">
              <div className="w-16 h-16 bg-kooq-clementine/10 text-kooq-clementine rounded-2xl flex items-center justify-center"><Camera size={32} /></div>
              <div className="flex-1">
                  <h3 className="text-xl font-sans font-black tracking-tighter text-kooq-dark">{t.choice_scan_title}</h3>
                  <p className="text-sm text-kooq-slate font-medium opacity-90">{t.choice_scan_desc}</p>
              </div>
              <ArrowRight className="text-kooq-slate/30 group-hover:text-kooq-clementine transition-colors" size={24} />
            </button>
          </div>
          {account ? (
            <p className="text-center text-kooq-dark text-sm leading-relaxed drop-shadow-sm font-medium">{t.logged_in_as} <span className="font-sans font-black">{account.name}</span></p>
          ) : (
          <button onClick={() => setView('login')} className="text-center text-kooq-dark text-sm transition-all animate-in fade-in duration-1000 delay-500 leading-relaxed drop-shadow-sm font-medium">{t.already_member}<br /><span className="font-sans font-black underline underline-offset-4">{t.login_here}</span></button>
          )}
        </div>
        <input type="file" accept="image/*" ref={fileInputRef} onChange={async (e) => {
            const file = e.target.files?.[0]; if (!file) return;
            setLoadingType('scan'); setLoading(true);
            const reader = new FileReader();
            reader.onloadend = async () => {
                try {
                    const res = await analyzeFridgeImage((reader.result as string).split(',')[1], preferences || { language: currentLang } as any);
                    setScanResult(res); setView('scan-results');
                    if (userStatus === 'basic' || userStatus === 'free' || preferences?.trialStartedAt) {
                      setUsage(u => ({ ...u, scans: u.scans + 1 }));
                    }
                } catch (err: any) {
                    // Limiet bereikt: zonder account eerst registreren, anders de abonnementen.
                    if (err?.status === 402) { if (account) setShowPaywall(true); else setView('register'); }
                    else alert(`De scan lukte niet. ${err?.message || ''}`);
                } finally {
                    setLoading(false);
                }
            };
            reader.readAsDataURL(file);
        }} className="hidden" />
      </div>
    );
  }

  if (view === 'onboarding') return <Onboarding onComplete={(p) => { setPreferences(p); triggerRegeneration(p); }} />;

  return (
    <div className="min-h-screen bg-kooq-white font-body text-kooq-dark flex flex-col">
      <Header onMenuClick={() => setView('choice')} onShopClick={() => setView('shopping')} onFavoritesClick={() => setView('favorites')} subscriptionStatus={userStatus} trialStartedAt={preferences?.trialStartedAt} onTogglePremium={() => setShowPaywall(true)} onSettingsClick={() => setShowSettings(true)} onScanClick={() => fileInputRef.current?.click()} onAgendaClick={handleAgendaClick} language={currentLang} />
      
      {/* Auto-refresh indicator */}
      {isAutoRefreshing && (
          <div className="bg-kooq-sage text-white px-4 py-2 text-center text-[10px] font-sans font-black uppercase tracking-widest animate-in slide-in-from-top duration-500 flex items-center justify-center gap-2">
             <Info size={14} /> Vers menu voor deze week staat klaar!
          </div>
      )}

      <main className="flex-1">
        {showTrialSuccess && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-kooq-dark/80 backdrop-blur-md">
                <div className="bg-white rounded-[3rem] p-10 max-w-md w-full text-center space-y-6 shadow-2xl animate-in zoom-in duration-500">
                    <div className="w-20 h-20 bg-kooq-sage/20 text-kooq-sage rounded-3xl flex items-center justify-center mx-auto">
                        <PartyPopper size={48} />
                    </div>
                    <div className="space-y-2">
                        <h2 className="text-3xl font-sans font-black text-kooq-dark tracking-tighter">{t.trial_active_title.replace('{name}', preferences?.name || '')}</h2>
                        <p className="text-sm font-medium text-kooq-slate leading-relaxed px-4">{t.trial_active_desc}</p>
                    </div>
                    <div className="bg-kooq-white p-4 rounded-2xl border border-kooq-slate/5">
                        <span className="text-[10px] font-sans font-black text-kooq-slate uppercase tracking-widest block mb-1 opacity-60">{t.free_until}</span>
                        <span className="text-lg font-sans font-black text-kooq-dark">
                            {new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toLocaleDateString(currentLang, { day: 'numeric', month: 'long', year: 'numeric' })}
                        </span>
                    </div>
                    <Button onClick={() => { setShowTrialSuccess(false); setView(plan ? 'dashboard' : 'choice'); }} className="w-full py-5 text-lg font-sans font-black shadow-xl active:scale-95 transition-all">{t.start_cooking_btn}</Button>
                </div>
            </div>
        )}
        {(view === 'login' || view === 'register' || view === 'forgot' || view === 'reset') && (
            <AuthView mode={view} resetToken={resetToken} onSwitch={(m) => setView(m)} onBack={() => { if (resetToken) window.history.replaceState(null, '', '/'); setView(plan ? 'dashboard' : 'choice'); }} onSuccess={handleAuthSuccess} t={t} />
        )}
        {view === 'dashboard' && plan && preferences && (
          <Dashboard 
            plan={plan} 
            userStatus={userStatus} 
            trialStartedAt={preferences.trialStartedAt}
            onUnlock={() => setView('register')} 
            onMealSelect={(m: Meal) => { setSelectedMeal(m); setView('meal-detail'); }} 
            selectedMealIds={selectedMealIds} 
            onToggleShopItem={toggleShopItem} 
            onGenerateList={() => { setLoadingType('list'); setLoading(true); generateShoppingList(plan.days.filter(m => selectedMealIds.has(m.id)), preferences).then(list => { const have = new Set(pantryHave()); setShoppingList(list.map(i => isPantryItem(i) && have.has(i.name.toLowerCase()) ? { ...i, checked: true } : i)); setView('shopping'); }).catch(e => alert(`De boodschappenlijst kon niet worden gemaakt. ${e?.message || ''}`)).finally(() => setLoading(false)); }} 
            onReplaceMeal={async (oldMeal: Meal, dayIndex: number) => { 
                if (userStatus === 'free' || userStatus === 'basic') {
                    if (usage.replacements >= 3) { 
                        setShowPaywall(true); 
                        return; 
                    }
                }
                
                setReplacingId(oldMeal.id); 
                try { 
                    // Use favorite titles for replacement inspiration
                    const favMeals = allFavoriteMeals();
                    const favTitles = favMeals.map(m => m.title);

                    // Stuur het hele weekmenu mee, zodat het nieuwe gerecht niet al op een andere dag staat.
                    const newMeal = await replaceMeal(oldMeal, { ...preferences, currentWeek: plan.days.map((m: any) => ({ title: m.title, main_ingredient: m.main_ingredient, cuisine: m.cuisine })) } as any, dayIndex, favTitles); 
                    recordTaste(oldMeal.title, 'replaced');
                    const updatedDays = plan.days.map((m, i) => i === dayIndex ? newMeal : m); 
                    const newPlan = { ...plan, days: updatedDays }; 
                    setPlan(newPlan); 
                    setSelectedMealIds(prev => { if (!prev.has(oldMeal.id)) return prev; const n = new Set(prev); n.delete(oldMeal.id); n.add(newMeal.id); return n; });
                    localStorage.setItem('qook_current_plan', JSON.stringify(stripImages(newPlan))); 
                    
                    // Add new meal to history
                    const newHistory = [...(preferences.generationHistory || [])];
                    if (!newHistory.includes(newMeal.title)) newHistory.push(newMeal.title);
                    const updatedPrefs = { ...preferences, generationHistory: newHistory.slice(-100) };
                    setPreferences(updatedPrefs);
                    localStorage.setItem('qook_prefs', JSON.stringify(updatedPrefs));

                    if (userStatus === 'free' || userStatus === 'basic') {
                        setUsage(u => ({ ...u, replacements: u.replacements + 1 })); 
                    }
                } catch (e) { 
                    console.error(e); 
                    handleApiError(e, 'Vervangen lukte niet.');
                } finally { 
                    setReplacingId(null); 
                } 
            }} 
            language={currentLang} 
            dayModes={preferences.dayModes} 
            onUpdateDayMode={(idx: number, mode: DayMode) => { const updated = { ...preferences.dayModes, [idx]: mode }; const newPrefs = { ...preferences, dayModes: updated }; setPreferences(newPrefs); localStorage.setItem('qook_prefs', JSON.stringify(newPrefs)); }} 
            onRegenerate={() => triggerRegeneration()} 
            replacingId={replacingId} 
            onShowPaywall={() => setShowPaywall(true)} 
            agendaRef={agendaRef} 
            usage={usage}
          />
        )}
        {view === 'meal-detail' && selectedMeal && (
          <MealDetail meal={selectedMeal} isPremium={userStatus !== 'free'} isFreeMeal={userStatus === 'free' && plan?.days[0]?.id === selectedMeal.id} userPrefs={preferences!} onBack={() => setView('dashboard')} onStartCooking={handleStartCooking} onShowPaywall={() => setShowPaywall(true)} onToggleList={toggleShopItem} isSelected={selectedMealIds.has(selectedMeal.id)} onSelectSuggestion={(m) => setSelectedMeal(m)} isFavorite={favoriteIds.includes(selectedMeal.id)} onToggleFavorite={() => toggleFavorite(selectedMeal.id)} selectedMealIds={selectedMealIds} onUnlock={() => setView('register')} />
        )}
        {view === 'favorites' && preferences && (
            <FavoritesView favoriteMeals={allFavoriteMeals()} favoriteIds={favoriteIds} onMealSelect={(m) => { setSelectedMeal(m); setView('meal-detail'); }} onToggleFavorite={(m) => toggleFavorite(m.id)} onBack={() => setView('dashboard')} language={currentLang} isPremium={userStatus !== 'free'} hasHealthMode={userStatus === 'culinary'} selectedMealIds={selectedMealIds} onToggleShopItem={toggleShopItem} />
        )}
        {view === 'scan-results' && scanResult && (
            <div className="p-6 max-w-5xl mx-auto space-y-6">
                <button onClick={() => setView('choice')} className="flex items-center gap-2 text-kooq-slate font-bold"><ArrowLeft size={18}/> {t.cancel}</button>
                <h2 className="text-2xl font-sans font-black text-kooq-dark tracking-tighter">{t.scan_results_title}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {scanResult.suggestions.map(m => ( <Dashboard.MealCard key={m.id} meal={m} onClick={() => { setSelectedMeal(m); setView('meal-detail'); }} selectedMealIds={selectedMealIds} onToggleShopItem={toggleShopItem} t={t} language={currentLang} /> ))}
                </div>
            </div>
        )}
        {view === 'cooking' && selectedMeal && <CookingMode meal={selectedMeal} onClose={() => setView('dashboard')} language={currentLang} onFeedback={(_id, rating) => recordTaste(selectedMeal.title, rating === 'up' ? 'liked' : 'disliked')} />}
        {view === 'shopping' && <ShoppingList items={shoppingList} onClose={() => setView('dashboard')} onToggleItem={(id) => setShoppingList(l => l.map(i => { if (i.id !== id) return i; if (isPantryItem(i)) rememberPantry(i.name, !i.checked); return { ...i, checked: !i.checked }; }))} language={currentLang} />}
      </main>
      {preferences && <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} preferences={preferences} onUpdate={(p) => applyPrefs(p)} onReset={async () => { await resetAccountData(); localStorage.clear(); window.location.reload(); }} account={account} onLogin={() => { setShowSettings(false); setView('login'); }} onLogout={handleLogout} onDeleteAccount={handleDeleteAccount} onUnlock={() => setView('register')} userStatus={userStatus === 'free' ? 'visitor' : userStatus as any} onShowPaywall={(m) => setShowPaywall(true)} />}
      <ChatAssistant 
        userPrefs={preferences || {} as any} 
        currentPlan={plan} 
        userStatus={userStatus === 'free' ? 'visitor' : userStatus as any} 
        onUpdatePrefs={(p, regen = true) => applyPrefs(p, regen)} 
        onShowPaywall={() => setShowPaywall(true)} 
        currentView={view} 
        onSetStatus={(s) => setUserStatus(s as any)} 
        onUnlock={() => setView('register')}
        hasBottomAction={isBottomActionVisible}
      />
      <PaywallModal isOpen={showPaywall} onClose={() => setShowPaywall(false)} onUpgrade={(tier) => { 
          // Een abonnement hoort bij een account: eerst inloggen of registreren.
          if (!account) { setShowPaywall(false); setView('register'); return; }
          setUserStatus(tier); 
          saveSubscription(tier);
          if (preferences) { 
              const updated = { ...preferences, subscriptionStatus: tier, trialStartedAt: undefined }; 
              setPreferences(updated); 
              localStorage.setItem('qook_prefs', JSON.stringify(updated)); 
              if (tier === 'premium' || tier === 'culinary') triggerRegeneration(updated, false, true); 
          } 
          setShowPaywall(false); 
      }} language={currentLang} currentStatus={userStatus} />
      <input type="file" accept="image/*" ref={fileInputRef} onChange={async (e) => {
          const file = e.target.files?.[0]; if (!file) return;
          const scanLimited = userStatus === 'basic' || userStatus === 'free' || !!preferences?.trialStartedAt;
          if (scanLimited && usage.scans >= 1) { setShowPaywall(true); return; }
          setLoadingType('scan'); setLoading(true);
          const reader = new FileReader();
          reader.onloadend = async () => {
              try {
                  const res = await analyzeFridgeImage((reader.result as string).split(',')[1], preferences || { language: currentLang } as any);
                  setScanResult(res); setView('scan-results');
                  if (scanLimited) setUsage(u => ({ ...u, scans: u.scans + 1 }));
              } catch (err) {
                  handleApiError(err, 'De scan lukte niet.');
              } finally {
                  setLoading(false);
              }
          };
          reader.readAsDataURL(file);
      }} className="hidden" />
    </div>
  );
}
