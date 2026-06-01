// scripts/testTournamentLoader.mjs
// Validiert lib/tournaments.mjs ohne Annahme, dass eine spezifische Repo-Datei existiert.

import { getTournament, listTournaments } from '../lib/tournaments.mjs';

let pass = 0, fail = 0;
function expect(label, ok) {
  if (ok) { console.log('✓ ' + label); pass++; }
  else    { console.log('✗ ' + label); fail++; }
}

const missing = await getTournament('does-not-exist-2099');
expect('getTournament(unknown) → null', missing === null);

const all = await listTournaments();
expect('listTournaments() liefert Array', Array.isArray(all));
expect('listTournaments() läuft fehlerfrei (kann leer sein)', true);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass, ${fail} fail`);
process.exitCode = fail === 0 ? 0 : 1;
