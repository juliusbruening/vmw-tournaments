// lib/dkvPdf.mjs
//
// Generiert einen DKV-Schiedsrichtereinsatzbogen (PDF) für einen Schiri,
// indem die Vorlage in assets/dkv-einsatzbogen-vorlage.pdf mit Text überlagert
// wird. Koordinaten wurden 1:1 aus der Vorlage extrahiert (pdfplumber).
//
// Verwendung:
//   import { generateEinsatzbogenPdf } from '../lib/dkvPdf.mjs';
//   const bytes = await generateEinsatzbogenPdf({ referee, year, entries });
//
// `entries` ist ein bereits zusammengeführtes & sortiertes Array aus auto+manual
// Einsätzen (siehe me.mjs / reports.mjs für die Aggregation).

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Pfad zur DKV-Vorlage relativ zu process.cwd().
//
// Wichtig — NICHT relativ zu import.meta.url auflösen: Netlifys Function-Bundler
// bündelt diese Datei in netlify/functions/me.mjs, sodass `..` davon `netlify/`
// statt dem Projekt-Root liefert. `included_files` in netlify.toml extrahiert
// das Asset jedoch in `/var/task/assets/...` (= cwd + "assets/...").
//
// Lokale Tests laufen vom Projekt-Root, da stimmt cwd ebenfalls.
const TEMPLATE_PATH = join(process.cwd(), 'assets', 'dkv-einsatzbogen-vorlage.pdf');

const A4_HEIGHT = 842;
const ROW_HEIGHT = 14.16;
const FONT_SIZE = 9;
// Offset, um pdfplumber's `top` (Oberkante des Glyphs) auf die Baseline der
// bestehenden 11pt-Labels in der Vorlage zu setzen (manuell kalibriert).
const GLYPH_OFFSET = 10;

// 7 interne Rollen → 5 DKV-Funktionen
const ROLE_TO_DKV = {
  ref1:      '1.SR',
  ref2:      '2.SR',
  scorer:    'Protokoll',
  timer:     'Zeitn.',
  shotclock: 'Zeitn.',
  line1:     'Linien',
  line2:     'Linien',
};

// Direkte Spielklassen-Codes für Eintrag-Items, die bereits den DKV-Code
// liefern (statt division-String). Wird von externen Einträgen genutzt.
const SPIELKLASSE_TO_COLUMN = {
  herren:   'herren',
  damen:    'damen',
  junioren: 'junioren',
  jugend:   'jugend',
  schueler: 'schueler',
};

// Layout — Vermessungen aus der Vorlage (in pt, pdfplumber-Top-Koordinaten).
// Page 1 enthält das Header-Block + Zeilen 1..34. Page 2 enthält Zeilen 35..76
// (mit eigenem leicht verschobenem Tabellen-Ursprung).
const PAGE_1 = {
  firstRowTop: 276.7,
  cols: {
    lfdNr:         { center: 70 },
    datum:         { center: 115 },
    spielNr:       { center: 162 },
    veranstaltung: { left: 184, maxWidth: 105 },
    funktion:      { center: 322 },
    herren:        { center: 367.5 },
    damen:         { center: 401.5 },
    junioren:      { center: 435.5 },
    jugend:        { center: 469.5 },
    schueler:      { center: 503.5 },
    bemerkung:     { left: 524, maxWidth: 53 },
  },
};
const PAGE_2 = {
  firstRowTop: 164.3,
  cols: {
    lfdNr:         { center: 41.6 },
    datum:         { center: 86.75 },
    spielNr:       { center: 133.5 },
    veranstaltung: { left: 155, maxWidth: 105 },
    funktion:      { center: 293.7 },
    herren:        { center: 339 },
    damen:         { center: 373 },
    junioren:      { center: 407 },
    jugend:        { center: 441 },
    schueler:      { center: 475 },
    bemerkung:     { left: 496, maxWidth: 53 },
  },
};

// Header-Felder auf Page 1 — Y-Koordinaten als pdfplumber-Top
const HEADER = {
  einsatzjahr:           { x: 532, top: 114.6 },
  name:                  { x: 115, top: 152.0 },
  schiedsrichterklasse:  { x: 438, top: 152.0 },
  strasse:               { x: 115, top: 176.0 },
  verein:                { x: 394, top: 176.0 },
  ort:                   { x: 115, top: 200.0 },
  verband:               { x: 394, top: 200.0 },
  telefon:               { x: 115, top: 224.0 },
  ausweisNr:             { x: 394, top: 224.0 },
  // Unterschrift unten
  datum:                 { x:  97, top: 729.0 },
};

