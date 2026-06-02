// scripts/testManualEntriesIndex.mjs
//
// N1 — Index-Pattern für manualEntries. Testet die Pure-Functions
// (toIndexEntry, mergeIndex), die als Wurzel des Bugfixes dienen.
//
// Strong-Consistency-Garantien des @netlify/blobs-Stores werden hier nicht
// gemockt — die Logik dahinter ist Pure: wenn `mergeIndex` korrekt arbeitet,
// und `setJSON`+`get` mit `consistency:'strong'` aufgerufen werden, ist der
// End-to-End-Garantievertrag erfüllt. Diese Tests fokussieren auf die
// Pure-Function-Schicht.

import { toIndexEntry, mergeIndex } from '../lib/manualEntries.mjs';

let pass = 0, fail = 0;
function expect(label, ok, details = '') {
  if (ok) { console.log('✓ ' + label); pass++; }
  else    { console.log('✗ ' + label + (details ? ': ' + details : '')); fail++; }
}

// ── toIndexEntry: Pflichtfelder, optionale Felder ─────────────────────────
const fullEntry = {
  id: 'abc-123',
  refereeId: 'ref-1',
  tournamentName: 'Pokal Cottbus 2026',
  tournamentDate: '2026-04-12',
  matchNr: '42',
  matchLabel: 'Halbfinale',
  role: 'ref1',
  spielklasse: 'herren',
  notes: 'Aushilfe',
  createdAt: '2026-04-13T08:00:00Z',
  createdBy: 'self',
};
const indexed = toIndexEntry(fullEntry);
expect('toIndexEntry behält id', indexed.id === 'abc-123');
expect('toIndexEntry behält Datum', indexed.tournamentDate === '2026-04-12');
expect('toIndexEntry behält role', indexed.role === 'ref1');
expect('toIndexEntry behält spielklasse', indexed.spielklasse === 'herren');
expect('toIndexEntry behält tournamentName', indexed.tournamentName === 'Pokal Cottbus 2026');
expect('toIndexEntry verwirft notes (nicht für Filter nötig)', !('notes' in indexed));
expect('toIndexEntry verwirft matchNr', !('matchNr' in indexed));
expect('toIndexEntry verwirft createdAt', !('createdAt' in indexed));

// Legacy-Entry ohne spielklasse
const legacy = toIndexEntry({
  id: 'leg-1', tournamentDate: '2025-09-01', role: 'scorer', tournamentName: 'Alt-Turnier',
});
expect('toIndexEntry Legacy: spielklasse=null',  legacy.spielklasse === null);

// ── mergeIndex: add ──────────────────────────────────────────────────────
const empty = { entries: [] };
const afterAdd = mergeIndex(empty, fullEntry, 'add');
expect('mergeIndex add auf leeres Index → 1 Eintrag', afterAdd.entries.length === 1);
expect('mergeIndex add: indexed shape',
  afterAdd.entries[0].id === 'abc-123' &&
  afterAdd.entries[0].tournamentDate === '2026-04-12');
expect('mergeIndex add: updatedAt gesetzt',
  typeof afterAdd.updatedAt === 'string' && afterAdd.updatedAt.length > 10);

// ── mergeIndex: update (gleiche id → Ersetzen, kein Duplikat) ────────────
const updated = mergeIndex(afterAdd, { ...fullEntry, spielklasse: 'damen' }, 'add');
expect('mergeIndex update: gleicher Eintrag wird ersetzt, keine Duplikate',
  updated.entries.length === 1);
expect('mergeIndex update: Feld aktualisiert',
  updated.entries[0].spielklasse === 'damen');

// ── mergeIndex: add eines zweiten Eintrags ──────────────────────────────
const second = { id: 'def-456', tournamentName: 'X', tournamentDate: '2026-05-01', role: 'timer' };
const afterTwo = mergeIndex(updated, second, 'add');
expect('mergeIndex add zweiter Eintrag → 2',
  afterTwo.entries.length === 2);

// ── mergeIndex: remove ──────────────────────────────────────────────────
const afterRemove = mergeIndex(afterTwo, { id: 'abc-123' }, 'remove');
expect('mergeIndex remove → 1 Eintrag', afterRemove.entries.length === 1);
expect('mergeIndex remove behält den richtigen Eintrag',
  afterRemove.entries[0].id === 'def-456');

// ── mergeIndex: remove eines nicht-existenten Eintrags → no-op ─────────
const afterRemoveMissing = mergeIndex(afterRemove, { id: 'ghost' }, 'remove');
expect('mergeIndex remove unbekannter id → keine Änderung',
  afterRemoveMissing.entries.length === 1);

// ── mergeIndex: defensives Verhalten bei undefined-Input ─────────────────
const fromNull = mergeIndex(null, fullEntry, 'add');
expect('mergeIndex toleriert currentIndex=null',
  fromNull.entries.length === 1);
const fromMissingEntries = mergeIndex({ updatedAt: 'x' }, fullEntry, 'add');
expect('mergeIndex toleriert currentIndex ohne entries-Array',
  fromMissingEntries.entries.length === 1);

// ── Immutability: Original-Index wird nicht mutiert ─────────────────────
const orig = { entries: [{ id: 'a' }, { id: 'b' }] };
const _ = mergeIndex(orig, { id: 'c' }, 'add');
expect('mergeIndex mutiert das Original nicht (Immutability)',
  orig.entries.length === 2);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass, ${fail} fail`);
process.exitCode = fail === 0 ? 0 : 1;
