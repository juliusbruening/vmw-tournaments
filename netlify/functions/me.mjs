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
    const year = Number(url.searchParams.get('year') || new Date().getFullYear());

    const [agg, manual, autoDetails] = await Promise.all([
      aggregateReferees({ year }),
      listManualEntries(refereeId, { year }),
      listAutoEntriesForReferee(refereeId, year),
    ]);
    const bucket = agg.byReferee?.[refereeId];
    return new Response(JSON.stringify({
      ok: true,
      year,
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

  const id = randomUUID();
  const entry = {
    id,
    refereeId,
    tournamentName: body.tournamentName.trim(),
    tournamentDate: body.tournamentDate,
    matchNr:        (body.matchNr || '').toString().trim(),
    matchLabel:     (body.matchLabel || '').trim(),
    role:           body.role,
    // N2 — Spielklasse für DKV-PDF (wird via division → SPIELKLASSE_TO_COLUMN
    // in die richtige Bogen-Spalte gemappt). Optional → null falls nicht gesetzt.
    spielklasse:    SPIELKLASSEN.includes(body.spielklasse) ? body.spielklasse : null,
    notes:          (body.notes || '').trim(),
    createdAt:      new Date().toISOString(),
    createdBy:      'self',
  };
  const store = getStore(STORE);
  await store.setJSON(MANUAL_KEY(refereeId, id), entry);
  return jsonResponse({ ok: true, entry }, { status: 201 });
}

async function updateManualEntry(req, refereeId, entryId) {
  let body; try { body = await req.json(); } catch { body = null; }
  const store = getStore(STORE);
  const existing = await store.get(MANUAL_KEY(refereeId, entryId), { type: 'json', consistency: 'strong' });
  if (!existing) return notFound();
  const err = validateManualEntry({ ...existing, ...body });
  if (err) return badRequest(err);
  const merged = { ...existing, ...body, updatedAt: new Date().toISOString() };
  await store.setJSON(MANUAL_KEY(refereeId, entryId), merged);
  return jsonResponse({ ok: true, entry: merged });
}

async function deleteManualEntry(refereeId, entryId) {
  const store = getStore(STORE);
  const existing = await store.get(MANUAL_KEY(refereeId, entryId), { type: 'json' });
  if (!existing) return notFound();
  await store.delete(MANUAL_KEY(refereeId, entryId));
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

function validateManualEntry(entry) {
  if (!entry) return 'body required';
  if (!entry.tournamentName || typeof entry.tournamentName !== 'string') return 'tournamentName required';
  if (!entry.tournamentDate || !/^\d{4}-\d{2}-\d{2}$/.test(entry.tournamentDate)) return 'tournamentDate must be YYYY-MM-DD';
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
