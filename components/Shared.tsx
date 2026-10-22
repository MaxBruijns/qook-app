
import React from 'react';
import { Lock, Crown, Settings, Heart, Check, Star, RefreshCw, Camera, Sparkles, Wine, ShoppingBag, Calendar, Globe, Languages } from 'lucide-react';
import { useTranslation, translations } from '../utils/i18n';
import { SubscriptionStatus } from '../types';
import { Notice, onNotice } from '../utils/notify';

export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'outline' | 'ghost' }> = ({ 
  children, variant = 'primary', className = '', ...props 
}) => {
  const baseStyle = "px-4 py-3 rounded-xl font-sans font-black uppercase tracking-widest text-[10px] md:text-xs transition-all duration-200 flex items-center justify-center gap-2 active:scale-95";
  const variants = {
    primary: "bg-kooq-sage text-white hover:bg-opacity-90 shadow-lg shadow-kooq-sage/20 border-none",
    secondary: "bg-kooq-dark text-white hover:bg-opacity-90 shadow-md border-none",
    outline: "border-2 border-kooq-dark text-kooq-dark hover:bg-kooq-dark hover:text-white",
    ghost: "text-kooq-slate hover:bg-kooq-slate/10 border-none"
  };

  return (
    <button className={`${baseStyle} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
};

export const Card: React.FC<{ children: React.ReactNode, className?: string, onClick?: () => void }> = ({ children, className = '', onClick }) => (
  <div onClick={onClick} className={`bg-white rounded-2xl shadow-sm border border-kooq-slate/5 overflow-hidden ${className} ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}>
    {children}
  </div>
);

export const PaywallModal: React.FC<{ 
    isOpen: boolean; 
    onClose: () => void; 
    onUpgrade: (mode: SubscriptionStatus, period: 'month' | 'year') => void; 
    language: string;
    currentStatus: SubscriptionStatus;
}> = ({ isOpen, onClose, onUpgrade, language, currentStatus }) => {
  const { t } = useTranslation(language);
  // Per maand of per jaar (Basic is altijd per jaar).
  const [period, setPeriod] = React.useState<'month' | 'year'>('year');
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-kooq-dark/90 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-[2.5rem] w-full max-w-5xl relative shadow-2xl overflow-y-auto max-h-[95vh] p-8">
        <button onClick={onClose} className="absolute top-6 right-6 text-kooq-slate hover:text-kooq-dark z-10 p-2">✕</button>
        
        <div className="text-center mb-10">
            <h2 className="text-3xl font-black text-kooq-dark mb-2">Kies jouw kook-partner</h2>
            <p className="text-kooq-slate font-medium">Van dagelijks gemak tot gastronomische beleving.</p>
            <div className="inline-flex mt-6 p-1 rounded-full bg-kooq-white border border-kooq-slate/10" role="group" aria-label="Betaalperiode">
                {(['month', 'year'] as const).map(p => (
                    <button key={p} onClick={() => setPeriod(p)} aria-pressed={period === p}
                        className={`px-5 py-2 rounded-full text-xs font-sans font-black uppercase tracking-widest transition-all ${period === p ? 'bg-kooq-dark text-white' : 'text-kooq-slate'}`}>
                        {p === 'month' ? 'Per maand' : 'Per jaar (voordeliger)'}
                    </button>
                ))}
            </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
            <div className="border border-kooq-slate/10 rounded-3xl p-6 flex flex-col bg-kooq-white/30">
                <div className="mb-6">
                    <div className="w-12 h-12 bg-kooq-slate text-white rounded-2xl flex items-center justify-center mb-4 shadow-md"><Check size={24} /></div>
                    <h3 className="text-xl font-black text-kooq-dark mb-1">Qook Basic</h3>
                    <p className="text-[10px] text-kooq-slate font-black uppercase tracking-widest mb-4">De Fundering</p>
                    <div className="space-y-1">
                        <div className="text-2xl font-black text-kooq-dark">€19,99 <span className="text-xs opacity-50">/ jaar</span></div>
                        <div className="text-[10px] font-bold text-kooq-sage">Slechts €1,66 per maand</div>
                    </div>
                </div>
                <ul className="space-y-3 mb-8 flex-1">
                    <li className="flex gap-2 text-xs font-medium"><Check size={14} className="text-kooq-sage shrink-0"/> 52 weken gebalanceerd menu</li>
                    <li className="flex gap-2 text-xs font-medium"><Check size={14} className="text-kooq-sage shrink-0"/> 3x per week een gerecht vervangen</li>
                    <li className="flex gap-2 text-xs font-medium"><Check size={14} className="text-kooq-sage shrink-0"/> 1x per week Koelkast-Magic</li>
                </ul>
                <Button onClick={() => onUpgrade('basic', 'year')} variant="outline" className="w-full">Start Basic</Button>
            </div>

            <div className="border-2 border-kooq-sage rounded-3xl p-6 flex flex-col bg-white shadow-xl relative scale-105 z-10">
                <div className="absolute top-0 right-0 bg-kooq-sage text-white text-[8px] font-black px-4 py-1.5 rounded-bl-2xl rounded-tr-2xl uppercase tracking-widest">Populair</div>
                <div className="mb-6">
                    <div className="w-12 h-12 bg-kooq-sage text-white rounded-2xl flex items-center justify-center mb-4 shadow-lg"><Crown size={24} /></div>
                    <h3 className="text-xl font-black text-kooq-dark mb-1">Qook Premium</h3>
                    <p className="text-[10px] text-kooq-sage font-black uppercase tracking-widest mb-4">De Personal Assistant</p>
                    <div className="space-y-1">
                        <div className="text-2xl font-black text-kooq-dark">€4,99 <span className="text-xs opacity-50">/ maand</span></div>
                        <div className="text-[10px] font-bold text-kooq-slate opacity-60">Of €39,99 per jaar (bespaar 33%)</div>
                    </div>
                </div>
                <ul className="space-y-3 mb-8 flex-1">
                    <li className="flex gap-2 text-xs font-bold text-kooq-dark"><Check size={14} className="text-kooq-sage shrink-0"/> Onbeperkt gerechten vervangen</li>
                    <li className="flex gap-2 text-xs font-bold text-kooq-dark"><Check size={14} className="text-kooq-sage shrink-0"/> Onbeperkte Koelkast-Magic</li>
                    <li className="flex gap-2 text-xs font-bold text-kooq-dark"><Check size={14} className="text-kooq-sage shrink-0"/> Elke week 1x extra weekmenu</li>
                    <li className="flex gap-2 text-xs font-bold text-kooq-dark"><Check size={14} className="text-kooq-sage shrink-0"/> Menu afgestemd op jouw smaak + zero-waste-rapport</li>
                </ul>
                <Button onClick={() => onUpgrade('premium', period)} className="w-full bg-kooq-sage border-none shadow-kooq-sage/20">Start Premium</Button>
            </div>

            <div className="border border-kooq-dark/10 rounded-3xl p-6 flex flex-col bg-kooq-dark text-white shadow-2xl">
                <div className="mb-6">
                    <div className="w-12 h-12 bg-kooq-clementine text-white rounded-2xl flex items-center justify-center mb-4 shadow-lg"><Wine size={24} /></div>
                    <h3 className="text-xl font-black text-white mb-1">Qook Culinair</h3>
                    <p className="text-[10px] text-kooq-clementine font-black uppercase tracking-widest mb-4">Gastronomisch</p>
                    <div className="space-y-1">
                        <div className="text-2xl font-black">€9,99 <span className="text-xs opacity-50">/ maand</span></div>
                        <div className="text-[10px] font-bold text-white/50">Of €69,99 per jaar (bespaar 42%)</div>
                    </div>
                </div>
                <ul className="space-y-3 mb-8 flex-1">
                    <li className="flex gap-2 text-xs font-medium"><Check size={14} className="text-kooq-clementine shrink-0"/> Onbeperkt gastronomische recepten</li>
                    <li className="flex gap-2 text-xs font-medium"><Check size={14} className="text-kooq-clementine shrink-0"/> Wijn-Spijs suggesties</li>
                    <li className="flex gap-2 text-xs font-medium"><Check size={14} className="text-kooq-clementine shrink-0"/> Per dag kiezen: culinair of gewoon</li>
                    <li className="flex gap-2 text-xs font-medium"><Check size={14} className="text-kooq-clementine shrink-0"/> Chef's Plating Tips</li>
                </ul>
                <Button onClick={() => onUpgrade('culinary', period)} className="w-full bg-kooq-clementine border-none shadow-kooq-clementine/20">Start Culinair</Button>
            </div>
        </div>

        <div className="mt-10 text-center">
            <button onClick={onClose} className="text-sm font-sans font-black uppercase tracking-widest text-kooq-slate underline hover:text-kooq-dark">Misschien later</button>
        </div>
      </div>
    </div>
  );
};

