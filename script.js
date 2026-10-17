const state={
  players:[],
  left:[],
  queue:[],
  lockedPartners:[],
  courts:[],
  logs:[],
  nextPlayer:1,
  nextCourt:1,
  nextWaitingCourt:1,
  nextLog:1,
  selectedCourt:null,
  pendingLeftDelete:null,
  pendingRemoveCourt:null,
  eventRules:{target:11,winBy:1,type:'Doubles'},
  sessionMetrics:{cloudCheckins:0,newRegistered:0},
  sessionActive:false,
  sessionName:'Open Play — Oct 6, 2026',
  duprMatch:false,
  recordScores:false
};

const STORAGE_KEY='pickleq_v11_state';
const LIVE_VIEW_STORAGE_KEY='picklepoint_live_view_state_v1';
const LIVE_VIEW_THEME_STORAGE_KEY='picklepoint_live_view_theme_v1';
let liveViewBroadcastChannel=null;
let liveViewPublishInFlight=false;
let liveViewPendingSnapshot=null;
let liveViewPublishRetryTimer=null;
let liveViewPublishRetryDelay=3000;
let liveViewPendingKeepalive=false;
try{if('BroadcastChannel' in window)liveViewBroadcastChannel=new BroadcastChannel('pickle-point-match-live-view');}catch(e){}
const LEGACY_STORAGE_KEYS=['pickleq_v10_state','pickleq_v9_state','pickleq_v8_state','pickleq_v7_state','pickleq_v6_state'];
const CLOUD_RECORDS_KEY='pickleq_registered_cloud_records_v1';
let cloudRecords={players:[],logs:[],sessions:[]};let pendingCloudDeleteId=null;let pendingCloudMatchDeleteId=null;let pendingCloudMatchPlayerId=null;let pendingCloudMatchEditId=null;let pendingCloudMatchEditPlayerId=null;
function loadCloudRecords(){try{const d=JSON.parse(localStorage.getItem(CLOUD_RECORDS_KEY)||'null');if(d)cloudRecords={players:d.players||[],logs:d.logs||[],sessions:d.sessions||[]};}catch(e){}}
function saveCloudRecords(){try{localStorage.setItem(CLOUD_RECORDS_KEY,JSON.stringify(cloudRecords));}catch(e){}}
function upsertCloudPlayer(p){if(!p||!p.name)return;loadCloudRecords();let a=cloudRecords.players.find(x=>x.name.toLowerCase()===p.name.toLowerCase());if(!a){a={cloudId:Date.now()+Math.floor(Math.random()*100000),name:p.name,matches:0,wins:0,losses:0};cloudRecords.players.push(a);}Object.assign(a,{name:p.name,nickname:p.nickname||a.nickname||'',gender:p.gender||a.gender||'',category:p.category||a.category||'',opgId:p.opgId||a.opgId||''});saveCloudRecords();}
function archiveLiveSession(){
  loadCloudRecords();
  state.players.concat(state.left).forEach(upsertCloudPlayer);
  loadCloudRecords();
  const sid='session-'+Date.now();
  const getName=id=>(state.players.find(p=>p.id===id)||state.left.find(p=>p.id===id)||{}).name;
  const normalizeName=value=>String(value||'').trim().toLowerCase();
  const logs=state.logs.map(l=>{
    const team1Names=Array.isArray(l.team1Names)&&l.team1Names.length?l.team1Names:(l.team1Ids||[]).map(getName).filter(Boolean);
    const team2Names=Array.isArray(l.team2Names)&&l.team2Names.length?l.team2Names:(l.team2Ids||[]).map(getName).filter(Boolean);
    const winners=String(l.winner||'').split(' & ').map(normalizeName).filter(Boolean);
    const losers=String(l.loser||'').split(' & ').map(normalizeName).filter(Boolean);
    const sc=String(l.score||'').split('-').map(Number);
    const scoreWinner=sc.length===2&&Number.isFinite(sc[0])&&Number.isFinite(sc[1])&&sc[0]!==sc[1]?(sc[0]>sc[1]?1:2):null;
    [...team1Names.map(name=>({name,team:1})),...team2Names.map(name=>({name,team:2}))].forEach(v=>{
      const a=cloudRecords.players.find(p=>normalizeName(p.name)===normalizeName(v.name));
      if(!a)return;
      a.matches=(a.matches||0)+1;
      const isWinner=winners.includes(normalizeName(v.name));
      const isLoser=losers.includes(normalizeName(v.name));
      const won=isWinner&&!isLoser ? true : isLoser&&!isWinner ? false : scoreWinner!==null ? scoreWinner===v.team : null;
      if(won===true)a.wins=(a.wins||0)+1;
      else if(won===false)a.losses=(a.losses||0)+1;
    });
    return {...l,sessionId:sid,team1Names,team2Names,endedAt:l.endedAt||new Date().toISOString(),sessionName:l.sessionName||state.sessionName||''};
  });
  cloudRecords.logs.push(...logs);
  cloudRecords.sessions.push({id:sid,endedAt:new Date().toISOString(),playerCount:state.players.length+state.left.length,matchCount:logs.length,sessionName:state.sessionName||''});
  saveCloudRecords();
}
function renderCloudRecords(){const previouslyOpenCloudLogs=new Set([...document.querySelectorAll('#cloudRecordsContent .cloud-match-details[open]')].map(d=>Number(d.dataset.cloudPlayerId)));ensureCloudMatchIds();loadCloudRecords();enforceSingleCloudMatchLogOpen();const count=$('cloudRecordsCount');if(count)count.textContent=`(${cloudRecords.players.length})`;const q=($('cloudRecordsSearch').value||'').trim().toLowerCase();const players=cloudRecords.players.filter(p=>[p.name,p.nickname,p.gender,p.category,p.opgId].join(' ').toLowerCase().includes(q));const sessionNames={};cloudRecords.sessions.forEach(s=>{if(s&&s.id)sessionNames[s.id]=s.sessionName||'';});$('cloudRecordsSummary').innerHTML=`<span>👤 <b>${cloudRecords.players.length}</b> registered</span><span>🏓 <b>${cloudRecords.logs.length}</b> match record${cloudRecords.logs.length===1?'':'s'}</span><span>☁ <b>${cloudRecords.sessions.length}</b> archived session${cloudRecords.sessions.length===1?'':'s'}</span>`;$('cloudRecordsContent').innerHTML=players.map((p,index)=>{const logs=cloudRecords.logs.filter(l=>{if((l._cloudDeletedFor||[]).some(id=>Number(id)===Number(p.cloudId)))return false;return [...(l.team1Names||[]),...(l.team2Names||[])].some(n=>n.toLowerCase()===p.name.toLowerCase());});const cat=({BEG:'BEG',NOV:'NOV',INT:'INT',ADV:'ADV',EXP:'EXP'})[p.category]||p.category||'—';const cls=({BEG:'beg',NOV:'nov',INT:'int',ADV:'adv',EXP:'exp'})[p.category]||'nov';const active=state.players.find(sp=>String(sp.name||'').trim().toLowerCase()===String(p.name||'').trim().toLowerCase()&&(state.queue.includes(sp.id)||!!sp.court||(state.courts||[]).some(c=>(c.players||[]).includes(sp.id))));const alreadyQueued=!!active;const hasPendingMatch=Number(pendingCloudMatchDeleteId)>0&&Number(pendingCloudMatchPlayerId)===Number(p.cloudId)&&logs.some(l=>Number(l._cloudMatchId||0)===Number(pendingCloudMatchDeleteId));const keepMatchLogOpen=hasPendingMatch||Number(pendingCloudMatchEditPlayerId)===Number(p.cloudId);return `<article class="cloud-player-card"><div class="cloud-player-main"><div class="cloud-avatar"><span class="cloud-avatar-number">${index+1}</span>${esc((p.name||'?').charAt(0).toUpperCase())}</div><div class="cloud-player-ident"><b>${esc(p.name)}${p.nickname?` (${esc(p.nickname)})`:''} <span class="cloud-gender ${p.gender==='Female'?'gender-female':'gender-male'}">${p.gender==='Female'?'♀':'♂'}</span></b><small class="cloud-player-summary"><span class="cloud-category-badge skill-${cls}">${esc(cat)}</span><span class="cloud-player-stats"><span>${p.matches||0} Matches</span><span class="cloud-win">${p.wins||0} Wins</span><span class="cloud-loss">${p.losses||0} Losses</span></span></small></div><div class="cloud-player-actions"><button class="cloud-checkin-btn" ${alreadyQueued?'disabled aria-disabled="true" title="Player is already checked in or playing on court"':''} onclick="checkInCloudPlayer(${Number(p.cloudId)})">${alreadyQueued?'Checked In':'Check in'}</button>${Number(pendingCloudDeleteId)===Number(p.cloudId)?'':`<button class="cloud-delete-btn" ${alreadyQueued?'disabled aria-disabled="true" title="Cannot delete a checked-in player"':''} onclick="requestDeleteCloudPlayer(${Number(p.cloudId)})">Delete</button>`}</div></div>${Number(pendingCloudDeleteId)===Number(p.cloudId)?`<div class="cloud-delete-warning">Delete this registered profile? Match history will be kept. <button onclick="deleteCloudPlayer(${Number(p.cloudId)})">Confirm</button> <button onclick="cancelDeleteCloudPlayer()">Cancel</button></div>`:''}<details class="cloud-match-details" data-cloud-player-id="${Number(p.cloudId)}"${(keepMatchLogOpen||previouslyOpenCloudLogs.has(Number(p.cloudId)))?' open':''}><summary><span class="cloud-match-details-label">Match Log (${logs.length})</span></summary>${logs.slice().reverse().map((l,matchIndex)=>{const mid=Number(l._cloudMatchId||0),pendingMatch=Number(pendingCloudMatchDeleteId)===mid&&Number(pendingCloudMatchPlayerId)===Number(p.cloudId),pendingEdit=Number(pendingCloudMatchEditId)===mid&&Number(pendingCloudMatchEditPlayerId)===Number(p.cloudId),deleteDisabled=pendingMatch||pendingEdit,editDisabled=pendingMatch||pendingEdit;return `<div class="cloud-match-row"><button class="cloud-match-delete-icon${deleteDisabled?' is-disabled':''}" type="button" title="${pendingEdit?'Edit confirmation active':pendingMatch?'Delete confirmation active':'Delete match'}" aria-label="Delete match" ${deleteDisabled?'disabled aria-disabled="true"':''} onclick="event.stopPropagation();deleteCloudMatch(${Number(p.cloudId)},${mid})">🗑</button><b>${esc((l.team1Names||[]).join(' & '))} vs ${esc((l.team2Names||[]).join(' & '))}</b><span class="cloud-match-score"><button class="cloud-match-edit-icon${editDisabled?' is-disabled':''}" type="button" title="${pendingMatch?'Delete confirmation active':pendingEdit?'Edit confirmation active':'Edit score'}" aria-label="Edit score" ${editDisabled?'disabled aria-disabled="true"':''} onclick="event.stopPropagation();editCloudMatch(${Number(p.cloudId)},${mid})">✎</button>${l.recordingMode==='win-only'?'WIN / LOSS':esc(l.score||'--')}</span><small>${esc(l.court||'Court')} · ${esc(l.duration||'--')} · ${l.endedAt?new Date(l.endedAt).toLocaleString():''}${(l.sessionName||sessionNames[l.sessionId])?` · ${esc(l.sessionName||sessionNames[l.sessionId])}`:''}</small>${pendingMatch?`<div class="cloud-match-delete-warning">Delete this match records? <span>Team 1 · <b>${esc((l.team1Names||[]).join(' & ')||'Team 1')}</b> VS Team 2 · <b>${esc((l.team2Names||[]).join(' & ')||'Team 2')}</b></span> <button onclick="confirmDeleteCloudMatch()">Confirm</button> <button class="cloud-match-cancel-confirm" onclick="cancelDeleteCloudMatch()">Cancel</button></div>`:''}${pendingEdit?`<div class="cloud-match-edit-warning"><span>Edit match score?</span><label>Team 1 · <input id="cloudEditScore1-${mid}" type="number" min=0 step=1 inputmode="numeric" value="${esc(String(l.score||'0-0').split('-')[0]||'0')}"></label><label>Team 2 · <input id="cloudEditScore2-${mid}" type="number" min=0 step=1 inputmode="numeric" value="${esc(String(l.score||'0-0').split('-')[1]||'0')}"></label><button class="cloud-match-edit-confirm" onclick="confirmEditCloudMatch()">OK</button><button class="cloud-match-cancel-confirm" onclick="cancelEditCloudMatch()">Cancel</button></div>`:''}</div>`}).join('')||'<small>No match records yet.</small>'}</details></article>`}).join('')||'<div class="cloud-empty"><div class="cloud-empty-icon">🏓</div><div>No registered player records found.</div></div>';}
function getCloudMatchId(log){return Number(log?._cloudMatchId)||0;}
function ensureCloudMatchIds(){loadCloudRecords();let changed=false,seq=Date.now();cloudRecords.logs.forEach(l=>{if(!Number(l._cloudMatchId)){l._cloudMatchId=seq++;changed=true;}});if(changed)saveCloudRecords();return changed;}
function findCloudMatch(matchId){loadCloudRecords();return cloudRecords.logs.find(l=>Number(l._cloudMatchId)===Number(matchId));}
function recomputeCloudPlayerStats(){
  cloudRecords.players.forEach(p=>{p.matches=0;p.wins=0;p.losses=0;});
  const normalizeName=value=>String(value||'').trim().toLowerCase();
  cloudRecords.logs.forEach(l=>{
    const sc=String(l.score||'').split('-').map(Number);
    const scoreWinner=sc.length===2&&Number.isFinite(sc[0])&&Number.isFinite(sc[1])&&sc[0]!==sc[1]?(sc[0]>sc[1]?1:2):null;
    const winners=String(l.winner||'').split(' & ').map(normalizeName).filter(Boolean);
    const losers=String(l.loser||'').split(' & ').map(normalizeName).filter(Boolean);
    [...(l.team1Names||[]).map(name=>({name,team:1})),...(l.team2Names||[]).map(name=>({name,team:2}))].forEach(v=>{
      const p=cloudRecords.players.find(x=>normalizeName(x.name)===normalizeName(v.name));
      if(!p || (l._cloudDeletedFor||[]).some(id=>Number(id)===Number(p.cloudId)))return;
      p.matches=(p.matches||0)+1;
      const isWinner=winners.includes(normalizeName(v.name));
      const isLoser=losers.includes(normalizeName(v.name));
      if(isWinner&&!isLoser)p.wins=(p.wins||0)+1;
      else if(isLoser&&!isWinner)p.losses=(p.losses||0)+1;
      else if(scoreWinner!==null){if(scoreWinner===v.team)p.wins=(p.wins||0)+1;else p.losses=(p.losses||0)+1;}
    });
  });
}
function closeCloudMatchModal(){const el=$('cloudMatchActionModal');if(el){el.classList.add('hidden');el.classList.remove('cloud-match-edit-modal');}window._cloudMatchAction=null;}
function openCloudMatchModal(type,matchId){ensureCloudMatchIds();const l=findCloudMatch(matchId);if(!l)return;const modal=$('cloudMatchActionModal');if(!modal)return;const title=$('cloudMatchActionTitle'),body=$('cloudMatchActionBody'),actions=$('cloudMatchActionActions');const t1=(l.team1Names||[]).join(' & ')||'Team 1';const t2=(l.team2Names||[]).join(' & ')||'Team 2';if(type==='delete'){title.textContent='Delete this match records?';body.innerHTML=`<div class="cloud-match-delete-teams"><div>Team 1 · <b>${esc(t1)}</b></div><div class="cloud-match-vs">VS</div><div>Team 2 · <b>${esc(t2)}</b></div></div>`;actions.innerHTML=`<button type="button" class="cloud-modal-ok" onclick="confirmDeleteCloudMatch()">OK</button><button type="button" class="cloud-modal-cancel" onclick="closeCloudMatchModal()">Cancel</button>`;}else{const parts=String(l.score||'0-0').split('-').map(v=>v.trim());title.textContent='Edit match score';body.innerHTML=`<div class="cloud-match-edit-grid"><label><span>Team 1 ·</span><input id="cloudEditScore1" type="number" min=0 step=1 inputmode="numeric" value="${esc(parts[0]||'0')}"></label><label><span>Team 2 ·</span><input id="cloudEditScore2" type="number" min=0 step=1 inputmode="numeric" value="${esc(parts[1]||'0')}"></label></div>`;actions.innerHTML=`<button type="button" class="cloud-modal-ok" onclick="confirmEditCloudMatch()">OK</button><button type="button" class="cloud-modal-cancel" onclick="closeCloudMatchModal()">Cancel</button>`;}window._cloudMatchAction={type,matchId};modal.classList.toggle('cloud-match-edit-modal',type==='edit');modal.classList.remove('hidden');if(type==='edit'){setTimeout(()=>{$('cloudEditScore1')?.focus();$('cloudEditScore1')?.select();},0);}}
function editCloudMatch(playerId,matchId){pendingCloudMatchEditId=Number(matchId);pendingCloudMatchEditPlayerId=Number(playerId);renderCloudRecords();}
function cancelEditCloudMatch(){const keepPlayer=pendingCloudMatchEditPlayerId;pendingCloudMatchEditId=null;pendingCloudMatchEditPlayerId=null;renderCloudRecords();if(keepPlayer)requestAnimationFrame(()=>{const d=document.querySelector(`#cloudRecordsContent .cloud-match-details[data-cloud-player-id=\"${keepPlayer}\"]`);if(d)d.open=true;});}
function confirmEditCloudMatch(){const matchId=Number(pendingCloudMatchEditId),keepPlayer=Number(pendingCloudMatchEditPlayerId||0);if(!matchId)return;loadCloudRecords();const l=cloudRecords.logs.find(x=>Number(x._cloudMatchId)===matchId);if(!l)return;const s1=String($(`cloudEditScore1-${matchId}`)?.value??$('cloudEditScore1')?.value??'').trim(),s2=String($(`cloudEditScore2-${matchId}`)?.value??$('cloudEditScore2')?.value??'').trim();if(!/^\d+$/.test(s1)||!/^\d+$/.test(s2)||Number(s1)===Number(s2)){toast('Enter valid non-tied scores.');return;}l.score=`${Number(s1)}-${Number(s2)}`;l.recordingMode='score';l.winnerTeam=Number(s1)>Number(s2)?1:2;l.winner=(l.winnerTeam===1?(l.team1Names||[]):(l.team2Names||[])).join(' & ');l.loser=(l.winnerTeam===1?(l.team2Names||[]):(l.team1Names||[])).join(' & ');pendingCloudMatchEditId=null;pendingCloudMatchEditPlayerId=keepPlayer||null;recomputeCloudPlayerStats();saveCloudRecords();renderCloudRecords();if(keepPlayer)requestAnimationFrame(()=>{const d=document.querySelector(`#cloudRecordsContent .cloud-match-details[data-cloud-player-id=\"${keepPlayer}\"]`);if(d)d.open=true;pendingCloudMatchEditPlayerId=null;});}
function deleteCloudMatch(playerId,matchId){pendingCloudMatchDeleteId=Number(matchId);pendingCloudMatchPlayerId=Number(playerId);renderCloudRecords();}
function cancelDeleteCloudMatch(){pendingCloudMatchDeleteId=null;const keepPlayer=pendingCloudMatchPlayerId;pendingCloudMatchPlayerId=null;renderCloudRecords();if(keepPlayer)requestAnimationFrame(()=>{const d=document.querySelector(`#cloudRecordsContent .cloud-match-details[data-cloud-player-id=\"${keepPlayer}\"]`);if(d)d.open=true;});}
function confirmDeleteCloudMatch(){const matchId=Number(pendingCloudMatchDeleteId);const keepPlayer=Number(pendingCloudMatchPlayerId||0);if(!matchId)return;loadCloudRecords();const target=cloudRecords.logs.find(x=>Number(x._cloudMatchId)===matchId);if(target&&keepPlayer){target._cloudDeletedFor=Array.isArray(target._cloudDeletedFor)?target._cloudDeletedFor:[];if(!target._cloudDeletedFor.some(id=>Number(id)===keepPlayer))target._cloudDeletedFor.push(keepPlayer);}pendingCloudMatchDeleteId=null;pendingCloudMatchPlayerId=keepPlayer||null;recomputeCloudPlayerStats();saveCloudRecords();renderCloudRecords();if(keepPlayer)requestAnimationFrame(()=>{const d=document.querySelector(`#cloudRecordsContent .cloud-match-details[data-cloud-player-id="${keepPlayer}"]`);if(d)d.open=true;pendingCloudMatchPlayerId=null;});}

function closeAllCloudMatchLogs(except){document.querySelectorAll('#cloudRecordsContent .cloud-match-details').forEach(d=>{if(d!==except)d.open=false;});}
function enforceSingleCloudMatchLogOpen(){const root=$('cloudRecordsContent');if(!root||root._singleMatchLogBound)return;root._singleMatchLogBound=true;root.addEventListener('toggle',e=>{const d=e.target;if(d&&d.matches&&d.matches('.cloud-match-details')&&d.open)closeAllCloudMatchLogs(d);},true);}
function clearCloudMatchConfirmations(){pendingCloudMatchDeleteId=null;pendingCloudMatchPlayerId=null;pendingCloudMatchEditId=null;pendingCloudMatchEditPlayerId=null;}
function requestDeleteCloudPlayer(id){clearCloudMatchConfirmations();closeAllCloudMatchLogs();pendingCloudDeleteId=id;renderCloudRecords();}
function cancelDeleteCloudPlayer(){pendingCloudDeleteId=null;renderCloudRecords();}
function deleteCloudPlayer(id){loadCloudRecords();cloudRecords.players=cloudRecords.players.filter(p=>Number(p.cloudId)!==Number(id));pendingCloudDeleteId=null;saveCloudRecords();renderCloudRecords();}
function checkInCloudPlayer(id){loadCloudRecords();const a=cloudRecords.players.find(p=>Number(p.cloudId)===Number(id));if(!a)return;let p=state.players.find(p=>p.name.toLowerCase()===a.name.toLowerCase());if(!p){const left=state.left.find(p=>p.name.toLowerCase()===a.name.toLowerCase());if(left){checkIn(left.id,true);state.sessionMetrics.cloudCheckins=(Number(state.sessionMetrics.cloudCheckins)||0)+1;saveState();renderCloudRecords();return;}p={id:state.nextPlayer++,name:a.name,nickname:a.nickname||'',wins:a.wins||0,court:null,gender:a.gender||'Male',category:a.category||'',queuedAt:Date.now(),waitingSince:Date.now()};state.players.push(p);}if(p.court){toast('Player is already on court.');return;}if(!state.queue.includes(p.id))state.queue.push(p.id);p.queuedAt=Date.now();p.waitingSince=p.queuedAt;state.sessionMetrics.cloudCheckins=(Number(state.sessionMetrics.cloudCheckins)||0)+1;saveState();render();renderCloudRecords();toast(`${p.name} checked in.`);}

let openCategoryPlayerId=null;
let openGenderPlayerId=null;
let registrationGender='';
let registrationSkillLevel='';
let courtSettingsDraft=null;

const $=id=>document.getElementById(id);

// Main queue workspace network indicator. Queueing remains local-first, so it
// can continue working when the device loses its network connection.
function initQueueNetworkStatus(){
  const badge=document.querySelector('.topbar .top-actions .online');
  if(!badge)return;
  const sync=()=>{
    const isOnline=navigator.onLine!==false;
    badge.classList.toggle('offline',!isOnline);
    badge.innerHTML=`<i aria-hidden="true"></i> ${isOnline?'Online Queueing':'Offline Queueing'}`;
    badge.setAttribute('role','status');
    badge.setAttribute('aria-live','polite');
    badge.setAttribute('aria-label',isOnline?'Online Queueing: network detected':'Offline Queueing: no network detected');
    badge.title=isOnline?'Network detected. Queueing can continue.':'No network detected. Queueing can continue offline.';
  };
  window.addEventListener('online',sync);
  window.addEventListener('offline',sync);
  window.addEventListener('focus',sync);
  sync();
}

const endSessionCountTimers={};
function animateEndSessionCount(id,target){
  const el=$(id);
  if(!el)return;
  if(endSessionCountTimers[id]){
    clearInterval(endSessionCountTimers[id]);
    endSessionCountTimers[id]=null;
  }
  target=Math.max(0,Math.floor(Number(target)||0));
  let current=0;
  el.textContent='0';
  if(target===0)return;
  endSessionCountTimers[id]=setInterval(()=>{
    current+=1;
    el.textContent=String(current);
    if(current>=target){
      clearInterval(endSessionCountTimers[id]);
      endSessionCountTimers[id]=null;
    }
  },70);
}

function openEndSessionConfirmation(){
  const modal=$('endSessionModal');
  if(!modal)return;
  const checkins=Number(state.sessionMetrics?.cloudCheckins)||0;
  const registered=Number(state.sessionMetrics?.newRegistered)||0;
  const matches=Array.isArray(state.logs)?state.logs.length:0;
  modal.classList.remove('hidden');
  animateEndSessionCount('endSummaryCheckins',checkins);
  animateEndSessionCount('endSummaryRegistered',registered);
  animateEndSessionCount('endSummaryMatches',matches);
}

function closeEndSessionConfirmation(){
  const modal=$('endSessionModal');
  if(modal)modal.classList.add('hidden');
}

function endSession(){
  closeEndSessionConfirmation();
  archiveLiveSession();
  try{
    [STORAGE_KEY,...LEGACY_STORAGE_KEYS].forEach(k=>localStorage.removeItem(k));
  }catch(e){ console.warn('PickleQ reset failed',e); }

  state.players=[];
  state.left=[];
  state.queue=[];
  state.lockedPartners=[];
  state.courts=[];
  state.logs=[];
  state.nextPlayer=1;
  state.nextCourt=1;
  state.nextWaitingCourt=1;
  state.nextLog=1;
  state.selectedCourt=null;
  state.pendingLeftDelete=null;
  state.pendingRemoveCourt=null;
  state.eventRules={target:11,winBy:1,type:'Doubles'};
  state.sessionMetrics={cloudCheckins:0,newRegistered:0};
  state.sessionActive=false;
  state.sessionName='Open Play — Oct 6, 2026';
  state.duprMatch=false;
  state.recordScores=false;
  openCategoryPlayerId=null;
  openGenderPlayerId=null;
  registrationGender='';
  publishLiveViewState(true);

  // Refresh automatically so every screen returns to the clean starting state.
  window.location.reload();
}

