// scripts/testTidBasedMatching.mjs
//
// Regression-Test für den Bracket-Bug (Halbfinale/Finale wurden im alten Code
// fälschlich als VMW-Spiele markiert, weil das Namens-Matching auf Platzhalter-
// Teamnamen reagierte).
//
// Neue Logik (scraper/connectors/kayakers.mjs): Match zählt nur dann als
// ourTeam-Spiel, wenn die Team-TID in config.ourTeams[].tid enthalten ist.
// Platzhalter-Teams haben oft keine echte TID → werden automatisch ignoriert.
//
// HINWEIS: Verwendet eine synthetische Config statt eines spezifischen
// Turniers aus dem Blob-Store/Repo — der Test ist damit unabhängig davon,
// ob ein bestimmtes Turnier existiert.

import { buildSnapshot } from '../scraper/index.mjs';

let pass = 0, fail = 0;
function expect(label, ok) {
  if (ok) { console.log('✓ ' + label); pass++; }
  else    { console.log('✗ ' + label); fail++; }
}

// Synthetische Test-Config (keine Abhängigkeit zu getTournament)
const testConfig = {
  slug: 'test-tid-matching',
  name: 'Test-Turnier',
  connector: 'kayakers',
  dates: ['2026-05-23'],
  source: {
    matchListUrl: 'https://cpt.kayakers.nl/MatchList',
    matchListVid: 'test-vid',
    tournamentId: 'test-tournament-id',
  },
  ourTeams: [
    { code: 'U21', name: 'VMW Berlin U21', tid: 'ecc239cd-2306-41b9-a659-432e7ed1647a' },
  ],
};

// Synthetisches HTML mit 3 Matches:
//   1) Echtes VMW-Spiel — beide TIDs gültig, VMW Berlin U21 spielt → ourTeam=U21
//   2) Bracket-Platzhalter — Name "VMW Berlin U21" aber KEINE TID (kayakers vor Bracket-Match)
//      → muss ourTeam=null sein
//   3) Spiel ohne VMW-Beteiligung → ourTeam=null
const html = (matches) => `
<table><tbody>
  <tr><td colspan="9">07:30 May 23rd 07:30</td></tr>
  ${matches}
</tbody></table>`;

const realVmwMatch = `
<tr>
  <td><img src="/Images/x.png" title="Beendet"></td>
  <td>1</td><td>1</td><td>Men U21</td><td>A</td>
  <td><a href="/Team?id=X&tid=ecc239cd-2306-41b9-a659-432e7ed1647a">VMW Berlin U21</a> 5</td>
  <td>-</td>
  <td><a href="/Team?id=X&tid=bbb-2">KP Prag U21</a> 2</td>
  <td><a href="/Team?id=X&tid=ccc-1">Jury Foo</a></td>
</tr>`;

const bracketPlaceholderMatch = `
<tr>
  <td><img src="/Images/x.png" title="Nicht gespielt"></td>
  <td>2</td><td>2</td><td>Men U21</td><td>A</td>
  <td><a href="#">VMW Berlin U21</a></td>
  <td>-</td>
  <td><a href="#">Sieger Halbfinale</a></td>
  <td><a href="/Team?id=X&tid=ccc-2">Jury Bar</a></td>
</tr>`;

const otherMatch = `
<tr>
  <td><img src="/Images/x.png" title="Beendet"></td>
  <td>3</td><td>1</td><td>Men 2nd class</td><td>B</td>
  <td><a href="/Team?id=X&tid=zzz-1">1. MKC Duisburg</a> 3</td>
  <td>-</td>
  <td><a href="/Team?id=X&tid=zzz-2">UKS Set Kaniow</a> 1</td>
  <td><a href="/Team?id=X&tid=zzz-3">Jury Baz</a></td>
</tr>`;

const allHtml = html(realVmwMatch + bracketPlaceholderMatch + otherMatch);

// Mock-Fetcher: liefert für Day 1 unser Test-HTML, für die anderen Tage leeres HTML,
// für Team-URLs ein minimal-valides HTML (parseTeam soll nicht crashen).
async function mockFetcher(url) {
  if (url.includes('MatchList') && url.includes('day=1')) return allHtml;
  if (url.includes('MatchList')) return '<table></table>';
  if (url.includes('Team?id=')) return '<table></table><div class="scheduleSection"></div>';
  return '';
}

const snapshot = await buildSnapshot(testConfig, { fetcher: mockFetcher });

const m1 = snapshot.matches.find(m => m.nr === 1);
const m2 = snapshot.matches.find(m => m.nr === 2);
const m3 = snapshot.matches.find(m => m.nr === 3);

expect('Echtes VMW-Match #1 → ourTeam="U21"',                m1?.ourTeam === 'U21');
expect('Bracket-Platzhalter ohne TID #2 → ourTeam=null',     m2?.ourTeam === null);
expect('Match ohne VMW-Beteiligung #3 → ourTeam=null',       m3?.ourTeam === null);

// Schiri-Referee: Spiel #3 hat zwar einen Schiri ("Jury Baz") aber NICHT VMW
expect('M3 ourReferee=null (kein VMW als Schiri)',           m3?.ourReferee === null);

// Field-Rename-Check: referee statt jury
expect('snapshot.matches[].referee existiert (nicht jury)',  m1?.referee !== undefined);
expect('snapshot.matches[].jury existiert NICHT',            m1?.jury === undefined);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass, ${fail} fail`);
process.exitCode = fail === 0 ? 0 : 1;
