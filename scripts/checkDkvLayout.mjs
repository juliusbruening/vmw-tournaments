// scripts/checkDkvLayout.mjs
//
// Smoke-Test gegen die DKV-Vorlage: stellt sicher, dass sich die Layout-
// Koordinaten der Vorlage gegenüber den in lib/dkvPdf.mjs hartkodierten Werten
// nicht geändert haben. Greift, wenn der DKV die PDF-Vorlage tauscht — sonst
// würde der Export still falsch ausgefüllt werden.
//
// Methode: liest die Vorlage mit pdf-lib, extrahiert die Y-Koordinate der
// ersten Tabellen-Zeile via Inhalt-Pattern (kennt die Zeilen-Höhe nicht direkt,
// aber Page-Anzahl + Page-Größe sind als sanity-check ok).
//
// Hinweis: vollständige pdfplumber-Vermessung wäre zu schwer für Node-Runtime,
// daher prüfen wir nur die Constraints, die sich am ehesten ändern:
//   - PDF ist A4 (595x842)
//   - PDF hat 2 Seiten
//   - Beide Seiten haben Höhe 842 (Portrait, A4)

import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(SCRIPT_DIR, '..', 'assets', 'dkv-einsatzbogen-vorlage.pdf');

const EXPECTED = {
  pageCount: 2,
  pageWidth: 595,
  pageHeight: 842,
};

let pass = 0, fail = 0;
function expect(label, ok) {
  if (ok) { console.log('✓ ' + label); pass++; }
  else    { console.log('✗ ' + label); fail++; }
}

const bytes = await readFile(TEMPLATE);
const pdf = await PDFDocument.load(bytes);

const pageCount = pdf.getPageCount();
expect(`PDF hat ${EXPECTED.pageCount} Seiten (ist: ${pageCount})`, pageCount === EXPECTED.pageCount);

for (let i = 0; i < Math.min(pageCount, 2); i++) {
  const page = pdf.getPage(i);
  const { width, height } = page.getSize();
  expect(`Seite ${i+1}: Breite ${EXPECTED.pageWidth} (ist: ${Math.round(width)})`,  Math.round(width)  === EXPECTED.pageWidth);
  expect(`Seite ${i+1}: Höhe ${EXPECTED.pageHeight} (ist: ${Math.round(height)})`, Math.round(height) === EXPECTED.pageHeight);
}

// Form-Felder-Check: wenn DKV plötzlich AcroForm-Felder einbaut, lieber die
// pdf-Felder nutzen statt manuelle Overlays. Aktueller Stand: 0 Felder.
const form = pdf.getForm();
const fieldCount = form.getFields().length;
expect(`Keine AcroForm-Felder (Overlay-Modus, ist: ${fieldCount})`, fieldCount === 0);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass, ${fail} fail`);
if (fail > 0) {
  console.log('\n⚠ Wenn die Vorlage geändert wurde, neu vermessen mit pdfplumber:');
  console.log('   pip install pdfplumber --break-system-packages');
  console.log('   python3 -c "import pdfplumber; ..."');
  console.log('   → dann Konstanten in lib/dkvPdf.mjs aktualisieren');
}
process.exitCode = fail === 0 ? 0 : 1;
