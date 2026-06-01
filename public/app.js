/* =========================================================
   VMW Live-App — Frontend (Phase 1: Multi-Turnier-aware)
   Pollt /api/data?slug=<slug> alle 60s, rendert 4 Tabs (Live, Spielplan, Teams, Hausliga).
   Schiri-Einteilung via /api/admin/refs?slug=<slug> mit Passwort-Header.
   ========================================================= */

const POLL_INTERVAL_MS = 60_000;

/* =========================================================
   SLUG-ERKENNUNG
   /t/<slug>/...     → slug aus URL
   /                 → "dc2026" als Default (Phase-1-Übergang)
   Phase 4 ersetzt den Default durch eine echte Landing-Page.
   ========================================================= */
function detectTournamentSlug() {
  const m = window.location.pathname.match(/^\/t\/([a-z0-9-]+)/i);
  return m ? m[1].toLowerCase() : null;
}
const CURRENT_SLUG = detectTournamentSlug();
window.CURRENT_SLUG = CURRENT_SLUG;
// CURRENT_SLUG === null bedeutet: keine /t/<slug>-Route (also /, /admin, /me/…).
// In diesem Fall übernimmt phase3.js das Bootstrap (Landing-Page / Login-Modal / Self-Service).
// app.js skippt fetchData unten, damit nicht parallel die DC2026-UI rendert.

/* =========================================================
   BEAMER-MODUS
   Aktiviert via ?beamer=1 in der URL. In dem Modus:
   - Tabbar + Admin-Icon verschwinden
   - "Heute"-Tab ist gelockt (kein Tab-Wechsel)
   - Schriftgrößen werden via CSS deutlich größer
   - "Mehr anzeigen"-Sektions automatisch offen
   - Wake-Lock verhindert Bildschirm-Sleep solange Tab aktiv ist
   ========================================================= */
const isBeamerMode = new URLSearchParams(window.location.search).get('beamer') === '1';
if (isBeamerMode){
  document.body.classList.add('beamer');
  // Bildschirm wachhalten (Chrome, Edge, neueres Safari unterstützen das)
  if ('wakeLock' in navigator){
    navigator.wakeLock.request('screen').catch(()=>{ /* still ok */ });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible'){
        navigator.wakeLock.request('screen').catch(()=>{});
      }
    });
  }
  // QR-Code für die Sharing-URL der App (ohne ?beamer=1) lazy laden
  const qrScript = document.createElement('script');
  qrScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
  qrScript.onload = () => {
    try {
      const shareUrl = location.origin + location.pathname; // ohne Query-Params
      const qr = window.qrcode(0, 'M'); // Type 0 = auto, Error-Correction M
      qr.addData(shareUrl);
      qr.make();
      // createSvgTag mit scalable=true → SVG füllt den Container, sieht scharf aus
      document.getElementById('qrCode').innerHTML = qr.createSvgTag({ scalable: true });
      document.getElementById('qrUrl').textContent = shareUrl.replace(/^https?:\/\//, '');
      document.getElementById('qrContainer').hidden = false;
    } catch (e){ /* QR fail = beamer mode trotzdem ok */ }
  };
  document.head.appendChild(qrScript);
}

// Eigene Teams — wird dynamisch aus config.ourTeams gefüllt (kommt mit /api/data).
// Bis der erste Fetch durch ist, leeres Array — Rendering hat Skeleton/Empty-States.
let TEAMS = [];
// Tournament-Dates (1-basierter Index → "YYYY-MM-DD"). Wird ebenfalls aus config.dates abgeleitet.
let TOURNAMENT_DATES = {};
// Aktuelle Tournament-Config (Subset). Frontend liest hier z.B. name, type, status.
let CURRENT_CONFIG = null;

function applyConfigToFrontend(uiConfig){
  if (!uiConfig) return;
  CURRENT_CONFIG = uiConfig;
  TEAMS = (uiConfig.ourTeams || []).map(t => ({
    code: t.code,
    short: t.short,
    pillLabel: t.pillLabel,
    name: t.name,
    division: divisionForCode(t.code),
  }));
  TOURNAMENT_DATES = {};
  (uiConfig.dates || []).forEach((d, i) => { TOURNAMENT_DATES[i + 1] = d; });

  // ─── Dynamische UI-Updates ─────────────────────────────────────────
  // 1) Header-Title aus config
  applyHeaderTitle(uiConfig);
  // 2) Tag-Switches aus config.dates (statt hardcoded Sa/So/Mo 23.-25. Mai)
  applyDaySwitches(uiConfig);
  // 3) Footer-Link aus config.source
  applyFooterLink(uiConfig);
  // 4) Hausliga-Tab ein/ausblenden je nach config.showHausliga
  applyHausligaVisibility(uiConfig);
  // 5) Team-Pills im Spielplan aus ourTeams
  applyTeamPills(uiConfig);
}

function applyHeaderTitle(uiConfig){
  const titleEl = document.querySelector('header.app .title');
  if (!titleEl) return;
  const dateRange = formatDateRange(uiConfig.dates || []);
  // BUGFIX_EXTERNES_TURNIER#D — Hierarchie umgedreht:
  // Auf einer Turnier-Seite ist der Turnier-Name die wichtigste Info. "VMW
  // Berlin" steckt schon im Logo daneben und gehört nicht in die primäre
  // Zeile. Reihenfolge jetzt:
  //   primär  → Turnier-Name (z.B. "Deutschland Cup 2026")
  //   small   → "VMW Berlin · 23.–25. Mai 2026"
  const primary = uiConfig.name || 'Turnier';
  const subtitle = 'VMW Berlin' + (dateRange ? ' · ' + dateRange : '');
  // Untertitel ist nowrap+ellipsis (CSS Code Review #12) — Full-Text als
  // title-Attribut für Hover/Long-Press, damit auf schmalen Viewports
  // nichts verloren geht.
  titleEl.innerHTML = `${escapeHtml(primary)}<small>${escapeHtml(subtitle)}</small>`;
  titleEl.title = primary;
  const smallEl = titleEl.querySelector('small');
  if (smallEl) smallEl.title = subtitle;
  document.title = uiConfig.name ? `${uiConfig.name} · VMW` : 'VMW Live-App';

  // Zurück-Button + Trainer-Login-Icon im Header injizieren falls noch nicht da
  const headerInner = document.querySelector('header.app .inner');
  if (headerInner && !headerInner.querySelector('.back-btn')) {
    const back = document.createElement('button');
    back.className = 'back-btn';
    back.title = 'Zurück zur Übersicht';
    back.innerHTML = '←';
    back.style.cssText = 'background:transparent;border:none;color:white;font-size:22px;padding:0 10px;cursor:pointer;margin-right:6px';
    back.onclick = () => { window.location.href = '/'; };
    headerInner.insertBefore(back, headerInner.firstChild);
  }
  // Altes Zahnrad-Icon umbinden auf Trainer-Login / Schiri-Einteilung (Turnier-Kontext)
  const menuBtn = document.querySelector('header.app .menu');
  if (menuBtn) {
    menuBtn.title = 'Schiri-Einteilung';
    menuBtn.onclick = (e) => {
      e.preventDefault();
      // Bereits eingeloggt als Trainer/Master? Direkt zur Einteilungs-Page.
      if (window.state.role === 'trainer' || window.state.role === 'master') {
        if (typeof window.openTournamentLineup === 'function') {
          window.openTournamentLineup(window.CURRENT_SLUG);
          return;
        }
      }
      // Sonst Login öffnen
      if (typeof window.openTrainerLogin === 'function') {
        window.openTrainerLogin();
      } else if (typeof window.openLogin === 'function') {
        window.openLogin();
      }
    };
  }
}

function formatDateRange(dates){
  if (!dates?.length) return '';
  const first = parseIsoDate(dates[0]);
  const last  = parseIsoDate(dates[dates.length - 1]);
  if (!first) return '';
  const month = first.toLocaleDateString('de-DE', { month: 'long', timeZone: 'Europe/Berlin' });
  if (dates.length === 1) {
    return `${first.getDate()}. ${month} ${first.getFullYear()}`;
  }
  if (last && last.getMonth() === first.getMonth() && last.getFullYear() === first.getFullYear()) {
    return `${first.getDate()}.–${last.getDate()}. ${month} ${first.getFullYear()}`;
  }
  return `${first.toLocaleDateString('de-DE', { day:'numeric', month:'short' })} – ${last.toLocaleDateString('de-DE', { day:'numeric', month:'short', year:'numeric' })}`;
}

