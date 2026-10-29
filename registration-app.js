(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const registrationParams = new URLSearchParams(window.location.search);
  const organizerScope = String(registrationParams.get('organizer') || '').trim();
  const registrationSessionId = String(registrationParams.get('session') || '').trim();
  const registrationDuprSession = ['1', 'true', 'dupr'].includes(String(registrationParams.get('dupr') || '').trim().toLowerCase());
  let organizerValidated = false;
  let registrationSessionAvailable = false;
  let registrationSessionBlockReason = 'No active live session. Registration is closed until the organizer starts a new session.';
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
      const response = await fetch(scopedApiUrl('/api/app-state',{_:Date.now()}), {cache:'no-store',credentials:'same-origin'});
      const data = response.ok ? await response.json() : null;
      if (!data || String(data.organizerId || '') !== organizerScope) {
        showRegistrationLinkNotice('This organizer registration link is invalid or inactive. Please ask the organizer for an updated QR code or link.');
        return false;
      }
      organizerValidated = true;
      updateRegistrationSessionState(data.state);
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
  let selectedAvatarId = 'avatar-01';
  let cloudPlayers = [];
  let appPlayers = [];
  let serviceReady = false;
  let submitting = false;
  let cloudEvents = null;
  let eyebrowThemeEvents = null;
  let feedbackTimer = null;
  let feedbackHideTimer = null;

  function updateRegistrationSessionState(appState) {
    const sessionId = String(appState?.sessionId || '').trim();
    const active = appState?.sessionActive === true && !!sessionId && !appState?.sessionEndedAt;
    const sessionMismatch = active && !!registrationSessionId && registrationSessionId !== sessionId;
    registrationSessionAvailable = active && !sessionMismatch;
    if (sessionMismatch) {
      registrationSessionBlockReason = 'This registration QR belongs to a previous session. Please scan the current Register QR code from the organizer.';
    } else if (!active) {
      registrationSessionBlockReason = 'No active live session. The organizer has ended the session. Registration is unavailable until a new session starts.';
    } else {
      registrationSessionBlockReason = '';
    }

    const panel = $('registrationPagePanel');
    const notice = $('registrationLinkNotice');
    if (!organizerValidated) {
      if (panel) panel.hidden = true;
      updateSubmitButton();
      return;
    }
    if (!registrationSessionAvailable) {
      if (panel) panel.hidden = true;
      if (notice) {
        notice.textContent = registrationSessionBlockReason;
        notice.hidden = false;
      }
      setConnection(false, sessionMismatch ? 'Old QR code' : 'No live session');
    } else {
      if (panel) panel.hidden = false;
      if (notice) notice.hidden = true;
      setConnection(true, 'Live session active');
    }
    updateSubmitButton();
  }

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
    if (button) button.disabled = !(serviceReady && organizerValidated && registrationSessionAvailable && complete && !duplicate && !duplicateDupr && !submitting);
    return {fullname, duplicate, duplicateDupr, complete};
  }

  function selectAvatar(avatarId) {
    const value = String(avatarId || '');
    if (!/^avatar-(?:0[1-9]|1[0-9]|2[01])$/.test(value)) return;
    selectedAvatarId = value;
    document.querySelectorAll('.registration-avatar-option').forEach(button => {
      const selected = button.dataset.avatarId === value;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const selectedLabel = $('registrationAvatarSelectedLabel');
    if (selectedLabel) selectedLabel.textContent = `Avatar ${value.slice(-2)} selected`;
  }

  function bindAvatarPicker() {
    const carousel = $('registrationAvatarCarousel');
    if (!carousel) return;
    const options = Array.from(carousel.querySelectorAll('.registration-avatar-option'));
    const reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    function centerAvatar(button, behavior = 'smooth') {
      if (!button) return;
      const carouselRect = carousel.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const buttonCenter = buttonRect.left + buttonRect.width / 2;
      const carouselCenter = carouselRect.left + carousel.clientWidth / 2;
      const maxScroll = Math.max(0, carousel.scrollWidth - carousel.clientWidth);
      const targetLeft = Math.max(0, Math.min(maxScroll, carousel.scrollLeft + buttonCenter - carouselCenter));
      carousel.scrollTo({ left: targetLeft, behavior: reducedMotion ? 'auto' : behavior });
    }

    function nearestAvatarToCenter() {
      const center = carousel.getBoundingClientRect().left + carousel.clientWidth / 2;
      let nearest = null;
      let nearestDistance = Infinity;
      options.forEach(button => {
        const rect = button.getBoundingClientRect();
        const distance = Math.abs((rect.left + rect.width / 2) - center);
        if (distance < nearestDistance) {
          nearest = button;
          nearestDistance = distance;
        }
      });
      return nearest;
    }

    let suppressClickUntil = 0;
    options.forEach((button, index) => {
      button.addEventListener('click', event => {
        if (performance.now() < suppressClickUntil) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        selectAvatar(button.dataset.avatarId);
        centerAvatar(button);
      });
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        let nextIndex = index;
        if (event.key === 'ArrowRight') nextIndex = Math.min(options.length - 1, index + 1);
        if (event.key === 'ArrowLeft') nextIndex = Math.max(0, index - 1);
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = options.length - 1;
        const next = options[nextIndex];
        if (!next) return;
        next.focus({ preventScroll: true });
        selectAvatar(next.dataset.avatarId);
        centerAvatar(next);
      });
    });

    // Native touch scrolling keeps mobile momentum; desktop mouse dragging is handled here.
    let pointerStartX = 0;
    let pointerStartY = 0;
    let scrollStartX = 0;
    let draggingMouse = false;
    let dragMoved = false;
    let trackingTouchSwipe = false;
    let touchSwipeMoved = false;

    carousel.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse') {
        if (event.button !== 0) return;
        draggingMouse = true;
        dragMoved = false;
        pointerStartX = event.clientX;
        scrollStartX = carousel.scrollLeft;
        carousel.classList.add('is-dragging');
      } else {
        trackingTouchSwipe = true;
        touchSwipeMoved = false;
        pointerStartX = event.clientX;
        pointerStartY = event.clientY;
      }
    });

    window.addEventListener('pointermove', event => {
      if (draggingMouse) {
        const delta = event.clientX - pointerStartX;
        if (Math.abs(delta) > 5) dragMoved = true;
        if (dragMoved) {
          carousel.scrollLeft = scrollStartX - delta;
          if (event.cancelable) event.preventDefault();
        }
        return;
      }
      if (trackingTouchSwipe) {
        const deltaX = event.clientX - pointerStartX;
        const deltaY = event.clientY - pointerStartY;
        if (Math.abs(deltaX) > 9 && Math.abs(deltaX) > Math.abs(deltaY) * 1.15) {
          touchSwipeMoved = true;
        }
      }
    }, { passive: false });

    function finishPointerInteraction() {
      if (draggingMouse) {
        draggingMouse = false;
        carousel.classList.remove('is-dragging');
        if (dragMoved) {
          suppressClickUntil = performance.now() + 120;
          const nearest = nearestAvatarToCenter();
          if (nearest) {
            selectAvatar(nearest.dataset.avatarId);
            centerAvatar(nearest);
          }
        }
      }
      if (trackingTouchSwipe) {
        trackingTouchSwipe = false;
        if (touchSwipeMoved) suppressClickUntil = performance.now() + 120;
      }
      dragMoved = false;
      touchSwipeMoved = false;
    }

    window.addEventListener('pointerup', finishPointerInteraction);
    window.addEventListener('pointercancel', finishPointerInteraction);
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
      updateRegistrationSessionState(appStateData?.state);
      serviceReady = true;
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
          updateRegistrationSessionState(payload.state);
          updateSubmitButton();
        } catch (_) {}
      });
      cloudEvents.onerror = () => setConnection(false, 'Reconnecting');
      cloudEvents.onopen = () => setConnection(registrationSessionAvailable, registrationSessionAvailable ? 'Live session active' : 'No live session');
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
    selectAvatar('avatar-01');
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
    if (!registrationSessionAvailable) {
      await validateOrganizerRegistrationLink();
      if (!registrationSessionAvailable) {
        showFeedback(registrationSessionId ? 'Registration QR unavailable' : 'No active live session', registrationSessionBlockReason || 'Registration is closed until the organizer starts a live session.', true);
        return;
      }
    }
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
    if (!registrationSessionAvailable) {
      showFeedback(registrationSessionId ? 'Registration QR unavailable' : 'No active live session', registrationSessionBlockReason || 'Registration is closed until the organizer starts a live session.', true);
      return;
    }

    submitting = true;
    const button = $('registerSaveBtn');
    if (button) button.textContent = 'Registering…';
    updateSubmitButton();
    try {
      const registrationParamsForRequest = {dupr:registrationDuprSession?'1':'0'};
      if (registrationSessionId) registrationParamsForRequest.session = registrationSessionId;
      const response = await fetch(scopedApiUrl('/api/register-player', registrationParamsForRequest), {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        cache: 'no-store',
        body: JSON.stringify({name: fullname, nickname: $('registerNickname').value.trim(), gender: selectedGender, category: selectedSkill, avatarId:selectedAvatarId, duprId, selfRating, duprMatch:registrationDuprSession, organizerId:organizerScope, sessionId:registrationSessionId})
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 409 && data.noActiveSession) {
        updateRegistrationSessionState({sessionActive:data.sessionActive===true,sessionId:data.sessionId||null,sessionEndedAt:data.sessionEndedAt||null});
        showFeedback(data.sessionMismatch ? 'Registration QR expired' : 'No active live session', data.error || registrationSessionBlockReason, true);
        return;
      }
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
  bindAvatarPicker();
  syncDuprRegistrationFields();
  if ($('registrationPagePanel')) $('registrationPagePanel').hidden = true;
  if ($('registrationLinkNotice')) {
    $('registrationLinkNotice').textContent = 'Checking live session status…';
    $('registrationLinkNotice').hidden = false;
  }
  syncRegistrationEyebrowTheme();
  loadCloudRecords();
})();