function liveViewPlayerLabel(p){
  if(!p)return '';
  const name=String(p.name||'').trim();
  const nickname=String(p.nickname||'').trim();
  return name+(nickname&&nickname.toLowerCase()!==name.toLowerCase()?` (${nickname})`:'');
}
function buildLiveViewSnapshot(){
  const roster=[...(Array.isArray(state.players)?state.players:[]),...(Array.isArray(state.left)?state.left:[])];
  const byId=new Map(roster.map(p=>[String(p.id),p]));
  const playerRef=id=>{
    const p=byId.get(String(id));
    return p?{
      id:p.id,
      name:String(p.name||'Player'),
      nickname:String(p.nickname||''),
      gender:String(p.gender||''),
      category:String(p.category||''),
      queuedAt:p.queuedAt||null,
      waitingSince:p.waitingSince||p.queuedAt||null
    }:null;
  };
  const courts=(Array.isArray(state.courts)?state.courts:[]).map(c=>{
    const ids=Array.isArray(c.players)?c.players:[];
    const slots=ids.map(id=>playerRef(id));
    return {
      id:c.id,
      name:c.waitingOnly?(String(c.name||'').trim()||`Waiting Court #${c.waitingOrder||1}`):courtDisplayName(c),
      number:Number(c.number)||null,
      waitingOnly:!!c.waitingOnly,
      playing:!!c.playing,
      start:c.playing?(c.start||null):null,
      target:Number(c.target)||Number(state.eventRules?.target)||11,
      winBy:Number(c.winBy)||Number(state.eventRules?.winBy)||1,
      players:slots,
      team1:slots.slice(0,2),
      team2:slots.slice(2,4),
      scores:Array.isArray(c.scores)?c.scores.slice(0,2).map(v=>Number(v)||0):[0,0]
    };
  });
  const recentMatches=(Array.isArray(state.logs)?state.logs:[]).slice(-12).reverse().map(l=>({
    id:l.id,
    court:String(l.court|| (l.courtNumber?`Court ${l.courtNumber}`:'Court')),
    winner:String(l.winner||''),
    loser:String(l.loser||''),
    score:l.recordingMode==='win-only'?'WIN / LOSS':String(l.score||''),
    endedAt:l.endedAt||null,
    duration:String(l.duration||'')
  }));
  return {
    sessionName:String(state.sessionName||'Pickle Point Match'),
    active:!!state.sessionActive,
    updatedAt:new Date().toISOString(),
    playerCount:roster.length,
    queue:(Array.isArray(state.queue)?state.queue:[]).map(playerRef).filter(Boolean),
    courts,
    activeCourtCount:courts.filter(c=>!c.waitingOnly&&c.playing).length,
    readyCourtCount:courts.filter(c=>!c.waitingOnly&&!c.playing).length,
    courtCount:courts.filter(c=>!c.waitingOnly).length,
    waitingCourtCount:courts.filter(c=>c.waitingOnly).length,
    matchCount:Array.isArray(state.logs)?state.logs.length:0,
    eventRules:{target:Number(state.eventRules?.target)||11,winBy:Number(state.eventRules?.winBy)||1,type:String(state.eventRules?.type||'Doubles')},
    recentMatches
  };
}
function flushLiveViewState(){
  if(liveViewPublishInFlight||!liveViewPendingSnapshot||(location.protocol!=='http:'&&location.protocol!=='https:'))return;
  const snapshot=liveViewPendingSnapshot;
  liveViewPendingSnapshot=null;
  const keepalive=liveViewPendingKeepalive;
  liveViewPendingKeepalive=false;
  liveViewPublishInFlight=true;
  const controller=new AbortController();
  const timeout=window.setTimeout(()=>controller.abort(),30000);
  fetch('/api/live-state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot),keepalive:!!keepalive,cache:'no-store',signal:controller.signal})
    .then(response=>{if(!response.ok)throw new Error(`Live state publish failed (${response.status})`);liveViewPublishRetryDelay=3000;})
    .catch(()=>{
      // Keep only a fresh snapshot for the retry so an older request can never
      // replace newer queue/court state after a temporary connection failure.
      liveViewPendingSnapshot=buildLiveViewSnapshot();
      if(liveViewPublishRetryTimer===null){
        const delay=liveViewPublishRetryDelay;
        liveViewPublishRetryDelay=Math.min(30000,Math.round(liveViewPublishRetryDelay*1.7));
        liveViewPublishRetryTimer=window.setTimeout(()=>{
          liveViewPublishRetryTimer=null;
          flushLiveViewState();
        },delay);
      }
    })
    .finally(()=>{
      window.clearTimeout(timeout);
      liveViewPublishInFlight=false;
      if(liveViewPendingSnapshot&&liveViewPublishRetryTimer===null)flushLiveViewState();
    });
}
function publishLiveViewState(keepalive=false){
  const snapshot=buildLiveViewSnapshot();
  try{localStorage.setItem(LIVE_VIEW_STORAGE_KEY,JSON.stringify(snapshot));}catch(e){}
  try{liveViewBroadcastChannel?.postMessage(snapshot);}catch(e){}
  // Publish in sequence and retry transient failures. Only the latest pending
  // snapshot is retained, preventing overlapping requests from reverting state.
  if(location.protocol==='http:'||location.protocol==='https:'){
    liveViewPendingSnapshot=snapshot;
    liveViewPendingKeepalive=liveViewPendingKeepalive||!!keepalive;
    flushLiveViewState();
  }
  return snapshot;
}
function getLiveViewUrl(){
  return new URL('live.html',window.location.href);
}
function syncLiveViewThemeButton(theme){
  const button=$('liveViewThemeToggle');
  if(!button)return;
  const normalized=theme==='light'?'light':'night';
  const lightMode=normalized==='light';
  const nextMode=lightMode?'night':'light';
  button.classList.toggle('is-light',lightMode);
  button.setAttribute('aria-pressed',String(lightMode));
  button.setAttribute('aria-label',`Switch Live View to ${nextMode} mode`);
  button.title=`Switch Live View to ${nextMode} mode`;
  const label=button.querySelector('.live-view-theme-label');
  if(label)label.textContent=lightMode?'Light':'Night';
}
function setLiveViewTheme(theme,publish=true){
  const normalized=theme==='light'?'light':'night';
  try{localStorage.setItem(LIVE_VIEW_THEME_STORAGE_KEY,normalized);}catch(e){}
  syncLiveViewThemeButton(normalized);
  if(publish&&(location.protocol==='http:'||location.protocol==='https:')){
    fetch('/api/live-theme',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme:normalized}),cache:'no-store'}).catch(()=>{});
  }
}
function initLiveViewThemeController(){
  let initial='night';
  let themeChangedLocally=false;
  try{const saved=localStorage.getItem(LIVE_VIEW_THEME_STORAGE_KEY);if(saved==='light'||saved==='night')initial=saved;}catch(e){}
  syncLiveViewThemeButton(initial);
  $('liveViewThemeToggle')?.addEventListener('click',()=>{
    themeChangedLocally=true;
    let current='night';
    try{const saved=localStorage.getItem(LIVE_VIEW_THEME_STORAGE_KEY);if(saved==='light'||saved==='night')current=saved;}catch(e){}
    setLiveViewTheme(current==='light'?'night':'light',true);
  });
  window.addEventListener('storage',event=>{
    if(event.key===LIVE_VIEW_THEME_STORAGE_KEY&&event.newValue){
      themeChangedLocally=true;
      const theme=event.newValue==='light'?'light':'night';
      syncLiveViewThemeButton(theme);
    }
  });
  if(location.protocol==='http:'||location.protocol==='https:'){
    fetch('/api/live-theme',{cache:'no-store'}).then(response=>response.ok?response.json():null).then(data=>{
      if(!themeChangedLocally&&data&&(data.theme==='light'||data.theme==='night'))setLiveViewTheme(data.theme,false);
    }).catch(()=>{});
  }
}
function openLiveView(){
  const url=getLiveViewUrl();
  window.open(url.href,'_blank','noopener');
}
function syncLiveViewQrNetworkState(forceQrRefresh=false){
  const modal=$('liveViewQrModal');
  const wrap=$('liveViewQrImageWrap');
  const image=$('liveViewQrImage');
  const unavailable=$('liveViewQrUnavailable');
  const loader=$('liveViewQrOfflineLoader');
  const statusTitle=$('liveViewQrStatusTitle');
  const statusNote=$('liveViewQrStatusNote');
  if(!modal||!wrap||!image||!unavailable||!loader)return;

  // Bind image events once so the QR becomes visible as soon as it loads,
  // and use a second QR endpoint automatically if the primary one fails.
  if(!image.dataset.qrNetworkEventsBound){
    image.dataset.qrNetworkEventsBound='true';
    image.addEventListener('load',()=>{
      if(navigator.onLine===false)return;
      image.hidden=false;
      loader.hidden=true;
      unavailable.hidden=true;
    });
    image.addEventListener('error',()=>{
      if(navigator.onLine===false){syncLiveViewQrNetworkState();return;}
      const target=image.dataset.qrTarget;
      if(target&&image.dataset.qrFallbackAttempted!=='true'){
        image.dataset.qrFallbackAttempted='true';
        image.src='https://quickchart.io/qr?size=280&margin=8&text='+encodeURIComponent(target);
        return;
      }
      image.hidden=true;
      loader.hidden=true;
      unavailable.textContent='QR preview could not load. It will retry automatically when the connection is restored.';
      unavailable.hidden=false;
    });
  }

  const isOnline=navigator.onLine!==false;
  wrap.classList.toggle('is-offline',!isOnline);
  if(!isOnline){
    image.hidden=true;
    image.removeAttribute('src');
    delete image.dataset.qrTarget;
    image.dataset.qrFallbackAttempted='false';
    loader.hidden=false;
    unavailable.hidden=true;
    if(statusTitle)statusTitle.textContent='Offline mode';
    if(statusNote)statusNote.textContent='The QR preview is paused while the system is offline. It will return automatically when the connection is restored.';
    return;
  }

  loader.hidden=true;
  const url=getLiveViewUrl();
  const isHttp=['http:','https:'].includes(url.protocol);
  image.hidden=!isHttp;
  unavailable.hidden=isHttp;
  if(!isHttp){
    image.removeAttribute('src');
    delete image.dataset.qrTarget;
    if(statusTitle)statusTitle.textContent='Local / private link';
    if(statusNote)statusNote.textContent='QR code will appear when opened through a web server.';
    return;
  }

  // Prepare the QR as soon as the app detects an online connection, even
  // while this modal is closed, so opening it can show the QR immediately.
  const target=url.href;
  const imageFailed=image.complete&&image.naturalWidth===0;
  const needsRefresh=forceQrRefresh===true||image.dataset.qrTarget!==target||!image.getAttribute('src')||imageFailed;
  if(needsRefresh){
    image.dataset.qrTarget=target;
    image.dataset.qrFallbackAttempted='false';
    image.src='https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=8&data='+encodeURIComponent(target);
  }

  const host=url.hostname;
  const privateIpv4=/^(10\.|192\.168\.|127\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(host);
  const localHost=host==='localhost'||host==='0.0.0.0'||host==='::1'||privateIpv4;
  const publicReady=url.protocol==='https:'&&!localHost;
  if(statusTitle)statusTitle.textContent=publicReady?'Public link ready':'Local / private link';
  if(statusNote)statusNote.textContent=publicReady
    ?'Anyone with this QR code and an internet connection can open the live page.'
    :'This QR code currently points to this computer or local network. To let players scan from anywhere, deploy the app to public HTTPS hosting, then reopen this screen.';
}
function openLiveViewQrModal(){
  const modal=$('liveViewQrModal');
  const url=getLiveViewUrl();
  const urlField=$('liveViewQrUrl');
  if(!modal||!urlField)return;
  urlField.value=url.href;
  modal.classList.remove('hidden');
  syncLiveViewQrNetworkState();
}
window.addEventListener('online',()=>syncLiveViewQrNetworkState(true));
window.addEventListener('offline',()=>syncLiveViewQrNetworkState());
window.addEventListener('focus',()=>syncLiveViewQrNetworkState());
// Preload the QR while online so the share modal opens directly to the QR.
syncLiveViewQrNetworkState();
function closeLiveViewQrModal(){ $('liveViewQrModal')?.classList.add('hidden'); }
async function copyLiveViewQrLink(){
  const field=$('liveViewQrUrl');if(!field)return;
  try{await navigator.clipboard.writeText(field.value);toast('Live View link copied.');}
  catch(e){field.focus();field.select();let copied=false;try{copied=document.execCommand('copy');}catch(err){}toast(copied?'Live View link copied.':'Select and copy the Live View link.');}
}
function saveState(){
  try{
    const snapshot={
      schemaVersion:11,
      players:state.players,left:state.left,queue:state.queue,lockedPartners:state.lockedPartners,courts:state.courts,logs:state.logs,
      nextPlayer:state.nextPlayer,nextCourt:state.nextCourt,nextWaitingCourt:state.nextWaitingCourt,nextLog:state.nextLog,sessionMetrics:state.sessionMetrics,sessionActive:state.sessionActive,sessionName:state.sessionName,duprMatch:state.duprMatch,recordScores:state.recordScores,eventRules:state.eventRules
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }catch(e){ console.warn('PickleQ save failed',e); }
  publishLiveViewState();
}

function loadState(){
  try{
    // Read the newest valid save first. A corrupt/newer save must not block recovery
    // from an older valid save.
    let data=null;
    for(const key of [STORAGE_KEY,...LEGACY_STORAGE_KEYS]){
      try{
        const raw=localStorage.getItem(key);
        if(!raw)continue;
        const parsed=JSON.parse(raw);
        if(parsed && typeof parsed==='object'){
          data=parsed;
          break;
        }
      }catch(err){
        console.warn(`PickleQ ignored invalid saved state: ${key}`,err);
      }
    }
    if(!data)return;
    state.players=Array.isArray(data.players)?data.players:[];
    state.left=Array.isArray(data.left)?data.left:[];
    state.queue=Array.isArray(data.queue)?data.queue:[];
    state.lockedPartners=Array.isArray(data.lockedPartners)?data.lockedPartners.filter(pair=>Array.isArray(pair)&&pair.length===2):[];
    state.courts=Array.isArray(data.courts)?data.courts:[];
    state.logs=Array.isArray(data.logs)?data.logs:[];
    state.sessionMetrics={cloudCheckins:Number(data.sessionMetrics?.cloudCheckins)||0,newRegistered:Number(data.sessionMetrics?.newRegistered)||0};
    state.sessionActive=typeof data.sessionActive==='boolean'?data.sessionActive:(state.players.length>0||state.left.length>0||state.queue.length>0||state.courts.length>0||state.logs.length>0);
    state.sessionName=String(data.sessionName||'Open Play — Oct 6, 2026');
    state.duprMatch=!!data.duprMatch;
    state.recordScores=typeof data.recordScores==='boolean'?data.recordScores:false;
    state.nextPlayer=Number(data.nextPlayer)||((state.players.reduce((m,p)=>Math.max(m,Number(p.id)||0),0))+1);
    state.nextCourt=Number(data.nextCourt)||((state.courts.reduce((m,c)=>Math.max(m,Number(c.number)||0),0))+1);
    state.nextWaitingCourt=Number(data.nextWaitingCourt)||1;
    state.nextLog=Number(data.nextLog)||((state.logs.reduce((m,l)=>Math.max(m,Number(l.id)||0),0))+1);
    const loadedTarget=Number(data.eventRules?.target); state.eventRules={target:[11,15,21].includes(loadedTarget)?loadedTarget:(loadedTarget===22?21:11),winBy:[1,2,3].includes(Number(data.eventRules?.winBy))?Number(data.eventRules.winBy):1,type:'Doubles'};
    state.players.forEach(p=>{ p.gender=(String(p.gender||'').toLowerCase()==='female'?'Female':(String(p.gender||'').toLowerCase()==='male'?'Male':'')); p.wins=Number(p.wins)||0; p.category=['BEG','NOV','INT','ADV','EXP'].includes(p.category)?p.category:''; p.queuedAt=p.queuedAt||Date.now(); p.waitingSince=p.waitingSince||p.queuedAt; p.nickname=p.nickname||''; });
    state.left.forEach(p=>{ p.gender=(String(p.gender||'').toLowerCase()==='female'?'Female':(String(p.gender||'').toLowerCase()==='male'?'Male':'')); p.wins=Number(p.wins)||0; p.category=['BEG','NOV','INT','ADV','EXP'].includes(p.category)?p.category:''; p.queuedAt=p.queuedAt||Date.now(); p.waitingSince=p.waitingSince||p.queuedAt; p.nickname=p.nickname||''; });
    state.logs.forEach(l=>{ l.recordingMode=l.recordingMode==='win-only'?'win-only':'score'; if(l.recordingMode==='win-only')l.score=null;else l.score=l.score||'0-0'; l.team1Ids=Array.isArray(l.team1Ids)?l.team1Ids:[]; l.team2Ids=Array.isArray(l.team2Ids)?l.team2Ids:[]; l.team1Names=Array.isArray(l.team1Names)?l.team1Names:[]; l.team2Names=Array.isArray(l.team2Names)?l.team2Names:[]; l.duration=l.duration||'--'; l.startedAt=l.startedAt||null; l.endedAt=l.endedAt||null; l.target=Number(l.target)||11; l.type=l.type||'Doubles'; });
    state.selectedCourt=null;
    state.pendingLeftDelete=null;
    state.pendingRemoveCourt=null;
    state.courts.forEach(c=>{
      c.players=Array.isArray(c.players)?c.players:[];
      c.scores=Array.isArray(c.scores)&&c.scores.length===2?c.scores:[0,0];
      // The event rule is the single source of truth for court mode.
      // Older saved states may have a stale court target (for example 15)
      // while the event-rule button is set to Race to 11.
      const selectedTarget=Number(state.eventRules?.target);
      const selectedWinBy=Number(state.eventRules?.winBy);
      c.target=[11,15,21].includes(selectedTarget)?selectedTarget:(Number(c.target)||11);
      c.winBy=[1,2,3].includes(selectedWinBy)?selectedWinBy:(Number(c.winBy)||1);
      c.playing=!!c.playing; c.waitingOnly=!!c.waitingOnly;
      c.allowedSkills=Array.isArray(c.allowedSkills)?c.allowedSkills.filter(x=>['BEG','NOV','INT','ADV','EXP'].includes(x)):[];
      if(c.waitingOnly){
        c.waitingOrder=Number(c.waitingOrder)||state.nextWaitingCourt++;
        c.name=`Waiting Court #${c.waitingOrder}`;
        c.number=null;
      }else{
        c.name=c.name?courtDisplayName(c):`Court ${c.number||1}`;
      }
    });
    state.courts.sort((a,b)=>a.waitingOnly?(b.waitingOnly?((a.waitingOrder||9999)-(b.waitingOrder||9999)):1):(b.waitingOnly?-1:((Number(a.number)||9999)-(Number(b.number)||9999))));
    // Rebuild player-to-court links after loading.
    state.players.forEach(p=>{p.court=null;p.wins=Number(p.wins)||0;});
    state.courts.forEach(c=>c.players.forEach(pid=>{const p=player(pid);if(p)p.court=c.id;}));
  }catch(e){
    console.warn('PickleQ load failed',e);
  }
}

function nextAvailableCourtNumber(){
  const used=new Set(state.courts.filter(c=>!c.waitingOnly).map(c=>Number(c.number)||Number(c.name)||0));
  let n=1;
  while(used.has(n))n++;
  return n;
}

function courtDisplayName(c){
  if(!c) return 'Court';
  const raw=String(c.name||'').trim();
  if(/^court\s*\d+$/i.test(raw)) return raw.replace(/court\s*/i,'Court ');
  if(/^\d+$/.test(raw)) return `Court ${raw}`;
  return raw || `Court ${c.number||''}`;
}

function normalizeCourtEntry(value){
  const raw=String(value||'').trim();
  const fallback=nextAvailableCourtNumber();
  if(!raw)return {number:fallback,name:`Court ${fallback}`};
  const match=raw.match(/\d+/);
  if(match){
    const number=Math.max(1,parseInt(match[0],10));
    const occupied=state.courts.some(c=>!c.waitingOnly && Number(c.number)===number);
    if(occupied)return {error:`Court ${number} already exists.`};
    return {number,name:`Court ${number}`};
  }
  return {number:fallback,name:raw};
}

function renameCourt(id,value){
  const c=court(id); if(!c)return;
  const raw=String(value||'').trim();
  if(!raw)return;
  const match=raw.match(/\d+/);
  if(match){
    const number=Math.max(1,parseInt(match[0],10));
    const occupied=state.courts.some(x=>!x.waitingOnly && x.id!==id && Number(x.number)===number);
    if(occupied){toast(`Court ${number} is already in use.`);render();return;}
    c.number=number; c.name=`Court ${number}`;
  }else{
    c.name=raw;
  }
  saveState(); render(); toast(`Court renamed to ${courtDisplayName(c)}.`);
}

function editCourtTitle(id,button){
  const c=court(id);
  if(!c || c.waitingOnly)return;
  const title=button?.closest('.court-title');
  const label=title?.querySelector('.court-title-text');
  if(!title || !label || label.isContentEditable)return;
  const original=courtDisplayName(c);
  label.contentEditable='true';
  label.dataset.originalTitle=original;
  label.setAttribute('role','textbox');
  label.setAttribute('aria-label','Edit court title');
  label.focus();
  try{
    const range=document.createRange();
    range.selectNodeContents(label);
    const selection=window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }catch(e){}
  const onKeyDown=e=>{
    if(e.key==='Enter'){
      e.preventDefault();
      label.blur();
    }else if(e.key==='Escape'){
      e.preventDefault();
      label.textContent=original;
      label.blur();
    }
  };
  const finish=()=>{
    if(!label.isContentEditable)return;
    label.contentEditable='false';
    label.removeAttribute('role');
    label.removeEventListener('keydown',onKeyDown);
    const value=label.textContent.trim();
    if(!value || value===original){
      label.textContent=original;
      return;
    }
    renameCourt(id,value);
  };
  label.addEventListener('blur',finish,{once:true});
  label.addEventListener('keydown',onKeyDown);
}

function renderCourtTitle(c){
  return `<div class="court-title"><span class="court-logo" aria-hidden="true">🏟️</span><b class="court-title-text">${esc(courtDisplayName(c))}</b><button type="button" class="court-title-edit" title="Edit court title" aria-label="Edit ${esc(courtDisplayName(c))}" onclick="event.stopPropagation();editCourtTitle(${c.id},this)">✎</button></div>`;
}

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const player=id=>state.players.find(p=>p.id===id);
const court=id=>state.courts.find(c=>c.id===id);

function toast(msg){
  const t=$('toast');
  t.textContent=msg;
  t.style.display='block';
  clearTimeout(window.__toast);
  window.__toast=setTimeout(()=>t.style.display='none',2200);
}

function addOrCheckIn(){
  const input=$('playerInputQueue');
  const name=input.value.trim();
  // New players default to Male. Gender is changed from the compact M/F badge on the player row.
  const gender='Male';
  if(!name){toast('Enter a player name.');return;}

  const active=state.players.find(p=>p.name.toLowerCase()===name.toLowerCase());
  if(active){
    active.gender=gender; active.queuedAt=active.queuedAt||Date.now(); active.waitingSince=Date.now();
    if(!state.queue.includes(active.id) && !active.court){
      state.queue.push(active.id); saveState(); render(); toast(`${active.name} added back to queue.`);
    }else toast(`${active.name} is already checked in.`);
    input.value=''; return;
  }

  const old=state.left.find(p=>p.name.toLowerCase()===name.toLowerCase());
  if(old){
    state.left=state.left.filter(p=>p.id!==old.id);
    old.court=null;
    old.gender=gender; old.queuedAt=old.queuedAt||Date.now(); old.waitingSince=Date.now();
    state.players.push(old);
    state.queue.push(old.id);
    input.value=''; saveState(); render(); toast(`${old.name} checked in again. Wins preserved.`); return;
  }

  const p={id:state.nextPlayer++,name,wins:0,court:null,gender,category:'',queuedAt:Date.now(),waitingSince:Date.now()};
  state.players.push(p); state.queue.push(p.id); input.value=''; saveState(); render(); toast(`${name} added to queue. Tap M/F to change gender.`);
}

function cleanupGenderMenuPortal(){
  document.querySelectorAll('.gender-menu.gender-menu-portal').forEach(menu=>menu.remove());
}

function toggleGenderMenu(id){
  openGenderPlayerId=(openGenderPlayerId===id?null:id); openCategoryPlayerId=null; renderQueue(); }

function positionGenderMenu(id){
  const trigger=document.querySelector(`.queue-gender-inline .gender-inline[onclick*='toggleGenderMenu(${id})']`);
  const menu=document.querySelector(`.gender-menu.gender-menu-portal[data-player-id="${id}"]`);
  if(!trigger||!menu)return;
  const r=trigger.getBoundingClientRect();
  const mw=menu.offsetWidth||61;
  const mh=menu.offsetHeight||126;
  const gap=6;
  const pad=8;

  // Keep the selector beside the gender icon, not inside the queue row.
  // Prefer the LEFT side; flip to the RIGHT only when necessary.
  let left=r.left-mw-gap;
  let top=r.top+(r.height/2)-(mh/2);
  if(left<pad) left=r.right+gap;

  // Keep the whole selector inside the visible viewport.
  left=Math.max(pad,Math.min(left,window.innerWidth-mw-pad));
  top=Math.max(pad,Math.min(top,window.innerHeight-mh-pad));

  menu.style.left=`${left}px`;
  menu.style.top=`${top}px`;
}

function setPlayerGender(id,gender){
  const p=player(id);
  if(!p)return;
  p.gender=gender==='Female'?'Female':(gender==='Male'?'Male':'');
  openGenderPlayerId=null;
  saveState();
  renderQueue();
  renderCourts();
  renderResults();
}

function togglePlayerGender(id){
  const p=player(id);
  if(!p)return;
  p.gender=p.gender==='Female'?'Male':'Female';
  saveState();
  renderQueue();
  renderCourts();
  renderResults();
}

function setPlayerCategory(id,category){
  const p=player(id);
  if(!p)return;
  const allowed=['BEG','NOV','INT','ADV','EXP'];
  p.category=allowed.includes(category)?category:'';
  openCategoryPlayerId=null;
  const menu=document.getElementById('queueCategoryPopup');
  if(menu) menu.style.display='none';
  saveState();
  renderQueue();
  renderCourts();
  renderResults();
}

function getCategoryMenu(){
  let menu=document.getElementById('queueCategoryPopup');
  if(menu)return menu;
  menu=document.createElement('div');
  menu.id='queueCategoryPopup';
  menu.className='category-menu category-menu-portal';
  menu.setAttribute('role','menu');
  menu.innerHTML=`
    <button type="button" class="skill-beg" data-category="BEG"><span>BEG - DUPR 2.0 - 2.5</span></button>
    <button type="button" class="skill-nov" data-category="NOV"><span>NOV - DUPR 2.5 - 3.0</span></button>
    <button type="button" class="skill-int" data-category="INT"><span>INT - DUPR 3.0 - 3.5</span></button>
    <button type="button" class="skill-adv" data-category="ADV"><span>ADV - DUPR 3.5 - 4.0</span></button>
    <button type="button" class="skill-exp" data-category="EXP"><span>EXP - DUPR 4.0+</span></button>`;
  menu.addEventListener('click',e=>{
    const btn=e.target.closest('button[data-category]');
    if(!btn || openCategoryPlayerId===null)return;
    e.stopPropagation();
    setPlayerCategory(openCategoryPlayerId,btn.dataset.category);
  });
  document.body.appendChild(menu);
  return menu;
}

function positionCategoryMenu(id){
  const trigger=document.querySelector(`.queue-cat-wrap .category-trigger[data-player-id="${id}"]`);
  const menu=getCategoryMenu();
  if(!trigger){menu.style.display='none';return;}
  const r=trigger.getBoundingClientRect();
  const gap=6;
  const mw=184;
  const mh=menu.offsetHeight||170;
  let left=r.right+gap;
  if(left+mw>window.innerWidth-8) left=r.left-mw-gap;
  left=Math.max(8,Math.min(left,window.innerWidth-mw-8));
  let top=r.top;
  if(top+mh>window.innerHeight-8) top=r.bottom-mh;
  top=Math.max(8,Math.min(top,window.innerHeight-mh-8));
  // The portal is position:fixed; force the coordinates to win over any legacy menu rules.
  menu.style.setProperty('left', `${Math.round(left)}px`, 'important');
  menu.style.setProperty('right', 'auto', 'important');
  menu.style.setProperty('top', `${Math.round(top)}px`, 'important');
  menu.style.display='flex';
}

function toggleCategoryMenu(id){
  if(openCategoryPlayerId===id){
    closeCategoryMenu();
    return;
  }
  openCategoryPlayerId=id;
  openGenderPlayerId=null;
  renderQueue();
  requestAnimationFrame(()=>positionCategoryMenu(id));
}

function closeCategoryMenu(){
  const menu=document.getElementById('queueCategoryPopup');
  const wasOpen=openCategoryPlayerId!==null;
  openCategoryPlayerId=null;
  if(menu)menu.style.display='none';
  if(wasOpen)renderQueue();
}

function formatWaitingDuration(minutes){
  const m=Math.max(0,Math.floor(Number(minutes)||0));
  if(m<60)return `${m}m`;
  const h=Math.floor(m/60);
  return `${h}h ${m%60}m`;
}
function waitingText(ts){
  const sec=Math.max(0,Math.floor((Date.now()-Number(ts||Date.now()))/1000));
  const m=Math.floor(sec/60);
  return `${formatWaitingDuration(m)} waiting`;
}
function checkInTime(ts){
  if(!ts)return '--';
  try{return new Date(Number(ts)).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});}catch(e){return '--';}
}
function waitingAfterCheckin(ts){
  if(!ts)return '';
  const sec=Math.max(0,Math.floor((Date.now()-Number(ts))/1000));
  if(sec<60)return '0m waiting';
  const m=Math.floor(sec/60);
  if(m<60)return `${m}m waiting`;
  const h=Math.floor(m/60);
  return `${h}h ${m%60}m waiting`;
}
function displayPlayerName(p){ if(!p)return ''; const full=String(p.name||'').trim(); const nick=String(p.nickname||'').trim(); return nick ? `${full} (${nick})` : full; }
function assignOneToCourt(pid,c){
  const p=player(pid); if(!p||!c||c.playing||c.players.filter(Boolean).length>=4||p.court)return false;
  // Fill the first empty slot without shifting any existing player between teams.
  let slot=c.players.findIndex(value=>!value);
  if(slot<0) slot=c.players.length;
  c.players[slot]=pid;p.court=c.id;state.queue=state.queue.filter(x=>x!==pid);return true;
}
function choosePlayerForCourt(playerId,courtId,silent=false){ choosePlayerForCourt(playerId,courtId); }

