// lib/referees.mjs
//
// Schiri-Stammdaten-Layer. Blob-Layout:
//   club/referees/index.json           — Cache mit Public-Feldern aller Schiris
//   club/referees/<id>.json            — Volldatensatz pro Schiri
//
// Lookup-Strategie:
//   - listReferees() liest index.json (Cache) für die meisten UI-Abfragen
//   - getReferee(id) liest den Volldatensatz
//   - jede Mutation aktualisiert index.json synchron
//
// Bei <100 Schiris ist eine zusätzliche byCode-Lookup-Datei unnötig — wir
// iterieren bei Login-Versuchen einfach den Index.

import { getStore } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';

const STORE = 'club';
const INDEX_KEY = 'referees/index.json';
const REF_KEY   = (id) => `referees/${id}.json`;

const PUBLIC_FIELDS  = ['id', 'displayName', 'level', 'categories', 'active'];
const SELF_FIELDS    = ['firstName', 'lastName', 'displayName', 'street', 'city', 'phone', 'licenseNr', 'club', 'federation'];
const MASTER_FIELDS  = ['firstName', 'lastName', 'displayName', 'level', 'categories', 'active', 'notes',
                        'street', 'city', 'phone', 'licenseNr', 'club', 'federation'];

/**
 * Volldatensatz lesen. Strong-Consistency, weil oft direkt nach Edit.
 */
export async function getReferee(id) {
  const store = getStore(STORE);
  return await store.get(REF_KEY(id), { type: 'json', consistency: 'strong' });
}

/**
 * Liste — default nur Public-Felder, optional voll für Master.
 * @param {{activeOnly?: boolean, includeSecret?: boolean}} opts
 */
export async function listReferees({ activeOnly = false, includeSecret = false } = {}) {
  const store = getStore(STORE);
  const index = (await store.get(INDEX_KEY, { type: 'json', consistency: 'strong' })) ?? { referees: [] };

  let referees = index.referees;
  if (activeOnly) referees = referees.filter(r => r.active !== false);

  if (!includeSecret) {
    // Public-View: ohne Vollnamen, ohne Adresse, ohne loginCode
    return referees.map(r => filterFields(r, PUBLIC_FIELDS));
  }

  // Master-View: lade Volldatensätze
  const full = await Promise.all(referees.map(r => getReferee(r.id)));
  return full.filter(Boolean);
}

/**
 * Performance-optimierte Variante: liefert NUR die kompakten Index-Einträge
 * (inkl. loginCode + hasLoginCode + active + level), OHNE die N Volldatensätze
 * nachzuladen. Für Auth-Checks (getRole, auth-login) das richtige Tool —
 * loginCode liegt eh im Index.
 *
 * Master-Listings müssen weiter `listReferees({ includeSecret: true })` nutzen,
 * weil die Vollnamen + Adresse benötigt werden.
 */
export async function listRefereesIndex({ activeOnly = false } = {}) {
  const store = getStore(STORE);
  const index = (await store.get(INDEX_KEY, { type: 'json', consistency: 'strong' })) ?? { referees: [] };
  let referees = index.referees;
  if (activeOnly) referees = referees.filter(r => r.active !== false);
  return referees;
}

export async function createReferee(data) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const referee = {
    id,
    firstName:   data.firstName || '',
    lastName:    data.lastName  || '',
    displayName: data.displayName || data.firstName || '',
    level:       data.level || null,
    categories:  Array.isArray(data.categories) ? data.categories : [],
    active:      data.active !== false,
    notes:       data.notes || '',
    street:      data.street || '',
    city:        data.city || '',
    phone:       data.phone || '',
    licenseNr:   data.licenseNr || '',
    club:        data.club || '',
    federation:  data.federation || '',
    loginCode:   null,
    createdAt:   now,
    updatedAt:   now,
  };
  await persistReferee(referee);
  return referee;
}

/**
 * Update — `whitelist` steuert, welche Felder ein nicht-Master schreiben darf.
 */
export async function updateReferee(id, patch, { whitelist = MASTER_FIELDS } = {}) {
  const store = getStore(STORE);
  const existing = await getReferee(id);
  if (!existing) return null;

  const merged = { ...existing };
  for (const key of whitelist) {
    if (key in patch && patch[key] !== undefined) merged[key] = patch[key];
  }
  merged.updatedAt = new Date().toISOString();
  await persistReferee(merged);
  return merged;
}

/**
 * Update durch Self-Service: nur SELF_FIELDS dürfen geschrieben werden.
 */
export async function updateRefereeSelf(id, patch) {
  return updateReferee(id, patch, { whitelist: SELF_FIELDS });
}

export async function softDeleteReferee(id) {
  const ref = await getReferee(id);
  if (!ref) return false;
  ref.active = false;
  ref.loginCode = null;       // Login wird mit-deaktiviert
  ref.updatedAt = new Date().toISOString();
  await persistReferee(ref);
  return true;
}

