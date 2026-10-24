(() => {
  function addLogoutButton() {
    if (document.getElementById('ppOrganizerLogout')) return;
    const isSessionPage = document.body?.dataset?.page === 'start';
    const sessionFooter = isSessionPage ? document.querySelector('#liveQueueStartScreen > .page-footer') : null;
    const style = document.createElement('style');
    style.textContent = isSessionPage
      ? `#ppOrganizerLogout{position:static;z-index:auto;display:inline-flex;align-items:center;justify-content:center;min-height:0;margin:0;padding:0;border:0;border-radius:0;background:transparent;color:#82969a;box-shadow:none;font:750 9px/1.5 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:.2px;cursor:pointer}#ppOrganizerLogout:hover{background:transparent;color:#27d3c5}#ppOrganizerLogout:disabled{opacity:.65;cursor:wait}@media(max-width:520px){#ppOrganizerLogout{font-size:8px}}`
      : `#ppOrganizerLogout{position:fixed;z-index:10050;top:max(10px,env(safe-area-inset-top));right:max(12px,env(safe-area-inset-right));display:inline-flex;align-items:center;gap:7px;min-height:34px;padding:0 12px;border:1px solid rgba(99,117,129,.2);border-radius:999px;background:rgba(255,255,255,.96);color:#3d4d59;box-shadow:0 2px 10px rgba(14,32,43,.10);font:600 12px/1.1 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;cursor:pointer}#ppOrganizerLogout:hover{background:#f5f8fa}#ppOrganizerLogout svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}#ppOrganizerLogout:disabled{opacity:.65;cursor:wait}@media(max-width:700px){#ppOrganizerLogout{top:auto;bottom:max(12px,env(safe-area-inset-bottom));right:max(12px,env(safe-area-inset-right));min-height:40px;box-shadow:0 4px 16px rgba(14,32,43,.18)}body.pp-has-logout{padding-bottom:calc(64px + env(safe-area-inset-bottom))}}`;
    document.head.appendChild(style);
    const button = document.createElement('button');
    button.id = 'ppOrganizerLogout';
    button.type = 'button';
    if (isSessionPage) {
      button.textContent = 'Logout';
    } else {
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3M14 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/></svg><span>Log out</span>';
    }
    button.addEventListener('click', async () => {
      if (!window.confirm('Log out of the organizer account?')) return;
      button.disabled = true;
      try { await fetch('/api/logout', {method:'POST',credentials:'same-origin',cache:'no-store'}); } catch (_) {}
      window.location.replace('/index.html');
    });
    if (sessionFooter) {
      sessionFooter.appendChild(button);
    } else {
      document.body.appendChild(button);
      document.body.classList.add('pp-has-logout');
    }
  }

  window.PPM_AUTH_READY = fetch('/api/auth-status', {cache:'no-store',credentials:'same-origin'}).then(response => response.json()).then(status => {
    if (!status.authenticated || status.role !== 'organizer') {
      const next = encodeURIComponent(window.location.pathname.slice(1) + window.location.search);
      window.location.replace(`/index.html?next=${next}`);
      return null;
    }
    window.PPM_ORGANIZER_ID = status.organizerId || '';
    window.PPM_ORGANIZER_USERNAME = status.username || '';
    window.PPM_ORGANIZER_NAME = status.displayName || status.username || '';
    if (document.body?.dataset?.page !== 'queueing') addLogoutButton();
    return status;
  }).catch(() => {
    window.location.replace('/index.html');
    return null;
  });
})();
