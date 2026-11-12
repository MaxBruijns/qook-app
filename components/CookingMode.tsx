
import React, { useState, useEffect, useRef } from 'react';
import { Meal, Step } from '../types';
import { Button } from './Shared';
import { X, ChevronRight, RotateCcw, Clock, CheckCircle, ThumbsUp, ThumbsDown, Users, Play, Pause, BellRing, Trash2 } from 'lucide-react';
import { useTranslation } from '../utils/i18n';
import { stepTimers, StepTimer } from '../utils/cookTimers';

interface Props {
  meal: Meal;
  onClose: () => void;
  language: string;
  onFeedback: (mealId: string, rating: 'up' | 'down') => void;
}

interface ActiveTimer {
  id: string;
  label: string;
  endAt: number;              // tijdstip waarop de tijd om is (klopt ook als het scherm even uit was)
  pausedLeft: number | null;  // resterende ms tijdens pauze
  done: boolean;
}

// Korte piepjes via de luidspreker (geen geluidsbestand nodig) + trillen waar het kan.
let audio: AudioContext | null = null;
const unlockAudio = () => {
  try { audio = audio || new (window.AudioContext || (window as any).webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch {}
};
const ring = () => {
  try { navigator.vibrate?.([300, 150, 300, 150, 600]); } catch {}
  if (!audio) return;
  [0, 0.35, 0.7].forEach(t => {
    const o = audio!.createOscillator(), g = audio!.createGain();
    o.frequency.value = 880; o.type = 'sine';
    g.gain.setValueAtTime(0.0001, audio!.currentTime + t);
    g.gain.exponentialRampToValueAtTime(0.4, audio!.currentTime + t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audio!.currentTime + t + 0.25);
    o.connect(g).connect(audio!.destination); o.start(audio!.currentTime + t); o.stop(audio!.currentTime + t + 0.3);
  });
};

export const CookingMode: React.FC<Props> = ({ meal, onClose, language, onFeedback }) => {
  const { t } = useTranslation(language);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [feedbackGiven, setFeedbackGiven] = useState(false);
  const [activeTimers, setActiveTimers] = useState<ActiveTimer[]>([]);
  
  const steps = meal.steps || [];
  const currentStep = steps[currentStepIndex];

  const [now, setNow] = useState(Date.now());
  const left = (t: ActiveTimer) => Math.max(0, Math.ceil(((t.pausedLeft ?? (t.endAt - now)) as number) / 1000));

  // Klok: rekent vanaf de eindtijd, dus loopt niet achter als de telefoon even op slot ging.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, []);

  // Tijd om: één keer markeren en piepen; daarna elke 5 seconden opnieuw tot je hem wegtikt.
  useEffect(() => {
    let rang = false;
    const next = activeTimers.map(t => {
      if (!t.done && t.pausedLeft === null && t.endAt <= now) { rang = true; return { ...t, done: true }; }
      return t;
    });
    if (rang) { setActiveTimers(next); ring(); }
  }, [now]);
  useEffect(() => {
    if (!activeTimers.some(t => t.done)) return;
    const again = setInterval(ring, 5000);
    return () => clearInterval(again);
  }, [activeTimers.some(t => t.done)]);

  // Scherm aan houden zolang de kookstand open is (waar de browser dat toestaat).
  useEffect(() => {
    let lock: any = null;
    const request = async () => { try { lock = await (navigator as any).wakeLock?.request('screen'); } catch {} };
    const onVisible = () => { if (document.visibilityState === 'visible') request(); };
    request();
    document.addEventListener('visibilitychange', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); try { lock?.release(); } catch {} };
  }, []);

  const timerId = (stepIdx: number, i: number) => `timer-${stepIdx}-${i}`;
  const addTimer = (stepIdx: number, i: number, timer: StepTimer) => {
    unlockAudio();
    const id = timerId(stepIdx, i);
    if (activeTimers.find(t => t.id === id)) return;
    setActiveTimers(prev => [...prev, { id, label: `${t.step} ${stepIdx + 1} · ${timer.label}`, endAt: Date.now() + timer.seconds * 1000, pausedLeft: null, done: false }]);
  };

  const removeTimer = (id: string) => {
    setActiveTimers(prev => prev.filter(t => t.id !== id));
  };

  const toggleTimer = (id: string) => {
    setActiveTimers(prev => prev.map(tm => {
      if (tm.id !== id) return tm;
      if (tm.done) return tm;
      return tm.pausedLeft === null
        ? { ...tm, pausedLeft: Math.max(0, tm.endAt - Date.now()) }
        : { ...tm, endAt: Date.now() + tm.pausedLeft, pausedLeft: null };
    }));
  };

  const addMinute = (id: string) => {
    setActiveTimers(prev => prev.map(tm => tm.id !== id ? tm : tm.pausedLeft !== null
      ? { ...tm, pausedLeft: tm.pausedLeft + 60000 }
      : { ...tm, endAt: Math.max(tm.endAt, Date.now()) + 60000, done: false }));
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600), mins = Math.floor((seconds % 3600) / 60), secs = seconds % 60;
    const mm = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    return h ? `${h}:${mm}` : mm;
  };

  const handleFeedback = (rating: 'up' | 'down') => {
      onFeedback(meal.id, rating);
      setFeedbackGiven(true);
  };

  if (currentStepIndex >= steps.length) {
      return (
          <div className="fixed inset-0 z-50 bg-white flex flex-col items-center justify-center p-6 text-center">
              <div className="w-20 h-20 bg-kooq-sage/20 rounded-full flex items-center justify-center text-kooq-sage mb-6 animate-bounce"><CheckCircle size={48}/></div>
              <h2 className="text-3xl font-sans font-black text-kooq-dark mb-4">{t.cooking_done_title}</h2>
              <p className="text-kooq-slate mb-8 font-medium">{t.cooking_done_desc}</p>
              {!feedbackGiven ? (
                  <div className="flex gap-4 mb-10">
                    <button onClick={() => handleFeedback('down')} className="p-6 rounded-3xl bg-kooq-white border border-kooq-slate/10 hover:border-red-400 transition-all active:scale-90"><ThumbsDown size={32} className="text-kooq-slate"/></button>
                    <button onClick={() => handleFeedback('up')} className="p-6 rounded-3xl bg-kooq-white border border-kooq-slate/10 hover:border-kooq-sage transition-all active:scale-90"><ThumbsUp size={32} className="text-kooq-sage"/></button>
                  </div>
              ) : <p className="text-kooq-sage font-sans font-black uppercase tracking-widest text-xs mb-10">{t.feedback_saved}</p>}
              <Button onClick={onClose} className="w-full max-w-xs py-5 text-sm">{t.back_overview}</Button>
          </div>
      );
  }

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      {/* Dynamic Header with Progress and Global Timers Slider */}
      <div className="shrink-0 bg-white border-b border-kooq-slate/10 shadow-sm z-10">
          <div className="px-4 py-4 flex items-center justify-between">
            <button onClick={onClose} className="p-2 hover:bg-kooq-white rounded-full"><X size={24} /></button>
            <div className="flex-1 px-4">
                 <div className="h-1.5 w-full bg-kooq-slate/10 rounded-full overflow-hidden">
                    <div className="h-full bg-kooq-sage transition-all duration-500" style={{ width: `${((currentStepIndex + 1) / steps.length) * 100}%` }}></div>
                 </div>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1 bg-kooq-dark/5 rounded-full text-[10px] font-sans font-black text-kooq-dark uppercase tracking-widest ml-2 border border-kooq-dark/10">
                <Users size={12} className="text-kooq-sage" /> {meal.servings || 2} PERS
            </div>
          </div>

          {/* Persistent Global Timer Slider */}
          {activeTimers.length > 0 && (
            <div className="relative bg-kooq-dark overflow-hidden group">
                {/* Horizontal Snap Scroll Container */}
                <div className="px-4 py-3 flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory">
                    {activeTimers.map(timer => {
                      const secs = left(timer), paused = timer.pausedLeft !== null;
                      return (
                        <div 
                            key={timer.id} 
                            onClick={() => timer.done ? removeTimer(timer.id) : toggleTimer(timer.id)}
                            className={`flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all shrink-0 w-56 snap-start cursor-pointer active:scale-95 ${
                                timer.done
                                ? 'bg-kooq-clementine border-kooq-clementine text-white animate-pulse ring-4 ring-kooq-clementine/20' 
                                : 'bg-white/10 text-white border-white/10 hover:bg-white/15'
                            }`}
                        >
                            <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${timer.done ? 'bg-white/20' : 'bg-white/10'}`}>
                                {timer.done ? <BellRing size={16} className="animate-shake" /> : paused ? <Play size={14} fill="currentColor" /> : <Pause size={14} fill="currentColor" />}
                            </div>
                            <div className="flex-1 min-w-0 flex flex-col leading-tight">
                                <span className="text-xl font-sans font-black tabular-nums">{timer.done ? t.timer_done : formatTime(secs)}</span>
                                <span className="text-xs font-bold opacity-70 truncate">{timer.label}</span>
                            </div>
                            <button 
                                onClick={(e) => { e.stopPropagation(); addMinute(timer.id); }}
                                className="px-2 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-black shrink-0"
                                aria-label="+1 min"
                            >+1</button>
                            <button 
                                onClick={(e) => { e.stopPropagation(); removeTimer(timer.id); }}
                                className="p-1.5 hover:bg-white/20 rounded-full text-white/50 hover:text-white"
                                aria-label="verwijderen"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                      );
                    })}
                    {/* Spacer for ending scroll nicely */}
                    <div className="w-4 shrink-0" />
                </div>
                {/* Visual hint that there's more to scroll */}
                {activeTimers.length > 2 && (
                    <div className="absolute top-0 right-0 h-full w-12 bg-gradient-to-l from-kooq-dark to-transparent pointer-events-none" />
                )}
            </div>
          )}
      </div>

      {/* Main Step Content */}
      <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center text-center">
         <div className="max-w-md w-full animate-in fade-in zoom-in duration-300">
            <div className="mb-4 text-[10px] font-sans font-black text-kooq-sage uppercase tracking-[0.2em]">{t.step} {currentStepIndex + 1} <span className="text-kooq-slate/30 mx-1">/</span> {steps.length}</div>
            <h2 className="text-3xl font-sans font-black text-kooq-dark mb-10 leading-tight tracking-tighter">{currentStep.user_text}</h2>
            
            {stepTimers(currentStep.user_text).length > 0 && (
              <div className="flex flex-col gap-3 items-center">
                {stepTimers(currentStep.user_text).map((tm, i) => {
                  const running = activeTimers.find(a => a.id === timerId(currentStepIndex, i));
                  return (
                    <button 
                      key={i}
                      onClick={() => addTimer(currentStepIndex, i, tm)}
                      className={`group px-8 py-5 rounded-3xl flex items-center gap-4 mx-auto font-sans font-black shadow-lg active:scale-95 transition-all border-2 ${
                         running
                         ? 'bg-kooq-sage text-white border-kooq-sage pointer-events-none'
                         : 'bg-kooq-sand/10 border-kooq-sand/30 text-kooq-dark hover:bg-kooq-sand/20'
                      }`}
                    >
                      <Clock size={28} className={running ? 'text-white' : 'text-kooq-sage'} />
                      <div className="flex flex-col items-start leading-tight">
                        <span className="text-2xl tracking-tighter tabular-nums">
                          {running ? formatTime(left(running)) : formatTime(tm.seconds)}
                        </span>
                        <span className="text-xs opacity-70">
                          {running ? t.timer_running : tm.maxSeconds > tm.seconds ? t.timer_range.replace('{range}', tm.label) : t.timer_start}
                        </span>
                      </div>
                      {!running && <Play size={20} fill="currentColor" />}
                    </button>
                  );
                })}
              </div>
            )}
         </div>
      </div>

      {/* Footer Navigation */}
      <div className="p-6 bg-white border-t border-kooq-slate/10 flex gap-4 max-w-md mx-auto w-full shrink-0">
         <Button variant="ghost" onClick={() => setCurrentStepIndex(Math.max(0, currentStepIndex - 1))} disabled={currentStepIndex === 0} className="flex-1 h-14 border border-kooq-slate/10"><RotateCcw size={20} /></Button>
         <Button onClick={() => setCurrentStepIndex(currentStepIndex + 1)} className="flex-[3] h-14 text-sm shadow-xl">{t.next_step} <ChevronRight size={20} /></Button>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(-10deg); }
          75% { transform: rotate(10deg); }
        }
        .animate-shake {
          animation: shake 0.5s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
};
