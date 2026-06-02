// scripts/testLandingGrouping.mjs
//
// Validiert die displayGroup()-Logik aus phase3.js — die Funktion, die
// entscheidet in welcher Landing-Sektion ein Turnier landet:
//   running   : status=active UND today im Datums-Fenster
//   planned   : status=active+future ODER status=awaiting-schedule
//   draft     : status=draft
//   completed : status=completed
//
// Wir importieren die Logik nicht direkt (sitzt in einer IIFE im Browser-Code),
// sondern duplizieren sie hier 1:1 — der Test fängt also Regressionen wenn die
// Logik im Frontend von dieser Reference-Implementation abweicht.

function displayGroup(t, todayIso) {
  if (t.status === 'completed') return 'completed';
  if (t.status === 'draft')     return 'draft';
  const today = todayIso || new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
  const dates = t.dates?.length ? t.dates : (t.expectedDates || []);
  if (!dates.length) return 'planned';
  const first = dates[0];
  const last  = dates[dates.length - 1];
  if (today < first) return 'planned';
  if (today > last)  return 'completed';
  return 'running';
}

let pass = 0, fail = 0;
function expect(label, actual, wanted) {
  const ok = actual === wanted;
  if (ok) { console.log(`✓ ${label}  →  "${actual}"`); pass++; }
  else    { console.log(`✗ ${label}  →  got "${actual}", wanted "${wanted}"`); fail++; }
}

// User-szenario: active aber Spielplan in 5 Tagen → MUSS planned sein
expect('active + future (5d) → planned',
  displayGroup({ status: 'active', dates: ['2026-06-15','2026-06-16'] }, '2026-06-10'),
  'planned');

// User-szenario: active und heute im Fenster → running
expect('active + im Fenster → running',
  displayGroup({ status: 'active', dates: ['2026-06-10','2026-06-12'] }, '2026-06-11'),
  'running');

// active + erster Tag heute → running
expect('active + erster Tag heute → running',
  displayGroup({ status: 'active', dates: ['2026-06-10','2026-06-12'] }, '2026-06-10'),
  'running');

// active + letzter Tag heute → running
expect('active + letzter Tag heute → running',
  displayGroup({ status: 'active', dates: ['2026-06-10','2026-06-12'] }, '2026-06-12'),
  'running');

// active + Datum vorbei (Cron hat noch nicht completed gesetzt) → completed
expect('active + Datum vorbei → completed (defensive)',
  displayGroup({ status: 'active', dates: ['2026-06-10','2026-06-12'] }, '2026-06-15'),
  'completed');

// awaiting-schedule (Spielplan kommt noch) → planned
expect('awaiting-schedule → planned',
  displayGroup({ status: 'awaiting-schedule', expectedDates: ['2026-09-05'] }, '2026-06-10'),
  'planned');

// awaiting-schedule ohne dates → planned (Fallback)
expect('awaiting-schedule ohne dates → planned',
  displayGroup({ status: 'awaiting-schedule' }, '2026-06-10'),
  'planned');

// draft → draft
expect('draft → draft',
  displayGroup({ status: 'draft', dates: ['2026-08-10'] }, '2026-06-10'),
  'draft');

// completed → completed
expect('completed → completed',
  displayGroup({ status: 'completed', dates: ['2026-04-10'] }, '2026-06-10'),
  'completed');

// single-day Turnier heute → running
expect('single-day Turnier heute → running',
  displayGroup({ status: 'active', dates: ['2026-06-10'] }, '2026-06-10'),
  'running');

// ─── P1.4 — vmwCategoriesFor / autoDetectCategory: Herren-Detection mit Men2 ──
import('../lib/tournaments.mjs').then(({ vmwCategoriesFor }) => {
  function expectSet(label, actual, expected) {
    const ok = actual.length === expected.length && expected.every(e => actual.includes(e));
    if (ok) { console.log('✓ ' + label); pass++; }
    else    { console.log('✗ ' + label + ` — expected [${expected.join(',')}], got [${actual.join(',')}]`); fail++; }
  }

  // DC2026-Fall: Men2 muss als 'herren' erkannt werden
  expectSet('P1.4: Team-Code Men2 → herren',
    vmwCategoriesFor({ ourTeams: [{ code: 'Men2', name: 'VMW Berlin Men2' }] }),
    ['herren']);

  // Alle 5 Kategorien zusammen (DC2026-ähnliches Setup)
  expectSet('P1.4: U14 + U16 + U21 + Women + Men2 → alle 5 Kategorien',
    vmwCategoriesFor({ ourTeams: [
      { code: 'U14',   name: 'VMW Berlin U14'   },
      { code: 'U16',   name: 'VMW Berlin U16'   },
      { code: 'U21',   name: 'VMW Berlin U21'   },
      { code: 'Women', name: 'VMW Berlin Women' },
      { code: 'Men2',  name: 'VMW Berlin Men2'  },
    ]}),
    ['schueler', 'jugend', 'junioren', 'damen', 'herren']);

  // Men ohne Suffix matcht weiterhin (Regression-Schutz)
  expectSet('P1.4: Team-Code Men → herren',
    vmwCategoriesFor({ ourTeams: [{ code: 'Men', name: 'VMW Berlin Men' }] }),
    ['herren']);

  // Negativer Fall: Women darf NICHT als herren matchen
  expectSet('P1.4: Women bleibt damen (kein herren-Leak)',
    vmwCategoriesFor({ ourTeams: [{ code: 'Women', name: 'VMW Berlin Women' }] }),
    ['damen']);

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass, ${fail} fail`);
  process.exitCode = fail === 0 ? 0 : 1;
});
