
import React from 'react';
import { Meal } from '../types';
import { MealCard } from './Dashboard';
import { ArrowLeft, Heart } from 'lucide-react';
import { useTranslation } from '../utils/i18n';

interface Props {
  favoriteMeals: Meal[];
  favoriteIds: string[];
  onMealSelect: (meal: Meal) => void;
  onToggleFavorite: (meal: Meal) => void;
  onBack: () => void;
  language: string;
  isPremium: boolean;
  hasHealthMode: boolean;
  selectedMealIds: Set<string>;
  onToggleShopItem: (id: string, selected: boolean) => void;
}

export const FavoritesView: React.FC<Props> = ({ 
    favoriteMeals, favoriteIds, onMealSelect, onToggleFavorite, onBack, language, isPremium, hasHealthMode, selectedMealIds, onToggleShopItem 
}) => {
    const { t } = useTranslation(language);

    return (
        <div className="p-4 max-w-5xl mx-auto space-y-6 animate-in slide-in-from-right duration-300">
            <div className="flex items-center gap-4">
                <button onClick={onBack} className="p-2 hover:bg-kooq-slate/10 rounded-full text-kooq-dark transition-colors">
                    <ArrowLeft size={24} />
                </button>
                <h1 className="text-2xl font-bold text-kooq-dark flex items-center gap-2">
                    <Heart size={24} className="text-kooq-dark" fill="currentColor" />
                    {t.favorites}
                </h1>
            </div>

            {favoriteMeals.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 text-center text-kooq-slate bg-kooq-white/50 rounded-3xl border border-dashed border-kooq-slate/20">
                    <Heart size={48} className="mb-4 opacity-20" />
                    <p className="max-w-xs">{t.favorites_empty}</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {favoriteMeals.map(meal => (
                        <MealCard 
                            key={meal.id}
                            meal={meal}
                            onClick={() => onMealSelect(meal)}
                            selectedMealIds={selectedMealIds}
                            onToggleShopItem={onToggleShopItem}
                            t={t}
                            // Fixed: Passed language prop to fix TypeScript error
                            language={language}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};