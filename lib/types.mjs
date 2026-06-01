// lib/types.mjs
// JSDoc-Typen — keine Runtime-Code, nur Editor-/Doc-Support.
// Tatsächliche Datei-Schemata werden über JSON-Files in /tournaments und Blobs gehalten.

/**
 * @typedef {"tournament" | "league" | "external"} EventType
 *   "tournament": klassisches 2-3-Tages-Event (z.B. DC2026)
 *   "league":     Saison mit verteilten Spieltagen + Gesamttabelle
 *   "external":   keine eigenen Daten — Landing-Page-Karte verlinkt auf externe App
 *                 (z.B. die bestehende vmw-kanupolo-live für die Bundesliga)
 */

/**
 * @typedef {"draft" | "awaiting-schedule" | "active" | "completed" | "archived"} TournamentStatus
 */

/**
 * @typedef {"kayakers" | "bundesligaKanupolio"} ConnectorId
 */

/**
 * @typedef {Object} OurTeam
 * @property {string} code         interner Identifier, z.B. "U14"
 * @property {string} pillLabel    kurz für Anzeige, z.B. "U14"
 * @property {string} short        z.B. "VMW U14"
 * @property {string} name         voll, wie in der Quelle, z.B. "VMW Berlin U14"
 * @property {string} tid          UUID aus der Quelle (kayakers oder bundesliga.kanupolo.de)
 */

/**
 * @typedef {Object} KayakersSource
 * @property {string|null} viewUrl
 * @property {string|null} tournamentInfoUrl
 * @property {string|null} matchListUrl
 * @property {string|null} matchListVid
 * @property {string|null} tournamentId
 */

/**
 * @typedef {Object} BundesligaSource
 * @property {string} season
 * @property {string|null} ligaSlug
 * @property {string} spielplanUrl
 * @property {string} tabelleUrl
 * @property {string} kaderBaseUrl
 * @property {Array<{nr: number, date: string}>} spieltage
 */

/**
 * @typedef {Object} TournamentConfig
 * @property {string} slug                                    URL-friendly, lowercase, [a-z0-9-]+
 * @property {string} name                                    Display-Name
 * @property {EventType} type                                 Default: "tournament"
 * @property {ConnectorId} connector
 * @property {boolean} showStandings                          Liga: true; Turnier: meist false
 * @property {KayakersSource | BundesligaSource} source       connector-spezifisch
 * @property {TournamentStatus} status
 * @property {string[]} dates                                 Array "YYYY-MM-DD"; bei Liga ggf. lange Liste
 * @property {string[] | null} expectedDates                  nur bei awaiting-schedule gefüllt
 * @property {string} timezone                                IANA, default "Europe/Berlin"
 * @property {boolean} pendingTeamSelection                   nach Auto-Activation: Master muss Teams picken
 * @property {string | null} lastRediscoveryAt                ISO-Timestamp
 * @property {OurTeam[]} ourTeams
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} [externalUrl]                           nur bei type === "external"
 */

/**
 * @typedef {Object} MatchTeam
 * @property {string} name
 * @property {string | null} tid           UUID; null bei Bracket-Platzhaltern
 */

/**
 * @typedef {Object} Match
 * @property {number} day                  1-basierter Spieltag (oder Wochen-Tag bei Liga)
 * @property {number} nr                   Match-Nummer aus der Quelle
 * @property {string | null} time          "HH:MM"
 * @property {number | string} pitch
 * @property {string} division
 * @property {string | null} divisionCode  "U14" | "U16" | "U21" | "Women" | "Men1" | "Men2"
 * @property {string | null} group
 * @property {MatchTeam} teamA
 * @property {MatchTeam} teamB
 * @property {{a: number|null, b: number|null}} score
 * @property {"next" | "live" | "done"} status
 * @property {MatchTeam | null} referee    Schiedsrichter-Team (war "jury" im alten Code)
 * @property {string | null} ourTeam       Code aus config.ourTeams falls VMW spielt
 * @property {string | null} ourReferee    Code aus config.ourTeams falls VMW pfeift
 */

/**
 * @typedef {Object} StandingsRow                Liga-Tabellen-Eintrag
 * @property {number} rank
 * @property {string} team
 * @property {string} tid
 * @property {number} P                  Punkte
 * @property {number} W
 * @property {number} D
 * @property {number} L
 * @property {number} GF                 Goals For
 * @property {number} GA                 Goals Against
 * @property {number} GD                 Goal Difference
 * @property {number} played
 * @property {boolean} vmw               eigenes Team
 */

/**
 * @typedef {Object} Snapshot
 * @property {string} lastUpdated
 * @property {Match[]} matches
 * @property {Array<Object>} teams
 * @property {StandingsRow[]} [standings] nur bei Liga gefüllt
 */

export {};