function parseIsoDate(s){
  if (!s) return null;
  const d = new Date(s + 'T12:00:00+02:00');
  return isNaN(d.getTime()) ? null : d;
}

function applyDaySwitches(uiConfig){
  const dates = uiConfig.dates || [];
  for (const containerId of ['liveDaySwitch', 'planDaySwitch']) {
    const el = document.getElementById(containerId);
    if (!el) continue;
    el.innerHTML = '';
    dates.forEach((iso, i) => {
      const d = parseIsoDate(iso);
      if (!d) return;
      const day = i + 1;
      const weekday = d.toLocaleDateString('de-DE', { weekday: 'short', timeZone: 'Europe/Berlin' });
      const monthDay = d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', timeZone: 'Europe/Berlin' });
      const btn = document.createElement('button');
      btn.dataset.day = String(day);
      if (day === state.liveDay) btn.classList.add('active');
      btn.innerHTML = `${weekday}<small>${monthDay}</small>`;
      el.appendChild(btn);
    });
    // Click-Handler reattachen (alte Listener sind durch innerHTML weg)
    el.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        const key = containerId === 'liveDaySwitch' ? 'liveDay' : 'planDay';
        state[key] = Number(b.dataset.day);
        save(key, state[key]);
        if (containerId === 'liveDaySwitch') {
          state.liveExpand = { next:false, ref:false, done:false };
          renderLive();
        } else {
          renderPlan();
        }
      });
    });
  }
}

function applyFooterLink(uiConfig){
  const url = uiConfig.source?.matchListUrl
    ? `${uiConfig.source.matchListUrl}?day=1${uiConfig.source.matchListVid ? '&vid=' + uiConfig.source.matchListVid : ''}`
    : (uiConfig.source?.viewUrl || 'https://cpt.kayakers.nl/');
  document.querySelectorAll('.app-footer a[href*="kayakers"], .modal a[href*="kayakers"]').forEach(a => {
    a.href = url;
  });
}

function applyHausligaVisibility(uiConfig){
  const show = uiConfig.showHausliga === true;
  const hausTab = document.querySelector('.tabbar button[data-tab="haus"]');
  const hausPanel = document.getElementById('panel-haus');
  if (hausTab) hausTab.style.display = show ? '' : 'none';
  if (hausPanel) hausPanel.style.display = show ? '' : 'none';
  if (!show && state.tab === 'haus') {
    state.tab = 'live';
    save('tab', 'live');
  }
  // Tabbar-Layout: bei 3 statt 4 Tabs gleichmäßig verteilen
  const inner = document.querySelector('nav.tabbar .inner');
  if (inner) {
    const visibleTabs = inner.querySelectorAll('button:not([style*="display: none"])').length || 3;
    inner.style.gridTemplateColumns = `repeat(${visibleTabs}, 1fr)`;
  }
}

function applyDivisionPills(snapshot){
  const el = document.getElementById('planDivisionPills');
  if (!el || !snapshot?.matches) return;
  // Sammle alle Divisions die im Snapshot vorkommen, samt Original-Label.
  const map = new Map();   // code → label
  for (const m of snapshot.matches) {
    if (!m.division) continue;
    const code = m.divisionCode || m.division;
    if (!map.has(code)) {
      // Label vorzugsweise aus dem internen divisionLabel-Mapping, sonst Original
      const label = (typeof divisionLabel === 'function' ? divisionLabel(m.division) : null) || m.division;
      map.set(code, label);
    }
  }
  el.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.dataset.div = 'all';
  allBtn.textContent = 'Alle Klassen';
  el.appendChild(allBtn);
  // Sortierung: U14 → U16 → U21 → Women → Men1 → Men2 → Rest alphabetisch
  const order = ['U14','U16','U21','Women','Men1','Men2'];
  const sorted = [...map.entries()].sort((a,b) => {
    const ia = order.indexOf(a[0]); const ib = order.indexOf(b[0]);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a[1].localeCompare(b[1]);
  });
  sorted.forEach(([code, label]) => {
    const btn = document.createElement('button');
    btn.dataset.div = code;
    btn.textContent = label;
    el.appendChild(btn);
  });
  // Active-State + Click-Handler reattachen
  el.querySelectorAll('button').forEach(b => {
    if (b.dataset.div === state.planDivision) b.classList.add('active');
    b.addEventListener('click', () => {
      state.planDivision = b.dataset.div;
      save('spielplanDivision', state.planDivision);
      renderPlan();
    });
  });
}

function applyTeamPills(uiConfig){
  const teams = uiConfig.ourTeams || [];
  for (const containerId of ['planTeamPills', 'teamPills', 'scorerPills']) {
    const el = document.getElementById(containerId);
    if (!el) continue;
    el.innerHTML = '';
    if (containerId === 'planTeamPills' || containerId === 'scorerPills') {
      const allBtn = document.createElement('button');
      allBtn.dataset.team = 'all';
      allBtn.textContent = 'Alle' + (containerId === 'scorerPills' ? '' : ' Teams');
      el.appendChild(allBtn);
    }
    teams.forEach(t => {
      const btn = document.createElement('button');
      btn.dataset.team = t.code;
      btn.textContent = t.pillLabel || t.code;
      el.appendChild(btn);
    });

    // active-State + Click-Handler — pro Container die richtige Render-Funktion + State-Key
    const stateKey = containerId === 'planTeamPills' ? 'planFilter'
                   : containerId === 'teamPills'     ? 'teamView'
                   :                                    'scorerFilt';
    const storageKey = containerId === 'planTeamPills' ? 'spielplanFilter'
                     : containerId === 'teamPills'     ? 'teamsView'
                     :                                    'scorersFilter';
    const renderFn = containerId === 'planTeamPills' ? renderPlan
                   : containerId === 'teamPills'     ? renderTeams
                   :                                    renderHausliga;

    el.querySelectorAll('button').forEach(b => {
      if (b.dataset.team === state[stateKey]) b.classList.add('active');
      b.addEventListener('click', () => {
        state[stateKey] = b.dataset.team;
        save(storageKey, b.dataset.team);
        // teamView (Teams-Tab) hat keinen "all"-Modus — falls null/all, ersten Code nehmen
        if (containerId === 'teamPills' && b.dataset.team === 'all' && teams[0]) {
          state.teamView = teams[0].code;
        }
        renderFn();
      });
    });
  }
}

// Helper: Code → kanonische Division (für TEAMS.division-Fallback)
function divisionForCode(code){
  switch (code) {
    case 'U14':   return 'Pupils U14';
    case 'U16':   return 'Youth U16';
    case 'U21':   return 'Men U21';
    case 'Women': return 'Women';
    case 'Men1':  return 'Men 1st class';
    case 'Men2':  return 'Men 2nd class';
    default:      return '';
  }
}

/* =========================================================
   STATE
   ========================================================= */
// Heutigen Turniertag einmalig beim App-Start bestimmen.
// Wenn im localStorage ein vergangener Tag gespeichert ist (z.B. Sa von gestern,
// heute ist So), wird er verworfen und auf heute zurückgesetzt.
// Manuell vorausgewählte zukünftige Tage bleiben aber erhalten.
const _todayDay = todayTournamentDay();
function pickInitialDay(key){
  const stored = Number(localStorage.getItem(key));
  return (stored && stored >= _todayDay) ? stored : _todayDay;
}

const state = {
  tab:        localStorage.getItem('vmw.tab') || 'live',
  liveDay:    pickInitialDay('vmw.liveDay'),
  planDay:    pickInitialDay('vmw.planDay'),
  planScope:  localStorage.getItem('vmw.planScope')  || 'vmw',
  planFilter: localStorage.getItem('vmw.spielplanFilter') || 'all',
  planDivision: localStorage.getItem('vmw.spielplanDivision') || 'all',
  planPastOpen: false,
  teamView:   localStorage.getItem('vmw.teamsView') || 'Women',
  teamsPastOpen: false,
  teamsRefPastOpen: false,
  scorerFilt: localStorage.getItem('vmw.scorersFilter') || 'all',
  scorersAllVisible: false,
  // Auto-Expansion ist in beiden Modi aus — Beamer cappt selbst auf 3 pro Spalte.
  liveExpand: { next:false, ref:false, done:false },
  adminPassword: localStorage.getItem('vmw.adminPwd') || null,
  adminFilter: localStorage.getItem('vmw.adminFilter') || 'all',
  // remote
  snapshot: null,
  refs: {},
  lastFetchOk: 0,
  lastFetchAt: 0,
  fetchError: null,
  pollTimer: null,   // setInterval-Handle; wird gecleart sobald wir extern detecten
};
function save(k,v){ localStorage.setItem('vmw.'+k, v); }
// State global verfügbar machen, damit phase3.js (Picker, Profil, Master-Admin) darauf zugreifen kann.
window.state = state;
function todayTournamentDay(){
  // Tagesnummer auf Basis der Berliner Lokalzeit + TOURNAMENT_DATES.
  // Vor Turnier (heute < erster Tag): Day 1
  // Während Turnier: Index in TOURNAMENT_DATES
  // Nach Turnier (heute > letzter Tag): letzter Tag
  // Fallback bei fehlenden TOURNAMENT_DATES: Day 1
  const dates = (Array.isArray(window.TOURNAMENT_DATES) ? window.TOURNAMENT_DATES : []);
  if (!dates.length) return 1;
  const ymd = new Date().toLocaleDateString('en-CA', { timeZone:'Europe/Berlin' });
  const idx = dates.indexOf(ymd);
  if (idx >= 0) return idx + 1;
  if (ymd < dates[0]) return 1;
  return dates.length;
}

