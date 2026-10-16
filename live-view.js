(() => {
  'use strict';
  const LIVE_VIEW_STORAGE_KEY = 'picklepoint_live_view_state_v1';
  const THEME_STORAGE_KEY = 'picklepoint_live_view_theme_v1';
  const $ = id => document.getElementById(id);
  let currentState = null;
  let serverConnected = false;
  let serverTried = false;
  let channel = null;
  let eventSource = null;
  let reconnectTimer = null;
  let reconnectDelay = 3000;
  let remoteRefreshInFlight = false;

  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
  const playerName = p => p
    ? String(p.name || 'Player') + (String(p.nickname || '').trim() ? ` (${String(p.nickname).trim()})` : '')
    : 'Waiting for player';
  const playerGenderClass = p => p?.gender === 'Female' ? 'female' : 'male';
  const playerGenderIcon = p => p?.gender === 'Female' ? '♀' : '♂';
  const playerCategory = p => String(p?.category || 'CAT').trim().toUpperCase();
  const playerCategoryClass = p => ({ BEG: 'skill-beg', NOV: 'skill-nov', INT: 'skill-int', ADV: 'skill-adv', EXP: 'skill-exp' })[playerCategory(p)] || '';
  const formatTime = value => {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };
  const elapsedSeconds = start => {
    if (!start) return 0;
    const startMs = new Date(start).getTime();
    return Number.isFinite(startMs) ? Math.max(0, Math.floor((Date.now() - startMs) / 1000)) : 0;
  };
  const elapsed = start => {
    const totalSeconds = elapsedSeconds(start);
    return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
  };
  const timerClass = start => {
    const totalSeconds = elapsedSeconds(start);
    if (totalSeconds >= 15 * 60) return 'timer-red';
    if (totalSeconds >= 10 * 60) return 'timer-amber';
    return 'timer-blue';
  };

  function setConnection(mode, label) {
    const el = $('connectionStatus');
    if (!el) return;
    el.className = 'connection-status ' + mode;
    el.querySelector('span').textContent = label;
  }

  function applyTheme(theme) {
    const normalized = theme === 'light' ? 'light' : 'night';
    document.documentElement.dataset.theme = normalized;
    try { localStorage.setItem(THEME_STORAGE_KEY, normalized); } catch (error) {}
  }

  async function loadRemoteTheme() {
    if (!['http:', 'https:'].includes(location.protocol)) return;
    try {
      const response = await fetch('/api/live-theme', { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      if (data && (data.theme === 'light' || data.theme === 'night')) applyTheme(data.theme);
    } catch (error) {}
  }

  function loadTheme() {
    try {
      const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      return savedTheme === 'light' || savedTheme === 'night' ? savedTheme : 'night';
    } catch (error) {
      return 'night';
    }
  }

  function localSnapshot() {
    try { return JSON.parse(localStorage.getItem(LIVE_VIEW_STORAGE_KEY) || 'null'); }
    catch (error) { return null; }
  }

  function renderCourtCard(c) {
    const status = c.waitingOnly ? 'Waiting' : c.playing ? 'Playing' : 'Ready';
    const statusClass = c.waitingOnly ? 'waiting' : c.playing ? 'playing' : 'ready';
    const t1 = Array.isArray(c.team1) ? c.team1 : [];
    const t2 = Array.isArray(c.team2) ? c.team2 : [];
    const team = arr => [0, 1].map(i => {
      const player = arr[i];
      const name = player ? playerName(player) : 'Open slot';
      const playerMeta = player
        ? `<span class="live-player-gender ${playerGenderClass(player)}" title="${playerGenderClass(player) === 'female' ? 'Female' : 'Male'}" aria-label="${playerGenderClass(player) === 'female' ? 'Female' : 'Male'}">${playerGenderIcon(player)}</span><span class="live-player-category ${playerCategoryClass(player)}" title="Skill category">${escapeHTML(playerCategory(player))}</span>`
        : '';
      return `<div class="player-chip${player ? '' : ' empty'}"><span class="player-chip-name">${escapeHTML(name)}</span>${playerMeta}</div>`;
    }).join('');
    const courtName = c.waitingOnly ? 'Court #' : (c.name || 'Court');
    const matchMeta = c.playing
      ? `<div class="match-meta"><span class="match-timer ${timerClass(c.start)}" data-start="${escapeHTML(c.start || '')}">${elapsed(c.start)}</span><span class="race-to-win">Race to ${Number(c.target) || 11} · Win by ${Number(c.winBy) || 1}</span></div>`
      : `<div class="match-meta"><span>${c.waitingOnly ? 'Waiting for an available court' : 'Ready for matchmaking'}</span><span>${(c.players || []).filter(Boolean).length}/4 players</span></div>`;
    return `<article class="court-card${c.playing ? ' playing' : ''}"><div class="court-top"><strong class="court-name">${escapeHTML(courtName)}</strong><span class="court-state ${statusClass}">${status}</span></div>${matchMeta}<div class="teams"><div class="team"><span class="team-label">TEAM 1</span>${team(t1)}</div><div class="versus">VS</div><div class="team"><span class="team-label">TEAM 2</span>${team(t2)}</div></div>${c.playing ? `<div class="scoreline"><div class="score-values"><b>${Number(c.scores?.[0]) || 0}</b><span class="score-separator">-</span><b>${Number(c.scores?.[1]) || 0}</b></div></div>` : ''}</article>`;
  }

  function render() {
    const s = currentState;
    const active = !!s?.active;
    $('sessionTitle').textContent = s?.sessionName || 'Pickle Point Match';
    $('inactiveNotice').hidden = active;
    $('queueSectionCount').textContent = `${s?.queue?.length || 0} players`;
    $('lastUpdated').textContent = s?.updatedAt
      ? `Last updated ${new Date(s.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`
      : 'Waiting for live session data…';

    const allCourts = s?.courts || [];
    const regularCourts = allCourts.filter(c => !c.waitingOnly);
    const waitingCourts = allCourts.filter(c => c.waitingOnly);
    $('courtSectionCount').textContent = `${s?.courtCount ?? regularCourts.length} courts`;
    $('courtsList').innerHTML = regularCourts.length
      ? regularCourts.map(renderCourtCard).join('')
      : '<div class="empty-state">No courts have been set up in this session.</div>';

    $('waitingCourtsSection').hidden = waitingCourts.length === 0;
    $('waitingCourtSectionCount').textContent = `${waitingCourts.length} waiting court${waitingCourts.length === 1 ? '' : 's'}`;
    $('waitingCourtsList').innerHTML = waitingCourts.map(renderCourtCard).join('');

    const queue = s?.queue || [];
    $('queueList').innerHTML = queue.length
      ? queue.map((p, i) => `<div class="queue-item"><span class="queue-number">${i + 1}</span><div class="queue-player-wrap"><div class="queue-player-line"><div class="queue-player">${escapeHTML(playerName(p))}</div><span class="live-player-gender ${playerGenderClass(p)}" title="${playerGenderClass(p) === 'female' ? 'Female' : 'Male'}" aria-label="${playerGenderClass(p) === 'female' ? 'Female' : 'Male'}">${playerGenderIcon(p)}</span><span class="live-player-category ${playerCategoryClass(p)}" title="Skill category">${escapeHTML(playerCategory(p))}</span></div></div></div>`).join('')
      : '<div class="empty-state">No players are waiting in queue.</div>';

    const usingHttpServer = location.protocol === 'http:' || location.protocol === 'https:';
    $('syncNotice').hidden = serverConnected || (usingHttpServer && !serverTried);
    if (serverConnected) setConnection('connected', 'Live sync');
    else if (serverTried) setConnection('local', 'Local preview');
    else setConnection('', 'Connecting');
  }

  function acceptState(value) {
    if (!value || typeof value !== 'object') return;
    currentState = value;
    try { localStorage.setItem(LIVE_VIEW_STORAGE_KEY, JSON.stringify(value)); } catch (error) {}
    render();
  }

  function isHttpPage() {
    return location.protocol === 'http:' || location.protocol === 'https:';
  }

  function scheduleReconnect() {
    if (!isHttpPage() || reconnectTimer !== null) return;
    const wait = reconnectDelay;
    reconnectDelay = Math.min(30000, Math.round(reconnectDelay * 1.7));
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connectServer();
    }, wait);
  }

  function markServerConnected() {
    serverTried = true;
    serverConnected = true;
    reconnectDelay = 3000;
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    setConnection('connected', 'Live sync');
    $('syncNotice').hidden = true;
  }

  function markServerDisconnected() {
    serverTried = true;
    serverConnected = false;
    setConnection('local', 'Reconnecting');
    $('syncNotice').hidden = false;
  }

  async function refreshRemoteState() {
    if (!isHttpPage() || remoteRefreshInFlight) return false;
    remoteRefreshInFlight = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`/api/live-state?_=${Date.now()}`, {
        cache: 'no-store',
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Live API returned ${response.status}`);
      const data = await response.json();
      if (data && data.state && typeof data.state === 'object') {
        acceptState(data.state);
      } else {
        // The server is reachable but has no published session. Clear any old
        // browser-cached snapshot instead of showing stale queue data.
        const emptyState = {
          sessionName: 'Pickle Point Match', active: false, updatedAt: null,
          queue: [], courts: [], courtCount: 0, waitingCourtCount: 0
        };
        acceptState(emptyState);
      }
      markServerConnected();
      return true;
    } catch (error) {
      markServerDisconnected();
      // Keep the most recent displayed state during temporary network problems.
      // Load the browser snapshot only when this page has no state yet.
      if (!currentState) {
        const saved = localSnapshot();
        if (saved) acceptState(saved);
      }
      return false;
    } finally {
      window.clearTimeout(timeout);
      remoteRefreshInFlight = false;
    }
  }

  function startEventStream() {
    if (!isHttpPage() || typeof EventSource === 'undefined') return;
    if (eventSource && eventSource.readyState !== EventSource.CLOSED) return;
    try {
      const source = new EventSource('/api/live-events');
      eventSource = source;
      source.addEventListener('live-state', event => {
        try {
          const parsed = JSON.parse(event.data);
          acceptState(parsed);
          markServerConnected();
        } catch (error) {}
      });
      source.addEventListener('live-theme', event => {
        const theme = String(event.data || '').trim();
        if (theme === 'light' || theme === 'night') applyTheme(theme);
      });
      source.onopen = () => markServerConnected();
      source.onerror = () => {
        markServerDisconnected();
        // EventSource reconnects on its own while CONNECTING. If the stream
        // is fully closed, recreate it after checking the API again.
        if (source.readyState === EventSource.CLOSED) {
          if (eventSource === source) eventSource = null;
          scheduleReconnect();
        }
      };
    } catch (error) {
      eventSource = null;
      scheduleReconnect();
    }
  }

  async function connectServer() {
    if (!isHttpPage()) {
      serverTried = true;
      acceptState(localSnapshot());
      render();
      return;
    }
    const connected = await refreshRemoteState();
    if (connected) startEventStream();
    else scheduleReconnect();
  }

  try {
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel('pickle-point-match-live-view');
      channel.onmessage = event => { if (event.data) acceptState(event.data); };
    }
  } catch (error) {}
  window.addEventListener('storage', event => {
    if (event.key === LIVE_VIEW_STORAGE_KEY && event.newValue) {
      try { acceptState(JSON.parse(event.newValue)); } catch (error) {}
    }
    if (event.key === THEME_STORAGE_KEY && event.newValue) {
      applyTheme(event.newValue);
    }
  });

  applyTheme(loadTheme());
  loadRemoteTheme();

  const boot = localSnapshot();
  if (boot) { currentState = boot; render(); }
  connectServer();
  // Polling is a recovery path if a proxy, sleeping host, or network issue
  // interrupts Server-Sent Events. The stream still delivers normal updates
  // immediately; polling ensures the page eventually catches up if it does not.
  if (isHttpPage()) {
    window.setInterval(async () => {
      const connected = await refreshRemoteState();
      if (connected && (!eventSource || eventSource.readyState === EventSource.CLOSED)) {
        eventSource = null;
        startEventStream();
      } else if (!connected) {
        scheduleReconnect();
      }
    }, 15000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) connectServer();
    });
  }
  setInterval(() => {
    document.querySelectorAll('[data-start]').forEach(el => {
      el.textContent = elapsed(el.dataset.start);
      el.classList.remove('timer-blue', 'timer-amber', 'timer-red');
      el.classList.add(timerClass(el.dataset.start));
    });
  }, 1000);
})();
