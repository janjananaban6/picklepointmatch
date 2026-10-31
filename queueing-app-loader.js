/* Load the queue workspace only after the organizer identity is known. This keeps
   local queue caches namespaced per organizer before the queue script initializes. */
(function () {
  function loadQueueingApp(status) {
    if (!status || status.role !== 'organizer' || !status.organizerId) return;
    window.PPM_ORGANIZER_ID = status.organizerId;
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
    app.src = 'script.js?v=organizer-scoped-dupr-registration-20261028-1&organizer-stat-text-only=20261029-1&queueing-startup-stability=20261029-1&qr-logo-assignment=20261024-2&organizer-title-badge=20261024-1&event-rules-enabled-20261026-1&left-section-empty-20261026-1&court-dupr-label-20261026-1&court-player-inline-meta-20261026-1&court-dupr-editor-touch-size-20261026-1&dupr-label-toggle-20261026-1&dupr-csv-export=20261028-3&end-session-details=20261028-1&dupr-location-archive=20261031-1&queue-dupr-toggle-header=20261026-2&queue-dupr-text-only=20261026-1&end-session-attendee-panel=20261029-1-synced-motion&registered-player-edit=20261028-1&session-lifecycle-qr-guards=20261028-2&cloud-player-stats-removed=20261028-1&left-player-dupr-id=20261029-1&registered-cloud-dupr-inline-edit=20261029-2&cloud-dupr-stable-anchor=20261029-2&cloud-dupr-no-shift-final=20261029-1&queue-self-rating-removed=20261029-1&dupr-id-no-spaces=20261029-1&cloud-edit-side-panel=20261029-1-smooth-slide&cloud-player-edit-form=20261029-2-category-buttons&cloud-edit-live-preview=20261029-1&cloud-edit-gender-two-options=20261029-1&cloud-edit-dupr-empty-state=20261029-1&cloud-edit-live-follow-responsive=20261029-2-no-autofocus-fit-content&cloud-edit-loading-animation=20261029-1&cloud-edit-dupr-slot-select-all=20261029-1&cloud-record-actions-20261029=1&cloud-edit-width=20261029-1&cloud-dupr-slot-static=20261029-1&cloud-category-full-labels=20261029-2-live-edit-follow&queue-dupr-badge-fix=20261029-1&court-dupr-input-text=20261029-2&court-dupr-ipad-no-width-writes=20261029-2&dupr-toggle-court-glitch-fix=20261029-4-stable-slot-height&stability-cleanup=20261030-1&cloud-edit-slide-motion=20261030-2-transform-ease';
    app.onerror = () => {
      console.error('Pickle Point Match could not load script.js.');
      window.__PPM_RELEASE_QUEUEING_STARTUP?.();
    };
    document.body.appendChild(app);
  }
  if (window.PPM_AUTH_READY && typeof window.PPM_AUTH_READY.then === 'function') {
    window.PPM_AUTH_READY.then(loadQueueingApp);
  } else {
    fetch('/api/auth-status', {cache:'no-store',credentials:'same-origin'}).then(response => response.json()).then(loadQueueingApp).catch(() => {});
  }
})();
