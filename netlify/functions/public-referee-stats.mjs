// netlify/functions/public-referee-stats.mjs
// GET /api/club/referees/<id>/stats?year=YYYY
//
// Public-Endpoint für Schiri-Profil-Stats. Wird vom Frontend beim Klick auf einen
// Schiri-Pillen-Namen abgerufen. Liefert nur aggregierte Zahlen — KEIN Vollname,
// keine Adresse, keine sensiblen Daten.
//
// Edge-Cache: 60s (Stats ändern sich langsam, Master-Refresh dauert max 1 Min).

import { aggregateReferees } from '../../lib/reports.mjs';

export default async (req) => {
  try {
    const url = new URL(req.url);
    const path = url.pathname;
    // Pfad-Pattern: /api/club/referees/<id>/stats
    const m = path.match(/referees\/([a-z0-9-]+)\/stats/i);
    if (!m) return jsonError('id required', 400);
    const id = m[1];
    const year = Number(url.searchParams.get('year') || new Date().getFullYear());

    const agg = await aggregateReferees({ year });
    const bucket = agg.byReferee?.[id];
    if (!bucket) return jsonError('Schiri nicht gefunden', 404);

    const publicView = {
      id: bucket.id,
      displayName: bucket.displayName,
      level: bucket.level,
      // KEIN fullName im Public-View
      year,
      totalGames: bucket.totalGames,
      byRole: bucket.byRole,
      byTournament: bucket.byTournament.map(t => ({ slug: t.slug, name: t.name, games: t.games })),
    };

    return new Response(JSON.stringify(publicView), {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=60',
        'netlify-cdn-cache-control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (e) {
    return jsonError(e?.message ?? String(e), 500);
  }
};

function jsonError(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { 'content-type': 'application/json' },
  });
}
