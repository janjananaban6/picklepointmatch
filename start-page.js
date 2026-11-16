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
  let sharedStateRevision = 0;
  let stateCheckComplete = false;
  let isNavigating = false;
  let sharedStateSource = null;
  let locationSuggestTimer = 0;
  let locationSuggestController = null;
  let locationSuggestRequestId = 0;
  let locationSuggestFeatures = [];
  let locationSuggestActiveIndex = -1;
  let locationSuggestLastRequestAt = 0;

  const PH_LOCATION_BOUNDS = { minLat: 4.0, maxLat: 22.4, minLon: 115.5, maxLon: 128.6 };
  const PH_LOCATION_CENTER = { lat: 12.8797, lon: 121.7740 };
  // Verified court entries are included alongside the live Philippines geocoder
  // so venues that are not yet indexed in OpenStreetMap can still be selected.
  const VERIFIED_PH_COURT_LOCATIONS = [
    {
      name: 'Summer Pickle and Perks (Alabel)',
      address: 'Pecolados Compound, Purok Centro, Poblacion, Alabel, Sarangani 9501, Philippines',
      label: 'Summer Pickle and Perks, Pecolados Compound, Purok Centro, Poblacion, Alabel, Sarangani 9501, Philippines',
      lat: 6.1114236,
      lon: 125.2934115,
      countrycode: 'PH',
      source: 'verified-venue-listing'
    },
    {
      name: 'Summer Pickle and Perks-Bula',
      address: 'Zone 9, Bula, General Santos City, South Cotabato, Philippines',
      label: 'Summer Pickle and Perks-Bula, Zone 9, Bula, General Santos City, South Cotabato, Philippines',
      lat: 6.106678009,
      lon: 125.192527771,
      countrycode: 'PH',
      source: 'verified-venue-listing'
    }
  ];

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

  function sessionId(state) { return String(state && state.sessionId || '').trim(); }

  function sessionIdentityDiffers(a, b) {
    const first = sessionId(a);
    const second = sessionId(b);
    return (!!first || !!second) && first !== second;
  }

  function isEndedSession(state) {
    return !!(state && state.sessionActive === false && state.sessionEndedAt);
  }

  function persistRemoteState(state, updatedAt) {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
      const timestamp = Date.parse(updatedAt || '') || Date.now();
      localStorage.setItem(SAVED_AT_KEY, String(timestamp));
      localStorage.removeItem(PENDING_SYNC_KEY);
    } catch (_) {}
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
    if (isEndedSession(state)) return false;
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

  function normalizeSelectedLocationCoordinates(value) {
    let source = value;
    if (typeof source === 'string') {
      try { source = JSON.parse(source); } catch (_) { return null; }
    }
    if (!source || typeof source !== 'object') return null;
    const lat = Number(source.lat ?? source.latitude);
    const lon = Number(source.lon ?? source.lng ?? source.longitude);
    const insidePhilippines = Number.isFinite(lat) && Number.isFinite(lon) &&
      lat >= PH_LOCATION_BOUNDS.minLat && lat <= PH_LOCATION_BOUNDS.maxLat &&
      lon >= PH_LOCATION_BOUNDS.minLon && lon <= PH_LOCATION_BOUNDS.maxLon;
    if (!insidePhilippines) return null;
    const countrycode = String(source.countrycode || source.countryCode || 'PH').toUpperCase();
    if (countrycode !== 'PH') return null;
    return {
      lat,
      lon,
      label: String(source.label || source.name || '').trim(),
      name: String(source.name || '').trim(),
      countrycode: 'PH',
      source: String(source.source || 'photon')
    };
  }

  function getSelectedLocationCoordinates() {
    return normalizeSelectedLocationCoordinates($('liveQueueDuprLocationCoordinates')?.value || '');
  }

  function setSelectedLocationCoordinates(value) {
    const hidden = $('liveQueueDuprLocationCoordinates');
    if (!hidden) return;
    const normalized = normalizeSelectedLocationCoordinates(value);
    hidden.value = normalized ? JSON.stringify(normalized) : '';
  }

  function hideLocationSuggestions() {
    const list = $('liveQueueDuprLocationSuggestions');
    const input = $('liveQueueDuprLocation');
    if (list) {
      list.hidden = true;
      list.innerHTML = '';
    }
    if (input) input.setAttribute('aria-expanded', 'false');
    locationSuggestFeatures = [];
    locationSuggestActiveIndex = -1;
  }

  function showLocationMessage(title, message) {
    const list = $('liveQueueDuprLocationSuggestions');
    const input = $('liveQueueDuprLocation');
    if (!list || !input) return;
    list.innerHTML = `<div class="live-queue-location-message"><strong>${escapeLocationText(title)}</strong>${escapeLocationText(message)}</div>`;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    locationSuggestFeatures = [];
    locationSuggestActiveIndex = -1;
  }

  function escapeLocationText(value) {
    return String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }

  function normalizeLocationSearchText(value) {
    return String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  }

  function locationFeatureParts(feature) {
    const properties = feature?.properties || {};
    const coordinates = feature?.geometry?.coordinates || [];
    const lon = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    const countrycode = String(properties.countrycode || properties.countryCode || '').toUpperCase();
    if (countrycode !== 'PH' || !Number.isFinite(lat) || !Number.isFinite(lon) ||
        lat < PH_LOCATION_BOUNDS.minLat || lat > PH_LOCATION_BOUNDS.maxLat ||
        lon < PH_LOCATION_BOUNDS.minLon || lon > PH_LOCATION_BOUNDS.maxLon) return null;

    const name = String(properties.name || properties.street || properties.city || 'Philippines location').trim();
    const street = [properties.housenumber, properties.street].filter(Boolean).join(' ').trim();
    const addressParts = [
      street && normalizeLocationSearchText(street) !== normalizeLocationSearchText(name) ? street : '',
      properties.district,
      properties.suburb,
      properties.city,
      properties.county,
      properties.state,
      properties.postcode,
      'Philippines'
    ].filter(Boolean);
    const address = [...new Set(addressParts.map(value => String(value).trim()).filter(Boolean))].join(', ');
    const label = [...new Set([name, ...addressParts].filter(Boolean))].join(', ');
    const osmId = [properties.osm_type || '', properties.osm_id || ''].join(':');
    return { name, address, label, lat, lon, countrycode: 'PH', osmId, properties };
  }

  function renderLocationSuggestions(features) {
    const list = $('liveQueueDuprLocationSuggestions');
    const input = $('liveQueueDuprLocation');
    if (!list || !input) return;
    locationSuggestFeatures = features;
    locationSuggestActiveIndex = -1;
    if (!features.length) {
      showLocationMessage('No matching Philippines location', 'Try the venue name with its city, barangay, or province. You can also enter a full address manually.');
      return;
    }
    list.innerHTML = features.map((feature, index) => `
      <button type="button" class="live-queue-location-option" role="option" aria-selected="false" data-location-option="${index}">
        <strong>${escapeLocationText(feature.name)}</strong>
        <small>${escapeLocationText(feature.address || feature.label)}</small>
        <em>${feature.source === 'verified-venue-listing' ? 'Verified court venue · Philippines' : 'Philippines · Map search'}</em>
      </button>`).join('');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  async function searchPhilippinesLocations(query, requestId) {
    const input = $('liveQueueDuprLocation');
    if (!input || input.disabled) return;
    if (locationSuggestController) locationSuggestController.abort();
    const controller = new AbortController();
    locationSuggestController = controller;
    const delay = Math.max(0, 950 - (Date.now() - locationSuggestLastRequestAt));
    if (delay) await new Promise(resolve => window.setTimeout(resolve, delay));
    if (controller.signal.aborted || requestId !== locationSuggestRequestId || String(input.value || '').trim() !== query) return;

    const terms = normalizeLocationSearchText(query).split(' ').filter(term => term.length > 2 && !['the', 'and', 'for', 'philippines'].includes(term));
    const requiredMatches = terms.length <= 1 ? 1 : Math.max(1, Math.ceil(terms.length * 0.5));
    const curatedMatches = VERIFIED_PH_COURT_LOCATIONS.filter(feature => {
      const searchable = normalizeLocationSearchText(`${feature.name} ${feature.address}`);
      const matches = terms.filter(term => searchable.includes(term)).length;
      return !terms.length || matches >= requiredMatches;
    }).map(feature => ({ ...feature }));
    if (curatedMatches.length) renderLocationSuggestions(curatedMatches);
    else showLocationMessage('Searching Philippines locations…', 'Looking for matching courts, venues, and addresses.');
    const params = new URLSearchParams({
      q: query,
      limit: '10',
      lang: 'en',
      countrycode: 'PH',
      bbox: '115.5,4.0,128.6,22.4',
      lat: String(PH_LOCATION_CENTER.lat),
      lon: String(PH_LOCATION_CENTER.lon),
      zoom: '5'
    });
    locationSuggestLastRequestAt = Date.now();
    try {
      const response = await fetch(`https://photon.komoot.io/api/?${params.toString()}`, {
        headers: { Accept: 'application/geo+json, application/json' },
        signal: controller.signal,
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`Location search failed (${response.status}).`);
      const payload = await response.json();
      if (controller.signal.aborted || requestId !== locationSuggestRequestId || String(input.value || '').trim() !== query) return;

      const unique = new Map();
      // Add verified Philippine pickleball venues first when the search matches.
      curatedMatches.forEach(feature => {
        const key = `${normalizeLocationSearchText(feature.name)}|${feature.lat.toFixed(5)}|${feature.lon.toFixed(5)}`;
        unique.set(key, feature);
      });
      (Array.isArray(payload.features) ? payload.features : []).forEach(feature => {
        const parts = locationFeatureParts(feature);
        if (!parts) return;
        const searchable = normalizeLocationSearchText([parts.name, parts.address, parts.properties?.osm_key, parts.properties?.osm_value].filter(Boolean).join(' '));
        const matches = terms.filter(term => searchable.includes(term)).length;
        if (terms.length && matches < requiredMatches) return;
        const key = `${normalizeLocationSearchText(parts.name)}|${parts.lat.toFixed(5)}|${parts.lon.toFixed(5)}`;
        if (!unique.has(key)) unique.set(key, parts);
      });
      renderLocationSuggestions([...unique.values()].slice(0, 8));
    } catch (error) {
      if (error?.name === 'AbortError' || requestId !== locationSuggestRequestId) return;
      if (curatedMatches.length) renderLocationSuggestions(curatedMatches);
      else showLocationMessage('Location search unavailable', 'Check your internet connection and try again, or enter the complete court address manually.');
    }
  }

  function queuePhilippinesLocationSearch(rawQuery) {
    const input = $('liveQueueDuprLocation');
    const query = String(rawQuery || '').trim();
    locationSuggestRequestId += 1;
    const requestId = locationSuggestRequestId;
    window.clearTimeout(locationSuggestTimer);
    if (locationSuggestController) locationSuggestController.abort();
    if (!input || input.disabled || query.length < 3) {
      hideLocationSuggestions();
      return;
    }
    showLocationMessage('Searching Philippines locations…', 'Looking for matching courts, venues, and addresses.');
    locationSuggestTimer = window.setTimeout(() => searchPhilippinesLocations(query, requestId), 450);
  }

  function choosePhilippinesLocation(index) {
    const feature = locationSuggestFeatures[index];
    const input = $('liveQueueDuprLocation');
    if (!feature || !input || input.disabled) return;
    input.value = feature.label;
    setSelectedLocationCoordinates(feature);
    input.dataset.locationSelected = 'true';
    input.setCustomValidity('');
    hideLocationSuggestions();
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function bindPhilippinesLocationAutocomplete() {
    const picker = $('liveQueueLocationPicker');
    const input = $('liveQueueDuprLocation');
    const list = $('liveQueueDuprLocationSuggestions');
    if (!picker || !input || !list || picker.dataset.autocompleteBound === 'true') return;
    picker.dataset.autocompleteBound = 'true';

    input.addEventListener('input', () => {
      setSelectedLocationCoordinates(null);
      input.dataset.locationSelected = 'false';
      input.setCustomValidity('');
      queuePhilippinesLocationSearch(input.value);
    });
    input.addEventListener('focus', () => {
      if (!getSelectedLocationCoordinates() && String(input.value || '').trim().length >= 3) queuePhilippinesLocationSearch(input.value);
    });
    input.addEventListener('keydown', event => {
      if (list.hidden) return;
      const options = [...list.querySelectorAll('[data-location-option]')];
      if (event.key === 'ArrowDown' && options.length) {
        event.preventDefault();
        locationSuggestActiveIndex = Math.min(options.length - 1, locationSuggestActiveIndex + 1);
      } else if (event.key === 'ArrowUp' && options.length) {
        event.preventDefault();
        locationSuggestActiveIndex = Math.max(0, locationSuggestActiveIndex - 1);
      } else if (event.key === 'Enter' && locationSuggestActiveIndex >= 0) {
        event.preventDefault();
        choosePhilippinesLocation(locationSuggestActiveIndex);
      } else if (event.key === 'Escape') {
        hideLocationSuggestions();
        return;
      } else {
        return;
      }
      options.forEach((option, index) => {
        const active = index === locationSuggestActiveIndex;
        option.setAttribute('aria-selected', String(active));
        if (active) option.scrollIntoView({ block: 'nearest' });
      });
    });
    list.addEventListener('pointerdown', event => {
      if (event.target.closest('[data-location-option]')) event.preventDefault();
    });
    list.addEventListener('click', event => {
      const option = event.target.closest('[data-location-option]');
      if (option) choosePhilippinesLocation(Number(option.dataset.locationOption));
    });
    document.addEventListener('click', event => {
      if (!picker.contains(event.target)) hideLocationSuggestions();
    });
  }

  function syncDuprLocationVisibility() {
    const toggle = $('liveQueueDupr');
    const field = $('liveQueueDuprLocationField');
    const input = $('liveQueueDuprLocation');
    const duprEnabled = !!toggle?.checked;
    // Court location is useful for dashboard map pins on every session,
    // even when DUPR export is disabled. Only DUPR sessions require it.
    if (field) {
      field.classList.remove('hidden');
      field.classList.toggle('is-required', duprEnabled);
    }
    if (input) {
      input.disabled = hasExistingQueue(currentState);
      input.required = duprEnabled;
      input.setAttribute('aria-required', String(duprEnabled));
      if (!duprEnabled || String(input.value || '').trim()) input.setCustomValidity('');
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
      setSelectedLocationCoordinates(currentState.duprLocationCoordinates || currentState.locationCoordinates || null);
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
          if (Number(payload && payload.revision) > sharedStateRevision) sharedStateRevision = Number(payload.revision) || sharedStateRevision;
          if (payload && payload.state && typeof payload.state === 'object') {
            const sessionChanged = sessionIdentityDiffers(payload.state, localState);
            const remoteIsTerminal = isEndedSession(payload.state);
            const localIsTerminal = isEndedSession(localState);
            if (sessionChanged || remoteIsTerminal || localIsTerminal || !readLocalPendingIsNewer(payload.updatedAt)) {
              currentState = payload.state;
              if (sessionChanged || remoteIsTerminal || localIsTerminal) persistRemoteState(currentState, payload.updatedAt);
            } else {
              currentState = localState;
            }
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

  function startSharedStateStream() {
    if (!(location.protocol === 'http:' || location.protocol === 'https:') || typeof EventSource === 'undefined') return;
    try {
      sharedStateSource = new EventSource('/api/shared-events');
      const source = sharedStateSource;
      source.addEventListener('app-state', event => {
        try {
          const payload = JSON.parse(event.data || '{}');
          const revision = Number(payload.revision) || 0;
          if (revision && revision <= sharedStateRevision) return;
          if (!payload.state || typeof payload.state !== 'object') return;
          if (revision) sharedStateRevision = revision;
          const localState = readLocalState();
          const sessionChanged = sessionIdentityDiffers(payload.state, currentState || localState);
          const remoteIsTerminal = isEndedSession(payload.state);
          const localIsTerminal = isEndedSession(currentState || localState);
          if (!sessionChanged && !remoteIsTerminal && !localIsTerminal && readLocalPendingIsNewer(payload.updatedAt)) return;
          currentState = payload.state;
          stateCheckComplete = true;
          if (sessionChanged || remoteIsTerminal || localIsTerminal) persistRemoteState(currentState, payload.updatedAt);
          applyQueueAvailability();
          if (!hasExistingQueue(currentState)) syncSessionName();
        } catch (_) {}
      });
      source.onerror = () => {
        // EventSource reconnects automatically; the existing polling remains as fallback.
      };
    } catch (_) {}
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
      duprLocationCoordinates: getSelectedLocationCoordinates(),
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
    window.location.assign('/queueing?create=1');
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
  $('liveQueueDuprLocation')?.addEventListener('change', event => {
    const input = event.currentTarget;
    if (!$('liveQueueDupr')?.checked || String(input.value || '').trim()) input.setCustomValidity('');
  });
  bindPhilippinesLocationAutocomplete();
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
    window.location.assign('/queueing');
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

  startSharedStateStream();

  // Keep this Start Screen's Existing Live Queue indicator fresh if the queue changes on another device.
  window.addEventListener('focus', () => { refreshSharedState(); });
  window.setInterval(() => { if (document.visibilityState !== 'hidden') refreshSharedState(); }, 15000);
})();
