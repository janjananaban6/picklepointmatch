(() => {
  const form = document.getElementById('organizerLoginForm');
  const usernameInput = document.getElementById('organizerUsername');
  const passwordInput = document.getElementById('organizerPassword');
  const message = document.getElementById('loginMessage');
  const submit = document.getElementById('loginSubmit');
  const togglePassword = document.getElementById('togglePassword');
  const params = new URLSearchParams(window.location.search);

  function safeNextPath() {
    const next = String(params.get('next') || 'session.html');
    if (!/^\/(session\.html|queueing\.html)(\?.*)?$/.test(next)) {
      if (/^(session\.html|queueing\.html)(\?.*)?$/.test(next)) return `/${next}`;
      return '/session.html';
    }
    return next;
  }
  function setMessage(text, kind = 'error') {
    message.textContent = text;
    message.classList.toggle('is-info', kind === 'info');
  }

  togglePassword.addEventListener('click', () => {
    const show = passwordInput.type === 'password';
    passwordInput.type = show ? 'text' : 'password';
    togglePassword.textContent = show ? 'Hide' : 'Show';
    togglePassword.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });

  fetch('/api/auth-status', {cache:'no-store'}).then(response => response.json()).then(status => {
    if (status.authenticated) window.location.replace('/session.html');
    else if (!status.configured) setMessage('Organizer login is not configured yet. Set ORGANIZER_USERNAME, ORGANIZER_PASSWORD, and SESSION_SECRET in Render, then deploy.', 'error');
  }).catch(() => {});

  form.addEventListener('submit', async event => {
    event.preventDefault();
    setMessage('');
    submit.disabled = true;
    submit.querySelector('span').textContent = 'Signing in…';
    try {
      const response = await fetch('/api/login', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        cache:'no-store',
        credentials:'same-origin',
        body:JSON.stringify({username:usernameInput.value.trim(),password:passwordInput.value})
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        if (response.status === 429) throw new Error('Too many attempts. Please wait 15 minutes before trying again.');
        if (response.status === 503) throw new Error('Organizer login is not configured in Render yet.');
        throw new Error(result.error || 'Unable to sign in. Check your username and password.');
      }
      window.location.replace(safeNextPath());
    } catch (error) {
      setMessage(error.message || 'Unable to sign in. Please try again.');
      submit.disabled = false;
      submit.querySelector('span').textContent = 'Sign in';
    }
  });
})();
