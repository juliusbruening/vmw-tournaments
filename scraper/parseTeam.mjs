// scraper/parseTeam.mjs
// Parser für https://cpt.kayakers.nl/Team?id=<TOURN>&tid=<TEAM>
//
// kayakers nutzt diese HTML-Signale (verifiziert gegen echtes HTML):
//
// Roster-Tabelle:
//   <table id="playersList">
//     <thead><tr>
//       <th colspan="2">Mannschafts-Mitglieder</th>   <- Header colspan!
//       <th>T</th><th>R-Icon</th><th>Y-Icon</th><th>G-Icon</th>
//     </tr></thead>
//     <tbody><tr>
//       <td>1</td><td><span data-content="Name">Name</span></td>
//       <td>0</td><td>0</td><td>0</td><td>0</td>    <- T, R, Y, G
//     </tr></tbody>
//   </table>
//
// Gruppentabelle (DE/EN sprachabhängig):
//   #  | Mannschaft/Team | P | +/- | T+/GF | T-/GA | Gespielt/Played | Gewonnen/Won | Verloren/Lost | Unentschieden/Draw

import * as cheerio from 'cheerio';

function cleanText(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}
function num(s) {
  const n = Number(cleanText(s).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function extractRosterRow($, cells) {
  const nr = Number(cleanText($(cells[0]).text()));
  if (!Number.isFinite(nr) || nr === 0) return null;
  // Name aus data-content-Span oder direkt aus Cell-Text
  const $name = $(cells[1]).find('span[data-content]').first();
  const name = $name.length
    ? cleanText($name.attr('data-content') || $name.text())
    : (cleanText($(cells[1]).text()) || null);
  const goals  = num($(cells[2]).text());
  const red    = cells.length > 3 ? num($(cells[3]).text()) : 0;
  const yellow = cells.length > 4 ? num($(cells[4]).text()) : 0;
  const green  = cells.length > 5 ? num($(cells[5]).text()) : 0;
  return { nr, name: name || null, goals, red, yellow, green };
}

export function parseTeam(html, { teamCode, teamName }) {
  const $ = cheerio.load(html);
  let roster = [];
  let groupTable = [];

  $('table').each((_, table) => {
    const $t = $(table);

    // ─── Roster: über id="playersList" (kayakers-Standard) ───────────
    if (roster.length === 0 && $t.attr('id') === 'playersList') {
      for (const row of $t.find('tbody tr').toArray()) {
        const cells = $(row).find('th, td').toArray();
        if (cells.length < 4) continue;
        const item = extractRosterRow($, cells);
        if (item) roster.push(item);
      }
      return;
    }

    // ─── Gruppentabelle: erkannt über Header-Stichwörter (DE+EN) ─────
    if (groupTable.length === 0) {
      const headerText = cleanText($t.find('tr').first().text()).toLowerCase();
      const hasGespielt = headerText.includes('gespielt') || headerText.includes('played');
      const hasTeam     = headerText.includes('mannschaft') || headerText.includes('team');
      if (hasGespielt && hasTeam) {
        for (const row of $t.find('tbody tr').toArray()) {
          const cells = $(row).find('th, td').toArray();
          if (cells.length < 10) continue;
          const rank = Number(cleanText($(cells[0]).text()));
          const name = cleanText($(cells[1]).text());
          if (!name) continue;
          groupTable.push({
            rank,
            team:   name,
            P:      num($(cells[2]).text()),
            GD:     num($(cells[3]).text()),
            GF:     num($(cells[4]).text()),
            GA:     num($(cells[5]).text()),
            played: num($(cells[6]).text()),
            W:      num($(cells[7]).text()),
            L:      num($(cells[8]).text()),
            D:      num($(cells[9]).text()),
            vmw:    /VMW Berlin/i.test(name),
          });
        }
      }
    }
  });

  // ─── Fallback: Roster über generische Tabellen-Heuristik ──────────
  // (falls kayakers irgendwann die ID umbenennt)
  if (roster.length === 0) {
    $('table').each((_, table) => {
      const $t = $(table);
      if ($t.attr('id') === 'playersList') return;
      const headerText = cleanText($t.find('tr').first().text()).toLowerCase();
      if (headerText.includes('gespielt') || headerText.includes('played')) return;
      if (headerText.includes('ergebnis') || headerText.includes('result')) return;
      if (headerText.includes('zeit') && headerText.includes('feld')) return;

      const candidates = [];
      for (const row of $t.find('tr').toArray()) {
        const cells = $(row).find('th, td').toArray();
        if (cells.length < 4 || cells.length > 8) continue;
        const item = extractRosterRow($, cells);
        if (item) candidates.push(item);
      }
      if (candidates.length >= 3 && roster.length === 0) {
        roster = candidates;
      }
    });
  }

  return { code: teamCode, name: teamName, roster, groupTable };
}
