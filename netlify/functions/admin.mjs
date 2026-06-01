// netlify/functions/admin.mjs (Phase 2-6)
//
// Multi-Endpoint Admin-Router. Pfade:
//
//   POST /api/admin/login                        (trainer ODER master) — Login-Test
//
//   GET  /api/admin/refs?slug=…                  (trainer/master)       — Legacy Phase-1-Refs (Namen)
//   POST /api/admin/refs?slug=…                  (trainer/master)       — Legacy upsert
//   POST /api/admin/t/<slug>/assignments/<nr>    (trainer/master)       — Phase-3 rollenbasiert
//
//   GET  /api/admin/tournaments                  (master)               — alle Tournaments
//   POST /api/admin/tournaments/discover         (master)               — URL-Discovery
//   POST /api/admin/tournaments                  (master)               — anlegen
//   PUT  /api/admin/tournaments/<slug>           (master)               — editieren
//   POST /api/admin/tournaments/<slug>/status    (master)               — Status setzen
//   POST /api/admin/tournaments/<slug>/scrape    (master)               — manueller Scrape
//   GET  /api/admin/discover/list?country=DE     (master)               — Tournament-Picker-Liste
//
//   GET  /api/admin/referees                     (master)               — Schiri-Liste full
//   GET  /api/admin/referees/<id>                (master)
//   POST /api/admin/referees                     (master)
//   PUT  /api/admin/referees/<id>                (master)
//   DELETE /api/admin/referees/<id>              (master)               — soft delete
//   POST /api/admin/referees/<id>/login-code     (master)               — Code (re)generieren
//   DELETE /api/admin/referees/<id>/login-code   (master)
//
//   GET  /api/admin/reports/referees?year=YYYY   (master)               — Jahres-Aggregation
//   GET  /api/admin/reports/referees.csv?year=…  (master)               — CSV-Export

import { getStore } from '@netlify/blobs';
import { getRole, isMaster, isTrainerOrMaster, jsonResponse, unauthorized, forbidden, notFound, badRequest } from '../../lib/auth.mjs';
import { getTournament, listTournaments, saveTournament, updateTournament } from '../../lib/tournaments.mjs';
import {
  listReferees, getReferee, createReferee, updateReferee, softDeleteReferee, hardDeleteReferee,
  generateLoginCode, revokeLoginCode,
} from '../../lib/referees.mjs';
import { detectConnector, getConnector } from '../../scraper/connectors/index.mjs';
import { ROLES, REFEREE_LEVELS, canAssignRole } from '../../lib/refereeLevels.mjs';
import { buildSnapshot } from '../../scraper/index.mjs';
import { aggregateReferees, refereesToCsv, detailEntriesToCsv } from '../../lib/reports.mjs';
import {
  listExternalAssignments, getExternalAssignment,
  createExternalAssignment, updateExternalAssignment, deleteExternalAssignment,
} from '../../lib/externalAssignments.mjs';
import { buildEinsatzbogenForReferee } from '../../lib/einsatzbogen.mjs';
import { getBanner, setBanner, clearBanner } from '../../lib/banner.mjs';