function importPlayers(){
  const raw=$('importText').value.trim(); if(!raw){toast('Paste player names first.');return;}
  let added=0;
  raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).forEach(line=>{
    const parts=line.split(',').map(x=>x.trim()); const name=parts[0]; if(!name)return;
    const gender=(parts[1]||'Male').toLowerCase()==='female'?'Female':'Male';
    let p=state.players.find(x=>x.name.toLowerCase()===name.toLowerCase());
    if(!p){p={id:state.nextPlayer++,name,wins:0,court:null,gender,category:'',queuedAt:Date.now(),waitingSince:Date.now()};state.players.push(p);}
    else {p.gender=gender;p.queuedAt=Date.now();p.waitingSince=p.queuedAt;}
    if(!p.court&&!state.queue.includes(p.id)){state.queue.push(p.id);added++;}
  });
  $('importText').value='';$('importModal').classList.add('hidden');state.players.forEach(upsertCloudPlayer);saveState();render();toast(`${added} player${added===1?'':'s'} imported.`);
}

function removePlayer(id){
  const p=player(id); if(!p)return;
  state.queue=state.queue.filter(x=>x!==id);
  state.courts.forEach(c=>c.players=c.players.filter(x=>x!==id));
  p.court=null;
  state.players=state.players.filter(x=>x.id!==id);
  state.lockedPartners=(state.lockedPartners||[]).filter(pair=>!pair.map(Number).includes(Number(id)));
  state.left.unshift(p);
  state.selectedCourt=null;
  saveState(); render(); toast(`${p.name} moved to Left Players.`);
}

function checkIn(id, resetCheckInTime=false){
  const p=state.left.find(x=>x.id===id); if(!p)return;
  state.left=state.left.filter(x=>x.id!==id);
  p.court=null;
  // Preserve the original check-in timestamp when a player returns from Left Players.
  // Reset it only when the player is checked in from Cloud Records.
  if(resetCheckInTime || !p.queuedAt) p.queuedAt=Date.now();
  p.waitingSince=Date.now();
  state.players.push(p); state.queue.push(p.id);
  saveState(); render(); toast(`${p.name} checked in.`);
}

function requestDeleteLeftPlayer(id){
  const p=state.left.find(x=>x.id===id);
  if(!p)return;
  state.pendingLeftDelete=id;
  render();
}

function cancelDeleteLeftPlayer(id){
  if(state.pendingLeftDelete===id)state.pendingLeftDelete=null;
  render();
}

function confirmDeleteLeftPlayer(id){
  if(state.pendingLeftDelete!==id)return;
  state.pendingLeftDelete=null;
  deleteLeftPlayer(id);
}

function getLeftPlayerLiveStats(p){
  const stats={matches:0,wins:0,losses:0};
  if(!p)return stats;
  const playerName=String(p.name||'').trim().toLowerCase();
  (state.logs||[]).forEach(log=>{
    const team1=Array.isArray(log.team1Ids)?log.team1Ids:[];
    const team2=Array.isArray(log.team2Ids)?log.team2Ids:[];
    const name1=String(log.winner||'').split(' & ').concat(String(log.loser||'').split(' & ')).map(n=>n.trim().toLowerCase());
    const idIn1=team1.some(id=>String(id)===String(p.id));
    const idIn2=team2.some(id=>String(id)===String(p.id));
    const nameInLog=playerName && name1.includes(playerName);
    if(!idIn1&&!idIn2&&!nameInLog)return;
    stats.matches++;
    const score=String(log.score||'').split('-').map(v=>Number(v.trim()));
    if(score.length===2&&Number.isFinite(score[0])&&Number.isFinite(score[1])&&score[0]!==score[1]){
      const wonByScore=(idIn1&&score[0]>score[1])||(idIn2&&score[1]>score[0]);
      if(wonByScore)stats.wins++;else stats.losses++;
    }else if(String(log.winner||'').toLowerCase().split(' & ').map(n=>n.trim()).includes(playerName)){
      stats.wins++;
    }else if(String(log.loser||'').toLowerCase().split(' & ').map(n=>n.trim()).includes(playerName)){
      stats.losses++;
    }
  });
  return stats;
}

function getVisibleLeftPlayers(){const activeNames=new Set(state.players.filter(sp=>state.queue.includes(sp.id)||!!sp.court||(state.courts||[]).some(c=>(c.players||[]).includes(sp.id))).map(sp=>String(sp.name||'').trim().toLowerCase()));return state.left.filter(p=>!activeNames.has(String(p.name||'').trim().toLowerCase()));}
function renderLeftPlayerRows(popup=false){
  const visibleLeft=getVisibleLeftPlayers();
  if(!visibleLeft.length)return '<div class="left-empty-state"><div class="left-empty-icon" aria-hidden="true">↩️</div><div class="left-empty-text">No left players yet</div></div>';
  const query=popup?String(($('leftPlayersSearch')&&$('leftPlayersSearch').value)||'').trim().toLowerCase():'';
  const filtered=popup?visibleLeft.filter(p=>{const st=getLeftPlayerLiveStats(p);return [p.name,p.nickname,p.gender,p.category,st.matches,st.wins,st.losses].join(' ').toLowerCase().includes(query);}):visibleLeft;
  if(popup){const summary=$('leftPlayersSearchSummary');if(summary)summary.textContent=`${filtered.length} of ${visibleLeft.length} player${visibleLeft.length===1?'':'s'}`;}
  if(!filtered.length)return '<div class="left-empty-state"><div class="left-empty-icon" aria-hidden="true">↩️</div><div class="left-empty-text">No matching left players found</div></div>';
  return filtered.map((p,index)=>{
    const pending=state.pendingLeftDelete===p.id;
    const liveStats=getLeftPlayerLiveStats(p);
    if(popup){
      const category=String(p.category||'—');
      const catClass=({'BEG':'beg','NOV':'nov','INT':'int','ADV':'adv','EXP':'exp'})[category.toUpperCase()]||'nov';
      const matches=liveStats.matches;
      return `<article class="cloud-player-card left-cloud-player-card ${pending?'delete-pending':''}">
        <div class="cloud-player-main">
          <div class="cloud-avatar"><span class="cloud-avatar-number">${index+1}</span>${esc((p.name||'?').charAt(0).toUpperCase())}</div>
          <div class="cloud-player-ident"><b>${esc(p.name||'Unknown')}${p.nickname?` (${esc(p.nickname)})`:''} <span class="cloud-gender ${p.gender==='Female'?'gender-female':'gender-male'}">${p.gender==='Female'?'♀':'♂'}</span></b>
            <small class="cloud-player-summary"><span class="cloud-category-badge skill-${catClass}">${esc(category)}</span><span class="cloud-player-stats"><span>${matches} Matches</span><span class="cloud-win">${liveStats.wins} Wins</span><span class="cloud-loss">${liveStats.losses} Losses</span></span></small>
          </div>
          <div class="cloud-player-actions"><button class="cloud-checkin-btn" ${pending?'disabled':''} onclick="event.stopPropagation();checkIn(${p.id})">Check in</button>${pending?'':`<button class="cloud-delete-btn" onclick="event.stopPropagation();requestDeleteLeftPlayer(${p.id})">Remove</button>`}</div>
        </div>
        ${pending?`<div class="cloud-delete-warning">Remove this player from the Left Players list? Their player records will remain saved. <button onclick="event.stopPropagation();confirmDeleteLeftPlayer(${p.id})">Confirm</button> <button class="left-cloud-cancel-confirm" onclick="event.stopPropagation();cancelDeleteLeftPlayer(${p.id})">Cancel</button></div>`:''}
      </article>`;
    }
    return `<div class="left-row ${pending?'delete-pending':''}"><div class="left-person"><div class="left-name">${esc(p.name)}</div><div class="queue-meta"><span>${liveStats.wins} wins</span></div></div><div class="left-row-actions"><button class="mini check" ${pending?'disabled':''} onclick="event.stopPropagation();checkIn(${p.id})">CHECK IN</button>${pending?`<button class="mini cancel-delete" onclick="event.stopPropagation();cancelDeleteLeftPlayer(${p.id})">CANCEL</button>`:''}<button class="left-delete ${pending?'delete-confirm':''}" onclick="event.stopPropagation();${pending?`confirmDeleteLeftPlayer(${p.id})`:`requestDeleteLeftPlayer(${p.id})`}">DELETE</button></div></div>`;
  }).join('');
}

function openLeftPlayersPopup(){
  renderLeftPlayersPopup();
  $('leftPlayersModal').classList.remove('hidden');
  /* Keep search unfocused on open so mobile keyboards do not launch automatically. */
}
function closeLeftPlayersPopup(){ $('leftPlayersModal').classList.add('hidden'); }
function renderLeftPlayersPopup(){
  const list=$('leftPlayersPopupList'); if(!list)return;
  const count=$('leftPopupCount'); if(count)count.textContent=`(${getVisibleLeftPlayers().length})`;
  list.innerHTML=renderLeftPlayerRows(true);
}

function deleteLeftPlayer(id){
  const p=state.left.find(x=>x.id===id);
  if(!p)return;
  // Remove only from the Left Players list; keep the player's saved records intact.
  state.left=state.left.filter(x=>x.id!==id);
  state.pendingLeftDelete=null;
  saveState(); render(); toast(`${p.name} removed from Left Players. Player records were kept.`);
}

function addQueue(id){
  const p=player(id); if(!p||p.court||state.queue.includes(id))return;
  state.queue.push(id); saveState(); render(); toast(`${p.name} added to queue.`);
}

function updateAddWaitingCourtButton(){
  const btn=$('addCourtBtn');
  if(!btn)return;
  const realCourtCount=state.courts.filter(c=>!c.waitingOnly).length;
  const canAdd=realCourtCount>0;
  btn.disabled=!canAdd;
  btn.setAttribute('aria-disabled',canAdd?'false':'true');
  btn.title=canAdd?'Add a Waiting Court':'Select a court from the Court List first.';
}

function addWaitingCourt(){
  // A Waiting Court can be added whenever at least one regular court exists in the Court List.
  // Selection is not required; only the existence of a regular court matters.
  const realCourtCount=state.courts.filter(c=>!c.waitingOnly).length;
  if(realCourtCount===0){
    toast('Add a court to the Court List first.');
    return;
  }
  const waitingOrder=Math.max(0,...state.courts.filter(c=>c.waitingOnly).map(c=>Number(c.waitingOrder)||0),Number(state.nextWaitingCourt||1)-1)+1;
  const name=`Waiting Court #${waitingOrder}`;
  const id=Date.now()+Math.floor(Math.random()*1000);
  state.courts.push({
    id, number:null, name, waitingOrder, players:[], playing:false, start:null, target:state.eventRules.target, winBy:state.eventRules.winBy, scores:[0,0], allowedSkills:[], waitingOnly:true
  });
  state.nextWaitingCourt=waitingOrder+1;
  state.selectedCourt=null;
  saveState();
  render();
  toast(`${name} added. Select 4 players for the next available court.`);
}

function openCourt(){
  const input=$('courtNameInput');
  if(input)input.value=`Court ${nextAvailableCourtNumber()}`;
  $('nextCourtPreview').textContent=`Next available: Court ${nextAvailableCourtNumber()}`;
  $('courtModal').classList.remove('hidden');
  setTimeout(()=>{if(input)input.focus();},0);
}
function closeCourt(){$('courtModal').classList.add('hidden')}

function saveCourt(){
  const requested=$('courtNameInput')?.value||'';
  const normalized=normalizeCourtEntry(requested);
  if(normalized?.error){toast(normalized.error);return;}
  const number=normalized?.number||nextAvailableCourtNumber();
  const name=normalized?.name||`Court ${number}`;
  state.courts.push({
    id:Date.now()+Math.floor(Math.random()*1000),
    number,
    name,
    players:[],
    playing:false,
    start:null,
    target:state.eventRules.target,
    winBy:state.eventRules.winBy,
    scores:[0,0],
    waitingOnly:true
  });
  closeCourt(); saveState(); render(); toast(`Court ${name} added.`);
}

function selectCourt(id){
  const c=court(id); if(!c)return;
  if(c.playing){toast('This court is already LIVE.');return;}
  if(c.players.filter(Boolean).length===4){
    state.selectedCourt=null;
    render();
    return;
  }
  if(state.selectedCourt===id){
    state.selectedCourt=null;
    render();
    toast('Court selector cancelled.');
    return;
  }
  state.selectedCourt=id;
  saveState();
  render();
}

function autoMatchVariety(courtId){
  const c=court(courtId);
  if(!c||c.playing)return;
  if(c.players.filter(Boolean).length===4){
    cancelReadyMatch(courtId);
    return;
  }

  const needed=4-c.players.filter(Boolean).length;
  const allowedSkills=Array.isArray(c.allowedSkills)?c.allowedSkills:[];
  const available=state.queue.map(player).filter(Boolean).filter(p=>!allowedSkills.length || allowedSkills.includes(p.category));
  if(available.length<needed){
    toast(`Need ${needed} more player${needed===1?'':'s'} in Queue. Only ${available.length} available.`);
    return;
  }
  const combos=[];
  function walk(index, chosen, count){
    if(count===needed){ combos.push(chosen.slice()); return; }
    if(count>needed || index>=available.length)return;
    for(let i=index;i<available.length;i++) walk(i+1, chosen.concat([available[i]]), count+1);
  }
  walk(0,[],0);

  // Locked partners are a single selection unit: never auto-match only one
  // member of a locked pair.
  const chosenIdsFor = combo => new Set(combo.map(p=>Number(p.id)));
  const validCombos = combos.filter(combo=>{
    const ids=chosenIdsFor(combo);
    for(const p of combo){
      const partnerId=getLockedPartnerId(p.id);
      if(partnerId==null) continue;
      if(c.players.includes(partnerId)) continue;
      const partner=player(partnerId);
      if(!partner || !available.some(x=>Number(x.id)===partnerId) || !ids.has(partnerId)) return false;
    }
    for(const pid of c.players.filter(Boolean)){
      const partnerId=getLockedPartnerId(pid);
      if(partnerId!=null && !c.players.includes(partnerId) && !ids.has(partnerId)) return false;
    }
    return true;
  });
  combos.length=0;
  combos.push(...validCombos);

  if(!combos.length){
    toast('No matching combination fits the remaining court slots.');
    return;
  }

  // Prefer gender variety, then players closest to the front of the Queue.
  const existing= c.players.map(player).filter(Boolean);
  const existingFemale=existing.filter(p=>p.gender==='Female').length;
  const existingMale=existing.length-existingFemale;
  const scored=combos.map(combo=>{
    const people=combo.flat();
    const female=existingFemale+people.filter(p=>p.gender==='Female').length;
    const male=existingMale+people.length-people.filter(p=>p.gender==='Female').length;
    const balance=Math.abs(female-male);
    const queueIndex=people.reduce((sum,p)=>sum+Math.max(0,state.queue.indexOf(p.id)),0);
    return {people,balance,queueIndex};
  }).sort((a,b)=>a.balance-b.balance || a.queueIndex-b.queueIndex);

  const chosen=scored[0].people;
  // Keep each locked pair in the same team (slots 0/1 or 2/3).
  const remaining=chosen.slice();
  for(let i=0;i<remaining.length;i++){
    const p=remaining[i];
    if(!p) continue;
    const partnerId=getLockedPartnerId(p.id);
    if(partnerId==null) continue;
    const j=remaining.findIndex((x,k)=>k!==i&&x&&Number(x.id)===partnerId);
    if(j<0 || j<i) continue;
    const firstEmpty=c.players.findIndex(v=>!v);
    const teamStarts=firstEmpty<2?[0,2]:[2,0];
    const start=teamStarts.find(st=>!c.players[st]&&!c.players[st+1]);
    if(start!==undefined){
      const partner=remaining[j];
      c.players[start]=p.id;c.players[start+1]=partner.id;
      p.court=c.id;partner.court=c.id;
      state.queue=state.queue.filter(id=>Number(id)!==Number(p.id)&&Number(id)!==Number(partner.id));
      remaining[i]=null;remaining[j]=null;
    }
  }
  remaining.filter(Boolean).forEach(p=>assignOneToCourt(p.id,c));
  state.selectedCourt=null;
  saveState();
  render();
  toast(`${courtDisplayName(c)} filled with 4 players and is ready.`);
}
function autoMatchEmptySlot(courtId,slotIndex){
  const c=court(courtId); if(!c||c.playing)return;
  // Empty slots are manual selection points: clicking one opens the player picker.
  state.selectedCourt=courtId;
  saveState();
  render();
}

let courtPickerFilters={category:'ALL',gender:'ALL',wait:0};

function filterCourtPicker(){
  const input=$('courtPickerSearch');
  const term=(input?.value||'').trim().toLowerCase();
  let visibleCount=0;

  document.querySelectorAll('.picker-player').forEach(btn=>{
    const name=btn.getAttribute('data-player-name')||'';
    const category=btn.getAttribute('data-category')||'';
    const gender=btn.getAttribute('data-gender')||'';
    const queuedAt=Number(btn.getAttribute('data-queued-at')||0);
    const wait=Math.max(0,Math.floor((Date.now()-(queuedAt||Date.now()))/60000));
    const okName=!term||name.includes(term);
    const okCategory=courtPickerFilters.category==='ALL'||category===courtPickerFilters.category;
    const okGender=courtPickerFilters.gender==='ALL'||gender===courtPickerFilters.gender;
    const okWait=!courtPickerFilters.wait||wait>=courtPickerFilters.wait;

    // Keep the wait badge live and automatically change its color by wait time.
    const waitBadge=btn.querySelector('.picker-wait');
    if(waitBadge){
      waitBadge.textContent=`⏱ ${formatWaitingDuration(wait)}`;
      waitBadge.classList.remove('wait-yellow','wait-red');
      if(wait>=15) waitBadge.classList.add('wait-red');
      else if(wait>=10) waitBadge.classList.add('wait-yellow');
    }

    const visible=okName&&okCategory&&okGender&&okWait;
    btn.classList.toggle('picker-hidden', !visible);
    if(visible) visibleCount++;
  });

  const empty=document.querySelector('.picker-player-list');
  if(empty){
    let msg=empty.querySelector('.picker-filter-empty');
    if(!visibleCount){
      if(!msg){msg=document.createElement('div');msg.className='picker-empty picker-filter-empty';empty.appendChild(msg);}
      msg.textContent='No players match the selected filters.';
      msg.style.display='block';
    }else if(msg){
      msg.style.display='none';
    }
  }
}

function setCourtPickerFilter(type,value,button){
  courtPickerFilters[type]=value;
  const group=button?.closest('.picker-filter-row');
  if(group){
    group.querySelectorAll('.picker-filter').forEach(b=>{
      b.classList.toggle('active',
        b.dataset.filterType===type && String(b.dataset.filterValue)===String(value)
      );
    });
  }
  filterCourtPicker();
}

function cancelCourtPicker(courtId){
  const c=court(courtId);
  if(!c||c.playing)return;
  state.selectedCourt=null;
  saveState();
  render();
  toast('Court player picker cancelled.');
}

function cancelReadyMatch(courtId){
  const c=court(courtId);
  if(!c||c.playing||!c.players.length)return;
  c.players.forEach(pid=>{
    const p=player(pid);
    if(p){p.court=null;if(!p.queuedAt)p.queuedAt=Date.now();if(!state.queue.includes(pid))state.queue.push(pid);}
  });
  c.players=[];
  state.selectedCourt=null;
  saveState();
  render();
  toast(`${courtDisplayName(c)} players returned to Queue.`);
}

function announcePlayers(courtId){
  const c=court(courtId); if(!c||c.players.length!==4)return;
  // Using another live action dismisses a pending delete confirmation first.
  const pendingDeleteFooter=document.querySelector(`.live-footer[data-court="${courtId}"].delete-confirming`);
  if(pendingDeleteFooter)cancelDeleteMatch(courtId);
  const names=c.players.map(id=>player(id)).filter(Boolean).map(p=>p.name);
  const team1=names.slice(0,2).join(' and ');
  const team2=names.slice(2,4).join(' and ');
  const message=`Please Proceed to Court number ${c.number}. ${team1} Versus ${team2}.`;
  if('speechSynthesis' in window){
    window.speechSynthesis.cancel();
    const utterance=new SpeechSynthesisUtterance(message);
    utterance.rate=0.95;
    window.speechSynthesis.speak(utterance);
  }
  toast(message);
}

function handleQueuePlayerClick(playerId){
  const p=player(playerId); if(!p)return;
  if(state.selectedCourt){
    choosePlayerForCourt(playerId,state.selectedCourt);
    return;
  }
  const target=state.courts
    .filter(c=>!c.waitingOnly && !c.playing && c.players.filter(Boolean).length<4)
    .sort((a,b)=>(Number(a.number)||9999)-(Number(b.number)||9999))[0];
  if(!target){toast('No empty court slot available. Add a court or select a court with an empty slot.');return;}
  choosePlayerForCourt(playerId,target.id);
}

function choosePlayerForCourt(playerId,courtId){
  const p=player(playerId),c=court(courtId);
  if(!p||!c)return;
  if(c.playing){toast('The match is already LIVE.');return;}
  if(c.players.filter(Boolean).length>=4){toast('Maximum 4 players on a court.');return;}
  if(p.court){toast(`${p.name} is already on a court.`);return;}

  let slot=c.players.findIndex(value=>!value); if(slot<0) slot=c.players.length;
  const partnerId=getLockedPartnerId(playerId);
  const partner=partnerId?player(partnerId):null;
  const partnerAvailable=partner&&state.queue.includes(partnerId)&&!partner.court;
  const teammateSlot=slot%2===0?slot+1:slot-1;
  // A locked player may only enter a court together with their locked partner.
  // Unlocking removes this restriction and lets either player pair freely.
  if(partnerId && !partnerAvailable){
    toast(`${p.name} is locked with ${partner?.name||'their partner'}. Return both players to Queue and place them together, or unlock the pair first.`);return;
  }
  if(partnerAvailable){
    if(teammateSlot<0||teammateSlot>=4||c.players[teammateSlot]){
      toast(`${p.name} is locked with ${partner.name}. Choose an available team pair of court slots.`);return;
    }
    c.players[slot]=playerId;p.court=c.id;
    c.players[teammateSlot]=partnerId;partner.court=c.id;
    state.queue=state.queue.filter(id=>Number(id)!==Number(playerId)&&Number(id)!==Number(partnerId));
    toast(`${p.name} & ${partner.name} added to Court ${c.name} as locked partners.`);
  }else{
    c.players[slot]=playerId; p.court=c.id;
    state.queue=state.queue.filter(x=>x!==playerId);
    toast(`${p.name} added to Court ${c.name}.`);
  }
  if(c.players.filter(Boolean).length===4&&state.selectedCourt===c.id)state.selectedCourt=null;
  saveState(); render();
}

function removePlayerFromCourt(playerId,courtId){
  const c=court(courtId), p=player(playerId);
  if(!c||!p||c.playing)return;
  // Leave the slot empty in place; never shift Team 2 players into Team 1 (or vice versa).
  const slotIndex=c.players.indexOf(playerId);
  if(slotIndex>=0)c.players[slotIndex]=null;
  p.court=null;
  if(!p.queuedAt) p.queuedAt=Date.now();
  if(!state.queue.includes(playerId))state.queue.push(playerId);
  state.selectedCourt=c.id;
  saveState(); render();
  toast(`${p.name} returned to Queue.`);
}

