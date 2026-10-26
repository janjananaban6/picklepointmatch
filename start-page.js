/* Standalone Start Screen controller. The queueing workspace lives in queueing.html. */
(function () {
  'use strict';
  const ORGANIZER_STORAGE_SUFFIX = String(window.PPM_ORGANIZER_ID || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const STATE_KEY = `pickleq_v11_state${ORGANIZER_STORAGE_SUFFIX ? `_${ORGANIZER_STORAGE_SUFFIX}` : ''}`;
  const LEGACY_STATE_KEYS = ORGANIZER_STORAGE_SUFFIX ? [] : ['pickleq_v10_state', 'pickleq_v9_state', 'pickleq_v8_state', 'pickleq_v7_state', 'pickleq_v6_state'];
  const SAVED_AT_KEY = `${STATE_KEY}_saved_at`;
  const PENDING_SYNC_KEY = `${STATE_KEY}_pending_sync`;
  const PENDING_START_CONFIG_KEY = 'picklepoint.pending-live-queue-start-config';
  const $ = id => document.getElementById(id);

  let currentState = null;
  let stateCheckComplete = false;
  let isNavigating = false;

  function readLocalState() {
    for (const key of [STATE_KEY, ...LEGACY_STATE_KEYS]) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch (_) {}
    }
    return null;
  }

  function readLocalPendingIsNewer(remoteUpdatedAt) {
    try {
      const savedAt = Number(localStorage.getItem(SAVED_AT_KEY)) || 0;
      const pendingAt = Number(localStorage.getItem(PENDING_SYNC_KEY)) || 0;
      const remoteAt = Date.parse(remoteUpdatedAt || '') || 0;
      return pendingAt > 0 && pendingAt === savedAt && savedAt > remoteAt;
    } catch (_) {
      return false;
    }
  }

  function hasExistingQueue(state) {
    if (!state || typeof state !== 'object') return false;
    return !!(state.sessionActive ||
      (Array.isArray(state.players) && state.players.length) ||
      (Array.isArray(state.left) && state.left.length) ||
      (Array.isArray(state.queue) && state.queue.length) ||
      (Array.isArray(state.courts) && state.courts.length) ||
      (Array.isArray(state.logs) && state.logs.length));
  }

  function getPrefix(dupr) {
    return dupr ? '(DUPR MATCH)' : '(NON DUPR MATCH)';
  }

  function escapeSessionNamePreviewText(value) {
    return String(value).replace(/[&<>\"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;'
    }[character]));
  }

  function renderSessionNamePreview() {
    const input = $('liveQueueSessionName');
    const preview = $('liveQueueSessionNamePreview');
    if (!input || !preview) return;

    const value = String(input.value || '');
    const match = value.match(/^(\s*)(\((?:NON\s+)?DUPR\s+(?:RATED|MATCH)\))/i);
    const content = match
      ? `${escapeSessionNamePreviewText(match[1])}<span class="live-queue-session-name-prefix">${escapeSessionNamePreviewText(match[2])}</span>${escapeSessionNamePreviewText(value.slice(match[0].length))}`
      : escapeSessionNamePreviewText(value);
    preview.innerHTML = `<span class="live-queue-session-name-preview-content">${content}</span>`;

    const inputStyle = window.getComputedStyle(input);
    preview.style.font = inputStyle.font;
    preview.style.letterSpacing = inputStyle.letterSpacing;
    preview.style.textTransform = inputStyle.textTransform;
    preview.style.color = "#18383e";
    preview.style.paddingLeft = inputStyle.paddingLeft;
    preview.style.paddingRight = inputStyle.paddingRight;
    const previewContent = preview.firstElementChild;
    if (previewContent) previewContent.style.transform = `translateX(${-input.scrollLeft}px)`;
  }

  function syncSessionName() {
    const input = $('liveQueueSessionName');
    if (!input) return;
    const prefix = getPrefix(!!$('liveQueueDupr')?.checked);
    const current = String(input.value || '').trim();
    const suffix = current.replace(/^\((?:NON )?DUPR MATCH\)\s*/i, '').trim();
    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const autoName = !suffix || /^Open Play(?:\s*[—-]\s*[A-Za-z]{3}\s+\d{1,2},?\s+\d{4})?$/i.test(suffix);
    const nextSuffix = autoName ? `Open Play — ${today}` : suffix;
    input.value = `${prefix} ${nextSuffix}`;
    input.dataset.lastValidSuffix = nextSuffix;
    renderSessionNamePreview();
  }

  function enforceSessionPrefix() {
    const input = $('liveQueueSessionName');
    if (!input) return;
    const prefix = `${getPrefix(!!$('liveQueueDupr')?.checked)} `;
    const raw = String(input.value || '');
    let suffix = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw.replace(/^\s*\([^)]*\)\s*/, '');
    suffix = suffix.replace(/\s*\((?:NON )?DUPR MATCH\)\s*/ig, ' ').replace(/^\s+/, '');
    const next = suffix ? `${prefix}${suffix}` : prefix;
    if (raw !== next) {
      const oldStart = input.selectionStart ?? raw.length;
      input.value = next;
      try {
        const caret = Math.max(prefix.length, Math.min(next.length, oldStart));
        input.setSelectionRange(caret, caret);
      } catch (_) {}
    }
    input.dataset.lastValidSuffix = suffix || input.dataset.lastValidSuffix || 'Open Play';
    renderSessionNamePreview();
  }

  function setGroupActive(selector, button) {
    document.querySelectorAll(selector).forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
  }

  function syncDuprLocationVisibility() {
    const toggle = $('liveQueueDupr');
    const field = $('liveQueueDuprLocationField');
    const input = $('liveQueueDuprLocation');
    const enabled = !!toggle?.checked;
    if (field) {
      field.classList.toggle('hidden', !enabled);
      field.classList.toggle('is-required', enabled);
    }
    if (input) {
      input.disabled = hasExistingQueue(currentState);
      input.required = enabled;
      input.setAttribute('aria-required', String(enabled));
      if (!enabled || String(input.value || '').trim()) input.setCustomValidity('');
    }
  }

  function syncDuprRecordingResults() {
    const duprToggle = $('liveQueueDupr');
    const recordToggle = $('liveQueueRecordResults');
    if (!recordToggle) return;

    const duprEnabled = !!duprToggle?.checked;
    const existing = hasExistingQueue(currentState);
    if (duprEnabled) recordToggle.checked = true;

    recordToggle.required = duprEnabled;
    recordToggle.setAttribute('aria-required', String(duprEnabled));
    recordToggle.setAttribute('aria-label', duprEnabled
      ? 'Record game scores (required for DUPR matches)'
      : 'Record game scores');
    recordToggle.disabled = existing || duprEnabled || recordToggle.dataset.originallyDisabled === 'true';
    recordToggle.setAttribute('aria-disabled', String(recordToggle.disabled));

    const row = recordToggle.closest('.record-results-toggle-row');
    if (row) {
      row.classList.toggle('is-required-by-dupr', duprEnabled);
      row.title = duprEnabled
        ? 'Recording results is required for DUPR matches'
        : 'Choose whether to record numeric game scores';
    }
  }

  function syncDuprLabelToggleText() {
    const toggle = $('liveQueueDuprLabels');
    const row = toggle?.closest('.dupr-labels-toggle-row');
    const status = $('liveQueueDuprLabelsStatus');
    const enabled = toggle ? !!toggle.checked : true;
    if (status) status.textContent = enabled ? 'DUPR ON · Show labels in Queueing' : 'DUPR OFF · Hide labels in Queueing';
    row?.classList.toggle('is-dupr-off', !enabled);
    if (toggle) toggle.setAttribute('aria-label', enabled ? 'DUPR ON — show labels in Queueing' : 'DUPR OFF — hide labels in Queueing');
  }

  function applyQueueAvailability() {
    const existing = hasExistingQueue(currentState);
    $('existingLiveQueueCard')?.classList.toggle('hidden', !existing);
    $('existingLiveQueueStats')?.classList.toggle('hidden', !existing);

    if (existing) {
      $('existingLiveQueueName').textContent = String(currentState.sessionName || 'Existing live queue');
      $('existingLiveQueuePlayersCount').textContent = String(Array.isArray(currentState.queue) ? currentState.queue.length : 0);
      $('existingLiveQueueCourtsCount').textContent = String(Array.isArray(currentState.courts) ? currentState.courts.filter(court => !court.waitingOnly).length : 0);
      $('existingLiveQueueMatchesCount').textContent = String(Array.isArray(currentState.logs) ? currentState.logs.length : 0);
      $('liveQueueStartSubtitle').textContent = 'An existing live queue is ready. Continue it to keep managing the same session.';
      if ($('liveQueueSessionName')) {
        $('liveQueueSessionName').value = String(currentState.sessionName || '(NON DUPR MATCH) Open Play');
        $('liveQueueSessionName').disabled = true;
      }
      if ($('liveQueueRecordResults')) $('liveQueueRecordResults').checked = !!currentState.recordScores;
      if ($('liveQueueDupr')) $('liveQueueDupr').checked = !!currentState.duprMatch;
      if ($('liveQueueDuprLocation')) $('liveQueueDuprLocation').value = String(currentState.duprLocation || '');
      if ($('liveQueueDuprLabels')) $('liveQueueDuprLabels').checked = currentState.duprLabelsEnabled !== false;
      syncDuprLabelToggleText();
      syncDuprLocationVisibility();
      renderSessionNamePreview();
    } else {
      $('liveQueueStartSubtitle').textContent = 'Create a live queue session before entering the queueing workspace.';
      if ($('liveQueueSessionName')) $('liveQueueSessionName').disabled = false;
    }

    syncDuprLabelToggleText();
    syncDuprLocationVisibility();
    document.querySelectorAll('#liveQueueMatchType button, #liveQueueWinBy button, #liveQueueGameMode button, #liveQueueMatchingMode button, #liveQueueStartScreen .live-queue-toggle-row input').forEach(control => {
      control.disabled = existing || control.dataset.originallyDisabled === 'true';
      control.setAttribute('aria-disabled', control.disabled ? 'true' : 'false');
    });
    syncDuprRecordingResults();
    const recordResults = $('liveQueueRecordResults');
    if (recordResults) recordResults.setAttribute('aria-disabled', recordResults.disabled ? 'true' : 'false');
    const create = $('createLiveQueueBtn');
    if (create) {
      create.disabled = !stateCheckComplete || existing || isNavigating;
      create.setAttribute('aria-disabled', create.disabled ? 'true' : 'false');
    }
    const continueButton = $('continueLiveQueueBtn');
    if (continueButton) continueButton.disabled = !existing || isNavigating;
  }

  async function refreshSharedState() {
    const localState = readLocalState();
    currentState = localState;

    if (location.protocol === 'http:' || location.protocol === 'https:') {
      try {
        const response = await fetch(`/api/app-state?_=${Date.now()}`, { cache: 'no-store' });
        if (response.ok) {
          const payload = await response.json();
          if (payload && payload.state && typeof payload.state === 'object') {
            currentState = readLocalPendingIsNewer(payload.updatedAt) ? localState : payload.state;
          } else if (!localState) {
            currentState = null;
          }
        }
      } catch (_) {
        // Fall back to this browser's saved state if the shared server is offline.
      }
    }

    stateCheckComplete = true;
    applyQueueAvailability();
    if (!hasExistingQueue(currentState)) syncSessionName();
  }

  function collectStartConfig() {
    enforceSessionPrefix();
    return {
      sessionName: String($('liveQueueSessionName')?.value || '').trim() || getPrefix(!!$('liveQueueDupr')?.checked) + ' Open Play',
      duprMatch: !!$('liveQueueDupr')?.checked,
      type: document.querySelector('#liveQueueMatchType .live-queue-choice.active')?.dataset.value || 'Doubles',
      target: Number(document.querySelector('#liveQueueGameMode .live-queue-game.active')?.dataset.target) || 11,
      winBy: Number(document.querySelector('#liveQueueWinBy .live-queue-choice.active')?.dataset.value) || 1,
      matchingMode: document.querySelector('#liveQueueMatchingMode .live-queue-matching-option.active')?.dataset.mode || 'balanced',
      recordScores: !!$('liveQueueDupr')?.checked || !!$('liveQueueRecordResults')?.checked,
      duprLocation: String($('liveQueueDuprLocation')?.value || '').trim(),
      duprLabelsEnabled: $('liveQueueDuprLabels') ? !!$('liveQueueDuprLabels').checked : true
    };
  }

  async function createQueue() {
    if (isNavigating || !stateCheckComplete || hasExistingQueue(currentState)) return;

    // A DUPR session must have a real location before its queue can be created.
    const duprLocationInput = $('liveQueueDuprLocation');
    const duprEnabled = !!$('liveQueueDupr')?.checked;
    const duprLocation = String(duprLocationInput?.value || '').trim();
    if (duprLocationInput) {
      duprLocationInput.required = duprEnabled;
      duprLocationInput.setAttribute('aria-required', String(duprEnabled));
      if (duprEnabled && !duprLocation) {
        duprLocationInput.setCustomValidity('Enter the CSV location before creating a DUPR session.');
        duprLocationInput.reportValidity();
        duprLocationInput.focus();
        return;
      }
      duprLocationInput.setCustomValidity('');
    }

    isNavigating = true;
    applyQueueAvailability();

    // Recheck shared state immediately before creating so another device's session is not overwritten.
    await refreshSharedState();
    if (hasExistingQueue(currentState)) {
      applyQueueAvailability();
      isNavigating = false;
      applyQueueAvailability();
      return;
    }

    const config = collectStartConfig();
    try {
      sessionStorage.setItem(PENDING_START_CONFIG_KEY, JSON.stringify(config));
      sessionStorage.setItem('liveQueueView', 'workspace');
    } catch (_) {
      // sessionStorage is normally available for same-tab navigation; if blocked, don't lose the user's configuration silently.
      isNavigating = false;
      applyQueueAvailability();
      window.alert('Your browser blocked session storage, so the queue could not be opened. Please allow site storage and try again.');
      return;
    }
    window.location.assign('queueing.html?create=1');
  }

  document.querySelectorAll('#liveQueueMatchType .live-queue-choice').forEach(button => button.addEventListener('click', () => {
    if (!button.disabled) setGroupActive('#liveQueueMatchType .live-queue-choice', button);
  }));
  document.querySelectorAll('#liveQueueWinBy .live-queue-choice').forEach(button => button.addEventListener('click', () => {
    if (!button.disabled) setGroupActive('#liveQueueWinBy .live-queue-choice', button);
  }));
  document.querySelectorAll('#liveQueueGameMode .live-queue-game').forEach(button => button.addEventListener('click', () => {
    if (!button.disabled) setGroupActive('#liveQueueGameMode .live-queue-game', button);
  }));
  document.querySelectorAll('#liveQueueMatchingMode .live-queue-matching-option').forEach(button => button.addEventListener('click', () => {
    if (button.disabled) return;
    document.querySelectorAll('#liveQueueMatchingMode .live-queue-matching-option').forEach(option => {
      const active = option === button;
      option.classList.toggle('active', active);
      option.setAttribute('aria-pressed', String(active));
    });
  }));
  $('liveQueueDupr')?.addEventListener('change', () => { syncSessionName(); syncDuprLocationVisibility(); syncDuprRecordingResults(); });
  $('liveQueueDuprLocation')?.addEventListener('input', event => {
    const input = event.currentTarget;
    if (!$('liveQueueDupr')?.checked || String(input.value || '').trim()) input.setCustomValidity('');
  });
  $('liveQueueDuprLabels')?.addEventListener('change', syncDuprLabelToggleText);
  $('liveQueueSessionName')?.addEventListener('input', enforceSessionPrefix);
  $('liveQueueSessionName')?.addEventListener('focus', enforceSessionPrefix);
  $('liveQueueSessionName')?.addEventListener('scroll', renderSessionNamePreview);
  $('liveQueueSessionName')?.addEventListener('keydown', event => {
    const input = event.currentTarget;
    const prefixLength = getPrefix(!!$('liveQueueDupr')?.checked).length + 1;
    if ((input.selectionStart || 0) < prefixLength && !['Tab', 'Shift', 'Control', 'Alt', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      try { input.setSelectionRange(prefixLength, prefixLength); } catch (_) {}
    }
  });
  $('createLiveQueueBtn')?.addEventListener('click', createQueue);
  $('continueLiveQueueBtn')?.addEventListener('click', () => {
    if (!hasExistingQueue(currentState) || isNavigating) return;
    isNavigating = true;
    window.location.assign('queueing.html');
  });

  syncSessionName();
  syncDuprLabelToggleText();
  syncDuprLocationVisibility();
  applyQueueAvailability();
  refreshSharedState().catch(() => {
    stateCheckComplete = true;
    currentState = readLocalState();
    applyQueueAvailability();
    if (!hasExistingQueue(currentState)) syncSessionName();
  });

  // Keep this Start Screen's Existing Live Queue indicator fresh if the queue changes on another device.
  window.addEventListener('focus', () => { refreshSharedState(); });
  window.setInterval(() => { if (document.visibilityState !== 'hidden') refreshSharedState(); }, 15000);
})();
