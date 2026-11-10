/**
 * Externe bestanden via onze eigen server (lettertypen, achtergrondfoto's, Tailwind).
 *
 * Laadt de browser deze rechtstreeks van Google, Unsplash of Tailwind, dan krijgen die partijen het
 * IP-adres van de bezoeker. Via /api/ext/ haalt onze server ze op en bewaart ze; de bezoeker
 * praat alleen met Qook. Alleen vaste, bekende adressen zijn toegestaan.
 */
const SOURCES: Record<string, { base: string; ttl: number; type?: string }> = {
  gstatic: { base: 'https://fonts.gstatic.com/', ttl: 31536000 },
  unsplash: { base: 'https://images.unsplash.com/', ttl: 2592000 },
};
const TAILWIND = 'https://cdn.tailwindcss.com/3.4.17';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const cacheApi = () => (typeof caches !== 'undefined' ? (caches as any).default : null);

async function cached(req: Request, ctx: any, make: () => Promise<Response>) {
  const cache = cacheApi();
  const key = new Request(req.url, { method: 'GET' });
  const hit = cache ? await cache.match(key) : null;
  if (hit) return hit;
  const res = await make();
  if (res.ok && cache) {
    const put = cache.put(key, res.clone());
    if (ctx?.waitUntil) ctx.waitUntil(put); else await put;
  }
  return res;
}

const withHeaders = async (res: Response, ttl: number, type?: string) => new Response(res.body, {
  status: res.status,
  headers: {
    'content-type': type || res.headers.get('content-type') || 'application/octet-stream',
    'cache-control': `public, max-age=${ttl}, immutable`,
    'access-control-allow-origin': '*',
  },
});

/** /api/ext/... — geeft null terug voor andere paden. */
export async function handleExternal(req: Request, path: string, ctx?: any): Promise<Response | null> {
  if (!path.startsWith('/api/ext/') || req.method !== 'GET') return null;
  const url = new URL(req.url);
  const rest = path.slice('/api/ext/'.length);

  if (rest === 'fonts.css') {
    // Lettertype-CSS van Google, met de lettertype-adressen omgezet naar onze server.
    const family = url.searchParams.getAll('family');
    if (!family.length || family.some(f => !/^[\w +:;,.@-]+$/.test(f))) return new Response('Ongeldig', { status: 400 });
    return cached(req, ctx, async () => {
      const q = new URLSearchParams();
      for (const f of family) q.append('family', f);
      q.set('display', 'swap');
      const res = await fetch(`https://fonts.googleapis.com/css2?${q}`, { headers: { 'user-agent': BROWSER_UA } });
      if (!res.ok) return new Response('', { status: 502 });
      const css = (await res.text()).replaceAll('https://fonts.gstatic.com/', '/api/ext/gstatic/');
      return new Response(css, { headers: { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=604800' } });
    });
  }

  if (rest === 'tailwind.js') {
    return cached(req, ctx, async () => withHeaders(await fetch(TAILWIND), 604800, 'text/javascript; charset=utf-8'));
  }

  const slash = rest.indexOf('/');
  const source = SOURCES[rest.slice(0, slash)];
  const sub = rest.slice(slash + 1);
  if (!source || slash < 0 || !/^[\w./-]+$/.test(sub) || sub.includes('..')) return new Response('Niet gevonden', { status: 404 });
  return cached(req, ctx, async () => {
    const res = await fetch(`${source.base}${sub}${url.search}`);
    if (!res.ok) return new Response('', { status: res.status === 404 ? 404 : 502 });
    return withHeaders(res, source.ttl, source.type);
  });
}
