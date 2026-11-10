(() => {
  'use strict';

  const rawPath = String(window.location.pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';
  const path = rawPath.replace(/\.html$/i, '');
  const role = path === '/panel'
    ? 'panel'
    : (['/dashboard', '/queueing'].includes(path) ? 'organizer' : '');
  if (!role) return;

  const next = `${path.replace(/^\//, '')}${window.location.search || ''}`;
  const fallback = role === 'panel' ? 'panel' : 'dashboard';
  const loginUrl = `/?next=${encodeURIComponent(next || fallback)}`;
  const root = document.documentElement;
  root.style.visibility = 'hidden';

  const returnToLogin = () => window.location.replace(loginUrl);

  // The server sends an HttpOnly, role-specific cookie after sign-in. Cookies
  // are automatically shared by same-origin pages in this browser profile.
  // A separate device/browser has no such cookie and is redirected to login.
  fetch('/api/auth-status', {
    method: 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {'X-PPM-Auth-Role': role}
  }).then(async response => {
    const status = await response.json().catch(() => null);
    if (!response.ok || !status || status.authenticated !== true || status.role !== role) {
      returnToLogin();
      return;
    }
    window.PPM_TAB_AUTH = {role, sessionType: 'http-only-cookie'};
    document.getElementById('ppm-tab-auth-curtain')?.remove();
    root.style.removeProperty('visibility');
  }).catch(returnToLogin);
})();