export const Badge: React.FC<{ children: React.ReactNode, variant?: 'free' | 'premium' | 'culinary' }> = ({ children, variant = 'free' }) => {
    let styles = "bg-kooq-sage/20 text-kooq-dark border-kooq-sage/30";
    if (variant === 'premium') styles = "bg-kooq-clementine/10 text-kooq-clementine border-kooq-clementine/20";
    if (variant === 'culinary') styles = "bg-kooq-dark text-white border-kooq-dark/20";
    
    return (
        <span className={`px-2 py-1 rounded-full text-[8px] font-black uppercase tracking-widest border ${styles}`}>
            {children}
        </span>
    );
}

export const Header: React.FC<{ 
  onMenuClick: () => void, 
  onShopClick: () => void, 
  onFavoritesClick: () => void,
  subscriptionStatus: SubscriptionStatus, 
  trialStartedAt?: string,
  onTogglePremium: () => void, 
  onSettingsClick: () => void,
  onScanClick: () => void,
  onAgendaClick: () => void,
  language: string
}> = ({ onMenuClick, onShopClick, onFavoritesClick, subscriptionStatus, trialStartedAt, onTogglePremium, onSettingsClick, onScanClick, language }) => {
    const { t } = useTranslation(language);
    
    let statusLabel = subscriptionStatus.toUpperCase();
    let statusStyle = 'bg-kooq-slate/10 text-kooq-slate border-kooq-slate/20 shadow-sm';
    
    if (subscriptionStatus === 'premium') {
        statusStyle = 'bg-kooq-dark text-white border-kooq-dark shadow-md';
        statusLabel = trialStartedAt ? "PROEF PREMIUM" : "PREMIUM";
    } else if (subscriptionStatus === 'culinary') {
        statusStyle = 'bg-kooq-clementine text-white border-kooq-clementine shadow-md';
        statusLabel = "CULINAIR";
    } else if (subscriptionStatus === 'basic') {
        statusStyle = 'bg-kooq-sage text-white border-kooq-sage shadow-md';
        statusLabel = trialStartedAt ? "PROEFPERIODE" : "BASIC";
    }

    return (
        <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-kooq-slate/10 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-1">
                <div className="flex items-center gap-2 cursor-pointer" onClick={onMenuClick}>
                    <div className="w-8 h-8 bg-kooq-sage rounded-lg flex items-center justify-center text-white font-bold shadow-sm">Q</div>
                    <span className="font-sans font-black text-xl text-kooq-dark tracking-tighter">Qook</span>
                </div>
            </div>
            <div className="flex items-center gap-1 md:gap-3">
                <button onClick={onScanClick} className="p-2 text-kooq-slate hover:bg-kooq-sage hover:text-white rounded-full transition-all flex items-center gap-1.5 md:px-3">
                    <Camera size={20} />
                    <span className="hidden md:inline text-[10px] font-sans font-black uppercase tracking-wider">{t.scan_short}</span>
                </button>
                <button onClick={onFavoritesClick} className="p-2 text-kooq-slate hover:bg-kooq-slate/10 rounded-full">
                    <Heart size={20} />
                </button>
                <button onClick={onSettingsClick} className="p-2 text-kooq-slate hover:bg-kooq-slate/10 rounded-full">
                    <Settings size={20} />
                </button>
                <button onClick={onTogglePremium} className={`text-[10px] px-3 py-1.5 md:px-5 rounded-full border ${statusStyle} transition-all font-sans font-black uppercase tracking-widest`}>
                    {statusLabel}
                </button>
            </div>
        </header>
    );
};

