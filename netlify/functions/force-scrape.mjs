// netlify/functions/force-scrape.mjs
//
// Master-only manueller Scrape-Trigger. Akzeptiert Query-Param `?slug=...`.
// Aufruf:
//   curl -X POST "https://<site>/.netlify/functions/force-scrape?slug=dc2026" \
//        -H "x-admin-password: $ADMIN_PASSWORD"

import { getStore } from '@netlify/blobs';
import { getTournament } from '../../lib/tournaments.mjs';
import { buildSnapshot } from '../../scraper/index.mjs';

export default async (req) => {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return new Response(JSON.stringify({ ok: false, error: 'ADMIN_PASSWORD not configured' }),
      { status: 500, headers: { 'content-type': 'application/json' } });
  }
  const provided = req.headers.get('x-admin-password');
  if (!provided || provided !== expected) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }),
      { status: 401, headers: { 'content-type': 'application/json' } });
  }

  const url = new URL(req.url);
  const slug = (url.searchParams.get('slug') || 'dc2026').trim();

  const config = await getTournament(slug);
  if (!config) {
    return new Response(JSON.stringify({ ok: false, error: `Tournament "${slug}" nicht gefunden` }),
      { status: 404, headers: { 'content-type': 'application/json' } });
  }

  console.log(`[force-scrape] manual trigger for ${slug}`);
  const t0 = Date.now();
  try {
    const snapshot = await buildSnapshot(config);
    const store = getStore('tournaments');
    await store.setJSON(`${slug}/snapshot.json`, snapshot);
    const ms = Date.now() - t0;
    return new Response(JSON.stringify({
      ok: true, slug, durationMs: ms,
      matches: snapshot.matches.length,
      teams: snapshot.teams.length,
      lastUpdated: snapshot.lastUpdated,
    }, null, 2), { headers: { 'content-type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, slug, error: e?.message ?? String(e) }),
      { status: 500, headers: { 'content-type': 'application/json' } });
  }
};