/* =========================================================
   HELPERS
   ========================================================= */
function teamByCode(c){ return TEAMS.find(t=>t.code===c) }
function isVmw(name){ return /VMW Berlin/i.test(name||'') }
function matchSortKey(m){ return Number((m.time||'00:00').replace(':','')) }
function vmwRoleFor(m){ if(m.ourTeam) return 'spielt'; if(m.ourReferee) return 'pfeift'; return null }

// Mapping kayakers-Division → Code
function divisionCode(division){
  if(!division) return null;
  if(/Pupils|U14/i.test(division)) return 'U14';
  if(/Youth|U16/i.test(division))  return 'U16';
  if(/U21/i.test(division))        return 'U21';
  if(/Women/i.test(division))      return 'Women';
  if(/1st class/i.test(division))  return 'Men1';
  if(/2nd class/i.test(division))  return 'Men2';
  return null;
}
function divisionLabel(division){
  const c = divisionCode(division);
  return ({U14:'U14',U16:'U16',U21:'U21',Women:'Damen',Men1:'Herren 1',Men2:'Herren 2'})[c] || division || '';
}
function displayName(rawName, vmwCode){
  if(vmwCode){
    const t = teamByCode(vmwCode);
    if(t) return t.short;
  }
  return rawName;
}
// Nutzt aktuelle Berliner Uhrzeit, um "Vergangenheit/Zukunft" zu bestimmen.
function isPast(m){
  if(m.status==='done') return true;
  if(m.status==='live') return false;
  if(!m.time) return false;
  const cur = currentBerlinDayAndTime();
  if (m.day < cur.day) return true;
  if (m.day > cur.day) return false;
  return m.time < cur.time;
}
function currentBerlinDayAndTime(){
  const now = new Date();
  const ymd = now.toLocaleDateString('en-CA', { timeZone:'Europe/Berlin' }); // YYYY-MM-DD
  const hm  = now.toLocaleTimeString('de-DE',  { timeZone:'Europe/Berlin', hour:'2-digit', minute:'2-digit', hour12:false });
  const day = ymd === '2026-05-23' ? 1 : ymd === '2026-05-24' ? 2 : ymd === '2026-05-25' ? 3 : (ymd < '2026-05-23' ? 0 : 4);
  return { day, time: hm };
}
// Liefert alle Matches innerhalb der ersten N Zeit-Slots der Liste.
// (Liste muss schon nach Zeit sortiert sein — ascending für "Nächste", descending für "Beendete".)
// Beispiel: bei [11:00, 11:00, 11:30, 12:00] und slotCap=2 → drei Matches (zwei aus 11:00 + eines aus 11:30).
function takeTopTimeSlots(list, slotCap){
  const seen = new Set();
  const out = [];
  for (const m of list){
    if (!seen.has(m.time)){
      if (seen.size >= slotCap) break;
      seen.add(m.time);
    }
    out.push(m);
  }
  return out;
}

// Gruppiert Matches nach Uhrzeit. desc=true → späteste Zeit zuerst
// (für "Gerade beendet": der jüngste Block soll oben stehen).
function groupByTime(list, { desc = false } = {}){
  const map = new Map();
  list.forEach(m=>{
    const t = m.time || '00:00';
    if(!map.has(t)) map.set(t, []);
    map.get(t).push(m);
  });
  for(const arr of map.values()) arr.sort((a,b)=>Number(a.pitch)-Number(b.pitch));
  const entries = Array.from(map.entries());
  entries.sort((a,b)=>{
    const da = Number(a[0].replace(':','')), db = Number(b[0].replace(':',''));
    return desc ? db - da : da - db;
  });
  return entries;
}
function refsFor(matchNr){
  // Phase-3-Rollen-Assignments (neu) zuerst — wenn da, ins Players-Array
  // mappen, damit die Anzeige im Live-/Plan-Tab funktioniert.
  const rolesEntry = state.assignments?.[matchNr] || state.assignments?.[String(matchNr)];
  if (rolesEntry?.roles) {
    const refById = new Map((state.referees || []).map(r => [r.id, r]));
    const ROLE_ORDER = ['ref1', 'ref2', 'scorer', 'timer', 'shotclock', 'line1', 'line2'];
    const SHORTS = {
      ref1: '1.SR', ref2: '2.SR', scorer: 'Prot.', timer: 'Zeit',
      shotclock: 'Shot', line1: '1.Lin', line2: '2.Lin',
    };
    const players = [];
    for (const code of ROLE_ORDER) {
      const refId = rolesEntry.roles[code];
      if (!refId) continue;
      const ref = refById.get(refId);
      const name = ref?.displayName || ref?.firstName || '?';
      players.push(`${SHORTS[code]}: ${name}`);
    }
    if (players.length) return players;
  }
  // Fallback: Phase-1 Legacy-Refs (freie Spielernamen)
  const entry = state.refs[matchNr] || state.refs[String(matchNr)];
  return entry?.players ?? null;
}
function refPills(arr){
  if(!arr || !arr.length) return `<span class="refs-empty">— noch nicht eingeteilt</span>`;
  return arr.map(p=>`<span class="ref-pill">${escapeHtml(p)}</span>`).join('');
}
function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* =========================================================
   CARDS
   ========================================================= */
function scoreHtml(m){
  if(m.score && m.score.a != null && m.score.b != null){
    const cls = m.status==='live' ? 'score live' : 'score';
    return `<span class="${cls}">${m.score.a}<span style="color:var(--ink-3);margin:0 4px">:</span>${m.score.b}</span>`;
  }
  return `<span class="vs">– vs –</span>`;
}
function statusBadgeHtml(m){
  if(m.status==='live') return `<span class="badge live"><span class="pulse-dot" style="background:#0E7C3A"></span>Live</span>`;
  if(m.status==='done') return `<span class="badge done">Beendet</span>`;
  return '';
}

function liveCard(m){
  const role = vmwRoleFor(m);
  const cls = ['card'];
  if(m.status==='live') cls.push('live');
  if(role==='spielt') cls.push('spielt');
  else if(role==='pfeift') cls.push('pfeift');

  // Schiri-Karte: anderes Layout — VMW prominent, Gegner-Paarung als dezente Sekundärinfo.
  // Damit Schiri-Karten nicht durch die Match-Paarung der fremden Teams größer
  // wirken als VMW-Spielkarten.
  if (role === 'pfeift'){
    const t = teamByCode(m.ourReferee);
    return `
      <div class="${cls.join(' ')}">
        <div class="match-top">
          <span class="pitch">F${escapeHtml(String(m.pitch))}</span>
          <span class="division-chip">${escapeHtml(divisionLabel(m.division))}</span>
        </div>
        <div class="pfeift-headline">
          <span class="icon">⚖️</span> ${t?.short || 'VMW'} <span class="weak">pfeift</span>
        </div>
        <div class="pfeift-subline">
          ${escapeHtml(m.teamA?.name||'')} <span class="vs">vs</span> ${escapeHtml(m.teamB?.name||'')}
        </div>
        <div class="refs">${refPills(refsFor(m.nr))}</div>
      </div>`;
  }

  // Normale Spielkarte
  const nameA = displayName(m.teamA?.name, isVmw(m.teamA?.name)?m.ourTeam:null);
  const nameB = displayName(m.teamB?.name, isVmw(m.teamB?.name)?m.ourTeam:null);
  const aCls  = isVmw(m.teamA?.name) ? 'team vmw' : 'team';
  const bCls  = isVmw(m.teamB?.name) ? 'team vmw right' : 'team right';

  return `
    <div class="${cls.join(' ')}">
      <div class="match-top">
        <span class="pitch">F${escapeHtml(String(m.pitch))}</span>
        <span class="division-chip">${escapeHtml(divisionLabel(m.division))}</span>
        ${statusBadgeHtml(m)}
      </div>
      <div class="match-teams">
        <span class="${aCls}">${escapeHtml(nameA||'')}</span>
        ${scoreHtml(m)}
        <span class="${bCls}">${escapeHtml(nameB||'')}</span>
      </div>
    </div>`;
}

