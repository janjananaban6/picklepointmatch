/* Load the queue workspace only after the organizer identity is known. This keeps
   local queue caches namespaced per organizer before the queue script initializes. */
(function () {
  function loadQueueingApp(status) {
    if (!status || status.role !== 'organizer' || !status.organizerId) return;
    window.PPM_ORGANIZER_ID = status.organizerId;
    window.PPM_ORGANIZER_USERNAME = status.username || '';
    window.PPM_ORGANIZER_NAME = status.displayName || status.username || '';
    const app = document.createElement('script');
    app.src = 'script.js?v=organizer-name-qr-scope-20261024-3&qr-logo-assignment=20261024-2&organizer-title-badge=20261024-1';
    app.onerror = () => console.error('Pickle Point Match could not load script.js.');
    document.body.appendChild(app);
  }
  if (window.PPM_AUTH_READY && typeof window.PPM_AUTH_READY.then === 'function') {
    window.PPM_AUTH_READY.then(loadQueueingApp);
  } else {
    fetch('/api/auth-status', {cache:'no-store',credentials:'same-origin'}).then(response => response.json()).then(loadQueueingApp).catch(() => {});
  }
})();
