// netlify/functions/banner.mjs
// GET /api/banner  →  aktuell aktiver Banner (für ALLE User, public)
//
// Antwort:
//   { active: true,  message: "…", level: "info" }   wenn aktiv gesetzt
//   { active: false }                                 wenn nicht gesetzt / deaktiviert

import { getBanner } from '../../lib/banner.mjs';

export default async (req) => {
  const banner = await getBanner();
  const payload = banner?.active && banner.message
    ? { active: true, message: banner.message, level: banner.level || 'info' }
    : { active: false };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=30',
      'netlify-cdn-cache-control': 'public, s-maxage=30, stale-while-revalidate=120',
    },
  });
};
