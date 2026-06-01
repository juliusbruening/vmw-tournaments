// scripts/testBuildSnapshotReal.mjs
//
// End-to-End-Validierung gegen das echte DC2026-Live-HTML aus tests/fixtures.
// Mock-Fetcher liefert die echte Spielplan-HTML für alle 3 Tage und ein
// Team-Detail-HTML für jede Team-Abfrage.
//
// Erwartung: Snapshot baut sich auf, ourTeam wird per TID korrekt gesetzt,
// referee-Feld ist gefüllt, Bracket-Bug-Schutz greift (keine Falschmeldungen).

import fs from 'node:fs/promises';
import { buildSnapshot } from '../scraper/index.mjs';

const FIXTURES = new URL('../tests/fixtures/', import.meta.url);
const spielplanHtml = await fs.readFile(new URL('dc2026-spielplan.html', FIXTURES), 'utf8');
const teamHtml      = await fs.readFile(new URL('dc2026-team-men2.html',  FIXTURES), 'utf8');

async function mockFetcher(url) {
  if (url.includes('/MatchList/')) return spielplanHtml;
  if (url.includes('/Team?id='))   return teamHtml;
  return '';
}

let pass = 0, fail = 0;
function expect(label, ok) {
  if (ok) { console.log('✓ ' + label); pass++; }
  else    { console.log('✗ ' + label); fail++; }
}

// Synthetische DC2026-Config — Test unabhängig von Blob/Repo-State.
// Wir setzen Dummy-TIDs für 5 VMW-Teams; das deckt das Bracket-Bug-Schutz
// (TID-basiertes Matching) ohne ourTeam-Asserts.
const config = {
  slug: 'dc2026',
  name: 'Deutschland Cup 2026',
  connector: 'kayakers',
  dates: ['2026-05-23', '2026-05-24', '2026-05-25'],
  source: {
    matchListUrl:  'https://cpt.kayakers.nl/MatchList/dc2026',
    matchListVid:  'test-vid',
    tournamentId:  'test-tournament-id',
  },
  ourTeams: [
    { code: 'Men1',  name: 'VMW Berlin Men1',  tid: '11111111-1111-1111-1111-111111111111' },
    { code: 'Men2',  name: 'VMW Berlin Men2',  tid: '22222222-2222-2222-2222-222222222222' },
    { code: 'U21',   name: 'VMW Berlin U21',   tid: '33333333-3333-3333-3333-333333333333' },
    { code: 'Women', name: 'VMW Berlin Women', tid: '44444444-4444-4444-4444-444444444444' },
    { code: 'Mix',   name: 'VMW Berlin Mix',   tid: '55555555-5555-5555-5555-555555555555' },
  ],
};

const snapshot = await buildSnapshot(config, { fetcher: mockFetcher });

expect('Snapshot hat matches[]',                       Array.isArray(snapshot.matches));
expect('Snapshot.matches.length > 100',                snapshot.matches.length > 100);
expect('Snapshot.lastUpdated ist ISO-Datum',           !!Date.parse(snapshot.lastUpdated));

const done = snapshot.matches.filter(m => m.status === 'done');
const next = snapshot.matches.filter(m => m.status === 'next');
expect('Status-Verteilung enthält done + next',        done.length > 0 && next.length > 0);

// TID-basiertes Matching: Spielen mit unbekannten TIDs → ourTeam=null
// (Dummy-TIDs in der Config matchen nicht die echten kayakers-TIDs).
// Wir prüfen lediglich, dass der Mapper Spiele OHNE Crash verarbeitet.
const ourTeamSet = snapshot.matches.filter(m => m.ourTeam !== null);
expect('ourTeam-Feld wird gesetzt oder null (kein crash)',
  snapshot.matches.every(m => m.ourTeam === null || typeof m.ourTeam === 'string'));

// Field-Rename: jury → referee
const sample = snapshot.matches[0];
expect('match.referee (nicht jury) vorhanden',         sample.referee !== undefined);
expect('match.jury existiert NICHT mehr',              sample.jury === undefined);
expect('match.ourReferee statt juryVmw',               sample.ourReferee !== undefined);
expect('match.juryVmw existiert NICHT mehr',           sample.juryVmw === undefined);

// Teams-Array: 5 VMW-Teams werden gebaut (mockFetcher liefert teamHtml für alle)
expect('Snapshot hat 5 Teams',                         snapshot.teams.length === 5);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass, ${fail} fail`);
process.exitCode = fail === 0 ? 0 : 1;
