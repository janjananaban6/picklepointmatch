/* Load the queue workspace only after the organizer identity is known. This keeps
   local queue caches namespaced per organizer before the queue script initializes. */
(function () {
  // Do not initialize authentication-dependent queueing application code on phones.
  // The early guard in queueing.html already displays the mobile-disabled notice.
  if (window.__PPM_QUEUEING_MOBILE_BLOCKED === true ||
      document.documentElement.classList.contains('queueing-mobile-disabled')) {
    return;
  }

  function loadQueueingApp(status) {
    if (!status || status.role !== 'organizer' || !status.organizerId) return;
    window.PPM_ORGANIZER_ID = status.organizerId;
    window.PPM_ORGANIZER_SLUG = status.organizerSlug || '';
    window.PPM_ORGANIZER_USERNAME = status.username || '';
    window.PPM_ORGANIZER_NAME = status.displayName || status.username || '';

    // Prime the organizer text before the main application bundle downloads.
    // This avoids the label appearing only after the first full queue render.
    const organizerName = String(window.PPM_ORGANIZER_NAME || '').trim();
    const organizerStat = document.getElementById('eventOrganizerStat');
    const organizerNameLabel = document.getElementById('eventOrganizerName');
    if (organizerStat && organizerNameLabel) {
      organizerNameLabel.textContent = organizerName;
      organizerStat.hidden = !organizerName;
      organizerStat.title = organizerName;
      if (organizerName) organizerStat.setAttribute('aria-label', organizerName);
      else organizerStat.removeAttribute('aria-label');
    }

    // Restore the organizer logo immediately from a per-organizer cache so it
    // does not disappear during a browser refresh while the API request runs.
    // The API remains authoritative and updates/clears the cache after loading.
    const organizerLogo = document.getElementById('eventOrganizerLogo');
    const organizerId = String(status.organizerId || '').trim();
    const logoCacheKey = `ppm:queueing:organizer-logo:${organizerId}`;
    const isValidLogo = value => typeof value === 'string' &&
      /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(value.trim());
    let cachedLogo = '';
    if (organizerLogo && organizerId) {
      try { cachedLogo = localStorage.getItem(logoCacheKey) || ''; } catch (_) {}
      organizerLogo.dataset.organizerLogoId = organizerId;
      organizerLogo.dataset.organizerLogoReady = 'loading';
      organizerLogo.dataset.hasCustomOrganizerLogo = isValidLogo(cachedLogo) ? 'true' : 'false';
      if (isValidLogo(cachedLogo)) {
        organizerLogo.onerror = () => {
          organizerLogo.onerror = null;
          organizerLogo.hidden = true;
          organizerLogo.removeAttribute('src');
          organizerLogo.dataset.hasCustomOrganizerLogo = 'false';
          try { localStorage.removeItem(logoCacheKey); } catch (_) {}
        };
        organizerLogo.src = cachedLogo.trim();
        organizerLogo.hidden = false;
      } else {
        organizerLogo.hidden = true;
        organizerLogo.removeAttribute('src');
      }

      fetch(`/api/live-state?organizer=${encodeURIComponent(organizerId)}`, {
        cache: 'no-store', credentials: 'same-origin'
      }).then(response => response.ok ? response.json() : null).then(data => {
        if (!organizerLogo || organizerLogo.dataset.organizerLogoId !== organizerId) return;
        const freshLogo = isValidLogo(data?.organizerLogo) ? data.organizerLogo.trim() : '';
        if (freshLogo) {
          try { localStorage.setItem(logoCacheKey, freshLogo); } catch (_) {}
          organizerLogo.onerror = () => {
            organizerLogo.onerror = null;
            organizerLogo.hidden = true;
            organizerLogo.removeAttribute('src');
            organizerLogo.dataset.hasCustomOrganizerLogo = 'false';
            try { localStorage.removeItem(logoCacheKey); } catch (_) {}
          };
          if (organizerLogo.getAttribute('src') !== freshLogo) organizerLogo.src = freshLogo;
          organizerLogo.hidden = false;
          organizerLogo.dataset.hasCustomOrganizerLogo = 'true';
        } else {
          try { localStorage.removeItem(logoCacheKey); } catch (_) {}
          organizerLogo.hidden = true;
          organizerLogo.removeAttribute('src');
          organizerLogo.dataset.hasCustomOrganizerLogo = 'false';
        }
        organizerLogo.dataset.organizerLogoReady = 'true';
      }).catch(() => {
        // Keep a valid cached logo visible if the network is temporarily down.
        if (!organizerLogo || organizerLogo.dataset.organizerLogoId !== organizerId) return;
        organizerLogo.dataset.organizerLogoReady = 'true';
        if (isValidLogo(cachedLogo) && organizerLogo.getAttribute('src')) {
          organizerLogo.hidden = false;
          organizerLogo.dataset.hasCustomOrganizerLogo = 'true';
        } else {
          organizerLogo.hidden = true;
          organizerLogo.dataset.hasCustomOrganizerLogo = 'false';
        }
      });
    }

    const app = document.createElement('script');
    app.src = 'script.js?v=queueing-matches-filter-20261113-1';
    app.onerror = () => {
      console.error('Pickle Point Match could not load script.js.');
      window.__PPM_RELEASE_QUEUEING_STARTUP?.();
    };
    document.body.appendChild(app);
  }
  if (window.PPM_AUTH_READY && typeof window.PPM_AUTH_READY.then === 'function') {
    window.PPM_AUTH_READY.then(loadQueueingApp);
  } else {
    fetch('/api/auth-status', {cache:'no-store',credentials:'same-origin',headers:{'X-PPM-Auth-Role':'organizer'}}).then(response => response.json()).then(loadQueueingApp).catch(() => {});
  }
})();