const STORE_NAME = 'tournaments';
const ASSIGNMENTS_KEY = (slug) => `${slug}/assignments.json`;
const LEGACY_REFS_KEY = (slug) => `${slug}/refereeAssignments.json`;

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin':  '*',
        'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'access-control-allow-headers': 'content-type,x-admin-password,x-personal-token',
      },
    });
  }

  const role = await getRole(req);
  if (!role) return unauthorized();

  const url = new URL(req.url);
  const path = url.pathname
    .replace(/^\/api\/admin\/?/, '')
    .replace(/^\/\.netlify\/functions\/admin\/?/, '');

  // ── Login-Test ─────────────────────────────────────────────────────
  if (req.method === 'POST' && path === 'login') {
    return jsonResponse({ ok: true, role: typeof role === 'string' ? role : 'self' });
  }

  // ── Legacy Phase-1-Refs (Trainer/Master) ───────────────────────────
  if ((path === 'refs') && (req.method === 'GET' || req.method === 'POST')) {
    if (!isTrainerOrMaster(role)) return forbidden();
    return await handleLegacyRefs(req, url);
  }

  // ── Phase-3 Rollen-Assignment ──────────────────────────────────────
  const assignMatch = path.match(/^t\/([a-z0-9-]+)\/assignments\/(\d+)$/i);
  if (assignMatch && req.method === 'POST') {
    if (!isTrainerOrMaster(role)) return forbidden();
    return await handleAssignment(req, assignMatch[1], Number(assignMatch[2]));
  }

  // ── Phase-7 Externe Einsätze (Trainer + Master) ────────────────────
  const extListMatch = path.match(/^t\/([a-z0-9-]+)\/external-entries$/i);
  if (extListMatch) {
    if (!isTrainerOrMaster(role)) return forbidden();
    if (req.method === 'GET')  return await handleListExternal(extListMatch[1]);
    if (req.method === 'POST') return await handleCreateExternal(req, extListMatch[1], role);
  }
  const extItemMatch = path.match(/^t\/([a-z0-9-]+)\/external-entries\/([a-z0-9-]+)$/i);
  if (extItemMatch) {
    if (!isTrainerOrMaster(role)) return forbidden();
    if (req.method === 'PUT')    return await handleUpdateExternal(req, extItemMatch[1], extItemMatch[2]);
    if (req.method === 'DELETE') return await handleDeleteExternal(extItemMatch[1], extItemMatch[2]);
  }

  // ── Master-only ab hier ────────────────────────────────────────────
  if (!isMaster(role)) return forbidden();

  // Tournaments
  if (req.method === 'GET'    && path === 'tournaments')          return await handleListTournaments();
  if (req.method === 'POST'   && path === 'tournaments/discover') return await handleDiscover(req);
  if (req.method === 'POST'   && path === 'tournaments')          return await handleCreateTournament(req);
  const tMatch = path.match(/^tournaments\/([a-z0-9-]+)$/i);
  if (tMatch && req.method === 'PUT')                             return await handleUpdateTournament(req, tMatch[1]);
  if (tMatch && req.method === 'DELETE')                          return await handleDeleteTournament(tMatch[1]);
  const sMatch = path.match(/^tournaments\/([a-z0-9-]+)\/status$/i);
  if (sMatch && req.method === 'POST')                            return await handleStatus(req, sMatch[1]);
  const scrapeMatch = path.match(/^tournaments\/([a-z0-9-]+)\/scrape$/i);
  if (scrapeMatch && req.method === 'POST')                       return await handleManualScrape(scrapeMatch[1]);
  if (req.method === 'GET'    && path.startsWith('discover/list'))return await handleDiscoverList(url);

  // Referees
  if (req.method === 'GET'    && path === 'referees')             return await handleListReferees();
  const rGet = path.match(/^referees\/([a-z0-9-]+)$/i);
  if (rGet && req.method === 'GET')                               return await handleGetReferee(rGet[1]);
  if (req.method === 'POST'   && path === 'referees')             return await handleCreateReferee(req);
  if (rGet && req.method === 'PUT')                               return await handleUpdateReferee(req, rGet[1]);
  if (rGet && req.method === 'DELETE')                            return await handleDeleteReferee(rGet[1], url.searchParams.get('permanent') === '1');
  const codeMatch = path.match(/^referees\/([a-z0-9-]+)\/login-code$/i);
  if (codeMatch && req.method === 'POST')                         return await handleGenerateCode(codeMatch[1]);
  if (codeMatch && req.method === 'DELETE')                       return await handleRevokeCode(codeMatch[1]);

  // DKV-PDF-Einsatzbogen pro Schiri (zentral durch Master)
  const pdfMatch = path.match(/^referees\/([a-z0-9-]+)\/pdf-einsatzbogen$/i);
  if (pdfMatch && req.method === 'GET') return await handleRefereePdf(pdfMatch[1], url);

  // Banner (Master-only, global)
  if (path === 'banner') {
    if (req.method === 'GET')    return jsonResponse({ ok: true, banner: await getBanner() });
    if (req.method === 'PUT')    return await handleBannerSet(req);
    if (req.method === 'DELETE') return await handleBannerClear();
  }

  // Reports
  if (req.method === 'GET' && path === 'reports/referees')          return await handleReport(url, 'json');
  if (req.method === 'GET' && path === 'reports/referees.csv')      return await handleReport(url, 'csv');
  if (req.method === 'GET' && path === 'reports/entries.csv')       return await handleDetailReport(url);

  return notFound();
};

