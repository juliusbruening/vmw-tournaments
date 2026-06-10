// lib/reports.mjs
//
// Aggregations-Logik für Schiri-Einsätze über alle Turniere eines Jahres.
// Quelle: tournaments/<slug>/assignments.json (Phase 3 rollenbasiert)
//       + tournaments/<slug>/externalAssignments/*.json (Phase 7 — externe Turniere)
//       + club/manualEntries/<refereeId>/*.json (Phase 6 — Self-Service-Fallback)

import { getStore } from '@netlify/blobs';
import { listTournaments } from './tournaments.mjs';
import { listReferees } from './referees.mjs';
import { ROLES } from './refereeLevels.mjs';
import { listExternalAssignments } from './externalAssignments.mjs';
// N1 — Manuelle Einsätze via Index-Pattern (strong-konsistent).
import { listManualEntries } from './manualEntries.mjs';

const SPIELKLASSE_LABELS = {
  herren:   'Herren',
  damen:    'Damen',
  junioren: 'Junioren',   // bewusst Junioren (DKV-Term), in UI als U21
  jugend:   'Jugend',
  schueler: 'Schüler',
};

/**
 * Aggregiert alle Einsätze pro Schiri für ein Jahr.
 * Returnt { byReferee: { [id]: {...} } }.
 *
 * @param {{ year: number }} opts
 */
export async function aggregateReferees({ year }) {
  const [tournaments, referees] = await Promise.all([
    listTournaments(),
    listReferees({ activeOnly: false, includeSecret: true }),
  ]);

  // Initialisiere Schiri-Buckets
  const byReferee = {};
  for (const r of referees) {
    byReferee[r.id] = {
      id: r.id,
      displayName: r.displayName || r.firstName,
      fullName: `${r.firstName || ''} ${r.lastName || ''}`.trim(),
      level: r.level,
      active: r.active,
      totalGames: 0,
      byRole: Object.fromEntries(ROLES.map(rl => [rl.code, 0])),
      byTournament: {},
    };
  }

  // 1) Auto-Einsätze aus den Turnier-Assignments
  const store = getStore('tournaments');
  for (const t of tournaments) {
    // Filter: Turnier hat mindestens ein Datum im Zieljahr
    const yearsCovered = new Set((t.dates || []).map(d => Number(d.slice(0, 4))));
    if (!yearsCovered.has(year)) continue;

    const assignments = await store.get(`${t.slug}/assignments.json`, { type: 'json' });
    if (!assignments) continue;

    for (const [matchNr, entry] of Object.entries(assignments)) {
      if (!entry?.roles) continue;
      for (const [roleCode, refId] of Object.entries(entry.roles)) {
        if (!refId) continue;
        if (!byReferee[refId]) continue;
        const bucket = byReferee[refId];
        bucket.totalGames += 1;
        bucket.byRole[roleCode] = (bucket.byRole[roleCode] || 0) + 1;
        const tKey = t.slug;
        if (!bucket.byTournament[tKey]) {
          bucket.byTournament[tKey] = { slug: t.slug, name: t.name, games: 0, byRole: {} };
        }
        bucket.byTournament[tKey].games += 1;
        bucket.byTournament[tKey].byRole[roleCode] = (bucket.byTournament[tKey].byRole[roleCode] || 0) + 1;
      }
    }
  }

  // 1b) Externe Einsätze (Phase 7) — per Turnier in externalAssignments/
  // Reads parallel statt sequenziell — ein Read pro Turnier des Jahres.
  const tournamentsInYear = tournaments.filter(t => {
    const yearsCovered = new Set((t.dates || []).map(d => Number(d.slice(0, 4))));
    return yearsCovered.has(year);
  });
  const extLists = await Promise.all(
    tournamentsInYear.map(t => listExternalAssignments(t.slug).catch(() => []))
  );
  for (const [i, t] of tournamentsInYear.entries()) {
    const ext = extLists[i];
    for (const entry of ext) {
      // Filter pro Eintrag — nur wenn das Datum im Zieljahr liegt
      if (!entry.date?.startsWith(String(year))) continue;
      for (const [roleCode, refId] of Object.entries(entry.roles || {})) {
        if (!refId || !byReferee[refId]) continue;
        const bucket = byReferee[refId];
        bucket.totalGames += 1;
        bucket.byRole[roleCode] = (bucket.byRole[roleCode] || 0) + 1;
        const tKey = t.slug;
        if (!bucket.byTournament[tKey]) {
          bucket.byTournament[tKey] = { slug: t.slug, name: t.name, games: 0, byRole: {} };
        }
        bucket.byTournament[tKey].games += 1;
        bucket.byTournament[tKey].byRole[roleCode] = (bucket.byTournament[tKey].byRole[roleCode] || 0) + 1;
      }
    }
  }

  // 2) Manuelle Einsätze (Phase 6) — pro Schiri unter club/manualEntries/<refId>/
  // N1 — via lib/manualEntries.mjs (Index-basiert, strong-konsistent).
  // ACHTUNG: Beim erstmaligen Aufruf pro Schiri triggert listManualEntries
  // einen einmaligen `store.list`-Bootstrap, um den Index aus dem alten
  // Blob-Bestand aufzubauen. Bei N Schiris ist das ein N-mal-list-Burst beim
  // allerersten Master-Report nach Deploy — bei <100 Schiris vernachlässigbar.
  // Reads parallel — der sequenzielle Loop war bei 50 Schiris 50 Blob-Reads
  // in Serie und damit der größte Latenz-Treiber des Master-Reports.
  const refIds = Object.keys(byReferee);
  const manualLists = await Promise.all(
    refIds.map(refId => listManualEntries(refId, { year }).catch(() => []))
  );
  for (const [i, refId] of refIds.entries()) {
    try {
      const entries = manualLists[i];
      for (const entry of entries) {
        const bucket = byReferee[refId];
        bucket.totalGames += 1;
        bucket.byRole[entry.role] = (bucket.byRole[entry.role] || 0) + 1;
        const key = `_manual:${entry.tournamentName || 'Manuell'}`;
        if (!bucket.byTournament[key]) {
          bucket.byTournament[key] = {
            slug: null, name: entry.tournamentName || 'Manueller Eintrag',
            games: 0, byRole: {}, manual: true,
          };
        }
        bucket.byTournament[key].games += 1;
        bucket.byTournament[key].byRole[entry.role] = (bucket.byTournament[key].byRole[entry.role] || 0) + 1;
      }
    } catch { /* kein manualEntries-Dir → skip */ }
  }

  // Tournament-Map zu Array konvertieren für übersichtliche JSON-Antworten
  for (const id of Object.keys(byReferee)) {
    byReferee[id].byTournament = Object.values(byReferee[id].byTournament);
  }

  return { byReferee };
}

