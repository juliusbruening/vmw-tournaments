// netlify/functions/me.mjs
//
// Schiri-Self-Service-Endpunkte. Auth via Header `x-personal-token: VMW-7K2X`.
//
//   GET    /api/me/profile                  → eigene Stammdaten (ohne loginCode)
//   PUT    /api/me/profile                  → Self-Edit (whitelisted Felder)
//   GET    /api/me/entries?year=YYYY        → eigene Einsätze (auto + manuell)
//   GET    /api/me/pdf-einsatzbogen?year=Y  → DKV-PDF mit allen Einsätzen
//   POST   /api/me/manual-entry             → neuer manueller Eintrag
//   PUT    /api/me/manual-entry/<id>        → Update
//   DELETE /api/me/manual-entry/<id>        → löschen

import { getStore } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';
import { getRole, isSelf, jsonResponse, unauthorized, forbidden, notFound, badRequest } from '../../lib/auth.mjs';
import { getReferee, updateRefereeSelf } from '../../lib/referees.mjs';
import { aggregateReferees, listManualEntries } from '../../lib/reports.mjs';
import { ROLES, canAssignRole } from '../../lib/refereeLevels.mjs';
import {
  buildEinsatzbogenForReferee,
  listAutoEntriesForReferee as listAutoEntriesShared,
} from '../../lib/einsatzbogen.mjs';
import { listExternalEntriesForReferee } from '../../lib/externalAssignments.mjs';
import { buildCacheHeadersShort } from '../../lib/cacheHeaders.mjs';
// N1 — Persistenz via Index-Pattern (siehe lib/manualEntries.mjs). Ersetzt
// die direkten store.list-Aufrufe, die wegen Eventual-Consistency dazu führten,
// dass frische Einträge erst nach Sekunden bis Minuten sichtbar wurden.
import * as manualEntries from '../../lib/manualEntries.mjs';

const STORE = 'club';
const MANUAL_KEY = (refId, entryId) => `manualEntries/${refId}/${entryId}.json`;

// N2 — Erlaubte Werte für `spielklasse` analog zu lib/externalAssignments.mjs.
// Wird im DKV-PDF von dkvPdf.mjs#SPIELKLASSE_TO_COLUMN gebraucht.
const SPIELKLASSEN = ['herren', 'damen', 'junioren', 'jugend', 'schueler'];

export default async (req) => {
  const role = await getRole(req);
  if (!isSelf(role)) return unauthorized();
  const refereeId = role.refereeId;

  const url = new URL(req.url);
  const path = url.pathname
    .replace(/^\/api\/me\/?/, '')
    .replace(/^\/\.netlify\/functions\/me\/?/, '');

  // ── Profile ─────────────────────────────────────────────────────────
  if (req.method === 'GET' && path === 'profile') {
    const ref = await getReferee(refereeId);
    if (!ref) return notFound();
    const { loginCode, notes, ...publicView } = ref;
    return new Response(JSON.stringify({ ok: true, referee: publicView }), {
      status: 200,
      // N1 — Cache via zentralem Helper: private,max-age=5 + cdn no-store + Vary,
      // damit Browser nach POST/DELETE keine stale Antwort serviert.
      headers: { 'content-type': 'application/json', ...buildCacheHeadersShort(true) },
    });
  }

  if (req.method === 'PUT' && path === 'profile') {
    let body; try { body = await req.json(); } catch { body = null; }
    const updated = await updateRefereeSelf(refereeId, body || {});
    if (!updated) return notFound();
    const { loginCode, notes, ...publicView } = updated;
    return jsonResponse({ ok: true, referee: publicView });
  }

  // ── Einsätze (auto + manuell) ───────────────────────────────────────
  if (req.method === 'GET' && path === 'entries') {
    // N1 R3 — year='all' → year=null durchreichen (Filter überspringt).
    // listManualEntries und aggregateReferees ignorieren year: undefined/null.
    // listAutoEntriesForReferee bekommt 'all' weitergereicht und filtert dort.
    const yearParam = url.searchParams.get('year');
    const allYears = yearParam === 'all';
    const year = allYears ? null : Number(yearParam || new Date().getFullYear());

    const [agg, manual, autoDetails] = await Promise.all([
      aggregateReferees({ year: year ?? undefined }),
      listManualEntries(refereeId, { year: year ?? undefined }),
      listAutoEntriesForReferee(refereeId, year),
    ]);
    const bucket = agg.byReferee?.[refereeId];
    return new Response(JSON.stringify({
      ok: true,
      year: allYears ? 'all' : year,
      stats: bucket
        ? { totalGames: bucket.totalGames, byRole: bucket.byRole, byTournament: bucket.byTournament }
        : { totalGames: 0, byRole: {}, byTournament: [] },
      autoEntries: autoDetails,
      manualEntries: manual,
    }), {
      status: 200,
      // N1 — Cache via zentralem Helper: private,max-age=5 + cdn no-store + Vary,
      // damit Browser nach POST/DELETE keine stale Antwort serviert.
      headers: { 'content-type': 'application/json', ...buildCacheHeadersShort(true) },
    });
  }

  // ── DKV-PDF-Einsatzbogen ───────────────────────────────────────────
  if (req.method === 'GET' && path === 'pdf-einsatzbogen') {
    const year = Number(url.searchParams.get('year') || new Date().getFullYear());
    return await renderPdfEinsatzbogen(refereeId, year);
  }

  // ── Manuelle Einträge ──────────────────────────────────────────────
  if (req.method === 'POST' && path === 'manual-entry') {
    return await createManualEntry(req, refereeId);
  }

  const editMatch = path.match(/^manual-entry\/([a-z0-9-]+)$/i);
  if (editMatch && req.method === 'PUT') {
    return await updateManualEntry(req, refereeId, editMatch[1]);
  }
  if (editMatch && req.method === 'DELETE') {
    return await deleteManualEntry(refereeId, editMatch[1]);
  }

  return notFound();
};

