// lib/cacheHeaders.mjs
//
// Zentraler Cache-Header-Builder für die public Read-Endpoints
// (`/api/data`, `/api/tournaments`, `/api/banner`).
//
// Hintergrund (Code Review #2):
//   Der Netlify-CDN keyt seinen Cache per URL — *nicht* per Request-Header.
//   Eine anonyme CDN-Antwort würde ohne `Vary` auch authed Requests bedienen,
//   und Mutationen leaken bis zu `s-maxage + stale-while-revalidate` lang in
//   die UI weiter. Wir setzen deshalb auf jedem Pfad:
//
//   - `Vary: x-admin-password, x-personal-token` — separate CDN-Cache-Entries
//     pro Auth-Variante (soweit der Edge-Cache Vary respektiert).
//   - Authed-Antworten zusätzlich `netlify-cdn-cache-control: no-store` —
//     garantiert, dass die CDN-Schicht authed Antworten *nicht* hält, selbst
//     wenn Vary irgendwann ignoriert würde.
//
// Frontend bust-strategie: Master-Mutationen rufen anschließend einen Endpoint
// mit `?t=${Date.now()}` auf, damit der CDN-Eintrag aktiv invalidiert wird.
//
// `isAuthed` = `true` für master/trainer/self (also alles außer `null`).

/**
 * @param {boolean} isAuthed
 * @returns {Record<string, string>}
 */
export function buildCacheHeaders(isAuthed) {
  if (isAuthed) {
    return {
      'cache-control': 'private, max-age=5',
      'netlify-cdn-cache-control': 'no-store',
      'vary': 'x-admin-password, x-personal-token',
    };
  }
  // s-maxage 10s + SWR 60s: anon-User sehen Master-Mutationen spätestens nach
  // ~70s. Trade-off bewusst gegen die ursprünglich gewählten 60+300 (~6 Min) —
  // die App ist Single-Club-Traffic, der CDN muss nicht jede Sekunde absorbieren.
  return {
    'cache-control': 'public, max-age=10',
    'netlify-cdn-cache-control': 'public, s-maxage=10, stale-while-revalidate=60',
    'vary': 'x-admin-password, x-personal-token',
  };
}

/**
 * Variante mit kürzerem CDN-TTL für /api/data — Live-Daten ändern sich oft.
 */
export function buildCacheHeadersShort(isAuthed) {
  if (isAuthed) {
    return {
      'cache-control': 'private, max-age=5',
      'netlify-cdn-cache-control': 'no-store',
      'vary': 'x-admin-password, x-personal-token',
    };
  }
  return {
    'cache-control': 'public, max-age=5',
    'netlify-cdn-cache-control': 'public, s-maxage=5, stale-while-revalidate=60',
    'vary': 'x-admin-password, x-personal-token',
  };
}
