(() => {
  const $ = id => document.getElementById(id);
  const rows = $('organizerRows');
  const notice = $('panelNotice');
  const createForm = $('createOrganizerForm');
  const createButton = $('createOrganizerButton');
  let accounts = [];

  function setNotice(text, error = false) {
    notice.textContent = text || '';
    notice.classList.toggle('is-error', !!error);
  }
  function setCreateMessage(text) { $('createMessage').textContent = text || ''; }
  function safeText(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  function formatDate(value) {
    if (!value) return 'Never';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(date);
  }
  async function request(url, options = {}) {
    const response = await fetch(url,{cache:'no-store',credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { window.location.replace('/index.html'); throw new Error('Your administrator session has expired. Please sign in again.'); }
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
      return `<tr data-id="${safeText(account.id)}">
        <td data-label="Organizer"><span class="organizer-name">${safeText(account.displayName || account.username)}</span><span class="organizer-sub">Added ${safeText(formatDate(account.createdAt))}</span></td>
        <td data-label="Username"><span class="username-text">${safeText(account.username)}</span></td>
        <td data-label="Status">${status}</td>
        <td data-label="Last sign in">${safeText(formatDate(account.lastLoginAt))}</td>
        <td data-label="Actions"><div class="action-wrap"><button class="row-action" type="button" data-action="edit">Edit name</button><button class="row-action" type="button" data-action="password">Reset password</button><button class="row-action" type="button" data-action="toggle">${actionLabel}</button><button class="row-action danger" type="button" data-action="delete">Delete</button></div></td>
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
    } catch (error) { setNotice(error.message || 'Unable to load organizer accounts.',true); }
  }
  async function performAccountAction(button, action, account) {
    try {
      button.disabled = true;
      if (action === 'edit') {
        const value = window.prompt('Organizer / venue display name:',account.displayName || account.username);
        if (value === null) return;
        const displayName = value.trim();
        if (!displayName) throw new Error('Display name cannot be blank.');
        await request(`/api/panel/organizers/${encodeURIComponent(account.id)}`,{method:'PATCH',body:JSON.stringify({displayName})});
        setNotice(`Updated ${account.username}.`);
      } else if (action === 'password') {
        const password = window.prompt(`Enter a new password for ${account.username} (at least 8 characters):`);
        if (password === null) return;
        if (password.length < 8) throw new Error('Password must be at least 8 characters long.');
        await request(`/api/panel/organizers/${encodeURIComponent(account.id)}`,{method:'PATCH',body:JSON.stringify({password})});
        setNotice(`Password reset for ${account.username}.`);
      } else if (action === 'toggle') {
        const verb = account.active ? 'deactivate' : 'activate';
        if (!window.confirm(`Are you sure you want to ${verb} ${account.username}?`)) return;
        await request(`/api/panel/organizers/${encodeURIComponent(account.id)}`,{method:'PATCH',body:JSON.stringify({active:!account.active})});
        setNotice(`${account.username} is now ${account.active ? 'inactive' : 'active'}.`);
      } else if (action === 'delete') {
        if (!window.confirm(`Delete organizer account “${account.username}”? Its separate queue state will also be deleted. This cannot be undone.`)) return;
        await request(`/api/panel/organizers/${encodeURIComponent(account.id)}`,{method:'DELETE'});
        setNotice(`Deleted organizer account ${account.username}.`);
      }
      await loadAccounts();
    } catch (error) { setNotice(error.message || 'Unable to update the organizer account.',true); }
    finally { button.disabled = false; }
  }
  rows.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const row = button.closest('tr');
    const account = accounts.find(item => item.id === row?.dataset.id);
    if (account) performAccountAction(button,button.dataset.action,account);
  });
  createForm.addEventListener('submit', async event => {
    event.preventDefault();
    setCreateMessage('');
    createButton.disabled = true;
    createButton.textContent = 'Creating account…';
    try {
      const data = await request('/api/panel/organizers',{method:'POST',body:JSON.stringify({displayName:$('newDisplayName').value.trim(),username:$('newUsername').value.trim(),password:$('newPassword').value})});
      createForm.reset();
      setNotice(`Created organizer account ${data.organizer?.username || ''}.`);
      await loadAccounts();
    } catch (error) { setCreateMessage(error.message || 'Unable to create organizer account.'); }
    finally { createButton.disabled = false; createButton.innerHTML = 'Create organizer account <span aria-hidden="true">→</span>'; }
  });
  $('toggleNewPassword').addEventListener('click', () => {
    const input = $('newPassword');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('toggleNewPassword').textContent = show ? 'Hide' : 'Show';
    $('toggleNewPassword').setAttribute('aria-label',show ? 'Hide password' : 'Show password');
  });
  $('refreshAccounts').addEventListener('click',() => loadAccounts(true));
  $('jumpToCreate').addEventListener('click',() => {
    $('createSection').scrollIntoView({behavior:'smooth',block:'center'});
    $('newDisplayName').focus({preventScroll:true});
  });
  $('panelLogout').addEventListener('click',async () => {
    if (!window.confirm('Log out of the administrator panel?')) return;
    try { await fetch('/api/logout',{method:'POST',credentials:'same-origin',cache:'no-store'}); } catch (_) {}
    window.location.replace('/index.html');
  });
  fetch('/api/auth-status',{cache:'no-store',credentials:'same-origin'}).then(response => response.json()).then(status => {
    if (!status.authenticated || status.role !== 'panel') { window.location.replace('/index.html'); return; }
    loadAccounts();
  }).catch(() => window.location.replace('/index.html'));
})();
