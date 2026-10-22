# KOOQ — jouw persoonlijke sous-chef

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
