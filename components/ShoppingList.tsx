
import React from 'react';
import { ShoppingItem } from '../types';
import { X, Check, MessageSquare } from 'lucide-react';
import { Button } from './Shared';
import { useTranslation } from '../utils/i18n';

interface Props {
  items: ShoppingItem[];
  onClose: () => void;
  onToggleItem: (id: string) => void;
  language: string;
}

export const ShoppingList: React.FC<Props> = ({ items, onClose, onToggleItem, language }) => {
  const { t } = useTranslation(language);
  const grouped = items.reduce((acc, item) => { if (!acc[item.category]) acc[item.category] = []; acc[item.category].push(item); return acc; }, {} as Record<string, ShoppingItem[]>);

  const handleShare = () => {
      let text = `🛒 *Qook Boodschappenlijst*\n\n`;
      (Object.entries(grouped) as [string, ShoppingItem[]][]).forEach(([cat, items]) => {
          text += `*${cat}*\n`;
          items.forEach(i => { text += `${i.checked ? '✅' : '☐'} ${i.name} (${i.amount} ${i.unit})\n`; });
          text += `\n`;
      });
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`);
  };

  return (
    <div className="fixed inset-0 z-40 bg-white flex flex-col animate-in slide-in-from-bottom duration-300">
      <div className="p-4 border-b border-kooq-slate/10 flex items-center justify-between bg-kooq-white">
        <h2 className="text-xl font-bold text-kooq-dark">{t.shopping_list}</h2>
        <button onClick={onClose} className="p-2 rounded-full hover:bg-kooq-slate/10"><X size={24} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 max-w-2xl mx-auto w-full">
         {items.length === 0 ? <div className="text-center py-20 text-kooq-slate">{t.empty_list}</div> : (
             <div className="space-y-6">
                 {Object.keys(grouped).map(cat => (
                     <div key={cat}>
                         <h3 className="text-sm font-bold text-kooq-sage uppercase tracking-wider mb-2 sticky top-0 bg-white py-2 z-10">{cat}</h3>
                         <div className="space-y-2">
                             {grouped[cat].map(item => (
                                 <div key={item.id} onClick={() => onToggleItem(item.id)} className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer ${item.checked ? 'bg-kooq-white border-transparent opacity-50' : 'bg-white border-kooq-slate/10'}`}>
                                     <div className={`mt-1 w-5 h-5 rounded-md border flex items-center justify-center ${item.checked ? 'bg-kooq-sage border-kooq-sage text-white' : 'border-kooq-slate/30'}`}>{item.checked && <Check size={14} />}</div>
                                     <div className="flex-1 min-w-0 font-medium">{item.name}</div>
                                     <span className="text-sm font-semibold text-kooq-slate">{item.amount} {item.unit}</span>
                                 </div>
                             ))}
                         </div>
                     </div>
                 ))}
             </div>
         )}
      </div>
      <div className="p-4 border-t border-kooq-slate/10 bg-white space-y-3">
          <Button onClick={handleShare} className="w-full max-w-md mx-auto bg-kooq-dark text-white border-none shadow-xl"><MessageSquare size={18}/> {t.share_list}</Button>
          <Button onClick={onClose} variant="secondary" className="w-full max-w-md mx-auto">{t.done}</Button>
      </div>
    </div>
  );
};
