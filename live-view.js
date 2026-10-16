(() => {
  'use strict';
  const LIVE_VIEW_STORAGE_KEY = 'picklepoint_live_view_state_v1';
  const THEME_STORAGE_KEY = 'picklepoint_live_view_theme_v1';
  const $ = id => document.getElementById(id);
  let currentState = null;
  let serverConnected = false;
  let serverTried = false;
  let channel = null;

  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
  const playerName = p => p
    ? String(p.name || 'Player') + (p.nickname && String(p.nickname).trim().toLowerCase() !== String(p.name || '').trim().toLowerCase() ? ` (${p.nickname})` : '')
    : 'Waiting for player';
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
    const toggle = $('themeToggle');
    if (!toggle) return;
    const lightMode = normalized === 'light';
    toggle.setAttribute('aria-pressed', String(lightMode));
    const nextMode = lightMode ? 'night' : 'light';
    const nextLabel = lightMode ? 'Night' : 'Light';
    const nextAction = `Switch to ${nextMode} mode`;
    const icon = toggle.querySelector('.theme-toggle-icon');
    const label = toggle.querySelector('.theme-toggle-label');
    if (icon) icon.textContent = lightMode ? '☾' : '☀';
    if (label) label.textContent = nextLabel;
    toggle.setAttribute('aria-label', nextAction);
    toggle.title = nextAction;
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
      return `<div class="player-chip${player ? '' : ' empty'}"><span class="player-chip-name">${escapeHTML(name)}</span></div>`;
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
      ? queue.map((p, i) => `<div class="queue-item"><span class="queue-number">${i + 1}</span><div class="queue-player-wrap"><div class="queue-player">${escapeHTML(playerName(p))}</div></div></div>`).join('')
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

  async function connectServer() {
    if (!['http:', 'https:'].includes(location.protocol)) {
      serverTried = true;
      acceptState(localSnapshot());
      render();
      return;
    }
    try {
      const response = await fetch('/api/live-state', { cache: 'no-store' });
      if (!response.ok) throw new Error('Live API unavailable');
      const data = await response.json();
      serverTried = true;
      serverConnected = true;
      if (data && data.state) acceptState(data.state);
      else if (localSnapshot()) acceptState(localSnapshot());
      setConnection('connected', 'Live sync');
      $('syncNotice').hidden = true;
      const source = new EventSource('/api/live-events');
      source.addEventListener('live-state', event => {
        try {
          const parsed = JSON.parse(event.data);
          serverConnected = true;
          acceptState(parsed);
          setConnection('connected', 'Live sync');
          $('syncNotice').hidden = true;
        } catch (error) {}
      });
      source.onopen = () => {
        serverConnected = true;
        setConnection('connected', 'Live sync');
        $('syncNotice').hidden = true;
      };
      source.onerror = () => {
        serverConnected = false;
        setConnection('local', 'Reconnecting');
        $('syncNotice').hidden = false;
      };
    } catch (error) {
      serverTried = true;
      serverConnected = false;
      acceptState(localSnapshot());
      setConnection('local', 'Local preview');
      $('syncNotice').hidden = false;
    }
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

  const themeToggle = $('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const nextTheme = document.documentElement.dataset.theme === 'light' ? 'night' : 'light';
      applyTheme(nextTheme);
      try { localStorage.setItem(THEME_STORAGE_KEY, nextTheme); } catch (error) {}
    });
  }
  applyTheme(loadTheme());

  const boot = localSnapshot();
  if (boot) { currentState = boot; render(); }
  connectServer();
  setInterval(() => {
    document.querySelectorAll('[data-start]').forEach(el => {
      el.textContent = elapsed(el.dataset.start);
      el.classList.remove('timer-blue', 'timer-amber', 'timer-red');
      el.classList.add(timerClass(el.dataset.start));
    });
  }, 1000);
})();
