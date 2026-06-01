// netlify/functions/data.mjs (Phase 7+)
//
// GET /api/data?slug=<slug>
//
// Liefert:
//   - config         (UI-Subset, abgeleitet aus tournaments/<slug>/config.json)
//   - snapshot       (matches/teams/standings)
//   - assignments    (Phase 3+ rollenbasiert) ODER legacy refereeAssignments
//   - referees       (Public-View aller aktiven Schiris — für den Picker im Frontend)
//
// Für externe Turniere zusätzlich:
//   - external.resources, externalAssignments

import { getStore } from '@netlify/blobs';
import { getTournament, vmwCategoriesFor } from '../../lib/tournaments.mjs';
import { listReferees } from '../../lib/referees.mjs';
import { listExternalAssignments } from '../../lib/externalAssignments.mjs';
import { getRole } from '../../lib/auth.mjs';
import { buildCacheHeadersShort } from '../../lib/cacheHeaders.mjs';

export default async (req) => {
  try {
    const url = new URL(req.url);
    const slug = (url.searchParams.get('slug') || '').trim();
    if (!slug) {
      return new Response(JSON.stringify({ error: 'slug parameter required' }),
        { status: 400, headers: { 'content-type': 'application/json' } });
    }

    const config = await getTournament(slug);
    if (!config) {
      return new Response(JSON.stringify({ error: `Tournament "${slug}" nicht gefunden` }),
        { status: 404, headers: { 'content-type': 'application/json' } });
    }

    // Cache-Strategie siehe lib/cacheHeaders.mjs (Short-Variante, weil /api/data
    // Live-Daten liefert und der CDN nur 5s halten darf).
    const role = await getRole(req);
    const cacheHeaders = buildCacheHeadersShort(!!role);

    const referees = await listReferees({ activeOnly: true, includeSecret: false }).catch(() => []);

    // ─── External Tournaments: Dashboard mit Ressourcen + Einsätzen ──────────
    if (config.type === 'external') {
      const externalAssignments = await listExternalAssignments(slug).catch(() => []);
      const resources = Array.isArray(config.external?.resources) ? config.external.resources : [];

      return new Response(JSON.stringify({
        slug, external: true,
        config: {
          slug: config.slug,
          name: config.name,
          type: 'external',
          status: config.status,
          dates: config.dates ?? [],
          ourTeams: config.ourTeams ?? [],
          vmwCategories: vmwCategoriesFor(config),
          external: { resources },
          // Legacy-Felder
          externalUrl: config.externalUrl || null,
          externalDays: Array.isArray(config.externalDays) ? config.externalDays : null,
        },
        externalAssignments,
        referees,
        server: new Date().toISOString(),
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          ...cacheHeaders,
        },
      });
    }

    // ─── Normales Turnier (kayakers): Live-Spielplan ─────────────────────────
    const store = getStore('tournaments');
    const [snapshot, assignments, legacyRefs, externalAssignments] = await Promise.all([
      store.get(`${slug}/snapshot.json`, { type: 'json' }),
      store.get(`${slug}/assignments.json`, { type: 'json', consistency: 'strong' }),
      store.get(`${slug}/refereeAssignments.json`, { type: 'json', consistency: 'strong' }),
      // Auch kayakers-Turniere können manuelle Einsätze haben (Hybrid-Modus,
      // z.B. wenn kayakers den Spielplan nie liefert oder nur teilweise).
      listExternalAssignments(slug).catch(() => []),
    ]);

    // ─── Hybrid-Fallback: kayakers-Turnier OHNE Spielplan → Dashboard ──────────
    // Wenn das Turnier zwar als 'tournament' angelegt ist, aber noch keine Matches
    // im Snapshot stehen (z.B. kayakers hat den Plan noch nicht veröffentlicht),
    // liefern wir es als `external: true` aus + synthetisieren die kayakers-Quelle
    // als Ressource. Frontend rendert dann dieselbe Dashboard-View wie für externe
    // Turniere — mit Link zur kayakers-Seite + manuellen Einsätzen.
    const hasMatches = Array.isArray(snapshot?.matches) && snapshot.matches.length > 0;
    if (!hasMatches) {
      const resources = [];
      // kayakers-Source als ersten Link hinzufügen
      const viewUrl = config.source?.viewUrl;
      const matchListUrl = config.source?.matchListUrl;
      if (viewUrl) {
        resources.push({ title: 'kayakers.nl (Turnier-Übersicht)', url: viewUrl });
      } else if (matchListUrl) {
        resources.push({ title: 'kayakers.nl (Spielplan-URL)', url: matchListUrl });
      }
      return new Response(JSON.stringify({
        slug, external: true,
        config: {
          slug: config.slug,
          name: config.name,
          type: config.type ?? 'tournament',
          status: config.status,
          dates: config.dates ?? [],
          ourTeams: config.ourTeams ?? [],
          vmwCategories: vmwCategoriesFor(config),
          external: { resources },
          // Hinweis fürs Frontend, dass das ein kayakers-Hybrid ist (Spielplan kommt noch)
          isKayakersAwaiting: true,
        },
        externalAssignments,
        referees,
        server: new Date().toISOString(),
      }), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8', ...cacheHeaders },
      });
    }

    const uiConfig = {
      slug: config.slug,
      name: config.name,
      type: config.type ?? 'tournament',
      status: config.status,
      showStandings: !!config.showStandings,
      showHausliga: !!config.showHausliga,
      dates: config.dates ?? [],
      expectedDates: config.expectedDates ?? null,
      ourTeams: config.ourTeams ?? [],
      pendingTeamSelection: !!config.pendingTeamSelection,
      source: config.source ?? null,
      vmwCategories: vmwCategoriesFor(config),
    };

    const payload = {
      slug,
      config: uiConfig,
      snapshot: snapshot ?? null,
      assignments: assignments ?? null,                       // Phase 3 rollenbasiert
      refereeAssignments: legacyRefs ?? {},                   // Phase 1 legacy
      externalAssignments: externalAssignments ?? [],         // Phase 7 — Hybrid-Modus
      referees,                                                // Public-Schiri-Index für Picker
      server: new Date().toISOString(),
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        ...cacheHeaders,    // private,max-age=5 für authed; public+CDN für anon
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};
