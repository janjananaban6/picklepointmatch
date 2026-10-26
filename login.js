(() => {
  'use strict';

  const loginForm = document.getElementById('organizerLoginForm');
  const registrationForm = document.getElementById('organizerRegistrationForm');
  const usernameInput = document.getElementById('organizerUsername');
  const accountSearchInput = document.getElementById('organizerAccountSearch');
  const accountOptions = document.getElementById('organizerAccountOptions');
  const accountPicker = document.getElementById('organizerPicker');
  const accountPickerToggle = document.getElementById('organizerPickerToggle');
  const selectedOrganizerLogo = document.getElementById('organizerSelectedLogo');
  const passwordInput = document.getElementById('organizerPassword');
  const message = document.getElementById('loginMessage');
  const submit = document.getElementById('loginSubmit');
  const togglePassword = document.getElementById('togglePassword');
  const showRegistration = document.getElementById('showRegistration');
  const modePrompt = document.getElementById('modePrompt');
  const loginTitle = document.getElementById('loginTitle');
  const loginDescription = document.getElementById('loginDescription');
  const loginFormPanel = document.querySelector('.login-form-panel');
  const registerMessage = document.getElementById('registerMessage');
  const registerSubmit = document.getElementById('registerSubmit');
  const displayNameInput = document.getElementById('organizerDisplayName');
  const registerUsernameInput = document.getElementById('registerUsername');
  const registerPasswordInput = document.getElementById('registerPassword');
  const registerPasswordConfirmInput = document.getElementById('registerPasswordConfirm');
  const duprIdInput = document.getElementById('organizerDuprId');
  const duprSlotInputs = Array.from(document.querySelectorAll('.dupr-id-slot'));
  const organizerLogoInput = document.getElementById('organizerLogoInput');
  const organizerLogoPreview = document.getElementById('organizerLogoPreview');
  const organizerLogoPlaceholder = document.getElementById('organizerLogoPlaceholder');
  const removeOrganizerLogo = document.getElementById('removeOrganizerLogo');
  const params = new URLSearchParams(window.location.search);

  let loginPending = false;
  let registerPending = false;
  let registrationSubmitted = false;
  let logoProcessing = false;
  let organizerLogoData = '';
  let loginAccounts = [];
  let selectedLoginAccount = null;
  let panelLoginAccount = null;
  let accountsLoaded = false;
  let accountsLoadError = false;

  function safeNextPath() {
    const next = String(params.get('next') || 'session.html');
    if (!/^\/(session\.html|queueing\.html)(\?.*)?$/.test(next)) {
      if (/^(session\.html|queueing\.html)(\?.*)?$/.test(next)) return `/${next}`;
      return '/session.html';
    }
    return next;
  }

  function setMessage(element, text, kind = 'error') {
    if (!element) return;
    const messageText = String(text || '').trim();
    element.textContent = messageText;
    element.classList.toggle('is-info', kind === 'info');
    element.classList.toggle('has-message', messageText.length > 0);
  }

  // Keep organizer names readable as they are entered: capitalize the first
  // letter of each word while preserving the user's remaining letter casing.
  function capitalizeOrganizerName(value) {
    return String(value || '').replace(/(^|[\s\-’'])([a-zà-öø-ÿ])/giu, (match, separator, letter) =>
      separator + letter.toLocaleUpperCase()
    );
  }

  function applyInputTransform(input, transform) {
    if (!input) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const transformed = transform(input.value);
    if (transformed === input.value) return;
    input.value = transformed;
    // Case changes normally preserve length; restoring the caret avoids jumps
    // when editing in the middle of a name or username on mobile/tablet.
    if (typeof start === 'number' && typeof end === 'number') {
      try { input.setSelectionRange(start, end); } catch (_) { /* ignore unsupported input types */ }
    }
  }

  function isSafeLogoData(value) {
    return typeof value === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(value.trim());
  }

  function getAccountLogoData(account) {
    if (!account || typeof account !== 'object') return '';
    return [account.profileImage, account.organizerLogo, account.logoData, account.logo]
      .find(isSafeLogoData) || '';
  }

  function hasOrganizerLogo(account) {
    return !!getAccountLogoData(account);
  }

  function closeOrganizerOptions() {
    accountOptions.hidden = true;
    accountSearchInput.setAttribute('aria-expanded', 'false');
    accountPickerToggle.setAttribute('aria-expanded', 'false');
    accountPicker.classList.remove('is-open');
  }

  function openOrganizerOptions(query = '') {
    renderOrganizerOptions(query);
    accountOptions.hidden = false;
    accountSearchInput.setAttribute('aria-expanded', 'true');
    accountPickerToggle.setAttribute('aria-expanded', 'true');
    accountPicker.classList.add('is-open');
  }

  function optionLogo(account) {
    return getAccountLogoData(account) || 'pickleball-p-emblem.png';
  }

  function setSelectedOrganizerLogo(account) {
    selectedOrganizerLogo.onerror = null;
    selectedOrganizerLogo.src = optionLogo(account);
    selectedOrganizerLogo.classList.toggle('is-default-logo', !hasOrganizerLogo(account));
    selectedOrganizerLogo.onerror = () => {
      selectedOrganizerLogo.onerror = null;
      selectedOrganizerLogo.src = 'pickleball-p-emblem.png';
      selectedOrganizerLogo.classList.add('is-default-logo');
    };
  }

  function renderOrganizerOptions(query = '') {
    accountOptions.replaceChildren();
    const term = String(query || '').trim().toLocaleLowerCase();
    const matching = loginAccounts.filter(account => {
      const searchable = `${account.displayName || ''} ${account.username || ''}`.toLocaleLowerCase();
      return searchable.includes(term);
    });

    if (!accountsLoaded) {
      const empty = document.createElement('div');
      empty.className = 'organizer-options-empty';
      empty.textContent = accountsLoadError ? 'Could not load accounts. Refresh and try again.' : 'Loading organizer accounts…';
      accountOptions.appendChild(empty);
      return;
    }

    if (!matching.length) {
      const empty = document.createElement('div');
      empty.className = 'organizer-options-empty';
      empty.textContent = loginAccounts.length ? 'No matching club or organizer.' : 'No active organizer accounts found.';
      accountOptions.appendChild(empty);
      return;
    }

    matching.forEach(account => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = `organizer-option${selectedLoginAccount && selectedLoginAccount.username === account.username ? ' is-selected' : ''}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(!!(selectedLoginAccount && selectedLoginAccount.username === account.username)));
      option.dataset.username = account.username;

      const logo = document.createElement('img');
      logo.className = 'organizer-option-logo';
      logo.src = optionLogo(account);
      logo.alt = '';
      logo.setAttribute('aria-hidden', 'true');
      logo.addEventListener('error', () => {
        if (logo.dataset.defaultLogoApplied === 'true') return;
        logo.dataset.defaultLogoApplied = 'true';
        logo.src = 'pickleball-p-emblem.png';
      });

      const copy = document.createElement('span');
      copy.className = 'organizer-option-copy';
      const name = document.createElement('strong');
      name.className = 'organizer-option-name';
      name.textContent = account.displayName || account.username;
      const username = document.createElement('small');
      username.className = 'organizer-option-username';
      username.textContent = `@${account.username}`;
      copy.append(name, username);

      const check = document.createElement('span');
      check.className = 'organizer-option-check';
      check.textContent = selectedLoginAccount && selectedLoginAccount.username === account.username ? '✓' : '';
      check.setAttribute('aria-hidden', 'true');
      option.append(logo, copy, check);
      option.addEventListener('click', () => selectLoginAccount(account));
      accountOptions.appendChild(option);
    });
  }

  function selectLoginAccount(account) {
    selectedLoginAccount = account;
    usernameInput.value = account.username;
    accountSearchInput.value = account.displayName || account.username;
    setSelectedOrganizerLogo(account);
    selectedOrganizerLogo.alt = '';
    passwordInput.value = '';
    closeOrganizerOptions();
    renderOrganizerOptions(accountSearchInput.value);
    setMessage(message, '');
  }

  async function loadOrganizerAccounts() {
    try {
      const response = await fetch('/api/organizers/public', {cache: 'no-store', credentials: 'same-origin'});
      const result = await response.json().catch(() => null);
      if (!response.ok || !result || !result.ok || !Array.isArray(result.organizers)) {
        throw new Error('Unable to load organizer accounts.');
      }
      loginAccounts = result.organizers
        .filter(account => account
          && typeof account.username === 'string'
          && account.username.trim()
          && account.active === true
          && String(account.approvalStatus || '').trim().toLowerCase() === 'approved')
        .map(account => ({...account, role: 'organizer'}));
      // Keep the administrator account available for direct sign-in, but never list it as an organizer option.
      panelLoginAccount = result.panelAccount && typeof result.panelAccount.username === 'string' && result.panelAccount.username.trim()
        ? {...result.panelAccount, role: 'panel'}
        : null;
      accountsLoaded = true;
      accountsLoadError = false;
    } catch (_) {
      accountsLoadError = true;
    } finally {
      renderOrganizerOptions(accountSearchInput.value);
    }
  }

  accountSearchInput.addEventListener('focus', () => openOrganizerOptions());
  accountSearchInput.addEventListener('input', () => {
    const entered = accountSearchInput.value.trim().toLocaleLowerCase();
    const isDirectPanelLogin = !!(panelLoginAccount && entered && entered === String(panelLoginAccount.username || '').trim().toLocaleLowerCase());
    selectedLoginAccount = isDirectPanelLogin ? panelLoginAccount : null;
    usernameInput.value = isDirectPanelLogin ? panelLoginAccount.username : '';
    setSelectedOrganizerLogo(isDirectPanelLogin ? panelLoginAccount : null);
    renderOrganizerOptions(accountSearchInput.value);
    accountOptions.hidden = false;
    accountSearchInput.setAttribute('aria-expanded', 'true');
    accountPickerToggle.setAttribute('aria-expanded', 'true');
    accountPicker.classList.add('is-open');
    if (message.textContent) setMessage(message, '');
  });
  accountPickerToggle.addEventListener('click', () => {
    if (accountOptions.hidden) {
      accountSearchInput.focus();
      openOrganizerOptions();
    } else {
      closeOrganizerOptions();
    }
  });
  accountSearchInput.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeOrganizerOptions();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (accountOptions.hidden) openOrganizerOptions();
      const options = [...accountOptions.querySelectorAll('.organizer-option')];
      if (!options.length) return;
      const target = event.key === 'ArrowDown' ? options[0] : options[options.length - 1];
      target.focus();
      return;
    }
    if (event.key === 'Enter' && !accountOptions.hidden && !selectedLoginAccount) {
      const options = [...accountOptions.querySelectorAll('.organizer-option')];
      if (options.length === 1) {
        event.preventDefault();
        selectLoginAccount(loginAccounts.find(account => account.username === options[0].dataset.username));
      }
    }
  });
  accountOptions.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'Escape'].includes(event.key)) return;
    const options = [...accountOptions.querySelectorAll('.organizer-option')];
    const current = options.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      closeOrganizerOptions();
      accountSearchInput.focus();
      return;
    }
    event.preventDefault();
    if (!options.length) return;
    const nextIndex = event.key === 'ArrowDown'
      ? Math.min(options.length - 1, current + 1)
      : Math.max(0, current < 0 ? options.length - 1 : current - 1);
    options[nextIndex].focus();
  });
  document.addEventListener('pointerdown', event => {
    if (!accountPicker.contains(event.target)) closeOrganizerOptions();
  });

  function resetRegistrationState() {
    // Treat each visit to Become an Organizer as a fresh form, including after a successful application.
    registrationForm.reset();
    registrationSubmitted = false;
    registerPending = false;
    logoProcessing = false;
    organizerLogoInput.value = '';
    registrationForm.querySelectorAll('input, button').forEach(control => { control.disabled = false; });
    showLogoPreview('');
    registerSubmit.querySelector('span').textContent = 'Become an Organizer';
    registerSubmit.removeAttribute('aria-busy');
    setMessage(registerMessage, '');
  }

  function showLogin() {
    loginFormPanel.classList.remove('is-registering');
    loginForm.hidden = false;
    registrationForm.hidden = true;
    loginTitle.textContent = 'Organizer Login';
    loginDescription.textContent = 'Sign in with your organizer credentials to open your dashboard.';
    modePrompt.textContent = 'New host?';
    showRegistration.textContent = 'Become an Organizer';
    setMessage(message, '');
    setMessage(registerMessage, '');
    // Avoid auto-focusing credential fields; browser account/password prompts are browser-controlled.
  }

  function showRegister() {
    // Refresh the form state whenever the user returns from Sign In.
    resetRegistrationState();
    loginFormPanel.classList.add('is-registering');
    loginForm.hidden = true;
    registrationForm.hidden = false;
    loginTitle.textContent = 'Become an Organizer';
    loginDescription.textContent = 'Submit your organizer application for review by Pickle Point Match.';
    modePrompt.textContent = 'Already have an account?';
    showRegistration.textContent = 'Back to sign in';
    setMessage(message, '');
    updateRegisterSubmitState();
    // Avoid forced focus so the page does not jump or auto-scroll on mobile.
  }

  function normalizeDuprId(value) {
    return String(value || '').trim().replace(/^DUPR\s*:\s*/i, '').replace(/\s+/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  }

  function syncDuprSlotsToInput() {
    duprIdInput.value = duprSlotInputs.map(slot => slot.value).join('').slice(0, 6);
    // Reuse the existing form-state validation and submission wiring.
    duprIdInput.dispatchEvent(new Event('input', {bubbles: true}));
  }

  function fillDuprSlots(value, focusIndex = null) {
    const normalized = normalizeDuprId(value);
    duprSlotInputs.forEach((slot, index) => { slot.value = normalized[index] || ''; });
    syncDuprSlotsToInput();
    if (Number.isInteger(focusIndex) && duprSlotInputs.length) {
      duprSlotInputs[Math.max(0, Math.min(focusIndex, duprSlotInputs.length - 1))]?.focus();
    }
  }

  duprSlotInputs.forEach((slot, index) => {
    slot.addEventListener('input', () => {
      const raw = String(slot.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (raw.length > 1) {
        // Some mobile keyboards insert several characters at once. Treat that
        // as a pasted DUPR ID and distribute it across the six visible cards.
        fillDuprSlots(raw, Math.min(raw.length, duprSlotInputs.length - 1));
        return;
      }
      slot.value = raw.slice(0, 1);
      syncDuprSlotsToInput();
      if (slot.value && index < duprSlotInputs.length - 1) duprSlotInputs[index + 1].focus();
    });

    slot.addEventListener('paste', event => {
      const pastedText = event.clipboardData?.getData('text') || '';
      const normalized = normalizeDuprId(pastedText);
      if (!normalized) return;
      event.preventDefault();
      fillDuprSlots(normalized, Math.min(normalized.length, duprSlotInputs.length - 1));
    });

    slot.addEventListener('keydown', event => {
      if (event.key === 'Backspace' && !slot.value && index > 0) {
        event.preventDefault();
        duprSlotInputs[index - 1].value = '';
        duprSlotInputs[index - 1].focus();
        syncDuprSlotsToInput();
      } else if (event.key === 'ArrowLeft' && index > 0) {
        event.preventDefault();
        duprSlotInputs[index - 1].focus();
      } else if (event.key === 'ArrowRight' && index < duprSlotInputs.length - 1) {
        event.preventDefault();
        duprSlotInputs[index + 1].focus();
      }
    });
  });

  function updateRegisterSubmitState() {
    const logoComplete = !!organizerLogoData;
    const displayNameComplete = !!displayNameInput.value.trim();
    const usernameComplete = !!registerUsernameInput.value.trim();
    const password = registerPasswordInput.value;
    const confirm = registerPasswordConfirmInput.value;
    const credentialsValid = logoComplete && displayNameComplete && usernameComplete &&
      registerUsernameInput.validity.valid && registerPasswordInput.validity.valid &&
      registerPasswordConfirmInput.validity.valid && password.length >= 8 && password === confirm;
    registerSubmit.disabled = registrationSubmitted || !credentialsValid || registerPending || logoProcessing || !registrationForm.checkValidity();
    registerSubmit.setAttribute('aria-busy', String(registerPending || logoProcessing));
    if (registrationSubmitted) registerSubmit.querySelector('span').textContent = 'Application submitted';

    if (confirm && password && password !== confirm && !registerPending) {
      setMessage(registerMessage, 'The passwords do not match.');
    } else if (registerMessage.textContent === 'The passwords do not match.') {
      setMessage(registerMessage, '');
    }
  }

  function showLogoPreview(dataUrl) {
    organizerLogoData = dataUrl || '';
    if (organizerLogoData) {
      organizerLogoPreview.src = organizerLogoData;
      organizerLogoPreview.hidden = false;
      organizerLogoPlaceholder.hidden = true;
      removeOrganizerLogo.disabled = false;
    } else {
      organizerLogoPreview.removeAttribute('src');
      organizerLogoPreview.hidden = true;
      organizerLogoPlaceholder.hidden = false;
      removeOrganizerLogo.disabled = true;
    }
  }

  async function compressImage(file) {
    const maxSourceBytes = 100 * 1024 * 1024;
    const maxPayloadChars = 260000;
    if (!file || !String(file.type || '').startsWith('image/')) {
      throw new Error('Choose an image file for the organizer logo.');
    }
    if (file.size > maxSourceBytes) {
      throw new Error('This image is over 100 MB. Please choose a smaller source image.');
    }

    // Decode the source via an object URL instead of creating a huge Base64 string
    // for the original file. The final compressed image is what gets posted to the server.
    const source = URL.createObjectURL(file);
    let image;
    try {
      image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('This logo format is not supported by this browser. Try PNG, JPG, or WebP.'));
        element.src = source;
      });
    } finally {
      URL.revokeObjectURL(source);
    }
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error('This logo image has invalid dimensions. Please choose another image.');
    }

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Logo editing is not supported in this browser.');

    // Normalize large/high-resolution logos locally so the request stays small.
    // Try WebP first to retain transparent backgrounds, then JPEG as a fallback.
    const maxSides = [512, 448, 384, 320, 256, 192, 160, 128];
    const qualities = [0.84, 0.72, 0.60, 0.48, 0.36, 0.28];
    for (const maxSide of maxSides) {
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      for (const quality of qualities) {
        const webp = canvas.toDataURL('image/webp', quality);
        if (webp.startsWith('data:image/webp;') && webp.length <= maxPayloadChars) return webp;

        // JPEG has no alpha channel, so use a white canvas for transparent logos.
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const jpeg = canvas.toDataURL('image/jpeg', quality);
        if (jpeg.length <= maxPayloadChars) return jpeg;

        // Restore transparency before trying WebP at the next quality level.
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
      }
    }
    throw new Error('This logo could not be compressed for upload. Please try a PNG, JPG, or WebP image.');
  }

  togglePassword.addEventListener('click', () => {
    const show = passwordInput.type === 'password';
    passwordInput.type = show ? 'text' : 'password';
    togglePassword.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    togglePassword.setAttribute('title', show ? 'Hide password' : 'Show password');
    togglePassword.setAttribute('aria-pressed', String(show));
    togglePassword.classList.toggle('is-visible', show);
  });

  showRegistration.addEventListener('click', () => {
    if (registerPending || logoProcessing || loginPending) return;
    if (registrationForm.hidden) showRegister();
    else showLogin();
  });

  displayNameInput.addEventListener('input', () => {
    applyInputTransform(displayNameInput, capitalizeOrganizerName);
  });
  displayNameInput.addEventListener('change', () => {
    applyInputTransform(displayNameInput, capitalizeOrganizerName);
  });
  registerUsernameInput.addEventListener('input', () => {
    applyInputTransform(registerUsernameInput, value => value.toLocaleLowerCase());
  });
  registerUsernameInput.addEventListener('change', () => {
    applyInputTransform(registerUsernameInput, value => value.toLocaleLowerCase());
  });

  [displayNameInput, registerUsernameInput, registerPasswordInput, registerPasswordConfirmInput, duprIdInput].forEach(input => {
    input.addEventListener('input', () => {
      if (input === duprIdInput) {
        const normalized = normalizeDuprId(duprIdInput.value);
        if (duprIdInput.value !== normalized) duprIdInput.value = normalized;
      }
      if (registerMessage.textContent && registerMessage.textContent !== 'The passwords do not match.') {
        setMessage(registerMessage, '');
      }
      updateRegisterSubmitState();
    });
    input.addEventListener('change', updateRegisterSubmitState);
  });

  organizerLogoInput.addEventListener('change', async event => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    logoProcessing = true;
    setMessage(registerMessage, '');
    updateRegisterSubmitState();
    try {
      showLogoPreview(await compressImage(file));
    } catch (error) {
      showLogoPreview('');
      setMessage(registerMessage, error.message || 'Unable to use this logo.');
    } finally {
      organizerLogoInput.value = '';
      logoProcessing = false;
      updateRegisterSubmitState();
    }
  });

  removeOrganizerLogo.addEventListener('click', () => {
    showLogoPreview('');
    organizerLogoInput.value = '';
    setMessage(registerMessage, '');
    updateRegisterSubmitState();
  });

  // Start with a blank credential state; never restore hidden username or password values.
  accountSearchInput.value = '';
  usernameInput.value = '';
  passwordInput.value = '';
  setSelectedOrganizerLogo(null);

  window.addEventListener('pageshow', () => {
    selectedLoginAccount = null;
    accountSearchInput.value = '';
    usernameInput.value = '';
    passwordInput.value = '';
    setSelectedOrganizerLogo(null);
    closeOrganizerOptions();
  });

  loadOrganizerAccounts();

  fetch('/api/auth-status', {cache: 'no-store', credentials: 'same-origin'})
    .then(async response => {
      const status = await response.json().catch(() => null);
      if (!response.ok || !status || status.ok === false) {
        throw new Error(status?.error || `Login service returned HTTP ${response.status}.`);
      }
      if (status.authenticated) {
        window.location.replace(status.role === 'panel' ? '/panel.html' : safeNextPath());
        return;
      }
      if (!status.panelConfigured && !status.configured) {
        setMessage(message, 'Login is not configured on the server. The administrator must set SESSION_SECRET and a valid login credential in the hosting settings.', 'info');
      }
    })
    .catch(() => {
      // Give a useful hint instead of silently ignoring a broken API/server connection.
      if (!registrationForm.hidden) return;
      setMessage(message, 'Cannot connect to the login service. Check the server connection, then refresh this page.');
    });

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (loginPending) return;
    if (!selectedLoginAccount || !usernameInput.value) {
      setMessage(message, 'Please select your club or organizer from the dropdown first.');
      accountSearchInput.focus();
      openOrganizerOptions(accountSearchInput.value);
      return;
    }
    setMessage(message, '');
    loginPending = true;
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    submit.querySelector('span').textContent = 'Signing in…';

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        cache: 'no-store',
        credentials: 'same-origin',
        body: JSON.stringify({username: usernameInput.value.trim(), password: passwordInput.value})
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result || !result.ok) {
        if (response.status === 503) throw new Error(result?.error || 'Login is not configured on the server yet.');
        if (response.status === 401) throw new Error(result?.error || 'Incorrect username or password. Check your credentials and try again.');
        if (!result) throw new Error(`The login server returned an unexpected response (HTTP ${response.status}). Please refresh and try again.`);
        const serverMessage = String(result.error || '');
        if (/too many .*attempt|try again later|rate.?limit|temporarily locked/i.test(serverMessage)) {
          throw new Error('Login could not be completed. Please check your credentials and try again.');
        }
        throw new Error(serverMessage || `Unable to sign in (HTTP ${response.status}). Please try again.`);
      }
      if (result.role !== 'panel' && result.role !== 'organizer') {
        throw new Error('The server response was incomplete. Please refresh the login page and try again.');
      }
      window.location.replace(result.role === 'panel' ? '/panel.html' : safeNextPath());
    } catch (error) {
      const detail = String(error?.message || '');
      const userMessage = /failed to fetch|networkerror|load failed|fetch failed/i.test(detail)
        ? 'Cannot reach the login service. Check your internet connection or server deployment, then try again.'
        : detail || 'Unable to sign in. Please try again.';
      setMessage(message, userMessage);
    } finally {
      loginPending = false;
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
      submit.querySelector('span').textContent = 'Sign in';
    }
  });

  registrationForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (registerPending || logoProcessing) return;
    // Normalize before validation and submission so stored values match what
    // the registration fields display, even when text was pasted or autofilled.
    displayNameInput.value = capitalizeOrganizerName(displayNameInput.value.trim());
    registerUsernameInput.value = registerUsernameInput.value.trim().toLocaleLowerCase();
    setMessage(registerMessage, '');
    updateRegisterSubmitState();
    if (!registrationForm.reportValidity()) return;

    const displayName = displayNameInput.value.trim();
    const username = registerUsernameInput.value.trim().toLocaleLowerCase();
    const password = registerPasswordInput.value;
    const confirm = registerPasswordConfirmInput.value;
    const duprId = normalizeDuprId(duprIdInput.value);
    duprIdInput.value = duprId;
    if (!/^[A-Z0-9]{6}$/.test(duprId)) {
      setMessage(registerMessage, 'Enter all 6 characters of the organizer’s DUPR ID.');
      (duprSlotInputs.find(slot => !slot.value) || duprSlotInputs[0])?.focus();
      return;
    }
    if (!organizerLogoData) return setMessage(registerMessage, 'Choose an organizer logo before submitting your application.');
    if (!displayName) return setMessage(registerMessage, 'Enter the organizer or venue name.');
    if (!username || !registerUsernameInput.validity.valid) return setMessage(registerMessage, 'Enter a valid username (3–40 letters, numbers, dots, underscores, or hyphens).');
    if (password.length < 8) return setMessage(registerMessage, 'Use a password with at least 8 characters.');
    if (password !== confirm) {
      setMessage(registerMessage, 'The passwords do not match.');
      updateRegisterSubmitState();
      return;
    }

    registerPending = true;
    registerSubmit.disabled = true;
    registerSubmit.setAttribute('aria-busy', 'true');
    registerSubmit.querySelector('span').textContent = 'Submitting application…';
    try {
      const response = await fetch('/api/register-organizer', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        cache: 'no-store',
        credentials: 'same-origin',
        body: JSON.stringify({displayName, username, password, profileImage: organizerLogoData, duprId})
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result || !result.ok) {
        if (response.status === 429 || /too many registration attempts|registration.*rate.?limit/i.test(String(result?.error || ''))) {
          throw new Error('The server is still applying a registration-attempt limit. This project version does not lock out registration; redeploy the latest project to Render and refresh the page. If this continues, the limit is configured outside this app.');
        }
        if (response.status === 413) {
          throw new Error('The registration request was rejected as too large. Refresh the page to load the latest automatic logo compression, then try again.');
        }
        if (!result) throw new Error(`The registration service returned an unexpected response (HTTP ${response.status}). Please refresh and try again.`);
        throw new Error(result.error || `Unable to create organizer account (HTTP ${response.status}).`);
      }
      registrationSubmitted = true;
      // Clear the registration fields and logo immediately, while keeping the result message visible.
      registrationForm.reset();
      showLogoPreview('');
      organizerLogoInput.value = '';
      registrationForm.querySelectorAll('input, button').forEach(control => { control.disabled = true; });
      registerSubmit.querySelector('span').textContent = 'Application submitted';
      setMessage(registerMessage, 'Application submitted successfully. Your information is now under review by Pickle Point Match. For account security, organizer access will remain disabled until an administrator approves your application. Please return to sign in after approval.', 'info');
      showRegistration.textContent = 'Back to sign in';
      modePrompt.textContent = 'Application received';
    } catch (error) {
      const detail = String(error?.message || '');
      const userMessage = /failed to fetch|networkerror|load failed|fetch failed/i.test(detail)
        ? 'Cannot reach the registration service. Check your connection and try again.'
        : detail || 'Unable to create organizer account. Please try again.';
      setMessage(registerMessage, userMessage);
    } finally {
      registerPending = false;
      if (!registrationSubmitted) registerSubmit.querySelector('span').textContent = 'Become an Organizer';
      updateRegisterSubmitState();
    }
  });

  showLogoPreview('');
  updateRegisterSubmitState();
})();
