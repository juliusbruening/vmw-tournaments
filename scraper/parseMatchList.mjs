// scraper/parseMatchList.mjs
// Parser für https://cpt.kayakers.nl/MatchList/DC2026?day=N
// Server-rendered HTML. Tabellenzeilen mit fester Spalten-Reihenfolge:
// Status | # | Pitch | Division | Group | Team A | Score | Team B | Jury
// Zwischen den Match-Zeilen gibt es Zeit-Header-Zeilen ("HH:MM May 23rd HH:MM").

import * as cheerio from 'cheerio';

const TID_RX = /tid=([a-f0-9-]+)/i;

function extractTid(href = '') {
  const m = href.match(TID_RX);
  return m ? m[1] : null;
}

function parseTimeFromHeaderText(text) {
  // Zeit-Header-Zeilen sehen aus wie: "07:30 May 23rd 07:30"
  const m = /(\d{1,2}:\d{2})/.exec(text || '');
  return m ? m[1].padStart(5, '0') : null;
}

function cleanText(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} html - Roher HTML-Quelltext der MatchList-Seite
 * @param {number} day  - Tagesnummer (1, 2, 3)
 * @returns {Array<Match>}
 */
export function parseMatchList(html, day) {
  const $ = cheerio.load(html);
  const matches = [];
  let currentTime = null;

  // Wir suchen einfach alle <tr> im Dokument und filtern selbst.
  $('tr').each((_, tr) => {
    const $tr = $(tr);
    const cells = $tr.find('td').toArray();

    // Zeit-Header-Zeilen haben üblicherweise sehr wenige Zellen + enthalten ein Zeitformat.
    const rowText = cleanText($tr.text());
    if (cells.length < 8) {
      const t = parseTimeFromHeaderText(rowText);
      if (t) currentTime = t;
      return;
    }

    // Match-Zeile: erwartete Spalten ab 0..8
    // [0] Status (img), [1] #, [2] Pitch, [3] Division, [4] Group,
    // [5] Team A (a), [6] Score, [7] Team B (a), [8] Jury (a oder "-")
    const $statusCell = $(cells[0]);
    const statusImg = $statusCell.find('img').first();
    const matchNrTxt = cleanText($(cells[1]).text());
    const pitchTxt   = cleanText($(cells[2]).text());
    const divisionRaw = cleanText($(cells[3]).text());
    const groupTxt   = cleanText($(cells[4]).text());

    const $cellA = $(cells[5]);
    const $cellB = $(cells[7]);
    const teamA_a = $cellA.find('a').first();
    const teamB_a = $cellB.find('a').first();
    const referee_a  = $(cells[8]).find('a').first();

    const teamA = cleanText(teamA_a.text() || $cellA.text());
    const teamB = cleanText(teamB_a.text() || $cellB.text());
    const referee  = cleanText(referee_a.text()  || $(cells[8]).text());

    if (!teamA || !teamB) return; // wahrscheinlich keine Match-Zeile

    const matchNr = Number(matchNrTxt.replace(/\D+/g, ''));
    if (!Number.isFinite(matchNr) || matchNr === 0) return;

    // ─── SCORE ───────────────────────────────────────────────
    // kayakers rendert den Spielstand auf der MatchList-Seite je nach Layout-Variante
    // in unterschiedlichen Zellen:
    //
    //   Variante A (älter / Team-Detailseiten-Renderer):
    //     cells[6] enthält <span data-goalsa="4">…</span> - <span data-goalsb="2">…</span>
    //
    //   Variante B (aktuelles MatchList-Markup, beobachtet im echten Live-HTML):
    //     cells[5] = "<a>Team A</a> 4"      ← Score nach dem Team-Link, gleiche Zelle
    //     cells[6] = "-"                    ← nur Trenner
    //     cells[7] = "<a>Team B</a> 2"
    //
    // Wir suchen defensiv in mehreren Quellen, von der zuverlässigsten zur
    // weichesten Heuristik. Wichtig: numerische 0 ist gültig.
    let scoreA = null, scoreB = null;

    // 1) data-goalsa/-b irgendwo in der Zeile (deckt Variante A & Renderer-Mischformen ab)
    const goalsA = $tr.find('[data-goalsa]').attr('data-goalsa');
    const goalsB = $tr.find('[data-goalsb]').attr('data-goalsb');
    if (goalsA != null && /^\d+$/.test(goalsA)) scoreA = Number(goalsA);
    if (goalsB != null && /^\d+$/.test(goalsB)) scoreB = Number(goalsB);

    // 2) Score nach dem Team-Link in der jeweiligen Team-Zelle (Variante B)
    if (scoreA == null) scoreA = scoreFromTeamCell($cellA, teamA_a);
    if (scoreB == null) scoreB = scoreFromTeamCell($cellB, teamB_a);

    // 3) Klartext-Fallback: "4 - 2" in der Score-Zelle (oder in der ganzen Zeile)
    if (scoreA == null || scoreB == null) {
      const $scoreCell = $(cells[6]);
      const scoreCellText = cleanText($scoreCell.text());
      const ms = scoreCellText.match(/(\d+)\s*[-–]\s*(\d+)/);
      if (ms) {
        if (scoreA == null) scoreA = Number(ms[1]);
        if (scoreB == null) scoreB = Number(ms[2]);
      }
    }

    // ─── STATUS ──────────────────────────────────────────────
    // kayakers serviert den `title=`-Text in der Browser-Sprache der HTTP-Anfrage
    // (Accept-Language). Hier laufen wir aus Deutschland → bekommen oft Deutsch.
    // Deshalb müssen wir multilingual matchen UND zusätzlich data-status/img-src
    // als sprach-unabhängige Fallbacks nutzen.
    let status = detectMatchStatus($, $statusCell, statusImg);

    // Sicherheitsnetz: Wenn ein numerischer Spielstand vorliegt, ist das Spiel
    // mindestens beendet (Score wird vom Backend erst nach Schiri-Eintrag publiziert).
    // Verhindert, dass beendete Spiele durch fehlerhafte Status-Erkennung in "next" hängenbleiben.
    if (status === 'next' && scoreA != null && scoreB != null) {
      status = 'done';
    }

    // Division kompakt: doppelte Wiederholungen vom Markdown-Konverter sind im echten HTML kein Problem,
    // aber sicherheitshalber:
    const division = compactDivision(divisionRaw);

    // Division-Code (intern)
    const divisionCode = inferDivisionCode(division);

    matches.push({
      day,
      nr: matchNr,
      time: currentTime || null,
      pitch: Number(pitchTxt) || pitchTxt,
      division,
      divisionCode,
      group: groupTxt || null,
      teamA: {
        name: teamA,
        tid: extractTid(teamA_a.attr('href') || ''),
      },
      teamB: {
        name: teamB,
        tid: extractTid(teamB_a.attr('href') || ''),
      },
      score: { a: scoreA, b: scoreB },
      status,
      referee: referee
        ? { name: referee, tid: extractTid(referee_a.attr('href') || '') }
        : null,
    });
  });

  return matches;
}