function planCard(m, opts={}){
  const role = vmwRoleFor(m);
  const past = isPast(m);
  const cls = ['card','compact'];
  if(m.status==='live') cls.push('live');
  if(past) cls.push('past');
  if(role==='spielt') cls.push('spielt');
  else if(role==='pfeift') cls.push('pfeift');

  const nameA = displayName(m.teamA?.name, isVmw(m.teamA?.name)?m.ourTeam:null);
  const nameB = displayName(m.teamB?.name, isVmw(m.teamB?.name)?m.ourTeam:null);
  const aCls  = isVmw(m.teamA?.name) ? 'team vmw' : 'team';
  const bCls  = isVmw(m.teamB?.name) ? 'team vmw right' : 'team right';

  let juryBlock = '';
  if(role==='pfeift'){
    const t = teamByCode(m.ourReferee);
    juryBlock = `
      <div class="pfeift-row"><span class="icon">⚖️</span> ${t?.short || 'VMW'} pfeift</div>
      <div class="refs">${refPills(refsFor(m.nr))}</div>`;
  } else if(opts.showJury){
    juryBlock = `<div class="jury-row">Schiri: <strong>${escapeHtml(m.jury?.name || '—')}</strong></div>`;
  }

  return `
    <div class="${cls.join(' ')}">
      <div class="match-top">
        <span class="pitch">F${escapeHtml(String(m.pitch))}</span>
        <span class="division-chip">${escapeHtml(divisionLabel(m.division))}${m.group && m.group!=='Final'?` · ${escapeHtml(m.group)}`:''}${m.group==='Final'?' · Final':''}</span>
        ${statusBadgeHtml(m)}
      </div>
      <div class="match-teams">
        <span class="${aCls}">${escapeHtml(nameA||'')}</span>
        ${scoreHtml(m)}
        <span class="${bCls}">${escapeHtml(nameB||'')}</span>
      </div>
      ${juryBlock}
    </div>`;
}

function teamLiteCard(m){
  const past = isPast(m);
  const cls = ['card','compact'];
  if(m.status==='live') cls.push('live');
  if(past) cls.push('past');

  const nameA = displayName(m.teamA?.name, isVmw(m.teamA?.name)?m.ourTeam:null);
  const nameB = displayName(m.teamB?.name, isVmw(m.teamB?.name)?m.ourTeam:null);
  const aCls  = isVmw(m.teamA?.name) ? 'team vmw' : 'team';
  const bCls  = isVmw(m.teamB?.name) ? 'team vmw right' : 'team right';

  return `
    <div class="${cls.join(' ')}">
      <div class="match-top">
        <span class="time">Tag ${m.day} · ${escapeHtml(m.time||'')}</span>
        <span class="pitch">F${escapeHtml(String(m.pitch))}</span>
        ${statusBadgeHtml(m)}
      </div>
      <div class="match-teams">
        <span class="${aCls}">${escapeHtml(nameA||'')}</span>
        ${scoreHtml(m)}
        <span class="${bCls}">${escapeHtml(nameB||'')}</span>
      </div>
    </div>`;
}
function teamRefLiteCard(m){
  const past = isPast(m);
  const cls = ['card','compact','pfeift'];
  if(past) cls.push('past');

  return `
    <div class="${cls.join(' ')}">
      <div class="match-top">
        <span class="time">Tag ${m.day} · ${escapeHtml(m.time||'')}</span>
        <span class="pitch">F${escapeHtml(String(m.pitch))}</span>
      </div>
      <div style="font-size:13.5px;font-weight:600;margin-top:2px">pfeift <strong>${escapeHtml(m.teamA?.name||'')} vs ${escapeHtml(m.teamB?.name||'')}</strong></div>
      <div class="refs" style="margin-top:6px">${refPills(refsFor(m.nr))}</div>
    </div>`;
}

/* =========================================================
   RENDER: VMW LIVE
   ========================================================= */
function renderLive(){
  if (!state.snapshot){
    setLiveSections([], [], [], []);
    return;
  }
  // Empty-Snapshot-Fallback: kayakers-Turnier ohne Spielplan → friendly Hinweis
  // statt leere Listen, plus Link zur Schiri-Einteilung (Hybrid-Modus).
  if (!state.snapshot.matches || state.snapshot.matches.length === 0) {
    const live = document.getElementById('liveLive');
    const next = document.getElementById('liveNext');
    if (live) {
      live.innerHTML = '<div style="padding:24px;background:#fff;border:1px dashed #d1d5db;border-radius:12px;text-align:center;color:#6b7280;font-size:13px">'
        + '<div style="font-size:32px;margin-bottom:8px">📋</div>'
        + '<div style="font-weight:500;color:#111;margin-bottom:4px">Spielplan steht noch nicht</div>'
        + '<div style="font-size:12px">Wir checken regelmäßig, ob kayakers den Plan veröffentlicht hat. '
        + 'Du kannst trotzdem schon Schiri-Einsätze manuell pflegen.</div>'
        + '<button class="p3-btn primary" style="margin-top:12px" onclick="window.openTournamentLineup && window.openTournamentLineup(window.CURRENT_SLUG)">'
        + '→ Zur Schiri-Einteilung</button>'
        + '</div>';
    }
    if (next) next.innerHTML = '';
    return;
  }
  // Im Beamer-Modus immer auf den aktuellen Turniertag syncen
  // (greift beim 60s-Polling — Mitternachts-Tagewechsel passt sich automatisch an)
  if (isBeamerMode){
    const today = todayTournamentDay();
    if (today !== state.liveDay) state.liveDay = today;
  }
  const day = state.liveDay;
  document.querySelectorAll('#liveDaySwitch button').forEach(b=>{
    b.classList.toggle('active', Number(b.dataset.day)===day);
  });
  const all = state.snapshot.matches.filter(m=>m.day===day);

  const live = all.filter(m=> m.status==='live' && (m.ourTeam || m.ourReferee));
  const next = all.filter(m=> m.status==='next' && m.ourTeam).sort((a,b)=>matchSortKey(a)-matchSortKey(b));
  const refs = all.filter(m=> m.status==='next' && m.ourReferee).sort((a,b)=>matchSortKey(a)-matchSortKey(b));
  const done = all.filter(m=> m.status==='done' && m.ourTeam).sort((a,b)=>matchSortKey(b)-matchSortKey(a));

  setLiveSections(live, next, refs, done);
}
function setLiveSections(live, next, refs, done){
  document.getElementById('liveNowCount').textContent = live.length;
  document.getElementById('liveNowList').innerHTML = live.length
    ? renderGroupedByTime(live)
    : `<div class="empty">Gerade kein VMW-Spiel live.</div>`;

  // Einheitlicher Cap = 4 ZEIT-SLOTS für alle Sektionen.
  // Beispiel: 2 Spiele um 11:00 + 1 Spiel um 11:30 + 1 Spiel um 12:00 + 1 Spiel um 12:30 = 5 Karten in 4 Slots,
  // also alle fünf werden gezeigt. Mehr Slots = "Mehr anzeigen"-Button (auf dem Handy).
  renderExpandableSection('liveNextList','liveNextMore','liveNextCount', next, 'next', `<div class="empty">Keine weiteren VMW-Spiele heute.</div>`, 4);
  renderExpandableSection('liveRefList','liveRefMore','liveRefCount', refs, 'ref',  `<div class="empty">Heute keine Schiri-Einsätze mehr.</div>`, 4);
  // "Gerade beendet": desc=true → jüngste Zeit-Blöcke oben, damit man wirklich
  // die zuletzt beendeten Spiele sieht (sonst Reihenfolge ab Tagesbeginn).
  renderExpandableSection('liveDoneList','liveDoneMore','liveDoneCount', done, 'done', `<div class="empty">Noch keine VMW-Spiele beendet.</div>`, 4, { desc: true });
}

