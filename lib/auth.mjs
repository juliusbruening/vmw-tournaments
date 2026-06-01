// lib/auth.mjs
//
// Rollen-Auflösung für Netlify-Functions.
//   getRole(req) → 'master' | 'trainer' | { type:'self', refereeId } | null
//
// Header:
//   x-admin-password    → "master" (MASTER_PASSWORD) oder "trainer" (ADMIN_PASSWORD)
//   x-personal-token    → Login-Code eines Schiris (Phase 6)
//
// MASTER_PASSWORD ist optional: solange nicht gesetzt, fällt der Master-Login
// auf ADMIN_PASSWORD zurück (Phase 1 Übergangsmodus).

import { listRefereesIndex } from './referees.mjs';

export async function getRole(req) {
  const pwd = req.headers.get('x-admin-password');

  if (pwd && process.env.MASTER_PASSWORD && pwd === process.env.MASTER_PASSWORD) {
    return 'master';
  }
  if (pwd && process.env.ADMIN_PASSWORD && pwd === process.env.ADMIN_PASSWORD) {
    // Fallback: kein MASTER_PASSWORD gesetzt → ADMIN_PASSWORD zählt als Master
    if (!process.env.MASTER_PASSWORD) return 'master';
    return 'trainer';
  }

  const token = req.headers.get('x-personal-token');
  if (token) {
    try {
      // listRefereesIndex liest nur das Index-Blob — KEINE N Volldatensätze.
      // Index enthält loginCode bereits, dann reicht 1 Blob-Read.
      const referees = await listRefereesIndex({ activeOnly: true });
      const found = referees.find(r => (r.loginCode || '').toLowerCase() === token.toLowerCase());
      if (found) return { type: 'self', refereeId: found.id };
    } catch { /* lib/referees may not be initialized yet — fall through */ }
  }

  return null;
}

export function isMaster(role) { return role === 'master'; }
export function isTrainerOrMaster(role) { return role === 'master' || role === 'trainer'; }
export function isSelf(role) { return typeof role === 'object' && role?.type === 'self'; }

export function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  });
}

export const unauthorized = (msg = 'Unauthorized') => jsonResponse({ ok: false, error: msg }, { status: 401 });
export const forbidden    = (msg = 'Forbidden')    => jsonResponse({ ok: false, error: msg }, { status: 403 });
export const notFound     = (msg = 'Not found')    => jsonResponse({ ok: false, error: msg }, { status: 404 });
export const badRequest   = (msg = 'Bad request')  => jsonResponse({ ok: false, error: msg }, { status: 400 });