// ─── Handler-Implementierungen ───────────────────────────────────────────────

async function handleLegacyRefs(req, url) {
  const slug = (url.searchParams.get('slug') || 'dc2026').trim();
  const store = getStore(STORE_NAME);

  if (req.method === 'GET') {
    const refs = (await store.get(LEGACY_REFS_KEY(slug), { type: 'json', consistency: 'strong' })) ?? {};
    return jsonResponse({ ok: true, slug, refs });
  }

  let body;
  try { body = await req.json(); } catch { body = null; }
  const nr = Number(body?.matchNr);
  const players = Array.isArray(body?.players) ? body.players.filter(Boolean) : [];
  if (!Number.isFinite(nr)) return badRequest('matchNr required');

  const updatedAt = new Date().toISOString();
  const reqId = Math.random().toString(36).slice(2, 8);
  let refs = null, success = false, attempt = 0;
  const maxAttempts = 3;

  while (attempt < maxAttempts && !success) {
    attempt++;
    refs = (await store.get(LEGACY_REFS_KEY(slug), { type: 'json', consistency: 'strong' })) ?? {};
    if (players.length === 0) delete refs[nr];
    else refs[nr] = { players, updatedAt };
    await store.setJSON(LEGACY_REFS_KEY(slug), refs);

    const verify = (await store.get(LEGACY_REFS_KEY(slug), { type: 'json', consistency: 'strong' })) ?? {};
    const entry = verify[nr];
    const expectedStr = players.length === 0 ? null : players.join('|');
    const actualStr   = entry?.players ? entry.players.join('|') : null;
    if (expectedStr === actualStr) {
      success = true; refs = verify;
      console.log(`[admin/refs] ${reqId} slug=${slug} nr=${nr} attempt=${attempt} OK`);
    } else {
      console.warn(`[admin/refs] ${reqId} slug=${slug} nr=${nr} attempt=${attempt} MISMATCH`);
      refs = verify;
    }
  }

  if (!success) return jsonResponse({ ok: false, error: 'write_conflict' }, { status: 409 });
  return jsonResponse({ ok: true, slug, refs, updatedAt });
}

async function handleAssignment(req, slug, nr) {
  let body;
  try { body = await req.json(); } catch { body = null; }
  const roles = body?.roles && typeof body.roles === 'object' ? body.roles : null;
  if (!roles) return badRequest('roles object required');

  // Validierung: alle keys gehören zu ROLES
  const knownRoles = new Set(ROLES.map(r => r.code));
  for (const key of Object.keys(roles)) {
    if (!knownRoles.has(key)) return badRequest(`Unbekannte Rolle: ${key}`);
  }

  // PLZ-Validierung + Existenz-Check
  const refIds = Object.values(roles).filter(Boolean);
  if (refIds.length > 0) {
    const allRefs = await listReferees({ activeOnly: false });
    const byId = new Map(allRefs.map(r => [r.id, r]));

    // PLZ in ref1/ref2 verbieten
    for (const roleCode of ['ref1', 'ref2']) {
      const rid = roles[roleCode];
      if (!rid) continue;
      const ref = byId.get(rid);
      if (!ref) return badRequest(`Schiri ${rid} nicht gefunden`);
      if (!canAssignRole(ref.level, roleCode)) {
        return badRequest(`Schiri "${ref.displayName || ref.firstName}" hat Klasse ${ref.level} und darf nicht ${roleCode}`);
      }
    }

    // Doppelte Belegung
    const seen = new Set();
    for (const rid of refIds) {
      if (seen.has(rid)) return badRequest('Ein Schiri kann nicht doppelt im selben Spiel sein');
      seen.add(rid);
    }
  }

  const store = getStore(STORE_NAME);
  const updatedAt = new Date().toISOString();
  let assignments = null, success = false, attempt = 0;
  while (attempt < 3 && !success) {
    attempt++;
    assignments = (await store.get(ASSIGNMENTS_KEY(slug), { type: 'json', consistency: 'strong' })) ?? {};
    // Normalize: null statt undefined / "" / leerer String
    const normalized = {};
    for (const r of ROLES) normalized[r.code] = roles[r.code] || null;
    assignments[nr] = { roles: normalized, updatedAt };
    await store.setJSON(ASSIGNMENTS_KEY(slug), assignments);
    const verify = (await store.get(ASSIGNMENTS_KEY(slug), { type: 'json', consistency: 'strong' })) ?? {};
    if (JSON.stringify(verify[nr]?.roles) === JSON.stringify(normalized)) {
      success = true; assignments = verify;
    }
  }
  if (!success) return jsonResponse({ ok: false, error: 'write_conflict' }, { status: 409 });
  return jsonResponse({ ok: true, slug, nr, assignment: assignments[nr], assignments });
}

