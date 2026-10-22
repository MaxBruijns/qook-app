
import React, { useState } from 'react';
import { ShoppingItem } from '../types';
import { X, Check, MessageSquare, ChevronUp, ChevronDown, ArrowUpDown } from 'lucide-react';
import { Button } from './Shared';
import { useTranslation } from '../utils/i18n';

interface Props {
  items: ShoppingItem[];
  onClose: () => void;
  onToggleItem: (id: string) => void;
  language: string;
}

// Volgorde van de afdelingen in jouw eigen supermarkt (onthouden op dit apparaat).
const ORDER_KEY = 'qook_shop_order';
const loadOrder = (): string[] => { try { return JSON.parse(localStorage.getItem(ORDER_KEY) || '[]'); } catch { return []; } };
const saveOrder = (order: string[]) => { try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch {} };

/** Afdelingen in de eigen volgorde; nieuwe afdelingen behouden de standaardvolgorde (looproute). */
const sortCategories = (cats: string[], order: string[]) => {
  const pos = (c: string) => { const i = order.indexOf(c); return i < 0 ? order.length + cats.indexOf(c) : i; };
  return [...cats].sort((a, b) => pos(a) - pos(b));
};

/** 1.5 -> "1,5"; 0 (zout, peper, naar smaak) -> niets. */
const formatAmount = (item: ShoppingItem, language: string) => {
  const n = Number(item.amount) || 0;
  if (!n) return '';
  return `${n.toLocaleString(language || 'nl-NL', { maximumFractionDigits: 1 })} ${item.unit || ''}`.trim();
};

export const ShoppingList: React.FC<Props> = ({ items, onClose, onToggleItem, language }) => {
  const { t } = useTranslation(language);
  const grouped = items.reduce((acc, item) => { if (!acc[item.category]) acc[item.category] = []; acc[item.category].push(item); return acc; }, {} as Record<string, ShoppingItem[]>);
  const [order, setOrder] = useState<string[]>(loadOrder);
  const [editOrder, setEditOrder] = useState(false);
  const categories = sortCategories(Object.keys(grouped), order);

  // Afdeling een plek omhoog of omlaag; de hele volgorde wordt onthouden (ook afdelingen die nu niet op de lijst staan).
  const move = (cat: string, dir: -1 | 1) => {
    const i = categories.indexOf(cat), j = i + dir;
    if (j < 0 || j >= categories.length) return;
    const visible = [...categories];
    [visible[i], visible[j]] = [visible[j], visible[i]];
    const rest = order.filter(c => !visible.includes(c));
    const next = [...visible, ...rest];
    setOrder(next);
    saveOrder(next);
  };

  const handleShare = () => {
      let text = `🛒 *Qook Boodschappenlijst*\n\n`;
      categories.map(cat => [cat, grouped[cat]] as [string, ShoppingItem[]]).forEach(([cat, items]) => {
          text += `*${cat}*\n`;
          items.forEach(i => { const a = formatAmount(i, language); text += `${i.checked ? '✅' : '☐'} ${i.name}${a ? ` (${a})` : ''}\n`; });
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
                 <button onClick={() => setEditOrder(e => !e)} className="flex items-center gap-2 text-xs font-bold text-kooq-slate hover:text-kooq-dark">
                     <ArrowUpDown size={14} /> {editOrder ? t.shop_order_done : t.shop_order_edit}
                 </button>
                 {categories.map((cat, ci) => (
                     <div key={cat}>
                         <div className="flex items-center justify-between sticky top-0 bg-white py-2 z-10 mb-2">
                             <h3 className="text-sm font-bold text-kooq-sage uppercase tracking-wider">{cat}</h3>
                             {editOrder && (
                                 <div className="flex gap-1">
                                     <button aria-label="omhoog" disabled={ci === 0} onClick={() => move(cat, -1)} className="p-2 rounded-lg bg-kooq-white disabled:opacity-30"><ChevronUp size={16} /></button>
                                     <button aria-label="omlaag" disabled={ci === categories.length - 1} onClick={() => move(cat, 1)} className="p-2 rounded-lg bg-kooq-white disabled:opacity-30"><ChevronDown size={16} /></button>
                                 </div>
                             )}
                         </div>
                         <div className="space-y-2">
                             {grouped[cat].map(item => (
                                 <div key={item.id} onClick={() => onToggleItem(item.id)} className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer ${item.checked ? 'bg-kooq-white border-transparent opacity-50' : 'bg-white border-kooq-slate/10'}`}>
                                     <div className={`mt-1 w-5 h-5 rounded-md border flex items-center justify-center ${item.checked ? 'bg-kooq-sage border-kooq-sage text-white' : 'border-kooq-slate/30'}`}>{item.checked && <Check size={14} />}</div>
                                     <div className="flex-1 min-w-0 font-medium">{item.name}</div>
                                     <span className="text-sm font-semibold text-kooq-slate whitespace-nowrap">{formatAmount(item, language)}</span>
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
