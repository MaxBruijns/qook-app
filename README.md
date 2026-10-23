# Qook — jouw weekmenu en boodschappen

Alles draait op **Cloudflare**, in één Worker:

| Onderdeel | Cloudflare-dienst |
|---|---|
| Website (React/Vite) | Worker static assets (map `dist`) |
| Backend (`/api/...`) | Worker (`worker/index.ts`) |
| Receptenbank | D1-database `kooq-db` |
| Maaltijdfoto's | R2-bucket `kooq-photos` |
| Foto's maken | Workers AI (FLUX schnell) |
| Tekst (menu's, recepten, chat, koelkastscan) | Google Gemini (sleutel `GEMINI_API_KEY`) |

## Online zetten (eenmalig)

1. Cloudflare-dashboard → **Workers & Pages** → **Create** → **Import a repository** → kies `qook-app`.
2. Build-instellingen:
   - Build command: `npm run build`
   - Deploy command: `npx wrangler@4 deploy`
3. Na de eerste deploy: Worker → **Settings → Variables and Secrets** → **Add** →
   type *Secret*, naam `GEMINI_API_KEY`, waarde = je sleutel uit Google AI Studio.
4. Controleer `https://<jouw-worker>.workers.dev/api/health`.

De database en de fotobucket worden bij de eerste deploy automatisch aangemaakt. Lukt dat niet, maak ze dan zelf aan
met precies deze namen: D1-database `kooq-db` en R2-bucket `kooq-photos`. Deploy daarna opnieuw.

Elke push naar `main` zet automatisch een nieuwe versie online.

## Lokaal ontwikkelen

```bash
npm install
npx wrangler@4 dev          # backend op poort 8787 (zet GEMINI_API_KEY in .dev.vars)
npm run dev                 # website op poort 3000, /api gaat naar de backend
```

## Optioneel

- `TEXT_MODEL` (variabele): ander Gemini-model, standaard `gemini-3.5-flash-lite` (alternatief: `gemini-3.8-flash`, beter maar duurder).
- `RECIPE_MODEL` (variabele): model voor volledige recepten, standaard `gemini-3.8-flash`.
- `ADMIN_KEY` (secret): zet je deze, dan kun je de receptenbank handmatig een ronde laten aanvullen met
  `POST /api/admin/seed` en de header `x-admin-key: <jouw sleutel>`.
- `SEED_DETAILS_PER_RUN` / `SEED_IMAGES_PER_RUN` (variabelen): hoeveel volledige recepten en foto's de
  geplande taak per ronde maakt (standaard 2 en 1).

## Receptenbank

Elke 20 minuten vult een geplande taak (cron, staat in `wrangler.jsonc`) de receptenbank aan: eerst
nieuwe gerechten per categorie (Hollands, Europees, wereld, kindvriendelijk, vegetarisch, snel, vis en
drie culinaire categorieën; samen ±310), daarna volledige recepten en foto's. Een weekmenu wordt
eerst uit de bank samengesteld; de AI maakt alleen wat ontbreekt. De voortgang zie je op `/api/health`
onder `recipe_bank`.

## Accounts

Bezoekers kunnen een account maken met naam, e-mailadres en wachtwoord. Wachtwoorden worden met
PBKDF2 (100.000 rondes, eigen salt) opgeslagen; sessies staan in een HttpOnly-cookie. Instellingen,
weekmenu, favorieten, smaakprofiel en geschiedenis worden per account bewaard en op elk apparaat
gesynchroniseerd. Uitloggen wist de gegevens van het apparaat; "Account verwijderen" wist alles.

- `PASSWORD_ITERATIONS` (variabele, optioneel): standaard 100000. Dat kost ±30–50 ms rekentijd per
  inlog; het gratis Workers-abonnement staat 10 ms per aanvraag toe. Daarom: Workers Paid ($5/maand),
  of tijdelijk een lagere waarde (minimaal 10000). Bij een latere verhoging worden wachtwoorden bij
  de volgende inlog automatisch sterker versleuteld.
- `RESEND_API_KEY` + `MAIL_FROM` (optioneel): zet je deze (vereist een eigen domein bij Resend), dan
  werkt "Wachtwoord vergeten" via e-mail. Zonder deze instellingen toont de app dat dit nog niet kan.

## Pagina's

- `/` — landingspagina (`index.html`): uitleg, abonnementen, vragen. Terugkerende bezoekers gaan
  direct door naar de app. Bedrijfsgegevens (naam, KvK, e-mail, links naar privacy en voorwaarden)
  vul je in bovenaan het script onderaan `index.html` (`BEDRIJF`); lege velden worden niet getoond.
- `/app/` — de app (`app/index.html`).
- De app is installeerbaar op het beginscherm (`public/manifest.webmanifest`, `public/sw.js`).

## Proefperiode en e-mails

- Per account worden alleen aantallen bijgehouden (weekmenu's, boodschappenlijsten, hergebruikte
  ingrediënten, gekookt). De app toont ze in de proefbanner.
- De geplande taak stuurt tijdens en na de proef e-mails: welkom en "proef stopt morgen" (dienstberichten)
  altijd; tips, "jouw eerste week", het aanbod en "je zit nu op Gratis" alleen met toestemming
  (vinkje bij registratie of in Instellingen), met afmeldlink.
- Dit werkt pas als `RESEND_API_KEY`, `MAIL_FROM` en `APP_URL` (bv. `https://myqook.com`) zijn ingesteld.
- Het aanbod aan het einde van de proef staat in `worker/engagement.ts` (`TRIAL_OFFER`) en in de
  app-teksten (`trial_offer`).
