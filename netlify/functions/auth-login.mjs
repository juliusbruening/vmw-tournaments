// netlify/functions/auth-login.mjs
//
// POST /api/auth/referee-login
//   Body: { code: "VMW-7K2X" }
//   Response 200: { ok: true, referee: { id, displayName, level, ... } }
//   Response 401: { ok: false, error: 'invalid_code' }
//
// Rate-Limit: max 5 Fehlversuche pro IP / 5 Min — über Blob-basierten Counter.

import { getStore } from '@netlify/blobs';
import { listRefereesIndex } from '../../lib/referees.mjs';

const RATE_KEY = (ip) => `rateLimit/login/${ip}.json`;
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000;

export default async (req) => {
  if (req.method !== 'POST') return j({ error: 'POST required' }, 405);

  const ip = req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'unknown';
  const store = getStore('club');

  // Rate-Limit-Check
  const now = Date.now();
  const rate = await store.get(RATE_KEY(ip), { type: 'json' });
  if (rate && (now - rate.firstAt) < WINDOW_MS && rate.fails >= MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - rate.firstAt)) / 1000);
    return new Response(JSON.stringify({ ok: false, error: 'rate_limited', retryAfter }),
      { status: 429, headers: { 'content-type': 'application/json', 'retry-after': String(retryAfter) } });
  }

  let body; try { body = await req.json(); } catch { body = null; }
  // Normalisieren: trim, alle Whitespace-Varianten (auch unsichtbare nbsp etc.) raus.
  const code = (body?.code || '').replace(/\s+/g, '').toUpperCase();
  if (!code) return j({ ok: false, error: 'code required' }, 400);

  // Nur den Index lesen — loginCode liegt eh dort, kein Bedarf für N Volldatensätze.
  const referees = await listRefereesIndex({ activeOnly: true });
  // Logging: hilft beim Debug im Netlify-Function-Log
  const codesInPool = referees.map(r => (r.loginCode || '').replace(/\s+/g, '').toUpperCase());
  console.log(`[auth-login] tryCode="${code}" pool=${referees.length} codes=[${codesInPool.filter(Boolean).join(',')}]`);

  const found = referees.find(r => (r.loginCode || '').replace(/\s+/g, '').toUpperCase() === code);

  if (!found) {
    // Rate-Counter aktualisieren
    const newRate = (rate && (now - rate.firstAt) < WINDOW_MS)
      ? { ...rate, fails: rate.fails + 1 }
      : { firstAt: now, fails: 1 };
    await store.setJSON(RATE_KEY(ip), newRate);
    return j({ ok: false, error: 'invalid_code' }, 401);
  }

  // Bei Erfolg: Rate-Counter zurücksetzen
  if (rate) await store.delete?.(RATE_KEY(ip)).catch(() => {});

  return j({
    ok: true,
    referee: {
      id: found.id,
      displayName: found.displayName,
      level: found.level,
      categories: found.categories,
      profileComplete: !!(found.street && found.city && found.licenseNr),
    },
  });
};

function j(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}
