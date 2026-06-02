// lib/manualEntries.mjs
//
// Self-Service-Einträge eines Schiris für Turniere, die der Auto-Scraper
// nicht erfasst (Bundesliga ohne unsere App, Vereins-Cups, ältere DC-Jahre).
// Pro Schiri: ein Index in `club/manualEntries/<refId>/index.json` plus
// ein Volldatensatz pro Eintrag in `club/manualEntries/<refId>/<entryId>.json`.
//
// Konsistenz-Pattern analog zu lib/externalAssignments.mjs und
// lib/referees.mjs: jede Mutation schreibt den Volldatensatz und den Index
// strong-consistent. Lese-Operationen gehen über den Index, NICHT über
// `store.list({prefix})` — letzteres ist auf Netlify Blobs eventually
// consistent und liefert nach einem frischen `setJSON` für mehrere Sekunden
// bis Minuten den alten Bestand (N1-Bug aus Test-Runde 2).
//
// Bootstrap: Wenn ein Schiri zum ersten Mal eine `listManualEntries`-Anfrage
// hat und noch kein Index existiert, wird einmalig über `store.list()` der
// vorhandene Blob-Bestand gelesen und der Index neu aufgebaut.
//
// HINWEIS zum Bootstrap-Race: `store.list()` ist eventually consistent.
// Wenn der allererste Listing-Aufruf eines Schiris exakt im Moment passiert,
// in dem auch ein POST/PUT auf einem anderen Worker frische Blobs schreibt,
// kann der neueste Blob fehlen. In der Praxis irrelevant, weil:
//   (1) Mutationen über diesen Helper schreiben den Index sofort selbst —
//       Bootstrap wird nur EINMAL pro Schiri benötigt.
//   (2) Wenn der erste Bootstrap einen Eintrag verpasst, taucht der spätestens
//       beim nächsten Mutate-Pfad wieder im Index auf (Index-Schreibung
//       überschreibt den bestehenden Eintrag mit der frischen ID-Liste).
// Trotzdem hier vermerkt für die nächste Iteration, falls jemand strict
// behavior braucht.

import { getStore } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';

const STORE = 'club';
const ENTRY_KEY = (refId, id) => `manualEntries/${refId}/${id}.json`;
const INDEX_KEY = (refId)     => `manualEntries/${refId}/index.json`;

/**
 * Liefert die kompakten Index-Einträge (id + Felder für Filter) eines Schiris.
 * Im Index-Format: { id, tournamentDate, role, spielklasse, tournamentName }.
 * Wenn noch kein Index existiert → Bootstrap aus vorhandenen Volldatensätzen.
 */
export async function listManualEntriesIndex(refereeId) {
  const store = getStore(STORE);
  let idx = await store.get(INDEX_KEY(refereeId), { type: 'json', consistency: 'strong' });
  if (!idx?.entries) {
    // Migration: alten Bestand einmalig in einen Index überführen.
    idx = { entries: await bootstrapIndex(refereeId), updatedAt: new Date().toISOString() };
    await store.setJSON(INDEX_KEY(refereeId), idx);
  }
  return idx.entries;
}

/**
 * Liefert alle Volldatensätze des Schiris (gefiltert optional nach Jahr).
 * Sortierung absteigend nach Datum.
 */
export async function listManualEntries(refereeId, { year } = {}) {
  const store = getStore(STORE);
  const indexEntries = await listManualEntriesIndex(refereeId);
  const fulls = await Promise.all(
    indexEntries.map(e => store.get(ENTRY_KEY(refereeId, e.id), { type: 'json', consistency: 'strong' }))
  );
  let entries = fulls.filter(Boolean);
  if (year != null) {
    entries = entries.filter(e => Number((e.tournamentDate || '').slice(0, 4)) === year);
  }
  return entries.sort((a, b) => (b.tournamentDate || '').localeCompare(a.tournamentDate || ''));
}

/**
 * Einzelnen Eintrag laden — für update/delete-Vorabprüfung.
 */
export async function getManualEntry(refereeId, entryId) {
  const store = getStore(STORE);
  return await store.get(ENTRY_KEY(refereeId, entryId), { type: 'json', consistency: 'strong' });
}

