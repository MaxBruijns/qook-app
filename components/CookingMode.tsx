
import React, { useState, useEffect, useRef } from 'react';
import { Meal, Step } from '../types';
import { Button } from './Shared';
import { X, ChevronRight, RotateCcw, Clock, CheckCircle, ThumbsUp, ThumbsDown, Users, Play, Pause, BellRing, Trash2 } from 'lucide-react';
import { useTranslation } from '../utils/i18n';

interface Props {
  meal: Meal;
  onClose: () => void;
  language: string;
  onFeedback: (mealId: string, rating: 'up' | 'down') => void;
}

interface ActiveTimer {
  id: string;
  label: string;
  timeLeft: number;
  initialTime: number;
  isActive: boolean;
}

export const CookingMode: React.FC<Props> = ({ meal, onClose, language, onFeedback }) => {
  const { t } = useTranslation(language);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [feedbackGiven, setFeedbackGiven] = useState(false);
  const [activeTimers, setActiveTimers] = useState<ActiveTimer[]>([]);
  
  const steps = meal.steps || [];
  const currentStep = steps[currentStepIndex];

  // Global Timer Engine
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveTimers(prev => prev.map(timer => {
        if (timer.isActive && timer.timeLeft > 0) {
          return { ...timer, timeLeft: timer.timeLeft - 1 };
        }
        if (timer.timeLeft === 0 && timer.isActive) {
          return { ...timer, isActive: false };
        }
        return timer;
      }));
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const addTimer = (step: Step) => {
    const timerId = `timer-${step.step_index}`;
    // Don't duplicate
    if (activeTimers.find(t => t.id === timerId)) return;

    const newTimer: ActiveTimer = {
      id: timerId,
      label: (step as any).timer_label || `Stap ${step.step_index + 1}`,
      timeLeft: step.estimated_duration_seconds,
      initialTime: step.estimated_duration_seconds,
      isActive: true
    };
    setActiveTimers(prev => [...prev, newTimer]);
  };

  const removeTimer = (id: string) => {
    setActiveTimers(prev => prev.filter(t => t.id !== id));
  };

  const toggleTimer = (id: string) => {
    setActiveTimers(prev => prev.map(t => t.id === id ? { ...t, isActive: !t.isActive } : t));
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
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
                    {activeTimers.map(timer => (
                        <div 
                            key={timer.id} 
                            onClick={() => toggleTimer(timer.id)}
                            className={`flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all shrink-0 w-40 snap-start cursor-pointer active:scale-95 ${
                                timer.timeLeft === 0 
                                ? 'bg-kooq-clementine border-kooq-clementine text-white animate-pulse ring-4 ring-kooq-clementine/20' 
                                : 'bg-white/10 text-white border-white/10 hover:bg-white/15'
                            }`}
                        >
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${timer.timeLeft === 0 ? 'bg-white/20' : 'bg-white/10'}`}>
                                {timer.timeLeft === 0 ? <BellRing size={14} className="animate-shake" /> : timer.isActive ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
                            </div>
                            <div className="flex-1 min-w-0 flex flex-col leading-none">
                                <span className="text-[14px] font-sans font-black tabular-nums">{formatTime(timer.timeLeft)}</span>
                                <span className="text-[8px] font-bold opacity-60 uppercase tracking-widest truncate">{timer.label}</span>
                            </div>
                            <button 
                                onClick={(e) => { e.stopPropagation(); removeTimer(timer.id); }}
                                className="p-1.5 hover:bg-white/20 rounded-full text-white/40 hover:text-white"
                            >
                                <Trash2 size={12} />
                            </button>
                        </div>
                    ))}
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
            
            {currentStep.needs_timer && (
              <button 
                onClick={() => addTimer(currentStep)}
                className={`group px-8 py-5 rounded-3xl flex items-center gap-4 mx-auto font-sans font-black uppercase tracking-widest shadow-lg active:scale-95 transition-all border-2 ${
                   activeTimers.find(t => t.id === `timer-${currentStep.step_index}`)
                   ? 'bg-kooq-sage text-white border-kooq-sage pointer-events-none'
                   : 'bg-kooq-sand/10 border-kooq-sand/30 text-kooq-dark hover:bg-kooq-sand/20'
                }`}
              >
                <Clock size={28} className={activeTimers.find(t => t.id === `timer-${currentStep.step_index}`) ? 'text-white' : 'text-kooq-sage'} />
                <div className="flex flex-col items-start leading-none">
                  <span className="text-2xl tracking-tighter tabular-nums">
                    {formatTime(currentStep.estimated_duration_seconds)}
                  </span>
                  <span className="text-[8px] opacity-60 uppercase tracking-widest">
                    {activeTimers.find(t => t.id === `timer-${currentStep.step_index}`) ? 'BEZIG...' : `TIMER VOOR: ${(currentStep as any).timer_label || 'DEZE STAP'}`}
                  </span>
                </div>
                {!activeTimers.find(t => t.id === `timer-${currentStep.step_index}`) && <Play size={20} fill="currentColor" />}
              </button>
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