function mixCourt(id){
  const c=court(id); if(!c || (!c.playing && c.players.length!==4))return;
  // Using another live action dismisses a pending delete confirmation first.
  const pendingDeleteFooter=document.querySelector(`.live-footer[data-court="${id}"].delete-confirming`);
  if(pendingDeleteFooter)cancelDeleteMatch(id);
  // The manual MIX TEAMS action intentionally mixes all four court players,
  // even when a locked-in pair exists. Lock-in rules still apply to queue
  // selection and auto-match; this button is an explicit manual override.
  const mixedPlayers=c.players.slice();
  for(let i=mixedPlayers.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [mixedPlayers[i],mixedPlayers[j]]=[mixedPlayers[j],mixedPlayers[i]];
  }
  // Avoid a no-op shuffle when possible so the button visibly mixes teams.
  if(mixedPlayers.length===4 && mixedPlayers.every((pid,i)=>Number(pid)===Number(c.players[i]))){
    [mixedPlayers[0],mixedPlayers[2]]=[mixedPlayers[2],mixedPlayers[0]];
  }
  c.players=mixedPlayers;
  c.scores=[0,0];
  saveState(); render();
  toast(`Court ${c.name}: teams mixed.`);
}

function scoreInputs(id){return [...document.querySelectorAll(`.score-input[data-court="${id}"]`)];}

function scoreState(id){
  const c=court(id);
  const values=scoreInputs(id).map(x=>x.value.trim());
  const nums=values.map(v=>v===''?0:Number(v));
  const valid=nums.length===2 && nums.every(n=>Number.isInteger(n)&&n>=0);
  const hasScore=nums.some(n=>n>0);
  const tie=nums.length===2 && nums[0]===nums[1];
  const reachedTarget=c ? nums.some(n=>n>=c.target) : false;
  return {nums,valid,hasScore,tie,reachedTarget};
}

function updateSubmitState(id){
  const footer=document.querySelector(`.live-footer[data-court="${id}"]`);
  const s=scoreState(id);
  const c=court(id);
  if(c && s.nums.length===2 && s.valid){c.scores=[s.nums[0],s.nums[1]]; saveState();}
  const validScore=s.valid&&s.hasScore&&!s.tie;
  const currentScore=`${s.nums[0]}-${s.nums[1]}`;

  // If the score changes while the Submit Score confirmation is open,
  // automatically close the confirmation and return to the normal footer.
  if(footer?.classList.contains('submit-confirming')){
    const confirmedScore=footer.dataset.confirmScore||'';
    if(confirmedScore!==currentScore){
      footer.classList.remove('submit-confirming');
      footer.dataset.confirmScore='';
      footer.innerHTML=`<button class="cancel-match" data-court="${c.id}" onclick="requestCancelMatch(${c.id})">Delete Match</button><button class="submit-score" data-court="${c.id}" onclick="requestSubmitScore(${c.id})" ${validScore?'':'disabled'}>Submit Score</button>`;
      return;
    }
  }

  const btn=footer?.querySelector(`.submit-score[data-court="${id}"]`);
  if(!btn)return;

  // A cancelled confirmation keeps Submit Score disabled until the score is changed.
  const cancelledScore=btn.dataset.cancelledScore||'';
  const sameCancelledScore=cancelledScore!=='' && cancelledScore===currentScore;
  if(sameCancelledScore){
    btn.disabled=true;
  }else{
    if(cancelledScore && cancelledScore!==currentScore) btn.dataset.cancelledScore='';
    btn.disabled=!validScore;
  }

}

function setScore(id,team,delta){
  const c=court(id); if(!c||!c.playing)return;
  const input=document.querySelector(`.score-input[data-court="${id}"][data-team="${team}"]`);
  if(!input)return;
  const current=Math.max(0,parseInt(input.value||'0',10)||0);
  input.value=Math.max(0,current+delta);
  c.scores[team-1]=Number(input.value);
  saveState();
  updateSubmitState(id);
}

function toggleCourtExpand(courtId){
  const c=court(courtId);
  if(!c)return;
  const ps=(c.players||[]).map(player).filter(Boolean);
  if(!ps.length){
    openNoPlayersCourtModal(courtId);
    return;
  }
  openCourtPlayersModal(courtId);
}

function openCourtPlayersModal(courtId){
  const c=court(courtId);
  if(!c)return;
  const ps=(c.players||[]).map(player).filter(Boolean);
  const body=$('courtPlayersModalBody');
  if(!body)return;

  const target=Number(c.target)||11;
  const winBy=Number(c.winBy)||1;
  const isWaitingCourt=!!c.waitingOnly;
  const started=c.playing&&c.start ? elapsed(c.start) : (isWaitingCourt ? '0:00' : '--');
  const courtName=isWaitingCourt ? 'Court #' : courtDisplayName(c);
  const genderIcon=p=>p?.gender==='Female'?'♀':'♂';
  const courtStats=getRankingStats();
  const playerCard=(p,index)=>{
    if(!p)return `<div class="court-lineup-player court-lineup-empty"><span class="court-lineup-avatar">${index+1}</span><div class="court-lineup-player-info"><b>Open slot</b></div></div>`;
    const category=String(p.category||'CAT').toUpperCase();
    const categoryClass=category.toLowerCase().replace(/[^a-z0-9_-]/g,'');
    const genderClass=p.gender==='Female'?'female':'male';
    return `<div class="court-lineup-player">
      <span class="court-lineup-avatar ${genderClass}">${esc(initial(p.name))}</span>
      <div class="court-lineup-player-info">
        <div class="court-lineup-name"><b>${esc(displayPlayerName(p))}</b><span class="court-lineup-gender ${genderClass}">${genderIcon(p)}</span><span class="court-lineup-category skill-${categoryClass}">${esc(category)}</span></div>
      </div>
    </div>`;
  };
  const detailPlayerRow=(p,teamClass)=>{
    if(!p)return '';
    const st=courtStats.get(p.id)||{wins:0,losses:0};
    const category=String(p.category||'CAT');
    const categoryClass=p.category?`skill-${String(p.category).toLowerCase().replace(/[^a-z0-9_-]/g,'')}`:'';
    return `<div class="detail-player-row ${teamClass}"><span class="dot"></span><div class="detail-player-info"><b>${esc(displayPlayerName(p))}</b><span class="detail-row-gender ${p.gender==='Female'?'female':'male'}" aria-label="${esc(p.gender||'Unknown')}">${genderIcon(p)}</span><span class="mini-badge ${categoryClass}">${esc(category)}</span></div><small>${Number(st.wins)||0}W · ${Number(st.losses)||0}L</small></div>`;
  };

  body.innerHTML=`
    <div class="court-lineup-top">
      <div class="court-lineup-title"><span class="court-lineup-court-icon" aria-hidden="true">🏟️</span><b>${esc(courtName)}</b></div>
      <div class="court-lineup-count ${isWaitingCourt?'waiting':''}"><span class="court-lineup-dot"></span><span>${isWaitingCourt?'Waiting':'Playing'}</span><b>${ps.length}/4</b></div>
    </div>
    <div class="court-lineup-divider"></div>
    <div class="court-lineup-meta">
      <span class="court-lineup-time ${isWaitingCourt?'waiting':''}" id="courtLineupTime-${c.id}">${esc(started)}</span>
      <span class="court-lineup-rule">To ${target} (win by ${winBy})</span>
    </div>
    <div class="court-lineup-divider"></div>
    <div class="court-lineup-teams">
      <div class="court-lineup-team">
        ${playerCard(ps[0],0)}${playerCard(ps[1],1)}
      </div>
      <div class="court-lineup-vs">VS</div>
      <div class="court-lineup-team">
        ${playerCard(ps[2],2)}${playerCard(ps[3],3)}
      </div>
    </div>
    <div class="detail-players court-lineup-detail-players"><h4>PLAYERS</h4>${ps.slice(0,2).map(p=>detailPlayerRow(p,'team-one-dot')).join('')}${ps.slice(2,4).map(p=>detailPlayerRow(p,'team-two-dot')).join('')}</div>
    <div class="court-lineup-footer"><button class="court-lineup-close" type="button" onclick="closeCourtPlayersModal()">Close</button></div>
  `;
  body.dataset.courtId=String(c.id);
  $('courtPlayersModal').classList.remove('hidden');
  updateCourtPlayersModalTimer(c.id);
}
function courtLineupTimerClass(start){
  if(!start)return 'timer-blue';
  const sec=Math.max(0,Math.floor((Date.now()-new Date(start).getTime())/1000));
  if(sec>=900)return 'timer-red';
  if(sec>=600)return 'timer-amber';
  return 'timer-blue';
}

function updateCourtPlayersModalTimer(courtId){
  const c=court(courtId);
  if(!c)return;
  const timeEl=$(`courtLineupTime-${c.id}`);
  if(!timeEl)return;
  if(c.waitingOnly){
    timeEl.textContent='0:00';
    timeEl.classList.remove('timer-blue','timer-amber','timer-red');
    timeEl.classList.add('waiting');
    return;
  }
  if(!c.playing)return;
  timeEl.textContent=elapsed(c.start);
  timeEl.classList.remove('waiting','timer-blue','timer-amber','timer-red');
  timeEl.classList.add(courtLineupTimerClass(c.start));
}

function closeCourtPlayersModal(){
  $('courtPlayersModal').classList.add('hidden');
}

function renderExpandedCourtPlayers(c){
  return '';
}

function requestSubmitScore(id){
  if(!state.recordScores)return;
  const c=court(id); if(!c||!c.playing)return;
  const s=scoreState(id);
  if(!s.hasScore){toast('Enter a score before submitting.');return;}
  if(!s.valid){toast('Scores must be whole numbers.');return;}
  if(s.tie){toast('Scores cannot be tied.');return;}

  const footer=document.querySelector(`.live-footer[data-court="${id}"]`);
  const btn=footer?.querySelector(`.submit-score[data-court="${id}"]`);
  if(!footer||!btn)return;

  const currentScore=`${s.nums[0]}-${s.nums[1]}`;

  // First click opens the inline Submit Score confirmation note.
  if(btn.dataset.confirming!=='true'){
    btn.dataset.confirming='true';
    btn.dataset.confirmScore=currentScore;
    footer.classList.add('submit-confirming');
    footer.dataset.confirmScore=currentScore;
    footer.innerHTML=`
      <button class="cancel-match delete-match-disabled" type="button" disabled aria-disabled="true">Delete Match</button>
      <button class="submit-score submit-score-disabled" data-court="${c.id}" type="button" disabled aria-disabled="true">Submit Score</button>
      <div class="submit-score-note">
        <span>Submit this score? This will end the live match.</span>
        <div class="submit-score-note-actions">
          <button class="submit-score-confirm-btn" type="button" onclick="confirmSubmitScore(${id})">Confirm</button>
          <button class="submit-score-cancel-btn" type="button" onclick="cancelSubmitScore(${id})">Cancel</button>
        </div>
      </div>`;
    return;
  }
}

function cancelSubmitScore(id){
  const c=court(id); if(!c||!c.playing)return;
  const s=scoreState(id);
  const score=`${s.nums[0]}-${s.nums[1]}`;
  const footer=document.querySelector(`.live-footer[data-court="${id}"]`);
  if(!footer)return;
  footer.classList.remove('submit-confirming');
  footer.innerHTML=`<button class="cancel-match" data-court="${c.id}" onclick="requestCancelMatch(${c.id})">Delete Match</button><button class="submit-score" data-court="${c.id}" onclick="requestSubmitScore(${c.id})">Submit Score</button>`;
}

function confirmSubmitScore(id){
  const c=court(id); if(!c||!c.playing)return;
  const s=scoreState(id);
  const currentScore=`${s.nums[0]}-${s.nums[1]}`;
  const footer=document.querySelector(`.live-footer[data-court="${id}"]`);
  if(!footer)return;
  const confirmScore=footer.querySelector('.submit-score-confirm-btn')?.dataset?.score || null;
  const scoreAtConfirmation=footer.dataset.confirmScore || currentScore;
  if(scoreAtConfirmation!==currentScore){
    footer.classList.remove('submit-confirming');
    updateSubmitState(id);
    toast('Score changed. Please confirm the new score.');
    return;
  }
  submitScore(id);
}

function promoteWaitingCourtTo(courtId){
  const preferred=court(courtId);
  // Waiting Courts are only queue/holding slots. When a real matchmaking court
  // becomes available, move the next complete waiting group into that real court,
  // but DO NOT start the match automatically. The players must appear in the
  // normal matchmaking area first so the operator can review them and click
  // START MATCHMAKING manually.
  const available=state.courts
    .filter(c=>!c.waitingOnly && !c.playing && c.players.filter(Boolean).length===0)
    .sort((a,b)=>(Number(a.number)||9999)-(Number(b.number)||9999));
  if(!available.length)return false;

  const active=preferred && !preferred.waitingOnly && !preferred.playing && preferred.players.length===0
    ? preferred
    : available[0];

  const waiting=state.courts
    .filter(c=>c.waitingOnly && !c.playing && c.players.filter(Boolean).length===4)
    .sort((a,b)=>(Number(a.waitingOrder)||9999)-(Number(b.waitingOrder)||9999))[0];
  if(!waiting)return false;

  const players=waiting.players.filter(Boolean).slice(0,4);
  active.players=players;
  active.playing=false;
  active.start=null;
  active.scores=[0,0];

  players.forEach(pid=>{
    const p=player(pid);
    if(p){
      p.court=active.id;
      state.queue=state.queue.filter(x=>x!==pid);
    }
  });

  // The waiting slot is consumed once its four players are promoted.
  state.courts=state.courts.filter(x=>x.id!==waiting.id);

  // Keep remaining waiting slots compact and ordered.
  const remainingWaiting=state.courts
    .filter(c=>c.waitingOnly)
    .sort((a,b)=>(Number(a.waitingOrder)||9999)-(Number(b.waitingOrder)||9999));
  remainingWaiting.forEach((c,index)=>{
    c.waitingOrder=index+1;
    c.name=`Waiting Court #${index+1}`;
  });
  state.nextWaitingCourt=remainingWaiting.length+1;

  state.selectedCourt=null;
  return active;
}

function submitScore(id){
  if(!state.recordScores)return;
  const c=court(id); if(!c||!c.playing||c.players.length!==4)return;
  const s=scoreState(id);
  if(!s.hasScore){toast('SUBMIT is locked. Enter a score first.');return;}
  if(!s.valid){toast('Scores must be whole numbers.');return;}
  if(s.tie){toast('Scores cannot be tied.');return;}
  const winningTeam=s.nums[0]>s.nums[1]?1:2;
  completeMatchResult(id,winningTeam,s.nums);
}

function recordMatchWin(id,winningTeam){
  if(state.recordScores)return;
  const c=court(id);
  if(!c||!c.playing||c.players.length!==4)return;
  const teamNumber=Number(winningTeam);
  if(teamNumber!==1&&teamNumber!==2)return;
  completeMatchResult(id,teamNumber,null);
}

function completeMatchResult(id,winningTeamNumber,recordedScores=null){
  const c=court(id); if(!c||!c.playing||c.players.length!==4)return;
  const team1=c.players.slice(0,2).map(player).filter(Boolean);
  const team2=c.players.slice(2,4).map(player).filter(Boolean);
  if(team1.length!==2||team2.length!==2){toast('All 4 match players must be present.');return;}
  const winningTeam=winningTeamNumber===1?team1:team2;
  const losingTeam=winningTeamNumber===1?team2:team1;
  const winningNames=winningTeam.map(p=>p.name).join(' & ');
  const losingNames=losingTeam.map(p=>p.name).join(' & ');
  winningTeam.forEach(p=>p.wins++);
  const endedAt=new Date();
  // Save the active event rule with the completed match, rather than a stale target.
  const savedRaceTarget=[11,15,21].includes(Number(state.eventRules?.target))
    ? Number(state.eventRules.target) : (Number(c.target)||11);
  c.target=savedRaceTarget;
  const team1Names=team1.map(p=>p.name), team2Names=team2.map(p=>p.name);
  state.logs.push({
    id:state.nextLog++, court:c.name, courtNumber:c.number,
    winner:winningNames, loser:losingNames,
    score:Array.isArray(recordedScores)?`${recordedScores[0]}-${recordedScores[1]}`:null,
    recordingMode:Array.isArray(recordedScores)?'score':'win-only',
    winnerTeam:winningTeamNumber,
    team1Ids:team1.map(p=>p.id), team2Ids:team2.map(p=>p.id),
    team1Names, team2Names,
    team1Players:team1.map(p=>({id:p.id,name:p.name,nickname:p.nickname||'',gender:p.gender||'',category:p.category||''})),
    team2Players:team2.map(p=>({id:p.id,name:p.name,nickname:p.nickname||'',gender:p.gender||'',category:p.category||''})),
    startedAt:c.start, endedAt:endedAt.toISOString(), duration:elapsed(c.start), target:savedRaceTarget, type:'Doubles', sessionName:state.sessionName||''
  });

  c.players.forEach(pid=>{
    const p=player(pid);
    if(p){p.court=null;p.queuedAt=p.queuedAt||Date.now();p.waitingSince=Date.now();if(!state.queue.includes(pid))state.queue.push(pid)}
  });
  c.players=[]; c.playing=false; c.start=null; c.scores=[0,0];
  state.selectedCourt=null;

  const promoted=promoteWaitingCourtTo(c.id);
  saveState(); render();
  const scoreText=Array.isArray(recordedScores)?` (${recordedScores[0]}–${recordedScores[1]})`:'';
  if(promoted){
    toast(`${winningNames} won${scoreText}! +1 win each. Next Waiting Court moved to ${courtDisplayName(promoted)} — review the players, then click START MATCHMAKING.`);
  }else{
    toast(`${winningNames} won${scoreText}! Result recorded.`);
  }
}

function startMatch(id){
  const c=court(id); if(!c)return;
  if(c.waitingOnly){toast(`${courtDisplayName(c)} is a Waiting Court. It will move to the next available matchmaking court automatically.`);return;}
  if(c.players.filter(Boolean).length!==4){toast('Choose exactly 4 players before starting matchmaking.');return;}
  // Snapshot the current top-bar rules when this match starts.
  c.target=[11,15,21].includes(Number(state.eventRules?.target))?Number(state.eventRules.target):(Number(c.target)||11);
  c.winBy=[1,2,3].includes(Number(state.eventRules?.winBy))?Number(state.eventRules.winBy):(Number(c.winBy)||1);
  c.playing=true; c.start=new Date(); c.scores=[0,0];
  if(state.selectedCourt===id)state.selectedCourt=null;
  saveState(); render(); toast(`${courtDisplayName(c)} is now LIVE.`);
}

function requestCancelMatch(id){
  const c=court(id); if(!c||!c.playing)return;
  const footer=document.querySelector(`.live-footer[data-court="${id}"]`);
  if(!footer)return;
  footer.classList.add('delete-confirming');
  // Keep the original action buttons in place while showing the confirmation.
  // This prevents the footer grid from changing widths during confirmation.
  const actionButtons=state.recordScores
    ? `<button class="cancel-match" data-court="${c.id}" onclick="requestCancelMatch(${c.id})">Delete Match</button><button class="submit-score" data-court="${c.id}" onclick="requestSubmitScore(${c.id})" disabled>Submit Score</button>`
    : `<button class="cancel-match" data-court="${c.id}" onclick="requestCancelMatch(${c.id})">Delete Match</button><div class="live-actions live-actions-win-only"><button class="announce" onclick="announcePlayers(${c.id})">♬ Announce Players</button><div class="mix-action-wrap"><button class="mix-live" onclick="mixCourt(${c.id})">⇄ Mix Teams</button></div></div>`;
  footer.innerHTML=`${actionButtons}
    <div class="delete-match-note">
      <span>Delete this match? Players will be returned to the queue.</span>
      <div class="delete-match-note-actions">
        <button class="delete-match-confirm-btn" type="button" onclick="confirmCancelMatch(${id})">Confirm</button>
        <button class="delete-match-cancel-btn" type="button" onclick="cancelDeleteMatch(${id})">Cancel</button>
      </div>
    </div>`;
}

function cancelDeleteMatch(id){
  const c=court(id); if(!c||!c.playing)return;
  const footer=document.querySelector(`.live-footer[data-court="${id}"]`);
  if(!footer)return;
  footer.classList.remove('delete-confirming');
  if(state.recordScores){
    const s=scoreState(id);
    const canSubmit=s.valid && s.hasScore && !s.tie;
    footer.classList.remove('win-only-footer');
    footer.innerHTML=`<button class="cancel-match" data-court="${c.id}" onclick="requestCancelMatch(${c.id})">Delete Match</button><button class="submit-score" data-court="${c.id}" onclick="requestSubmitScore(${c.id})" ${canSubmit?'':'disabled'}>Submit Score</button>`;
  }else{
    footer.classList.add('win-only-footer');
    footer.innerHTML=`<button class="cancel-match" data-court="${c.id}" onclick="requestCancelMatch(${c.id})">Delete Match</button><div class="live-actions live-actions-win-only"><button class="announce" onclick="announcePlayers(${c.id})">♬ Announce Players</button><div class="mix-action-wrap"><button class="mix-live" onclick="mixCourt(${c.id})">⇄ Mix Teams</button></div></div>`;
  }
}
function confirmCancelMatch(id){
  const c=court(id); if(!c||!c.playing)return;
  cancelMatch(id);
}

function cancelMatch(id){
  const c=court(id); if(!c||!c.playing)return;
  c.players.forEach(pid=>{
    const p=player(pid);
    if(p){p.court=null;p.queuedAt=p.queuedAt||Date.now();p.waitingSince=Date.now();if(!state.queue.includes(pid))state.queue.push(pid)}
  });
  c.players=[]; c.playing=false; c.start=null; c.scores=[0,0];
  state.selectedCourt=null;
  saveState(); render(); toast(`${courtDisplayName(c)} match cancelled. Players returned to Queue.`);
}

function requestRemoveCourt(id){
  const c=court(id); if(!c)return;
  if(c.playing){toast('Finish or cancel the LIVE match before removing the court.');return;}
  if(state.pendingRemoveCourt===id){
    removeCourtNow(id);
    return;
  }
  state.pendingRemoveCourt=id;
  render();
}

function cancelRemoveCourt(id){
  if(state.pendingRemoveCourt!==id)return;
  state.pendingRemoveCourt=null;
  render();
}

function removeCourtNow(id){
  const c=court(id); if(!c)return;
  state.pendingRemoveCourt=null;
  if(c.playing){toast('Finish or cancel the LIVE match before removing the court.');return;}
  c.players.forEach(pid=>{
    const p=player(pid);
    if(p){p.court=null;if(!p.queuedAt)p.queuedAt=Date.now();if(!state.queue.includes(pid))state.queue.push(pid)}
  });
  state.courts=state.courts.filter(x=>x.id!==id);
  if(state.selectedCourt===id)state.selectedCourt=null;
  saveState(); render(); toast(`${courtDisplayName(c)} removed.`);
}

function timerToneClass(start){
  if(!start)return 'timer-normal';
  const sec=Math.max(0,Math.floor((Date.now()-new Date(start).getTime())/1000));
  if(sec>=900)return 'timer-red';
  if(sec>=600)return 'timer-yellow';
  return 'timer-normal';
}

function elapsed(start){
  if(!start)return '00:00';
  const sec=Math.max(0,Math.floor((Date.now()-new Date(start).getTime())/1000));
  return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
}

function updateRegistrationDuplicateMessage(){
  const input=$('registerFullname');
  const message=$('registrationDuplicateMessage');
  if(!input||!message)return;
  const fullname=String(input.value||'').trim();
  if(!fullname){message.textContent='';message.hidden=true;return;}
  loadCloudRecords();
  const normalized=fullname.toLocaleLowerCase();
  const match=cloudRecords.players.find(p=>String(p.name||'').trim().toLocaleLowerCase()===normalized);
  if(match){message.textContent=`player "${match.name}" is registered already`;message.hidden=false;}
  else{message.textContent='';message.hidden=true;}
}

function updateRegistrationSaveButton(){
  const fullname=String($('registerFullname')?.value||'').trim();
  const saveBtn=$('registerSaveBtn');
  if(saveBtn) saveBtn.disabled=!(fullname && registrationGender && registrationSkillLevel);
  updateRegistrationDuplicateMessage();
}

function selectRegistrationSkill(level){
  const value=String(level||'').toUpperCase();
  if(!['BEG','NOV','INT','ADV','EXP'].includes(value))return;
  registrationSkillLevel=value;
  document.querySelectorAll('.registration-skill-btn').forEach(btn=>{
    const selected=btn.dataset.skill===value;
    btn.classList.toggle('selected',selected);
    btn.setAttribute('aria-pressed',selected?'true':'false');
  });
  updateRegistrationSaveButton();
}

function clearRegistrationSkill(){
  registrationSkillLevel='';
  document.querySelectorAll('.registration-skill-btn').forEach(btn=>{
    btn.classList.remove('selected');
    btn.setAttribute('aria-pressed','false');
  });
  updateRegistrationSaveButton();
}

function saveRegisteredPlayer(){
  const fullname=$('registerFullname').value.trim(), nickname=$('registerNickname').value.trim();
  if(!fullname){toast('Enter the full name.');return;}
  if(!registrationGender){toast('Select Male or Female.');return;}
  if(!registrationSkillLevel){toast('Select a skill level.');return;}
  const existing=state.players.find(p=>p.name.toLowerCase()===fullname.toLowerCase());
  if(existing){
    existing.nickname=nickname; existing.gender=registrationGender;
    if(registrationSkillLevel) existing.category=registrationSkillLevel;
    if(!existing.court && !state.queue.includes(existing.id)){ existing.queuedAt=existing.queuedAt||Date.now(); existing.waitingSince=Date.now(); state.queue.push(existing.id); }
    upsertCloudPlayer(existing); saveState(); render(); toast(`${fullname} registered and added to Queue.`); showQueueMain(); return;
  }
  const p={id:state.nextPlayer++,name:fullname,nickname,wins:0,court:null,gender:registrationGender,category:registrationSkillLevel||'',queuedAt:Date.now(),waitingSince:Date.now()};
  state.players.push(p);
  state.queue.push(p.id);
  upsertCloudPlayer(p);
  state.sessionMetrics.newRegistered=(Number(state.sessionMetrics.newRegistered)||0)+1;
  saveState(); render(); toast(`${fullname} registered and added to Queue.`); showQueueMain();
}
function renderRegisteredSearch(){
  const area=$('registeredPlayerResults'); if(!area)return;
  const input=$('registeredPlayerSearch');
  const q=String(input?.value||'').trim().toLowerCase();
  if(!q){area.innerHTML='';return;}
  const normalize=v=>String(v??'').trim().toLowerCase();
  const matches=state.players.filter(p=>{
    const hay=[
      p.name, p.nickname, p.opgId, p.opgID, p.opg_id, p.playerId, p.playerID, p.id
    ].map(normalize).join(' ');
    return hay.includes(q);
  }).slice(0,12);
  area.innerHTML=matches.map(p=>{
    const alreadyQueued=state.queue.includes(p.id);
    return `<button type="button" class="registered-result ${alreadyQueued?'already-queued':''}" onclick="addRegisteredToQueue(${p.id})"><span><b>${esc(displayPlayerName(p))}</b><small>${p.gender==='Female'?'♀ Female':'♂ Male'} • ${p.category||'CAT'} • ${p.wins}W${p.opgId?` • OPG ${esc(p.opgId)}`:''}</small></span><strong>${alreadyQueued?'✓ QUEUED':'＋ QUEUE'}</strong></button>`;
  }).join('')||'<div class="registered-search-hint">No registered player found.</div>';
}
function addRegisteredToQueue(id){
  const p=player(id); if(!p)return;
  if(p.court){toast(`${p.name} is currently on a court.`);return;}
  if(state.queue.includes(id)){toast(`${p.name} is already in Queue.`);return;}
  p.queuedAt=p.queuedAt||Date.now(); p.waitingSince=Date.now(); state.queue.push(id); saveState(); render(); toast(`${p.name} added to Queue.`);
}

