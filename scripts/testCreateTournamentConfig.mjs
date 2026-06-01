// scripts/testCreateTournamentConfig.mjs
//
// Regression-Test für die Tournament-Config-Whitelist in admin.mjs.
// Fängt den Bug aus BUGFIX_EXTERNES_TURNIER#A: das `external`-Objekt wurde
// nicht durchgereicht, sodass externe Turniere ohne Ressourcen-Liste
// gespeichert wurden.

import { buildCreateTournamentConfig } from '../netlify/functions/admin.mjs';

let pass = 0, fail = 0;
function expect(label, ok, details = '') {
  if (ok) { console.log('✓ ' + label); pass++; }
  else    { console.log('✗ ' + label + (details ? ': ' + details : '')); fail++; }
}

const FIXED_NOW = '2026-06-01T10:00:00.000Z';

// ── Default-Fall: 'tournament' ohne external ─────────────────────────────
const basic = buildCreateTournamentConfig({
  slug: 'test-tournament',
  name: 'Test Cup',
  status: 'draft',
}, FIXED_NOW);

expect('basic: slug übernommen', basic.slug === 'test-tournament');
expect('basic: type defaultet auf tournament', basic.type === 'tournament');
expect('basic: status übernommen', basic.status === 'draft');
expect('basic: external ist null (nicht-extern)', basic.external === null);
expect('basic: timezone Europe/Berlin', basic.timezone === 'Europe/Berlin');
expect('basic: createdAt = FIXED_NOW', basic.createdAt === FIXED_NOW);

// ── Kern-Regression: type='external' mit Ressourcen ──────────────────────
const ext = buildCreateTournamentConfig({
  slug: 'bundesliga-1',
  name: 'Bundesliga Spieltag 1',
  type: 'external',
  status: 'active',
  dates: ['2026-06-06', '2026-06-07'],
  external: {
    resources: [
      { title: 'Spielplan PDF', url: 'https://example.org/plan.pdf' },
      { title: 'Bundesliga-Tabelle', url: 'https://kanupolio.de/standings' },
    ],
  },
}, FIXED_NOW);

expect('external: type übernommen', ext.type === 'external');
expect('external: external-Objekt nicht null (Regression-Schutz!)',
  ext.external !== null,
  'external war null — Whitelist-Bug ist zurück');
expect('external: resources-Array mit 2 Einträgen',
  Array.isArray(ext.external?.resources) && ext.external.resources.length === 2,
  `actual: ${JSON.stringify(ext.external)}`);
expect('external: resources behalten title + url',
  ext.external?.resources?.[0]?.title === 'Spielplan PDF' &&
  ext.external?.resources?.[0]?.url === 'https://example.org/plan.pdf',
  `actual: ${JSON.stringify(ext.external?.resources?.[0])}`);
expect('external: dates übernommen',
  ext.dates?.length === 2 && ext.dates[0] === '2026-06-06');

// ── Defensive: external als nicht-Objekt → null statt Crash ──────────────
const externalString = buildCreateTournamentConfig({
  slug: 'ext-bad', name: 'X', type: 'external', external: 'not-an-object',
}, FIXED_NOW);
expect('external als String → null (defensiv)', externalString.external === null);

const externalNullResources = buildCreateTournamentConfig({
  slug: 'ext-null', name: 'X', type: 'external', external: { resources: null },
}, FIXED_NOW);
expect('external.resources=null → leeres Array',
  Array.isArray(externalNullResources.external?.resources) &&
  externalNullResources.external.resources.length === 0);

// ── Legacy-Felder bleiben durchgereicht (für alte Configs) ───────────────
const legacy = buildCreateTournamentConfig({
  slug: 'legacy', name: 'Legacy', type: 'external',
  externalUrl: 'https://old.example.com',
  externalDays: [{ date: '2025-01-01', label: 'Tag 1' }],
}, FIXED_NOW);
expect('legacy: externalUrl behalten', legacy.externalUrl === 'https://old.example.com');
expect('legacy: externalDays Array', Array.isArray(legacy.externalDays) && legacy.externalDays.length === 1);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass, ${fail} fail`);
process.exitCode = fail === 0 ? 0 : 1;
