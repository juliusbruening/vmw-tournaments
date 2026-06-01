// scripts/testRoleMapping.mjs
//
// Validiert das 7→5-Rollen-Mapping (intern → DKV-Funktion) das in dkvPdf.mjs
// statt einer Lookup-Tabelle steckt. Test fängt Regression wenn jemand das
// Mapping ändert oder Rollen-Codes umbenennt.

import { generateEinsatzbogenPdf } from '../lib/dkvPdf.mjs';
import { writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';

let pass = 0, fail = 0;
function expect(label, ok, details = '') {
  if (ok) { console.log('✓ ' + label); pass++; }
  else    { console.log('✗ ' + label + (details ? ': ' + details : '')); fail++; }
}

const MAPPINGS = [
  // [internalRole, dkvFunction]
  ['ref1',      '1.SR'],
  ['ref2',      '2.SR'],
  ['scorer',    'Protokoll'],
  ['timer',     'Zeitn.'],
  ['shotclock', 'Zeitn.'],
  ['line1',     'Linien'],
  ['line2',     'Linien'],
];

const referee = { firstName: 'Test', city: 'Berlin' };
const entries = MAPPINGS.map(([role], i) => ({
  date: `2026-05-${String(i + 1).padStart(2, '0')}`,
  matchNr: String(100 + i),
  tournamentName: `Cup ${role}`,
  role,
  division: '',
  notes: '',
}));

const bytes = await generateEinsatzbogenPdf({ referee, year: 2026, entries });
await writeFile('/tmp/dkv-role-mapping.pdf', bytes);
const text = execSync('pdftotext -layout /tmp/dkv-role-mapping.pdf -', { encoding: 'utf8' });

// Jede DKV-Funktion muss min. 1x im PDF stehen
const uniqueDkvFns = [...new Set(MAPPINGS.map(m => m[1]))];
for (const fn of uniqueDkvFns) {
  expect(`DKV-Funktion "${fn}" im PDF`, text.includes(fn));
}

// Zeitn. muss min. 2x stehen (timer + shotclock)
const zeitnCount = (text.match(/Zeitn\./g) || []).length;
expect('Zeitn. erscheint ≥ 2× (timer + shotclock)', zeitnCount >= 2,
  `actual: ${zeitnCount}`);

// Linien muss min. 2x stehen (line1 + line2)
const linienCount = (text.match(/Linien/g) || []).length;
expect('Linien erscheint ≥ 2× (line1 + line2)', linienCount >= 2,
  `actual: ${linienCount}`);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass, ${fail} fail`);
process.exitCode = fail === 0 ? 0 : 1;