async function handleListTournaments() {
  const all = await listTournaments();
  return jsonResponse({ ok: true, tournaments: all });
}

async function handleDiscover(req) {
  let body; try { body = await req.json(); } catch { body = null; }
  const inputUrl = body?.url;
  if (!inputUrl) return badRequest('url required');

  const connector = detectConnector(inputUrl);
  if (!connector) {
    return jsonResponse({
      ok: false, error: 'unsupported',
      message: `Kein Connector für diese URL. Bekannt: kayakers.nl, bundesliga.kanupolo.de`,
    }, { status: 400 });
  }
  try {
    const result = await connector.discover(inputUrl);
    return jsonResponse({ ok: true, result });
  } catch (e) {
    if (e.hint === 'manual') {
      return jsonResponse({
        ok: false, error: 'manual',
        message: e.message,
        suggestedSource: e.suggestedSource,
      }, { status: 400 });
    }
    throw e;
  }
}

/**
 * Pure-Function-Variante der Tournament-Config-Whitelist. Exportiert für Tests.
 *
 * Bugfix BUGFIX_EXTERNES_TURNIER#A — `external.resources` fehlte vorher in
 * der Whitelist. Der Wizard schickt `config.external = { resources: [...] }`,
 * der Server hat das aber still verworfen → neue externe Turniere wurden
 * ohne Ressourcen-Liste gespeichert (die Edit-Maske hatte das durch ihren
 * `{ ...existing, ...patch }`-Merge zufällig kaschiert).
 *
 * @param {object} config - vom Wizard gesendetes Config-Objekt
 * @param {string} now - ISO-Timestamp (DI für Tests)
 * @returns {object} Sanitisierte Tournament-Config zum Schreiben
 */
export function buildCreateTournamentConfig(config, now = new Date().toISOString()) {
  return {
    slug: config.slug,
    name: config.name,
    type: config.type || 'tournament',
    connector: config.connector || null,
    showStandings: !!config.showStandings,
    showHausliga: !!config.showHausliga,
    source: config.source || null,
    status: config.status || 'draft',
    dates: config.dates || [],
    expectedDates: config.expectedDates || null,
    timezone: config.timezone || 'Europe/Berlin',
    pendingTeamSelection: false,
    lastRediscoveryAt: null,
    ourTeams: config.ourTeams || [],
    // Felder für externe Turniere (type === 'external')
    external: config.external && typeof config.external === 'object'
      ? { resources: Array.isArray(config.external.resources) ? config.external.resources : [] }
      : null,
    // Legacy-Felder — solange noch alte Configs im Blob-Store liegen
    externalUrl: config.externalUrl || null,
    externalDays: Array.isArray(config.externalDays) ? config.externalDays : null,
    createdAt: now,
    updatedAt: now,
  };
}

async function handleCreateTournament(req) {
  let body; try { body = await req.json(); } catch { body = null; }
  const config = body?.config;
  if (!config?.slug || !config?.name) return badRequest('config.slug and config.name required');
  if (!/^[a-z0-9-]{3,40}$/.test(config.slug)) return badRequest('slug muss 3-40 Zeichen [a-z0-9-]+ sein');

  // Konflikt-Check
  const existing = await getTournament(config.slug);
  if (existing) return jsonResponse({ ok: false, error: 'slug_taken' }, { status: 409 });

  const finalConfig = buildCreateTournamentConfig(config);
  await saveTournament(finalConfig);
  return jsonResponse({ ok: true, config: finalConfig });
}

