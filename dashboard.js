(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  let sessionDropdownOpen=false;

  const state = {
    tab:'attendance',
    auth:null,
    appState:null,
    records:{players:[],logs:[],sessions:[]},
    matchesVisible:[],
    matchDateRange:'',
    matchSessionFilterId:'',
    emptySessionCleanupDone:false,
    selection:{session:''},
    pendingDeleteSessionId:'',
    editingSessionId:'',
    editingSessionOriginalStartedAt:'',
    editingSessionOriginalEndedAt:'',
    editingParticipant:null,
    pendingDeleteParticipant:null,
    editingMatch:null,
    pendingDeleteMatch:null,
    settingsLogoDraft:undefined,
    settingsLogoProcessing:false,
    settingsLogoProcessingToken:0,
    refreshTimer:null,
    appEventStream:null,
    appRevision:0,
    dashboardLoadRequestId:0,
    toastTimer:null,
    duprModalFilter:'all',
    duprModalSessionId:'',
    duprModalEventName:'',
    duprModalLocation:'',
    duprModalScoreType:'RALLY',
    duprSubmittedMatchKeys:new Set()
  };

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const safeImagePath = value => /^registration-avatar-(?:0[1-9]|1[0-9]|2[01])\.png$/.test(String(value || '')) ? String(value) : '';
  const fullName = person => String(person?.name || person?.displayName || '').trim();
  const normalizeName = value => String(value || '').normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase();
  const validDate = value => { const date = value ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? date : null; };
  const formatDate = value => { const date=validDate(value); return date ? new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'}).format(date) : 'Date not available'; };
  const formatDateTime = value => { const date=validDate(value); return date ? new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(date) : 'Date not available'; };
  function sessionCreatedAt(session) {
    const saved=validDate(session?.createdAt);
    if(saved)return saved;
    // Session IDs are generated as session-${Date.now()}-${uuid}; the timestamp
    // is the actual creation time and also supports older archived sessions.
    const match=String(session?.id||'').match(/^session-(\d{10,13})(?:-|$)/);
    if(match){
      const raw=Number(match[1]);
      const timestamp=match[1].length===10?raw*1000:raw;
      const fromId=new Date(timestamp);
      if(Number.isFinite(fromId.getTime()))return fromId;
    }
    return validDate(session?.startedAt)||validDate(session?.endedAt);
  }

  function sessionFilterEndAt(session) {
    if(!session)return null;
    // A live session remains open through the current moment. Archived sessions
    // use their saved end timestamp; older records fall back to their latest match.
    if(session.isLive)return new Date();
    const ended=validDate(session.endedAt);
    if(ended)return ended;
    const latestMatch=sessionLogs(session)
      .map(log=>validDate(log?.endedAt)||validDate(log?.startedAt))
      .filter(Boolean)
      .sort((a,b)=>b.getTime()-a.getTime())[0];
    return latestMatch||sessionCreatedAt(session)||validDate(session.startedAt);
  }

  function toLocalMatchDateTimeValue(value) {
    const date=validDate(value);
    if(!date)return '';
    const local=new Date(date.getTime()-date.getTimezoneOffset()*60000);
    return local.toISOString().slice(0,19);
  }

  const escapeAttr = value => escapeHtml(value).replace(/`/g,'&#96;');

  function toLocalDateTimeValue(value) {
    const date=validDate(value);
    if(!date)return '';
    const local=new Date(date.getTime()-date.getTimezoneOffset()*60000);
    return local.toISOString().slice(0,16);
  }


  function showToast(message) {
    const el=$('dashboardToast');
    if(!el)return;
    el.textContent=message;
    el.classList.add('is-visible');
    clearTimeout(state.toastTimer);
    state.toastTimer=setTimeout(()=>el.classList.remove('is-visible'),2800);
  }

  async function fetchJson(url, options={}) {
    const response=await fetch(url,{cache:'no-store',credentials:'same-origin',...options});
    const body=await response.json().catch(()=>null);
    if(response.status===401){window.location.replace(`/index.html?next=${encodeURIComponent('dashboard.html')}`);throw new Error('Please sign in again.');}
    if(!response.ok||!body||body.ok===false)throw new Error(body?.error||`Request failed (${response.status}).`);
    return body;
  }

  function earliestMatchStart(logs) {
    const dates=(Array.isArray(logs)?logs:[]).map(log=>validDate(log?.startedAt)).filter(Boolean).sort((a,b)=>a-b);
    return dates.length?dates[0].toISOString():null;
  }

  function currentActiveSession() {
    const current=state.appState;
    if(!current||current.sessionActive!==true||!String(current.sessionId||'').trim()||current.sessionEndedAt)return null;
    const sessionId=String(current.sessionId);
    const savedAttendance=state.records.attendanceBySession?.[sessionId];
    let participants;
    if(Array.isArray(savedAttendance)) {
      // Dashboard attendance is deliberately separate from the live queue.
      participants=savedAttendance;
    } else {
      const people=[...(Array.isArray(current.players)?current.players:[]),...(Array.isArray(current.left)?current.left:[])];
      const seen=new Set();
      participants=people.filter(person=>{
        const key=String(person?.id??normalizeName(person?.name));
        if(!fullName(person)||seen.has(key))return false;
        seen.add(key);return true;
      }).map(person=>({id:person.id,name:fullName(person),nickname:person.nickname||'',gender:person.gender||'',category:person.category||'',avatarId:person.avatarId||''}));
    }
    const liveLogs=Array.isArray(current.logs)?current.logs:[];
    return {id:sessionId,sessionName:String(current.sessionName||'Current Session'),startedAt:earliestMatchStart(liveLogs),endedAt:null,playerCount:participants.length,matchCount:liveLogs.length,participants,duprLocation:String(current.duprLocation||'').trim(),isLive:true};
  }

  function archivedSessions() {
    return (Array.isArray(state.records.sessions)?state.records.sessions:[])
      .filter(session=>session&&String(session.id||'').trim())
      .map(session=>{
        const savedAttendance=state.records.attendanceBySession?.[String(session.id)];
        const participants=Array.isArray(savedAttendance)?savedAttendance:(Array.isArray(session.participants)?session.participants:[]);
        return {...session,id:String(session.id),participants,playerCount:Array.isArray(savedAttendance)?savedAttendance.length:(Number(session.playerCount)||participants.length),isLive:false};
      })
      .sort((a,b)=>(validDate(b.endedAt)?.getTime()||0)-(validDate(a.endedAt)?.getTime()||0));
  }

  function allSessions() {
    const archived=archivedSessions();
    const live=currentActiveSession();
    return live?[live,...archived.filter(session=>session.id!==live.id)]:archived;
  }

  function sessionLogs(session) {
    if(!session)return [];
    // Queueing writes completed match results into appState.logs immediately.
    // They are copied into cloud-records with a sessionId only when End Session
    // is pressed, so read the live app state for the active session.
    const sessionId=String(session.id||'').trim();
    const logs=session.isLive
      ? (String(state.appState?.sessionId||'').trim()===sessionId && Array.isArray(state.appState?.logs) ? state.appState.logs : [])
      : (Array.isArray(state.records.logs)?state.records.logs:[]).filter(log=>{
          // Accept legacy casing variants, but never use session names as a
          // fallback because separate sessions can share the same name.
          const logSessionId=String(log?.sessionId??log?.sessionID??log?.session_id??'').trim();
          return logSessionId===sessionId;
        });
    return logs.slice().sort((a,b)=>(validDate(b.endedAt||b.startedAt)?.getTime()||0)-(validDate(a.endedAt||a.startedAt)?.getTime()||0));
  }

  function selectedSession() {
    const selectedId=String(state.selection.session||'');
    return allSessions().find(session=>String(session.id||'')===selectedId)||null;
  }

  function ensureSelection() {
    const options=allSessions();
    if(!options.some(session=>session.id===state.selection.session))state.selection.session=options[0]?.id||'';
  }

  function updateDashboardBrand(organizer={}) {
    const name=String(organizer.displayName||organizer.username||'Organizer').trim()||'Organizer';
    const username=String(organizer.username||'').trim();
    const duprId=String(organizer.duprId||organizer.personalDuprId||organizer.duprID||organizer.dupr_id||'').trim().replace(/^DUPR\s*:\s*/i,'').replace(/\s+/g,'').toUpperCase();
    const logo=$('organizerLogo');
    $('organizerClubName').textContent=name;
    const usernameEl=$('organizerUsername');
    if(usernameEl)usernameEl.textContent=username?`@${username}`:'';
    const duprBadge=$('organizerDuprBadge');
    if(duprBadge){
      duprBadge.textContent=duprId?`DUPR ${duprId}`:'';
      duprBadge.hidden=!duprId;
      duprBadge.title=duprId?`Organizer DUPR ID: ${duprId}`:'';
    }
    const brandLink=$('dashboardBrandLink');
    if(brandLink){
      brandLink.setAttribute('aria-label',`${name} organizer dashboard home${username?`, username ${username}`:''}${duprId?`, DUPR ID ${duprId}`:''}`);
      brandLink.title=`${name}${username?` · @${username}`:''}${duprId?` · DUPR ${duprId}`:''}`;
    }
    const organizerLogoSrc=organizer.logo&&/^data:image\/(?:png|jpeg|webp);base64,/i.test(organizer.logo)?organizer.logo:'pickleball-p-emblem.png';
    if(logo){
      logo.alt=`${name} logo`;
      logo.onerror=()=>{logo.onerror=null;logo.src='pickleball-p-emblem.png';};
      logo.src=organizerLogoSrc;
    }
  }

  function sessionOptionDetails(session) {
    const title=String(session?.sessionName||'Open Play').trim()||'Open Play';
    const status=session?.isLive?'LIVE':'COMPLETE';
    const createdAt=sessionCreatedAt(session);
    const date=createdAt?formatDate(createdAt):'Date not available';
    const matchCount=sessionLogs(session).length;
    return {
      title,
      status,
      date,
      matchCount,
      searchText:normalizeName(`${title} ${status} ${date} ${matchCount} matches`)
    };
  }

  function updateSessionPickerClearButton() {
    const search=$('sessionSelectSearch');
    const clear=$('sessionSelectClear');
    if(clear)clear.hidden=!search||!search.value||search.disabled;
  }

  function renderSessionPickerOptions(query='') {
    const list=$('sessionSelectOptions');
    if(!list)return;
    const normalized=normalizeName(query);
    const options=allSessions().filter(session=>{
      if(!normalized)return true;
      const details=sessionOptionDetails(session);
      return details.searchText.includes(normalized);
    });
    if(!options.length){
      list.innerHTML='<div class="session-select-empty">No matching sessions found</div>';
    }else{
      list.innerHTML=options.map(session=>{
        const details=sessionOptionDetails(session);
        const selected=session.id===state.selection.session;
        const optionId=`session-option-${String(session.id||'').replace(/[^a-zA-Z0-9_-]/g,'-')}`;
        return `<button id="${escapeAttr(optionId)}" class="session-select-option${selected?' is-selected':''}" type="button" role="option" aria-selected="${selected?'true':'false'}" data-session-option data-session-id="${escapeAttr(session.id)}"><span class="session-select-option-name">${escapeHtml(details.title)}</span><span class="session-select-option-meta${session.isLive?' is-live':' is-complete'}">${escapeHtml(details.status)}</span></button>`;
      }).join('');
    }
    list.hidden=!sessionDropdownOpen;
    const search=$('sessionSelectSearch');
    if(search){
      const selected=list.querySelector('[data-session-option].is-selected');
      if(selected)search.setAttribute('aria-activedescendant',`session-option-${String(selected.dataset.sessionId||'').replace(/[^a-zA-Z0-9_-]/g,'-')}`);
      else search.removeAttribute('aria-activedescendant');
    }
    updateSessionPickerClearButton();
  }

  function openSessionPicker({clearSearch=true}={}) {
    const select=$('sessionSelect');
    const shell=$('sessionSelectShell');
    const search=$('sessionSelectSearch');
    if(!select||select.disabled||!shell||!search)return;
    sessionDropdownOpen=true;
    shell.classList.add('is-open');
    search.setAttribute('aria-expanded','true');
    $('sessionSelectToggle')?.setAttribute('aria-expanded','true');
    if(clearSearch)search.value='';
    renderSessionPickerOptions(search.value);
  }

  function closeSessionPicker({restore=true}={}) {
    const shell=$('sessionSelectShell');
    const search=$('sessionSelectSearch');
    const list=$('sessionSelectOptions');
    sessionDropdownOpen=false;
    shell?.classList.remove('is-open');
    if(search){
      search.setAttribute('aria-expanded','false');
      if(restore){
        const selected=selectedSession();
        search.value=selected?sessionOptionDetails(selected).title:'';
      }
    }
    $('sessionSelectToggle')?.setAttribute('aria-expanded','false');
    if(list)list.hidden=true;
    updateSessionPickerClearButton();
  }

  function applySessionSelection(sessionId) {
    const normalizedId=String(sessionId||'').trim();
    const session=allSessions().find(item=>String(item.id||'')===normalizedId);
    if(!session)return false;

    // Session selection controls Attendance and scopes Match History to the
    // selected session. The date-range preset buttons switch Match History back
    // to the global all-session view.
    state.selection.session=String(session.id);
    state.editingParticipant=null;
    state.pendingDeleteParticipant=null;

    // Selecting a session applies its exact creation-to-end time window and
    // scopes Match History to that session ID. This keeps sessions created on
    // the same calendar day (or with the same name) from being mixed together.
    // The quick range buttons explicitly switch back to global all-session history.
    const sessionStart=sessionCreatedAt(session);
    const sessionEnd=sessionFilterEndAt(session);
    if(sessionStart){
      const safeEnd=sessionEnd&&sessionEnd>=sessionStart?sessionEnd:sessionStart;
      $('matchesFromDate').value=toLocalMatchDateTimeValue(sessionStart);
      $('matchesToDate').value=toLocalMatchDateTimeValue(safeEnd);
      state.matchSessionFilterId=String(session.id);
      state.matchDateRange='';
      syncMatchRangeButtons();
    }

    const select=$('sessionSelect');
    if(select)select.value=String(session.id);
    closeSessionPicker({restore:false});
    render();
    closeSessionPicker({restore:true});
    return true;
  }

  function chooseSessionFromPicker(sessionId) {
    applySessionSelection(sessionId);
  }

  function renderSessionSelect() {
    ensureSelection();
    const select=$('sessionSelect');
    const search=$('sessionSelectSearch');
    const options=allSessions();
    if(!select)return;
    if(!options.length){
      select.innerHTML='<option value="">No sessions recorded yet</option>';
      select.disabled=true;
      if(search){search.value='';search.disabled=true;search.placeholder='No sessions recorded yet';search.setAttribute('aria-expanded','false');}
      sessionDropdownOpen=false;
      $('sessionSelectShell')?.classList.remove('is-open');
      $('sessionSelectToggle')?.setAttribute('aria-expanded','false');
      $('sessionSelectOptions').hidden=true;
      $('selectedSessionMeta').textContent='';
      updateSessionPickerClearButton();
      return;
    }
    select.disabled=false;
    if(search){search.disabled=false;search.placeholder='Search sessions…';}
    select.innerHTML=options.map(session=>{
      const details=sessionOptionDetails(session);
      return `<option value="${escapeAttr(session.id)}">${escapeHtml(details.title)} · ${escapeHtml(details.date)}</option>`;
    }).join('');
    select.value=state.selection.session;
    const selected=selectedSession();
    if(selected){
      const selectedDetails=sessionOptionDetails(selected);
      const matchLabel=selectedDetails.matchCount===1?'match':'matches';
      $('selectedSessionMeta').textContent=`Selected session · ${selectedDetails.matchCount} ${matchLabel} played`;
      if(search&&!sessionDropdownOpen)search.value=selectedDetails.title;
    } else {
      $('selectedSessionMeta').textContent='';
      if(search&&!sessionDropdownOpen)search.value='';
    }
    if(sessionDropdownOpen)renderSessionPickerOptions(search?.value||'');
    else updateSessionPickerClearButton();
  }

  function renderTabs() {
    ['attendance','matches','sessions'].forEach(tab=>{
      const active=state.tab===tab;
      const button=$(`${tab}Tab`);
      const view=$(`${tab}View`);
      button.classList.toggle('is-active',active);
      button.setAttribute('aria-selected',String(active));
      view.hidden=!active;
    });
    const sessionToolbar=document.querySelector('.records-toolbar');
    if(sessionToolbar)sessionToolbar.hidden=false;
  }

  function participantAvatar(person) {
    const raw=String(person?.avatarId||'').replace(/^avatar-/,'');
    const image=safeImagePath(raw ? `registration-avatar-${raw}.png` : '');
    const initials=fullName(person).split(/\s+/).filter(Boolean).slice(0,2).map(part=>Array.from(part)[0]).join('').toUpperCase()||'P';
    return image?`<span class="participant-avatar"><img src="${image}" alt="" loading="lazy" draggable="false"></span>`:`<span class="participant-avatar" aria-hidden="true">${escapeHtml(initials)}</span>`;
  }

  function cloudPlayerName(person) {
    const direct=fullName(person);
    if(direct)return direct;
    return [person?.firstName,person?.lastName].map(value=>String(value||'').trim()).filter(Boolean).join(' ');
  }

  function categoryCode(value) {
    const category=String(value||'').trim().toUpperCase();
    const map={BEGINNER:'BEG',NOVICE:'NOV',INTERMEDIATE:'INT',ADVANCED:'ADV',EXPERT:'EXP'};
    return map[category]||(['BEG','NOV','INT','ADV','EXP'].includes(category)?category:'');
  }

  function renderCloudPlayerSuggestions() {
    const datalist=$('attendanceCloudPlayerSuggestions');
    if(!datalist)return;
    const seen=new Set();
    const options=(Array.isArray(state.records.players)?state.records.players:[])
      .map(player=>({player,name:cloudPlayerName(player)}))
      .filter(item=>item.name&&!seen.has(normalizeName(item.name))&&seen.add(normalizeName(item.name)))
      .sort((a,b)=>a.name.localeCompare(b.name))
      .map(({player,name})=>{
        const details=[player.nickname,player.gender,player.category].filter(Boolean).join(' · ');
        return `<option value="${escapeAttr(name)}"${details?` label="${escapeAttr(details)}"`:''}></option>`;
      });
    datalist.innerHTML=options.join('');
  }

  function applyCloudPlayerSuggestion(form) {
    const nameInput=form?.querySelector('[name="name"]');
    if(!nameInput)return;
    const entered=normalizeName(nameInput.value);
    if(!entered)return;
    const match=(Array.isArray(state.records.players)?state.records.players:[]).find(player=>normalizeName(cloudPlayerName(player))===entered);
    if(!match)return;
    form.querySelector('[name="nickname"]').value=String(match.nickname||'');
    const gender=String(match.gender||'').trim().toLowerCase();
    form.querySelector('[name="gender"]').value=gender==='male'?'Male':gender==='female'?'Female':'';
    form.querySelector('[name="category"]').value=categoryCode(match.category);
  }

  function participantMarkup(person,index,session) {
    const name=fullName(person)||'Unnamed participant';
    const nickname=String(person.nickname||'').trim();
    const target=state.editingParticipant;
    const isEditing=!!target&&target.sessionId===session.id&&target.index===index;
    const avatar=`<div class="participant-avatar-stack">${participantAvatar(person)}<span class="participant-position-badge">${index+1}</span></div>`;
    if(isEditing){
      return `<article class="participant-row is-editing">
        ${avatar}
        <form class="participant-inline-edit" data-participant-edit-form data-participant-index="${index}">
          <div class="participant-inline-fields">
            <input class="participant-inline-input participant-inline-name" name="name" type="text" maxlength="100" required autocomplete="off" list="attendanceCloudPlayerSuggestions" data-cloud-player-name value="${escapeAttr(name)}" aria-label="Full name" placeholder="Full name">
            <input class="participant-inline-input participant-inline-nickname" name="nickname" type="text" maxlength="60" autocomplete="off" value="${escapeAttr(nickname)}" aria-label="Nickname" placeholder="Nickname">
            <input type="hidden" name="gender" value="${escapeAttr(person.gender||'')}">
            <input type="hidden" name="category" value="${escapeAttr(categoryCode(person.category)||person.category||'')}">
          </div>
          <div class="participant-inline-actions">
            <button class="participant-action participant-inline-save" type="submit">Save</button>
            <button class="participant-action participant-inline-cancel" type="button" data-participant-action="cancel-edit">Cancel</button>
          </div>
          <p class="participant-inline-hint">Cloud suggestions update this attendance record only.</p>
        </form>
      </article>`;
    }
    const singleLine=`${name}${nickname?` (${nickname})`:''}`;
    const isDeletePending=!!state.pendingDeleteParticipant&&state.pendingDeleteParticipant.sessionId===session.id&&state.pendingDeleteParticipant.index===index;
    const deleteWarning=isDeletePending?`<div class="cloud-delete-warning dashboard-attendance-delete-warning" role="alert"><span>Remove this player from attendance only? Queue and Cloud Players will remain unchanged.</span><button type="button" data-participant-action="confirm-delete" data-participant-index="${index}">Confirm</button><button type="button" class="attendance-cancel-confirm" data-participant-action="cancel-delete" data-participant-index="${index}">Cancel</button></div>`:'';
    return `<article class="participant-row${isDeletePending?' is-delete-confirming':''}">
      ${avatar}
      <span class="participant-copy"><strong class="participant-name" title="${escapeAttr(singleLine)}">${escapeHtml(singleLine)}</strong></span>
      <span class="participant-actions">
        <button class="participant-action edit-participant-action" type="button" data-participant-action="edit" data-participant-index="${index}" aria-label="Edit ${escapeAttr(name)}" title="Edit participant"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"></path></svg><span>Edit</span></button>
        <button class="participant-action delete-participant-action" type="button" data-participant-action="delete" data-participant-index="${index}" aria-label="Remove ${escapeAttr(name)}" title="Remove participant"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="m19 6-1 14H6L5 6"></path><path d="M10 11v5M14 11v5"></path></svg><span>Delete</span></button>
      </span>
      ${deleteWarning}
    </article>`;
  }

  function emptyMarkup(title,description,icon='🏓') {
    return `<div class="empty-state"><span class="empty-state-icon" aria-hidden="true">${icon}</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(description)}</p></div>`;
  }

  function renderAttendance() {
    const session=selectedSession();
    const list=$('participantList');
    const search=String($('attendanceSearch').value||'').trim().toLocaleLowerCase();
    if(!session){
      $('attendanceTotal').textContent='(0)';
      $('attendanceSubtitle').textContent='';
      list.innerHTML=emptyMarkup('No attendance yet','Select a session to view its checked-in participants.','♧');
      return;
    }
    const participants=Array.isArray(session.participants)?session.participants:[];
    const participantCount=session.isLive?participants.length:(Number(session.playerCount)||participants.length);
    $('attendanceTotal').textContent=`(${participantCount})`;
    $('attendanceSubtitle').textContent=String(session.sessionName||'');
    if(state.editingParticipant?.sessionId===session.id && list.querySelector('[data-participant-edit-form]'))return;
    const filtered=participants.map((person,index)=>({person,index})).filter(({person})=>`${fullName(person)} ${person.nickname||''} ${person.category||''}`.toLocaleLowerCase().includes(search));
    if(filtered.length){list.innerHTML=filtered.map(({person,index})=>participantMarkup(person,index,session)).join('');return;}
    if(!participants.length){
      const older=Number(session.playerCount)||0;
      list.innerHTML=older?emptyMarkup('Attendance names not available',`This older session has ${older} participant record(s), but the name list was not saved at the time. New completed sessions include the full check-in list.`,'◷'):emptyMarkup('No participants recorded','This session has no saved participant check-ins.','♧');
    }else{
      list.innerHTML=emptyMarkup('No participants found','Try another name or clear your search.','⌕');
    }
  }

  function teamPeople(log,side) {
    const direct=Array.isArray(log?.[`${side}Players`])?log[`${side}Players`]:[];
    if(direct.length)return direct.map(person=>fullName(person)||'Player');
    const names=Array.isArray(log?.[`${side}Names`])?log[`${side}Names`]:[];
    if(names.length)return names.map(name=>String(name||'Player'));
    const ids=Array.isArray(log?.[`${side}Ids`])?log[`${side}Ids`]:[];
    return ids.map(id=>{
      const match=(state.records.players||[]).find(person=>String(person.id||person.cloudId)===String(id));
      return fullName(match)||`Player ${id}`;
    });
  }

  function isWinningTeam(log,side) {
    if(Number(log?.winnerTeam)===1)return side==='team1';
    if(Number(log?.winnerTeam)===2)return side==='team2';
    const winnerNames=String(log?.winner||'').split('&').map(normalizeName).filter(Boolean);
    if(!winnerNames.length)return false;
    const team=teamPeople(log,side).map(normalizeName);
    return team.length>0&&team.every(name=>winnerNames.includes(name));
  }

  function matchTimeOnly(value) {
    const date=validDate(value);
    return date?new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(date):'Time not available';
  }

  function matchDuration(value) {
    const raw=String(value||'').trim();
    if(!raw)return '';
    const seconds=raw.match(/^(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)$/i);
    if(seconds){const n=Math.max(0,Math.round(Number(seconds[1])));return n>=60?`${Math.floor(n/60)}m ${n%60}s`:`${n}s`;}
    return raw.replace(/\bminutes?\b/i,'min').replace(/\bseconds?\b/i,'sec');
  }

  function matchTeamPlayers(log,side) {
    const snapshots=Array.isArray(log?.[`${side}Players`])?log[`${side}Players`]:[];
    const ids=Array.isArray(log?.[`${side}Ids`])?log[`${side}Ids`]:[];
    const names=teamPeople(log,side);
    return names.map((name,index)=>{
      const snapshot=snapshots[index]||{};
      const matchPlayer={id:snapshot.id??ids[index]??null,cloudId:snapshot.cloudId??null,name:fullName(snapshot)||name,nickname:String(snapshot.nickname||'').trim()};
      const registered=registeredPlayerForMatch(matchPlayer);
      const duprId=String(registered?.duprId||registered?.duprID||registered?.dupr_id||registered?.dupr||snapshot.duprId||snapshot.duprID||snapshot.dupr_id||snapshot.dupr||'').trim().toUpperCase();
      return {...matchPlayer,duprId};
    });
  }

  function matchPlayerMarkup(player,showDuprBadge=true) {
    return `<span class="match-player-line"><span class="match-player-name" title="${escapeAttr(player.name)}">${escapeHtml(player.name)}</span>${showDuprBadge&&player.duprId?`<span class="match-dupr-badge">DUPR</span>`:''}</span>`;
  }

  function isDuprMatch(log,session) {
    // A match-level label/flag takes precedence over the parent session. This
    // prevents a stale session DUPR flag from turning an explicitly NON-DUPR
    // match into an exportable DUPR record.
    const matchName=String(log?.sessionName||'').trim();
    if(/^\(NON\s+DUPR\s+MATCH\)/i.test(matchName))return false;
    if(/^\(DUPR\s+MATCH\)/i.test(matchName))return true;
    if(typeof log?.duprMatch==='boolean')return log.duprMatch;
    const sessionName=String(session?.sessionName||'').trim();
    if(/^\(NON\s+DUPR\s+MATCH\)/i.test(sessionName))return false;
    if(/^\(DUPR\s+MATCH\)/i.test(sessionName))return true;
    return session?.duprMatch===true;
  }

  function duprCsvRowForMatch(log,session) {
    if(!isDuprMatch(log,session)||!hasRecordedMatchScore(log))return null;
    const score=String(log?.score||'').trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if(!score||score[1]===score[2])return null;
    const type=String(log?.type||'Doubles').toLowerCase();
    const isSingles=type.includes('single');
    if(!isSingles&&!type.includes('double'))return null;
    const size=isSingles?1:2;
    const teamA=matchTeamPlayers(log,'team1'),teamB=matchTeamPlayers(log,'team2');
    if(teamA.length!==size||teamB.length!==size||[...teamA,...teamB].some(player=>!player.name||!player.duprId))return null;
    const sessionName=String(log.sessionName||session?.sessionName||'Open Play').replace(/^\((?:NON\s+)?DUPR\s+MATCH\)\s*/i,'').trim()||'Open Play';
    const date=validDate(log.endedAt||log.startedAt||session?.endedAt||session?.startedAt);
    return {matchType:isSingles?'S':'D',event:sessionName,date:date?`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`:'',
      playerA1:teamA[0]?.name||'',playerA1DuprId:teamA[0]?.duprId||'',playerA1ExternalId:'',playerA2:teamA[1]?.name||'',playerA2DuprId:teamA[1]?.duprId||'',playerA2ExternalId:'',
      playerB1:teamB[0]?.name||'',playerB1DuprId:teamB[0]?.duprId||'',playerB1ExternalId:'',playerB2:teamB[1]?.name||'',playerB2DuprId:teamB[1]?.duprId||'',playerB2ExternalId:'',
      teamAGame1:Number(score[1]),teamBGame1:Number(score[2]),teamAGame2:'',teamBGame2:'',teamAGame3:'',teamBGame3:'',teamAGame4:'',teamBGame4:'',teamAGame5:'',teamBGame5:'',scoreType:String(log.scoreType||((Number(log.target)===21)?'Rally':'Sideout')),location:''};
  }

  function matchScoreCenterMarkup(log,team1Won,team2Won) {
    // Both DUPR and NON-DUPR matches use the exact same score display rules.
    // A valid recorded score is always numeric; win-only matches show W-L.
    const scoreParts=String(log?.score??'').trim().match(/^(\d+)\s*-\s*(\d+)$/);
    const winOnly=String(log?.recordingMode||'').trim().toLowerCase()==='win-only';
    const hasRecordedScore=!winOnly&&!!scoreParts&&Number(scoreParts[1])!==Number(scoreParts[2]);
    const left=hasRecordedScore?scoreParts[1]:(team1Won?'W':team2Won?'L':'—');
    const right=hasRecordedScore?scoreParts[2]:(team2Won?'W':team1Won?'L':'—');
    const leftClass=team1Won?'score-is-winner':team2Won?'score-is-loser':'';
    const rightClass=team2Won?'score-is-winner':team1Won?'score-is-loser':'';
    return `<strong class="${leftClass}">${escapeHtml(left)}</strong><span>-</span><strong class="${rightClass}">${escapeHtml(right)}</strong>`;
  }

  function hasRecordedMatchScore(log) {
    if(String(log?.recordingMode||'').trim().toLowerCase()==='win-only')return false;
    const score=String(log?.score||'').trim().match(/^(\d+)\s*-\s*(\d+)$/);
    return !!score&&Number(score[1])!==Number(score[2]);
  }

  function registeredPlayerForMatch(player) {
    const cloudPlayers=Array.isArray(state.records.players)?state.records.players:[];
    const cloudId=String(player?.cloudId||'').trim();
    if(cloudId){
      const byId=cloudPlayers.find(item=>String(item?.cloudId||'').trim()===cloudId);
      if(byId)return byId;
    }
    const playerName=normalizeName(player?.name);
    return playerName?cloudPlayers.find(item=>normalizeName(cloudPlayerName(item))===playerName)||null:null;
  }

  function matchEditPlayerMarkup(player,side,index) {
    const baseName=String(player?.name||'Player details unavailable');
    const registered=registeredPlayerForMatch(player);
    const selectedCloudId=registered?.cloudId==null?'':String(registered.cloudId);
    const selectedName=registered?cloudPlayerName(registered):'';
    return `<div class="match-edit-player-row">
      <div class="match-player-autocomplete">
        <input class="match-edit-player-field" type="text" name="${side}Player${index}" maxlength="120" required autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" data-match-player-input data-match-side="${side}" data-match-player-index="${index}" data-original-name="${escapeAttr(baseName)}" data-selected-cloud-id="${escapeAttr(selectedCloudId)}" data-selected-name="${escapeAttr(selectedName)}" value="${escapeAttr(baseName)}" aria-label="${side==='team1'?'Team 1':'Team 2'} player ${index+1}" placeholder="Search registered player">
        <div class="match-player-suggestions" role="listbox" hidden></div>
      </div>
    </div>`;
  }

  function matchEditorMarkup(log,team1,team2,meta,isDupr,matchNumber,sessionId,cardHeadMarkup,deleteWarningMarkup,syncRowMarkup,renderKey,editFormId) {
    const parts=String(log?.score||'').trim().match(/^(\d+)\s*-\s*(\d+)$/);
    const leftScore=parts?parts[1]:'';
    const rightScore=parts?parts[2]:'';
    const playerRows=(players,side)=>players.length?players.map((player,index)=>matchEditPlayerMarkup(player,side,index)).join(''):'<div class="match-edit-player-field match-edit-player-field-empty">Player details unavailable</div>';
    return `<article class="match-card match-record-card is-editing" data-match-id="${escapeAttr(matchNumber)}" data-match-session-id="${escapeAttr(sessionId)}">
      ${cardHeadMarkup}
      ${deleteWarningMarkup}
      ${syncRowMarkup}
      <form class="match-inline-edit-form" id="${escapeAttr(editFormId)}" data-match-edit-form data-match-id="${escapeAttr(matchNumber)}" data-session-id="${escapeAttr(sessionId)}" data-match-render-key="${escapeAttr(renderKey)}">
        <div class="match-inline-edit-panel">
          <div class="match-edit-teams">
            <section class="match-edit-team-group" aria-label="Team 1 players"><span class="match-edit-team-label">Team 1</span><div class="match-edit-player-list">${playerRows(team1,'team1')}</div></section>
            <div class="match-edit-score-center" aria-label="Edit recorded match score">
              <input data-match-score-input name="team1Score" type="text" inputmode="numeric" pattern="[0-9]{1,2}" maxlength="2" autocomplete="off" required aria-label="Team 1 score" value="${escapeAttr(leftScore)}">
              <span>VS</span>
              <input data-match-score-input name="team2Score" type="text" inputmode="numeric" pattern="[0-9]{1,2}" maxlength="2" autocomplete="off" required aria-label="Team 2 score" value="${escapeAttr(rightScore)}">
            </div>
            <section class="match-edit-team-group" aria-label="Team 2 players"><span class="match-edit-team-label">Team 2</span><div class="match-edit-player-list">${playerRows(team2,'team2')}</div></section>
          </div>
          <p class="match-edit-cloud-hint">Choose player names from Registered Player Cloud suggestions. Unregistered or manually typed replacement names cannot be saved.</p>
        </div>
      </form>
    </article>`;
  }

  function matchDeleteWarningMarkup(matchNumber,sessionId) {
    return `<div class="cloud-delete-warning dashboard-attendance-delete-warning match-inline-delete-warning" role="alert"><span>Delete this recorded match? The session and its participants will remain unchanged.</span><button type="button" data-match-action="confirm-delete" data-match-id="${escapeAttr(matchNumber)}" data-session-id="${escapeAttr(sessionId)}">Confirm</button><button type="button" class="attendance-cancel-confirm" data-match-action="cancel-delete" data-match-id="${escapeAttr(matchNumber)}" data-session-id="${escapeAttr(sessionId)}">Cancel</button></div>`;
  }

  function mountedMatchCard(sessionId,matchId) {
    return Array.from($('matchList').querySelectorAll('.match-record-card')).find(card=>
      String(card.dataset.matchSessionId||'')===String(sessionId)&&String(card.dataset.matchId||'')===String(matchId)
    )||null;
  }

  function matchMarkup(log,index,session,renderKey='') {
    const team1=matchTeamPlayers(log,'team1'),team2=matchTeamPlayers(log,'team2');
    const team1Won=isWinningTeam(log,'team1'),team2Won=isWinningTeam(log,'team2');
    const time=matchTimeOnly(log.endedAt||log.startedAt);
    const duration=matchDuration(log.duration);
    const type=String(log.type||'Doubles');
    const matchNumber=log.id!==undefined&&log.id!==null?String(log.id):String(index+1);
    const idAvailable=log.id!==undefined&&log.id!==null&&String(log.id)!=='';
    const sessionId=String(session?.id||'');
    const isDupr=isDuprMatch(log,session);
    const exportable=!!duprCsvRowForMatch(log,session);
    const canEditRecordedScore=idAvailable&&hasRecordedMatchScore(log);
    const hasRecordedScore=hasRecordedMatchScore(log);
    const isEditingThisMatch=state.editingMatch?.sessionId===sessionId&&state.editingMatch?.matchId===matchNumber;
    const isDeletePending=String(state.pendingDeleteMatch?.sessionId||'')===sessionId&&String(state.pendingDeleteMatch?.matchId||'')===matchNumber;
    const deleteWarningMarkup=isDeletePending?matchDeleteWarningMarkup(matchNumber,sessionId):'';
    const scoreCenter=matchScoreCenterMarkup(log,team1Won,team2Won);
    const editFormId=`match-edit-form-${`${sessionId}-${matchNumber}`.replace(/[^a-zA-Z0-9_-]/g,'-')}`;
    const meta=`<strong>#${escapeHtml(matchNumber)}</strong><time>${escapeHtml(time)}</time>${duration?`<span class="match-duration">(${escapeHtml(duration)})</span>`:''}<span class="match-type-pill">${escapeHtml(type)}</span>`;
    const editHeaderActions=isEditingThisMatch?`
        <button class="match-edit-header-button match-edit-save" type="submit" form="${escapeAttr(editFormId)}">Save</button>
        <button class="match-edit-header-button match-edit-cancel" type="button" data-match-action="cancel-edit" data-match-id="${escapeAttr(matchNumber)}" data-session-id="${escapeAttr(sessionId)}">Cancel</button>`:
      canEditRecordedScore?`<button class="match-icon-action" type="button" data-match-action="edit" data-match-id="${escapeAttr(matchNumber)}" data-session-id="${escapeAttr(sessionId)}" aria-label="Edit match" title="Edit recorded match"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"></path></svg></button>`:'';
    const cardHeadMarkup=`<div class="match-card-head">
      <div class="match-record-meta">${meta}</div>
      <div class="match-card-actions ${isEditingThisMatch?'is-editing-actions':''}">
        ${editHeaderActions}
        <button class="match-icon-action is-delete" type="button" data-match-action="delete" data-match-id="${escapeAttr(matchNumber)}" data-session-id="${escapeAttr(sessionId)}" ${idAvailable&&!isDeletePending?'':'disabled'} aria-label="Delete match" title="Delete match"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="m19 6-1 14H6L5 6"></path><path d="M10 11v5M14 11v5"></path></svg></button>
      </div>
    </div>`;
    const syncRowMarkup=hasRecordedScore?`<div class="match-sync-row"><span class="match-sync-status" data-match-kind="${isDupr?'dupr':'non-dupr'}">${isDupr?'DUPR MATCH':'NON-DUPR MATCH'}</span><button class="match-sync-button" type="button" data-match-action="export" data-match-id="${escapeAttr(matchNumber)}" data-session-id="${escapeAttr(sessionId)}" ${exportable&&!state.editingMatch?'':'disabled'} title="${state.editingMatch?'Finish or cancel the open match edit before exporting':exportable?'Download a CSV ready for manual DUPR import':'DUPR export requires a DUPR match, a valid score, and DUPR IDs for every player'}">Export DUPR CSV</button></div>`:'';
    if(isEditingThisMatch) {
      return matchEditorMarkup(log,team1,team2,meta,isDupr,matchNumber,sessionId,cardHeadMarkup,deleteWarningMarkup,syncRowMarkup,renderKey,editFormId);
    }
    const teamMarkup=(players,won)=>`<div class="match-team ${won?'is-winner':'is-loser'}"><span class="match-outcome-mark">${won?'W':'L'}</span><span class="match-team-players">${players.map(player=>matchPlayerMarkup(player,hasRecordedScore)).join('')||'<span class="match-player-line"><span class="match-player-name">Player details unavailable</span></span>'}</span></div>`;
    return `<article class="match-card match-record-card" data-match-id="${escapeAttr(matchNumber)}" data-match-session-id="${escapeAttr(sessionId)}">
      ${cardHeadMarkup}
      ${deleteWarningMarkup}
      ${syncRowMarkup}
      <div class="match-teams">
        ${teamMarkup(team1,team1Won)}
        <div class="match-score-center">${scoreCenter}</div>
        ${teamMarkup(team2,team2Won)}
      </div>
    </article>`;
  }

  function allMatchEntries() {
    // Match History is global: collect completed matches from every archived
    // session plus the active session, then apply the date range to that set.
    // Each entry keeps its owning session so edit/delete/DUPR actions still
    // target the correct session even when match IDs overlap between sessions.
    return allSessions().flatMap(session=>sessionLogs(session).map(log=>({log,session}))).sort((a,b)=>{
      const dateA=validDate(a.log?.endedAt||a.log?.startedAt||a.session?.endedAt||a.session?.startedAt)?.getTime()||0;
      const dateB=validDate(b.log?.endedAt||b.log?.startedAt||b.session?.endedAt||b.session?.startedAt)?.getTime()||0;
      return dateB-dateA;
    });
  }

  function parseLocalMatchDateTimeInput(value) {
    const match=String(value||'').trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if(!match)return null;
    const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
    const hour=Number(match[4]),minute=Number(match[5]),second=Number(match[6]||0);
    const date=new Date(year,month-1,day,hour,minute,second,0);
    // Reject impossible dates/times instead of allowing Date to roll them over.
    if(date.getFullYear()!==year||date.getMonth()!==month-1||date.getDate()!==day||
      date.getHours()!==hour||date.getMinutes()!==minute||date.getSeconds()!==second)return null;
    return date;
  }

  function dateRangeBounds() {
    const from=parseLocalMatchDateTimeInput($('matchesFromDate')?.value);
    const toDate=parseLocalMatchDateTimeInput($('matchesToDate')?.value);
    // datetime-local controls have one-second precision. Make the To second
    // inclusive by using the following second as the exclusive upper boundary.
    const to=toDate?new Date(toDate.getTime()+1000):null;
    return {from,to};
  }

  function matchEntryDate(entry) {
    // Use the first valid timestamp. A malformed endedAt must not hide a valid
    // startedAt, and session timestamps are only a last-resort legacy fallback.
    return validDate(entry.log?.endedAt)||validDate(entry.log?.startedAt)||
      validDate(entry.session?.endedAt)||validDate(entry.session?.startedAt);
  }

  function matchEntryMatchesRange(entry,bounds) {
    const date=matchEntryDate(entry);
    if(!date&&(bounds.from||bounds.to))return false;
    if(bounds.from&&date<bounds.from)return false;
    if(bounds.to&&date>=bounds.to)return false;
    return true;
  }

  function syncMatchRangeButtons() {
    document.querySelectorAll('#matchFilterToolbar [data-match-range]').forEach(button=>{
      const active=String(button.dataset.matchRange||'')===state.matchDateRange;
      button.classList.toggle('is-active',active);
      button.setAttribute('aria-pressed',String(active));
    });
  }

  function setManualMatchDateFilter(changedField) {
    state.matchDateRange='';
    state.matchSessionFilterId='';
    const fromInput=$('matchesFromDate');
    const toInput=$('matchesToDate');
    const from=parseLocalMatchDateTimeInput(fromInput.value);
    const to=parseLocalMatchDateTimeInput(toInput.value);
    // Keep the selected interval valid when its endpoints are edited in either
    // direction; adjust the opposite endpoint to the newly chosen date.
    if(from&&to&&from>to){
      if(changedField==='from')toInput.value=fromInput.value;
      else fromInput.value=toInput.value;
    }
    syncMatchRangeButtons();
    renderMatches();
  }

  function renderMatches() {
    const list=$('matchList');
    const search=normalizeName($('matchesSearch').value||'');
    const bounds=dateRangeBounds();
    const allEntries=allMatchEntries();
    // A session chosen from the picker is isolated by its unique ID and exact
    // created-time window. Choosing a quick range or editing either date clears
    // that scope and restores global all-session Match History.
    const inRange=allEntries.filter(entry=>
      (!state.matchSessionFilterId||String(entry.session?.id||'')===state.matchSessionFilterId)&&
      matchEntryMatchesRange(entry,bounds)
    );
    const filtered=inRange.filter(({log})=>{
      if(!search)return true;
      // Match search is intentionally limited to player names only. Court,
      // session, score, DUPR ID, and nickname text are not search fields.
      const playerNames=[
        ...matchTeamPlayers(log,'team1').map(player=>player.name),
        ...matchTeamPlayers(log,'team2').map(player=>player.name)
      ];
      return playerNames.some(name=>normalizeName(name).includes(search));
    });
    // The summary and CSV export set follow the date range, not the text search.
    state.matchesVisible=inRange;
    const totalMatches=inRange.length;
    const duprMatches=inRange.filter(({log,session})=>isDuprMatch(log,session));
    const exportable=duprMatches.filter(({log,session})=>!!duprCsvRowForMatch(log,session));
    $('matchesTotal').textContent=`(${totalMatches})`;
    $('matchesPlayedCount').textContent=String(totalMatches);
    $('duprExportCount').textContent=String(exportable.length);
    // DUPR export follows the same scope currently shown in Match History.
    // Quick ranges and All Time clear the selected-session scope first.
    $('exportMatchesButton').disabled=duprMatches.length===0||!!state.editingMatch;
    $('exportMatchesButton').title=duprMatches.length===0
      ?'No DUPR MATCH sessions in the selected date range'
      :state.editingMatch
        ?'Finish or cancel the open match edit before exporting'
        :exportable.length===duprMatches.length
          ?'Review and export DUPR-ready matches'
          :exportable.length
            ?'Review DUPR matches and missing IDs before exporting'
            :'Open DUPR export to review matches and missing details';
    const scopedSession=state.matchSessionFilterId?allSessions().find(session=>String(session.id)===state.matchSessionFilterId):null;
    $('matchesSubtitle').textContent=scopedSession?`Selected Session · ${scopedSession.sessionName||'Open Play'}`:'All Sessions';
    const renderKey=[search,state.matchSessionFilterId||'',bounds.from?bounds.from.getTime():'',bounds.to?bounds.to.getTime():''].join('|');
    if(state.editingMatch){
      const targetStillVisible=filtered.some(({log,session})=>String(log?.id??'')===state.editingMatch.matchId&&String(session?.id||'')===state.editingMatch.sessionId);
      const mountedEditor=list.querySelector('[data-match-edit-form]');
      const mountedEditorIsTarget=!!mountedEditor&&
        String(mountedEditor.dataset.matchId||'')===String(state.editingMatch.matchId)&&
        String(mountedEditor.dataset.sessionId||'')===String(state.editingMatch.sessionId);
      if(targetStillVisible&&mountedEditorIsTarget&&mountedEditor.dataset.matchRenderKey===renderKey)return;
      if(!targetStillVisible)state.editingMatch=null;
    }
    if(!filtered.length){
      list.innerHTML=inRange.length?emptyMarkup('No matches found','Try another player name or clear your search.','⌕'):allEntries.length?emptyMarkup('No matches in this date range','Change the dates or choose All Time to view older match records.','🏓'):emptyMarkup('No match history yet','Completed matches recorded in Queueing will appear here.','🏓');
      return;
    }
    list.innerHTML=filtered.map(({log,session},index)=>matchMarkup(log,index,session,renderKey)).join('');
  }

  function matchDateTimeInputValue(date) {
    return toLocalMatchDateTimeValue(date);
  }

  function initializeDefaultMatchDateRange() {
    // Default to Today on first load. Quick ranges always show global history.
    state.matchDateRange='today';
    state.matchSessionFilterId='';
    const today=new Date();
    const start=new Date(today.getFullYear(),today.getMonth(),today.getDate(),0,0,0);
    const end=new Date(today.getFullYear(),today.getMonth(),today.getDate(),23,59,59);
    $('matchesFromDate').value=matchDateTimeInputValue(start);
    $('matchesToDate').value=matchDateTimeInputValue(end);
    syncMatchRangeButtons();
    renderMatches();
  }

  function setMatchDateRange(range) {
    const normalized=String(range??'').trim().toLowerCase();
    if(!['today','7','30','all'].includes(normalized))return;
    state.matchDateRange=normalized;
    state.matchSessionFilterId='';
    const today=new Date();
    const end=new Date(today.getFullYear(),today.getMonth(),today.getDate(),23,59,59);
    let start=null;
    if(normalized==='today')start=new Date(today.getFullYear(),today.getMonth(),today.getDate(),0,0,0);
    else if(normalized==='7')start=new Date(today.getFullYear(),today.getMonth(),today.getDate()-6,0,0,0);
    else if(normalized==='30')start=new Date(today.getFullYear(),today.getMonth(),today.getDate()-29,0,0,0);
    // All Time intentionally clears both endpoints and remains global.
    $('matchesFromDate').value=start?matchDateTimeInputValue(start):'';
    $('matchesToDate').value=normalized==='all'?'':matchDateTimeInputValue(end);
    syncMatchRangeButtons();
    renderMatches();
  }

  function sessionManageMarkup(session) {
    const matchCount=sessionLogs(session).length;
    const participantCount=Number(session.playerCount)||session.participants?.length||0;
    const createdDate=formatDateTime(sessionCreatedAt(session));
    const endedDate=session.isLive?'LIVE':`${formatDateTime(session.endedAt||session.startedAt)} ENDED`;
    const subtitle=`${endedDate} · ${participantCount} participant${participantCount===1?'':'s'} · ${matchCount} match${matchCount===1?'':'es'}`;
    const disabled=session.isLive?'disabled':'';
    const status=session.isLive?'<span class="session-status is-live">LIVE</span>':'<span class="session-status">COMPLETED</span>';
    const isDeletePending=String(state.pendingDeleteSessionId||'')===String(session.id||'');
    const deleteWarningMarkup=isDeletePending?`<div class="cloud-delete-warning dashboard-attendance-delete-warning session-inline-delete-warning" role="alert"><span>Delete this session and all match records saved under it? This action cannot be undone.</span><button type="button" data-session-action="confirm-delete" data-session-id="${escapeAttr(session.id)}">Confirm</button><button type="button" class="attendance-cancel-confirm" data-session-action="cancel-delete" data-session-id="${escapeAttr(session.id)}">Cancel</button></div>`:'';
    return `<article class="session-manage-card" data-session-id="${escapeAttr(session.id)}">
      <div class="session-manage-copy"><div class="session-manage-topline">${status}<span class="session-manage-date">${escapeHtml(createdDate)} CREATED</span></div>
        <h3>${escapeHtml(session.sessionName||'Open Play')}</h3><p>${escapeHtml(subtitle)}</p>
      </div>
      <div class="session-manage-actions">
        <button type="button" class="session-manage-btn edit-session-btn" data-session-action="edit" data-session-id="${escapeAttr(session.id)}" ${disabled} aria-label="Edit ${escapeAttr(session.sessionName||'session')}" title="Edit session"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"></path></svg><span>Edit</span></button>
        <button type="button" class="session-manage-btn delete-session-btn" data-session-action="delete" data-session-id="${escapeAttr(session.id)}" ${disabled||isDeletePending?'disabled':''} aria-label="Delete ${escapeAttr(session.sessionName||'session')}" title="Delete session"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="m19 6-1 14H6L5 6"></path><path d="M10 11v5M14 11v5"></path></svg><span>Delete</span></button>
      </div>
      ${deleteWarningMarkup}
      ${session.isLive?'<div class="session-manage-note">End this live session before editing or deleting it.</div>':''}
    </article>`;
  }

  function renderSessions() {
    const list=$('sessionManagementList');
    const search=String($('sessionsSearch').value||'').trim().toLocaleLowerCase();
    const sessions=allSessions();
    $('sessionsTotal').textContent=`(${sessions.length})`;
    const filtered=sessions.filter(session=>`${session.sessionName||''} ${session.endedAt||''} ${session.startedAt||''}`.toLocaleLowerCase().includes(search));
    if(filtered.length){list.innerHTML=filtered.map(sessionManageMarkup).join('');return;}
    list.innerHTML=sessions.length?emptyMarkup('No sessions found','Try another session name or clear your search.','⌕'):emptyMarkup('No sessions to manage','Create your first session to see it listed here.','◷');
  }

  function render() {
    renderTabs();
    renderSessionSelect();
    renderAttendance();
    renderMatches();
    renderSessions();
    if($('duprExportModal')&&!$('duprExportModal').hidden)renderDuprExportModal();
  }

  function setTab(tab) {
    if(!['attendance','matches','sessions'].includes(tab)||state.tab===tab)return;
    state.tab=tab;
    render();
  }

  async function loadDashboardData({silent=false}={}) {
    // Polling, manual refreshes, and mutations can overlap. Only the newest
    // request may update dashboard data, otherwise a slow older response can
    // replace newer match/session records and make the dashboard appear to glitch.
    const requestId=++state.dashboardLoadRequestId;
    try {
      // Completed sessions are retained until an organizer explicitly deletes them.
      state.emptySessionCleanupDone=true;
      const dashboard=await fetchJson('/api/organizer-dashboard');
      if(requestId!==state.dashboardLoadRequestId)return true;

      const organizer=dashboard.organizer||{};
      state.auth=organizer;
      const responseRevision=Number(dashboard.appRevision)||0;
      // The EventSource can deliver a newer app state while this fetch is in
      // flight. Keep its app state AND its corresponding cloud-record snapshot.
      const shouldApplySnapshot=responseRevision>=state.appRevision;
      if(shouldApplySnapshot){
        const previousSessionId=String(state.appState?.sessionId||'');
        const nextAppState=dashboard.appState&&typeof dashboard.appState==='object'?dashboard.appState:null;
        const nextSessionId=String(nextAppState?.sessionId||'');
        const newLiveSession=nextAppState?.sessionActive===true&&nextSessionId&&nextSessionId!==previousSessionId;
        state.appState=nextAppState;
        state.appRevision=responseRevision;

        const records=dashboard.records&&typeof dashboard.records==='object'?dashboard.records:{};
        state.records={players:Array.isArray(records.players)?records.players:[],logs:Array.isArray(records.logs)?records.logs:[],sessions:Array.isArray(records.sessions)?records.sessions:[],attendanceBySession:records.attendanceBySession&&typeof records.attendanceBySession==='object'?records.attendanceBySession:{}};
        if(newLiveSession)state.selection.session=nextSessionId;
      }
      renderCloudPlayerSuggestions();
      updateDashboardBrand(organizer);
      ensureSelection();
      render();
      return true;
    }catch(error){
      // A superseded request is expected during polling; its failure must not
      // clear the UI or show an error over a newer successful response.
      if(requestId!==state.dashboardLoadRequestId)return true;
      if(!silent){
        $('participantList').innerHTML=emptyMarkup('Unable to load attendance','Check your connection and refresh this page.','!');
        $('matchList').innerHTML=emptyMarkup('Unable to load match history','Check your connection and refresh this page.','!');
        $('sessionManagementList').innerHTML=emptyMarkup('Unable to load sessions','Check your connection and refresh this page.','!');
        showToast(error.message||'Unable to load dashboard records.');
      }
      return false;
    }
  }

  function initLiveStateStream() {
    if(!('EventSource' in window)||state.appEventStream)return;
    const stream=new EventSource('/api/shared-events');
    state.appEventStream=stream;
    stream.addEventListener('app-state',event=>{
      let payload;
      try{payload=JSON.parse(event.data);}catch(_){return;}
      if(payload?.organizerId&&state.auth?.id&&String(payload.organizerId)!==String(state.auth.id))return;
      const revision=Number(payload?.revision)||0;
      if(revision&&revision<=state.appRevision)return;
      const incoming=payload?.state;
      if(!incoming||typeof incoming!=='object')return;
      const previousSessionId=String(state.appState?.sessionId||'');
      const nextSessionId=String(incoming.sessionId||'');
      const newLiveSession=incoming.sessionActive===true&&nextSessionId&&nextSessionId!==previousSessionId;
      state.appRevision=Math.max(state.appRevision,revision);
      state.appState=incoming;
      if(newLiveSession)state.selection.session=nextSessionId;
      ensureSelection();
      render();
      if(incoming.sessionActive===false&&incoming.sessionEndedAt){
        // End Session archives to the cloud record store as well. Refresh the
        // archive after the app-state transition so the new session is selectable.
        window.setTimeout(()=>loadDashboardData({silent:true}),700);
      }
    });
    stream.addEventListener('error',()=>{
    });
  }

  let sessionEditCalendarCursor=new Date();
  let sessionEditSelectedDate='';

  function localCalendarDate(value) {
    const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match?new Date(Number(match[1]),Number(match[2])-1,Number(match[3])):null;
  }

  function localDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }

  function formatSessionDateKey(value) {
    const date=localCalendarDate(value);
    return date?new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric'}).format(date):'Select a day';
  }

  function formatSessionDateTime(value) {
    const date=validDate(value);
    if(!date)return '—';
    const dateLabel=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(date);
    const timeLabel=new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit'}).format(date);
    return `${dateLabel} • ${timeLabel}`;
  }

  function closeSessionEditCalendar() {
    $('sessionEditCalendar').hidden=true;
    $('sessionEditDateTrigger').setAttribute('aria-expanded','false');
  }

  function renderSessionEditCalendar() {
    const cursor=sessionEditCalendarCursor;
    $('sessionEditMonthLabel').textContent=new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric'}).format(cursor);
    const firstDay=new Date(cursor.getFullYear(),cursor.getMonth(),1);
    const mondayOffset=(firstDay.getDay()+6)%7;
    const gridStart=new Date(cursor.getFullYear(),cursor.getMonth(),1-mondayOffset);
    const todayKey=localDateKey(new Date());
    const visibleDays=Math.ceil((mondayOffset+new Date(cursor.getFullYear(),cursor.getMonth()+1,0).getDate())/7)*7;
    const cells=[];
    for(let index=0;index<visibleDays;index++){
      const day=new Date(gridStart.getFullYear(),gridStart.getMonth(),gridStart.getDate()+index);
      const key=localDateKey(day);
      const outside=day.getMonth()!==cursor.getMonth();
      const selected=key===sessionEditSelectedDate;
      cells.push(`<button class="session-edit-calendar-day${outside?' is-outside':''}${selected?' is-selected':''}${key===todayKey?' is-today':''}" type="button" data-session-date="${key}" aria-label="${new Intl.DateTimeFormat(undefined,{dateStyle:'full'}).format(day)}" aria-pressed="${selected?'true':'false'}">${day.getDate()}</button>`);
    }
    $('sessionEditCalendarGrid').innerHTML=cells.join('');
  }

  function updateSessionEditStartPreview() {
    let start=validDate(state.editingSessionOriginalStartedAt);
    const originalEnd=validDate(state.editingSessionOriginalEndedAt);
    const editedEnd=validDate($('sessionEditEndedAt').value);
    if(start&&originalEnd&&editedEnd)start=new Date(start.getTime()+(editedEnd.getTime()-originalEnd.getTime()));
    $('sessionEditStartTimePreview').textContent=start?formatSessionDateTime(start.toISOString()):'—';
    $('sessionEditEndPreview').textContent=editedEnd?formatSessionDateTime(editedEnd.toISOString()):'—';
  }

  function syncSessionEditDateTime() {
    const date=sessionEditSelectedDate;
    const endLocal=toLocalDateTimeValue(state.editingSessionOriginalEndedAt)||toLocalDateTimeValue(state.editingSessionOriginalStartedAt);
    const time=endLocal?endLocal.slice(11,16):'23:59';
    $('sessionEditEndedAt').value=date?`${date}T${time}`:'';
    $('sessionEditDateLabel').textContent=formatSessionDateKey(date);
    updateSessionEditStartPreview();
  }

  function chooseSessionEditDate(dateKey) {
    if(!localCalendarDate(dateKey))return;
    sessionEditSelectedDate=dateKey;
    syncSessionEditDateTime();
    renderSessionEditCalendar();
  }

  function openEditSession(sessionId) {
    const session=archivedSessions().find(item=>item.id===sessionId);
    if(!session){showToast('This session is no longer available.');return;}
    state.editingSessionId=session.id;
    state.editingSessionOriginalStartedAt=session.startedAt||'';
    state.editingSessionOriginalEndedAt=session.endedAt||'';
    $('sessionEditName').value=String(session.sessionName||'Open Play');
    const endLocal=toLocalDateTimeValue(session.endedAt);
    sessionEditSelectedDate=endLocal?endLocal.slice(0,10):'';
    const cursorDate=localCalendarDate(sessionEditSelectedDate)||new Date();
    sessionEditCalendarCursor=new Date(cursorDate.getFullYear(),cursorDate.getMonth(),1);
    $('sessionEditEndedAt').value=endLocal;
    $('sessionEditDateLabel').textContent=formatSessionDateKey(sessionEditSelectedDate);
    closeSessionEditCalendar();
    renderSessionEditCalendar();
    updateSessionEditStartPreview();
    showDashboardModal('sessionEditModal');
    $('sessionEditName').focus();
  }

  function closeEditSession() {
    closeSessionEditCalendar();
    hideDashboardModal('sessionEditModal');
    state.editingSessionId='';
    state.editingSessionOriginalStartedAt='';
    state.editingSessionOriginalEndedAt='';
  }

  function openDeleteSession(sessionId) {
    const session=archivedSessions().find(item=>String(item.id)===String(sessionId));
    if(!session){showToast('This session is no longer available.');return;}
    state.pendingDeleteSessionId=String(session.id);
    renderSessions();
  }

  function closeDeleteSession() {
    state.pendingDeleteSessionId='';
    renderSessions();
  }

  async function saveSessionEdit(event) {
    event.preventDefault();
    if(!state.editingSessionId)return;
    const button=$('saveSessionEditButton');
    const sessionName=String($('sessionEditName').value||'').trim();
    if(!sessionName){$('sessionEditName').focus();return;}
    const localDate=String($('sessionEditEndedAt').value||'').trim();
    let endedAt='';
    if(localDate){
      const parsed=new Date(localDate);
      if(!Number.isFinite(parsed.getTime())){showToast('Please enter a valid session date and time.');return;}
      endedAt=parsed.toISOString();
    }
    button.disabled=true;
    button.textContent='Saving…';
    try{
      await fetchJson(`/api/organizer-dashboard/sessions/${encodeURIComponent(state.editingSessionId)}`,{
        method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionName,endedAt})
      });
      closeEditSession();
      await loadDashboardData({silent:true});
      showToast('Session updated successfully.');
    }catch(error){showToast(error.message||'Unable to update session.');}
    finally{button.disabled=false;button.textContent='Save Changes';}
  }

  async function confirmDeleteSession(button) {
    const sessionId=state.pendingDeleteSessionId;
    if(!sessionId)return;
    if(button){button.disabled=true;button.textContent='Deleting…';}
    try{
      await fetchJson(`/api/organizer-dashboard/sessions/${encodeURIComponent(sessionId)}`,{method:'DELETE'});
      state.pendingDeleteSessionId='';
      await loadDashboardData({silent:true});
      showToast('Session and its recorded matches were deleted.');
    }catch(error){showToast(error.message||'Unable to delete session.');}
    finally{if(button){button.disabled=false;button.textContent='Confirm';}}
  }

  function syncModalBodyLock() {
    const open=['sessionEditModal','settingsModal','duprExportModal'].some(id=>$(id)&&!$(id).hidden);
    document.body.classList.toggle('modal-open',open);
  }

  function showDashboardModal(id) {
    $(id).hidden=false;
    syncModalBodyLock();
  }

  function hideDashboardModal(id) {
    $(id).hidden=true;
    syncModalBodyLock();
  }

  function openEditParticipant(index) {
    const session=selectedSession();
    const person=session?.participants?.[index];
    if(!session||!person){showToast('This attendance record is no longer available.');return;}
    state.editingParticipant={sessionId:session.id,index};
    renderAttendance();
    const input=$('participantList').querySelector('[data-cloud-player-name]');
    input?.focus();input?.select();
  }

  function closeEditParticipant() {
    state.editingParticipant=null;
    renderAttendance();
  }

  async function saveParticipantEdit(event) {
    event.preventDefault();
    const form=event.target.closest('[data-participant-edit-form]');
    const target=state.editingParticipant;
    if(!target||!form)return;
    const name=String(form.querySelector('[name="name"]')?.value||'').normalize('NFC').trim().replace(/\s+/g,' ');
    if(!name){form.querySelector('[name="name"]')?.focus();return;}
    const button=form.querySelector('button[type="submit"]');
    button.disabled=true;button.textContent='Saving…';
    try {
      await fetchJson(`/api/organizer-dashboard/sessions/${encodeURIComponent(target.sessionId)}/participants/${target.index}`,{
        method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({
          name,nickname:form.querySelector('[name="nickname"]').value,
          gender:form.querySelector('[name="gender"]').value,
          category:form.querySelector('[name="category"]').value
        })
      });
      state.editingParticipant=null;
      await loadDashboardData({silent:true});
      showToast('Attendance record updated. Queue and Cloud Players were not changed.');
    } catch(error) { showToast(error.message||'Unable to update participant.');button.disabled=false;button.textContent='Save'; }
  }

  function openDeleteParticipant(index) {
    const session=selectedSession();
    const person=session?.participants?.[index];
    if(!session||!person){showToast('This attendance record is no longer available.');return;}
    state.editingParticipant=null;
    state.pendingDeleteParticipant={sessionId:session.id,index};
    renderAttendance();
  }

  function closeDeleteParticipant() {
    state.pendingDeleteParticipant=null;
    renderAttendance();
  }

  async function confirmDeleteParticipant(button) {
    const target=state.pendingDeleteParticipant;
    if(!target||!button)return;
    button.disabled=true;button.textContent='Removing…';
    try {
      await fetchJson(`/api/organizer-dashboard/sessions/${encodeURIComponent(target.sessionId)}/participants/${target.index}`,{method:'DELETE'});
      state.pendingDeleteParticipant=null;
      await loadDashboardData({silent:true});
      showToast('Participant removed from attendance. Match history was kept.');
    } catch(error) { showToast(error.message||'Unable to remove participant.');button.disabled=false;button.textContent='Confirm'; }
  }

  function findMatch(sessionId,matchId) {
    const session=allSessions().find(item=>item.id===String(sessionId));
    return session?{session,log:sessionLogs(session).find(log=>String(log?.id??'')===String(matchId))}:null;
  }

  function openEditMatch(matchId,sessionId) {
    const found=findMatch(sessionId,matchId);
    if(!found?.session||!found?.log){showToast('This match is no longer available.');return;}
    if(!hasRecordedMatchScore(found.log)){showToast('Only matches with a recorded score can be edited.');return;}
    const scrollX=window.scrollX;
    const scrollY=window.scrollY;
    state.editingMatch={sessionId:found.session.id,matchId:String(matchId)};
    renderMatches();
    // Restore after layout/paint so the browser cannot anchor the viewport to
    // the newly expanded card or the removed pencil button.
    requestAnimationFrame(()=>window.scrollTo(scrollX,scrollY));
  }

  function closeEditMatch() {
    if(!state.editingMatch)return;
    state.editingMatch=null;
    renderMatches();
  }

  async function saveMatchEdit(event) {
    const form=event.target.closest('[data-match-edit-form]');
    if(!form)return;
    event.preventDefault();
    const target=state.editingMatch;
    if(!target)return;
    const left=String(form.querySelector('[name="team1Score"]')?.value||'').trim();
    const right=String(form.querySelector('[name="team2Score"]')?.value||'').trim();
    const leftInput=form.querySelector('[name="team1Score"]');
    const rightInput=form.querySelector('[name="team2Score"]');
    if(!left||!right){showToast('A recorded score is required to edit this match.');(!left?leftInput:rightInput)?.focus();return;}
    if((left&&!/^\d{1,2}$/.test(left))||(right&&!/^\d{1,2}$/.test(right))){showToast('Each score must contain 1 or 2 digits only.');(left&&!/^\d{1,2}$/.test(left)?leftInput:rightInput)?.focus();return;}
    const score=`${Number(left)}-${Number(right)}`;
    if(Number(left)===Number(right)){showToast('A completed match cannot have a tied score.');rightInput?.focus();return;}

    const usedNames=new Set();
    const usedCloudIds=new Set();
    const teamSelections={team1Players:[],team2Players:[]};
    for(const input of Array.from(form.querySelectorAll('[data-match-player-input]'))){
      const name=String(input.value||'').normalize('NFC').trim().replace(/\s+/g,' ');
      const originalName=String(input.dataset.originalName||'').normalize('NFC').trim().replace(/\s+/g,' ');
      const cloudId=String(input.dataset.selectedCloudId||'').trim();
      if(!name){showToast('Each match player must have a name.');input.focus();return;}
      if(usedNames.has(normalizeName(name))){showToast('A player cannot appear more than once in the same match.');input.focus();return;}
      usedNames.add(normalizeName(name));
      if(cloudId){
        const cloudPlayer=(state.records.players||[]).find(player=>String(player?.cloudId||'').trim()===cloudId);
        if(!cloudPlayer||normalizeName(cloudPlayerName(cloudPlayer))!==normalizeName(name)){
          showToast('Please select the player from Registered Player Cloud suggestions.');input.focus();return;
        }
        if(usedCloudIds.has(cloudId)){showToast('A registered player cannot be selected twice in the same match.');input.focus();return;}
        usedCloudIds.add(cloudId);
      }else if(normalizeName(name)!==normalizeName(originalName)){
        showToast('Player names must be selected from Registered Player Cloud suggestions.');input.focus();return;
      }
      const side=input.dataset.matchSide==='team2'?'team2Players':'team1Players';
      teamSelections[side].push({name,cloudId});
    }
    if(!teamSelections.team1Players.length||!teamSelections.team2Players.length){showToast('Both teams must have registered player entries.');return;}

    const button=form.querySelector('button[type="submit"]');
    if(button){button.disabled=true;button.textContent='Saving…';}
    try {
      await fetchJson(`/api/organizer-dashboard/sessions/${encodeURIComponent(target.sessionId)}/matches/${encodeURIComponent(target.matchId)}`,{
        method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({score,...teamSelections})
      });
      state.editingMatch=null;
      await loadDashboardData({silent:true});
      showToast('Match score and players updated.');
    } catch(error) {
      showToast(error.message||'Unable to update match.');
      if(button?.isConnected){button.disabled=false;button.textContent='Save';}
    }
  }

  function closeMatchPlayerSuggestions(except=null) {
    $('matchList').querySelectorAll('[data-match-player-input]').forEach(input=>{
      if(input===except)return;
      input.setAttribute('aria-expanded','false');
      const list=input.closest('.match-player-autocomplete')?.querySelector('.match-player-suggestions');
      if(list)list.hidden=true;
    });
  }

  function renderMatchPlayerSuggestions(input) {
    const wrapper=input?.closest('.match-player-autocomplete');
    const suggestionList=wrapper?.querySelector('.match-player-suggestions');
    if(!input||!suggestionList)return;
    const query=normalizeName(input.value);
    const players=(Array.isArray(state.records.players)?state.records.players:[])
      .filter(player=>String(player?.cloudId||'').trim()&&cloudPlayerName(player))
      .filter(player=>{
        if(!query)return true;
        return normalizeName(cloudPlayerName(player)).includes(query)||normalizeName(player.nickname).includes(query);
      })
      .sort((a,b)=>cloudPlayerName(a).localeCompare(cloudPlayerName(b)));
    if(!players.length){
      suggestionList.innerHTML='<div class="match-player-suggestions-empty">No registered player found</div>';
    }else{
      suggestionList.innerHTML=players.map(player=>{
        const name=cloudPlayerName(player);
        const detail=player.nickname?`(${player.nickname})`:'';
        return `<button class="match-player-suggestion" type="button" role="option" data-match-player-select data-cloud-id="${escapeAttr(player.cloudId)}"><strong>${escapeHtml(name)}</strong>${detail?`<span>${escapeHtml(detail)}</span>`:''}</button>`;
      }).join('');
    }
    suggestionList.hidden=false;
    input.setAttribute('aria-expanded','true');
  }

  function selectMatchCloudPlayer(button) {
    const wrapper=button.closest('.match-player-autocomplete');
    const input=wrapper?.querySelector('[data-match-player-input]');
    const cloudId=String(button.dataset.cloudId||'');
    const player=(state.records.players||[]).find(item=>String(item?.cloudId||'')===cloudId);
    if(!input||!player)return;
    const name=cloudPlayerName(player);
    input.value=name;
    input.dataset.selectedCloudId=cloudId;
    input.dataset.selectedName=name;
    const list=wrapper.querySelector('.match-player-suggestions');
    if(list)list.hidden=true;
    input.setAttribute('aria-expanded','false');
    input.focus();
  }

  function openDeleteMatch(matchId,sessionId) {
    const found=findMatch(sessionId,matchId);
    const session=found?.session,log=found?.log;
    if(!session||!log){showToast('This match is no longer available.');return;}
    state.pendingDeleteMatch={sessionId:String(session.id),matchId:String(matchId)};
    const card=mountedMatchCard(session.id,matchId);
    if(card){
      const head=card.querySelector('.match-card-head');
      if(head&&!card.querySelector('.match-inline-delete-warning'))head.insertAdjacentHTML('afterend',matchDeleteWarningMarkup(matchId,session.id));
      const deleteButton=card.querySelector('[data-match-action="delete"]');
      if(deleteButton)deleteButton.disabled=true;
    }else renderMatches();
  }

  function closeDeleteMatch() {
    const target=state.pendingDeleteMatch;
    state.pendingDeleteMatch=null;
    const card=target?mountedMatchCard(target.sessionId,target.matchId):null;
    if(card){
      card.querySelector('.match-inline-delete-warning')?.remove();
      const deleteButton=card.querySelector('[data-match-action="delete"]');
      if(deleteButton)deleteButton.disabled=false;
    }else renderMatches();
  }

  async function confirmDeleteMatch(button) {
    const target=state.pendingDeleteMatch;if(!target)return;
    if(button){button.disabled=true;button.textContent='Deleting…';}
    try {
      await fetchJson(`/api/organizer-dashboard/sessions/${encodeURIComponent(target.sessionId)}/matches/${encodeURIComponent(target.matchId)}`,{method:'DELETE'});
      state.editingMatch=null;state.pendingDeleteMatch=null;await loadDashboardData({silent:true});showToast('Match record deleted.');
    } catch(error) { showToast(error.message||'Unable to delete match.'); }
    finally { if(button){button.disabled=false;button.textContent='Confirm';} }
  }

  const DUPR_EXPORT_COLUMNS=['matchType','event','date','playerA1','playerA1DuprId','playerA1ExternalId','playerA2','playerA2DuprId','playerA2ExternalId','playerB1','playerB1DuprId','playerB1ExternalId','playerB2','playerB2DuprId','playerB2ExternalId','teamAGame1','teamBGame1','teamAGame2','teamBGame2','teamAGame3','teamBGame3','teamAGame4','teamBGame4','teamAGame5','teamBGame5','scoreType','location'];
  function csvCell(value) { const text=String(value??'');return /[",\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text; }

  function downloadDuprCsv(rows,filename) {
    const csv=[DUPR_EXPORT_COLUMNS.join(','),...rows.map(row=>DUPR_EXPORT_COLUMNS.map(column=>csvCell(row[column])).join(','))].join('\r\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);const link=document.createElement('a');
    link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
  }

  function duprExportExclusions(entries) {
    // Keep warning groups mutually exclusive so a NON-DUPR match without a
    // score is not counted twice in the export warning.
    const nonDupr=entries.filter(({log,session})=>!isDuprMatch(log,session));
    const duprEntries=entries.filter(({log,session})=>isDuprMatch(log,session));
    const unscored=duprEntries.filter(({log})=>!hasRecordedMatchScore(log));
    const scoredButIncomplete=duprEntries.filter(({log,session})=>hasRecordedMatchScore(log)&&!duprCsvRowForMatch(log,session));
    return {nonDupr,unscored,scoredButIncomplete};
  }

  function duprExportWarningMessage(exclusions) {
    const lines=['Some matches are not allowed in a DUPR CSV export:'];
    if(exclusions.nonDupr.length)lines.push(`• ${exclusions.nonDupr.length} NON-DUPR match(es) — not eligible for DUPR export`);
    if(exclusions.unscored.length)lines.push(`• ${exclusions.unscored.length} match(es) without a recorded score — not eligible for DUPR export`);
    if(exclusions.scoredButIncomplete.length)lines.push(`• ${exclusions.scoredButIncomplete.length} scored DUPR match(es) missing valid player DUPR IDs or match details`);
    return lines.join('\n');
  }

  function exportMatchToDupr(matchId,sessionId) {
    if(state.editingMatch){showToast('Finish or cancel the open match edit before exporting.');return;}
    const found=findMatch(sessionId,matchId);
    if(!found?.log||!found?.session)return;
    const row=duprCsvRowForMatch(found.log,found.session);
    if(!row){
      const exclusions=duprExportExclusions([{log:found.log,session:found.session}]);
      window.alert(`${duprExportWarningMessage(exclusions)}\n\nThis match was not exported.`);
      return;
    }
    downloadDuprCsv([row],`dupr-match-${String(matchId).replace(/[^a-z0-9_-]/gi,'-')}.csv`);
    showToast('DUPR CSV downloaded. Import it in DUPR to complete syncing.');
  }

  const DUPR_SUBMITTED_STORAGE_KEY='pickle-point-dupr-submitted-v1';
  function loadDuprSubmittedMatchKeys() {
    try{
      const saved=JSON.parse(localStorage.getItem(DUPR_SUBMITTED_STORAGE_KEY)||'[]');
      state.duprSubmittedMatchKeys=new Set(Array.isArray(saved)?saved.map(String):[]);
    }catch(_){state.duprSubmittedMatchKeys=new Set();}
  }

  function duprModalMatchKey(entry,index=0) {
    const sessionId=String(entry?.session?.id||'');
    const log=entry?.log||{};
    const matchId=log.id??log.matchId??log.matchID??log.match_id;
    if(matchId!==undefined&&matchId!==null&&String(matchId).trim()!=='')return `${sessionId}:${String(matchId)}`;
    const players=[...matchTeamPlayers(log,'team1'),...matchTeamPlayers(log,'team2')].map(player=>normalizeName(player.name)).join('|');
    return `${sessionId}:${String(log.endedAt||log.startedAt||'')}:${String(log.score||'')}:${players}:${index}`;
  }

  function persistDuprSubmittedMatchKeys() {
    try{localStorage.setItem(DUPR_SUBMITTED_STORAGE_KEY,JSON.stringify(Array.from(state.duprSubmittedMatchKeys)));}
    catch(_){showToast('Submission status could not be saved in this browser.');}
  }

  function duprModalSessionEventName(session) {
    return String(session?.sessionName||'Open Play').replace(/^\((?:NON\s+)?DUPR\s+MATCH\)\s*/i,'').trim()||'Open Play';
  }

  function duprModalSessionLocation(session) {
    // Session setup stores this value as duprLocation. Keep the legacy aliases
    // for older archives that may have stored it as location or venue.
    return String(session?.duprLocation||session?.location||session?.venue||'').trim();
  }

  function duprModalEntries() {
    const entries=(Array.isArray(state.matchesVisible)?state.matchesVisible:[])
      .filter(entry=>isDuprMatch(entry.log,entry.session));
    return entries.map((entry,index)=>{
      const log=entry.log||{};
      const playersA=matchTeamPlayers(log,'team1');
      const playersB=matchTeamPlayers(log,'team2');
      const players=[...playersA,...playersB];
      const row=duprCsvRowForMatch(log,entry.session);
      const score=String(log.score||'').trim().match(/^(\d+)\s*-\s*(\d+)$/);
      const type=String(log.type||'Doubles').toLowerCase().includes('single')?'S':'D';
      const key=duprModalMatchKey(entry,index);
      return {entry,log,session:entry.session,playersA,playersB,players,score,type,row,key,submitted:state.duprSubmittedMatchKeys.has(key),missingPlayers:players.filter(player=>!player.duprId)};
    });
  }

  function duprModalFilteredEntries(entries) {
    switch(state.duprModalFilter){
      case 'not-submitted':return entries.filter(item=>!item.submitted);
      case 'already-submitted':return entries.filter(item=>item.submitted);
      case 'all-have-dupr':return entries.filter(item=>item.players.length>0&&item.players.every(player=>!!player.duprId));
      case 'missing-dupr':return entries.filter(item=>item.missingPlayers.length>0);
      default:return entries;
    }
  }

  function duprModalSetFilterCounts(entries) {
    const counts={
      all:entries.length,
      'not-submitted':entries.filter(item=>!item.submitted).length,
      'already-submitted':entries.filter(item=>item.submitted).length,
      'all-have-dupr':entries.filter(item=>item.players.length>0&&item.players.every(player=>!!player.duprId)).length,
      'missing-dupr':entries.filter(item=>item.missingPlayers.length>0).length
    };
    Object.entries(counts).forEach(([filter,count])=>{
      const node=$(`duprExportCount-${filter}`);
      if(node)node.textContent=String(count);
    });
  }

  function duprModalMissingPlayersMarkup(entries) {
    const unique=new Map();
    entries.forEach(item=>item.missingPlayers.forEach(player=>{
      const key=normalizeName(player.name)||`missing-${unique.size}`;
      if(!unique.has(key))unique.set(key,player.name||'Unnamed player');
    }));
    const names=Array.from(unique.values());
    $('duprMissingPlayersCount').textContent=String(names.length);
    $('duprMissingPlayersList').innerHTML=names.map(name=>`<span class="dupr-missing-player-chip">${escapeHtml(name)}</span>`).join('');
    $('duprMissingNotice').hidden=!names.length;
  }

  function duprModalPlayerCell(player) {
    if(!player)return '<td class="dupr-export-empty-cell">—</td><td class="dupr-export-id-cell">—</td>';
    const id=String(player.duprId||'').trim();
    return `<td class="dupr-export-player-cell" title="${escapeAttr(player.name)}">${escapeHtml(player.name||'—')}</td><td class="dupr-export-id-cell ${id?'is-present':'is-missing'}">${id?escapeHtml(id):'MISSING'}</td>`;
  }

  function duprModalRowMarkup(item,index) {
    const date=validDate(item.log.endedAt||item.log.startedAt||item.session?.endedAt||item.session?.startedAt);
    const scoreA=item.score?item.score[1]:'—';
    const scoreB=item.score?item.score[2]:'—';
    return `<tr class="${item.submitted?'is-submitted':''}"><td class="dupr-export-number-cell">${index+1}</td><td><span class="dupr-export-type ${item.type==='S'?'is-singles':''}">${item.type}</span></td><td class="dupr-export-date-cell">${date?escapeHtml(formatDate(date)):'—'}</td>${duprModalPlayerCell(item.playersA[0])}${item.type==='D'?duprModalPlayerCell(item.playersA[1]):'<td class="dupr-export-empty-cell">—</td><td class="dupr-export-id-cell">—</td>'}${duprModalPlayerCell(item.playersB[0])}${item.type==='D'?duprModalPlayerCell(item.playersB[1]):'<td class="dupr-export-empty-cell">—</td><td class="dupr-export-id-cell">—</td>'}<td class="dupr-export-score ${item.score&&Number(item.score[1])>Number(item.score[2])?'is-winning':''}">${escapeHtml(scoreA)}</td><td class="dupr-export-score ${item.score&&Number(item.score[2])>Number(item.score[1])?'is-winning':''}">${escapeHtml(scoreB)}</td></tr>`;
  }

  function renderDuprExportModal() {
    const modal=$('duprExportModal');
    if(!modal||modal.hidden)return;
    const entries=duprModalEntries();
    if(!entries.length){closeDuprExportModal();return;}
    const sessions=Array.from(new Map(entries.map(item=>[String(item.session?.id||''),item.session])).values());
    const sessionSignature=sessions.map(session=>String(session.id||'')).sort().join('|');
    if(state.duprModalSessionId!==sessionSignature){
      state.duprModalSessionId=sessionSignature;
      // For a single session, prefill its event and location. For a mixed
      // multi-session range, leave overrides blank so each row keeps its own
      // event/location from the source session.
      state.duprModalEventName=sessions.length===1?duprModalSessionEventName(sessions[0]):'';
      state.duprModalLocation=sessions.length===1?duprModalSessionLocation(sessions[0]):'';
      const firstScore=entries.map(item=>String(item.log?.scoreType||'').trim().toUpperCase()).find(Boolean)||'RALLY';
      state.duprModalScoreType=/SIDE.?OUT/.test(firstScore)?'SIDEOUT':'RALLY';
    }
    const filtered=duprModalFilteredEntries(entries);
    const readyCount=filtered.filter(item=>!!item.row).length;
    $('duprExportSubheading').textContent=readyCount?`${readyCount} matches ready. Download the CSV, then import that file in DUPR.`:'No eligible matches in this filter. Check scores and player DUPR IDs.';
    $('duprExportEventName').value=state.duprModalEventName;
    $('duprExportLocation').value=state.duprModalLocation;
    $('duprExportScoreType').value=state.duprModalScoreType;
    duprModalSetFilterCounts(entries);
    document.querySelectorAll('[data-dupr-export-filter]').forEach(button=>{
      const active=button.dataset.duprExportFilter===state.duprModalFilter;
      button.classList.toggle('is-active',active);
      button.setAttribute('aria-pressed',String(active));
    });
    duprModalMissingPlayersMarkup(entries);
    $('duprExportTableBody').innerHTML=filtered.map((item,index)=>duprModalRowMarkup(item,index)).join('');
    $('duprExportEmpty').hidden=filtered.length>0;
    $('duprExportTableWrap').hidden=!filtered.length;
    if(sessions.length===1){
      const session=sessions[0];
      const startTime=session.startedAt?matchTimeOnly(session.startedAt):'';
      const endTime=session.endedAt?matchTimeOnly(session.endedAt):'';
      const period=session.isLive?'LIVE':startTime&&endTime?`${startTime}–${endTime}`:formatDate(session.startedAt||session.endedAt);
      $('duprExportFooterCount').textContent=`${filtered.length} matches · ${String(session.sessionName||'DUPR MATCH').trim()} | ${period}`;
    }else{
      $('duprExportFooterCount').textContent=`${filtered.length} matches · ${sessions.length} sessions`;
    }
    $('duprExportDownloadButton').disabled=readyCount===0;
    const pendingReady=filtered.filter(item=>!!item.row&&!item.submitted).length;
    $('duprMarkSubmittedButton').disabled=pendingReady===0;
    $('duprMarkSubmittedButton').title=pendingReady?`Mark ${pendingReady} eligible match(es) as submitted after importing the CSV in DUPR`:'No unsubmitted eligible matches in this filter';
  }

  function openDuprExportModal() {
    if(state.editingMatch){showToast('Finish or cancel the open match edit before exporting.');return;}
    if(!Array.isArray(state.matchesVisible)||!state.matchesVisible.length){showToast('No matches in the selected date range.');return;}
    const entries=duprModalEntries();
    if(!entries.length){showToast('No DUPR MATCH sessions in the selected date range.');return;}
    // Force the modal to refresh its session-specific defaults for this range.
    state.duprModalSessionId='';
    state.duprModalFilter='all';
    showDashboardModal('duprExportModal');
    renderDuprExportModal();
    $('closeDuprExportModal')?.focus();
  }

  function closeDuprExportModal() {
    const modal=$('duprExportModal');
    if(!modal||modal.hidden)return;
    hideDashboardModal('duprExportModal');
    $('exportMatchesButton')?.focus();
  }

  async function refreshDuprExportIds(button) {
    if(button){button.disabled=true;button.classList.add('is-refreshing');}
    try{
      const refreshed=await loadDashboardData({silent:true});
      if(!refreshed)throw new Error('Unable to refresh player records. Check your connection.');
      renderDuprExportModal();
      showToast('Player DUPR IDs refreshed from Registered Player Cloud.');
    }catch(error){showToast(error.message||'Unable to refresh DUPR IDs.');}
    finally{if(button){button.disabled=false;button.classList.remove('is-refreshing');}}
  }

  function downloadDuprModalCsv() {
    const entries=duprModalFilteredEntries(duprModalEntries());
    const rows=entries.filter(item=>item.row).map(item=>({...item.row,
      event:state.duprModalEventName.trim()||item.row.event,
      location:state.duprModalLocation.trim()||duprModalSessionLocation(item.session),
      scoreType:state.duprModalScoreType==='SIDEOUT'?'Sideout':'Rally'
    }));
    if(!rows.length){showToast('No eligible DUPR matches in this filter.');return;}
    const club=String(state.auth?.displayName||state.auth?.username||'club').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'club';
    downloadDuprCsv(rows,`${club}-dupr-matches-${rows.length}.csv`);
    showToast(`${rows.length} DUPR-ready match${rows.length===1?'':'es'} downloaded. Import the CSV in DUPR, then mark them as submitted here.`);
  }

  function markDuprModalMatchesSubmitted() {
    const entries=duprModalFilteredEntries(duprModalEntries());
    const pending=entries.filter(item=>item.row&&!item.submitted);
    if(!pending.length){showToast('No unsubmitted eligible matches in this filter.');return;}
    pending.forEach(item=>state.duprSubmittedMatchKeys.add(item.key));
    persistDuprSubmittedMatchKeys();
    renderDuprExportModal();
    showToast(`${pending.length} match${pending.length===1?'':'es'} marked as submitted in this browser.`);
  }

  function settingsDuprValue() {
    // Build the value from the six visible character inputs at the moment Save
    // is pressed. Never rely on a possibly stale hidden input value.
    const value=Array.from({length:6},(_,index)=>{
      const slot=$(`settingsDuprSlot${index+1}`);
      const normalized=String(slot?.value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
      const character=normalized.slice(0,1);
      if(slot&&slot.value!==character)slot.value=character;
      return character;
    }).join('').slice(0,6);
    const hiddenInput=$('settingsOrganizerDuprId');
    if(hiddenInput){
      hiddenInput.value=value;
      // Keep form integrations and browser autofill observers in sync too.
      hiddenInput.dispatchEvent(new Event('input',{bubbles:true}));
      hiddenInput.dispatchEvent(new Event('change',{bubbles:true}));
    }
    return value;
  }

  function syncSettingsDuprSlotsToInput() {
    return settingsDuprValue();
  }

  function setSettingsDuprValue(value) {
    const normalized=String(value||'').replace(/^DUPR\s*:\s*/i,'').replace(/\s+/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
    for(let index=0;index<6;index++)$(`settingsDuprSlot${index+1}`).value=normalized[index]||'';
    syncSettingsDuprSlotsToInput();
  }

  async function openSettings() {
    try {
      const response=await fetchJson('/api/organizer-settings');
      const organizer=response.organizer||{};state.auth=organizer;state.settingsLogoDraft=undefined;
      state.settingsLogoProcessing=false;state.settingsLogoProcessingToken++;
      $('settingsClubName').value=String(organizer.displayName||organizer.username||'');
      $('settingsUsername').value=String(organizer.username||'');
      setSettingsDuprValue(organizer.duprId||'');
      $('settingsLogoPreview').src=organizer.logo||'pickleball-p-emblem.png';
      $('settingsLogoInput').value='';$('settingsCurrentPassword').value='';$('settingsNewPassword').value='';$('settingsConfirmPassword').value='';
      $('saveSettingsButton').disabled=false;
      setSettingsMessage('');$('settingsShowPasswords').textContent='Show passwords';$('settingsShowPasswords').setAttribute('aria-pressed','false');
      document.querySelectorAll('.settings-password-input').forEach(input=>input.type='password');
      showDashboardModal('settingsModal');
    } catch(error) { showToast(error.message||'Unable to load club settings.'); }
  }

  function closeSettings() {
    state.settingsLogoProcessingToken++;state.settingsLogoProcessing=false;
    $('saveSettingsButton').disabled=false;
    hideDashboardModal('settingsModal');state.settingsLogoDraft=undefined;
  }

  function setSettingsMessage(message,isError=false) {
    const el=$('settingsFormMessage');
    const text=String(message||'');
    el.textContent=text;
    el.classList.toggle('is-visible',!!text);
    el.classList.toggle('is-error',!!isError&&!!text);
  }

  function fileAsDataUrl(file) {
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result||''));
      reader.onerror=()=>reject(new Error('Unable to read the selected logo.'));
      reader.readAsDataURL(file);
    });
  }

  async function automaticallyRemoveLogoBackground(file) {
    const bitmap=await createImageBitmap(file);
    const maxSide=640;
    const scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));
    const width=Math.max(1,Math.round(bitmap.width*scale));
    const height=Math.max(1,Math.round(bitmap.height*scale));
    const canvas=document.createElement('canvas');
    canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d',{willReadFrequently:true});
    if(!context){bitmap.close?.();throw new Error('Your browser could not process this logo.');}
    context.drawImage(bitmap,0,0,width,height);bitmap.close?.();
    const image=context.getImageData(0,0,width,height);
    const pixels=image.data;const pixelCount=width*height;
    const edgeSamples=[];
    const stride=Math.max(1,Math.floor(Math.min(width,height)/350));
    for(let x=0;x<width;x+=stride){edgeSamples.push(x,x+(height-1)*width);}
    for(let y=0;y<height;y+=stride){edgeSamples.push(y*width,y*width+width-1);}
    let transparentEdges=0;
    const buckets=new Map();
    for(const index of edgeSamples){
      const offset=index*4;
      const alpha=pixels[offset+3];
      if(alpha<24){transparentEdges++;continue;}
      const r=pixels[offset],g=pixels[offset+1],b=pixels[offset+2];
      const key=((r>>5)<<6)|((g>>5)<<3)|(b>>5);
      let entry=buckets.get(key);
      if(!entry){entry={count:0,r:0,g:0,b:0};buckets.set(key,entry);}
      entry.count++;entry.r+=r;entry.g+=g;entry.b+=b;
    }
    const outputType='image/webp';
    if(transparentEdges>edgeSamples.length*.3){
      const ready=canvas.toDataURL(outputType,.93);
      return {dataUrl:ready,removed:false,alreadyTransparent:true};
    }
    let dominant=null;
    for(const entry of buckets.values())if(!dominant||entry.count>dominant.count)dominant=entry;
    const validEdgeCount=Math.max(1,edgeSamples.length-transparentEdges);
    if(!dominant||dominant.count/validEdgeCount<.13){
      return {dataUrl:await fileAsDataUrl(file),removed:false,undetected:true};
    }
    const background={r:dominant.r/dominant.count,g:dominant.g/dominant.count,b:dominant.b/dominant.count};
    let spread=0;
    for(const index of edgeSamples){
      const offset=index*4;if(pixels[offset+3]<24)continue;
      const d=Math.hypot(pixels[offset]-background.r,pixels[offset+1]-background.g,pixels[offset+2]-background.b);
      if(d<=55)spread+=d;
    }
    const averageSpread=spread/Math.max(1,dominant.count);
    const tolerance=Math.max(38,Math.min(72,38+averageSpread*1.25));
    const visited=new Uint8Array(pixelCount);
    const queue=new Int32Array(pixelCount);
    let head=0,tail=0;
    const visit=(index)=>{
      if(index<0||index>=pixelCount||visited[index])return;
      visited[index]=1;
      const offset=index*4;
      if(pixels[offset+3]<12){queue[tail++]=index;return;}
      const distance=Math.hypot(pixels[offset]-background.r,pixels[offset+1]-background.g,pixels[offset+2]-background.b);
      if(distance<=tolerance)queue[tail++]=index;
    };
    for(let x=0;x<width;x++){visit(x);visit((height-1)*width+x);}
    for(let y=0;y<height;y++){visit(y*width);visit(y*width+width-1);}
    while(head<tail){
      const index=queue[head++];
      const x=index%width;
      if(x>0)visit(index-1);
      if(x<width-1)visit(index+1);
      if(index>=width)visit(index-width);
      if(index<pixelCount-width)visit(index+width);
    }
    const removedRatio=tail/pixelCount;
    if(removedRatio<.008){
      return {dataUrl:await fileAsDataUrl(file),removed:false,undetected:true};
    }
    for(let i=0;i<pixelCount;i++){
      if(!visited[i])continue;
      const offset=i*4;
      if(pixels[offset+3]<12){pixels[offset+3]=0;continue;}
      const distance=Math.hypot(pixels[offset]-background.r,pixels[offset+1]-background.g,pixels[offset+2]-background.b);
      const t=Math.max(0,Math.min(1,(distance-tolerance*.32)/(tolerance*.68)));
      const feather=t*t*(3-2*t);
      pixels[offset+3]=Math.round(pixels[offset+3]*feather);
    }
    context.putImageData(image,0,0);
    let dataUrl=canvas.toDataURL(outputType,.93);
    if(!dataUrl.startsWith('data:image/webp'))dataUrl=canvas.toDataURL('image/png');
    return {dataUrl,removed:true,removedRatio};
  }

  async function saveSettings(event) {
    event.preventDefault();
    if(state.settingsLogoProcessing){setSettingsMessage('Please wait for the logo background removal to finish.');return;}
    const displayName=String($('settingsClubName').value||'').normalize('NFC').trim().replace(/\s+/g,' ');
    const currentPassword=String($('settingsCurrentPassword').value||'');
    const newPassword=String($('settingsNewPassword').value||'');
    const confirmPassword=String($('settingsConfirmPassword').value||'');
    if(!displayName){setSettingsMessage('Club or organizer name is required.',true);$('settingsClubName').focus();return;}
    const duprId=syncSettingsDuprSlotsToInput();
    if(!/^[A-Z0-9]{6}$/.test(duprId)){
      setSettingsMessage('Enter all 6 characters of your organizer DUPR ID.',true);
      const firstEmpty=Array.from({length:6},(_,index)=>$(`settingsDuprSlot${index+1}`)).find(slot=>!String(slot?.value||'').trim());
      (firstEmpty||$('settingsDuprSlot1'))?.focus();
      return;
    }
    if(newPassword||confirmPassword){
      if(newPassword.length<8){setSettingsMessage('New password must be at least 8 characters.',true);$('settingsNewPassword').focus();return;}
      if(newPassword!==confirmPassword){setSettingsMessage('New password and confirmation do not match.',true);$('settingsConfirmPassword').focus();return;}
      if(!currentPassword){setSettingsMessage('Enter your current password to set a new password.',true);$('settingsCurrentPassword').focus();return;}
    }
    const payload={displayName,duprId,showOnLeaderboard:state.auth?.showOnLeaderboard!==false};
    if(state.settingsLogoDraft!==undefined)payload.profileImage=state.settingsLogoDraft||null;
    if(newPassword){payload.currentPassword=currentPassword;payload.newPassword=newPassword;}
    const button=$('saveSettingsButton');button.disabled=true;button.textContent='Saving…';setSettingsMessage('');
    try {
      const response=await fetchJson('/api/organizer-settings',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      state.auth=response.organizer||state.auth;
      updateDashboardBrand(state.auth);
      closeSettings();await loadDashboardData({silent:true});showToast('Club settings saved successfully.');
    } catch(error) { setSettingsMessage(error.message||'Unable to save settings.',true); }
    finally { button.disabled=false;button.textContent='Save settings'; }
  }

  $('attendanceTab').addEventListener('click',()=>setTab('attendance'));
  $('matchesTab').addEventListener('click',()=>setTab('matches'));
  $('sessionsTab').addEventListener('click',()=>setTab('sessions'));
  $('sessionSelect').addEventListener('change',event=>{
    applySessionSelection(event.currentTarget.value);
  });
  $('sessionSelectSearch').addEventListener('focus',()=>{
    if(!sessionDropdownOpen)openSessionPicker();
  });
  $('sessionSelectSearch').addEventListener('input',event=>{
    if(!sessionDropdownOpen)openSessionPicker({clearSearch:false});
    renderSessionPickerOptions(event.currentTarget.value);
  });
  $('sessionSelectSearch').addEventListener('keydown',event=>{
    if(event.key==='Escape'&&sessionDropdownOpen){event.preventDefault();closeSessionPicker();return;}
    if(event.key==='ArrowDown'){
      event.preventDefault();
      if(!sessionDropdownOpen)openSessionPicker();
      $('sessionSelectOptions').querySelector('[data-session-option]')?.focus();
    }
    if(event.key==='Enter'&&sessionDropdownOpen){
      const first=$('sessionSelectOptions').querySelector('[data-session-option]');
      if(first){event.preventDefault();chooseSessionFromPicker(first.dataset.sessionId);}
    }
  });
  $('sessionSelectClear').addEventListener('click',()=>{
    if(!sessionDropdownOpen)openSessionPicker();
    $('sessionSelectSearch').value='';
    renderSessionPickerOptions('');
    $('sessionSelectSearch').focus();
  });
  $('sessionSelectToggle').addEventListener('click',()=>{
    if(sessionDropdownOpen){closeSessionPicker();return;}
    openSessionPicker();
    $('sessionSelectSearch').focus();
  });
  $('sessionSelectOptions').addEventListener('pointerdown',event=>{
    if(event.target.closest('[data-session-option]'))event.preventDefault();
  });
  $('sessionSelectOptions').addEventListener('click',event=>{
    const option=event.target.closest('[data-session-option]');
    if(option)chooseSessionFromPicker(option.dataset.sessionId);
  });
  $('sessionSelectOptions').addEventListener('keydown',event=>{
    const current=event.target.closest('[data-session-option]');
    if(!current)return;
    if(event.key==='ArrowDown'){
      event.preventDefault();
      (current.nextElementSibling?.matches('[data-session-option]')?current.nextElementSibling:$('sessionSelectOptions').querySelector('[data-session-option]'))?.focus();
    }else if(event.key==='ArrowUp'){
      event.preventDefault();
      (current.previousElementSibling?.matches('[data-session-option]')?current.previousElementSibling:$('sessionSelectSearch'))?.focus();
    }else if(event.key==='Escape'){
      event.preventDefault();closeSessionPicker();$('sessionSelectSearch').focus();
    }else if(event.key==='Enter'){
      event.preventDefault();chooseSessionFromPicker(current.dataset.sessionId);
    }
  });
  document.addEventListener('pointerdown',event=>{
    if(!event.target.closest('#sessionSelectShell')&&sessionDropdownOpen)closeSessionPicker();
  });
  $('attendanceSearch').addEventListener('input',renderAttendance);
  $('matchesSearch').addEventListener('input',renderMatches);
  $('matchesFromDate').addEventListener('change',()=>setManualMatchDateFilter('from'));
  $('matchesToDate').addEventListener('change',()=>setManualMatchDateFilter('to'));
  // Delegate from the toolbar so the preset controls continue working even if
  // the toolbar's inner markup is refreshed by a future dashboard update.
  $('matchFilterToolbar').addEventListener('click',event=>{
    const button=event.target.closest('[data-match-range]');
    if(!button||!event.currentTarget.contains(button))return;
    event.preventDefault();
    event.stopPropagation();
    setMatchDateRange(button.dataset.matchRange);
  });
  $('refreshMatchesButton').addEventListener('click',async()=>{const button=$('refreshMatchesButton');button.disabled=true;button.classList.add('is-refreshing');try{const refreshed=await loadDashboardData({silent:true});if(refreshed)showToast('Match history refreshed.');else showToast('Unable to refresh match history. Check your connection.');}finally{button.disabled=false;button.classList.remove('is-refreshing');}});
  $('exportMatchesButton').addEventListener('click',openDuprExportModal);
  $('closeDuprExportModal').addEventListener('click',closeDuprExportModal);
  $('refreshDuprIdsButton').addEventListener('click',event=>refreshDuprExportIds(event.currentTarget));
  $('duprExportDownloadButton').addEventListener('click',downloadDuprModalCsv);
  $('duprMarkSubmittedButton').addEventListener('click',markDuprModalMatchesSubmitted);
  $('duprExportFilters').addEventListener('click',event=>{
    const button=event.target.closest('[data-dupr-export-filter]');
    if(!button)return;
    state.duprModalFilter=button.dataset.duprExportFilter||'all';
    renderDuprExportModal();
  });
  $('duprExportEventName').addEventListener('input',event=>{state.duprModalEventName=event.currentTarget.value;});
  $('duprExportLocation').addEventListener('input',event=>{state.duprModalLocation=event.currentTarget.value;});
  $('duprExportScoreType').addEventListener('change',event=>{state.duprModalScoreType=event.currentTarget.value;});
  $('sessionsSearch').addEventListener('input',renderSessions);
  $('sessionManagementList').addEventListener('click',event=>{
    const button=event.target.closest('[data-session-action]');
    if(!button||button.disabled)return;
    const id=button.dataset.sessionId;
    if(button.dataset.sessionAction==='cancel-delete'){closeDeleteSession();return;}
    if(button.dataset.sessionAction==='confirm-delete'){confirmDeleteSession(button);return;}
    if(button.dataset.sessionAction==='edit')openEditSession(id);
    if(button.dataset.sessionAction==='delete')openDeleteSession(id);
  });
  $('participantList').addEventListener('click',event=>{
    const button=event.target.closest('[data-participant-action]');if(!button||button.disabled)return;
    const action=button.dataset.participantAction;
    if(action==='cancel-edit'){closeEditParticipant();return;}
    if(action==='cancel-delete'){closeDeleteParticipant();return;}
    if(action==='confirm-delete'){confirmDeleteParticipant(button);return;}
    const index=Number(button.dataset.participantIndex);if(!Number.isInteger(index)||index<0)return;
    if(action==='edit')openEditParticipant(index);
    if(action==='delete')openDeleteParticipant(index);
  });
  $('participantList').addEventListener('change',event=>{
    if(event.target.matches('[data-cloud-player-name]'))applyCloudPlayerSuggestion(event.target.closest('[data-participant-edit-form]'));
  });
  $('participantList').addEventListener('submit',saveParticipantEdit);

  $('matchList').addEventListener('input',event=>{
    const scoreInput=event.target.closest('[data-match-score-input]');
    if(scoreInput){
      const cleaned=String(scoreInput.value||'').replace(/\D/g,'').slice(0,2);
      if(scoreInput.value!==cleaned)scoreInput.value=cleaned;
      return;
    }
    const input=event.target.closest('[data-match-player-input]');
    if(!input)return;
    const selectedName=normalizeName(input.dataset.selectedName||'');
    if(!selectedName||normalizeName(input.value)!==selectedName){
      delete input.dataset.selectedCloudId;
      delete input.dataset.selectedName;
      const original=normalizeName(input.dataset.originalName||'');
      if(normalizeName(input.value)===original){
        const originalPlayer=(state.records.players||[]).find(player=>normalizeName(cloudPlayerName(player))===original&&String(player?.cloudId||'').trim());
        if(originalPlayer){input.dataset.selectedCloudId=String(originalPlayer.cloudId);input.dataset.selectedName=cloudPlayerName(originalPlayer);}
      }
    }
    closeMatchPlayerSuggestions(input);
    renderMatchPlayerSuggestions(input);
  });
  $('matchList').addEventListener('focusin',event=>{
    const input=event.target.closest('[data-match-player-input]');
    if(input)renderMatchPlayerSuggestions(input);
  });
  $('matchList').addEventListener('pointerdown',event=>{
    const suggestion=event.target.closest('[data-match-player-select]');
    if(suggestion){event.preventDefault();selectMatchCloudPlayer(suggestion);}
  });
  $('matchList').addEventListener('click',event=>{
    const suggestion=event.target.closest('[data-match-player-select]');
    if(suggestion){
      const input=suggestion.closest('.match-player-autocomplete')?.querySelector('[data-match-player-input]');
      if(input?.dataset.selectedCloudId!==String(suggestion.dataset.cloudId||''))selectMatchCloudPlayer(suggestion);
      return;
    }
    const button=event.target.closest('[data-match-action]');if(!button||button.disabled)return;
    const id=button.dataset.matchId;const sessionId=button.dataset.sessionId;
    if(button.dataset.matchAction==='cancel-delete'){closeDeleteMatch();return;}
    if(button.dataset.matchAction==='confirm-delete'){confirmDeleteMatch(button);return;}
    if(button.dataset.matchAction==='edit')openEditMatch(id,sessionId);
    if(button.dataset.matchAction==='cancel-edit'){closeEditMatch();return;}
    if(button.dataset.matchAction==='delete')openDeleteMatch(id,sessionId);
    if(button.dataset.matchAction==='export'&&!state.editingMatch)exportMatchToDupr(id,sessionId);
  });
  $('matchList').addEventListener('submit',saveMatchEdit);
  document.addEventListener('click',event=>{if(!event.target.closest('.match-player-autocomplete'))closeMatchPlayerSuggestions();});
  $('openSettingsButton').addEventListener('click',openSettings);
  $('cancelSettingsButton').addEventListener('click',closeSettings);
  $('settingsForm').addEventListener('submit',saveSettings);
  // Do not close settings when the backdrop is clicked; use Cancel or Escape.
  const settingsDuprSlots=Array.from({length:6},(_,index)=>$(`settingsDuprSlot${index+1}`));
  function fillSettingsDuprSlots(value,focusIndex=null) {
    const normalized=String(value||'').replace(/^DUPR\s*:\s*/i,'').replace(/\s+/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
    settingsDuprSlots.forEach((slot,index)=>{slot.value=normalized[index]||'';});
    syncSettingsDuprSlotsToInput();
    if(Number.isInteger(focusIndex)&&settingsDuprSlots.length)settingsDuprSlots[Math.max(0,Math.min(focusIndex,settingsDuprSlots.length-1))]?.focus();
  }
  settingsDuprSlots.forEach((slot,index)=>{
    slot.addEventListener('input',()=>{
      const raw=String(slot.value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
      if(raw.length>1){fillSettingsDuprSlots(raw,Math.min(raw.length,settingsDuprSlots.length-1));return;}
      slot.value=raw.slice(0,1);
      syncSettingsDuprSlotsToInput();
      if(slot.value&&index<settingsDuprSlots.length-1)settingsDuprSlots[index+1].focus();
    });
    // Some mobile keyboards and autofill flows dispatch change/blur without a
    // final input event. Sync these too so the saved ID always matches the UI.
    slot.addEventListener('change',syncSettingsDuprSlotsToInput);
    slot.addEventListener('blur',syncSettingsDuprSlotsToInput);
    slot.addEventListener('paste',event=>{
      const pasted=String(event.clipboardData?.getData('text')||'').replace(/^DUPR\s*:\s*/i,'').replace(/\s+/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
      if(!pasted)return;
      event.preventDefault();
      fillSettingsDuprSlots(pasted,Math.min(pasted.length,settingsDuprSlots.length-1));
    });
    slot.addEventListener('keydown',event=>{
      if(event.key==='Backspace'&&!slot.value&&index>0){event.preventDefault();settingsDuprSlots[index-1].value='';settingsDuprSlots[index-1].focus();syncSettingsDuprSlotsToInput();}
      else if(event.key==='ArrowLeft'&&index>0){event.preventDefault();settingsDuprSlots[index-1].focus();}
      else if(event.key==='ArrowRight'&&index<settingsDuprSlots.length-1){event.preventDefault();settingsDuprSlots[index+1].focus();}
    });
  });
  $('settingsLogoInput').addEventListener('change',async event=>{
    const file=event.target.files?.[0];if(!file)return;
    const processToken=++state.settingsLogoProcessingToken;
    if(!/^image\/(png|jpeg|webp)$/i.test(file.type)||file.size>2*1024*1024){state.settingsLogoProcessing=false;$('saveSettingsButton').disabled=false;setSettingsMessage('Choose a PNG, JPG, or WebP image up to 2 MB.',true);event.target.value='';return;}
    state.settingsLogoProcessing=true;$('saveSettingsButton').disabled=true;
    setSettingsMessage('Removing the logo background automatically…');
    try{
      const result=await automaticallyRemoveLogoBackground(file);
      if(processToken!==state.settingsLogoProcessingToken)return;
      state.settingsLogoDraft=result.dataUrl;
      $('settingsLogoPreview').src=result.dataUrl;
      if(result.removed)setSettingsMessage('Background removed automatically. Review the preview, then save your settings.');
      else if(result.alreadyTransparent)setSettingsMessage('This logo already has a transparent background.');
      else setSettingsMessage('A plain background could not be detected, so the original logo was kept.');
    }catch(error){
      if(processToken!==state.settingsLogoProcessingToken)return;
      setSettingsMessage(error.message||'Unable to process this logo. The existing logo was kept.',true);
      event.target.value='';
    }finally{
      if(processToken===state.settingsLogoProcessingToken){state.settingsLogoProcessing=false;$('saveSettingsButton').disabled=false;}
    }
  });
  $('removeSettingsLogoButton').addEventListener('click',()=>{state.settingsLogoProcessingToken++;state.settingsLogoProcessing=false;$('saveSettingsButton').disabled=false;state.settingsLogoDraft='';$('settingsLogoPreview').src='pickleball-p-emblem.png';$('settingsLogoInput').value='';setSettingsMessage('The default logo will be used after saving.');});
  $('settingsShowPasswords').addEventListener('click',()=>{
    const show=$('settingsShowPasswords').getAttribute('aria-pressed')!=='true';
    document.querySelectorAll('.settings-password-input').forEach(input=>input.type=show?'text':'password');
    $('settingsShowPasswords').setAttribute('aria-pressed',String(show));$('settingsShowPasswords').textContent=show?'Hide passwords':'Show passwords';
  });

  $('sessionEditDateTrigger').addEventListener('click',()=>{
    const calendar=$('sessionEditCalendar');
    calendar.hidden=!calendar.hidden;
    $('sessionEditDateTrigger').setAttribute('aria-expanded',String(!calendar.hidden));
    if(!calendar.hidden)renderSessionEditCalendar();
  });
  $('sessionEditPrevMonth').addEventListener('click',()=>{
    sessionEditCalendarCursor=new Date(sessionEditCalendarCursor.getFullYear(),sessionEditCalendarCursor.getMonth()-1,1);
    renderSessionEditCalendar();
  });
  $('sessionEditNextMonth').addEventListener('click',()=>{
    sessionEditCalendarCursor=new Date(sessionEditCalendarCursor.getFullYear(),sessionEditCalendarCursor.getMonth()+1,1);
    renderSessionEditCalendar();
  });
  $('sessionEditCalendarGrid').addEventListener('click',event=>{
    const day=event.target.closest('[data-session-date]');
    if(day)chooseSessionEditDate(day.dataset.sessionDate);
  });
  $('sessionEditRemoveButton').addEventListener('click',()=>{
    // Remove clears the optional session date without changing the original session times.
    sessionEditSelectedDate='';
    $('sessionEditEndedAt').value='';
    $('sessionEditDateLabel').textContent='Select a day';
    updateSessionEditStartPreview();
    renderSessionEditCalendar();
  });
  $('sessionEditDoneButton').addEventListener('click',closeSessionEditCalendar);
  document.addEventListener('pointerdown',event=>{
    const picker=$('sessionEditDatePicker');
    if(!picker)return;
    const path=typeof event.composedPath==='function'?event.composedPath():[];
    const clickedInside=path.length?path.includes(picker):picker.contains(event.target);
    if(!clickedInside)closeSessionEditCalendar();
  },true);

  $('sessionEditForm').addEventListener('submit',saveSessionEdit);
  $('cancelSessionEditButton').addEventListener('click',closeEditSession);
  // Close dashboard/settings dialogs only when the backdrop itself is clicked.
  // Clicks inside the dialog content must never dismiss the modal.
  document.querySelectorAll('.dashboard-modal-backdrop, .settings-modal-backdrop').forEach(backdrop=>{
    backdrop.addEventListener('click',event=>{
      if(event.target!==backdrop)return;
      if(backdrop.id==='sessionEditModal')closeEditSession();
      else if(backdrop.id==='settingsModal')closeSettings();
      else if(backdrop.id==='duprExportModal')closeDuprExportModal();
    });
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){
      if(!$('sessionEditModal').hidden&&!$('sessionEditCalendar').hidden){closeSessionEditCalendar();return;}
      if(!$('sessionEditModal').hidden)closeEditSession();
      if(state.editingParticipant)closeEditParticipant();
      if(state.pendingDeleteParticipant)closeDeleteParticipant();
      if(state.pendingDeleteMatch)closeDeleteMatch();
      if(state.pendingDeleteSessionId)closeDeleteSession();
      if(state.editingMatch)closeEditMatch();
      if(!$('settingsModal').hidden)closeSettings();
      if(!$('duprExportModal').hidden)closeDuprExportModal();
    }
  });
  $('logoutButton').addEventListener('click',async()=>{
    // Use the browser's native confirmation dialog; no custom logout modal.
    const confirmed=window.confirm('Are you sure you want to log out?');
    if(!confirmed)return;
    $('logoutButton').disabled=true;
    try{await fetch('/api/logout',{method:'POST',credentials:'same-origin',cache:'no-store'});}catch(_){/* Local navigation still ends the visible session. */}
    window.location.replace('/index.html');
  });

  loadDuprSubmittedMatchKeys();
  initializeDefaultMatchDateRange();
  loadDashboardData().then(initLiveStateStream);
  state.refreshTimer=setInterval(()=>{
    if(document.visibilityState!=='hidden')loadDashboardData({silent:true});
  },8000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')loadDashboardData({silent:true});});
})();
