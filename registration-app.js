(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const organizerScope = String(new URLSearchParams(window.location.search).get('organizer') || '').trim();
  function scopedApiUrl(path, params = {}) {
    const url = new URL(path, window.location.origin);
    if (organizerScope) url.searchParams.set('organizer', organizerScope);
    Object.entries(params).forEach(([key,value]) => url.searchParams.set(key, String(value)));
    return url.pathname + url.search;
  }
  const SKILLS = new Set(['BEG', 'NOV', 'INT', 'ADV', 'EXP']);
  let selectedGender = '';
  let selectedSkill = '';
  let cloudPlayers = [];
  let appPlayers = [];
  let serviceReady = false;
  let submitting = false;
  let cloudEvents = null;
  let eyebrowThemeEvents = null;
  let previousQueueIds = new Set();
  let queueBaselineReady = false;
  const addedPlayerToastQueue = [];
  const recentlyNotifiedPlayers = new Map();
  let addedPlayerToastActive = false;
  let addedPlayerToastTimer = null;

  const LIVE_THEME_STORAGE_KEY = 'picklepoint_live_view_theme_v1';

  function applyRegistrationEyebrowTheme(theme) {
    const eyebrow = document.querySelector('.registration-page-intro .eyebrow');
    if (!eyebrow || !['light', 'night'].includes(theme)) return;
    eyebrow.dataset.liveTheme = theme;
  }

  async function syncRegistrationEyebrowTheme() {
    try {
      applyRegistrationEyebrowTheme(localStorage.getItem(LIVE_THEME_STORAGE_KEY));
    } catch (_) {}

    try {
      const response = await fetch(`/api/live-theme?_=${Date.now()}`, {cache: 'no-store'});
      if (response.ok) {
        const data = await response.json();
        applyRegistrationEyebrowTheme(data?.theme);
      }
    } catch (_) {}

    if (!eyebrowThemeEvents && typeof EventSource !== 'undefined' && ['http:', 'https:'].includes(location.protocol)) {
      try {
        eyebrowThemeEvents = new EventSource(scopedApiUrl('/api/live-events'));
        eyebrowThemeEvents.addEventListener('live-theme', event => {
          applyRegistrationEyebrowTheme(String(event.data || '').trim());
        });
      } catch (_) { eyebrowThemeEvents = null; }
    }
  }

  window.addEventListener('storage', event => {
    if (event.key === LIVE_THEME_STORAGE_KEY) {
      applyRegistrationEyebrowTheme(event.newValue);
    }
  });

  function normalizedName(value) {
    return String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  }

  function formatName(value) {
    return String(value || '').replace(/\S+/g, word => {
      const chars = Array.from(word);
      if (!chars.length) return word;
      const first = chars[0];
      const formatted = (first === 'ñ' || first === 'Ñ') ? 'Ñ' : first.toUpperCase();
      return formatted + chars.slice(1).join('').toLowerCase();
    });
  }

  function setConnection(connected, label) {
    const status = $('registrationConnectionStatus');
    if (!status) return;
    status.classList.toggle('connected', !!connected);
    status.classList.toggle('local', !connected);
    const text = status.querySelector('span');
    if (text) text.textContent = label || (connected ? 'Connected' : 'Offline');
  }

  function showRegistrationError(message) {
    // Keep actionable errors visible in the existing result panel instead of a status banner.
    showResult('Please check your registration', message, true);
  }

  function updateAppPlayers(state) {
    const players = Array.isArray(state?.players) ? state.players : [];
    const left = Array.isArray(state?.left) ? state.left : [];
    appPlayers = players.concat(left).filter(player => player && player.name);
  }

  function primeQueueWatcher(state) {
    if (queueBaselineReady || !state || !Array.isArray(state.queue)) return;
    previousQueueIds = new Set(state.queue.map(id => String(id)));
    queueBaselineReady = true;
  }

  function observeQueueState(state) {
    if (!state || !Array.isArray(state.queue)) return;
    const currentQueueIds = new Set(state.queue.map(id => String(id)));
    if (!queueBaselineReady) {
      previousQueueIds = currentQueueIds;
      queueBaselineReady = true;
      return;
    }

    const newlyQueuedIds = [...currentQueueIds].filter(id => !previousQueueIds.has(id));
    previousQueueIds = currentQueueIds;
    if (!newlyQueuedIds.length) return;

    const roster = (Array.isArray(state.players) ? state.players : [])
      .concat(Array.isArray(state.left) ? state.left : []);
    newlyQueuedIds.forEach(id => {
      const player = roster.find(item => item && String(item.id) === id);
      if (player && player.name) notifyPlayerAdded(player.name);
    });
  }

  function notifyPlayerAdded(name) {
    const cleanName = String(name || '').trim();
    if (!cleanName) return;
    const key = normalizedName(cleanName);
    const now = Date.now();
    const lastNotified = recentlyNotifiedPlayers.get(key);
    // A local registration response and its shared app-state event can arrive together.
    // Suppress that duplicate, while still allowing later queue re-entries to notify again.
    if (lastNotified && now - lastNotified < 4500) return;
    recentlyNotifiedPlayers.set(key, now);
    if (recentlyNotifiedPlayers.size > 100) {
      for (const [playerKey, timestamp] of recentlyNotifiedPlayers) {
        if (now - timestamp > 15000) recentlyNotifiedPlayers.delete(playerKey);
      }
    }
    addedPlayerToastQueue.push(cleanName);
    if (!addedPlayerToastActive) displayNextAddedPlayerToast();
  }

  function displayNextAddedPlayerToast() {
    const toast = $('registrationQueueAddedToast');
    const name = $('registrationQueueAddedName');
    if (!toast || !name) {
      addedPlayerToastQueue.length = 0;
      addedPlayerToastActive = false;
      return;
    }
    const nextName = addedPlayerToastQueue.shift();
    if (!nextName) {
      addedPlayerToastActive = false;
      return;
    }

    // Keep the toast compact by showing only the player's first name.
    const firstName = String(nextName).trim().split(/\s+/)[0] || String(nextName).trim();
    addedPlayerToastActive = true;
    name.textContent = firstName;
    toast.hidden = false;
    toast.classList.remove('is-visible');
    window.requestAnimationFrame(() => toast.classList.add('is-visible'));

    window.clearTimeout(addedPlayerToastTimer);
    addedPlayerToastTimer = window.setTimeout(() => {
      toast.classList.remove('is-visible');
      window.setTimeout(() => {
        toast.hidden = true;
        if (addedPlayerToastQueue.length) displayNextAddedPlayerToast();
        else addedPlayerToastActive = false;
      }, 390);
    }, 2900);
  }

  function duplicatePlayer(name) {
    const normalized = normalizedName(name);
    if (!normalized) return null;
    return cloudPlayers.find(player => normalizedName(player && player.name) === normalized)
      || appPlayers.find(player => normalizedName(player && player.name) === normalized)
      || null;
  }

  function updateDuplicateMessage() {
    const input = $('registerFullname');
    const message = $('registrationDuplicateMessage');
    if (!input || !message) return null;
    const fullname = input.value.trim();
    const duplicate = duplicatePlayer(fullname);
    if (duplicate) {
      message.textContent = `This user is already registered: ${duplicate.name}`;
      message.hidden = false;
    } else {
      message.textContent = '';
      message.hidden = true;
    }
    return duplicate;
  }

  function updateSubmitButton() {
    const fullname = String($('registerFullname')?.value || '').trim();
    const duplicate = updateDuplicateMessage();
    const duprId = String($('registerDuprId')?.value || '').trim();
    const complete = fullname.length > 0 && /^[A-Z0-9]{6}$/.test(duprId.toUpperCase()) && !!selectedGender && SKILLS.has(selectedSkill);
    const button = $('registerSaveBtn');
    if (button) button.disabled = !(serviceReady && complete && !duplicate && !submitting);
    return {fullname, duplicate, complete};
  }

  function selectGender(gender) {
    if (!['Male', 'Female'].includes(gender)) return;
    selectedGender = gender;
    document.querySelectorAll('.gender-choice').forEach(button => {
      button.classList.toggle('selected', button.dataset.gender === gender);
      button.setAttribute('aria-pressed', String(button.dataset.gender === gender));
    });
    updateSubmitButton();
  }

  function selectSkill(skill) {
    const value = String(skill || '').toUpperCase();
    if (!SKILLS.has(value)) return;
    selectedSkill = value;
    document.querySelectorAll('.registration-skill-btn').forEach(button => {
      const selected = button.dataset.skill === value;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    updateSubmitButton();
  }

  async function loadCloudRecords() {
    try {
      const appStateRequest = fetch(scopedApiUrl('/api/app-state',{_:Date.now()}), {cache: 'no-store'})
        .then(response => response.ok ? response.json() : null)
        .catch(() => null);
      const response = await fetch(`/api/cloud-records?_=${Date.now()}`, {cache: 'no-store'});
      if (!response.ok) throw new Error('Registered Player Cloud is unavailable.');
      const [data, appStateData] = await Promise.all([response.json(), appStateRequest]);
      cloudPlayers = Array.isArray(data.records?.players) ? data.records.players : [];
      primeQueueWatcher(appStateData?.state);
      updateAppPlayers(appStateData?.state);
      serviceReady = true;
      setConnection(true, 'Connected');
      updateSubmitButton();
      bindCloudEvents();
      return true;
    } catch (error) {
      serviceReady = false;
      setConnection(false, 'Offline');
      showRegistrationError('Registration needs the Pickle Point Match server. Open this page using the hosted app link, then try again.');
      updateSubmitButton();
      return false;
    }
  }

  function bindCloudEvents() {
    if (cloudEvents || !('EventSource' in window)) return;
    try {
      cloudEvents = new EventSource(scopedApiUrl('/api/shared-events'));
      cloudEvents.addEventListener('cloud-records', event => {
        try {
          const payload = JSON.parse(event.data);
          cloudPlayers = Array.isArray(payload.records?.players) ? payload.records.players : [];
          updateSubmitButton();
        } catch (_) {}
      });
      cloudEvents.addEventListener('app-state', event => {
        try {
          const payload = JSON.parse(event.data);
          observeQueueState(payload.state);
          updateAppPlayers(payload.state);
          updateSubmitButton();
        } catch (_) {}
      });
      cloudEvents.onerror = () => setConnection(false, 'Reconnecting');
      cloudEvents.onopen = () => setConnection(true, 'Connected');
    } catch (_) {
      cloudEvents = null;
    }
  }

  function resetForm() {
    $('registerFullname').value = '';
    $('registerNickname').value = '';
    $('registerDuprId').value = '';
    $('registerSelfRating').value = '';
    selectedGender = '';
    selectedSkill = '';
    document.querySelectorAll('.gender-choice').forEach(button => {
      button.classList.remove('selected');
      button.setAttribute('aria-pressed', 'false');
    });
    document.querySelectorAll('.registration-skill-btn').forEach(button => {
      button.classList.remove('selected');
      button.setAttribute('aria-pressed', 'false');
    });
    updateSubmitButton();
  }

  function showResult(title, detail, error = false) {
    const result = $('registrationPageResult');
    if (!result) return;
    result.classList.toggle('is-error', error);
    result.innerHTML = `<strong></strong><span></span>`;
    result.querySelector('strong').textContent = title;
    result.querySelector('span').textContent = detail;
    result.hidden = false;
  }

  async function submitRegistration() {
    if (submitting) return;
    const {fullname, duplicate, complete} = updateSubmitButton();
    const result = $('registrationPageResult');
    if (result) result.hidden = true;
    if (duplicate) {
      showResult('This user is already registered', `${duplicate.name} is already saved in Registered Player Cloud. No duplicate profile was created.`, true);
      return;
    }
    if (!fullname) { showRegistrationError('Please enter the player’s full name.'); $('registerFullname').focus(); return; }
    const duprId = String($('registerDuprId')?.value || '').trim().toUpperCase();
    const selfRating = String($('registerSelfRating')?.value || '').trim();
    if (!duprId) { showRegistrationError('Please enter the player’s DUPR ID.'); $('registerDuprId').focus(); return; }
    if (!/^[A-Z0-9]{6}$/.test(duprId)) { showRegistrationError('DUPR ID must contain exactly 6 letters or numbers (for example, 1A2B3C).'); $('registerDuprId').focus(); return; }
    if (selfRating && !/^\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?$/.test(selfRating)) { showRegistrationError('Enter self rating as a number, such as 2.5, or a range such as 2.5/4.0.'); $('registerSelfRating').focus(); return; }
    if (!selectedGender) { showRegistrationError('Please select Male or Female.'); return; }
    if (!SKILLS.has(selectedSkill)) { showRegistrationError('Please select a skill level.'); return; }
    if (!serviceReady || !complete) {
      await loadCloudRecords();
      if (!serviceReady) return;
    }

    submitting = true;
    const button = $('registerSaveBtn');
    if (button) button.textContent = 'Registering…';
    updateSubmitButton();
    try {
      const response = await fetch('/api/register-player', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        cache: 'no-store',
        body: JSON.stringify({name: fullname, nickname: $('registerNickname').value.trim(), gender: selectedGender, category: selectedSkill, duprId, selfRating, ...(organizerScope ? {organizerId:organizerScope} : {})})
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 409 && data.duplicate) {
        const player = data.player || {name: fullname};
        if (!duplicatePlayer(player.name)) cloudPlayers.push(player);
        updateDuplicateMessage();
        showResult('This user is already registered', `${player.name} is already saved in Registered Player Cloud. No duplicate profile was created.`, true);
        return;
      }
      if (!response.ok || !data.ok) throw new Error(data.error || 'Unable to register this player. Please try again.');

      cloudPlayers.push(data.player);
      if (data.queued) notifyPlayerAdded(data.player.name);
      resetForm();
      $('registerFullname').focus();
    } catch (error) {
      if (error instanceof TypeError) {
        showResult('Registration not completed', 'The server did not confirm the save. Please retry before closing this page.', true);
      } else {
        showResult('Registration not completed', error.message || 'Please try again.', true);
      }
    } finally {
      submitting = false;
      if (button) button.textContent = 'Register & Add to Queue';
      updateSubmitButton();
    }
  }

  function bindNameHelpers() {
    ['registerFullname', 'registerNickname'].forEach(id => {
      const input = $(id);
      input.addEventListener('input', () => {
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        input.value = formatName(input.value);
        try { input.setSelectionRange(start, end); } catch (_) {}
        updateSubmitButton();
        const result = $('registrationPageResult');
        if (result && !result.hidden) result.hidden = true;
      });
    });
    document.querySelectorAll('.registration-enye-btn').forEach(button => {
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => {
        const input = $(button.dataset.target);
        if (!input) return;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        input.focus();
        input.setRangeText('Ñ', start, end, 'end');
        input.dispatchEvent(new Event('input', {bubbles: true}));
      });
    });
  }

  document.querySelectorAll('.gender-choice').forEach(button => button.addEventListener('click', () => selectGender(button.dataset.gender)));
  document.querySelectorAll('.registration-skill-btn').forEach(button => button.addEventListener('click', () => selectSkill(button.dataset.skill)));
  $('registerSaveBtn').addEventListener('click', submitRegistration);
  $('registerFullname').addEventListener('keydown', event => { if (event.key === 'Enter') submitRegistration(); });
  $('registerDuprId').addEventListener('input', () => {
    const input = $('registerDuprId');
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    try { input.setSelectionRange(Math.min(start, input.value.length), Math.min(end, input.value.length)); } catch (_) {}
    updateSubmitButton();
    const result = $('registrationPageResult');
    if (result && !result.hidden) result.hidden = true;
  });
  $('registerSelfRating').addEventListener('input', () => {
    const input = $('registerSelfRating');
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.value = input.value.replace(/[^0-9./]/g, '').slice(0, 20);
    try { input.setSelectionRange(Math.min(start, input.value.length), Math.min(end, input.value.length)); } catch (_) {}
    updateSubmitButton();
    const result = $('registrationPageResult');
    if (result && !result.hidden) result.hidden = true;
  });
  bindNameHelpers();
  syncRegistrationEyebrowTheme();
  loadCloudRecords();
})();