async function handleUpdateTournament(req, slug) {
  let body; try { body = await req.json(); } catch { body = null; }
  const patch = body?.patch || {};
  const existing = await getTournament(slug);
  if (!existing) return notFound();
  const merged = { ...existing, ...patch, slug, updatedAt: new Date().toISOString() };
  await saveTournament(merged);
  return jsonResponse({ ok: true, config: merged });
}

async function handleDeleteTournament(slug) {
  const store = getStore(STORE_NAME);

  // Snapshot + Assignments immer löschen
  await store.delete(`${slug}/snapshot.json`).catch(() => {});
  await store.delete(`${slug}/assignments.json`).catch(() => {});
  await store.delete(`${slug}/refereeAssignments.json`).catch(() => {});

  // Prüfen: war das ein Repo-basiertes Tournament?
  const existing = await getTournament(slug);
  const isRepoBased = existing?._source === 'repo';

  if (isRepoBased) {
    // Tombstone schreiben, der die Repo-Datei überschattet
    await store.setJSON(`${slug}/config.json`, {
      slug, _deleted: true, deletedAt: new Date().toISOString(),
    });
    console.log(`[admin] tournament ${slug} tombstoned (was repo-based)`);
  } else {
    // Normal löschen
    await store.delete(`${slug}/config.json`).catch(() => {});
    console.log(`[admin] tournament ${slug} deleted`);
  }

  const index = (await store.get('index.json', { type: 'json', consistency: 'strong' })) ?? { tournaments: [] };
  index.tournaments = index.tournaments.filter(t => t.slug !== slug);
  index.updatedAt = new Date().toISOString();
  await store.setJSON('index.json', index);

  return jsonResponse({ ok: true, slug, deleted: true, tombstoned: isRepoBased });
}

async function handleStatus(req, slug) {
  let body; try { body = await req.json(); } catch { body = null; }
  const status = body?.status;
  const valid = ['draft', 'awaiting-schedule', 'active', 'completed', 'archived'];
  if (!valid.includes(status)) return badRequest(`status muss eines sein: ${valid.join(', ')}`);

  const existing = await getTournament(slug);
  if (!existing) return notFound();
  await updateTournament(slug, { status, updatedAt: new Date().toISOString() });
  return jsonResponse({ ok: true, slug, status });
}

async function handleManualScrape(slug) {
  const config = await getTournament(slug);
  if (!config) return notFound();
  try {
    const snapshot = await buildSnapshot(config);
    const store = getStore(STORE_NAME);
    await store.setJSON(`${slug}/snapshot.json`, snapshot);
    return jsonResponse({ ok: true, slug, matches: snapshot.matches.length, teams: snapshot.teams.length });
  } catch (e) {
    return jsonResponse({ ok: false, slug, error: e?.message ?? String(e) }, { status: 500 });
  }
}

async function handleDiscoverList(url) {
  const country = url.searchParams.get('country');
  const connectorId = url.searchParams.get('connector') || 'kayakers';
  const connector = getConnector(connectorId);
  if (!connector) return badRequest('unbekannter connector');
  const list = await connector.listAvailableTournaments({ country });
  return jsonResponse({ ok: true, tournaments: list });
}

async function handleListReferees() {
  const all = await listReferees({ activeOnly: false, includeSecret: true });
  return jsonResponse({ ok: true, referees: all });
}

async function handleGetReferee(id) {
  const r = await getReferee(id);
  if (!r) return notFound();
  return jsonResponse({ ok: true, referee: r });
}

async function handleCreateReferee(req) {
  let body; try { body = await req.json(); } catch { body = null; }
  if (!body?.firstName || !body?.lastName) return badRequest('firstName + lastName required');
  const ref = await createReferee(body);
  return jsonResponse({ ok: true, referee: ref });
}

async function handleUpdateReferee(req, id) {
  let body; try { body = await req.json(); } catch { body = null; }
  const ref = await updateReferee(id, body);
  if (!ref) return notFound();
  return jsonResponse({ ok: true, referee: ref });
}

