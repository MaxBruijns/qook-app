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

// Uitgeschreven getallen vóór een tijdseenheid ("twintig minuten", "vijfentwintig min") naar cijfers.
const ONES: Record<string, number> = { een: 1, 'één': 1, twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6, zeven: 7, acht: 8, negen: 9,
  tien: 10, elf: 11, twaalf: 12, dertien: 13, veertien: 14, vijftien: 15, zestien: 16, zeventien: 17, achttien: 18, negentien: 19 };
const TENS: Record<string, number> = { twintig: 20, dertig: 30, veertig: 40, vijftig: 50, zestig: 60, zeventig: 70, tachtig: 80, negentig: 90 };
const wordNumber = (w: string): number | null => {
  const x = w.toLowerCase();
  if (x in ONES) return ONES[x];
  if (x in TENS) return TENS[x];
  const m = x.match(/^(een|één|twee|drie|vier|vijf|zes|zeven|acht|negen)(?:en|ën)(twintig|dertig|veertig|vijftig|zestig|zeventig|tachtig|negentig)$/);
  return m ? ONES[m[1]] + TENS[m[2]] : null;
};
export function digitsForNumberWords(text: string): string {
  return text.replace(/\b([a-zA-Zéë]+)(\s*(?:-|–|tot|à)\s*)([a-zA-Zéë]+)(?=\s+(?:seconden|minuten|minuut|uur|uren)\b)/gi,
    (all, a, sep, b) => (wordNumber(a) !== null && wordNumber(b) !== null ? `${wordNumber(a)}${sep}${wordNumber(b)}` : all))
    .replace(/\b([a-zA-Zéë]+)(?=\s+(?:seconden|minuten|uur|uren)\b)/gi, (all, w) => {
      const n = wordNumber(w);
      return n !== null && n > 1 ? String(n) : all;   // "een minuut/een uur" worden apart herkend
    });
}

const fmt = (sec: number) => (sec % 3600 === 0 ? `${sec / 3600} uur` : sec % 60 === 0 ? `${sec / 60} min` : `${sec} sec`);

export function stepTimers(text: string): StepTimer[] {
  if (!text) return [];
  const found: StepTimer[] = [];
  text = digitsForNumberWords(text);
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
