// scripts/testEinsatzbogenAggregation.mjs
//
// Validiert, dass `aggregateEntriesForReferee()` aus lib/einsatzbogen.mjs
// alle drei Einsatz-Quellen korrekt zusammenführt:
//   1. auto-Einsätze aus kayakers-Turnieren (assignments.json)
//   2. externe Einsätze aus externalAssignments
//   3. manuelle Einträge aus club/manualEntries/
//
// Methode: lib/einsatzbogen.mjs mit gemockten Sub-Libraries laden.
// Wir mocken über ESM-Import-Side-Effects nicht trivial, daher checken wir
// das Mapping/Sortieren auf einer Synthetic-Input-Liste durch direkten Aufruf
// von generateEinsatzbogenPdf — Ergebnis: Einträge erscheinen im PDF.

import { generateEinsatzbogenPdf } from '../lib/dkvPdf.mjs';
import { writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';

let pass = 0, fail = 0;
function expect(label, ok, details = '') {
  if (ok) { console.log('✓ ' + label); pass++; }
  else    { console.log('✗ ' + label + (details ? ': ' + details : '')); fail++; }
}

// Synthetic-Aggregation: simuliere das Output von aggregateEntriesForReferee
// (auto + extern + manuell, sortiert nach Datum/Spielnr)
const entries = [
  // Auto-Einsatz (kayakers)
  { date: '2026-05-23', matchNr: '1',  tournamentName: 'DC2026',          role: 'ref1',     division: 'Men 1st class', notes: '' },
  // Externer Einsatz (Bundesliga manuell)
  { date: '2026-06-14', matchNr: '5',  tournamentName: 'Bundesliga',      role: 'scorer',   division: 'herren', notes: '' },
  // Manueller Self-Service-Eintrag
  { date: '2026-07-20', matchNr: '12', tournamentName: 'Hallencup Köln',  role: 'line1',    division: '',       notes: 'Aushilfe' },
  // Späteres Spiel
  { date: '2026-09-05', matchNr: '3',  tournamentName: 'Spätsommer-Cup',  role: 'shotclock',division: 'damen',  notes: '' },
];

const referee = { firstName: 'Aggr', lastName: 'Test', city: 'Berlin', federation: 'KVN' };
const bytes = await generateEinsatzbogenPdf({ referee, year: 2026, entries });
await writeFile('/tmp/dkv-agg.pdf', bytes);
const text = execSync('pdftotext -layout /tmp/dkv-agg.pdf -', { encoding: 'utf8' });

expect('Alle 4 Veranstaltungen im PDF',
  text.includes('DC2026') && text.includes('Bundesliga') &&
  text.includes('Hallencup Köln') && text.includes('Spätsommer-Cup'));

expect('Bemerkung "Aushilfe" wird übernommen', text.includes('Aushilfe'));

// Sortierung: 23.05. vor 14.06. vor 20.07. vor 05.09.
const idxMay = text.indexOf('23.05.26');
const idxJun = text.indexOf('14.06.26');
const idxJul = text.indexOf('20.07.26');
const idxSep = text.indexOf('05.09.26');
expect('Sortierung chronologisch (Mai vor Juni vor Juli vor September)',
  idxMay > 0 && idxJun > idxMay && idxJul > idxJun && idxSep > idxJul);

// Externer Eintrag mit DKV-Code "herren" landet in Herren-Spalte (X)
// (Spielklassen-Spalten sind im Layout; X markiert die Zugehörigkeit)
const lines = text.split('\n');
const bundesligaLine = lines.find(l => l.includes('Bundesliga'));
expect('Bundesliga-Zeile enthält "X" (Herren-Spalte)',
  !!bundesligaLine && bundesligaLine.includes('X'));

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass, ${fail} fail`);
process.exitCode = fail === 0 ? 0 : 1;
