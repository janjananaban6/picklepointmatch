(() => {
  'use strict';

  const path = String(window.location.pathname || '').toLowerCase();
  const role = path.endsWith('/panel.html') || path === '/panel.html'
    ? 'panel'
    : (path.endsWith('/dashboard.html') || path === '/dashboard.html' ? 'organizer' : '');
  if (!role) return;

  const storageKey = role === 'panel' ? 'ppm-panel-tab-session-v1' : 'ppm-organizer-tab-session-v1';
  const next = `${path.replace(/^\//, '')}${window.location.search || ''}`;
  const loginUrl = `/index.html?next=${encodeURIComponent(next || (role === 'panel' ? 'panel.html' : 'dashboard.html'))}`;
  const root = document.documentElement;
  root.style.visibility = 'hidden';

  let token = '';
  try { token = window.sessionStorage.getItem(storageKey) || ''; } catch (_) {}

  const returnToLogin = () => {
    try { window.sessionStorage.removeItem(storageKey); } catch (_) {}
    window.location.replace(loginUrl);
  };

  // A new tab has its own sessionStorage. A role cookie from another tab is
  // deliberately not sufficient to reveal this page.
  if (!token) {
    returnToLogin();
    return;
  }

  const nativeFetch = window.fetch.bind(window);
  const authHeaders = () => ({
    'X-PPM-Auth-Role': role,
    'X-PPM-Tab-Scoped': '1',
    'X-PPM-Tab-Session': token
  });

  window.fetch = (input, init = {}) => {
    let target;
    try {
      const inputUrl = (typeof Request !== 'undefined' && input instanceof Request) ? input.url : String(input);
      target = new URL(inputUrl, window.location.href);
    } catch (_) {
      return nativeFetch(input, init);
    }
    if (target.origin !== window.location.origin || !target.pathname.startsWith('/api/')) {
      return nativeFetch(input, init);
    }

    const headers = new Headers((typeof Request !== 'undefined' && input instanceof Request) ? input.headers : undefined);
    new Headers(init.headers || {}).forEach((value, name) => headers.set(name, value));
    Object.entries(authHeaders()).forEach(([name, value]) => headers.set(name, value));
    return nativeFetch(input, {...init, headers});
  };

  // Check the role and signature before making the protected page visible.
  nativeFetch('/api/auth-status', {
    method: 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: authHeaders()
  }).then(async response => {
    const status = await response.json().catch(() => null);
    if (!response.ok || !status || status.authenticated !== true || status.role !== role) {
      returnToLogin();
      return;
    }
    window.PPM_TAB_AUTH = {role, storageKey};
    document.getElementById('ppm-tab-auth-curtain')?.remove();
    root.style.removeProperty('visibility');
  }).catch(returnToLogin);
})();
