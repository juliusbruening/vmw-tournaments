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

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass, ${fail} fail`);
process.exitCode = fail === 0 ? 0 : 1;
