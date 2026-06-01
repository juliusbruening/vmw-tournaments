// scripts/testParseMatchList.mjs
// Validiert parseMatchList gegen zwei Markup-Varianten:
//
//   Variante A (älterer / Team-Detail-Renderer): Score in cells[6] als data-goalsa/-b,
//       Titles auf Deutsch ("Nicht gespielt", "Wird gespielt", "Gespielt").
//
//   Variante B (aktuelles MatchList-Live-HTML, kayakers.nl, Mai 2026):
//       Titles auf Englisch ("Not played", "In progress", "Finished", "Cancelled"),
//       Score steht NACH dem Team-Link in den Team-Zellen (cells[5] / cells[7]),
//       cells[6] enthält nur den Trenner "-".
//
// Vor dem Fix vom 23.5.2026: Variante B landete komplett auf status='next' und
// score={a:null,b:null}, weil der Parser nur Variante A kannte.

import { parseMatchList } from '../scraper/parseMatchList.mjs';

const HEAD = `
<table>
  <thead>
    <tr><th></th><th>#</th><th>P</th><th>Div</th><th>G</th>
        <th>A</th><th>-</th><th>B</th><th>Jury</th></tr>
  </thead>
  <tbody>
    <!-- Zeit-Header -->
    <tr><td colspan="9"><strong>07:30</strong> May 23rd <strong>07:30</strong></td></tr>
`;
const TAIL = `</tbody></table>`;

function matchRow({ nr, pitch, division, group, teamA, teamB, jury, statusTitle, dataStatus, goalsA, goalsB }) {
  const scoreCell = (goalsA !== '' || goalsB !== '')
    ? `<span data-goalsa="${goalsA}">${goalsA || '...'}</span><span> - </span><span data-goalsb="${goalsB}">${goalsB || '...'}</span>`
    : `<span data-goalsa=""></span><span> - </span><span data-goalsb=""></span>`;
  return `
    <tr>
      <td><div class="matchStatusIcon" data-status="${dataStatus}"><img src="/Images/MatchStatus3.png" title="${statusTitle}"></div></td>
      <td>${nr}</td>
      <td>${pitch}</td>
      <td>${division}</td>
      <td>${group}</td>
      <td><a href="/Team?id=X&tid=t-${nr}A">${teamA}</a></td>
      <td class="text-center">${scoreCell}</td>
      <td><a href="/Team?id=X&tid=t-${nr}B">${teamB}</a></td>
      <td><a href="/Team?id=X&tid=t-jury-${nr}">${jury}</a></td>
    </tr>`;
}

const html = HEAD
  + matchRow({ nr: 101, pitch: 1, division: 'Men 2nd class', group: 'A',
               teamA: 'VMW Berlin Men2', teamB: 'KSV Glauchau Men2', jury: 'PSC Coburg Men2',
               statusTitle: 'Nicht gespielt', dataStatus: '0', goalsA: '', goalsB: '' })
  + matchRow({ nr: 102, pitch: 2, division: 'Women', group: 'B',
               teamA: 'VMW Berlin Women', teamB: 'FOA Liverpool Women', jury: 'KRM Essen Women',
               statusTitle: 'Wird gespielt', dataStatus: '1', goalsA: '3', goalsB: '2' })
  + matchRow({ nr: 103, pitch: 3, division: 'Youth U16', group: 'A',
               teamA: 'VMW Berlin U16', teamB: 'KP Prag U16', jury: 'VMW Berlin Men2',
               statusTitle: 'Gespielt', dataStatus: '2', goalsA: '8', goalsB: '6' })
  // Edge case: kein title, kein data-status, aber Score vorhanden → muss als 'done' erkannt werden (Safety net)
  + matchRow({ nr: 104, pitch: 4, division: 'Pupils U14', group: 'A',
               teamA: 'VMW Berlin U14', teamB: 'KK Neptun U14', jury: '-',
               statusTitle: '', dataStatus: '', goalsA: '5', goalsB: '5' })
  + TAIL;

const matches = parseMatchList(html, 1);

