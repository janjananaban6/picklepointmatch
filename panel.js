(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const rows = $('organizerRows');
  const pendingApplicationsSection = $('pendingApplicationsSection');
  const pendingApplicationRows = $('pendingApplicationRows');
  const pendingApplicationsBadge = $('pendingApplicationsBadge');
  const modal = $('accountModal');
  const modalDialog = modal.querySelector('.panel-modal-dialog');
  const logoutModal = $('panelLogoutModal');
  const logoutDialog = logoutModal.querySelector('.logout-confirm-dialog');
  const settingsModal = $('panelSettingsModal');
  const settingsDialog = settingsModal.querySelector('.panel-settings-dialog');
  const editForm = $('editOrganizerForm');
  const confirmBody = $('confirmModalBody');
  const confirmButton = $('confirmAccountAction');
  const themeKey = 'ppm-panel-theme';
  const settingsKey = 'ppm-panel-settings-v1';
  const defaultPanelSettings = {theme:'light', interfaceFont:'anthropic-sans', chatFont:'anthropic-serif', textSize:'medium', transcriptWidth:'narrow', motion:'system', voiceLanguage:'English', voiceStyle:'Buttery', voiceSpeed:'Normal'};
  let panelSettings = {...defaultPanelSettings};
  let accounts = [];
  let selectedAccount = null;
  let pendingAction = null;
  let returnFocusTo = null;
  let logoutReturnFocusTo = null;
  let toastTimer = null;
  const statusToast = document.createElement('div');
  statusToast.className = 'panel-toast';
  statusToast.setAttribute('role', 'status');
  statusToast.setAttribute('aria-live', 'polite');
  document.body.appendChild(statusToast);
  let avatarData = '';
  let avatarChanged = false;
  let isSavingProfile = false;

  function setNotice(message, error = false) {
    if (!message) return;
    statusToast.textContent = message;
    statusToast.classList.toggle('is-error', !!error);
    statusToast.classList.add('is-visible');
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => statusToast.classList.remove('is-visible'), 4200);
  }
  function safeText(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function formatDate(value) {
    if (!value) return 'Never';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(undefined, {year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}).format(date);
  }
  function initials(account) {
    const name = String(account?.displayName || account?.username || 'Organizer').trim();
    return name.split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join('').toUpperCase() || 'OP';
  }
  function safeProfileImage(value) {
    const image = String(value || '');
    return /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image) ? image : '';
  }
  async function request(url, options = {}) {
    const response = await fetch(url, {
      cache: 'no-store', credentials: 'same-origin', ...options,
      headers: {'Content-Type':'application/json', ...(options.headers || {})}
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.replace('/index.html');
      throw new Error('Your administrator session has expired. Please sign in again.');
    }
    if (!response.ok || data.ok === false) throw new Error(data.error || 'The request could not be completed.');
    return data;
  }

  const organizerApprovalCutover = Date.parse('2026-10-25T16:00:00.000Z');
  function isPendingApproval(account) {
    const status = String(account?.approvalStatus || '').trim().toLowerCase();
    if (status === 'rejected') return false;

    // The submission timestamp is retained for audit/history after approval.
    // It must never override the explicit administrator approval marker.
    if (status === 'pending') return true;
    const source = String(account?.createdBy || 'registration').trim().toLowerCase();
    if (source === 'panel' || source === 'legacy-environment' || account?.adminApproved === true) return false;
    if (status === 'approved' && account?.approvedAt) return false;

    // Only an unapproved application is pending because it has a submission time.
    if (account?.applicationSubmittedAt) return true;
    const createdAt = Date.parse(account?.createdAt || '');
    return !Number.isFinite(createdAt) || createdAt >= organizerApprovalCutover;
  }

  function renderAccounts() {
    // Defense in depth: recent/ambiguous self-registrations must show as pending
    // even if an older API payload accidentally reports active/approved.
    accounts = accounts.map(account => {
      if (isPendingApproval(account)) return {...account, active:false, approvalStatus:'pending', adminApproved:false};
      return account;
    });
    $('totalAccounts').textContent = String(accounts.length);
    $('activeAccounts').textContent = String(accounts.filter(account => account.active).length);
    $('inactiveAccounts').textContent = String(accounts.filter(account => !account.active && (account.approvalStatus || 'approved') !== 'pending').length);
    const pendingAccounts = accounts.filter(isPendingApproval);
    $('pendingAccounts').textContent = String(pendingAccounts.length);
    // Keep the approval area visible even when empty, so admins always have
    // a clear place to review new signups and can distinguish an empty queue.
    pendingApplicationsSection.hidden = false;
    pendingApplicationsBadge.textContent = `${pendingAccounts.length} pending`;
    pendingApplicationRows.innerHTML = pendingAccounts.length ? pendingAccounts.map(account => {
      const image = safeProfileImage(account.profileImage);
      const avatar = image
        ? `<img class="pending-organizer-avatar" src="${safeText(image)}" alt="${safeText(account.displayName || account.username)} logo" loading="lazy">`
        : `<span class="pending-organizer-avatar pending-organizer-initials" aria-hidden="true">${safeText(initials(account))}</span>`;
      const appliedAt = formatDate(account.applicationSubmittedAt || account.createdAt);
      const clubLine = `<small class="pending-organizer-club-id">Club ID: ${safeText(account.clubId || 'Assigning…')}</small>`;
      const duprLine = account.duprId ? `<small class="pending-organizer-dupr">DUPR: ${safeText(account.duprId)}</small>` : '';
      return `<article class="pending-application-card" data-id="${safeText(account.id)}">
        <div class="pending-application-identity">${avatar}<div class="pending-application-copy"><strong>${safeText(account.displayName || account.username)}</strong><span>@${safeText(account.username)}</span>${clubLine}${duprLine}<small>Submitted ${safeText(appliedAt)}</small></div></div>
        <div class="pending-application-status"><span class="status-pill pending">Pending approval</span></div>
        <div class="pending-application-actions"><button class="row-action approve-action pending-confirm-button" type="button" data-action="approve">Confirm organizer</button><button class="row-action danger pending-reject-button" type="button" data-action="reject">Reject application</button></div>
      </article>`;
    }).join('') : '<div class="pending-application-empty" role="status"><span class="pending-application-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.2 4.2L19 7"/></svg></span><span class="pending-application-empty-copy"><strong>No pending applications</strong><span>There are no organizer applications waiting for approval. New registrations will appear here.</span></span></div>';
    if (!accounts.length) {
      rows.innerHTML = '<tr><td colspan="7" class="empty-row">No organizer accounts yet. Organizer applications will appear here.</td></tr>';
      return;
    }
    rows.innerHTML = accounts.map(account => {
      const approvalStatus = isPendingApproval(account) ? 'pending' : (account.approvalStatus || 'approved');
      const status = approvalStatus === 'pending'
        ? '<span class="status-pill pending">Pending approval</span>'
        : approvalStatus === 'rejected'
          ? '<span class="status-pill rejected">Rejected</span>'
          : account.active
            ? '<span class="status-pill active">Active</span>'
            : '<span class="status-pill inactive">Inactive</span>';
      const actionButton = approvalStatus === 'pending'
        ? '<button class="row-action approve-action" type="button" data-action="approve"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7"/></svg><span>Approve</span></button><button class="row-action danger" type="button" data-action="reject"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg><span>Reject</span></button>'
        : `<button class="row-action ${account.active ? 'deactivate-action' : 'activate-action'}" type="button" data-action="toggle"><svg viewBox="0 0 24 24" aria-hidden="true">${account.active ? '<path d="M8 5v14M16 5v14"/>' : '<path d="m8 5 11 7-11 7Z"/>'}</svg><span>${account.active ? 'Deactivate' : (approvalStatus === 'rejected' ? 'Re-approve' : 'Activate')}</span></button>`;
      const image = safeProfileImage(account.profileImage);
      const avatar = image
        ? `<img class="organizer-avatar" src="${safeText(image)}" alt="${safeText(account.displayName || account.username)} profile photo" loading="lazy">`
        : `<span class="organizer-avatar" aria-hidden="true">${safeText(initials(account))}</span>`;
      const requestDate = account.applicationSubmittedAt || account.createdAt;
      const systemClubId = String(account.clubId || '').trim();
      const clubIdLine = `<span class="organizer-sub club-id-sub"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M8 9h8M8 12h8M8 15h4"/></svg> Club ID: ${safeText(systemClubId || 'Assigning…')}</span>`;
      const duprOrganizerLine = account.duprOrganizerId
        ? `<span class="organizer-sub dupr-organizer-id-sub">External DUPR Organizer ID: ${safeText(account.duprOrganizerId)}</span>`
        : '';
      const personalDupr = String(account.duprId || account.personalDuprId || account.duprID || account.dupr_id || '').trim();
      const duprCell = personalDupr
        ? `<span class="dupr-id-chip" title="Personal DUPR ID"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12h7M12 8.5v7"/></svg><span>${safeText(personalDupr)}</span></span>`
        : '<span class="dupr-id-empty">Not set</span>';
      const currentPassword = String(account.passwordDisplay || '');
      const passwordCell = currentPassword
        ? `<div class="password-row-cell"><code class="password-visible-text" title="Current organizer password">${safeText(currentPassword)}</code></div>`
        : `<div class="password-row-cell"><span class="password-unavailable" title="This older account has only a one-way password hash">Reset once</span><button type="button" class="row-action password-reset-action" data-action="edit" aria-label="Set a viewable password" title="Set a new password to make it viewable"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8 2 2-2 2 2 2-3 3-2-2-3 3"/></svg><span>Set</span></button></div>`;
      return `<tr data-id="${safeText(account.id)}">
        <td data-label="Organizer"><div class="organizer-cell">${avatar}<span class="organizer-cell-copy"><span class="organizer-name">${safeText(account.displayName || account.username)}</span><span class="organizer-sub">${approvalStatus === 'pending' ? 'Applied ' : 'Added '}${safeText(formatDate(requestDate))}</span>${clubIdLine}${duprOrganizerLine}</span></div></td>
        <td data-label="Username"><span class="username-text">${safeText(account.username)}</span></td>
        <td data-label="DUPR ID">${duprCell}</td>
        <td data-label="Password">${passwordCell}</td>
        <td data-label="Status">${status}</td>
        <td data-label="Last sign in">${safeText(formatDate(account.lastLoginAt))}</td>
        <td data-label="Actions"><div class="action-wrap"><button class="row-action edit-action" type="button" data-action="edit"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5 5 5M4 20l4.2-.8L19 8.4 15.6 5 4.8 15.8 4 20Z"/></svg><span>Edit</span></button>${actionButton}<button class="row-action danger" type="button" data-action="delete"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5M14 11v5"/></svg><span>Delete</span></button></div></td>
      </tr>`;
    }).join('');
  }

  async function loadAccounts() {
    try {
      const data = await request('/api/panel/organizers');
      accounts = Array.isArray(data.organizers) ? data.organizers : [];
      renderAccounts();
    } catch (error) {
      // Replace the perpetual loading placeholder with a visible error state.
      // This also makes it clear when the empty-state data could not be fetched.
      pendingApplicationsSection.hidden = false;
      pendingApplicationsBadge.textContent = 'Unavailable';
      pendingApplicationRows.innerHTML = `<div class="pending-application-empty pending-application-error" role="alert"><span class="pending-application-empty-icon" aria-hidden="true">!</span><span class="pending-application-empty-copy"><strong>Could not load applications</strong><span>${safeText(error.message || 'Check the connection and refresh the panel.')}</span></span></div>`;
      rows.innerHTML = '<tr><td colspan="7" class="empty-row">Unable to load organizer accounts. Check the connection and refresh the panel.</td></tr>';
      setNotice(error.message || 'Unable to load organizer accounts.', true);
    }
  }

  // Panel appearance and UI preferences are local to this panel page.
  function loadPanelSettings() {
    const loaded = {...defaultPanelSettings};
    try {
      const saved = JSON.parse(localStorage.getItem(settingsKey) || '{}');
      if (saved && typeof saved === 'object') {
        const allowed = {
          theme: ['system','light','dark'],
          interfaceFont: ['anthropic-sans','system','opendyslexic'],
          chatFont: ['anthropic-serif','anthropic-sans','system','opendyslexic'],
          textSize: ['small','medium','large'],
          transcriptWidth: ['narrow','medium','wide'],
          motion: ['system','reduced'],
          voiceLanguage: ['English','Filipino','Spanish','French','Japanese','Korean'],
          voiceStyle: ['Buttery','Bright','Calm','Warm','Professional'],
          voiceSpeed: ['Slow','Normal','Fast','Faster']
        };
        Object.keys(allowed).forEach(key => {
          if (allowed[key].includes(saved[key])) loaded[key] = saved[key];
        });
      }
    } catch (_) {}
    // Keep support for the older theme-only preference stored by previous versions.
    try {
      const legacyTheme = localStorage.getItem(themeKey);
      if ((!localStorage.getItem(settingsKey) || !JSON.parse(localStorage.getItem(settingsKey) || '{}').theme) && ['light','dark','system'].includes(legacyTheme)) {
        loaded.theme = legacyTheme;
      }
    } catch (_) {}
    return loaded;
  }

  function savePanelSettings() {
    try {
      localStorage.setItem(settingsKey, JSON.stringify(panelSettings));
      localStorage.setItem(themeKey, panelSettings.theme);
    } catch (_) {}
  }

  function syncSettingsControls() {
    document.querySelectorAll('[data-theme-choice]').forEach(button => {
      const active = button.dataset.themeChoice === panelSettings.theme;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const selectMap = {
      panelSettingInterfaceFont: 'interfaceFont',
      panelSettingChatFont: 'chatFont',
      panelSettingVoiceLanguage: 'voiceLanguage',
      panelSettingVoiceStyle: 'voiceStyle',
      panelSettingVoiceSpeed: 'voiceSpeed'
    };
    Object.entries(selectMap).forEach(([id, key]) => {
      const select = $(id);
      if (select) select.value = panelSettings[key];
    });
    settingsModal.querySelectorAll('[data-font-dropdown]').forEach(dropdown => {
      const select = $(dropdown.dataset.fontDropdown);
      const current = dropdown.querySelector('[data-dropdown-current]');
      if (select && current) current.textContent = select.selectedOptions[0]?.textContent || 'Select font';
      dropdown.querySelectorAll('[data-font-value]').forEach(optionButton => {
        const selected = !!select && optionButton.dataset.fontValue === select.value;
        optionButton.classList.toggle('is-selected', selected);
        optionButton.setAttribute('aria-selected', String(selected));
      });
    });
    document.querySelectorAll('[data-setting-key]').forEach(button => {
      const active = button.dataset.settingChoice === panelSettings[button.dataset.settingKey];
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function applyPanelSettings() {
    const fontMap = {
      'anthropic-sans': "'DM Sans', Arial, sans-serif",
      'manrope': "'Manrope', Arial, sans-serif",
      'system': "system-ui, -apple-system, 'Segoe UI', sans-serif",
      'inter': "Inter, 'DM Sans', Arial, sans-serif",
      'arial': 'Arial, sans-serif',
      'georgia': 'Georgia, serif',
      'opendyslexic': "'OpenDyslexic', 'Comic Sans MS', Arial, sans-serif",
      'anthropic-serif': "Georgia, 'Times New Roman', serif"
    };
    document.documentElement.style.setProperty('--panel-interface-font', fontMap[panelSettings.interfaceFont] || fontMap['anthropic-sans']);
    document.body.style.setProperty('--panel-chat-font', panelSettings.chatFont === 'anthropic-serif' ? "Georgia, 'Times New Roman', serif" : (fontMap[panelSettings.chatFont] || fontMap['anthropic-sans']));
    document.body.dataset.panelTextSize = panelSettings.textSize;
    document.body.dataset.panelTranscriptWidth = panelSettings.transcriptWidth;
    document.body.dataset.panelMotion = panelSettings.motion === 'reduced' || (panelSettings.motion === 'system' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ? 'reduced' : 'system';
    syncSettingsControls();
  }

  function setTheme(theme, persist = true) {
    const preference = ['system','light','dark'].includes(theme) ? theme : 'light';
    const systemDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
    panelSettings.theme = preference;
    document.body.dataset.theme = resolved;
    document.body.dataset.panelThemePreference = preference;
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.content = resolved === 'light' ? '#f1f7f8' : '#061f27';
    syncSettingsControls();
    if (persist) savePanelSettings();
  }

  function loadTheme() {
    return panelSettings.theme || 'light';
  }

  function showAvatarPreview() {
    const image = $('organizerAvatarPreview');
    const fallback = $('avatarFallback');
    const current = safeProfileImage(avatarData);
    if (current) {
      image.src = current;
      image.hidden = false;
      fallback.hidden = true;
    } else {
      image.removeAttribute('src');
      image.hidden = true;
      fallback.hidden = false;
      fallback.textContent = initials(selectedAccount);
    }
  }

  function syncModalLock() {
    const open = [modal, logoutModal, settingsModal].some(element => element && !element.hidden);
    document.body.classList.toggle('modal-open', open);
  }
  let settingsReturnFocusTo = null;
  function openSettingsModal() {
    if (!settingsModal.hidden) return;
    settingsReturnFocusTo = document.activeElement;
    settingsModal.hidden = false;
    syncModalLock();
    window.requestAnimationFrame(() => settingsDialog.focus({preventScroll:true}));
  }
  function closeSettingsModal() {
    if (settingsModal.hidden) return;
    settingsModal.hidden = true;
    syncModalLock();
    const target = settingsReturnFocusTo;
    settingsReturnFocusTo = null;
    if (target && target.isConnected && typeof target.focus === 'function') target.focus({preventScroll:true});
  }
  function selectSettingsPage(page) {
    const titles = {
      general: 'General', account: 'Account', privacy: 'Privacy', billing: 'Billing',
      capabilities: 'Capabilities', memory: 'Memory', reflect: 'Reflect',
      'time-focus': 'Time and focus', 'claude-code': 'Claude Code', skills: 'Skills',
      connectors: 'Connectors', plugins: 'Plugins'
    };
    const messages = {
      account: 'Organizer accounts are managed from the Panel page. Use the Edit, Reset, activate, or deactivate controls available on each account row.',
      privacy: 'This panel uses your current administrator session and saves appearance preferences in this browser. It does not connect to a third-party account.',
      billing: 'Billing settings are not configured for Pickle Point Match.',
      capabilities: 'This panel is designed for organizer account management. Additional capabilities can be added without changing your current queueing setup.',
      memory: 'Separate memory settings are not available in Pickle Point Match.',
      reflect: 'Reflection tools are not available in this panel.',
      'time-focus': 'Time and focus controls are not currently available in this panel.',
      'claude-code': 'Developer tools are not configured in Pickle Point Match.',
      skills: 'Skills customization is not currently available in this panel.',
      connectors: 'No external connectors are configured for this panel.',
      plugins: 'Plugin management is not available in this panel.'
    };
    document.querySelectorAll('[data-settings-page]').forEach(button => {
      const active = button.dataset.settingsPage === page;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    $('panelSettingsGeneral').hidden = page !== 'general';
    $('panelSettingsPlaceholder').hidden = page === 'general';
    $('panelSettingsTitle').textContent = titles[page] || 'Settings';
    $('panelSettingsPlaceholderTitle').textContent = titles[page] || 'Settings';
    $('panelSettingsPlaceholderText').textContent = messages[page] || 'These settings are not available yet.';
    $('panelSettingsScroll').scrollTop = 0;
  }
  function saveSetting(key, value) {
    panelSettings[key] = value;
    if (key === 'theme') setTheme(value, true);
    else { savePanelSettings(); applyPanelSettings(); }
  }

  function openModal() {
    returnFocusTo = document.activeElement;
    modal.hidden = false;
    syncModalLock();
    window.requestAnimationFrame(() => modalDialog.focus({preventScroll:true}));
  }
  function closeModal() {
    if (modal.hidden || isSavingProfile) return;
    modal.hidden = true;
    syncModalLock();
    pendingAction = null;
    selectedAccount = null;
    const target = returnFocusTo;
    returnFocusTo = null;
    if (target && target.isConnected && typeof target.focus === 'function') target.focus({preventScroll:true});
  }
  function openLogoutModal() {
    logoutReturnFocusTo = document.activeElement;
    logoutModal.hidden = false;
    syncModalLock();
    window.requestAnimationFrame(() => $('cancelPanelLogout').focus({preventScroll:true}));
  }
  function closeLogoutModal() {
    if (logoutModal.hidden) return;
    logoutModal.hidden = true;
    syncModalLock();
    const target = logoutReturnFocusTo;
    logoutReturnFocusTo = null;
    if (target && target.isConnected && typeof target.focus === 'function') target.focus({preventScroll:true});
  }
  function configureModal({title, description, icon = '✦', mode}) {
    $('accountModalTitle').textContent = title;
    $('accountModalDescription').textContent = description;
    $('modalIcon').textContent = icon;
    editForm.hidden = mode !== 'edit';
    confirmBody.hidden = mode !== 'confirm';
    $('editModalError').textContent = '';
    $('confirmModalError').textContent = '';
  }
  function openEditModal(account) {
    selectedAccount = account;
    pendingAction = 'edit';
    avatarData = safeProfileImage(account.profileImage);
    avatarChanged = false;
    configureModal({title:'Edit organizer profile', description:'Update the account details and profile photo.', icon:'✎', mode:'edit'});
    $('editDisplayName').value = account.displayName || account.username || '';
    $('editUsername').value = account.username || '';
    $('editClubId').value = account.clubId || ''; 
    $('editDuprId').value = account.duprId || account.personalDuprId || account.duprID || account.dupr_id || '';
    $('editDuprOrganizerId').value = account.duprOrganizerId || account.dupr_organizer_id || '';
    const currentPassword = typeof account.passwordDisplay === 'string' ? account.passwordDisplay : '';
    $('editPassword').value = currentPassword;
    $('organizerProfileImage').value = '';
    $('toggleEditPassword').textContent = 'Hide';
    $('toggleEditPassword').setAttribute('aria-label', 'Hide password');
    $('editPassword').type = 'text';
    $('editPassword').placeholder = currentPassword ? 'Current password' : 'Password unavailable — enter a replacement';
    $('passwordEditHint').textContent = currentPassword
      ? 'Current password is shown. Change this field only to replace the password.'
      : 'This older account has only a one-way hash, so its original password cannot be recovered. Set a replacement once to show it here and on the row.';
    showAvatarPreview();
    openModal();
    $('editDisplayName').focus({preventScroll:true});
  }
  function openConfirmModal(account, action) {
    selectedAccount = account;
    pendingAction = action;
    const isDelete = action === 'delete';
    const isApprove = action === 'approve' || (action === 'toggle' && account.approvalStatus === 'rejected');
    const isReject = action === 'reject';
    const willDeactivate = action === 'toggle' && account.active;
    const title = isDelete ? 'Delete organizer?' : isApprove ? 'Confirm organizer activation?' : isReject ? 'Reject organizer application?' : (willDeactivate ? 'Deactivate organizer?' : 'Activate organizer?');
    const actionName = isDelete ? 'delete' : isApprove ? 'approve' : isReject ? 'reject' : (willDeactivate ? 'deactivate' : 'activate');
    configureModal({title, description: isDelete ? 'This action cannot be undone.' : isApprove ? 'Administrator confirmation is required before organizer access is activated.' : isReject ? 'The application will remain unable to sign in.' : 'Confirm this account status change.', icon: isDelete || isReject || willDeactivate ? '!' : '✓', mode:'confirm'});
    $('confirmModalText').textContent = isDelete
      ? `Delete ${account.displayName || account.username} (@${account.username})?`
      : isApprove
        ? `Approve ${account.displayName || account.username} (@${account.username}) as a Pickle Point Match organizer?`
        : isReject
          ? `Reject the organizer application from ${account.displayName || account.username} (@${account.username})?`
          : `Are you sure you want to ${actionName} ${account.displayName || account.username}?`;
    $('confirmModalDetail').textContent = isDelete
      ? 'The organizer account and its separate queue/session state will be removed. The shared Registered Player Cloud remains shared.'
      : isApprove
        ? 'This approval will activate the account and allow the organizer to sign in and manage their own live queue.'
        : isReject
          ? 'This application will be marked as rejected. The applicant will not be able to sign in unless you approve the account later.'
          : (willDeactivate
            ? 'This organizer will no longer be able to sign in. Existing requests will be blocked when the account is checked again.'
            : 'This organizer will be able to sign in and manage their own live queue again.');
    confirmButton.textContent = isDelete ? 'Delete account' : isApprove ? 'Confirm & activate organizer' : isReject ? 'Confirm rejection' : (willDeactivate ? 'Deactivate account' : 'Activate account');
    confirmButton.classList.toggle('danger-confirm', isDelete || isReject || willDeactivate);
    openModal();
    confirmButton.focus({preventScroll:true});
  }

  async function confirmPendingAction() {
    if (!selectedAccount || !pendingAction || confirmButton.disabled) return;
    const account = selectedAccount;
    const action = pendingAction;
    confirmButton.disabled = true;
    confirmButton.textContent = action === 'delete' ? 'Deleting…' : action === 'approve' ? 'Approving…' : action === 'reject' ? 'Rejecting…' : 'Updating…';
    $('confirmModalError').textContent = '';
    try {
      const endpoint = `/api/panel/organizers/${encodeURIComponent(account.id)}`;
      if (action === 'delete') {
        await request(endpoint, {method:'DELETE'});
        closeModal();
        setNotice(`Deleted organizer account ${account.username}.`);
      } else if (action === 'approve' || (action === 'toggle' && account.approvalStatus === 'rejected')) {
        const result = await request(endpoint, {method:'PATCH', body:JSON.stringify({approvalStatus:'approved'})});
        const approved = result?.organizer;
        if (!approved || approved.approvalStatus !== 'approved' || approved.active !== true || approved.adminApproved !== true) {
          throw new Error('The server did not confirm organizer activation. Please try again.');
        }

        // Verify the saved status from the panel API before closing the dialog or
        // reporting success. The submission timestamp remains for audit purposes.
        const refreshed = await request('/api/panel/organizers');
        const latestAccounts = Array.isArray(refreshed.organizers) ? refreshed.organizers : [];
        const savedApproval = latestAccounts.find(item => String(item.id) === String(account.id));
        if (!savedApproval || savedApproval.approvalStatus !== 'approved' || savedApproval.active !== true || savedApproval.adminApproved !== true) {
          throw new Error('Approval was submitted, but the saved account status could not be verified. Refresh the panel and try again.');
        }
        accounts = latestAccounts;
        renderAccounts();
        closeModal();
        setNotice(`Approved ${account.username}. The organizer is now active and can sign in.`);
      } else if (action === 'reject') {
        await request(endpoint, {method:'PATCH', body:JSON.stringify({approvalStatus:'rejected'})});
        closeModal();
        setNotice(`Rejected the application from ${account.username}.`);
      } else {
        await request(endpoint, {method:'PATCH', body:JSON.stringify({active:!account.active})});
        closeModal();
        setNotice(`${account.username} is now ${account.active ? 'inactive' : 'active'}.`);
      }
      await loadAccounts();
    } catch (error) {
      $('confirmModalError').textContent = error.message || 'Unable to update this organizer account.';
    } finally {
      confirmButton.disabled = false;
      if (pendingAction === 'delete') confirmButton.textContent = 'Delete account';
      else if (pendingAction === 'approve') confirmButton.textContent = 'Confirm & activate organizer';
      else if (pendingAction === 'reject') confirmButton.textContent = 'Confirm rejection';
      else if (selectedAccount && pendingAction === 'toggle') confirmButton.textContent = selectedAccount.active ? 'Deactivate account' : (selectedAccount.approvalStatus === 'rejected' ? 'Re-approve' : 'Activate account');
    }
  }

  async function compressImage(file) {
    const maxSourceBytes = 40 * 1024 * 1024;
    const maxPayloadChars = 260000;
    if (!file || !String(file.type || '').startsWith('image/')) throw new Error('Choose an image file.');
    if (file.size > maxSourceBytes) throw new Error('This image is over 40 MB. Please choose a smaller source image.');
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Unable to read this image.'));
      reader.readAsDataURL(file);
    });
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('This image format is not supported by this browser. Try PNG, JPG, or WebP.'));
      element.src = source;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('This image has invalid dimensions. Please choose another image.');

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image editing is not supported in this browser.');
    const maxSides = [512, 448, 384, 320, 256, 192, 160, 128];
    const qualities = [0.84, 0.72, 0.60, 0.48, 0.36, 0.28];
    for (const maxSide of maxSides) {
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of qualities) {
        const webp = canvas.toDataURL('image/webp', quality);
        if (webp.startsWith('data:image/webp;') && webp.length <= maxPayloadChars) return webp;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const jpeg = canvas.toDataURL('image/jpeg', quality);
        if (jpeg.length <= maxPayloadChars) return jpeg;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
      }
    }
    throw new Error('This image could not be compressed for upload. Please try a PNG, JPG, or WebP image.');
  }

  function handleOrganizerActionClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const row = button.closest('[data-id]');
    const account = accounts.find(item => item.id === row?.dataset.id);
    if (!account) return;
    if (button.dataset.action === 'edit') {
      openEditModal(account);
      if (button.classList.contains('password-reset-action')) window.requestAnimationFrame(() => $('editPassword').focus({preventScroll:true}));
    } else openConfirmModal(account, button.dataset.action);
  }
  rows.addEventListener('click', handleOrganizerActionClick);
  pendingApplicationRows.addEventListener('click', handleOrganizerActionClick);

  editForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!selectedAccount || isSavingProfile) return;
    const account = selectedAccount;
    const displayName = $('editDisplayName').value.trim();
    const username = $('editUsername').value.trim();
    const duprId = $('editDuprId').value.trim().replace(/^DUPR\s*:\s*/i, '').replace(/\s+/g, '').toUpperCase();
    const duprOrganizerId = $('editDuprOrganizerId').value.trim();
    const password = $('editPassword').value;
    const errorNode = $('editModalError');
    errorNode.textContent = '';
    if (!displayName) { errorNode.textContent = 'Organizer name cannot be blank.'; return; }
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,39}$/.test(username)) { errorNode.textContent = 'Username must be 3–40 characters and use letters, numbers, dot, underscore, or hyphen.'; return; }
    if (duprId && !/^[A-Z0-9_-]{1,40}$/.test(duprId)) { errorNode.textContent = 'DUPR ID must use letters, numbers, hyphens, or underscores (up to 40 characters).'; return; }
    if (password && password !== String(account.passwordDisplay || '') && password.length < 8) { errorNode.textContent = 'Password must be at least 8 characters long.'; return; }
    const saveButton = $('saveOrganizerChanges');
    isSavingProfile = true;
    saveButton.disabled = true;
    saveButton.setAttribute('aria-busy', 'true');
    saveButton.textContent = 'Saving…';
    try {
      const payload = {displayName, username, duprId, duprOrganizerId};
      if (password && password !== String(account.passwordDisplay || '')) payload.password = password;
      if (avatarChanged) payload.profileImage = avatarData || '';
      const saveResult = await request(`/api/panel/organizers/${encodeURIComponent(account.id)}`, {method:'PATCH', body:JSON.stringify(payload)});
      const returnedDuprId = String(saveResult?.organizer?.duprId || '').trim().toUpperCase();
      if (returnedDuprId !== duprId) throw new Error('The server did not confirm the saved DUPR ID. Your changes were not closed; please check the ID and save again.');
      const refreshed = await request('/api/panel/organizers');
      const latestAccounts = Array.isArray(refreshed.organizers) ? refreshed.organizers : [];
      const verifiedAccount = latestAccounts.find(item => String(item.id) === String(account.id));
      if (!verifiedAccount || String(verifiedAccount.duprId || '').trim().toUpperCase() !== duprId) {
        throw new Error('The DUPR ID could not be verified after saving. Keep this modal open and try again.');
      }
      accounts = latestAccounts;
      renderAccounts();
      isSavingProfile = false;
      closeModal();
      setNotice(`Updated organizer profile ${username}.`);
    } catch (error) {
      errorNode.textContent = error.message || 'Unable to save organizer details.';
    } finally {
      isSavingProfile = false;
      saveButton.disabled = false;
      saveButton.removeAttribute('aria-busy');
      saveButton.innerHTML = 'Save changes <span aria-hidden="true">→</span>';
    }
  });

  $('organizerProfileImage').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    $('editModalError').textContent = '';
    const input = event.target;
    input.disabled = true;
    try {
      avatarData = await compressImage(file);
      avatarChanged = true;
      showAvatarPreview();
    } catch (error) {
      $('editModalError').textContent = error.message || 'Unable to use this image.';
    } finally {
      input.disabled = false;
      input.value = '';
    }
  });
  $('removeOrganizerPhoto').addEventListener('click', () => {
    avatarData = '';
    avatarChanged = true;
    $('organizerProfileImage').value = '';
    showAvatarPreview();
  });
  $('toggleEditPassword').addEventListener('click', () => {
    const input = $('editPassword');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('toggleEditPassword').textContent = show ? 'Hide' : 'Show';
    $('toggleEditPassword').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });

  $('panelOpenSettings').addEventListener('click', openSettingsModal);
  $('closePanelSettings').addEventListener('click', closeSettingsModal);
  settingsModal.querySelectorAll('[data-close-settings]').forEach(button => button.addEventListener('click', closeSettingsModal));
  settingsModal.querySelectorAll('[data-settings-page]').forEach(button => button.addEventListener('click', () => selectSettingsPage(button.dataset.settingsPage)));
  $('panelSettingsSearch').addEventListener('input', () => {
    const query = $('panelSettingsSearch').value.trim().toLowerCase();
    document.querySelectorAll('[data-settings-page]').forEach(button => {
      button.hidden = !!query && !button.textContent.trim().toLowerCase().includes(query);
    });
    document.querySelectorAll('[data-nav-group-label]').forEach(label => {
      const nav = label.nextElementSibling;
      label.hidden = !!query && (!nav || ![...nav.querySelectorAll('[data-settings-page]')].some(button => !button.hidden));
    });
    const generalIsVisible = !$('panelSettingsGeneral').hidden;
    if (generalIsVisible) {
      document.querySelectorAll('#panelSettingsGeneral .panel-setting-row').forEach(row => {
        row.hidden = !!query && !row.textContent.toLowerCase().includes(query);
      });
      document.querySelectorAll('#panelSettingsGeneral .panel-settings-section').forEach(section => {
        const title = section.querySelector('h3')?.textContent.toLowerCase() || '';
        const hasMatchingRow = [...section.querySelectorAll('.panel-setting-row')].some(row => !row.hidden);
        section.hidden = !!query && !title.includes(query) && !hasMatchingRow;
      });
    }
  });
  settingsModal.querySelectorAll('[data-theme-choice]').forEach(button => button.addEventListener('click', () => saveSetting('theme', button.dataset.themeChoice)));
  const settingSelects = {
    panelSettingInterfaceFont: 'interfaceFont', panelSettingChatFont: 'chatFont',
    panelSettingVoiceLanguage: 'voiceLanguage', panelSettingVoiceStyle: 'voiceStyle',
    panelSettingVoiceSpeed: 'voiceSpeed'
  };
  Object.entries(settingSelects).forEach(([id, key]) => $(id).addEventListener('change', event => saveSetting(key, event.target.value)));
  const fontDropdowns = [...settingsModal.querySelectorAll('[data-font-dropdown]')];
  function closeFontDropdown(dropdown, restoreFocus = false) {
    if (!dropdown) return;
    const trigger = dropdown.querySelector('[data-dropdown-trigger]');
    const menu = dropdown.querySelector('.panel-settings-dropdown-menu');
    dropdown.classList.remove('is-open');
    if (menu) menu.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus && trigger) trigger.focus();
  }
  function closeAllFontDropdowns(except = null) {
    fontDropdowns.forEach(dropdown => { if (dropdown !== except) closeFontDropdown(dropdown); });
  }
  fontDropdowns.forEach(dropdown => {
    const trigger = dropdown.querySelector('[data-dropdown-trigger]');
    const menu = dropdown.querySelector('.panel-settings-dropdown-menu');
    trigger.addEventListener('click', () => {
      const shouldOpen = menu.hidden;
      closeAllFontDropdowns(dropdown);
      dropdown.classList.toggle('is-open', shouldOpen);
      menu.hidden = !shouldOpen;
      trigger.setAttribute('aria-expanded', String(shouldOpen));
    });
    dropdown.querySelectorAll('[data-font-value]').forEach(optionButton => {
      optionButton.addEventListener('click', () => {
        const select = $(dropdown.dataset.fontDropdown);
        if (!select) return;
        select.value = optionButton.dataset.fontValue;
        select.dispatchEvent(new Event('change', {bubbles:true}));
        closeFontDropdown(dropdown, true);
      });
    });
    menu.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const options = [...menu.querySelectorAll('[data-font-value]')];
        const currentIndex = options.indexOf(document.activeElement);
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        options[(currentIndex + delta + options.length) % options.length]?.focus();
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const options = [...menu.querySelectorAll('[data-font-value]')];
        (event.key === 'Home' ? options[0] : options[options.length - 1])?.focus();
      }
    });
  });
  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('[data-font-dropdown]')) closeAllFontDropdowns();
  });
  settingsModal.querySelectorAll('[data-setting-key]').forEach(button => button.addEventListener('click', () => saveSetting(button.dataset.settingKey, button.dataset.settingChoice)));
  window.addEventListener('storage', event => {
    if (event.key === settingsKey && event.newValue) {
      panelSettings = loadPanelSettings();
      setTheme(panelSettings.theme, false);
      applyPanelSettings();
    } else if (event.key === themeKey && ['light','dark','system'].includes(event.newValue)) {
      panelSettings.theme = event.newValue;
      setTheme(event.newValue, false);
    }
  });
  if (window.matchMedia) {
    const colorPreference = window.matchMedia('(prefers-color-scheme: dark)');
    const updateSystemTheme = () => { if (panelSettings.theme === 'system') setTheme('system', false); };
    if (typeof colorPreference.addEventListener === 'function') colorPreference.addEventListener('change', updateSystemTheme);
    else if (typeof colorPreference.addListener === 'function') colorPreference.addListener(updateSystemTheme);
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateSystemMotion = () => { if (panelSettings.motion === 'system') applyPanelSettings(); };
    if (typeof motionPreference.addEventListener === 'function') motionPreference.addEventListener('change', updateSystemMotion);
    else if (typeof motionPreference.addListener === 'function') motionPreference.addListener(updateSystemMotion);
  }
  $('panelLogout').addEventListener('click', openLogoutModal);
  $('closeLogoutConfirm').addEventListener('click', closeLogoutModal);
  $('cancelPanelLogout').addEventListener('click', closeLogoutModal);
  logoutModal.querySelectorAll('[data-cancel-logout]').forEach(button => button.addEventListener('click', closeLogoutModal));
  logoutModal.addEventListener('click', event => { if (event.target === logoutModal) closeLogoutModal(); });
  $('confirmPanelLogout').addEventListener('click', async () => {
    const button = $('confirmPanelLogout');
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = 'Logging out…';
    try {
      await fetch('/api/logout', {method:'POST', credentials:'same-origin', cache:'no-store', headers:{'Content-Type':'application/json'}});
    } catch (_) {
      // End the local panel session even if the server cannot be reached.
    }
    window.location.replace('/index.html');
  });
  modal.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', closeModal));
  $('confirmAccountAction').addEventListener('click', confirmPendingAction);
  modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
  document.addEventListener('keydown', event => {
    const activeModal = !logoutModal.hidden ? logoutModal : (!modal.hidden ? modal : (!settingsModal.hidden ? settingsModal : null));
    if (!activeModal) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (activeModal === logoutModal) closeLogoutModal();
      else if (activeModal === modal) closeModal();
      else {
        const openFontDropdown = settingsModal.querySelector('.panel-settings-dropdown.is-open');
        if (openFontDropdown) closeFontDropdown(openFontDropdown, true);
        else closeSettingsModal();
      }
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = activeModal === logoutModal ? logoutDialog : (activeModal === modal ? modalDialog : settingsDialog);
    const focusables = [...dialog.querySelectorAll('button:not(:disabled):not([hidden]), input:not(:disabled):not([hidden]), select:not(:disabled):not([hidden]), [tabindex="0"]')]
      .filter(element => element.getClientRects().length > 0);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  panelSettings = loadPanelSettings();
  setTheme(loadTheme(), false);
  applyPanelSettings();
  selectSettingsPage('general');
  fetch('/api/auth-status', {cache:'no-store', credentials:'same-origin'})
    .then(response => response.json())
    .then(status => {
      if (!status.authenticated || status.role !== 'panel') { window.location.replace('/index.html'); return; }
      loadAccounts();
    })
    .catch(() => window.location.replace('/index.html'));
})();
