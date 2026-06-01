// lib/tournaments.mjs
//
// Tournament-Config-Loader. Single Source: Netlify Blob "tournaments/<slug>/config.json".
//
// Der frühere Repo-Datei-Fallback (`tournaments/<slug>.json`) wurde mit Phase 7
// entfernt — Master legt Turniere über die UI an, alles lebt im Blob-Store.
// Tombstones (`_deleted: true`) bleiben als Marker im Blob für gelöschte Turniere.
//
// Erweitertes Schema (Phase 7):
//   {
//     slug, name, status, dates, connector, ...
//     type:        'tournament' | 'external',
//     ourTeams: [
//       { code, name, tid?, category }
//       // category = 'herren' | 'damen' | 'junioren' | 'jugend' | 'schueler'
//       //   → Altersklasse der VMW-Mannschaft, NICHT des gesamten Turniers.
//       //   → Wird auf der Landing-Page als Pills aufsummiert
//       //     (unique Werte aus allen ourTeams).
//     ],
//     external: {
//       resources: [ { title, url } ],   // ehemals { url } — auto-migriert
//     },
//   }

import { getStore } from '@netlify/blobs';

const BLOB_STORE = 'tournaments';

// Interne Codes — bewusst DKV-aligned, damit dkvPdf.mjs direkt mappen kann.
const VALID_CATEGORIES = ['herren', 'damen', 'junioren', 'jugend', 'schueler'];

// Anzeige-Labels (modern). Der interne Code bleibt 'junioren', damit das
// DKV-PDF korrekt mappt — angezeigt wird auf der Kachel + im Profil 'U21'.
export const CATEGORY_LABELS = {
  herren:   'Herren',
  damen:    'Damen',
  junioren: 'U21',
  jugend:   'Jugend',
  schueler: 'Schüler',
};

export function categoryLabel(code) {
  return CATEGORY_LABELS[code] ?? code;
}

/**
 * Aggregiert die VMW-teilnehmenden Altersklassen aus einer Tournament-Config.
 * Nutzt ourTeams[].category (falls gesetzt) und fällt sonst auf Auto-Detection
 * aus dem Team-Code/Namen zurück.
 *
 * @param {object} config — Tournament-Config
 * @returns {string[]} unique Liste von Kategorie-Codes
 */
export function vmwCategoriesFor(config) {
  if (!config?.ourTeams?.length) return [];
  const seen = new Set();
  for (const t of config.ourTeams) {
    const c = (t.category && VALID_CATEGORIES.includes(t.category))
            ? t.category
            : autoDetectCategory(t);
    if (c) seen.add(c);
  }
  return [...seen];
}

/**
 * Heuristik: schließt aus Team-Code/Name auf die DKV-Altersklasse.
 * Wird genutzt wenn category-Feld noch nicht migriert wurde.
 */
function autoDetectCategory(team) {
  const txt = `${team.code || ''} ${team.name || ''}`.toLowerCase();
  if (/u\s*1[2-4]\b|schüler|schueler/.test(txt)) return 'schueler';
  if (/u\s*1[56]\b|jugend|youth/.test(txt))       return 'jugend';
  if (/u\s*(17|18|19|20|21)\b|junior/.test(txt))  return 'junioren';
  if (/^damen|women|frauen|wmn/.test(txt))        return 'damen';
  if (/herren|^men\b|männer|mens/.test(txt))      return 'herren';
  return null;
}

/**
 * Lädt eine einzelne Tournament-Config.
 * @param {string} slug
 * @returns {Promise<import('./types.mjs').TournamentConfig | null>}
 */
export async function getTournament(slug) {
  try {
    const store = getStore(BLOB_STORE);
    const cfg = await store.get(`${slug}/config.json`, { type: 'json', consistency: 'strong' });
    // Tombstone-Marker: vom Master via UI gelöscht
    if (cfg && cfg._deleted === true) return null;
    return cfg || null;
  } catch {
    return null;  // Blob-Store nicht erreichbar
  }
}

/**
 * Liefert alle Tournaments aus dem Blob-Store.
 * @returns {Promise<import('./types.mjs').TournamentConfig[]>}
 */
export async function listTournaments() {
  const found = new Map();

  try {
    const store = getStore(BLOB_STORE);
    const index = await store.get('index.json', { type: 'json', consistency: 'strong' });
    if (index?.tournaments) {
      for (const entry of index.tournaments) {
        const cfg = await store.get(`${entry.slug}/config.json`, { type: 'json', consistency: 'strong' });
        if (cfg?._deleted === true) continue;          // Tombstone überspringen
        if (cfg) found.set(cfg.slug, cfg);
      }
    }
  } catch { /* Blob-Store nicht erreichbar — leere Liste zurückgeben */ }

  return [...found.values()];
}

/**
 * Speichert eine Tournament-Config in den Blob-Store und aktualisiert den Index.
 * @param {import('./types.mjs').TournamentConfig} config
 */
export async function saveTournament(config) {
  const store = getStore(BLOB_STORE);
  await store.setJSON(`${config.slug}/config.json`, config);

  const index = (await store.get('index.json', { type: 'json', consistency: 'strong' })) ?? { tournaments: [] };
  const existing = index.tournaments.findIndex(t => t.slug === config.slug);
  const entry = {
    slug: config.slug,
    name: config.name,
    type: config.type ?? 'tournament',
    status: config.status,
    dates: config.dates,
  };
  if (existing >= 0) index.tournaments[existing] = entry;
  else index.tournaments.push(entry);
  index.updatedAt = new Date().toISOString();
  await store.setJSON('index.json', index);
}

/**
 * Partial-Update einer Tournament-Config (merge mit Bestand).
 */
export async function updateTournament(slug, patch) {
  const existing = await getTournament(slug);
  if (!existing) return null;
  const merged = { ...existing, ...patch, slug };
  merged.updatedAt = patch.updatedAt || new Date().toISOString();
  await saveTournament(merged);
  return merged;
}
