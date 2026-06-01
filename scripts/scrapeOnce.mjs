// scripts/scrapeOnce.mjs
// Lokal einen kompletten Scrape ausführen und das Ergebnis nach public/data.json schreiben.
// Damit kann das Frontend offline gegen echte (gerade gescrapte) Daten getestet werden.

import { writeFile, mkdir } from 'node:fs/promises';
import { buildSnapshot } from '../scraper/index.mjs';

const out = new URL('../public/data.json', import.meta.url);
await mkdir(new URL('../public/', import.meta.url), { recursive: true });

console.log('[scrapeOnce] starting…');
const t0 = Date.now();
const snap = await buildSnapshot();
const payload = {
  snapshot: snap,
  refereeAssignments: {},
  server: new Date().toISOString(),
};
await writeFile(out, JSON.stringify(payload, null, 2));
console.log(`[scrapeOnce] done in ${Date.now()-t0}ms · ${snap.matches.length} matches · ${snap.teams.length} teams`);
console.log(`[scrapeOnce] written to ${out.pathname}`);