// Rendert Match-Liste mit Zeit-Block-Headern (wie im Spielplan)
// Jeder Zeit-Block ist in einen .time-block-cards Container gewrappt,
// damit Beamer-Modus dort ein Multi-Column-Grid drauf legen kann.
function renderGroupedByTime(list, { desc = false } = {}){
  const groups = groupByTime(list, { desc });
  return groups.map(([time, items]) => {
    const isLiveBlock = items.some(m => m.status==='live');
    return `
      <div class="time-block">
        <div class="time-block-h ${isLiveBlock?'live-block':''}">
          <span>${escapeHtml(time)} Uhr</span>
          <span class="cnt">${items.length}</span>
        </div>
        <div class="time-block-cards">
          ${items.map(liveCard).join('')}
        </div>
      </div>`;
  }).join('');
}

function renderExpandableSection(listId, moreBtnId, countId, list, key, emptyHtml, slotCap=3, opts={}){
  document.getElementById(countId).textContent = list.length;
  const listEl = document.getElementById(listId);
  const moreEl = document.getElementById(moreBtnId);
  if (!list.length){
    listEl.innerHTML = emptyHtml;
    moreEl.hidden = true;
    return;
  }
  const expanded = state.liveExpand[key];
  const visible = expanded ? list : takeTopTimeSlots(list, slotCap);
  // desc=true rendert die Zeit-Blöcke absteigend — wichtig für "Gerade beendet",
  // damit die jüngsten beendeten Spiele oben stehen.
  listEl.innerHTML = renderGroupedByTime(visible, { desc: !!opts.desc });
  const hidden = list.length - visible.length;
  if (hidden > 0){
    moreEl.hidden = false;
    moreEl.textContent = expanded ? '× Weniger anzeigen' : `▾ Weitere ${hidden} anzeigen`;
  } else {
    moreEl.hidden = true;
  }
}

/* =========================================================
   RENDER: SPIELPLAN
   ========================================================= */
function renderPlan(){
  const day = state.planDay;
  const scope = state.planScope;
  const f = state.planFilter;
  const df = state.planDivision;

  document.querySelectorAll('#planDaySwitch button').forEach(b=>{
    b.classList.toggle('active', Number(b.dataset.day)===day);
  });
  document.querySelectorAll('#scopeSeg button').forEach(b=>{
    b.classList.toggle('active', b.dataset.scope===scope);
  });
  document.querySelectorAll('#planTeamPills button').forEach(b=>{
    b.classList.toggle('active', b.dataset.team===f);
  });
  document.querySelectorAll('#planDivisionPills button').forEach(b=>{
    b.classList.toggle('active', b.dataset.div===df);
  });
  document.getElementById('planTeamPills').style.display     = scope==='vmw' ? '' : 'none';
  document.getElementById('planDivisionPills').style.display = scope==='vmw' ? 'none' : '';

  const out = document.getElementById('planList');
  if (!state.snapshot){
    out.innerHTML = `<div class="loading-skel">Lade Spielplan …</div>`;
    return;
  }

  let list = state.snapshot.matches.filter(m=>m.day===day);
  if(scope==='vmw'){
    list = list.filter(m=>m.ourTeam || m.ourReferee);
    if(f!=='all') list = list.filter(m=>m.ourTeam===f || m.ourReferee===f);
  } else {
    if(df!=='all') list = list.filter(m=>divisionCode(m.division)===df);
  }
  list.sort((a,b)=>matchSortKey(a)-matchSortKey(b));

  if(!list.length){
    out.innerHTML = `<div class="empty">Keine Spiele für diese Auswahl.</div>`;
    return;
  }

  const isCurrentDay = day === currentBerlinDayAndTime().day;
  const past = list.filter(m=>isPast(m));
  const future = list.filter(m=>!isPast(m));
  const showJury = scope==='all';

  function renderBlock(blockMatches){
    const groups = groupByTime(blockMatches);
    return groups.map(([time, matches])=>{
      const isLiveBlock = matches.some(m=>m.status==='live');
      return `
        <div class="time-block-h ${isLiveBlock?'live-block':''}">
          <span>${escapeHtml(time)} Uhr</span>
          <span class="cnt">${matches.length}</span>
        </div>
        ${matches.map(m=>planCard(m,{showJury})).join('')}`;
    }).join('');
  }

  let html = '';
  if(isCurrentDay && past.length){
    html += `
      <button class="past-toggle ${state.planPastOpen?'open':''}" id="pastToggle">
        <span class="arrow">▶</span>
        <span>Beendete Spiele</span>
        <span class="cnt">${past.length}</span>
      </button>`;
    if(state.planPastOpen) html += `<div style="opacity:.85">${renderBlock(past)}</div>`;
  } else if(!isCurrentDay){
    html += renderBlock(list);
  }

  if(isCurrentDay){
    if(future.length){
      html += `<div class="now-divider"><span class="dot"></span>jetzt<span class="dot"></span></div>`;
      html += renderBlock(future);
    } else {
      html += `<div class="now-divider" style="opacity:.6"><span class="dot"></span>alle Spiele beendet<span class="dot"></span></div>`;
    }
  }

  out.innerHTML = html;
  const pt = document.getElementById('pastToggle');
  if(pt) pt.addEventListener('click', ()=>{ state.planPastOpen = !state.planPastOpen; renderPlan(); });
}

/* =========================================================
   RENDER: TEAMS
   ========================================================= */
function teamStats(code){
  if (!state.snapshot) return { Sp:0, W:0, D:0, L:0, GF:0, GA:0, GD:0, P:0, PPG:0 };
  const games = state.snapshot.matches.filter(m=>m.ourTeam===code && m.status==='done' && m.score?.a!=null);
  let W=0,D=0,L=0,GF=0,GA=0;
  games.forEach(m=>{
    const our   = isVmw(m.teamA?.name) ? m.score.a : m.score.b;
    const their = isVmw(m.teamA?.name) ? m.score.b : m.score.a;
    GF+=our; GA+=their;
    if(our>their) W++; else if(our<their) L++; else D++;
  });
  const Sp=games.length, P=W*3+D, PPG=Sp>0?P/Sp:0;
  return { Sp, W, D, L, GF, GA, GD:GF-GA, P, PPG };
}
function splitPastFuture(list){
  return { past: list.filter(m=>isPast(m)), future: list.filter(m=>!isPast(m)) };
}
function renderTeams(){
  const code = state.teamView;
  document.querySelectorAll('#teamPills button').forEach(b=>{
    b.classList.toggle('active', b.dataset.team===code);
  });
  const team = teamByCode(code);
  const out = document.getElementById('teamDetail');
  if (!state.snapshot){
    out.innerHTML = `<div class="loading-skel">Lade Team-Daten …</div>`;
    return;
  }

  const teamMatches = state.snapshot.matches
    .filter(m=>m.ourTeam===code)
    .sort((a,b)=>(a.day*1e4+matchSortKey(a))-(b.day*1e4+matchSortKey(b)));
  const refMatches  = state.snapshot.matches
    .filter(m=>m.ourReferee===code)
    .sort((a,b)=>(a.day*1e4+matchSortKey(a))-(b.day*1e4+matchSortKey(b)));
  const remoteTeam = state.snapshot.teams.find(t=>t.code===code);
  const roster = remoteTeam?.roster || [];
  const s = teamStats(code);
  const goalsTotal = roster.reduce((sum,p)=>sum+(p.goals||0),0);

  const tm = splitPastFuture(teamMatches);
  const rf = splitPastFuture(refMatches);

  const bilanzTable = `
    <div class="table-wrap">
      <table class="t">
        <thead><tr>
          <th>Sp</th><th>S</th><th>U</th><th>N</th>
          <th>Tore</th><th>Diff</th><th>Pkt</th><th>PPG</th>
        </tr></thead>
        <tbody><tr>
          <td>${s.Sp}</td><td>${s.W}</td><td>${s.D}</td><td>${s.L}</td>
          <td>${s.GF}:${s.GA}</td><td>${s.GD>=0?'+':''}${s.GD}</td>
          <td><strong>${s.P}</strong></td>
          <td class="ppg">${s.Sp>0 ? s.PPG.toFixed(2) : '—'}</td>
        </tr></tbody>
      </table>
    </div>`;

  function matchesSection(label, icon, future, past, openState, toggleId, cardFn){
    let html = `<h3 class="section">${icon} ${label} <span class="count">${(future.length+past.length)}</span></h3>`;
    if(past.length){
      html += `
        <button class="past-toggle ${openState?'open':''}" id="${toggleId}">
          <span class="arrow">▶</span>
          <span>Vergangene</span>
          <span class="cnt">${past.length}</span>
        </button>`;
      if(openState) html += past.map(cardFn).join('');
    }
    if(future.length){
      html += future.map(cardFn).join('');
    } else if(!past.length){
      html += `<div class="empty">Keine ${label.toLowerCase()} geplant.</div>`;
    }
    return html;
  }

  out.innerHTML = `
    <div style="background:#fff;border-radius:var(--radius);box-shadow:var(--shadow);padding:14px 14px 12px;margin-bottom:14px">
      <div style="font-size:13px;color:var(--ink-3);font-weight:600">${escapeHtml(divisionLabel(team.division))}</div>
      <div style="font-size:20px;font-weight:800;color:var(--vmw-red);margin-top:2px">${escapeHtml(team.name)}</div>
    </div>

    <h3 class="section">📊 Bilanz</h3>
    ${bilanzTable}

    ${matchesSection('Spiele','📅', tm.future, tm.past, state.teamsPastOpen, 'teamsPastToggle', teamLiteCard)}
    ${matchesSection('Schiri-Einsätze','🟠', rf.future, rf.past, state.teamsRefPastOpen, 'teamsRefPastToggle', teamRefLiteCard)}

    <h3 class="section">👤 Kader & Tore <span class="count">${goalsTotal} Tore</span></h3>
    <div class="table-wrap" style="padding:0">
      ${roster.length === 0
        ? `<div class="empty" style="border-radius:0">Noch kein Kader hinterlegt.</div>`
        : roster.map(p=>`
        <div class="roster-row">
          <div class="nr">${p.nr}</div>
          <div class="name ${p.name?'':'empty'}">${p.name ? escapeHtml(p.name) : '— Vorname nicht hinterlegt —'}</div>
          <div class="goals">${p.goals||0}<small>Tore</small></div>
        </div>`).join('')}
    </div>
  `;
  const pt = document.getElementById('teamsPastToggle');
  if(pt) pt.addEventListener('click', ()=>{ state.teamsPastOpen = !state.teamsPastOpen; renderTeams(); });
  const rt = document.getElementById('teamsRefPastToggle');
  if(rt) rt.addEventListener('click', ()=>{ state.teamsRefPastOpen = !state.teamsRefPastOpen; renderTeams(); });
}