async function handleDeleteReferee(id, permanent = false) {
  if (permanent) {
    const ok = await hardDeleteReferee(id);
    if (!ok) return notFound();
    return jsonResponse({ ok: true, id, hardDeleted: true });
  }
  const ok = await softDeleteReferee(id);
  if (!ok) return notFound();
  return jsonResponse({ ok: true, id, deactivated: true });
}

async function handleGenerateCode(id) {
  const result = await generateLoginCode(id);
  if (!result) return notFound();
  // Hinweis ehrlich gehalten: Code liegt aktuell als Klartext im Blob-Store
  // (siehe README → Known Limitations). Hash-Speicherung ist als Issue geplant,
  // bis dahin Master-Disziplin: Code direkt an Schiri weiter, nicht aufbewahren.
  return jsonResponse({ ok: true, id, loginCode: result.loginCode,
    message: 'Code an den Schiri weitergeben. Bei Verlust kannst du jederzeit einen neuen generieren (alter wird ungültig).' });
}

async function handleRevokeCode(id) {
  const ok = await revokeLoginCode(id);
  if (!ok) return notFound();
  return jsonResponse({ ok: true, id, revoked: true });
}

async function handleDetailReport(url) {
  const year = Number(url.searchParams.get('year') || new Date().getFullYear());
  const csv = await detailEntriesToCsv(year);
  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="einsaetze-detail-${year}.csv"`,
    },
  });
}

async function handleReport(url, format) {
  const year = url.searchParams.get('year') || String(new Date().getFullYear());
  const aggregation = await aggregateReferees({ year: Number(year) });
  if (format === 'csv') {
    const csv = refereesToCsv(aggregation, Number(year));
    return new Response(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="einsaetze-${year}.csv"`,
      },
    });
  }
  return jsonResponse({ ok: true, year: Number(year), ...aggregation });
}

// ─── Externe Schiri-Einsätze (Trainer + Master) ──────────────────────────────

async function handleListExternal(slug) {
  const tournament = await getTournament(slug);
  if (!tournament) return notFound();
  const entries = await listExternalAssignments(slug);
  return jsonResponse({ ok: true, entries });
}

async function handleCreateExternal(req, slug, role) {
  const tournament = await getTournament(slug);
  if (!tournament) return notFound();
  let body; try { body = await req.json(); } catch { body = null; }
  try {
    const createdBy = typeof role === 'string' ? role : 'self';
    const entry = await createExternalAssignment(slug, body || {}, { createdBy });
    return jsonResponse({ ok: true, entry }, { status: 201 });
  } catch (e) {
    return badRequest(e.message);
  }
}

async function handleUpdateExternal(req, slug, id) {
  let body; try { body = await req.json(); } catch { body = null; }
  try {
    const updated = await updateExternalAssignment(slug, id, body || {});
    if (!updated) return notFound();
    return jsonResponse({ ok: true, entry: updated });
  } catch (e) {
    return badRequest(e.message);
  }
}

async function handleDeleteExternal(slug, id) {
  const ok = await deleteExternalAssignment(slug, id);
  if (!ok) return notFound();
  return jsonResponse({ ok: true, id, deleted: true });
}

// ─── Banner (Master setzt globale Nachricht) ─────────────────────────────────

async function handleBannerSet(req) {
  let body; try { body = await req.json(); } catch { body = null; }
  try {
    const banner = await setBanner(body || {}, 'master');
    return jsonResponse({ ok: true, banner });
  } catch (e) {
    return badRequest(e.message);
  }
}

async function handleBannerClear() {
  await clearBanner();
  return jsonResponse({ ok: true });
}

// ─── Master-Download: DKV-PDF pro Schiri ─────────────────────────────────────

async function handleRefereePdf(refereeId, url) {
  const year = Number(url.searchParams.get('year') || new Date().getFullYear());
  const result = await buildEinsatzbogenForReferee(refereeId, year);
  if (!result) return notFound();

  const filename = `DKV-Einsatzbogen-${result.referee.displayName || refereeId}-${year}.pdf`;
  return new Response(result.pdfBytes, {
    status: 200,
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control':       'no-store',
    },
  });
}