/**
 * Konvertiert aggregateReferees-Output in eine ZUSAMMENFASSUNG-CSV
 * (eine Zeile pro Schiri mit Total + Aufschlüsselung pro Rolle).
 * Für Verbands-Schnellblick.
 */
export function refereesToCsv(aggregation, year) {
  const rows = Object.values(aggregation.byReferee);
  const header = ['DisplayName', 'FullName', 'Level', 'Total', ...ROLES.map(r => r.short)];
  const lines = [header.join(',')];
  for (const r of rows) {
    const cols = [
      csvField(r.displayName),
      csvField(r.fullName),
      csvField(r.level || ''),
      String(r.totalGames),
      ...ROLES.map(role => String(r.byRole[role.code] || 0)),
    ];
    lines.push(cols.join(','));
  }
  return '﻿' + lines.join('\n');
}

/**
 * Detail-CSV: pro Einsatz eine Zeile mit Schiri-Name, Datum, Turnier, Spielnummer, Rolle, Klasse.
 * Layout passt zum DKV-Einsatzbogen — Schiris können die Zeilen manuell ins PDF übertragen.
 *
 * @param {Object} entriesData  — {byReferee, allMatches}
 * @param {number} year
 */
export async function detailEntriesToCsv(year) {
  const { getStore } = await import('@netlify/blobs');
  const { listTournaments } = await import('./tournaments.mjs');
  const { listReferees } = await import('./referees.mjs');

  const FUNCTION_LABELS = {
    ref1: '1.SR', ref2: '2.SR', scorer: 'Protokoll', timer: 'Zeit',
    shotclock: 'Zeit (Shotclock)', line1: 'Linien', line2: 'Linien',
  };
  const DIVISION_TO_CLASS = (div) => {
    const d = (div || '').toLowerCase();
    if (d.includes('men 1st') || d.includes('men 2nd') || d.includes('herren')) return 'Herren';
    if (d.includes('women') || d.includes('damen')) return 'Damen';
    if (d.includes('u21') || d.includes('junioren')) return 'Junioren';
    if (d.includes('u16') || d.includes('youth') || d.includes('jugend')) return 'Jugend';
    if (d.includes('u14') || d.includes('pupils') || d.includes('schüler')) return 'Schüler';
    return '';
  };

  const [tournaments, referees] = await Promise.all([
    listTournaments(),
    listReferees({ activeOnly: false, includeSecret: true }),
  ]);
  const refsById = new Map(referees.map(r => [r.id, r]));
  const store = getStore('tournaments');
  const clubStore = getStore('club');
  const rows = [];

  // 1) Auto-Einsätze aus Turnier-Assignments
  for (const t of tournaments) {
    const yearsCovered = new Set((t.dates || []).map(d => Number(d.slice(0,4))));
    if (!yearsCovered.has(year)) continue;
    const [assignments, snapshot] = await Promise.all([
      store.get(`${t.slug}/assignments.json`, { type: 'json' }),
      store.get(`${t.slug}/snapshot.json`, { type: 'json' }),
    ]);
    if (!assignments) continue;
    const matchesByNr = new Map((snapshot?.matches || []).map(m => [m.nr, m]));
    for (const [matchNr, entry] of Object.entries(assignments)) {
      const match = matchesByNr.get(Number(matchNr));
      const dateIso = match ? (t.dates?.[(match.day || 1) - 1] || '') : '';
      for (const [roleCode, refId] of Object.entries(entry?.roles || {})) {
        if (!refId) continue;
        const ref = refsById.get(refId);
        if (!ref) continue;
        rows.push({
          displayName: ref.displayName || ref.firstName,
          fullName: `${ref.firstName || ''} ${ref.lastName || ''}`.trim(),
          level: ref.level || '',
          date: dateIso ? dateIso.split('-').reverse().join('.') : '',
          tournament: t.name,
          matchNr: matchNr,
          function: FUNCTION_LABELS[roleCode] || roleCode,
          class: match ? DIVISION_TO_CLASS(match.division) : '',
          notes: '',
        });
      }
    }
  }

  // 1b) Externe Einsätze (Phase 7)
  for (const t of tournaments) {
    const yearsCovered = new Set((t.dates || []).map(d => Number(d.slice(0,4))));
    if (!yearsCovered.has(year)) continue;
    const ext = await listExternalAssignments(t.slug);
    for (const entry of ext) {
      if (!entry.date?.startsWith(String(year))) continue;
      for (const [roleCode, refId] of Object.entries(entry.roles || {})) {
        if (!refId) continue;
        const ref = refsById.get(refId);
        if (!ref) continue;
        rows.push({
          displayName: ref.displayName || ref.firstName,
          fullName: `${ref.firstName || ''} ${ref.lastName || ''}`.trim(),
          level: ref.level || '',
          date: entry.date.split('-').reverse().join('.'),
          tournament: t.name,
          matchNr: entry.matchNr,
          function: FUNCTION_LABELS[roleCode] || roleCode,
          class: SPIELKLASSE_LABELS[entry.spielklasse] || '',
          notes: entry.notes || '',
        });
      }
    }
  }

  // 2) Manuelle Einträge — N1: via Index-Helper (strong-konsistent)
  for (const ref of referees) {
    try {
      const entries = await listManualEntries(ref.id, { year });
      for (const entry of entries) {
        rows.push({
          displayName: ref.displayName || ref.firstName,
          fullName: `${ref.firstName || ''} ${ref.lastName || ''}`.trim(),
          level: ref.level || '',
          date: entry.tournamentDate ? entry.tournamentDate.split('-').reverse().join('.') : '',
          tournament: entry.tournamentName,
          matchNr: entry.matchNr || entry.matchLabel || '',
          function: FUNCTION_LABELS[entry.role] || entry.role,
          // N2 — Spielklasse wird beim manuellen Eintrag jetzt optional erfasst.
          // Legacy-Einträge (`spielklasse` undefined) zeigen weiterhin '' in der Spalte.
          class: SPIELKLASSE_LABELS[entry.spielklasse] || '',
          notes: entry.notes || 'manuell',
        });
      }
    } catch { /* skip */ }
  }

  // Sortierung: nach Schiri-Name, dann Datum
  rows.sort((a, b) => {
    const n = a.displayName.localeCompare(b.displayName);
    if (n !== 0) return n;
    return a.date.localeCompare(b.date);
  });

  const header = ['Schiri', 'Vollname', 'Klasse', 'Datum', 'Veranstaltung', 'Spiel-Nr.', 'Funktion', 'Spielklasse', 'Bemerkung'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      csvField(r.displayName), csvField(r.fullName), csvField(r.level),
      csvField(r.date), csvField(r.tournament), csvField(r.matchNr),
      csvField(r.function), csvField(r.class), csvField(r.notes),
    ].join(','));
  }
  return '﻿' + lines.join('\n');
}

function csvField(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Manuelle Einträge pro Schiri lesen — für /api/me/entries und andere Caller.
 *
 * N1 — delegiert an lib/manualEntries.mjs (Index-Pattern + strong-konsistent).
 * Re-Export hier, damit bestehende `import { listManualEntries } from './reports.mjs'`
 * weiter funktionieren. Bei einem zukünftigen Refactor können Caller direkt
 * auf lib/manualEntries.mjs umgestellt werden.
 */
export { listManualEntries };
