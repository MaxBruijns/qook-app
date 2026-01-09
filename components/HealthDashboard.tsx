
import React from 'react';
import { DayPlan, Meal } from '../types';
import { Card, Button } from './Shared';
import { Flame, Clock, Plus, Check, Heart, Coffee, Utensils, Apple } from 'lucide-react';
import { useTranslation } from '../utils/i18n';

interface Props {
  weekPlans: (DayPlan | null)[];
  selectedDayIndex: number;
  onSelectDay: (index: number) => void;
  onMealSelect: (meal: Meal) => void;
  onToggleShopItem: (id: string, selected: boolean) => void;
  selectedMealIds: Set<string>;
  onGenerateList: () => void;
  language: string;
  loading: boolean;
}

const MealRow: React.FC<{ title: string, meal: Meal, onClick: () => void, isSelected: boolean, onSelect: (checked: boolean) => void, icon: any }> = ({ title, meal, onClick, isSelected, onSelect, icon: Icon }) => {
    return (
        <Card className="flex items-center p-3 gap-4 mb-3 hover:shadow-md transition-shadow cursor-pointer" onClick={onClick}>
             <div className="w-16 h-16 rounded-xl bg-kooq-sage/10 flex items-center justify-center text-kooq-sage flex-shrink-0"><Icon size={24}/></div>
             <div className="flex-1 min-w-0">
                 <div className="text-[10px] font-bold text-kooq-sage uppercase tracking-wider mb-0.5">{title}</div>
                 <h4 className="font-bold text-kooq-dark text-sm truncate">{meal.title}</h4>
                 <div className="flex gap-3 text-xs text-kooq-slate"><span>{meal.calories_per_portion} kcal</span></div>
             </div>
             <div onClick={e => e.stopPropagation()}>
                <label className="p-2 cursor-pointer"><input type="checkbox" checked={isSelected} onChange={(e) => onSelect(e.target.checked)} className="w-5 h-5 rounded border-kooq-slate/30 text-kooq-sage" /></label>
             </div>
        </Card>
    );
}

export const HealthDashboard: React.FC<Props> = ({ weekPlans, selectedDayIndex, onSelectDay, onMealSelect, onToggleShopItem, selectedMealIds, onGenerateList, language, loading }) => {
  const { t } = useTranslation(language);
  const plan = weekPlans[selectedDayIndex];
  const targetCals = plan?.targetCalories || 2000;
  const currentCals = plan?.totalCalories || 0;
  const remaining = targetCals - currentCals;
  const ratio = Math.min(100, (currentCals / targetCals) * 100);

  return (
    <div className="p-4 pb-32 max-w-2xl mx-auto space-y-6">
        <div className="flex gap-2 overflow-x-auto no-scrollbar py-2">
            {[0,1,2,3,4,5,6].map(i => (
                <button key={i} onClick={() => onSelectDay(i)} className={`px-4 py-3 rounded-2xl text-xs font-bold transition-all min-w-[50px] ${selectedDayIndex === i ? 'bg-kooq-sage text-white' : 'bg-white text-kooq-slate'}`}>{t[`day_short_${i}`]}</button>
            ))}
        </div>

        {plan ? (
            <>
                <div className="bg-kooq-dark text-white p-6 rounded-3xl shadow-xl space-y-4">
                    <div className="flex justify-between items-end">
                        <div><h2 className="text-sm opacity-80">{t.day_total}</h2><div className="text-4xl font-bold">{currentCals} <span className="text-lg opacity-50">/ {targetCals} kcal</span></div></div>
                        <div className="text-right text-kooq-sage font-bold">{remaining > 0 ? t.health_remaining.replace('{kcal}', remaining.toString()) : 'Target met!'}</div>
                    </div>
                    <div className="h-3 bg-white/10 rounded-full overflow-hidden"><div className="h-full bg-kooq-sage transition-all duration-1000" style={{ width: `${ratio}%` }}></div></div>
                </div>
                <div className="space-y-3">
                    <MealRow title={t.breakfast} meal={plan.breakfast} icon={Coffee} onClick={() => onMealSelect(plan.breakfast)} isSelected={selectedMealIds.has(plan.breakfast.id)} onSelect={(c) => onToggleShopItem(plan.breakfast.id, c)} />
                    <MealRow title={t.lunch} meal={plan.lunch} icon={Utensils} onClick={() => onMealSelect(plan.lunch)} isSelected={selectedMealIds.has(plan.lunch.id)} onSelect={(c) => onToggleShopItem(plan.lunch.id, c)} />
                    {plan.snacks.map((s, i) => <MealRow key={i} title={t.snacks} meal={s} icon={Apple} onClick={() => onMealSelect(s)} isSelected={selectedMealIds.has(s.id)} onSelect={(c) => onToggleShopItem(s.id, c)} />)}
                    <MealRow title={t.dinner} meal={plan.dinner} icon={Utensils} onClick={() => onMealSelect(plan.dinner)} isSelected={selectedMealIds.has(plan.dinner.id)} onSelect={(c) => onToggleShopItem(plan.dinner.id, c)} />
                </div>
            </>
        ) : <div className="text-center py-20 opacity-50">{loading ? t.loading_day : 'Geen plan voor deze dag'}</div>}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-kooq-slate/10 z-20 flex justify-center"><Button onClick={onGenerateList} disabled={selectedMealIds.size === 0} className="w-full max-w-md">{t.make_list} ({selectedMealIds.size})</Button></div>
    </div>
  );
};