function compactDivision(s = '') {
  // "Men 1st class Men 1st class Men 1st class" → "Men 1st class"
  // "Free Free Free" → "Free"
  // (kommt vor wenn der HTML-Renderer responsive-spans zusammenfasst)
  const t = s.trim();
  if (!t) return t;

  // Bekannte Divisions bevorzugt (deutsche + englische)
  for (const candidate of [
    'Pupils U14', 'Youth U16', 'Men U21', 'Women',
    'Men 1st class', 'Men 2nd class',
    'Damen', 'Herren', 'Junioren', 'Jugend', 'Schüler',
  ]) {
    if (t.startsWith(candidate)) return candidate;
  }

  // Generell: erkenne 2-3fach wiederholte Wortgruppen (1-3 Wörter Länge)
  // "Foo Foo Foo" → "Foo"; "Free Cup Free Cup" → "Free Cup"
  for (const groupSize of [1, 2, 3, 4]) {
    const words = t.split(/\s+/);
    if (words.length < groupSize * 2) continue;
    const first = words.slice(0, groupSize).join(' ');
    const repeats = Math.floor(words.length / groupSize);
    let allMatch = true;
    for (let i = 1; i < repeats; i++) {
      const slice = words.slice(i * groupSize, (i + 1) * groupSize).join(' ');
      if (slice !== first) { allMatch = false; break; }
    }
    if (allMatch && repeats >= 2) return first;
  }

  return t.split(/\s{2,}|\t/)[0] || t;
}

/**
 * Sprach-unabhängige Status-Erkennung.
 *
 * Zwei kombinierte Signale, vom verlässlichsten zum unsichersten:
 *
 *  1. title-Attribut des <img> (multilingual matching).
 *     Im echten DC2026-HTML aktuell Deutsch: "Beendet" / "Nicht gespielt" /
 *     "Abgesagt". Andere Server-Lokalisierungen oder zukünftige Änderungen
 *     decken wir per Regex mit EN/DE/NL/PL ab.
 *
 *  2. data-status-Attribut auf <div class="matchStatusIcon">.
 *     Reale Werte (Mai 2026, gegen Live-HTML verifiziert):
 *         0   → scheduled / nicht gespielt
 *         10  → in progress (Annahme nach Mustererkennung)
 *         100 → played / beendet
 *         1000 → cancelled / abgesagt
 *     Die alte Annahme im Code (0/1/2) war falsch — daher viele "beendet"-
 *     Spiele bisher fälschlich als "next" gelandet sind.
 *
 * Reihenfolge: erst Title, weil er expliziter ist. data-status nur als
 * Sprach-unabhängiger Fallback, falls Title fehlt.
 */