function getLockedPartnerId(playerId){
  const pair=(state.lockedPartners||[]).find(ids=>ids.map(Number).includes(Number(playerId)));
  return pair?Number(pair.find(id=>Number(id)!==Number(playerId))):null;
}
function areLockedPartners(playerA,playerB){
  return (state.lockedPartners||[]).some(pair=>pair.length===2&&pair.map(Number).includes(Number(playerA))&&pair.map(Number).includes(Number(playerB)));
}
function toggleLockInPartner(playerId,partnerId){
  playerId=Number(playerId);partnerId=Number(partnerId);
  if(!playerId||!partnerId||playerId===partnerId)return;
  const a=player(playerId),b=player(partnerId);
  if(!a||!b||!state.queue.includes(playerId)||!state.queue.includes(partnerId)){
    toast('Both players must be in the Queue List to lock in partners.');return;
  }
  const existing=(state.lockedPartners||[]).find(pair=>pair.map(Number).includes(playerId)&&pair.map(Number).includes(partnerId));
  if(existing){state.lockedPartners=state.lockedPartners.filter(pair=>pair!==existing);document.querySelector(`.queue-player-details[data-queue-player-id="${playerId}"]`)?.removeAttribute('open');saveState();render();toast('Lock-in partner removed.');return;}
  // A player can only be locked with one partner at a time.
  state.lockedPartners=(state.lockedPartners||[]).filter(pair=>!pair.map(Number).includes(playerId)&&!pair.map(Number).includes(partnerId));
  state.lockedPartners.push([playerId,partnerId]);
  // Close the selector after choosing a partner; the locked pair remains visible in Queue List.
  document.querySelector(`.queue-player-details[data-queue-player-id="${playerId}"]`)?.removeAttribute('open');
  saveState();render();toast(`${a.name} & ${b.name} locked in as partners.`);
}
const lockPartnerSearchValues={};
function filterLockInPartnerOptions(playerId){
  const input=document.querySelector(`.queue-lock-partner-search[data-player-id="${Number(playerId)}"]`);
  const root=input?.closest('.queue-lock-partner');if(!root)return;
  const query=String(input.value||'').trim().toLowerCase();
  root.querySelectorAll('.queue-lock-partner-option').forEach(option=>{
    option.hidden=!option.querySelector('span')?.textContent.toLowerCase().includes(query);
  });
}
function openQueueLockPartnerList(playerId){
  const details=document.querySelector(`.queue-player-details[data-queue-player-id="${Number(playerId)}"]`);
  if(!details)return;
  // The lock button is a true toggle: open the picker on first click and
  // close it on the next click, without changing the queue row layout.
  const shouldOpen=!details.open;
  document.querySelectorAll('.queue-player-details[open]').forEach(openDetails=>{
    if(openDetails!==details) openDetails.removeAttribute('open');
  });
  if(shouldOpen){
    details.open=true;
    const list=details.querySelector('.queue-lock-partner-list');
    if(list) list.scrollTop=0;
    const search=details.querySelector('.queue-lock-partner-search');
    if(search) requestAnimationFrame(()=>search.focus({preventScroll:true}));
  }else{
    details.open=false;
  }
  const trigger=document.querySelector(`.queue-row-actions .queue-lock-open-btn[aria-controls="queue-lock-list-${Number(playerId)}"]`);
  if(trigger) trigger.setAttribute('aria-expanded',String(details.open));
}
function renderLockInPartnerChoices(playerId){
  const partnerId=getLockedPartnerId(playerId);
  // Only show Queue List players who do not already have a locked-in partner.
  const candidates=state.queue.filter(id=>Number(id)!==Number(playerId)&&getLockedPartnerId(id)==null).map(id=>player(id)).filter(Boolean);
  const searchValue=String(lockPartnerSearchValues[Number(playerId)]||'');
  const options=candidates.map(candidate=>`<button type="button" class="queue-lock-partner-option" title="Lock in ${esc(displayPlayerName(candidate))}" aria-label="Lock in ${esc(displayPlayerName(candidate))}" onclick="event.stopPropagation();toggleLockInPartner(${playerId},${candidate.id})"><span class="queue-lock-partner-option-ident"><span class="queue-lock-partner-option-name">${esc(displayPlayerName(candidate))}</span><span class="queue-lock-partner-option-meta"><span class="queue-lock-partner-gender ${candidate.gender==='Female'?'female':'male'}" aria-label="${candidate.gender==='Female'?'Female':'Male'}">${candidate.gender==='Female'?'♀':'♂'}</span><span class="queue-lock-partner-category ${candidate.category?'skill-'+String(candidate.category).toLowerCase():''}">${esc(candidate.category||'—')}</span></span></span><span class="queue-lock-partner-option-state" aria-hidden="true">🔓</span></button>`).join('');
  return `<div class="queue-lock-partner"><div class="queue-lock-partner-heading">Lock in partner</div><span class="queue-lock-partner-divider" aria-hidden="true"></span><div class="queue-lock-partner-search-wrap"><svg class="queue-lock-partner-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="M16 16l4 4"></path></svg><input class="queue-lock-partner-search" data-player-id="${Number(playerId)}" type="search" placeholder="Search players..." aria-label="Search lock in partner players" value="${esc(searchValue)}" oninput="lockPartnerSearchValues[${Number(playerId)}]=this.value;filterLockInPartnerOptions(${Number(playerId)})" onclick="event.stopPropagation()"></div><div class="queue-lock-partner-list ${candidates.length>=5?'has-scroll':''}">${options||'<small class="queue-lock-partner-empty">No other players in the Queue List.</small>'}</div></div>`;
}
function renderQueue(){
  const queueCountBadge=$('queueCountBadge');
  // Paddle Stack count = everyone currently active: players waiting in Queue
  // plus players currently playing on courts. A player is counted only once.
  const queuedIds=new Set(state.queue);
  const playingIds=new Set(
    state.courts.flatMap(c=>Array.isArray(c.players)?c.players:[])
  );
  const activePlayerCount=new Set([...queuedIds,...playingIds]).size;
  if(queueCountBadge)queueCountBadge.textContent=`(${activePlayerCount})`;
  // The gender menu is portaled to <body> so no queue/panel overflow can clip it.
  cleanupGenderMenuPortal();
  const q=$('queueList');
  const search=($('registeredPlayerSearch')?.value ?? $('searchQueue')?.value ?? '').trim().toLowerCase();
  const ids=state.queue.filter(id=>{const p=player(id);const hay=`${p?.name||''} ${p?.nickname||''}`.toLowerCase();return p&&(!search||hay.includes(search));});
  const rankingStats=getRankingStats();
  // Preserve expanded player/lock-in details while the 1-second waiting timer refreshes the queue.
  const previouslyOpenQueueDetails=new Set([...q.querySelectorAll('.queue-player-details[open]')].map(d=>Number(d.dataset.queuePlayerId)));
  $('queueEmpty').style.display=ids.length?'none':'flex';
  q.innerHTML=ids.map((id,i)=>{
    const p=player(id);
    const gender=p.gender==='Female'?'Female':'Male';
    const st=rankingStats.get(p.id)||{matches:0,wins:0,losses:0};
    const opgId=p.opgId||p.opgID||p.opg_id||'';
    const duprId=p.duprId||p.duprID||p.dupr_id||p.dupr||'';
    const levelChange=p.levelChange||p.levelChanged||p.levelChangeNotice||'';
    const rating=p.rating||p.ratingLevel||p.rankLevel||'';
    const lockedPartnerId=getLockedPartnerId(id);
    const lockedPartner=lockedPartnerId?player(lockedPartnerId):null;
    return `<div class="queue-item queue-modern-item ${lockedPartner?'has-locked-partner':''}" data-player-id="${id}">
      <div class="queue-avatar-stack">
        <div class="queue-avatar ${gender==='Female'?'female':'male'}">${initial(p.name)}</div>
        <span class="queue-position-badge">${i+1}</span>
      </div>
      <div class="queue-main-info">
        <div class="queue-name-line">
          <span class="queue-name">${esc(displayPlayerName(p))}</span>
          <span class="queue-gender-inline">
            <span class="gender-inline ${gender==='Female'?'female':'male'}" title="Gender" aria-label="Gender">${gender==='Female'?'♀':'♂'}</span>
          </span>
        </div>
        <div class="queue-stats-line">
          <span class="queue-cat-stack">
            <span class="queue-cat-wrap"><button type="button" data-player-id="${id}" class="category-trigger ${p.category?'skill-'+p.category.toLowerCase():''}" title="Skill category" onclick="event.stopPropagation();toggleCategoryMenu(${id})">${p.category||'CAT'}</button></span>
          </span>
          <span class="queue-record-badge">${st.matches} match${st.matches===1?'':'es'} (${st.wins}W-${st.losses}L)</span>
        </div>
        <div class="queue-time-line">
          <span class="queue-checkin-inline">⏱︎ ${esc(checkInTime(p.queuedAt))}</span>
          <span class="queue-time-separator">·</span>
          <span class="queue-waiting-line" data-player-id="${id}">${esc(waitingAfterCheckin(p.waitingSince||p.queuedAt))}</span>
          ${lockedPartner?`<button type="button" class="queue-locked-partner-inline" title="Click to unlock partner" aria-label="Unlock ${esc(String(lockedPartner.name||'').trim().split(/\s+/)[0]||displayPlayerName(lockedPartner))}" onclick="event.stopPropagation();toggleLockInPartner(${id},${lockedPartner.id})">🔒${esc(String(lockedPartner.name||'').trim().split(/\s+/)[0]||displayPlayerName(lockedPartner))}</button>`:''}
        </div>
      </div>
      <div class="queue-row-actions">
        <button type="button" class="queue-lock-open-btn ${lockedPartner?'is-locked':'is-unlocked'}" ${lockedPartner?'disabled aria-disabled="true" title="Disabled — player is locked in with a partner" aria-label="Lock-in partner selection disabled while partner is locked"':'title="No locked-in partner — click to choose one" aria-label="Open lock-in partner list"'} aria-expanded="${previouslyOpenQueueDetails.has(Number(id))?'true':'false'}" aria-controls="queue-lock-list-${id}" onclick="event.stopPropagation();openQueueLockPartnerList(${id})"><span class="queue-lock-icon" aria-hidden="true">${lockedPartner?'🔒':'🔓'}</span></button>
        <button class="xbtn player-x" title="Move to Left Players" aria-label="Move to Left Players" onclick="event.stopPropagation();removePlayer(${id})"><svg class="queue-action-icon queue-x-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg></button>
      </div>
      <details class="queue-player-details" id="queue-lock-list-${id}" data-queue-player-id="${id}"${previouslyOpenQueueDetails.has(Number(id))?' open':''}>
        <summary aria-label="Show player and lock-in partner details"><span class="queue-player-details-line"></span></summary>
        ${renderLockInPartnerChoices(id)}
      </details>
    </div>`;
  }).join('');

  // Portal the selector to <body>, then position it against the actual trigger.
  if(openGenderPlayerId!==null){
    const menu=q.querySelector(`.gender-menu-pending[data-player-id="${openGenderPlayerId}"]`);
    if(menu){
      menu.classList.remove('gender-menu-pending');
      menu.classList.add('gender-menu-portal');
      document.body.appendChild(menu);
    }
    requestAnimationFrame(()=>positionGenderMenu(openGenderPlayerId));
  }

  const sc=state.selectedCourt?court(state.selectedCourt):null;
  const note=$('selectedCourtNote');
  if(sc){note.classList.add('show');note.textContent=`${courtDisplayName(sc)} SELECTED — use an empty court slot to add players.`}
  else {note.classList.add('show');note.textContent='Select an empty court slot to choose a player.';}

  $('leftCount').textContent=state.left.length;
  const left=$('leftPlayersQueue');
  left.innerHTML=renderLeftPlayerRows(false);
  renderLeftPlayersPopup();
  const leftSection=document.querySelector('.left-section');
  if(leftSection){
    leftSection.classList.add('collapsed');
    leftSection.classList.remove('expanded');
    const count=$('leftCount'); if(count)count.textContent=`(${state.left.length})`;
  }
}
function initial(name){ const n=String(name||'').trim(); return n ? esc(n.charAt(0).toUpperCase()) : 'P'; }


function werePairedBefore(playerAId, playerBId){
  // Match Log is the only source of truth. Pairing is recalculated on every render,
  // so removing/re-adding a player in picker-player-list or ready-match-sheet does
  // not erase historical pairing. Empty logs always mean no prior pairing.
  if(playerAId==null || playerBId==null || String(playerAId)===String(playerBId)) return false;
  const logs=Array.isArray(state.logs)?state.logs:[];
  if(!logs.length) return false;

  const findPlayer=(id)=>[...(state.players||[]),...(state.left||[])].find(p=>String(p.id)===String(id));
  const aliasesFor=(id)=>{
    const p=findPlayer(id);
    return new Set(p?[p.name,p.nickname,displayPlayerName(p)].filter(Boolean).map(normalizePairName).filter(Boolean):[]);
  };
  const aAliases=aliasesFor(playerAId), bAliases=aliasesFor(playerBId);
  const matchesEntry=(entry,id,aliases)=>{
    if(entry==null) return false;
    if(typeof entry==='object'){
      const eid=entry.id??entry.playerId??entry.player_id??entry.userId;
      if(eid!=null && String(eid)===String(id)) return true;
      return [entry.name,entry.fullName,entry.nickname,entry.displayName].filter(Boolean)
        .map(normalizePairName).some(n=>aliases.has(n));
    }
    const raw=String(entry).trim();
    return raw===String(id) || aliases.has(normalizePairName(raw));
  };
  const teamEntries=(log,team)=>{
    const ids=Array.isArray(log[`${team}Ids`])?log[`${team}Ids`]:[];
    const names=Array.isArray(log[`${team}Names`])?log[`${team}Names`]:[];
    const players=Array.isArray(log[`${team}Players`])?log[`${team}Players`]:[];
    const count=Math.max(ids.length,names.length,players.length);
    const entries=[];
    for(let i=0;i<count;i++){
      const obj=players[i] && typeof players[i]==='object' ? {...players[i]} : {};
      if(obj.id==null && ids[i]!=null) obj.id=ids[i];
      if(!obj.name && names[i]!=null) obj.name=names[i];
      // Keep each player's id/name paired by index; do not independently match
      // one player against an ID array and the other against a different name.
      if(obj.id!=null || obj.name || obj.nickname) entries.push(obj);
    }
    return entries;
  };
  return logs.some(log=>{
    if(!log) return false;
    // Entries in state.logs are match-log records; support older saved log formats
    // without endedAt, but require actual team membership data and a score/finish marker.
    const finished=!!log.endedAt || !!log.completed || !!log.finishedAt || (!!String(log.score||'').trim() && log.score!=='--');
    if(!finished) return false;
    for(const team of ['team1','team2']){
      const entries=teamEntries(log,team);
      const hasA=entries.some(e=>matchesEntry(e,playerAId,aAliases));
      const hasB=entries.some(e=>matchesEntry(e,playerBId,bAliases));
      if(hasA && hasB) return true;
    }
    return false;
  });
}

function normalizePairName(value){
  return String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
}

function readySlot(p,courtId,slotIndex){
  if(!p){
    return `<div class="team-player tap-slot empty-slot" onclick="autoMatchEmptySlot(${courtId},${slotIndex})">Tap a player below</div>`;
  }
  const genderClass=p.gender==='Female'?'female':'male';
  const initialLetter=initial(p.name);
  const category=p.category||'CAT';
  // Pairing is determined by the actual fixed slot beside this player, not partnerId.
  // This keeps the indicator stable when a player is removed and returned to the queue.
  const c=state.courts.find(x=>String(x.id)===String(courtId));
  const teammateSlot=slotIndex%2===0?slotIndex+1:slotIndex-1;
  const teammateId=c&&Array.isArray(c.players)?c.players[teammateSlot]:null;
  const paired=teammateId!=null && !!player(teammateId) && werePairedBefore(p.id,teammateId);
  const lockedPartnerId=getLockedPartnerId(p.id);
  // Show the lock icon only while the locked-in pair are teammates on this court.
  // MIX TEAMS keeps the lock-in relationship saved, but hides the icon when they
  // land on opposite teams; it returns automatically when they are paired again.
  const lockedOnCourt=lockedPartnerId!=null && teammateId!=null && Number(teammateId)===Number(lockedPartnerId);
  return `<div class="team-player tap-slot filled-slot ${paired?'paired-before-player':''}" onclick="selectCourt(${courtId})"><span class="slot-player-name"><span class="slot-gender ${genderClass}">${initialLetter}</span><span class="slot-player-text">${esc(displayPlayerName(p))}</span><span class="slot-gender-icon ${genderClass}" aria-label="${p.gender}">${p.gender==='Female'?'♀':'♂'}</span><span class="slot-category ${p.category?'skill-'+String(p.category).toLowerCase():''}">${esc(category)}</span></span>${lockedOnCourt?'<span class="slot-lock-icon" title="Locked-in partner" aria-label="Locked-in partner">🔒</span>':''}<button class="slot-remove" title="Remove player from court" onclick="event.stopPropagation();removePlayerFromCourt(${p.id},${courtId})">×</button></div>`;
}

function pickerCandidatePairedBefore(courtId, candidateId){
  const c=state.courts.find(x=>String(x.id)===String(courtId));
  if(!c || !Array.isArray(c.players) || !Array.isArray(state.logs) || !state.logs.length) return false;
  // assignOneToCourt fills the first empty slot without shifting any other player.
  let targetSlot=c.players.findIndex(pid=>!pid);
  if(targetSlot<0) targetSlot=c.players.length;
  if(targetSlot>=4) return false;
  const teammateSlot=targetSlot%2===0?targetSlot+1:targetSlot-1;
  const teammateId=c.players[teammateSlot];
  return teammateId!=null && String(teammateId)!==String(candidateId) && !!player(teammateId) && werePairedBefore(teammateId,candidateId);
}

function moveWaitingCourt(courtId,direction){
  const waitingCourts=state.courts
    .filter(c=>c.waitingOnly)
    .sort((a,b)=>(Number(a.waitingOrder)||9999)-(Number(b.waitingOrder)||9999));
  const index=waitingCourts.findIndex(c=>String(c.id)===String(courtId));
  if(index<0)return;
  const targetIndex=index+(direction==='up'?-1:1);
  if(targetIndex<0||targetIndex>=waitingCourts.length)return;
  const current=waitingCourts[index];
  const target=waitingCourts[targetIndex];
  const currentOrder=Number(current.waitingOrder)||index+1;
  const targetOrder=Number(target.waitingOrder)||targetIndex+1;
  current.waitingOrder=targetOrder;
  current.name=`Waiting Court #${targetOrder}`;
  target.waitingOrder=currentOrder;
  target.name=`Waiting Court #${currentOrder}`;
  state.nextWaitingCourt=waitingCourts.length+1;
  saveState();
  render();
}

