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
  const playerInitial = p => String(p?.name || '').trim().charAt(0).toUpperCase() || 'P';
  const normalizedPlayerGender = p => String(p?.gender ?? '').trim().toLowerCase();
  const playerGenderClass = p => ['female', 'f', 'woman', 'women'].includes(normalizedPlayerGender(p)) ? 'female' : 'male';
  // Use inline SVG instead of platform-dependent Unicode glyphs so gender icons
  // stay consistently sized and aligned across Windows, Android, iOS and browsers.
  const playerGenderIcon = p => playerGenderClass(p) === 'female'
    ? '<svg class="gender-symbol" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="4.8" r="3.55" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 8.4v5.9M5.25 11.35h5.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
    : '<svg class="gender-symbol" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="5.35" cy="10.65" r="3.45" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7.8 8.2 14.1 1.9M9.35 1.9h4.75v4.75" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
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
  const waitingDuration = start => {
    if (!start) return '0m waiting';
    const totalSeconds = Math.max(0, Math.floor((Date.now() - Number(start)) / 1000));
    if (totalSeconds < 60) return '0m waiting';
    const minutes = Math.floor(totalSeconds / 60);
    if (minutes < 60) return `${minutes}m waiting`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m waiting`;
  };
  const waitingTimeClass = start => {
    const totalSeconds = start ? Math.max(0, Math.floor((Date.now() - Number(start)) / 1000)) : 0;
    if (totalSeconds >= 15 * 60) return 'waiting-red';
    if (totalSeconds >= 10 * 60) return 'waiting-amber';
    return '';
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
    const status = c.waitingOnly ? 'Up Next' : c.playing ? 'Playing' : 'Ready';
    const statusClass = c.waitingOnly ? 'up-next' : c.playing ? 'playing' : 'ready';
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
      ? `<div class="match-meta"><span class="match-timer ${timerClass(c.start)}" data-start="${escapeHTML(c.start || '')}">${elapsed(c.start)}</span><span class="race-to-win">To ${Number(c.target) || 11} (win by ${Number(c.winBy) || 1})</span></div>`
      : `<div class="match-meta"><span>${c.waitingOnly ? 'Waiting for an available court' : 'Ready for matchmaking'}</span><span>${(c.players || []).filter(Boolean).length}/4 players</span></div>`;
    return `<article class="court-card${c.playing ? ' playing' : ''}"><div class="court-top"><strong class="court-name">${escapeHTML(courtName)}</strong><span class="court-state ${statusClass}">${status}</span></div>${matchMeta}<div class="teams"><div class="team"><span class="team-label">TEAM 1</span>${team(t1)}</div><div class="versus">VS</div><div class="team"><span class="team-label">TEAM 2</span>${team(t2)}</div></div>${c.playing && currentState?.recordScores === true ? `<div class="scoreline"><div class="score-values"><b>${Number(c.scores?.[0]) || 0}</b><span class="score-separator">-</span><b>${Number(c.scores?.[1]) || 0}</b></div></div>` : ''}</article>`;
  }

  function renderLiveRanking() {
    const list = $('liveRankingList');
    const subtitle = $('liveRankingSubtitle');
    if (!list) return;
    const ranking = Array.isArray(currentState?.ranking) ? currentState.ranking : [];
    if (subtitle) {
      const totalMatches = Number(currentState?.matchCount) || ranking.reduce((sum, p) => sum + (Number(p.matches) || 0), 0);
      subtitle.textContent = `${ranking.length} ranked player${ranking.length === 1 ? '' : 's'} · ${totalMatches} completed match${totalMatches === 1 ? '' : 'es'} · updates automatically`;
    }
    if (!ranking.length) {
      list.innerHTML = '<div class="live-ranking-empty"><span aria-hidden="true">🏆</span><strong>No ranking standings yet</strong><span>Complete a recorded match to start the live ranking.</span></div>';
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    list.innerHTML = ranking.map((p, i) => {
      const name = String(p.name || 'Player');
      const nickname = String(p.nickname || '').trim();
      const displayName = nickname && nickname.toLowerCase() !== name.trim().toLowerCase()
        ? `${name} (${nickname})` : name;
      const position = i < 3 ? medals[i] : `#${Number(p.position) || i + 1}`;
      const category = String(p.category || '').trim().toUpperCase();
      const categoryClass = ({ BEG: 'skill-beg', NOV: 'skill-nov', INT: 'skill-int', ADV: 'skill-adv', EXP: 'skill-exp' })[category] || '';
      const winRate = Math.max(0, Math.min(100, Number(p.winRate) || 0));
      return `<article class="live-ranking-row">
        <div class="live-ranking-position" aria-label="Rank ${Number(p.position) || i + 1}">${position}</div>
        <div class="live-ranking-main">
          <div class="live-ranking-name-line"><strong>${escapeHTML(displayName)}</strong>${category ? `<span class="live-ranking-category ${categoryClass}">${escapeHTML(category)}</span>` : ''}${p.playing ? '<span class="live-ranking-playing">Playing</span>' : ''}</div>
          <div class="live-ranking-stats"><span>${Number(p.wins) || 0}W - ${Number(p.losses) || 0}L</span><span>${Number(p.matches) || 0} match${Number(p.matches) === 1 ? '' : 'es'}</span></div>
          <div class="live-ranking-progress" aria-label="Win rate ${winRate}%"><span style="width:${winRate}%"></span></div>
        </div>
        <div class="live-ranking-result"><strong>${winRate}%</strong><span>Win rate</span></div>
      </article>`;
    }).join('');
  }

  function syncLiveRankingAvailability() {
    const enabled = currentState?.liveRankingEnabled !== false;
    const toggle = $('liveRankingToggle');
    const modal = $('liveRankingModal');
    if (toggle) toggle.hidden = !enabled;
    if (!enabled && modal && !modal.hidden) {
      modal.hidden = true;
      toggle?.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('live-ranking-open');
    }
    return enabled;
  }

  function setLiveRankingOpen(open) {
    const modal = $('liveRankingModal');
    const toggle = $('liveRankingToggle');
    if (!modal || !toggle) return;
    if (open && !syncLiveRankingAvailability()) return;
    modal.hidden = !open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      renderLiveRanking();
      $('liveRankingClose')?.focus();
      document.body.classList.add('live-ranking-open');
    } else {
      document.body.classList.remove('live-ranking-open');
      toggle.focus();
    }
  }

  function render() {
    const s = currentState;
    syncLiveRankingAvailability();
    renderLiveRanking();
    const active = !!s?.active;
    $('sessionTitle').textContent = s?.sessionName || 'Pickle Point Match';
    $('inactiveNotice').hidden = active;
    $('queueSectionCount').textContent = `(${s?.queue?.length || 0})`;
    $('lastUpdated').textContent = s?.updatedAt
      ? `Last updated ${new Date(s.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`
      : 'Waiting for live session data…';

    const allCourts = s?.courts || [];
    const regularCourts = allCourts.filter(c => !c.waitingOnly);
    const waitingCourts = allCourts.filter(c => c.waitingOnly);
    $('courtSectionCount').textContent = `(${s?.courtCount ?? regularCourts.length})`;
    $('courtsList').innerHTML = regularCourts.length
      ? regularCourts.map(renderCourtCard).join('')
      : '<div class="empty-state">No courts have been set up in this session.</div>';

    $('waitingCourtsSection').hidden = waitingCourts.length === 0;
    $('waitingCourtSectionCount').textContent = `(${waitingCourts.length})`;
    $('waitingCourtsList').innerHTML = waitingCourts.map(renderCourtCard).join('');

    const queue = s?.queue || [];
    $('queueList').innerHTML = queue.length
      ? queue.map((p, i) => {
          const waitingSince = p.waitingSince || p.queuedAt || null;
          const genderClass = playerGenderClass(p);
          const genderLabel = genderClass === 'female' ? 'Female' : 'Male';
          const lockedPartnerName = String(p.lockedPartnerName || '').trim();
          const lockedPartnerIndicator = lockedPartnerName
            ? `<span class="queue-locked-partner-inline" title="Locked in with ${escapeHTML(lockedPartnerName)}" aria-label="Locked in with partner ${escapeHTML(lockedPartnerName)}" role="img">🔒${escapeHTML(lockedPartnerName)}</span>`
            : '';
          return `<div class="queue-item"><div class="queue-avatar-stack" aria-label="${genderLabel} player, queue position ${i + 1}"><div class="queue-avatar ${genderClass}" aria-hidden="true">${escapeHTML(playerInitial(p))}</div><span class="queue-position-badge" aria-label="Queue position ${i + 1}">${i + 1}</span></div><div class="queue-player-wrap"><div class="queue-player-line"><div class="queue-player">${escapeHTML(playerName(p))}</div><span class="live-player-gender ${genderClass}" title="${genderLabel}" aria-label="${genderLabel}">${playerGenderIcon(p)}</span><span class="live-player-category ${playerCategoryClass(p)}" title="Skill category">${escapeHTML(playerCategory(p))}</span>${lockedPartnerIndicator}</div></div><span class="queue-waiting-time ${waitingTimeClass(waitingSince)}" data-waiting-since="${escapeHTML(waitingSince || '')}" title="Player waiting time">${waitingDuration(waitingSince)}</span></div>`;
        }).join('')
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
          queue: [], courts: [], ranking: [], courtCount: 0, waitingCourtCount: 0
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

  $('liveRankingToggle')?.addEventListener('click', () => setLiveRankingOpen(true));
  $('liveRankingClose')?.addEventListener('click', () => setLiveRankingOpen(false));
  $('liveRankingModal')?.querySelectorAll('[data-close-live-ranking]').forEach(el => {
    el.addEventListener('click', () => setLiveRankingOpen(false));
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && $('liveRankingModal') && !$('liveRankingModal').hidden) setLiveRankingOpen(false);
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
    document.querySelectorAll('.queue-waiting-time[data-waiting-since]').forEach(el => {
      el.textContent = waitingDuration(el.dataset.waitingSince);
      el.classList.remove('waiting-amber', 'waiting-red');
      const waitingClass = waitingTimeClass(el.dataset.waitingSince);
      if (waitingClass) el.classList.add(waitingClass);
    });
  }, 1000);
})();
