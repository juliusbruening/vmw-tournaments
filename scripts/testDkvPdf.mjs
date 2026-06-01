// scripts/testDkvPdf.mjs — generiert ein Test-PDF zur visuellen Prüfung
import { writeFile } from 'node:fs/promises';
import { generateEinsatzbogenPdf } from '../lib/dkvPdf.mjs';

const referee = {
  firstName: 'Julius',
  lastName:  'Brüning',
  level:     'B',
  street:    'Musterweg 12',
  zip:       '10115',
  city:      'Berlin',
  club:      'VMW Berlin Kanu-Polo',
  verband:   'KVN',
  phone:     '+49 170 1234567',
  ausweisNr: 'B-12345',
};

const events = [
  ['Deutschland Cup 2026',     'Men 1st class'],
  ['Bundesliga Herren Berlin', 'Men 1st class'],
  ['Hallen-Cup Hamburg',       'Women'],
  ['EM U21 Spanien',           'Men U21'],
  ['Jugend-Turnier Köln',      'Jugend U15'],
  ['Schüler-Pokal',            'Schüler U13'],
];
const roles = ['ref1', 'ref2', 'scorer', 'timer', 'shotclock', 'line1', 'line2'];

const entries = Array.from({ length: 42 }, (_, i) => {
  const [name, division] = events[i % events.length];
  return {
    date:            `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`,
    matchNr:         100 + i,
    tournamentName:  name,
    role:            roles[i % roles.length],
    division,
    notes:           i % 5 === 0 ? 'Nachgemeldet' : '',
  };
});

const bytes = await generateEinsatzbogenPdf({ referee, year: 2026, entries });
await writeFile('/tmp/dkv-test.pdf', bytes);
console.log('✓ Test-PDF geschrieben: /tmp/dkv-test.pdf');
console.log(`  Größe: ${bytes.length} Bytes, Einträge: ${entries.length}`);
