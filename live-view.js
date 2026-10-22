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
  let queueCollapsed = false;
  let queueAnimationToken = 0;
  let queueAnimationTimer = null;
  let queueTransitionHandler = null;
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
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) themeColorMeta.content = normalized === 'light' ? '#f1f7f8' : '#072f38';
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

  function renderCourtCard(c, listName = 'regular', index = 0) {
    // Mirror the Queueing page: regular courts are READY until playing;
    // waiting-court slots are labeled Up Next.
    const status = c.waitingOnly ? 'Up Next' : (c.playing ? 'PLAYING' : 'READY');
    const statusClass = c.waitingOnly ? 'is-up-next' : (c.playing ? 'is-playing' : 'is-ready');
    const t1 = Array.isArray(c.team1) ? c.team1 : [];
    const t2 = Array.isArray(c.team2) ? c.team2 : [];
    const hasPlayers = [...t1, ...t2].some(Boolean);
    // Empty courts show a simple message instead of an empty diagram or guide line.
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
    const diagramContent = hasPlayers
      ? `<div class="court-diagram" role="img" aria-label="${escapeHTML(diagramLabel)}">
          <span class="court-diagram-line court-diagram-horizontal" aria-hidden="true"></span>
          <span class="court-diagram-line court-diagram-vertical court-diagram-third" aria-hidden="true"></span>
          <span class="court-diagram-line court-diagram-vertical court-diagram-two-thirds" aria-hidden="true"></span>
          <span class="court-diagram-center-line" aria-hidden="true"></span>
          ${marker(t1[0], 'marker-top-left')}
          ${marker(t1[1], 'marker-bottom-left')}
          ${marker(t2[0], 'marker-top-right')}
          ${marker(t2[1], 'marker-bottom-right')}
        </div>`
      : '<div class="court-diagram-empty-message" role="status">No players assigned yet</div>';
    return `<article class="court-card court-visual-card${c.playing ? ' playing' : ''}${c.waitingOnly ? ' waiting-only' : ''}${hasPlayers ? '' : ' is-empty-court'}">
      <div class="court-visual-header">
        <div class="court-visual-heading"><strong class="court-visual-name">${escapeHTML(courtName)}</strong>${timer}</div>
        <span class="court-visual-status ${statusClass}"><i aria-hidden="true"></i>${status}</span>
      </div>
      ${diagramContent}
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
    // Preserve the user's visible court on both horizontal lists while live data
    // replaces card DOM nodes. An innerHTML rebuild can reset scrollLeft on iOS,
    // Safari, and some Chromium layouts even when the court count is unchanged.
    const courtScrollSnapshots = ['courtsList', 'waitingCourtsList'].map(id => {
      const list = $(id);
      return list ? {
        list,
        left: list.scrollLeft,
        top: list.scrollTop,
        horizontal: list.classList.contains('is-horizontal-scroll')
      } : null;
    });
    renderLiveRanking('pageRankingList', 'pageRankingSearch');
    renderRecentMatches();
    const active = !!s?.active;
    // Never show a stale dated session title when there is no active session.
    $('sessionTitle').textContent = active ? (s?.sessionName || 'Open Play') : 'Open Play';
    const sessionMatchType = $('sessionMatchType');
    if (sessionMatchType) sessionMatchType.textContent = String(s?.eventRules?.type || 'Doubles');
    const sessionPlayerCount = $('sessionPlayerCount');
    if (sessionPlayerCount) {
      const reportedPlayerCount = Number(s?.playerCount);
      const fallbackPlayerIds = new Set();
      (Array.isArray(s?.queue) ? s.queue : []).forEach(player => {
        const key = player?.id != null ? String(player.id) : String(player?.name || '');
        if (key) fallbackPlayerIds.add(key);
      });
      (Array.isArray(s?.courts) ? s.courts : []).forEach(court => {
        (Array.isArray(court?.players) ? court.players : [...(court?.team1 || []), ...(court?.team2 || [])]).forEach(player => {
          if (!player) return;
          const key = player?.id != null ? String(player.id) : String(player?.name || '');
          if (key) fallbackPlayerIds.add(key);
        });
      });
      const playerCount = Number.isFinite(reportedPlayerCount) && reportedPlayerCount >= 0
        ? reportedPlayerCount
        : fallbackPlayerIds.size;
      sessionPlayerCount.textContent = `${playerCount} player${playerCount === 1 ? '' : 's'}`;
    }
    $('inactiveNotice').hidden = active;
    $('queueSectionCount').textContent = `${s?.queue?.length || 0} WAITING`;

    const allCourts = Array.isArray(s?.courts) ? s.courts : [];
    const regularCourts = allCourts.filter(c => c && !c.waitingOnly);
    const waitingCourts = allCourts.filter(c => c && c.waitingOnly);
    const sessionCourtCount = $('sessionCourtCount');
    if (sessionCourtCount) {
      const courtCount = regularCourts.length;
      sessionCourtCount.textContent = `${courtCount} court${courtCount === 1 ? '' : 's'}`;
    }

    // Derive the heading count from the same court records used to render the
    // cards. The published activeCourtCount can be stale (for example, after
    // the server merges a registration update), so it must never override the
    // actual playing flags on the current court list.
    const liveCourtCount = regularCourts.filter(c => Boolean(c.playing)).length;
    const courtCountLabel = $('courtSectionCount');
    if (courtCountLabel) courtCountLabel.textContent = `${liveCourtCount} live`;
    $('courtsList').innerHTML = regularCourts.length
      ? regularCourts.map((court, index) => renderCourtCard(court, 'regular', index)).join('')
      : '<div class="empty-state">No courts have been set up in this session.</div>';

    $('waitingCourtsSection').hidden = waitingCourts.length === 0;
    $('waitingCourtSectionCount').textContent = `${waitingCourts.length} planned`;
    $('waitingCourtsList').innerHTML = waitingCourts.map((court, index) => renderCourtCard(court, 'waiting', index)).join('');
    // Reapply scroll offsets before geometry is measured by the layout
    // controllers. This keeps Court 2/3/etc visible during ordinary live updates,
    // including empty court cards; only an explicit layout toggle resets to Court 1.
    courtScrollSnapshots.forEach(snapshot => {
      if (!snapshot || !snapshot.horizontal || !snapshot.list.classList.contains('is-horizontal-scroll')) return;
      snapshot.list.scrollLeft = snapshot.left;
      snapshot.list.scrollTop = snapshot.top;
    });
    courtLayoutController?.syncCardCount();
    waitingCourtLayoutController?.syncCardCount();

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

    const queueViewport = $('queueListViewport');
    if (queueViewport) {
      // Keep accessibility state in sync during live refreshes, but let the
      // dedicated toggle handler own height/opacity animation styles.
      queueViewport.setAttribute('aria-hidden', String(queueCollapsed));
      if (queueCollapsed) queueViewport.setAttribute('inert', '');
      else queueViewport.removeAttribute('inert');
    }

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
  const courtLayoutMediaQuery = typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 560px)')
    : { matches: false };
  const courtLayoutReducedMotion = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  function createCourtLayoutController(toggle, list, labelPrefix) {
    if (!toggle || !list) return null;
    let horizontalMode = false;
    let transitionToken = 0;
    let scrollResetToken = 0;
    let animations = [];
    let transitionStacking = new Map();
    // Keep the vertical card geometry across live re-renders. render() replaces
    // each card's DOM node when the server publishes an update, so inline
    // geometry on the old nodes must be restored onto the new ones.
    let lockedGeometry = [];

    function geometrySignature(card) {
      return ['waiting-only', 'playing', 'is-empty-court']
        .filter(className => card.classList.contains(className))
        .join('|');
    }

    function applyLockedGeometry() {
      if (!horizontalMode || !courtLayoutMediaQuery.matches) return;
      const cards = Array.from(list.querySelectorAll(':scope > .court-card'));
      cards.forEach((card, index) => {
        const signature = geometrySignature(card);
        const geometry = lockedGeometry[index]
          || lockedGeometry.find(item => item.signature === signature)
          || lockedGeometry[0];
        const diagram = card.querySelector('.court-diagram');

        // Keep the original court diagram height across live re-renders.
        if (diagram && geometry && Number.isFinite(geometry.diagramHeight) && geometry.diagramHeight > 0) {
          diagram.style.setProperty('--court-layout-diagram-height', `${geometry.diagramHeight}px`);
        } else if (diagram) {
          diagram.style.removeProperty('--court-layout-diagram-height');
        }

        if (geometry && Number.isFinite(geometry.height) && geometry.height > 0) {
          // A score can be enabled or updated after the list has entered
          // horizontal mode. Measure the card at its natural content height
          // so the score row is not clipped by the saved card height. Cards
          // without a score keep their exact original height.
          if (card.querySelector('.court-visual-score')) {
            card.style.removeProperty('--court-layout-fixed-height');
            const contentHeight = card.getBoundingClientRect().height;
            const height = Math.max(geometry.height, contentHeight);
            card.style.setProperty('--court-layout-fixed-height', `${height}px`);
          } else {
            card.style.setProperty('--court-layout-fixed-height', `${geometry.height}px`);
          }
        } else {
          card.style.removeProperty('--court-layout-fixed-height');
        }
      });
    }

    function restoreTransitionStacking() {
      transitionStacking.forEach((previous, card) => {
        if (previous.value) {
          card.style.setProperty('z-index', previous.value, previous.priority);
        } else {
          card.style.removeProperty('z-index');
        }
      });
      transitionStacking.clear();
    }

    function applyTransitionStacking(cards) {
      restoreTransitionStacking();
      // During grid-to-row FLIP, later cards travel from below the first card
      // to its right. Keep the first card above them so they slide out from
      // behind it instead of briefly covering it and appearing on the left.
      cards.forEach((card, index) => {
        transitionStacking.set(card, {
          value: card.style.getPropertyValue('z-index'),
          priority: card.style.getPropertyPriority('z-index')
        });
        card.style.setProperty('z-index', String(cards.length - index), 'important');
      });
    }

    function cancelAnimations() {
      animations.forEach(animation => {
        try { animation.cancel(); } catch (error) {}
      });
      animations = [];
      restoreTransitionStacking();
      list.classList.remove('is-court-layout-transitioning');
    }

    function updateToggle() {
      const nextModeLabel = horizontalMode
        ? `Switch ${labelPrefix} to vertical layout`
        : `Switch ${labelPrefix} to horizontal scrolling`;
      toggle.setAttribute('aria-pressed', String(horizontalMode));
      toggle.setAttribute('aria-label', nextModeLabel);
      toggle.title = nextModeLabel;
    }

    // Browser scroll-snap (especially on iPad/iOS) can restore the last snap
    // point when a list is switched back to horizontal mode. Temporarily disable
    // snapping and force Court 1 to the leading edge over the next two frames.
    // The token prevents an older reset from overriding a newer layout change.
    function resetScrollToFirstCard() {
      const resetToken = ++scrollResetToken;
      list.classList.add('is-resetting-court-scroll');
      list.scrollLeft = 0;
      list.scrollTop = 0;
      if (typeof list.scrollTo === 'function') {
        try { list.scrollTo({ left: 0, top: 0, behavior: 'auto' }); } catch (error) {}
      }
      void list.offsetWidth;

      const requestFrame = typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : callback => window.setTimeout(callback, 16);
      requestFrame(() => {
        if (resetToken !== scrollResetToken) return;
        list.scrollLeft = 0;
        if (typeof list.scrollTo === 'function') {
          try { list.scrollTo({ left: 0, top: 0, behavior: 'auto' }); } catch (error) {}
        }
        void list.offsetWidth;
        requestFrame(() => {
          if (resetToken !== scrollResetToken) return;
          list.scrollLeft = 0;
          list.classList.remove('is-resetting-court-scroll');
        });
      });
    }

    async function setMode(horizontal, animate = true) {
      const token = ++transitionToken;
      const wasHorizontalMode = horizontalMode;
      const isMobile = Boolean(courtLayoutMediaQuery.matches);
      horizontalMode = isMobile && Boolean(horizontal);
      updateToggle();
      cancelAnimations();

      // Both controls are phone-only. Always restore the normal grid outside
      // the mobile breakpoint, without carrying horizontal state to desktop.
      if (!isMobile) {
        list.classList.remove('is-horizontal-scroll');
        resetScrollToFirstCard();
        lockedGeometry = [];
        list.querySelectorAll('.court-card').forEach(card => {
          card.style.removeProperty('--court-layout-fixed-height');
          card.style.removeProperty('--court-layout-diagram-height');
        });
        return;
      }

      const reduceMotion = Boolean(courtLayoutReducedMotion && courtLayoutReducedMotion.matches);
      const cards = Array.from(list.querySelectorAll('.court-card'));
      const beforeRects = new Map(cards.map(card => [card, card.getBoundingClientRect()]));
      const beforeHeight = list.getBoundingClientRect().height;

      // Mobile horizontal mode narrows the card only to reveal the next court
      // on the right. Preserve the default outer card height and the court
      // diagram height so the bottom labels do not jump upward or look smaller.
      if (horizontalMode) {
        lockedGeometry = cards.map((card, index) => {
          const rect = beforeRects.get(card) || card.getBoundingClientRect();
          const diagram = card.querySelector('.court-diagram');
          return {
            index,
            signature: geometrySignature(card),
            height: rect.height,
            diagramHeight: diagram ? diagram.getBoundingClientRect().height : null
          };
        });
        applyLockedGeometry();
      } else {
        lockedGeometry = [];
        cards.forEach(card => {
          card.style.removeProperty('--court-layout-fixed-height');
          card.style.removeProperty('--court-layout-diagram-height');
        });
      }

      const canAnimate = animate && !reduceMotion && cards.length > 0
        && typeof list.animate === 'function'
        && cards.every(card => typeof card.animate === 'function');

      if (!canAnimate) {
        list.classList.toggle('is-horizontal-scroll', horizontalMode);
        // Reset on every layout exit and whenever horizontal mode is entered;
        // both regular and waiting-court lists use this same controller.
        if (!horizontalMode || !wasHorizontalMode) resetScrollToFirstCard();
        applyLockedGeometry();
        return;
      }

      // FLIP transition: animate card positions only. The card's previous
      // height is retained in horizontal mode, preventing the layout from
      // making court cards look shorter while showing the next card on the right.
      list.classList.toggle('is-horizontal-scroll', horizontalMode);
      // Reset only when changing layout, not during live re-renders while the
      // user is swiping through courts. Prevent native snap restoration on exit.
      if (!horizontalMode || !wasHorizontalMode) resetScrollToFirstCard();
      applyLockedGeometry();
      list.classList.add('is-court-layout-transitioning');

      const afterHeight = list.getBoundingClientRect().height;
      const nextAnimations = [];

      if (Math.abs(beforeHeight - afterHeight) > 1) {
        nextAnimations.push(list.animate([
          { height: `${beforeHeight}px` },
          { height: `${afterHeight}px` }
        ], {
          duration: 380,
          easing: 'cubic-bezier(.22, .72, .25, 1)',
          fill: 'both'
        }));
      }

      const currentCards = Array.from(list.querySelectorAll('.court-card'));
      if (horizontalMode) applyTransitionStacking(currentCards);
      currentCards.forEach(card => {
        const before = beforeRects.get(card);
        if (!before) return;
        const after = card.getBoundingClientRect();
        const deltaX = before.left - after.left;
        const deltaY = before.top - after.top;
        if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;

        nextAnimations.push(card.animate([
          { transform: `translate(${deltaX}px, ${deltaY}px)` },
          { transform: 'translate(0px, 0px)' }
        ], {
          duration: 380,
          easing: 'cubic-bezier(.22, .72, .25, 1)',
          fill: 'both'
        }));
      });

      if (!nextAnimations.length) {
        restoreTransitionStacking();
        list.classList.remove('is-court-layout-transitioning');
        if (!horizontalMode || !wasHorizontalMode) resetScrollToFirstCard();
        return;
      }

      animations = nextAnimations;
      await Promise.all(nextAnimations.map(animation => animation.finished.catch(() => null)));
      if (token !== transitionToken) return;

      // Remove the finished WAAPI effects so their final zero-translation
      // state returns to the card's normal CSS state without a visual jump.
      nextAnimations.forEach(animation => {
        try { animation.cancel(); } catch (error) {}
      });
      animations = [];
      restoreTransitionStacking();
      list.classList.remove('is-court-layout-transitioning');
      // Do the final reset only for the latest completed toggle. Resetting after
      // the FLIP animation is important on mobile Safari/iPad where scroll snap
      // can otherwise move back to a previously viewed card.
      if (!horizontalMode || !wasHorizontalMode) resetScrollToFirstCard();
    }

    function refreshLockedGeometryFromCurrentCards() {
      if (!horizontalMode || !courtLayoutMediaQuery.matches) return;

      // render() replaces every court card when new live state arrives. If a
      // court changes from empty to assigned (or gets cleared), its new diagram
      // must be measured from the current content instead of reusing the old
      // empty/filled card's height. Measure in the normal full-width grid, then
      // restore horizontal mode synchronously before the browser paints.
      const wasHorizontal = list.classList.contains('is-horizontal-scroll');
      const previousScrollLeft = list.scrollLeft;
      const cards = Array.from(list.querySelectorAll(':scope > .court-card'));

      cards.forEach(card => {
        card.style.removeProperty('--court-layout-fixed-height');
        card.style.removeProperty('--court-layout-diagram-height');
      });
      if (wasHorizontal) list.classList.remove('is-horizontal-scroll');

      // Force current, natural vertical geometry for the newly-rendered cards.
      lockedGeometry = cards.map((card, index) => {
        const rect = card.getBoundingClientRect();
        const diagram = card.querySelector('.court-diagram');
        const diagramHeight = diagram ? diagram.getBoundingClientRect().height : null;
        return {
          index,
          signature: geometrySignature(card),
          height: rect.height,
          diagramHeight: Number.isFinite(diagramHeight) && diagramHeight > 0 ? diagramHeight : null
        };
      });

      if (wasHorizontal) {
        list.classList.add('is-horizontal-scroll');
        list.scrollLeft = previousScrollLeft;
        applyLockedGeometry();
      }
    }

    function syncCardCount() {
      const cardCount = list.querySelectorAll(':scope > .court-card').length;
      toggle.hidden = cardCount <= 1;

      // Cards are re-rendered from live state. Invalidate any animation tied to
      // detached card nodes, then remeasure current content so showing/canceling
      // a diagram works immediately in either layout without a second toggle.
      if (horizontalMode && courtLayoutMediaQuery.matches) {
        if (animations.length || list.classList.contains('is-court-layout-transitioning')) {
          transitionToken += 1;
          cancelAnimations();
        }
        list.classList.add('is-horizontal-scroll');
        refreshLockedGeometryFromCurrentCards();
      }

      // If live updates leave only one card, there is no layout choice to make.
      // Return that list to the default grid and hide its toggle.
      if (cardCount <= 1 && horizontalMode) setMode(false, false);
    }

    function resetForViewport() {
      // Entering or leaving the phone breakpoint starts from the stable grid.
      setMode(false, false);
    }

    updateToggle();
    setMode(false, false);
    toggle.addEventListener('click', () => {
      if (!courtLayoutMediaQuery.matches) return;
      setMode(!horizontalMode);
    });
    return { resetForViewport, syncCardCount };
  }

  const courtLayoutController = createCourtLayoutController(
    $('courtLayoutToggle'), $('courtsList'), 'courts'
  );
  const waitingCourtLayoutController = createCourtLayoutController(
    $('waitingCourtLayoutToggle'), $('waitingCourtsList'), 'waiting courts'
  );
  function resetCourtLayoutsForViewport() {
    courtLayoutController?.resetForViewport();
    waitingCourtLayoutController?.resetForViewport();
  }
  if (typeof courtLayoutMediaQuery.addEventListener === 'function') {
    courtLayoutMediaQuery.addEventListener('change', resetCourtLayoutsForViewport);
  } else if (typeof courtLayoutMediaQuery.addListener === 'function') {
    courtLayoutMediaQuery.addListener(resetCourtLayoutsForViewport);
  }

  const queueCollapseToggle = $('queueCollapseToggle');
  const queueListViewport = $('queueListViewport');

  function setQueueCollapsed(collapsed, animate = true) {
    queueCollapsed = Boolean(collapsed);
    if (!queueCollapseToggle || !queueListViewport) return;

    const viewport = queueListViewport;
    const token = ++queueAnimationToken;

    queueCollapseToggle.textContent = queueCollapsed ? '+' : '−';
    queueCollapseToggle.setAttribute('aria-expanded', String(!queueCollapsed));
    queueCollapseToggle.setAttribute('aria-label', queueCollapsed ? 'Show waiting queue' : 'Hide waiting queue');
    queueCollapseToggle.title = queueCollapsed ? 'Show waiting queue' : 'Hide waiting queue';
    viewport.setAttribute('aria-hidden', String(queueCollapsed));
    if (queueCollapsed) viewport.setAttribute('inert', '');
    else viewport.removeAttribute('inert');

    // Read the currently rendered values before cancelling a previous transition.
    // This lets a quick second tap reverse the animation from its current position.
    const wasHidden = viewport.hidden;
    const currentHeight = wasHidden ? 0 : viewport.getBoundingClientRect().height;
    const currentOpacity = wasHidden
      ? 0
      : (Number.parseFloat(window.getComputedStyle(viewport).opacity) || 0);

    if (queueAnimationTimer !== null) {
      clearTimeout(queueAnimationTimer);
      queueAnimationTimer = null;
    }
    if (queueTransitionHandler) {
      viewport.removeEventListener('transitionend', queueTransitionHandler);
      queueTransitionHandler = null;
    }

    const finishTransition = () => {
      if (token !== queueAnimationToken) return;
      if (queueAnimationTimer !== null) {
        clearTimeout(queueAnimationTimer);
        queueAnimationTimer = null;
      }
      if (queueTransitionHandler) {
        viewport.removeEventListener('transitionend', queueTransitionHandler);
        queueTransitionHandler = null;
      }

      viewport.hidden = queueCollapsed;
      viewport.style.height = queueCollapsed ? '0px' : 'auto';
      viewport.style.opacity = queueCollapsed ? '0' : '1';
      viewport.style.overflow = 'hidden';
    };

    // Immediate, deterministic state for initialization and reduced-motion users.
    const reduceMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate || reduceMotion) {
      finishTransition();
      return;
    }

    // Keep the element measurable while animating; apply `hidden` only after
    // collapsing has finished so it can be expanded again reliably.
    viewport.hidden = false;
    const startHeight = Number.isFinite(currentHeight) ? Math.max(0, currentHeight) : 0;
    const naturalHeight = viewport.scrollHeight;
    viewport.style.overflow = 'hidden';
    viewport.style.height = `${startHeight}px`;
    viewport.style.opacity = String(Math.max(0, Math.min(1, currentOpacity)));
    void viewport.offsetHeight;

    queueTransitionHandler = event => {
      if (event.target === viewport && event.propertyName === 'height') finishTransition();
    };
    viewport.addEventListener('transitionend', queueTransitionHandler);

    requestAnimationFrame(() => {
      if (token !== queueAnimationToken) return;
      viewport.style.height = queueCollapsed ? '0px' : `${naturalHeight}px`;
      viewport.style.opacity = queueCollapsed ? '0' : '1';
    });

    // Fallback for browsers that skip transitionend or when a resize interrupts it.
    queueAnimationTimer = setTimeout(finishTransition, 500);
  }

  if (queueCollapseToggle && queueListViewport) {
    queueCollapseToggle.addEventListener('click', () => setQueueCollapsed(!queueCollapsed));
    // Normalize the initial button label, accessibility attributes, and viewport state.
    setQueueCollapsed(false, false);
  }

  const sessionTitleToggle = $('sessionTitleToggle');
  const sessionTitleSlide = $('sessionTitleSlide');
  if (sessionTitleToggle && sessionTitleSlide) {
    sessionTitleToggle.addEventListener('click', () => {
      const collapsed = sessionTitleSlide.classList.toggle('is-collapsed');
      sessionTitleToggle.setAttribute('aria-expanded', String(!collapsed));
      sessionTitleToggle.setAttribute('aria-label', collapsed ? 'Show session title' : 'Hide session title');
      sessionTitleToggle.title = collapsed ? 'Show session title' : 'Hide session title';
    });
  }

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
