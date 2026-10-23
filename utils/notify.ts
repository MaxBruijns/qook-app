// Nette meldingen in de app (in plaats van de kale pop-ups van de browser).
export type NoticeKind = 'info' | 'error' | 'success';
export interface Notice { id: number; text: string; kind: NoticeKind }

type Listener = (n: Notice) => void;
const listeners = new Set<Listener>();
let next = 1;

export const notify = (text: string, kind: NoticeKind = 'info') => {
  const n = { id: next++, text, kind };
  listeners.forEach(l => l(n));
};

export const onNotice = (l: Listener) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};