function detectMatchStatus($, $statusCell, statusImg) {
  // 1) data-status — präziseste numerische Quelle, falls vorhanden
  const dataStatusEl = $statusCell.find('[data-status]').first();
  const dataStatus = dataStatusEl.length ? dataStatusEl.attr('data-status') : null;

  // 2) title (multilingual). Reihenfolge wichtig: "not played" / "nicht gespielt"
  // muss VOR "played" / "gespielt" greifen, weil sonst der Substring fälschlich
  // als "gespielt" matched.
  const title = (statusImg.attr('title') || '').toLowerCase();

  const isCancelled =
    /cancelled|canceled|abgesagt|entfallen|abgebrochen|afgelast|odwo[łl]any/.test(title);
  const isNotPlayed =
    /not played|not yet played|scheduled|nicht gespielt|noch nicht gespielt|niet gespeeld|nie zagrane|nie rozegrane/.test(title);
  const isInProgress =
    /in progress|playing|currently|wird gerade gespielt|wird gespielt|läuft|laufend|live|loopt|bezig|w toku|trwa/.test(title);
  const isPlayed =
    /(?:^|[^a-zäöü])(played|finished|completed|ended|gespielt|beendet|gespeeld|afgelopen|zagrane|rozegrane|zako[ńn]czon[ey])\b/.test(title) && !isNotPlayed;

  // Abgesagte Spiele behandeln wir wie "beendet" — sie sollen nicht in der
  // "Kommende Spiele"-Liste auftauchen. (Das Frontend hat aktuell keine
  // eigene Cancelled-Anzeige; lieber raus aus next als unsichtbar hängen.)
  if (isCancelled)  return 'done';
  if (isInProgress) return 'live';
  if (isPlayed)     return 'done';
  if (isNotPlayed)  return 'next';

  // 3) data-status als sprach-unabhängiger Fallback (echtes Schema 0/10/100/1000)
  if (dataStatus === '1000') return 'done';   // cancelled → done
  if (dataStatus === '100')  return 'done';   // beendet
  if (dataStatus === '10')   return 'live';   // läuft (vermutet)
  if (dataStatus === '1')    return 'live';   // legacy
  if (dataStatus === '2')    return 'done';   // legacy
  if (dataStatus === '0')    return 'next';

  // Standard: noch nicht gespielt
  return 'next';
}

/**
 * Liest den Spielstand aus einer Team-Zelle, in der die Punktzahl als reiner
 * Text NACH dem Team-Link steht. Beispiel:
 *   <td><a href="...">VMW Berlin Men2</a> 4</td>
 *
 * Wir bauen aus den Text-Nodes der Zelle (ohne Anchor-Inhalt) zusammen und
 * suchen die erste ganze Zahl. Robust gegenüber zusätzlichem Whitespace und
 * Trenner-Strings wie "&nbsp;".
 */
function scoreFromTeamCell($cell, teamLink) {
  if (!$cell || $cell.length === 0) return null;
  const cellText = cleanText($cell.text());
  const linkText = teamLink && teamLink.length ? cleanText(teamLink.text()) : '';
  let rest = cellText;
  if (linkText) {
    // Erst exakten Substring entfernen (häufigster Fall), sonst case-insensitive ersetzen
    const idx = rest.indexOf(linkText);
    if (idx >= 0) {
      rest = (rest.slice(0, idx) + rest.slice(idx + linkText.length)).trim();
    } else {
      try {
        const safe = linkText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        rest = rest.replace(new RegExp(safe, 'i'), '').trim();
      } catch { /* nichts */ }
    }
  }
  const m = rest.match(/(?:^|\s)(\d+)(?:\s|$)/);
  return m ? Number(m[1]) : null;
}

function inferDivisionCode(division = '') {
  const d = division.toLowerCase();
  if (d.includes('u14') || d.includes('pupils')) return 'U14';
  if (d.includes('u16') || d.includes('youth'))  return 'U16';
  if (d.includes('u21'))                          return 'U21';
  if (d.includes('women'))                        return 'Women';
  if (d.includes('1st class'))                    return 'Men1';
  if (d.includes('2nd class'))                    return 'Men2';
  return null;
}