/* =========================================================
   RENDER: HAUSLIGA
   ========================================================= */
function computeHausliga(){
  return TEAMS.map(t=>({ code:t.code, pillLabel:t.pillLabel, ...teamStats(t.code) }))
    .sort((a,b)=> b.PPG-a.PPG || b.GD-a.GD);
}
function renderHausliga(){
  const tbody = document.querySelector('#hausligaTable tbody');
  const rows = computeHausliga();
  tbody.innerHTML = rows.map((r,i)=>`
    <tr>
      <td class="rank">${i+1}</td>
      <td class="team-cell">${r.pillLabel}</td>
      <td>${r.Sp}</td><td>${r.W}</td><td>${r.D}</td><td>${r.L}</td>
      <td>${r.GF}:${r.GA}</td><td>${r.GD>=0?'+':''}${r.GD}</td><td><strong>${r.P}</strong></td>
      <td class="ppg">${r.Sp>0 ? r.PPG.toFixed(2) : '—'}</td>
    </tr>`).join('');

  const f = state.scorerFilt;
  document.querySelectorAll('#scorerPills button').forEach(b=>{
    b.classList.toggle('active', b.dataset.team===f);
  });

  let scorers = [];
  TEAMS.forEach(t=>{
    if(f!=='all' && t.code!==f) return;
    const remoteTeam = state.snapshot?.teams.find(x=>x.code===t.code);
    (remoteTeam?.roster || []).forEach(p=>scorers.push({ ...p, team:t.pillLabel, code:t.code }));
  });
  scorers = scorers.filter(s=>(s.goals||0)>0).sort((a,b)=>(b.goals||0)-(a.goals||0));

  const out = document.getElementById('scorersList');
  const moreBtn = document.getElementById('scorersMoreBtn');

  if(!scorers.length){
    out.innerHTML = `<div class="empty" style="border-radius:var(--radius)">Noch keine Tore in dieser Auswahl.</div>`;
    moreBtn.style.display = 'none';
    return;
  }
  const visible = state.scorersAllVisible ? scorers : scorers.slice(0,10);
  out.innerHTML = visible.map((s,i)=>`
    <div class="scorer">
      <span class="rank">${i+1}.</span>
      <span class="team-av team-${s.code}">${escapeHtml(s.team)}</span>
      <span class="name ${s.name?'':'empty'}">${s.name ? escapeHtml(s.name) : '— Vorname fehlt —'}</span>
      <span class="goals">${s.goals||0}<small>Tore</small></span>
    </div>`).join('');

  if(scorers.length > 10){
    moreBtn.style.display = '';
    moreBtn.textContent = state.scorersAllVisible
      ? '× Weniger anzeigen'
      : `▾ Weitere ${scorers.length - 10} anzeigen`;
  } else {
    moreBtn.style.display = 'none';
  }
}

/* =========================================================
   ADMIN MODAL
   ========================================================= */
function renderAdmin(){
  const cont = document.getElementById('adminContent');
  if(!state.adminPassword){
    cont.innerHTML = `
      <h3>Trainer-Login</h3>
      <p style="font-size:13px;color:var(--ink-2);margin:0">
        Nur Trainer:innen mit Passwort. Hier wird die Schiri-Einteilung gepflegt.
      </p>
      <label class="field">
        <span>Passwort</span>
        <input type="password" id="adminPwd" placeholder="••••••••" autocomplete="off">
      </label>
      <button class="btn" id="adminLoginBtn">Login</button>
      <button class="btn secondary" onclick="closeModal('admin')">Abbrechen</button>`;
    document.getElementById('adminLoginBtn').addEventListener('click', adminLogin);
    document.getElementById('adminPwd').addEventListener('keydown', e=>{ if(e.key==='Enter') adminLogin(); });
    return;
  }

  if (!state.snapshot){
    cont.innerHTML = `<h3>Schiri-Einteilung</h3><div class="loading-skel">Lade Daten …</div>`;
    return;
  }

  let upcoming = state.snapshot.matches
    .filter(m => m.ourReferee && !isPast(m))
    .sort((a,b)=>(a.day*1e4+matchSortKey(a))-(b.day*1e4+matchSortKey(b)));
  if(state.adminFilter !== 'all') upcoming = upcoming.filter(m=>m.ourReferee === state.adminFilter);

  const pillsHtml = `
    <div class="pills" style="margin:6px -4px 10px;padding-left:4px;padding-right:4px">
      <button data-team="all" class="${state.adminFilter==='all'?'active':''}">Alle</button>
      ${TEAMS.map(t=>`<button data-team="${t.code}" class="${state.adminFilter===t.code?'active':''}">${t.pillLabel}</button>`).join('')}
    </div>`;

  cont.innerHTML = `
    <h3>Schiri-Einteilung</h3>
    <p style="font-size:13px;color:var(--ink-2);margin:0 0 4px">
      Bitte nur <strong>Vornamen</strong> eintragen, durch <strong>Komma getrennt</strong> — sie erscheinen einzeln als kleine Tags in der App.
    </p>
    ${pillsHtml}
    ${upcoming.length === 0
      ? `<div class="empty">Keine anstehenden Schiri-Einsätze für diese Auswahl.</div>`
      : upcoming.map(m=>{
          const r = refsFor(m.nr) || [];
          const val = r.join(', ');
          const t = teamByCode(m.ourReferee);
          const hasRefs = r.length > 0;
          return `
            <div class="admin-match ${hasRefs?'':'empty'}" id="adm-${m.nr}">
              ${hasRefs ? `<span class="assigned-marker">✓ Eingeteilt</span>` : ''}
              <div class="meta">Tag ${m.day} · ${escapeHtml(m.time||'')} · Feld ${escapeHtml(String(m.pitch))} · #${m.nr}</div>
              <div class="teams"><span style="color:var(--orange)">⚖️ ${t.pillLabel}</span> pfeift <strong>${escapeHtml(m.teamA?.name||'')} vs ${escapeHtml(m.teamB?.name||'')}</strong></div>
              <textarea id="ref-${m.nr}" placeholder="z. B. Lisa, Tom, Klara">${escapeHtml(val)}</textarea>
              <div class="hint">Vornamen durch Komma trennen</div>
              <button class="save" id="save-${m.nr}" data-nr="${m.nr}">Speichern</button>
            </div>`;
        }).join('')}
    <button class="btn secondary" onclick="adminLogout()">Logout</button>
  `;

  cont.querySelectorAll('.pills button').forEach(b=>{
    b.addEventListener('click', ()=>{
      state.adminFilter = b.dataset.team;
      save('adminFilter', state.adminFilter);
      renderAdmin();
    });
  });
  cont.querySelectorAll('.save').forEach(btn=>{
    btn.addEventListener('click', ()=>saveRefs(Number(btn.dataset.nr)));
  });
}

