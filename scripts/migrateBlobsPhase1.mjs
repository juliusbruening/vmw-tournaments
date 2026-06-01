// scripts/migrateBlobsPhase1.mjs
//
// Einmalige Migration: alten Store "dc2026" → neuen Store "tournaments"
// mit Pfaden "dc2026/snapshot.json" und "dc2026/refereeAssignments.json".
//
// Voraussetzung: Netlify CLI installiert + verbunden, oder als Function
// im selben Netlify-Site-Kontext ausgeführt.
//
// Ausführung:
//   netlify dev    # (in einem Terminal, damit Blob-Zugriff geht)
//   node scripts/migrateBlobsPhase1.mjs
//
// Nach der Migration NICHT den alten Store löschen — er bleibt als Backup,
// bis der erste Live-Cron-Lauf erfolgreich war.

import { getStore } from '@netlify/blobs';

const SLUG = 'dc2026';

console.log(`[migrate] starting Phase-1 migration for slug="${SLUG}"`);

const oldStore = getStore('dc2026');
const newStore = getStore('tournaments');

// 1) Snapshot
const snapshot = await oldStore.get('snapshot.json', { type: 'json' });
if (snapshot) {
  await newStore.setJSON(`${SLUG}/snapshot.json`, snapshot);
  console.log(`[migrate] snapshot.json kopiert (${snapshot.matches?.length ?? 0} matches)`);
} else {
  console.warn(`[migrate] kein snapshot.json im alten Store — überspringe`);
}

// 2) Referee-Assignments (Phase-1-Format bleibt das alte players[]-Schema)
const refs = await oldStore.get('refereeAssignments.json', { type: 'json' });
if (refs) {
  await newStore.setJSON(`${SLUG}/refereeAssignments.json`, refs);
  console.log(`[migrate] refereeAssignments.json kopiert (${Object.keys(refs).length} Einträge)`);
} else {
  console.warn(`[migrate] keine refereeAssignments.json im alten Store — überspringe`);
}

// 3) Index initial anlegen — Phase 2/4 pflegt ihn dann via UI weiter
const indexEntry = {
  slug: SLUG,
  name: 'Deutschland Cup 2026',
  type: 'tournament',
  status: 'completed',
  dates: ['2026-05-23', '2026-05-24', '2026-05-25'],
};
const existingIndex = (await newStore.get('index.json', { type: 'json' })) ?? { tournaments: [] };
const idx = existingIndex.tournaments.findIndex(t => t.slug === SLUG);
if (idx >= 0) existingIndex.tournaments[idx] = indexEntry;
else existingIndex.tournaments.push(indexEntry);
existingIndex.updatedAt = new Date().toISOString();
await newStore.setJSON('index.json', existingIndex);
console.log(`[migrate] index.json aktualisiert (${existingIndex.tournaments.length} Tournaments insgesamt)`);

console.log('[migrate] ✅ Phase-1-Migration abgeschlossen.');
console.log('[migrate] Alter Store bleibt als Backup. Nach erfolgreichem Live-Test entfernen.');
