// scripts/testDkvPdfFields.mjs
//
// Validiert, dass die Schiri-Stammdaten aus den RICHTIGEN Schema-Feldern
// gelesen werden:
//   - federation (NICHT verband) — siehe lib/referees.mjs SELF_FIELDS
//   - licenseNr  (NICHT ausweisNr)
//
// Regression-Test für den Bug "DKV Bogen zeigt RKN für Verband statt 'Test'".
//
// Methode: PDF generieren, Text extrahieren mit pdfplumber-CLI-Fallback (oder
// pdf-parse falls verfügbar). Hier nutzen wir pdftotext aus poppler-utils
// — ist auf Netlify-Build-Box und auf Macs via Homebrew verfügbar.

import { writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { generateEinsatzbogenPdf } from '../lib/dkvPdf.mjs';

let pass = 0, fail = 0;
function expect(label, ok, details = '') {
  if (ok) { console.log('✓ ' + label); pass++; }
  else    { console.log('✗ ' + label + (details ? ': ' + details : '')); fail++; }
}

// Test 1: federation-Feld wird übernommen
const ref1 = {
  firstName: 'Test', lastName: 'User',
  level: 'B',
  street: 'Teststraße 1',
  zip: '12345', city: 'Berlin',
  phone: '0123',
  club: 'VMW Berlin',
  federation: 'Test-Verband-FED',        // ← echtes Feld
  licenseNr: 'AUSWEIS-FED-123',          // ← echtes Feld
};
const bytes1 = await generateEinsatzbogenPdf({ referee: ref1, year: 2026, entries: [] });
await writeFile('/tmp/dkv-test-fed.pdf', bytes1);
const text1 = execSync('pdftotext -layout /tmp/dkv-test-fed.pdf -', { encoding: 'utf8' });
expect('PDF enthält "Test-Verband-FED" aus federation-Feld',
  text1.includes('Test-Verband-FED'),
  `Output snippet: ${text1.slice(0, 200)}`);
expect('PDF enthält "AUSWEIS-FED-123" aus licenseNr-Feld',
  text1.includes('AUSWEIS-FED-123'));

// Test 2: Fallback auf legacy 'verband' und 'ausweisNr'-Felder
const ref2 = {
  firstName: 'Legacy', lastName: 'User',
  level: 'A',
  city: 'Berlin',
  club: 'VMW Berlin',
  verband: 'Legacy-Verband',             // ← altes Feld
  ausweisNr: 'LEGACY-AUSWEIS',           // ← altes Feld
};
const bytes2 = await generateEinsatzbogenPdf({ referee: ref2, year: 2026, entries: [] });
await writeFile('/tmp/dkv-test-legacy.pdf', bytes2);
const text2 = execSync('pdftotext -layout /tmp/dkv-test-legacy.pdf -', { encoding: 'utf8' });
expect('Legacy-Verband-Fallback funktioniert',  text2.includes('Legacy-Verband'));
expect('Legacy-Ausweis-Fallback funktioniert',  text2.includes('LEGACY-AUSWEIS'));

// Test 3: Kein Default-Wert wenn beides leer (vorher: "KVN" / "RKN")
const ref3 = {
  firstName: 'Empty', lastName: 'User',
  level: 'C',
  city: 'Berlin',
  club: 'VMW Berlin',
  // Kein federation, kein verband
};
const bytes3 = await generateEinsatzbogenPdf({ referee: ref3, year: 2026, entries: [] });
await writeFile('/tmp/dkv-test-empty.pdf', bytes3);
const text3 = execSync('pdftotext -layout /tmp/dkv-test-empty.pdf -', { encoding: 'utf8' });
expect('Kein "KVN"-Default wenn federation leer',  !text3.includes('KVN'));
expect('Kein "RKN"-Default wenn federation leer',  !text3.includes('RKN'));

// Test 4: Einsätze landen mit Rollen-Mapping in der Tabelle
const refWithEntries = {
  firstName: 'Mit', lastName: 'Einsatz',
  level: 'B', city: 'Berlin', club: 'VMW',
};
const entries = [
  { date: '2026-05-23', matchNr: '42', tournamentName: 'Test-Cup', role: 'ref1',     division: 'herren', notes: '' },
  { date: '2026-05-23', matchNr: '43', tournamentName: 'Test-Cup', role: 'ref2',     division: 'herren', notes: '' },
  { date: '2026-05-24', matchNr: '50', tournamentName: 'Test-Cup', role: 'shotclock', division: 'damen',  notes: '' },
  { date: '2026-05-24', matchNr: '51', tournamentName: 'Test-Cup', role: 'line2',    division: 'jugend', notes: '' },
];
const bytes4 = await generateEinsatzbogenPdf({ referee: refWithEntries, year: 2026, entries });
await writeFile('/tmp/dkv-test-roles.pdf', bytes4);
const text4 = execSync('pdftotext -layout /tmp/dkv-test-roles.pdf -', { encoding: 'utf8' });
expect('Spiel-Nr. 42 im PDF',         text4.includes('42'));
expect('1.SR-Mapping aus ref1',       text4.includes('1.SR'));
expect('2.SR-Mapping aus ref2',       text4.includes('2.SR'));
// shotclock → Zeitn., line2 → Linien (siehe ROLE_TO_DKV in dkvPdf.mjs)
expect('Zeitn.-Mapping aus shotclock', text4.includes('Zeitn.'));
expect('Linien-Mapping aus line2',     text4.includes('Linien'));
expect('Test-Cup als Veranstaltung',   text4.includes('Test-Cup'));

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass, ${fail} fail`);
process.exitCode = fail === 0 ? 0 : 1;