function renderCourts(){
  const realCourts=state.courts.filter(c=>!c.waitingOnly);
  const waitingCourts=state.courts.filter(c=>c.waitingOnly).sort((a,b)=>(Number(a.waitingOrder)||9999)-(Number(b.waitingOrder)||9999));
  $('courtCount').textContent=`(${realCourts.length})`;
  $('courtsList').innerHTML=realCourts.map(c=>{
    const slots=[0,1,2,3].map(i=>player(c.players[i]));
    const ps=slots.filter(Boolean);
    const team1=slots.slice(0,2), team2=slots.slice(2,4);
    const selected=state.selectedCourt===c.id;

    if(c.playing){
      const score1=c.scores[0]||0;
      const score2=c.scores[1]||0;
      return `<div class="court-card court-live-card">
        <div class="court-box live-box">
          <div class="court-head live-head">
            ${renderCourtTitle(c)}
            <div class="court-head-right"><button class="court-expand" ${ps.length ? '' : 'disabled'} title="${ps.length ? 'Expand court' : 'Court is empty'}" aria-label="${ps.length ? 'Expand court' : 'Court is empty'}" aria-disabled="${ps.length ? 'false' : 'true'}" onclick="toggleCourtExpand(${c.id})">⛶</button><span class="status live"><span class="status-dot"></span> Playing</span></div>
          </div>
          <div class="live-meta"><span id="timer-${c.id}" class="live-timer ${timerToneClass(c.start)}">${elapsed(c.start)}</span><span>To ${c.target} (win by ${c.winBy})</span></div>
          ${renderExpandedCourtPlayers(c)}

          <div class="matchmaking-sheet">
            <div class="match-team team-one">
              <div class="match-players">
                <div class="match-player"><span class="avatar orange">${initial(team1[0]?.name)}</span><div class="match-player-line"><b>${esc(team1[0]?displayPlayerName(team1[0]):'Player 1')}</b><span class="match-gender ${team1[0]?.gender==='Female'?'female':'male'}">${team1[0]?.gender==='Female'?'♀':'♂'}</span><span class="match-category ${team1[0]?.category?'skill-'+String(team1[0].category).toLowerCase():''}">${esc(team1[0]?.category||'CAT')}</span></div></div>
                <div class="match-player second"><span class="avatar orange-light">${initial(team1[1]?.name)}</span><div class="match-player-line"><b>${esc(team1[1]?displayPlayerName(team1[1]):'Player 2')}</b><span class="match-gender ${team1[1]?.gender==='Female'?'female':'male'}">${team1[1]?.gender==='Female'?'♀':'♂'}</span><span class="match-category ${team1[1]?.category?'skill-'+String(team1[1].category).toLowerCase():''}">${esc(team1[1]?.category||'CAT')}</span></div></div>
              </div>
              ${state.recordScores ? `<div class="score-control"><button onclick="setScore(${c.id},1,-1)">−</button><input class="score-input" data-court="${c.id}" data-team="1" type="number" min="0" step="1" value="${score1}" oninput="updateSubmitState(${c.id})"><button class="score-plus" onclick="setScore(${c.id},1,1)">+</button></div>` : `<button type="button" class="team-win-btn team-one-win-btn" onclick="recordMatchWin(${c.id},1)" aria-label="Record Team 1 win">🏆 WIN</button>`}
            </div>

            <div class="match-vs">VS</div>

            <div class="match-team team-two">
              <div class="match-players">
                <div class="match-player"><span class="avatar gray">${initial(team2[0]?.name)}</span><div class="match-player-line"><b>${esc(team2[0]?displayPlayerName(team2[0]):'Player 3')}</b><span class="match-gender ${team2[0]?.gender==='Female'?'female':'male'}">${team2[0]?.gender==='Female'?'♀':'♂'}</span><span class="match-category ${team2[0]?.category?'skill-'+String(team2[0].category).toLowerCase():''}">${esc(team2[0]?.category||'CAT')}</span></div></div>
                <div class="match-player second"><span class="avatar gray-light">${initial(team2[1]?.name)}</span><div class="match-player-line"><b>${esc(team2[1]?displayPlayerName(team2[1]):'Player 4')}</b><span class="match-gender ${team2[1]?.gender==='Female'?'female':'male'}">${team2[1]?.gender==='Female'?'♀':'♂'}</span><span class="match-category ${team2[1]?.category?'skill-'+String(team2[1].category).toLowerCase():''}">${esc(team2[1]?.category||'CAT')}</span></div></div>
              </div>
              ${state.recordScores ? `<div class="score-control"><button onclick="setScore(${c.id},2,-1)">−</button><input class="score-input" data-court="${c.id}" data-team="2" type="number" min="0" step="1" value="${score2}" oninput="updateSubmitState(${c.id})"><button class="score-plus" onclick="setScore(${c.id},2,1)">+</button></div>` : `<button type="button" class="team-win-btn team-two-win-btn" onclick="recordMatchWin(${c.id},2)" aria-label="Record Team 2 win">🏆 WIN</button>`}
            </div>
          </div>

          ${state.recordScores ? `<div class="live-actions">
            <div class="mix-action-wrap">
              <button class="mix-live" onclick="mixCourt(${c.id})">⇄ Mix Teams</button>
            </div>
            <button class="announce" onclick="announcePlayers(${c.id})">♬ Announce Players</button>
          </div>` : ''}
          <div class="live-footer ${state.recordScores?'':'win-only-footer'}" data-court="${c.id}"><button class="cancel-match" data-court="${c.id}" onclick="requestCancelMatch(${c.id})">Delete Match</button>${state.recordScores ? `<button class="submit-score" data-court="${c.id}" onclick="requestSubmitScore(${c.id})" disabled>Submit Score</button>` : `<div class="live-actions live-actions-win-only"><button class="announce" onclick="announcePlayers(${c.id})">♬ Announce Players</button><div class="mix-action-wrap"><button class="mix-live" onclick="mixCourt(${c.id})">⇄ Mix Teams</button></div></div>`}</div>
        </div>
      </div>`;
    }

    return `<div class="court-card court-ready-card"><div class="court-box ready-box">
      <div class="court-head ready-head">${renderCourtTitle(c)}<div class="court-head-right"><button class="court-expand" ${ps.length ? '' : 'disabled'} title="${ps.length ? 'Expand court' : 'Court is empty'}" aria-label="${ps.length ? 'Expand court' : 'Court is empty'}" aria-disabled="${ps.length ? 'false' : 'true'}" onclick="event.stopPropagation();toggleCourtExpand(${c.id})">⛶</button>${state.pendingRemoveCourt===c.id ? '' : `<button class="court-remove court-x-delete" title="Delete court" aria-label="Delete court" onclick="event.stopPropagation();requestRemoveCourt(${c.id})">❌</button>`}<span class="status ready"><span class="status-dot ready"></span> Ready</span></div></div>
      ${state.pendingRemoveCourt===c.id ? `<div class="court-delete-confirm-row"><span class="court-delete-message">Remove this court?</span><button class="court-confirm-yes" onclick="event.stopPropagation();requestRemoveCourt(${c.id})">Yes, Remove</button><button class="court-confirm-no" onclick="event.stopPropagation();cancelRemoveCourt(${c.id})">No</button></div>` : ''}
      <div class="ready-meta"><div class="ready-meta-left"><span class="ready-selected">${ps.length}/4 <b>players selected</b></span>${(c.allowedSkills||[]).length?`<span class="ready-skill-list">${['BEG','NOV','INT','ADV','EXP'].filter(cat=>(c.allowedSkills||[]).includes(cat)).map(cat=>`<span class="ready-skill-chip skill-${cat.toLowerCase()}">${cat}</span>`).join('')}</span>`:''}</div><span class="ready-meta-hint">${c.waitingOnly?'Next for available court':'Ready for matchmaking'}</span></div>
      ${renderExpandedCourtPlayers(c)}
      <div class="ready-match-sheet">
        <div class="ready-match-team ready-team-one ${!!team1[0] && !!team1[1] && werePairedBefore(team1[0].id,team1[1].id)?'has-paired-before':''}">
          <div class="ready-team-heading">TEAM 1${!!team1[0] && !!team1[1] && werePairedBefore(team1[0].id,team1[1].id)?' <span class="paired-before-label">(Paired Before)</span>':''}</div>
          <div class="ready-team-players">
            ${readySlot(team1[0],c.id,0)}
            ${readySlot(team1[1],c.id,1)}
          </div>
        </div>
        <div class="ready-match-vs">VS</div>
        <div class="ready-match-team ready-team-two ${!!team2[0] && !!team2[1] && werePairedBefore(team2[0].id,team2[1].id)?'has-paired-before':''}">
          <div class="ready-team-heading">TEAM 2${!!team2[0] && !!team2[1] && werePairedBefore(team2[0].id,team2[1].id)?' <span class="paired-before-label">(Paired Before)</span>':''}</div>
          <div class="ready-team-players">
            ${readySlot(team2[0],c.id,2)}
            ${readySlot(team2[1],c.id,3)}
          </div>
        </div>
      </div>
      ${selected && ps.length<4 ? `<div class="court-picker"><div class="picker-title"><div class="picker-search-wrap"><span class="picker-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="M16 16l4 4"></path></svg></span><input id="courtPickerSearch" class="picker-search" type="search" placeholder="Search player..." autocomplete="off" oninput="filterCourtPicker()"></div><div class="picker-filter-row category-filters"><button type="button" class="picker-filter ${courtPickerFilters.category==='ALL'?'active':''}" data-filter-type="category" data-filter-value="ALL" onclick="setCourtPickerFilter('category','ALL',this)">All (${state.queue.length})</button>${['BEG','NOV','INT','ADV','EXP'].map(cat=>{const n=state.queue.filter(pid=>player(pid)?.category===cat).length;return `<button type="button" class="picker-filter skill-${cat.toLowerCase()} ${courtPickerFilters.category===cat?'active':''}" data-filter-type="category" data-filter-value="${cat}" onclick="setCourtPickerFilter('category','${cat}',this)">${cat} (${n})</button>`}).join('')}</div><div class="picker-filter-row gender-filters"><button type="button" class="picker-filter ${courtPickerFilters.gender==='ALL'?'active':''}" data-filter-type="gender" data-filter-value="ALL" onclick="setCourtPickerFilter('gender','ALL',this)">All (${state.queue.length})</button><button type="button" class="picker-filter gender-male ${courtPickerFilters.gender==='Male'?'active':''}" data-filter-type="gender" data-filter-value="Male" onclick="setCourtPickerFilter('gender','Male',this)">♂ M (${state.queue.filter(pid=>player(pid)?.gender==='Male').length})</button><button type="button" class="picker-filter gender-female ${courtPickerFilters.gender==='Female'?'active':''}" data-filter-type="gender" data-filter-value="Female" onclick="setCourtPickerFilter('gender','Female',this)">♀ F (${state.queue.filter(pid=>player(pid)?.gender==='Female').length})</button></div><div class="picker-filter-row wait-filters"><button type="button" class="picker-filter ${courtPickerFilters.wait===0?'active':''}" data-filter-type="wait" data-filter-value="0" onclick="setCourtPickerFilter('wait',0,this)">⏱︎ All (${state.queue.length})</button><button type="button" class="picker-filter ${courtPickerFilters.wait===5?'active':''}" data-filter-type="wait" data-filter-value="5" onclick="setCourtPickerFilter('wait',5,this)">⏱︎ 5m+ (${state.queue.filter(pid=>{const q=player(pid);return q&&(Date.now()-(q.waitingSince||q.queuedAt||Date.now()))>=300000}).length})</button><button type="button" class="picker-filter ${courtPickerFilters.wait===10?'active':''}" data-filter-type="wait" data-filter-value="10" onclick="setCourtPickerFilter('wait',10,this)">⏱︎ 10m+ (${state.queue.filter(pid=>{const q=player(pid);return q&&(Date.now()-(q.waitingSince||q.queuedAt||Date.now()))>=600000}).length})</button><button type="button" class="picker-filter ${courtPickerFilters.wait===15?'active':''}" data-filter-type="wait" data-filter-value="15" onclick="setCourtPickerFilter('wait',15,this)">⏱︎ 15m+ (${state.queue.filter(pid=>{const q=player(pid);return q&&(Date.now()-(q.waitingSince||q.queuedAt||Date.now()))>=900000}).length})</button></div></div><div class="picker-player-list">${state.queue.slice().sort((a,b)=>{const pa=player(a),pb=player(b);return (Number(pa?.waitingSince||pa?.queuedAt||Date.now())-Number(pb?.waitingSince||pb?.queuedAt||Date.now()))||(Number(a)-Number(b));}).map(pid=>{const qp=player(pid);if(!qp)return '';const wait=Math.max(0,Math.floor((Date.now()-(qp.waitingSince||qp.queuedAt||Date.now()))/60000));return `<button class="picker-player ${pickerCandidatePairedBefore(c.id,qp.id)?'paired-before-player':''}" data-player-name="${esc(`${displayPlayerName(qp)} ${qp.nickname||''}`).toLowerCase()}" data-category="${esc(qp.category||'')}" data-gender="${esc(qp.gender||'')}" data-queued-at="${Number(qp.waitingSince||qp.queuedAt||Date.now())}" data-wait="${wait}" onclick="choosePlayerForCourt(${pid},${c.id})"><span class="picker-info"><span class="picker-meta"><b>${esc(displayPlayerName(qp))}</b><span class="picker-gender ${qp.gender==='Female'?'female':'male'}">${qp.gender==='Female'?'♀':'♂'}</span><span class="picker-category ${qp.category?'skill-'+qp.category.toLowerCase():''}">${esc(qp.category||'CAT')}</span>${getLockedPartnerId(qp.id)!=null?`<span class="partner-inline-badge" title="Locked-in partner"><span class="partner-inline-lock" aria-hidden="true">🔒</span><span class="partner-inline-name">${esc(String(player(getLockedPartnerId(qp.id))?.name||'').trim().split(/\s+/)[0]||displayPlayerName(player(getLockedPartnerId(qp.id))))}</span></span>`:''}${pickerCandidatePairedBefore(c.id,qp.id)?'<span class="paired-before-label picker-paired-before">(Paired Before)</span>':''}</span></span></span><span class="picker-wait ${wait>=15?'wait-red':wait>=10?'wait-yellow':''}">⏱ ${formatWaitingDuration(wait)}</span></button>`}).join('')||'<div class="picker-empty">No players waiting in Queue.</div>'}</div></div>` : ''}
      <div class="ready-actions ready-actions-v2">
        ${selected && ps.length<4
          ? `<button class="ready-cancel active picker-cancel" onclick="cancelCourtPicker(${c.id})">CANCEL</button>
             <button class="auto-match-ready" onclick="autoMatchVariety(${c.id})">AUTO-MATCH VARIETY</button>
             ${c.waitingOnly?`<button class="start" disabled>WAITING FOR COURT</button>`:`<button class="start" onclick="startMatch(${c.id})" disabled>START MATCHMAKING</button>`}`
          : `<button class="ready-cancel ${ps.length===4?'active':''}" onclick="${ps.length===4?`cancelReadyMatch(${c.id})`:`autoMatchVariety(${c.id})`}">${ps.length===4?'CANCEL MATCH':'AUTO-MATCH VARIETY'}</button>
             <button class="mix-live" onclick="mixCourt(${c.id})" ${ps.length!==4?'disabled':''}>⇄ MIX TEAMS</button>
             ${c.waitingOnly?`<button class="start" disabled>${ps.length===4?'WAITING FOR COURT':'WAITING COURT'}</button>`:`<button class="start" onclick="startMatch(${c.id})" ${ps.length!==4?'disabled':''}>START MATCHMAKING</button>`}` }
      </div>
    </div></div>`;  }).join('')||'<div class="court-empty-state"><div class="court-empty-icon" aria-hidden="true">🏟️</div><div class="court-empty-text">No courts yet. Click "Add Court" to set up your courts!</div></div>';

  const waitingHtml=waitingCourts.map(c=>{
    const slots=[0,1,2,3].map(i=>player(c.players[i]));
    const ps=slots.filter(Boolean), selected=state.selectedCourt===c.id;
    const team1=slots.slice(0,2), team2=slots.slice(2,4);
    return `<div class="court-card waiting-court-card"><div class="court-box ready-box waiting-box">
      <div class="court-head ready-head waiting-head"><div class="court-title"><span class="court-logo" aria-hidden="true">🏟️</span><b>Court #</b></div><div class="court-head-right"><span class="waiting-order-controls" role="group" aria-label="Reorder waiting court"><button type="button" class="waiting-order-btn waiting-order-up" ${waitingCourts.indexOf(c)===0?'disabled':''} title="Move waiting court up" aria-label="Move waiting court up" onclick="event.stopPropagation();moveWaitingCourt(${c.id},'up')"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 7.5 6 4.5l3 3"/></svg></button><button type="button" class="waiting-order-btn waiting-order-down" ${waitingCourts.indexOf(c)===waitingCourts.length-1?'disabled':''} title="Move waiting court down" aria-label="Move waiting court down" onclick="event.stopPropagation();moveWaitingCourt(${c.id},'down')"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg></button></span><button class="court-expand" ${ps.length ? '' : 'disabled'} title="${ps.length ? 'Expand court' : 'Court is empty'}" aria-label="${ps.length ? 'Expand court' : 'Court is empty'}" aria-disabled="${ps.length ? 'false' : 'true'}" onclick="event.stopPropagation();toggleCourtExpand(${c.id})">⛶</button>${state.pendingRemoveCourt===c.id ? '' : `<button class="court-remove court-x-delete" title="Delete waiting court" aria-label="Delete waiting court" onclick="event.stopPropagation();requestRemoveCourt(${c.id})">❌</button>`}<span class="status"><span class="status-dot ready"></span> Up Next</span></div></div>
      ${state.pendingRemoveCourt===c.id ? `<div class="court-delete-confirm-row"><span class="court-delete-message">Remove this court?</span><button class="court-confirm-yes" onclick="event.stopPropagation();requestRemoveCourt(${c.id})">Yes, Remove</button><button class="court-confirm-no" onclick="event.stopPropagation();cancelRemoveCourt(${c.id})">No</button></div>` : ''}
      <div class="ready-meta"><div class="ready-meta-left"><span class="ready-selected">${ps.length}/4 <b>players selected</b></span></div><span class="ready-meta-hint">Moves to the next available court automatically</span></div>
      <div class="ready-match-sheet">
        <div class="ready-match-team ready-team-one ${!!team1[0] && !!team1[1] && werePairedBefore(team1[0].id,team1[1].id)?'has-paired-before':''}"><div class="ready-team-heading">TEAM 1${!!team1[0] && !!team1[1] && werePairedBefore(team1[0].id,team1[1].id)?' <span class="paired-before-label">(Paired Before)</span>':''}</div><div class="ready-team-players">${readySlot(team1[0],c.id,0)}${readySlot(team1[1],c.id,1)}</div></div>
        <div class="ready-match-vs">VS</div>
        <div class="ready-match-team ready-team-two ${!!team2[0] && !!team2[1] && werePairedBefore(team2[0].id,team2[1].id)?'has-paired-before':''}"><div class="ready-team-heading">TEAM 2${!!team2[0] && !!team2[1] && werePairedBefore(team2[0].id,team2[1].id)?' <span class="paired-before-label">(Paired Before)</span>':''}</div><div class="ready-team-players">${readySlot(team2[0],c.id,2)}${readySlot(team2[1],c.id,3)}</div></div>
      </div>
      ${selected && ps.length<4 ? `<div class="court-picker"><div class="picker-title"><div class="picker-search-wrap"><span class="picker-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="M16 16l4 4"></path></svg></span><input id="courtPickerSearch" class="picker-search" type="search" placeholder="Search player..." autocomplete="off" oninput="filterCourtPicker()"></div><div class="picker-filter-row category-filters"><button type="button" class="picker-filter ${courtPickerFilters.category==='ALL'?'active':''}" data-filter-type="category" data-filter-value="ALL" onclick="setCourtPickerFilter('category','ALL',this)">All (${state.queue.length})</button>${['BEG','NOV','INT','ADV','EXP'].map(cat=>{const n=state.queue.filter(pid=>player(pid)?.category===cat).length;return `<button type="button" class="picker-filter skill-${cat.toLowerCase()} ${courtPickerFilters.category===cat?'active':''}" data-filter-type="category" data-filter-value="${cat}" onclick="setCourtPickerFilter('category','${cat}',this)">${cat} (${n})</button>`}).join('')}</div><div class="picker-filter-row gender-filters"><button type="button" class="picker-filter ${courtPickerFilters.gender==='ALL'?'active':''}" data-filter-type="gender" data-filter-value="ALL" onclick="setCourtPickerFilter('gender','ALL',this)">All (${state.queue.length})</button><button type="button" class="picker-filter gender-male ${courtPickerFilters.gender==='Male'?'active':''}" data-filter-type="gender" data-filter-value="Male" onclick="setCourtPickerFilter('gender','Male',this)">♂ M (${state.queue.filter(pid=>player(pid)?.gender==='Male').length})</button><button type="button" class="picker-filter gender-female ${courtPickerFilters.gender==='Female'?'active':''}" data-filter-type="gender" data-filter-value="Female" onclick="setCourtPickerFilter('gender','Female',this)">♀ F (${state.queue.filter(pid=>player(pid)?.gender==='Female').length})</button></div><div class="picker-filter-row wait-filters"><button type="button" class="picker-filter ${courtPickerFilters.wait===0?'active':''}" data-filter-type="wait" data-filter-value="0" onclick="setCourtPickerFilter('wait',0,this)">⏱︎ All (${state.queue.length})</button><button type="button" class="picker-filter ${courtPickerFilters.wait===5?'active':''}" data-filter-type="wait" data-filter-value="5" onclick="setCourtPickerFilter('wait',5,this)">5m+</button><button type="button" class="picker-filter ${courtPickerFilters.wait===10?'active':''}" data-filter-type="wait" data-filter-value="10" onclick="setCourtPickerFilter('wait',10,this)">10m+</button><button type="button" class="picker-filter ${courtPickerFilters.wait===15?'active':''}" data-filter-type="wait" data-filter-value="15" onclick="setCourtPickerFilter('wait',15,this)">15m+</button></div></div><div class="picker-player-list">${state.queue.slice().sort((a,b)=>{const pa=player(a),pb=player(b);return (Number(pa?.waitingSince||pa?.queuedAt||Date.now())-Number(pb?.waitingSince||pb?.queuedAt||Date.now()))||(Number(a)-Number(b));}).map(pid=>{const qp=player(pid);if(!qp)return '';const wait=Math.max(0,Math.floor((Date.now()-(qp.waitingSince||qp.queuedAt||Date.now()))/60000));return `<button class="picker-player ${pickerCandidatePairedBefore(c.id,qp.id)?'paired-before-player':''}" data-player-name="${esc(`${displayPlayerName(qp)} ${qp.nickname||''}`).toLowerCase()}" data-category="${esc(qp.category||'')}" data-gender="${esc(qp.gender||'')}" data-queued-at="${Number(qp.waitingSince||qp.queuedAt||Date.now())}" data-wait="${wait}" onclick="choosePlayerForCourt(${pid},${c.id})"><span class="picker-info"><span class="picker-meta"><b>${esc(displayPlayerName(qp))}</b><span class="picker-gender ${qp.gender==='Female'?'female':'male'}">${qp.gender==='Female'?'♀':'♂'}</span><span class="picker-category ${qp.category?'skill-'+qp.category.toLowerCase():''}">${esc(qp.category||'CAT')}</span>${getLockedPartnerId(qp.id)!=null?`<span class="partner-inline-badge" title="Locked-in partner"><span class="partner-inline-lock" aria-hidden="true">🔒</span><span class="partner-inline-name">${esc(String(player(getLockedPartnerId(qp.id))?.name||'').trim().split(/\s+/)[0]||displayPlayerName(player(getLockedPartnerId(qp.id))))}</span></span>`:''}${pickerCandidatePairedBefore(c.id,qp.id)?'<span class="paired-before-label picker-paired-before">(Paired Before)</span>':''}</span></span><span class="picker-wait ${wait>=15?'wait-red':wait>=10?'wait-yellow':''}">⏱ ${formatWaitingDuration(wait)}</span></button>`}).join('')||'<div class="picker-empty">No players waiting in Queue.</div>'}</div></div>` : ''}
      <div class="ready-actions ready-actions-v2">${selected && ps.length<4?`<button class="ready-cancel active picker-cancel" onclick="cancelCourtPicker(${c.id})">CANCEL</button><button class="auto-match-ready" onclick="autoMatchVariety(${c.id})">AUTO-MATCH VARIETY</button><button class="start" disabled>WAITING FOR COURT</button>`:`<button class="ready-cancel ${ps.length===4?'active':''}" onclick="${ps.length===4?`cancelReadyMatch(${c.id})`:`autoMatchVariety(${c.id})`}">${ps.length===4?'CANCEL MATCH':'AUTO-MATCH VARIETY'}</button><button class="mix-live" onclick="mixCourt(${c.id})" ${ps.length!==4?'disabled':''}>⇄ MIX TEAMS</button><button class="start" disabled>${ps.length===4?'WAITING FOR COURT':'WAITING COURT'}</button>`}</div>
    </div></div>`;
  }).join('');
  $('courtsList').innerHTML += waitingHtml ? `<div class="waiting-courts-section"><div class="waiting-courts-title">⏳ WAITING COURTS <span>(${waitingCourts.length})</span><small>These are queue slots, not numbered matchmaking courts.</small></div>${waitingHtml}</div>` : '';

  realCourts.filter(c=>c.playing).forEach(c=>updateSubmitState(c.id));
}

function minimizeLeftPlayers(){
  const section=document.querySelector('.left-section');
  if(!section)return;
  section.classList.add('collapsed');
  section.classList.remove('expanded');
  
}

function toggleLeftPlayers(){
  const section=document.querySelector('.left-section');
  if(!section)return;
  section.classList.add('collapsed');
  section.classList.remove('expanded');
}

function cloneCourtSettings(){
  return state.courts.filter(c=>!c.waitingOnly).map(c=>({id:c.id,number:c.number,name:c.name,playing:!!c.playing,allowedSkills:Array.isArray(c.allowedSkills)?[...c.allowedSkills]:[]}));
}
function buildCourtSettingsQuickNumbers(){
  const existing=new Set((courtSettingsDraft||[]).map(c=>Number(c.number)||0));
  const result=[];
  for(let n=1;result.length<4;n++){
    if(!existing.has(n)) result.push(n);
  }
  return result;
}
function openCourtSettings(){
  courtSettingsDraft=cloneCourtSettings();
  if(!Array.isArray(courtSettingsDraft))courtSettingsDraft=[];
  courtSettingsQuickNumbers=buildCourtSettingsQuickNumbers();
  renderCourtSettings();
  $('courtSettingsModal').classList.remove('hidden');
  setTimeout(()=>{$('courtSettingsNameInput')?.focus();},0);
}
function closeCourtSettings(){ $('courtSettingsModal').classList.add('hidden'); courtSettingsDraft=null; }
function draftCourt(id){return courtSettingsDraft?.find(c=>c.id===id);}
function renderCourtSettings(){
  const pool=$('courtSettingsPool'), skills=$('courtSettingsSkills'), quick=$('courtSettingsQuickAdd');
  if(!pool||!skills||!quick)return;
  const courts=[...(courtSettingsDraft||[])].sort((a,b)=>(Number(a.number)||9999)-(Number(b.number)||9999));
  const count=$('courtSettingsPoolCount'); if(count)count.textContent=`(${courts.length} COURTS)`;
  pool.classList.toggle('court-pool-scroll', courts.length > 6);
  pool.innerHTML=courts.length?courts.map(c=>{
    const playing=!!c.playing;
    const statusText=playing?'Playing':'Waiting';
    return `<div class="court-pool-chip ${playing?'is-playing':'is-waiting'}" title="${statusText}"><span class="pool-dot" aria-label="${statusText}" title="${statusText}">•</span><b>${esc(courtDisplayName(c))}</b><button type="button" aria-label="Remove ${esc(courtDisplayName(c))}" onclick="removeCourtFromSettings(${c.id})" ${playing?'disabled title="Finish the match before removing this court"':''}>×</button></div>`;
  }).join(''):'<div class="settings-empty">No courts created yet.</div>';
  quick.innerHTML=[
    {start:1,end:3,label:'Court 1-3'},
    {start:1,end:5,label:'Court 1-5'},
    {start:3,end:5,label:'Court 3-5'},
    {start:1,end:8,label:'Court 1-8'}
  ].map(item=>`<button type="button" class="quick-court-btn" onclick="quickSetupCourts(${item.start},${item.end})">${item.label}</button>`).join('');
  skills.innerHTML=courts.length?courts.map(c=>{
    const allowed=new Set(c.allowedSkills||[]);
    return `<div class="court-skill-row"><div class="court-skill-name">${esc(courtDisplayName(c))}</div><div class="court-skill-buttons">${['BEG','NOV','INT','ADV','EXP'].map(cat=>`<button type="button" class="court-skill-btn ${allowed.has(cat)?'selected ':''}skill-${cat.toLowerCase()}" onclick="toggleCourtSkill(${c.id},'${cat}')">${cat}</button>`).join('')}</div></div>`;
  }).join(''):'<div class="settings-empty">Add a court to configure skill assignments.</div>';
}
function addCourtFromSettings(){
  const input=$('courtSettingsNameInput');
  const normalized=normalizeCourtEntry(input?.value||'');
  if(normalized?.error){toast(normalized.error);return;}
  const number=normalized.number||nextAvailableCourtNumber();
  const name=normalized.name||`Court ${number}`;
  if(courtSettingsDraft.some(c=>Number(c.number)===Number(number))){toast(`Court ${number} already exists.`);return;}
  courtSettingsDraft.push({id:Date.now()+Math.floor(Math.random()*1000),number,name,players:[],playing:false,start:null,target:state.eventRules.target,winBy:state.eventRules.winBy,scores:[0,0],allowedSkills:[],waitingOnly:false});
  if(Array.isArray(courtSettingsQuickNumbers)){
    const idx=courtSettingsQuickNumbers.indexOf(Number(number));
    if(idx>=0){
      courtSettingsQuickNumbers.splice(idx,1);
      const used=new Set([...(courtSettingsDraft||[]).map(c=>Number(c.number)||0),...courtSettingsQuickNumbers]);
      let next=Math.max(0,...courtSettingsQuickNumbers)+1;
      while(used.has(next))next++;
      courtSettingsQuickNumbers.push(next);
    }
  }
  if(input)input.value='';
  renderCourtSettings();
}
function quickAddCourt(number){
  number=Number(number);
  if((courtSettingsDraft||[]).some(c=>Number(c.number)===number)){toast(`Court ${number} already exists.`);return;}
  courtSettingsDraft.push({id:Date.now()+Math.floor(Math.random()*1000),number,name:`Court ${number}`,players:[],playing:false,start:null,target:state.eventRules.target,winBy:state.eventRules.winBy,scores:[0,0],allowedSkills:[],waitingOnly:false});
  if(!Array.isArray(courtSettingsQuickNumbers))courtSettingsQuickNumbers=buildCourtSettingsQuickNumbers();
  const idx=courtSettingsQuickNumbers.indexOf(number);
  if(idx>=0){
    courtSettingsQuickNumbers.splice(idx,1);
    const used=new Set([...(courtSettingsDraft||[]).map(c=>Number(c.number)||0),...courtSettingsQuickNumbers]);
    let next=Math.max(0,...courtSettingsQuickNumbers)+1;
    while(used.has(next))next++;
    courtSettingsQuickNumbers.push(next);
  }
  renderCourtSettings();
}

function quickSetupCourts(start,end){
  start=Number(start); end=Number(end);
  if(!Array.isArray(courtSettingsDraft))return;
  const existing=new Set(courtSettingsDraft.map(c=>Number(c.number)||0));
  let added=0;
  for(let number=start;number<=end;number++){
    if(existing.has(number))continue;
    courtSettingsDraft.push({id:Date.now()+Math.floor(Math.random()*100000)+number,number,name:`Court ${number}`,players:[],playing:false,start:null,target:state.eventRules.target,winBy:state.eventRules.winBy,scores:[0,0],allowedSkills:[],waitingOnly:false});
    existing.add(number); added++;
  }
  renderCourtSettings();
  toast(added?`Court setup ready. Save Changes to apply ${added} new court${added===1?'':'s'}.`:'All courts in that range already exist.');
}

function toggleCourtSkill(id,category){
  const c=draftCourt(id); if(!c)return;
  const set=new Set(c.allowedSkills||[]);
  if(set.has(category))set.delete(category);else set.add(category);
  c.allowedSkills=['BEG','NOV','INT','ADV','EXP'].filter(x=>set.has(x));
  renderCourtSettings();
}
function removeCourtFromSettings(id){
  const c=draftCourt(id); if(!c)return;
  if(c.playing){toast('Finish or cancel the LIVE match before removing the court.');return;}
  const players=Array.isArray(c.players)?c.players:[];
  if(players.length){
    // Draft courts normally mirror live courts; move players back only when the saved change is applied.
    const live=state.courts.find(x=>x.id===id);
    if(live?.players?.length){toast(`${courtDisplayName(live)} has players selected. Remove them from the court first.`);return;}
  }
  const removedNumber=Number(c.number);
  courtSettingsDraft=courtSettingsDraft.filter(x=>x.id!==id);
  if(!Array.isArray(courtSettingsQuickNumbers))courtSettingsQuickNumbers=buildCourtSettingsQuickNumbers();
  if(removedNumber>0 && !courtSettingsQuickNumbers.includes(removedNumber)){
    courtSettingsQuickNumbers.push(removedNumber);
    courtSettingsQuickNumbers.sort((a,b)=>a-b);
    if(courtSettingsQuickNumbers.length>4){
      courtSettingsQuickNumbers.pop();
    }
  }
  renderCourtSettings();
}
function saveCourtSettings(){
  if(!Array.isArray(courtSettingsDraft))return;
  const removed=state.courts.filter(c=>!c.waitingOnly && !courtSettingsDraft.some(d=>d.id===c.id));
  if(removed.some(c=>c.playing)){toast('A LIVE court cannot be removed.');return;}
  const removedWithPlayers=removed.find(c=>Array.isArray(c.players)&&c.players.length);
  if(removedWithPlayers){toast(`${courtDisplayName(removedWithPlayers)} still has players. Remove its players first.`);return;}
  courtSettingsDraft.forEach(d=>{
    const c=state.courts.find(x=>x.id===d.id);
    if(c)c.allowedSkills=[...(d.allowedSkills||[])];
  });
  removed.forEach(c=>{state.courts=state.courts.filter(x=>x.id!==c.id);if(state.selectedCourt===c.id)state.selectedCourt=null;});
  const newDrafts=courtSettingsDraft.filter(d=>!state.courts.some(c=>c.id===d.id));
  newDrafts.forEach(d=>state.courts.push({...d,players:[],playing:false,start:null,scores:[0,0],target:state.eventRules.target,winBy:state.eventRules.winBy,allowedSkills:[...(d.allowedSkills||[])]}));
  state.courts.sort((a,b)=>(Number(a.number)||9999)-(Number(b.number)||9999));
  saveState(); closeCourtSettings(); render(); toast('Court settings saved.');
}


function historyTeams(log){
  const t1=(log.team1Ids||[]).map(player).filter(Boolean);
  const t2=(log.team2Ids||[]).map(player).filter(Boolean);
  if(!t1.length){
    const names=(log.winner||'').split(' & ').filter(Boolean).map(name=>({name}));
    const loses=(log.loser||'').split(' & ').filter(Boolean).map(name=>({name}));
    return {t1:names,t2:loses};
  }
  const scores=String(log.score||'0-0').split('-').map(Number); return scores[0]>=scores[1]?{t1,t2}:{t1,t2};
}
function parseDurationSeconds(value){
  const raw=String(value||'').trim();
  const m=raw.match(/^(\d+):(\d{1,2})$/);
  if(m)return (Number(m[1])||0)*60+(Number(m[2])||0);
  const min=raw.match(/(\d+)\s*m/i);
  if(min)return (Number(min[1])||0)*60;
  return 0;
}

function formatTotalMatchMinutes(seconds){
  const totalMinutes=Math.floor(Math.max(0,Number(seconds)||0)/60);
  if(totalMinutes < 60) return `${totalMinutes}m`;
  const hours=Math.floor(totalMinutes/60);
  const minutes=totalMinutes%60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function getRankingStats(){
  // Keep ranking independent from the active Queue/Left Players area. A player
  // moved to Left Players remains eligible for ranking and historical stats.
  const rankingPlayers=[...new Map([...state.players,...state.left].map(p=>[String(p.id),p])).values()];
  // Queue records are derived only from completed live match logs. Never seed
  // wins from the player's cached `wins` field, which may be stale/imported.
  const stats=new Map(rankingPlayers.map(p=>[p.id,{matches:0,wins:0,losses:0,xp:0,totalSeconds:0}]));
  const normName=value=>String(value||'').trim().toLowerCase();
  state.logs.forEach(log=>{
    const team1=Array.isArray(log.team1Ids)?log.team1Ids:[];
    const team2=Array.isArray(log.team2Ids)?log.team2Ids:[];
    const team1Names=Array.isArray(log.team1Names)?log.team1Names:[];
    const team2Names=Array.isArray(log.team2Names)?log.team2Names:[];
    const winnerNames=String(log.winner||'').split(' & ').map(normName).filter(Boolean);
    const loserNames=String(log.loser||'').split(' & ').map(normName).filter(Boolean);
    const score=String(log.score||'').split('-').map(v=>Number(v.trim()));
    const hasScore=score.length===2&&Number.isFinite(score[0])&&Number.isFinite(score[1])&&score[0]!==score[1];
    const team1Won=hasScore?score[0]>score[1]:null;
    const durationSeconds=parseDurationSeconds(log.duration);
    rankingPlayers.forEach(playerRecord=>{
      const st=stats.get(playerRecord.id);
      const pname=normName(playerRecord.name);
      const inTeam1=team1.some(id=>String(id)===String(playerRecord.id))||team1Names.some(n=>normName(n)===pname);
      const inTeam2=team2.some(id=>String(id)===String(playerRecord.id))||team2Names.some(n=>normName(n)===pname);
      const isWinner=winnerNames.includes(pname);
      const isLoser=loserNames.includes(pname);
      if(!inTeam1&&!inTeam2&&!isWinner&&!isLoser)return;
      st.matches++;
      st.totalSeconds+=durationSeconds;
      if(team1Won!==null){
        if((inTeam1&&!inTeam2&&team1Won)||(inTeam2&&!inTeam1&&!team1Won)){st.wins++;st.xp+=20;}
        else if((inTeam1&&!inTeam2&&!team1Won)||(inTeam2&&!inTeam1&&team1Won)){st.losses++;st.xp+=8;}
      }else if(isWinner&&!isLoser){st.wins++;st.xp+=20;}
      else if(isLoser&&!isWinner){st.losses++;st.xp+=8;}
    });
  });
  // Include the currently LIVE match in each player's accumulated play time.
  state.courts.filter(c=>c.playing && c.start).forEach(c=>{
    const liveSeconds=Math.max(0,Math.floor((Date.now()-new Date(c.start).getTime())/1000));
    (c.players||[]).forEach(id=>{
      const st=stats.get(id);
      if(st) st.totalSeconds+=liveSeconds;
    });
  });
  stats.forEach(st=>{st.losses=Math.max(0,st.matches-st.wins);st.winRate=st.matches?Math.round((st.wins/st.matches)*100):0;});
  return stats;
}

function isPlayerPlaying(p){
  return !!(p && p.court && state.courts.some(c=>c.id===p.court && c.playing));
}
function getLeaderboardScore(st){
  const wins=Math.max(0,Number(st?.wins)||0);
  const matches=Math.max(0,Number(st?.matches)||0);
  const winRate=matches?wins/matches:0;
  // Balanced ranking: winning percentage is important, but repeated wins and
  // meaningful match volume also count so a tiny 100% sample does not always
  // outrank a player with substantially more wins and games.
  const winComponent=1-Math.exp(-wins/5);
  const gameComponent=1-Math.exp(-matches/10);
  return (winRate*0.50)+(winComponent*0.35)+(gameComponent*0.15);
}
function compareLeaderboardPlayers(a,b,stats){
  const sa=stats.get(a.id)||{winRate:0,wins:0,losses:0,matches:0};
  const sb=stats.get(b.id)||{winRate:0,wins:0,losses:0,matches:0};
  return getLeaderboardScore(sb)-getLeaderboardScore(sa)
    || sb.wins-sa.wins
    || sb.winRate-sa.winRate
    || sb.matches-sa.matches
    || sa.losses-sb.losses
    || String(a.name||'').localeCompare(String(b.name||''));
}

function closePodiumExpandModal(){
  $('podiumExpandModal')?.classList.add('hidden');
  document.body.classList.remove('podium-modal-open');
}
function openPodiumExpandModal(){
  renderExpandedPodium();
  const modal=$('podiumExpandModal');
  if(!modal)return;
  modal.classList.remove('hidden');
  document.body.classList.add('podium-modal-open');
}
function renderExpandedPodium(){
  const target=$('podiumExpandedContent');
  if(!target)return;
  const stats=getRankingStats();
  const rankingPlayers=[...new Map([...state.players,...state.left].map(p=>[String(p.id),p])).values()];
  const ranked=rankingPlayers.filter(p=>(stats.get(p.id)?.matches||0)>0).sort((a,b)=>compareLeaderboardPlayers(a,b,stats));
  const top=ranked.slice(0,3);
  const medals=['🥇','🥈','🥉'];
  const podiumOrder=[top[1],top[0],top[2]].filter(Boolean);
  const stage=podiumOrder.map((p,i)=>{
    const actualRank=ranked.indexOf(p)+1;
    const st=stats.get(p.id)||{winRate:0,wins:0,losses:0,matches:0};
    return `<div class="expanded-podium-place place-${actualRank}">
      <div class="expanded-podium-player">
        <div class="expanded-podium-medal">${medals[actualRank-1]||'🏅'}</div>
        <b>${esc(displayPlayerName(p))}</b>
        <span>${st.winRate}% win rate</span>
      </div>
      <div class="expanded-podium-block"><strong>${actualRank}</strong><small>${st.wins}W · ${st.losses}L</small></div>
    </div>`;
  }).join('');
  const rows=ranked.map((p,i)=>{
    const st=stats.get(p.id)||{winRate:0,wins:0,losses:0,matches:0,totalSeconds:0};
    return `<div class="expanded-ranking-row">
      <div class="expanded-ranking-position">${i<3?medals[i]:`#${i+1}`}</div>
      <div class="expanded-ranking-player">
        <div class="ranking-player-main">
          <div class="ranking-name-line">
            <b>${esc(displayPlayerName(p))}</b>
            <span class="expanded-ranking-gender ${p.gender==='Female'?'female':'male'}" aria-label="${p.gender==='Female'?'Female':'Male'}">${p.gender==='Female'?'♀':'♂'}</span>
            ${p.category?`<span class="rank-category skill-${String(p.category).toLowerCase()}">${esc(p.category)}</span>`:''}
            ${getLockedPartnerId(p.id)?`<span class="queue-locked-partner-inline" title="Locked in with ${esc(displayPlayerName(player(getLockedPartnerId(p.id))||{name:'partner'}))}" aria-label="Locked in with partner" role="img">🔒</span>`:''}
            ${isPlayerPlaying(p)?'<span class="playing-badge">Playing</span>':''}
          </div>
          <div class="expanded-ranking-secondary">
            <div class="ranking-progress"><div class="progress-track"><span style="width:${st.winRate}%"></span></div></div>
            <div class="ranking-meta"><span class="ranking-play-time"><span class="play-time-icon" aria-hidden="true">⏱︎</span>${formatTotalMatchMinutes(st.totalSeconds)}</span></div>
          </div>
        </div>
      </div>
      <div class="expanded-ranking-result"><strong>${st.winRate}%</strong><span>${st.wins}W - ${st.losses}L</span><small>${st.matches} match${st.matches===1?'':'es'}</small></div>
    </div>`;
  }).join('');
  target.innerHTML=ranked.length
    ? `<div class="expanded-podium-stage">${stage}</div><div class="expanded-list-head"><span>PLAYER RANKING</span><span>${ranked.length} player${ranked.length===1?'':'s'}</span></div><div class="expanded-ranking-list">${rows}</div>`
    : '<div class="expanded-podium-empty">🏆<b>No podium results yet</b><span>Complete a match to start the ranking.</span></div>';
}

function renderResults(){
  const stats=getRankingStats();
  // Rank all known players, including those temporarily moved to Left Players.
  const rankingPlayers=[...new Map([...state.players,...state.left].map(p=>[String(p.id),p])).values()];
  const r=rankingPlayers.filter(p=>(stats.get(p.id)?.matches||0)>0).sort((a,b)=>compareLeaderboardPlayers(a,b,stats));

  const podium=$('podiumList');
  if(podium){
    const medals=['🥇','🥈','🥉'];
    podium.innerHTML=r.slice(0,3).map((p,i)=>{
      const st=stats.get(p.id)||{winRate:0,wins:0,losses:0,matches:0,xp:0};
      return `<div class="podium-card podium-${i+1}">
        <div class="podium-medal">${medals[i]}</div>
        <div class="podium-player"><b>${esc(displayPlayerName(p))}</b><span class="${p.category?'skill-'+String(p.category).toLowerCase():''}">${p.category?esc(p.category):'CAT'}</span>${isPlayerPlaying(p)?'<span class="playing-badge">Playing</span>':''}</div>
        <div class="podium-rank">${i+1}<sup>${i===0?'ST':i===1?'ND':'RD'}</sup></div>
        <div class="podium-stats"><span>${st.wins}W-${st.losses}L · ${st.matches} match${st.matches===1?'':'es'} · ${st.winRate}%</span></div>
      </div>`;
    }).join('');
  }

  $('rankingTable').innerHTML=r.map((p,i)=>{
    const st=stats.get(p.id)||{winRate:0,wins:0,losses:0,matches:0,totalSeconds:0};
    const level = p.level || p.rankLevel || p.levelName || '';
    return `<div class="ranking-row">
      <div class="ranking-position">${i<3?['🥇','🥈','🥉'][i]:`#${i+1}`}</div>
      <div class="ranking-player">
        <div class="ranking-player-main">
          <div class="ranking-name-line"><b>${esc(displayPlayerName(p))}</b>${p.category?`<span class="rank-category skill-${String(p.category).toLowerCase()}">${esc(p.category)}</span>`:''}${getLockedPartnerId(p.id)?`<span class="queue-locked-partner-inline" title="Locked in with ${esc(displayPlayerName(player(getLockedPartnerId(p.id))||{name:'partner'}))}" aria-label="Locked in with partner" role="img">🔒</span>`:''}${isPlayerPlaying(p)?'<span class="playing-badge">Playing</span>':''}${level?`<span class="ranking-level">${esc(String(level).startsWith('Lv')?String(level):`Lv${level}`)}</span>`:''}</div>
          <div class="ranking-secondary">
            <div class="ranking-progress"><div class="progress-track"><span style="width:${st.winRate}%"></span></div></div>
            <div class="ranking-meta"><span class="ranking-play-time"><span class="play-time-icon" aria-hidden="true">⏱︎</span>${formatTotalMatchMinutes(st.totalSeconds)}</span></div>
          </div>
        </div>
      </div>
      <div class="ranking-result"><strong>${st.winRate}%</strong><span>${st.wins}W - ${st.losses}L</span><small>${st.matches} match${st.matches===1?'':'es'}</small></div>
    </div>`;
  }).join('')||'<div class="ranking-empty" aria-label="Leaderboard will appear after the first game"></div>';

  if($('historyCount')) $('historyCount').textContent=`(${state.logs.length})`;
  renderHistoryTable();
}

function renderHistoryTable(){
  const table=$('historyTable');
  if(!table) return;
  const query=String($('historySearchInput')?.value||'').trim().toLowerCase();
  const allLogs=(state.logs||[]).slice().reverse();
  const rows=query?allLogs.filter(l=>{
    const names=[
      l.winner,l.loser,
      ...(Array.isArray(l.team1Names)?l.team1Names:[]),
      ...(Array.isArray(l.team2Names)?l.team2Names:[]),
      ...(Array.isArray(l.team1Players)?l.team1Players.map(p=>p?.name||p?.nickname||''):[]),
      ...(Array.isArray(l.team2Players)?l.team2Players.map(p=>p?.name||p?.nickname||''):[])
    ].filter(Boolean).join(' ').toLowerCase();
    return names.includes(query);
  }):allLogs;

  if(!allLogs.length){
    table.innerHTML='<div class="history-empty" aria-label="No matches completed yet"></div>';
    return;
  }
  if(!rows.length){
    table.innerHTML='<div class="history-search-empty" role="status"><span class="history-search-empty-icon" aria-hidden="true">📜</span><span>No match history found for that player.</span></div>';
    return;
  }
  table.innerHTML=rows.map(l=>{
    const winOnly=l.recordingMode==='win-only' || !String(l.score??'').trim();
    const sc=String(l.score||'').split('-');
    return `<div class="history-card${winOnly?' history-card-win-only':''}" onclick="openHistoryDetail(${l.id})">
      <div class="history-index">${l.id}</div><div class="history-team winner-team"><b>${esc(l.winner||'Winner')}</b></div>
      <div class="history-score ${winOnly?'history-result-labels':''}">${winOnly?`<strong class="history-win-label">WIN</strong><span class="history-result-dash">-</span><strong class="history-loss-label">LOSS</strong>`:`<strong>${esc(sc[0]||'0')}</strong><span>-</span><strong>${esc(sc[1]||'0')}</strong>`}</div>
      <div class="history-team loser-team"><b>${esc(l.loser||'Loser')}</b></div>
      <div class="history-time">⏱︎ ${esc(l.duration||'--')}</div><div class="history-arrow">›</div>
    </div>`;
  }).join('');
}

function getHistoryWinnerTeam(log){
  if(Number(log?.winnerTeam)===1 || Number(log?.winnerTeam)===2)return Number(log.winnerTeam);
  const winnerNames=String(log?.winner||'').split(' & ').map(v=>String(v||'').trim().toLowerCase()).filter(Boolean);
  const t1=(Array.isArray(log?.team1Names)?log.team1Names:[]).map(v=>String(v||'').trim().toLowerCase());
  const t2=(Array.isArray(log?.team2Names)?log.team2Names:[]).map(v=>String(v||'').trim().toLowerCase());
  if(winnerNames.some(n=>t1.includes(n)))return 1;
  if(winnerNames.some(n=>t2.includes(n)))return 2;
  const scores=String(log?.score||'').split('-').map(v=>Number(v));
  return scores.length===2 && Number.isFinite(scores[0]) && scores[0]>scores[1]?1:2;
}

function openHistoryDetail(logId,preservePendingWinner=false){
  const l=state.logs.find(x=>x.id===logId); if(!l)return;
  const winOnly=l.recordingMode==='win-only' || !String(l.score??'').trim();
  if(!preservePendingWinner || window.__historyEditingId!==logId || ![1,2].includes(Number(window.__historyPendingWinnerTeam))){
    window.__historyPendingWinnerTeam=getHistoryWinnerTeam(l);
  }
  // Match details reflect the active event-rule button as requested for Mode.
  const detailRaceTarget=[11,15,21].includes(Number(state.eventRules?.target))
    ? Number(state.eventRules.target) : (Number(l.target)||11);
  window.__historyEditingId=logId;
  const scores=String(l.score||'0-0').split('-').map(x=>Number(x)||0);
  const resolveHistoryPlayer=(id,teamSnapshots=[])=>{
    const live=[...(state.players||[]),...(state.left||[])].find(p=>String(p.id)===String(id));
    if(live)return live;
    const snap=(teamSnapshots||[]).find(p=>String(p.id)===String(id));
    return snap?{...snap}:null;
  };
  const t1=(l.team1Ids||[]).map(id=>resolveHistoryPlayer(id,l.team1Players||[])).filter(Boolean);
  const t2=(l.team2Ids||[]).map(id=>resolveHistoryPlayer(id,l.team2Players||[])).filter(Boolean);
  const snapshotFromName=(name,idx,gender='',category='')=>({id:`history-${l.id}-${idx}-${name}`,name,nickname:'',gender,category});
  if(!t1.length && Array.isArray(l.team1Names)) l.team1Names.forEach((name,i)=>{ if(name)t1.push(snapshotFromName(name,i)); });
  if(!t2.length && Array.isArray(l.team2Names)) l.team2Names.forEach((name,i)=>{ if(name)t2.push(snapshotFromName(name,i+100)); });
  const actualWinnerTeam=getHistoryWinnerTeam(l);
  const winnerTeamNumber=winOnly?Number(window.__historyPendingWinnerTeam||actualWinnerTeam):actualWinnerTeam;
  const winTeam=winnerTeamNumber===1?t1:t2, loseTeam=winnerTeamNumber===1?t2:t1;
  const winnerScore=winOnly?'':Math.max(scores[0],scores[1]);
  const loserScore=winOnly?'':Math.min(scores[0],scores[1]);
  const historyStats=getRankingStats();
  const getHistoryStats=p=>{
    const byId=historyStats.get(p?.id);
    if(byId)return byId;
    const target=String(p?.name||'').trim().toLowerCase();
    const st={wins:0,losses:0};
    if(!target)return st;
    state.logs.forEach(log=>{
      const winners=String(log.winner||'').split(' & ').map(v=>String(v||'').trim().toLowerCase()).filter(Boolean);
      const losers=String(log.loser||'').split(' & ').map(v=>String(v||'').trim().toLowerCase()).filter(Boolean);
      if(winners.includes(target))st.wins++;
      else if(losers.includes(target))st.losses++;
    });
    return st;
  };
  const renderDetailPlayer=p=>`<div class="detail-player"><span class="detail-player-name">${esc(displayPlayerName(p))}</span><span class="detail-gender-icon ${p.gender==='Female'?'female':'male'}" aria-label="${p.gender||'Unknown'}">${p.gender==='Female'?'♀':'♂'}</span><span class="mini-badge ${p.category?'skill-'+String(p.category).toLowerCase():''}">${esc(p.category||'CAT')}</span></div>`;
  const renderDetailRow=(p,teamClass)=>{const st=getHistoryStats(p);return `<div class="detail-player-row ${teamClass}"><span class="dot"></span><div class="detail-player-info"><b>${esc(displayPlayerName(p))}</b><span class="detail-row-gender ${p.gender==='Female'?'female':'male'}" aria-label="${p.gender||'Unknown'}">${p.gender==='Female'?'♀':'♂'}</span><span class="mini-badge ${p.category?'skill-'+String(p.category).toLowerCase():''}">${esc(p.category||'CAT')}</span></div><small>${Number(st.wins)||0}W · ${Number(st.losses)||0}L</small></div>`;};
  $('historyDetailBody').innerHTML=`<div class="detail-score-grid ${winOnly?'detail-winner-only':''}">
    <div class="detail-team winner"><div class="detail-label">WINNER</div>${winOnly?'':`<input id="editScoreWin" class="detail-score-input" type="number" min="0" value="${winnerScore}">`}${winTeam.map(renderDetailPlayer).join('')}</div>
    <div class="detail-vs"><span>VS</span>${winOnly?`<button type="button" class="history-swap-btn detail-history-swap-btn" title="Swap WIN and LOSS" aria-label="Swap WIN and LOSS" onclick="event.stopPropagation();toggleHistoryWinnerPreview(${l.id})">⇄</button>`:''}</div>
    <div class="detail-team loser"><div class="detail-label">${winOnly?'LOSS':'LOSER'}</div>${winOnly?'':`<input id="editScoreLose" class="detail-score-input" type="number" min="0" value="${loserScore}">`}${loseTeam.map(renderDetailPlayer).join('')}</div>
  </div>
  <div class="detail-meta-grid"><span>Mode <b>Race to ${detailRaceTarget}</b></span><span>Type <b>${esc(l.type||'Doubles')}</b></span><span>Court <b>${esc(l.court||'')}</b></span><span>Duration <b>${esc(l.duration||'--')}</b></span><span>Start <b>${l.startedAt?new Date(l.startedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'--'}</b></span><span>End <b>${l.endedAt?new Date(l.endedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'--'}</b></span></div>
  <div class="detail-players"><h4>PLAYERS</h4>${t1.map(p=>renderDetailRow(p,'team-one-dot')).join('')}${t2.map(p=>renderDetailRow(p,'team-two-dot')).join('')}</div>`;
  const note=document.querySelector('#historyDetailModal .modal-note');
  if(note)note.textContent=winOnly?'Swap WIN/LOSS below, then save the result.':'Tap a score to edit, then Save Score';
  const saveButton=$('historySaveBtn');
  if(saveButton){saveButton.style.display='';saveButton.textContent=winOnly?'Save Result':'Save Score';}
  const detailBox=document.querySelector('#historyDetailModal .history-detail-box');
  if(detailBox)detailBox.classList.toggle('winner-only-detail',winOnly);
  $('historyDetailModal').classList.remove('hidden');
}

function toggleHistoryWinnerPreview(logId){
  const log=state.logs.find(x=>x.id===logId);
  if(!log || !(log.recordingMode==='win-only' || !String(log.score??'').trim()))return;
  if(window.__historyEditingId!==logId)window.__historyPendingWinnerTeam=getHistoryWinnerTeam(log);
  const current=Number(window.__historyPendingWinnerTeam||getHistoryWinnerTeam(log));
  window.__historyPendingWinnerTeam=current===1?2:1;
  openHistoryDetail(logId,true);
}

function applyHistoryWinnerTeam(logId,newWinnerTeam,refreshUI=true){
  const log=state.logs.find(x=>x.id===logId);
  if(!log || !(log.recordingMode==='win-only' || !String(log.score??'').trim()))return false;
  const oldWinnerTeam=getHistoryWinnerTeam(log);
  newWinnerTeam=Number(newWinnerTeam);
  if(![1,2].includes(newWinnerTeam) || newWinnerTeam===oldWinnerTeam)return false;
  const resolveLivePlayer=id=>[...(state.players||[]),...(state.left||[])].find(p=>String(p.id)===String(id));
  const oldWinnerIds=oldWinnerTeam===1?(log.team1Ids||[]):(log.team2Ids||[]);
  const newWinnerIds=newWinnerTeam===1?(log.team1Ids||[]):(log.team2Ids||[]);
  oldWinnerIds.map(resolveLivePlayer).filter(Boolean).forEach(p=>{p.wins=Math.max(0,(Number(p.wins)||0)-1);});
  newWinnerIds.map(resolveLivePlayer).filter(Boolean).forEach(p=>{p.wins=(Number(p.wins)||0)+1;});
  const namesForTeam=(teamNumber)=>{
    const names=teamNumber===1?log.team1Names:log.team2Names;
    if(Array.isArray(names)&&names.length)return names;
    const ids=teamNumber===1?(log.team1Ids||[]):(log.team2Ids||[]);
    const snapshots=teamNumber===1?(log.team1Players||[]):(log.team2Players||[]);
    return ids.map(id=>resolveLivePlayer(id)?.name||snapshots.find(p=>String(p.id)===String(id))?.name||'').filter(Boolean);
  };
  const winningNames=namesForTeam(newWinnerTeam), losingNames=namesForTeam(newWinnerTeam===1?2:1);
  log.winnerTeam=newWinnerTeam;
  log.winner=winningNames.join(' & ');
  log.loser=losingNames.join(' & ');
  log.score=null;
  log.recordingMode='win-only';
  saveState();
  if(refreshUI){
    render();
    if(!$('historyDetailModal').classList.contains('hidden'))openHistoryDetail(logId);
    toast(`${log.winner} now marked as the winner.`);
  }
  return true;
}

function swapHistoryWinner(logId){
  const log=state.logs.find(x=>x.id===logId);
  if(!log)return;
  const current=getHistoryWinnerTeam(log);
  return applyHistoryWinnerTeam(logId,current===1?2:1,true);
}

function closeHistoryDetail(){$('historyDetailModal').classList.add('hidden');window.__historyEditingId=null;window.__historyPendingWinnerTeam=null;}
function saveHistoryScore(){
  const id=window.__historyEditingId;
  const l=state.logs.find(x=>x.id===id);
  if(!l)return;
  if(l.recordingMode==='win-only' || !String(l.score??'').trim()){
    const actualWinnerTeam=getHistoryWinnerTeam(l);
    const pendingWinnerTeam=Number(window.__historyPendingWinnerTeam||actualWinnerTeam);
    const changed=applyHistoryWinnerTeam(id,pendingWinnerTeam,false);
    closeHistoryDetail();
    render();
    toast(changed?'Match result updated.':'Match result saved.');
    return;
  }
  const win=Number($('editScoreWin')?.value),lose=Number($('editScoreLose')?.value);
  if(!Number.isInteger(win)||!Number.isInteger(lose)||win<0||lose<0||win===lose){toast('Enter valid non-tied scores.');return;}
  const oldWinnerTeam=getHistoryWinnerTeam(l);
  const newWinnerTeam=win>lose?oldWinnerTeam:(oldWinnerTeam===1?2:1);
  const resolveHistoryPlayerForScore=(pid,teamSnapshots=[])=>{
    const live=[...(state.players||[]),...(state.left||[])].find(p=>String(p.id)===String(pid));
    if(live)return live;
    return (teamSnapshots||[]).find(p=>String(p.id)===String(pid))||null;
  };
  const oldWinnerIds=oldWinnerTeam===1?(l.team1Ids||[]):(l.team2Ids||[]);
  const newWinnerIds=newWinnerTeam===1?(l.team1Ids||[]):(l.team2Ids||[]);
  if(oldWinnerTeam!==newWinnerTeam){
    const oldSnapshots=oldWinnerTeam===1?(l.team1Players||[]):(l.team2Players||[]);
    const newSnapshots=newWinnerTeam===1?(l.team1Players||[]):(l.team2Players||[]);
    oldWinnerIds.map(pid=>resolveHistoryPlayerForScore(pid,oldSnapshots)).filter(Boolean).forEach(p=>{p.wins=Math.max(0,(Number(p.wins)||0)-1);});
    newWinnerIds.map(pid=>resolveHistoryPlayerForScore(pid,newSnapshots)).filter(Boolean).forEach(p=>{p.wins=(Number(p.wins)||0)+1;});
  }
  // The edit fields follow the currently displayed winner/loser teams; stored score remains team1-team2.
  l.score=oldWinnerTeam===1?`${win}-${lose}`:`${lose}-${win}`;
  l.recordingMode='score';
  l.winnerTeam=newWinnerTeam;
  const namesForTeam=(teamNumber)=>{
    const names=teamNumber===1?l.team1Names:l.team2Names;
    if(Array.isArray(names)&&names.length)return names;
    const ids=teamNumber===1?(l.team1Ids||[]):(l.team2Ids||[]);
    const snapshots=teamNumber===1?(l.team1Players||[]):(l.team2Players||[]);
    return ids.map(pid=>resolveHistoryPlayerForScore(pid,snapshots)?.name||'').filter(Boolean);
  };
  l.winner=namesForTeam(newWinnerTeam).join(' & ');
  l.loser=namesForTeam(newWinnerTeam===1?2:1).join(' & ');
  saveState();closeHistoryDetail();render();toast('Match score updated.');
}
function bindEventRuleButtons(){
  const race=$('eventRaceBtn'), win=$('eventWinByBtn');
  if(race && !race.dataset.bound){race.dataset.bound='1';race.addEventListener('click',()=>cycleEventRule('target'));}
  if(win && !win.dataset.bound){win.dataset.bound='1';win.addEventListener('click',()=>cycleEventRule('winBy'));}
}
function cycleEventRule(kind){
  const values=kind==='target'?[11,15,21]:[1,2,3];
  const current=Number(state.eventRules[kind])||values[0];
  state.eventRules[kind]=values[(values.indexOf(current)+1)%values.length];
  // Keep every court synchronized with the selected event rule, not only
  // courts that are already live. Otherwise a court prepared before the rule
  // changes can start with an old target and save the wrong Race to value in
  // the history detail-meta-grid.
  state.courts.forEach(c=>{
    if(kind==='target') c.target=state.eventRules.target;
    if(kind==='winBy') c.winBy=state.eventRules.winBy;
  });
  saveState(); render();
  toast(kind==='target'?`Race to ${state.eventRules.target}`:`Win by ${state.eventRules.winBy}`);
}

function render(){
  renderQueue(); renderCourts(); renderResults(); renderRegisteredSearch();
  updateAddWaitingCourtButton();
  const realCourts=state.courts.filter(c=>!c.waitingOnly); const waitingCourts=state.courts.filter(c=>c.waitingOnly);
  const stats=$('topStats'); if(stats){ stats.innerHTML=`<span class="event-stat-text">${state.players.length} players</span><span class="event-stat-sep">•</span><span class="event-stat-text">${realCourts.length} courts</span><span class="event-stat-sep">•</span><button type="button" class="event-rule-btn" id="eventRaceBtn" title="Change race target">Race to ${state.eventRules.target}</button><span class="event-stat-sep">•</span><span class="event-stat-text">${esc(state.eventRules.type||'Doubles')}</span><span class="event-stat-sep">•</span><button type="button" class="event-rule-btn" id="eventWinByBtn" title="Change win-by rule">Win by ${state.eventRules.winBy}</button>`; bindEventRuleButtons(); }
  const title=$('eventTitle'); if(title) title.textContent=state.sessionName||'(DUPR MATCH) @PICKLE WORLD DOWNTOWN | 7PM - 11PM';
}

function syncQueueModeButtons(mode){
  const searchIds=['searchPlayerModeBtn'];
  const walkIds=['walkInModeBtn'];
  searchIds.forEach(id=>$(id)?.classList.toggle('active',mode==='search'));
  walkIds.forEach(id=>$(id)?.classList.toggle('active',mode==='walkin'));
}
function setPlayerMode(mode){
  const searchBtn=$('searchPlayerModeBtn'), walkBtn=$('walkInModeBtn');
  if(searchBtn) searchBtn.classList.toggle('active', mode==='search');
  if(walkBtn) walkBtn.classList.toggle('active', mode==='walkin');
}

function showRegistration(){
  setPlayerMode('walkin');
  $('queueMainArea').classList.add('hidden'); $('registrationArea').classList.remove('hidden');
  syncQueueModeButtons('walkin');
  registrationGender='';
  clearRegistrationSkill();
  $('registerFullname').value=''; $('registerNickname').value='';
  document.querySelectorAll('.gender-choice').forEach(x=>x.classList.remove('selected'));
  updateRegistrationSaveButton();
  setTimeout(()=>$('registerFullname').focus(),0);
}
function showQueueMain(){ $('registrationArea').classList.add('hidden'); $('queueMainArea').classList.remove('hidden'); syncQueueModeButtons('search'); renderRegisteredSearch(); }
$('searchPlayerModeBtn').onclick=()=>showQueueMain();
$('walkInModeBtn').onclick=()=>showRegistration();
$('registerSaveBtn').onclick=saveRegisteredPlayer;
document.querySelectorAll('.registration-skill-btn').forEach(btn=>{
  btn.addEventListener('click',()=>selectRegistrationSkill(btn.dataset.skill));
});
function formatRegistrationName(value){
  return String(value||'').replace(/\S+/g, word=>{
    const chars=Array.from(word);
    if(!chars.length) return word;
    const first=chars[0];
    const normalizedFirst=(first==='ñ'||first==='Ñ')?'Ñ':first.toUpperCase();
    return normalizedFirst+chars.slice(1).join('').toLowerCase();
  });
}

function bindRegistrationTextHelpers(){
  ['registerFullname','registerNickname'].forEach(id=>{
    const input=$(id);
    if(!input || input.dataset.nameFormatBound==='1') return;
    input.dataset.nameFormatBound='1';
    input.addEventListener('input',()=>{
      const start=input.selectionStart ?? input.value.length;
      const end=input.selectionEnd ?? start;
      input.value=formatRegistrationName(input.value);
      input.setSelectionRange(start,end);
    });
  });
  document.querySelectorAll('.registration-enye-btn').forEach(btn=>{
    if(btn.dataset.enyeBound==='1') return;
    btn.dataset.enyeBound='1';
    btn.addEventListener('mousedown',e=>e.preventDefault());
    btn.addEventListener('click',()=>{
      const input=$(btn.dataset.target);
      if(!input) return;
      const start=input.selectionStart ?? input.value.length;
      const end=input.selectionEnd ?? start;
      input.focus();
      input.setRangeText('Ñ',start,end,'end');
      const caret=start+1;
      input.setSelectionRange(caret,caret);
      input.dispatchEvent(new Event('input',{bubbles:true}));
      // Re-assert the literal Ñ after formatting so it can never be reduced to N.
      if(input.value.slice(start,start+1)!=='Ñ'){
        const chars=Array.from(input.value);
        chars[start]='Ñ';
        input.value=chars.join('');
        input.setSelectionRange(caret,caret);
      }
    });
  });
}

document.querySelectorAll('.gender-choice').forEach(btn=>btn.onclick=()=>{registrationGender=btn.dataset.gender;document.querySelectorAll('.gender-choice').forEach(x=>x.classList.remove('selected'));btn.classList.add('selected');updateRegistrationSaveButton();});
$('registerFullname').addEventListener('input',updateRegistrationSaveButton);
bindRegistrationTextHelpers();
$('endSessionBtn').onclick=openEndSessionConfirmation;
$('endSessionCancel').onclick=closeEndSessionConfirmation;
$('endSessionConfirm').onclick=endSession;
$('addCourtBtn').onclick=addWaitingCourt;
$('courtSettingsBtn').onclick=openCourtSettings;
$('courtSettingsNameInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')addCourtFromSettings();});
$('cancelCourt').onclick=closeCourt;
$('saveCourt').onclick=saveCourt;
if($('closeHistoryDetail'))$('closeHistoryDetail').onclick=closeHistoryDetail;
$('historyCloseBtn').onclick=closeHistoryDetail;
$('historySaveBtn').onclick=saveHistoryScore;

$('importPlayersBtn').onclick=()=>{loadCloudRecords();$('cloudRecordsModal').classList.remove('hidden');renderCloudRecords();};
$('cloudRecordsDone').onclick=()=>{clearCloudMatchConfirmations();pendingCloudDeleteId=null;closeAllCloudMatchLogs();$('cloudRecordsModal').classList.add('hidden');};$('cloudRecordsSearch').addEventListener('input',renderCloudRecords);const leftPlayersSearch=$('leftPlayersSearch');if(leftPlayersSearch)leftPlayersSearch.addEventListener('input',renderLeftPlayersPopup);$('cloudImportPlayersBtn').onclick=()=>{clearCloudMatchConfirmations();pendingCloudDeleteId=null;closeAllCloudMatchLogs();$('cloudRecordsModal').classList.add('hidden');$('importModal').classList.remove('hidden');setTimeout(()=>$('importText').focus(),0);};
$('importCancel').onclick=()=>$('importModal').classList.add('hidden');
$('importSave').onclick=importPlayers;

$('courtNameInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')saveCourt();});
$('historySearchInput')?.addEventListener('input',renderHistoryTable);
$('searchQueue')?.addEventListener('input',renderQueue);
$('registeredPlayerSearch')?.addEventListener('input',renderQueue);
$('registeredPlayerSearch')?.addEventListener('keyup',renderQueue);
$('registeredPlayerSearch')?.addEventListener('change',renderQueue);
$('registeredSearchUpdateBtn')?.addEventListener('click',()=>{
  const updateBtn=$('registeredSearchUpdateBtn');
  if(!updateBtn || updateBtn.classList.contains('is-loading')) return;
  updateBtn.classList.add('is-loading');
  updateBtn.setAttribute('aria-busy','true');
  updateBtn.disabled=true;
  renderQueue();
  toast('Queue updated.');
  setTimeout(()=>{
    updateBtn.classList.remove('is-loading');
    updateBtn.removeAttribute('aria-busy');
    updateBtn.disabled=false;
  },700);
});
$('nextCourtPreview').textContent=`Next available: Court ${nextAvailableCourtNumber()}`;


document.addEventListener('click',e=>{
  if(openCategoryPlayerId!==null && !e.target.closest('.category-wrap,.category-menu-portal')) closeCategoryMenu();
  if(openGenderPlayerId!==null && !e.target.closest('.queue-gender-inline, .gender-inline-wrap, .gender-menu-portal')){openGenderPlayerId=null;renderQueue();}
});

$('queueList')?.addEventListener('scroll',()=>{
  if(openCategoryPlayerId!==null) closeCategoryMenu();
  if(openGenderPlayerId!==null) positionGenderMenu(openGenderPlayerId);
},{passive:true});
window.addEventListener('resize',()=>{
  if(openCategoryPlayerId!==null) positionCategoryMenu(openCategoryPlayerId);
  if(openGenderPlayerId!==null) positionGenderMenu(openGenderPlayerId);
});
window.addEventListener('scroll',()=>{
  if(openCategoryPlayerId!==null) closeCategoryMenu();
  if(openGenderPlayerId!==null) positionGenderMenu(openGenderPlayerId);
},{passive:true});

$('podiumExpandBtn')?.addEventListener('click',openPodiumExpandModal);
document.querySelectorAll('.tab').forEach(tab=>tab.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  tab.classList.add('active');
  $('rankingView').classList.toggle('hidden',tab.dataset.tab!=='ranking');
  $('historyView').classList.toggle('hidden',tab.dataset.tab!=='history');
});

setInterval(()=>{
  state.courts.filter(c=>c.playing).forEach(c=>{ updateCourtPlayersModalTimer(c.id); const el=$(`timer-${c.id}`); if(el){el.textContent=elapsed(c.start); el.classList.remove('timer-normal','timer-yellow','timer-red'); el.classList.add(timerToneClass(c.start));} });
  if(document.visibilityState!=='hidden'){
    // Never rebuild the queue while ANY interactive popup is open. Re-rendering
    // destroys the popup DOM, focus, and click targets and was the main source
    // of the intermittent gender/category/partner glitches.
    if(openGenderPlayerId!==null || openCategoryPlayerId!==null || document.querySelector('.queue-lock-partner')){
      // Keep interactive queue details mounted while the waiting timer ticks.
      // Rebuilding the queue here resets search focus and the partner list scroll position.
      document.querySelectorAll('.queue-waiting-line[data-player-id]').forEach(el=>{
        const p=player(Number(el.dataset.playerId));
        if(p) el.textContent=waitingAfterCheckin(p.waitingSince||p.queuedAt);
      });
      if(openCategoryPlayerId!==null) positionCategoryMenu(openCategoryPlayerId);
      if(openGenderPlayerId!==null) positionGenderMenu(openGenderPlayerId);
    }else{
      renderQueue();
    }
    if(document.querySelector('.picker-player-list')) filterCourtPicker();
  }
},1000);

function hasExistingLiveQueue(){
  return !!(state.sessionActive || state.players.length || state.left.length || state.queue.length || state.courts.length || state.logs.length);
}
function showLiveQueueWorkspace(){
  try{sessionStorage.setItem('liveQueueView','workspace')}catch(e){}
  $('liveQueueStartScreen')?.classList.add('hidden');
  document.querySelector('.topbar')?.classList.remove('live-start-hidden');
  document.querySelector('.workspace')?.classList.remove('live-start-hidden');
  render();
}
function getLiveQueuePrefix(dupr){
  return `(${dupr?'DUPR MATCH':'NON DUPR MATCH'})`;
}
function getAutoLiveQueueSessionName(dupr){
  const today=new Date();
  const dateText=today.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  return `${getLiveQueuePrefix(dupr)} Open Play — ${dateText}`;
}
function syncLiveQueueSessionName(){
  const input=$('liveQueueSessionName');
  if(!input) return;
  const dupr=!!$('liveQueueDupr')?.checked;
  const prefix=getLiveQueuePrefix(dupr);
  const current=String(input.value||'').trim();
  const currentSuffix=current.replace(/^\((?:NON )?DUPR MATCH\)\s*/i,'').trim();
  const todaySuffix=`Open Play — ${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;
  // Refresh the automatically generated Open Play date each time the start screen is shown,
  // while preserving any custom session name entered by the user.
  const isAutoOpenPlay=!currentSuffix || /^Open Play(?:\s*[—-]\s*[A-Za-z]{3}\s+\d{1,2},?\s+\d{4})?$/i.test(currentSuffix);
  const suffix=isAutoOpenPlay?todaySuffix:currentSuffix;
  input.value=`${prefix} ${suffix}`;
  input.dataset.lastValidSuffix=suffix;
  const duprToggle=$('liveQueueDupr');
  if(duprToggle){duprToggle.checked=false;duprToggle.disabled=true;duprToggle.setAttribute('aria-disabled','true');}
}
function enforceLiveQueueSessionPrefix(){
  const input=$('liveQueueSessionName');
  if(!input) return;
  const prefix=getLiveQueuePrefix(!!$('liveQueueDupr')?.checked);
  const prefixWithSpace=`${prefix} `;
  const raw=String(input.value||'');
  let suffix='';
  if(raw.startsWith(prefixWithSpace)) {
    suffix=raw.slice(prefixWithSpace.length);
  } else {
    // Treat the match-type prefix as a fixed label; never allow edits inside it
    // to become part of the editable session name.
    suffix=raw.replace(/^\s*\([^)]*\)\s*/,'');
    if(!suffix && raw.includes('(')) suffix=input.dataset.lastValidSuffix||'Open Play';
  }
  // Strip repeated match labels from the editable portion to prevent duplication.
  // Preserve trailing spaces while typing (e.g. \"Open \") so users can enter multi-word names.
  // Only remove leading whitespace and duplicate match-type labels.
  suffix=suffix.replace(/\s*\((?:NON )?DUPR MATCH\)\s*/ig,' ').replace(/^\s+/, '');
  const next=suffix?`${prefixWithSpace}${suffix}`:prefixWithSpace;
  if(raw!==next){
    const oldStart=input.selectionStart ?? raw.length;
    input.value=next;
    const caret=Math.max(prefixWithSpace.length, Math.min(next.length, oldStart));
    try{input.setSelectionRange(caret,next.length)}catch(e){}
  }
  input.dataset.lastValidSuffix=suffix||input.dataset.lastValidSuffix||'Open Play';
}
function syncLiveQueueStartScreen(){
  const existing=hasExistingLiveQueue();
  const card=$('existingLiveQueueCard');
  if(card) card.classList.toggle('hidden',!existing);
  const stats=$('existingLiveQueueStats');
  if(stats) stats.classList.toggle('hidden',!existing);
  const queuedCount=$('existingLiveQueuePlayersCount');
  if(queuedCount) queuedCount.textContent=String(state.queue.length);
  const courtCount=$('existingLiveQueueCourtsCount');
  if(courtCount) courtCount.textContent=String(state.courts.filter(c=>!c.waitingOnly).length);
  const matchCount=$('existingLiveQueueMatchesCount');
  if(matchCount) matchCount.textContent=String(state.logs.length);
  const name=$('existingLiveQueueName');
  if(name) name.textContent=state.sessionName||'Existing live queue';
  const input=$('liveQueueSessionName');
  if(input && !existing) syncLiveQueueSessionName();
  const recordToggle=$('liveQueueRecordResults');
  if(recordToggle) recordToggle.checked=!!state.recordScores;
  const create=$('createLiveQueueBtn');
  if(create){
    create.textContent='Create Live Queue';
    create.disabled=existing;
    create.setAttribute('aria-disabled',existing?'true':'false');
  }
}
function enterLiveQueueFromStart(){
  const name=getAutoLiveQueueSessionName(!!$('liveQueueDupr')?.checked);
  const type=document.querySelector('#liveQueueMatchType .live-queue-choice.active')?.dataset.value||'Doubles';
  const target=Number(document.querySelector('#liveQueueGameMode .live-queue-game.active')?.dataset.target)||11;
  const winBy=Number(document.querySelector('#liveQueueWinBy .live-queue-choice.active')?.dataset.value)||1;
  const sessionInput=$('liveQueueSessionName');
  enforceLiveQueueSessionPrefix();
  state.sessionName=sessionInput?.value?.trim()||name;
  state.sessionActive=true;
  state.duprMatch=!!$('liveQueueDupr')?.checked;
  state.recordScores=!!$('liveQueueRecordResults')?.checked;
  state.eventRules={target,winBy,type};
  saveState();
  showLiveQueueWorkspace();
}
function bindLiveQueueStartScreen(){
  document.querySelectorAll('#liveQueueMatchType .live-queue-choice').forEach(btn=>btn.addEventListener('click',()=>{
    if(btn.disabled) return;
    document.querySelectorAll('#liveQueueMatchType .live-queue-choice').forEach(x=>x.classList.remove('active')); btn.classList.add('active');
  }));
  document.querySelectorAll('#liveQueueWinBy .live-queue-choice').forEach(btn=>btn.addEventListener('click',()=>{
    if(btn.disabled) return;
    document.querySelectorAll('#liveQueueWinBy .live-queue-choice').forEach(x=>x.classList.remove('active')); btn.classList.add('active');
  }));
  document.querySelectorAll('#liveQueueGameMode .live-queue-game').forEach(btn=>btn.addEventListener('click',()=>{
    if(btn.disabled) return;
    document.querySelectorAll('#liveQueueGameMode .live-queue-game').forEach(x=>x.classList.remove('active')); btn.classList.add('active');
  }));
  const recordToggle=$('liveQueueRecordResults');
  if(recordToggle){
    recordToggle.checked=!!state.recordScores;
    recordToggle.addEventListener('change',()=>{
      const next=!!recordToggle.checked;
      if(state.recordScores===next)return;
      state.recordScores=next;
      // When switching to winner-only mode, discard any unfinished score entry.
      if(!next)state.courts.forEach(c=>{if(c.playing)c.scores=[0,0];});
      saveState();
      if(state.sessionActive)render();
    });
  }
  const duprToggle=$('liveQueueDupr');
  if(duprToggle){duprToggle.checked=false;duprToggle.disabled=true;duprToggle.setAttribute('aria-disabled','true');}
  duprToggle?.addEventListener('change',()=>{
    duprToggle.checked=false;
    syncLiveQueueSessionName();
  });
  $('liveQueueSessionName')?.addEventListener('input',enforceLiveQueueSessionPrefix);
  $('liveQueueSessionName')?.addEventListener('focus',enforceLiveQueueSessionPrefix);
  $('liveQueueSessionName')?.addEventListener('keydown',e=>{
    const input=e.currentTarget;
    const prefixLength=getLiveQueuePrefix(!!$('liveQueueDupr')?.checked).length+1;
    if((input.selectionStart||0)<prefixLength && !['Tab','Shift','Control','Alt','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)){
      e.preventDefault();
      try{input.setSelectionRange(prefixLength,prefixLength)}catch(err){}
    }
  });
  $('createLiveQueueBtn')?.addEventListener('click',()=>{
    if(hasExistingLiveQueue()) return;
    enterLiveQueueFromStart();
  });
  $('continueLiveQueueBtn')?.addEventListener('click',showLiveQueueWorkspace);
}

function showLiveQueueStartScreen(){
  try{sessionStorage.setItem('liveQueueView','start')}catch(e){}
  $('liveQueueStartScreen')?.classList.remove('hidden');
  document.querySelector('.topbar')?.classList.add('live-start-hidden');
  document.querySelector('.workspace')?.classList.add('live-start-hidden');
  syncLiveQueueStartScreen();
}
function setupTopbarModalActionGuard(buttons){
  const guardedButtons=(Array.isArray(buttons)?buttons:[buttons]).filter(Boolean);
  if(!guardedButtons.length)return;
  // Use the same visibility rules for every topbar action that must be locked
  // while a dialog is open, including the tablet Results popup.
  const modalSelector='.modal, .tablet-results-modal, [role="dialog"], [aria-modal="true"], dialog[open]';
  const isVisibleModal=el=>{
    if(el.hidden||el.getAttribute('aria-hidden')==='true')return false;
    const style=window.getComputedStyle(el);
    return style.display!=='none'&&style.visibility!=='hidden'&&el.getClientRects().length>0;
  };
  const sync=()=>{
    const modalIsOpen=Array.from(document.querySelectorAll(modalSelector)).some(isVisibleModal);
    guardedButtons.forEach(button=>{
      button.disabled=modalIsOpen;
      button.setAttribute('aria-disabled',modalIsOpen?'true':'false');
    });
  };
  sync();
  const observer=new MutationObserver(sync);
  observer.observe(document.body,{
    subtree:true,
    childList:true,
    attributes:true,
    attributeFilter:['class','style','hidden','aria-hidden','aria-modal','open']
  });
  window.addEventListener('resize',sync,{passive:true});
  document.addEventListener('transitionend',sync,true);
}
function bindTopbarBackButton(){
  const button=$('topbarBackToStartBtn');
  if(!button)return;
  button.addEventListener('click',()=>{
    if(button.disabled)return;
    showLiveQueueStartScreen();
  });
  setupTopbarModalActionGuard([
    button,
    $('endSessionBtn'),
    $('liveViewQrOpenBtn')
  ]);
}

loadCloudRecords();
loadState();
bindLiveQueueStartScreen();
bindTopbarBackButton();
initQueueNetworkStatus();
initLiveViewThemeController();
$('liveViewQrOpenBtn')?.addEventListener('click',openLiveViewQrModal);
$('liveViewQrCopyBtn')?.addEventListener('click',copyLiveViewQrLink);
$('liveViewQrOpenPageBtn')?.addEventListener('click',openLiveView);
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeLiveViewQrModal();});
render();
publishLiveViewState();
// Keep the shared live snapshot available while an active event is running.
// The server ignores unchanged heartbeats, so this does not repeatedly write data.
setInterval(()=>{
  if(state.sessionActive && (location.protocol==='http:'||location.protocol==='https:')) publishLiveViewState();
},30000);
let savedLiveQueueView='start';
try{savedLiveQueueView=sessionStorage.getItem('liveQueueView')||'start'}catch(e){}
if(hasExistingLiveQueue() && savedLiveQueueView==='workspace'){
  showLiveQueueWorkspace();
} else {
  showLiveQueueStartScreen();
}


// Tablet-only results modal; preserve the original results panel location on other devices.
(function setupTabletResultsModal(){
  const panel=document.querySelector('.results-panel');
  const modal=document.getElementById('tabletResultsModal');
  const modalBody=document.getElementById('tabletResultsModalBody');
  const openBtn=document.getElementById('tabletResultsOpenBtn');
  const closeBtn=document.getElementById('tabletResultsCloseBtn');
  const courtsPanel=document.querySelector('.courts-panel');
  const courtsList=document.getElementById('courtsList');
  if(!panel||!modal||!modalBody||!openBtn||!courtsPanel||!courtsList)return;
  const marker=document.createComment('results-panel-original-location');
  panel.parentNode.insertBefore(marker,panel);
  const tablet=()=>window.matchMedia('(min-width: 768px) and (max-width: 1100px)').matches;
  function syncLayout(){
    if(tablet()){
      if(panel.parentNode!==modalBody) modalBody.appendChild(panel);
      openBtn.style.display='inline-flex';
    }else{
      if(panel.parentNode!==marker.parentNode) marker.parentNode.insertBefore(panel,marker.nextSibling);
      openBtn.style.removeProperty('display');
      closeModal();
    }
    syncWaitingScroll();
  }
  function openModal(){if(!tablet())return;modal.classList.add('is-open');modal.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';closeBtn?.focus();}
  function closeTabletResultsPopup(){modal.classList.remove('is-open');modal.setAttribute('aria-hidden','true');document.body.style.removeProperty('overflow');}
  function closeModal(){closeTabletResultsPopup();}
  function syncWaitingScroll(){
    const realCourtCount=courtsList.querySelectorAll(':scope > .court-card').length;
    const waitingCount=courtsList.querySelectorAll(':scope > .waiting-courts-section > .court-card, :scope > .waiting-courts-section > .waiting-court-card, :scope > .waiting-court-card').length;
    // Tablet panels stay balanced to the court content, not the number of queued players.
    // When the combined visible court cards exceed two, both panels get their own scrollbar.
    const needsScroll=(realCourtCount + waitingCount) > 2;
    courtsPanel.classList.toggle('tablet-court-overflow',needsScroll);
    courtsPanel.classList.toggle('tablet-many-waiting',waitingCount>2);
    const queuePanel=document.querySelector('.workspace > .queue-panel');
    queuePanel?.classList.toggle('tablet-court-overflow',needsScroll);
  }
  openBtn.addEventListener('click',openModal);
  closeBtn?.addEventListener('click',closeModal);
  modal.querySelectorAll('[data-close-tablet-results]').forEach(el=>el.addEventListener('click',closeModal));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modal.classList.contains('is-open'))closeModal();});
  window.addEventListener('resize',syncLayout);
  new MutationObserver(syncWaitingScroll).observe(courtsList,{childList:true,subtree:true});
  syncLayout();
})();
