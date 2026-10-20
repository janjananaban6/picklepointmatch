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
  // Render browser-style search highlights while keeping player names HTML-safe.
  const highlightSearchMatch = (value, term) => {
    const text = String(value ?? '');
    const query = String(term ?? '').trim();
    if (!query) return escapeHTML(text);
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escapedQuery, 'gi');
    let output = '';
    let cursor = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      output += escapeHTML(text.slice(cursor, match.index));
      output += `<mark class="live-ranking-search-hit">${escapeHTML(match[0])}</mark>`;
      cursor = pattern.lastIndex;
    }
    return output + escapeHTML(text.slice(cursor));
  };
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
    // Mirror the Queueing page: regular courts are READY until playing;
    // waiting-court slots are labeled Up Next.
    const status = c.waitingOnly ? 'Up Next' : (c.playing ? 'PLAYING' : 'READY');
    const statusClass = c.waitingOnly ? 'is-up-next' : (c.playing ? 'is-playing' : 'is-ready');
    const t1 = Array.isArray(c.team1) ? c.team1 : [];
    const t2 = Array.isArray(c.team2) ? c.team2 : [];
    const shortPlayerName = player => {
      if (!player) return '';
      const nickname = String(player.nickname || '').trim();
      const firstName = String(player.name || '').trim().split(/\s+/)[0];
      return nickname || firstName || 'Player';
    };
    const teamLabel = players => players.filter(Boolean).map(shortPlayerName).filter(Boolean).join(' · ') || 'Open court';
    const categoryClasses = { BEG: 'skill-beg', NOV: 'skill-nov', INT: 'skill-int', ADV: 'skill-adv', EXP: 'skill-exp' };
    const marker = (player, slotClass) => {
      const category = String(player?.category || '').trim().toUpperCase();
      const categoryClass = categoryClasses[category] || '';
      const genderClass = player ? playerGenderClass(player) : '';
      const genderLabel = genderClass === 'female' ? 'Female' : 'Male';
      const accessibleName = player ? `${playerName(player)}${categoryClass ? `, ${category} category` : ''}${player ? `, ${genderLabel}` : ''}` : 'Open slot';
      const categoryBadge = player && categoryClass
        ? `<span class="court-player-category ${categoryClass}" title="${category} category">${category}</span>`
        : '';
      const genderBadge = player
        ? `<span class="court-player-gender ${genderClass}" title="${genderLabel}" aria-label="${genderLabel}">${playerGenderIcon(player)}</span>`
        : '';
      return `<span class="court-player-marker ${slotClass}${player ? '' : ' is-empty'}" title="${escapeHTML(accessibleName)}" aria-label="${escapeHTML(accessibleName)}"><span class="court-player-initial">${escapeHTML(player ? playerInitial(player) : '+')}</span>${categoryBadge}${genderBadge}</span>`;
    };
    // Number only regular courts in the visual header; waiting courts keep their existing generic label.
    const courtNumber = Number(c.number);
    const courtName = c.waitingOnly ? 'Court #' : (Number.isFinite(courtNumber) && courtNumber > 0 ? `Court ${courtNumber}` : 'Court #');
    const timer = c.playing
      ? `<span class="court-mini-timer ${timerClass(c.start)}" data-start="${escapeHTML(c.start || '')}" title="Match duration">${elapsed(c.start)}</span>`
      : '';
    const score = c.playing && currentState?.recordScores === true
      ? `<div class="court-visual-score" aria-label="Score ${Number(c.scores?.[0]) || 0} to ${Number(c.scores?.[1]) || 0}"><b>${Number(c.scores?.[0]) || 0}</b><span>–</span><b>${Number(c.scores?.[1]) || 0}</b></div>`
      : '';
    const diagramLabel = `${courtName}: ${teamLabel(t1)} versus ${teamLabel(t2)}`;
    return `<article class="court-card court-visual-card${c.playing ? ' playing' : ''}${c.waitingOnly ? ' waiting-only' : ''}">
      <div class="court-visual-header">
        <div class="court-visual-heading"><strong class="court-visual-name">${escapeHTML(courtName)}</strong>${timer}</div>
        <span class="court-visual-status ${statusClass}"><i aria-hidden="true"></i>${status}</span>
      </div>
      <div class="court-diagram" role="img" aria-label="${escapeHTML(diagramLabel)}">
        <span class="court-diagram-line court-diagram-horizontal" aria-hidden="true"></span>
        <span class="court-diagram-line court-diagram-vertical court-diagram-third" aria-hidden="true"></span>
        <span class="court-diagram-line court-diagram-vertical court-diagram-two-thirds" aria-hidden="true"></span>
        <span class="court-diagram-center-line" aria-hidden="true"></span>
        ${marker(t1[0], 'marker-top-left')}
        ${marker(t1[1], 'marker-bottom-left')}
        ${marker(t2[0], 'marker-top-right')}
        ${marker(t2[1], 'marker-bottom-right')}
      </div>
      <div class="court-team-footer">
        <span class="court-team-label court-team-left">${escapeHTML(teamLabel(t1))}</span>
        <span class="court-team-versus">VS</span>
        <span class="court-team-label court-team-right">${escapeHTML(teamLabel(t2))}</span>
      </div>
      ${score}
    </article>`;
  }

  function renderLiveRanking(listId = 'pageRankingList', searchInputId = 'pageRankingSearch') {
    const list = $(listId);
    if (!list) return;
    const ranking = Array.isArray(currentState?.ranking) ? currentState.ranking : [];
    if (!currentState?.active || currentState?.liveRankingEnabled === false) {
      list.innerHTML = '<div class="live-ranking-empty"><span aria-hidden="true">🏆</span><strong>Rankings unavailable</strong><span>Live rankings are currently disabled for this session.</span><span>Request on QM to enable the live ranking.</span></div>';
      return;
    }
    if (!ranking.length) {
      list.innerHTML = '<div class="live-ranking-empty"><span aria-hidden="true">🏆</span><strong>No ranking standings yet</strong><span>Complete a recorded match to start the live ranking.</span></div>';
      return;
    }

    const searchTerm = String($(searchInputId)?.value || '').trim().toLocaleLowerCase();
    const filteredRanking = ranking
      .map((player, index) => ({ player, index, rank: Number(player.position) || index + 1 }))
      .filter(({ player }) => {
        if (!searchTerm) return true;
        const name = String(player.name || 'Player');
        const nickname = String(player.nickname || '').trim();
        return [name, nickname, `${name} ${nickname}`]
          .some(value => value.toLocaleLowerCase().includes(searchTerm));
      });

    if (!filteredRanking.length) {
      list.innerHTML = `<div class="live-ranking-empty"><span aria-hidden="true">🔎</span><strong>No players found</strong><span>No players match “${escapeHTML(String($(searchInputId)?.value || '').trim())}”. Try another name.</span></div>`;
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    list.innerHTML = filteredRanking.map(({ player: p, rank }) => {
      const name = String(p.name || 'Player');
      const nickname = String(p.nickname || '').trim();
      const displayName = nickname && nickname.toLowerCase() !== name.trim().toLowerCase()
        ? `${name} (${nickname})` : name;
      const position = rank >= 1 && rank <= 3 ? medals[rank - 1] : `#${rank}`;
      const genderClass = playerGenderClass(p);
      const genderLabel = genderClass === 'female' ? 'Female' : 'Male';
      const category = String(p.category || '').trim().toUpperCase();
      const categoryClass = ({ BEG: 'skill-beg', NOV: 'skill-nov', INT: 'skill-int', ADV: 'skill-adv', EXP: 'skill-exp' })[category] || '';
      const winRate = Math.max(0, Math.min(100, Number(p.winRate) || 0));
      const rankClass = rank >= 1 && rank <= 3 ? ` rank-${rank}` : '';
      return `<article class="live-ranking-row${rankClass}">
        <div class="live-ranking-position" aria-label="Rank ${rank}">${position}</div>
        <div class="live-ranking-main">
          <div class="live-ranking-name-line"><strong>${highlightSearchMatch(displayName, searchTerm)}</strong><span class="live-player-gender ${genderClass}" title="${genderLabel}" aria-label="${genderLabel}">${playerGenderIcon(p)}</span>${category ? `<span class="live-ranking-category ${categoryClass}">${escapeHTML(category)}</span>` : ''}${p.playing ? '<span class="live-ranking-playing">Playing</span>' : ''}</div>
          <div class="live-ranking-stats"><span>${Number(p.wins) || 0}W - ${Number(p.losses) || 0}L</span><span>${Number(p.matches) || 0} match${Number(p.matches) === 1 ? '' : 'es'}</span></div>
          <div class="live-ranking-progress" aria-label="Win rate ${winRate}%"><span style="width:${winRate}%"></span></div>
        </div>
        <div class="live-ranking-result"><strong>${winRate}%</strong><span>Win rate</span></div>
      </article>`;
    }).join('');
  }

  function renderRecentMatches() {
    const list = $('matchesList');
    if (!list) return;
    const matches = Array.isArray(currentState?.recentMatches) ? currentState.recentMatches : [];
    const count = $('matchesSectionCount');
    if (!currentState?.active || currentState?.liveMatchesEnabled === false) {
      if (count) count.textContent = '(0)';
      list.innerHTML = '<div class="live-ranking-empty"><span aria-hidden="true">🏓</span><strong>Matches unavailable</strong><span>Live matches are currently disabled for this session.</span><span>Request on QM to enable live matches.</span></div>';
      return;
    }
    const rawSearchTerm = String($('pageMatchesSearch')?.value || '').trim();
    const searchTerm = rawSearchTerm.toLocaleLowerCase();
    const filteredMatches = matches.filter(match => {
      if (!searchTerm) return true;
      const date = match.endedAt ? new Date(match.endedAt) : null;
      const endedAt = date && !Number.isNaN(date.getTime())
        ? date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        : '';
      const searchableValues = [
        match.court,
        match.winner,
        match.loser,
        match.score,
        match.duration,
        match.endedAt,
        endedAt
      ];
      return searchableValues.some(value => String(value || '').toLocaleLowerCase().includes(searchTerm));
    });

    // Keep the section count in sync with the same filtered results shown below.
    if (count) count.textContent = `(${filteredMatches.length})`;

    if (!matches.length) {
      list.innerHTML = '<div class="live-ranking-empty"><span aria-hidden="true">🏓</span><strong>No recorded matches yet</strong><span>Finished matches will appear here after they are recorded.</span></div>';
      return;
    }

    if (!filteredMatches.length) {
      list.innerHTML = `<div class="live-ranking-empty"><span aria-hidden="true">🔎</span><strong>No matches found</strong><span>No match results match “${escapeHTML(rawSearchTerm)}”. Try another search.</span></div>`;
      return;
    }

    list.innerHTML = filteredMatches.map(match => {
      const court = String(match.court || 'Court');
      const winner = String(match.winner || 'Winner not recorded');
      const loser = String(match.loser || 'Opponent not recorded');
      const score = String(match.score || '').trim();
      const date = match.endedAt ? new Date(match.endedAt) : null;
      const endedAt = date && !Number.isNaN(date.getTime())
        ? date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        : '';
      const duration = String(match.duration || '').trim();
      const matchMeta = [endedAt, duration].filter(Boolean).join(' · ');
      return `<article class="live-match-row">
        <div class="live-match-topline"><strong>${highlightSearchMatch(court, rawSearchTerm)}</strong><span>${highlightSearchMatch(matchMeta, rawSearchTerm)}</span></div>
        <div class="live-match-result"><div class="live-match-winner"><span class="live-match-outcome">WINNER</span><strong>${highlightSearchMatch(winner, rawSearchTerm)}</strong></div><span class="live-match-vs">VS</span><div class="live-match-loser"><span class="live-match-outcome">OPPONENT</span><strong>${highlightSearchMatch(loser, rawSearchTerm)}</strong></div></div>
        ${score ? `<div class="live-match-score">${highlightSearchMatch(score, rawSearchTerm)}</div>` : ''}
      </article>`;
    }).join('');
  }

  function setLiveTab(tabName) {
    const allowed = ['queue', 'rankings', 'matches'];
    const selected = allowed.includes(tabName) ? tabName : 'queue';
    document.querySelectorAll('[data-live-tab]').forEach(button => {
      const isSelected = button.dataset.liveTab === selected;
      button.classList.toggle('is-active', isSelected);
      button.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      button.tabIndex = isSelected ? 0 : -1;
    });
    document.querySelectorAll('[data-live-panel]').forEach(panel => {
      panel.hidden = panel.dataset.livePanel !== selected;
    });
    if (selected === 'rankings') renderLiveRanking('pageRankingList', 'pageRankingSearch');
    if (selected === 'matches') renderRecentMatches();
  }

  function render() {
    const s = currentState;
    renderLiveRanking('pageRankingList', 'pageRankingSearch');
    renderRecentMatches();
    const active = !!s?.active;
    // Never show a stale dated session title when there is no active session.
    $('sessionTitle').textContent = active ? (s?.sessionName || 'Open Play') : 'Open Play';
    $('inactiveNotice').hidden = active;
    $('queueSectionCount').textContent = `(${s?.queue?.length || 0})`;

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
  $('pageRankingSearch')?.addEventListener('input', () => renderLiveRanking('pageRankingList', 'pageRankingSearch'));
  $('pageMatchesSearch')?.addEventListener('input', renderRecentMatches);
  document.querySelectorAll('[data-live-tab]').forEach(button => {
    button.addEventListener('click', () => setLiveTab(button.dataset.liveTab));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = [...document.querySelectorAll('[data-live-tab]:not([hidden])')];
      const index = tabs.indexOf(button);
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault();
      tabs[nextIndex]?.focus();
      if (tabs[nextIndex]) setLiveTab(tabs[nextIndex].dataset.liveTab);
    });
  });

  applyTheme(loadTheme());
  loadRemoteTheme();

  const boot = localSnapshot();
  if (boot) {
    currentState = boot;
    render();
  } else {
    // Render the inactive-queue notice immediately while the first shared-state
    // request is loading, or if the server cannot be reached on a fresh device.
    currentState = {
      sessionName: 'Pickle Point Match', active: false, updatedAt: null,
      queue: [], courts: [], ranking: [], courtCount: 0, waitingCourtCount: 0
    };
    render();
  }
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
