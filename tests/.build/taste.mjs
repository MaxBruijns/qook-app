// Smaakprofiel: Qook leert van wat de gebruiker kiest.
//
// Signalen (duimpjes, favorieten, gekookt, boodschappenlijst, vervangen)
// worden hier verzameld. Bij een nieuw weekmenu vat de backend ze samen tot
// een kort smaakprofiel dat in de AI-opdracht meegaat.
//
// Nu bewaard op dit apparaat (localStorage). Bij de inlogstap verhuist dit
// naar de database, zodat het meegaat naar elk apparaat.
const KEY = 'qook_taste';
const MAX_EVENTS = 200;
/** Na zoveel nieuwe signalen wordt het profiel opnieuw samengevat. */
export const REFRESH_AFTER = 3;
const empty = () => ({ events: [], profile: '', eventsSinceProfile: 0 });
const load = () => {
    try {
        const raw = localStorage.getItem(KEY);
        return raw ? { ...empty(), ...JSON.parse(raw) } : empty();
    }
    catch {
        return empty();
    }
};
const save = (s) => {
    try {
        localStorage.setItem(KEY, JSON.stringify(s));
    }
    catch { }
};
/** Registreer een keuze van de gebruiker. Dubbele signalen binnen een uur tellen één keer. */
export const recordTaste = (title, kind) => {
    if (!title)
        return;
    const s = load();
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const dup = s.events.some(e => e.title === title && e.kind === kind && new Date(e.at).getTime() > hourAgo);
    if (dup)
        return;
    s.events = [...s.events, { title, kind, at: new Date().toISOString() }].slice(-MAX_EVENTS);
    s.eventsSinceProfile += 1;
    save(s);
};
export const getTasteProfile = () => load().profile;
export const getTasteState = () => load();
export const needsProfileRefresh = () => {
    const s = load();
    return s.eventsSinceProfile >= REFRESH_AFTER || (!s.profile && s.events.length > 0);
};
export const setTasteProfile = (profile, fromRefresh = false) => {
    const s = load();
    s.profile = profile.trim();
    s.profileUpdatedAt = new Date().toISOString();
    if (fromRefresh)
        s.eventsSinceProfile = 0;
    save(s);
};
/** Alles wissen: profiel én de signalen waaruit het is opgebouwd. */
export const clearTaste = () => save(empty());
