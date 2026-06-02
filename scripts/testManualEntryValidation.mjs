// scripts/testManualEntryValidation.mjs
//
// N1 R3 — Regression-Test für validateManualEntry. Sicherheits-Netz gegen
// die Wiederkehr von „1111-01-01"-Eingaben, plus Format/Schema-Checks.
//
// validateManualEntry akzeptiert einen optionalen `now`-Parameter für
// deterministisches Testen (sonst hängt der Range vom Wall-Clock-Year ab).

import { validateManualEntry } from '../netlify/functions/me.mjs';

let pass = 0, fail = 0;
function expect(label, ok, details = '') {
  if (ok) { console.log('✓ ' + label); pass++; }
  else    { console.log('✗ ' + label + (details ? ': ' + details : '')); fail++; }
}

// FIXED_NOW = 2. Juni 2026 → thisYear=2026, max=2027
const FIXED_NOW = new Date('2026-06-02T10:00:00Z').getTime();

const base = {
  tournamentName: 'Pokal Cottbus',
  tournamentDate: '2026-04-12',
  role: 'ref1',
};

// ── Happy Path ───────────────────────────────────────────────────────────
expect('Valider Eintrag → null',
  validateManualEntry(base, FIXED_NOW) === null);

expect('Mit spielklasse=herren → null',
  validateManualEntry({ ...base, spielklasse: 'herren' }, FIXED_NOW) === null);

expect('Mit spielklasse=null (Legacy) → null',
  validateManualEntry({ ...base, spielklasse: null }, FIXED_NOW) === null);

// ── Pflichtfelder ────────────────────────────────────────────────────────
expect('body=null → Fehler',
  validateManualEntry(null, FIXED_NOW) === 'body required');

expect('Ohne tournamentName → Fehler',
  validateManualEntry({ ...base, tournamentName: '' }, FIXED_NOW)?.includes('tournamentName'));

expect('Ohne tournamentDate → Fehler',
  validateManualEntry({ ...base, tournamentDate: '' }, FIXED_NOW)?.includes('YYYY-MM-DD'));

expect('Falsches Format → Fehler',
  validateManualEntry({ ...base, tournamentDate: '12.04.2026' }, FIXED_NOW)?.includes('YYYY-MM-DD'));

expect('Ohne role → Fehler',
  validateManualEntry({ ...base, role: '' }, FIXED_NOW)?.includes('role'));

expect('Unbekannte role → Fehler',
  validateManualEntry({ ...base, role: 'fake-role' }, FIXED_NOW)?.includes('role'));

expect('Unbekannte spielklasse → Fehler',
  validateManualEntry({ ...base, spielklasse: 'profi' }, FIXED_NOW)?.includes('spielklasse'));

// ── N1 R3 — Range-Check ──────────────────────────────────────────────────
expect('Datum 1111-01-01 → Fehler (Akut-Bug)',
  validateManualEntry({ ...base, tournamentDate: '1111-01-01' }, FIXED_NOW)?.includes('zwischen 2000'));

expect('Datum 1999-12-31 → Fehler (Untergrenze)',
  validateManualEntry({ ...base, tournamentDate: '1999-12-31' }, FIXED_NOW)?.includes('zwischen 2000'));

expect('Datum 2000-01-01 → OK (Grenze inklusiv)',
  validateManualEntry({ ...base, tournamentDate: '2000-01-01' }, FIXED_NOW) === null);

expect('Datum 2025-06-15 → OK (Vorjahr)',
  validateManualEntry({ ...base, tournamentDate: '2025-06-15' }, FIXED_NOW) === null);

expect('Datum 2027-12-31 → OK (max-Grenze inklusiv)',
  validateManualEntry({ ...base, tournamentDate: '2027-12-31' }, FIXED_NOW) === null);

expect('Datum 2028-01-01 → Fehler (Obergrenze überschritten)',
  validateManualEntry({ ...base, tournamentDate: '2028-01-01' }, FIXED_NOW)?.includes('zwischen 2000'));

expect('Datum 9999-12-31 → Fehler (defensiv)',
  validateManualEntry({ ...base, tournamentDate: '9999-12-31' }, FIXED_NOW)?.includes('zwischen 2000'));

// Range bewegt sich mit `now` mit
const FUTURE = new Date('2027-06-02T10:00:00Z').getTime();
expect('2028-12-31 ist OK wenn now=2027 (thisYear+1=2028)',
  validateManualEntry({ ...base, tournamentDate: '2028-12-31' }, FUTURE) === null);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass, ${fail} fail`);
process.exitCode = fail === 0 ? 0 : 1;
