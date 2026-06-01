// lib/refereeLevels.mjs
//
// Konstanten für Schiedsrichter-Klassen + Rollen + Kategorien.
// Fixe Listen — ändern sich selten, daher kein Blob-Storage.

export const REFEREE_LEVELS = [
  { code: 'PLZ', label: 'PLZ', description: 'Prüfungslehrgangs-Zulassung', canRefMatch: false },
  { code: 'C',   label: 'C',   description: 'Schiri C-Lizenz',             canRefMatch: true  },
  { code: 'B',   label: 'B',   description: 'Schiri B-Lizenz',             canRefMatch: true  },
  { code: 'A',   label: 'A',   description: 'Schiri A-Lizenz',             canRefMatch: true  },
  { code: 'ICF', label: 'ICF', description: 'Internationale Lizenz',       canRefMatch: true  },
];

/**
 * Die 7 Rollen pro Spiel. Reihenfolge gleich der Anzeige im Picker.
 * `requiresRefMatch` heißt: nur Schiris mit `canRefMatch === true` (alle außer PLZ).
 */
export const ROLES = [
  { code: 'ref1',      label: '1. Schiedsrichter', short: '1.SR',  requiresRefMatch: true  },
  { code: 'ref2',      label: '2. Schiedsrichter', short: '2.SR',  requiresRefMatch: true  },
  { code: 'scorer',    label: 'Protokoll',         short: 'Prot',  requiresRefMatch: false },
  { code: 'timer',     label: 'Zeitnehmer',        short: 'Zeit',  requiresRefMatch: false },
  { code: 'shotclock', label: 'Shotclock',         short: 'Shot',  requiresRefMatch: false },
  { code: 'line1',     label: '1. Linienrichter',  short: 'Lin1',  requiresRefMatch: false },
  { code: 'line2',     label: '2. Linienrichter',  short: 'Lin2',  requiresRefMatch: false },
];

export const CATEGORIES = ['U14', 'U16', 'U21', 'Damen', 'Herren'];

/**
 * Darf der Schiri (gegeben seine Klasse) die angegebene Rolle übernehmen?
 */
export function canAssignRole(level, roleCode) {
  const role = ROLES.find(r => r.code === roleCode);
  if (!role) return false;
  if (!role.requiresRefMatch) return true;          // andere Rollen für alle erlaubt
  const lvl = REFEREE_LEVELS.find(l => l.code === level);
  return !!lvl?.canRefMatch;                         // ref1/ref2 nur für C/B/A/ICF
}
