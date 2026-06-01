// lib/banner.mjs
//
// Globaler Info-Banner. Master setzt eine Nachricht (z.B. "Live-Test läuft —
// Bitte Bugs an Julius melden"), die auf jeder Seite oben angezeigt wird.
//
// Blob-Layout (Store: "club"):
//   banner.json  →  { message, level, active, updatedAt, updatedBy }
//
// Felder:
//   message  — Text, max 280 Zeichen
//   level    — 'info' | 'warning' (Farbe; default 'info')
//   active   — boolean (Toggle ohne den Text zu löschen)

import { getStore } from '@netlify/blobs';

const STORE = 'club';
const KEY = 'banner.json';

const MAX_LEN = 280;
const VALID_LEVELS = ['info', 'warning'];

export async function getBanner() {
  const store = getStore(STORE);
  return await store.get(KEY, { type: 'json', consistency: 'strong' });
}

/**
 * Aktualisiert oder erstellt den Banner.
 * @param {object} patch    — { message?, level?, active? }
 * @param {string} updatedBy — z.B. 'master'
 */
export async function setBanner(patch, updatedBy = 'master') {
  if (patch.message != null && (typeof patch.message !== 'string' || patch.message.length > MAX_LEN)) {
    throw new Error(`message muss String sein, max ${MAX_LEN} Zeichen`);
  }
  if (patch.level != null && !VALID_LEVELS.includes(patch.level)) {
    throw new Error(`level muss einer von ${VALID_LEVELS.join(', ')} sein`);
  }
  const store = getStore(STORE);
  const existing = (await store.get(KEY, { type: 'json' })) || {};
  const merged = {
    message: patch.message ?? existing.message ?? '',
    level:   patch.level   ?? existing.level   ?? 'info',
    active:  patch.active  ?? existing.active  ?? false,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  await store.setJSON(KEY, merged);
  return merged;
}

export async function clearBanner() {
  const store = getStore(STORE);
  await store.delete(KEY).catch(() => {});
}
