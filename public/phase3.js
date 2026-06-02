/* =========================================================
   Phase 2-6 Frontend-Supplement
   Erweitert app.js um:
   - Rollen-Picker für Schiri-Einteilung (Phase 3)
   - Public-Profil-Sheet beim Klick auf Schiri-Namen (Phase 3+5)
   - Login-Modal mit Master/Trainer/Schiri-Tabs (Phase 3+6)
   - Master-Admin-Tabs: Turniere/Stammdaten/Reports (Phase 2-5)
   - Schiri-Self-Service-Dashboard (Phase 6)
   - Landing-Page bei pathname '/' (Phase 4)
   - Liga-Tabelle-Tab wenn config.showStandings (Phase 2)
   ========================================================= */

(function(){
  'use strict';

  // ─── Konstanten (mirror von lib/refereeLevels.mjs) ────────────────────
  const ROLES = [
    { code: 'ref1',      label: '1. Schiedsrichter', short: '1.SR',  requiresRefMatch: true  },
    { code: 'ref2',      label: '2. Schiedsrichter', short: '2.SR',  requiresRefMatch: true  },
    { code: 'scorer',    label: 'Protokoll',         short: 'Prot',  requiresRefMatch: false },
    { code: 'timer',     label: 'Zeitnehmer',        short: 'Zeit',  requiresRefMatch: false },
    { code: 'shotclock', label: 'Shotclock',         short: 'Shot',  requiresRefMatch: false },
    { code: 'line1',     label: '1. Linienrichter',  short: 'Lin1',  requiresRefMatch: false },
    { code: 'line2',     label: '2. Linienrichter',  short: 'Lin2',  requiresRefMatch: false },
  ];
  const REFEREE_LEVELS = ['PLZ', 'C', 'B', 'A', 'ICF'];
  const PLZ_CAN_DO = (roleCode) => !ROLES.find(r => r.code === roleCode)?.requiresRefMatch;
  const CATEGORIES = ['U14', 'U16', 'U21', 'Damen', 'Herren'];

  // Globalen State erweitern (vorausgesetzt window.state ist von app.js)
  window.state = window.state || {};
  Object.assign(window.state, {
    role:               window.state.role || localStorage.getItem('vmw.role') || null,
    refereeAuth:        window.state.refereeAuth || localStorage.getItem('refereeAuth') || null,
    refereeDisplayName: window.state.refereeDisplayName || localStorage.getItem('refereeDisplayName') || null,
    referees:           [],
    assignments:        null,
  });

  // ─── Helpers ────────────────────────────────────────────────────────
  const $ = (sel, root=document) => root.querySelector(sel);
  const h = (tag, attrs = {}, ...children) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k === 'onclick') el.onclick = v;
      else if (k.startsWith('data-')) el.setAttribute(k, v);
      else el[k] = v;
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

  // ─── Modal-Manager ───────────────────────────────────────────────────
  function openModal(content, opts={}) {
    closeModal();
    const backdrop = h('div', { class: 'p3-backdrop', onclick: (e) => { if (e.target === backdrop) closeModal(); }});
    const modal = h('div', { class: 'p3-modal' });
    if (opts.wide) modal.classList.add('wide');
    modal.appendChild(content);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    document.body.style.overflow = 'hidden';
    return modal;
  }
  function closeModal() {
    document.querySelectorAll('.p3-backdrop').forEach(b => b.remove());
    document.body.style.overflow = '';
  }
  window.closeP3Modal = closeModal;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // ─── Toast ──────────────────────────────────────────────────────────
  function toast(msg, kind='info') {
    const el = h('div', { class: `p3-toast ${kind}` }, msg);
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // ─── CSV-Download mit Auth-Header (Browser-Link kann keine Header) ───
  async function downloadCsv(url, filename) {
    return downloadFile(url, filename);
  }
  // Generischer Auth-aware Download (für CSV oder PDF). Sendet beide Header-Typen,
  // damit Master-, Trainer- und Schiri-Endpoints gleichermaßen funktionieren.
  async function downloadFile(url, filename) {
    try {
      const headers = {};
      if (window.state.adminPassword) headers['x-admin-password'] = window.state.adminPassword;
      if (window.state.refereeAuth)   headers['x-personal-token']  = window.state.refereeAuth;
      const res = await fetch(url, { headers });
      if (!res.ok) { toast('Download fehlgeschlagen: HTTP ' + res.status, 'error'); return; }
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 100);
    } catch (e) {
      toast('Fehler: ' + e.message, 'error');
    }
  }
  window.downloadCsv = downloadCsv;
  window.downloadFile = downloadFile;

  // ─── Button-Loading-Wrapper ───────────────────────────────────────
  // Setzt den Button auf "lädt …", disabled ihn, und stellt nach der Action
  // den Originalzustand wieder her. Verhindert Doppel-Klicks.
  async function withLoading(button, label, action) {
    const original = button.innerHTML;
    const wasDisabled = button.disabled;
    button.disabled = true;
    button.innerHTML = '<span class="p3-spinner"></span> ' + (label || 'lädt …');
    try {
      await action();
    } finally {
      button.disabled = wasDisabled;
      button.innerHTML = original;
    }
  }

  // GET /api/data?slug=… mit Auth-Headern. Sendet x-admin-password und
  // x-personal-token, damit der Server für eingeloggte User no-cache liefert
  // und Mutationen sofort sichtbar werden. cache:'no-store' verhindert
  // zusätzlich den Browser-Cache.
  async function fetchData(slug) {
    const headers = {};
    if (window.state.adminPassword) headers['x-admin-password'] = window.state.adminPassword;
    if (window.state.refereeAuth)   headers['x-personal-token']  = window.state.refereeAuth;
    return fetch(`/api/data?slug=${encodeURIComponent(slug)}`, { headers, cache: 'no-store' })
      .then(r => r.json());
  }
  window.fetchData = fetchData;

  // ─── API-Helpers ────────────────────────────────────────────────────
  async function api(path, opts={}) {
    const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
    if (window.state.adminPassword) headers['x-admin-password'] = window.state.adminPassword;
    if (window.state.refereeAuth)   headers['x-personal-token'] = window.state.refereeAuth;
    // N1 — `opts.fresh = true` umgeht den 5s-Browser-Cache. Wird nach Mutations
    // gesetzt, damit ein direkt folgender GET-Refresh die frischen Daten sieht.
    // `fresh` ist ein lokales Flag und wird nicht an fetch durchgereicht.
    const { fresh, ...fetchOpts } = opts;
    if (fresh) fetchOpts.cache = 'no-store';
    const res = await fetch(path, { ...fetchOpts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data?.error || data?.message || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ═══════════════════════════════════════════════════════════════════
  // DATENSTAND-PILL (P1.3)
  //
  // Liefert ein Header-Pill „Stand HH:MM" mit Farbpunkt (grün < 20 Min,
  // gelb < 60, grau > 60). Klick öffnet einen Info-Modal mit Erklärung.
  // Auf kayakers-Live-View existiert das schon im statischen Header
  // (siehe `app.js`); diese Variante ist für phase3-Pages
  // (External-Dashboard, Schiri-Einteilung), die eigene p3-page-header
  // rendern.
  // ═══════════════════════════════════════════════════════════════════
  window.renderUpdatedPill = function(stamp, opts = {}) {
    const pill = h('button', {
      class: 'p3-updated-pill',
      'aria-label': 'Letzter Datenstand · zum Erklären antippen',
      onclick: () => openUpdatedInfoModal(pill.dataset.stamp || stamp, opts.label, opts.subline),
    });
    const dot = h('span', { class: 'p3-updated-dot' });
    const txt = h('span', { class: 'p3-updated-txt' }, '—');
    pill.append(dot, txt);

    function update() {
      const s = pill.dataset.stamp || stamp;
      if (!s) { txt.textContent = '—'; dot.className = 'p3-updated-dot dead'; return; }
      const last = new Date(s);
      if (Number.isNaN(last.getTime())) { txt.textContent = '—'; dot.className = 'p3-updated-dot dead'; return; }
      const minAgo = Math.floor((Date.now() - last.getTime()) / 60000);
      const t = last.toLocaleTimeString('de-DE', {
        timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false,
      });
      txt.textContent = `Stand ${t}`;
      dot.className = 'p3-updated-dot' +
        (minAgo < 20 ? '' : minAgo < 60 ? ' stale' : ' dead');
    }
    pill.dataset.stamp = stamp || '';
    update();
    // Caller kann nach dem Setzen von dataset.stamp ein Re-Render erzwingen
    pill.refresh = update;
    const iv = setInterval(update, 30_000);
    // Wenn das Element aus dem DOM geht, Interval freigeben
    new MutationObserver(() => { if (!pill.isConnected) clearInterval(iv); })
      .observe(document.body, { childList: true, subtree: true });
    return pill;
  };

  function openUpdatedInfoModal(stamp, label, subline) {
    const last = stamp ? new Date(stamp) : null;
    const valid = last && !Number.isNaN(last.getTime());
    const timeStr = valid ? last.toLocaleString('de-DE', {
      timeZone: 'Europe/Berlin',
      weekday: 'short', day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }) : '—';
    const minAgo = valid ? Math.floor((Date.now() - last.getTime()) / 60000) : null;
    const agoStr = minAgo == null ? ''
      : minAgo < 1 ? 'gerade eben'
      : minAgo < 60 ? `vor ${minAgo} Min`
      : minAgo < 1440 ? `vor ${Math.floor(minAgo/60)} Std`
      : `vor ${Math.floor(minAgo/1440)} Tagen`;

    const backdrop = h('div', { class: 'p3-backdrop',
      onclick: (e) => { if (e.target === backdrop) closeModal(); }});
    const card = h('div', { class: 'p3-modal-card', style: 'max-width:420px' });
    backdrop.appendChild(card);
    card.appendChild(h('div', { class: 'p3-modal-h' },
      h('h3', {}, label || 'Datenstand'),
      h('button', { class: 'p3-close', onclick: closeModal }, '×')));
    card.appendChild(h('div', { class: 'p3-body' },
      h('div', { style: 'font-size:24px; font-weight:600; margin-bottom:6px' }, timeStr),
      agoStr ? h('div', { style: 'color:#6b7280; margin-bottom:14px' }, agoStr) : null,
      h('p', { style: 'margin:0; color:#3a3a3a; line-height:1.5' },
        subline || 'Die App holt Daten alle 15 Minuten von kayakers.nl. Bei externen Turnieren werden Einsätze manuell von Trainern oder vom Master gepflegt.'),
    ));
    document.body.appendChild(backdrop);
  }

  // ═══════════════════════════════════════════════════════════════════
  // HERO-INFO-MODAL (P1.5)
  // Volle Erklärung der App, die früher als ~330-Zeichen-Text im Hero stand.
  // Auf der Landing zeigt der Hero jetzt nur eine prägnante Tagline + „?"-Button.
  // ═══════════════════════════════════════════════════════════════════
  function openHeroInfoModal() {
    const backdrop = h('div', { class: 'p3-backdrop',
      onclick: (e) => { if (e.target === backdrop) closeModal(); }});
    const card = h('div', { class: 'p3-modal-card', style: 'max-width:480px' });
    backdrop.appendChild(card);
    card.appendChild(h('div', { class: 'p3-modal-h' },
      h('h3', {}, 'Über die VMW Live-App'),
      h('button', { class: 'p3-close', onclick: closeModal }, '×')));
    card.appendChild(h('div', { class: 'p3-body' },
      h('p', { style: 'margin:0 0 12px;line-height:1.55;color:#3a3a3a' },
        'Übersicht aller Turniere und Ligen, in denen VMW Berlin spielt. Wenn ',
        'möglich mit Live-Spielständen direkt in der App — sonst mit Verlinkung ',
        'auf den externen Spielplan.'),
      h('p', { style: 'margin:0;line-height:1.55;color:#3a3a3a' },
        'Außerdem zentral für das Tracking der Schiri-Einsätze: Trainer pflegen ',
        'die Einteilungen, jeder Schiri lädt seinen DKV-Einsatzbogen am ',
        'Jahresende selbst herunter.'),
    ));
    document.body.appendChild(backdrop);
  }

  // ═══════════════════════════════════════════════════════════════════
  // LOGIN-MODAL mit 3 Tabs (Trainer / Master / Schiri)
  // ═══════════════════════════════════════════════════════════════════
  window.openLogin = function() {
    // Tabs: Master + Schiri immer. Trainer zusätzlich, wenn auf einer
    // Turnier-Seite (CURRENT_SLUG gesetzt) — Trainer-Auth ist Tournament-scoped.
    // Default-Tab: Schiri auf Landing/extern (häufigster Fall), Master/Trainer
    // auf Tournament-Seiten (wo Master+Trainer aktiv arbeiten).
    let activeTab = window.CURRENT_SLUG ? 'master' : 'schiri';
    const tabBar = h('div', { class: 'p3-tabbar' });
    const body = h('div', { class: 'p3-body' });
    // N5 — Trainer-Tab unconditional. War vorher Tournament-scoped, aber der
    // Login selbst soll überall möglich sein. Default-Slug-Hack in der
    // Auth-Route (`?slug=${CURRENT_SLUG || 'dc2026'}`) bleibt bestehen —
    // handleLogin in admin.mjs nutzt den Slug nur als Marker.
    const availableTabs = ['master', 'trainer', 'schiri'];

    function render() {
      tabBar.innerHTML = '';
      availableTabs.forEach(t => {
        const btn = h('button', {
          class: 'p3-tab ' + (activeTab === t ? 'active' : ''),
          onclick: () => { activeTab = t; render(); },
        }, t === 'master' ? 'Master' : t === 'trainer' ? 'Trainer' : 'Schiri');
        tabBar.appendChild(btn);
      });

      body.innerHTML = '';
      if (activeTab === 'trainer' || activeTab === 'master') {
        // Username-Input (versteckt) damit Browser-Passwort-Manager triggert
        const usernameInput = h('input', {
          type: 'text', name: 'username', autocomplete: 'username',
          value: activeTab === 'master' ? 'master@vmw-berlin' : 'trainer@vmw-berlin',
          style: 'display:none', readonly: 'readonly',
        });
        const input = h('input', {
          type: 'password', placeholder: '••••••••', class: 'p3-input',
          autocomplete: 'current-password', name: 'password',
        });
        const btn = h('button', { class: 'p3-btn primary', type: 'submit' }, 'Login');
        input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); btn.click(); } };
        setTimeout(() => input.focus(), 50);
        btn.onclick = () => withLoading(btn, 'Prüfe …', async () => {
          // PHASE 1: Reine Auth-Prüfung. Nur Fehler HIER lösen "Login fehlgeschlagen" aus.
          let loginOk = false;
          try {
            window.state.adminPassword = input.value;
            await api(`/api/admin/login?slug=${encodeURIComponent(window.CURRENT_SLUG || 'dc2026')}`, { method: 'POST', body: '{}' });
            loginOk = true;
          } catch (e) {
            window.state.adminPassword = null;
            toast('Login fehlgeschlagen', 'error');
            return;
          }

          // PHASE 2: State + Persistence (sollte nicht fehlschlagen, aber falls doch
          // — der Login war erfolgreich, also Toast trotzdem als Success zeigen).
          window.state.role = activeTab;
          localStorage.setItem('vmw.adminPwd', input.value);
          localStorage.setItem('vmw.role', activeTab);
          toast(`Eingeloggt als ${activeTab}`, 'success');
          closeModal();

          // PHASE 3: Rendering. Fehler hier dürfen den Login-Erfolg NICHT überdecken
          // (sonst sieht der User "Login fehlgeschlagen" obwohl er eingeloggt ist).
          try {
            window.fillUserAreaSlot && window.fillUserAreaSlot();
            if (activeTab === 'master') {
              await window.openMasterAdmin();
            } else if (window.CURRENT_SLUG && typeof window.renderActiveTab === 'function') {
              window.renderActiveTab();
            } else {
              await window.renderLanding();
            }
          } catch (renderErr) {
            console.error('[login] Post-Login-Render fehlgeschlagen:', renderErr);
            // Kein User-facing-Toast — Login war OK. User kann Seite reloaden.
          }
        });
        // <form> wrappen — sonst registriert Safari/Chrome das Passwort nicht zum Speichern
        const form = h('form', {
          autocomplete: 'on',
          onsubmit: (e) => { e.preventDefault(); btn.click(); },
        }, h('label', {}, 'Passwort'),
           usernameInput,
           input,
           btn);
        body.appendChild(form);
      } else {
        const input = h('input', { type: 'text', placeholder: 'VMW-XXXX', class: 'p3-input', style: 'text-transform:uppercase' });
        const btn = h('button', { class: 'p3-btn primary' }, 'Einloggen');
        input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); btn.click(); } };
        setTimeout(() => input.focus(), 50);
        btn.onclick = () => withLoading(btn, 'Prüfe …', async () => {
          try {
            const result = await fetch('/api/auth/referee-login', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ code: input.value.replace(/\s+/g, '').toUpperCase() }),
            }).then(r => r.json());
            if (!result.ok) { toast(result.error === 'rate_limited' ? 'Zu viele Versuche — bitte später' : 'Code ungültig', 'error'); return; }
            const normalizedCode = input.value.replace(/\s+/g, '').toUpperCase();
            window.state.refereeAuth = normalizedCode;
            window.state.refereeDisplayName = result.referee.displayName;
            localStorage.setItem('refereeAuth', normalizedCode);
            if (result.referee.displayName) {
              localStorage.setItem('refereeDisplayName', result.referee.displayName);
            }
            toast(`Willkommen ${result.referee.displayName}`, 'success');
            closeModal();
            window.fillUserAreaSlot && window.fillUserAreaSlot();
            // N6 — Routing-aware Re-Render statt sturem openMyProfile.
            // Bei Login auf einem Tournament wollen wir die aktuelle View
            // (external oder kayakers) refreshen, nicht zum Profil springen.
            const pathname = window.location.pathname;
            const tMatch = pathname.match(/^\/t\/([^/]+)/);
            if (tMatch) {
              const slug = decodeURIComponent(tMatch[1]);
              try {
                const data = await fetchData(slug);
                if (data?.external) {
                  window.renderExternalDashboard(slug, data);
                } else if (typeof window.renderActiveTab === 'function') {
                  window.renderActiveTab();
                }
              } catch { /* user merkt's beim manuellen Reload */ }
            } else if (pathname === '/' || pathname === '') {
              await window.renderLanding();
            } else {
              // /me/<code> oder unbekannter Pfad: Profil-Default wie bisher
              window.openMyProfile();
            }
          } catch (e) {
            toast('Login fehlgeschlagen', 'error');
          }
        });
        body.appendChild(h('label', {}, 'Schiri-Login-Code'));
        body.appendChild(input);
        body.appendChild(h('div', { class: 'p3-hint' }, 'Code vom Schiri-Verantwortlichen.'));
        body.appendChild(btn);
      }
    }

    const modal = h('div', { class: 'p3-modal-content' },
      h('div', { class: 'p3-modal-h' },
        h('h3', {}, 'Login'),
        h('button', { class: 'p3-close', onclick: closeModal }, '×')
      ),
      tabBar,
      body
    );
    openModal(modal);
    render();
  };

  window.logout = function() {
    if (window.state.refereeAuth) {
      window.state.refereeAuth = null;
      window.state.refereeDisplayName = null;
      localStorage.removeItem('refereeAuth');
      localStorage.removeItem('refereeDisplayName');
    }
    if (window.state.role) {
      window.state.role = null;
      window.state.adminPassword = null;
      localStorage.removeItem('vmw.role');
      localStorage.removeItem('vmw.adminPwd');
    }
    toast('Ausgeloggt', 'info');
    // Nach Logout immer zurück zur Landing-Page
    window.location.href = '/';
  };

  // ═══════════════════════════════════════════════════════════════════
  // USER-AREA — zentrales Header-Element rechts oben auf JEDER Seite.
  //
  // Zustände:
  //   nicht eingeloggt        → [Login]
  //   Schiri (refereeAuth)    → [Avatar JB · Mein Profil] [↳]
  //   Master  (role=master)   → [⚙ Master-Admin]          [↳]
  //   Trainer (role=trainer)  → [👥 Schiri-Einteilung]    [↳]
  //                             auf Turnierseite — sonst nur [↳]
  //
  // Optional `opts.onBrand=true` → optimiert für VMW-roten Header (helle Buttons).
  // ═══════════════════════════════════════════════════════════════════
  window.renderUserArea = function(opts = {}) {
    const onBrand = !!opts.onBrand;
    const btnClass = onBrand ? 'p3-userarea-btn p3-userarea-btn-onbrand' : 'p3-userarea-btn';
    const wrap = h('div', { class: 'p3-userarea' });

    // Nicht eingeloggt → Login-Button
    if (!window.state.role && !window.state.refereeAuth) {
      const b = h('button', { class: btnClass }, 'Login');
      b.onclick = () => window.openLogin();
      wrap.appendChild(b);
      return wrap;
    }

    // Schiri eingeloggt
    if (window.state.refereeAuth) {
      const name = window.state.refereeDisplayName || '';
      const initials = initialsOf(name) || '·';
      const profileBtn = h('button', { class: btnClass + ' p3-userarea-pill' },
        h('span', { class: 'p3-userarea-avatar' }, initials),
        h('span', {}, 'Mein Profil'),
      );
      profileBtn.onclick = () => window.openMyProfile();
      wrap.appendChild(profileBtn);
      wrap.appendChild(logoutIconBtn(btnClass));
      return wrap;
    }

    // Master eingeloggt
    if (window.state.role === 'master') {
      const adminBtn = h('button', { class: btnClass + ' p3-userarea-compact' }, 'Master-Admin');
      adminBtn.onclick = () => window.openMasterAdmin();
      wrap.appendChild(adminBtn);
      wrap.appendChild(logoutIconBtn(btnClass));
      return wrap;
    }

    // Trainer eingeloggt — auf Turnierseite Einteilung, sonst nur Logout
    if (window.state.role === 'trainer') {
      if (window.CURRENT_SLUG) {
        const lineupBtn = h('button', { class: btnClass + ' p3-userarea-compact' }, 'Einteilung');
        lineupBtn.onclick = () => window.openTournamentLineup(window.CURRENT_SLUG);
        wrap.appendChild(lineupBtn);
      }
      wrap.appendChild(logoutIconBtn(btnClass));
      return wrap;
    }

    return wrap;
  };

  function logoutIconBtn(btnClass) {
    // Klares Text-Label statt kryptischem Icon — "↳" war schlecht erkennbar.
    const b = h('button', { class: btnClass + ' p3-userarea-logout', title: 'Logout', 'aria-label': 'Logout' }, '🚪 Logout');
    b.onclick = () => {
      if (confirm('Wirklich ausloggen?')) window.logout();
    };
    return b;
  }

  function initialsOf(name) {
    if (!name) return '';
    return name.trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
  }

  // ═══════════════════════════════════════════════════════════════════
  // TURNIER-EINTEILUNGS-PAGE (Trainer + Master)
  // Standalone-Page mit Filter nach Tag, Klasse und Status
  // ═══════════════════════════════════════════════════════════════════
  window.openTournamentLineup = async function(slug) {
    slug = slug || window.CURRENT_SLUG;
    if (!slug) { toast('Kein Turnier ausgewählt', 'error'); return; }
    if (!window.state.role) {
      toast('Bitte erst als Trainer oder Master einloggen', 'error');
      window.openTrainerLogin();
      return;
    }

    const ROLES = [
      { code: 'ref1', short: '1.SR' }, { code: 'ref2', short: '2.SR' },
      { code: 'scorer', short: 'Prot' }, { code: 'timer', short: 'Zeit' },
      { code: 'shotclock', short: 'Shot' },
      { code: 'line1', short: 'Lin1' }, { code: 'line2', short: 'Lin2' },
    ];

    document.body.innerHTML = '';
    document.body.classList.remove('p3-landing-mode');
    document.body.classList.add('p3-page');
    document.body.style.visibility = 'visible';

    const titleEl = h('h1', {}, 'Schiri-Einteilung');
    const filtersBar = h('div', { class: 'p3-lineup-filters' });
    const body = h('div', { class: 'p3-body' });

    // P1.3 — Datenstand-Pill. Stamp wird unten gesetzt, sobald data geladen ist.
    const updatedPill = window.renderUpdatedPill(null, {
      label: 'Datenstand',
      subline: 'Spielplan wird alle 15 Minuten von kayakers.nl geholt. Schiri-Einteilung wird live durch Trainer/Master gepflegt.',
    });

    const page = h('div', { class: 'p3-page-wrap' },
      h('header', { class: 'p3-page-header' },
        h('button', { class: 'p3-btn small', onclick: () => {
          document.body.classList.remove('p3-page');
          window.location.href = `/t/${slug}`;
        } }, '← Zum Turnier'),
        titleEl,
        updatedPill,
        window.renderUserArea({ onBrand: true }),
      ),
      filtersBar,
      body,
    );
    document.body.appendChild(page);

    body.appendChild(h('div', { class: 'p3-hint', style: 'padding:16px' }, '🔄 Lade …'));

    let snapshot, assignments, referees, config, externalAssignments;
    try {
      const data = await fetchData(slug);
      snapshot = data.snapshot;
      assignments = data.assignments || {};
      referees = data.referees || [];
      config = data.config;
      externalAssignments = data.externalAssignments || [];
      // Setze globalen state für den Picker
      window.state.snapshot = snapshot;
      window.state.assignments = assignments;
      window.state.referees = referees;
      window.state.externalReferees = referees; // cache für openExternalEntryForm
      window.CURRENT_SLUG = slug;
    } catch (e) {
      body.innerHTML = '';
      body.appendChild(h('div', { class: 'p3-banner error' }, 'Fehler: ' + e.message));
      return;
    }

    titleEl.textContent = `Schiri-Einteilung · ${config.name}`;

    // P1.3 — Pill mit max(snapshot.lastUpdated, config.updatedAt, max(assignments.*.updatedAt))
    {
      let best = snapshot?.lastUpdated || config.updatedAt || null;
      // assignments-Struktur: { matchNr: { roleCode: { refId, updatedAt? } } }
      for (const m of Object.values(assignments || {})) {
        for (const r of Object.values(m || {})) {
          if (r?.updatedAt && (!best || r.updatedAt > best)) best = r.updatedAt;
        }
      }
      updatedPill.dataset.stamp = best || '';
      updatedPill.refresh();
    }

    // Filter-State — persistiert pro Turnier in localStorage
    const days = config.dates || [];
    const filterKey = `vmw.lineup.filters.${slug}`;
    const saved = (() => {
      try { return JSON.parse(localStorage.getItem(filterKey) || 'null') || {}; }
      catch { return {}; }
    })();
    // Wenn heutiges Datum in den Turnier-Tagen ist → auf den Tag filtern
    const todayIso = new Date().toISOString().slice(0, 10);
    const todayIdx = days.indexOf(todayIso);
    const defaultDayIdx = todayIdx >= 0 ? todayIdx : -1;
    let activeDayIdx = saved.activeDayIdx ?? defaultDayIdx;
    let activeDivision = saved.activeDivision ?? 'all';
    let activeStatus = saved.activeStatus ?? 'all';     // default: alle Einsätze (statt nur 'open')
    function persistFilters() {
      try {
        localStorage.setItem(filterKey, JSON.stringify({ activeDayIdx, activeDivision, activeStatus }));
      } catch {}
    }

    // Alle Divisionen im Snapshot — für Klassen-Filter
    // Guard: snapshot kann fehlen (externes Turnier, kayakers ohne Spielplan)
    const divsSeen = new Map();
    (snapshot?.matches || []).forEach(m => {
      if (m.divisionCode && !divsSeen.has(m.divisionCode)) {
        divsSeen.set(m.divisionCode, m.division);
      }
    });

    function renderFilters() {
      filtersBar.innerHTML = '';
      // Ohne Spielplan: keine Filter (machen keinen Sinn — manuelle Einsätze
      // haben keine Match-Nrn aus kayakers, kein "offen vs. beendet" Status)
      if (!snapshot?.matches?.length) return;
      // Tag-Filter
      const dayRow = h('div', { class: 'p3-filter-row' });
      dayRow.appendChild(h('span', { class: 'p3-flabel' }, 'Tag:'));
      const allDaysBtn = h('button', { class: 'p3-pillchoice ' + (activeDayIdx === -1 ? 'active' : '') }, 'Alle');
      allDaysBtn.onclick = () => { activeDayIdx = -1; persistFilters(); renderFilters(); renderMatches(); };
      dayRow.appendChild(allDaysBtn);
      days.forEach((iso, i) => {
        const d = new Date(iso + 'T12:00:00+02:00');
        const label = d.toLocaleDateString('de-DE', { weekday:'short', day:'numeric', month:'short' });
        const btn = h('button', { class: 'p3-pillchoice ' + (activeDayIdx === i ? 'active' : '') }, label);
        btn.onclick = () => { activeDayIdx = i; persistFilters(); renderFilters(); renderMatches(); };
        dayRow.appendChild(btn);
      });
      filtersBar.appendChild(dayRow);

      // Klassen-Filter (aus snapshot)
      if (divsSeen.size > 1) {
        const divRow = h('div', { class: 'p3-filter-row' });
        divRow.appendChild(h('span', { class: 'p3-flabel' }, 'Klasse:'));
        const allBtn = h('button', { class: 'p3-pillchoice ' + (activeDivision === 'all' ? 'active' : '') }, 'Alle');
        allBtn.onclick = () => { activeDivision = 'all'; persistFilters(); renderFilters(); renderMatches(); };
        divRow.appendChild(allBtn);
        const order = ['U14','U16','U21','Women','Men1','Men2'];
        const sorted = [...divsSeen.entries()].sort((a,b) => (order.indexOf(a[0]) - order.indexOf(b[0])));
        sorted.forEach(([code, label]) => {
          const btn = h('button', { class: 'p3-pillchoice ' + (activeDivision === code ? 'active' : '') }, label);
          btn.onclick = () => { activeDivision = code; persistFilters(); renderFilters(); renderMatches(); };
          divRow.appendChild(btn);
        });
        filtersBar.appendChild(divRow);
      }

      // Status-Filter
      const statusRow = h('div', { class: 'p3-filter-row' });
      statusRow.appendChild(h('span', { class: 'p3-flabel' }, 'Status:'));
      const statusOptions = [
        ['open', 'Offen / Live'],
        ['done-incomplete', 'Beendet & unvollständig'],
        ['all', 'Alle inkl. beendete'],
      ];
      statusOptions.forEach(([k, label]) => {
        const btn = h('button', { class: 'p3-pillchoice ' + (activeStatus === k ? 'active' : '') }, label);
        btn.onclick = () => { activeStatus = k; persistFilters(); renderFilters(); renderMatches(); };
        statusRow.appendChild(btn);
      });
      filtersBar.appendChild(statusRow);
    }

    function renderMatches() {
      body.innerHTML = '';
      const refsById = new Map(referees.map(r => [r.id, r]));
      const hasSnapshot = !!snapshot?.matches?.length;

      // ─── Banner bei leerem Spielplan ──────────────────────────────────
      if (!hasSnapshot) {
        body.appendChild(h('div', { class: 'p3-banner warning', style: 'margin-bottom:16px' },
          '⚠ kayakers.nl hat noch keinen Spielplan für dieses Turnier veröffentlicht. ',
          'Du kannst Schiri-Einsätze trotzdem manuell unten anlegen — sie fließen ',
          'genauso in die DKV-Bögen wie auto-zugewiesene Einsätze.'));
      } else {
        // ─── Normale kayakers-Match-Sektion ──────────────────────────────
        let matches = snapshot.matches.filter(m => m.ourReferee);
        if (activeDayIdx !== -1) matches = matches.filter(m => (m.day || 1) - 1 === activeDayIdx);
        if (activeDivision !== 'all') matches = matches.filter(m => m.divisionCode === activeDivision);

        const isIncomplete = (m) => {
          const r = assignments[m.nr]?.roles || {};
          return ROLES.some(role => !r[role.code]);
        };
        if (activeStatus === 'open') matches = matches.filter(m => m.status !== 'done');
        if (activeStatus === 'done-incomplete') matches = matches.filter(m => m.status === 'done' && isIncomplete(m));

        matches.sort((a, b) => {
          const d = (a.day || 0) - (b.day || 0);
          if (d !== 0) return d;
          return (a.time || '').localeCompare(b.time || '');
        });

        if (!matches.length) {
          body.appendChild(h('div', { class: 'p3-hint', style: 'padding:24px; text-align:center' },
            'Keine Spiele für diese Filter.'));
        } else {
          body.appendChild(h('div', { class: 'p3-section-title' }, `${matches.length} kayakers-Spiel${matches.length===1?'':'e'}`));
          matches.forEach(m => {
            const ass = assignments[m.nr]?.roles || {};
            const card = h('div', { class: 'p3-lineup-card' });
            const dateLabel = days[(m.day || 1) - 1] || '';
            const dateDisplay = dateLabel ? new Date(dateLabel + 'T12:00:00+02:00').toLocaleDateString('de-DE', { day:'numeric', month:'short' }) : '';

            // P2.6 — Card-Header mit Spielnr (blau) + Zeit + Teams (mittig) + Klasse-Pill rechts
            const teamsLine = `${m.teamA?.name || ''} · ${m.teamB?.name || ''}`;
            card.appendChild(h('div', { class: 'p3-lineup-head' },
              h('span', { class: 'p3-lineup-nr' }, `#${m.nr}`),
              h('span', { class: 'p3-lineup-time' }, `${dateDisplay} ${m.time || ''}`.trim()),
              h('span', { class: 'p3-lineup-teams', style: 'flex:1;text-align:left;font-weight:500;color:#222;font-size:13px;margin-left:4px' }, teamsLine),
              m.status === 'done'
                ? h('span', { class: 'p3-lineup-status p3-status-done' }, 'beendet')
                : (m.status === 'live'
                  ? h('span', { class: 'p3-lineup-status p3-status-live' }, 'live')
                  : null),
              m.division ? h('span', { class: 'ui-pill ui-pill-class' }, m.division) : null,
            ));

            // 2-Spalten-Grid mit Role-Label + Name + Lizenz-Letter (Mockup Slide 6)
            const grid = h('div', {
              style: 'display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;margin-top:8px;padding-top:8px;border-top:1px dashed #e5e7eb',
            });
            ROLES.forEach(role => {
              const refId = ass[role.code];
              const ref = refId ? refsById.get(refId) : null;
              const refName = ref ? (ref.displayName || ref.firstName) : null;
              const refLevel = ref?.level || '';

              const cell = h('div', { style: 'display:flex;align-items:center;gap:6px' },
                h('span', {
                  style: 'font-size:10.5px;color:#6b7280;font-weight:500;min-width:46px;text-transform:uppercase;letter-spacing:0.3px',
                }, role.short),
                refName
                  ? h('button', {
                      style: 'flex:1;text-align:left;font-size:12.5px;font-weight:500;color:#111;background:none;border:none;cursor:pointer;padding:0;display:flex;align-items:center;gap:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
                      onclick: () => window.openRolePicker(m.nr, role.code),
                    },
                    h('span', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, refName),
                    refLevel
                      ? h('span', { class: 'ui-lizenz ui-lizenz-' + refLevel.toLowerCase() }, refLevel.charAt(0).toUpperCase())
                      : null,
                  )
                  : h('button', {
                      style: 'flex:1;text-align:left;font-size:12.5px;color:#9ca3af;font-style:italic;background:none;border:none;cursor:pointer;padding:0',
                      onclick: () => window.openRolePicker(m.nr, role.code),
                    }, '+ einteilen'),
              );
              grid.appendChild(cell);
            });
            card.appendChild(grid);
            body.appendChild(card);
          });
        }
      }

      // ─── Hybrid: Manuelle Einsätze-Sektion (immer sichtbar) ──────────────
      renderManualSection();
    }

    async function refreshManual() {
      const fresh = await fetchData(slug);
      externalAssignments = fresh.externalAssignments || [];
      renderMatches();
    }

    function renderManualSection() {
      const refsById = new Map(referees.map(r => [r.id, r]));
      const section = h('div', { style: 'margin-top:32px' });

      section.appendChild(h('div', { class: 'p3-ext-einsatz-header' },
        h('div', { class: 'p3-section-title' },
          `Manuelle Einsätze${externalAssignments.length ? ` (${externalAssignments.length})` : ''}`),
        h('button', { class: 'p3-btn primary small',
          onclick: () => window.openExternalEntryForm(slug, null, refreshManual) },
          '+ Einsatz anlegen'),
      ));

      if (!externalAssignments.length) {
        section.appendChild(h('div', { class: 'p3-empty-soft' },
          'Noch keine manuellen Einsätze. Nutze diese Sektion z.B. für ',
          'Bracket-Spiele, die kayakers nicht zeigt, oder wenn kayakers überhaupt keinen Spielplan hat.'));
      } else {
        const list = h('div', { class: 'p3-ext-einsatz-list' });
        externalAssignments.forEach(e => {
          list.appendChild(renderExternalEntryCard(slug, e, refsById, true, refreshManual));
        });
        section.appendChild(list);
      }
      body.appendChild(section);
    }

    renderFilters();
    renderMatches();
  };

  // Trainer-Login als separates Modal — nur im Tournament-View aufgerufen
  window.openTrainerLogin = function() {
    if (window.state.role === 'trainer') {
      // Bereits eingeloggt — Confirm-Dialog für Logout
      if (confirm('Bereits als Trainer eingeloggt. Ausloggen?')) window.logout();
      return;
    }
    const usernameInput = h('input', {
      type: 'text', name: 'username', autocomplete: 'username',
      value: 'trainer@vmw-berlin', style: 'display:none', readonly: 'readonly',
    });
    const input = h('input', {
      type: 'password', placeholder: '••••••••', class: 'p3-input',
      autocomplete: 'current-password', name: 'password',
    });
    const btn = h('button', { class: 'p3-btn primary', type: 'submit' }, 'Login');
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); btn.click(); } };
    setTimeout(() => input.focus(), 50);
    btn.onclick = () => withLoading(btn, 'Prüfe …', async () => {
      try {
        window.state.adminPassword = input.value;
        const slug = window.CURRENT_SLUG || 'dc2026';
        await api(`/api/admin/login?slug=${encodeURIComponent(slug)}`, { method: 'POST', body: '{}' });
        window.state.role = 'trainer';
        localStorage.setItem('vmw.adminPwd', input.value);
        localStorage.setItem('vmw.role', 'trainer');
        toast('Eingeloggt als Trainer', 'success');
        closeModal();
        // Direkt zur Einteilungs-Page
        window.openTournamentLineup(slug);
      } catch (e) {
        window.state.adminPassword = null;
        toast('Login fehlgeschlagen', 'error');
      }
    });
    const form = h('form', {
      autocomplete: 'on',
      onsubmit: (e) => { e.preventDefault(); btn.click(); },
    },
      h('label', {}, 'Trainer-Passwort'),
      usernameInput, input, btn,
    );
    const modal = h('div', { class: 'p3-modal-content' },
      h('div', { class: 'p3-modal-h' },
        h('h3', {}, 'Trainer-Login'),
        h('button', { class: 'p3-close', onclick: closeModal }, '×')),
      h('div', { class: 'p3-body' },
        h('div', { class: 'p3-hint', style: 'margin-bottom:12px' },
          'Login um Schiri-Einteilungen für dieses Turnier vorzunehmen.'),
        form,
      ),
    );
    openModal(modal);
  };

  // ═══════════════════════════════════════════════════════════════════
  // ROLLEN-PICKER (Schiri für ein Match in eine Rolle eintragen)
  // ═══════════════════════════════════════════════════════════════════
  window.openRolePicker = function(matchNr, roleCode) {
    const role = ROLES.find(r => r.code === roleCode);
    if (!role) return;
    const match = window.state.snapshot?.matches?.find(m => m.nr === matchNr);
    if (!match) return;
    const refs = window.state.referees || [];
    const currentAssignment = (window.state.assignments?.[matchNr]?.roles) || {};

    let filterCategory = 'all';
    let filterLevel = 'all';
    let search = '';

    const listEl = h('div', { class: 'p3-picker-list' });
    function render() {
      listEl.innerHTML = '';
      const matchDivKey = match.divisionCode || ''; // U14|U16|U21|Women|Men1|Men2
      const defaultCat = matchDivKey === 'Women' ? 'Damen' : (matchDivKey.startsWith('Men') ? 'Herren' : matchDivKey);
      const cat = filterCategory === 'auto' ? defaultCat : (filterCategory === 'all' ? null : filterCategory);

      let visible = refs.filter(r => r.active !== false);
      if (cat) visible = visible.filter(r => (r.categories || []).includes(cat));
      if (filterLevel !== 'all') visible = visible.filter(r => r.level === filterLevel);
      if (search) visible = visible.filter(r => (r.displayName || '').toLowerCase().includes(search.toLowerCase()));

      // "Keine Auswahl"-Option oben
      listEl.appendChild(h('div', {
        class: 'p3-picker-item empty',
        onclick: () => savePick(null),
      }, h('em', {}, '— Keine Auswahl —')));

      visible.forEach(r => {
        const disabled = role.requiresRefMatch && r.level === 'PLZ';
        const alreadyAssigned = Object.entries(currentAssignment).find(([rc, id]) => rc !== roleCode && id === r.id);
        const item = h('div', {
          class: 'p3-picker-item' + (disabled || alreadyAssigned ? ' disabled' : ''),
          onclick: disabled || alreadyAssigned ? null : () => savePick(r.id),
        },
          h('div', {},
            h('div', { class: 'p3-pname' }, r.displayName || ''),
            h('div', { class: 'p3-pmeta' }, `${r.level || '—'} · ${(r.categories || []).join(', ')}`)
          ),
          disabled ? h('div', { class: 'p3-pdis' }, 'PLZ darf nicht 1./2. Schiri')
          : alreadyAssigned ? h('div', { class: 'p3-pdis' }, 'bereits eingeteilt')
          : null
        );
        listEl.appendChild(item);
      });
    }

    async function savePick(refId) {
      // currentAssignment kann Felder mit undefined haben — explizit null setzen für leere
      const cleanCurrent = {};
      for (const r of ROLES) cleanCurrent[r.code] = currentAssignment[r.code] || null;
      const newRoles = { ...cleanCurrent, [roleCode]: refId };
      try {
        const slug = window.CURRENT_SLUG || 'dc2026';
        const result = await api(`/api/admin/t/${slug}/assignments/${matchNr}`, {
          method: 'POST',
          body: JSON.stringify({ roles: newRoles }),
        });
        window.state.assignments = result.assignments;
        toast('Gespeichert', 'success');
        closeModal();
        // Falls auf Lineup-Page → neu rendern
        if (typeof window.openTournamentLineup === 'function' && document.body.classList.contains('p3-page')) {
          window.openTournamentLineup(slug);
        } else if (typeof window.renderActiveTab === 'function') {
          window.renderActiveTab();
        }
      } catch (e) {
        // Detaillierte Server-Fehlermeldung statt nur "Fehler"
        const msg = e.data?.message || e.data?.error || e.message || 'unbekannt';
        toast('Fehler: ' + msg, 'error');
      }
    }

    const filters = h('div', { class: 'p3-picker-filters' });
    function renderFilterPills() {
      filters.innerHTML = '';
      filters.appendChild(h('div', { class: 'p3-filter-row' },
        h('span', { class: 'p3-flabel' }, 'Kategorie:'),
        ...['all', ...CATEGORIES].map(c => {
          const btn = h('button', { class: 'p3-pillchoice' + (filterCategory === c ? ' active' : '') },
            c === 'all' ? 'Alle' : c);
          btn.onclick = () => { filterCategory = c; renderFilterPills(); render(); };
          return btn;
        }),
      ));
      filters.appendChild(h('div', { class: 'p3-filter-row' },
        h('span', { class: 'p3-flabel' }, 'Klasse:'),
        ...['all', ...REFEREE_LEVELS].map(l => {
          const btn = h('button', { class: 'p3-pillchoice' + (filterLevel === l ? ' active' : '') },
            l === 'all' ? 'Alle' : l);
          btn.onclick = () => { filterLevel = l; renderFilterPills(); render(); };
          return btn;
        }),
      ));
    }
    renderFilterPills();
    const searchEl = h('input', {
      type: 'text', placeholder: '🔍 Suchen…', class: 'p3-input',
      oninput: (e) => { search = e.target.value; render(); },
    });

    const teamLabel = `${match.teamA?.name || ''} vs ${match.teamB?.name || ''}`;
    const modal = h('div', { class: 'p3-modal-content' },
      h('div', { class: 'p3-modal-h' },
        h('div', {},
          h('h3', {}, `${role.label} · Spiel #${matchNr}`),
          h('div', { class: 'p3-subtitle' }, teamLabel)
        ),
        h('button', { class: 'p3-close', onclick: closeModal }, '×'),
      ),
      h('div', { class: 'p3-picker-search' }, searchEl),
      filters,
      listEl,
    );
    openModal(modal);
    render();
  };

  // ═══════════════════════════════════════════════════════════════════
  // PROFIL-SHEET (Public, Klick auf Schiri-Pillen-Namen)
  // ═══════════════════════════════════════════════════════════════════
  window.openProfile = async function(refereeId) {
    const year = new Date().getFullYear();
    try {
      const data = await fetch(`/api/club/referees/${refereeId}/stats?year=${year}`).then(r => r.json());
      if (data.error) { toast('Profil nicht gefunden', 'error'); return; }
      const modal = h('div', { class: 'p3-modal-content' },
        h('div', { class: 'p3-modal-h' },
          h('div', {},
            h('h3', {}, data.displayName),
            h('div', { class: 'p3-subtitle' }, `Klasse ${data.level || '—'}`)
          ),
          h('button', { class: 'p3-close', onclick: closeModal }, '×'),
        ),
        h('div', { class: 'p3-body' },
          h('div', { class: 'p3-stat-grid' },
            h('div', { class: 'p3-stat' },
              h('div', { class: 'p3-stat-label' }, `Einsätze ${year}`),
              h('div', { class: 'p3-stat-value' }, String(data.totalGames || 0))),
            h('div', { class: 'p3-stat' },
              h('div', { class: 'p3-stat-label' }, 'Turniere'),
              h('div', { class: 'p3-stat-value' }, String((data.byTournament || []).length))),
          ),
          h('div', { class: 'p3-section-title' }, 'Pro Rolle'),
          h('div', { class: 'p3-list' },
            ...ROLES.map(r => {
              const cnt = (data.byRole?.[r.code] || 0);
              if (!cnt) return null;
              return h('div', { class: 'p3-list-item' },
                h('span', {}, r.label),
                h('strong', {}, String(cnt))
              );
            }).filter(Boolean)
          ),
          h('div', { class: 'p3-section-title' }, 'Pro Turnier'),
          h('div', { class: 'p3-list' },
            ...(data.byTournament || []).map(t =>
              h('div', { class: 'p3-list-item' },
                h('span', {}, t.name),
                h('strong', {}, String(t.games))
              )
            )
          ),
        ),
      );
      openModal(modal);
    } catch (e) {
      toast('Profil konnte nicht geladen werden', 'error');
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // SELF-SERVICE: Mein Profil + Meine Einsätze
  // ═══════════════════════════════════════════════════════════════════
  window.openMyProfile = async function(opts = {}) {
    closeModal();
    // N2 — URL auf /profil setzen, damit Browser-Refresh den User im Profil
    // hält statt auf der Landing zu landen. Idempotent (kein doppelter
    // History-Eintrag bei wiederholtem Profil-Mutations-Refresh).
    if (window.location.pathname !== '/profil') {
      window.history.pushState({}, '', '/profil');
    }
    // N1 R3 — Year-Toggle: erlaubt das Aufrufen mit einem anderen Jahr oder 'all'.
    // Default = aktuelles Jahr. Wert wird sowohl an /api/me/entries als auch an
    // den DKV-PDF-Button durchgereicht.
    const activeYear = opts.year ?? new Date().getFullYear();
    // SOFORT Loading-State rendern, NICHT auf den Fetch warten. Sonst bleibt der
    // User auf der vorherigen Page (z.B. External-Dashboard) und denkt "lädt nicht".
    document.body.innerHTML = '';
    document.body.classList.remove('p3-landing-mode', 'p3-page-external');
    document.body.classList.add('p3-page', 'p3-page-schiri');
    document.body.style.visibility = 'visible';
    const loadingView = h('div', { class: 'p3-page-wrap' },
      h('header', { class: 'p3-page-header' },
        h('h1', {}, '👋 Mein Profil')),
      h('div', { class: 'p3-body' },
        h('div', { class: 'p3-hint', style: 'padding:32px;text-align:center' },
          h('span', { class: 'p3-spinner' }), ' Profil wird geladen …')),
    );
    document.body.appendChild(loadingView);

    try {
      // N1 — `fresh:true` umgeht den 5s-Browser-Cache. openMyProfile() wird
      // direkt nach Mutationen aufgerufen (POST/PUT/DELETE auf manual-entry);
      // ohne den Bypass würden die alten Daten gerendert.
      const [profile, entries] = await Promise.all([
        api('/api/me/profile', { fresh: true }),
        // N1 R3 — Year-Toggle: 'all' → kein year-Filter
        api(`/api/me/entries?year=${activeYear}`, { fresh: true }),
      ]);
      const ref = profile.referee;
      const incomplete = !ref.street || !ref.city || !ref.licenseNr;

      // Page-Layout (kein Modal — bleibt persistent)
      document.body.innerHTML = '';
      document.body.classList.add('p3-page', 'p3-page-schiri');
      document.body.style.visibility = 'visible';

      // P2.7 — Hero-Avatar + Stats + DKV-CTA (Mockup Slide 7).
      const initials = (ref.displayName || ref.firstName || '?')
        .split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();

      // Inline-SVG für das DKV-Icon (Lucide-Style)
      function dkvIcon() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '18'); svg.setAttribute('height', '18');
        svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', '#fff'); svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
        svg.innerHTML = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline>';
        return svg;
      }

      const page = h('div', { class: 'p3-page-wrap' },
        h('header', { class: 'p3-page-header' },
          h('button', { class: 'p3-btn small', onclick: () => {
            document.body.classList.remove('p3-page', 'p3-page-schiri');
            window.renderLanding();
          } }, '← Übersicht'),
          h('h1', {}, 'Mein Profil'),
          window.renderUserArea({ onBrand: true }),
        ),
        h('div', { class: 'p3-body' },

          // Hero-Card mit Avatar + Name + Pills
          h('div', { class: 'ui-card', style: 'display:flex;gap:14px;align-items:center;margin-bottom:14px' },
            h('div', { class: 'ui-avatar ui-avatar-lg' }, initials),
            h('div', { style: 'flex:1;min-width:0' },
              h('div', { style: 'font-size:18px;font-weight:600;line-height:1.2' },
                ref.displayName || `${ref.firstName} ${ref.lastName || ''}`.trim()),
              h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px' },
                ref.level
                  ? h('span', { class: 'ui-pill', style: 'background:rgba(22,163,74,0.12);color:#15803D' },
                      ref.level + '-Schiri')
                  : null,
                ...(ref.categories || []).map(c =>
                  h('span', { class: 'ui-pill ui-pill-class' }, c.charAt(0).toUpperCase() + c.slice(1))),
              ),
            ),
          ),

          incomplete ? h('div', { class: 'p3-banner warning' },
            '⚠ Bitte ergänze deine Adresse + Ausweis-Nr. unten, damit der jährliche Einsatzbogen-Export funktioniert.') : null,

          // Stats als ui-stat-tile
          // N1 R3 — Label respektiert das aktive Jahr; bei 'all' wird das
          // aktuelle Jahr als Default fürs PDF-Label genutzt.
          (() => {
            const yearLabel = entries.year === 'all'
              ? 'alle Jahre'
              : String(entries.year);
            // Für DKV-PDF: 'all' ist kein gültiger DKV-Bogen → wir nehmen
            // im PDF-Fall das aktuelle Jahr. Im UI ist das Verhalten klar
            // erkennbar, weil das CTA-Label „aktuelles Jahr" zeigt.
            const pdfYear = entries.year === 'all'
              ? new Date().getFullYear()
              : entries.year;

            return [
              h('div', { style: 'display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:14px' },
                h('div', { class: 'ui-stat-tile' },
                  h('div', { class: 'num' }, String(entries.stats?.totalGames || 0)),
                  h('div', { class: 'lbl' }, `Einsätze ${yearLabel}`)),
                h('div', { class: 'ui-stat-tile' },
                  h('div', { class: 'num' }, String((entries.manualEntries || []).length)),
                  h('div', { class: 'lbl' }, 'davon manuell')),
              ),

              // DKV-PDF als prominente CTA-Card (Mockup Slide 7)
              h('div', { class: 'ui-card',
                style: 'display:flex;align-items:center;gap:12px;background:#F4F3FE;border:1px solid #CECBF6;margin-bottom:14px' },
                h('div', { style: 'width:38px;height:38px;border-radius:9px;background:#534AB7;color:#fff;display:grid;place-items:center;flex:0 0 auto' },
                  dkvIcon()),
                h('div', { style: 'flex:1;min-width:0' },
                  h('div', { style: 'font-weight:600;color:#26215C' }, `DKV-Einsatzbogen ${pdfYear}`),
                  h('div', { style: 'font-size:12px;color:#5F5BAF;margin-top:2px' },
                    entries.year === 'all'
                      ? 'PDF lädt das aktuelle Jahr — wähle einen Year-Tab für andere Jahre'
                      : 'Offizielles PDF — auf Knopfdruck'),
                ),
                h('button', {
                  class: 'ui-btn ui-btn-sm',
                  style: 'background:#534AB7;color:#fff;flex:0 0 auto',
                  title: incomplete
                    ? 'Stammdaten unvollständig — PDF enthält Lücken'
                    : 'DKV-Einsatzbogen als PDF herunterladen',
                  onclick: (e) => withLoading(e.currentTarget, 'PDF …', async () => {
                    const filename = `DKV-Einsatzbogen-${ref.code || ref.id}-${pdfYear}.pdf`;
                    await window.downloadFile(
                      `/api/me/pdf-einsatzbogen?year=${pdfYear}`,
                      filename,
                    );
                  }),
                }, 'PDF laden'),
              ),
            ];
          })(),

          // N1 R3 — Year-Tabs: letzte 3 Jahre + „Alle". Klick rendert das Profil
          // mit dem gewählten Jahr neu (öffnet `openMyProfile({year})`). Reuse
          // der bestehenden .p3-yeartab-Klasse von der Landing.
          (() => {
            const thisYear = new Date().getFullYear();
            const years = [thisYear, thisYear - 1, thisYear - 2];
            const bar = h('div', { class: 'p3-yeartabs', style: 'margin:12px 0' });
            years.forEach(y => {
              const btn = h('button', {
                class: 'p3-yeartab' + (activeYear === y ? ' active' : ''),
                onclick: () => window.openMyProfile({ year: y }),
              }, String(y));
              bar.appendChild(btn);
            });
            bar.appendChild(h('button', {
              class: 'p3-yeartab' + (activeYear === 'all' ? ' active' : ''),
              onclick: () => window.openMyProfile({ year: 'all' }),
            }, 'Alle'));
            return bar;
          })(),

          // Einsatz-Tabelle (Logik unverändert)
          h('h3', { class: 'ui-section-h' },
            h('span', { class: 'dot dot-planned' }),
            `Einsätze ${entries.year === 'all' ? '(alle Jahre)' : entries.year}`,
            h('span', { class: 'counter' },
              String((entries.autoEntries?.length || 0) + (entries.manualEntries?.length || 0)))),
          renderEntriesTable(entries),

          // Manueller-Einsatz-Button als Ghost-Button (CTA bleibt der DKV-PDF-Button oben)
          h('div', { style: 'margin-top:12px' },
            h('button', {
              class: 'ui-btn ui-btn-ghost',
              onclick: () => window.openManualEntryForm(),
            }, '+ Manuellen Einsatz ergänzen'),
          ),

          // ─── Stammdaten (eingeklappt) ──────────────────────────────────
          (() => {
            const details = h('details', { class: 'p3-collapse' });
            if (incomplete) details.open = true; // zwingend offen wenn unvollständig
            details.appendChild(h('summary', {},
              h('span', { class: 'p3-section-title-inline' }, 'Stammdaten'),
              h('span', { class: 'p3-hint' }, incomplete ? ' · ⚠ unvollständig' : ' · vollständig'),
            ));
            renderProfileForm(ref).forEach(el => details.appendChild(el));
            return details;
          })(),
        ),
      );
      document.body.appendChild(page);
    } catch (e) {
      toast('Profil konnte nicht geladen werden: ' + e.message, 'error');
    }
  };

  function renderEntriesTable(entries) {
    const ROLE_LABELS = {
      ref1: '1. SR', ref2: '2. SR', scorer: 'Protokoll', timer: 'Zeit',
      shotclock: 'Shotclock', line1: '1. Linie', line2: '2. Linie',
    };
    const rows = [];
    // Auto-Einträge — eine Zeile pro Einsatz mit Datum + Spielnummer
    (entries.autoEntries || []).forEach(e => {
      rows.push({
        date: e.date,
        tournament: e.tournamentName,
        match: `#${e.matchNr}`,
        role: ROLE_LABELS[e.role] || e.role,
        source: 'auto',
      });
    });
    // Manuelle Einträge
    (entries.manualEntries || []).forEach(e => {
      rows.push({
        date: e.tournamentDate,
        tournament: e.tournamentName,
        match: e.matchNr ? `#${e.matchNr}` : (e.matchLabel || '—'),
        role: ROLE_LABELS[e.role] || e.role,
        source: 'manuell',
        entryId: e.id,
      });
    });
    rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    if (!rows.length) {
      return h('div', { class: 'p3-hint', style: 'padding:16px; text-align:center' },
        'Noch keine Einsätze in diesem Jahr.');
    }

    const tbl = h('table', { class: 'p3-table' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Datum'),
        h('th', {}, 'Veranstaltung'),
        h('th', {}, 'Spiel'),
        h('th', {}, 'Rolle'),
        h('th', {}, 'Quelle'),
        h('th', {}, ''),
      )),
      h('tbody', {},
        ...rows.map(r => h('tr', {},
          h('td', {}, r.date || '—'),
          h('td', {}, r.tournament),
          h('td', {}, r.match),
          h('td', {}, r.role),
          h('td', {}, r.source === 'manuell'
            ? h('span', { class: 'p3-badge', style: 'background:#dbeafe;color:#1e40af' }, '✍ manuell')
            : h('span', { class: 'p3-badge', style: 'background:#dcfce7;color:#166534' }, '🏟️ auto')),
          h('td', {},
            r.entryId
              ? (() => {
                  const b = h('button', { class: 'p3-btn small danger' }, '✕');
                  b.onclick = async () => {
                    if (!confirm('Eintrag löschen?')) return;
                    try {
                      await api(`/api/me/manual-entry/${r.entryId}`, { method: 'DELETE' });
                      window.openMyProfile();
                    } catch (err) { toast('Fehler: ' + err.message, 'error'); }
                  };
                  return b;
                })()
              : ''),
        )),
      ),
    );
    return h('div', { style: 'overflow-x:auto' }, tbl);
  }

  function renderProfileForm(ref) {
    const fields = [
      ['firstName', 'Vorname'], ['lastName', 'Nachname'], ['displayName', 'Anzeigename'],
      ['street', 'Straße *'], ['city', 'PLZ + Ort *'], ['phone', 'Telefon'],
      ['licenseNr', 'Ausweis-Nr. *'], ['federation', 'Verband'], ['club', 'Verein'],
    ];
    const inputs = {};
    const form = h('div', { class: 'p3-form' },
      ...fields.map(([key, label]) => {
        const input = h('input', { type: 'text', class: 'p3-input', value: ref[key] || '' });
        inputs[key] = input;
        return h('div', { class: 'p3-field' },
          h('label', {}, label),
          input,
        );
      }),
      (() => {
        const btn = h('button', { class: 'p3-btn primary' }, 'Stammdaten speichern');
        btn.onclick = () => withLoading(btn, 'Speichere …', async () => {
          const patch = {};
          for (const [key] of fields) patch[key] = inputs[key].value;
          try {
            await api('/api/me/profile', { method: 'PUT', body: JSON.stringify(patch) });
            toast('Stammdaten gespeichert', 'success');
            // Profil neu rendern, damit "unvollständig"-Badge + Banner aktualisiert werden
            await window.openMyProfile();
          } catch (e) {
            toast('Fehler: ' + e.message, 'error');
          }
        });
        return btn;
      })(),
    );
    return [form];
  }

  function renderManualEntries(entries) {
    if (!entries.length) return [h('div', { class: 'p3-hint' }, 'Noch keine manuellen Einträge.')];
    return entries.map(e => h('div', { class: 'p3-entry' },
      h('div', {},
        h('div', { class: 'p3-entry-title' }, `${e.tournamentDate} · ${e.tournamentName}`),
        h('div', { class: 'p3-entry-meta' }, `${e.matchLabel || ''} · ${ROLES.find(r=>r.code===e.role)?.label || e.role}`),
      ),
      h('button', {
        class: 'p3-btn small danger',
        onclick: async () => {
          if (!confirm('Eintrag löschen?')) return;
          try {
            await api(`/api/me/manual-entry/${e.id}`, { method: 'DELETE' });
            closeModal();
            window.openMyProfile();
          } catch (err) { toast('Fehler: ' + err.message, 'error'); }
        },
      }, '×'),
    ));
  }

  window.openManualEntryForm = function() {
    const inputs = {};
    function input(name, label, opts = {}) {
      const attrs = { type: opts.type || 'text', class: 'p3-input', placeholder: opts.placeholder || '' };
      // N1 R3 — min/max für date-Inputs durchreichen, damit der Browser-Picker
      // den Datumsbereich von vornherein einschränkt (verhindert 1111-01-01).
      if (opts.min) attrs.min = opts.min;
      if (opts.max) attrs.max = opts.max;
      const el = h('input', attrs);
      inputs[name] = el;
      return h('div', { class: 'p3-field' }, h('label', {}, label), el);
    }
    function select(name, label, options) {
      const el = h('select', { class: 'p3-input' }, ...options.map(o => h('option', { value: o.value }, o.label)));
      inputs[name] = el;
      return h('div', { class: 'p3-field' }, h('label', {}, label), el);
    }
    const saveBtn = h('button', { class: 'p3-btn primary' }, 'Speichern');
    saveBtn.onclick = () => withLoading(saveBtn, 'Speichere …', async () => {
      const body = {};
      for (const k of Object.keys(inputs)) body[k] = inputs[k].value;
      // Client-seitige Mindestvalidierung — sonst Fehler erst spät vom Server
      if (!body.tournamentName?.trim())  return toast('Veranstaltung fehlt', 'error');
      if (!body.tournamentDate)           return toast('Datum fehlt', 'error');
      try {
        await api('/api/me/manual-entry', { method: 'POST', body: JSON.stringify(body) });
        // Modal IMMER schließen — auch wenn openMyProfile gleich noch hängt
        closeModal();
        toast('Eintrag gespeichert', 'success');
        // Profil neu laden, damit der Eintrag direkt sichtbar ist
        await window.openMyProfile();
      } catch (e) {
        toast('Fehler: ' + e.message, 'error');
      }
    });
    const content = h('div', { class: 'p3-modal-content' },
      h('div', { class: 'p3-modal-h' },
        h('h3', {}, 'Manuellen Einsatz ergänzen'),
        h('button', { class: 'p3-close', onclick: closeModal }, '×')),
      h('div', { class: 'p3-body' },
        input('tournamentName', 'Veranstaltung *', { placeholder: 'z.B. Pokal Frühling Cottbus 2026' }),
        // N1 R3 — Range 2000 bis next-year (Server-Validierung im Backend)
        input('tournamentDate', 'Datum *', {
          type: 'date',
          min: '2000-01-01',
          max: `${new Date().getFullYear() + 1}-12-31`,
        }),
        input('matchNr', 'Spiel-Nr. *', { placeholder: 'z.B. 42' }),
        select('role', 'Funktion *', ROLES.map(r => ({ value: r.code, label: r.label }))),
        // N2 — Spielklasse für DKV-Bogen (wird im PDF in die richtige Spalte
        // gemappt). Leere Option = nicht angeben (Legacy-Verhalten).
        select('spielklasse', 'Spielklasse', [
          { value: '',         label: '— wählen —' },
          { value: 'herren',   label: 'Herren' },
          { value: 'damen',    label: 'Damen' },
          { value: 'junioren', label: 'U21 / Junioren' },
          { value: 'jugend',   label: 'Jugend' },
          { value: 'schueler', label: 'Schüler' },
        ]),
        input('notes', 'Bemerkung (optional)'),
        saveBtn,
      ),
    );
    openModal(content);
  };

  // ═══════════════════════════════════════════════════════════════════
  // MASTER-ADMIN: Stammdaten verwalten
  // ═══════════════════════════════════════════════════════════════════
  window.openMasterAdmin = async function() {
    if (window.state.role !== 'master') { openLogin(); return; }
    // Schließe alle offenen Modals und übernimm die ganze Seite
    closeModal();
    let activeTab = 'tournaments';

    const tabBar = h('div', { class: 'p3-tabbar' });
    const body = h('div', { class: 'p3-body' });

    async function render() {
      tabBar.innerHTML = '';
      for (const t of [['tournaments','Turniere'], ['referees','Schiris'], ['reports','Reports'], ['banner','Banner']]) {
        const btn = h('button', {
          class: 'p3-tab ' + (activeTab === t[0] ? 'active' : ''),
          onclick: () => { activeTab = t[0]; render(); },
        }, t[1]);
        tabBar.appendChild(btn);
      }
      body.innerHTML = '';
      body.appendChild(h('div', { class: 'p3-hint', style: 'padding:8px' }, '🔄 Lade …'));

      try {
        await renderActiveTab();
      } catch (e) {
        body.innerHTML = '';
        body.appendChild(h('div', { class: 'p3-banner error' },
          'Fehler beim Laden: ' + (e.message || 'unbekannt')));
        body.appendChild(h('button', { class: 'p3-btn', onclick: render }, '↻ Erneut versuchen'));
      }
    }

    async function renderActiveTab() {
      body.innerHTML = '';

      if (activeTab === 'tournaments') {
        const result = await api('/api/admin/tournaments');
        body.appendChild(h('button', {
          class: 'p3-btn primary', style: 'margin-bottom:12px',
          onclick: () => openTournamentWizard(),
        }, '+ Neues Turnier'));
        result.tournaments.forEach(t => {
          const scrapeBtn = h('button', { class: 'p3-btn small' }, '🔄 Scrape');
          scrapeBtn.onclick = () => withLoading(scrapeBtn, 'Scrape …', () => quickScrape(t.slug));

          const editBtn = h('button', { class: 'p3-btn small', title: 'Turnier bearbeiten' }, '✏️ Edit');
          editBtn.onclick = () => openTournamentEdit(t, render);

          const deleteBtn = h('button', { class: 'p3-btn small danger', title: 'Turnier löschen' }, '🗑');
          deleteBtn.onclick = () => withLoading(deleteBtn, '', async () => {
            if (!confirm(`Turnier "${t.name}" wirklich löschen?\nSnapshot + alle Einteilungen werden ebenfalls entfernt.`)) return;
            try {
              await api(`/api/admin/tournaments/${t.slug}`, { method: 'DELETE' });
              toast('Turnier gelöscht', 'success');
              render();
            } catch (e) { toast('Löschen fehlgeschlagen: ' + e.message, 'error'); }
          });

          const datesStr = (t.dates || []).length
            ? formatDateRange(t.dates)
            : '—';

          body.appendChild(h('div', { class: 'p3-admin-row' },
            h('div', {},
              h('strong', {}, t.name),
              h('div', { class: 'p3-hint' }, `${datesStr} · ${t.status} · ${t.connector || (t.type === 'external' ? 'extern' : '—')} · ${t.slug}`)
            ),
            h('div', { class: 'p3-row-actions' },
              editBtn,
              t.type === 'external' ? null : scrapeBtn,
              h('select', {
                class: 'p3-input small',
                onchange: async (e) => {
                  await api(`/api/admin/tournaments/${t.slug}/status`, { method: 'POST', body: JSON.stringify({ status: e.target.value }) });
                  toast('Status aktualisiert', 'success'); render();
                },
              },
                ...['draft','awaiting-schedule','active','completed','archived'].map(s =>
                  h('option', { value: s, selected: s === t.status }, s))
              ),
              deleteBtn,
            ),
          ));
        });
      }

      if (activeTab === 'referees') {
        const result = await api('/api/admin/referees');
        body.appendChild(h('button', {
          class: 'p3-btn primary', style: 'margin-bottom:12px',
          onclick: () => openRefereeForm(),
        }, '+ Neuer Schiri'));
        result.referees.forEach(r => {
          const actions = [];

          // Edit-Button (immer verfügbar)
          actions.push(h('button', { class: 'p3-btn small', onclick: () => openRefereeForm(r) }, 'Edit'));

          if (r.active !== false) {
            // Aktiver Schiri: Code generieren + Soft-Delete (Deaktivieren)
            const codeBtn = h('button', { class: 'p3-btn small' }, '🔑 Code');
            codeBtn.onclick = () => withLoading(codeBtn, 'Generiere …', () => generateCode(r.id));
            actions.push(codeBtn);

            // Master kann pro Schiri den DKV-Bogen herunterladen (z.B. wenn der
            // Schiri selbst keinen Zugriff hat oder ihn nicht generiert).
            const pdfBtn = h('button', {
              class: 'p3-btn small',
              title: 'DKV-Einsatzbogen für ' + r.displayName + ' herunterladen',
            }, '📄 PDF');
            pdfBtn.onclick = () => withLoading(pdfBtn, 'PDF …', async () => {
              const year = new Date().getFullYear();
              const safeName = (r.displayName || r.firstName || 'schiri').replace(/[^a-z0-9-]/gi, '_');
              await window.downloadFile(
                `/api/admin/referees/${r.id}/pdf-einsatzbogen?year=${year}`,
                `DKV-Einsatzbogen-${safeName}-${year}.pdf`,
              );
            });
            actions.push(pdfBtn);

            const deactivateBtn = h('button', { class: 'p3-btn small danger', title: 'Deaktivieren (Soft-Delete)' }, '🚫');
            deactivateBtn.onclick = () => withLoading(deactivateBtn, '', async () => {
              if (!confirm(`"${r.displayName}" deaktivieren?\nHistorische Einsätze bleiben in den Reports erhalten.`)) return;
              try { await api(`/api/admin/referees/${r.id}`, { method: 'DELETE' }); toast('Deaktiviert', 'success'); render(); }
              catch (e) { toast('Fehler: ' + e.message, 'error'); }
            });
            actions.push(deactivateBtn);
          } else {
            // Inaktiver Schiri: Reaktivieren + Hard-Delete
            const reactivateBtn = h('button', { class: 'p3-btn small' }, '🔄 Reaktivieren');
            reactivateBtn.onclick = () => withLoading(reactivateBtn, '', async () => {
              try {
                await api(`/api/admin/referees/${r.id}`, { method: 'PUT', body: JSON.stringify({ active: true }) });
                toast('Reaktiviert', 'success'); render();
              } catch (e) { toast('Fehler: ' + e.message, 'error'); }
            });
            actions.push(reactivateBtn);

            const hardDeleteBtn = h('button', { class: 'p3-btn small danger', title: 'Endgültig löschen' }, '🗑 Endgültig');
            hardDeleteBtn.onclick = () => withLoading(hardDeleteBtn, '', async () => {
              if (!confirm(`"${r.displayName}" ENDGÜLTIG löschen?\n\n⚠ Stammdaten + manuelle Einträge werden komplett entfernt.\nHistorische Einsätze in Reports verlieren ihre Auflösung.\n\nDas kann nicht rückgängig gemacht werden.`)) return;
              try {
                await api(`/api/admin/referees/${r.id}?permanent=1`, { method: 'DELETE' });
                toast('Endgültig gelöscht', 'success'); render();
              } catch (e) { toast('Fehler: ' + e.message, 'error'); }
            });
            actions.push(hardDeleteBtn);
          }

          body.appendChild(h('div', { class: 'p3-admin-row' },
            h('div', {},
              h('strong', {}, `${r.firstName} ${r.lastName}`),
              h('span', { class: 'p3-hint' }, ` · "${r.displayName}" · ${r.level || '—'} · ${(r.categories || []).join(', ')}`),
              r.loginCode ? h('div', { class: 'p3-code' }, `Login-Code: ${r.loginCode}`) : null,
              r.active === false ? h('span', { class: 'p3-badge muted' }, 'inaktiv') : null,
            ),
            h('div', { class: 'p3-row-actions' }, ...actions),
          ));
        });
      }

      if (activeTab === 'reports') {
        const year = new Date().getFullYear();
        const result = await api(`/api/admin/reports/referees?year=${year}`);
        body.appendChild(h('div', { style: 'display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:12px; flex-wrap:wrap' },
          h('strong', {}, `Einsätze ${year}`),
          h('div', { style: 'display:flex; gap:6px' },
            (() => {
              const link = h('a', { class: 'p3-btn small' }, '📥 Übersicht-CSV');
              link.href = `/api/admin/reports/referees.csv?year=${year}`;
              link.title = 'Eine Zeile pro Schiri, Summen pro Rolle';
              // Mit Auth-Header — Browser-Download via Blob
              link.onclick = (e) => {
                e.preventDefault();
                downloadCsv(`/api/admin/reports/referees.csv?year=${year}`, `einsaetze-uebersicht-${year}.csv`);
              };
              return link;
            })(),
            (() => {
              const link = h('a', { class: 'p3-btn small primary' }, '📥 Detail-CSV (pro Einsatz)');
              link.href = `/api/admin/reports/entries.csv?year=${year}`;
              link.title = 'Eine Zeile pro Einsatz — passt zum DKV-Bogen-Layout';
              link.onclick = (e) => {
                e.preventDefault();
                downloadCsv(`/api/admin/reports/entries.csv?year=${year}`, `einsaetze-detail-${year}.csv`);
              };
              return link;
            })(),
          ),
        ));
        const table = h('table', { class: 'p3-table' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'Schiri'),
            h('th', {}, 'Klasse'),
            h('th', {}, 'Total'),
            ...ROLES.map(r => h('th', {}, r.short)),
          )),
          h('tbody', {},
            ...Object.values(result.byReferee || {}).sort((a,b)=>b.totalGames-a.totalGames).map(r =>
              h('tr', { onclick: () => window.openProfile(r.id), style: 'cursor:pointer' },
                h('td', {}, r.displayName),
                h('td', {}, r.level || '—'),
                h('td', {}, String(r.totalGames)),
                ...ROLES.map(role => h('td', {}, String(r.byRole?.[role.code] || 0))),
              )
            )
          )
        );
        body.appendChild(table);
      }

      if (activeTab === 'banner') {
        // Aktuellen Banner laden
        let current = null;
        try { current = (await api('/api/admin/banner')).banner; } catch { current = null; }

        body.appendChild(h('div', { class: 'p3-hint', style: 'margin-bottom:12px' },
          'Hier kannst du eine globale Info-Nachricht setzen, die auf jeder Seite ' +
          'der App ganz oben angezeigt wird — z.B. „Testphase, bitte Bugs an Julius melden".'));

        const msgInput = h('textarea', {
          class: 'p3-input',
          rows: 3,
          maxlength: 280,
          placeholder: 'Nachrichten-Text — max. 280 Zeichen',
        });
        if (current?.message) msgInput.value = current.message;

        const levelSelect = h('select', { class: 'p3-input' },
          h('option', { value: 'info'    }, 'ℹ Info (blau)'),
          h('option', { value: 'warning' }, '⚠ Warnung (gelb)'));
        if (current?.level === 'warning') levelSelect.value = 'warning';

        const activeCb = h('input', { type: 'checkbox' });
        if (current?.active) activeCb.checked = true;

        const saveBtn = h('button', { class: 'p3-btn primary' }, 'Banner speichern');
        saveBtn.onclick = () => withLoading(saveBtn, 'Speichere …', async () => {
          try {
            await api('/api/admin/banner', {
              method: 'PUT',
              body: JSON.stringify({
                message: msgInput.value.trim(),
                level: levelSelect.value,
                active: !!activeCb.checked,
              }),
            });
            toast('Banner gespeichert', 'success');
            // Cache invalidieren + Banner sofort neu rendern
            const res = await fetch('/api/banner?_ts=' + Date.now(), { cache: 'no-store' });
            const data = res.ok ? await res.json() : null;
            bannerCache = data?.active ? data : null;
            window.renderGlobalBanner();
            render();
          } catch (e) {
            toast('Fehler: ' + e.message, 'error');
          }
        });

        const clearBtn = h('button', { class: 'p3-btn danger' }, '🗑 Banner löschen');
        clearBtn.onclick = () => withLoading(clearBtn, 'Lösche …', async () => {
          if (!confirm('Banner komplett entfernen?')) return;
          try {
            await api('/api/admin/banner', { method: 'DELETE' });
            toast('Banner entfernt', 'success');
            bannerCache = null;
            window.renderGlobalBanner();
            render();
          } catch (e) {
            toast('Fehler: ' + e.message, 'error');
          }
        });

        body.appendChild(h('div', { class: 'p3-field' }, h('label', {}, 'Nachricht'), msgInput));
        body.appendChild(h('div', { class: 'p3-field' }, h('label', {}, 'Typ'), levelSelect));
        body.appendChild(h('div', { class: 'p3-field' },
          h('label', { style: 'display:flex; align-items:center; gap:8px; cursor:pointer' },
            activeCb, h('span', {}, 'Banner aktiv — wird auf allen Seiten angezeigt'))));
        body.appendChild(h('div', { class: 'p3-row', style: 'gap:8px; margin-top:12px' }, saveBtn, clearBtn));

        if (current?.updatedAt) {
          body.appendChild(h('div', { class: 'p3-hint', style: 'margin-top:16px' },
            `Zuletzt gesetzt: ${new Date(current.updatedAt).toLocaleString('de-DE')} von ${current.updatedBy || 'master'}`));
        }
      }
    }

    async function quickScrape(slug) {
      try { await api(`/api/admin/tournaments/${slug}/scrape`, { method: 'POST' }); toast(`Gescraped: ${slug}`, 'success'); }
      catch (e) { toast('Fehler: ' + e.message, 'error'); }
    }
    async function generateCode(id) {
      const result = await api(`/api/admin/referees/${id}/login-code`, { method: 'POST' });
      showCodeModal(result.loginCode);
      render();
    }
    function showCodeModal(code) {
      const codeBox = h('div', { class: 'p3-code-display' }, code);
      const copyBtn = h('button', { class: 'p3-btn primary' }, '📋 In Zwischenablage kopieren');
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(code);
          copyBtn.textContent = '✓ Kopiert';
          setTimeout(() => { copyBtn.textContent = '📋 In Zwischenablage kopieren'; }, 2000);
        } catch {
          toast('Kopieren fehlgeschlagen — bitte manuell markieren', 'error');
        }
      };
      const modal = h('div', { class: 'p3-modal-content' },
        h('div', { class: 'p3-modal-h' },
          h('h3', {}, 'Login-Code'),
          h('button', { class: 'p3-close', onclick: closeModal }, '×')),
        h('div', { class: 'p3-body' },
          h('div', { class: 'p3-hint' }, 'Diesen Code an den Schiri weitergeben (z.B. per WhatsApp):'),
          codeBox,
          copyBtn,
          h('div', { class: 'p3-hint', style: 'margin-top:12px' },
            'Der Schiri loggt sich damit unter "Login → Schiri" ein. ' +
            'Bei Verlust kannst du einen neuen Code generieren (der alte wird ungültig).'),
        ),
      );
      openModal(modal);
    }
    async function deactivate(id) {
      if (!confirm('Schiri deaktivieren?')) return;
      await api(`/api/admin/referees/${id}`, { method: 'DELETE' }); render();
    }

    async function openTournamentAssignments_unused(tournament) {
      // Lädt Snapshot + Assignments + Referees, zeigt alle Spiele mit Jury-Team-Match
      // egal welchen Status — Master kann auch beendete Turniere nachpflegen.
      body.innerHTML = '';
      body.appendChild(h('div', { class: 'p3-hint' }, '🔄 Lade Snapshot …'));

      const ROLES = [
        { code: 'ref1', short: '1.SR' }, { code: 'ref2', short: '2.SR' },
        { code: 'scorer', short: 'Prot' }, { code: 'timer', short: 'Zeit' },
        { code: 'shotclock', short: 'Shot' },
        { code: 'line1', short: 'Lin1' }, { code: 'line2', short: 'Lin2' },
      ];

      try {
        const data = await fetchData(tournament.slug);
        const snapshot = data.snapshot;
        const assignments = data.assignments || {};
        const referees = data.referees || [];

        if (!snapshot?.matches) {
          body.innerHTML = '';
          body.appendChild(h('div', { class: 'p3-banner warning' },
            'Kein Snapshot vorhanden — Turnier hat noch keinen Spielplan.'));
          body.appendChild(h('button', { class: 'p3-btn', onclick: () => { activeTab = 'einteilungen'; render(); } }, '← Zurück'));
          return;
        }

        // window.state für Picker setzen
        window.state.snapshot = snapshot;
        window.state.assignments = assignments;
        window.state.referees = referees;
        window.CURRENT_SLUG = tournament.slug;

        // Nur Spiele wo eines unserer Teams Schiri ist (analog zu Trainer-Admin)
        const ourMatches = snapshot.matches.filter(m => m.ourReferee).sort((a,b) => {
          // erst nach Tag, dann nach Zeit
          const dayDiff = (a.day || 0) - (b.day || 0);
          if (dayDiff !== 0) return dayDiff;
          return (a.time || '').localeCompare(b.time || '');
        });

        body.innerHTML = '';
        body.appendChild(h('div', { class: 'p3-section-title' },
          h('button', { class: 'p3-btn small', onclick: () => { activeTab = 'einteilungen'; render(); } }, '← Zurück'),
          ' ' + tournament.name + ` · ${ourMatches.length} Jury-Einsätze`));

        if (!ourMatches.length) {
          body.appendChild(h('div', { class: 'p3-hint' }, 'Keine VMW-Schiri-Einsätze in diesem Turnier.'));
          return;
        }

        const refsById = new Map(referees.map(r => [r.id, r]));

        // Gruppieren in: Offen (next/live ohne komplette Einteilung), Beendet
        const grouped = { offen: [], live: [], done: [] };
        ourMatches.forEach(m => {
          if (m.status === 'done') grouped.done.push(m);
          else if (m.status === 'live') grouped.live.push(m);
          else grouped.offen.push(m);
        });

        function renderMatchCard(m) {
          const ass = assignments[m.nr]?.roles || {};
          const card = h('div', { class: 'p3-conn-card', style: 'cursor:default' });
          card.appendChild(h('strong', {}, `#${m.nr} · ${m.teamA?.name} vs ${m.teamB?.name}`));
          card.appendChild(h('div', { class: 'p3-hint' },
            `${m.time || ''} · ${m.division || ''} · ${m.status === 'done' ? 'beendet' : m.status}`));
          const pillRow = h('div', { class: 'p3-pillrow', style: 'margin-top:8px; flex-wrap: wrap' });
          ROLES.forEach(role => {
            const refId = ass[role.code];
            const refName = refId && refsById.get(refId)
              ? refsById.get(refId).displayName || refsById.get(refId).firstName
              : '—';
            const pill = h('button', {
              class: 'p3-pillchoice' + (refId ? ' active' : ''),
              style: 'cursor:pointer',
              onclick: () => window.openRolePicker(m.nr, role.code),
            }, `${role.short}: ${refName}`);
            pillRow.appendChild(pill);
          });
          card.appendChild(pillRow);
          return card;
        }

        for (const [key, label] of [['offen', '⏭ Offen / Live'], ['done', '✅ Beendet']]) {
          if (key === 'offen') grouped.offen.push(...grouped.live);
          if (!grouped[key].length) continue;
          body.appendChild(h('div', { class: 'p3-section-title' }, label));
          grouped[key].forEach(m => body.appendChild(renderMatchCard(m)));
        }
      } catch (e) {
        body.innerHTML = '';
        body.appendChild(h('div', { class: 'p3-banner error' }, 'Fehler: ' + e.message));
      }
    }

    // Page-Layout (kein Modal — bleibt persistent, kein Klick-außerhalb-schließt)
    document.body.innerHTML = '';
    document.body.style.visibility = 'visible';
    document.body.classList.add('p3-page');
    const page = h('div', { class: 'p3-page-wrap' },
      h('header', { class: 'p3-page-header' },
        h('button', { class: 'p3-btn small', onclick: () => { document.body.classList.remove('p3-page'); window.renderLanding(); } }, '← Übersicht'),
        h('h1', {}, 'Master-Admin'),
        window.renderUserArea({ onBrand: true }),
      ),
      tabBar,
      body,
    );
    document.body.appendChild(page);
    render();
  };

  function openRefereeForm(existing = null) {
    const fields = [
      ['firstName', 'Vorname *'], ['lastName', 'Nachname *'], ['displayName', 'Anzeigename'],
    ];
    const inputs = {};
    fields.forEach(([k]) => { inputs[k] = h('input', { type: 'text', class: 'p3-input', value: existing?.[k] || '' }); });
    const levelSel = h('select', { class: 'p3-input' },
      ...REFEREE_LEVELS.map(l => h('option', { value: l, selected: existing?.level === l }, l))
    );
    const catWrap = h('div', { class: 'p3-pillrow' },
      ...CATEGORIES.map(c => {
        const btn = h('button', { class: 'p3-pillchoice' }, c);
        const active = (existing?.categories || []).includes(c);
        if (active) btn.classList.add('active');
        btn.onclick = () => btn.classList.toggle('active');
        return btn;
      })
    );

    const modal = h('div', { class: 'p3-modal-content' },
      h('div', { class: 'p3-modal-h' },
        h('h3', {}, existing ? 'Schiri editieren' : 'Neuer Schiri'),
        h('button', { class: 'p3-close', onclick: closeModal }, '×')),
      h('div', { class: 'p3-body' },
        ...fields.map(([k, l]) => h('div', { class: 'p3-field' }, h('label', {}, l), inputs[k])),
        h('div', { class: 'p3-field' }, h('label', {}, 'Klasse'), levelSel),
        h('div', { class: 'p3-field' }, h('label', {}, 'Kategorien'), catWrap),
        h('button', {
          class: 'p3-btn primary',
          onclick: async () => {
            const data = {
              firstName: inputs.firstName.value,
              lastName:  inputs.lastName.value,
              displayName: inputs.displayName.value || inputs.firstName.value,
              level: levelSel.value,
              categories: [...catWrap.querySelectorAll('.p3-pillchoice.active')].map(b => b.textContent),
            };
            try {
              if (existing) await api(`/api/admin/referees/${existing.id}`, { method: 'PUT', body: JSON.stringify(data) });
              else          await api('/api/admin/referees', { method: 'POST', body: JSON.stringify(data) });
              toast('Gespeichert', 'success');
              closeModal();
              window.openMasterAdmin();
            } catch (e) { toast('Fehler: ' + e.message, 'error'); }
          },
        }, 'Speichern'),
      ),
    );
    openModal(modal);
  }

  // Bekannte Connectoren — Liste passt zu scraper/connectors/index.mjs
  const KNOWN_CONNECTORS = [
    { id: 'kayakers',            label: 'kayakers.nl', supportsListing: true },
    // Bundesliga läuft als externes Turnier — kein eigener Connector mehr nötig.
  ];

  // ═══════════════════════════════════════════════════════════════════
  // TOURNAMENT-EDIT — Modal zum Editieren eines bestehenden Turniers
  // ═══════════════════════════════════════════════════════════════════
  //
  // Editierbare Felder (für alle Typen):
  //   - Name, Datums (komma-getrennt YYYY-MM-DD)
  //   - showStandings, showHausliga (nur kayakers-Turniere)
  //   - external.resources (nur externe Turniere)
  // Slug + type sind NICHT editierbar (würden Datenintegrität brechen).
  function openTournamentEdit(t, onSaved) {
    const isExternal = t.type === 'external';
    const card = h('div', { class: 'p3-modal-content' });

    const nameInput  = h('input', { class: 'p3-input', value: t.name || '' });
    const datesInput = h('input', { class: 'p3-input', value: (t.dates || []).join(', ') });
    // P1.2: „Tabellen anzeigen"-Toggle ist UI-only entfernt — Standings-Rendering
    // ist nicht implementiert. Re-enable wenn Liga-Tab gebaut ist (siehe README
    // Known Limitations). Daten in `config.showStandings` bleiben unverändert.
    // const standingsCb = h('input', { type: 'checkbox' });
    // if (t.showStandings) standingsCb.checked = true;
    const hausligaCb = h('input', { type: 'checkbox' });
    if (t.showHausliga) hausligaCb.checked = true;

    // Ressourcen für externe Turniere
    const resourceRows = [];
    const resourceSection = h('div', {});
    function addResRow(initial = {}) {
      const titleInput = h('input', { class: 'p3-input', placeholder: 'z.B. Spielplan (PDF)', value: initial.title || '' });
      const urlInput   = h('input', { class: 'p3-input', placeholder: 'https://…',          value: initial.url   || '' });
      const removeBtn  = h('button', { class: 'p3-btn small danger', onclick: () => {
        const idx = resourceRows.findIndex(r => r.row === row);
        if (idx >= 0) resourceRows.splice(idx, 1);
        row.remove();
      }}, '×');
      const row = h('div', { class: 'p3-multiday-row' },
        h('div', { style: 'display:grid; grid-template-columns: 1fr 2fr auto; gap:6px; align-items:end' },
          h('div', {}, h('label', { style: 'font-size:11px; color:#6b7280' }, 'Titel'), titleInput),
          h('div', {}, h('label', { style: 'font-size:11px; color:#6b7280' }, 'URL'),   urlInput),
          removeBtn,
        ),
      );
      resourceRows.push({ titleInput, urlInput, row });
      resourceSection.appendChild(row);
    }
    if (isExternal) {
      const existing = Array.isArray(t.external?.resources) ? t.external.resources : [];
      if (existing.length) existing.forEach(r => addResRow(r));
      else addResRow();
    }

    const saveBtn = h('button', { class: 'p3-btn primary' }, 'Speichern');
    saveBtn.onclick = () => withLoading(saveBtn, 'Speichere …', async () => {
      const dates = datesInput.value.split(',').map(s => s.trim()).filter(Boolean);
      const patch = {
        name: nameInput.value.trim(),
        dates,
      };
      if (!isExternal) {
        // P1.2: showStandings-UI entfernt, Feld bleibt im Storage unverändert
        patch.showHausliga = !!hausligaCb.checked;
      }
      if (isExternal) {
        const resources = resourceRows
          .filter(r => r.urlInput.value.trim())
          .map(r => ({
            title: r.titleInput.value.trim() || 'Externer Plan',
            url:   r.urlInput.value.trim(),
          }));
        for (const r of resources) {
          if (!/^https?:\/\//.test(r.url)) return toast(`URL ungültig: ${r.url}`, 'error');
        }
        patch.external = { resources };
      }
      try {
        await api(`/api/admin/tournaments/${t.slug}`, {
          method: 'PUT', body: JSON.stringify({ patch }),
        });
        toast('Änderungen gespeichert', 'success');
        closeModal();
        if (onSaved) await onSaved();
      } catch (e) {
        toast('Fehler: ' + e.message, 'error');
      }
    });

    card.appendChild(h('div', { class: 'p3-modal-h' },
      h('h3', {}, '✏️ Turnier bearbeiten — ' + t.slug),
      h('button', { class: 'p3-close', onclick: closeModal }, '×'),
    ));
    const body = h('div', { class: 'p3-body' });
    body.appendChild(h('div', { class: 'p3-field' }, h('label', {}, 'Name'), nameInput));
    body.appendChild(h('div', { class: 'p3-field' },
      h('label', {}, 'Tage (komma-getrennt YYYY-MM-DD)'),
      datesInput));
    if (!isExternal) {
      // P1.2: Tabellen-anzeigen-Toggle UI ausgeblendet bis Liga-Tab gebaut ist.
      // body.appendChild(h('div', { class: 'p3-field' },
      //   h('label', { style: 'display:flex; align-items:center; gap:8px; cursor:pointer' },
      //     standingsCb, h('span', {}, 'Tabellen anzeigen'))));
      body.appendChild(h('div', { class: 'p3-field' },
        h('label', { style: 'display:flex; align-items:center; gap:8px; cursor:pointer' },
          hausligaCb, h('span', {}, 'Hausliga-Tab anzeigen'))));
    }
    if (isExternal) {
      body.appendChild(h('div', { class: 'p3-field' },
        h('label', {}, 'Ressourcen (externe Pläne, PDFs, Webseiten)'),
        h('div', { class: 'p3-hint', style: 'margin-bottom:8px' },
          'Werden auf der Turnier-Dashboard-Seite verlinkt.'),
        resourceSection,
        h('button', { class: 'p3-btn small', onclick: () => addResRow() }, '+ Weitere Ressource'),
      ));
    }
    body.appendChild(h('div', { class: 'p3-hint', style: 'margin-top:12px' },
      'Slug + Typ sind nach Anlage nicht mehr änderbar.'));
    body.appendChild(saveBtn);
    card.appendChild(body);

    openModal(card);
  }

  function openTournamentWizard() {
    const resultBox = h('div', { class: 'p3-body' });

    // ─── Schritt 0: Connector-Auswahl ────────────────────────────────
    function renderStep0() {
      resultBox.innerHTML = '';

      // (1) Echte Connectoren mit Discovery
      resultBox.appendChild(h('div', { class: 'p3-section-title' }, '🔌 Mit Connector (automatisch)'));
      KNOWN_CONNECTORS.forEach(c => {
        const card = h('div', {
          class: 'p3-conn-card',
          onclick: () => {
            if (c.supportsListing) loadConnectorTournaments(c.id);
            else renderManualUrlEntry(c.id);
          },
        },
          h('strong', {}, c.label),
          h('div', { class: 'p3-hint' },
            c.supportsListing ? 'Aktuelle Turniere automatisch laden, Spielplan wird gespiegelt' : 'URL manuell eingeben'),
        );
        resultBox.appendChild(card);
      });

      // (2) Externes Turnier ohne Connector — verlinkt nur auf andere Seite
      resultBox.appendChild(h('div', { class: 'p3-section-title', style: 'margin-top:24px' }, '↗ Ohne Connector (nur Verlinkung)'));
      const extCard = h('div', {
        class: 'p3-conn-card p3-conn-card-ext',
        onclick: () => renderExternalForm(),
      },
        h('strong', {}, 'Externes Turnier verlinken'),
        h('div', { class: 'p3-hint' },
          'Für Turniere bei Anbietern ohne Connector (eigene Vereins-App, Toornament, Webseite …). Klick auf das Turnier öffnet die externe URL in neuem Tab. Status (aktiv/beendet) wird automatisch aus dem Datum bestimmt.'),
      );
      resultBox.appendChild(extCard);
    }

    // ─── Schritt 1b: Externes Turnier manuell anlegen ────────────────
    function renderExternalForm() {
      resultBox.innerHTML = '';
      resultBox.appendChild(h('button', { class: 'p3-btn small', onclick: renderStep0 }, '← Zurück'));
      resultBox.appendChild(h('div', { class: 'p3-section-title' }, '↗ Externes Turnier'));
      resultBox.appendChild(h('div', { class: 'p3-hint', style: 'margin-bottom:12px' },
        'Externe Turniere haben Schiri-Einsätze, die Trainer/Master pflegen, plus optionale Links zu externen Spielplänen (PDF, Webseite).'));

      const nameInput = h('input', { class: 'p3-input', placeholder: 'z.B. 1. Bundesliga Herren 2026' });
      const slugInput = h('input', { class: 'p3-input', placeholder: 'auto aus Name' });
      const datesInput = h('input', { class: 'p3-input', placeholder: '2026-05-23, 2026-05-24, …' });

      // Auto-Slug aus Name
      nameInput.oninput = () => {
        if (!slugInput.dataset.touched) {
          slugInput.value = nameInput.value.toLowerCase()
            .replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
        }
      };
      slugInput.oninput = () => { slugInput.dataset.touched = '1'; };

      // ─── Ressourcen-Liste (Multi-Link) ─────────────────────────────
      const resourceSection = h('div', {});
      const resourceRows = [];
      function addResourceRow(initial = {}) {
        const titleInput = h('input', { class: 'p3-input', placeholder: 'z.B. Spielplan (PDF)', value: initial.title || '' });
        const urlInput   = h('input', { class: 'p3-input', placeholder: 'https://…',          value: initial.url   || '' });
        const removeBtn  = h('button', { class: 'p3-btn small danger', title: 'Entfernen', onclick: () => {
          const idx = resourceRows.findIndex(r => r.row === row);
          if (idx >= 0) resourceRows.splice(idx, 1);
          row.remove();
        }}, '×');
        const row = h('div', { class: 'p3-multiday-row' },
          h('div', { style: 'display:grid; grid-template-columns: 1fr 2fr auto; gap:6px; align-items:end' },
            h('div', {}, h('label', { style: 'font-size:11px; color:#6b7280' }, 'Titel'), titleInput),
            h('div', {}, h('label', { style: 'font-size:11px; color:#6b7280' }, 'URL'), urlInput),
            removeBtn,
          ),
        );
        resourceRows.push({ titleInput, urlInput, row });
        resourceSection.appendChild(row);
      }
      addResourceRow();
      const addResourceBtn = h('button', { class: 'p3-btn small', onclick: () => addResourceRow() }, '+ Weitere Ressource');

      // VMW-Team-Felder wurden entfernt (Kategorie-Pills auf den Kacheln sind raus).
      const saveBtn = h('button', { class: 'p3-btn primary' }, 'Speichern');
      saveBtn.onclick = () => withLoading(saveBtn, 'Speichere …', async () => {
        const name = nameInput.value.trim();
        const slug = slugInput.value.trim();
        if (!name) return toast('Name fehlt', 'error');
        if (!/^[a-z0-9-]{3,40}$/.test(slug)) return toast('Slug muss 3-40 Zeichen [a-z0-9-]+ sein', 'error');

        const dates = datesInput.value.split(',').map(s => s.trim()).filter(Boolean);

        // Ressourcen (optional, kein Pflichtfeld)
        const resources = resourceRows
          .filter(r => r.urlInput.value.trim())
          .map(r => ({
            title: r.titleInput.value.trim() || 'Externer Plan',
            url:   r.urlInput.value.trim(),
          }));
        for (const r of resources) {
          if (!/^https?:\/\//.test(r.url)) return toast(`URL ungültig: ${r.url}`, 'error');
        }

        // Auto-Status nach Datum
        const today = new Date().toISOString().slice(0, 10);
        let status = 'active';
        if (dates.length) {
          if (today < dates[0]) status = 'active';
          else if (today > dates[dates.length - 1]) status = 'completed';
        }

        const config = {
          slug, name, type: 'external',
          connector: null, showStandings: false, showHausliga: false,
          source: null,
          external: { resources },
          status, dates,
          expectedDates: null, timezone: 'Europe/Berlin',
          pendingTeamSelection: false, lastRediscoveryAt: null,
          ourTeams: [],
        };

        try {
          await api('/api/admin/tournaments', { method: 'POST', body: JSON.stringify({ config }) });
          toast('Externes Turnier angelegt', 'success');
          closeModal();
          window.openMasterAdmin();
        } catch (e) {
          toast('Fehler: ' + e.message, 'error');
        }
      });

      resultBox.appendChild(h('div', { class: 'p3-field' }, h('label', {}, 'Name *'), nameInput));
      resultBox.appendChild(h('div', { class: 'p3-field' }, h('label', {}, 'Slug *'), slugInput,
        h('div', { class: 'p3-hint' }, 'URL des Turniers: /t/<slug>')));
      resultBox.appendChild(h('div', { class: 'p3-field' }, h('label', {}, 'Tage (komma-getrennt YYYY-MM-DD)'), datesInput,
        h('div', { class: 'p3-hint' }, 'Bestimmt automatisch ob das Turnier als "aktiv" oder "beendet" angezeigt wird.')));

      // Ressourcen-Section
      resultBox.appendChild(h('div', { class: 'p3-field' },
        h('label', {}, 'Externer Spielplan (optional)'),
        h('div', { class: 'p3-hint', style: 'margin-bottom:8px' },
          'Beliebig viele Links zu externen Plänen — PDFs, Vereinsseiten, Liga-Apps. Bei mehreren Links eine eigene Zeile pro Link.'),
        resourceSection,
        addResourceBtn,
      ));

      resultBox.appendChild(saveBtn);

      setTimeout(() => nameInput.focus(), 50);
    }

    // ─── Schritt 1: Tournament-Liste aus Connector ───────────────────
    // N3 — keine Backend-country-Filterung mehr. Wir holen alle Tournaments
    // einmal und filtern client-seitig per Pill. Damit:
    //   - sind internationale Turniere zugänglich (~1-2 pro Jahr).
    //   - sehen wir die verfügbaren Länder dynamisch aus dem Result statt
    //     einer statischen Liste.
    //   - kein zusätzlicher Round-Trip beim Wechsel zwischen Filtern.
    async function loadConnectorTournaments(connectorId) {
      resultBox.innerHTML = '';
      resultBox.appendChild(h('div', { class: 'p3-hint', style: 'padding:20px; text-align:center' }, '🔄 Lade Turnier-Liste …'));

      try {
        const result = await api(`/api/admin/discover/list?connector=${encodeURIComponent(connectorId)}`);
        renderConnectorTournamentList(connectorId, result.tournaments || []);
      } catch (e) {
        toast('Liste konnte nicht geladen werden: ' + e.message, 'error');
        renderStep0();
      }
    }

    function renderConnectorTournamentList(connectorId, list) {
      resultBox.innerHTML = '';
      const back = h('button', { class: 'p3-btn small', onclick: renderStep0 }, '← Zurück');
      resultBox.appendChild(back);

      resultBox.appendChild(h('div', { class: 'p3-section-title' }, `${list.length} Turniere gefunden`));

      const today = new Date().toISOString().slice(0, 10);
      let timeFilter    = 'upcoming';   // 'upcoming' | 'past' | 'all'
      let countryFilter = 'DE';         // N3 — 'DE' default | 'all' | sonst Country-Code
      let search        = '';

      // Verfügbare Länder dynamisch aus dem Result ableiten — so passen sich
      // die Pills automatisch an, wenn kayakers neue Länder zeigt.
      const availableCountries = [...new Set(
        list.map(t => t.countryCode).filter(Boolean)
      )].sort();
      // DE zuerst (90% Use-Case), dann der Rest alphabetisch
      const countryOrder = availableCountries.includes('DE')
        ? ['DE', ...availableCountries.filter(c => c !== 'DE')]
        : availableCountries;

      const filterRow = h('div', { class: 'p3-pillrow', style: 'margin-bottom:8px' });
      [['upcoming', 'Bevorstehend'], ['past', 'Vergangen'], ['all', 'Alle']].forEach(([k, label]) => {
        const btn = h('button', { class: 'p3-pillchoice ' + (timeFilter === k ? 'active' : '') }, label);
        btn.onclick = () => {
          timeFilter = k;
          filterRow.querySelectorAll('.p3-pillchoice').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          render();
        };
        filterRow.appendChild(btn);
      });

      // N3 — Country-Filter-Row (zweite Pill-Reihe darunter)
      const countryRow = h('div', { class: 'p3-pillrow', style: 'margin-bottom:8px' });
      const countryLabel = h('span', { class: 'p3-flabel', style: 'margin-right:4px' }, 'Land:');
      countryRow.appendChild(countryLabel);
      const countryOptions = [
        { value: 'all', label: 'Alle Länder' },
        ...countryOrder.map(c => ({ value: c, label: c })),
      ];
      countryOptions.forEach(opt => {
        const btn = h('button', {
          class: 'p3-pillchoice country-pill' + (countryFilter === opt.value ? ' active' : ''),
          'data-country': opt.value,
        }, opt.label);
        btn.onclick = () => {
          countryFilter = opt.value;
          countryRow.querySelectorAll('.country-pill').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          render();
        };
        countryRow.appendChild(btn);
      });

      const searchInput = h('input', {
        type: 'text', class: 'p3-input', placeholder: '🔍 Suchen (Name, Land) …',
        style: 'margin-bottom:8px',
      });
      searchInput.oninput = (e) => { search = e.target.value; render(); };

      const listEl = h('div');

      function render() {
        listEl.innerHTML = '';
        const ft = search.trim().toLowerCase();
        let filtered = list.filter(t => {
          if (timeFilter === 'upcoming' && t.dateIso && t.dateIso < today) return false;
          if (timeFilter === 'past'     && t.dateIso && t.dateIso >= today) return false;
          // N3 — Country-Filter (clientseitig)
          if (countryFilter !== 'all' && t.countryCode !== countryFilter) return false;
          if (!ft) return true;
          return t.name.toLowerCase().includes(ft)
              || (t.countryCode || '').toLowerCase().includes(ft)
              || (t.dateRange || '').toLowerCase().includes(ft);
        });

        // Upcoming: aufsteigend (nächstes zuerst), Past: absteigend (jüngstes zuerst)
        filtered.sort((a, b) => {
          const da = a.dateIso || '9999-99-99';
          const db = b.dateIso || '9999-99-99';
          return timeFilter === 'past' ? db.localeCompare(da) : da.localeCompare(db);
        });

        filtered.forEach(t => {
          const card = h('div', {
            class: 'p3-conn-card',
            onclick: () => analyze(null, t.viewUrl),
          },
            h('strong', {}, t.name),
            h('div', { class: 'p3-hint' },
              h('span', { style: 'font-weight:500; color:#111' }, t.dateRange || 'kein Datum'),
              ' · ',
              t.countryCode || '—',
            ),
          );
          listEl.appendChild(card);
        });
        if (filtered.length === 0) {
          listEl.appendChild(h('div', { class: 'p3-hint', style: 'padding:8px' },
            `Keine Treffer.`));
        }
      }

      resultBox.appendChild(filterRow);
      resultBox.appendChild(countryRow);     // N3 — Country-Filter unterhalb der Zeit-Pills
      resultBox.appendChild(searchInput);
      resultBox.appendChild(listEl);
      render();
    }

    function renderManualUrlEntry(connectorId) {
      resultBox.innerHTML = '';
      const back = h('button', { class: 'p3-btn small', onclick: renderStep0 }, '← Zurück');
      resultBox.appendChild(back);
      resultBox.appendChild(h('div', { class: 'p3-section-title' }, 'URL eingeben'));
      const urlInput = h('input', { type: 'text', class: 'p3-input', placeholder: 'https://…' });
      const btn = h('button', { class: 'p3-btn primary' }, 'Analysieren');
      urlInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); btn.click(); } };
      btn.onclick = () => analyze(btn, urlInput.value.trim());
      resultBox.appendChild(h('div', { class: 'p3-field' }, urlInput));
      resultBox.appendChild(btn);
      setTimeout(() => urlInput.focus(), 50);
    }

    async function analyze(btn, url) {
      if (!url) { toast('Bitte URL angeben', 'error'); return; }

      // Progress-Anzeige mit Schritten — Discovery dauert oft 3-10 Sek bei vielen Tagen.
      // Wir können den Backend-Fortschritt nicht streamen, simulieren ihn deshalb mit
      // Heartbeat-Texten alle 2 Sek.
      resultBox.innerHTML = '';
      const progress = h('div', { class: 'p3-progress' },
        h('div', { class: 'p3-progress-icon' }, '🔍'),
        h('div', { class: 'p3-progress-title' }, 'Analysiere Turnier'),
        h('div', { class: 'p3-progress-step', id: 'p3-prog-step' }, 'URL prüfen …'),
        h('div', { class: 'p3-progress-bar' }, h('div', { class: 'p3-progress-bar-fill' })),
      );
      resultBox.appendChild(progress);

      const stepEl = progress.querySelector('#p3-prog-step');
      const steps = [
        'URL prüfen …',
        'Turnier-Seite laden …',
        'Spielplan erfassen (Tag 1) …',
        'Spielplan erfassen (Tag 2-3) …',
        'Teams extrahieren …',
        'Daten zusammenstellen …',
      ];
      let stepIdx = 0;
      const stepTimer = setInterval(() => {
        stepIdx = Math.min(stepIdx + 1, steps.length - 1);
        stepEl.textContent = steps[stepIdx];
      }, 1800);

      try {
        const result = await api('/api/admin/tournaments/discover', {
          method: 'POST', body: JSON.stringify({ url }),
        });
        clearInterval(stepTimer);
        showWizardStep2(result.result);
      } catch (e) {
        clearInterval(stepTimer);
        if (e.data?.error === 'manual') {
          showWizardManual(e.data.suggestedSource || {});
        } else {
          resultBox.innerHTML = '';
          resultBox.appendChild(h('div', { class: 'p3-banner error' },
            'Discovery fehlgeschlagen: ' + e.message));
          const retryBtn = h('button', { class: 'p3-btn', onclick: renderStep0 }, '← Zurück zur Auswahl');
          resultBox.appendChild(retryBtn);
        }
      }
    }

    function showWizardStep2(disc) {
      resultBox.innerHTML = '';
      const inputs = {
        name: h('input', { type: 'text', class: 'p3-input', value: disc.suggestedName || '' }),
        slug: h('input', { type: 'text', class: 'p3-input', value: disc.suggestedSlug || '' }),
        dates: h('input', { type: 'text', class: 'p3-input', value: (disc.proposedDates || []).join(', ') }),
      };
      const teamPicks = [];
      const teamList = h('div', { class: 'p3-team-pick' });

      function renderTeamList(filter = '') {
        teamList.innerHTML = '';
        const ft = filter.trim().toLowerCase();
        let shown = 0;
        teamPicks.forEach(p => {
          const matches = !ft || p.team.name.toLowerCase().includes(ft) || (p.team.division || '').toLowerCase().includes(ft);
          if (!matches && !p.cb.checked) return;
          shown++;
          teamList.appendChild(h('label', { class: 'p3-team-row' },
            p.cb, h('span', {}, p.team.name), h('span', { class: 'p3-hint' }, ` · ${p.team.division || ''}`), p.labelInput));
        });
        if (shown === 0) {
          teamList.appendChild(h('div', { class: 'p3-hint', style: 'padding:8px' },
            `Keine Treffer für "${filter}". Tipp: leeres Suchfeld zeigt alle ${teamPicks.length} Teams.`));
        }
      }

      (disc.allTeams || []).forEach(t => {
        const cb = h('input', { type: 'checkbox' });
        const labelInput = h('input', { type: 'text', class: 'p3-input small', placeholder: 'Pillen-Label', style: 'width:100px' });
        teamPicks.push({ team: t, cb, labelInput });
      });

      const searchInput = h('input', {
        type: 'text', class: 'p3-input', placeholder: '🔍 Suchen (z.B. VMW, Berlin, U21) …',
        style: 'margin-bottom:8px',
      });
      searchInput.oninput = (e) => renderTeamList(e.target.value);

      resultBox.appendChild(h('div', { class: 'p3-banner ok' },
        disc.hasSchedule ? '✓ Spielplan gefunden' : '⚠ Reduzierte Discovery — Spielplan kommt später'));
      resultBox.appendChild(h('div', { class: 'p3-field' }, h('label', {}, 'Name'), inputs.name));
      resultBox.appendChild(h('div', { class: 'p3-field' }, h('label', {}, 'Slug'), inputs.slug));
      resultBox.appendChild(h('div', { class: 'p3-field' }, h('label', {}, 'Tage (komma-getrennt YYYY-MM-DD)'), inputs.dates));

      // Hausliga-Toggle
      const hausligaCheckbox = h('input', { type: 'checkbox' });
      resultBox.appendChild(h('div', { class: 'p3-field' },
        h('label', { style: 'display:flex; align-items:center; gap:8px; cursor:pointer' },
          hausligaCheckbox,
          h('span', {}, 'Hausliga aktivieren'),
          h('span', { class: 'p3-hint', style: 'margin-left:8px' },
            '(vereinsinterner Wettkampf zwischen den eigenen Teams)'),
        ),
      ));
      inputs.showHausliga = hausligaCheckbox;

      if (teamPicks.length) {
        resultBox.appendChild(h('div', { class: 'p3-section-title' }, `Eigene Teams auswählen (${teamPicks.length} gefunden)`));
        resultBox.appendChild(searchInput);
        resultBox.appendChild(teamList);
        renderTeamList('');
      }
      const saveBtn = h('button', { class: 'p3-btn primary' }, 'Speichern');
      saveBtn.onclick = () => withLoading(saveBtn, 'Speichere …', async () => {
        const dates = inputs.dates.value.split(',').map(s => s.trim()).filter(Boolean);
        const ourTeams = teamPicks
          .filter(p => p.cb.checked)
          .map(p => {
            const label = p.labelInput.value || codeFromName(p.team.name);
            return {
              code: codeFromName(p.team.name), pillLabel: label, short: p.team.name,
              name: p.team.name, tid: p.team.tid,
            };
          });
        const config = {
          slug: inputs.slug.value.trim(),
          name: inputs.name.value.trim(),
          type: 'tournament',
          connector: disc.connectorId,
          showStandings: false,
          showHausliga: inputs.showHausliga?.checked === true,
          source: disc.source,
          status: disc.hasSchedule ? 'active' : 'awaiting-schedule',
          dates: disc.hasSchedule ? dates : [],
          expectedDates: disc.hasSchedule ? null : dates,
          ourTeams,
        };
        try {
          await api('/api/admin/tournaments', { method: 'POST', body: JSON.stringify({ config }) });
          toast('Turnier angelegt', 'success');
          closeModal();
          window.openMasterAdmin();
        } catch (e) {
          toast('Fehler: ' + e.message, 'error');
        }
      });
      resultBox.appendChild(saveBtn);
    }

    function showWizardManual(suggested) {
      resultBox.innerHTML = '';
      resultBox.appendChild(h('div', { class: 'p3-banner warning' }, 'Keine Discovery möglich. Bitte manuell konfigurieren.'));
      resultBox.appendChild(h('div', { class: 'p3-hint' },
        suggested.viewUrl ? `Vorgeschlagene Info-URL: ${suggested.viewUrl}` : ''));
      // Vereinfachung: in dieser Iteration empfehlen wir, den Wizard zu schließen
      // und das Turnier per JSON-Datei zu erstellen (Phase 1-Stil).
      resultBox.appendChild(h('button', { class: 'p3-btn', onclick: closeModal }, 'Abbrechen'));
    }

    function codeFromName(name) {
      const m = name.match(/U14|U16|U21|Women|Men ?\d?|Damen|Herren/i);
      return m ? m[0].replace(/\s+/g, '') : name.slice(0, 8);
    }

    const content = h('div', { class: 'p3-modal-content' },
      h('div', { class: 'p3-modal-h' },
        h('h3', {}, 'Neues Turnier'),
        h('button', { class: 'p3-close', onclick: closeModal }, '×')),
      resultBox,
    );
    openModal(content, { wide: true });
    renderStep0();
  }

  // ═══════════════════════════════════════════════════════════════════
  // LANDING-PAGE
  // ═══════════════════════════════════════════════════════════════════
  window.renderLanding = async function() {
    document.body.classList.add('p3-landing-mode');
    document.body.innerHTML = '';
    document.body.style.visibility = 'visible';

    const root = h('div', { class: 'p3-landing' });
    document.body.appendChild(root);

    // ─── Hero (VMW-Brand) ─────────────────────────────────────────────
    // User-Area kommt aus renderUserArea() (zentral) — keine eigene Button-Logik mehr

    // P1.5 — Hero-Beschreibung gekürzt auf eine prägnante Tagline, Vollerklärung
    // wandert hinter den „?"-Button in ein Info-Modal. Spart auf 375px-Viewport
    // ~5 Zeilen Hero-Höhe (Hero war vorher ~50% des First-Screens).
    const heroInfoBtn = h('button', {
      class: 'p3-hero-info-btn',
      'aria-label': 'Mehr über die App',
      onclick: () => openHeroInfoModal(),
    }, '?');

    root.appendChild(h('div', { class: 'p3-hero' },
      h('div', { class: 'p3-hero-inner' },
        h('img', { class: 'p3-hero-logo', src: 'https://vmw-berlin.de/wp-content/uploads/2022/06/cropped-final_logo-3.png', alt: 'VMW Berlin', onerror: 'this.style.display=\'none\'' }),
        h('div', { class: 'p3-hero-text' },
          h('h1', {}, 'VMW Berlin Live-App'),
          h('p', { class: 'p3-hero-tagline' },
            'Spielpläne, Live-Stände und Schiri-Einsätze für VMW Berlin.',
            heroInfoBtn),
        ),
        h('div', { class: 'p3-hero-actions' }, window.renderUserArea({ onBrand: true })),
      ),
    ));

    // ─── Status-Streifen + Jahres-Tabs (zwischen Hero und Liste) ────────
    const statusBar = h('div', { class: 'p3-statusbar' });
    root.appendChild(statusBar);

    // ─── Tournament-Liste ────────────────────────────────────────────
    const listSection = h('div', { class: 'p3-landing-list' });
    root.appendChild(listSection);

    try {
      // Auth-Header senden, damit Server-Cache für eingeloggte User deaktiviert wird
      const authHeaders = {};
      if (window.state.adminPassword) authHeaders['x-admin-password'] = window.state.adminPassword;
      if (window.state.refereeAuth)   authHeaders['x-personal-token']  = window.state.refereeAuth;
      const result = await fetch('/api/tournaments', { headers: authHeaders, cache: 'no-store' }).then(r => r.json());

      const allTournaments = result.tournaments || [];

      // Jahr aus Datums extrahieren
      const tournamentYear = (t) => {
        const d = t.dates?.[0] || t.expectedDates?.[0];
        return d ? Number(d.slice(0, 4)) : new Date().getFullYear();
      };
      const yearsAvailable = [...new Set(allTournaments.map(tournamentYear))].sort((a, b) => b - a);
      const defaultYear = yearsAvailable.includes(new Date().getFullYear())
        ? new Date().getFullYear()
        : (yearsAvailable[0] || new Date().getFullYear());
      let activeYear = defaultYear;
      // "Archiv" = alles vor (defaultYear - 1). Eigene Pseudo-Auswahl.
      const archiveYears = yearsAvailable.filter(y => y < defaultYear - 1);

      function renderStatusBar() {
        statusBar.innerHTML = '';

        // Counts berechnen — entweder für aktuelles Jahr oder Archiv
        let tsForCount;
        if (activeYear === 'archive') {
          tsForCount = allTournaments.filter(t => archiveYears.includes(tournamentYear(t)));
        } else {
          tsForCount = allTournaments.filter(t => tournamentYear(t) === activeYear);
        }
        const total    = tsForCount.length;
        // Zählen nach Display-Gruppe — sonst sagt der Streifen "2 laufen gerade"
        // obwohl die noch in der Zukunft liegen.
        const active   = tsForCount.filter(t => displayGroup(t) === 'running').length;
        const finished = tsForCount.filter(t => displayGroup(t) === 'completed').length;

        // Stats-Block (links)
        const yearLabel = activeYear === 'archive' ? 'Archiv' : activeYear;
        const stats = h('div', { class: 'p3-stats-line' },
          h('span', {}, h('strong', { class: 'p3-stat-num' }, String(total)),
            ` Turnier${total === 1 ? '' : 'e'} ${yearLabel}`),
          total > 0 ? h('span', { class: 'p3-stat-sep' }, '·') : null,
          total > 0 ? h('span', {}, h('strong', { class: 'p3-stat-num live' }, String(active)),
            ' ', active === 1 ? 'läuft gerade' : 'laufen gerade') : null,
          finished > 0 ? h('span', { class: 'p3-stat-sep' }, '·') : null,
          finished > 0 ? h('span', {}, h('strong', {}, String(finished)), ' beendet') : null,
        );

        // DKV-Bogen-Download ist NICHT mehr auf der Landing — gehört ins Schiri-Profil.
        // Schiri findet ihn dort (rechts oben "Mein Profil" → unten in der Übersicht).
        const personalAction = null;

        // Jahres-Tabs (rechts)
        const tabs = h('div', { class: 'p3-yeartabs' });
        if (yearsAvailable.length > 1) {
          const recentYears = yearsAvailable.filter(y => y >= defaultYear - 1);
          for (const y of recentYears) {
            const tab = h('button', {
              class: 'p3-yeartab' + (activeYear === y ? ' active' : ''),
            }, String(y));
            tab.onclick = () => { activeYear = y; renderStatusBar(); renderList(); };
            tabs.appendChild(tab);
          }
          if (archiveYears.length) {
            const archiveTab = h('button', {
              class: 'p3-yeartab' + (activeYear === 'archive' ? ' active' : ''),
            }, 'Archiv');
            archiveTab.onclick = () => { activeYear = 'archive'; renderStatusBar(); renderList(); };
            tabs.appendChild(archiveTab);
          }
        }

        statusBar.appendChild(stats);
        if (personalAction) statusBar.appendChild(personalAction);
        statusBar.appendChild(tabs);
      }

      function renderList() {
        listSection.innerHTML = '';

        // Filtern nach aktivem Jahr / Archiv
        let visible;
        if (activeYear === 'archive') {
          visible = allTournaments.filter(t => archiveYears.includes(tournamentYear(t)));
        } else {
          visible = allTournaments.filter(t => tournamentYear(t) === activeYear);
        }

        // Anzeige-Buckets (datumbasiert, nicht status-basiert) — siehe displayGroup
        const groups = { running: [], planned: [], draft: [], completed: [] };
        visible.forEach(t => { groups[displayGroup(t)].push(t); });

        // P2.4 — Migration auf ui-section-h: farbiger Indikator-Dot + Counter rechts,
        // Emoji-Icons raus (Mockup Slide 4).
        const labels = {
          running:    { dotClass: 'dot-live',    title: 'Läuft gerade' },
          planned:    { dotClass: 'dot-planned', title: 'Geplant' },
          draft:      { dotClass: 'dot-planned', title: 'Entwürfe' },
          completed:  { dotClass: 'dot-done',    title: 'Beendet' + (activeYear !== 'archive' ? ' ' + activeYear : '') },
        };

        let anyShown = false;
        for (const bucket of ['running', 'planned', 'draft']) {
          const ts = groups[bucket];
          if (!ts.length) continue;
          anyShown = true;
          listSection.appendChild(h('h2', { class: 'ui-section-h' },
            h('span', { class: 'dot ' + labels[bucket].dotClass }),
            labels[bucket].title,
            h('span', { class: 'counter' }, String(ts.length))));
          const grid = h('div', { class: 'p3-card-grid' });
          ts.forEach(t => grid.appendChild(renderTournamentCard(t)));
          listSection.appendChild(grid);
        }

        // Beendet — default aufgeklappt, Caret rotiert beim Zuklappen
        if (groups.completed.length) {
          anyShown = true;
          const summary = h('summary', { class: 'ui-section-h p3-landing-section-toggle' },
            h('span', { class: 'dot ' + labels.completed.dotClass }),
            labels.completed.title,
            h('span', { class: 'counter' }, String(groups.completed.length)),
            h('span', { class: 'caret' }, '▾'));
          const grid = h('div', { class: 'p3-card-grid', style: 'margin-top:12px' });
          groups.completed.forEach(t => grid.appendChild(renderTournamentCard(t)));
          const details = h('details', { class: 'p3-completed-details' }, summary, grid);
          details.open = true;
          const syncCaret = () => { summary.dataset.collapsed = details.open ? 'false' : 'true'; };
          syncCaret();
          details.addEventListener('toggle', syncCaret);
          listSection.appendChild(details);
        }

        if (!anyShown) {
          listSection.appendChild(h('div', { class: 'p3-empty-state' },
            h('div', { class: 'p3-empty-icon' }, '🏆'),
            h('h3', {}, 'Keine Turniere in ' + (activeYear === 'archive' ? 'Archiv' : activeYear)),
            h('p', {}, 'Wechsle das Jahr oben, oder leg ein neues Turnier im Master-Admin an.'),
          ));
        }
      }

      renderStatusBar();
      renderList();
    } catch (e) {
      listSection.appendChild(h('div', { class: 'p3-banner error' }, 'Fehler beim Laden: ' + e.message));
    }

    // Footer
    root.appendChild(h('footer', { class: 'p3-landing-footer' },
      h('p', {}, 'Gebaut von Julius Brüning · ',
        h('a', { href: 'mailto:juliusbruening1994@gmail.com' }, 'Feedback'),
      ),
    ));
  };

  // Anzeige-Labels für VMW-Team-Kategorien (intern junioren, Anzeige U21)
  const CATEGORY_LABELS = {
    herren: 'Herren', damen: 'Damen', junioren: 'U21', jugend: 'Jugend', schueler: 'Schüler',
  };

  // ───────────────────────────────────────────────────────────────────────
  // displayGroup — mappt einen Tournament-Status auf eine Anzeige-Sektion.
  //
  // Hintergrund: status='active' im Schema bedeutet "sichtbar und nicht beendet"
  // — also auch Turniere, deren Spielplan steht aber die noch in der Zukunft
  // liegen. User-mental-model: "active = läuft jetzt". Wir gruppieren daher
  // datumbasiert, nicht status-basiert:
  //
  //   running  : Turnier ist HEUTE im Datums-Fenster
  //   planned  : Turnier ist in der Zukunft (egal ob Spielplan da oder nicht)
  //   draft    : Master-only Entwurf
  //   completed: Beendet
  //
  // todayIso optional (für Tests). Default: heute (Berlin).
  function displayGroup(t, todayIso) {
    if (t.status === 'completed') return 'completed';
    if (t.status === 'draft')     return 'draft';
    // active oder awaiting-schedule → datumbasiert
    const today = todayIso || new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
    const dates = t.dates?.length ? t.dates : (t.expectedDates || []);
    if (!dates.length) return 'planned'; // ohne Datum: kann nur geplant sein
    const first = dates[0];
    const last  = dates[dates.length - 1];
    if (today < first) return 'planned';
    if (today > last)  return 'completed'; // Cron hat's noch nicht auf completed gesetzt
    return 'running';
  }
  window.displayGroup = displayGroup; // exportiert für Tests

  // Rollen-Labels (UI)
  const ROLE_LABELS_DISPLAY = {
    ref1: '1. SR', ref2: '2. SR', scorer: 'Protokoll',
    timer: 'Zeit', shotclock: 'Shotclock', line1: '1. Linie', line2: '2. Linie',
  };

  // ═══════════════════════════════════════════════════════════════════
  // EXTERNAL-TOURNAMENT DASHBOARD
  // ═══════════════════════════════════════════════════════════════════
  //
  // Layout:
  //   Header (Name + Datum + Status + Trainer-Login-Button)
  //   Ressourcen-Card(s) — externer Spielplan-Link(s)
  //   Schiri-Einsatz-Liste (eine Card pro Spielnummer)
  //   + Einsatz-Anlegen-Button (Trainer/Master only)
  //
  // Datenquelle: /api/data?slug=<slug> mit external=true.
  window.renderExternalDashboard = async function(slug, data) {
    window.CURRENT_SLUG = slug;
    const cfg = data.config;
    const referees = data.referees || [];
    const refsById = new Map(referees.map(r => [r.id, r]));
    const entries  = data.externalAssignments || [];
    const resources = cfg.external?.resources || [];

    const isTrainer = window.state.role === 'master' || window.state.role === 'trainer';

    document.body.innerHTML = '';
    document.body.classList.remove('p3-landing-mode');
    document.body.classList.add('p3-page', 'p3-page-external');
    document.body.style.visibility = 'visible';

    const statusBadge = h('span', { class: `p3-status-badge p3-status-${cfg.status}` },
      ({ active: 'live', 'awaiting-schedule': 'geplant', draft: 'draft', completed: 'beendet' }[cfg.status] || cfg.status));

    // User-Area zeigt den richtigen Login-/Profil-/Logout-Knopf.
    // Trainer-Login ist im openLogin-Modal als zusätzlicher Tab auf
    // Turnierseiten verfügbar (siehe openLogin).
    const userArea = window.renderUserArea({ onBrand: true });

    const dateStr = formatDateRange(cfg.dates || []);

    // Ressourcen-Section
    const resourcesSection = resources.length
      ? h('div', { class: 'p3-ext-resources' },
          h('div', { class: 'p3-section-title' }, 'Externer Spielplan'),
          ...resources.map(r => renderResourceCard(r)))
      : h('div', { class: 'p3-ext-resources p3-ext-noresource' },
          h('div', { class: 'p3-section-title' }, 'Externer Spielplan'),
          h('div', { class: 'p3-hint' }, 'Kein externer Plan verlinkt — Schiri-Einsätze werden ausschließlich hier verwaltet.'));

    // Einsatz-Section
    const einsatzHeader = h('div', { class: 'p3-ext-einsatz-header' },
      h('div', { class: 'p3-section-title' }, `Schiri-Einsätze (${entries.length})`),
      isTrainer
        ? h('button', { class: 'p3-btn primary small',
            onclick: () => window.openExternalEntryForm(slug, null, refresh) },
            '+ Einsatz anlegen')
        : null,
    );

    const einsatzList = h('div', { class: 'p3-ext-einsatz-list' },
      entries.length
        ? entries.map(e => renderExternalEntryCard(slug, e, refsById, isTrainer, refresh))
        : h('div', { class: 'p3-empty-soft' },
            isTrainer
              ? 'Noch keine Einsätze angelegt. Klicke „+ Einsatz anlegen", um zu starten.'
              : 'Noch keine Einsätze angelegt.'));

    // P1.3 — Datenstand-Pill: max(config.updatedAt, externalAssignments.updatedAt|createdAt).
    // Bei externen Turnieren kommt der Stand vom Trainer/Master, nicht vom Cron.
    const extStamp = (() => {
      let best = cfg.updatedAt || null;
      for (const e of entries || []) {
        const t = e.updatedAt || e.createdAt;
        if (t && (!best || t > best)) best = t;
      }
      return best;
    })();
    const updatedPill = window.renderUpdatedPill(extStamp, {
      label: 'Datenstand',
      subline: 'Externer Turnierplan + Einsätze werden manuell von Trainer/Master gepflegt. Letzte Änderung oben angezeigt.',
    });

    const page = h('div', { class: 'p3-page-wrap' },
      h('header', { class: 'p3-page-header' },
        h('button', { class: 'p3-btn small', onclick: () => {
          document.body.classList.remove('p3-page', 'p3-page-external');
          window.history.pushState({}, '', '/');
          window.renderLanding();
        } }, '← Übersicht'),
        h('div', { class: 'p3-page-title-wrap' },
          h('h1', {}, cfg.name),
          h('div', { class: 'p3-page-sub' },
            h('span', {}, dateStr),
            statusBadge),
        ),
        updatedPill,
        userArea,
      ),
      h('div', { class: 'p3-body' },
        // Kayakers-Hybrid-Banner: Spielplan kommt vielleicht noch
        cfg.isKayakersAwaiting
          ? h('div', { class: 'p3-banner info', style: 'margin-bottom:16px' },
              '⏳ Der Spielplan auf kayakers.nl ist noch nicht veröffentlicht. ',
              'Sobald er erscheint, wird diese Seite automatisch durch den Live-Spielplan ersetzt. ',
              'Bis dahin kannst du Schiri-Einsätze unten manuell pflegen.')
          : null,
        resourcesSection,
        h('div', { class: 'p3-ext-einsatz-section' },
          einsatzHeader,
          einsatzList,
          h('div', { class: 'p3-ext-footer-hint' },
            '📝 Manuell gepflegt von Trainer/Master · Keine Verbindung zum externen Spielplan'),
        ),
      ),
    );

    document.body.appendChild(page);

    async function refresh() {
      const fresh = await fetchData(slug);
      window.renderExternalDashboard(slug, fresh);
    }
  };

  // Eine Ressourcen-Card (Link zu externem PDF/Webseite)
  function renderResourceCard(r) {
    const isPdf = /\.pdf(\?|$)/i.test(r.url || '');
    const icon = isPdf ? '📄' : '🔗';
    const typeBadge = isPdf ? 'PDF' : 'Link';
    let host = '';
    try { host = new URL(r.url).hostname; } catch {}
    return h('a', { class: 'p3-ext-resource-card', href: r.url, target: '_blank', rel: 'noopener noreferrer' },
      h('span', { class: 'p3-ext-resource-icon' }, icon),
      h('div', { class: 'p3-ext-resource-text' },
        h('div', { class: 'p3-ext-resource-title' }, r.title || (isPdf ? 'Spielplan (PDF)' : 'Externer Plan')),
        h('div', { class: 'p3-ext-resource-host' }, host)),
      h('span', { class: 'p3-ext-resource-type' }, typeBadge),
      h('span', { class: 'p3-ext-arrow' }, '↗'),
    );
  }

  // Eine Einsatz-Card (Spielnummer + Rollen-Belegung)
  function renderExternalEntryCard(slug, entry, refsById, isTrainer, refresh) {
    const dateShort = entry.date ? entry.date.split('-').reverse().join('.').slice(0,5) + entry.date.slice(0,4).slice(-2) : '';
    const klasse = entry.spielklasse
      ? (CATEGORY_LABELS[entry.spielklasse] || entry.spielklasse)
      : '—';
    const myRefereeId = window.state.refereeAuth
      ? referees_findIdByCode(window.state.refereeAuth)
      : null;

    // P1.1 — Uhrzeit anzeigen wenn vorhanden (DKV-PDF ignoriert es weiterhin).
    const dateLabel = entry.date + (entry.time ? ` · ${entry.time}` : '');
    const head = h('div', { class: 'p3-ext-entry-head' },
      h('span', { class: 'p3-ext-entry-nr' }, `Spiel ${entry.matchNr}`),
      h('span', { class: 'p3-ext-entry-meta' }, `${dateLabel} · ${klasse}`),
      isTrainer
        ? h('div', { class: 'p3-ext-entry-actions' },
            h('button', { class: 'p3-btn xsmall',
              onclick: () => window.openExternalEntryForm(slug, entry, refresh) }, '✏️'),
            h('button', { class: 'p3-btn xsmall danger',
              onclick: async () => {
                if (!confirm('Diesen Einsatz wirklich löschen?')) return;
                try {
                  await api(`/api/admin/t/${slug}/external-entries/${entry.id}`, { method: 'DELETE' });
                  await refresh();
                } catch (e) { toast('Fehler: ' + e.message, 'error'); }
              } }, '🗑️'))
        : null,
    );

    const roleGrid = h('div', { class: 'p3-ext-entry-roles' });
    // Alle 7 Rollen anzeigen (vorher fehlten shotclock + line2)
    const visibleRoles = ['ref1', 'ref2', 'scorer', 'timer', 'shotclock', 'line1', 'line2'];
    for (const code of visibleRoles) {
      const refId = entry.roles?.[code];
      const ref = refId ? refsById.get(refId) : null;
      const isMe = myRefereeId && refId === myRefereeId;
      roleGrid.appendChild(h('div', { class: 'p3-ext-role-cell' + (isMe ? ' is-me' : '') },
        h('div', { class: 'p3-ext-role-label' }, ROLE_LABELS_DISPLAY[code]),
        h('div', { class: 'p3-ext-role-name' }, ref?.displayName || (refId ? '?' : '–')),
      ));
    }

    return h('div', { class: 'p3-ext-entry-card' }, head, roleGrid,
      entry.notes ? h('div', { class: 'p3-ext-entry-notes' }, '📝 ' + entry.notes) : null);
  }

  function referees_findIdByCode(/* code */) {
    // Schiri-Auth liefert nur den Code, aber kein Referee-Mapping client-seitig.
    // Highlight für eigene Einsätze erfolgt server-seitig bzw. wird hier
    // best-effort weggelassen (würde extra Round-Trip kosten).
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // EXTERNAL ENTRY-FORM (anlegen + bearbeiten)
  // ═══════════════════════════════════════════════════════════════════
  window.openExternalEntryForm = async function(slug, existing, refresh) {
    // Schiri-Liste für Picker laden (cached via data.referees ggf.)
    let referees = window.state.externalReferees;
    if (!referees) {
      try {
        const data = await fetchData(slug);
        referees = data.referees || [];
        window.state.externalReferees = referees;
      } catch { referees = []; }
    }

    const isEdit = !!existing;
    const init = existing || { matchNr: '', date: '', time: '', spielklasse: 'herren', roles: {}, notes: '' };
    // Bugfix P0.4: dieses Modal nutzt einen eigenen Container (.p3-modal-bg),
    // der zentrale closeModal()-Manager räumt aber nur `.p3-backdrop` →
    // Abbrechen, Backdrop-Click und Save-Success waren wirkungslos.
    // Lokal scoped close() löst das Modal direkt.
    const modal = h('div', { class: 'p3-modal-bg', onclick: (e) => { if (e.target === e.currentTarget) close(); } });
    const card = h('div', { class: 'p3-modal-card' });
    modal.appendChild(card);
    const close = () => modal.remove();

    card.appendChild(h('h2', {}, isEdit ? 'Einsatz bearbeiten' : 'Einsatz anlegen'));

    const matchNrInput = h('input', { type: 'text', placeholder: 'z.B. 12', value: init.matchNr });
    const dateInput    = h('input', { type: 'date', value: init.date });
    // P1.1 — Uhrzeit ist optional; erscheint in der UI, nicht im DKV-PDF.
    const timeInput    = h('input', { type: 'time', value: init.time || '' });
    const klasseSelect = h('select', {});
    for (const [code, label] of Object.entries(CATEGORY_LABELS)) {
      const opt = h('option', { value: code }, label);
      if (init.spielklasse === code) opt.selected = true;
      klasseSelect.appendChild(opt);
    }

    card.appendChild(formRow('Spiel-Nr.', matchNrInput));
    card.appendChild(formRow('Datum', dateInput));
    card.appendChild(formRow('Uhrzeit (optional)', timeInput));
    card.appendChild(formRow('Spielklasse', klasseSelect));

    // Rollen-Picker
    card.appendChild(h('div', { class: 'p3-section-title' }, 'Rollen-Belegung'));
    const roleSelects = {};
    const allRoles = ['ref1', 'ref2', 'scorer', 'timer', 'shotclock', 'line1', 'line2'];
    for (const code of allRoles) {
      const sel = h('select', {});
      sel.appendChild(h('option', { value: '' }, '— nicht besetzt —'));
      for (const r of referees) {
        const opt = h('option', { value: r.id }, r.displayName + ' (' + (r.level || '?') + ')');
        if (init.roles?.[code] === r.id) opt.selected = true;
        sel.appendChild(opt);
      }
      roleSelects[code] = sel;
      card.appendChild(formRow(ROLE_LABELS_DISPLAY[code], sel));
    }

    const notesInput = h('input', { type: 'text', placeholder: 'optional', value: init.notes || '' });
    card.appendChild(formRow('Bemerkung', notesInput));

    const actions = h('div', { class: 'p3-modal-actions' });
    actions.appendChild(h('button', { class: 'p3-btn', onclick: close }, 'Abbrechen'));
    const saveBtn = h('button', { class: 'p3-btn primary' }, isEdit ? 'Speichern' : 'Anlegen');
    saveBtn.onclick = (e) => withLoading(e.currentTarget, 'speichere …', async () => {
      const payload = {
        matchNr:     matchNrInput.value.trim(),
        date:        dateInput.value,
        time:        timeInput.value || null,    // P1.1 — null = nicht gesetzt
        spielklasse: klasseSelect.value,
        roles:       Object.fromEntries(
          Object.entries(roleSelects).map(([k, sel]) => [k, sel.value || null]).filter(([, v]) => v)
        ),
        notes:       notesInput.value.trim(),
      };
      try {
        if (isEdit) {
          await api(`/api/admin/t/${slug}/external-entries/${existing.id}`, {
            method: 'PUT', body: JSON.stringify(payload),
          });
        } else {
          await api(`/api/admin/t/${slug}/external-entries`, {
            method: 'POST', body: JSON.stringify(payload),
          });
        }
        close();
        await refresh();
      } catch (err) {
        toast('Fehler: ' + err.message, 'error');
      }
    });
    actions.appendChild(saveBtn);
    card.appendChild(actions);

    document.body.appendChild(modal);
  };

  function formRow(label, control) {
    return h('label', { class: 'p3-formrow' },
      h('span', { class: 'p3-formrow-label' }, label),
      control);
  }

  // Formatiert ein Array von ISO-Datumsstrings als deutsches Range:
  //   ['2026-05-23','2026-05-24','2026-05-25'] → '23.–25. Mai 2026'
  //   ['2026-06-14','2026-06-15']               → '14.–15. Juni 2026'
  //   ['2026-09-12']                            → '12. September 2026'
  //   []                                        → '—'
  function formatDateRange(dates) {
    if (!dates || !dates.length) return '—';
    const MONTHS = ['Januar','Februar','März','April','Mai','Juni',
                    'Juli','August','September','Oktober','November','Dezember'];
    const parse = (iso) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
      return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
    };
    const first = parse(dates[0]);
    const last  = parse(dates[dates.length - 1]);
    if (!first) return dates[0] || '—';
    if (!last || dates.length === 1) return `${first.d}. ${MONTHS[first.m-1]} ${first.y}`;

    // Gleicher Monat + Jahr → "23.–25. Mai 2026"
    if (first.m === last.m && first.y === last.y) {
      return `${first.d}.–${last.d}. ${MONTHS[first.m-1]} ${first.y}`;
    }
    // Gleiches Jahr, verschiedene Monate → "30. Mai – 2. Juni 2026"
    if (first.y === last.y) {
      return `${first.d}. ${MONTHS[first.m-1]} – ${last.d}. ${MONTHS[last.m-1]} ${first.y}`;
    }
    // Verschiedene Jahre
    return `${first.d}. ${MONTHS[first.m-1]} ${first.y} – ${last.d}. ${MONTHS[last.m-1]} ${last.y}`;
  }

  function renderTournamentCard(t) {
    const isExternal = t.type === 'external';
    // Status-Pille folgt der Display-Gruppe (datumbasiert), nicht dem rohen
    // Code-Status — sonst zeigt eine Karte "live" obwohl das Turnier erst in
    // 5 Tagen anfängt.
    const bucket = displayGroup(t);
    const statusBadgeText = {
      running:   'live',
      planned:   'geplant',
      draft:     'draft',
      completed: 'beendet',
    }[bucket] || bucket;
    // P2.4 — Pill-Variante über die UI-Bibliothek
    const statusPillClass = {
      running:   'ui-pill ui-pill-live',
      planned:   'ui-pill ui-pill-planned',
      draft:     'ui-pill ui-pill-planned',
      completed: 'ui-pill ui-pill-done',
    }[bucket] || 'ui-pill ui-pill-done';

    const meta = formatDateRange(t.dates?.length ? t.dates : (t.expectedDates || []));

    // Subtiler Hinweis "Spielplan ausstehend" für kayakers-Turniere ohne
    // Discovery-Erfolg.
    const awaitingSchedule = !isExternal && t.status === 'awaiting-schedule';

    // Kategorie-Pills (VMW-Teilnehmer) aus dem Backend
    const catPills = (t.vmwCategories || []).map(c =>
      h('span', { class: 'ui-pill ui-pill-class' }, CATEGORY_LABELS?.[c] || c));

    // Top-Badge: App-Turnier vs Externer Plan
    const topBadge = isExternal
      ? h('span', { class: 'ui-pill ui-pill-extern' }, 'Extern')
      : null;

    const cardClass = 'p3-tcard ui-card ui-card-interactive ' +
      (isExternal ? 'p3-tcard-external' : 'p3-tcard-live');
    return h('a', { class: cardClass, href: `/t/${t.slug}` },
      topBadge,
      h('div', { class: 'p3-tcard-name' }, t.name),
      h('div', { class: 'p3-tcard-meta' }, meta),
      catPills.length
        ? h('div', { class: 'p3-tcard-pillrow', style: 'display:flex;flex-wrap:wrap;gap:4px;margin-top:8px' },
            h('span', { class: statusPillClass },
              h('span', { class: 'dot' }), statusBadgeText),
            ...catPills)
        : h('div', { class: 'p3-tcard-pillrow', style: 'margin-top:8px' },
            h('span', { class: statusPillClass },
              h('span', { class: 'dot' }), statusBadgeText)),
      awaitingSchedule
        ? h('div', { class: 'p3-tcard-hint', style: 'margin-top:6px' },
            'Spielplan ausstehend')
        : null,
      h('div', { class: 'p3-tcard-footer' },
        h('span', { class: 'p3-tcard-hint' },
          isExternal
            ? (t.externalResourceCount > 0
                ? `${t.externalResourceCount} Ressource${t.externalResourceCount === 1 ? '' : 'n'} + Einsätze`
                : 'Schiri-Einsätze')
            : 'Spielplan öffnen →'),
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // ROUTING: pathname-basiertes Bootstrap
  // ═══════════════════════════════════════════════════════════════════
  //
  // /                 → Landing-Page (übermalt die DC2026-Shell aus app.js)
  // /t/<slug>         → Tournament-Live-View (app.js übernimmt)
  // /admin            → Login-Modal sofort
  // /me/<code>        → Code in localStorage, dann Profil
  //
  // Wichtig: app.js startet immer und füllt die DC2026-Shell. Wir lassen
  // app.js fertig laufen und ersetzen DANACH den DOM. So bricht nichts
  // unerwartet, und wenn die Routing-Logik hier scheitert, hat man wenigstens
  // die alte UI als Fallback.

  function showBody() {
    document.body.style.visibility = 'visible';
  }

  // Füllt den User-Area-Slot im static index.html-Header (kayakers-Tournament-View).
  // Wird beim Boot UND nach Login/Logout aufgerufen, damit der Status aktuell bleibt.
  window.fillUserAreaSlot = function() {
    const slot = document.getElementById('userAreaSlot');
    if (!slot) return;
    slot.innerHTML = '';
    slot.appendChild(window.renderUserArea({ onBrand: false }));
  };

  // ═══════════════════════════════════════════════════════════════════
  // GLOBALER BANNER — von Master gesetzte Info-Nachricht oben auf jeder Seite
  // ═══════════════════════════════════════════════════════════════════
  let bannerCache = null;
  async function fetchGlobalBanner() {
    try {
      const res = await fetch('/api/banner', { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      return data.active ? data : null;
    } catch { return null; }
  }
  // Rendert den Banner als allererstes Body-Child wenn aktiv.
  // Wird bei jedem Page-Render aufgerufen.
  window.renderGlobalBanner = function() {
    // Vorherigen Banner entfernen (falls vorhanden)
    document.querySelectorAll('.p3-global-banner').forEach(el => el.remove());
    if (!bannerCache?.message) return;
    const bar = h('div', { class: `p3-global-banner p3-global-banner-${bannerCache.level || 'info'}` },
      h('span', { class: 'p3-global-banner-icon' }, bannerCache.level === 'warning' ? '⚠' : 'ℹ'),
      h('span', { class: 'p3-global-banner-text' }, bannerCache.message));
    document.body.insertBefore(bar, document.body.firstChild);
  };
  // Beim ersten Boot fetchen + rendern
  fetchGlobalBanner().then(b => {
    bannerCache = b;
    window.renderGlobalBanner();
    // MutationObserver: wenn body geleert wird (innerHTML=''), Banner wieder ergänzen.
    // So müssen die ~8 Render-Funktionen den Banner nicht explizit nachladen.
    if (bannerCache?.message) {
      new MutationObserver(() => {
        if (bannerCache?.message && !document.querySelector('.p3-global-banner')) {
          window.renderGlobalBanner();
        }
      }).observe(document.body, { childList: true });
    }
  });

  function bootstrapRoute() {
    // User-Area-Slot füllen wo vorhanden (kayakers-Tournament-View)
    window.fillUserAreaSlot();

    const pathname = window.location.pathname;

    // /me/<code> — Bookmark-Login für Schiris
    const meMatch = pathname.match(/^\/me\/([A-Z0-9-]+)/i);
    if (meMatch) {
      const code = meMatch[1];
      localStorage.setItem('refereeAuth', code);
      window.state.refereeAuth = code;
      // N2 — URL auf /profil statt /. Damit hält ein Browser-Refresh den User
      // im Profil. Sauberes Bookmark-Verhalten: `/me/CODE` → Login → `/profil`.
      window.history.replaceState({}, '', '/profil');
      document.body.innerHTML = '';
      showBody();
      window.openMyProfile();
      return;
    }

    // N2 — /profil — eigene Route für persistente Profil-URL nach Refresh.
    // Erfordert eingeloggten Schiri (refereeAuth in localStorage). Sonst:
    // Fallback auf Landing mit Hinweis.
    if (pathname === '/profil' || pathname === '/profil/') {
      if (!window.state.refereeAuth) {
        showBody();
        window.renderLanding();
        if (typeof window.toast === 'function') {
          window.toast('Bitte zuerst als Schiri einloggen', 'info');
        }
        return;
      }
      showBody();
      window.openMyProfile();
      return;
    }

    // /admin — Login-Modal sofort
    if (pathname === '/admin') {
      // Body leeren, damit nicht die alte DC2026-UI durchscheint
      document.body.innerHTML = '';
      showBody();
      // Schon eingeloggt? Dann Master-Admin direkt zeigen.
      if (window.state.role === 'master') window.openMasterAdmin();
      else window.openLogin();
      return;
    }

    // / — Landing-Page
    if (pathname === '/') {
      showBody();
      window.renderLanding();
      return;
    }

    // /t/<slug> — Tournament-View
    //   - Für External-Turniere: phase3.js übernimmt und rendert Dashboard
    //   - Sonst: app.js rendert die Live-Spielplan-View
    //
    // Visibility-Strategie: Body bleibt versteckt bis entweder
    // renderExternalDashboard (external) oder app.js's renderActiveTab (kayakers)
    // ihre erste Render-Iteration durchhaben. So kein DC-Shell-Flash auf
    // externen Turnieren. Fallback nach 3s: forciert Body sichtbar, falls
    // Netzwerk hängt — User sieht dann was app.js bis dahin gerendert hat.
    const tMatch = pathname.match(/^\/t\/([^/]+)/);
    if (tMatch) {
      const slug = decodeURIComponent(tMatch[1]);
      fetchData(slug)
        .then(data => {
          if (data?.external) {
            window.renderExternalDashboard(slug, data);
          }
          // Wenn nicht external: app.js's renderActiveTab macht body sichtbar
        })
        .catch(() => { /* Fallback unten */ });
      setTimeout(showBody, 3000);
      return;
    }

    setTimeout(showBody, 300);
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', bootstrapRoute);
  } else {
    bootstrapRoute();
  }

})();
