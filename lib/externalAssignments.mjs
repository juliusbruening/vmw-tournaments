// lib/externalAssignments.mjs
//
// Manuell gepflegte Schiri-Einsätze für externe Turniere (Bundesliga, PDF-only-
// Turniere, kleine Vereins-Cups). Trainer + Master legen diese Einträge an;
// sie fließen durch dieselbe Aggregations-Pipeline wie auto-Einsätze und
// erscheinen automatisch im Profil und im DKV-PDF jedes betroffenen Schiris.
//
// Blob-Layout (Store: "tournaments"):
//   <slug>/externalAssignments/<id>.json
//   <slug>/externalAssignments/index.json     — Cache (id, matchNr, date)
//
// Eintrag-Schema:
//   {
//     id:           UUID,
//     matchNr:      "1"   (string, weil externe Pläne auch "1a", "F1" o.ä. nutzen),
//     date:         "2026-06-14",
//     time:         "10:30" | null  (P1.1 — optional, HH:MM; nicht im DKV-PDF),
//     spielklasse:  "herren" | "damen" | "junioren" | "jugend" | "schueler",
//     roles:        { ref1: refId, ref2: refId, scorer: refId, ... },
//     notes:        "",
//     createdAt, createdBy, updatedAt
//   }

import { getStore } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';

const STORE = 'tournaments';
const ENTRY_KEY = (slug, id) => `${slug}/externalAssignments/${id}.json`;
const INDEX_KEY = (slug)      => `${slug}/externalAssignments/index.json`;

const ROLE_CODES = ['ref1', 'ref2', 'scorer', 'timer', 'shotclock', 'line1', 'line2'];
const SPIELKLASSEN = ['herren', 'damen', 'junioren', 'jugend', 'schueler'];

/**
 * Liefert alle externen Einsätze eines Turniers.
 */
export async function listExternalAssignments(slug) {
  const store = getStore(STORE);
  const index = await store.get(INDEX_KEY(slug), { type: 'json', consistency: 'strong' });
  if (!index?.entries?.length) return [];

  const entries = await Promise.all(
    index.entries.map(e => store.get(ENTRY_KEY(slug, e.id), { type: 'json', consistency: 'strong' }))
  );
  return entries.filter(Boolean).sort(sortEntries);
}

/**
 * Liefert einen einzelnen Eintrag.
 */
export async function getExternalAssignment(slug, id) {
  const store = getStore(STORE);
  return await store.get(ENTRY_KEY(slug, id), { type: 'json', consistency: 'strong' });
}

/**
 * Legt einen neuen Eintrag an.
 */
export async function createExternalAssignment(slug, data, { createdBy = 'unknown' } = {}) {
  const err = validateAssignment(data);
  if (err) throw new Error(err);

  const id = randomUUID();
  const now = new Date().toISOString();
  const entry = {
    id,
    matchNr:     String(data.matchNr).trim(),
    date:        data.date,
    time:        data.time?.trim() || null,        // P1.1 — optional
    spielklasse: data.spielklasse,
    roles:       sanitizeRoles(data.roles),
    notes:       (data.notes || '').trim(),
    createdAt:   now,
    createdBy,
  };
  const store = getStore(STORE);
  await store.setJSON(ENTRY_KEY(slug, id), entry);
  await updateIndex(slug, entry, 'add');
  return entry;
}

/**
 * Update — Partial Merge auf bestehenden Eintrag.
 */
export async function updateExternalAssignment(slug, id, patch) {
  const store = getStore(STORE);
  const existing = await store.get(ENTRY_KEY(slug, id), { type: 'json', consistency: 'strong' });
  if (!existing) return null;

  const merged = {
    ...existing,
    ...patch,
    id,                                        // ID nie überschreiben
    matchNr: patch.matchNr != null ? String(patch.matchNr).trim() : existing.matchNr,
    // P1.1 — `time` darf bewusst auf null gesetzt werden (Spread reicht für undefined,
    // aber wir wollen auch explizites null durchlassen).
    time:    patch.time !== undefined ? (patch.time ? String(patch.time).trim() : null) : existing.time ?? null,
    roles:   patch.roles ? sanitizeRoles(patch.roles) : existing.roles,
    updatedAt: new Date().toISOString(),
  };
  const err = validateAssignment(merged);
  if (err) throw new Error(err);

  await store.setJSON(ENTRY_KEY(slug, id), merged);
  await updateIndex(slug, merged, 'add');
  return merged;
}

