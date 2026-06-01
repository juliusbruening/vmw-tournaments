// scraper/connectors/index.mjs
//
// Registry & Dispatcher für die Connector-Implementationen.
// Jeder Connector implementiert:
//
//   id:                string            // "kayakers" | "bundesligaKanupolio"
//   matchesUrl(url):   boolean           // ob die URL zu diesem Connector gehört
//   listAvailableTournaments(opts?):     // Tournament-Picker-Liste (Phase 2 UI)
//                      Promise<Array>
//   discover(url):     Promise<DiscoveryResult>   // siehe types.mjs
//   scrape(config):    Promise<Snapshot>          // siehe types.mjs

import { kayakersConnector } from './kayakers.mjs';
import { bundesligaKanupolioConnector } from './bundesligaKanupolio.mjs';

const CONNECTORS = [kayakersConnector, bundesligaKanupolioConnector];

export function getConnector(id) {
  return CONNECTORS.find(c => c.id === id) || null;
}

export function detectConnector(url) {
  return CONNECTORS.find(c => c.matchesUrl(url)) || null;
}

export function allConnectors() {
  return [...CONNECTORS];
}
