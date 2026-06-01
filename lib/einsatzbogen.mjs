// lib/einsatzbogen.mjs
//
// High-Level-Builder für den DKV-Schiedsrichtereinsatzbogen.
// Aggregiert alle Einsätze (auto + extern + manuell) eines Schiris in einem
// Jahr, mappt sie ins DKV-Format und übergibt sie an dkvPdf.mjs zur Erzeugung
// der PDF-Bytes.
//
// Wird genutzt von:
//   - netlify/functions/me.mjs       (Self-Service-Download durch den Schiri)
//   - netlify/functions/admin.mjs    (Master-Download für beliebige Schiris)

import { getStore } from '@netlify/blobs';
import { getReferee } from './referees.mjs';
import { listTournaments } from './tournaments.mjs';
import { listExternalEntriesForReferee } from './externalAssignments.mjs';
import { listManualEntries } from './reports.mjs';
// dkvPdf.mjs wird lazy-importiert — pdf-lib soll nicht im Bundle aller Endpoints
// liegen (sonst lädt z.B. /api/me/profile pdf-lib unnötig und kann auf Netlify
// als 502 sterben, falls die Bundle-Resolution scheitert).

/**
 * Liest alle auto-Assignments aus kayakers-Turnieren für einen Schiri/ein Jahr.
 * Liefert flache Liste: [{ slug, tournamentName, date, matchNr, role, division }]
 */
export async function listAutoEntriesForReferee(refereeId, year) {
  const tournaments = await listTournaments();
  const store = getStore('tournaments');
  const results = [];

  for (const t of tournaments) {
    const yearsCovered = new Set((t.dates || []).map(d => Number(d.slice(0, 4))));
    if (!yearsCovered.has(year)) continue;
    const [assignments, snapshot] = await Promise.all([
      store.get(`${t.slug}/assignments.json`, { type: 'json' }),
      store.get(`${t.slug}/snapshot.json`, { type: 'json' }),
    ]);
    if (!assignments) continue;
    const matchesByNr = new Map((snapshot?.matches || []).map(m => [m.nr, m]));
    for (const [matchNr, entry] of Object.entries(assignments)) {
      for (const [roleCode, refId] of Object.entries(entry?.roles || {})) {
        if (refId !== refereeId) continue;
        const match = matchesByNr.get(Number(matchNr));
        const dateIso = match ? (t.dates?.[(match.day || 1) - 1] || '') : '';
        results.push({
          slug: t.slug,
          tournamentName: t.name,
          date: dateIso,
          matchNr,
          role: roleCode,
          division: match?.division || '',
          source: 'auto',
        });
      }
    }
  }
  return results;
}

/**
 * Aggregiert alle Einsätze (auto + extern + manuell) eines Schiris für ein Jahr.
 * Sortiert nach Datum, dann Spielnummer.
 */
export async function aggregateEntriesForReferee(refereeId, year) {
  const tournaments = await listTournaments();

  const [autoEntries, externalEntries, manual] = await Promise.all([
    listAutoEntriesForReferee(refereeId, year),
    listExternalEntriesForReferee(refereeId, tournaments, year),
    listManualEntries(refereeId, { year }),
  ]);

  // Auto-Einträge ins DKV-Format mappen
  const autoMapped = autoEntries.map(a => ({
    date:           a.date,
    matchNr:        a.matchNr,
    tournamentName: a.tournamentName,
    role:           a.role,
    division:       a.division,
    notes:          '',
  }));

  // Externe Einträge — division ist hier bereits der DKV-Code
  const externalMapped = externalEntries.map(e => ({
    date:           e.date,
    matchNr:        e.matchNr,
    tournamentName: e.tournamentName,
    role:           e.role,
    division:       e.division,
    notes:          '',
  }));

  // Manuelle Einträge (Self-Service-Fallback)
  const manualMapped = manual.map(m => ({
    date:           m.tournamentDate,
    matchNr:        m.matchNr || '',
    tournamentName: m.tournamentName,
    role:           m.role,
    division:       '',
    notes:          m.notes || '',
  }));

  const combined = [...autoMapped, ...externalMapped, ...manualMapped].sort((a, b) => {
    const d = (a.date || '').localeCompare(b.date || '');
    if (d !== 0) return d;
    const an = Number(a.matchNr) || 0;
    const bn = Number(b.matchNr) || 0;
    return an - bn;
  });

  return combined;
}

/**
 * Komplett-Build: Schiri-Daten + Einsätze + PDF-Bytes in einem Aufruf.
 * Wird von me.mjs und admin.mjs identisch verwendet.
 */
export async function buildEinsatzbogenForReferee(refereeId, year) {
  const referee = await getReferee(refereeId);
  if (!referee) return null;
  const entries = await aggregateEntriesForReferee(refereeId, year);
  // Lazy: pdf-lib nur laden wenn wirklich gerendert wird
  const { generateEinsatzbogenPdf } = await import('./dkvPdf.mjs');
  const pdfBytes = await generateEinsatzbogenPdf({ referee, year, entries });
  return { referee, entries, pdfBytes };
}