/**
 * Löscht einen Eintrag.
 */
export async function deleteExternalAssignment(slug, id) {
  const store = getStore(STORE);
  const existing = await store.get(ENTRY_KEY(slug, id), { type: 'json' });
  if (!existing) return false;
  await store.delete(ENTRY_KEY(slug, id));
  await updateIndex(slug, { id }, 'remove');
  return true;
}

/**
 * Bequemer Aggregations-Helper: liefert eine flache Liste pro Schiri-Einsatz
 * im selben Format wie listAutoEntriesForReferee, sodass me.mjs sie kombinieren
 * kann ohne Sonderlogik.
 *
 * Felder pro Item:
 *   { slug, tournamentName, date, matchNr, role, division, source: 'external' }
 */
export async function listExternalEntriesForReferee(refereeId, tournaments, year) {
  const results = [];

  for (const t of tournaments) {
    const entries = await listExternalAssignments(t.slug);
    for (const entry of entries) {
      if (year != null && !entry.date.startsWith(String(year))) continue;
      for (const [roleCode, refId] of Object.entries(entry.roles || {})) {
        if (refId !== refereeId) continue;
        results.push({
          slug:           t.slug,
          tournamentName: t.name,
          date:           entry.date,
          time:           entry.time ?? null,   // P1.1 — für UI; DKV-PDF ignoriert es
          matchNr:        entry.matchNr,
          role:           roleCode,
          division:       entry.spielklasse,    // direkt im DKV-Format
          source:         'external',
        });
      }
    }
  }
  return results;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function validateAssignment(entry) {
  if (!entry) return 'body required';
  if (!entry.matchNr || !String(entry.matchNr).trim()) return 'matchNr required';
  if (!entry.date || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return 'date muss YYYY-MM-DD sein';
  // P1.1 — time ist optional. Wenn gesetzt: striktes HH:MM (00:00–23:59).
  if (entry.time != null && entry.time !== '') {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.time)) return 'time muss HH:MM sein (00:00–23:59)';
  }
  if (entry.spielklasse && !SPIELKLASSEN.includes(entry.spielklasse)) {
    return `spielklasse muss eine von ${SPIELKLASSEN.join(', ')} sein`;
  }
  if (entry.roles && typeof entry.roles !== 'object') return 'roles muss Object sein';
  if (entry.roles) {
    for (const k of Object.keys(entry.roles)) {
      if (!ROLE_CODES.includes(k)) return `unbekannter Rollen-Code: ${k}`;
    }
  }
  return null;
}

function sanitizeRoles(roles) {
  const clean = {};
  for (const k of ROLE_CODES) {
    if (roles?.[k] && typeof roles[k] === 'string') clean[k] = roles[k];
  }
  return clean;
}

function sortEntries(a, b) {
  const d = (a.date || '').localeCompare(b.date || '');
  if (d !== 0) return d;
  // P1.1 — wenn time gesetzt: sekundär nach Anpfiff sortieren (Spielreihenfolge).
  // Einträge ohne time wandern ans Ende des Tages (leere Strings sortieren <).
  const at = a.time || '99:99';
  const bt = b.time || '99:99';
  if (at !== bt) return at.localeCompare(bt);
  // Tertiär: Spielnummer als Zahl wenn möglich, sonst lexikalisch
  const an = Number(a.matchNr), bn = Number(b.matchNr);
  if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
  return String(a.matchNr).localeCompare(String(b.matchNr));
}

async function updateIndex(slug, entry, op) {
  const store = getStore(STORE);
  const index = (await store.get(INDEX_KEY(slug), { type: 'json', consistency: 'strong' }))
              ?? { entries: [] };
  const existingIdx = index.entries.findIndex(e => e.id === entry.id);

  if (op === 'remove') {
    if (existingIdx >= 0) index.entries.splice(existingIdx, 1);
  } else {
    const indexEntry = {
      id:           entry.id,
      matchNr:      entry.matchNr,
      date:         entry.date,
      spielklasse:  entry.spielklasse,
      roleCount:    Object.keys(entry.roles || {}).length,
    };
    if (existingIdx >= 0) index.entries[existingIdx] = indexEntry;
    else index.entries.push(indexEntry);
  }
  index.updatedAt = new Date().toISOString();
  await store.setJSON(INDEX_KEY(slug), index);
}
