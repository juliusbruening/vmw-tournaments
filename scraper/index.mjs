// scraper/index.mjs (Phase 2)
//
// Dünner Dispatcher: delegiert an den richtigen Connector basierend auf
// config.connector. Die alte buildSnapshot-Logik ist jetzt in
// scraper/connectors/kayakers.mjs.
//
// Re-Export von buildSnapshot für Backwards-Compat mit force-scrape, scrape,
// und allen Tests, die sich auf scraper/index.mjs verlassen.

import { getConnector } from './connectors/index.mjs';

/**
 * @param {import('../lib/types.mjs').TournamentConfig} config
 * @param {object} [options]
 * @returns {Promise<import('../lib/types.mjs').Snapshot>}
 */
export async function buildSnapshot(config, options = {}) {
  const connector = getConnector(config.connector);
  if (!connector) {
    throw new Error(`Unbekannter Connector "${config.connector}" für Tournament "${config.slug}"`);
  }
  return connector.scrape(config, options);
}
