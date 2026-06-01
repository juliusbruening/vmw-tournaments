# VMW Live-App — Turnier 2.0

Multi-Turnier-Plattform für VMW Berlin. Nachfolger der DC2026-Einzel-App, jetzt mit pluggable Connectoren, Multi-Turnier-Verwaltung, persistentem Schiedsrichter-Tracking, DKV-Einsatzbogen-PDF-Export und integrierten externen Turnieren (Bundesliga & Co).

**Phasen 1-7 sind umgesetzt.** Datenhaltung läuft ausschließlich über Netlify Blobs — die ehemalige `tournaments/<slug>.json`-Repo-Datei wurde mit Phase 7 entfernt; Master legt Turniere über die UI an, alles lebt im Blob-Store. Konzepte siehe `KONZEPT_MULTI_TURNIER.md` und `KONZEPT_SCHIRI_TRACKING.md` im übergeordneten Projektordner.

## Was alles drin ist

### Phase 1 — Multi-Turnier-Refactor
- Tournament-Config aus dem Blob-Store (`tournaments/<slug>/config.json`)
- SPA-Routing `/t/<slug>`, `/admin`, `/me/<code>`, `/`
- TID-basiertes Team-Matching (Bracket-Bug-Fix — kein Namens-Matching mehr)
- Field-Rename: `jury → referee`, `juryVmw → ourReferee`, `vmwTeam → ourTeam`

### Phase 2 — Connector-Abstraktion + Master-Admin-Wizard
- `scraper/connectors/index.mjs` als Registry mit `kayakers.mjs` (Drei-Pfad-Discovery: Vollständig / Reduziert / Manuell)
- `bundesligaKanupolio.mjs` als Skelett für die DKV-Bundesliga (Parser-Migration steht noch aus — externe Turniere nutzen aktuell den `external`-Typ ohne Live-Spielplan)
- Master-Admin im Frontend: Turnier-Liste mit Edit-Modal, Status-Toggle, "Neues Turnier"-Wizard mit URL-Discovery & Tournament-Picker
- Connector erkennt automatisch `/View/<slug>`, `/Tournament/<slug>`, `/MatchList/<slug>` plus `vid`-Param für Liga-Phasen
- Zwei Passwort-Rollen: `MASTER_PASSWORD` (Julius — alles) und `ADMIN_PASSWORD` (Trainer — nur Schiri-Einteilungen)

### Phase 3 — Schiri-Stammdaten + Rollen-Einteilung
- Vereins-Pool unter `club/referees/<id>.json` mit kompaktem Index `club/referees/index.json` (inkl. `loginCode` für schnelle Auth-Lookups via `listRefereesIndex()`)
- 5 Schiri-Klassen (PLZ / C / B / A / ICF) + 5 Kategorien (Schüler / Jugend / U21 / Damen / Herren)
- 7 Rollen pro Spiel (1.SR, 2.SR, Protokoll, Zeit, Shotclock, 1.Linie, 2.Linie), alle optional
- PLZ-Klasse darf nicht 1./2. Schiri sein — Validierung im Frontend (ausgegraut) + Backend (HTTP 400)
- Schiri-Picker als Bottom-Sheet mit Filter nach Kategorie + Klasse + Suche
- Public-Profil-Sheet beim Klick auf einen Schiri-Namen (kein Vollname, nur Stats)
- Master-Admin: Schiri-CRUD (Anlegen, Editieren, Soft-Delete, Hard-Delete, Vornamen-Kollisions-Warnung)
- Defensiver Persist-Pfad mit Verify-Loop: wenn der Volldatensatz nach 3 Versuchen nicht konsistent ist, wird der Schreibvorgang abgebrochen statt einen Stale-Index zu hinterlassen

### Phase 4 — Lifecycle + Landing-Page
- Status-Automatik: `draft → awaiting-schedule → active → completed` via Cron
- Adaptive Re-Discovery für `awaiting-schedule`: >30 Tage = 1×/Woche, 7-30 Tage = 1×/Tag, <7 Tage = 2×/Tag
- Sobald Spielplan erscheint: Auto-Transition zu `active`, Master sieht `pendingTeamSelection`-Banner
- Auto-Transition zu `completed` einen Tag nach letztem Spieltag
- Landing-Page auf `/` mit Status-Sektionen "Läuft gerade" / "Geplant" / "Beendet" + Jahres-Tabs für Beendet
- Display-Gruppierung berücksichtigt das Datum: aktive Turniere mit Startdatum in der Zukunft zeigen sich unter "Geplant"; "Läuft gerade" zeigt nur Turniere im tatsächlichen Datumsfenster
- Tombstone-Mechanismus (`_deleted: true`) für gelöschte Turniere — bleibt als Marker im Blob, verhindert Wiederauftauchen aus Caches

