// Maaltijdgeschiedenis met datum.
//
// Hiermee bewaakt de backend dat gerechten niet te snel terugkomen:
// gewone gerechten niet binnen 8 weken, favorieten na 4 weken weer wel,
// afgekeurde gerechten nooit meer.
//
// Nu bewaard op dit apparaat. Bij de inlogstap verhuist dit naar de database.

export interface HistoryEntry {
  title: string;
  date: string;              // ISO-datum waarop het gerecht op het menu kwam
  main_ingredient?: string;
  cuisine?: string;
}

const KEY = 'qook_meal_history';
const MAX_ENTRIES = 400;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Ouder dan dit sturen we niet mee: het venster is hoogstens 8 weken. */
const SEND_WEEKS = 12;

const load = (): HistoryEntry[] => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
    // Eenmalige overstap: oude titels zonder datum behandelen als twee weken geleden.
    const prefs = JSON.parse(localStorage.getItem('qook_prefs') || '{}');
    const old: string[] = Array.isArray(prefs.generationHistory) ? prefs.generationHistory : [];
    const date = new Date(Date.now() - 2 * WEEK_MS).toISOString();
    return old.map(title => ({ title, date }));
  } catch {
    return [];
  }
};

const save = (h: HistoryEntry[]) => {
  try { localStorage.setItem(KEY, JSON.stringify(h.slice(-MAX_ENTRIES))); } catch {}
};

/** Gerechten die op het menu gezet zijn (nieuw weekmenu of vervangen). */
export const recordPlanned = (meals: { title?: string; main_ingredient?: string; cuisine?: string }[]) => {
  const date = new Date().toISOString();
  const entries = meals.filter(m => m?.title).map(m => ({
    title: String(m.title), date, main_ingredient: m.main_ingredient, cuisine: m.cuisine,
  }));
  if (entries.length) save([...load(), ...entries]);
};

/** Recente geschiedenis voor de backend, met "aantal weken geleden" in plaats van datums. */
export const getRecentHistory = () => {
  const now = Date.now();
  return load()
    .map(h => ({ title: h.title, cuisine: h.cuisine, weeksAgo: Math.floor((now - new Date(h.date).getTime()) / WEEK_MS) }))
    .filter(h => h.weeksAgo < SEND_WEEKS)
    .slice(-150);
};
