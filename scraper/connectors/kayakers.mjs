// scraper/connectors/kayakers.mjs
//
// Kapselt die heutige DC2026-Scrape-Logik hinter dem Connector-Interface.
// Drei-Pfad-Discovery (Pfad A/B/C, siehe KONZEPT_MULTI_TURNIER.md):
//   A) MatchList liefert Matches  → full discovery, hasSchedule=true
//   B) MatchList leer, /View/ oder /Tournament/ lesbar → reduced discovery
//   C) Nichts greifbar             → throw Error mit hint='manual'

import * as cheerio from 'cheerio';
import { fetchHtml } from '../fetch.mjs';
import { parseMatchList } from '../parseMatchList.mjs';
import { parseTeam } from '../parseTeam.mjs';

const BASE_ORIGIN = 'https://cpt.kayakers.nl';

export const kayakersConnector = {
  id: 'kayakers',

  matchesUrl(url) {
    try { return new URL(url).hostname.endsWith('kayakers.nl'); }
    catch { return false; }
  },

  /**
   * Liefert die Tournament-Liste von kayakers.nl-Homepage für den Admin-Picker.
   * Cache-freundlich (Function-Caller kann die Response selbst cachen).
   */
  async listAvailableTournaments({ country = null } = {}) {
    const html = await fetchHtml(`${BASE_ORIGIN}/`);
    return parseListingHtml(html, { country });
  },

  /**
   * Drei-Pfad-Discovery. Akzeptiert beliebige kayakers-URL.
   */
  async discover(url, { fetcher = fetchHtml } = {}) {
    const u = new URL(url);
    const slug = u.pathname.split('/').filter(Boolean).pop();
    const baseOrigin = u.origin;

    const viewUrl = `${baseOrigin}/View/${slug}`;
    const tournamentInfoUrl = `${baseOrigin}/Tournament/${slug}`;
    let matchListUrl = `${baseOrigin}/MatchList/${slug}`;
    let vid = null;

    // 1) View-Page probieren — enthält oft MatchList-Links mit vid
    const viewHtml = await fetcher(viewUrl).catch(() => null);
    if (viewHtml) {
      const $ = cheerio.load(viewHtml);
      $('a[href*="/MatchList/"]').each((_, a) => {
        const href = $(a).attr('href') || '';
        const vidMatch = href.match(/[?&]vid=([a-f0-9-]+)/i);
        if (vidMatch && !vid) vid = vidMatch[1];
      });
    }

    // 2) MatchList probieren (mit vid falls verfügbar)
    const probeUrl = vid
      ? `${matchListUrl}?day=1&vid=${vid}`
      : `${matchListUrl}?day=1`;
    const day1Html = await fetcher(probeUrl).catch(() => null);
    if (day1Html) {
      const day1Matches = parseMatchList(day1Html, 1);
      if (day1Matches.length > 0) {
        return await this._fullDiscovery({
          matchListUrl, vid, viewUrl, tournamentInfoUrl, slug, baseOrigin, day1Html, fetcher,
        });
      }
    }

    // 3) Reduced Discovery aus der View-Page
    if (viewHtml) {
      return this._reducedDiscovery({ viewUrl, matchListUrl, vid, tournamentInfoUrl, slug, infoHtml: viewHtml });
    }

    // 4) Fallback Tournament-Info-Page (älteres URL-Pattern)
    const infoHtml = await fetcher(tournamentInfoUrl).catch(() => null);
    if (infoHtml) {
      return this._reducedDiscovery({ viewUrl: null, matchListUrl, vid: null, tournamentInfoUrl, slug, infoHtml });
    }

    // 5) Pfad C — gar nichts da
    const err = new Error('Konnte weder Spielplan noch Info-Seite lesen.');
    err.hint = 'manual';
    err.suggestedSource = { viewUrl, tournamentInfoUrl, matchListUrl };
    throw err;
  },

  async _fullDiscovery({ matchListUrl, vid, viewUrl, tournamentInfoUrl, slug, baseOrigin, day1Html, fetcher }) {
    // Tournament-ID + Name aus dem ersten Team-Link / <title>
    const tidMatch = day1Html.match(/\/Team\?id=([a-f0-9-]{36})/i);
    const tournamentId = tidMatch ? tidMatch[1] : null;
    const titleMatch = day1Html.match(/<title>([^<]+)<\/title>/i);
    const suggestedName = titleMatch ? titleMatch[1].trim().replace(/\s+- (Match list|kayakers\.nl).*$/i, '').trim() : slug;

    // Alle Tage durchgehen — die Date-Header in der Page geben das Datum her
    const proposedDates = [];
    const seenDates = new Set();
    const allTeams = new Map();
    let lastFirstMatchNr = null;
    for (let day = 1; day <= 14; day++) {
      const url = vid ? `${matchListUrl}?day=${day}&vid=${vid}` : `${matchListUrl}?day=${day}`;
      const html = day === 1 ? day1Html : await fetcher(url).catch(() => null);
      if (!html) break;
      const matches = parseMatchList(html, day);
      if (!matches.length) break;
      // Wenn kayakers für ungültige Tage einfach Tag 1 zurückgibt: abbrechen sobald
      // die erste Match-Nr identisch zur vorherigen ist.
      const firstNr = matches[0]?.nr ?? null;
      if (day > 1 && firstNr === lastFirstMatchNr) break;
      lastFirstMatchNr = firstNr;
      const date = parseFirstDateFromHtml(html);
      if (date && !seenDates.has(date)) {
        proposedDates.push(date);
        seenDates.add(date);
      }
      for (const m of matches) {
        if (m.teamA?.tid && !allTeams.has(m.teamA.tid)) {
          allTeams.set(m.teamA.tid, { name: m.teamA.name, division: m.division });
        }
        if (m.teamB?.tid && !allTeams.has(m.teamB.tid)) {
          allTeams.set(m.teamB.tid, { name: m.teamB.name, division: m.division });
        }
      }
    }
    proposedDates.sort();

    return {
      hasSchedule: true,
      connectorId: 'kayakers',
      source: { viewUrl, tournamentInfoUrl, matchListUrl, matchListVid: vid, tournamentId },
      suggestedName,
      suggestedSlug: slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40),
      proposedDates,
      allTeams: [...allTeams.entries()].map(([tid, info]) => ({ tid, name: info.name, division: info.division })),
    };
  },

  _reducedDiscovery({ viewUrl, matchListUrl, vid, tournamentInfoUrl, slug, infoHtml }) {
    const titleMatch = infoHtml.match(/<title>([^<]+)<\/title>/i);
    const suggestedName = titleMatch
      ? titleMatch[1].trim().replace(/\s+- kayakers\.nl.*$/i, '').trim()
      : slug;
    // Datum-Hints aus der Info-Page — best effort
    const datesParsed = extractDateHintsFromHtml(infoHtml);

    return {
      hasSchedule: false,
      connectorId: 'kayakers',
      source: { viewUrl, tournamentInfoUrl, matchListUrl: null, matchListVid: vid, tournamentId: null },
      suggestedName,
      suggestedSlug: slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40),
      proposedDates: [],
      allTeams: [],
      hintFromInfoPage: { datesParsed, plannedMatchListUrl: matchListUrl },
    };
  },

  /**
   * Voll-Scrape: holt alle Spieltage + Team-Detailseiten der eigenen Teams,
   * reichert Matches mit ourTeam + ourReferee an (TID-basiert).
   */
  async scrape(config, { fetcher = fetchHtml } = {}) {
    const baseOrigin = new URL(config.source.matchListUrl).origin;
    const matchListUrl = config.source.matchListUrl;
    const vid = config.source.matchListVid;
    const tournamentId = config.source.tournamentId;

    const dayCount = Math.max(1, config.dates?.length ?? 0);
    const dayHtmlList = await Promise.all(
      Array.from({ length: dayCount }, (_, i) => {
        const day = i + 1;
        const url = vid ? `${matchListUrl}?day=${day}&vid=${vid}` : `${matchListUrl}?day=${day}`;
        return fetcher(url);
      })
    );
    const allMatchesRaw = dayHtmlList.flatMap((html, idx) => parseMatchList(html, idx + 1));

    const teamHtmlList = await Promise.all(
      (config.ourTeams || []).map(t => fetcher(`${baseOrigin}/Team?id=${tournamentId}&tid=${t.tid}`))
    );
    const teams = teamHtmlList.map((html, idx) => {
      const t = config.ourTeams[idx];
      const parsed = parseTeam(html, { teamCode: t.code, teamName: t.name });
      return { ...t, roster: parsed.roster, groupTable: parsed.groupTable };
    });

    const tidToCode = new Map((config.ourTeams || []).map(t => [t.tid, t.code]));
    const matches = allMatchesRaw.map(m => ({
      day: m.day, nr: m.nr, time: m.time, pitch: m.pitch,
      division: m.division, divisionCode: m.divisionCode, group: m.group,
      teamA: m.teamA, teamB: m.teamB, score: m.score, status: m.status,
      referee: m.referee,
      ourTeam:    ourTeamCodeForMatch(m, tidToCode),
      ourReferee: ourRefereeCodeForMatch(m.referee, tidToCode),
    }));

    return {
      lastUpdated: new Date().toISOString(),
      matches,
      teams,
    };
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ourTeamCodeForMatch(match, tidToCode) {
  if (match.teamA?.tid && tidToCode.has(match.teamA.tid)) return tidToCode.get(match.teamA.tid);
  if (match.teamB?.tid && tidToCode.has(match.teamB.tid)) return tidToCode.get(match.teamB.tid);
  return null;
}
function ourRefereeCodeForMatch(referee, tidToCode) {
  if (referee?.tid && tidToCode.has(referee.tid)) return tidToCode.get(referee.tid);
  return null;
}

function parseFirstDateFromHtml(html) {
  const monthMap = {
    Jan: 1, Feb: 2, Mar: 3, Mär: 3, Apr: 4, May: 5, Mai: 5,
    Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Okt: 10, Nov: 11, Dec: 12, Dez: 12,
  };
  // kayakers schreibt Zeit-Header wie "07:30 May 23rd 07:30" (Monat vor Tag)
  // oder auch "07:30 Mai 23 07:30" — beide Reihenfolgen abdecken.
  const reMonthFirst = /\b(Jan|Feb|Mar|Mär|Apr|May|Mai|Jun|Jul|Aug|Sep|Oct|Okt|Nov|Dec|Dez)\w*\s+(\d{1,2})(?:st|nd|rd|th|\.)?(?:\s+(\d{4}))?/i;
  const reDayFirst   = /\b(\d{1,2})\.?\s+(Jan|Feb|Mar|Mär|Apr|May|Mai|Jun|Jul|Aug|Sep|Oct|Okt|Nov|Dec|Dez)(?:\w+)?(?:\s+(\d{4}))?/i;

  let day, monthKey, year;
  const m1 = html.match(reMonthFirst);
  if (m1) {
    monthKey = m1[1];
    day = m1[2];
    year = m1[3];
  } else {
    const m2 = html.match(reDayFirst);
    if (!m2) return null;
    day = m2[1];
    monthKey = m2[2];
    year = m2[3];
  }
  const monthCapital = monthKey[0].toUpperCase() + monthKey.slice(1).toLowerCase();
  const month = monthMap[monthCapital] ?? monthMap[monthKey];
  if (!month) return null;
  return `${year || new Date().getFullYear()}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

/**
 * Parsed das erste Datum aus einem Range-Header wie "May 23rd - May 25th" oder
 * "Aug 8th, 25" oder "Apr 25th - Apr 26th" zu YYYY-MM-DD.
 * Returnt null bei nicht-parsebarem Input.
 *
 * Jahres-Heuristik (wenn das Jahr im Text fehlt — kayakers lässt es bei
 * Headers für das laufende Jahr oft weg):
 *   - Default: aktuelles Jahr.
 *   - Liegt der Monat mehr als 1 Monat vor `now`, nehmen wir `currentYear + 1`
 *     an — kayakers listet primär kommende Spieltage, deshalb ist z.B. "Feb"
 *     beim Scrape im November fast immer der nächste Februar.
 *   - 1-Monats-Toleranz schützt frische "letzter Monat"-Einträge (z.B. ein
 *     "Aug"-Turnier, das im September noch in der Liste hängt — soll als
 *     August dieses Jahres erkannt werden, nicht als nächster August).
 *   - Edge-Case: ein Turnier mehrere Monate in der Vergangenheit ohne Jahr
 *     liefert ein falsches +1 — kommt in der Praxis fast nie vor, aber Master
 *     kann den Wert im Tournament-Edit-Modal manuell überschreiben.
 */
function parseDateRangeStart(headerText) {
  if (!headerText) return null;
  const monthMap = {
    Jan: 1, Feb: 2, Mar: 3, Mär: 3, Apr: 4, May: 5, Mai: 5,
    Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Okt: 10, Nov: 11, Dec: 12, Dez: 12,
  };
  // kayakers schreibt z.B. "May 23rd - May 25th" oder "Aug 8th, 25" oder "Sep 5th - Sep 6th"
  // ",25" hinter dem Tag = Jahr 2025
  const re = /\b(Jan|Feb|Mar|Mär|Apr|May|Mai|Jun|Jul|Aug|Sep|Oct|Okt|Nov|Dec|Dez)\w*\s+(\d{1,2})(?:st|nd|rd|th|\.)?(?:,?\s*(\d{2,4}))?/i;
  const m = headerText.match(re);
  if (!m) return null;
  const month = monthMap[m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()];
  if (!month) return null;
  const day = String(m[2]).padStart(2, '0');
  let year;
  if (m[3]) {
    year = Number(m[3]);
    if (year < 100) year += 2000;
  } else {
    // Kein Jahr → aktuelle Saison (wenn Monat schon vorbei: nächstes Jahr)
    const now = new Date();
    year = now.getFullYear();
    const monthNow = now.getMonth() + 1;
    if (month < monthNow - 1) year += 1;
  }
  return `${year}-${String(month).padStart(2,'0')}-${day}`;
}

function extractDateHintsFromHtml(html) {
  // Best-effort: erkennt Patterns wie "23.-25. Mai 2026" oder "14.-16. Juni 2027"
  // Sehr unscharf — Master kann die Werte im UI editieren.
  const dates = [];
  const monthMap = {
    januar: 1, february: 2, februar: 2, märz: 3, march: 3, april: 4,
    mai: 5, juni: 6, june: 6, juli: 7, july: 7, august: 8, september: 9,
    oktober: 10, october: 10, november: 11, dezember: 12, december: 12,
  };
  const re = /(\d{1,2})\.?\s*[-–]\s*(\d{1,2})\.?\s+(januar|february|februar|märz|march|april|mai|juni|june|juli|july|august|september|oktober|october|november|dezember|december)\s+(\d{4})/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const from = Number(match[1]);
    const to = Number(match[2]);
    const month = monthMap[match[3].toLowerCase()];
    const year = Number(match[4]);
    if (!month) continue;
    for (let d = from; d <= to; d++) {
      dates.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    break;
  }
  return dates;
}

/**
 * N4 — Pure-Function-Variante: parst die Listing-Seite via strukturierter Daten
 * (data-country, eventItem-id-Suffix, span.dates) statt brüchiger prev('h4')-Suche.
 *
 * Exportiert für Test in scripts/testKayakersListing.mjs gegen die Fixture
 * tests/fixtures/kayakers-listing.html.
 *
 * Eingabe:  HTML-String der kayakers.nl-Homepage
 * Optionen: { country: 'DE' | 'NL' | ... | null }  — filtert nach data-country
 * Ausgabe:  [{ slug, name, viewUrl, countryCode, dateRange, dateIso }]
 *           dateIso (YYYY-MM-DD) wird aus dem `id="eventItem-...-YYYYMMDD"`-Suffix
 *           extrahiert — keine Text-Heuristik mehr.
 *           Sortierung: aufsteigend nach dateIso (bevorstehende zuerst).
 */
export function parseListingHtml(html, { country = null } = {}) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const tournaments = [];

  $('div.eventItem').each((_, item) => {
    const $item = $(item);
    const $a = $item.find('a[href*="/View/"]').first();
    if (!$a.length) return;

    const href = $a.attr('href') || '';
    const slugMatch = href.match(/\/View\/([^?&"]+)/);
    if (!slugMatch) return;
    const slug = slugMatch[1];
    if (seen.has(slug)) return;
    seen.add(slug);

    const name = $a.text().trim();
    if (!name) return;

    // 1. Country aus data-country auf der umschließenden Row
    const countryCode = $item.closest('.eventItemRow').attr('data-country') || null;

    // 2. dateIso aus id-Suffix "eventItem-<uuid>-YYYYMMDD"
    let dateIso = null;
    const id = $item.attr('id') || '';
    const idMatch = id.match(/-(\d{8})$/);
    if (idMatch) {
      const d = idMatch[1];
      dateIso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    }

    // 3. dateRange aus span.dates — Anzeigetext wie "6 Jun - 7 Jun".
    // \s+ wegen Zeilenumbrüchen im HTML.
    const dateRange = $item.find('span.dates').first().text().trim().replace(/\s+/g, ' ') || null;

    tournaments.push({
      slug,
      name,
      viewUrl: `${BASE_ORIGIN}/View/${slug}`,
      countryCode,
      dateRange,
      dateIso,
    });
  });

  // Sortieren aufsteigend nach dateIso — bevorstehende zuerst, Einträge ohne
  // Datum ans Ende.
  tournaments.sort((a, b) => {
    const da = a.dateIso || '9999-99-99';
    const db = b.dateIso || '9999-99-99';
    return da.localeCompare(db);
  });

  return country
    ? tournaments.filter(t => t.countryCode === country)
    : tournaments;
}