async function adminLogin(){
  const v = document.getElementById('adminPwd').value;
  try {
    const res = await fetch(`/api/admin/login?slug=${encodeURIComponent(CURRENT_SLUG)}`, {
      method: 'POST',
      headers: { 'x-admin-password': v, 'content-type':'application/json' },
      body: '{}',
    });
    if (res.ok){
      state.adminPassword = v;
      localStorage.setItem('vmw.adminPwd', v);
      showToast('Eingeloggt');
      renderAdmin();
    } else {
      showToast('Passwort falsch');
    }
  } catch (e){
    showToast('Login fehlgeschlagen');
  }
}
function adminLogout(){
  state.adminPassword = null;
  localStorage.removeItem('vmw.adminPwd');
  showToast('Ausgeloggt');
  renderAdmin();
}
async function saveRefs(nr){
  const txt = document.getElementById('ref-'+nr).value.trim();
  const players = txt ? txt.split(',').map(s=>s.trim()).filter(Boolean) : [];
  const btn = document.getElementById('save-'+nr);
  const card = document.getElementById('adm-'+nr);
  btn.disabled = true; btn.textContent = '…';
  try {
    const res = await fetch(`/api/admin/refs?slug=${encodeURIComponent(CURRENT_SLUG)}`, {
      method:'POST',
      headers:{ 'content-type':'application/json', 'x-admin-password': state.adminPassword },
      body: JSON.stringify({ matchNr: nr, players }),
    });
    if (!res.ok){
      if (res.status === 401){
        adminLogout();
        return;
      }
      throw new Error('save failed: '+res.status);
    }
    const json = await res.json();
    state.refs = json.refs || {};
    // Diesen Eintrag im "fresh window" markieren, damit der nächste
    // /api/data-Poll ihn nicht durch eine stale CDN-Antwort wegputzt.
    _markRefFresh(nr);
    btn.classList.add('ok'); btn.textContent = '✓ Gespeichert';
    if(players.length && card){
      card.classList.remove('empty');
      if(!card.querySelector('.assigned-marker')){
        const span = document.createElement('span');
        span.className = 'assigned-marker';
        span.textContent = '✓ Eingeteilt';
        card.prepend(span);
      }
    } else if(card){
      card.classList.add('empty');
      const marker = card.querySelector('.assigned-marker');
      if(marker) marker.remove();
    }
    setTimeout(()=>{ btn.classList.remove('ok'); btn.textContent='Speichern'; btn.disabled=false; }, 2000);
    renderActiveTab();
  } catch (e){
    btn.textContent='Fehler';
    setTimeout(()=>{ btn.textContent='Speichern'; btn.disabled=false; }, 2000);
    showToast('Speichern fehlgeschlagen');
  }
}

/* =========================================================
   MODAL / TOAST
   ========================================================= */
function openModal(which){
  if(which==='admin') renderAdmin();
  document.getElementById(which+'Modal').classList.add('open');
}
function closeModal(which){
  document.getElementById(which+'Modal').classList.remove('open');
}
window.openModal = openModal;
window.closeModal = closeModal;
window.adminLogout = adminLogout;

