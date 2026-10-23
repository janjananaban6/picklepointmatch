(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const rows = $('organizerRows');
  const notice = $('panelNotice');
  const createForm = $('createOrganizerForm');
  const createButton = $('createOrganizerButton');
  const modal = $('accountModal');
  const modalDialog = modal.querySelector('.panel-modal-dialog');
  const editForm = $('editOrganizerForm');
  const confirmBody = $('confirmModalBody');
  const confirmButton = $('confirmAccountAction');
  const themeKey = 'ppm-panel-theme';
  let accounts = [];
  let selectedAccount = null;
  let pendingAction = null;
  let returnFocusTo = null;
  let avatarData = '';
  let avatarChanged = false;

  function setNotice(message, error = false) {
    notice.textContent = message || '';
    notice.classList.toggle('is-error', !!error);
  }
  function setCreateMessage(message) { $('createMessage').textContent = message || ''; }
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

  function renderAccounts() {
    $('totalAccounts').textContent = String(accounts.length);
    $('activeAccounts').textContent = String(accounts.filter(account => account.active).length);
    $('inactiveAccounts').textContent = String(accounts.filter(account => !account.active).length);
    if (!accounts.length) {
      rows.innerHTML = '<tr><td colspan="5" class="empty-row">No organizer accounts yet. Create one using the form.</td></tr>';
      return;
    }
    rows.innerHTML = accounts.map(account => {
      const status = account.active ? '<span class="status-pill active">Active</span>' : '<span class="status-pill inactive">Inactive</span>';
      const actionLabel = account.active ? 'Deactivate' : 'Activate';
      const image = safeProfileImage(account.profileImage);
      const avatar = image
        ? `<img class="organizer-avatar" src="${safeText(image)}" alt="${safeText(account.displayName || account.username)} profile photo" loading="lazy">`
        : `<span class="organizer-avatar" aria-hidden="true">${safeText(initials(account))}</span>`;
      return `<tr data-id="${safeText(account.id)}">
        <td data-label="Organizer"><div class="organizer-cell">${avatar}<span class="organizer-cell-copy"><span class="organizer-name">${safeText(account.displayName || account.username)}</span><span class="organizer-sub">Added ${safeText(formatDate(account.createdAt))}</span></span></div></td>
        <td data-label="Username"><span class="username-text">${safeText(account.username)}</span></td>
        <td data-label="Status">${status}</td>
        <td data-label="Last sign in">${safeText(formatDate(account.lastLoginAt))}</td>
        <td data-label="Actions"><div class="action-wrap"><button class="row-action" type="button" data-action="edit">Edit profile</button><button class="row-action" type="button" data-action="toggle">${actionLabel}</button><button class="row-action danger" type="button" data-action="delete">Delete</button></div></td>
      </tr>`;
    }).join('');
  }

  async function loadAccounts(showMessage = false) {
    if (showMessage) setNotice('Refreshing accounts…');
    try {
      const data = await request('/api/panel/organizers');
      accounts = Array.isArray(data.organizers) ? data.organizers : [];
      renderAccounts();
      if (showMessage) setNotice('Organizer accounts are up to date.');
    } catch (error) {
      setNotice(error.message || 'Unable to load organizer accounts.', true);
    }
  }

  function setTheme(theme, persist = true) {
    const normalized = theme === 'dark' ? 'dark' : 'light';
    document.body.dataset.theme = normalized;
    const button = $('panelThemeToggle');
    const lightMode = normalized === 'light';
    button.classList.toggle('is-light', lightMode);
    button.setAttribute('aria-pressed', String(lightMode));
    button.setAttribute('aria-label', `Switch panel to ${lightMode ? 'dark' : 'light'} mode`);
    button.title = `Switch panel to ${lightMode ? 'dark' : 'light'} mode`;
    const label = button.querySelector('.live-view-theme-label');
    if (label) label.textContent = lightMode ? 'Dark Mode' : 'Light Mode';
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.content = normalized === 'dark' ? '#0c151d' : '#0b2522';
    if (persist) {
      try { localStorage.setItem(themeKey, normalized); } catch (_) {}
    }
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

  function openModal() {
    returnFocusTo = document.activeElement;
    modal.hidden = false;
    document.body.classList.add('modal-open');
    window.requestAnimationFrame(() => modalDialog.focus());
  }
  function closeModal() {
    if (modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    pendingAction = null;
    selectedAccount = null;
    if (returnFocusTo && typeof returnFocusTo.focus === 'function') returnFocusTo.focus({preventScroll:true});
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
    $('editPassword').value = '';
    $('organizerProfileImage').value = '';
    $('toggleEditPassword').textContent = 'Show';
    $('editPassword').type = 'password';
    showAvatarPreview();
    openModal();
    $('editDisplayName').focus({preventScroll:true});
  }
  function openConfirmModal(account, action) {
    selectedAccount = account;
    pendingAction = action;
    const isDelete = action === 'delete';
    const willDeactivate = action === 'toggle' && account.active;
    const title = isDelete ? 'Delete organizer?' : (willDeactivate ? 'Deactivate organizer?' : 'Activate organizer?');
    const actionName = isDelete ? 'delete' : (willDeactivate ? 'deactivate' : 'activate');
    configureModal({title, description: isDelete ? 'This action cannot be undone.' : 'Confirm this account status change.', icon: isDelete ? '!' : (willDeactivate ? 'Ⅱ' : '✓'), mode:'confirm'});
    $('confirmModalText').textContent = isDelete
      ? `Delete ${account.displayName || account.username} (@${account.username})?`
      : `Are you sure you want to ${actionName} ${account.displayName || account.username}?`;
    $('confirmModalDetail').textContent = isDelete
      ? 'The organizer account and its separate queue/session state will be removed. The shared Registered Player Cloud remains shared.'
      : (willDeactivate
        ? 'This organizer will no longer be able to sign in. Existing requests will be blocked when the account is checked again.'
        : 'This organizer will be able to sign in and manage their own live queue again.');
    confirmButton.textContent = isDelete ? 'Delete account' : (willDeactivate ? 'Deactivate account' : 'Activate account');
    confirmButton.classList.toggle('danger-confirm', isDelete || willDeactivate);
    openModal();
    confirmButton.focus({preventScroll:true});
  }

  async function confirmPendingAction() {
    if (!selectedAccount || !pendingAction || confirmButton.disabled) return;
    const account = selectedAccount;
    const action = pendingAction;
    confirmButton.disabled = true;
    confirmButton.textContent = action === 'delete' ? 'Deleting…' : 'Updating…';
    $('confirmModalError').textContent = '';
    try {
      const endpoint = `/api/panel/organizers/${encodeURIComponent(account.id)}`;
      if (action === 'delete') {
        await request(endpoint, {method:'DELETE'});
        closeModal();
        setNotice(`Deleted organizer account ${account.username}.`);
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
      else if (selectedAccount && pendingAction === 'toggle') confirmButton.textContent = selectedAccount.active ? 'Deactivate account' : 'Activate account';
    }
  }

  async function compressImage(file) {
    if (!file || !/^image\/(?:png|jpeg|webp)$/.test(file.type)) throw new Error('Choose a JPG, PNG, or WebP image.');
    if (file.size > 8 * 1024 * 1024) throw new Error('Please choose an image smaller than 8 MB.');
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Unable to read this image.'));
      reader.readAsDataURL(file);
    });
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('This image file could not be opened.'));
      element.src = source;
    });
    const maxSide = 360;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image editing is not supported in this browser.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let result = canvas.toDataURL('image/jpeg', .82);
    if (result.length > 560000) result = canvas.toDataURL('image/jpeg', .66);
    if (result.length > 650000) throw new Error('The processed image is still too large. Choose another photo.');
    return result;
  }

  rows.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const row = button.closest('tr');
    const account = accounts.find(item => item.id === row?.dataset.id);
    if (!account) return;
    if (button.dataset.action === 'edit') openEditModal(account);
    else openConfirmModal(account, button.dataset.action);
  });

  editForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!selectedAccount) return;
    const account = selectedAccount;
    const displayName = $('editDisplayName').value.trim();
    const username = $('editUsername').value.trim();
    const password = $('editPassword').value;
    const errorNode = $('editModalError');
    errorNode.textContent = '';
    if (!displayName) { errorNode.textContent = 'Organizer name cannot be blank.'; return; }
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,39}$/.test(username)) { errorNode.textContent = 'Username must be 3–40 characters and use letters, numbers, dot, underscore, or hyphen.'; return; }
    if (password && password.length < 8) { errorNode.textContent = 'New password must be at least 8 characters long.'; return; }
    const saveButton = $('saveOrganizerChanges');
    saveButton.disabled = true;
    saveButton.textContent = 'Saving…';
    try {
      const payload = {displayName, username};
      if (password) payload.password = password;
      if (avatarChanged) payload.profileImage = avatarData || '';
      await request(`/api/panel/organizers/${encodeURIComponent(account.id)}`, {method:'PATCH', body:JSON.stringify(payload)});
      closeModal();
      setNotice(`Updated organizer profile ${username}.`);
      await loadAccounts();
    } catch (error) {
      errorNode.textContent = error.message || 'Unable to save organizer details.';
    } finally {
      saveButton.disabled = false;
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
    $('toggleEditPassword').setAttribute('aria-label', show ? 'Hide new password' : 'Show new password');
  });

  createForm.addEventListener('submit', async event => {
    event.preventDefault();
    setCreateMessage('');
    createButton.disabled = true;
    createButton.textContent = 'Creating account…';
    try {
      const data = await request('/api/panel/organizers', {
        method:'POST',
        body:JSON.stringify({displayName:$('newDisplayName').value.trim(), username:$('newUsername').value.trim(), password:$('newPassword').value})
      });
      createForm.reset();
      setNotice(`Created organizer account ${data.organizer?.username || ''}.`);
      await loadAccounts();
    } catch (error) {
      setCreateMessage(error.message || 'Unable to create organizer account.');
    } finally {
      createButton.disabled = false;
      createButton.innerHTML = 'Create organizer account <span aria-hidden="true">→</span>';
    }
  });
  $('toggleNewPassword').addEventListener('click', () => {
    const input = $('newPassword');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('toggleNewPassword').textContent = show ? 'Hide' : 'Show';
    $('toggleNewPassword').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
  $('refreshAccounts').addEventListener('click', () => loadAccounts(true));
  $('panelThemeToggle').addEventListener('click', () => setTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark'));
  $('panelLogout').addEventListener('click', async () => {
    const button = $('panelLogout');
    button.disabled = true;
    button.querySelector('span:last-child').textContent = 'Logging out…';
    try { await fetch('/api/logout', {method:'POST', credentials:'same-origin', cache:'no-store'}); } catch (_) {}
    window.location.replace('/index.html');
  });
  $('closeAccountModal').addEventListener('click', closeModal);
  modal.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', closeModal));
  $('confirmAccountAction').addEventListener('click', confirmPendingAction);
  modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
  document.addEventListener('keydown', event => {
    if (modal.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); closeModal(); }
    if (event.key === 'Tab') {
      const focusables = [...modalDialog.querySelectorAll('button:not(:disabled):not([hidden]), input:not(:disabled):not([hidden]), label[for]')].filter(element => element.getClientRects().length > 0);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });

  try { setTheme(localStorage.getItem(themeKey) || 'light', false); } catch (_) { setTheme('light', false); }
  fetch('/api/auth-status', {cache:'no-store', credentials:'same-origin'})
    .then(response => response.json())
    .then(status => {
      if (!status.authenticated || status.role !== 'panel') { window.location.replace('/index.html'); return; }
      loadAccounts();
    })
    .catch(() => window.location.replace('/index.html'));
})();