### Phase 5 — Jahres-Reports + CSV
- `/api/admin/reports/referees?year=YYYY` aggregiert alle `assignments.json` + manuelle Einträge des Jahres
- Master-Admin-Tab "Reports" zeigt Tabelle mit Total + Aufschlüsselung pro Rolle, sortierbar
- CSV-Export via `/api/admin/reports/referees.csv?year=YYYY` (UTF-8 BOM, Excel-freundlich)
- Klick auf Report-Zeile öffnet das Public-Profil-Sheet

### Phase 6 — Schiri-Login + Self-Service
- Login-Modal mit drei Tabs: Trainer / Master / Schiri (Schiri-Tab ist Default auf der Landing-Page)
- Schiri-Login-Code Format `<PREFIX>-XXXX` (Vereins-Präfix + 4 Zufallszeichen aus `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, ohne 0/O/1/I)
- Rate-Limit: 5 Fehlversuche pro IP / 5 Min
- Self-Service-Dashboard `/me/<code>` ODER per App-Login zugänglich: Stammdaten editieren + Einsatz-Historie + manuell Einsatz ergänzen + DKV-Einsatzbogen-PDF
- Self pflegt: Adresse, Telefon, Lizenz-Nr, Verband, Verein. Master pflegt: Klasse, Kategorien, active-Flag, Notizen
- Manuelle Einträge (`club/manualEntries/<refId>/<id>.json`) für externe Turniere — fließen in Jahres-Report

### Phase 7 — DKV-PDF, externe Turniere, Banner & UI-Modernisierung
- **DKV-Einsatzbogen-PDF** als Overlay auf der echten Vorlage (`public/assets/dkv-einsatzbogen-vorlage.pdf`), Generierung via `pdf-lib` in `lib/dkvPdf.mjs`. Endpoints: `GET /api/me/pdf-einsatzbogen?year=YYYY` (Self) und `GET /api/admin/referees/<id>/pdf-einsatzbogen?year=YYYY` (Master).
- **Externe Turniere** (`type: 'external'`) für Bundesliga & andere: keine Live-Daten, dafür Ressourcen-Liste (`external.resources[]`) auf der Tournament-Page + manuelle Schiri-Einsätze. Aggregation: externe Einsätze laufen über `tournaments/<slug>/externalAssignments.json` in den Jahres-Report.
- **Hybrid-Modus**: auch kayakers-Turniere ohne Spielplan zeigen ein Dashboard mit Ressourcen + manuellen Einsätzen (Zwischenseite bis der Spielplan kommt).
- **Single Source für Tournament-Configs**: `tournaments/<slug>/config.json` im Blob-Store. Der ehemalige Repo-Datei-Fallback (`tournaments/<slug>.json`) ist entfernt — neue Turniere entstehen ausschließlich über das Master-UI.
- **Globaler Banner** (`club/banner.json`): Master kann eine Nachricht setzen, die auf jeder Seite oben angezeigt wird. MutationObserver re-injected den Banner, falls eine Page-Render die `body.innerHTML` ersetzt.
- **Modernisierte UI**: Sticky-Header mit Glass-Blur, zentrale User-Area auf allen Seiten, Team-PDF mit Screenshots (via Playwright + Mockups + reportlab), Login-Schiri als Default auf der Landing.
- **Cache-Header**: `private, max-age=5` für authed Responses (`/api/data`, `/api/tournaments`), `public, max-age=5` + Netlify-CDN für anonyme — Master-Mutationen leaken nicht mehr in CDN-Cache.
- **Auth-Performance**: `getRole()` nutzt `listRefereesIndex()` (1 Blob-Read) statt `listReferees({ includeSecret: true })` (1 + N Reads). LoginCode liegt eh im Index — Vollnamen werden für Auth nicht gebraucht.

## Projekt-Struktur

```
Turnier 2.0/
├── lib/
│   ├── auth.mjs                     # Rolle-Detection (master/trainer/self), nutzt listRefereesIndex
│   ├── refereeLevels.mjs            # ROLES, REFEREE_LEVELS, CATEGORIES, canAssignRole
│   ├── referees.mjs                 # CRUD für Schiri-Stammdaten, listRefereesIndex, generateLoginCode
│   ├── reports.mjs                  # aggregateReferees, refereesToCsv, listManualEntries, externalAssignments
│   ├── tournaments.mjs              # getTournament, listTournaments, saveTournament, updateTournament
│   ├── dkvPdf.mjs                   # PDF-Overlay-Generator auf DKV-Vorlage
│   ├── einsatzbogen.mjs             # Aggregation aller Einsätze pro Schiri+Jahr für DKV-PDF
│   └── types.mjs                    # JSDoc-Typen
│
├── scraper/
│   ├── connectors/
│   │   ├── index.mjs                # getConnector, detectConnector
│   │   ├── kayakers.mjs             # Drei-Pfad-Discovery + Scrape, parseDateRangeStart mit Jahres-Heuristik
│   │   └── bundesligaKanupolio.mjs  # Skelett — externe Turniere laufen aktuell ohne Live-Spielplan
│   ├── index.mjs                    # Dispatcher → Connector
│   ├── parseMatchList.mjs           # Field-Rename jury → referee
│   ├── parseTeam.mjs
│   └── fetch.mjs
│
├── netlify/functions/
│   ├── data.mjs                     # GET /api/data?slug=… (snapshot + assignments + referees + config + externalAssignments)
│   ├── admin.mjs                    # /api/admin/*  (Tournaments + Refs + Reports + Rollen + externalAssignments + Banner + DKV-PDF)
│   ├── auth-login.mjs               # POST /api/auth/referee-login
│   ├── me.mjs                       # /api/me/*  (Self-Service + DKV-PDF)
│   ├── public-referee-stats.mjs     # GET /api/club/referees/<id>/stats
│   ├── tournaments-list.mjs         # GET /api/tournaments  (Landing-Page)
│   ├── banner.mjs                   # GET /api/banner  (Public-Banner-Read)
│   ├── scrape.mjs                   # Cron alle 15 Min — adaptive Re-Discovery + auto-completion
│   └── force-scrape.mjs             # POST manueller Scrape (Master)
│
├── public/
│   ├── index.html
│   ├── app.js                       # Phase-1-Frontend (slug-aware), Empty-Snapshot-Fallback
│   ├── phase3.js                    # Login-Modal, Picker, Profil, Master-Admin, Landing, /me, Banner, Hybrid
│   ├── style.css
│   ├── phase3.css
│   ├── manifest.webmanifest
│   └── assets/
│       └── dkv-einsatzbogen-vorlage.pdf  # DKV-Vorlage als Overlay-Basis
│
├── scripts/
│   ├── testParseMatchList.mjs
│   ├── testTournamentLoader.mjs
│   ├── testTidBasedMatching.mjs
│   ├── testBuildSnapshotReal.mjs
│   ├── checkDkvLayout.mjs
│   ├── testDkvPdf.mjs
│   ├── testDkvPdfFields.mjs
│   ├── testRoleMapping.mjs
│   ├── testEinsatzbogenAggregation.mjs
│   ├── testCacheHeaders.mjs
│   ├── testLandingGrouping.mjs
│   ├── migrateBlobsPhase1.mjs
│   ├── scrapeOnce.mjs
│   └── serveLocal.mjs
│
├── tests/fixtures/
│   ├── dc2026-spielplan.html
│   └── dc2026-team-men2.html
│
├── netlify.toml                     # SPA + API-Redirects
├── package.json
└── README.md
```

## URL-Schema

| Pfad | Inhalt | Auth |
|---|---|---|
| `/` | Landing-Page mit Tournament-Übersicht | public |
| `/t/<slug>` | Tournament-Live-Ansicht (oder Dashboard für externe / hybride Turniere ohne Spielplan) | public |
| `/t/<slug>?beamer=1` | Beamer-Modus | public |
| `/admin` | Admin-Modal (Login → Trainer/Master) | passwortgeschützt |
| `/me/<code>` | Schiri-Self-Service (alternativ via App-Login) | personal-token |

## Endpoint-Übersicht

### Public
- `GET /api/data?slug=…` — Snapshot + Assignments + Referees + Config + externalAssignments
- `GET /api/tournaments` — Tournament-Index für die Landing-Page
- `GET /api/banner` — Globaler Banner-Text (oder leerer Body, wenn unset)
- `GET /api/club/referees/<id>/stats?year=YYYY` — Public-Profil-Stats

### Auth
- `POST /api/auth/referee-login` — Schiri-Login mit Code, Rate-Limited

### Schiri-Self-Service (`x-personal-token`)
- `GET  /api/me/profile`
- `PUT  /api/me/profile`
- `GET  /api/me/entries?year=YYYY`
- `POST /api/me/manual-entry`
- `PUT  /api/me/manual-entry/<id>`
- `DELETE /api/me/manual-entry/<id>`
- `GET  /api/me/pdf-einsatzbogen?year=YYYY` — DKV-PDF des eigenen Jahres

### Trainer + Master (`x-admin-password`)
- `POST /api/admin/login`
- `POST /api/admin/t/<slug>/assignments/<matchNr>` — Phase-3 rollenbasierte Schiri-Einteilung
- `POST /api/admin/t/<slug>/external-assignments` — manuelle externe Einsätze anlegen
- `PUT  /api/admin/t/<slug>/external-assignments/<id>`
- `DELETE /api/admin/t/<slug>/external-assignments/<id>`

### Master only
- `GET  /api/admin/tournaments`
- `POST /api/admin/tournaments/discover`
- `POST /api/admin/tournaments`
- `PUT  /api/admin/tournaments/<slug>`
- `POST /api/admin/tournaments/<slug>/status`
- `POST /api/admin/tournaments/<slug>/scrape`
- `DELETE /api/admin/tournaments/<slug>` (setzt Tombstone)
- `GET  /api/admin/discover/list?country=DE`
- `GET/POST/PUT/DELETE /api/admin/referees(/…)`
- `POST/DELETE /api/admin/referees/<id>/login-code`
- `GET  /api/admin/referees/<id>/pdf-einsatzbogen?year=YYYY`
- `GET  /api/admin/reports/referees?year=YYYY`
- `GET  /api/admin/reports/referees.csv?year=YYYY`
- `GET/POST/DELETE /api/admin/banner`

## Setup

```bash
npm install
npm test            # alle Tests grün
npm run preview     # http://localhost:5173 (mit Mock-Daten)
```

`npm test` läuft folgende Targets:

| Target | Was es prüft |
|---|---|
| `test:parse` | parseMatchList — Status, Score, Field-Rename gegen echtes kayakers-HTML |
| `test:loader` | tournaments.mjs — getTournament/listTournaments ohne Repo-Datei |
| `test:tid` | TID-basiertes Team-Matching (Bracket-Bug-Schutz) |
| `test:snapshot` | buildSnapshot end-to-end gegen Fixtures |
| `test:dkv-layout` | DKV-Vorlage hat genau 2 Seiten Format A4, kein AcroForm |
| `test:dkv-pdf` | Smoke-Test PDF-Generierung |
| `test:dkv-fields` | federation/licenseNr im PDF, Legacy-Fallback, Spiel-Nr, Rollen-Mapping |
| `test:role-mapping` | DKV-Funktionen 1.SR/2.SR/Protokoll/Zeitn./Linien korrekt gemapped |
| `test:aggregation` | externe Einsätze + manuelle Einträge landen sortiert im PDF |
| `test:cache-headers` | `private` für authed, `public` + CDN für anon, kein Crash auf authed `/api/data` |
| `test:grouping` | displayGroup() — Running / Planned / Completed / Draft |

Auf Netlify deployen — Env-Variablen setzen:
- `ADMIN_PASSWORD` — für Trainer (oder Master, wenn `MASTER_PASSWORD` nicht gesetzt)
- `MASTER_PASSWORD` — optional, für separate Master-Rolle

## Tournament-Lifecycle in der Praxis

1. Master legt im Wizard ein Turnier an — entweder kayakers (mit URL-Discovery) oder `type: 'external'` (Bundesliga & Co).
2. Status startet auf `draft`, sichtbar nur für Master. Master setzt auf `awaiting-schedule` sobald das Turnier öffentlich beworben werden kann.
3. Cron (`scrape.mjs`, 15 Min) macht adaptive Re-Discovery — bei Erfolg setzt es Status `active` und triggert den Master-Banner "VMW-Teams einteilen".
4. Trainer trägt Schiris ein (`/admin` → Schiri-Picker pro Spiel).
5. Einen Tag nach dem letzten Spieltag wird Status `completed` — Turnier wandert auf der Landing-Page in den Jahres-Tab unter "Beendet".
6. Reports + DKV-PDFs werden über die `assignments.json` (rollenbasiert) + `externalAssignments.json` (manuell, für externe + Hybrid) + `manualEntries/<refId>/<id>.json` (Schiri-Self-Service) aggregiert.

Soft-Delete via Status `archived` oder Hard-Delete via Tombstone (`_deleted: true`) — beides bleibt im Blob, damit historische Einsätze auflösbar bleiben.

## Known Limitations / nächste Verbesserungen

- **Login-Code als Klartext im Index.** Für höhere Sicherheit könnte man ihn hashen — Master müsste ihn dann beim Generieren einmalig sichern (Klartext ist nur im Generate-Response sichtbar). Mit Login-Code in der Hand könnten Dritte aktuell Schiri-Self-Service-Endpoints aufrufen. Mitigations heute: keine kritischen Schreibrechte im Self-Pfad, Rate-Limiting, Master kann Codes jederzeit revoken.
- **`phase3.js` als Single-File-Erweiterung statt Module.** Pragmatisch für den ersten Wurf, langfristig könnte man auf Vite + ES-Modules wechseln. Aktuell macht der MutationObserver für den Global-Banner Re-Inject auf body-innerHTML-Replace nötig — saubere Komponenten würden das überflüssig machen.
- **`bundesligaKanupolio`-Connector ist Skelett.** Echte Bundesliga-Turniere laufen heute als `type: 'external'` ohne Live-Spielplan. Migration der Parser aus `vmw-kanupolo-live` ist vorbereitet, aber nicht beauftragt.
- **Live-Beamer-Modus** hat noch keinen Liga-Tabellen-View für `type: 'league'`.
- **Kein Audit-Log** für Schiri-Profil-Edits durch Self-Service. Vermutlich verschmerzbar bei <100 Schiris.
- **CORS aktuell offen** auf den public Endpoints (`/api/data`, `/api/tournaments`, `/api/banner`) — kein expliziter `Access-Control-Allow-Origin`-Header gesetzt, Netlify-Default greift. Für eine reine Same-Origin-App ok; bei späterer 3rd-Party-Einbindung explizit setzen.
- **Zeitzonen-Annahme.** Spielzeiten kommen aus kayakers als lokale Berlin-Zeit ohne TZ-Info — buildSnapshot rechnet UTC-basiert, das funktioniert solange alle Spiele in DE stattfinden. Für ein Turnier außerhalb Berlin müsste das Snapshot-Schema um eine `tz`-Annotation pro Tag ergänzt werden.
- **Konstanten verstreut.** `ROLES`, `REFEREE_LEVELS`, `CATEGORIES` liegen in `lib/refereeLevels.mjs`, einige Render-Labels in `phase3.js`, DKV-Mappings in `lib/dkvPdf.mjs`. Solange sich das Modell nicht ändert kein Problem, aber bei einem Refactor ein guter Konsolidierungs-Punkt.
- **Migrations-Wizard für DC2026-Schiri-Einträge** auf Rollen-Format fehlt — der alte players[]-Eintrag wird heute parallel gelesen; ein UI-Wizard für die Namen→Rolle-Zuordnung wäre nice-to-have.
- **Jahres-Heuristik im Date-Parser.** `parseDateRangeStart` ratet das Jahr wenn der kayakers-Header nur "May 23rd" sagt (Heuristik dokumentiert im Funktions-Kommentar). Master kann den Wert im Tournament-Edit-Modal manuell korrigieren.

## Lessons learned aus dem Live-Betrieb DC2026 (Mai 2026)

Alle Fixes aus dem Wochenende sind übernommen:
- Multilingual Status-Detection (Beendet/Finished/Nicht gespielt/Cancelled)
- Score-Extraktion aus Team-Zelle
- TID-basiertes Team-Matching (Bracket-Bug-Schutz)
- Strong-Consistency-Read + Verify-Loop für Race-Schutz
- Frontend-Merge schützt frisch gespeicherte Einträge vor stale CDN-Antworten
- Zeitbasierte Live-Erkennung (Anpfiff erreicht + kein Score → live)
- "Gerade beendet" desc-Sortierung
- Refresh-Pattern flächendeckend nach Mutationen (`entries`, `profile`, `external`, `wizard`, `picker`)
- Trainer-Login-Bug (Render-Crash hat erfolgreichen Login als "fehlgeschlagen" angezeigt) → drei separate Phasen: Auth / Persist / Render mit eigenem Try-Catch
- White-Screen-Fix bei mid-session external-Detection
- Empty-Snapshot-Fallback in `app.js` für Tournaments ohne Spielplan
