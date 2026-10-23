// Lettertypen, foto's en Tailwind via onze eigen server (geen IP-adressen naar derden).
import assert from 'node:assert/strict';
import { handleExternal } from './external.mjs';
const fetched = [];
globalThis.fetch = async (url, init) => {
  fetched.push({ url: String(url), ua: init?.headers?.['user-agent'] });
  if (String(url).startsWith('https://fonts.googleapis.com/')) return new Response("@font-face { src: url(https://fonts.gstatic.com/s/inter/v1/a.woff2) format('woff2'); }", { headers: { 'content-type': 'text/css' } });
  if (String(url).startsWith('https://images.unsplash.com/')) return new Response('JPG', { headers: { 'content-type': 'image/jpeg' } });
  if (String(url).startsWith('https://cdn.tailwindcss.com/3.4.17')) return new Response('/* tw */');
  return new Response('nee', { status: 404 });
};
const get = (p) => handleExternal(new Request('https://q.test' + p), new URL('https://q.test' + p).pathname);

let r = await get('/api/ext/fonts.css?family=Inter:wght@400;500');
assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/css/);
assert.match(await r.text(), /url\(\/api\/ext\/gstatic\/s\/inter\/v1\/a\.woff2\)/);
assert.match(fetched[0].url, /family=Inter%3Awght%40400%3B500&display=swap/); assert.match(fetched[0].ua, /Chrome/);
assert.equal((await get('/api/ext/fonts.css?family=<script>')).status, 400);
r = await get('/api/ext/unsplash/photo-123?q=80&w=800');
assert.equal(r.status, 200); assert.equal(fetched.at(-1).url, 'https://images.unsplash.com/photo-123?q=80&w=800');
assert.match(r.headers.get('cache-control'), /immutable/);
assert.equal((await get('/api/ext/gstatic/s/inter/a.woff2')).status, 404, 'onbekend bestand bij bron: netjes 404');
assert.equal((await get('/api/ext/evil/x')).status, 404, 'alleen bekende bronnen');
assert.notEqual((await get('/api/ext/unsplash/../../etc'))?.status, 200, 'geen uitbraak uit de map');
assert.equal((await get('/api/ext/tailwind.js')).status, 200);
assert.equal(await get('/api/iets'), null, 'andere paden niet');
console.log('EXTERN VIA EIGEN SERVER: ALLE TESTS GESLAAGD');