// Whiteout-Boxen, um die Dot-Filler "………" in der Vorlage zu überdecken,
// bevor wir den Text schreiben.
const HEADER_WHITEOUTS = {
  einsatzjahr:           { x: 528, top: 112,  w:  50, h: 14 },
  name:                  { x: 110, top: 150,  w: 200, h: 14 },
  schiedsrichterklasse:  { x: 432, top: 150,  w: 100, h: 14 },
  strasse:               { x: 110, top: 174,  w: 200, h: 14 },
  verein:                { x: 388, top: 174,  w: 160, h: 14 },
  ort:                   { x: 108, top: 198,  w: 200, h: 14 },
  verband:               { x: 388, top: 198,  w: 160, h: 14 },
  telefon:               { x: 108, top: 222,  w: 200, h: 14 },
  ausweisNr:             { x: 388, top: 222,  w: 110, h: 14 },
};

/**
 * Mappt eine division-Bezeichnung auf eine DKV-Spielklassen-Spalte.
 * Liefert null wenn nicht eindeutig zuordenbar.
 */
function divisionToSpielklasse(division) {
  if (!division) return null;
  const d = division.toLowerCase();

  // Direkter Code-Match (externe Einträge liefern bereits DKV-Code)
  if (SPIELKLASSE_TO_COLUMN[d]) return SPIELKLASSE_TO_COLUMN[d];

  // U-Altersklassen explizit prüfen (vor allgemeinem Men/Women-Match)
  if (/u\s*1[2-4]\b|schueler|schüler/.test(d))    return 'schueler';
  if (/u\s*1[56]\b|jugend|youth/.test(d))         return 'jugend';
  if (/u\s*(17|18|19|20|21)\b|junior/.test(d))    return 'junioren';
  if (/^damen|women|frauen/.test(d))              return 'damen';
  if (/^herren|men\b|männer|mens/.test(d))        return 'herren';
  return null;
}

/**
 * Mappt eine interne Rolle (ref1, scorer, ...) auf die DKV-Funktions-Bezeichnung.
 * Wenn ein freier Text übergeben wurde (z. B. aus manualEntry), wird er
 * unverändert zurückgegeben.
 */
function roleToDkvFunktion(role) {
  if (!role) return '';
  return ROLE_TO_DKV[role] ?? role;
}

/**
 * Hauptfunktion. Liefert UInt8Array (PDF-Bytes).
 *
 * @param {object} opts
 * @param {object} opts.referee   - Schiri-Stammdaten (name, klasse, …)
 * @param {number} opts.year      - Einsatzjahr
 * @param {Array}  opts.entries   - Sortierte Einsätze; Felder:
 *     date (YYYY-MM-DD), matchNr (string|number), tournamentName,
 *     role (interner Code) ODER funktion (Freitext), division, notes
 */
