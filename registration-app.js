(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const registrationParams = new URLSearchParams(window.location.search);
  const organizerScope = String(registrationParams.get('organizer') || '').trim();
  const registrationDuprSession = ['1', 'true', 'dupr'].includes(String(registrationParams.get('dupr') || '').trim().toLowerCase());
  let organizerValidated = false;
  function scopedApiUrl(path, params = {}) {
    const url = new URL(path, window.location.origin);
    if (organizerScope) url.searchParams.set('organizer', organizerScope);
    Object.entries(params).forEach(([key,value]) => url.searchParams.set(key, String(value)));
    return url.pathname + url.search;
  }

  function showRegistrationLinkNotice(message) {
    const notice = $('registrationLinkNotice');
    if (notice) { notice.textContent = message; notice.hidden = false; }
    const panel = $('registrationPagePanel');
    if (panel) panel.hidden = true;
    setConnection(false, 'Organizer link required');
  }

  async function validateOrganizerRegistrationLink() {
    if (!organizerScope) {
      showRegistrationLinkNotice('This registration page is organizer-specific. Please scan the registration QR code or open the link provided by your organizer.');
      return false;
    }
    try {
      const response = await fetch(`/api/live-state?organizer=${encodeURIComponent(organizerScope)}`, {cache:'no-store',credentials:'same-origin'});
      const data = response.ok ? await response.json() : null;
      if (!data || String(data.organizerId || '') !== organizerScope) {
        showRegistrationLinkNotice('This organizer registration link is invalid or inactive. Please ask the organizer for an updated QR code or link.');
        return false;
      }
      organizerValidated = true;
      return true;
    } catch (_) {
      setConnection(false, 'Offline');
      showRegistrationError('Unable to verify this organizer link. Reconnect to the internet and try again.');
      return false;
    }
  }

  function syncDuprRegistrationFields() {
    const extras = $('registrationExtraFields');
    const duprId = $('registerDuprId');
    const rating = $('registerSelfRating');
    if (extras) extras.hidden = !registrationDuprSession;
    if (duprId) {
      duprId.required = registrationDuprSession;
      duprId.disabled = !registrationDuprSession;
      duprId.setAttribute('aria-required', String(registrationDuprSession));
    }
    if (rating) rating.disabled = !registrationDuprSession;
    const duprMessage = $('registrationDuprDuplicateMessage');
    if (duprMessage && !registrationDuprSession) { duprMessage.hidden = true; duprMessage.textContent = ''; }
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
  let feedbackTimer = null;
  let feedbackHideTimer = null;

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
    showFeedback('Please check your registration', message, true);
  }

  function updateAppPlayers(state) {
    const players = Array.isArray(state?.players) ? state.players : [];
    const left = Array.isArray(state?.left) ? state.left : [];
    appPlayers = players.concat(left).filter(player => player && player.name);
  }

  function hideFeedback() {
    const toast = $('registrationFeedbackToast');
    if (!toast) return;
    window.clearTimeout(feedbackTimer);
    window.clearTimeout(feedbackHideTimer);
    toast.classList.remove('is-visible');
    feedbackHideTimer = window.setTimeout(() => {
      toast.hidden = true;
      feedbackHideTimer = null;
    }, 260);
  }

  function showFeedback(title, detail, error = false) {
    const toast = $('registrationFeedbackToast');
    const titleNode = $('registrationFeedbackTitle');
    const detailNode = $('registrationFeedbackMessage');
    if (!toast || !titleNode || !detailNode) return;
    window.clearTimeout(feedbackTimer);
    window.clearTimeout(feedbackHideTimer);
    feedbackHideTimer = null;
    titleNode.textContent = title;
    detailNode.textContent = detail;
    toast.classList.toggle('is-error', error);
    toast.hidden = false;
    toast.classList.remove('is-visible');
    window.requestAnimationFrame(() => toast.classList.add('is-visible'));
    feedbackTimer = window.setTimeout(() => {
      toast.classList.remove('is-visible');
      feedbackHideTimer = window.setTimeout(() => {
        toast.hidden = true;
        feedbackHideTimer = null;
      }, 260);
    }, 4200);
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

  function duplicateDuprPlayer(duprId) {
    const normalizedId = String(duprId || '').trim().toUpperCase();
    if (!normalizedId) return null;
    return cloudPlayers.find(player => {
      const registeredId = String(player?.duprId ?? player?.duprID ?? player?.dupr_id ?? '')
        .trim().replace(/^DUPR\s*:\s*/i, '').replace(/\s+/g, '').toUpperCase();
      return registeredId === normalizedId;
    }) || null;
  }

  function updateDuprDuplicateMessage() {
    const input = $('registerDuprId');
    if (!registrationDuprSession) {
      const hiddenMessage = $('registrationDuprDuplicateMessage');
      if (hiddenMessage) { hiddenMessage.textContent = ''; hiddenMessage.hidden = true; }
      return null;
    }
    const message = $('registrationDuprDuplicateMessage');
    if (!input || !message) return null;
    const duprId = input.value.trim().toUpperCase();
    const duplicate = duplicateDuprPlayer(duprId);
    if (duplicate) {
      message.textContent = `This DUPR ID: ${duprId} is already registered under the name: ${duplicate.name}.`;
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
    const duplicateDupr = updateDuprDuplicateMessage();
    const duprComplete = !registrationDuprSession || /^[A-Z0-9]{6}$/.test(duprId.toUpperCase());
    const complete = fullname.length > 0 && duprComplete && !!selectedGender && SKILLS.has(selectedSkill);
    const button = $('registerSaveBtn');
    if (button) button.disabled = !(serviceReady && organizerValidated && complete && !duplicate && !duplicateDupr && !submitting);
    return {fullname, duplicate, duplicateDupr, complete};
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
    if (!organizerValidated && !(await validateOrganizerRegistrationLink())) {
      serviceReady = false;
      updateSubmitButton();
      return false;
    }
    try {
      const appStateRequest = fetch(scopedApiUrl('/api/app-state',{_:Date.now()}), {cache: 'no-store',credentials:'same-origin'})
        .then(response => response.ok ? response.json() : null)
        .catch(() => null);
      const response = await fetch(scopedApiUrl('/api/cloud-records',{_:Date.now()}), {cache: 'no-store',credentials:'same-origin'});
      if (!response.ok) throw new Error('Registered Player Cloud is unavailable.');
      const [data, appStateData] = await Promise.all([response.json(), appStateRequest]);
      cloudPlayers = Array.isArray(data.records?.players) ? data.records.players : [];
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

  async function submitRegistration() {
    if (submitting) return;
    const {fullname, duplicate, duplicateDupr, complete} = updateSubmitButton();
    hideFeedback();
    if (duplicateDupr) {
      const duprId = String($('registerDuprId')?.value || '').trim().toUpperCase();
      showFeedback('DUPR ID already registered', `This DUPR ID: ${duprId} is already registered under the name: ${duplicateDupr.name}.`, true);
      return;
    }
    if (duplicate) {
      showFeedback('This user is already registered', `${duplicate.name} is already saved in Registered Player Cloud. No duplicate profile was created.`, true);
      return;
    }
    if (!fullname) { showRegistrationError('Please enter the player’s full name.'); $('registerFullname').focus(); return; }
    const duprId = registrationDuprSession ? String($('registerDuprId')?.value || '').trim().toUpperCase() : '';
    const selfRating = registrationDuprSession ? String($('registerSelfRating')?.value || '').trim() : '';
    if (registrationDuprSession && !duprId) { showRegistrationError('Please enter the player’s DUPR ID.'); $('registerDuprId').focus(); return; }
    if (registrationDuprSession && !/^[A-Z0-9]{6}$/.test(duprId)) { showRegistrationError('DUPR ID must contain exactly 6 letters or numbers (for example, 1A2B3C).'); $('registerDuprId').focus(); return; }
    if (registrationDuprSession && selfRating && !/^\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?$/.test(selfRating)) { showRegistrationError('Enter self rating as a number, such as 2.5, or a range such as 2.5/4.0.'); $('registerSelfRating').focus(); return; }
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
      const response = await fetch(scopedApiUrl('/api/register-player', {dupr:registrationDuprSession?'1':'0'}), {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        cache: 'no-store',
        body: JSON.stringify({name: fullname, nickname: $('registerNickname').value.trim(), gender: selectedGender, category: selectedSkill, duprId, selfRating, duprMatch:registrationDuprSession, organizerId:organizerScope})
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 409 && data.duplicate) {
        const player = data.player || {name: fullname};
        if (data.duplicateType === 'duprId') {
          if (!duplicateDuprPlayer(player.duprId || duprId)) cloudPlayers.push({...player, duprId:player.duprId || duprId});
          updateSubmitButton();
          showFeedback('DUPR ID already registered', `This DUPR ID: ${duprId} is already registered under the name: ${player.name}.`, true);
        } else {
          if (!duplicatePlayer(player.name)) cloudPlayers.push(player);
          updateDuplicateMessage();
          showFeedback('This user is already registered', `${player.name} is already saved in Registered Player Cloud. No duplicate profile was created.`, true);
        }
        return;
      }
      if (!response.ok || !data.ok) throw new Error(data.error || 'Unable to register this player. Please try again.');

      if (!cloudPlayers.some(player => normalizedName(player && player.name) === normalizedName(data.player.name))) {
        cloudPlayers.push(data.player);
      }
      showFeedback('Registered Player', `${data.player.name} was Registered.`);
      resetForm();
      $('registerFullname').focus();
    } catch (error) {
      if (error instanceof TypeError) {
        showFeedback('Registration not completed', 'The server did not confirm the save. Please retry before closing this page.', true);
      } else {
        showFeedback('Registration not completed', error.message || 'Please try again.', true);
      }
    } finally {
      submitting = false;
      if (button) button.textContent = 'Save to Registered Player Cloud';
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
        hideFeedback();
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
    hideFeedback();
  });
  $('registerSelfRating').addEventListener('input', () => {
    const input = $('registerSelfRating');
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.value = input.value.replace(/[^0-9./]/g, '').slice(0, 20);
    try { input.setSelectionRange(Math.min(start, input.value.length), Math.min(end, input.value.length)); } catch (_) {}
    updateSubmitButton();
    hideFeedback();
  });
  bindNameHelpers();
  syncDuprRegistrationFields();
  syncRegistrationEyebrowTheme();
  loadCloudRecords();
})();
