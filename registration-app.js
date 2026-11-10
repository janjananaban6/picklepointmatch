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
  let registrationLinkInvalid = false;
  let registrationValidationPromise = null;
  let cloudRetryTimer = null;
  let cloudLoadPromise = null;
  const CLOUD_RETRY_DELAY_MS = 5000;

  function scopedApiUrl(path, params = {}) {
    const url = new URL(path, window.location.origin);
    if (organizerScope) url.searchParams.set('organizer', organizerScope);
    Object.entries(params).forEach(([key,value]) => url.searchParams.set(key, String(value)));
    return url.pathname + url.search;
  }

  function showRegistrationLinkNotice(message) {
    registrationLinkInvalid = true;
    const notice = $('registrationLinkNotice');
    if (notice) { notice.textContent = message; notice.hidden = false; }
    const panel = $('registrationPagePanel');
    if (panel) panel.hidden = true;
    setConnection(false, 'Organizer link required');
    updateSubmitButton();
  }

  function showRegistrationFormWhileConnecting(message) {
    if (!organizerScope || registrationLinkInvalid) return;
    const panel = $('registrationPagePanel');
    const notice = $('registrationLinkNotice');
    if (panel) panel.hidden = false;
    if (notice) {
      notice.textContent = message || 'Connecting to the organizer server. You can complete the form now; the server will verify the live session when you save.';
      notice.hidden = false;
    }
    setConnection(false, navigator.onLine === false ? 'Offline' : 'Reconnecting');
    updateSubmitButton();
  }

  async function validateOrganizerRegistrationLink() {
    if (!organizerScope) {
      showRegistrationLinkNotice('This registration page is organizer-specific. Please scan the registration QR code or open the link provided by your organizer.');
      return false;
    }
    if (registrationLinkInvalid) return false;
    if (organizerValidated) return true;
    if (registrationValidationPromise) return registrationValidationPromise;

    registrationValidationPromise = (async () => {
      try {
        const response = await fetch(scopedApiUrl('/api/app-state',{_:Date.now()}), {cache:'no-store',credentials:'same-origin'});
        if (response.status === 400 || response.status === 401 || response.status === 403 || response.status === 404) {
          const data = await response.json().catch(() => ({}));
          showRegistrationLinkNotice(data.error || 'This organizer registration link is invalid or inactive. Please ask the organizer for an updated QR code or link.');
          return false;
        }
        if (!response.ok) {
          showRegistrationFormWhileConnecting('The organizer server is temporarily unavailable. Complete the form and try Save again; the server will verify the live session before adding the player.');
          return false;
        }
        const data = await response.json();
        if (!data || (String(data.organizerId || '') !== organizerScope && String(data.organizerSlug || '').toLowerCase() !== organizerScope.toLowerCase())) {
          showRegistrationLinkNotice('This organizer registration link is invalid or inactive. Please ask the organizer for an updated QR code or link.');
          return false;
        }
        registrationLinkInvalid = false;
        organizerValidated = true;
        // Load the organizer's current queue before rendering cloud suggestions,
        // so players already checked in on another device show as completed.
        updateAppPlayers(data.state);
        updateRegistrationSessionState(data.state);
        const searchInput = $('registerFullname');
        if (!selectedCloudPlayer && searchInput?.value.trim()) renderPlayerSuggestions(searchInput.value);
        return true;
      } catch (_) {
        showRegistrationFormWhileConnecting('Unable to reach the organizer server right now. You may complete the form; Save will verify the live session directly with the server.');
        return false;
      } finally {
        registrationValidationPromise = null;
      }
    })();
    return registrationValidationPromise;
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
  const SKILL_VALUES = {
    BEG: 'BEG', BEGINNER: 'BEG', BEGINNERS: 'BEG',
    NOV: 'NOV', NOVICE: 'NOV', NOVICES: 'NOV',
    INT: 'INT', INTERMEDIATE: 'INT',
    ADV: 'ADV', ADVANCE: 'ADV', ADVANCED: 'ADV',
    EXP: 'EXP', EXPERT: 'EXP', EXPERTS: 'EXP'
  };
  // Labels match the Registered Player Cloud list exactly.
  const SKILL_LABELS = {BEG:'BEGINNERS', NOV:'NOVICE', INT:'INTERMEDIATE', ADV:'ADVANCE', EXP:'EXPERT'};

  function normalizeSkillCategory(value) {
    // Match queueing.html's cloudCategoryCode(): accept category names and
    // legacy labels even when a cloud record has extra text after the label.
    const token = String(value || '').trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (/^(BEG|BEGINNER|BEGINNERS)/.test(token)) return 'BEG';
    if (/^(NOV|NOVICE|NOVICES)/.test(token)) return 'NOV';
    if (/^(INT|INTERMEDIATE)/.test(token)) return 'INT';
    if (/^(ADV|ADVANCE|ADVANCED)/.test(token)) return 'ADV';
    if (/^(EXP|EXPERT|EXPERTS)/.test(token)) return 'EXP';
    return SKILL_VALUES[token] || '';
  }

  function normalizePlayerSkill(player) {
    const candidates = [player?.category, player?.skill, player?.level, player?.skillLevel, player?.skill_level, player?.playerCategory, player?.player_category];
    for (const value of candidates) {
      const normalized = normalizeSkillCategory(value);
      if (normalized) return normalized;
    }
    return '';
  }

  function normalizePlayerGender(player) {
    const candidates = [player?.gender, player?.sex, player?.playerGender, player?.player_gender];
    for (const value of candidates) {
      const token = String(value || '').trim().toLowerCase();
      if (['male', 'm', 'man', 'men'].includes(token)) return 'Male';
      if (['female', 'f', 'woman', 'women'].includes(token)) return 'Female';
    }
    return '';
  }
  let selectedGender = '';
  let selectedSkill = '';
  let selectedAvatarId = '';
  let selectedCloudPlayer = null;
  let cloudPlayers = [];
  let appPlayers = [];
  let submitting = false;
  let cloudEvents = null;
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
      if (panel) panel.hidden = !organizerScope || registrationLinkInvalid;
      if (organizerScope && !registrationLinkInvalid) {
        if (notice) {
          notice.textContent = 'Connecting to the organizer server. You can complete the form now; the server will verify the live session when you save.';
          notice.hidden = false;
        }
        setConnection(false, navigator.onLine === false ? 'Offline' : 'Reconnecting');
      }
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
    // Registration.html currently has no live-theme eyebrow. Do not open a
    // second, long-lived EventSource for an element that is not on this page:
    // the cloud/session EventSource below is the only stream registration needs.
    const eyebrow = document.querySelector('.registration-page-intro .eyebrow');
    if (!eyebrow) return;

    try {
      applyRegistrationEyebrowTheme(localStorage.getItem(LIVE_THEME_STORAGE_KEY));
    } catch (_) {}

    // A one-time theme read is sufficient here. Avoid a separate /api/live-events
    // connection so registration cannot consume another browser connection slot.
    try {
      const response = await fetch(`/api/live-theme?_=${Date.now()}`, {cache: 'no-store'});
      if (response.ok) {
        const data = await response.json();
        applyRegistrationEyebrowTheme(data?.theme);
      }
    } catch (_) {}
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

  function isSelectedCloudPlayer(player = selectedCloudPlayer) {
    const fullname = String($('registerFullname')?.value || '').trim();
    return !!(player && String(player.cloudId ?? '').trim() && normalizedName(fullname) === normalizedName(player.name));
  }

  function queueDuplicateForCloudPlayer(player) {
    if (!player) return null;
    const cloudId = String(player.cloudId ?? '').trim();
    const playerName = normalizedName(player.name);
    if (!cloudId && !playerName) return null;
    return appPlayers.find(candidate =>
      (cloudId && String(candidate?.registeredCloudId || candidate?.registrationCloudId || '').trim() === cloudId)
      || (playerName && normalizedName(candidate?.name) === playerName)
    ) || null;
  }

  function queueDuplicateForSelectedPlayer() {
    if (!isSelectedCloudPlayer()) return null;
    return queueDuplicateForCloudPlayer(selectedCloudPlayer);
  }

  function updateDuplicateMessage() {
    const input = $('registerFullname');
    const message = $('registrationDuplicateMessage');
    if (!input || !message) return null;
    const fullname = input.value.trim();
    let duplicate = null;
    if (isSelectedCloudPlayer()) {
      duplicate = queueDuplicateForSelectedPlayer();
      if (duplicate) {
        message.textContent = `${selectedCloudPlayer.name} is already in this organizer’s live session.`;
        message.hidden = false;
      } else {
        message.textContent = '';
        message.hidden = true;
      }
      return duplicate;
    }
    duplicate = duplicatePlayer(fullname);
    if (duplicate) {
      message.textContent = `This player is already registered: ${duplicate.name}. Select the player from the suggestions to check in.`;
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
    if (isSelectedCloudPlayer() && duplicate && String(duplicate.cloudId ?? '') === String(selectedCloudPlayer.cloudId ?? '')) {
      message.textContent = '';
      message.hidden = true;
      return null;
    }
    if (duplicate) {
      message.textContent = `This DUPR ID: ${duprId} is already registered under the name: ${duplicate.name}.`;
      message.hidden = false;
    } else {
      message.textContent = '';
      message.hidden = true;
    }
    return duplicate;
  }

  function registrationGenderSvgIcon(gender) {
    const value = String(gender || '').trim().toLowerCase();
    const isFemale = ['female', 'f', 'woman', 'women'].includes(value);
    return isFemale
      ? '<svg class="gender-symbol gender-symbol-female" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="4.8" r="3.55" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 8.4v5.9M5.25 11.35h5.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
      : '<svg class="gender-symbol gender-symbol-male" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="5.35" cy="10.65" r="3.45" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7.8 8.2 14.1 1.9M9.35 1.9h4.75v4.75" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function updateSubmitButton() {
    const fullname = String($('registerFullname')?.value || '').trim();
    const isCloudCheckIn = isSelectedCloudPlayer();
    const duplicate = updateDuplicateMessage();
    const duprId = String($('registerDuprId')?.value || '').trim();
    const duplicateDupr = isCloudCheckIn ? null : updateDuprDuplicateMessage();
    const duprComplete = !registrationDuprSession || /^[A-Z0-9]{6}$/.test(duprId.toUpperCase());
    // A selected cloud profile pre-fills the form, but nickname, gender, and
    // skill remain editable. Check In submits those current form values so
    // both the queue entry and the saved cloud profile use the edited details.
    const complete = isCloudCheckIn
      ? !!(fullname && selectedCloudPlayer?.cloudId && isSelectedCloudPlayer()
          && ['Male','Female'].includes(selectedGender) && SKILLS.has(selectedSkill))
      : fullname.length > 0 && duprComplete && !!selectedGender && SKILLS.has(selectedSkill);
    const button = $('registerSaveBtn');
    if (button) {
      button.textContent = submitting
        ? (isCloudCheckIn ? 'Checking In…' : 'Registering…')
        : (isCloudCheckIn ? 'Check In' : 'Register as a Player');
      button.disabled = !(!!organizerScope && !registrationLinkInvalid && (!organizerValidated || registrationSessionAvailable) && complete && !duplicate && !duplicateDupr && !submitting);
      button.dataset.action = isCloudCheckIn ? 'check-in' : 'register';
    }
    return {fullname, duplicate, duplicateDupr, complete, isCloudCheckIn};
  }

  function hidePlayerSuggestions() {
    const list = $('registeredPlayerSuggestions');
    const input = $('registerFullname');
    if (list) { list.hidden = true; list.replaceChildren(); }
    if (input) input.setAttribute('aria-expanded', 'false');
  }

  function chooseCloudPlayer(player) {
    if (!player || !String(player.cloudId ?? '').trim()) return;
    selectedCloudPlayer = player;
    const fullname = $('registerFullname');
    const nickname = $('registerNickname');
    const duprId = $('registerDuprId');
    const selfRating = $('registerSelfRating');
    if (fullname) fullname.value = String(player.name || '');
    if (nickname) nickname.value = String(player.nickname || '');
    if (duprId) duprId.value = String(player.duprId ?? player.duprID ?? player.dupr_id ?? player.dupr ?? '').trim().replace(/^DUPR\s*:\s*/i, '').replace(/\s+/g, '').toUpperCase();
    if (selfRating) selfRating.value = String(player.selfRating ?? player.self_rating ?? '');
    selectedGender = normalizePlayerGender(player);
    document.querySelectorAll('.gender-choice').forEach(button => {
      const selected = !!selectedGender && button.dataset.gender === selectedGender;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const category = normalizePlayerSkill(player);
    selectedSkill = category;
    document.querySelectorAll('.registration-skill-btn').forEach(button => {
      const selected = !!selectedSkill && button.dataset.skill === selectedSkill;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    selectedAvatarId = String(player.avatarId ?? player.avatarID ?? player.avatar_id ?? '').trim();
    hidePlayerSuggestions();
    updateSubmitButton();
    hideFeedback();
  }

  function renderPlayerSuggestions(query) {
    const list = $('registeredPlayerSuggestions');
    const input = $('registerFullname');
    if (!list || !input) return;
    if (isSelectedCloudPlayer()) { hidePlayerSuggestions(); return; }
    const normalizedQuery = normalizedName(query);
    if (!normalizedQuery) { hidePlayerSuggestions(); return; }

    const matches = cloudPlayers
      .filter(player => {
        if (!String(player?.cloudId ?? '').trim()) return false;
        const name = normalizedName(player?.name);
        const nickname = normalizedName(player?.nickname);
        return name.includes(normalizedQuery) || nickname.includes(normalizedQuery);
      })
      .sort((a, b) => {
        const aName = normalizedName(a?.name);
        const bName = normalizedName(b?.name);
        const aRank = aName === normalizedQuery ? 0 : aName.startsWith(normalizedQuery) ? 1 : 2;
        const bRank = bName === normalizedQuery ? 0 : bName.startsWith(normalizedQuery) ? 1 : 2;
        return aRank - bRank || aName.localeCompare(bName);
      })
      .slice(0, 8);

    // No match means this is a new registration. Keep the suggestion panel
    // completely hidden rather than showing an empty-state warning.
    if (!matches.length) { hidePlayerSuggestions(); return; }

    list.replaceChildren();
    matches.forEach(player => {
      const alreadyCheckedIn = !!queueDuplicateForCloudPlayer(player);
      const option = document.createElement('button');
      option.type = 'button';
      option.className = `registration-player-suggestion${alreadyCheckedIn ? ' is-checked-in' : ''}`;
      option.dataset.cloudId = String(player.cloudId ?? '');
      option.disabled = alreadyCheckedIn;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(alreadyCheckedIn));
      option.setAttribute('aria-disabled', String(alreadyCheckedIn));

      const copy = document.createElement('span');
      copy.className = 'registration-player-suggestion-copy';

      const nameLine = document.createElement('span');
      nameLine.className = 'registration-player-suggestion-name-line';
      const name = document.createElement('span');
      name.className = 'registration-player-suggestion-name';
      name.textContent = String(player.name || 'Player');
      nameLine.appendChild(name);

      const nicknameValue = String(player.nickname || '').trim();
      if (nicknameValue) {
        const nickname = document.createElement('span');
        nickname.className = 'registration-player-suggestion-nickname';
        nickname.textContent = `(${nicknameValue})`;
        nameLine.appendChild(nickname);
      }

      const normalizedGender = normalizePlayerGender(player);
      const gender = normalizedGender === 'Male' ? 'male' : normalizedGender === 'Female' ? 'female' : '';
      if (gender) {
        const genderIcon = document.createElement('span');
        genderIcon.className = `registration-player-suggestion-gender is-${gender}`;
        genderIcon.innerHTML = registrationGenderSvgIcon(gender);
        genderIcon.setAttribute('role', 'img');
        genderIcon.setAttribute('aria-label', gender === 'male' ? 'Male' : 'Female');
        nameLine.appendChild(genderIcon);
      }

      const details = document.createElement('span');
      details.className = 'registration-player-suggestion-details';
      const category = normalizePlayerSkill(player);
      if (category) {
        const skillBadge = document.createElement('span');
        skillBadge.className = `registration-player-suggestion-badge registration-player-suggestion-skill cloud-category-badge skill-${category.toLowerCase()}`;
        skillBadge.textContent = SKILL_LABELS[category] || category;
        details.appendChild(skillBadge);
      }
      const duprValue = String(player.duprId || player.duprID || player.dupr_id || player.dupr || '')
        .trim().replace(/^DUPR\s*:\s*/i, '').replace(/\s+/g, '');
      if (duprValue) {
        const duprBadge = document.createElement('span');
        duprBadge.className = 'registration-player-suggestion-badge registration-player-suggestion-dupr cloud-dupr-badge';
        duprBadge.textContent = `DUPR: ${duprValue}`;
        details.appendChild(duprBadge);
      }

      copy.append(nameLine);
      if (details.childElementCount) copy.append(details);

      const plus = document.createElement('span');
      plus.className = `registration-player-suggestion-arrow${alreadyCheckedIn ? ' is-checked-in' : ''}`;
      plus.setAttribute('aria-hidden', 'true');
      plus.textContent = alreadyCheckedIn ? '✓' : '+';
      option.append(copy, plus);
      if (!alreadyCheckedIn) option.addEventListener('click', () => chooseCloudPlayer(player));
      list.appendChild(option);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function clearSelectedCloudPlayerDetails() {
    selectedCloudPlayer = null;
    const nickname = $('registerNickname');
    const duprId = $('registerDuprId');
    const selfRating = $('registerSelfRating');
    if (nickname) nickname.value = '';
    if (duprId) duprId.value = '';
    if (selfRating) selfRating.value = '';
    selectedGender = '';
    selectedSkill = '';
    selectAvatar('');
    document.querySelectorAll('.gender-choice').forEach(button => {
      button.classList.remove('selected');
      button.setAttribute('aria-pressed', 'false');
    });
    document.querySelectorAll('.registration-skill-btn').forEach(button => {
      button.classList.remove('selected');
      button.setAttribute('aria-pressed', 'false');
    });
    const duprMessage = $('registrationDuprDuplicateMessage');
    if (duprMessage) { duprMessage.textContent = ''; duprMessage.hidden = true; }
    const duplicateMessage = $('registrationDuplicateMessage');
    if (duplicateMessage) { duplicateMessage.textContent = ''; duplicateMessage.hidden = true; }
  }

  function bindPlayerSuggestions() {
    const input = $('registerFullname');
    const list = $('registeredPlayerSuggestions');
    if (!input || !list) return;
    input.addEventListener('input', () => {
      renderPlayerSuggestions(input.value);
      updateSubmitButton();
    });
    input.addEventListener('focus', () => {
      if (!selectedCloudPlayer && input.value.trim()) renderPlayerSuggestions(input.value);
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') { hidePlayerSuggestions(); return; }
      if (event.key === 'Enter' && !list.hidden) {
        const first = list.querySelector('.registration-player-suggestion:not(:disabled)');
        if (first) {
          event.preventDefault();
          const match = cloudPlayers.find(player => String(player.cloudId ?? '') === String(first.dataset.cloudId ?? ''));
          if (match) chooseCloudPlayer(match);
        }
      }
    });
    document.addEventListener('pointerdown', event => {
      if (!list.contains(event.target) && !input.closest('.registration-text-wrap')?.contains(event.target)) hidePlayerSuggestions();
    });
  }

  function selectAvatar(avatarId) {
    const value = String(avatarId || '').trim();
    if (value && !/^avatar-(?:0[1-9]|1[0-9]|2[01])$/.test(value)) return;
    selectedAvatarId = value;
    document.querySelectorAll('.registration-avatar-option').forEach(button => {
      const selected = !!value && button.dataset.avatarId === value;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const selectedLabel = $('registrationAvatarSelectedLabel');
    const selectedLine = document.querySelector('.registration-avatar-selected-line');
    if (selectedLabel) selectedLabel.textContent = value
      ? `Avatar ${value.slice(-2)} selected`
      : 'No avatar selected · System will assign one automatically';
    if (selectedLine) {
      selectedLine.classList.toggle('is-auto-assigned', !value);
      const marker = selectedLine.querySelector('.registration-avatar-selected-check');
      if (marker) marker.textContent = value ? '✓' : '✦';
    }
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

  function scheduleCloudRecordsRetry() {
    if (cloudRetryTimer || !organizerScope || registrationLinkInvalid) return;
    cloudRetryTimer = window.setTimeout(() => {
      cloudRetryTimer = null;
      loadCloudRecords();
    }, CLOUD_RETRY_DELAY_MS);
  }

  async function loadCloudRecords() {
    if (!organizerScope || registrationLinkInvalid) return false;
    if (cloudLoadPromise) return cloudLoadPromise;
    cloudLoadPromise = (async () => {
      const validationTask = organizerValidated ? Promise.resolve(true) : validateOrganizerRegistrationLink();
      try {
        const response = await fetch(scopedApiUrl('/api/cloud-records',{_:Date.now()}), {cache:'no-store',credentials:'same-origin'});
        if (response.status === 400 || response.status === 401 || response.status === 403 || response.status === 404) {
          const data = await response.json().catch(() => ({}));
          if (!organizerValidated) showRegistrationLinkNotice(data.error || 'This organizer registration link is invalid or inactive.');
          return false;
        }
        if (!response.ok) throw new Error('Registered Player Cloud is temporarily unavailable.');
        const data = await response.json();
        cloudPlayers = Array.isArray(data.records?.players) ? data.records.players : [];
        window.clearTimeout(cloudRetryTimer);
        cloudRetryTimer = null;
        bindCloudEvents();
        const searchInput = $('registerFullname');
        if (!selectedCloudPlayer && searchInput?.value.trim()) renderPlayerSuggestions(searchInput.value);
        updateSubmitButton();
        return true;
      } catch (error) {
        showRegistrationFormWhileConnecting('Registered Player Cloud is reconnecting. You can still complete the form; the server will check for duplicate players when you save.');
        scheduleCloudRecordsRetry();
        updateSubmitButton();
        return false;
      } finally {
        // Keep the organizer validation request alive independently. It can
        // confirm an ended or expired session even when the cloud list is slow.
        validationTask.then(valid => {
          if (!valid && !registrationLinkInvalid) scheduleCloudRecordsRetry();
        }).catch(() => scheduleCloudRecordsRetry());
        cloudLoadPromise = null;
      }
    })();
    return cloudLoadPromise;
  }

  function bindCloudEvents() {
    if (cloudEvents || !('EventSource' in window)) return;
    try {
      cloudEvents = new EventSource(scopedApiUrl('/api/shared-events'));
      cloudEvents.addEventListener('cloud-records', event => {
        try {
          const payload = JSON.parse(event.data);
          cloudPlayers = Array.isArray(payload.records?.players) ? payload.records.players : [];
          const searchInput = $('registerFullname');
          if (!selectedCloudPlayer && searchInput?.value.trim()) renderPlayerSuggestions(searchInput.value);
          updateSubmitButton();
        } catch (_) {}
      });
      cloudEvents.addEventListener('app-state', event => {
        try {
          const payload = JSON.parse(event.data);
          updateAppPlayers(payload.state);
          updateRegistrationSessionState(payload.state);
          const searchInput = $('registerFullname');
          if (!selectedCloudPlayer && searchInput?.value.trim()) renderPlayerSuggestions(searchInput.value);
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
    selectedCloudPlayer = null;
    hidePlayerSuggestions();
    $('registerFullname').value = '';
    $('registerNickname').value = '';
    $('registerDuprId').value = '';
    $('registerSelfRating').value = '';
    selectedGender = '';
    selectedSkill = '';
    selectAvatar('');
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

  async function verifyCloudPlayerCheckIn(player) {
    if (!player) return null;
    try {
      const response = await fetch(scopedApiUrl('/api/app-state', {_ : Date.now()}), {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {'Accept': 'application/json'}
      });
      if (!response.ok) return null;
      const payload = await response.json().catch(() => null);
      if (!payload || payload.ok !== true || (payload.organizerId && String(payload.organizerId) !== organizerScope)) return null;
      const state = payload.state || {};
      updateAppPlayers(state);
      const cloudId = String(player.cloudId ?? '').trim();
      const name = normalizedName(player.name);
      const found = [...(Array.isArray(state.players) ? state.players : []), ...(Array.isArray(state.left) ? state.left : [])]
        .find(candidate =>
          (cloudId && String(candidate?.registeredCloudId || candidate?.registrationCloudId || '').trim() === cloudId)
          || (name && normalizedName(candidate?.name) === name)
        );
      return found ? {player: found, state} : {player: null, state};
    } catch (_) {
      return null;
    }
  }

  function finishCloudPlayerCheckIn(playerName, title = 'Player Checked In', detailPrefix = 'was added to this organizer’s live waiting queue.', cloudPlayer = null) {
    organizerValidated = true;
    registrationLinkInvalid = false;
    registrationSessionAvailable = true;
    registrationSessionBlockReason = '';
    // Reflect the successful check-in immediately on this device; the live
    // app-state event will reconcile the complete queue snapshot afterward.
    if (cloudPlayer && !queueDuplicateForCloudPlayer(cloudPlayer)) {
      appPlayers.push({name:String(cloudPlayer.name || playerName || ''), registeredCloudId:String(cloudPlayer.cloudId || '')});
    }
    const notice = $('registrationLinkNotice');
    if (notice) notice.hidden = true;
    const panel = $('registrationPagePanel');
    if (panel) panel.hidden = false;
    setConnection(true, 'Live session active');
    showFeedback(title, `${playerName} ${detailPrefix}`);
    resetForm();
    $('registerFullname').focus();
  }

  async function checkInSelectedCloudPlayer() {
    if (submitting) return;
    if (!selectedCloudPlayer || !isSelectedCloudPlayer()) {
      showRegistrationError('Select a player from the Registered Player Cloud suggestions before checking in.');
      return;
    }
    if (!organizerScope || registrationLinkInvalid) {
      showFeedback('Registration link unavailable', 'Please open the organizer-specific registration QR code or link supplied by your organizer.', true);
      return;
    }
    if (organizerValidated && !registrationSessionAvailable) {
      showFeedback(registrationSessionId ? 'Registration QR unavailable' : 'No active live session', registrationSessionBlockReason || 'Registration is closed until the organizer starts a live session.', true);
      return;
    }
    const state = updateSubmitButton();
    // Capture the editable values currently shown in the form. The cloud ID
    // continues to identify the existing profile; the fields below are the
    // requested updates to apply when this player checks in.
    const selectedPlayer = {
      ...selectedCloudPlayer,
      nickname: String($('registerNickname')?.value || '').normalize('NFC').trim().replace(/\s+/g, ' ').slice(0, 80),
      gender: selectedGender,
      category: selectedSkill
    };
    if (state.duplicate) {
      showFeedback('Player already in this queue', `${selectedPlayer.name} is already in this organizer’s live session.`, true);
      return;
    }
    if (!state.complete) {
      showRegistrationError('Please confirm the player’s gender and skill level before checking in.');
      return;
    }

    submitting = true;
    hideFeedback();
    updateSubmitButton();
    try {
      const requestParams = {dupr:registrationDuprSession ? '1' : '0'};
      if (registrationSessionId) requestParams.session = registrationSessionId;
      const response = await fetch(scopedApiUrl('/api/register-player', requestParams), {
        method: 'POST',
        headers: {'Content-Type':'application/json', 'Accept':'application/json'},
        cache: 'no-store',
        credentials: 'same-origin',
        body: JSON.stringify({
          checkInExisting:true,
          cloudId:String(selectedPlayer.cloudId),
          nickname:selectedPlayer.nickname,
          gender:selectedPlayer.gender,
          category:selectedPlayer.category,
          organizerId:organizerScope,
          sessionId:registrationSessionId
        })
      });
      const data = await response.json().catch(() => ({}));

      if (response.status === 409 && data.noActiveSession) {
        organizerValidated = true;
        registrationLinkInvalid = false;
        updateRegistrationSessionState({sessionActive:data.sessionActive===true,sessionId:data.sessionId||null,sessionEndedAt:data.sessionEndedAt||null});
        showFeedback(data.sessionMismatch ? 'Registration QR expired' : 'No active live session', data.error || registrationSessionBlockReason, true);
        return;
      }
      if (response.status === 409 && data.duplicate) {
        const verification = await verifyCloudPlayerCheckIn(selectedPlayer);
        if (verification?.player) {
          finishCloudPlayerCheckIn(selectedPlayer.name, 'Already Checked In', 'is already in this organizer’s live session.', selectedPlayer);
          return;
        }
        showFeedback('Player already in this queue', data.error || `${selectedPlayer.name} is already in this organizer’s live session.`, true);
        return;
      }
      if (!response.ok || !data.ok || data.queued !== true) {
        // Confirm the organizer state before reporting a failure. The server may
        // have committed the queue write even if the response was interrupted.
        const verification = await verifyCloudPlayerCheckIn(selectedPlayer);
        if (verification?.player) {
          finishCloudPlayerCheckIn(selectedPlayer.name, 'Player Checked In', 'was added to this organizer’s live waiting queue.', selectedPlayer);
          return;
        }
        throw new Error(data.error || `The server rejected check-in (HTTP ${response.status}). Your selection is still on the form; please retry.`);
      }

      finishCloudPlayerCheckIn(data.queuePlayer?.name || data.player?.name || selectedPlayer.name, 'Player Checked In', 'was added to this organizer’s live waiting queue.', selectedPlayer);
    } catch (error) {
      // A dropped connection can happen after a successful server-side commit.
      // Read the organizer queue to distinguish that case from a real failure.
      const verification = await verifyCloudPlayerCheckIn(selectedPlayer);
      if (verification?.player) {
        finishCloudPlayerCheckIn(selectedPlayer.name, 'Player Checked In', 'was added to this organizer’s live waiting queue.', selectedPlayer);
      } else {
        const detail = error instanceof TypeError
          ? 'Unable to reach the check-in service. Your selected player is still on this form. Check your connection, then press Check In again.'
          : (error.message || 'Check-in could not be confirmed. Your selected player is still on this form; please retry.');
        showFeedback('Unable to confirm check-in', detail, true);
      }
    } finally {
      submitting = false;
      updateSubmitButton();
    }
  }

  async function submitRegistration() {
    if (submitting) return;
    if (!organizerScope || registrationLinkInvalid) {
      showFeedback('Registration link unavailable', 'Please open the organizer-specific registration QR code or link supplied by your organizer.', true);
      return;
    }
    // A successful GET may already have confirmed that this QR/session expired.
    // If the GET merely timed out, allow the POST to reach the server: the
    // registration endpoint performs the authoritative organizer/session check.
    if (organizerValidated && !registrationSessionAvailable) {
      showFeedback(registrationSessionId ? 'Registration QR unavailable' : 'No active live session', registrationSessionBlockReason || 'Registration is closed until the organizer starts a live session.', true);
      return;
    }
    const {fullname, duplicate, duplicateDupr, complete, isCloudCheckIn} = updateSubmitButton();
    if (isCloudCheckIn) return checkInSelectedCloudPlayer();
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
    if (!complete) { updateSubmitButton(); return; }

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
        body: JSON.stringify({name: fullname, nickname: $('registerNickname').value.trim(), gender: selectedGender, category: selectedSkill, avatarId:selectedAvatarId || '', duprId, selfRating, duprMatch:registrationDuprSession, organizerId:organizerScope, sessionId:registrationSessionId})
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 409 && data.noActiveSession) {
        organizerValidated = true;
        registrationLinkInvalid = false;
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
        } else if (data.duplicateType === 'organizerQueue') {
          showFeedback('Player already in this queue', `${player.name} is already in this organizer’s live session. No duplicate was added.`, true);
        } else {
          if (!duplicatePlayer(player.name)) cloudPlayers.push(player);
          updateDuplicateMessage();
          showFeedback('This user is already registered', `${player.name} is already saved in Registered Player Cloud. No duplicate profile was created.`, true);
        }
        return;
      }
      if (!response.ok || !data.ok) throw new Error(data.error || 'Unable to register this player. Please try again.');
      if (data.queued !== true) throw new Error('The profile was saved, but the organizer queue did not confirm the check-in. Please retry or contact the organizer.');

      organizerValidated = true;
      registrationLinkInvalid = false;
      registrationSessionAvailable = true;
      registrationSessionBlockReason = '';
      if (!cloudPlayers.some(player => normalizedName(player && player.name) === normalizedName(data.player.name))) {
        cloudPlayers.push(data.player);
      }
      const notice = $('registrationLinkNotice');
      if (notice) notice.hidden = true;
      const panel = $('registrationPagePanel');
      if (panel) panel.hidden = false;
      setConnection(true, 'Live session active');
      showFeedback('Registered & Queued', `${data.player.name} was added to this organizer’s live queue.`);
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
      updateSubmitButton();
    }
  }

  function bindNameHelpers() {
    ['registerFullname', 'registerNickname'].forEach(id => {
      const input = $(id);
      input.addEventListener('input', () => {
        if (id === 'registerFullname' && selectedCloudPlayer
          && normalizedName(input.value) !== normalizedName(selectedCloudPlayer.name)) {
          clearSelectedCloudPlayerDetails();
        }
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
  $('registerFullname').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.defaultPrevented) submitRegistration(); });
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
  bindPlayerSuggestions();
  bindAvatarPicker();
  syncDuprRegistrationFields();
  if ($('registrationPagePanel')) $('registrationPagePanel').hidden = !organizerScope;
  if ($('registrationLinkNotice')) {
    $('registrationLinkNotice').textContent = organizerScope
      ? 'Connecting to the organizer server. You can complete the form now; the server will verify the live session when you save.'
      : 'This registration page is organizer-specific. Please scan the registration QR code or open the link provided by your organizer.';
    $('registrationLinkNotice').hidden = false;
  }
  if (!organizerScope) showRegistrationLinkNotice('This registration page is organizer-specific. Please scan the registration QR code or open the link provided by your organizer.');
  syncRegistrationEyebrowTheme();
  loadCloudRecords();
  window.addEventListener('pagehide', () => {
    if (cloudRetryTimer) window.clearTimeout(cloudRetryTimer);
    cloudRetryTimer = null;
    if (cloudEvents) cloudEvents.close();
  }, {once:true});
})();
