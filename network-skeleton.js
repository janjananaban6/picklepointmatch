/* Shared startup skeleton: only overlays a page while a first-load API request is slow. */
(() => {
  'use strict';
  if (window.__PPM_NETWORK_SKELETON_INSTALLED__) return;
  window.__PPM_NETWORK_SKELETON_INSTALLED__ = true;

  const originalFetch = window.fetch ? window.fetch.bind(window) : null;
  if (!originalFetch) return;

  const criticalPaths = new Set([
    '/api/auth-status',
    '/api/organizers/public',
    '/api/panel/organizers',
    '/api/app-state',
    '/api/cloud-records',
    '/api/live-state',
    '/api/live-theme',
    '/api/shared-events'
  ]);
  const seen = new Set();
  const pending = new Set();
  const startupDeadline = Date.now() + 25000;
  let overlay = null;
  let hideTimer = null;

  function screenType() {
    const path = (window.location.pathname || '').toLowerCase();
    if (path.endsWith('/index.html') || path === '/' || document.body?.classList.contains('organizer-login-page')) return 'login';
    if (path.endsWith('/panel.html') || document.body?.classList.contains('panel-page')) return 'panel';
    if (path.endsWith('/session.html') || document.body?.dataset?.page === 'start') return 'start';
    if (path.endsWith('/queueing.html') || document.body?.dataset?.page === 'queueing') return 'queueing';
    if (path.endsWith('/registration.html') || document.body?.classList.contains('registration-page-body')) return 'registration';
    return 'live';
  }

  const line = (width = 'w100', size = '') => `<div class="ppm-skeleton-line ${width} ${size}"></div>`;
  const card = (size = 'medium', contents = '') => `<div class="ppm-skeleton-card ${size}">${contents}</div>`;
  const row = () => `<div class="ppm-skeleton-list-row"><div class="ppm-skeleton-avatar"></div><div class="ppm-skeleton-row-copy">${line('w50')}${line('w30','sm')}</div><div class="ppm-skeleton-pill"></div></div>`;

  function pageMarkup(type) {
    const header = `<header class="ppm-skeleton-header"><div class="ppm-skeleton-brand"><div class="ppm-skeleton-logo"></div><div class="ppm-skeleton-brand-copy">${line('w100','lg')}${line('w70','sm')}</div></div><div class="ppm-skeleton-actions"><div class="ppm-skeleton-pill"></div><div class="ppm-skeleton-pill wide"></div></div></header>`;
    if (type === 'login') {
      return `${header}<section class="ppm-skeleton-login-card"><div class="ppm-skeleton-center"><div class="ppm-skeleton-login-mark"></div><div class="ppm-skeleton-heading"></div>${line('w80')}</div><div class="ppm-skeleton-form">${line('w30','sm')}<div class="ppm-skeleton-input"></div>${line('w30','sm')}<div class="ppm-skeleton-input"></div><div class="ppm-skeleton-button"></div></div></section>`;
    }
    if (type === 'panel') {
      return `${header}<main class="ppm-skeleton-content"><div class="ppm-skeleton-title"><div class="ppm-skeleton-heading"></div>${line('w50')}</div><div class="ppm-skeleton-grid cols-3">${card('short',`${line('w40','sm')}${line('w30','lg')}`)}${card('short',`${line('w40','sm')}${line('w30','lg')}`)}${card('short',`${line('w40','sm')}${line('w30','lg')}`)}</div>${card('tall',`<div class="ppm-skeleton-stack">${line('w40','lg')}<div class="ppm-skeleton-table">${Array.from({length:6},()=>`<div class="ppm-skeleton-table-row">${line('w80')}${line('w60')}${line('w50')}${line('w30')}</div>`).join('')}</div></div>`)}</main>`;
    }
    if (type === 'start') {
      return `${header}<main class="ppm-skeleton-content"><div class="ppm-skeleton-grid cols-2"><section class="ppm-skeleton-card tall"><div class="ppm-skeleton-stack"><div class="ppm-skeleton-heading"></div>${line('w70')}<div class="ppm-skeleton-input"></div>${line('w30','sm')}<div class="ppm-skeleton-input"></div>${line('w30','sm')}<div class="ppm-skeleton-input"></div><div class="ppm-skeleton-button"></div></div></section><section class="ppm-skeleton-card tall"><div class="ppm-skeleton-stack">${line('w50','lg')}${line('w80')}${line('w60')}${line('w100')}${line('w70')}${line('w40')}</div></section></div></main>`;
    }
    if (type === 'queueing') {
      // Keep the real topbar (including eventOrganizerStat) visible during a slow
      // startup fetch. Only the workspace gets a skeleton overlay on this page.
      return `<main class="ppm-skeleton-content"><div class="ppm-skeleton-title"><div class="ppm-skeleton-heading"></div>${line('w60')}</div><div class="ppm-skeleton-grid cols-4">${card('short',`${line('w50','sm')}${line('w30','lg')}`)}${card('short',`${line('w50','sm')}${line('w30','lg')}`)}${card('short',`${line('w50','sm')}${line('w30','lg')}`)}${card('short',`${line('w50','sm')}${line('w30','lg')}`)}</div><div class="ppm-skeleton-grid cols-2" style="margin-top:14px">${card('tall',`<div class="ppm-skeleton-stack">${line('w40','lg')}${Array.from({length:5},row).join('')}</div>`)}${card('tall',`<div class="ppm-skeleton-stack">${line('w40','lg')}<div class="ppm-skeleton-courts">${card('medium',`${line('w50','sm')}${line('w70','lg')}${line('w60')}`)}${card('medium',`${line('w50','sm')}${line('w70','lg')}${line('w60')}`)}</div>${line('w50')}</div>`)}</div></main>`;
    }
    if (type === 'registration') {
      return `${header}<main class="ppm-skeleton-content"><div class="ppm-skeleton-grid cols-2"><section class="ppm-skeleton-card tall"><div class="ppm-skeleton-stack"><div class="ppm-skeleton-heading"></div>${line('w70')}<div class="ppm-skeleton-input"></div>${line('w30','sm')}<div class="ppm-skeleton-input"></div>${line('w30','sm')}<div class="ppm-skeleton-input"></div><div class="ppm-skeleton-button"></div></div></section><section class="ppm-skeleton-card tall"><div class="ppm-skeleton-stack">${line('w50','lg')}${Array.from({length:4},row).join('')}</div></section></div></main>`;
    }
    return `${header}<main class="ppm-skeleton-content"><div class="ppm-skeleton-title"><div class="ppm-skeleton-heading"></div>${line('w60')}</div><div class="ppm-skeleton-tabs"><div class="ppm-skeleton-pill"></div><div class="ppm-skeleton-pill"></div><div class="ppm-skeleton-pill"></div></div><div class="ppm-skeleton-grid cols-2">${card('tall',`<div class="ppm-skeleton-stack">${line('w40','lg')}${Array.from({length:4},row).join('')}</div>`)}${card('tall',`<div class="ppm-skeleton-stack">${line('w40','lg')}<div class="ppm-skeleton-courts">${card('medium',`${line('w60','lg')}${line('w80')}${line('w50')}`)}${card('medium',`${line('w60','lg')}${line('w80')}${line('w50')}`)}</div>${line('w60')}</div>`)}</div></main>`;
  }

  function ensureOverlay() {
    if (overlay || !document.body) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'ppmNetworkSkeleton';
    overlay.className = 'ppm-network-skeleton';
    overlay.hidden = true;
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.setAttribute('aria-label', 'Loading page content');
    const type = screenType();
    if (type === 'queueing') overlay.classList.add('ppm-network-skeleton-queueing');
    overlay.innerHTML = `<div class="ppm-skeleton-shell">${pageMarkup(type)}</div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  function showSkeleton() {
    const el = ensureOverlay();
    if (!el) return;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (screenType() === 'queueing') {
      // Measure the real header so the loading overlay starts below it and can
      // never replace or visually resize the queueing topbar.
      const topbar = document.querySelector('body[data-page="queueing"] header.topbar');
      const bottom = topbar ? Math.max(0, Math.ceil(topbar.getBoundingClientRect().bottom)) : 0;
      el.style.top = `${bottom}px`;
      el.style.paddingTop = '10px';
    } else {
      el.style.top = '0px';
      el.style.paddingTop = '';
    }
    if (el.hidden) el.hidden = false;
  }

  function hideSkeleton() {
    if (!overlay) return;
    const stillSlow = [...pending].some(item => item.slow);
    if (stillSlow) return;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (![...pending].some(item => item.slow) && overlay) overlay.hidden = true;
      hideTimer = null;
    }, 130);
  }

  function trackedPath(input) {
    try {
      const raw = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
      const url = new URL(raw, window.location.href);
      return url.origin === window.location.origin && criticalPaths.has(url.pathname) ? url.pathname : '';
    } catch (_) { return ''; }
  }

  window.fetch = function (input, init) {
    const path = Date.now() <= startupDeadline ? trackedPath(input) : '';
    const method = String(init?.method || input?.method || 'GET').toUpperCase();
    if (!path || method !== 'GET' || seen.has(path)) return originalFetch(input, init);
    seen.add(path);

    const state = {slow: false, timer: null, expiry: null};
    pending.add(state);
    const delay = navigator.onLine === false ? 120 : 620;
    state.timer = setTimeout(() => {
      state.slow = true;
      showSkeleton();
      state.expiry = setTimeout(() => {
        state.slow = false;
        hideSkeleton();
      }, 12000);
    }, delay);

    let result;
    try { result = originalFetch(input, init); }
    catch (error) {
      clearTimeout(state.timer);
      pending.delete(state);
      hideSkeleton();
      throw error;
    }
    return Promise.resolve(result).finally(() => {
      clearTimeout(state.timer);
      if (state.expiry) clearTimeout(state.expiry);
      state.slow = false;
      pending.delete(state);
      hideSkeleton();
    });
  };

  window.addEventListener('offline', () => {
    for (const state of pending) {
      if (!state.slow && state.timer) {
        clearTimeout(state.timer);
        state.timer = setTimeout(() => {
          state.slow = true;
          showSkeleton();
          state.expiry = setTimeout(() => { state.slow = false; hideSkeleton(); }, 12000);
        }, 80);
      }
    }
  });
})();
