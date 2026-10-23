// Account: inloggen, registreren en gegevens synchroniseren.
//
// De app blijft gewoon met localStorage werken. Is iemand ingelogd, dan worden
// wijzigingen in de onderstaande sleutels automatisch (na 2 seconden) naar het
// account gestuurd, en bij het openen van de app haalt hij de nieuwste versie op.
// Zo zijn instellingen, weekmenu, favorieten en smaakprofiel op elk apparaat gelijk.
export const SYNC_KEYS = ['qook_prefs', 'qook_current_plan', 'qook_favorites', 'qook_favorite_meals', 'qook_usage',
    'qook_taste', 'qook_meal_history', 'qook_pantry_have', 'qook_shop_order', 'qook_shopping_list'];
const ACCOUNT_KEY = 'qook_account'; // laatst bekende gebruiker (voor als het netwerk even weg is)
const STAMPS_KEY = 'qook_sync_stamps'; // per sleutel: versie die dit apparaat heeft
const DEBOUNCE_MS = 2000;
let current = null;
let stats = {};
const STATS_KEY = 'qook_stats';
let rawSet = null;
const dirty = new Set();
let timer = null;
export const getAccount = () => current;
export const getStats = () => stats;
const setStats = (s) => { stats = s && typeof s === 'object' ? s : {}; try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}
catch { } };
const api = async (path, method = 'GET', body, keepalive = false) => {
    const res = await fetch(`/api${path}`, {
        method,
        credentials: 'same-origin',
        keepalive,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data.detail || `Serverfout ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return data;
};
const readJson = (k, fallback) => {
    try {
        return JSON.parse(localStorage.getItem(k) || '') ?? fallback;
    }
    catch {
        return fallback;
    }
};
const setRaw = (k, v) => { try {
    (rawSet || localStorage.setItem.bind(localStorage))(k, v);
}
catch { } };
/** Alle app-gegevens op dit apparaat, zoals ze naar het account gaan. */
export const collectLocalData = () => {
    const out = {};
    for (const k of SYNC_KEYS) {
        const v = localStorage.getItem(k);
        if (v != null)
            out[k] = v;
    }
    return out;
};
/** Gegevens van het account op dit apparaat zetten (alleen wat nieuwer is dan wat hier staat). */
const applyServerData = (data, force = false) => {
    const stamps = force ? {} : readJson(STAMPS_KEY, {});
    for (const [k, item] of Object.entries(data || {})) {
        if (!SYNC_KEYS.includes(k) || !item)
            continue;
        if (force || item.updated_at > (stamps[k] || 0)) {
            setRaw(k, item.value);
            stamps[k] = item.updated_at;
        }
    }
    setRaw(STAMPS_KEY, JSON.stringify(stamps));
};
/** Naam en abonnement van het account in de app-instellingen zetten. */
const applyUser = (user) => {
    current = user;
    setRaw(ACCOUNT_KEY, JSON.stringify(user));
    const prefs = readJson('qook_prefs', null);
    if (prefs) {
        prefs.name = user.name;
        prefs.subscriptionStatus = user.subscription;
        prefs.trialStartedAt = user.trial_started_at || undefined;
        setRaw('qook_prefs', JSON.stringify(prefs));
    }
};
/** Wijzigingen naar het account sturen. */
export const flush = async (keepalive = false) => {
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
    if (!current || !dirty.size)
        return;
    const items = {};
    for (const k of dirty)
        items[k] = localStorage.getItem(k);
    dirty.clear();
    try {
        const { updated_at } = await api('/account/data', 'PUT', { items }, keepalive);
        const stamps = readJson(STAMPS_KEY, {});
        for (const k of Object.keys(items))
            stamps[k] = updated_at;
        setRaw(STAMPS_KEY, JSON.stringify(stamps));
    }
    catch (e) {
        if (e?.status === 401) {
            current = null;
            localStorage.removeItem(ACCOUNT_KEY);
            return;
        }
        for (const k of Object.keys(items))
            dirty.add(k); // later opnieuw proberen
        console.warn('Synchroniseren mislukt, wordt later opnieuw geprobeerd:', e?.message);
    }
};
const markDirty = (k) => {
    dirty.add(k);
    if (timer)
        clearTimeout(timer);
    timer = setTimeout(() => { flush(); }, DEBOUNCE_MS);
};
/** Elke localStorage-wijziging van app-gegevens doorgeven (eenmalig ingesteld). */
const installHook = () => {
    if (rawSet)
        return;
    const orig = localStorage.setItem.bind(localStorage);
    const origRemove = localStorage.removeItem.bind(localStorage);
    rawSet = orig;
    try {
        localStorage.setItem = (k, v) => { orig(k, v); if (current && SYNC_KEYS.includes(k))
            markDirty(k); };
        localStorage.removeItem = (k) => { origRemove(k); if (current && SYNC_KEYS.includes(k))
            markDirty(k); };
    }
    catch { }
    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden')
            flush(true); });
    }
};
/** Bij het openen van de app: ingelogd? Dan de nieuwste gegevens ophalen. */
export const bootstrapAccount = async () => {
    installHook();
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch('/api/auth/me', { credentials: 'same-origin', signal: ctrl.signal });
        clearTimeout(t);
        const { user, data, stats: st } = await res.json();
        if (!user) {
            current = null;
            localStorage.removeItem(ACCOUNT_KEY);
            return null;
        }
        applyServerData(data);
        applyUser(user);
        setStats(st);
        // Wat hier staat maar nog niet in het account (bv. offline gemaakt): alsnog meesturen.
        for (const k of Object.keys(collectLocalData()))
            if (!data?.[k])
                markDirty(k);
        return user;
    }
    catch {
        // Geen verbinding: verder met wat dit apparaat al wist.
        current = readJson(ACCOUNT_KEY, null);
        stats = readJson(STATS_KEY, {});
        return current;
    }
};
export const login = async (email, password) => {
    const { user, data, stats: st } = await api('/auth/login', 'POST', { email, password });
    setStats(st);
    // Het account is leidend; wat het account nog niet heeft, nemen we van dit apparaat mee.
    const local = collectLocalData();
    applyServerData(data, true);
    applyUser(user);
    for (const k of Object.keys(local))
        if (!data?.[k])
            markDirty(k);
    await flush();
    return user;
};
export const register = async (name, email, password, marketing = false) => {
    const { user, data, stats: st } = await api('/auth/register', 'POST', { name, email, password, marketing, data: collectLocalData() });
    setStats(st);
    applyServerData(data, true);
    applyUser(user);
    return user;
};
/** Gegevens van dit apparaat wissen (bij uitloggen of account verwijderen). */
const clearLocal = () => {
    for (const k of [...SYNC_KEYS, ACCOUNT_KEY, STAMPS_KEY, STATS_KEY])
        localStorage.removeItem(k);
};
export const logout = async () => {
    await flush().catch(() => { });
    const was = current;
    current = null;
    await api('/auth/logout', 'POST').catch(() => { });
    if (was)
        clearLocal();
};
export const deleteAccount = async (password) => {
    await api('/account/delete', 'POST', { password });
    current = null;
    clearLocal();
};
/** "Opnieuw beginnen": ook de gegevens in het account wissen. */
export const resetAccountData = async () => {
    if (!current)
        return;
    const items = {};
    for (const k of SYNC_KEYS)
        items[k] = null;
    dirty.clear();
    await api('/account/data', 'PUT', { items }).catch(() => { });
};
/** Tot de betaling er is: gekozen abonnement in het account onthouden. */
export const saveSubscription = async (tier) => {
    if (!current)
        return;
    await api('/account/subscription', 'POST', { tier }).catch(e => console.warn('Abonnement opslaan mislukt', e?.message));
    current = { ...current, subscription: tier, trial_started_at: null };
    setRaw(ACCOUNT_KEY, JSON.stringify(current));
};
export const passwordResetAvailable = async () => {
    try {
        return !!(await api('/auth/config')).password_reset;
    }
    catch {
        return false;
    }
};
export const requestPasswordReset = (email) => api('/auth/forgot', 'POST', { email });
export const resetPassword = async (token, password) => {
    const { user, data } = await api('/auth/reset', 'POST', { token, password });
    applyServerData(data, true);
    applyUser(user);
    return user;
};
/** Tips en aanbiedingen per e-mail aan of uit. */
export const setMarketing = async (optIn) => {
    if (!current)
        return;
    await api('/account/marketing', 'POST', { opt_in: optIn });
    current = { ...current, marketing: optIn };
    setRaw(ACCOUNT_KEY, JSON.stringify(current));
};
/** Mijlpaal die alleen de app ziet (gekookt, duim omhoog). Mislukt dit, dan is dat niet erg. */
export const trackMilestone = (key) => {
    if (!current)
        return;
    stats = { ...stats, [key]: (stats[key] || 0) + 1 };
    api('/account/milestone', 'POST', { key }).catch(() => { });
};
/** Lokaal bijhouden tot de volgende keer dat de app opent (de server telt zelf ook). */
export const bumpStat = (key, value) => {
    stats = { ...stats, [key]: value ?? ((stats[key] || 0) + 1) };
};
/** Kan de server e-mail versturen (eigen domein ingesteld)? */
export const mailAvailable = async () => {
    try {
        return !!(await api('/auth/config')).email;
    }
    catch {
        return false;
    }
};
/** Boodschappenlijst naar het e-mailadres van het account. */
export const emailShoppingList = (sections) => api('/account/email-list', 'POST', { sections });
/** Wachtwoord wijzigen; andere apparaten worden uitgelogd. */
export const changePassword = (current, password) => api('/account/password', 'POST', { current, password });
/** Bevestigingsmail opnieuw sturen. */
export const resendVerification = () => api('/account/verify-email', 'POST', {});
/** Alles wat Qook over je bewaart, als bestand (inzagerecht). */
export const downloadMyData = async () => {
    const res = await fetch('/api/account/export', { credentials: 'same-origin' });
    if (!res.ok)
        throw new Error('Downloaden lukte niet.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qook-gegevens-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
};
/** Staat betalen via Stripe aan? */
export const billingEnabled = async () => {
    try {
        return !!(await api('/billing/config')).enabled;
    }
    catch {
        return false;
    }
};
/** Naar de betaalpagina van Stripe. */
export const startCheckout = async (tier, period) => {
    const plan = tier === 'basic' ? 'basic_year' : `${tier}_${period}`;
    const { url } = await api('/billing/checkout', 'POST', { plan });
    await flush().catch(() => { });
    window.location.href = url;
};
/** Stripe-klantportaal: opzeggen, betaalmethode, facturen. */
export const openBillingPortal = async () => {
    const { url } = await api('/billing/portal', 'POST', {});
    window.location.href = url;
};
