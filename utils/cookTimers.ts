// Timers in de kookstand komen uit de tekst van de stap zelf, niet uit een schatting:
// alleen waar een vaste tijd staat ("kook de pasta 10 minuten", "laat 30 minuten marineren")
// komt een timer, met precies die tijd. Iets dat afhangt van pan of fornuis
// ("breng water aan de kook", "bak tot goudbruin") krijgt geen timer.

export interface StepTimer {
  seconds: number;      // starttijd van de timer (bij een bereik: de onderkant)
  maxSeconds: number;   // bovenkant van een bereik (gelijk aan seconds als er geen bereik is)
  label: string;        // zoals in de tekst, bv. "8–10 min"
}

// Zinsdelen die over een wachttijd gaan die niet vastligt: geen timer.
const VARIABLE = /aan de kook|voorverwarm|op temperatuur|tot (het|de) [^,.;]*kook|preheat|bring[^,.;]* to (a |the )?boil|until [^,.;]*boil/i;

const UNIT: [RegExp, number][] = [
  [/^(sec|seconde|seconden|seconds?)$/i, 1],
  [/^(min|minuut|minuten|minuutjes|minutes?|mins?)$/i, 60],
  [/^(uur|uren|hours?|hrs?)$/i, 3600],
];

const unitSeconds = (u: string) => UNIT.find(([re]) => re.test(u))?.[1] || 0;
const num = (s: string) => Number(s.replace(',', '.'));

const fmt = (sec: number) => (sec % 3600 === 0 ? `${sec / 3600} uur` : sec % 60 === 0 ? `${sec / 60} min` : `${sec} sec`);

export function stepTimers(text: string): StepTimer[] {
  if (!text) return [];
  const found: StepTimer[] = [];
  for (const clause of text.split(/[.;!?]|\s—\s|, (?=daarna|dan|en dan|then)/i)) {
    if (!clause.trim() || VARIABLE.test(clause)) continue;
    // Woorden: "anderhalf uur", "een half uur", "een kwartier", "een uur", "een minuut"
    const words: [RegExp, number][] = [
      [/\banderhalf uur\b/i, 5400], [/\b(een )?half uur\b/i, 1800], [/\b(een )?kwartier\b/i, 900],
      [/\b(een|één) uur\b/i, 3600], [/\b(een|één) minuut\b/i, 60], [/\b(an|one) hour\b/i, 3600], [/\bhalf an hour\b/i, 1800],
    ];
    let matchedWord = false;
    for (const [re, sec] of words) {
      if (re.test(clause)) {
        found.push({ seconds: sec, maxSeconds: sec, label: fmt(sec) });
        matchedWord = true;
        break;
      }
    }
    if (matchedWord) continue;
    // Getallen: "10 minuten", "8-10 min", "8 tot 10 minuten", "1,5 uur", "30 seconden"
    const re = /(\d+(?:[.,]\d+)?)\s*(?:(?:-|–|tot|à|to)\s*(\d+(?:[.,]\d+)?)\s*)?([a-zA-Z]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(clause))) {
      const per = unitSeconds(m[3]);
      if (!per) continue;
      const lo = Math.round(num(m[1]) * per), hi = m[2] ? Math.round(num(m[2]) * per) : lo;
      if (lo <= 0 || hi > 12 * 3600) continue;
      const label = m[2] ? `${m[1]}–${m[2]} ${fmt(per).replace(/^\d+ /, '')}` : fmt(lo);
      found.push({ seconds: Math.min(lo, hi), maxSeconds: Math.max(lo, hi), label });
    }
  }
  // Dezelfde tijd twee keer in één stap = één timer.
  return found.filter((t, i) => found.findIndex(x => x.seconds === t.seconds && x.maxSeconds === t.maxSeconds) === i);
}
