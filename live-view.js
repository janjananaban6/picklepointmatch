(() => {
  'use strict';
  const LIVE_VIEW_STORAGE_KEY = `picklepoint_live_view_state_v1${new URLSearchParams(window.location.search).get('organizer') ? '_' + String(new URLSearchParams(window.location.search).get('organizer')).replace(/[^a-zA-Z0-9_-]/g,'') : ''}`;
  const organizerScope = String(new URLSearchParams(window.location.search).get('organizer') || '').trim();
  // Resolve the public organizer scope from the first successful snapshot when
  // the page is opened without an explicit organizer query parameter.
  let resolvedOrganizerId = organizerScope;
  const LIVE_CHANNEL_NAME = `pickle-point-match-live-view${organizerScope ? '-' + organizerScope.replace(/[^a-zA-Z0-9_-]/g,'') : ''}`;
  function scopedApiUrl(path, params = {}) { const url = new URL(path, window.location.origin); const scope = resolvedOrganizerId || organizerScope; if (scope) url.searchParams.set('organizer',scope); Object.entries(params).forEach(([key,value])=>url.searchParams.set(key,String(value))); return url.pathname+url.search; }
  const THEME_STORAGE_KEY = 'picklepoint_live_view_theme_v1';
  const $ = id => document.getElementById(id);
  let currentState = null;
  let currentStateSignature = null;
  let acceptedStateSequence = 0;
  let renderedRankingSignature = null;
  let renderedMatchesSignature = null;
  let renderedRegularCourtsSignature = null;
  let renderedWaitingCourtsSignature = null;
  let renderedQueueSignature = null;
  let liveRankingCategoryFilter = 'ALL';
  let liveRankingScopeFilter = 'EVERYONE';
  // Keep manual court expansions stable while fresh live snapshots rebuild cards.
  const expandedCourtKeys = new Set();
  const knownCourtCollapseKeys = new Set();
  // Next Up courts have their own collapse state so their default can remain
  // compact without changing the default-expanded state of regular courts.
  const expandedWaitingCourtKeys = new Set();
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
  const normalizeLiveAvatarId = value => {
    const raw = String(value ?? '').trim().toLowerCase();
    const match = /^(?:avatar[-_ ]?)?0?(\d{1,2})$/.exec(raw);
    if (!match) return '';
    const number = Number(match[1]);
    return Number.isInteger(number) && number >= 1 && number <= 21 ? `avatar-${String(number).padStart(2, '0')}` : '';
  };
  const MALE_FALLBACK_AVATAR_NUMBERS = [1, 3, 7, 12, 13, 16, 17, 18, 21];
  const FEMALE_FALLBACK_AVATAR_NUMBERS = [2, 4, 5, 6, 8, 9, 10, 11, 14, 15, 19, 20];
  const fallbackLiveAvatarId = p => {
    const name = String(p?.name ?? '').normalize('NFC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
    const gender = String(p?.gender ?? '').trim().toLocaleLowerCase();
    const female = ['female', 'f', 'woman', 'women'].includes(gender);
    const male = ['male', 'm', 'man', 'men'].includes(gender);
    const pool = female ? FEMALE_FALLBACK_AVATAR_NUMBERS
      : male ? MALE_FALLBACK_AVATAR_NUMBERS
      : Array.from({length: 21}, (_, index) => index + 1);
    if (!name) return `avatar-${String(pool[0] || 1).padStart(2, '0')}`;
    let hash = 2166136261;
    for (const character of name) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return `avatar-${String(pool[hash % pool.length] || pool[0] || 1).padStart(2, '0')}`;
  };
  const playerAvatarMarkup = p => {
    // Prefer the exact saved registration choice; only profiles without a saved
    // choice use the stable, gender-matched fallback shared with queueing/server.
    const avatarId = normalizeLiveAvatarId(p?.avatarId ?? p?.avatarID ?? p?.avatar_id ?? p?.selectedAvatarId ?? p?.profileAvatarId) || fallbackLiveAvatarId(p);
    return `<img class="live-profile-avatar-image" src="registration-${avatarId}.png" alt="" aria-hidden="true" loading="eager" decoding="async" draggable="false">`;
  };
  // Do not let a stale/legacy SSE event erase an avatar already resolved by the
  // server's GET response. Match by player ID first, then by name + nickname.
  function preserveKnownAvatarIds(nextState, previousState) {
    if (!nextState || typeof nextState !== 'object' || !previousState || typeof previousState !== 'object') return nextState;
    const previousPlayers = [];
    const addPrevious = player => { if (player && typeof player === 'object') previousPlayers.push(player); };
    (Array.isArray(previousState.queue) ? previousState.queue : []).forEach(addPrevious);
    (Array.isArray(previousState.ranking) ? previousState.ranking : []).forEach(addPrevious);
    (Array.isArray(previousState.courts) ? previousState.courts : []).forEach(court => {
      (Array.isArray(court?.players) ? court.players : []).forEach(addPrevious);
      (Array.isArray(court?.team1) ? court.team1 : []).forEach(addPrevious);
      (Array.isArray(court?.team2) ? court.team2 : []).forEach(addPrevious);
    });
    const normalizeName = value => String(value ?? '').normalize('NFC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
    const findPreviousAvatar = player => {
      const playerNameKey = normalizeName(player?.name);
      const direct = previousPlayers.find(old => player?.id != null && old?.id != null && String(old.id) === String(player.id) && (!playerNameKey || !normalizeName(old?.name) || normalizeName(old?.name) === playerNameKey) && normalizeLiveAvatarId(old?.avatarId ?? old?.avatarID ?? old?.avatar_id));
      if (direct) return normalizeLiveAvatarId(direct.avatarId ?? direct.avatarID ?? direct.avatar_id);
      const name = normalizeName(player?.name);
      if (!name) return '';
      const nickname = normalizeName(player?.nickname);
      const named = previousPlayers.filter(old => normalizeName(old?.name) === name && normalizeLiveAvatarId(old?.avatarId ?? old?.avatarID ?? old?.avatar_id));
      const matchingNickname = nickname ? named.find(old => normalizeName(old?.nickname) === nickname) : null;
      if (matchingNickname) return normalizeLiveAvatarId(matchingNickname.avatarId ?? matchingNickname.avatarID ?? matchingNickname.avatar_id);
      return named.length === 1 ? normalizeLiveAvatarId(named[0].avatarId ?? named[0].avatarID ?? named[0].avatar_id) : '';
    };
    const mergePlayer = player => {
      if (!player || typeof player !== 'object' || normalizeLiveAvatarId(player.avatarId ?? player.avatarID ?? player.avatar_id)) return player;
      const avatarId = findPreviousAvatar(player);
      return avatarId ? { ...player, avatarId } : player;
    };
    return {
      ...nextState,
      queue: Array.isArray(nextState.queue) ? nextState.queue.map(mergePlayer) : nextState.queue,
      courts: Array.isArray(nextState.courts) ? nextState.courts.map(court => ({
        ...court,
        players: Array.isArray(court?.players) ? court.players.map(mergePlayer) : court?.players,
        team1: Array.isArray(court?.team1) ? court.team1.map(mergePlayer) : court?.team1,
        team2: Array.isArray(court?.team2) ? court.team2.map(mergePlayer) : court?.team2
      })) : nextState.courts,
      ranking: Array.isArray(nextState.ranking) ? nextState.ranking.map(mergePlayer) : nextState.ranking
    };
  }
  const normalizedPlayerGender = p => String(p?.gender ?? '').trim().toLowerCase();
  const playerGenderClass = p => ['female', 'f', 'woman', 'women'].includes(normalizedPlayerGender(p)) ? 'female' : 'male';
  // Use inline SVG instead of platform-dependent Unicode glyphs so gender icons
  // stay consistently sized and aligned across Windows, Android, iOS and browsers.
  const playerGenderIcon = p => playerGenderClass(p) === 'female'
    ? '<svg class="gender-symbol" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="4.8" r="3.55" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 8.4v5.9M5.25 11.35h5.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
    : '<svg class="gender-symbol" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="5.35" cy="10.65" r="3.45" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7.8 8.2 14.1 1.9M9.35 1.9h4.75v4.75" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const playerCategory = p => String(p?.category || 'CAT').trim().toUpperCase();
  const playerCategoryClass = p => ({ BEG: 'skill-beg', NOV: 'skill-nov', INT: 'skill-int', ADV: 'skill-adv', EXP: 'skill-exp' })[playerCategory(p)] || '';
  const timestampMilliseconds = value => {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : NaN;
    const text = String(value ?? '').trim();
    if (!text) return NaN;
    // Numeric timestamps are already milliseconds in the published live state.
    if (/^\d+(?:\.\d+)?$/.test(text)) {
      const numeric = Number(text);
      return Number.isFinite(numeric) && numeric > 0 ? numeric : NaN;
    }
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : NaN;
  };
  const elapsedSeconds = start => {
    const startMs = timestampMilliseconds(start);
    return Number.isFinite(startMs) ? Math.max(0, Math.floor((Date.now() - startMs) / 1000)) : 0;
  };
  const elapsed = start => {
    const totalSeconds = elapsedSeconds(start);
    return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
  };
  const waitingDuration = start => {
    const startMs = timestampMilliseconds(start);
    if (!Number.isFinite(startMs)) return '0m waiting';
    const totalSeconds = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
    if (totalSeconds < 60) return '0m waiting';
    const minutes = Math.floor(totalSeconds / 60);
    if (minutes < 60) return `${minutes}m waiting`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m waiting`;
  };
  const waitingTimeClass = start => {
    const startMs = timestampMilliseconds(start);
    const totalSeconds = Number.isFinite(startMs) ? Math.max(0, Math.floor((Date.now() - startMs) / 1000)) : 0;
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

  function setTextIfChanged(element, value) {
    if (element && element.textContent !== String(value)) element.textContent = String(value);
  }

  // Keep the Live page session title readable on every device. Normal-length
  // titles keep the existing CSS size; only shrink titles that would occupy
  // more than two lines, with a readable minimum size for phones and desktops.
  function fitSessionTitle() {
    const title = $('sessionTitle');
    const slide = $('sessionTitleSlide');
    if (!title || !slide || slide.classList.contains('is-collapsed')) return;
    if (!title.textContent.trim() || title.clientWidth <= 0) return;

    // Clear the previous fit before measuring the current responsive base size.
    title.style.removeProperty('font-size');
    const computedBase = parseFloat(getComputedStyle(title).fontSize);
    if (!Number.isFinite(computedBase) || computedBase <= 0) return;

    const isPhoneWidth = window.matchMedia('(max-width: 560px)').matches;
    const minimumSize = Math.min(computedBase, isPhoneWidth ? 16 : 18);
    let size = computedBase;
    title.style.fontSize = `${size}px`;

    const fitsTwoLines = () => {
      const style = getComputedStyle(title);
      const lineHeight = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) * 1.13);
      return title.scrollHeight <= (lineHeight * 2) + 2;
    };

    // Re-measure after each 1px adjustment. At the minimum, allow natural
    // wrapping rather than clipping unusually long titles.
    while (size > minimumSize && !fitsTwoLines()) {
      size = Math.max(minimumSize, size - 1);
      title.style.fontSize = `${size}px`;
    }

    // Leave the stylesheet in charge whenever shrinking was not necessary.
    if (size >= computedBase) title.style.removeProperty('font-size');
  }

  function replaceListContent(list, markup, preserveScroll = true) {
    if (!list) return;
    const scrollTop = preserveScroll ? list.scrollTop : 0;
    list.innerHTML = markup;
    list.scrollTop = scrollTop;
  }

  function stateContentSignature(state) {
    if (!state || typeof state !== 'object') return '';
    const comparable = { ...state };
    // Publisher heartbeats update only this timestamp. Do not rebuild the page
    // for heartbeat-only updates; full DOM replacement caused mobile scroll jumps.
    delete comparable.updatedAt;
    try { return JSON.stringify(comparable); } catch (error) { return ''; }
  }

  function courtCollapseKey(court) {
    const stableId = court?.id ?? court?.courtId ?? court?.number ?? court?.name ?? 'court';
    return `${court?.waitingOnly ? 'waiting-court' : 'court'}:${String(stableId).trim()}`;
  }

  function renderCourtCard(c) {
    // Mirror the Queueing page: regular courts are READY until playing;
    // waiting-court slots are labeled Up Next.
    const status = c.waitingOnly ? 'UP NEXT' : (c.playing ? 'PLAYING' : 'READY');
    const statusClass = c.waitingOnly ? 'is-up-next' : (c.playing ? 'is-playing' : 'is-ready');
    const rawT1 = Array.isArray(c.team1) ? c.team1 : [];
    const rawT2 = Array.isArray(c.team2) ? c.team2 : [];
    const singlesMode = String(c.type || currentState?.eventRules?.type || 'Doubles').trim().toLowerCase() === 'singles';
    // Older cached snapshots may place both Singles players in team1. Normalize
    // them here as a fallback until the next correctly-shaped live snapshot arrives.
    const t1 = singlesMode ? [rawT1[0] || rawT1[1] || null] : rawT1;
    const t2 = singlesMode ? [rawT2[0] || rawT2[1] || rawT1[1] || null] : rawT2;
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
      return `<span class="court-player-marker ${slotClass}${player ? '' : ' is-empty'}" title="${escapeHTML(accessibleName)}" aria-label="${escapeHTML(accessibleName)}"><span class="court-player-initial">${player ? playerAvatarMarkup(player) : '+'}</span>${categoryBadge}${genderBadge}</span>`;
    };
    // Both regular and Next Up cards use their actual court number when available.
    const courtNumber = Number(c.number);
    const courtName = Number.isFinite(courtNumber) && courtNumber > 0 ? `Court ${courtNumber}` : 'Court #';
    const timer = c.playing
      ? `<span class="court-mini-timer ${timerClass(c.start)}" data-start="${escapeHTML(c.start || '')}" title="Match duration">${elapsed(c.start)}</span>`
      : '';
    const score = c.playing && currentState?.recordScores === true
      ? `<div class="court-visual-score" aria-label="Score ${Number(c.scores?.[0]) || 0} to ${Number(c.scores?.[1]) || 0}"><b>${Number(c.scores?.[0]) || 0}</b><span>–</span><b>${Number(c.scores?.[1]) || 0}</b></div>`
      : '';
    const diagramLabel = `${courtName}: ${teamLabel(t1)} versus ${teamLabel(t2)}`;
    const singlesMarkers = singlesMode
      ? `${marker(t1[0], 'marker-single-left')}${marker(t2[0], 'marker-single-right')}`
      : `${marker(t1[0], 'marker-top-left')}${marker(t1[1], 'marker-bottom-left')}${marker(t2[0], 'marker-top-right')}${marker(t2[1], 'marker-bottom-right')}`;
    const diagramContent = hasPlayers
      ? `<div class="court-diagram pickleball-court${singlesMode ? ' is-singles' : ''}" role="img" aria-label="Pickleball court — ${escapeHTML(diagramLabel)}">
          <span class="pickleball-kitchen pickleball-kitchen-left" aria-hidden="true"></span>
          <span class="pickleball-kitchen pickleball-kitchen-right" aria-hidden="true"></span>
          <span class="pickleball-court-line pickleball-kitchen-line pickleball-kitchen-line-left" aria-hidden="true"></span>
          <span class="pickleball-court-line pickleball-kitchen-line pickleball-kitchen-line-right" aria-hidden="true"></span>
          <span class="pickleball-court-line pickleball-service-line pickleball-service-line-left" aria-hidden="true"></span>
          <span class="pickleball-court-line pickleball-service-line pickleball-service-line-right" aria-hidden="true"></span>
          <span class="pickleball-net" aria-hidden="true"></span>
          ${singlesMarkers}
        </div>`
      : '<div class="court-diagram-empty-message" role="status">No players assigned yet</div>';
    const teamFooter = `<div class="court-team-footer">
      <span class="court-team-label court-team-left">${escapeHTML(teamLabel(t1))}</span>
      <span class="court-team-versus">VS</span>
      <span class="court-team-label court-team-right">${escapeHTML(teamLabel(t2))}</span>
    </div>`;

    // Regular courts and Next Up courts share the same compact row and
    // per-card expand/collapse behavior. Next Up has a separate state set and
    // starts collapsed by default, matching the supplied reference image.
    const collapseKey = courtCollapseKey(c);
    const isWaitingCourt = Boolean(c.waitingOnly);
    const isExpanded = (isWaitingCourt ? expandedWaitingCourtKeys : expandedCourtKeys).has(collapseKey);
    const summaryStatus = c.playing ? 'In progress' : 'Ready';
    const summaryStatusClass = c.playing ? 'is-playing' : 'is-ready';
    const compactTeam = hasPlayers
      ? `${t1.filter(Boolean).map(shortPlayerName).join(' & ') || 'Open'} vs ${t2.filter(Boolean).map(shortPlayerName).join(' & ') || 'Open'}`
      : 'No players assigned';
    const courtStatusValue = c.playing ? 'playing' : 'ready';
    const waitingCardClass = isWaitingCourt ? ' waiting-only' : '';
    const collapseDataAttribute = isWaitingCourt
      ? `data-waiting-court-collapse-key="${escapeHTML(collapseKey)}"`
      : `data-court-collapse-key="${escapeHTML(collapseKey)}"`;
    return `<article class="court-card court-visual-card${waitingCardClass}${c.playing ? ' playing' : ''}${hasPlayers ? '' : ' is-empty-court'} ${isExpanded ? 'is-expanded' : 'is-collapsed'}" data-court-status="${courtStatusValue}" ${collapseDataAttribute}>
      <button class="court-card-collapse-toggle" type="button" aria-controls="${escapeHTML(collapseKey)}-details" aria-expanded="${String(isExpanded)}" aria-label="${isExpanded ? 'Collapse' : 'Expand'} ${escapeHTML(courtName)}" title="${isExpanded ? 'Collapse' : 'Expand'} ${escapeHTML(courtName)}">
        <span class="court-card-summary-start" aria-hidden="${String(isExpanded)}">
          <i class="court-card-summary-dot ${summaryStatusClass}" aria-hidden="true"></i>
          <strong class="court-card-summary-name">${escapeHTML(courtName)}</strong>
          <span class="court-card-summary-status ${summaryStatusClass}">${summaryStatus}</span>
        </span>
        <span class="court-card-expanded-heading" aria-hidden="${String(!isExpanded)}">
          <strong class="court-visual-name">${escapeHTML(courtName)}</strong>${timer}
        </span>
        <span class="court-card-summary-match" aria-hidden="${String(isExpanded)}" title="${escapeHTML(compactTeam)}">${escapeHTML(compactTeam)}</span>
        <span class="court-card-expanded-status ${statusClass}" aria-hidden="${String(!isExpanded)}">${status}</span>
        <span class="court-card-summary-chevron" aria-hidden="true">›</span>
      </button>
      <div id="${escapeHTML(collapseKey)}-details" class="court-card-expanded-content"${isExpanded ? '' : ' hidden'}>
        ${diagramContent}
        ${teamFooter}
        ${score}
      </div>
    </article>`;
  }

  function renderLiveRanking(listId = 'pageRankingList', searchInputId = 'pageRankingSearch', preserveScroll = true) {
    const list = $(listId);
    if (!list) return;
    const ranking = Array.isArray(currentState?.ranking) ? currentState.ranking : [];
    if (!currentState?.active || currentState?.liveRankingEnabled === false) {
      replaceListContent(list, '<div class="live-ranking-empty"><span aria-hidden="true">🏆</span><strong>Rankings unavailable</strong><span>Live rankings are currently disabled for this momment.</span><span>Request on QM to enable the live ranking.</span></div>', preserveScroll);
      return;
    }
    if (!ranking.length) {
      replaceListContent(list, '<div class="live-ranking-empty"><span aria-hidden="true">🏆</span><strong>No ranking standings yet</strong><span>Complete a recorded match to start the live ranking.</span></div>', preserveScroll);
      return;
    }

    const searchTerm = String($(searchInputId)?.value || '').trim().toLocaleLowerCase();
    const filteredRanking = ranking
      .map((player, index) => ({ player, index, rank: Number(player.position) || index + 1 }))
      .filter(({ player }) => {
        const category = String(player.category || '').trim().toUpperCase();
        if (liveRankingCategoryFilter !== 'ALL' && category !== liveRankingCategoryFilter) return false;
        const isLockedIn = player.lockedIn === true;
        if (liveRankingScopeFilter === 'SOLO' && isLockedIn) return false;
        if (liveRankingScopeFilter === 'LOCK_IN' && !isLockedIn) return false;
        if (!searchTerm) return true;
        const name = String(player.name || 'Player');
        const nickname = String(player.nickname || '').trim();
        return [name, nickname, `${name} ${nickname}`]
          .some(value => value.toLocaleLowerCase().includes(searchTerm));
      });

    if (!filteredRanking.length) {
      replaceListContent(list, `<div class="live-ranking-empty"><span aria-hidden="true">🔎</span><strong>No players found</strong><span>No players match “${escapeHTML(String($(searchInputId)?.value || '').trim())}”. Try another name.</span></div>`, preserveScroll);
      return;
    }

    const medals = ['🥇', '🥈', '🥉'];
    replaceListContent(list, filteredRanking.map(({ player: p, rank }) => {
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
    }).join(''), preserveScroll);
  }

  function renderRecentMatches(preserveScroll = true) {
    const list = $('matchesList');
    if (!list) return;
    const matches = Array.isArray(currentState?.recentMatches) ? currentState.recentMatches : [];
    const count = $('matchesSectionCount');
    if (!currentState?.active || currentState?.liveMatchesEnabled === false) {
      setTextIfChanged(count, '(0)');
      replaceListContent(list, '<div class="live-ranking-empty"><span aria-hidden="true">🏓</span><strong>Matches unavailable</strong><span>Live matches are currently disabled for this momment.</span><span>Request on QM to enable the live matches.</span></div>', preserveScroll);
      return;
    }
    const rawSearchTerm = String($('pageMatchesSearch')?.value || '').trim();
    const searchTerm = rawSearchTerm.toLocaleLowerCase();
    // Match search is intentionally player-name-only; court, score, and match metadata
    // remain visible in results but do not affect which matches are filtered in.
    const filteredMatches = matches.filter(match => {
      if (!searchTerm) return true;
      return [match.winner, match.loser]
        .some(name => String(name || '').toLocaleLowerCase().includes(searchTerm));
    });

    // Keep the section count in sync with the same filtered results shown below.
    setTextIfChanged(count, `(${filteredMatches.length})`);

    if (!matches.length) {
      replaceListContent(list, '<div class="live-ranking-empty"><span aria-hidden="true">🏓</span><strong>No recorded matches yet</strong><span>Finished matches will appear here after they are recorded.</span></div>', preserveScroll);
      return;
    }

    if (!filteredMatches.length) {
      replaceListContent(list, `<div class="live-ranking-empty"><span aria-hidden="true">🔎</span><strong>No matches found</strong><span>No player names match “${escapeHTML(rawSearchTerm)}”. Try another name.</span></div>`, preserveScroll);
      return;
    }

    replaceListContent(list, filteredMatches.map(match => {
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
        <div class="live-match-topline"><strong>${escapeHTML(court)}</strong><span>${escapeHTML(matchMeta)}</span></div>
        <div class="live-match-result"><div class="live-match-winner"><span class="live-match-outcome">WINNER</span><strong>${highlightSearchMatch(winner, rawSearchTerm)}</strong></div><span class="live-match-vs">VS</span><div class="live-match-loser"><span class="live-match-outcome">OPPONENT</span><strong>${highlightSearchMatch(loser, rawSearchTerm)}</strong></div></div>
        ${score ? `<div class="live-match-score">${escapeHTML(score)}</div>` : ''}
      </article>`;
    }).join(''), preserveScroll);
  }

  function setLiveTab(tabName) {
    const allowed = ['queue', 'rankings', 'matches'];
    const selected = allowed.includes(tabName) ? tabName : 'queue';
    document.querySelectorAll('[data-live-tab]').forEach(button => {
      const isSelected = button.dataset.liveTab === selected;
      button.classList.toggle('is-active', isSelected);
      button.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      // Keep the compact phone shortcuts reachable by keyboard even when the
      // queue (which has no shortcut icon) is the selected panel.
      button.tabIndex = button.classList.contains('mobile-header-icon-button') ? 0 : (isSelected ? 0 : -1);
    });
    document.querySelectorAll('[data-live-panel]').forEach(panel => {
      panel.hidden = panel.dataset.livePanel !== selected;
    });
    if (selected === 'rankings') renderLiveRanking('pageRankingList', 'pageRankingSearch');
    if (selected === 'matches') renderRecentMatches();
  }

  function renderQueueList(queue) {
    const list = $('queueList');
    if (!list) return;

    const players = Array.isArray(queue) ? queue : [];
    const rawSearchTerm = String($('queueListSearch')?.value || '').trim();
    const searchTerm = rawSearchTerm.toLocaleLowerCase();
    const filteredPlayers = players
      .map((player, index) => ({ player, index }))
      .filter(({ player }) => {
        if (!searchTerm) return true;
        const searchableValues = [player?.name, player?.nickname, playerName(player), player?.lockedPartnerName];
        return searchableValues.some(value => String(value || '').toLocaleLowerCase().includes(searchTerm));
      });

    if (!filteredPlayers.length) {
      list.innerHTML = players.length && searchTerm
        ? `<div class="empty-state queue-search-empty">No players match “${escapeHTML(rawSearchTerm)}”.</div>`
        : '<div class="empty-state">No players are waiting in queue.</div>';
      return;
    }

    list.innerHTML = filteredPlayers.map(({ player: p, index }) => {
      const waitingSince = p.waitingSince || p.queuedAt || null;
      const genderClass = playerGenderClass(p);
      const genderLabel = genderClass === 'female' ? 'Female' : 'Male';
      const lockedPartnerName = String(p.lockedPartnerName || '').trim();
      const lockedPartnerIndicator = lockedPartnerName
        ? `<span class="queue-locked-partner-inline" title="Locked in with ${escapeHTML(lockedPartnerName)}" aria-label="Locked in with partner ${escapeHTML(lockedPartnerName)}" role="img">🔒${escapeHTML(lockedPartnerName)}</span>`
        : '';
      const displayedName = highlightSearchMatch(playerName(p), rawSearchTerm);
      return `<div class="queue-item"><div class="queue-avatar-stack" aria-label="${genderLabel} player, queue position ${index + 1}"><div class="queue-avatar ${genderClass}" aria-hidden="true">${playerAvatarMarkup(p)}</div><span class="queue-position-badge" aria-label="Queue position ${index + 1}">${index + 1}</span></div><div class="queue-player-wrap"><div class="queue-player-line"><div class="queue-player">${displayedName}</div><span class="live-player-gender ${genderClass}" title="${genderLabel}" aria-label="${genderLabel}">${playerGenderIcon(p)}</span><span class="live-player-category ${playerCategoryClass(p)}" title="Skill category">${escapeHTML(playerCategory(p))}</span>${lockedPartnerIndicator}</div></div><span class="queue-waiting-time ${waitingTimeClass(waitingSince)}" data-waiting-since="${escapeHTML(waitingSince || '')}" title="Player waiting time">${waitingDuration(waitingSince)}</span></div>`;
    }).join('');
  }


  function render() {
    const s = currentState;
    // Preserve the user's visible court on both horizontal lists while live data
    // replaces card DOM nodes. An innerHTML rebuild can reset scrollLeft on iOS,
    // Safari, and some Chromium layouts even when the court count is unchanged.
    const changedCourtLists = new Set();
    const courtScrollSnapshots = ['courtsList', 'waitingCourtsList'].map(id => {
      const list = $(id);
      return list ? {
        list,
        left: list.scrollLeft,
        top: list.scrollTop,
        horizontal: list.classList.contains('is-horizontal-scroll')
      } : null;
    });
    const active = !!s?.active;
    const rankingSignature = JSON.stringify([active, s?.liveRankingEnabled, Array.isArray(s?.ranking) ? s.ranking : []]);
    if (rankingSignature !== renderedRankingSignature) {
      renderLiveRanking('pageRankingList', 'pageRankingSearch');
      renderedRankingSignature = rankingSignature;
    }
    const matchesSignature = JSON.stringify([active, s?.liveMatchesEnabled, Array.isArray(s?.recentMatches) ? s.recentMatches : []]);
    if (matchesSignature !== renderedMatchesSignature) {
      renderRecentMatches();
      renderedMatchesSignature = matchesSignature;
    }
    // Never show a stale dated session title when there is no active session.
    const sessionTitleElement = $('sessionTitle');
    const nextSessionTitle = active ? (s?.sessionName || 'Open Play') : 'Open Play';
    const sessionTitleChanged = !!sessionTitleElement && sessionTitleElement.textContent !== String(nextSessionTitle);
    setTextIfChanged(sessionTitleElement, nextSessionTitle);
    if (sessionTitleChanged) requestAnimationFrame(fitSessionTitle);

    // Keep the session title clean by removing any stored DUPR mode prefix.
    const rawMobileSessionTitle = String(nextSessionTitle || 'Open Play').trim();
    const mobileSessionTitle = rawMobileSessionTitle
      .replace(/^\s*\(\s*(?:NON[\s-]+)?DUPR\s+MATCH\s*\)\s*/i, '')
      .trim() || 'Open Play';
    setTextIfChanged($('mobileSessionTitle'), mobileSessionTitle);
    const mobileLiveStatus = $('mobileLiveStatus');
    if (mobileLiveStatus) {
      mobileLiveStatus.classList.toggle('is-live', active);
      mobileLiveStatus.classList.toggle('is-offline', !active);
      const statusText = mobileLiveStatus.querySelector('span');
      setTextIfChanged(statusText, active ? 'LIVE' : 'OFF');
      mobileLiveStatus.setAttribute('aria-label', active ? 'Session live' : 'No active session');
    }

    const sessionMatchType = $('sessionMatchType');
    const nextMatchType = String(s?.eventRules?.type || 'Doubles');
    setTextIfChanged(sessionMatchType, nextMatchType);
    setTextIfChanged($('mobileSessionMatchType'), nextMatchType);
    const sessionPlayerCount = $('sessionPlayerCount');
    if (sessionPlayerCount) {
      // Count only players who are currently queued or assigned to a regular /
      // waiting court. The server's playerCount is the full roster and includes
      // players who have left, so it must not be used for this Live View label.
      const sessionPlayerIds = new Set();
      const addSessionPlayer = player => {
        if (!player) return;
        const key = player?.id != null ? String(player.id).trim() : String(player?.name || '').trim();
        if (key) sessionPlayerIds.add(key);
      };
      (Array.isArray(s?.queue) ? s.queue : []).forEach(addSessionPlayer);
      // s.courts includes both courts in play / ready and waiting-only courts.
      (Array.isArray(s?.courts) ? s.courts : []).forEach(court => {
        const courtPlayers = Array.isArray(court?.players)
          ? court.players
          : [...(Array.isArray(court?.team1) ? court.team1 : []), ...(Array.isArray(court?.team2) ? court.team2 : [])];
        courtPlayers.forEach(addSessionPlayer);
      });
      const playerCount = sessionPlayerIds.size;
      const playerCountLabel = `${playerCount} player${playerCount === 1 ? '' : 's'}`;
      setTextIfChanged(sessionPlayerCount, playerCountLabel);
      setTextIfChanged($('mobileSessionPlayerCount'), playerCountLabel);
    }
    $('inactiveNotice').hidden = active;
    const queue = Array.isArray(s?.queue) ? s.queue : [];
    setTextIfChanged($('queueSectionCount'), `${queue.length} WAITING`);

    const allCourts = Array.isArray(s?.courts) ? s.courts : [];
    const regularCourts = allCourts.filter(c => c && !c.waitingOnly);
    const waitingCourts = allCourts.filter(c => c && c.waitingOnly);
    const currentCourtCollapseKeys = new Set(regularCourts.map(courtCollapseKey));
    const currentWaitingCourtCollapseKeys = new Set(waitingCourts.map(courtCollapseKey));
    expandedCourtKeys.forEach(key => {
      if (!currentCourtCollapseKeys.has(key)) expandedCourtKeys.delete(key);
    });
    knownCourtCollapseKeys.forEach(key => {
      if (!currentCourtCollapseKeys.has(key)) knownCourtCollapseKeys.delete(key);
    });
    expandedWaitingCourtKeys.forEach(key => {
      if (!currentWaitingCourtCollapseKeys.has(key)) expandedWaitingCourtKeys.delete(key);
    });
    // Newly added waiting courts remain collapsed because their keys are not
    // added to expandedWaitingCourtKeys until the user opens them.
    // Every newly-created regular court starts expanded by default. Keep the
    // known-key set separate so a user's manual collapse remains unchanged
    // when the live snapshot rebuilds the card.
    currentCourtCollapseKeys.forEach(key => {
      if (!knownCourtCollapseKeys.has(key)) {
        expandedCourtKeys.add(key);
        knownCourtCollapseKeys.add(key);
      }
    });
    const sessionCourtCount = $('sessionCourtCount');
    if (sessionCourtCount) {
      const courtCount = regularCourts.length;
      setTextIfChanged(sessionCourtCount, `${courtCount} court${courtCount === 1 ? '' : 's'}`);
    }

    // Derive the heading count from the same court records used to render the
    // cards. The published activeCourtCount can be stale (for example, after
    // the server merges a registration update), so it must never override the
    // actual playing flags on the current court list.
    const liveCourtCount = regularCourts.filter(c => Boolean(c.playing)).length;
    setTextIfChanged($('courtSectionCount'), `(${liveCourtCount} live)`);

    // Only replace the lists whose actual data changed. Rebuilding every court
    // and queue card on unrelated updates was causing scroll jumps on phones.
    const regularCourtsSignature = JSON.stringify([s?.recordScores === true, regularCourts]);
    if (regularCourtsSignature !== renderedRegularCourtsSignature) {
      changedCourtLists.add('courtsList');
      $('courtsList').innerHTML = regularCourts.length
        ? regularCourts.map(court => renderCourtCard(court)).join('')
        : '<div class="empty-state">No courts have been set up in this session.</div>';
      renderedRegularCourtsSignature = regularCourtsSignature;
      courtLayoutController?.syncCardCount();
    }

    $('waitingCourtsSection').hidden = waitingCourts.length === 0;
    setTextIfChanged($('waitingCourtSectionCount'), `(${waitingCourts.length} Planned)`);
    const waitingCourtsSignature = JSON.stringify([s?.recordScores === true, waitingCourts]);
    if (waitingCourtsSignature !== renderedWaitingCourtsSignature) {
      changedCourtLists.add('waitingCourtsList');
      $('waitingCourtsList').innerHTML = waitingCourts.map(court => renderCourtCard(court)).join('');
      renderedWaitingCourtsSignature = waitingCourtsSignature;
      waitingCourtLayoutController?.syncCardCount();
    }

    syncCourtCollapseAllToggle();
    syncWaitingCourtsCollapseToggle();

    // Restore swipe position only after a court list has actually changed.
    courtScrollSnapshots.forEach(snapshot => {
      if (!snapshot || !changedCourtLists.has(snapshot.list.id) || !snapshot.horizontal || !snapshot.list.classList.contains('is-horizontal-scroll')) return;
      snapshot.list.scrollLeft = snapshot.left;
      snapshot.list.scrollTop = snapshot.top;
    });

    const queueSignature = JSON.stringify(queue);
    if (queueSignature !== renderedQueueSignature) {
      renderQueueList(queue);
      renderedQueueSignature = queueSignature;
    }

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

  function notifyLiveViewPageState(value = currentState) {
    try {
      window.dispatchEvent(new CustomEvent('ppm-live-view-state', {
        detail: {state: value && typeof value === 'object' ? value : null, organizerId: resolvedOrganizerId || organizerScope || ''}
      }));
    } catch (_) {}
  }

  function acceptState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    value = preserveKnownAvatarIds(value, currentState);
    const signature = stateContentSignature(value);
    const contentChanged = signature !== currentStateSignature;
    currentState = value;
    acceptedStateSequence += 1;
    notifyLiveViewPageState(value);
    if (contentChanged) {
      currentStateSignature = signature;
      try { localStorage.setItem(LIVE_VIEW_STORAGE_KEY, JSON.stringify(value)); } catch (error) {}
      render();
    }
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
    if (!isHttpPage()) return false;
    // Do not treat a second caller as a failed connection while the first read
    // is still waiting for a sleeping/slow host to wake up.
    if (remoteRefreshInFlight) return null;
    remoteRefreshInFlight = true;
    const stateSequenceAtStart = acceptedStateSequence;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(scopedApiUrl('/api/live-state',{_:Date.now()}), {
        cache: 'no-store',
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Live API returned ${response.status}`);
      const data = await response.json();
      const responseOrganizerId = String(data?.organizerId || '').trim();
      if (responseOrganizerId) resolvedOrganizerId = responseOrganizerId;
      const organizerName = String(data?.organizerName || '').trim();
      const organizerLogo = String(data?.organizerLogo || '').trim();
      const organizerStat = $('sessionOrganizerStat');
      const organizerNameLabel = $('sessionOrganizerName');
      const organizerLogoImage = $('sessionOrganizerLogo');
      setTextIfChanged(organizerNameLabel, organizerName);
      const mobileOrganizerName = $('mobileSessionOrganizer');
      const mobileOrganizerSeparator = $('mobileOrganizerMetaSeparator');
      setTextIfChanged(mobileOrganizerName, organizerName);
      if (mobileOrganizerName) mobileOrganizerName.hidden = !organizerName;
      if (mobileOrganizerSeparator) mobileOrganizerSeparator.hidden = !organizerName;
      if (organizerLogoImage) {
        // The server only returns validated organizer profile-logo data URLs.
        if (organizerLogo && organizerLogoImage.getAttribute('src') !== organizerLogo) {
          organizerLogoImage.src = organizerLogo;
        } else if (!organizerLogo) {
          organizerLogoImage.removeAttribute('src');
        }
        organizerLogoImage.hidden = !organizerLogo;
        organizerLogoImage.onerror = () => {
          organizerLogoImage.hidden = true;
          organizerLogoImage.removeAttribute('src');
        };
      }
      if (organizerStat) {
        organizerStat.hidden = !organizerName;
        organizerStat.title = organizerName;
        if (organizerName) organizerStat.setAttribute('aria-label', organizerName);
        else organizerStat.removeAttribute('aria-label');
      }
      // Do not let a slower HTTP response overwrite a newer SSE or storage update.
      if (stateSequenceAtStart === acceptedStateSequence) {
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
      }
      // Also emit after resolving the organizer even when a newer SSE packet won
      // the race against this HTTP response. The history panel needs the scope.
      notifyLiveViewPageState(currentState || data?.state || null);
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
      const source = new EventSource(scopedApiUrl('/api/live-events'));
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
    if (connected === true) startEventStream();
    else if (connected === false) scheduleReconnect();
  }

  try {
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel(LIVE_CHANNEL_NAME);
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
  // Court layout switching is available on every viewport. The toggle is
  // intentionally not tied to a phone-only media query, so desktop, iPad,
  // and mobile all use the same horizontal swipe/scroll behavior.
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

    // Regular courts hide their diagram while collapsed. Measure that diagram
    // in the current vertical/grid width by briefly revealing its details
    // wrapper synchronously, then restore the collapsed state before paint.
    // This gives horizontal mode the same diagram height as vertical mode.
    function measureCourtDiagramHeight(card) {
      const diagram = card.querySelector('.court-card-expanded-content > .court-diagram.pickleball-court');
      if (!diagram) return null;

      let height = diagram.getBoundingClientRect().height;
      if (height > 0) return height;

      const details = diagram.closest('.court-card-expanded-content');
      if (!details || !details.hidden) return null;

      details.hidden = false;
      height = diagram.getBoundingClientRect().height;
      details.hidden = true;
      return Number.isFinite(height) && height > 0 ? height : null;
    }

    function applyLockedGeometry() {
      if (!horizontalMode) return;
      const cards = Array.from(list.querySelectorAll(':scope > .court-card'));
      cards.forEach((card, index) => {
        const signature = geometrySignature(card);
        const geometry = lockedGeometry[index]
          || lockedGeometry.find(item => item.signature === signature)
          || lockedGeometry[0];
        const diagram = card.querySelector('.court-diagram');

        // Keep the regular-court pickleball diagram at its vertical-layout
        // height while the horizontal cards become narrower. Waiting courts
        // continue using their existing measured-height behavior.
        if (diagram && geometry && Number.isFinite(geometry.diagramHeight) && geometry.diagramHeight > 0) {
          diagram.style.setProperty('--court-layout-diagram-height', `${geometry.diagramHeight}px`);
        } else if (diagram) {
          diagram.style.removeProperty('--court-layout-diagram-height');
        }

        if (card.classList.contains('is-collapsed')) {
          // A collapsed court must return to its compact natural height even
          // while the list is in horizontal-scroll mode. Never carry the
          // expanded card's locked height into its collapsed state.
          card.style.removeProperty('--court-layout-fixed-height');
        } else if (geometry && Number.isFinite(geometry.height) && geometry.height > 0) {
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
      // This controller only resets the horizontal court position. Resetting
      // scrollTop here is unrelated to the layout toggle and can create a
      // visible vertical jump on mobile browsers.
      list.scrollLeft = 0;
      if (typeof list.scrollTo === 'function') {
        try { list.scrollTo({ left: 0, behavior: 'auto' }); } catch (error) {}
      }
      void list.offsetWidth;

      const requestFrame = typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : callback => window.setTimeout(callback, 16);
      requestFrame(() => {
        if (resetToken !== scrollResetToken) return;
        list.scrollLeft = 0;
        if (typeof list.scrollTo === 'function') {
          try { list.scrollTo({ left: 0, behavior: 'auto' }); } catch (error) {}
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
      const pageScroller = list.closest('.live-content-scroll');
      const pageScrollTop = pageScroller ? pageScroller.scrollTop : window.scrollY;
      horizontalMode = Boolean(horizontal);
      updateToggle();
      cancelAnimations();

      const reduceMotion = Boolean(courtLayoutReducedMotion && courtLayoutReducedMotion.matches);
      const isPhoneViewport = typeof window.matchMedia === 'function'
        ? window.matchMedia('(max-width: 560px)').matches
        : window.innerWidth <= 560;
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
          const hasExpandableDetails = Boolean(card.querySelector('.court-card-expanded-content'));
          const measuredDiagramHeight = hasExpandableDetails
            ? measureCourtDiagramHeight(card)
            : (diagram ? diagram.getBoundingClientRect().height : null);
          return {
            index,
            signature: geometrySignature(card),
            height: rect.height,
            diagramHeight: Number.isFinite(measuredDiagramHeight) && measuredDiagramHeight > 0
              ? measuredDiagramHeight
              : null
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

      // Keep phone layout toggles immediate. FLIP translates entire court cards
      // vertically while the list changes from grid to swipe lane, which makes
      // the name/timer header appear to jump even though its own geometry is fixed.
      // Preserve the existing animated transition on tablet/desktop.
      const canAnimate = animate && !reduceMotion && !isPhoneViewport && cards.length > 0
        && typeof list.animate === 'function'
        && cards.every(card => typeof card.animate === 'function');

      if (!canAnimate) {
        list.classList.toggle('is-horizontal-scroll', horizontalMode);
        // Reset on every layout exit and whenever horizontal mode is entered;
        // both regular and waiting-court lists use this same controller.
        if (!horizontalMode || !wasHorizontalMode) resetScrollToFirstCard();
        applyLockedGeometry();

        // The court strip can change the height of the page content when it
        // switches between grid and swipe mode. Keep the Live page's vertical
        // reading position fixed so the court name/timer do not jump up/down.
        if (isPhoneViewport && pageScroller) {
          const restorePageScroll = () => {
            if (token !== transitionToken) return;
            pageScroller.scrollTop = pageScrollTop;
          };
          const requestFrame = typeof window.requestAnimationFrame === 'function'
            ? window.requestAnimationFrame.bind(window)
            : callback => window.setTimeout(callback, 16);
          restorePageScroll();
          requestFrame(() => {
            restorePageScroll();
            requestFrame(restorePageScroll);
          });
        }
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
      if (!horizontalMode) return;

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
        const hasExpandableDetails = Boolean(card.querySelector('.court-card-expanded-content'));
        const diagramHeight = hasExpandableDetails
          ? measureCourtDiagramHeight(card)
          : (diagram ? diagram.getBoundingClientRect().height : null);
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

    function syncCardGeometry(card) {
      if (!horizontalMode || !card || !list.contains(card)) return;

      // Collapsed courts should use their compact natural height in swipe mode.
      // The previous fixed height belonged to the expanded diagram and must
      // not keep the card tall after its details are hidden.
      card.style.removeProperty('--court-layout-fixed-height');
      if (card.classList.contains('is-collapsed')) return;

      // Expanding one court must not temporarily switch the whole list back to
      // grid mode. That old full-list remeasure made neighboring cards appear
      // to jump or stretch when only one court changed height.
      const naturalHeight = card.getBoundingClientRect().height;
      if (Number.isFinite(naturalHeight) && naturalHeight > 0) {
        card.style.setProperty('--court-layout-fixed-height', `${Math.ceil(naturalHeight)}px`);
      }

      const diagram = card.querySelector('.court-diagram');
      if (diagram && !card.querySelector('.court-card-expanded-content')) {
        const diagramHeight = diagram.getBoundingClientRect().height;
        if (Number.isFinite(diagramHeight) && diagramHeight > 0) {
          diagram.style.setProperty('--court-layout-diagram-height', `${diagramHeight}px`);
        }
      }
    }

    function syncCardCount() {
      const cardCount = list.querySelectorAll(':scope > .court-card').length;
      // The layout switch only adds value once three or more courts are
      // present. With zero, one, or two courts keep the heading uncluttered.
      toggle.hidden = cardCount < 3;

      // Cards are re-rendered from live state. Invalidate any animation tied to
      // detached card nodes, then remeasure current content so showing/canceling
      // a diagram works immediately in either layout without a second toggle.
      if (horizontalMode) {
        if (animations.length || list.classList.contains('is-court-layout-transitioning')) {
          transitionToken += 1;
          cancelAnimations();
        }
        list.classList.add('is-horizontal-scroll');
        refreshLockedGeometryFromCurrentCards();
      }

      // If live updates leave fewer than three cards, there is no layout
      // choice to make. Return to the default grid and hide its toggle.
      if (cardCount < 3 && horizontalMode) setMode(false, false);
    }

    // Add desktop mouse click-and-drag scrolling to the same horizontal
    // court strip used by native touch scrolling on phones and iPads. Only
    // start from non-interactive card space so court buttons remain clickable.
    let mouseDragPointerId = null;
    let mouseDragStartX = 0;
    let mouseDragStartY = 0;
    let mouseDragStartScrollLeft = 0;
    let mouseDragActive = false;
    let mouseDragMoved = false;
    let suppressClickUntil = 0;

    const isCourtControlTarget = target => Boolean(target && target.closest && target.closest(
      'button, a, input, select, textarea, summary, [role="button"], [contenteditable="true"], [draggable="true"], [data-no-court-scroll-drag], .team-player, .court-slot, .slot-remove'
    ));

    list.addEventListener('pointerdown', event => {
      if (!horizontalMode || event.pointerType !== 'mouse' || event.button !== 0) return;
      if (isCourtControlTarget(event.target)) return;

      mouseDragPointerId = event.pointerId;
      mouseDragStartX = event.clientX;
      mouseDragStartY = event.clientY;
      mouseDragStartScrollLeft = list.scrollLeft;
      mouseDragActive = false;
      mouseDragMoved = false;
    });

    window.addEventListener('pointermove', event => {
      if (mouseDragPointerId === null || event.pointerId !== mouseDragPointerId) return;
      const deltaX = event.clientX - mouseDragStartX;
      const deltaY = event.clientY - mouseDragStartY;

      if (!mouseDragActive && Math.abs(deltaX) > 6 && Math.abs(deltaX) > Math.abs(deltaY)) {
        mouseDragActive = true;
        mouseDragMoved = true;
        list.classList.add('is-mouse-dragging');
      } else if (!mouseDragActive && Math.abs(deltaY) > 8 && Math.abs(deltaY) > Math.abs(deltaX)) {
        // A primarily vertical gesture should remain available to the page.
        mouseDragPointerId = null;
        return;
      }

      if (mouseDragActive) {
        event.preventDefault();
        list.scrollLeft = mouseDragStartScrollLeft - deltaX;
      }
    }, { passive: false });

    const finishMouseDrag = event => {
      if (mouseDragPointerId === null || (event.pointerId !== undefined && event.pointerId !== mouseDragPointerId)) return;
      if (mouseDragMoved && mouseDragActive) suppressClickUntil = performance.now() + 250;
      mouseDragPointerId = null;
      mouseDragActive = false;
      mouseDragMoved = false;
      list.classList.remove('is-mouse-dragging');
    };
    window.addEventListener('pointerup', finishMouseDrag);
    window.addEventListener('pointercancel', finishMouseDrag);
    list.addEventListener('click', event => {
      if (!suppressClickUntil || performance.now() > suppressClickUntil) return;
      suppressClickUntil = 0;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }, true);

    updateToggle();
    setMode(false, false);
    toggle.addEventListener('click', () => setMode(!horizontalMode));
    return {
      syncCardCount,
      syncCardGeometry,
      isHorizontalMode: () => horizontalMode
    };
  }

  const courtLayoutController = createCourtLayoutController(
    $('courtLayoutToggle'), $('courtsList'), 'courts'
  );
  const waitingCourtLayoutController = createCourtLayoutController(
    $('waitingCourtLayoutToggle'), $('waitingCourtsList'), 'waiting courts'
  );
  const courtCollapseAllToggle = $('courtCollapseAllToggle');
  const courtsList = $('courtsList');
  const waitingCourtsCollapseToggle = $('waitingCourtsCollapseToggle');
  const waitingCourtsList = $('waitingCourtsList');

  function syncWaitingCourtsCollapseToggle() {
    if (!waitingCourtsCollapseToggle || !waitingCourtsList) return;
    const cards = Array.from(waitingCourtsList.querySelectorAll(':scope > .court-card[data-waiting-court-collapse-key]'));
    // Show Collapse/Expand from the first available court; the layout switch
    // is managed separately and appears only when at least three exist.
    waitingCourtsCollapseToggle.hidden = cards.length === 0;
    const allExpanded = cards.length > 0 && cards.every(card => card.classList.contains('is-expanded'));
    waitingCourtsCollapseToggle.disabled = cards.length === 0;
    waitingCourtsCollapseToggle.textContent = allExpanded ? 'Collapse all' : 'Expand all';
    waitingCourtsCollapseToggle.setAttribute('aria-expanded', String(allExpanded));
    waitingCourtsCollapseToggle.setAttribute('aria-label', allExpanded ? 'Collapse all waiting courts' : 'Expand all waiting courts');
    waitingCourtsCollapseToggle.title = allExpanded ? 'Collapse all waiting courts' : 'Expand all waiting courts';
  }

  function updateCourtCardExpanded(card, expanded) {
    if (!card) return;
    const isExpanded = Boolean(expanded);
    const isWaitingCourt = card.hasAttribute('data-waiting-court-collapse-key');
    const key = String(isWaitingCourt ? card.dataset.waitingCourtCollapseKey : card.dataset.courtCollapseKey || '');
    const expandedKeys = isWaitingCourt ? expandedWaitingCourtKeys : expandedCourtKeys;
    const layoutController = isWaitingCourt ? waitingCourtLayoutController : courtLayoutController;
    card.classList.toggle('is-expanded', isExpanded);
    card.classList.toggle('is-collapsed', !isExpanded);
    const summaryToggle = card.querySelector('.court-card-collapse-toggle');
    const details = card.querySelector('.court-card-expanded-content');
    if (summaryToggle) {
      const courtLabel = card.querySelector('.court-card-summary-name, .court-visual-name')?.textContent || 'court';
      summaryToggle.setAttribute('aria-expanded', String(isExpanded));
      summaryToggle.setAttribute('aria-label', `${isExpanded ? 'Collapse' : 'Expand'} ${courtLabel}`);
      summaryToggle.title = `${isExpanded ? 'Collapse' : 'Expand'} ${courtLabel}`;
    }
    const collapsedSummary = card.querySelector('.court-card-summary-start');
    const expandedHeading = card.querySelector('.court-card-expanded-heading');
    const compactMatch = card.querySelector('.court-card-summary-match');
    const expandedStatus = card.querySelector('.court-card-expanded-status');
    if (collapsedSummary) collapsedSummary.setAttribute('aria-hidden', String(isExpanded));
    if (expandedHeading) expandedHeading.setAttribute('aria-hidden', String(!isExpanded));
    if (compactMatch) compactMatch.setAttribute('aria-hidden', String(isExpanded));
    if (expandedStatus) expandedStatus.setAttribute('aria-hidden', String(!isExpanded));
    if (details) details.hidden = !isExpanded;
    // Expanded details now participate in normal layout flow; no overlay
    // height measurement or reserved margin is needed.
    card.style.removeProperty('--court-expanded-panel-space');

    // In vertical mode the diagram follows its natural aspect ratio. In
    // horizontal mode preserve the height captured from the vertical layout.
    const diagram = card.querySelector('.court-card-expanded-content > .court-diagram');
    if (diagram && !layoutController?.isHorizontalMode()) {
      diagram.style.removeProperty('--court-layout-diagram-height');
    }
    if (key) {
      if (isExpanded) expandedKeys.add(key);
      else expandedKeys.delete(key);
    }
  }

  function syncCourtCollapseAllToggle() {
    if (!courtCollapseAllToggle || !courtsList) return;
    const cards = Array.from(courtsList.querySelectorAll(':scope > .court-card[data-court-collapse-key]'));
    // Keep the expand/collapse action available from one court onward.
    // The layout toggle remains hidden until the list reaches three courts.
    courtCollapseAllToggle.hidden = cards.length === 0;
    const allExpanded = cards.length > 0 && cards.every(card => card.classList.contains('is-expanded'));
    courtCollapseAllToggle.disabled = cards.length === 0;
    courtCollapseAllToggle.textContent = allExpanded ? 'Collapse all' : 'Expand all';
    courtCollapseAllToggle.setAttribute('aria-expanded', String(allExpanded));
    courtCollapseAllToggle.setAttribute('aria-label', allExpanded ? 'Collapse all courts' : 'Expand all courts');
    courtCollapseAllToggle.title = allExpanded ? 'Collapse all courts' : 'Expand all courts';
  }

  function setAllRegularCourtsExpanded(expanded) {
    if (!courtsList) return;
    courtsList.querySelectorAll(':scope > .court-card[data-court-collapse-key]').forEach(card => {
      updateCourtCardExpanded(card, expanded);
    });
    syncCourtCollapseAllToggle();
    // Re-measure each card independently; no sibling card should be stretched
    // or have its own expanded/collapsed state changed by this action.
    courtsList.querySelectorAll(':scope > .court-card[data-court-collapse-key]').forEach(card => {
      courtLayoutController?.syncCardGeometry(card);
    });
  }

  if (courtsList) {
    courtsList.addEventListener('click', event => {
      const summaryToggle = event.target.closest('.court-card-collapse-toggle');
      if (!summaryToggle || !courtsList.contains(summaryToggle)) return;
      const card = summaryToggle.closest('.court-card[data-court-collapse-key]');
      if (!card) return;
      updateCourtCardExpanded(card, !card.classList.contains('is-expanded'));
      syncCourtCollapseAllToggle();
      courtLayoutController?.syncCardGeometry(card);
    });
  }

  if (courtCollapseAllToggle) {
    courtCollapseAllToggle.addEventListener('click', () => {
      const cards = Array.from(courtsList?.querySelectorAll(':scope > .court-card[data-court-collapse-key]') || []);
      const allExpanded = cards.length > 0 && cards.every(card => card.classList.contains('is-expanded'));
      setAllRegularCourtsExpanded(!allExpanded);
    });
  }

  function setAllWaitingCourtsExpanded(expanded) {
    if (!waitingCourtsList) return;
    const cards = Array.from(waitingCourtsList.querySelectorAll(':scope > .court-card[data-waiting-court-collapse-key]'));
    cards.forEach(card => updateCourtCardExpanded(card, expanded));
    syncWaitingCourtsCollapseToggle();
    cards.forEach(card => waitingCourtLayoutController?.syncCardGeometry(card));
  }

  if (waitingCourtsList) {
    waitingCourtsList.addEventListener('click', event => {
      const summaryToggle = event.target.closest('.court-card-collapse-toggle');
      if (!summaryToggle || !waitingCourtsList.contains(summaryToggle)) return;
      const card = summaryToggle.closest('.court-card[data-waiting-court-collapse-key]');
      if (!card) return;
      updateCourtCardExpanded(card, !card.classList.contains('is-expanded'));
      syncWaitingCourtsCollapseToggle();
      waitingCourtLayoutController?.syncCardGeometry(card);
    });
  }

  if (waitingCourtsCollapseToggle) {
    waitingCourtsCollapseToggle.addEventListener('click', () => {
      const cards = Array.from(waitingCourtsList?.querySelectorAll(':scope > .court-card[data-waiting-court-collapse-key]') || []);
      const allExpanded = cards.length > 0 && cards.every(card => card.classList.contains('is-expanded'));
      setAllWaitingCourtsExpanded(!allExpanded);
    });
    syncWaitingCourtsCollapseToggle();
  }

  const queueCollapseToggle = $('queueCollapseToggle');
  const queueListViewport = $('queueListViewport');

  function setQueueCollapsed(collapsed, animate = true) {
    queueCollapsed = Boolean(collapsed);
    if (!queueCollapseToggle || !queueListViewport) return;

    // Closing the queue also dismisses the queue-only search field and restores all players.
    if (queueCollapsed) setQueueSearchVisible(false);

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

  const queueSearchToggle = $('queueSearchToggle');
  const queueSearchSlot = $('queueSearchSlot');
  const queueSearchPanel = $('queueSearchPanel');
  const queueListSearch = $('queueListSearch');
  const queueSearchTransitionMs = 260;
  let queueSearchHideTimer = null;

  function setQueueSearchVisible(visible) {
    if (!queueSearchToggle || !queueSearchSlot || !queueSearchPanel || !queueListSearch) return;
    const shouldShow = Boolean(visible);

    if (queueSearchHideTimer !== null) {
      clearTimeout(queueSearchHideTimer);
      queueSearchHideTimer = null;
    }

    queueSearchToggle.setAttribute('aria-expanded', String(shouldShow));
    queueSearchToggle.setAttribute('aria-label', shouldShow ? 'Hide queue search' : 'Show queue search');
    queueSearchToggle.title = shouldShow ? 'Hide queue search' : 'Search players in queue';

    if (shouldShow) {
      // The slot owns the layout height; the field itself only fades/slides.
      // Separating them prevents the queue list from jumping during close.
      queueSearchSlot.hidden = false;
      queueSearchPanel.hidden = false;
      void queueSearchSlot.offsetHeight;
      requestAnimationFrame(() => {
        if (queueSearchToggle.getAttribute('aria-expanded') !== 'true') return;
        queueSearchSlot.classList.add('is-open');
        queueSearchPanel.classList.add('is-open');
        queueListSearch.focus();
      });
      return;
    }

    queueSearchSlot.classList.remove('is-open');
    queueSearchPanel.classList.remove('is-open');
    // Clear the filter when dismissing the field so the full queue is restored.
    if (queueListSearch.value) {
      queueListSearch.value = '';
      renderQueueList(currentState?.queue);
    }
    queueSearchHideTimer = setTimeout(() => {
      if (queueSearchToggle.getAttribute('aria-expanded') !== 'true'
          && !queueSearchSlot.classList.contains('is-open')) {
        queueSearchPanel.hidden = true;
        queueSearchSlot.hidden = true;
      }
      queueSearchHideTimer = null;
    }, queueSearchTransitionMs + 40);
  }

  if (queueSearchToggle && queueSearchSlot && queueSearchPanel && queueListSearch) {
    queueSearchToggle.addEventListener('click', () => {
      const shouldShow = queueSearchToggle.getAttribute('aria-expanded') !== 'true';
      // The search control remains available when the queue is collapsed: tapping it
      // reopens the queue first, then reveals and focuses the compact search field.
      if (shouldShow && queueCollapsed) setQueueCollapsed(false);
      setQueueSearchVisible(shouldShow);
    });
    queueListSearch.addEventListener('input', () => renderQueueList(currentState?.queue));
    queueListSearch.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setQueueSearchVisible(false);
        queueSearchToggle.focus();
      }
    });
  }

  const sessionTitleToggle = $('sessionTitleToggle');
  const sessionTitleSlide = $('sessionTitleSlide');
  if (sessionTitleToggle && sessionTitleSlide) {
    sessionTitleToggle.addEventListener('click', () => {
      const collapsed = sessionTitleSlide.classList.toggle('is-collapsed');
      sessionTitleToggle.setAttribute('aria-expanded', String(!collapsed));
      sessionTitleToggle.setAttribute('aria-label', collapsed ? 'Show session title' : 'Hide session title');
      sessionTitleToggle.title = collapsed ? 'Show session title' : 'Hide session title';
      if (!collapsed) requestAnimationFrame(fitSessionTitle);
    });
  }
  window.addEventListener('resize', fitSessionTitle, { passive: true });
  if (document.fonts?.ready) document.fonts.ready.then(fitSessionTitle);

  const pageRankingFilterToggle = $('pageRankingFilterToggle');
  const pageRankingFilterControls = $('pageRankingFilterControls');
  pageRankingFilterToggle?.addEventListener('click', () => {
    if (!pageRankingFilterControls) return;
    const isOpening = pageRankingFilterControls.hidden;
    pageRankingFilterControls.hidden = !isOpening;
    pageRankingFilterToggle.setAttribute('aria-expanded', String(isOpening));
    pageRankingFilterToggle.setAttribute('aria-label', isOpening ? 'Close ranking filters' : 'Open ranking filters');
    pageRankingFilterToggle.title = isOpening ? 'Close ranking filters' : 'Open ranking filters';
    pageRankingFilterToggle.classList.toggle('is-open', isOpening);
  });
  pageRankingFilterControls?.addEventListener('click', event => {
    const categoryButton = event.target.closest('[data-live-ranking-category]');
    const scopeButton = event.target.closest('[data-live-ranking-scope]');
    if (categoryButton) {
      liveRankingCategoryFilter = categoryButton.dataset.liveRankingCategory || 'ALL';
      pageRankingFilterControls.querySelectorAll('[data-live-ranking-category]').forEach(button => {
        const active = button === categoryButton;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      renderLiveRanking('pageRankingList', 'pageRankingSearch', false);
    } else if (scopeButton) {
      liveRankingScopeFilter = scopeButton.dataset.liveRankingScope || 'EVERYONE';
      pageRankingFilterControls.querySelectorAll('[data-live-ranking-scope]').forEach(button => {
        const active = button === scopeButton;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      renderLiveRanking('pageRankingList', 'pageRankingSearch', false);
    }
  });
  $('pageRankingSearch')?.addEventListener('input', () => renderLiveRanking('pageRankingList', 'pageRankingSearch', false));
  $('pageMatchesSearch')?.addEventListener('input', () => renderRecentMatches(false));

  const mobileLiveRefresh = $('mobileLiveRefresh');
  if (mobileLiveRefresh) {
    mobileLiveRefresh.addEventListener('click', async () => {
      if (mobileLiveRefresh.disabled) return;
      mobileLiveRefresh.disabled = true;
      mobileLiveRefresh.classList.add('is-refreshing');
      try {
        await refreshRemoteState();
      } finally {
        mobileLiveRefresh.classList.remove('is-refreshing');
        mobileLiveRefresh.disabled = false;
      }
    });
  }
  document.querySelectorAll('[data-live-tab]').forEach(button => {
    button.addEventListener('click', () => setLiveTab(button.dataset.liveTab));
    button.addEventListener('keydown', event => {
      if (button.classList.contains('mobile-header-icon-button')) return;
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = [...document.querySelectorAll('nav.live-tabs [data-live-tab]:not([hidden])')];
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
    currentStateSignature = stateContentSignature(boot);
    render();
  } else {
    // Render the inactive-queue notice immediately while the first shared-state
    // request is loading, or if the server cannot be reached on a fresh device.
    currentState = {
      sessionName: 'Pickle Point Match', active: false, updatedAt: null,
      queue: [], courts: [], ranking: [], courtCount: 0, waitingCourtCount: 0
    };
    currentStateSignature = stateContentSignature(currentState);
    render();
  }
  connectServer();
  // Polling is a recovery path if a proxy, sleeping host, or network issue
  // interrupts Server-Sent Events. The stream still delivers normal updates
  // immediately; polling ensures the page eventually catches up if it does not.
  if (isHttpPage()) {
    window.setInterval(async () => {
      // A healthy SSE connection already delivers every live-state change.
      // Poll only while the stream is absent, connecting, or fully closed.
      if (typeof EventSource !== 'undefined' && eventSource && eventSource.readyState === EventSource.OPEN) return;
      const connected = await refreshRemoteState();
      if (connected === true && (!eventSource || (typeof EventSource !== 'undefined' && eventSource.readyState === EventSource.CLOSED))) {
        eventSource = null;
        startEventStream();
      } else if (connected === false) {
        scheduleReconnect();
      }
    }, 15000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) connectServer();
    });
  }
  setInterval(() => {
    document.querySelectorAll('[data-start]').forEach(el => {
      const nextElapsed = elapsed(el.dataset.start);
      if (el.textContent !== nextElapsed) el.textContent = nextElapsed;

      const nextTimerClass = timerClass(el.dataset.start);
      if (!el.classList.contains(nextTimerClass)) {
        el.classList.remove('timer-blue', 'timer-amber', 'timer-red');
        el.classList.add(nextTimerClass);
      }
    });
    document.querySelectorAll('.queue-waiting-time[data-waiting-since]').forEach(el => {
      el.textContent = waitingDuration(el.dataset.waitingSince);
      el.classList.remove('waiting-amber', 'waiting-red');
      const waitingClass = waitingTimeClass(el.dataset.waitingSince);
      if (waitingClass) el.classList.add(waitingClass);
    });
  }, 1000);
})();