function expect(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '✓' : '✗'} ${label}  →  ${JSON.stringify(actual)}  (expected ${JSON.stringify(expected)})`);
  if (!ok) process.exitCode = 1;
}

console.log(`Parser hat ${matches.length} Matches gefunden (erwartet 4)\n`);

// Match 101 — Nicht gespielt
const m1 = matches.find(m => m.nr === 101);
expect('M101 status',  m1?.status,  'next');
expect('M101 scoreA',  m1?.score?.a, null);
expect('M101 scoreB',  m1?.score?.b, null);

// Match 102 — Wird gespielt (live)
const m2 = matches.find(m => m.nr === 102);
expect('M102 status',  m2?.status,  'live');
expect('M102 scoreA',  m2?.score?.a, 3);
expect('M102 scoreB',  m2?.score?.b, 2);

// Match 103 — Gespielt (done)
const m3 = matches.find(m => m.nr === 103);
expect('M103 status',  m3?.status,  'done');
expect('M103 scoreA',  m3?.score?.a, 8);
expect('M103 scoreB',  m3?.score?.b, 6);

// Match 104 — Safety net: Score vorhanden + Status leer → done
const m4 = matches.find(m => m.nr === 104);
expect('M104 status (safety-net)', m4?.status, 'done');
expect('M104 scoreA', m4?.score?.a, 5);
expect('M104 scoreB', m4?.score?.b, 5);

// ──────────────────────────────────────────────────────────────────────
// Variante B — echtes Live-Markup von cpt.kayakers.nl/MatchList/DC2026
// ──────────────────────────────────────────────────────────────────────
// Englische Titles, Score steht in der Team-Zelle direkt hinter dem Team-Link,
// cells[6] enthält nur "-". KEIN data-goalsa/-b irgendwo in der Zeile.

function liveMatchRow({ nr, pitch, division, group, teamA, teamB, jury, statusTitle, scoreA, scoreB }) {
  const aCellInner = scoreA === '' || scoreA == null
    ? `<a href="/Team?id=X&tid=t-${nr}A">${teamA}</a>`
    : `<a href="/Team?id=X&tid=t-${nr}A">${teamA}</a> ${scoreA}`;
  const bCellInner = scoreB === '' || scoreB == null
    ? `<a href="/Team?id=X&tid=t-${nr}B">${teamB}</a>`
    : `<a href="/Team?id=X&tid=t-${nr}B">${teamB}</a> ${scoreB}`;
  return `
    <tr>
      <td><img src="/Images/MatchStatusX.png" title="${statusTitle}"></td>
      <td>${nr}</td>
      <td>${pitch}</td>
      <td>${division}</td>
      <td>${group}</td>
      <td>${aCellInner}</td>
      <td>-</td>
      <td>${bCellInner}</td>
      <td><a href="/Team?id=X&tid=t-jury-${nr}">${jury}</a></td>
    </tr>`;
}

const liveHtml = HEAD
  // 201 — Not played (kommend)
  + liveMatchRow({ nr: 201, pitch: 1, division: 'Men 2nd class', group: 'A',
                   teamA: 'VMW Berlin Men2', teamB: 'KSV Glauchau Men2', jury: 'PSC Coburg Men2',
                   statusTitle: 'Not played', scoreA: '', scoreB: '' })
  // 202 — In progress
  + liveMatchRow({ nr: 202, pitch: 2, division: 'Women', group: 'B',
                   teamA: 'VMW Berlin Women', teamB: 'FOA Liverpool Women', jury: 'KRM Essen Women',
                   statusTitle: 'In progress', scoreA: 3, scoreB: 2 })
  // 203 — Finished
  + liveMatchRow({ nr: 203, pitch: 3, division: 'Youth U16', group: 'A',
                   teamA: 'VMW Berlin U16', teamB: 'KP Prag U16', jury: 'VMW Berlin Men2',
                   statusTitle: 'Finished', scoreA: 4, scoreB: 2 })
  // 204 — 0:0 Finished (numerische Null darf NICHT zu null kollabieren)
  + liveMatchRow({ nr: 204, pitch: 4, division: 'Pupils U14', group: 'A',
                   teamA: 'VMW Berlin U14', teamB: 'KK Neptun U14', jury: '-',
                   statusTitle: 'Finished', scoreA: 0, scoreB: 0 })
  // 205 — Cancelled → wird auf 'done' gemappt
  + liveMatchRow({ nr: 205, pitch: 5, division: 'Men U21', group: 'A',
                   teamA: 'VMW Berlin U21', teamB: 'KP Prag U21', jury: 'KRM Essen Women',
                   statusTitle: 'Cancelled', scoreA: '', scoreB: '' })
  + TAIL;

console.log('\n── Variante B (echtes Live-Markup, englische Titles) ─────────────────');
const liveMatches = parseMatchList(liveHtml, 1);
console.log(`Parser hat ${liveMatches.length} Matches gefunden (erwartet 5)\n`);

const m201 = liveMatches.find(m => m.nr === 201);
expect('M201 (Not played) status', m201?.status, 'next');
expect('M201 scoreA', m201?.score?.a, null);
expect('M201 scoreB', m201?.score?.b, null);

const m202 = liveMatches.find(m => m.nr === 202);
expect('M202 (In progress) status', m202?.status, 'live');
expect('M202 scoreA', m202?.score?.a, 3);
expect('M202 scoreB', m202?.score?.b, 2);

const m203 = liveMatches.find(m => m.nr === 203);
expect('M203 (Finished) status', m203?.status, 'done');
expect('M203 scoreA', m203?.score?.a, 4);
expect('M203 scoreB', m203?.score?.b, 2);

const m204 = liveMatches.find(m => m.nr === 204);
expect('M204 (Finished 0:0) status', m204?.status, 'done');
expect('M204 scoreA (numerische 0)', m204?.score?.a, 0);
expect('M204 scoreB (numerische 0)', m204?.score?.b, 0);

const m205 = liveMatches.find(m => m.nr === 205);
expect('M205 (Cancelled → done) status', m205?.status, 'done');

if (process.exitCode) {
  console.log('\n❌ Tests fehlgeschlagen');
} else {
  console.log('\n✅ Alle Status- und Score-Tests bestanden (Variante A + B)');
}