/** Meldingen onderaan het scherm; verdwijnen vanzelf na een paar seconden. */
export const Notices: React.FC = () => {
  const [items, setItems] = React.useState<Notice[]>([]);
  React.useEffect(() => onNotice(n => {
    setItems(list => [...list.slice(-2), n]);
    setTimeout(() => setItems(list => list.filter(x => x.id !== n.id)), n.kind === 'error' ? 7000 : 4500);
  }), []);
  if (!items.length) return null;
  return (
    <div className="fixed inset-x-0 bottom-28 z-[120] flex flex-col items-center gap-2 px-4 pointer-events-none" role="status" aria-live="polite">
      {items.map(n => (
        <div key={n.id} onClick={() => setItems(list => list.filter(x => x.id !== n.id))}
          className={`pointer-events-auto max-w-md w-full rounded-2xl px-5 py-4 text-sm font-medium shadow-2xl cursor-pointer animate-in slide-in-from-bottom-4 duration-300 ${
            n.kind === 'error' ? 'bg-red-600 text-white' : n.kind === 'success' ? 'bg-kooq-sage text-white' : 'bg-kooq-dark text-white'}`}>
          {n.text}
        </div>
      ))}
    </div>
  );
};

/** Laatste dagen van de proef: wat je houdt, wat je kwijtraakt, en het aanbod. */
export const TrialEndingModal: React.FC<{ isOpen: boolean; daysLeft: number; stats?: Partial<Record<string, number>>;
  language: string; onClose: () => void; onChoose: () => void }> = ({ isOpen, daysLeft, stats, language, onClose, onChoose }) => {
  const { t } = useTranslation(language);
  if (!isOpen) return null;
  const title = daysLeft <= 0 ? t.trial_end_today : daysLeft === 1 ? t.trial_end_tomorrow : t.trial_end_days.replace('{n}', String(daysLeft));
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-kooq-dark/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="trial-end-title">
      <div className="bg-white rounded-[2.5rem] p-8 max-w-md w-full space-y-6 shadow-2xl animate-in zoom-in duration-300">
        <div className="space-y-2">
          <h2 id="trial-end-title" className="text-2xl font-sans font-black text-kooq-dark tracking-tighter">{title}</h2>
          {stats && (stats.lists || stats.plans) ? (
            <p className="text-sm text-kooq-slate">{t.trial_stats.replace('{plans}', String(stats.plans || 0)).replace('{lists}', String(stats.lists || 0)).replace('{reused}', String(stats.reused || 0))}</p>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="space-y-2">
            <p className="text-[10px] font-sans font-black uppercase tracking-widest text-kooq-sage">{t.trial_keep}</p>
            <ul className="space-y-1 text-kooq-dark">{String(t.trial_keep_list).split('|').map((x: string) => <li key={x}>{x}</li>)}</ul>
          </div>
          <div className="space-y-2">
            <p className="text-[10px] font-sans font-black uppercase tracking-widest text-kooq-clementine">{t.trial_lose}</p>
            <ul className="space-y-1 text-kooq-slate">{String(t.trial_lose_list).split('|').map((x: string) => <li key={x}>{x}</li>)}</ul>
          </div>
        </div>
        <p className="text-sm text-kooq-dark bg-kooq-sage/10 rounded-2xl px-4 py-3">{t.trial_offer}</p>
        <div className="flex flex-col gap-3">
          <Button onClick={onChoose} className="w-full py-4 font-sans font-black">{t.trial_choose}</Button>
          <button onClick={onClose} className="text-sm text-kooq-slate font-medium">{t.trial_later}</button>
        </div>
      </div>
    </div>
  );
};
