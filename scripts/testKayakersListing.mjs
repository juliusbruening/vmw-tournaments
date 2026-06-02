// scripts/testKayakersListing.mjs
//
// N4 — Regression-Test gegen die echte kayakers.nl-Listing-Seite.
// Fixture: tests/fixtures/kayakers-listing.html (Stand 2. Juni 2026).
//
// Fängt zukünftige DOM-Drifts, die im Live-Betrieb zu „kein Datum"-Bug führten
// (alte Implementation suchte via prev('h4'); echte Struktur hat data-country
// + eventItem-id-Suffix + span.dates als Geschwister-Spalten).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseListingHtml } from '../scraper/connectors/kayakers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(
  path.join(__dirname, '..', 'tests', 'fixtures', 'kayakers-listing.html'),
  'utf8',
);

let pass = 0, fail = 0;
function expect(label, ok, details = '') {
  if (ok) { console.log('✓ ' + label); pass++; }
  else    { console.log('✗ ' + label + (details ? ': ' + details : '')); fail++; }
}

const all = parseListingHtml(fixture);
expect('Mindestens 20 Tournaments gefunden',
  all.length >= 20,
  `got ${all.length}`);

const withDate = all.filter(t => t.dateIso);
expect(`mindestens 90% mit dateIso (${withDate.length}/${all.length})`,
  withDate.length / Math.max(1, all.length) >= 0.9);

const withCountry = all.filter(t => t.countryCode);
expect(`mindestens 90% mit countryCode (${withCountry.length}/${all.length})`,
  withCountry.length / Math.max(1, all.length) >= 0.9);

// dateIso-Format: YYYY-MM-DD
expect('dateIso hat YYYY-MM-DD-Format',
  all.every(t => !t.dateIso || /^\d{4}-\d{2}-\d{2}$/.test(t.dateIso)),
  'mindestens ein Eintrag hat falsches Format');

// Country-Filter funktioniert
const deOnly = parseListingHtml(fixture, { country: 'DE' });
expect('country=DE filtert', deOnly.every(t => t.countryCode === 'DE'));
expect('country=DE liefert >0 Treffer', deOnly.length > 0, `got ${deOnly.length}`);

// Sortierung: aufsteigend nach dateIso (Einträge ohne Datum ans Ende)
const sortedAsc = withDate.every((t, i, arr) =>
  i === 0 || arr[i - 1].dateIso <= t.dateIso);
expect('Sortierung aufsteigend nach dateIso', sortedAsc);

// dateRange-Anzeigetext darf nicht leer sein wenn dateIso da ist
const withRangeAndIso = all.filter(t => t.dateIso && t.dateRange);
expect(`dateRange + dateIso korrelieren (${withRangeAndIso.length}/${withDate.length})`,
  withRangeAndIso.length / Math.max(1, withDate.length) >= 0.9);

// Slugs sind unique
const slugs = all.map(t => t.slug);
expect('Slugs sind eindeutig',
  new Set(slugs).size === slugs.length,
  `${slugs.length - new Set(slugs).size} Duplikate`);

// Jeder Eintrag hat eine viewUrl mit /View/
expect('viewUrl enthält /View/',
  all.every(t => t.viewUrl?.includes('/View/')));

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass, ${fail} fail`);
process.exitCode = fail === 0 ? 0 : 1;
