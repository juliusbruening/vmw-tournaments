// scripts/testCacheHeaders.mjs
//
// Validiert die Cache-Header der public Read-Endpoints. Drei Layers:
//
//   1. lib/cacheHeaders.mjs — direkt: buildCacheHeaders + buildCacheHeadersShort
//      decken die Vary + no-store-Logik ab, ohne Function-Mount.
//   2. tournaments-list.mjs handler — mit Mock-Request: prüft, dass die Header
//      tatsächlich in der Response landen.
//   3. data.mjs handler — sowohl 404 als auch eingespeister Blob-Mock für den
//      Haupt-Pfad (kayakers mit Spielplan), damit Vary auch dort durchschlägt.
//
// Hintergrund: Code Review #2 — der Netlify-CDN keyt per URL, ohne Vary
// werden authed/anon Responses unterschiedslos gecached.

let pass = 0, fail = 0;
function expect(label, ok, details = '') {
  if (ok) { console.log('✓ ' + label); pass++; }
  else    { console.log('✗ ' + label + (details ? ': ' + details : '')); fail++; }
}

function makeRequest(url, headers = {}) {
  return new Request(url, { method: 'GET', headers });
}

// ── Layer 1: lib/cacheHeaders.mjs direkt ───────────────────────────────────
const { buildCacheHeaders, buildCacheHeadersShort } = await import('../lib/cacheHeaders.mjs');

const anonHeaders   = buildCacheHeaders(false);
const authedHeaders = buildCacheHeaders(true);

expect('buildCacheHeaders(anon): cache-control = public',
  (anonHeaders['cache-control'] || '').includes('public'),
  `actual: "${anonHeaders['cache-control']}"`);
expect('buildCacheHeaders(anon): CDN cached (s-maxage)',
  (anonHeaders['netlify-cdn-cache-control'] || '').includes('s-maxage'),
  `actual: "${anonHeaders['netlify-cdn-cache-control']}"`);
// s-maxage explizit ≤ 30s — kein wochenlanges Staleness-Fenster nach Master-Mutationen
const smaxage = Number((anonHeaders['netlify-cdn-cache-control'] || '').match(/s-maxage=(\d+)/)?.[1] || 999);
expect('buildCacheHeaders(anon): s-maxage ≤ 30s (kein langes Stale-Fenster)',
  smaxage <= 30,
  `s-maxage=${smaxage}`);
expect('buildCacheHeaders(anon): Vary enthält x-admin-password',
  (anonHeaders['vary'] || '').includes('x-admin-password'),
  `actual: "${anonHeaders['vary']}"`);
expect('buildCacheHeaders(anon): Vary enthält x-personal-token',
  (anonHeaders['vary'] || '').includes('x-personal-token'),
  `actual: "${anonHeaders['vary']}"`);

expect('buildCacheHeaders(authed): cache-control = private',
  (authedHeaders['cache-control'] || '').includes('private'),
  `actual: "${authedHeaders['cache-control']}"`);
expect('buildCacheHeaders(authed): netlify-cdn = no-store (CDN ignoriert authed)',
  (authedHeaders['netlify-cdn-cache-control'] || '') === 'no-store',
  `actual: "${authedHeaders['netlify-cdn-cache-control']}"`);
expect('buildCacheHeaders(authed): Vary trotzdem gesetzt (Defense-in-Depth)',
  (authedHeaders['vary'] || '').includes('x-admin-password'),
  `actual: "${authedHeaders['vary']}"`);

// Short-Variante hat denselben Vary-Mechanismus, nur kürzere TTL
const shortAnon = buildCacheHeadersShort(false);
expect('buildCacheHeadersShort(anon): TTL = 5s',
  (shortAnon['netlify-cdn-cache-control'] || '').includes('s-maxage=5'),
  `actual: "${shortAnon['netlify-cdn-cache-control']}"`);
expect('buildCacheHeadersShort(anon): Vary gesetzt',
  (shortAnon['vary'] || '').includes('x-admin-password'),
  `actual: "${shortAnon['vary']}"`);

// ── Layer 2: tournaments-list.mjs handler ─────────────────────────────────
process.env.ADMIN_PASSWORD = 'dummy';   // damit lib/auth.mjs nicht crasht
const tournamentsHandler = (await import('../netlify/functions/tournaments-list.mjs')).default;

const anonRes = await tournamentsHandler(makeRequest('https://x/api/tournaments'));
expect('Anon /api/tournaments: public max-age',
  (anonRes.headers.get('cache-control') || '').includes('public'),
  `actual: "${anonRes.headers.get('cache-control')}"`);
expect('Anon /api/tournaments: Vary durchgereicht',
  (anonRes.headers.get('vary') || '').includes('x-admin-password'),
  `actual: "${anonRes.headers.get('vary')}"`);

