// netlify/functions/tournaments-list.mjs
// GET /api/tournaments
//
// Public-Listing aller Tournaments für die Landing-Page.
// Master-Login (via x-admin-password) sieht zusätzlich Drafts.

import { listTournaments, vmwCategoriesFor } from '../../lib/tournaments.mjs';
import { getRole, isMaster } from '../../lib/auth.mjs';
import { buildCacheHeaders } from '../../lib/cacheHeaders.mjs';

export default async (req) => {
  const role = await getRole(req);
  const all = await listTournaments();

  let visible = all.filter(t => t.status !== 'archived');
  if (!isMaster(role)) {
    visible = visible.filter(t => t.status !== 'draft');
  }

  // Sortierung: 1. active, 2. awaiting-schedule, 3. completed; innerhalb desc nach Datum
  const order = { 'active': 0, 'awaiting-schedule': 1, 'draft': 2, 'completed': 3 };
  visible.sort((a, b) => {
    const oa = order[a.status] ?? 99;
    const ob = order[b.status] ?? 99;
    if (oa !== ob) return oa - ob;
    const da = (a.dates?.[0] || a.expectedDates?.[0] || '');
    const db = (b.dates?.[0] || b.expectedDates?.[0] || '');
    return db.localeCompare(da);
  });

  // Public-Subset zurückgeben — keine Master-Felder wie `source`
  const compact = visible.map(t => ({
    slug: t.slug,
    name: t.name,
    type: t.type || 'tournament',
    status: t.status,
    dates: t.dates || [],
    expectedDates: t.expectedDates || null,
    showStandings: !!t.showStandings,
    // VMW-Teilnehmer-Kategorien (für Card-Pills)
    vmwCategories: vmwCategoriesFor(t),
    // External-spezifisch: Resource-Count für Hinweis "Externer Plan vorhanden"
    externalResourceCount: Array.isArray(t.external?.resources) ? t.external.resources.length : 0,
    // Legacy-Felder (alte Configs) — beibehalten für Backward-Compat
    externalUrl: t.externalUrl || null,
    externalDays: Array.isArray(t.externalDays) ? t.externalDays : null,
  }));

  // Cache-Strategie siehe lib/cacheHeaders.mjs — gemeinsamer Helper, damit der
  // Vary-Bug nicht wieder aus einer der Routes kippt.
  const cacheHeaders = buildCacheHeaders(!!role);

  return new Response(JSON.stringify({ tournaments: compact }), {
    status: 200,
    headers: { 'content-type': 'application/json', ...cacheHeaders },
  });
};