/**
 * Hartes Löschen — Datensatz, Index-Eintrag und manuelle Einträge des Schiris
 * werden entfernt. Historische Einsätze in Tournaments/<slug>/assignments.json
 * verlieren ihre Auflösung (Schiri-ID bleibt drin, ist aber nicht mehr lookup-bar).
 * Reports zeigen den Schiri dann nicht mehr.
 *
 * Nur für Test- und Cleanup-Zwecke. Soft-Delete (active=false) ist die normale
 * Operation; sie behält den Datensatz für Reports.
 */
export async function hardDeleteReferee(id) {
  const store = getStore(STORE);
  const ref = await getReferee(id);
  if (!ref) return false;

  // 1. Volldatensatz löschen
  await store.delete(REF_KEY(id)).catch(() => {});

  // 2. Aus Index entfernen
  const index = (await store.get(INDEX_KEY, { type: 'json', consistency: 'strong' })) ?? { referees: [] };
  index.referees = index.referees.filter(r => r.id !== id);
  index.updatedAt = new Date().toISOString();
  await store.setJSON(INDEX_KEY, index);

  // 3. Manuelle Einträge des Schiris löschen (in club-Store)
  try {
    const list = await store.list({ prefix: `manualEntries/${id}/` });
    for (const blob of (list?.blobs || [])) {
      await store.delete(blob.key).catch(() => {});
    }
  } catch { /* keine manualEntries → skip */ }

  console.log(`[referees] hard-deleted ${id} (${ref.displayName || ref.firstName})`);
  return true;
}

/**
 * Login-Code-Generator. Format: <PRÄFIX>-XXXX
 * Präfix = ersten 3 Buchstaben des Vereins (default "VMW"), 4 Zufallszeichen
 * aus erlaubtem Alphabet (ohne 0/O/1/I für Lesbarkeit).
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export async function generateLoginCode(id) {
  const ref = await getReferee(id);
  if (!ref) return null;
  const prefix = (ref.club || 'VMW').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'VMW';

  // Konflikt-Check über alle Schiris — nur Index reicht (loginCode liegt drin)
  const all = await listRefereesIndex({ activeOnly: false });
  let code;
  let attempts = 0;
  do {
    let suffix = '';
    for (let i = 0; i < 4; i++) suffix += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    code = `${prefix}-${suffix}`;
    attempts++;
  } while (all.some(r => r.id !== id && (r.loginCode || '').toUpperCase() === code) && attempts < 50);

  ref.loginCode = code;
  ref.updatedAt = new Date().toISOString();
  await persistReferee(ref);
  return { loginCode: code };
}

export async function revokeLoginCode(id) {
  const ref = await getReferee(id);
  if (!ref) return false;
  ref.loginCode = null;
  ref.updatedAt = new Date().toISOString();
  await persistReferee(ref);
  return true;
}

// ─── Internals ──────────────────────────────────────────────────────────────

async function persistReferee(referee) {
  const store = getStore(STORE);

  // 1. Volldatensatz schreiben + Verify (Race-Schutz: 3 Versuche, dann hart throw)
  // Vorher: Schleife verließ nach 3 Mismatches still — Index wurde trotzdem
  // mit den neuen Daten geschrieben, Volldatensatz war veraltet → inkonsistenter
  // Zustand. Jetzt: nach 3 erfolglosen Verifies abbrechen, der Caller sieht Fehler.
  let verified = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    await store.setJSON(REF_KEY(referee.id), referee);
    const verify = await store.get(REF_KEY(referee.id), { type: 'json', consistency: 'strong' });
    if (verify?.updatedAt === referee.updatedAt) { verified = true; break; }
  }
  if (!verified) {
    throw new Error(`persistReferee: Volldatensatz ${referee.id} nach 3 Versuchen nicht konsistent — Schreibvorgang abgebrochen, Index NICHT aktualisiert.`);
  }

  // 2. Index aktualisieren — kompakt, nur Public-Felder, mit Login-Code-Marker
  const index = (await store.get(INDEX_KEY, { type: 'json', consistency: 'strong' })) ?? { referees: [] };
  const compactEntry = {
    ...filterFields(referee, PUBLIC_FIELDS),
    // Marker, kein Klartext — damit Master in der Liste sieht, wer einen Code hat
    hasLoginCode: !!referee.loginCode,
    // loginCode im Index für schnelle Auflösung beim Self-Login (nur intern; Public-Endpoints filtern raus)
    loginCode: referee.loginCode || null,
  };
  const idx = index.referees.findIndex(r => r.id === referee.id);
  if (idx >= 0) index.referees[idx] = compactEntry;
  else index.referees.push(compactEntry);
  index.updatedAt = new Date().toISOString();
  await store.setJSON(INDEX_KEY, index);
}

function filterFields(obj, fields) {
  const out = {};
  for (const f of fields) if (f in obj) out[f] = obj[f];
  return out;
}