async function createManualEntry(req, refereeId) {
  let body; try { body = await req.json(); } catch { body = null; }
  const err = validateManualEntry(body);
  if (err) return badRequest(err);

  const ref = await getReferee(refereeId);
  if (!ref) return notFound();
  if (!canAssignRole(ref.level, body.role)) {
    return badRequest(`Schiri mit Klasse ${ref.level} darf nicht ${body.role}`);
  }

  // N1 — Persistenz via Index-Helper (schreibt Volldatensatz + Index strong-konsistent)
  const entry = await manualEntries.createManualEntry(refereeId, {
    tournamentName: body.tournamentName.trim(),
    tournamentDate: body.tournamentDate,
    matchNr:        (body.matchNr || '').toString().trim(),
    matchLabel:     (body.matchLabel || '').trim(),
    role:           body.role,
    spielklasse:    SPIELKLASSEN.includes(body.spielklasse) ? body.spielklasse : null,
    notes:          (body.notes || '').trim(),
  });
  return jsonResponse({ ok: true, entry }, { status: 201 });
}

async function updateManualEntry(req, refereeId, entryId) {
  let body; try { body = await req.json(); } catch { body = null; }
  const existing = await manualEntries.getManualEntry(refereeId, entryId);
  if (!existing) return notFound();
  const err = validateManualEntry({ ...existing, ...body });
  if (err) return badRequest(err);
  // N1 — Update via Index-Helper (strong-konsistenter Merge + Index-Sync)
  const merged = await manualEntries.updateManualEntry(refereeId, entryId, body || {});
  if (!merged) return notFound();
  return jsonResponse({ ok: true, entry: merged });
}

async function deleteManualEntry(refereeId, entryId) {
  // N1 — Delete via Index-Helper (Volldatensatz + Index-Eintrag entfernen)
  const ok = await manualEntries.deleteManualEntry(refereeId, entryId);
  if (!ok) return notFound();
  return jsonResponse({ ok: true, id: entryId, deleted: true });
}

/**
 * Liest pro Match-Nr die auto-zugewiesenen Rollen des Schiris aus allen
 * Turnieren des Jahres und liefert eine flache Liste:
 *   [{ slug, tournamentName, date, matchNr, role, division }, …]
 */
// Wrapper für die /api/me/entries-Route: nutzt den shared-Helper aus einsatzbogen.mjs
// und ergänzt die externen Einträge (gleiche Logik wie buildEinsatzbogen, aber
// als zwei separate Listen für die UI-Tabelle exponiert).
async function listAutoEntriesForReferee(refereeId, year) {
  const { listTournaments } = await import('../../lib/tournaments.mjs');
  const [tournaments, autoOnly] = await Promise.all([
    listTournaments(),
    listAutoEntriesShared(refereeId, year),
  ]);
  const external = await listExternalEntriesForReferee(refereeId, tournaments, year);
  const all = [...autoOnly, ...external];
  all.sort((a, b) => {
    const d = (b.date || '').localeCompare(a.date || '');
    if (d !== 0) return d;
    return Number(a.matchNr) - Number(b.matchNr);
  });
  return all;
}

/**
 * Validiert einen manualEntry. Exportiert für Tests in
 * scripts/testManualEntryValidation.mjs.
 *
 * N1 R3: Range-Check verhindert „1111-01-01"-Eingaben (Browser-Date-Picker
 * akzeptiert das, weil das ISO-Format formal stimmt — der Range ist die
 * App-Plausibilität). Untergrenze 2000 arbitrarisch (vor 2000 gab's keinen
 * DKV-Einsatzbogen in der heutigen Form). Obergrenze `thisYear+1` lässt
 * Eingaben für die kommende Saison zu (z.B. Januar 2027 für ein Spiel
 * im Mai 2027).
 *
 * @param {object} entry
 * @param {number} [now=Date.now()] — DI für Tests (deterministisches thisYear)
 */
export function validateManualEntry(entry, now = Date.now()) {
  if (!entry) return 'body required';
  if (!entry.tournamentName || typeof entry.tournamentName !== 'string') return 'tournamentName required';
  if (!entry.tournamentDate || !/^\d{4}-\d{2}-\d{2}$/.test(entry.tournamentDate)) return 'tournamentDate must be YYYY-MM-DD';
  // N1 R3 — Range-Check
  const yearNum = Number(entry.tournamentDate.slice(0, 4));
  const thisYear = new Date(now).getFullYear();
  if (yearNum < 2000 || yearNum > thisYear + 1) {
    return `Datum muss zwischen 2000 und ${thisYear + 1} liegen`;
  }
  if (!entry.role || !ROLES.some(r => r.code === entry.role)) return 'role muss eine bekannte Rolle sein';
  // N2 — spielklasse optional (Legacy-Einträge bleiben valide), wenn gesetzt: prüfen.
  if (entry.spielklasse && !SPIELKLASSEN.includes(entry.spielklasse)) {
    return `spielklasse muss eine von ${SPIELKLASSEN.join(', ')} sein`;
  }
  return null;
}

/**
 * Rendert das DKV-Einsatzbogen-PDF für den eingeloggten Schiri und das Jahr.
 * Self-Service-Endpoint — delegiert komplett an lib/einsatzbogen.mjs (gleiche
 * Pipeline wie der Master-Download).
 */
async function renderPdfEinsatzbogen(refereeId, year) {
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
