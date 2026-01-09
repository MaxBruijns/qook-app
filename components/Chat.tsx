
import React, { useState, useEffect, useRef } from 'react';
import { Send, X, MessageCircle, Sparkles, Activity, Target, Layout, ChevronRight } from 'lucide-react';
import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { ChatMessage, UserPreferences, WeeklyPlan } from '../types';
import { useTranslation } from '../utils/i18n';

interface Props {
  userPrefs: UserPreferences;
  currentPlan: WeeklyPlan | null;
  userStatus: 'visitor' | 'trial' | 'premium' | 'culinary';
  onUpdatePrefs: (newPrefs: UserPreferences, shouldRegenerate?: boolean) => void;
  onShowPaywall: () => void;
  currentView: string;
  onSetStatus: (status: string) => void;
  onUnlock: () => void;
  hasBottomAction?: boolean;
}

const updatePrefsTool: FunctionDeclaration = {
  name: 'updateUserPreferences',
  parameters: {
    type: Type.OBJECT,
    description: 'Update kookvoorkeuren of stel doelen in.',
    properties: {
      diet: { type: Type.ARRAY, items: { type: Type.STRING } },
      newMealRequest: { type: Type.STRING }
    }
  }
};

export const ChatAssistant: React.FC<Props> = ({ userPrefs, currentPlan, userStatus, onUpdatePrefs, onShowPaywall, currentView, onSetStatus, onUnlock, hasBottomAction }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [nudge, setNudge] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation(userPrefs.language || 'nl-NL');

  useEffect(() => {
    let question = "";
    
    if (userStatus === 'visitor' && messages.length === 0) {
      question = "Voor hoeveel personen kook je?";
    } else {
      switch (currentView) {
        case 'dashboard':
          question = "Menu aanpassen?";
          break;
        case 'meal-detail':
          question = "Ingrediënt vervangen?";
          break;
        case 'shopping':
          question = "Lijstje delen?";
          break;
        case 'scan-results':
          question = "Welk recept kies je?";
          break;
        case 'favorites':
          question = "Favoriet inplannen?";
          break;
        case 'cooking':
          question = "Hulp bij deze stap?";
          break;
        case 'choice':
          question = "Weekplan of scan?";
          break;
        default:
          question = "Vraag de chef!";
      }
    }

    setNudge(question);

    if (messages.length === 0 || (messages.length === 1 && messages[0].id.startsWith('init-'))) {
        let fullWelcome = "";
        switch (currentView) {
            case 'dashboard': fullWelcome = "Hier is je weekmenu! Wil je iets aanpassen of heb je vragen over de gerechten?"; break;
            case 'meal-detail': fullWelcome = "Lekker recept! Heb je hulp nodig bij de bereiding of wilt u een ingrediënt vervangen?"; break;
            case 'shopping': fullWelcome = "Boodschappen doen? Ik kan je helpen items af te vinken of je lijstje te delen."; break;
            case 'scan-results': fullWelcome = "Kijk eens wat een lekkere opties met jouw ingrediënten! Welke spreekt je het meest aan?"; break;
            case 'cooking': fullWelcome = "Succes met koken! Heb je hulp nodig bij een specifieke stap of wil je een timer zetten?"; break;
            default: fullWelcome = "Hoi Chef! Hoe kan ik je vandaag helpen met koken?";
        }
        setMessages([{ id: 'init-' + Date.now(), sender: 'assistant', text: fullWelcome }]);
    }
  }, [currentView, userStatus, messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  const handleSend = async (forcedInput?: string) => {
    const messageText = forcedInput || input;
    if (!messageText.trim() || loading) return;

    const userMsg: ChatMessage = { id: Date.now().toString(), sender: 'user', text: messageText };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const systemInstruction = `
        Je bent de culinaire motor achter de Qook-app. 
        Je plant weekmenu's en fungeert als een intelligente Sous-chef. 
        Je bent professioneel, kort en bondig.
        [USER_STATUS]: ${userStatus}
        [CURRENT_SCREEN]: ${currentView}
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [
            ...messages.map(m => ({ role: m.sender === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })),
            { role: 'user', parts: [{ text: messageText }] }
        ],
        config: { systemInstruction, tools: [{ functionDeclarations: [updatePrefsTool] }] }
      });

      const responseText = response.text || "";

      if (response.functionCalls) {
        for (const call of response.functionCalls) {
            if (call.name === 'updateUserPreferences') {
                const args = call.args as any;
                const updatedPrefs = { ...userPrefs };
                if (args.diet) updatedPrefs.diet = args.diet;
                onUpdatePrefs(updatedPrefs, false);
                setMessages(prev => [...prev, { 
                    id: Date.now().toString(), 
                    sender: 'assistant', 
                    text: "Begrepen! Ik heb je voorkeuren bijgewerkt." 
                }]);
            }
        }
      } else {
        setMessages(prev => [...prev, { id: Date.now().toString(), sender: 'assistant', text: responseText }]);
      }
    } catch (e) {
      setMessages(prev => [...prev, { id: Date.now().toString(), sender: 'assistant', text: "Er ging iets mis. Probeer het later opnieuw." }]);
    } finally {
      setLoading(false);
    }
  };

  const bottomPos = hasBottomAction ? 'bottom-32' : 'bottom-8';
  const mdBottomPos = hasBottomAction ? 'md:bottom-32' : 'md:bottom-8';

  return (
    <>
      {/* Floating Action Area - Changed to flex-row-reverse to put nudge left of FAB */}
      <div className={`fixed ${bottomPos} right-6 z-50 flex flex-row-reverse items-center gap-3 transition-all duration-500 ${isOpen ? 'opacity-0 scale-0 pointer-events-none' : 'opacity-100 scale-100'}`}>
        
        {/* FAB Button */}
        <button 
            onClick={() => setIsOpen(true)} 
            className="w-14 h-14 bg-kooq-sage text-white rounded-full shadow-2xl flex items-center justify-center hover:scale-105 transition-transform border-none active:scale-95 shrink-0"
        >
          <MessageCircle size={28} />
        </button>

        {/* The Nudge Bubble (The "Question") - Now positioned to the LEFT of the button */}
        {nudge && (
            <div 
                onClick={() => setIsOpen(true)}
                className="bg-white px-5 py-3 rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.15)] flex items-center gap-2 animate-in slide-in-from-right-4 duration-500 cursor-pointer hover:bg-kooq-white group border-none whitespace-nowrap"
            >
                <span className="text-[11px] font-black text-kooq-dark uppercase tracking-wider">{nudge}</span>
                <ChevronRight size={14} className="text-kooq-slate/40 group-hover:translate-x-0.5 transition-transform rotate-180" />
            </div>
        )}
      </div>

      <div className={`fixed inset-x-0 bottom-0 md:inset-auto ${mdBottomPos} md:right-6 md:w-96 md:h-[600px] bg-white z-[60] flex flex-col shadow-2xl transition-all duration-300 transform rounded-t-[2.5rem] md:rounded-[2.5rem] border border-kooq-slate/10 overflow-hidden ${isOpen ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="bg-kooq-sage p-6 flex items-center justify-between text-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-2xl flex items-center justify-center font-black">Q</div>
            <div>
                <h2 className="font-black leading-none text-white">Qook Sous-chef</h2>
                <div className="text-[8px] opacity-60 uppercase font-black tracking-widest">Smart Assistant</div>
            </div>
          </div>
          <button onClick={() => setIsOpen(false)} className="p-2 hover:bg-white/20 rounded-full transition-colors text-white"><X size={24} /></button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-kooq-white/50 no-scrollbar">
          {messages.map(msg => (
            <div key={msg.id} className={`flex flex-col gap-3 ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`max-w-[85%] p-4 rounded-3xl text-sm leading-relaxed ${msg.sender === 'user' ? 'bg-kooq-sage text-white rounded-br-none shadow-lg' : 'bg-white text-kooq-dark border border-kooq-slate/5 rounded-bl-none shadow-sm whitespace-pre-wrap'}`}>
                {msg.text}
              </div>
            </div>
          ))}
          {loading && <div className="flex justify-start"><div className="bg-white p-4 rounded-3xl flex gap-1.5"><div className="w-1.5 h-1.5 bg-kooq-sage rounded-full animate-bounce"></div><div className="w-1.5 h-1.5 bg-kooq-sage rounded-full animate-bounce delay-150"></div><div className="w-1.5 h-1.5 bg-kooq-sage rounded-full animate-bounce delay-300"></div></div></div>}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 bg-white border-t border-kooq-slate/10 flex gap-3 items-center shrink-0">
          <input 
            value={input} 
            onChange={(e) => setInput(e.target.value)} 
            onKeyDown={(e) => e.key === 'Enter' && handleSend()} 
            placeholder="Vraag de chef..." 
            className="flex-1 bg-kooq-white/80 border-none rounded-2xl px-5 py-3.5 text-sm outline-none font-medium" 
          />
          <button 
            onClick={() => handleSend()} 
            disabled={!input.trim() || loading} 
            className="p-4 bg-kooq-sage text-white rounded-2xl transition-all hover:bg-opacity-90 disabled:opacity-50"
          >
            <Send size={20} />
          </button>
        </div>
      </div>
    </>
  );
};
