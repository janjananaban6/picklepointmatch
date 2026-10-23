(() => {
  const loginForm = document.getElementById('organizerLoginForm');
  const registrationForm = document.getElementById('organizerRegistrationForm');
  const usernameInput = document.getElementById('organizerUsername');
  const passwordInput = document.getElementById('organizerPassword');
  const message = document.getElementById('loginMessage');
  const submit = document.getElementById('loginSubmit');
  const togglePassword = document.getElementById('togglePassword');
  const showRegistration = document.getElementById('showRegistration');
  const modePrompt = document.getElementById('modePrompt');
  const loginTitle = document.getElementById('loginTitle');
  const loginDescription = document.getElementById('loginDescription');
  const headingBadge = document.getElementById('headingBadge');
  const registerMessage = document.getElementById('registerMessage');
  const registerSubmit = document.getElementById('registerSubmit');
  const params = new URLSearchParams(window.location.search);

  function safeNextPath() {
    const next = String(params.get('next') || 'session.html');
    if (!/^\/(session\.html|queueing\.html)(\?.*)?$/.test(next)) {
      if (/^(session\.html|queueing\.html)(\?.*)?$/.test(next)) return `/${next}`;
      return '/session.html';
    }
    return next;
  }
  function setMessage(element, text, kind = 'error') {
    element.textContent = text;
    element.classList.toggle('is-info', kind === 'info');
  }
  function showLogin() {
    loginForm.hidden = false;
    registrationForm.hidden = true;
    loginTitle.textContent = 'Welcome back';
    loginDescription.textContent = 'Sign in to open your own live queue. Administrator credentials open the organizer management panel.';
    headingBadge.textContent = 'SECURE SIGN IN';
    modePrompt.textContent = 'New organizer?';
    showRegistration.textContent = 'Create an account';
    setMessage(message, '');
    setMessage(registerMessage, '');
    usernameInput.focus();
  }
  function showRegister() {
    loginForm.hidden = true;
    registrationForm.hidden = false;
    loginTitle.textContent = 'Create organizer account';
    loginDescription.textContent = 'Register your organizer account and start with a separate live queue.';
    headingBadge.textContent = 'NEW ORGANIZER';
    modePrompt.textContent = 'Already registered?';
    showRegistration.textContent = 'Back to sign in';
    setMessage(message, '');
    setMessage(registerMessage, '');
    document.getElementById('organizerDisplayName').focus();
  }
  togglePassword.addEventListener('click', () => {
    const show = passwordInput.type === 'password';
    passwordInput.type = show ? 'text' : 'password';
    togglePassword.textContent = show ? 'Hide' : 'Show';
    togglePassword.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
  showRegistration.addEventListener('click', () => registrationForm.hidden ? showRegister() : showLogin());

  fetch('/api/auth-status', {cache:'no-store',credentials:'same-origin'}).then(response => response.json()).then(status => {
    if (status.authenticated) {
      window.location.replace(status.role === 'panel' ? '/panel.html' : '/session.html');
      return;
    }
    if (!status.panelConfigured && !status.configured) {
      setMessage(message, 'Server login is not fully configured yet. The administrator must set PANEL_PASSWORD and SESSION_SECRET on the server.', 'info');
    }
  }).catch(() => {});

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    setMessage(message, '');
    submit.disabled = true;
    submit.querySelector('span').textContent = 'Signing in…';
    try {
      const response = await fetch('/api/login', {
        method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',credentials:'same-origin',
        body:JSON.stringify({username:usernameInput.value.trim(),password:passwordInput.value})
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        if (response.status === 429) throw new Error('Too many attempts. Please wait 15 minutes before trying again.');
        if (response.status === 503) throw new Error(result.error || 'Login is not configured on the server yet.');
        throw new Error(result.error || 'Unable to sign in. Check your username and password.');
      }
      window.location.replace(result.role === 'panel' ? '/panel.html' : safeNextPath());
    } catch (error) {
      setMessage(message, error.message || 'Unable to sign in. Please try again.');
      submit.disabled = false;
      submit.querySelector('span').textContent = 'Sign in';
    }
  });

  registrationForm.addEventListener('submit', async event => {
    event.preventDefault();
    setMessage(registerMessage, '');
    const password = document.getElementById('registerPassword').value;
    const confirm = document.getElementById('registerPasswordConfirm').value;
    if (password.length < 8) return setMessage(registerMessage, 'Use a password with at least 8 characters.');
    if (password !== confirm) return setMessage(registerMessage, 'The passwords do not match.');
    registerSubmit.disabled = true;
    registerSubmit.querySelector('span').textContent = 'Creating account…';
    try {
      const response = await fetch('/api/register-organizer', {
        method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',credentials:'same-origin',
        body:JSON.stringify({displayName:document.getElementById('organizerDisplayName').value.trim(),username:document.getElementById('registerUsername').value.trim(),password})
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to create organizer account.');
      window.location.replace('/session.html');
    } catch (error) {
      setMessage(registerMessage, error.message || 'Unable to create organizer account. Please try again.');
      registerSubmit.disabled = false;
      registerSubmit.querySelector('span').textContent = 'Create organizer account';
    }
  });
})();
