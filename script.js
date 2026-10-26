// Keep refresh-only behavior scoped to queueing.html.
const IS_QUEUEING_PAGE=document.body?.dataset.page==='queueing';

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
  matchingMode:'balanced',
  winnersLosersNextGroup:'winners',
  sessionMetrics:{cloudCheckins:0,newRegistered:0},
  sessionActive:false,
  sessionEndedAt:null,
  sessionName:'Open Play — Oct 6, 2026',
  duprMatch:false,
  duprLocation:'',
  duprLabelsEnabled:true,
  recordScores:false,
  liveRankingEnabled:false,
  liveMatchesEnabled:false
};

const ORGANIZER_STORAGE_SUFFIX=String(window.PPM_ORGANIZER_ID||'').replace(/[^a-zA-Z0-9_-]/g,'');
const STORAGE_KEY=`pickleq_v11_state${ORGANIZER_STORAGE_SUFFIX?`_${ORGANIZER_STORAGE_SUFFIX}`:''}`;
const LOCAL_STATE_SAVED_AT_KEY=`${STORAGE_KEY}_saved_at`;
const LOCAL_STATE_PENDING_SYNC_KEY=`${STORAGE_KEY}_pending_sync`;
const CLOUD_RECORDS_SAVED_AT_KEY='pickleq_registered_cloud_records_saved_at';
const CLOUD_RECORDS_PENDING_SYNC_KEY='pickleq_registered_cloud_records_pending_sync';
const LIVE_VIEW_STORAGE_KEY=`picklepoint_live_view_state_v1${ORGANIZER_STORAGE_SUFFIX?`_${ORGANIZER_STORAGE_SUFFIX}`:''}`;
const LIVE_VIEW_THEME_STORAGE_KEY='picklepoint_live_view_theme_v1';
const LIVE_RANKING_ENABLED_KEY=`picklepoint_live_ranking_enabled_v1${ORGANIZER_STORAGE_SUFFIX?`_${ORGANIZER_STORAGE_SUFFIX}`:''}`;
const LIVE_MATCHES_ENABLED_KEY=`picklepoint_live_matches_enabled_v1${ORGANIZER_STORAGE_SUFFIX?`_${ORGANIZER_STORAGE_SUFFIX}`:''}`;
const RESULTS_TAB_STORAGE_KEY=`picklepoint_results_tab_v1${ORGANIZER_STORAGE_SUFFIX?`_${ORGANIZER_STORAGE_SUFFIX}`:''}`;
try{state.liveRankingEnabled=localStorage.getItem(LIVE_RANKING_ENABLED_KEY)==='true';state.liveMatchesEnabled=localStorage.getItem(LIVE_MATCHES_ENABLED_KEY)==='true';}catch(e){}
let liveViewBroadcastChannel=null;
let liveViewPublishInFlight=false;
let liveViewPendingSnapshot=null;
let liveViewPublishRetryTimer=null;
let liveViewPublishRetryDelay=3000;
let liveViewPendingKeepalive=false;
try{if('BroadcastChannel' in window)liveViewBroadcastChannel=new BroadcastChannel(`pickle-point-match-live-view${ORGANIZER_STORAGE_SUFFIX?`-${ORGANIZER_STORAGE_SUFFIX}`:''}`);}catch(e){}
const LEGACY_STORAGE_KEYS=ORGANIZER_STORAGE_SUFFIX?[]:['pickleq_v10_state','pickleq_v9_state','pickleq_v8_state','pickleq_v7_state','pickleq_v6_state'];
const CLOUD_RECORDS_KEY='pickleq_registered_cloud_records_v1';
let cloudRecords={players:[],logs:[],sessions:[]};let pendingCloudDeleteId=null;let editingCloudDuprId=null;let editingQueueDuprPlayerId=null;let editingCourtDuprKey=null;
const sharedClientId=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():`pp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let sharedSyncReady=false,sharedSyncAvailable=false,sharedSyncInitializing=false,sharedSyncRetryTimer=null;
let sharedAppRevision=0,sharedCloudRevision=0,appSyncInFlight=false,appSyncPending=null,cloudSyncInFlight=false,cloudSyncPending=null,applyingRemoteAppState=false,sharedEvents=null,sharedSyncStartedAt=0;
let remoteSessionEndRedirectInProgress=false;
function isHttpApp(){return location.protocol==='http:'||location.protocol==='https:';}
function cloneSharedData(value){try{return JSON.parse(JSON.stringify(value));}catch(e){return value;}}
function readLocalTimestamp(key){try{return Number(localStorage.getItem(key))||0;}catch(e){return 0;}}
function toTimestamp(value){if(typeof value==='number'&&Number.isFinite(value)&&value>0)return value;const numeric=Number(value);if(Number.isFinite(numeric)&&numeric>0)return numeric;const parsed=Date.parse(value);return Number.isFinite(parsed)&&parsed>0?parsed:0;}
function hasFreshLocalPending(savedAtKey,pendingKey,remoteUpdatedAt){const savedAt=readLocalTimestamp(savedAtKey),pendingAt=readLocalTimestamp(pendingKey);return pendingAt>0&&pendingAt===savedAt&&savedAt>toTimestamp(remoteUpdatedAt);}
function clearLocalPendingSync(pendingKey,savedAtKey,expectedSavedAt){try{if(Number(localStorage.getItem(pendingKey))===Number(expectedSavedAt)&&Number(localStorage.getItem(savedAtKey))===Number(expectedSavedAt))localStorage.removeItem(pendingKey);}catch(e){}}
function stampRemoteSave(savedAtKey,pendingKey,updatedAt){try{localStorage.setItem(savedAtKey,String(toTimestamp(updatedAt)||Date.now()));localStorage.removeItem(pendingKey);}catch(e){}}
function loadCloudRecords(){try{const d=JSON.parse(localStorage.getItem(CLOUD_RECORDS_KEY)||'null');if(d)cloudRecords={players:Array.isArray(d.players)?d.players:[],logs:Array.isArray(d.logs)?d.logs:[],sessions:Array.isArray(d.sessions)?d.sessions:[]};}catch(e){}}
function queueCloudRecordsSync(){if(applyingRemoteAppState)return;cloudSyncPending=cloneSharedData(cloudRecords);flushCloudRecordsSync();}
function saveCloudRecords(){const savedAt=Date.now();try{localStorage.setItem(CLOUD_RECORDS_KEY,JSON.stringify(cloudRecords));localStorage.setItem(CLOUD_RECORDS_SAVED_AT_KEY,String(savedAt));if(isHttpApp())localStorage.setItem(CLOUD_RECORDS_PENDING_SYNC_KEY,String(savedAt));else localStorage.removeItem(CLOUD_RECORDS_PENDING_SYNC_KEY);}catch(e){}queueCloudRecordsSync();}
function flushCloudRecordsSync(){
  if(!sharedSyncAvailable||!sharedSyncReady||cloudSyncInFlight||!cloudSyncPending||!isHttpApp())return;
  const records=cloudSyncPending;cloudSyncPending=null;cloudSyncInFlight=true;
  let failed=false;
  const savedAt=readLocalTimestamp(CLOUD_RECORDS_SAVED_AT_KEY);
  fetch('/api/cloud-records',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify({records,clientId:sharedClientId,baseRevision:sharedCloudRevision})})
    .then(async response=>{
      const data=await response.json();
      if(response.status===409&&data.conflict){
        if(hasFreshLocalPending(CLOUD_RECORDS_SAVED_AT_KEY,CLOUD_RECORDS_PENDING_SYNC_KEY,data.updatedAt))sharedCloudRevision=Math.max(sharedCloudRevision,Number(data.revision)||0);
        else applySharedCloudRecords({revision:data.revision,updatedAt:data.updatedAt,clientId:null,records:data.records});
      }
      if(!response.ok)throw new Error(`Cloud records sync failed (${response.status})`);
      sharedCloudRevision=Math.max(sharedCloudRevision,Number(data.revision)||0);
      if(savedAt&&JSON.stringify(cloudRecords)===JSON.stringify(records))clearLocalPendingSync(CLOUD_RECORDS_PENDING_SYNC_KEY,CLOUD_RECORDS_SAVED_AT_KEY,savedAt);
    })
    .catch(()=>{failed=true;cloudSyncPending=cloneSharedData(cloudRecords);scheduleSharedSyncRetry();})
    .finally(()=>{cloudSyncInFlight=false;if(cloudSyncPending&&!failed)flushCloudRecordsSync();});
}
function applySharedCloudRecords(payload,force=false){
  if(!payload||!payload.records)return;
  const revision=Number(payload.revision)||0;
  if(!force&&revision<=sharedCloudRevision)return;
  sharedCloudRevision=Math.max(sharedCloudRevision,revision);
  // Keep a more recent, locally saved edit when its upload has not reached the server yet.
  if(hasFreshLocalPending(CLOUD_RECORDS_SAVED_AT_KEY,CLOUD_RECORDS_PENDING_SYNC_KEY,payload.updatedAt)&&(!force||readLocalTimestamp(CLOUD_RECORDS_SAVED_AT_KEY)>sharedSyncStartedAt)){
    cloudSyncPending=cloneSharedData(cloudRecords);
    if(sharedSyncAvailable)flushCloudRecordsSync();
    return;
  }
  if(payload.clientId===sharedClientId&&!force){
    if(JSON.stringify(payload.records)===JSON.stringify(cloudRecords))clearLocalPendingSync(CLOUD_RECORDS_PENDING_SYNC_KEY,CLOUD_RECORDS_SAVED_AT_KEY,readLocalTimestamp(CLOUD_RECORDS_SAVED_AT_KEY));
    return;
  }
  cloudRecords={players:Array.isArray(payload.records.players)?payload.records.players:[],logs:Array.isArray(payload.records.logs)?payload.records.logs:[],sessions:Array.isArray(payload.records.sessions)?payload.records.sessions:[]};
  try{localStorage.setItem(CLOUD_RECORDS_KEY,JSON.stringify(cloudRecords));}catch(e){}
  stampRemoteSave(CLOUD_RECORDS_SAVED_AT_KEY,CLOUD_RECORDS_PENDING_SYNC_KEY,payload.updatedAt);
  cloudSyncPending=null;
  if($('cloudRecordsModal')&&!$('cloudRecordsModal').classList.contains('hidden'))renderCloudRecords();
  if($('registerFullname'))updateRegistrationSaveButton();
}
function getSharedAppStateSnapshot(){return {schemaVersion:12,players:state.players,left:state.left,queue:state.queue,lockedPartners:state.lockedPartners,courts:state.courts,logs:state.logs,nextPlayer:state.nextPlayer,nextCourt:state.nextCourt,nextWaitingCourt:state.nextWaitingCourt,nextLog:state.nextLog,sessionMetrics:state.sessionMetrics,sessionActive:state.sessionActive,sessionEndedAt:state.sessionEndedAt||null,sessionName:state.sessionName,duprMatch:state.duprMatch,duprLocation:state.duprLocation||'',duprLabelsEnabled:state.duprLabelsEnabled!==false,recordScores:state.recordScores,liveRankingEnabled:state.liveRankingEnabled!==false,liveMatchesEnabled:state.liveMatchesEnabled!==false,eventRules:state.eventRules,matchingMode:state.matchingMode,winnersLosersNextGroup:state.winnersLosersNextGroup};}
function queueSharedAppStateSync(snapshot){if(applyingRemoteAppState)return;appSyncPending=cloneSharedData(snapshot);flushSharedAppStateSync();}
function flushSharedAppStateSync(){
  if(!sharedSyncAvailable||!sharedSyncReady||appSyncInFlight||!appSyncPending||!isHttpApp())return;
  const snapshot=appSyncPending;appSyncPending=null;appSyncInFlight=true;
  let failed=false;
  const savedAt=readLocalTimestamp(LOCAL_STATE_SAVED_AT_KEY);
  fetch('/api/app-state',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify({state:snapshot,clientId:sharedClientId,baseRevision:sharedAppRevision})})
    .then(async response=>{
      const data=await response.json();
      if(response.status===409&&data.conflict){
        if(isExplicitSessionEndState(data.state))applySharedAppState({revision:data.revision,updatedAt:data.updatedAt,clientId:null,state:data.state},true);
        else if(hasFreshLocalPending(LOCAL_STATE_SAVED_AT_KEY,LOCAL_STATE_PENDING_SYNC_KEY,data.updatedAt))sharedAppRevision=Math.max(sharedAppRevision,Number(data.revision)||0);
        else applySharedAppState({revision:data.revision,updatedAt:data.updatedAt,clientId:null,state:data.state});
      }
      if(!response.ok)throw new Error(`Application state sync failed (${response.status})`);
      sharedAppRevision=Math.max(sharedAppRevision,Number(data.revision)||0);
      if(savedAt&&JSON.stringify(getSharedAppStateSnapshot())===JSON.stringify(snapshot))clearLocalPendingSync(LOCAL_STATE_PENDING_SYNC_KEY,LOCAL_STATE_SAVED_AT_KEY,savedAt);
    })
    .catch(()=>{failed=true;appSyncPending=getSharedAppStateSnapshot();scheduleSharedSyncRetry();})
    .finally(()=>{appSyncInFlight=false;if(appSyncPending&&!failed)flushSharedAppStateSync();});
}
function isExplicitSessionEndState(incomingState){
  return !!(incomingState&&incomingState.sessionEndedAt&&incomingState.sessionActive===false&&
    ['players','left','queue','courts','logs'].every(key=>Array.isArray(incomingState[key])&&incomingState[key].length===0));
}
function stableStateValue(value){
  if(Array.isArray(value))return value.map(stableStateValue);
  if(value&&typeof value==='object'){
    const sorted={};
    Object.keys(value).sort().forEach(key=>{sorted[key]=stableStateValue(value[key]);});
    return sorted;
  }
  return value;
}
function sharedStateMatchesCurrent(incomingState){
  const current=getSharedAppStateSnapshot();
  // Older stored snapshots may omit newer defaulted fields; compare the shared
  // schema keys that exist today and let loadState handle genuinely new data.
  const comparable={};
  Object.keys(current).forEach(key=>{
    comparable[key]=Object.prototype.hasOwnProperty.call(incomingState,key)?incomingState[key]:current[key];
  });
  return JSON.stringify(stableStateValue(comparable))===JSON.stringify(stableStateValue(current));
}
function applySharedAppState(payload,force=false){
  if(!payload||!payload.state||typeof payload.state!=='object')return;
  const revision=Number(payload.revision)||0;
  if(!force&&revision<=sharedAppRevision)return;
  sharedAppRevision=Math.max(sharedAppRevision,revision);
  const incomingState=payload.state;
  const isExplicitSessionEnd=isExplicitSessionEndState(incomingState);
  // A confirmed remote End Session must beat stale, locally pending queue data.
  // Otherwise a second device could re-upload its old queue and keep the session alive.
  if(!isExplicitSessionEnd&&hasFreshLocalPending(LOCAL_STATE_SAVED_AT_KEY,LOCAL_STATE_PENDING_SYNC_KEY,payload.updatedAt)&&(!force||readLocalTimestamp(LOCAL_STATE_SAVED_AT_KEY)>sharedSyncStartedAt)){
    appSyncPending=getSharedAppStateSnapshot();
    if(sharedSyncAvailable)flushSharedAppStateSync();
    return;
  }
  if(payload.clientId===sharedClientId&&!force){
    if(JSON.stringify(payload.state)===JSON.stringify(getSharedAppStateSnapshot()))clearLocalPendingSync(LOCAL_STATE_PENDING_SYNC_KEY,LOCAL_STATE_SAVED_AT_KEY,readLocalTimestamp(LOCAL_STATE_SAVED_AT_KEY));
    return;
  }
  appSyncPending=null;
  applyingRemoteAppState=true;
  try{
    const stateUnchanged=IS_QUEUEING_PAGE&&sharedStateMatchesCurrent(incomingState);
    if(stateUnchanged){
      // A new revision is not necessarily new data. Avoid tearing down the
      // queue, ranking list, and court DOM for no-op server updates.
      stampRemoteSave(LOCAL_STATE_SAVED_AT_KEY,LOCAL_STATE_PENDING_SYNC_KEY,payload.updatedAt);
    }else{
      localStorage.setItem(STORAGE_KEY,JSON.stringify(payload.state));
      stampRemoteSave(LOCAL_STATE_SAVED_AT_KEY,LOCAL_STATE_PENDING_SYNC_KEY,payload.updatedAt);
      loadState();
      syncLiveRankingAdminToggle(state.liveRankingEnabled!==false);
      syncLiveMatchesAdminToggle(state.liveMatchesEnabled!==false);
      render();
      publishLiveViewState();
    }
    syncLiveQueueStartScreen();
    if(isExplicitSessionEnd){
      const hasPendingCreateConfig=(()=>{try{return new URLSearchParams(location.search).get('create')==='1'&&!!sessionStorage.getItem('picklepoint.pending-live-queue-start-config');}catch(e){return false;}})();
      if(!hasPendingCreateConfig){
        if(document.body?.dataset.page==='queueing'){
          remoteSessionEndRedirectInProgress=true;
          try{sessionStorage.setItem('liveQueueView','start');}catch(e){}
          window.location.replace('session.html');
        }else{
          showLiveQueueStartScreen();
        }
      }
    }
  }catch(e){console.warn('Could not apply shared queue state',e);}
  finally{applyingRemoteAppState=false;}
}
function scheduleSharedSyncRetry(){if(sharedSyncRetryTimer!==null||!isHttpApp())return;sharedSyncRetryTimer=setTimeout(()=>{sharedSyncRetryTimer=null;if(!sharedSyncAvailable){initializeSharedDataSync();return;}flushSharedAppStateSync();flushCloudRecordsSync();},5000);}
async function initializeSharedDataSync(){if(!isHttpApp()){sharedSyncReady=true;return;}if(sharedSyncInitializing||sharedSyncAvailable)return;sharedSyncInitializing=true;if(!sharedSyncStartedAt)sharedSyncStartedAt=Date.now();try{const responses=await Promise.all([fetch(`/api/app-state?_=${Date.now()}`,{cache:'no-store'}),fetch(`/api/cloud-records?_=${Date.now()}`,{cache:'no-store'})]);if(responses.some(response=>!response.ok))throw new Error('Shared data API is not available');const [remoteApp,remoteCloud]=await Promise.all(responses.map(response=>response.json()));
  if(remoteApp.state&&typeof remoteApp.state==='object'){applySharedAppState({revision:remoteApp.revision,updatedAt:remoteApp.updatedAt,clientId:null,state:remoteApp.state},true);}else{const response=await fetch('/api/app-state',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify({state:getSharedAppStateSnapshot(),clientId:sharedClientId,onlyIfEmpty:true})});if(!response.ok)throw new Error('Unable to initialize shared queue state');const seeded=await response.json();sharedAppRevision=Number(seeded.revision)||0;if(seeded.accepted===false&&seeded.state)applySharedAppState({revision:seeded.revision,updatedAt:seeded.updatedAt,clientId:null,state:seeded.state},true);}
  if(remoteCloud.records&&typeof remoteCloud.records==='object'){applySharedCloudRecords({revision:remoteCloud.revision,updatedAt:remoteCloud.updatedAt,clientId:null,records:remoteCloud.records},true);}else{const response=await fetch('/api/cloud-records',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify({records:cloneSharedData(cloudRecords),clientId:sharedClientId,onlyIfEmpty:true})});if(!response.ok)throw new Error('Unable to initialize Registered Player Cloud');const seeded=await response.json();sharedCloudRevision=Number(seeded.revision)||0;if(seeded.accepted===false&&seeded.records)applySharedCloudRecords({revision:seeded.revision,updatedAt:seeded.updatedAt,clientId:null,records:seeded.records},true);}
  sharedSyncAvailable=true;sharedSyncReady=true;sharedEvents=new EventSource('/api/shared-events');sharedEvents.addEventListener('app-state',event=>{try{applySharedAppState(JSON.parse(event.data));}catch(e){}});sharedEvents.addEventListener('cloud-records',event=>{try{applySharedCloudRecords(JSON.parse(event.data));}catch(e){}});publishLiveViewState();flushSharedAppStateSync();flushCloudRecordsSync();
 }catch(error){sharedSyncReady=true;console.warn('Shared device sync is temporarily unavailable:',error);scheduleSharedSyncRetry();}finally{sharedSyncInitializing=false;}}
function upsertCloudPlayer(p){if(!p||!p.name)return;loadCloudRecords();let a=cloudRecords.players.find(x=>x.name.toLowerCase()===p.name.toLowerCase());if(!a){a={cloudId:Date.now()+Math.floor(Math.random()*100000),name:p.name,matches:0,wins:0,losses:0};cloudRecords.players.push(a);}Object.assign(a,{name:p.name,nickname:p.nickname||a.nickname||'',gender:p.gender||a.gender||'',category:p.category||a.category||'',duprId:p.duprId||p.duprID||p.dupr_id||p.dupr||a.duprId||a.duprID||a.dupr_id||a.dupr||'',selfRating:p.selfRating||p.self_rating||a.selfRating||a.self_rating||'',opgId:p.opgId||a.opgId||''});saveCloudRecords();}
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
function renderCloudRecords(){
  loadCloudRecords();
  const count=$('cloudRecordsCount');
  if(count)count.textContent=`(${cloudRecords.players.length})`;
  const q=($('cloudRecordsSearch')?.value||'').trim().toLowerCase();
  const players=cloudRecords.players.filter(p=>[p.name,p.nickname,p.gender,p.category,p.opgId,p.duprId,p.duprID,p.dupr_id,p.dupr,p.selfRating,p.self_rating].join(' ').toLowerCase().includes(q));
  $('cloudRecordsContent').innerHTML=players.map((p,index)=>{
    const cat=({BEG:'BEG',NOV:'NOV',INT:'INT',ADV:'ADV',EXP:'EXP'})[p.category]||p.category||'—';
    const cls=({BEG:'beg',NOV:'nov',INT:'int',ADV:'adv',EXP:'exp'})[p.category]||'nov';
    const active=state.players.find(sp=>String(sp.name||'').trim().toLowerCase()===String(p.name||'').trim().toLowerCase()&&(state.queue.includes(sp.id)||!!sp.court||(state.courts||[]).some(c=>(c.players||[]).includes(sp.id))));
    const alreadyQueued=!!active;
    const rawDuprId=String(p.duprId||p.duprID||p.dupr_id||p.dupr||'').trim().toUpperCase();
    const duprId=rawDuprId==='NR'?'':rawDuprId;
    const rawSelfRating=String(p.selfRating||p.self_rating||'').trim().toUpperCase();
    const selfRating=rawSelfRating==='NR'?'':rawSelfRating;
    const playerId=Number(p.cloudId);
    const editing=Number(editingCloudDuprId)===playerId;
    const duprBadge=editing?`<span class="cloud-dupr-inline-edit" role="group" aria-label="Edit DUPR ID and self rating">
      <span class="cloud-dupr-badge cloud-dupr-inline-fields ${duprId?'':'is-unrated'}"><span class="cloud-dupr-inline-prefix">DUPR:</span><input id="cloudDuprIdInput" type="text" maxlength="20" autocomplete="off" spellcheck="false" value="${esc(duprId||'NR')}" aria-label="DUPR ID" style="width:${Math.max(28,Math.min(200,(duprId||'NR').length*10+4))}px !important" oninput="this.style.setProperty('width',Math.max(28,Math.min(200,this.value.length*10+4))+'px','important')" onclick="event.stopPropagation()" onkeydown="if(event.key==='Enter'){event.preventDefault();saveCloudDuprDetails(${playerId})}else if(event.key==='Escape'){cancelEditCloudDuprDetails()}" /><span class="cloud-dupr-separator">•</span><input id="cloudSelfRatingInput" type="text" maxlength="12" inputmode="decimal" autocomplete="off" value="${esc(selfRating||'NR')}" aria-label="Self rating" style="width:${Math.max(28,Math.min(104,(selfRating||'NR').length*10+4))}px !important" oninput="this.style.setProperty('width',Math.max(28,Math.min(104,this.value.length*10+4))+'px','important')" onclick="event.stopPropagation()" onkeydown="if(event.key==='Enter'){event.preventDefault();saveCloudDuprDetails(${playerId})}else if(event.key==='Escape'){cancelEditCloudDuprDetails()}" /></span>
      <span class="cloud-dupr-editor-actions"><button type="button" class="cloud-dupr-save-btn" onclick="event.stopPropagation();saveCloudDuprDetails(${playerId})">Save</button><button type="button" class="cloud-dupr-cancel-btn" onclick="event.stopPropagation();cancelEditCloudDuprDetails()">Cancel</button></span>
    </span>`:`<button type="button" class="cloud-dupr-badge ${duprId?'':'is-unrated'}" onclick="event.stopPropagation();editCloudDuprDetails(${playerId})" aria-label="Edit DUPR ID and self rating" title="Click to edit DUPR ID and self rating"><span>DUPR: ${esc(duprId||'NR')}</span><span class="cloud-dupr-separator">•</span><span>${esc(selfRating||'NR')}</span></button>`;
    return `<article class="cloud-player-card"><div class="cloud-player-main"><div class="cloud-avatar"><span class="cloud-avatar-number">${index+1}</span>${esc((p.name||'?').charAt(0).toUpperCase())}</div><div class="cloud-player-ident"><b>${highlightSearchMatch(p.name,q)}${p.nickname?` (${highlightSearchMatch(p.nickname,q)})`:''} <span class="cloud-gender ${p.gender==='Female'?'gender-female':'gender-male'}">${genderSvgIcon(p.gender)}</span></b><small class="cloud-player-summary"><span class="cloud-category-badge skill-${cls}">${esc(cat)}</span>${duprBadge}<span class="cloud-player-stats"><span>${p.matches||0} Matches</span><span class="cloud-win">${p.wins||0} Wins</span><span class="cloud-loss">${p.losses||0} Losses</span></span></small></div><div class="cloud-player-actions"><button class="cloud-checkin-btn" ${alreadyQueued?'disabled aria-disabled="true" title="Player is already checked in or playing on court"':''} onclick="checkInCloudPlayer(${playerId})">${alreadyQueued?'Checked In':'Check in'}</button>${Number(pendingCloudDeleteId)===playerId?'':`<button class="cloud-delete-btn" ${alreadyQueued?'disabled aria-disabled="true" title="Cannot delete a checked-in player"':''} onclick="requestDeleteCloudPlayer(${playerId})">Delete</button>`}</div></div>${Number(pendingCloudDeleteId)===playerId?`<div class="cloud-delete-warning">Delete this registered profile? Match history will be kept. <button onclick="deleteCloudPlayer(${playerId})">Confirm</button> <button onclick="cancelDeleteCloudPlayer()">Cancel</button></div>`:''}</article>`;
  }).join('')||'<div class="cloud-empty"><div class="cloud-empty-icon">🏓</div><div>No registered player records found.</div></div>';
}
function editCloudDuprDetails(id){
  loadCloudRecords();
  const p=cloudRecords.players.find(player=>Number(player.cloudId)===Number(id));
  if(!p)return;
  editingCloudDuprId=Number(id);
  pendingCloudDeleteId=null;
  renderCloudRecords();
  const input=$('cloudDuprIdInput');
  if(input){input.focus();input.select();}
}
function cancelEditCloudDuprDetails(){editingCloudDuprId=null;renderCloudRecords();}
function saveCloudDuprDetails(id){
  const duprInput=$('cloudDuprIdInput');
  const ratingInput=$('cloudSelfRatingInput');
  if(!duprInput||!ratingInput)return;
  const enteredDuprId=String(duprInput.value||'').trim().toUpperCase();
  const duprId=enteredDuprId==='NR'?'':enteredDuprId;
  const enteredRating=String(ratingInput.value||'').trim().toUpperCase();
  const selfRating=enteredRating==='NR'?'':enteredRating;
  if(duprId&&!/^[A-Z0-9]{1,20}$/.test(duprId)){toast('DUPR ID must contain letters and numbers only.');duprInput.focus();return;}
  if(selfRating&&!/^\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?$/.test(selfRating)){toast('Enter self rating as a number, a range such as 2.5/4.0, or NR.');ratingInput.focus();return;}
  loadCloudRecords();
  const p=cloudRecords.players.find(player=>Number(player.cloudId)===Number(id));
  if(!p)return;
  p.duprId=duprId;p.duprID='';p.dupr_id='';p.dupr='';
  p.selfRating=selfRating;p.self_rating='';
  const normalizedName=String(p.name||'').trim().toLowerCase();
  let changedLiveState=false;
  [...state.players,...state.left].filter(player=>String(player.name||'').trim().toLowerCase()===normalizedName).forEach(player=>{
    player.duprId=duprId;player.duprID='';player.dupr_id='';player.dupr='';
    player.selfRating=selfRating;player.self_rating='';
    changedLiveState=true;
  });
  editingCloudDuprId=null;
  saveCloudRecords();
  if(changedLiveState)saveState();
  renderCloudRecords();
  toast('DUPR ID and self rating saved.');
}
function closeCloudMatchModal(){const el=$('cloudMatchActionModal');if(el){el.classList.add('hidden');el.classList.remove('cloud-match-edit-modal');}window._cloudMatchAction=null;}
function requestDeleteCloudPlayer(id){editingCloudDuprId=null;pendingCloudDeleteId=id;renderCloudRecords();}
function cancelDeleteCloudPlayer(){pendingCloudDeleteId=null;renderCloudRecords();}
function deleteCloudPlayer(id){loadCloudRecords();cloudRecords.players=cloudRecords.players.filter(p=>Number(p.cloudId)!==Number(id));pendingCloudDeleteId=null;if(Number(editingCloudDuprId)===Number(id))editingCloudDuprId=null;saveCloudRecords();renderCloudRecords();}
function checkInCloudPlayer(id){loadCloudRecords();const a=cloudRecords.players.find(p=>Number(p.cloudId)===Number(id));if(!a)return;let p=state.players.find(p=>p.name.toLowerCase()===a.name.toLowerCase());if(!p){const left=state.left.find(p=>p.name.toLowerCase()===a.name.toLowerCase());if(left){checkIn(left.id,true);state.sessionMetrics.cloudCheckins=(Number(state.sessionMetrics.cloudCheckins)||0)+1;saveState();renderCloudRecords();return;}p={id:state.nextPlayer++,name:a.name,nickname:a.nickname||'',wins:a.wins||0,court:null,gender:a.gender||'Male',category:a.category||'',duprId:a.duprId||a.duprID||a.dupr_id||a.dupr||'',selfRating:a.selfRating||a.self_rating||'',queuedAt:Date.now(),waitingSince:Date.now()};state.players.push(p);}else{p.duprId=p.duprId||a.duprId||a.duprID||a.dupr_id||a.dupr||'';p.selfRating=p.selfRating||a.selfRating||a.self_rating||'';}if(p.court){toast('Player is already on court.');return;}if(!state.queue.includes(p.id))state.queue.push(p.id);p.queuedAt=Date.now();p.waitingSince=p.queuedAt;state.sessionMetrics.cloudCheckins=(Number(state.sessionMetrics.cloudCheckins)||0)+1;saveState();render();renderCloudRecords();toast(`${p.name} checked in.`);}

let openCategoryPlayerId=null;
let openGenderPlayerId=null;
let registrationGender='';
let registrationSkillLevel='';
let courtSettingsDraft=null;

const $=id=>document.getElementById(id);

// Shared SVG gender symbols keep all player icons crisp and aligned across browsers.
function genderSvgIcon(gender){
  const value=String(gender||'').trim().toLowerCase();
  const isFemale=['female','f','woman','women'].includes(value);
  return isFemale
    ? '<svg class="gender-symbol gender-symbol-female" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="4.8" r="3.55" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 8.4v5.9M5.25 11.35h5.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
    : '<svg class="gender-symbol gender-symbol-male" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="5.35" cy="10.65" r="3.45" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7.8 8.2 14.1 1.9M9.35 1.9h4.75v4.75" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

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
  syncDuprCsvDownloadButtons();
}

function closeEndSessionConfirmation(){
  const modal=$('endSessionModal');
  if(modal)modal.classList.add('hidden');
}

function endSession(){
  closeEndSessionConfirmation();
  archiveLiveSession();
  try{LEGACY_STORAGE_KEYS.forEach(k=>localStorage.removeItem(k));}
  catch(e){console.warn('PickleQ reset cleanup failed',e);}

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
  state.sessionEndedAt=new Date().toISOString();
  state.sessionName='Open Play — Oct 6, 2026';
  state.duprMatch=false;
  state.duprLocation='';
  state.duprLabelsEnabled=true;
  state.recordScores=false;
  state.matchingMode='balanced';
  state.winnersLosersNextGroup='winners';
  openCategoryPlayerId=null;
  openGenderPlayerId=null;
  registrationGender='';
  // Restore the setup controls to their original defaults without forcing a reload.
  document.querySelectorAll('#liveQueueMatchType .live-queue-choice').forEach(btn=>btn.classList.toggle('active',btn.dataset.value==='Doubles'));
  document.querySelectorAll('#liveQueueWinBy .live-queue-choice').forEach(btn=>btn.classList.toggle('active',btn.dataset.value==='1'));
  document.querySelectorAll('#liveQueueGameMode .live-queue-game').forEach(btn=>btn.classList.toggle('active',btn.dataset.target==='11'));
  if($('liveQueueRecordResults'))$('liveQueueRecordResults').checked=false;
  // Persist the empty queue to shared storage before any subsequent refresh.
  // Keeping the page alive avoids cancelling the just-started sync request.
  saveState();
  publishLiveViewState(true);
  if(document.body?.dataset.page==='queueing'){
    window.location.assign('session.html');
    return;
  }
  showLiveQueueStartScreen();
}

function isLiveRankingEnabled(){
  if(typeof state.liveRankingEnabled==='boolean')return state.liveRankingEnabled;
  try{return localStorage.getItem(LIVE_RANKING_ENABLED_KEY)==='true';}catch(e){return false;}
}
function syncLiveRankingAdminToggle(enabled=isLiveRankingEnabled()){
  const button=$('liveRankingAdminToggle');
  if(!button)return;
  const isEnabled=enabled!==false;
  button.classList.toggle('is-enabled',isEnabled);
  button.classList.toggle('is-disabled',!isEnabled);
  button.setAttribute('aria-pressed',String(isEnabled));
  button.setAttribute('aria-label',isEnabled?'Turn Live Standing off':'Turn Live Standing on');
  button.title=isEnabled?'Turn Live Standing off':'Turn Live Standing on';
  const label=button.querySelector('.live-ranking-admin-label');
  if(label)label.textContent=`Live Standing: ${isEnabled?'On':'Off'}`;
}
function initLiveRankingAdminToggle(){
  const button=$('liveRankingAdminToggle');
  if(!button)return;
  syncLiveRankingAdminToggle();
  button.addEventListener('click',()=>{
    const enabled=!isLiveRankingEnabled();
    state.liveRankingEnabled=enabled;
    try{localStorage.setItem(LIVE_RANKING_ENABLED_KEY,String(enabled));}catch(e){}
    syncLiveRankingAdminToggle(enabled);
    saveState();
    if(typeof toast==='function')toast(`Live Standing ${enabled?'enabled':'disabled'} on Live View.`);
  });
  window.addEventListener('storage',event=>{
    if(event.key===LIVE_RANKING_ENABLED_KEY){
      state.liveRankingEnabled=event.newValue==='true';
      syncLiveRankingAdminToggle(state.liveRankingEnabled);
      publishLiveViewState();
    }
  });
}
function isLiveMatchesEnabled(){
  if(typeof state.liveMatchesEnabled==='boolean')return state.liveMatchesEnabled;
  try{return localStorage.getItem(LIVE_MATCHES_ENABLED_KEY)==='true';}catch(e){return false;}
}
function syncLiveMatchesAdminToggle(enabled=isLiveMatchesEnabled()){
  const button=$('liveMatchesAdminToggle');
  if(!button)return;
  const isEnabled=enabled!==false;
  button.classList.toggle('is-enabled',isEnabled);
  button.classList.toggle('is-disabled',!isEnabled);
  button.setAttribute('aria-pressed',String(isEnabled));
  button.setAttribute('aria-label',isEnabled?'Turn Live Matches off':'Turn Live Matches on');
  button.title=isEnabled?'Turn Live Matches off':'Turn Live Matches on';
  const label=button.querySelector('.live-ranking-admin-label');
  if(label)label.textContent=`Live Matches: ${isEnabled?'On':'Off'}`;
}
function initLiveMatchesAdminToggle(){
  const button=$('liveMatchesAdminToggle');
  if(!button)return;
  syncLiveMatchesAdminToggle();
  button.addEventListener('click',()=>{
    const enabled=!isLiveMatchesEnabled();
    state.liveMatchesEnabled=enabled;
    try{localStorage.setItem(LIVE_MATCHES_ENABLED_KEY,String(enabled));}catch(e){}
    syncLiveMatchesAdminToggle(enabled);
    saveState();
    if(typeof toast==='function')toast(`Live Matches ${enabled?'enabled':'disabled'} on Live View.`);
  });
  window.addEventListener('storage',event=>{
    if(event.key===LIVE_MATCHES_ENABLED_KEY){
      state.liveMatchesEnabled=event.newValue==='true';
      syncLiveMatchesAdminToggle(state.liveMatchesEnabled);
      publishLiveViewState();
    }
  });
}
function resetLiveViewFeatureTogglesForNewSession(){
  // Every newly created session starts with both public Live View sections disabled.
  // Continuing an existing session does not call this helper, so its saved settings remain intact.
  state.liveRankingEnabled=false;
  state.liveMatchesEnabled=false;
  try{
    localStorage.setItem(LIVE_RANKING_ENABLED_KEY,'false');
    localStorage.setItem(LIVE_MATCHES_ENABLED_KEY,'false');
  }catch(e){}
  syncLiveRankingAdminToggle(false);
  syncLiveMatchesAdminToggle(false);
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
    // A running match keeps the format it started with; ready courts follow
    // the current event rule so the public Live View updates before start.
    const courtType=(c.playing&&c.type?c.type:state.eventRules?.type)==='Singles'?'Singles':'Doubles';
    const singlesMode=courtType==='Singles';
    return {
      id:c.id,
      name:c.waitingOnly?(String(c.name||'').trim()||`Waiting Court #${c.waitingOrder||1}`):courtDisplayName(c),
      number:Number(c.number)||null,
      waitingOnly:!!c.waitingOnly,
      playing:!!c.playing,
      type:courtType,
      start:c.playing?(c.start||null):null,
      target:Number(c.target)||Number(state.eventRules?.target)||11,
      winBy:Number(c.winBy)||Number(state.eventRules?.winBy)||1,
      players:slots,
      team1:singlesMode?[slots[0]||null]:slots.slice(0,2),
      team2:singlesMode?[slots[1]||null]:slots.slice(2,4),
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
  const rankingStats=getRankingStats();
  const rankingPlayers=[...new Map([...state.players,...state.left].map(p=>[String(p.id),p])).values()];
  const liveRanking=rankingPlayers
    .filter(p=>(rankingStats.get(p.id)?.matches||0)>0)
    .sort((a,b)=>compareLeaderboardPlayers(a,b,rankingStats))
    .map((p,index)=>{
      const st=rankingStats.get(p.id)||{matches:0,wins:0,losses:0,winRate:0,totalSeconds:0};
      return {
        position:index+1,
        id:String(p.id),
        name:String(p.name||'Player'),
        nickname:String(p.nickname||''),
        gender:String(p.gender||''),
        category:String(p.category||''),
        matches:Number(st.matches)||0,
        wins:Number(st.wins)||0,
        losses:Number(st.losses)||0,
        winRate:Number(st.winRate)||0,
        totalSeconds:Number(st.totalSeconds)||0,
        playing:isPlayerPlaying(p)
      };
    });
  return {
    sessionName:String(state.sessionName||'Pickle Point Match'),
    active:!!state.sessionActive,
    recordScores:!!state.recordScores,
    liveRankingEnabled:state.liveRankingEnabled!==false,
    liveMatchesEnabled:state.liveMatchesEnabled!==false,
    updatedAt:new Date().toISOString(),
    playerCount:roster.length,
    queue:(Array.isArray(state.queue)?state.queue:[]).map(id=>{
      const queuedPlayer=playerRef(id);
      if(!queuedPlayer)return null;
      const lockedPair=(Array.isArray(state.lockedPartners)?state.lockedPartners:[])
        .find(pair=>Array.isArray(pair)&&pair.map(Number).includes(Number(id)));
      const partnerId=lockedPair?.find(partnerId=>Number(partnerId)!==Number(id));
      const partner=partnerId!=null?byId.get(String(partnerId)):null;
      const partnerFirstName=String(partner?.name||'').trim().split(/\s+/)[0]||'';
      return {...queuedPlayer,lockedPartnerName:partnerFirstName};
    }).filter(Boolean),
    courts,
    activeCourtCount:courts.filter(c=>!c.waitingOnly&&c.playing).length,
    readyCourtCount:courts.filter(c=>!c.waitingOnly&&!c.playing).length,
    courtCount:courts.filter(c=>!c.waitingOnly).length,
    waitingCourtCount:courts.filter(c=>c.waitingOnly).length,
    matchCount:Array.isArray(state.logs)?state.logs.length:0,
    ranking:liveRanking,
    eventRules:{target:Number(state.eventRules?.target)||11,winBy:Number(state.eventRules?.winBy)||1,type:String(state.eventRules?.type||'Doubles')},
    recentMatches
  };
}
function flushLiveViewState(){
  if(!sharedSyncReady)return;
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
  const url=new URL('live.html',window.location.href);
  if(window.PPM_ORGANIZER_ID)url.searchParams.set('organizer',window.PPM_ORGANIZER_ID);
  return url;
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
  if(label)label.textContent=lightMode?'Light Mode':'Dark Mode';
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
  let remoteThemeReceived=false;
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
    // Subscribe to the server's shared theme stream. localStorage only syncs
    // tabs in the same browser; the server stream keeps other devices in step.
    try{
      if(typeof EventSource!=='undefined'){
        const themeEvents=new EventSource('/api/live-events');
        themeEvents.addEventListener('live-theme',event=>{
          const theme=String(event.data||'').trim();
          if(theme!=='light'&&theme!=='night')return;
          remoteThemeReceived=true;
          setLiveViewTheme(theme,false);
        });
      }
    }catch(e){}
    // Keep GET as a fallback for servers/proxies where EventSource is unavailable.
    fetch('/api/live-theme',{cache:'no-store'}).then(response=>response.ok?response.json():null).then(data=>{
      if(!themeChangedLocally&&!remoteThemeReceived&&data&&(data.theme==='light'||data.theme==='night'))setLiveViewTheme(data.theme,false);
    }).catch(()=>{});
  }
}
function openLiveView(){
  const url=getLiveViewUrl();
  window.open(url.href,'_blank','noopener');
}
function syncLiveViewOrganizerQrLogo(forceRefresh=false){
  const logo=$('liveViewOrganizerQrLogo');
  if(!logo)return;
  const organizerId=String(window.PPM_ORGANIZER_ID||'').trim();
  if(!organizerId){
    logo.src='pickleball-p-emblem.png';
    logo.dataset.organizerLogoReady='true';
    return;
  }
  if(!forceRefresh&&logo.dataset.organizerLogoId===organizerId&&['loading','true'].includes(logo.dataset.organizerLogoReady||''))return;
  logo.dataset.organizerLogoId=organizerId;
  logo.dataset.organizerLogoReady='loading';
  fetch(`/api/live-state?organizer=${encodeURIComponent(organizerId)}`,{cache:'no-store',credentials:'same-origin'})
    .then(response=>response.ok?response.json():null)
    .then(data=>{
      if(logo.dataset.organizerLogoId!==organizerId)return;
      const organizerLogo=typeof data?.organizerLogo==='string'?data.organizerLogo.trim():'';
      logo.onerror=null;
      logo.src=organizerLogo||'pickleball-p-emblem.png';
      logo.dataset.hasCustomOrganizerLogo=organizerLogo?'true':'false';
      logo.onerror=()=>{
        logo.onerror=null;
        logo.src='pickleball-p-emblem.png';
        logo.dataset.hasCustomOrganizerLogo='false';
      };
      logo.dataset.organizerLogoReady='true';
    })
    .catch(()=>{
      if(logo.dataset.organizerLogoId!==organizerId)return;
      logo.src='pickleball-p-emblem.png';
      logo.dataset.hasCustomOrganizerLogo='false';
      logo.dataset.organizerLogoReady='true';
    });
}
function syncEventOrganizerBadgeLogo(forceRefresh=false){
  const logo=$('eventOrganizerLogo');
  if(!logo)return;
  const organizerId=String(window.PPM_ORGANIZER_ID||'').trim();
  if(!organizerId){
    logo.hidden=true;
    logo.removeAttribute('src');
    logo.dataset.organizerLogoId='';
    logo.dataset.organizerLogoReady='true';
    return;
  }
  if(!forceRefresh&&logo.dataset.organizerLogoId===organizerId&&['loading','true'].includes(logo.dataset.organizerLogoReady||''))return;
  logo.dataset.organizerLogoId=organizerId;
  logo.dataset.organizerLogoReady='loading';
  logo.hidden=true;
  fetch(`/api/live-state?organizer=${encodeURIComponent(organizerId)}`,{cache:'no-store',credentials:'same-origin'})
    .then(response=>response.ok?response.json():null)
    .then(data=>{
      if(logo.dataset.organizerLogoId!==organizerId)return;
      const organizerLogo=typeof data?.organizerLogo==='string'?data.organizerLogo.trim():'';
      logo.onerror=null;
      if(organizerLogo){
        logo.src=organizerLogo;
        logo.hidden=false;
        logo.onerror=()=>{
          logo.onerror=null;
          logo.hidden=true;
          logo.removeAttribute('src');
        };
      }else{
        logo.hidden=true;
        logo.removeAttribute('src');
      }
      logo.dataset.organizerLogoReady='true';
    })
    .catch(()=>{
      if(logo.dataset.organizerLogoId!==organizerId)return;
      logo.hidden=true;
      logo.removeAttribute('src');
      logo.dataset.organizerLogoReady='true';
    });
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
  syncLiveViewOrganizerQrLogo();

  // Bind image events once so the QR becomes visible as soon as it loads,
  // and use a second QR endpoint automatically if the primary one fails.
  if(!image.dataset.qrNetworkEventsBound){
    image.dataset.qrNetworkEventsBound='true';
    image.addEventListener('load',()=>{
      if(navigator.onLine===false)return;
      image.hidden=false;
      loader.hidden=true;
      unavailable.hidden=true;
      const organizerLogo=$('liveViewOrganizerQrLogo');
      if(organizerLogo)organizerLogo.hidden=false;
    });
    image.addEventListener('error',()=>{
      const organizerLogo=$('liveViewOrganizerQrLogo');
      if(organizerLogo)organizerLogo.hidden=true;
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
    const organizerLogo=$('liveViewOrganizerQrLogo');
    if(organizerLogo)organizerLogo.hidden=true;
    image.removeAttribute('src');
    delete image.dataset.qrTarget;
    image.dataset.qrFallbackAttempted='false';
    loader.hidden=false;
    unavailable.hidden=true;
    if(statusTitle)statusTitle.textContent='Offline mode';
    if(statusNote)statusNote.textContent='You are offline, so the QR preview is paused. Reconnect to restore QR sharing.';
    return;
  }

  loader.hidden=true;
  const url=getLiveViewUrl();
  const isHttp=['http:','https:'].includes(url.protocol);
  image.hidden=!isHttp;
  unavailable.hidden=isHttp;
  if(!isHttp){
    const organizerLogo=$('liveViewOrganizerQrLogo');
    if(organizerLogo)organizerLogo.hidden=true;
    image.removeAttribute('src');
    delete image.dataset.qrTarget;
    if(statusTitle)statusTitle.textContent='Local / private link';
    if(statusNote)statusNote.textContent='Open Pickle Point Match through a web server to generate a scannable QR code.';
    return;
  }

  // Prepare the QR as soon as the app detects an online connection, even
  // while this modal is closed, so opening it can show the QR immediately.
  const target=url.href;
  const imageFailed=image.complete&&image.naturalWidth===0;
  const needsRefresh=forceQrRefresh===true||image.dataset.qrTarget!==target||!image.getAttribute('src')||imageFailed;
  if(needsRefresh){
    const organizerLogo=$('liveViewOrganizerQrLogo');
    if(organizerLogo)organizerLogo.hidden=true;
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
    ?'Anyone with this link can watch the live queue from a phone or browser.'
    :'This link is limited to this computer or local network. For access from anywhere, host the app on a public HTTPS address.';
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
// Preload the Live View QR while online; its centered logo comes from the current organizer profile.
syncLiveViewQrNetworkState();
function closeLiveViewQrModal(){ $('liveViewQrModal')?.classList.add('hidden'); }
async function copyLiveViewQrLink(){
  const field=$('liveViewQrUrl');if(!field)return;
  try{await navigator.clipboard.writeText(field.value);toast('Live View link copied.');}
  catch(e){field.focus();field.select();let copied=false;try{copied=document.execCommand('copy');}catch(err){}toast(copied?'Live View link copied.':'Select and copy the Live View link.');}
}
function getRegistrationPageUrl(){const url=new URL('Registration.html',window.location.href);if(window.PPM_ORGANIZER_ID)url.searchParams.set('organizer',window.PPM_ORGANIZER_ID);return url;}
function syncRegistrationQrNetworkState(){
  const modal=$('registrationQrModal'),wrap=$('registrationQrImageWrap'),image=$('registrationQrImage'),unavailable=$('registrationQrUnavailable'),loader=$('registrationQrLoader'),title=$('registrationQrStatusTitle'),note=$('registrationQrStatusNote'),brandLogo=$('registrationQrBrandLogo');
  if(!modal||!wrap||!image||!unavailable||!loader)return;
  if(!image.dataset.brandLogoEventsBound){
    image.dataset.brandLogoEventsBound='true';
    image.addEventListener('load',()=>{if(navigator.onLine!==false&&brandLogo)brandLogo.hidden=false;});
    image.addEventListener('error',()=>{if(brandLogo)brandLogo.hidden=true;});
  }
  const url=getRegistrationPageUrl();
  const online=navigator.onLine!==false;
  wrap.classList.toggle('is-offline',!online);
  if(!online){image.hidden=true;if(brandLogo)brandLogo.hidden=true;image.removeAttribute('src');delete image.dataset.qrTarget;image.dataset.qrFallbackAttempted='false';loader.hidden=false;unavailable.hidden=true;if(title)title.textContent='Offline mode';if(note)note.textContent='Reconnect to generate the registration QR code.';return;}
  loader.hidden=true;
  if(!['http:','https:'].includes(url.protocol)){image.hidden=true;if(brandLogo)brandLogo.hidden=true;image.removeAttribute('src');delete image.dataset.qrTarget;unavailable.textContent='Open Pickle Point Match through a web server to generate a QR code for phones.';unavailable.hidden=false;if(title)title.textContent='Web server required';if(note)note.textContent='The phone needs an HTTP or HTTPS registration link.';return;}
  const target=url.href;
  image.hidden=false;unavailable.hidden=true;
  if(image.dataset.qrTarget!==target){if(brandLogo)brandLogo.hidden=true;image.dataset.qrTarget=target;image.dataset.qrFallbackAttempted='false';image.onerror=()=>{if(image.dataset.qrFallbackAttempted!=='true'){image.dataset.qrFallbackAttempted='true';image.src='https://quickchart.io/qr?size=280&margin=8&text='+encodeURIComponent(target);return;}image.hidden=true;delete image.dataset.qrTarget;unavailable.textContent='QR preview could not load. Use the registration link below instead.';unavailable.hidden=false;};image.src='https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=8&data='+encodeURIComponent(target);}
  const host=url.hostname;const localHost=host==='localhost'||host==='127.0.0.1'||host==='0.0.0.0'||host==='::1'||/^10\./.test(host)||/^192\.168\./.test(host)||/^172\.(1[6-9]|2[0-9]|3[01])\./.test(host);
  if(title)title.textContent= url.protocol==='https:'&&!localHost?'Registration link ready':'Local / private link';
  if(note)note.textContent=localHost?'Scan from a phone connected to the same Wi-Fi network, and use the computer’s reachable LAN address if this link contains localhost.':'Players can complete their details, then they are saved to Registered Player Cloud and added to the queue automatically.';
}
function openRegistrationQrModal(){
  const modal=$('registrationQrModal'),field=$('registrationQrUrl');if(!modal||!field)return;
  field.value=getRegistrationPageUrl().href;modal.classList.remove('hidden');syncRegistrationQrNetworkState();
}
function closeRegistrationQrModal(){$('registrationQrModal')?.classList.add('hidden');}
async function copyRegistrationQrLink(){
  const field=$('registrationQrUrl');if(!field)return;
  try{await navigator.clipboard.writeText(field.value);toast('Registration link copied.');}
  catch(e){field.focus();field.select();let copied=false;try{copied=document.execCommand('copy');}catch(err){}toast(copied?'Registration link copied.':'Select and copy the registration link.');}
}
function openRegistrationPage(){window.open(getRegistrationPageUrl().href,'_blank','noopener');}
window.addEventListener('online',()=>{if($('registrationQrModal')&&!$('registrationQrModal').classList.contains('hidden'))syncRegistrationQrNetworkState();});
window.addEventListener('offline',()=>{if($('registrationQrModal')&&!$('registrationQrModal').classList.contains('hidden'))syncRegistrationQrNetworkState();});

function syncQueueDuprLabelsToggle(){
  const toggle=$('queueDuprLabelsToggle');
  if(!toggle)return;
  const enabled=state.duprLabelsEnabled!==false;
  toggle.textContent=enabled?'Dupr on':'Dupr off';
  toggle.classList.toggle('is-off',!enabled);
  toggle.title=enabled?'Dupr on — click to hide labels':'Dupr off — click to show labels';
  toggle.setAttribute('aria-pressed',String(enabled));
  toggle.setAttribute('aria-label',enabled?'Dupr on — click to hide labels':'Dupr off — click to show labels');
}

function saveState(){
  const snapshot=getSharedAppStateSnapshot();
  const savedAt=Date.now();
  try{
    localStorage.setItem(STORAGE_KEY,JSON.stringify(snapshot));
    localStorage.setItem(LOCAL_STATE_SAVED_AT_KEY,String(savedAt));
    if(isHttpApp())localStorage.setItem(LOCAL_STATE_PENDING_SYNC_KEY,String(savedAt));
    else localStorage.removeItem(LOCAL_STATE_PENDING_SYNC_KEY);
  }catch(e){console.warn('PickleQ save failed',e);}
  queueSharedAppStateSync(snapshot);
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
    state.sessionEndedAt=typeof data.sessionEndedAt==='string'&&data.sessionEndedAt?data.sessionEndedAt:null;
    state.sessionName=String(data.sessionName||'Open Play — Oct 6, 2026');
    state.duprMatch=!!data.duprMatch;
    state.duprLocation=String(data.duprLocation||'').trim();
    state.duprLabelsEnabled=typeof data.duprLabelsEnabled==='boolean'?data.duprLabelsEnabled:true;
    state.recordScores=typeof data.recordScores==='boolean'?data.recordScores:false;
    state.liveRankingEnabled=typeof data.liveRankingEnabled==='boolean'?data.liveRankingEnabled:isLiveRankingEnabled();
    state.liveMatchesEnabled=typeof data.liveMatchesEnabled==='boolean'?data.liveMatchesEnabled:isLiveMatchesEnabled();
    try{localStorage.setItem(LIVE_RANKING_ENABLED_KEY,String(state.liveRankingEnabled));localStorage.setItem(LIVE_MATCHES_ENABLED_KEY,String(state.liveMatchesEnabled));}catch(e){}
    state.matchingMode=['balanced','social-mix','skill-separated','winners-losers'].includes(data.matchingMode)?data.matchingMode:'balanced';
    state.winnersLosersNextGroup=data.winnersLosersNextGroup==='losers'?'losers':'winners';
    state.nextPlayer=Number(data.nextPlayer)||((state.players.reduce((m,p)=>Math.max(m,Number(p.id)||0),0))+1);
    state.nextCourt=Number(data.nextCourt)||((state.courts.reduce((m,c)=>Math.max(m,Number(c.number)||0),0))+1);
    state.nextWaitingCourt=Number(data.nextWaitingCourt)||1;
    state.nextLog=Number(data.nextLog)||((state.logs.reduce((m,l)=>Math.max(m,Number(l.id)||0),0))+1);
    const loadedTarget=Number(data.eventRules?.target); state.eventRules={target:[11,15,21].includes(loadedTarget)?loadedTarget:(loadedTarget===22?21:11),winBy:[1,2,3].includes(Number(data.eventRules?.winBy))?Number(data.eventRules.winBy):1,type:data.eventRules?.type==='Singles'?'Singles':'Doubles'};
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
function isSinglesCourt(c=null){return String(c?.type||state.eventRules?.type||'Doubles')==='Singles';}
function courtPlayerLimit(c=null){return isSinglesCourt(c)?2:4;}
function courtTeamPlayers(c){
  const ids=Array.isArray(c?.players)?c.players:[];
  if(isSinglesCourt(c))return [[player(ids[0])].filter(Boolean),[player(ids[1])].filter(Boolean)];
  return [ids.slice(0,2).map(player).filter(Boolean),ids.slice(2,4).map(player).filter(Boolean)];
}
function courtMixActionLabel(c=null){return isSinglesCourt(c)?'⇄ Swap Sides':'⇄ Mix Teams';}

function toast(msg){
  const t=$('toast');
  t.textContent=msg;
  t.style.display='block';
  clearTimeout(window.__toast);
  window.__toast=setTimeout(()=>t.style.display='none',2200);
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
  const p=player(pid); if(!p||!c||c.playing||c.players.filter(Boolean).length>=courtPlayerLimit(c)||p.court)return false;
  // Fill the first empty slot without shifting any existing player between teams.
  let slot=c.players.findIndex(value=>!value);
  if(slot<0) slot=c.players.length;
  c.players[slot]=pid;p.court=c.id;state.queue=state.queue.filter(x=>x!==pid);return true;
}
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
          <div class="cloud-player-ident"><b>${highlightSearchMatch(p.name||'Unknown',query)}${p.nickname?` (${highlightSearchMatch(p.nickname,query)})`:''} <span class="cloud-gender ${p.gender==='Female'?'gender-female':'gender-male'}">${genderSvgIcon(p.gender)}</span></b>
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
  toast(`${name} added. Select ${courtPlayerLimit()} players for the next available court.`);
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
  if(c.players.filter(Boolean).length===courtPlayerLimit(c)){
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

function autoMatchHistoryContext(){
  const teammateCounts=new Map();
  const opponentCounts=new Map();
  const outcomeById=new Map();
  const makePairKey=(a,b)=>{const first=String(a),second=String(b);return first<second?`${first}|${second}`:`${second}|${first}`;};
  const queueIndexById=new Map((state.queue||[]).map((id,index)=>[Number(id),index]));
  const addPair=(map,a,b)=>{
    if(a==null||b==null||String(a)===String(b))return;
    const key=makePairKey(a,b);
    map.set(key,(map.get(key)||0)+1);
  };
  (state.logs||[]).forEach(log=>{
    const team1=[...new Set((Array.isArray(log.team1Ids)?log.team1Ids:[]).filter(id=>id!=null).map(String))];
    const team2=[...new Set((Array.isArray(log.team2Ids)?log.team2Ids:[]).filter(id=>id!=null).map(String))];
    for(let i=0;i<team1.length;i++)for(let j=i+1;j<team1.length;j++)addPair(teammateCounts,team1[i],team1[j]);
    for(let i=0;i<team2.length;i++)for(let j=i+1;j<team2.length;j++)addPair(teammateCounts,team2[i],team2[j]);
    team1.forEach(a=>team2.forEach(b=>addPair(opponentCounts,a,b)));

    let winnerTeam=Number(log.winnerTeam);
    if(winnerTeam!==1&&winnerTeam!==2){
      const score=String(log.score||'').split('-').map(value=>Number(value.trim()));
      if(score.length===2&&Number.isFinite(score[0])&&Number.isFinite(score[1])&&score[0]!==score[1])winnerTeam=score[0]>score[1]?1:2;
    }
    if(winnerTeam===1||winnerTeam===2){
      const winnerIds=winnerTeam===1?team1:team2;
      const loserIds=winnerTeam===1?team2:team1;
      winnerIds.forEach(id=>outcomeById.set(String(id),'winners'));
      loserIds.forEach(id=>outcomeById.set(String(id),'losers'));
    }
  });
  return {teammateCounts,opponentCounts,outcomeById,makePairKey,queueIndexById};
}

function autoMatchSkillLevel(p){
  if(!p)return null;
  const categoryLevel={BEG:1,NOV:2,INT:3,ADV:4,EXP:5}[String(p.category||'').toUpperCase()];
  if(categoryLevel)return categoryLevel;
  const rawValues=[p.rating,p.duprRating,p.dupr_rating,p.ratingLevel,p.rankLevel,p.level];
  for(const raw of rawValues){
    const value=Number.parseFloat(String(raw??'').trim());
    if(Number.isFinite(value)&&value>0&&value<10)return Math.max(1,Math.min(5,value-1));
  }
  return null;
}

function autoMatchRating(p){
  if(!p)return null;
  const rawValues=[p.rating,p.duprRating,p.dupr_rating,p.ratingLevel,p.rankLevel,p.level];
  for(const raw of rawValues){
    const value=Number.parseFloat(String(raw??'').trim());
    if(Number.isFinite(value)&&value>0&&value<10)return Math.max(1,Math.min(5,value-1));
  }
  return autoMatchSkillLevel(p);
}

function autoMatchAssignmentScore(slots,mode,history,selectedIds){
  const people=slots.map(id=>id==null?null:player(id));
  if(people.some(person=>!person))return Infinity;
  // Skill Separated must use actual skill information; unknown levels cannot be
  // assumed to match the known players. Other modes can still include them.
  if(mode==='skill-separated'&&people.some(person=>autoMatchSkillLevel(person)===null))return Infinity;

  // Never split a locked-in partner pair across teams when auto-matching.
  for(let index=0;index<slots.length;index++){
    const partnerId=getLockedPartnerId(slots[index]);
    if(partnerId==null)continue;
    const partnerIndex=slots.findIndex(id=>Number(id)===Number(partnerId));
    if(partnerIndex<0||Math.floor(index/2)!==Math.floor(partnerIndex/2))return Infinity;
  }

  const pairKey=history.makePairKey;
  const teammateCounts=[
    history.teammateCounts.get(pairKey(slots[0],slots[1]))||0,
    history.teammateCounts.get(pairKey(slots[2],slots[3]))||0
  ];
  const opponentPairs=[
    history.opponentCounts.get(pairKey(slots[0],slots[2]))||0,
    history.opponentCounts.get(pairKey(slots[0],slots[3]))||0,
    history.opponentCounts.get(pairKey(slots[1],slots[2]))||0,
    history.opponentCounts.get(pairKey(slots[1],slots[3]))||0
  ];
  const queuePenalty=(selectedIds||[]).reduce((sum,id)=>sum+Math.max(0,history.queueIndexById.get(Number(id))??0),0)*0.025;

  if(mode==='social-mix'){
    // Social Mix is deliberately independent of player ratings and skill labels.
    // An unused partner pairing always outranks a repeated pairing; opponent
    // exposure is then spread as evenly as the available history allows.
    const partnerPenalty=teammateCounts.reduce((sum,count)=>sum+(count>0?10000+count*250:0),0);
    const opponentSum=opponentPairs.reduce((sum,count)=>sum+count,0);
    const average=opponentSum/opponentPairs.length;
    const opponentVariance=opponentPairs.reduce((sum,count)=>sum+Math.pow(count-average,2),0);
    const opponentRange=Math.max(...opponentPairs)-Math.min(...opponentPairs);
    const opponentPenalty=opponentVariance*20+opponentRange*5+opponentSum*1.5;
    return partnerPenalty+opponentPenalty+queuePenalty;
  }

  if(mode==='winners-losers'){
    const outcomes=people.map(person=>history.outcomeById.get(String(person.id))||null);
    let teamOutcomePenalty=0;
    [[0,1],[2,3]].forEach(([a,b])=>{
      if(outcomes[a]&&outcomes[b]&&outcomes[a]!==outcomes[b])teamOutcomePenalty+=1500;
      else if((outcomes[a]&&!outcomes[b])||(!outcomes[a]&&outcomes[b]))teamOutcomePenalty+=25;
    });
    return teamOutcomePenalty+teammateCounts.reduce((sum,count)=>sum+count*5,0)
      +opponentPairs.reduce((sum,count)=>sum+count*2,0)+queuePenalty;
  }

  const skillLevels=people.map(autoMatchSkillLevel).filter(value=>value!==null);
  const skillSpread=skillLevels.length>1?Math.max(...skillLevels)-Math.min(...skillLevels):0;
  if(mode==='skill-separated'&&skillSpread>1.01)return Infinity;

  // Every player contributes to the team average. A player without a rating
  // is treated as neutral (3/5), instead of being omitted and skewing teams
  // when the two sides have different numbers of rated players.
  const ratings=people.map(person=>autoMatchRating(person)??3);
  const ratingA=ratings.slice(0,2);
  const ratingB=ratings.slice(2,4);
  const teamRatingGap=Math.abs(
    ratingA.reduce((sum,value)=>sum+value,0)/ratingA.length
    -ratingB.reduce((sum,value)=>sum+value,0)/ratingB.length
  );

  if(mode==='skill-separated'){
    const teammateSkillGap=Math.abs(autoMatchSkillLevel(people[0])-autoMatchSkillLevel(people[1]))
      +Math.abs(autoMatchSkillLevel(people[2])-autoMatchSkillLevel(people[3]));
    return skillSpread*100+teammateSkillGap*20+teamRatingGap*10
      +teammateCounts.reduce((sum,count)=>sum+count*4,0)
      +opponentPairs.reduce((sum,count)=>sum+count,0)+queuePenalty;
  }

  // Balanced: pair the teams by combined skill/rating first, then prefer
  // players who have not already partnered or faced one another repeatedly.
  return teamRatingGap*100
    +teammateCounts.reduce((sum,count)=>sum+count*35,0)
    +opponentPairs.reduce((sum,count)=>sum+count*5,0)
    +queuePenalty;
}

function findBestAutoMatchAssignment(c,combos,mode,history){
  const baseSlots=[0,1,2,3].map(index=>Array.isArray(c.players)?(c.players[index]??null):null);
  const emptyIndexes=baseSlots.map((id,index)=>id==null?index:-1).filter(index=>index>=0);
  let best=null;
  combos.forEach(combo=>{
    const candidateIds=combo.map(person=>person.id);
    if(emptyIndexes.length===4&&combo.length===4){
      const [a,b,cPlayer,d]=combo;
      const partitions=[
        [a.id,b.id,cPlayer.id,d.id],
        [a.id,cPlayer.id,b.id,d.id],
        [a.id,d.id,b.id,cPlayer.id]
      ];
      partitions.forEach(slots=>{
        const score=autoMatchAssignmentScore(slots,mode,history,candidateIds);
        if(Number.isFinite(score)&&(!best||score<best.score))best={score,slots:slots.slice(),combo:combo.slice()};
      });
      return;
    }
    const remaining=combo.slice();
    function place(index){
      if(index===emptyIndexes.length){
        const score=autoMatchAssignmentScore(baseSlots,mode,history,candidateIds);
        if(Number.isFinite(score)&&(!best||score<best.score))best={score,slots:baseSlots.slice(),combo:combo.slice()};
        return;
      }
      const slotIndex=emptyIndexes[index];
      for(let i=0;i<remaining.length;i++){
        const person=remaining[i];
        remaining.splice(i,1);
        baseSlots[slotIndex]=person.id;
        place(index+1);
        remaining.splice(i,0,person);
        baseSlots[slotIndex]=null;
      }
    }
    place(0);
  });
  return best;
}

function autoMatchSingles(courtId){
  const c=court(courtId); if(!c||c.playing)return;
  const limit=2;
  const slots=[c.players?.[0]??null,c.players?.[1]??null];
  const occupied=slots.filter(Boolean).length;
  const needed=limit-occupied;
  if(needed<=0){cancelReadyMatch(courtId);return;}

  const mode=['balanced','social-mix','skill-separated','winners-losers'].includes(state.matchingMode)?state.matchingMode:'balanced';
  const allowedSkills=Array.isArray(c.allowedSkills)?c.allowedSkills:[];
  const available=state.queue.map(player).filter(Boolean).filter(p=>!allowedSkills.length||allowedSkills.includes(p.category));
  if(available.length<needed){
    toast(mode==='skill-separated'
      ?'Skill Separated needs another player with a similar known skill level for Singles.'
      :`Need ${needed} more player${needed===1?'':'s'} in Queue. Only ${available.length} available.`);
    return;
  }

  const pool=available.slice(0,32);
  const combos=[];
  function walk(index,chosen){
    if(chosen.length===needed){combos.push(chosen.slice());return;}
    const stillNeeded=needed-chosen.length;
    for(let i=index;i<=pool.length-stillNeeded;i++)walk(i+1,chosen.concat(pool[i]));
  }
  walk(0,[]);
  const history=autoMatchHistoryContext();
  const fixedIds=slots.filter(Boolean).map(Number);
  const targetOutcome=state.winnersLosersNextGroup==='losers'?'losers':'winners';
  let best=null;
  combos.forEach(combo=>{
    const comboIds=combo.map(p=>Number(p.id));
    const allIds=[...fixedIds,...comboIds];
    if(new Set(allIds).size!==limit)return;
    // A lock-in is a partner relationship, so those two players should not be opponents in Singles.
    if(allIds.some(id=>{
      const partnerId=getLockedPartnerId(id);
      return partnerId!=null&&allIds.some(other=>Number(other)===Number(partnerId));
    }))return;

    const skillLevels=allIds.map(id=>autoMatchSkillLevel(player(id)));
    if(mode==='skill-separated'&&(skillLevels.some(value=>value===null)||Math.max(...skillLevels)-Math.min(...skillLevels)>1.01))return;

    const people=allIds.map(id=>player(id)).filter(Boolean);
    if(people.length!==limit)return;
    const ratings=people.map(autoMatchRating);
    let score=0;
    if(mode!=='social-mix'&&ratings.every(value=>value!==null))score+=Math.abs(ratings[0]-ratings[1])*10;
    if(mode==='social-mix')score+=0;
    const repeatCount=history.opponentCounts.get(history.makePairKey(allIds[0],allIds[1]))||0;
    score+=repeatCount*(mode==='social-mix'?30:18);
    combo.forEach(person=>{score+=(history.queueIndexById.get(Number(person.id))||0)*0.002;});
    if(mode==='winners-losers'){
      const outcomes=allIds.map(id=>history.outcomeById.get(String(id))||null);
      if(outcomes.every(outcome=>outcome===targetOutcome))score-=100;
      else if(outcomes.every(outcome=>outcome===null))score-=10;
      else if(outcomes[0]&&outcomes[1]&&outcomes[0]===outcomes[1])score-=35;
      else score+=25;
    }
    if(!best||score<best.score)best={score,combo:combo.slice()};
  });

  if(!best){
    toast(mode==='skill-separated'
      ?'Skill Separated could not find two players within the same or adjacent skill levels. This court is left waiting.'
      :'No Singles matchup fits the current player availability and partner locks.');
    return;
  }

  let index=0;
  for(let slot=0;slot<limit;slot++){
    if(slots[slot]!=null)continue;
    const person=best.combo[index++];
    slots[slot]=person.id;
    person.court=c.id;
    state.queue=state.queue.filter(id=>Number(id)!==Number(person.id));
  }
  c.players=slots;
  if(mode==='winners-losers'){
    const outcomes=slots.map(id=>history.outcomeById.get(String(id))||null);
    const actualGroup=outcomes[0]&&outcomes[0]===outcomes[1]?outcomes[0]:null;
    if(actualGroup)state.winnersLosersNextGroup=actualGroup==='winners'?'losers':'winners';
    else state.winnersLosersNextGroup=targetOutcome==='winners'?'losers':'winners';
  }
  if(c.players.filter(Boolean).length===limit&&state.selectedCourt===c.id)state.selectedCourt=null;
  saveState(); render();
  const modeLabel=({'balanced':'Balanced','social-mix':'Social Mix','skill-separated':'Skill Separated','winners-losers':'Winners / Losers'})[mode];
  toast(`${courtDisplayName(c)} auto-matched for Singles using ${modeLabel}.`);
}

function autoMatchVariety(courtId){
  const c=court(courtId);
  if(!c||c.playing)return;
  if(c.players.filter(Boolean).length===courtPlayerLimit(c)){
    cancelReadyMatch(courtId);
    return;
  }
  if(isSinglesCourt(c)){autoMatchSingles(courtId);return;}

  const mode=['balanced','social-mix','skill-separated','winners-losers'].includes(state.matchingMode)?state.matchingMode:'balanced';
  const needed=4-c.players.filter(Boolean).length;
  const allowedSkills=Array.isArray(c.allowedSkills)?c.allowedSkills:[];
  const available=state.queue.map(player).filter(Boolean).filter(p=>!allowedSkills.length||allowedSkills.includes(p.category));
  if(available.length<needed){
    toast(mode==='skill-separated'
      ?'Skill Separated left this court waiting; more players at a similar skill level are needed.'
      :`Need ${needed} more player${needed===1?'':'s'} in Queue. Only ${available.length} available.`);
    return;
  }

  const history=autoMatchHistoryContext();
  const availableById=new Map(available.map(person=>[Number(person.id),person]));
  const pool=[];
  const poolLimit=24;
  const addToPool=person=>{
    if(!person||pool.length>=poolLimit||pool.some(existing=>Number(existing.id)===Number(person.id)))return false;
    pool.push(person);return true;
  };
  if(mode==='skill-separated'){
    // Sample every level rather than only the queue head, so a suitable skill
    // group is still found behind players from unrelated categories.
    ['BEG','NOV','INT','ADV','EXP'].forEach(category=>available.filter(person=>String(person.category||'').toUpperCase()===category).slice(0,4).forEach(addToPool));
    available.filter(person=>!autoMatchSkillLevel(person)).slice(0,2).forEach(addToPool);
  }else if(mode==='winners-losers'){
    ['winners','losers'].forEach(group=>available.filter(person=>history.outcomeById.get(String(person.id))===group).slice(0,4).forEach(addToPool));
    available.filter(person=>!history.outcomeById.has(String(person.id))).slice(0,4).forEach(addToPool);
    available.slice(0,8).forEach(addToPool);
  }else{
    available.slice(0,16).forEach(addToPool);
  }
  // Locked-in partners outside the queue sample must still be considered.
  for(let index=0;index<pool.length&&pool.length<poolLimit;index++){
    const partnerId=getLockedPartnerId(pool[index].id);
    if(partnerId!=null)addToPool(availableById.get(Number(partnerId)));
  }
  // Fill any remaining candidate slots in queue order, keeping the sample capped
  // so large queues do not make the combination search unresponsive.
  for(const person of available){
    if(pool.length>=poolLimit)break;
    if(pool.some(existing=>Number(existing.id)===Number(person.id)))continue;
    addToPool(person);
    const partnerId=getLockedPartnerId(person.id);
    if(partnerId!=null)addToPool(availableById.get(Number(partnerId)));
  }

  const combos=[];
  function walk(index,chosen){
    if(chosen.length===needed){combos.push(chosen.slice());return;}
    const stillNeeded=needed-chosen.length;
    for(let i=index;i<=pool.length-stillNeeded;i++)walk(i+1,chosen.concat(pool[i]));
  }
  walk(0,[]);

  const chosenIdsFor=combo=>new Set(combo.map(person=>Number(person.id)));
  const validCombos=combos.filter(combo=>{
    const ids=chosenIdsFor(combo);
    for(const person of combo){
      const partnerId=getLockedPartnerId(person.id);
      if(partnerId==null)continue;
      if(c.players.some(id=>Number(id)===Number(partnerId)))continue;
      if(!availableById.has(Number(partnerId))||!ids.has(Number(partnerId)))return false;
    }
    for(const playerId of c.players.filter(Boolean)){
      const partnerId=getLockedPartnerId(playerId);
      if(partnerId!=null&&!c.players.some(id=>Number(id)===Number(partnerId))&&!ids.has(Number(partnerId)))return false;
    }
    if(mode==='skill-separated'){
      const allIds=[...c.players.filter(Boolean),...combo.map(person=>person.id)];
      const skillLevels=allIds.map(id=>autoMatchSkillLevel(player(id)));
      // Only accept a lineup when all four players have known, similar skill levels.
      if(skillLevels.length!==4||skillLevels.some(value=>value===null))return false;
      if(Math.max(...skillLevels)-Math.min(...skillLevels)>1.01)return false;
    }
    return true;
  });
  if(!validCombos.length){
    toast(mode==='skill-separated'
      ?'Skill Separated could not find four players within the same or adjacent skill levels. This court is left waiting.'
      :'No matching combination fits the remaining court slots and locked partners.');
    return;
  }

  let best=null;
  let matchedOutcomeGroup=null;
  if(mode==='winners-losers'){
    const firstGroup=state.winnersLosersNextGroup==='losers'?'losers':'winners';
    for(const group of [firstGroup,firstGroup==='winners'?'losers':'winners']){
      const groupCombos=validCombos.filter(combo=>{
        const ids=[...c.players.filter(Boolean),...combo.map(person=>person.id)];
        const outcomes=ids.map(id=>history.outcomeById.get(String(id))||null);
        const targetCount=outcomes.filter(outcome=>outcome===group).length;
        const oppositeCount=outcomes.filter(outcome=>outcome&&outcome!==group).length;
        return targetCount>0&&oppositeCount===0;
      });
      if(!groupCombos.length)continue;
      const groupedBest=findBestAutoMatchAssignment(c,groupCombos,mode,history);
      if(groupedBest){best=groupedBest;matchedOutcomeGroup=group;break;}
    }
  }
  if(!best)best=findBestAutoMatchAssignment(c,validCombos,mode,history);
  if(!best){
    toast(mode==='skill-separated'
      ?'Skill Separated could not find four players within the same or adjacent skill levels. This court is left waiting.'
      :'No matching combination fits the selected mode and court slots.');
    return;
  }

  c.players=best.slots.slice();
  best.combo.forEach(person=>{
    person.court=c.id;
    state.queue=state.queue.filter(id=>Number(id)!==Number(person.id));
  });
  if(mode==='winners-losers'){
    const actualGroup=matchedOutcomeGroup;
    if(actualGroup)state.winnersLosersNextGroup=actualGroup==='winners'?'losers':'winners';
    else state.winnersLosersNextGroup=state.winnersLosersNextGroup==='losers'?'winners':'losers';
  }
  state.selectedCourt=null;
  saveState();
  render();
  const modeLabel=({'balanced':'Balanced','social-mix':'Social Mix','skill-separated':'Skill Separated','winners-losers':'Winners / Losers'})[mode];
  toast(`${courtDisplayName(c)} auto-matched using ${modeLabel}.`);
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
    const nameLabel=btn.querySelector('.picker-meta b');
    if(nameLabel){
      const original=nameLabel.dataset.searchName||nameLabel.textContent||'';
      nameLabel.dataset.searchName=original;
      nameLabel.innerHTML=highlightSearchMatch(original,term);
    }
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
  const c=court(courtId); if(!c||c.players.filter(Boolean).length!==courtPlayerLimit(c))return;
  // Using another live action dismisses a pending delete confirmation first.
  const pendingDeleteFooter=document.querySelector(`.live-footer[data-court="${courtId}"].delete-confirming`);
  if(pendingDeleteFooter)cancelDeleteMatch(courtId);
  const names=c.players.map(id=>player(id)).filter(Boolean).map(p=>p.name);
  const team1=isSinglesCourt(c)?names[0]:names.slice(0,2).join(' and ');
  const team2=isSinglesCourt(c)?names[1]:names.slice(2,4).join(' and ');
  const message=`Please Proceed to Court number ${c.number}. ${team1} Versus ${team2}.`;
  if('speechSynthesis' in window){
    window.speechSynthesis.cancel();
    const utterance=new SpeechSynthesisUtterance(message);
    utterance.rate=0.95;
    window.speechSynthesis.speak(utterance);
  }
  toast(message);
}

function choosePlayerForCourt(playerId,courtId){
  const p=player(playerId),c=court(courtId);
  if(!p||!c)return;
  if(c.playing){toast('The match is already LIVE.');return;}
  const playerLimit=courtPlayerLimit(c);
  if(c.players.filter(Boolean).length>=playerLimit){toast(`Maximum ${playerLimit} players on a court.`);return;}
  if(p.court){toast(`${p.name} is already on a court.`);return;}

  let slot=c.players.findIndex(value=>!value); if(slot<0) slot=c.players.length;
  if(isSinglesCourt(c)) {
    if(slot>=playerLimit){toast(`Maximum ${playerLimit} players on a court.`);return;}
    c.players[slot]=playerId; p.court=c.id;
    state.queue=state.queue.filter(x=>Number(x)!==Number(playerId));
    if(c.players.filter(Boolean).length===playerLimit&&state.selectedCourt===c.id)state.selectedCourt=null;
    saveState(); render(); toast(`${p.name} added to ${courtDisplayName(c)}.`); return;
  }
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
  if(c.players.filter(Boolean).length===playerLimit&&state.selectedCourt===c.id)state.selectedCourt=null;
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
  const c=court(id); if(!c || (!c.playing && c.players.filter(Boolean).length!==courtPlayerLimit(c)))return;
  if(isSinglesCourt(c)){
    if(c.players.length<2)return;
    [c.players[0],c.players[1]]=[c.players[1],c.players[0]];
    c.scores=[0,0]; saveState(); render(); toast(`${courtDisplayName(c)}: sides swapped.`); return;
  }
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
      footer.innerHTML=`<button class="cancel-match" data-court="${c.id}" onclick="requestCancelMatch(${c.id})">Delete Match</button><button class="mix-live" onclick="mixCourt(${c.id})">${courtMixActionLabel(c)}</button><button class="submit-score" data-court="${c.id}" onclick="requestSubmitScore(${c.id})" ${validScore?'':'disabled'}>Submit Score</button>`;
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
  const playerLimit=courtPlayerLimit(c);
  const singlesMode=isSinglesCourt(c);
  const [team1Players,team2Players]=courtTeamPlayers(c);
  const isWaitingCourt=!!c.waitingOnly;
  const started=c.playing&&c.start ? elapsed(c.start) : (isWaitingCourt ? '0:00' : '--');
  const courtName=isWaitingCourt ? 'Court #' : courtDisplayName(c);
  const genderIcon=p=>genderSvgIcon(p?.gender);
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

  const lineupSlots=[0,1,2,3].map(i=>player(c.players[i]));
  const team1Cards=singlesMode?playerCard(team1Players[0],0):`${playerCard(lineupSlots[0],0)}${playerCard(lineupSlots[1],1)}`;
  const team2Cards=singlesMode?playerCard(team2Players[0],1):`${playerCard(lineupSlots[2],2)}${playerCard(lineupSlots[3],3)}`;
  body.innerHTML=`
    <div class="court-lineup-top">
      <div class="court-lineup-title"><span class="court-lineup-court-icon" aria-hidden="true">🏟️</span><b>${esc(courtName)}</b></div>
      <div class="court-lineup-count ${isWaitingCourt?'waiting':(c.playing?'playing':'ready')}"><span class="court-lineup-dot"></span><span>${isWaitingCourt?'Waiting':(c.playing?'Playing':'Ready')}</span><b>${ps.length}/${playerLimit}</b></div>
    </div>
    <div class="court-lineup-divider"></div>
    <div class="court-lineup-meta">
      <span class="court-lineup-time ${isWaitingCourt?'waiting':''}" id="courtLineupTime-${c.id}">${esc(started)}</span>
      <span class="court-lineup-rule">To ${target} (win by ${winBy})</span>
    </div>
    <div class="court-lineup-divider"></div>
    <div class="court-lineup-teams">
      <div class="court-lineup-team">
        ${team1Cards}
      </div>
      <div class="court-lineup-vs">VS</div>
      <div class="court-lineup-team">
        ${team2Cards}
      </div>
    </div>
    <div class="detail-players court-lineup-detail-players"><h4>PLAYERS</h4>${team1Players.map(p=>detailPlayerRow(p,'team-one-dot')).join('')}${team2Players.map(p=>detailPlayerRow(p,'team-two-dot')).join('')}</div>
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
      <button class="mix-live mix-live-disabled" type="button" disabled aria-disabled="true">${courtMixActionLabel(c)}</button>
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
  footer.innerHTML=`<button class="cancel-match" data-court="${c.id}" onclick="requestCancelMatch(${c.id})">Delete Match</button><button class="mix-live" onclick="mixCourt(${c.id})">${courtMixActionLabel(c)}</button><button class="submit-score" data-court="${c.id}" onclick="requestSubmitScore(${c.id})">Submit Score</button>`;
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
    .filter(c=>c.waitingOnly && !c.playing && c.players.filter(Boolean).length===courtPlayerLimit(c))
    .sort((a,b)=>(Number(a.waitingOrder)||9999)-(Number(b.waitingOrder)||9999))[0];
  if(!waiting)return false;

  const players=waiting.players.filter(Boolean).slice(0,courtPlayerLimit(waiting));
  active.type=waiting.type||state.eventRules?.type||'Doubles';
  active.target=Number(state.eventRules?.target)||Number(active.target)||11;
  active.winBy=Number(state.eventRules?.winBy)||Number(active.winBy)||1;
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
  const c=court(id); if(!c||!c.playing||c.players.filter(Boolean).length!==courtPlayerLimit(c))return;
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
  if(!c||!c.playing||c.players.filter(Boolean).length!==courtPlayerLimit(c))return;
  const teamNumber=Number(winningTeam);
  if(teamNumber!==1&&teamNumber!==2)return;
  completeMatchResult(id,teamNumber,null);
}

function completeMatchResult(id,winningTeamNumber,recordedScores=null){
  const c=court(id); if(!c||!c.playing||c.players.filter(Boolean).length!==courtPlayerLimit(c))return;
  const [team1,team2]=courtTeamPlayers(c);
  const playersPerTeam=isSinglesCourt(c)?1:2;
  if(team1.length!==playersPerTeam||team2.length!==playersPerTeam){toast(`All ${courtPlayerLimit(c)} match players must be present.`);return;}
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
    team1Players:team1.map(p=>({id:p.id,name:p.name,nickname:p.nickname||'',gender:p.gender||'',category:p.category||'',duprId:p.duprId||p.duprID||p.dupr_id||p.dupr||''})),
    team2Players:team2.map(p=>({id:p.id,name:p.name,nickname:p.nickname||'',gender:p.gender||'',category:p.category||'',duprId:p.duprId||p.duprID||p.dupr_id||p.dupr||''})),
    startedAt:c.start, endedAt:endedAt.toISOString(), duration:elapsed(c.start), target:savedRaceTarget, type:isSinglesCourt(c)?'Singles':'Doubles', sessionName:state.sessionName||'', duprMatch:!!state.duprMatch, scoreType:savedRaceTarget===21?'Rally':'Sideout'
  });

  c.players.forEach(pid=>{
    const p=player(pid);
    if(p){p.court=null;p.queuedAt=p.queuedAt||Date.now();p.waitingSince=Date.now();if(!state.queue.includes(pid))state.queue.push(pid)}
  });
  c.players=[]; c.playing=false; c.start=null; c.scores=[0,0];
  c.type=state.eventRules?.type==='Singles'?'Singles':'Doubles';
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
  if(c.players.filter(Boolean).length!==courtPlayerLimit(c)){toast(`Choose exactly ${courtPlayerLimit(c)} players before starting matchmaking.`);return;}
  // Snapshot the current top-bar rules when this match starts.
  c.target=[11,15,21].includes(Number(state.eventRules?.target))?Number(state.eventRules.target):(Number(c.target)||11);
  c.winBy=[1,2,3].includes(Number(state.eventRules?.winBy))?Number(state.eventRules.winBy):(Number(c.winBy)||1);
  c.type=state.eventRules?.type==='Singles'?'Singles':'Doubles';
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
    ? `<button class="cancel-match" data-court="${c.id}" onclick="requestCancelMatch(${c.id})">Delete Match</button><button class="mix-live" onclick="mixCourt(${c.id})">${courtMixActionLabel(c)}</button><button class="submit-score" data-court="${c.id}" onclick="requestSubmitScore(${c.id})" disabled>Submit Score</button>`
    : `<button class="cancel-match" data-court="${c.id}" onclick="requestCancelMatch(${c.id})">Delete Match</button><div class="live-actions live-actions-win-only"><div class="mix-action-wrap"><button class="mix-live" onclick="mixCourt(${c.id})">${courtMixActionLabel(c)}</button></div></div>`;
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
    footer.innerHTML=`<button class="cancel-match" data-court="${c.id}" onclick="requestCancelMatch(${c.id})">Delete Match</button><button class="mix-live" onclick="mixCourt(${c.id})">${courtMixActionLabel(c)}</button><button class="submit-score" data-court="${c.id}" onclick="requestSubmitScore(${c.id})" ${canSubmit?'':'disabled'}>Submit Score</button>`;
  }else{
    footer.classList.add('win-only-footer');
    footer.innerHTML=`<button class="cancel-match" data-court="${c.id}" onclick="requestCancelMatch(${c.id})">Delete Match</button><div class="live-actions live-actions-win-only"><div class="mix-action-wrap"><button class="mix-live" onclick="mixCourt(${c.id})">${courtMixActionLabel(c)}</button></div></div>`;
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
  c.type=state.eventRules?.type==='Singles'?'Singles':'Doubles';
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
  const normalized=fullname.replace(/\s+/g,' ').toLocaleLowerCase();
  const match=cloudRecords.players.find(p=>String(p.name||'').trim().replace(/\s+/g,' ').toLocaleLowerCase()===normalized);
  if(match){message.textContent=`This user is already registered: ${match.name}`;message.hidden=false;}
  else{message.textContent='';message.hidden=true;}
}

function updateRegistrationSaveButton(){
  const fullname=String($('registerFullname')?.value||'').trim();
  loadCloudRecords();
  const normalized=fullname.replace(/\s+/g,' ').toLocaleLowerCase();
  const duplicate=!!fullname&&cloudRecords.players.some(p=>String(p.name||'').trim().replace(/\s+/g,' ').toLocaleLowerCase()===normalized);
  const saveBtn=$('registerSaveBtn');
  if(saveBtn) saveBtn.disabled=!(fullname && registrationGender && registrationSkillLevel) || duplicate;
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
  loadCloudRecords();
  const normalizedFullname=fullname.replace(/\s+/g,' ').toLocaleLowerCase();
  const cloudDuplicate=cloudRecords.players.find(p=>String(p.name||'').trim().replace(/\s+/g,' ').toLocaleLowerCase()===normalizedFullname);
  if(cloudDuplicate){updateRegistrationSaveButton();toast(`This user is already registered: ${cloudDuplicate.name}`);return;}
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
    return `<button type="button" class="registered-result ${alreadyQueued?'already-queued':''}" onclick="addRegisteredToQueue(${p.id})"><span><b>${highlightSearchMatch(displayPlayerName(p),q)}</b><small>${genderSvgIcon(p.gender)} ${p.gender==='Female'?'Female':'Male'} • ${p.category||'CAT'} • ${p.wins}W${p.opgId?` • OPG ${esc(p.opgId)}`:''}</small></span><strong>${alreadyQueued?'✓ QUEUED':'＋ QUEUE'}</strong></button>`;
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
    const name=option.querySelector('.queue-lock-partner-option-name');
    if(name){
      const original=name.dataset.searchName||name.textContent||'';
      name.dataset.searchName=original;
      name.innerHTML=highlightSearchMatch(original,query);
    }
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
  const options=candidates.map(candidate=>`<button type="button" class="queue-lock-partner-option" title="Lock in ${esc(displayPlayerName(candidate))}" aria-label="Lock in ${esc(displayPlayerName(candidate))}" onclick="event.stopPropagation();toggleLockInPartner(${playerId},${candidate.id})"><span class="queue-lock-partner-option-ident"><span class="queue-lock-partner-option-name">${highlightSearchMatch(displayPlayerName(candidate),searchValue)}</span><span class="queue-lock-partner-option-meta"><span class="queue-lock-partner-gender ${candidate.gender==='Female'?'female':'male'}" aria-label="${candidate.gender==='Female'?'Female':'Male'}">${genderSvgIcon(candidate.gender)}</span><span class="queue-lock-partner-category ${candidate.category?'skill-'+String(candidate.category).toLowerCase():''}">${esc(candidate.category||'—')}</span></span></span><span class="queue-lock-partner-option-state" aria-hidden="true">🔓</span></button>`).join('');
  return `<div class="queue-lock-partner"><div class="queue-lock-partner-heading">Lock in partner</div><span class="queue-lock-partner-divider" aria-hidden="true"></span><div class="queue-lock-partner-search-wrap"><svg class="queue-lock-partner-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="M16 16l4 4"></path></svg><input class="queue-lock-partner-search" data-player-id="${Number(playerId)}" type="search" placeholder="Search players..." aria-label="Search lock in partner players" value="${esc(searchValue)}" oninput="lockPartnerSearchValues[${Number(playerId)}]=this.value;filterLockInPartnerOptions(${Number(playerId)})" onclick="event.stopPropagation()"></div><div class="queue-lock-partner-list ${candidates.length>=5?'has-scroll':''}">${options||'<small class="queue-lock-partner-empty">No other players in the Queue List.</small>'}</div></div>`;
}
function courtDuprInputId(surface,id,field){
  return `courtDupr${field==='id'?'Id':'SelfRating'}Input-${surface}-${Number(id)}`;
}
function getCourtDuprDetails(target){
  if(!target)return {duprId:'',selfRating:''};
  const normalizedName=String(target.name||'').trim().toLowerCase();
  const matchingCloud=cloudRecords.players.find(item=>String(item.name||'').trim().toLowerCase()===normalizedName);
  const rawId=String(target.duprId||target.duprID||target.dupr_id||target.dupr||matchingCloud?.duprId||matchingCloud?.duprID||matchingCloud?.dupr_id||matchingCloud?.dupr||'').trim().toUpperCase();
  const rawRating=String(target.selfRating||target.self_rating||matchingCloud?.selfRating||matchingCloud?.self_rating||'').trim().toUpperCase();
  return {duprId:rawId==='NR'?'':rawId,selfRating:rawRating==='NR'?'':rawRating};
}
function renderCourtDuprBadge(target,surface){
  if(!target || state.duprLabelsEnabled===false)return '';
  const id=Number(target.id);
  const key=`${surface}:${id}`;
  const details=getCourtDuprDetails(target);
  const duprId=details.duprId;
  const selfRating=details.selfRating;
  // Live court is a display-only surface. Edits remain available from the ready court/queue UI.
  if(surface==='match'){
    return `<span class="court-dupr-badge court-dupr-badge-static ${duprId?'':'is-unrated'}" aria-label="DUPR ID and self rating"><span>DUPR: ${esc(duprId||'NR')}</span><span class="court-dupr-separator">•</span><span>${esc(selfRating||'NR')}</span></span>`;
  }
  if(editingCourtDuprKey===key){
    const idInputId=courtDuprInputId(surface,id,'id');
    const ratingInputId=courtDuprInputId(surface,id,'rating');
    return `<span class="court-dupr-inline-edit" role="group" aria-label="Edit DUPR ID and self rating" data-player-id="${id}" data-surface="${surface}"><span class="court-dupr-badge court-dupr-edit-fields ${duprId?'':'is-unrated'}"><span class="court-dupr-prefix">DUPR:</span><input class="court-dupr-id-input" id="${idInputId}" type="text" maxlength="20" autocomplete="off" spellcheck="false" value="${esc(duprId||'NR')}" aria-label="DUPR ID" style="width:${Math.max(36,Math.min(176,(duprId||'NR').length*10+4))}px !important" oninput="this.style.setProperty('width',Math.max(36,Math.min(176,this.value.length*10+4))+'px','important')" onclick="event.stopPropagation()" onkeydown="if(event.key==='Enter'){event.preventDefault();saveCourtDuprDetails(${id},'${surface}')}else if(event.key==='Escape'){event.preventDefault();cancelEditCourtDuprDetails()}" /><span class="court-dupr-separator">•</span><input class="court-dupr-rating-input" id="${ratingInputId}" type="text" maxlength="12" inputmode="decimal" autocomplete="off" value="${esc(selfRating||'NR')}" aria-label="Self rating" style="width:${Math.max(36,Math.min(96,(selfRating||'NR').length*10+4))}px !important" oninput="this.style.setProperty('width',Math.max(36,Math.min(96,this.value.length*10+4))+'px','important')" onclick="event.stopPropagation()" onkeydown="if(event.key==='Enter'){event.preventDefault();saveCourtDuprDetails(${id},'${surface}')}else if(event.key==='Escape'){event.preventDefault();cancelEditCourtDuprDetails()}" /></span><span class="court-dupr-editor-actions"><button type="button" class="court-dupr-save-btn" onclick="event.stopPropagation();saveCourtDuprDetails(${id},'${surface}')">Save</button><button type="button" class="court-dupr-cancel-btn" onclick="event.stopPropagation();cancelEditCourtDuprDetails()">Cancel</button></span></span>`;
  }
  return `<button type="button" class="court-dupr-badge ${duprId?'':'is-unrated'}" onclick="event.stopPropagation();editCourtDuprDetails(${id},'${surface}')" aria-label="Edit DUPR ID and self rating" title="Click to edit DUPR ID and self rating"><span>DUPR: ${esc(duprId||'NR')}</span><span class="court-dupr-separator">•</span><span>${esc(selfRating||'NR')}</span></button>`;
}
function editCourtDuprDetails(id,surface){
  if(surface==='match')return;
  const target=player(Number(id));
  if(!target)return;
  editingCourtDuprKey=`${surface}:${Number(id)}`;
  renderCourts();
  const input=$(courtDuprInputId(surface,id,'id'));
  if(input){input.focus();input.select();}
}
function cancelEditCourtDuprDetails(){
  editingCourtDuprKey=null;
  renderCourts();
}
function saveCourtDuprDetails(id,surface){
  const duprInput=$(courtDuprInputId(surface,id,'id'));
  const ratingInput=$(courtDuprInputId(surface,id,'rating'));
  if(!duprInput||!ratingInput)return;
  const enteredDuprId=String(duprInput.value||'').trim().toUpperCase();
  const duprId=enteredDuprId==='NR'?'':enteredDuprId;
  const enteredRating=String(ratingInput.value||'').trim().toUpperCase();
  const selfRating=enteredRating==='NR'?'':enteredRating;
  if(duprId&&!/^[A-Z0-9]{1,20}$/.test(duprId)){toast('DUPR ID must contain letters and numbers only.');duprInput.focus();return;}
  if(selfRating&&!/^\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?$/.test(selfRating)){toast('Enter self rating as a number, a range such as 2.5/4.0, or NR.');ratingInput.focus();return;}
  const target=player(Number(id));
  if(!target)return;
  const normalizedName=String(target.name||'').trim().toLowerCase();
  [...state.players,...state.left].filter(item=>String(item.name||'').trim().toLowerCase()===normalizedName).forEach(item=>{
    item.duprId=duprId;item.duprID='';item.dupr_id='';item.dupr='';
    item.selfRating=selfRating;item.self_rating='';
  });
  loadCloudRecords();
  let record=cloudRecords.players.find(item=>String(item.name||'').trim().toLowerCase()===normalizedName);
  if(!record){
    record={cloudId:Date.now()+Math.floor(Math.random()*100000),name:target.name,nickname:target.nickname||'',gender:target.gender||'',category:target.category||'',matches:0,wins:0,losses:0};
    cloudRecords.players.push(record);
  }
  record.duprId=duprId;record.duprID='';record.dupr_id='';record.dupr='';
  record.selfRating=selfRating;record.self_rating='';
  editingCourtDuprKey=null;
  saveCloudRecords();
  saveState();
  render();
  if($('cloudRecordsModal')&&!$('cloudRecordsModal').classList.contains('hidden'))renderCloudRecords();
  toast('DUPR ID and self rating saved.');
}

function editQueueDuprDetails(id){
  const target=player(Number(id));
  if(!target)return;
  editingQueueDuprPlayerId=Number(id);
  renderQueue();
  const input=$('queueDuprIdInput');
  if(input){input.focus();input.select();}
}
function cancelEditQueueDuprDetails(){editingQueueDuprPlayerId=null;renderQueue();}
function saveQueueDuprDetails(id){
  const duprInput=$('queueDuprIdInput');
  const ratingInput=$('queueSelfRatingInput');
  if(!duprInput||!ratingInput)return;
  const enteredDuprId=String(duprInput.value||'').trim().toUpperCase();
  const duprId=enteredDuprId==='NR'?'':enteredDuprId;
  const enteredRating=String(ratingInput.value||'').trim().toUpperCase();
  const selfRating=enteredRating==='NR'?'':enteredRating;
  if(duprId&&!/^[A-Z0-9]{1,20}$/.test(duprId)){toast('DUPR ID must contain letters and numbers only.');duprInput.focus();return;}
  if(selfRating&&!/^\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?$/.test(selfRating)){toast('Enter self rating as a number, a range such as 2.5/4.0, or NR.');ratingInput.focus();return;}
  const target=player(Number(id));
  if(!target)return;
  const normalizedName=String(target.name||'').trim().toLowerCase();
  [...state.players,...state.left].filter(item=>String(item.name||'').trim().toLowerCase()===normalizedName).forEach(item=>{
    item.duprId=duprId;item.duprID='';item.dupr_id='';item.dupr='';
    item.selfRating=selfRating;item.self_rating='';
  });
  loadCloudRecords();
  let record=cloudRecords.players.find(item=>String(item.name||'').trim().toLowerCase()===normalizedName);
  if(!record){
    record={cloudId:Date.now()+Math.floor(Math.random()*100000),name:target.name,nickname:target.nickname||'',gender:target.gender||'',category:target.category||'',matches:0,wins:0,losses:0};
    cloudRecords.players.push(record);
  }
  record.duprId=duprId;record.duprID='';record.dupr_id='';record.dupr='';
  record.selfRating=selfRating;record.self_rating='';
  editingQueueDuprPlayerId=null;
  saveCloudRecords();
  saveState();
  render();
  if($('cloudRecordsModal')&&!$('cloudRecordsModal').classList.contains('hidden'))renderCloudRecords();
  toast('DUPR ID and self rating saved.');
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
  loadCloudRecords();
  const search=String($('registeredPlayerSearch')?.value||'').trim().toLowerCase();
  const ids=state.queue.filter(id=>{const p=player(id);const hay=`${p?.name||''} ${p?.nickname||''}`.toLowerCase();return p&&(!search||hay.includes(search));});
  const rankingStats=getRankingStats();
  // Preserve expanded player/lock-in details while the 1-second waiting timer refreshes the queue.
  const previouslyOpenQueueDetails=new Set([...q.querySelectorAll('.queue-player-details[open]')].map(d=>Number(d.dataset.queuePlayerId)));
  $('queueEmpty').style.display=ids.length?'none':'flex';
  q.innerHTML=ids.map((id,i)=>{
    const p=player(id);
    const genderValue=String(p.gender??'').trim().toLowerCase();
    const gender=['female','f','woman','women'].includes(genderValue)?'Female':'Male';
    const st=rankingStats.get(p.id)||{matches:0,wins:0,losses:0};
    const opgId=p.opgId||p.opgID||p.opg_id||'';
    const matchingCloudDupr=cloudRecords.players.find(cp=>String(cp.name||'').trim().toLowerCase()===String(p.name||'').trim().toLowerCase());
    const rawQueueDuprId=String(p.duprId||p.duprID||p.dupr_id||p.dupr||matchingCloudDupr?.duprId||matchingCloudDupr?.duprID||matchingCloudDupr?.dupr_id||matchingCloudDupr?.dupr||'').trim().toUpperCase();
    const queueDuprId=rawQueueDuprId==='NR'?'':rawQueueDuprId;
    const rawQueueSelfRating=String(p.selfRating||p.self_rating||matchingCloudDupr?.selfRating||matchingCloudDupr?.self_rating||'').trim().toUpperCase();
    const queueSelfRating=rawQueueSelfRating==='NR'?'':rawQueueSelfRating;
    const queueDuprEditing=Number(editingQueueDuprPlayerId)===Number(id);
    const queueDuprBadge=state.duprLabelsEnabled===false?'':queueDuprEditing?`<span class="queue-dupr-inline-edit" role="group" aria-label="Edit DUPR ID and self rating"><span class="queue-dupr-badge queue-dupr-edit-fields ${queueDuprId?'':'is-unrated'}"><span class="queue-dupr-prefix">DUPR:</span><input id="queueDuprIdInput" type="text" maxlength="20" autocomplete="off" spellcheck="false" value="${esc(queueDuprId||'NR')}" aria-label="DUPR ID" style="width:${Math.max(28,Math.min(200,(queueDuprId||'NR').length*10+4))}px !important" oninput="this.style.setProperty('width',Math.max(28,Math.min(200,this.value.length*10+4))+'px','important')" onclick="event.stopPropagation()" onkeydown="if(event.key==='Enter'){event.preventDefault();saveQueueDuprDetails(${id})}else if(event.key==='Escape'){cancelEditQueueDuprDetails()}" /><span class="queue-dupr-separator">•</span><input id="queueSelfRatingInput" type="text" maxlength="12" inputmode="decimal" autocomplete="off" value="${esc(queueSelfRating||'NR')}" aria-label="Self rating" style="width:${Math.max(28,Math.min(104,(queueSelfRating||'NR').length*10+4))}px !important" oninput="this.style.setProperty('width',Math.max(28,Math.min(104,this.value.length*10+4))+'px','important')" onclick="event.stopPropagation()" onkeydown="if(event.key==='Enter'){event.preventDefault();saveQueueDuprDetails(${id})}else if(event.key==='Escape'){cancelEditQueueDuprDetails()}" /></span><span class="queue-dupr-editor-actions"><button type="button" class="queue-dupr-save-btn" onclick="event.stopPropagation();saveQueueDuprDetails(${id})">Save</button><button type="button" class="queue-dupr-cancel-btn" onclick="event.stopPropagation();cancelEditQueueDuprDetails()">Cancel</button></span></span>`:`<button type="button" class="queue-dupr-badge ${queueDuprId?'':'is-unrated'}" onclick="event.stopPropagation();editQueueDuprDetails(${id})" aria-label="Edit DUPR ID and self rating" title="Click to edit DUPR ID and self rating"><span>DUPR: ${esc(queueDuprId||'NR')}</span><span class="queue-dupr-separator">•</span><span>${esc(queueSelfRating||'NR')}</span></button>`;
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
          <span class="queue-name" title="${esc(displayPlayerName(p))}">${highlightSearchMatch(displayPlayerName(p),search)}</span>
          <span class="queue-gender-inline">
            <span class="gender-inline ${gender==='Female'?'female':'male'}" title="${gender}" aria-label="${gender}">${gender==='Female'
              ? '<svg class="gender-symbol" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="4.8" r="3.55" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 8.4v5.9M5.25 11.35h5.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'
              : '<svg class="gender-symbol" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="5.35" cy="10.65" r="3.45" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7.8 8.2 14.1 1.9M9.35 1.9h4.75v4.75" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'}</span>
          </span>
        </div>
        <div class="queue-stats-line">
          <span class="queue-cat-stack">
            <span class="queue-cat-wrap"><button type="button" data-player-id="${id}" class="category-trigger ${p.category?'skill-'+p.category.toLowerCase():''}" title="Skill category" onclick="event.stopPropagation();toggleCategoryMenu(${id})">${p.category||'CAT'}</button></span>
          </span>
          <span class="queue-record-badge">${st.matches} match${st.matches===1?'':'es'} (${st.wins}W-${st.losses}L)</span>
        </div>
        ${state.duprLabelsEnabled===false?'':`<div class="queue-dupr-line">${queueDuprBadge}</div>`}
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
  if(note){
    note.hidden=false;
    note.classList.remove('hidden');
    note.classList.add('show');
    note.textContent=sc?`${courtDisplayName(sc)} SELECTED — use an empty court slot to add players.`:'Select an empty court slot to choose a player.';
  }

  const leftCount=$('leftCount');
  if(leftCount)leftCount.textContent=`(${state.left.length})`;
  const left=$('leftPlayersQueue');
  if(left)left.innerHTML=renderLeftPlayerRows(false);
  renderLeftPlayersPopup();
  const leftSection=$('leftSection');
  if(leftSection){
    // Hide the compact Left Player section completely when there are no visible
    // players assigned to it. The section returns automatically as soon as a
    // player is moved to Left Players; expanded/collapsed preference is preserved.
    const hasVisibleLeftPlayers=getVisibleLeftPlayers().length>0;
    leftSection.classList.toggle('left-section-empty',!hasVisibleLeftPlayers);
    if(IS_QUEUEING_PAGE){
      // Default to collapsed only once. Subsequent state renders must not override
      // the organizer's current expanded/collapsed choice or resize the panel.
      if(!leftSection.classList.contains('collapsed')&&!leftSection.classList.contains('expanded')){
        leftSection.classList.add('collapsed');
      }
    }else{
      leftSection.classList.add('collapsed');
      leftSection.classList.remove('expanded');
    }
    if(leftCount)leftCount.textContent=`(${state.left.length})`;
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
  const singlesMode=isSinglesCourt(c);
  const teammateSlot=singlesMode?-1:(slotIndex%2===0?slotIndex+1:slotIndex-1);
  const teammateId=c&&Array.isArray(c.players)?c.players[teammateSlot]:null;
  const paired=!singlesMode && teammateId!=null && !!player(teammateId) && werePairedBefore(p.id,teammateId);
  const lockedPartnerId=singlesMode?null:getLockedPartnerId(p.id);
  // Show the lock icon only while the locked-in pair are teammates on this court.
  // MIX TEAMS keeps the lock-in relationship saved, but hides the icon when they
  // land on opposite teams; it returns automatically when they are paired again.
  const lockedOnCourt=lockedPartnerId!=null && teammateId!=null && Number(teammateId)===Number(lockedPartnerId);
  return `<div class="team-player tap-slot filled-slot ${paired?'paired-before-player':''}" onclick="selectCourt(${courtId})"><span class="slot-player-name"><span class="slot-gender ${genderClass}">${initialLetter}</span><span class="slot-player-identity"><span class="slot-player-primary-line"><span class="slot-player-text">${esc(displayPlayerName(p))}</span><span class="slot-gender-icon ${genderClass}" aria-label="${p.gender}">${genderSvgIcon(p.gender)}</span><span class="slot-category ${p.category?'skill-'+String(p.category).toLowerCase():''}">${esc(category)}</span></span>${renderCourtDuprBadge(p,'ready')}</span></span>${lockedOnCourt?'<span class="slot-lock-icon" title="Locked-in partner" aria-label="Locked-in partner">🔒</span>':''}<button class="slot-remove" title="Remove player from court" onclick="event.stopPropagation();removePlayerFromCourt(${p.id},${courtId})">×</button></div>`;
}

function pickerCandidatePairedBefore(courtId, candidateId){
  const c=state.courts.find(x=>String(x.id)===String(courtId));
  if(!c || isSinglesCourt(c) || !Array.isArray(c.players) || !Array.isArray(state.logs) || !state.logs.length) return false;
  // assignOneToCourt fills the first empty slot without shifting any other player.
  let targetSlot=c.players.findIndex(pid=>!pid);
  if(targetSlot<0) targetSlot=c.players.length;
  if(targetSlot>=courtPlayerLimit(c)) return false;
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

function renderMatchPlayer(p,fallback,avatarClass,second=false){
  const genderClass=p?.gender==='Female'?'female':'male';
  const category=p?.category||'CAT';
  const categoryClass=p?.category?'skill-'+String(p.category).toLowerCase():'';
  return `<div class="match-player ${second?'second':''}"><span class="avatar ${avatarClass}">${initial(p?.name)}</span><div class="match-player-line"><div class="match-player-identity"><div class="match-player-primary-line"><b>${esc(p?displayPlayerName(p):fallback)}</b><span class="match-gender ${genderClass}">${genderSvgIcon(p?.gender)}</span><span class="match-category ${categoryClass}">${esc(category)}</span></div>${renderCourtDuprBadge(p,'match')}</div></div></div>`;
}

function renderCourts(){
  loadCloudRecords();
  const realCourts=state.courts.filter(c=>!c.waitingOnly);
  const waitingCourts=state.courts.filter(c=>c.waitingOnly).sort((a,b)=>(Number(a.waitingOrder)||9999)-(Number(b.waitingOrder)||9999));
  $('courtCount').textContent=`(${realCourts.length})`;
  $('courtsList').innerHTML=realCourts.map(c=>{
    const slots=[0,1,2,3].map(i=>player(c.players[i]));
    const ps=slots.filter(Boolean);
    const playerLimit=courtPlayerLimit(c);
    const singlesMode=isSinglesCourt(c);
    const team1=singlesMode?[slots[0],null]:slots.slice(0,2), team2=singlesMode?[slots[1],null]:slots.slice(2,4);
    const selected=state.selectedCourt===c.id;

    if(c.playing){
      const score1=c.scores[0]||0;
      const score2=c.scores[1]||0;
      return `<div class="court-card court-live-card">
        <div class="court-box live-box">
          <div class="court-head live-head">
            ${renderCourtTitle(c)}
            <div class="court-head-right"><button type="button" class="court-announce-icon" title="Announce Players" aria-label="Announce Players" onclick="announcePlayers(${c.id})">📢</button><button class="court-expand" ${ps.length ? '' : 'disabled'} title="${ps.length ? 'Expand court' : 'Court is empty'}" aria-label="${ps.length ? 'Expand court' : 'Court is empty'}" aria-disabled="${ps.length ? 'false' : 'true'}" onclick="toggleCourtExpand(${c.id})">⛶</button><span class="status live"><span class="status-dot"></span> Playing</span></div>
          </div>
          <div class="live-meta"><span id="timer-${c.id}" class="live-timer ${timerToneClass(c.start)}">${elapsed(c.start)}</span><span>To ${c.target} (win by ${c.winBy})</span></div>
          ${renderExpandedCourtPlayers(c)}

          <div class="matchmaking-sheet">
            <div class="match-team team-one">
              <div class="match-players">
                ${renderMatchPlayer(team1[0],'Player 1','orange')}
                ${singlesMode?'':renderMatchPlayer(team1[1],'Player 2','orange-light',true)}
              </div>
              ${state.recordScores ? `<div class="score-control"><button onclick="setScore(${c.id},1,-1)">−</button><input class="score-input" data-court="${c.id}" data-team="1" type="number" min="0" step="1" value="${score1}" oninput="updateSubmitState(${c.id})"><button class="score-plus" onclick="setScore(${c.id},1,1)">+</button></div>` : `<button type="button" class="team-win-btn team-one-win-btn" onclick="recordMatchWin(${c.id},1)" aria-label="Record ${singlesMode?'Player 1':'Team 1'} win">🏆${singlesMode?'Player 1':'Team 1'} Win</button>`}
            </div>

            <div class="match-vs">VS</div>

            <div class="match-team team-two">
              <div class="match-players">
                ${renderMatchPlayer(team2[0],'Player 3','gray')}
                ${singlesMode?'':renderMatchPlayer(team2[1],'Player 4','gray-light',true)}
              </div>
              ${state.recordScores ? `<div class="score-control"><button onclick="setScore(${c.id},2,-1)">−</button><input class="score-input" data-court="${c.id}" data-team="2" type="number" min="0" step="1" value="${score2}" oninput="updateSubmitState(${c.id})"><button class="score-plus" onclick="setScore(${c.id},2,1)">+</button></div>` : `<button type="button" class="team-win-btn team-two-win-btn" onclick="recordMatchWin(${c.id},2)" aria-label="Record ${singlesMode?'Player 2':'Team 2'} win">🏆${singlesMode?'Player 2':'Team 2'} Win</button>`}
            </div>
          </div>

          <div class="live-footer ${state.recordScores?'':'win-only-footer'}" data-court="${c.id}"><button class="cancel-match" data-court="${c.id}" onclick="requestCancelMatch(${c.id})">Delete Match</button>${state.recordScores ? `<button class="mix-live" onclick="mixCourt(${c.id})">${courtMixActionLabel(c)}</button><button class="submit-score" data-court="${c.id}" onclick="requestSubmitScore(${c.id})" disabled>Submit Score</button>` : `<div class="live-actions live-actions-win-only"><div class="mix-action-wrap"><button class="mix-live" onclick="mixCourt(${c.id})">${courtMixActionLabel(c)}</button></div></div>`}</div>
        </div>
      </div>`;
    }

    return `<div class="court-card court-ready-card"><div class="court-box ready-box${ps.length===0?' empty-court-box':''}">
      <div class="court-head ready-head">${renderCourtTitle(c)}<div class="court-head-right"><button class="court-expand" ${ps.length ? '' : 'disabled'} title="${ps.length ? 'Expand court' : 'Court is empty'}" aria-label="${ps.length ? 'Expand court' : 'Court is empty'}" aria-disabled="${ps.length ? 'false' : 'true'}" onclick="event.stopPropagation();toggleCourtExpand(${c.id})">⛶</button>${state.pendingRemoveCourt===c.id ? '' : `<button class="court-remove court-x-delete" title="Delete court" aria-label="Delete court" onclick="event.stopPropagation();requestRemoveCourt(${c.id})">❌</button>`}<span class="status ready"><span class="status-dot ready"></span> Ready</span></div></div>
      ${state.pendingRemoveCourt===c.id ? `<div class="court-delete-confirm-row"><span class="court-delete-message">Remove this court?</span><button class="court-confirm-yes" onclick="event.stopPropagation();requestRemoveCourt(${c.id})">Yes, Remove</button><button class="court-confirm-no" onclick="event.stopPropagation();cancelRemoveCourt(${c.id})">No</button></div>` : ''}
      <div class="ready-meta"><div class="ready-meta-left"><span class="ready-selected">${ps.length}/${playerLimit} <b>players selected</b></span>${(c.allowedSkills||[]).length?`<span class="ready-skill-list">${['BEG','NOV','INT','ADV','EXP'].filter(cat=>(c.allowedSkills||[]).includes(cat)).map(cat=>`<span class="ready-skill-chip skill-${cat.toLowerCase()}">${cat}</span>`).join('')}</span>`:''}</div><span class="ready-meta-hint">${c.waitingOnly?'Next for available court':'Ready for matchmaking'}</span></div>
      ${renderExpandedCourtPlayers(c)}
      <div class="ready-match-sheet">
        <div class="ready-match-team ready-team-one ${!singlesMode && !!team1[0] && !!team1[1] && werePairedBefore(team1[0].id,team1[1].id)?'has-paired-before':''}">
          <div class="ready-team-heading">${singlesMode?'PLAYER 1':'TEAM 1'}${!singlesMode && !!team1[0] && !!team1[1] && werePairedBefore(team1[0].id,team1[1].id)?' <span class="paired-before-label">(Paired Before)</span>':''}</div>
          <div class="ready-team-players">
            ${readySlot(team1[0],c.id,0)}
            ${singlesMode?'':readySlot(team1[1],c.id,1)}
          </div>
        </div>
        <div class="ready-match-vs">VS</div>
        <div class="ready-match-team ready-team-two ${!singlesMode && !!team2[0] && !!team2[1] && werePairedBefore(team2[0].id,team2[1].id)?'has-paired-before':''}">
          <div class="ready-team-heading">${singlesMode?'PLAYER 2':'TEAM 2'}${!singlesMode && !!team2[0] && !!team2[1] && werePairedBefore(team2[0].id,team2[1].id)?' <span class="paired-before-label">(Paired Before)</span>':''}</div>
          <div class="ready-team-players">
            ${readySlot(team2[0],c.id,singlesMode?1:2)}
            ${singlesMode?'':readySlot(team2[1],c.id,3)}
          </div>
        </div>
      </div>
      ${selected && ps.length<playerLimit ? `<div class="court-picker"><div class="picker-title"><div class="picker-search-wrap"><span class="picker-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="M16 16l4 4"></path></svg></span><input id="courtPickerSearch" class="picker-search" type="search" placeholder="Search player..." autocomplete="off" oninput="filterCourtPicker()"></div><div class="picker-filter-row category-filters"><button type="button" class="picker-filter ${courtPickerFilters.category==='ALL'?'active':''}" data-filter-type="category" data-filter-value="ALL" onclick="setCourtPickerFilter('category','ALL',this)">All (${state.queue.length})</button>${['BEG','NOV','INT','ADV','EXP'].map(cat=>{const n=state.queue.filter(pid=>player(pid)?.category===cat).length;return `<button type="button" class="picker-filter skill-${cat.toLowerCase()} ${courtPickerFilters.category===cat?'active':''}" data-filter-type="category" data-filter-value="${cat}" onclick="setCourtPickerFilter('category','${cat}',this)">${cat} (${n})</button>`}).join('')}</div><div class="picker-filter-row gender-filters"><button type="button" class="picker-filter ${courtPickerFilters.gender==='ALL'?'active':''}" data-filter-type="gender" data-filter-value="ALL" onclick="setCourtPickerFilter('gender','ALL',this)">All (${state.queue.length})</button><button type="button" class="picker-filter gender-male ${courtPickerFilters.gender==='Male'?'active':''}" data-filter-type="gender" data-filter-value="Male" onclick="setCourtPickerFilter('gender','Male',this)">${genderSvgIcon('Male')} M (${state.queue.filter(pid=>player(pid)?.gender==='Male').length})</button><button type="button" class="picker-filter gender-female ${courtPickerFilters.gender==='Female'?'active':''}" data-filter-type="gender" data-filter-value="Female" onclick="setCourtPickerFilter('gender','Female',this)">${genderSvgIcon('Female')} F (${state.queue.filter(pid=>player(pid)?.gender==='Female').length})</button></div><div class="picker-filter-row wait-filters"><button type="button" class="picker-filter ${courtPickerFilters.wait===0?'active':''}" data-filter-type="wait" data-filter-value="0" onclick="setCourtPickerFilter('wait',0,this)">⏱︎ All (${state.queue.length})</button><button type="button" class="picker-filter ${courtPickerFilters.wait===5?'active':''}" data-filter-type="wait" data-filter-value="5" onclick="setCourtPickerFilter('wait',5,this)">⏱︎ 5m+ (${state.queue.filter(pid=>{const q=player(pid);return q&&(Date.now()-(q.waitingSince||q.queuedAt||Date.now()))>=300000}).length})</button><button type="button" class="picker-filter ${courtPickerFilters.wait===10?'active':''}" data-filter-type="wait" data-filter-value="10" onclick="setCourtPickerFilter('wait',10,this)">⏱︎ 10m+ (${state.queue.filter(pid=>{const q=player(pid);return q&&(Date.now()-(q.waitingSince||q.queuedAt||Date.now()))>=600000}).length})</button><button type="button" class="picker-filter ${courtPickerFilters.wait===15?'active':''}" data-filter-type="wait" data-filter-value="15" onclick="setCourtPickerFilter('wait',15,this)">⏱︎ 15m+ (${state.queue.filter(pid=>{const q=player(pid);return q&&(Date.now()-(q.waitingSince||q.queuedAt||Date.now()))>=900000}).length})</button></div></div><div class="picker-player-list">${state.queue.slice().sort((a,b)=>{const pa=player(a),pb=player(b);return (Number(pa?.waitingSince||pa?.queuedAt||Date.now())-Number(pb?.waitingSince||pb?.queuedAt||Date.now()))||(Number(a)-Number(b));}).map(pid=>{const qp=player(pid);if(!qp)return '';const wait=Math.max(0,Math.floor((Date.now()-(qp.waitingSince||qp.queuedAt||Date.now()))/60000));return `<button class="picker-player ${pickerCandidatePairedBefore(c.id,qp.id)?'paired-before-player':''}" data-player-name="${esc(`${displayPlayerName(qp)} ${qp.nickname||''}`).toLowerCase()}" data-category="${esc(qp.category||'')}" data-gender="${esc(qp.gender||'')}" data-queued-at="${Number(qp.waitingSince||qp.queuedAt||Date.now())}" data-wait="${wait}" onclick="choosePlayerForCourt(${pid},${c.id})"><span class="picker-info"><span class="picker-meta"><b>${highlightSearchMatch(displayPlayerName(qp), $('courtPickerSearch')?.value||'')}</b><span class="picker-gender ${qp.gender==='Female'?'female':'male'}">${genderSvgIcon(qp.gender)}</span><span class="picker-category ${qp.category?'skill-'+qp.category.toLowerCase():''}">${esc(qp.category||'CAT')}</span>${getLockedPartnerId(qp.id)!=null?`<span class="partner-inline-badge" title="Locked-in partner"><span class="partner-inline-lock" aria-hidden="true">🔒</span><span class="partner-inline-name">${esc(String(player(getLockedPartnerId(qp.id))?.name||'').trim().split(/\s+/)[0]||displayPlayerName(player(getLockedPartnerId(qp.id))))}</span></span>`:''}${pickerCandidatePairedBefore(c.id,qp.id)?'<span class="paired-before-label picker-paired-before">(Paired Before)</span>':''}</span></span></span><span class="picker-wait ${wait>=15?'wait-red':wait>=10?'wait-yellow':''}">⏱ ${formatWaitingDuration(wait)}</span></button>`}).join('')||'<div class="picker-empty">No players waiting in Queue.</div>'}</div></div>` : ''}
      <div class="ready-actions ready-actions-v2">
        ${selected && ps.length<playerLimit
          ? `<button class="ready-cancel active picker-cancel" onclick="cancelCourtPicker(${c.id})">CANCEL</button>
             <button class="auto-match-ready" onclick="autoMatchVariety(${c.id})">AUTO-MATCH VARIETY</button>
             ${c.waitingOnly?`<button class="start" disabled>WAITING FOR COURT</button>`:`<button class="start" onclick="startMatch(${c.id})" disabled>START MATCHMAKING</button>`}`
          : `<button class="ready-cancel ${ps.length===playerLimit?'active':''}" onclick="${ps.length===playerLimit?`cancelReadyMatch(${c.id})`:`autoMatchVariety(${c.id})`}">${ps.length===playerLimit?'CANCEL MATCH':'AUTO-MATCH VARIETY'}</button>
             <button class="mix-live" onclick="mixCourt(${c.id})" ${ps.length!==playerLimit?'disabled':''}>${singlesMode?'⇄ SWAP SIDES':'⇄ MIX TEAMS'}</button>
             ${c.waitingOnly?`<button class="start" disabled>${ps.length===playerLimit?'WAITING FOR COURT':'WAITING COURT'}</button>`:`<button class="start" onclick="startMatch(${c.id})" ${ps.length!==playerLimit?'disabled':''}>START MATCHMAKING</button>`}` }
      </div>
    </div></div>`;  }).join('')||'<div class="court-empty-state"><div class="court-empty-icon" aria-hidden="true">🏟️</div><div class="court-empty-text">No courts yet. Click "Add Court" to set up your courts!</div></div>';

  const waitingHtml=waitingCourts.map(c=>{
    const slots=[0,1,2,3].map(i=>player(c.players[i]));
    const ps=slots.filter(Boolean), selected=state.selectedCourt===c.id;
    const playerLimit=courtPlayerLimit(c), singlesMode=isSinglesCourt(c);
    const team1=singlesMode?[slots[0],null]:slots.slice(0,2), team2=singlesMode?[slots[1],null]:slots.slice(2,4);
    return `<div class="court-card waiting-court-card"><div class="court-box ready-box waiting-box${ps.length===0?' empty-court-box':''}">
      <div class="court-head ready-head waiting-head"><div class="court-title"><span class="court-logo" aria-hidden="true">🏟️</span><b>Court #</b></div><div class="court-head-right"><span class="waiting-order-controls" role="group" aria-label="Reorder waiting court"><button type="button" class="waiting-order-btn waiting-order-up" ${waitingCourts.indexOf(c)===0?'disabled':''} title="Move waiting court up" aria-label="Move waiting court up" onclick="event.stopPropagation();moveWaitingCourt(${c.id},'up')"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 7.5 6 4.5l3 3"/></svg></button><button type="button" class="waiting-order-btn waiting-order-down" ${waitingCourts.indexOf(c)===waitingCourts.length-1?'disabled':''} title="Move waiting court down" aria-label="Move waiting court down" onclick="event.stopPropagation();moveWaitingCourt(${c.id},'down')"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg></button></span><button class="court-expand" ${ps.length ? '' : 'disabled'} title="${ps.length ? 'Expand court' : 'Court is empty'}" aria-label="${ps.length ? 'Expand court' : 'Court is empty'}" aria-disabled="${ps.length ? 'false' : 'true'}" onclick="event.stopPropagation();toggleCourtExpand(${c.id})">⛶</button>${state.pendingRemoveCourt===c.id ? '' : `<button class="court-remove court-x-delete" title="Delete waiting court" aria-label="Delete waiting court" onclick="event.stopPropagation();requestRemoveCourt(${c.id})">❌</button>`}<span class="status"><span class="status-dot ready"></span> UP NEXT</span></div></div>
      ${state.pendingRemoveCourt===c.id ? `<div class="court-delete-confirm-row"><span class="court-delete-message">Remove this court?</span><button class="court-confirm-yes" onclick="event.stopPropagation();requestRemoveCourt(${c.id})">Yes, Remove</button><button class="court-confirm-no" onclick="event.stopPropagation();cancelRemoveCourt(${c.id})">No</button></div>` : ''}
      <div class="ready-meta"><div class="ready-meta-left"><span class="ready-selected">${ps.length}/${playerLimit} <b>players selected</b></span></div><span class="ready-meta-hint">Moves to the next available court automatically</span></div>
      <div class="ready-match-sheet">
        <div class="ready-match-team ready-team-one ${!singlesMode && !!team1[0] && !!team1[1] && werePairedBefore(team1[0].id,team1[1].id)?'has-paired-before':''}"><div class="ready-team-heading">${singlesMode?'PLAYER 1':'TEAM 1'}${!singlesMode && !!team1[0] && !!team1[1] && werePairedBefore(team1[0].id,team1[1].id)?' <span class="paired-before-label">(Paired Before)</span>':''}</div><div class="ready-team-players">${readySlot(team1[0],c.id,0)}${singlesMode?'':readySlot(team1[1],c.id,1)}</div></div>
        <div class="ready-match-vs">VS</div>
        <div class="ready-match-team ready-team-two ${!singlesMode && !!team2[0] && !!team2[1] && werePairedBefore(team2[0].id,team2[1].id)?'has-paired-before':''}"><div class="ready-team-heading">${singlesMode?'PLAYER 2':'TEAM 2'}${!singlesMode && !!team2[0] && !!team2[1] && werePairedBefore(team2[0].id,team2[1].id)?' <span class="paired-before-label">(Paired Before)</span>':''}</div><div class="ready-team-players">${readySlot(team2[0],c.id,singlesMode?1:2)}${singlesMode?'':readySlot(team2[1],c.id,3)}</div></div>
      </div>
      ${selected && ps.length<playerLimit ? `<div class="court-picker"><div class="picker-title"><div class="picker-search-wrap"><span class="picker-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="M16 16l4 4"></path></svg></span><input id="courtPickerSearch" class="picker-search" type="search" placeholder="Search player..." autocomplete="off" oninput="filterCourtPicker()"></div><div class="picker-filter-row category-filters"><button type="button" class="picker-filter ${courtPickerFilters.category==='ALL'?'active':''}" data-filter-type="category" data-filter-value="ALL" onclick="setCourtPickerFilter('category','ALL',this)">All (${state.queue.length})</button>${['BEG','NOV','INT','ADV','EXP'].map(cat=>{const n=state.queue.filter(pid=>player(pid)?.category===cat).length;return `<button type="button" class="picker-filter skill-${cat.toLowerCase()} ${courtPickerFilters.category===cat?'active':''}" data-filter-type="category" data-filter-value="${cat}" onclick="setCourtPickerFilter('category','${cat}',this)">${cat} (${n})</button>`}).join('')}</div><div class="picker-filter-row gender-filters"><button type="button" class="picker-filter ${courtPickerFilters.gender==='ALL'?'active':''}" data-filter-type="gender" data-filter-value="ALL" onclick="setCourtPickerFilter('gender','ALL',this)">All (${state.queue.length})</button><button type="button" class="picker-filter gender-male ${courtPickerFilters.gender==='Male'?'active':''}" data-filter-type="gender" data-filter-value="Male" onclick="setCourtPickerFilter('gender','Male',this)">${genderSvgIcon('Male')} M (${state.queue.filter(pid=>player(pid)?.gender==='Male').length})</button><button type="button" class="picker-filter gender-female ${courtPickerFilters.gender==='Female'?'active':''}" data-filter-type="gender" data-filter-value="Female" onclick="setCourtPickerFilter('gender','Female',this)">${genderSvgIcon('Female')} F (${state.queue.filter(pid=>player(pid)?.gender==='Female').length})</button></div><div class="picker-filter-row wait-filters"><button type="button" class="picker-filter ${courtPickerFilters.wait===0?'active':''}" data-filter-type="wait" data-filter-value="0" onclick="setCourtPickerFilter('wait',0,this)">⏱︎ All (${state.queue.length})</button><button type="button" class="picker-filter ${courtPickerFilters.wait===5?'active':''}" data-filter-type="wait" data-filter-value="5" onclick="setCourtPickerFilter('wait',5,this)">5m+</button><button type="button" class="picker-filter ${courtPickerFilters.wait===10?'active':''}" data-filter-type="wait" data-filter-value="10" onclick="setCourtPickerFilter('wait',10,this)">10m+</button><button type="button" class="picker-filter ${courtPickerFilters.wait===15?'active':''}" data-filter-type="wait" data-filter-value="15" onclick="setCourtPickerFilter('wait',15,this)">15m+</button></div></div><div class="picker-player-list">${state.queue.slice().sort((a,b)=>{const pa=player(a),pb=player(b);return (Number(pa?.waitingSince||pa?.queuedAt||Date.now())-Number(pb?.waitingSince||pb?.queuedAt||Date.now()))||(Number(a)-Number(b));}).map(pid=>{const qp=player(pid);if(!qp)return '';const wait=Math.max(0,Math.floor((Date.now()-(qp.waitingSince||qp.queuedAt||Date.now()))/60000));return `<button class="picker-player ${pickerCandidatePairedBefore(c.id,qp.id)?'paired-before-player':''}" data-player-name="${esc(`${displayPlayerName(qp)} ${qp.nickname||''}`).toLowerCase()}" data-category="${esc(qp.category||'')}" data-gender="${esc(qp.gender||'')}" data-queued-at="${Number(qp.waitingSince||qp.queuedAt||Date.now())}" data-wait="${wait}" onclick="choosePlayerForCourt(${pid},${c.id})"><span class="picker-info"><span class="picker-meta"><b>${highlightSearchMatch(displayPlayerName(qp), $('courtPickerSearch')?.value||'')}</b><span class="picker-gender ${qp.gender==='Female'?'female':'male'}">${genderSvgIcon(qp.gender)}</span><span class="picker-category ${qp.category?'skill-'+qp.category.toLowerCase():''}">${esc(qp.category||'CAT')}</span>${getLockedPartnerId(qp.id)!=null?`<span class="partner-inline-badge" title="Locked-in partner"><span class="partner-inline-lock" aria-hidden="true">🔒</span><span class="partner-inline-name">${esc(String(player(getLockedPartnerId(qp.id))?.name||'').trim().split(/\s+/)[0]||displayPlayerName(player(getLockedPartnerId(qp.id))))}</span></span>`:''}${pickerCandidatePairedBefore(c.id,qp.id)?'<span class="paired-before-label picker-paired-before">(Paired Before)</span>':''}</span></span><span class="picker-wait ${wait>=15?'wait-red':wait>=10?'wait-yellow':''}">⏱ ${formatWaitingDuration(wait)}</span></button>`}).join('')||'<div class="picker-empty">No players waiting in Queue.</div>'}</div></div>` : ''}
      <div class="ready-actions ready-actions-v2">${selected && ps.length<playerLimit?`<button class="ready-cancel active picker-cancel" onclick="cancelCourtPicker(${c.id})">CANCEL</button><button class="auto-match-ready" onclick="autoMatchVariety(${c.id})">AUTO-MATCH VARIETY</button><button class="start" disabled>WAITING FOR COURT</button>`:`<button class="ready-cancel ${ps.length===playerLimit?'active':''}" onclick="${ps.length===playerLimit?`cancelReadyMatch(${c.id})`:`autoMatchVariety(${c.id})`}">${ps.length===playerLimit?'CANCEL MATCH':'AUTO-MATCH VARIETY'}</button><button class="mix-live" onclick="mixCourt(${c.id})" ${ps.length!==playerLimit?'disabled':''}>${singlesMode?'⇄ SWAP SIDES':'⇄ MIX TEAMS'}</button><button class="start" disabled>${ps.length===playerLimit?'WAITING FOR COURT':'WAITING COURT'}</button>`}</div>
    </div></div>`;
  }).join('');
  $('courtsList').innerHTML += waitingHtml ? `<div class="waiting-courts-section"><div class="waiting-courts-title">⏳ WAITING COURTS <span>(${waitingCourts.length})</span><small>These are queue slots, not numbered matchmaking courts.</small></div>${waitingHtml}</div>` : '';

  realCourts.filter(c=>c.playing).forEach(c=>updateSubmitState(c.id));
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
  // Ranking includes every registered player, whether currently queued or in Left Players.
  // Resolve match participation by ID whenever both teams have IDs. Names are a legacy
  // fallback only; this prevents players with duplicate names from inheriting each other's stats.
  const rankingPlayers=[...new Map([...state.players,...state.left].map(p=>[String(p.id),p])).values()];
  const stats=new Map(rankingPlayers.map(p=>[p.id,{matches:0,wins:0,losses:0,xp:0,totalSeconds:0}]));
  const statsById=new Map(rankingPlayers.map(p=>[String(p.id),stats.get(p.id)]));
  const normName=value=>String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
  const asNames=value=>Array.isArray(value)?value.map(normName).filter(Boolean):[];
  const asIds=value=>Array.isArray(value)?value.filter(id=>id!==null&&id!==undefined&&String(id)!=='').map(id=>String(id)):[];
  const splitTeamNames=value=>String(value||'').split(/\s*&\s*/).map(normName).filter(Boolean);

  (Array.isArray(state.logs)?state.logs:[]).forEach(log=>{
    if(!log||typeof log!=='object')return;
    const team1Players=Array.isArray(log.team1Players)?log.team1Players:[];
    const team2Players=Array.isArray(log.team2Players)?log.team2Players:[];
    const team1Ids=asIds(log.team1Ids?.length?log.team1Ids:team1Players.map(p=>p?.id));
    const team2Ids=asIds(log.team2Ids?.length?log.team2Ids:team2Players.map(p=>p?.id));
    const team1Names=asNames(log.team1Names?.length?log.team1Names:team1Players.map(p=>p?.name));
    const team2Names=asNames(log.team2Names?.length?log.team2Names:team2Players.map(p=>p?.name));
    const winnerNames=new Set(splitTeamNames(log.winner));
    const loserNames=new Set(splitTeamNames(log.loser));
    const team1IdSet=new Set(team1Ids),team2IdSet=new Set(team2Ids);
    const hasReliableTeamIds=team1Ids.length>0&&team2Ids.length>0;
    const hasTeamNames=team1Names.length>0&&team2Names.length>0;

    // Prefer a valid saved score; win-only matches use the saved winning side or names.
    const scoreMatch=String(log.score??'').trim().match(/^(\d+)\s*-\s*(\d+)$/);
    const score1=scoreMatch?Number(scoreMatch[1]):NaN;
    const score2=scoreMatch?Number(scoreMatch[2]):NaN;
    const scoreWinner=scoreMatch&&Number.isFinite(score1)&&Number.isFinite(score2)&&score1!==score2?(score1>score2?1:2):null;
    const savedWinnerTeam=Number(log.winnerTeam);
    const winningSide=scoreWinner||(savedWinnerTeam===1||savedWinnerTeam===2?savedWinnerTeam:null);
    const durationSeconds=parseDurationSeconds(log.duration);

    // Records with team IDs/names are resolved as teams. Older records that only have
    // winner/loser labels are handled directly by those labels below.
    rankingPlayers.forEach(playerRecord=>{
      const st=stats.get(playerRecord.id);
      const playerId=String(playerRecord.id);
      const pname=normName(playerRecord.name);
      const isWinner=winnerNames.has(pname);
      const isLoser=loserNames.has(pname);
      let side=0;
      if(hasReliableTeamIds){
        if(team1IdSet.has(playerId))side=1;
        else if(team2IdSet.has(playerId))side=2;
      }else if(hasTeamNames){
        const inTeam1=team1Names.includes(pname);
        const inTeam2=team2Names.includes(pname);
        if(inTeam1!==inTeam2)side=inTeam1?1:2;
      }

      let result='';
      if(side){
        if(winningSide)result=side===winningSide?'win':'loss';
        else if(isWinner!==isLoser)result=isWinner?'win':'loss';
      }else if(!hasReliableTeamIds&&!hasTeamNames&&isWinner!==isLoser){
        // Backward compatibility for old logs that stored only winner/loser names.
        result=isWinner?'win':'loss';
      }
      // Do not count malformed or unresolved records as matches.
      if(!result)return;
      st.matches++;
      st.totalSeconds+=durationSeconds;
      if(result==='win'){st.wins++;st.xp+=20;}
      else {st.losses++;st.xp+=8;}
    });
  });

  // Include currently live match time without counting an unfinished match as a result.
  state.courts.filter(c=>c.playing&&c.start).forEach(c=>{
    const startedAt=new Date(c.start).getTime();
    const liveSeconds=Number.isFinite(startedAt)?Math.max(0,Math.floor((Date.now()-startedAt)/1000)):0;
    (c.players||[]).forEach(id=>{
      const st=statsById.get(String(id));
      if(st)st.totalSeconds+=liveSeconds;
    });
  });
  stats.forEach(st=>{st.winRate=st.matches?Math.round((st.wins/st.matches)*100):0;});
  return stats;
}

function isPlayerPlaying(p){
  return !!(p && p.court && state.courts.some(c=>c.id===p.court && c.playing));
}
function compareLeaderboardPlayers(a,b,stats){
  const sa=stats.get(a.id)||{winRate:0,wins:0,losses:0,matches:0};
  const sb=stats.get(b.id)||{winRate:0,wins:0,losses:0,matches:0};
  const rateA=sa.matches?sa.wins/sa.matches:0;
  const rateB=sb.matches?sb.wins/sb.matches:0;
  // Clear, predictable standings: most wins first; win percentage breaks ties,
  // followed by fewer losses and then a stable alphabetical order.
  return (Number(sb.wins)||0)-(Number(sa.wins)||0)
    || rateB-rateA
    || (Number(sa.losses)||0)-(Number(sb.losses)||0)
    || (Number(sb.matches)||0)-(Number(sa.matches)||0)
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
            <span class="expanded-ranking-gender ${p.gender==='Female'?'female':'male'}" aria-label="${p.gender==='Female'?'Female':'Male'}">${genderSvgIcon(p.gender)}</span>
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

function highlightSearchMatch(value, query, className='search-match-highlight'){
  const text=String(value??'');
  const needle=String(query??'').trim();
  if(!needle)return esc(text);
  // Escape the search text before using it as a regular expression, then escape
  // every rendered text segment so player names can never inject HTML.
  const escapedNeedle=needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const matcher=new RegExp(`(${escapedNeedle})`,'ig');
  return text.split(matcher).map(part=>
    part.toLowerCase()===needle.toLowerCase()
      ? `<mark class="${className}">${esc(part)}</mark>`
      : esc(part)
  ).join('');
}
function highlightHistorySearchMatch(value, query){
  return highlightSearchMatch(value, query, 'history-search-highlight');
}

const DUPR_CSV_COLUMNS=[
  'matchType','event','date',
  'playerA1','playerA1DuprId','playerA1ExternalId',
  'playerA2','playerA2DuprId','playerA2ExternalId',
  'playerB1','playerB1DuprId','playerB1ExternalId',
  'playerB2','playerB2DuprId','playerB2ExternalId',
  'teamAGame1','teamBGame1','teamAGame2','teamBGame2',
  'teamAGame3','teamBGame3','teamAGame4','teamBGame4',
  'teamAGame5','teamBGame5','scoreType','location'
];
function isDuprMarkedSessionName(value){
  const name=String(value||'').trim();
  return /^\(DUPR\s+MATCH\)/i.test(name)&&!/^\(NON\s+DUPR\s+MATCH\)/i.test(name);
}
function duprCleanId(value){
  const id=String(value??'').trim().toUpperCase();
  return !id||id==='NR'?'':id;
}
function duprCsvEscape(value){
  const text=String(value??'');
  return /[",\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;
}
function duprCsvDate(value){
  const date=value?new Date(value):new Date();
  if(!Number.isFinite(date.getTime()))return '';
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function duprCsvPlayerIdFrom(record){
  if(!record)return '';
  return duprCleanId(record.duprId||record.duprID||record.dupr_id||record.dupr||'');
}
function duprCsvNormalizeName(value){return String(value||'').trim().replace(/\s+/g,' ').toLocaleLowerCase();}
function resolveDuprCsvPlayer(log,side,index){
  const playerArray=Array.isArray(log[`${side}Players`])?log[`${side}Players`]:[];
  const playerIds=Array.isArray(log[`${side}Ids`])?log[`${side}Ids`]:[];
  const playerNames=Array.isArray(log[`${side}Names`])?log[`${side}Names`]:[];
  const snapshot=playerArray[index]||{};
  const id=snapshot.id??playerIds[index]??'';
  const name=String(snapshot.name||playerNames[index]||snapshot.nickname||'').trim();
  const activePlayers=[...(Array.isArray(state.players)?state.players:[]),...(Array.isArray(state.left)?state.left:[])];
  const byId=id!==''?activePlayers.find(player=>String(player.id)===String(id)):null;
  loadCloudRecords();
  const normalizedName=duprCsvNormalizeName(name||snapshot.name||snapshot.nickname||byId?.name);
  const byName=normalizedName?activePlayers.find(player=>duprCsvNormalizeName(player.name)===normalizedName):null;
  const cloudByName=normalizedName?(cloudRecords.players||[]).find(player=>duprCsvNormalizeName(player.name)===normalizedName):null;
  const active=byId||byName;
  const duprId=duprCsvPlayerIdFrom(active)||duprCsvPlayerIdFrom(cloudByName)||duprCsvPlayerIdFrom(snapshot);
  return {name:name||String(active?.name||cloudByName?.name||''),duprId,id};
}
function getDuprCsvRows(){
  const allLogs=Array.isArray(state.logs)?state.logs:[];
  const markedLogs=allLogs.filter(log=>log&&(log.duprMatch===true||isDuprMarkedSessionName(log.sessionName||state.sessionName)));
  const rows=[];
  const skipped={score:0,ids:0,players:0,format:0};
  markedLogs.forEach(log=>{
    const scoreText=String(log.score??'').trim();
    const scoreMatch=scoreText.match(/^(\d+)\s*-\s*(\d+)$/);
    if(log.recordingMode==='win-only'||!scoreMatch){skipped.score++;return;}
    const scoreA=Number(scoreMatch[1]),scoreB=Number(scoreMatch[2]);
    if(!Number.isSafeInteger(scoreA)||!Number.isSafeInteger(scoreB)||scoreA<0||scoreB<0||scoreA===scoreB){skipped.score++;return;}
    const type=String(log.type||'Doubles').toLowerCase();
    const isSingles=type.includes('single');
    if(!isSingles&&!type.includes('double')){skipped.format++;return;}
    const teamSize=isSingles?1:2;
    const teamA=Array.from({length:teamSize},(_,index)=>resolveDuprCsvPlayer(log,'team1',index));
    const teamB=Array.from({length:teamSize},(_,index)=>resolveDuprCsvPlayer(log,'team2',index));
    if(teamA.some(player=>!player.name)||teamB.some(player=>!player.name)){skipped.players++;return;}
    if(teamA.some(player=>!player.duprId)||teamB.some(player=>!player.duprId)){skipped.ids++;return;}
    const sessionName=String(log.sessionName||state.sessionName||'').trim();
    const eventName=sessionName.replace(/^\((?:NON\s+)?DUPR\s+MATCH\)\s*/i,'').trim()||'Open Play';
    const output={
      matchType:isSingles?'S':'D',event:eventName,date:duprCsvDate(log.endedAt||log.startedAt),
      playerA1:teamA[0]?.name||'',playerA1DuprId:teamA[0]?.duprId||'',playerA1ExternalId:'',
      playerA2:teamA[1]?.name||'',playerA2DuprId:teamA[1]?.duprId||'',playerA2ExternalId:'',
      playerB1:teamB[0]?.name||'',playerB1DuprId:teamB[0]?.duprId||'',playerB1ExternalId:'',
      playerB2:teamB[1]?.name||'',playerB2DuprId:teamB[1]?.duprId||'',playerB2ExternalId:'',
      teamAGame1:scoreA,teamBGame1:scoreB,teamAGame2:'',teamBGame2:'',
      teamAGame3:'',teamBGame3:'',teamAGame4:'',teamBGame4:'',teamAGame5:'',teamBGame5:'',
      scoreType:String(log.scoreType||((Number(log.target)===21)?'Rally':'Sideout')),
      location:''
    };
    rows.push(DUPR_CSV_COLUMNS.map(column=>output[column]??''));
  });
  return {rows,markedCount:markedLogs.length,skipped};
}
function duprCsvDefaultEventName(){
  const raw=String(state.sessionName||'Open Play').trim();
  return raw.replace(/^\((?:NON\s+)?DUPR\s+MATCH\)\s*/i,'').trim()||'Open Play';
}
function showDuprCsvPreExportValidation(){
  const {rows,markedCount,skipped}=getDuprCsvRows();
  if(!markedCount){
    alert('Walang DUPR-tagged matches na makita. I-on ang DUPR Match sa session setup bago maglaro, pagkatapos i-record ang scores.');
    return false;
  }
  if(!rows.length){
    const reasons=[];
    if(skipped.score)reasons.push(`${skipped.score} walang valid numerical score`);
    if(skipped.ids)reasons.push(`${skipped.ids} kulang ang DUPR ID ng isa o higit pang players`);
    if(skipped.players)reasons.push(`${skipped.players} kulang ang player details`);
    if(skipped.format)reasons.push(`${skipped.format} hindi kilalang match type`);
    alert(`May ${markedCount} DUPR match record(s), pero walang puwedeng i-export.\n\n${reasons.join('\n')||'Suriin ang score at DUPR ID ng players.'}\n\nAyusin ang match score at DUPR ID bago mag-download.`);
    return false;
  }
  return true;
}
function isCurrentSessionDupr(){
  return !!state.duprMatch || isDuprMarkedSessionName(state.sessionName);
}
function syncDuprCsvDownloadButtons(){
  if(!IS_QUEUEING_PAGE)return;
  const visible=isCurrentSessionDupr();
  const historyButton=$('downloadDuprCsvBtn');
  const endSessionButton=$('endSessionDuprCsvBtn');
  if(historyButton)historyButton.hidden=!visible;
  if(endSessionButton)endSessionButton.hidden=!visible;
}
function downloadDuprCsv(){
  if(!isCurrentSessionDupr()){
    syncDuprCsvDownloadButtons();
    alert('DUPR CSV download is available only for DUPR sessions.');
    return;
  }
  if(!showDuprCsvPreExportValidation())return;
  const modal=$('duprCsvExportModal');
  const eventInput=$('duprCsvEventNameInput');
  const locationInput=$('duprCsvLocationInput');
  if(!modal||!eventInput||!locationInput){
    alert('Hindi mabuksan ang DUPR CSV details form. Pakisubukang i-refresh ang page.');
    return;
  }
  eventInput.value=duprCsvDefaultEventName();
  locationInput.value=String(state.duprLocation||'').trim();
  modal.classList.remove('hidden');
  eventInput.focus();
}
function closeDuprCsvExportModal(){
  const modal=$('duprCsvExportModal');
  if(modal)modal.classList.add('hidden');
}
function confirmDuprCsvDownload(){
  const eventInput=$('duprCsvEventNameInput');
  const locationInput=$('duprCsvLocationInput');
  const eventName=String(eventInput?.value||'').trim();
  const locationName=String(locationInput?.value||'').trim();
  if(!eventName){
    alert('Ilagay muna ang Event Name.');
    eventInput?.focus();
    return;
  }
  if(!locationName){
    alert('Ilagay muna ang Location.');
    locationInput?.focus();
    return;
  }
  const {rows,markedCount,skipped}=getDuprCsvRows();
  if(!markedCount||!rows.length){
    closeDuprCsvExportModal();
    showDuprCsvPreExportValidation();
    return;
  }
  const eventColumnIndex=DUPR_CSV_COLUMNS.indexOf('event');
  const locationColumnIndex=DUPR_CSV_COLUMNS.indexOf('location');
  const exportRows=rows.map(row=>{
    const output=row.slice();
    output[eventColumnIndex]=eventName;
    output[locationColumnIndex]=locationName;
    return output;
  });
  state.duprLocation=locationName;
  saveState();
  const csv=[DUPR_CSV_COLUMNS.map(duprCsvEscape).join(','),...exportRows.map(row=>row.map(duprCsvEscape).join(','))].join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');
  const safeEvent=eventName.replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'')||'Pickle-Point-Match';
  anchor.href=url;
  anchor.download=`${duprCsvDate(new Date())}-${safeEvent}-DUPR-Matches.csv`;
  document.body.appendChild(anchor);anchor.click();anchor.remove();URL.revokeObjectURL(url);
  closeDuprCsvExportModal();
  const skippedCount=markedCount-exportRows.length;
  const skippedText=skippedCount?` ${skippedCount} match(es) skipped because score, player details, or DUPR IDs are incomplete.`:'';
  toast(`${exportRows.length} DUPR match(es) exported.${skippedText}`);
  if(skippedCount){
    const reasons=[];
    if(skipped.score)reasons.push(`${skipped.score} missing/invalid score`);
    if(skipped.ids)reasons.push(`${skipped.ids} missing DUPR ID`);
    if(skipped.players)reasons.push(`${skipped.players} missing player details`);
    if(skipped.format)reasons.push(`${skipped.format} unknown match type`);
    alert(`Na-download ang ${exportRows.length} match(es).\n\nHindi isinama: ${reasons.join(', ')||skippedCount+' incomplete match(es)'}.\n\nAyusin ang mga missing score o DUPR ID para maisama ang mga ito sa susunod na export.`);
  }
}
$('duprCsvExportForm')?.addEventListener('submit',event=>{
  event.preventDefault();
  confirmDuprCsvDownload();
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!$('duprCsvExportModal')?.classList.contains('hidden'))closeDuprCsvExportModal();
});

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
    ].filter(Boolean);
    return names.some(name=>String(name).toLowerCase().includes(query));
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
    const winnerName=l.winner||'Winner';
    const loserName=l.loser||'Loser';
    return `<div class="history-card${winOnly?' history-card-win-only':''}" onclick="openHistoryDetail(${l.id})">
      <div class="history-index">${l.id}</div><div class="history-team winner-team"><b>${highlightHistorySearchMatch(winnerName,query)}</b></div>
      <div class="history-score ${winOnly?'history-result-labels':''}">${winOnly?`<strong class="history-win-label">WIN</strong><span class="history-result-dash">-</span><strong class="history-loss-label">LOSS</strong>`:`<strong>${esc(sc[0]||'0')}</strong><span>-</span><strong>${esc(sc[1]||'0')}</strong>`}</div>
      <div class="history-team loser-team"><b>${highlightHistorySearchMatch(loserName,query)}</b></div>
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
  const renderDetailPlayer=p=>`<div class="detail-player"><span class="detail-player-name">${esc(displayPlayerName(p))}</span><span class="detail-gender-icon ${p.gender==='Female'?'female':'male'}" aria-label="${p.gender||'Unknown'}">${genderSvgIcon(p.gender)}</span><span class="mini-badge ${p.category?'skill-'+String(p.category).toLowerCase():''}">${esc(p.category||'CAT')}</span></div>`;
  const renderDetailRow=(p,teamClass)=>{const st=getHistoryStats(p);return `<div class="detail-player-row ${teamClass}"><span class="dot"></span><div class="detail-player-info"><b>${esc(displayPlayerName(p))}</b><span class="detail-row-gender ${p.gender==='Female'?'female':'male'}" aria-label="${p.gender||'Unknown'}">${genderSvgIcon(p.gender)}</span><span class="mini-badge ${p.category?'skill-'+String(p.category).toLowerCase():''}">${esc(p.category||'CAT')}</span></div><small>${Number(st.wins)||0}W · ${Number(st.losses)||0}L</small></div>`;};
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
function syncEventRuleButtonAvailability(){
  // Event rules remain editable even when score recording is off.
  const race=$('eventRaceBtn'), win=$('eventWinByBtn'), matchType=$('eventMatchTypeBtn');
  [[race,'Change race target'],[win,'Change win-by rule']].forEach(([button,title])=>{
    if(!button)return;
    button.disabled=false;
    button.setAttribute('aria-disabled','false');
    button.title=title;
  });
  if(matchType){
    const current=state.eventRules?.type==='Singles'?'Singles':'Doubles';
    matchType.disabled=false;
    matchType.setAttribute('aria-disabled','false');
    matchType.setAttribute('aria-label',`Match type ${current}. Activate to switch between Singles and Doubles.`);
    matchType.title='Switch between Singles and Doubles';
  }
}
function matchingModeDisplayName(mode){
  return ({
    'balanced':'Balance',
    'social-mix':'Social Mix',
    'skill-separated':'Skill Separated',
    'winners-losers':'Winner / Loser'
  })[mode]||'Balance';
}
function bindEventRuleButtons(){
  const race=$('eventRaceBtn'), win=$('eventWinByBtn'), mode=$('eventMatchingModeBtn'), matchType=$('eventMatchTypeBtn');
  syncEventRuleButtonAvailability();
  if(race && !race.dataset.bound){race.dataset.bound='1';race.addEventListener('click',()=>cycleEventRule('target'));}
  if(win && !win.dataset.bound){win.dataset.bound='1';win.addEventListener('click',()=>cycleEventRule('winBy'));}
  if(mode && !mode.dataset.bound){mode.dataset.bound='1';mode.addEventListener('click',cycleEventMatchingMode);}
  if(matchType && !matchType.dataset.bound){matchType.dataset.bound='1';matchType.addEventListener('click',cycleEventMatchType);}
}
function cycleEventMatchType(){
  const current=state.eventRules?.type==='Singles'?'Singles':'Doubles';
  const next=current==='Singles'?'Doubles':'Singles';
  let returnedToQueue=0;
  const queuedIds=new Set((state.queue||[]).map(id=>String(id)));

  // Running matches keep the format they started with. Every ready court follows
  // the newly selected format so player limits and team slots stay consistent.
  state.courts.forEach(c=>{
    if(c.playing)return;
    const slots=[0,1,2,3].map(index=>Array.isArray(c.players)?(c.players[index]??null):null);
    if(next==='Singles'){
      // Keep one player from each doubles side; return extra teammates to Queue.
      // If a court only has players on one side so far, preserve up to two of
      // those selections as Singles opponents instead of unexpectedly dropping one.
      const teamOne=slots[0]??slots[1];
      const teamTwo=slots[2]??slots[3];
      const keep=(teamTwo!==null&&teamTwo!==undefined
        ? [teamOne,teamTwo]
        : slots.filter(id=>id!==null&&id!==undefined).slice(0,2)
      ).filter(id=>id!==null&&id!==undefined);
      const keepIds=new Set(keep.map(id=>String(id)));
      slots.filter(id=>id!==null&&id!==undefined&&!keepIds.has(String(id))).forEach(id=>{
        const p=player(id);
        if(p){p.court=null;p.queuedAt=p.queuedAt||Date.now();p.waitingSince=p.waitingSince||p.queuedAt;}
        if(!queuedIds.has(String(id))){state.queue.push(id);queuedIds.add(String(id));}
        returnedToQueue++;
      });
      c.players=keep;
      keep.forEach(id=>{const p=player(id);if(p)p.court=c.id;});
    }else{
      // In Singles, slot 1 is the opponent. Place the two players on opposite
      // doubles sides, leaving their teammates' slots open for later selection.
      const assigned=slots.filter(id=>id!==null&&id!==undefined);
      c.players=assigned.length>1?[assigned[0],null,assigned[1]]:assigned;
    }
    c.type=next;
  });

  state.eventRules={...state.eventRules,type:next};
  saveState();
  render();
  toast(`Match type: ${next}${returnedToQueue?` — ${returnedToQueue} extra player${returnedToQueue===1?'':'s'} returned to Queue.`:''}`);
}
function cycleEventMatchingMode(){
  const values=['balanced','social-mix','skill-separated','winners-losers'];
  const current=values.includes(state.matchingMode)?state.matchingMode:'balanced';
  state.matchingMode=values[(values.indexOf(current)+1)%values.length];
  // Start the winners/losers rotation from winners whenever that mode is selected.
  if(state.matchingMode==='winners-losers')state.winnersLosersNextGroup='winners';
  saveState();
  render();
  toast(`Matching mode: ${matchingModeDisplayName(state.matchingMode)}`);
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

function renderSessionTitleMarkup(value){
  const text=String(value??'');
  const match=text.match(/^(\s*)(\((?:NON\s+)?DUPR\s+(?:RATED|MATCH)\))/i);
  if(!match)return esc(text);
  return `${esc(match[1])}<span class="event-title-type-prefix">${esc(match[2])}</span>${esc(text.slice(match[0].length))}`;
}

function render(){
  syncQueueDuprLabelsToggle();
  syncDuprCsvDownloadButtons();
  const activeResultsTab=IS_QUEUEING_PAGE?document.querySelector('.results-panel .tab.active')?.dataset.tab:null;
  const queueingScrollState=IS_QUEUEING_PAGE?{
    pageX:window.scrollX||0,
    pageY:window.scrollY||0,
    containers:Array.from(document.querySelectorAll('#queueList,#courtsList,#rankingTable,#historyTable')).map(el=>({id:el.id,top:el.scrollTop,left:el.scrollLeft}))
  }:null;
  renderQueue(); renderCourts(); renderResults(); renderRegisteredSearch();
  updateAddWaitingCourtButton();
  const realCourts=state.courts.filter(c=>!c.waitingOnly); const waitingCourts=state.courts.filter(c=>c.waitingOnly);
  const stats=$('topStats'); const organizerName=String(window.PPM_ORGANIZER_NAME||window.PPM_ORGANIZER_USERNAME||'').trim(); if(stats){ stats.innerHTML=`<span class="event-stat-text">${state.players.length} players</span><span class="event-stat-sep">•</span><span class="event-stat-text">${realCourts.length} courts</span><span class="event-stat-sep">•</span><button type="button" class="event-rule-btn" id="eventRaceBtn" title="Change race target" aria-disabled="false">Race to ${state.eventRules.target}</button><span class="event-stat-sep">•</span><button type="button" class="event-stat-text event-match-type-btn" id="eventMatchTypeBtn" title="Switch between Singles and Doubles" aria-disabled="false">${esc(state.eventRules.type==='Singles'?'Singles':'Doubles')}</button><span class="event-stat-sep">•</span><button type="button" class="event-rule-btn" id="eventWinByBtn" title="Change win-by rule" aria-disabled="false">Win by ${state.eventRules.winBy}</button><span class="event-stat-sep">•</span><button type="button" class="event-rule-btn queue-dupr-header-toggle" id="queueDuprLabelsToggle" aria-pressed="true" aria-label="Dupr on — click to hide labels" title="Dupr on — click to hide labels">Dupr on</button><span class="event-stat-sep">•</span><button type="button" class="event-rule-btn" id="eventMatchingModeBtn" title="Change matching mode" aria-label="Change matching mode, current mode ${matchingModeDisplayName(state.matchingMode)}">${matchingModeDisplayName(state.matchingMode)}</button>`; bindEventRuleButtons(); syncQueueDuprLabelsToggle(); }
  const organizerStat=$('eventOrganizerStat'); const organizerNameLabel=$('eventOrganizerName'); if(organizerNameLabel)organizerNameLabel.textContent=organizerName; if(organizerStat){ organizerStat.hidden=!organizerName; organizerStat.title=organizerName; if(organizerName)organizerStat.setAttribute('aria-label',organizerName); else organizerStat.removeAttribute('aria-label'); } syncEventOrganizerBadgeLogo();
  const title=$('eventTitle'); if(title) title.innerHTML=renderSessionTitleMarkup(state.sessionName||'(DUPR MATCH) @PICKLE WORLD DOWNTOWN | 7PM - 11PM');
  if(activeResultsTab){
    document.querySelectorAll('.results-panel .tab').forEach(tab=>tab.classList.toggle('active',tab.dataset.tab===activeResultsTab));
    $('rankingView')?.classList.toggle('hidden',activeResultsTab!=='ranking');
    $('historyView')?.classList.toggle('hidden',activeResultsTab!=='history');
  }
  if(queueingScrollState){
    requestAnimationFrame(()=>{
      queueingScrollState.containers.forEach(saved=>{
        const el=$(saved.id);
        if(el){el.scrollTop=saved.top;el.scrollLeft=saved.left;}
      });
      if(Math.abs((window.scrollY||0)-queueingScrollState.pageY)>1){
        window.scrollTo({left:queueingScrollState.pageX,top:queueingScrollState.pageY,behavior:'auto'});
      }
    });
  }
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
$('historyCloseBtn').onclick=closeHistoryDetail;
$('historySaveBtn').onclick=saveHistoryScore;

$('importPlayersBtn').onclick=()=>{loadCloudRecords();$('cloudRecordsModal').classList.remove('hidden');renderCloudRecords();};
$('topStats')?.addEventListener('click',e=>{const toggle=e.target.closest('#queueDuprLabelsToggle');if(!toggle)return;state.duprLabelsEnabled=state.duprLabelsEnabled===false;saveState();syncQueueDuprLabelsToggle();render();toast(state.duprLabelsEnabled?'DUPR labels are ON.':'DUPR labels are OFF.');});
$('cloudRecordsDone').onclick=()=>{pendingCloudDeleteId=null;editingCloudDuprId=null;$('cloudRecordsModal').classList.add('hidden');};$('cloudRecordsSearch').addEventListener('input',renderCloudRecords);const leftPlayersSearch=$('leftPlayersSearch');if(leftPlayersSearch)leftPlayersSearch.addEventListener('input',renderLeftPlayersPopup);
$('importCancel').onclick=()=>$('importModal').classList.add('hidden');
$('importSave').onclick=importPlayers;

$('courtNameInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')saveCourt();});
$('historySearchInput')?.addEventListener('input',renderHistoryTable);
$('registeredPlayerSearch')?.addEventListener('input',()=>{renderQueue();renderRegisteredSearch();});
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
function setResultsTab(tabName,persist=true){
  const selected=tabName==='history'?'history':'ranking';
  document.querySelectorAll('.tab').forEach(tab=>{
    const active=tab.dataset.tab===selected;
    tab.classList.toggle('active',active);
  });
  $('rankingView')?.classList.toggle('hidden',selected!=='ranking');
  $('historyView')?.classList.toggle('hidden',selected!=='history');
  if(persist){try{sessionStorage.setItem(RESULTS_TAB_STORAGE_KEY,selected)}catch(e){}}
}
document.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',()=>setResultsTab(tab.dataset.tab)));
let savedResultsTab='ranking';
try{
  const storedResultsTab=sessionStorage.getItem(RESULTS_TAB_STORAGE_KEY);
  if(storedResultsTab==='ranking'||storedResultsTab==='history')savedResultsTab=storedResultsTab;
}catch(e){}
setResultsTab(savedResultsTab,false);

setInterval(()=>{
  state.courts.filter(c=>c.playing).forEach(c=>{ updateCourtPlayersModalTimer(c.id); const el=$(`timer-${c.id}`); if(el){el.textContent=elapsed(c.start); el.classList.remove('timer-normal','timer-yellow','timer-red'); el.classList.add(timerToneClass(c.start));} });
  if(document.visibilityState!=='hidden'){
    if(IS_QUEUEING_PAGE || openGenderPlayerId!==null || openCategoryPlayerId!==null || document.querySelector('.queue-lock-partner')){
      // Queue timers update in place instead of replacing every queue row once
      // per second. This preserves item positions, scroll, focus, and open details.
      document.querySelectorAll('.queue-waiting-line[data-player-id]').forEach(el=>{
        const p=player(Number(el.dataset.playerId));
        if(p) el.textContent=waitingAfterCheckin(p.waitingSince||p.queuedAt);
      });
      if(openCategoryPlayerId!==null) positionCategoryMenu(openCategoryPlayerId);
      if(openGenderPlayerId!==null) positionGenderMenu(openGenderPlayerId);
    }else{
      // Preserve the existing timer/render behavior on any non-queueing page.
      renderQueue();
    }
    if(document.querySelector('.picker-player-list')) filterCourtPicker();
  }
},1000);

function hasExistingLiveQueue(){
  return !!(state.sessionActive || state.players.length || state.left.length || state.queue.length || state.courts.length || state.logs.length);
}
function showLiveQueueWorkspace(shouldRender=true){
  try{sessionStorage.setItem('liveQueueView','workspace')}catch(e){}
  $('liveQueueStartScreen')?.classList.add('hidden');
  document.querySelector('.topbar')?.classList.remove('live-start-hidden');
  document.querySelector('.workspace')?.classList.remove('live-start-hidden');
  if(shouldRender)render();
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
  const selectedMode=['balanced','social-mix','skill-separated','winners-losers'].includes(state.matchingMode)?state.matchingMode:'balanced';
  document.querySelectorAll('#liveQueueMatchingMode .live-queue-matching-option').forEach(option=>{
    const active=option.dataset.mode===selectedMode;
    option.classList.toggle('active',active);
    option.setAttribute('aria-pressed',active?'true':'false');
    option.disabled=existing;
    option.setAttribute('aria-disabled',existing?'true':'false');
  });
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
  const matchingMode=document.querySelector('#liveQueueMatchingMode .live-queue-matching-option.active')?.dataset.mode||'balanced';
  const sessionInput=$('liveQueueSessionName');
  enforceLiveQueueSessionPrefix();
  state.sessionName=sessionInput?.value?.trim()||name;
  resetLiveViewFeatureTogglesForNewSession();
  state.sessionActive=true;
  state.sessionEndedAt=null;
  state.duprMatch=!!$('liveQueueDupr')?.checked;
  state.duprLocation=String($('liveQueueDuprLocation')?.value||'').trim();
  state.duprLabelsEnabled=$('liveQueueDuprLabels') ? !!$('liveQueueDuprLabels').checked : true;
  state.recordScores=!!$('liveQueueRecordResults')?.checked;
  state.eventRules={target,winBy,type};
  state.matchingMode=['balanced','social-mix','skill-separated','winners-losers'].includes(matchingMode)?matchingMode:'balanced';
  state.winnersLosersNextGroup='winners';
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
  document.querySelectorAll('#liveQueueMatchingMode .live-queue-matching-option').forEach(btn=>btn.addEventListener('click',()=>{
    const mode=btn.dataset.mode;
    if(!['balanced','social-mix','skill-separated','winners-losers'].includes(mode))return;
    document.querySelectorAll('#liveQueueMatchingMode .live-queue-matching-option').forEach(option=>{
      const active=option===btn;
      option.classList.toggle('active',active);
      option.setAttribute('aria-pressed',active?'true':'false');
    });
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
      syncEventRuleButtonAvailability();
      // When switching to winner-only mode, discard any unfinished score entry.
      if(!next)state.courts.forEach(c=>{if(c.playing)c.scores=[0,0];});
      saveState();
      if(state.sessionActive)render();
    });
  }
  const duprToggle=$('liveQueueDupr');
  duprToggle?.addEventListener('change',syncLiveQueueSessionName);
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
function applyPendingLiveQueueStartConfig(){
  let raw=null;
  try{raw=sessionStorage.getItem('picklepoint.pending-live-queue-start-config')}catch(e){}
  if(!raw)return false;
  let config;
  try{config=JSON.parse(raw)}catch(e){config=null}
  try{sessionStorage.removeItem('picklepoint.pending-live-queue-start-config')}catch(e){}
  if(!config||typeof config!=='object')return false;
  // The Start Screen checks the server before creating. Check again after shared
  // state hydration so a queue started on another device is never overwritten.
  if(hasExistingLiveQueue()){
    showLiveQueueWorkspace(false);
    return false;
  }
  const target=Number(config.target)||11;
  const winBy=Number(config.winBy)||1;
  const matchingMode=['balanced','social-mix','skill-separated','winners-losers'].includes(config.matchingMode)?config.matchingMode:'balanced';
  state.sessionName=String(config.sessionName||getAutoLiveQueueSessionName(!!config.duprMatch)).trim()||getAutoLiveQueueSessionName(!!config.duprMatch);
  resetLiveViewFeatureTogglesForNewSession();
  state.sessionActive=true;
  state.sessionEndedAt=null;
  state.duprMatch=!!config.duprMatch;
  state.duprLocation=String(config.duprLocation||'').trim();
  state.duprLabelsEnabled=typeof config.duprLabelsEnabled==='boolean'?config.duprLabelsEnabled:true;
  state.recordScores=!!config.recordScores;
  state.eventRules={target:[11,15,21].includes(target)?target:11,winBy:[1,2,3].includes(winBy)?winBy:1,type:config.type==='Singles'?'Singles':'Doubles'};
  state.matchingMode=matchingMode;
  state.winnersLosersNextGroup='winners';
  state.selectedCourt=null;
  saveState();
  render();
  publishLiveViewState();
  showLiveQueueWorkspace(false);
  return true;
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
    if(document.body?.dataset.page==='queueing'){
      window.location.assign('session.html');
      return;
    }
    showLiveQueueStartScreen();
  });
  setupTopbarModalActionGuard([
    button,
    $('endSessionBtn'),
    $('liveViewQrOpenBtn'),
    $('liveViewRegisterBtn'),
    // Keep the compact Queueing-page Results opener inactive while any modal
    // is open, preventing stacked dialogs/tap-through on iPad and tablets.
    document.body?.dataset.page==='queueing' ? $('tabletResultsOpenBtn') : null
  ]);
}

loadCloudRecords();
loadState();
bindLiveQueueStartScreen();
bindTopbarBackButton();
initQueueNetworkStatus();
initLiveViewThemeController();
initLiveRankingAdminToggle();
initLiveMatchesAdminToggle();
$('liveViewQrOpenBtn')?.addEventListener('click',openLiveViewQrModal);
$('liveViewQrCopyBtn')?.addEventListener('click',copyLiveViewQrLink);
$('liveViewQrOpenPageBtn')?.addEventListener('click',openLiveView);
$('liveViewRegisterBtn')?.addEventListener('click',openRegistrationQrModal);
$('registrationQrCopyBtn')?.addEventListener('click',copyRegistrationQrLink);
$('registrationQrOpenPageBtn')?.addEventListener('click',openRegistrationPage);
document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeLiveViewQrModal();closeRegistrationQrModal();}});
// Paint the cached state immediately so the page layout is stable on refresh.
// Shared sync below only re-renders when the incoming state actually differs.
render();
publishLiveViewState();
const sharedDataSyncReady = initializeSharedDataSync();
// Keep the shared live snapshot available while an active event is running.
// The server ignores unchanged heartbeats, so this does not repeatedly write data.
setInterval(()=>{
  if(state.sessionActive && (location.protocol==='http:'||location.protocol==='https:')) publishLiveViewState();
},30000);
if(IS_QUEUEING_PAGE){
  // Keep the workspace visible while sync runs; don't trigger a second full
  // render merely because the initial sync promise has completed.
  showLiveQueueWorkspace(false);
  const finishQueueingStartup=()=>{
    if(remoteSessionEndRedirectInProgress)return;
    applyPendingLiveQueueStartConfig();
    if(!remoteSessionEndRedirectInProgress)showLiveQueueWorkspace(false);
  };
  sharedDataSyncReady.then(finishQueueingStartup,finishQueueingStartup);
}else{
  let savedLiveQueueView=null;
  try{
    const storedLiveQueueView=sessionStorage.getItem('liveQueueView');
    if(storedLiveQueueView==='start'||storedLiveQueueView==='workspace')savedLiveQueueView=storedLiveQueueView;
  }catch(e){}
  if(savedLiveQueueView==='workspace'){
    showLiveQueueWorkspace();
  }else if(savedLiveQueueView==='start'){
    showLiveQueueStartScreen();
  }else if(hasExistingLiveQueue()){
    showLiveQueueWorkspace();
  }else{
    showLiveQueueStartScreen();
  }
}


// Mobile/tablet Results modal; preserve the original results panel location on desktop.
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
  const compactScreen=()=>window.matchMedia('(max-width: 1100px)').matches;
  function syncLayout(){
    if(compactScreen()){
      if(panel.parentNode!==modalBody) modalBody.appendChild(panel);
      openBtn.style.display='inline-flex';
    }else{
      if(panel.parentNode!==marker.parentNode) marker.parentNode.insertBefore(panel,marker.nextSibling);
      openBtn.style.removeProperty('display');
      closeModal();
    }
    syncWaitingScroll();
  }
  function openModal(){if(!compactScreen())return;modal.classList.add('is-open');modal.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';closeBtn?.focus();}
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