/**
 * Neuen Eintrag anlegen. `data` muss vom Caller validiert sein (Schema +
 * `role`-Whitelist + spielklasse). Helper kümmert sich nur um Persistenz
 * + Index-Sync.
 */
export async function createManualEntry(refereeId, data) {
  const store = getStore(STORE);
  const id = randomUUID();
  const entry = {
    id,
    refereeId,
    ...data,
    createdAt: new Date().toISOString(),
    createdBy: 'self',
  };
  await store.setJSON(ENTRY_KEY(refereeId, id), entry);
  await updateIndex(refereeId, entry, 'add');
  return entry;
}

/**
 * Partial-Update. Existing wird strong-konsistent gelesen, gemerged,
 * geschrieben, Index aktualisiert. Liefert den merged-Entry zurück oder
 * null, wenn der Eintrag nicht existiert.
 */
export async function updateManualEntry(refereeId, entryId, patch) {
  const store = getStore(STORE);
  const existing = await store.get(ENTRY_KEY(refereeId, entryId), { type: 'json', consistency: 'strong' });
  if (!existing) return null;
  const merged = {
    ...existing,
    ...patch,
    id: entryId,                              // ID nie überschreiben
    refereeId: existing.refereeId,            // Owner nie überschreiben
    updatedAt: new Date().toISOString(),
  };
  await store.setJSON(ENTRY_KEY(refereeId, entryId), merged);
  await updateIndex(refereeId, merged, 'add');
  return merged;
}

/**
 * Eintrag löschen. Volldatensatz + Index-Eintrag werden entfernt.
 */
export async function deleteManualEntry(refereeId, entryId) {
  const store = getStore(STORE);
  const existing = await store.get(ENTRY_KEY(refereeId, entryId), { type: 'json' });
  if (!existing) return false;
  await store.delete(ENTRY_KEY(refereeId, entryId));
  await updateIndex(refereeId, { id: entryId }, 'remove');
  return true;
}

// ─── Internals ───────────────────────────────────────────────────────────────

async function bootstrapIndex(refereeId) {
  const store = getStore(STORE);
  const list = await store.list({ prefix: `manualEntries/${refereeId}/` });
  const blobs = (list?.blobs || []).filter(b => !b.key.endsWith('/index.json'));
  const fulls = await Promise.all(
    blobs.map(b => store.get(b.key, { type: 'json', consistency: 'strong' }))
  );
  return fulls.filter(Boolean).map(toIndexEntry);
}

/**
 * Pure-Function-Variante. Exportiert für Tests in
 * scripts/testManualEntriesIndex.mjs. Volldatensatz bleibt im Einzel-Blob,
 * der Index hält nur die für Filter/Sortierung nötigen Felder.
 */
export function toIndexEntry(entry) {
  return {
    id:             entry.id,
    tournamentDate: entry.tournamentDate || null,
    role:           entry.role || null,
    spielklasse:    entry.spielklasse || null,
    tournamentName: entry.tournamentName || null,
  };
}

/**
 * Pure-Function-Variante des Index-Merge: nimmt einen aktuellen Index +
 * Operation + Eintrag und liefert den neuen Index. Exportiert für Tests.
 *   op = 'add' | 'remove'
 */
export function mergeIndex(currentIndex, entry, op) {
  const entries = Array.isArray(currentIndex?.entries) ? [...currentIndex.entries] : [];
  const found = entries.findIndex(e => e.id === entry.id);
  if (op === 'remove') {
    if (found >= 0) entries.splice(found, 1);
  } else {
    const indexEntry = toIndexEntry(entry);
    if (found >= 0) entries[found] = indexEntry;
    else entries.push(indexEntry);
  }
  return { entries, updatedAt: new Date().toISOString() };
}

async function updateIndex(refereeId, entry, op) {
  const store = getStore(STORE);
  const current = (await store.get(INDEX_KEY(refereeId), { type: 'json', consistency: 'strong' }))
                ?? { entries: [] };
  const next = mergeIndex(current, entry, op);
  await store.setJSON(INDEX_KEY(refereeId), next);
}