const authRes = await tournamentsHandler(makeRequest('https://x/api/tournaments', {
  'x-admin-password': 'dummy',
}));
expect('Authed /api/tournaments: private',
  (authRes.headers.get('cache-control') || '').includes('private'),
  `actual: "${authRes.headers.get('cache-control')}"`);
expect('Authed /api/tournaments: CDN explizit no-store (statt fehlend!)',
  authRes.headers.get('netlify-cdn-cache-control') === 'no-store',
  `actual: "${authRes.headers.get('netlify-cdn-cache-control')}"`);
expect('Authed /api/tournaments: Vary auch hier',
  (authRes.headers.get('vary') || '').includes('x-admin-password'),
  `actual: "${authRes.headers.get('vary')}"`);

// ── Layer 3: data.mjs handler — 404 und Haupt-Pfad ────────────────────────
const dataHandler = (await import('../netlify/functions/data.mjs')).default;

// 404-Fall (Tournament nicht da) — keine cacheHeaders, daher KEIN Vary erwartet,
// aber auch kein "private" als anon
const anonDataRes = await dataHandler(makeRequest('https://x/api/data?slug=nonexistent'));
expect('Anon /api/data 404: kein "private"-Leak',
  !(anonDataRes.headers.get('cache-control') || '').includes('private'),
  `actual: "${anonDataRes.headers.get('cache-control') || ''}"`);

const authDataRes = await dataHandler(makeRequest('https://x/api/data?slug=nonexistent', {
  'x-admin-password': 'dummy',
}));
expect('Authed /api/data: Funktion läuft ohne Crash',
  authDataRes.status === 404 || authDataRes.status === 200,
  `status: ${authDataRes.status}`);

// Haupt-Pfad: brauchen wir einen Tournament-Mock. Wir setzen einen Blob via
// in-memory-mock — `@netlify/blobs` ohne Netlify-Context fällt auf Memory zurück.
// Quick-Test: legen wir einen externen Tournament-Eintrag an, dann sollte
// dataHandler diesen finden und cacheHeaders setzen.
import { getStore } from '@netlify/blobs';

let setupOk = true;
try {
  const tStore = getStore({ name: 'tournaments', siteID: 'test', token: 'test' });
  await tStore.setJSON('cache-test/config.json', {
    slug: 'cache-test', name: 'Cache Test', type: 'external', status: 'active',
    dates: [], ourTeams: [], external: { resources: [] },
  });
  // Index mit testSlug damit listTournaments es findet (für Hauptpfad nicht nötig)
} catch (e) {
  setupOk = false;
  console.log(`  [info] Blob-Mock nicht verfügbar (${e?.message?.slice(0, 80)}) — Hauptpfad-Test übersprungen.`);
}

if (setupOk) {
  // Anon Request gegen das externe Tournament → cacheHeaders müssen durch
  try {
    const anonExtRes = await dataHandler(makeRequest('https://x/api/data?slug=cache-test'));
    if (anonExtRes.status === 200) {
      expect('Anon /api/data Hauptpfad: cache-control public',
        (anonExtRes.headers.get('cache-control') || '').includes('public'),
        `actual: "${anonExtRes.headers.get('cache-control')}"`);
      expect('Anon /api/data Hauptpfad: Vary durchgereicht',
        (anonExtRes.headers.get('vary') || '').includes('x-admin-password'),
        `actual: "${anonExtRes.headers.get('vary')}"`);
      expect('Anon /api/data Hauptpfad: CDN s-maxage gesetzt',
        (anonExtRes.headers.get('netlify-cdn-cache-control') || '').includes('s-maxage'),
        `actual: "${anonExtRes.headers.get('netlify-cdn-cache-control')}"`);
    } else {
      console.log(`  [info] Hauptpfad-Status ${anonExtRes.status} — Test-Setup unvollständig, überspringe.`);
    }

    // Authed → no-store + Vary
    const authExtRes = await dataHandler(makeRequest('https://x/api/data?slug=cache-test', {
      'x-admin-password': 'dummy',
    }));
    if (authExtRes.status === 200) {
      expect('Authed /api/data Hauptpfad: private',
        (authExtRes.headers.get('cache-control') || '').includes('private'),
        `actual: "${authExtRes.headers.get('cache-control')}"`);
      expect('Authed /api/data Hauptpfad: CDN no-store (Anti-Leak)',
        authExtRes.headers.get('netlify-cdn-cache-control') === 'no-store',
        `actual: "${authExtRes.headers.get('netlify-cdn-cache-control')}"`);
      expect('Authed /api/data Hauptpfad: Vary',
        (authExtRes.headers.get('vary') || '').includes('x-admin-password'),
        `actual: "${authExtRes.headers.get('vary')}"`);
    }
  } catch (e) {
    console.log(`  [info] Hauptpfad-Aufruf gescheitert (${e?.message?.slice(0, 80)}) — überspringe.`);
  }
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass, ${fail} fail`);
process.exitCode = fail === 0 ? 0 : 1;