let toastTimer;
function showToast(text){
  const t = document.getElementById('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), 1800);
}

/* =========================================================
   TABS
   ========================================================= */
function setTab(tab){
  if (isBeamerMode) tab = 'live'; // Beamer-Modus: nur "Heute" anzeigen
  state.tab = tab; save('tab', tab);
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('panel-'+tab).classList.add('active');
  document.querySelectorAll('.tabbar button').forEach(b=>{
    b.classList.toggle('active', b.dataset.tab===tab);
  });
  window.scrollTo({ top:0, behavior:'instant' });
  renderActiveTab();
}
function renderActiveTab(){
  if(state.tab==='live') renderLive();
  else if(state.tab==='plan') renderPlan();
  else if(state.tab==='teams') renderTeams();
  else if(state.tab==='haus') renderHausliga();
  // Body sichtbar machen — falls noch versteckt (initialer Load).
  // phase3.js übernimmt für /, /admin, /me/ und externe Turniere; app.js für
  // kayakers-Spielpläne. Erst wenn wir hier rendern, ist klar dass wir's sind.
  if (document.body.style.visibility === 'hidden') {
    document.body.style.visibility = 'visible';
  }
}
window.renderActiveTab = renderActiveTab;

/* =========================================================
   UPDATE-INDICATOR (Header) — Timestamp passiv
   ========================================================= */
function tickStale(){
  // Live-Status (zeitbasiert) auf den aktuellen Snapshot anwenden — damit
  // Spiele auch zwischen Polls (alle 60s) rechtzeitig in "Jetzt" rutschen,
  // sobald ihre Anpfiff-Zeit erreicht ist.
  if (state.snapshot) {
    deriveLiveByTime(state.snapshot);
    renderActiveTab();
  }

  const el  = document.getElementById('updatedText');
  const dot = document.getElementById('updatedDot');

  // Wir zeigen NICHT den Frontend-Sync-Zeitpunkt, sondern wann der Scraper
  // zuletzt frische Daten von kayakers.nl geholt hat (snapshot.lastUpdated).
  const stamp = state.snapshot?.lastUpdated;
  if (!stamp){
    el.textContent = 'lade …';
    if (dot) dot.className = 'dot dead';
    return;
  }

  const last = new Date(stamp);
  const minAgo = Math.floor((Date.now() - last.getTime()) / 60000);

  // Absolute Berlin-Uhrzeit — "Stand 12:34" — einfacher zu scannen als "vor X Min"
  const timeStr = last.toLocaleTimeString('de-DE', {
    timeZone: 'Europe/Berlin',
    hour:   '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  el.textContent = `Stand ${timeStr}`;

  // Dot-Farbe nach Alter:
  //   grün < 20 Min  (Cron läuft 15-Min-Takt, also normal)
  //   gelb < 60 Min  (verzögert, irgendwas hakt)
  //   grau > 60 Min  (alt)
  if (!dot) return;
  if (minAgo < 20)      dot.className = 'dot';
  else if (minAgo < 60) dot.className = 'dot stale';
  else                  dot.className = 'dot dead';
}
setInterval(tickStale, 30_000);

/* =========================================================
   DATEN-FETCH (Polling alle 60s)
   ========================================================= */

// Refs, die wir gerade lokal gespeichert haben (matchNr → Zeitstempel-ms).
// Solange ein Eintrag <FRESH_WINDOW_MS alt ist, darf ihn ein /api/data-Poll
// NICHT mit stale CDN-Daten überschreiben. Schützt vor:
//   1) Edge-Cache von /api/data → der nächste Poll bekommt evtl. eine Antwort
//      von VOR unserem Save.
//   2) eventually consistent Blob-Reads über Replicas.
// Bugfix für "Schiri-Einsätze sind eingetragen und wieder verschwunden".
const FRESH_WINDOW_MS = 90_000;
const _localFreshRefs = new Map(); // String(matchNr) → ts of local save

function _markRefFresh(nr){
  _localFreshRefs.set(String(nr), Date.now());
}

function _mergeIncomingRefs(incoming){
  incoming = incoming || {};
  const now = Date.now();
  const merged = { ...incoming };

  for (const [nrStr, savedAt] of [..._localFreshRefs]) {
    if (now - savedAt > FRESH_WINDOW_MS) {
      _localFreshRefs.delete(nrStr); // alt genug — CDN hat ihn jetzt sicher gesehen
      continue;
    }
    const localEntry = state.refs[nrStr] || state.refs[Number(nrStr)];
    const incomingEntry = incoming[nrStr] || incoming[Number(nrStr)];

    if (!localEntry) {
      // Wir haben lokal gerade gelöscht → soll auch in der gemergten Map fehlen,
      // selbst wenn das CDN den Eintrag noch in einer stale Antwort liefert.
      delete merged[nrStr];
      delete merged[Number(nrStr)];
    } else {
      const incomingTs = incomingEntry?.updatedAt ? Date.parse(incomingEntry.updatedAt) : 0;
      const localTs    = localEntry.updatedAt ? Date.parse(localEntry.updatedAt) : savedAt;
      if (!incomingEntry || incomingTs < localTs) {
        // Unser frischer lokaler Stand gewinnt
        merged[nrStr] = localEntry;
      }
    }
  }
  return merged;
}

// ── Zeitbasierte Live-Erkennung ────────────────────────────────────────
// kayakers.nl setzt den Match-Status erst NACHTRÄGLICH (wenn die Schiris den
// Score eintragen). Während des Spiels bleibt der Status auf "Nicht gespielt".
// Heuristik: wenn die Anpfiff-Zeit bereits erreicht ist UND noch kein Score
// vorliegt, behandeln wir das Spiel im Frontend als 'live'. Sobald der Score
// gepflegt wird, übersteuert der Server-Status auf 'done'.
//
// TOURNAMENT_DATES wird oben dynamisch aus config.dates gefüllt (applyConfigToFrontend).
// Phase 1 nutzt die Werte aus tournaments/<slug>.json — keine Hardcode-Tage mehr.

// Wie lange nach Anpfiff zählt ein noch nicht beendetes Spiel als "live"?
// Kanu-Polo-Matches dauern netto ~25 Min; mit Puffer für Pausen/Verzögerungen.
const LIVE_WINDOW_MINUTES = 90;

function matchScheduledTime(m){
  if (!m || !m.time) return null;
  const ymd = TOURNAMENT_DATES[m.day];
  if (!ymd) return null;
  // ISO-Datum mit explizitem +02:00 Offset (CEST). Robust unabhängig von der
  // Zeitzone des Clients (Beamer / Handy / PC können alle anders konfiguriert sein).
  const d = new Date(`${ymd}T${m.time}:00+02:00`);
  return isNaN(d.getTime()) ? null : d;
}

function deriveLiveByTime(snapshot){
  if (!snapshot?.matches) return;
  const now = Date.now();
  for (const m of snapshot.matches) {
    if (m.status !== 'next') continue;            // schon done/live? Server gewinnt
    if (m.score?.a != null || m.score?.b != null) continue;  // Score da → kein next mehr
    const scheduled = matchScheduledTime(m);
    if (!scheduled) continue;
    const minutesSinceStart = (now - scheduled.getTime()) / 60_000;
    if (minutesSinceStart >= 0 && minutesSinceStart <= LIVE_WINDOW_MINUTES) {
      m.status = 'live';
    }
  }
}

async function fetchData(){
  try {
    const res = await fetch(`/api/data?slug=${encodeURIComponent(CURRENT_SLUG)}`, { cache: 'default' });
    if (!res.ok) throw new Error('HTTP '+res.status);
    const data = await res.json();
    // Config-Felder zuerst anwenden, damit TEAMS + TOURNAMENT_DATES für die nächste
    // Render-Iteration korrekt gefüllt sind (deriveLiveByTime nutzt TOURNAMENT_DATES).
    // External Tournament: phase3.js rendert das Dashboard.
    // - Beim Initial-Load übernimmt phase3.js's bootstrapRoute — Body bleibt
    //   da unangetastet (phase3.js setzt visibility selbst).
    // - Mid-Session (Tournament wurde gerade auf 'external' konvertiert):
    //   einmaliger Reload, damit phase3.js sauber neu startet.
    // - In jedem Fall: app.js-Polling sofort beenden (BUGFIX_EXTERNES_TURNIER#C).
    //   Sonst feuert das setInterval später noch einmal hier rein und kann den
    //   von phase3.js längst gerenderten Body wieder unsichtbar machen — das
    //   war die Wurzel des "Seite wird nach ~60s weiß"-Bugs.
    if (data.external) {
      if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
      if (state.lastFetchOk) {
        // Schon erfolgreich von app.js gerendert vorher → Mid-Session-Konversion
        window.location.reload();
      }
      // KEIN visibility:hidden mehr — phase3.js's bootstrapRoute übernimmt eh
      // den Body; ihn hier zu verstecken hat beim Re-Poll die bereits
      // gerenderte Seite ausgeblendet.
      return;
    }
    if (data.config) applyConfigToFrontend(data.config);
    state.snapshot = data.snapshot;
    // Division-Pills aus dem Snapshot ableiten (vorher hardcoded U14/U16/U21/Damen/Herren1/2)
    applyDivisionPills(state.snapshot);
    // Phase 3: Rollen-Assignments + Schiri-Index für den Picker bereitstellen
    state.assignments = data.assignments || null;
    state.referees    = Array.isArray(data.referees) ? data.referees : [];
    // Heuristik client-seitig anwenden (rechnet bei jedem Poll neu durch)
    deriveLiveByTime(state.snapshot);
    // Merge statt überschreiben: lokale frisch gespeicherte Schiri-Einträge
    // überleben einen Poll, auch wenn das CDN noch eine alte /api/data-Antwort
    // serviert. Ohne diesen Merge wurden Schiri-Einsätze "verschwunden" weil
    // die nächste Poll-Antwort sie nicht enthielt.
    state.refs = _mergeIncomingRefs(data.refereeAssignments);
    state.lastFetchOk = Date.now();
    state.fetchError = null;
    renderActiveTab();
    tickStale();
  } catch (e){
    state.fetchError = e.message;
    // Wenn wir noch nie Daten hatten, zeige Loading-Skeleton; sonst behalte bestehende Daten.
    renderActiveTab();
  }
}

/* =========================================================
   WIRE UP
   ========================================================= */
document.querySelectorAll('.tabbar button').forEach(b=>{
  b.addEventListener('click', ()=>setTab(b.dataset.tab));
});
document.querySelectorAll('#liveDaySwitch button').forEach(b=>{
  b.addEventListener('click', ()=>{
    state.liveDay = Number(b.dataset.day); save('liveDay', state.liveDay);
    state.liveExpand = { next:false, ref:false, done:false };
    renderLive();
  });
});
document.querySelectorAll('#planDaySwitch button').forEach(b=>{
  b.addEventListener('click', ()=>{
    state.planDay = Number(b.dataset.day); save('planDay', state.planDay);
    state.planPastOpen = false;
    renderPlan();
  });
});
document.querySelectorAll('#scopeSeg button').forEach(b=>{
  b.addEventListener('click', ()=>{
    state.planScope = b.dataset.scope; save('planScope', state.planScope);
    renderPlan();
  });
});
document.querySelectorAll('#planTeamPills button').forEach(b=>{
  b.addEventListener('click', ()=>{
    state.planFilter = b.dataset.team; save('spielplanFilter', state.planFilter);
    renderPlan();
  });
});
document.querySelectorAll('#planDivisionPills button').forEach(b=>{
  b.addEventListener('click', ()=>{
    state.planDivision = b.dataset.div; save('spielplanDivision', state.planDivision);
    renderPlan();
  });
});
document.querySelectorAll('#teamPills button').forEach(b=>{
  b.addEventListener('click', ()=>{
    state.teamView = b.dataset.team; save('teamsView', state.teamView);
    state.teamsPastOpen = false; state.teamsRefPastOpen = false;
    renderTeams();
  });
});
document.querySelectorAll('#scorerPills button').forEach(b=>{
  b.addEventListener('click', ()=>{
    state.scorerFilt = b.dataset.team; save('scorersFilter', state.scorerFilt);
    state.scorersAllVisible = false;
    renderHausliga();
  });
});
document.getElementById('scorersMoreBtn').addEventListener('click', ()=>{
  state.scorersAllVisible = !state.scorersAllVisible;
  renderHausliga();
});
['liveNextMore','liveRefMore','liveDoneMore'].forEach(id=>{
  const key = id.replace('liveNextMore','next').replace('liveRefMore','ref').replace('liveDoneMore','done');
  document.getElementById(id).addEventListener('click', ()=>{
    state.liveExpand[key] = !state.liveExpand[key];
    renderLive();
  });
});

/* INITIAL */
// Nur initialisieren wenn wir auf einer /t/<slug>-Route sind.
// Auf /, /admin, /me/<code> übernimmt phase3.js komplett — siehe dort.
if (CURRENT_SLUG) {
  setTab(state.tab);
  // Visibility NICHT sofort — erst nach dem ersten fetchData wissen wir, ob app.js
  // (kayakers-Spielplan) oder phase3.js (externes Dashboard) übernimmt. Wenn
  // external: phase3.js setzt visibility. Wenn kayakers: renderActiveTab tut es.
  // Das setInterval-Handle wird in state.pollTimer gehalten, damit fetchData()
  // es bei `data.external` clearen kann (BUGFIX_EXTERNES_TURNIER#C).
  fetchData();
  state.pollTimer = setInterval(fetchData, POLL_INTERVAL_MS);
}