export async function generateEinsatzbogenPdf({ referee = {}, year, entries = [] }) {
  const templateBytes = await readFile(TEMPLATE_PATH);
  const pdf = await PDFDocument.load(templateBytes);
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pages = pdf.getPages();
  const page1 = pages[0];
  const page2 = pages[1];

  // ── Whiteout über die Dot-Filler in der Vorlage ────────────────────────────
  for (const wo of Object.values(HEADER_WHITEOUTS)) {
    page1.drawRectangle({
      x: wo.x,
      y: A4_HEIGHT - wo.top - wo.h,
      width: wo.w,
      height: wo.h,
      color: rgb(1, 1, 1),
    });
  }

  // ── Header-Block ───────────────────────────────────────────────────────────
  drawLeft(page1, helvBold, String(year ?? ''),                     HEADER.einsatzjahr);
  drawLeft(page1, helv,     fullName(referee),                      HEADER.name);
  drawLeft(page1, helv,     referee.level ?? '',                    HEADER.schiedsrichterklasse);
  drawLeft(page1, helv,     referee.street ?? '',                   HEADER.strasse);
  drawLeft(page1, helv,     referee.club ?? 'VMW Berlin Kanu-Polo', HEADER.verein);
  drawLeft(page1, helv,     formatCityLine(referee),                HEADER.ort);
  // Schema-Feld heißt `federation` (siehe lib/referees.mjs SELF_FIELDS).
  // Alter Code prüfte `verband` → leerer Wert → Default-Fallback. Beide Schreibweisen
  // jetzt akzeptiert, Fallback nur wenn beide leer.
  drawLeft(page1, helv,     referee.federation ?? referee.verband ?? '', HEADER.verband);
  drawLeft(page1, helv,     referee.phone ?? '',                    HEADER.telefon);
  // Schema-Feld heißt `licenseNr` (siehe lib/referees.mjs SELF_FIELDS).
  drawLeft(page1, helv,     referee.licenseNr ?? referee.ausweisNr ?? '', HEADER.ausweisNr);

  // Unterschriftsdatum unten links auf Page 1 — bewusst weggelassen (Schiri füllt manuell)

  // ── Einsatz-Zeilen ─────────────────────────────────────────────────────────
  // NICHT lfd. Nr. zeichnen — ist bereits in der Vorlage.
  entries.slice(0, 76).forEach((entry, idx) => {
    const lfdNr = idx + 1;
    const onPage1 = lfdNr <= 34;
    const page = onPage1 ? page1 : page2;
    const layout = onPage1 ? PAGE_1 : PAGE_2;
    const localRow = onPage1 ? lfdNr - 1 : lfdNr - 35;
    const topY = layout.firstRowTop + localRow * ROW_HEIGHT;

    // Datum
    drawCenter(page, helv, formatGermanDate(entry.date), layout.cols.datum.center, topY);

    // Spiel-Nr.
    drawCenter(page, helv, String(entry.matchNr ?? ''), layout.cols.spielNr.center, topY);

    // Veranstaltung (links, mit Truncation)
    drawTruncated(
      page, helv,
      entry.tournamentName ?? '',
      layout.cols.veranstaltung.left, topY,
      layout.cols.veranstaltung.maxWidth,
    );

    // Funktion
    drawCenter(
      page, helv,
      roleToDkvFunktion(entry.role ?? entry.funktion),
      layout.cols.funktion.center, topY,
    );

    // Spielklasse — "X" in der passenden Spalte
    const kls = divisionToSpielklasse(entry.division);
    if (kls && layout.cols[kls]) {
      drawCenter(page, helv, 'X', layout.cols[kls].center, topY);
    }

    // Bemerkung
    drawTruncated(
      page, helv,
      entry.notes ?? '',
      layout.cols.bemerkung.left, topY,
      layout.cols.bemerkung.maxWidth,
    );
  });

  return await pdf.save();
}

// ─── Draw-Helpers ───────────────────────────────────────────────────────────

function drawLeft(page, font, text, pos) {
  if (!text) return;
  page.drawText(String(text), {
    x: pos.x,
    y: A4_HEIGHT - pos.top - GLYPH_OFFSET,
    size: FONT_SIZE,
    font,
    color: rgb(0, 0, 0),
  });
}

function drawCenter(page, font, text, centerX, top) {
  if (text == null || text === '') return;
  const str = String(text);
  const width = font.widthOfTextAtSize(str, FONT_SIZE);
  page.drawText(str, {
    x: centerX - width / 2,
    y: A4_HEIGHT - top - GLYPH_OFFSET,
    size: FONT_SIZE,
    font,
    color: rgb(0, 0, 0),
  });
}

function drawTruncated(page, font, text, x, top, maxWidth) {
  if (!text) return;
  let str = String(text);
  while (font.widthOfTextAtSize(str, FONT_SIZE) > maxWidth && str.length > 1) {
    str = str.slice(0, -1);
  }
  page.drawText(str, {
    x,
    y: A4_HEIGHT - top - GLYPH_OFFSET,
    size: FONT_SIZE,
    font,
    color: rgb(0, 0, 0),
  });
}

function fullName(ref) {
  const parts = [];
  if (ref.firstName) parts.push(ref.firstName);
  if (ref.lastName)  parts.push(ref.lastName);
  if (parts.length) return parts.join(' ');
  return ref.fullName ?? ref.name ?? '';
}

function formatCityLine(ref) {
  const zip = ref.zip ?? ref.plz;
  const city = ref.city ?? ref.ort;
  if (zip && city) return `${zip} ${city}`;
  return city ?? '';
}

function formatGermanDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1].slice(2)}`;
}
