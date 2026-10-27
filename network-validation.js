/* Shared offline and API-connectivity validation for Pickle Point Match. */
(() => {
  'use strict';
  if (window.__PPM_NETWORK_VALIDATION_INSTALLED__) return;
  window.__PPM_NETWORK_VALIDATION_INSTALLED__ = true;

  const rawFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  const HEALTH_TIMEOUT_MS = 1700;
  const API_READ_TIMEOUT_MS = 4500;
  const CHECK_INTERVAL_MS = 25000;
  const RECENT_CHECK_MS = 6500;
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/i.test(location.hostname || '');
  let currentStatus = 'checking';
  let checkInFlight = null;
  let lastCheckAt = 0;
  let lastRoundTripMs = null;
  let banner = null;
  let bannerMessage = null;

  const state = () => ({
    status: currentStatus,
    connected: currentStatus === 'connected',
    browserOnline: navigator.onLine !== false,
    lastCheckAt,
    roundTripMs: lastRoundTripMs
  });

  function messageFor(status) {
    if (status === 'offline') return 'Offline — changes need a connection.';
    if (status === 'unreachable') return 'App server unavailable — retrying automatically.';
    return '';
  }

  function mountBanner() {
    if (banner || !document.body) return;
    banner = document.createElement('div');
    banner.id = 'ppmNetworkValidationBanner';
    banner.className = 'ppm-network-validation-banner';
    banner.hidden = true;
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.setAttribute('aria-atomic', 'true');

    const dot = document.createElement('span');
    dot.className = 'ppm-network-validation-dot';
    dot.setAttribute('aria-hidden', 'true');
    bannerMessage = document.createElement('span');
    bannerMessage.className = 'ppm-network-validation-message';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'ppm-network-validation-retry';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => check(true));
    banner.append(dot, bannerMessage, retry);
    document.body.appendChild(banner);
    renderBanner();
  }

  function renderBanner() {
    if (!banner) return;
    const message = messageFor(currentStatus);
    banner.hidden = !message;
    banner.dataset.state = currentStatus;
    if (bannerMessage) bannerMessage.textContent = message;
  }

  function setState(status, detail = {}) {
    const allowed = new Set(['checking', 'connected', 'offline', 'unreachable']);
    if (!allowed.has(status)) status = 'unreachable';
    const changed = currentStatus !== status;
    currentStatus = status;
    if (Number.isFinite(detail.roundTripMs)) lastRoundTripMs = detail.roundTripMs;
    document.documentElement.dataset.networkState = status;
    if (document.body) {
      mountBanner();
      renderBanner();
    }
    if (changed) {
      window.dispatchEvent(new CustomEvent('ppm-network-state-change', {detail: state()}));
    }
  }

  function parseApiUrl(input) {
    try {
      const raw = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
      const url = new URL(raw, location.href);
      if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return null;
      return url;
    } catch (_) {
      return null;
    }
  }

  function combineSignals(originalSignal, timeoutSignal) {
    if (!originalSignal) return timeoutSignal;
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
      return AbortSignal.any([originalSignal, timeoutSignal]);
    }
    const combined = new AbortController();
    const abortFromOriginal = () => combined.abort(originalSignal.reason);
    const abortFromTimeout = () => combined.abort(timeoutSignal.reason);
    if (originalSignal.aborted) abortFromOriginal();
    else originalSignal.addEventListener('abort', abortFromOriginal, {once: true});
    if (timeoutSignal.aborted) abortFromTimeout();
    else timeoutSignal.addEventListener('abort', abortFromTimeout, {once: true});
    return combined.signal;
  }

  // Bound read-only API waits so a stalled connection is detected quickly.
  // Mutating requests are deliberately never retried or aborted by this wrapper,
  // avoiding duplicate registration, account, queue, and match actions.
  if (rawFetch) {
    window.fetch = function ppmValidatedFetch(input, init = {}) {
      const url = parseApiUrl(input);
      const method = String(init.method || input?.method || 'GET').toUpperCase();
      if (!url) return rawFetch(input, init);
      if (method !== 'GET') {
        // When a remote host is known to be unreachable, verify it before sending
        // a write command. The command itself is never automatically retried.
        if (!isLocalHost && (currentStatus === 'offline' || currentStatus === 'unreachable')) {
          return check(true).then(reachable => {
            if (!reachable) throw new TypeError('The Pickle Point Match server is unavailable. The command was not sent.');
            return rawFetch(input, init);
          });
        }
        return rawFetch(input, init);
      }

      const suppliedSignal = init.signal || (typeof Request !== 'undefined' && input instanceof Request ? input.signal : null);
      const timeoutController = new AbortController();
      const timeoutId = window.setTimeout(() => timeoutController.abort(new DOMException('API read timed out', 'TimeoutError')), API_READ_TIMEOUT_MS);
      const requestInit = {...init, signal: combineSignals(suppliedSignal, timeoutController.signal)};

      return rawFetch(input, requestInit).then(response => {
        if (response.status < 500) setState('connected');
        else scheduleCheck(true);
        return response;
      }).catch(error => {
        if (!(suppliedSignal && suppliedSignal.aborted)) scheduleCheck(true);
        throw error;
      }).finally(() => window.clearTimeout(timeoutId));
    };
  }

  async function check(force = false) {
    if (!rawFetch || !['http:', 'https:'].includes(location.protocol)) {
      setState('unreachable');
      return false;
    }
    if (checkInFlight) return checkInFlight;
    if (!force && Date.now() - lastCheckAt < RECENT_CHECK_MS && currentStatus !== 'checking') {
      return currentStatus === 'connected';
    }

    const startedAt = performance.now();
    lastCheckAt = Date.now();
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const healthUrl = new URL('/api/health', location.href);
    healthUrl.searchParams.set('_', String(Date.now()));

    checkInFlight = (async () => {
      try {
        const response = await rawFetch(healthUrl.href, {
          method: 'GET',
          cache: 'no-store',
          credentials: 'same-origin',
          headers: {'Accept': 'application/json'},
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Health check returned HTTP ${response.status}`);
        const payload = await response.json();
        if (!payload || payload.ok !== true) throw new Error('Health check did not confirm the app server');
        const roundTripMs = Math.max(0, Math.round(performance.now() - startedAt));
        setState('connected', {roundTripMs});
        return true;
      } catch (_) {
        setState(navigator.onLine === false && !isLocalHost ? 'offline' : 'unreachable');
        return false;
      } finally {
        window.clearTimeout(timeoutId);
        checkInFlight = null;
      }
    })();
    return checkInFlight;
  }

  let scheduledCheck = null;
  function scheduleCheck(force = false, delay = 150) {
    if (scheduledCheck !== null) window.clearTimeout(scheduledCheck);
    scheduledCheck = window.setTimeout(() => {
      scheduledCheck = null;
      if (!document.hidden) check(force);
    }, delay);
  }

  window.PPMNetworkValidation = {
    check: () => check(true),
    state,
    isConnected: () => currentStatus === 'connected',
    isOffline: () => currentStatus === 'offline' || currentStatus === 'unreachable'
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      mountBanner();
      check(true);
    }, {once: true});
  } else {
    mountBanner();
    check(true);
  }

  window.addEventListener('online', () => scheduleCheck(true, 0));
  window.addEventListener('offline', () => {
    setState('offline');
    scheduleCheck(true, 250);
  });
  window.addEventListener('focus', () => {
    if (Date.now() - lastCheckAt >= RECENT_CHECK_MS) scheduleCheck(false, 0);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastCheckAt >= RECENT_CHECK_MS) scheduleCheck(false, 0);
  });
  window.setInterval(() => {
    if (!document.hidden && Date.now() - lastCheckAt >= CHECK_INTERVAL_MS) check();
  }, CHECK_INTERVAL_MS);
})();
