// netlify/functions/scrape.mjs (Phase 4)
//
// Scheduled Function alle 15 Min (04-21 UTC). Pro Tournament:
//   1. status === 'active'             → wenn im Datum-Fenster: scrapen
//                                        wenn heute > letztes Datum + 1: auto → 'completed'
//   2. status === 'awaiting-schedule'  → adaptive Re-Discovery
//                                        > 30 Tage zum erwarteten Start: 1×/Woche
//                                        7-30 Tage: 1×/Tag
//                                        < 7 Tage:  2×/Tag
//   3. status === 'completed' / 'draft' / 'archived' → skip

import { getStore } from '@netlify/blobs';
import { listTournaments, updateTournament } from '../../lib/tournaments.mjs';
import { buildSnapshot } from '../../scraper/index.mjs';
import { getConnector } from '../../scraper/connectors/index.mjs';
import { fetchHtml } from '../../scraper/fetch.mjs';
import { parseMatchList } from '../../scraper/parseMatchList.mjs';

export const config = {
  schedule: '*/15 4-21 * * *',
};

function berlinDateString(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Für externe Turniere: Status nach config.dates ableiten.
 *   heute < dates[0]              → active (zukünftig, aber sichtbar)
 *   dates[0] ≤ heute ≤ dates[last]→ active
 *   heute > dates[last] + 1 Tag   → completed
 * Wenn keine dates: bleibt was es ist.
 */
function computeExternalStatus(tConfig, today) {
  if (['archived','draft'].includes(tConfig.status)) return tConfig.status;
  const dates = tConfig.dates || [];
  if (!dates.length) return tConfig.status;
  const last = dates[dates.length - 1];
  if (today > addDays(last, 1)) return 'completed';
  return 'active';
}

function isWithinTournamentWindow(tConfig, today) {
  if (!Array.isArray(tConfig.dates) || tConfig.dates.length === 0) return false;
  const first = tConfig.dates[0];
  const last  = tConfig.dates[tConfig.dates.length - 1];
  return today >= first && today <= last;
}

function rediscoveryIntervalMs(tConfig) {
  const expectedStart = tConfig.expectedDates?.[0]
    ? Date.parse(tConfig.expectedDates[0] + 'T00:00:00+02:00')
    : null;
  if (!expectedStart) return 7 * 24 * 3600_000;
  const daysAway = (expectedStart - Date.now()) / 86_400_000;
  if (daysAway < 7)  return 12 * 3600_000;
  if (daysAway <= 30) return 24 * 3600_000;
  return 7 * 24 * 3600_000;
}

async function probeForSchedule(tConfig) {
  const conn = getConnector(tConfig.connector);
  if (!conn) return { matchesFound: false };

  // Phase 4: nur kayakers-Re-Discovery implementiert
  if (tConfig.connector !== 'kayakers') return { matchesFound: false };

  const { matchListUrl, matchListVid, viewUrl } = tConfig.source || {};
  if (!matchListUrl && !viewUrl) return { matchesFound: false };

  // 1) MatchList direkt probieren
  if (matchListUrl) {
    const url = matchListVid ? `${matchListUrl}?day=1&vid=${matchListVid}` : `${matchListUrl}?day=1`;
    const html = await fetchHtml(url).catch(() => null);
    if (html) {
      const matches = parseMatchList(html, 1);
      if (matches.length > 0) {
        // Full Discovery für Dates + Teams + tournamentId
        const fullResult = await conn.discover(matchListUrl).catch(() => null);
        if (fullResult?.hasSchedule) {
          return { matchesFound: true, fullResult, matchListUrl, vid: matchListVid };
        }
      }
    }
  }

  // 2) Via /View/ — vid extrahieren und probieren
  if (viewUrl) {
    try {
      const result = await conn.discover(viewUrl);
      if (result.hasSchedule) {
        return { matchesFound: true, fullResult: result, matchListUrl: result.source.matchListUrl, vid: result.source.matchListVid };
      }
    } catch { /* ignore */ }
  }

  return { matchesFound: false };
}

export default async (req, ctx) => {
  const today = berlinDateString();
  const tournaments = await listTournaments();
  const results = [];

  for (const tConfig of tournaments) {
    // ─── external → nicht scrapen, aber Status nach Datum automatisch updaten ─
    if (tConfig.type === 'external') {
      const newStatus = computeExternalStatus(tConfig, today);
      if (newStatus && newStatus !== tConfig.status) {
        await updateTournament(tConfig.slug, { status: newStatus });
        results.push({ slug: tConfig.slug, transitioned: `external → ${newStatus}` });
        console.log(`[scrape] ${tConfig.slug} external status ${tConfig.status} → ${newStatus}`);
      } else {
        results.push({ slug: tConfig.slug, skipped: 'external' });
      }
      continue;
    }
    // ─── completed/archived/draft → skip ───────────────────────────────
    if (['completed', 'archived', 'draft'].includes(tConfig.status)) {
      results.push({ slug: tConfig.slug, skipped: tConfig.status });
      continue;
    }

    // ─── awaiting-schedule: adaptive Re-Discovery ──────────────────────
    if (tConfig.status === 'awaiting-schedule') {
      const lastTry = tConfig.lastRediscoveryAt ? Date.parse(tConfig.lastRediscoveryAt) : 0;
      const interval = rediscoveryIntervalMs(tConfig);
      if (Date.now() - lastTry < interval) {
        results.push({ slug: tConfig.slug, skipped: 'rediscovery-cooldown' });
        continue;
      }

      const probe = await probeForSchedule(tConfig);
      if (probe.matchesFound) {
        const f = probe.fullResult;
        await updateTournament(tConfig.slug, {
          source: {
            ...tConfig.source,
            matchListUrl: probe.matchListUrl || tConfig.source.matchListUrl,
            matchListVid: probe.vid || tConfig.source.matchListVid,
            tournamentId: f.source.tournamentId || tConfig.source.tournamentId,
          },
          dates: f.proposedDates,
          status: 'active',
          pendingTeamSelection: true,
          lastRediscoveryAt: new Date().toISOString(),
        });
        results.push({ slug: tConfig.slug, transitioned: 'awaiting-schedule → active', matches: 'TBD' });
        console.log(`[scrape] ${tConfig.slug} → active (schedule appeared)`);
      } else {
        await updateTournament(tConfig.slug, { lastRediscoveryAt: new Date().toISOString() });
        results.push({ slug: tConfig.slug, skipped: 'no-schedule-yet' });
      }
      continue;
    }

    // ─── active: scrapen oder transition zu completed ──────────────────
    if (tConfig.status === 'active') {
      const lastDate = tConfig.dates?.[tConfig.dates.length - 1];
      if (lastDate && today > addDays(lastDate, 1)) {
        await updateTournament(tConfig.slug, { status: 'completed' });
        results.push({ slug: tConfig.slug, transitioned: 'active → completed' });
        console.log(`[scrape] ${tConfig.slug} → completed (last day was ${lastDate})`);
        continue;
      }
      if (!isWithinTournamentWindow(tConfig, today)) {
        results.push({ slug: tConfig.slug, skipped: 'out-of-window' });
        continue;
      }

      try {
        const t0 = Date.now();
        const snapshot = await buildSnapshot(tConfig);
        const store = getStore('tournaments');
        await store.setJSON(`${tConfig.slug}/snapshot.json`, snapshot);
        const ms = Date.now() - t0;
        results.push({ slug: tConfig.slug, ok: true, ms, matches: snapshot.matches.length });
        console.log(`[scrape] ${tConfig.slug} OK in ${ms}ms · matches=${snapshot.matches.length}`);
      } catch (e) {
        results.push({ slug: tConfig.slug, ok: false, error: e?.message ?? String(e) });
        console.error(`[scrape] ${tConfig.slug} FAILED:`, e);
      }
    }
  }

  return new Response(JSON.stringify({ today, results }), {
    headers: { 'content-type': 'application/json' },
  });
};
