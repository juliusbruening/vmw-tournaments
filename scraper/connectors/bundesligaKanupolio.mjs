// scraper/connectors/bundesligaKanupolio.mjs
//
// Connector für https://bundesliga.kanupolo.de (1. Bundesliga Kanu-Polo Herren).
//
// Status: Skelett. Die echten Parser-Selektoren kommen aus dem bestehenden
// Repo https://github.com/juliusbruening/vmw-kanupolo-live . Bei der Voll-
// implementierung übernehmen wir parseSpielplan/parseTabelle/parseKader 1:1
// und wrappen sie hinter diesem Interface. Bis dahin:
//   - matchesUrl: erkennt die Domain
//   - listAvailableTournaments: returnt EINEN Eintrag (aktuelle Saison)
//   - discover: fehlerresistent — gibt "manuell konfigurieren" zurück wenn Parser fehlen
//   - scrape: TODO_PARSER markiert die Stellen
//
// WICHTIG: Phase 2 deployt diesen Connector als Stub. Erst wenn die Selektoren
// aus dem alten Repo übertragen sind, kann er aktiv genutzt werden. Bis dahin
// kann man eine Bundesliga-Config trotzdem manuell anlegen — der Scrape wird
// aber nicht aktualisieren.

import { fetchHtml } from '../fetch.mjs';

const BASE_ORIGIN = 'https://bundesliga.kanupolo.de';

export const bundesligaKanupolioConnector = {
  id: 'bundesligaKanupolio',

  matchesUrl(url) {
    try { return new URL(url).hostname === 'bundesliga.kanupolo.de'; }
    catch { return false; }
  },

  async listAvailableTournaments() {
    // bundesliga.kanupolo.de hat (vermutlich) keine durchsuchbare Liste.
    // Wir bieten genau einen Eintrag: die aktuelle Saison.
    const year = new Date().getFullYear();
    return [{
      slug: `bundesliga-herren-${year}`,
      name: `1. Bundesliga Herren Saison ${year}`,
      viewUrl: BASE_ORIGIN,
      countryCode: 'DE',
      dateRange: `Saison ${year}`,
    }];
  },

  /**
   * Reduzierte Discovery — gibt einen sinnvollen Default zurück, aus dem der Master
   * manuell die Spieltag-Daten und Teams ergänzen kann.
   * Vollautomatische Discovery folgt, sobald die parseSpielplan/parseKader/parseTabelle-
   * Parser aus dem alten Repo migriert sind.
   */
  async discover(url, { fetcher = fetchHtml } = {}) {
    const year = new Date().getFullYear();
    return {
      hasSchedule: false,
      connectorId: 'bundesligaKanupolio',
      source: {
        season: String(year),
        spielplanUrl: `${BASE_ORIGIN}/spielplan`,
        tabelleUrl:   `${BASE_ORIGIN}/tabelle`,
        kaderBaseUrl: `${BASE_ORIGIN}/team/{teamId}`,
        spieltage: [],
      },
      suggestedName: `1. Bundesliga Herren Saison ${year}`,
      suggestedSlug: `bundesliga-herren-${year}`,
      proposedDates: [],
      allTeams: [],
      hintFromInfoPage: {
        datesParsed: [],
        plannedMatchListUrl: `${BASE_ORIGIN}/spielplan`,
      },
      message: 'Bundesliga-Connector: Parser noch nicht migriert. Bitte Spieltage und eigene Teams manuell konfigurieren.',
    };
  },

  /**
   * Scrape-Skelett. Returnt einen leeren Snapshot bis die Parser migriert sind.
   * Im aktiven Betrieb würde hier:
   *   1) Spielplan-HTML laden → parseSpielplan (sectiontableentry1|2)
   *   2) Tabelle-HTML laden → parseStandings (rankingrow_*)
   *   3) Pro Team das Kader-HTML laden → parseRoster (playername-Klassen)
   *   4) Matches mit ourTeam + ourReferee anreichern (TID-basiert)
   */
  async scrape(config, { fetcher = fetchHtml } = {}) {
    // TODO_PARSER: parseSpielplan, parseTabelle, parseKader migrieren
    console.warn(`[bundesligaKanupolio] scrape() ist noch ein Stub — Parser nicht migriert. Slug=${config.slug}`);
    return {
      lastUpdated: new Date().toISOString(),
      matches: [],
      teams: [],
      standings: [],
      _stub: true,
    };
  },
};
