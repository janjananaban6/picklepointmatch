(() => {
  'use strict';
  const LIVE_VIEW_STORAGE_KEY='picklepoint_live_view_state_v1';
  const $=id=>document.getElementById(id);
  let currentState=null;
  let serverConnected=false;
  let serverTried=false;
  let channel=null;
  const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const playerName=p=>p?(String(p.name||'Player')+(p.nickname&&String(p.nickname).trim().toLowerCase()!==String(p.name||'').trim().toLowerCase()?` (${p.nickname})`:'')):'Waiting for player';
  const formatTime=value=>{if(!value)return '';const d=new Date(value);return Number.isNaN(d.getTime())?'':d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});};
  const elapsed=start=>{if(!start)return '00:00';const ms=Math.max(0,Date.now()-new Date(start).getTime());if(!Number.isFinite(ms))return '00:00';const n=Math.floor(ms/1000);return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;};
  function setConnection(mode,label){const el=$('connectionStatus');if(!el)return;el.className='connection-status '+mode;el.querySelector('span').textContent=label;}
  function localSnapshot(){try{return JSON.parse(localStorage.getItem(LIVE_VIEW_STORAGE_KEY)||'null');}catch(e){return null;}}
  function render(){
    const s=currentState;
    const hasState=!!s;
    const active=!!s?.active;
    $('sessionTitle').textContent=s?.sessionName||'Pickle Point Match';
    $('inactiveNotice').hidden=active;
    $('queueStat').textContent=String(s?.queue?.length||0);
    $('activeCourtStat').textContent=String(s?.activeCourtCount??(s?.courts||[]).filter(c=>!c.waitingOnly&&c.playing).length);
    $('readyCourtStat').textContent=String(s?.readyCourtCount??(s?.courts||[]).filter(c=>!c.waitingOnly&&!c.playing).length);
    $('matchStat').textContent=String(s?.matchCount||0);
    $('courtSectionCount').textContent=`${s?.courtCount??(((s?.courts||[]).filter(c=>!c.waitingOnly).length)||0)} courts`;
    $('queueSectionCount').textContent=`${s?.queue?.length||0} players`;
    $('recentCount').textContent=`${s?.recentMatches?.length||0} results`;
    $('lastUpdated').textContent=s?.updatedAt?`Last updated ${new Date(s.updatedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'})}`:'Waiting for live session data…';
    const courts=s?.courts||[];
    $('courtsList').innerHTML=courts.length?courts.map(c=>{
      const status=c.waitingOnly?'Waiting':c.playing?'Playing':'Ready';
      const statusClass=c.waitingOnly?'waiting':c.playing?'playing':'ready';
      const t1=Array.isArray(c.team1)?c.team1:[];const t2=Array.isArray(c.team2)?c.team2:[];
      const team=(arr)=>[0,1].map(i=>`<div class="player-chip${arr[i]?'':' empty'}">${escapeHTML(arr[i]?playerName(arr[i]):'Open slot')}</div>`).join('');
      return `<article class="court-card${c.playing?' playing':''}"><div class="court-top"><strong class="court-name">${escapeHTML(c.name||'Court')}</strong><span class="court-state ${statusClass}">${status}</span></div>${c.playing?`<div class="match-meta"><span>Race to ${Number(c.target)||11} · Win by ${Number(c.winBy)||1}</span><span class="match-timer" data-start="${escapeHTML(c.start||'')}">${elapsed(c.start)}</span></div>`:`<div class="match-meta"><span>${c.waitingOnly?'Waiting for an available court':'Ready for matchmaking'}</span><span>${(c.players||[]).filter(Boolean).length}/4 players</span></div>`}<div class="teams"><div class="team"><span class="team-label">TEAM 1</span>${team(t1)}</div><div class="versus">VS</div><div class="team"><span class="team-label">TEAM 2</span>${team(t2)}</div></div>${c.playing?`<div class="scoreline"><span>Score</span><b>${Number(c.scores?.[0])||0} — ${Number(c.scores?.[1])||0}</b></div>`:''}</article>`;
    }).join(''):'<div class="empty-state">No courts have been set up in this session.</div>';
    const queue=s?.queue||[];
    $('queueList').innerHTML=queue.length?queue.map((p,i)=>`<div class="queue-item"><span class="queue-number">${i+1}</span><div><div class="queue-player">${escapeHTML(playerName(p))}</div><small class="queue-label">${i===0?'NEXT UP':`QUEUE POSITION ${i+1}`}</small></div></div>`).join(''):'<div class="empty-state">No players are waiting in queue.</div>';
    const matches=s?.recentMatches||[];
    $('recentMatches').innerHTML=matches.length?matches.map(m=>`<article class="result-row"><div class="result-icon">🏆</div><div class="result-content"><div class="result-match"><span class="winner">${escapeHTML(m.winner||'Winner not recorded')}</span>${m.loser?` <span style="color:#84a9ad">def.</span> ${escapeHTML(m.loser)}`:''}</div><div class="result-meta"><span>${escapeHTML(m.court||'Court')}</span><span>${escapeHTML(m.score||'WIN / LOSS')}</span><span>${escapeHTML(formatTime(m.endedAt))}</span>${m.duration?`<span>${escapeHTML(m.duration)}</span>`:''}</div></div></article>`).join(''):'<div class="empty-state">No completed matches yet.</div>';
    const usingHttpServer=location.protocol==='http:'||location.protocol==='https:';
    $('syncNotice').hidden=serverConnected||(usingHttpServer&&!serverTried);
    // Display timers continue moving between state broadcasts.
    if(serverConnected)setConnection('connected','Live sync');else if(serverTried)setConnection('local','Local preview');else setConnection('','Connecting');
  }
  function acceptState(value){if(!value||typeof value!=='object')return;currentState=value;try{localStorage.setItem(LIVE_VIEW_STORAGE_KEY,JSON.stringify(value));}catch(e){}render();}
  async function connectServer(){
    if(!['http:','https:'].includes(location.protocol)){serverTried=true;acceptState(localSnapshot());render();return;}
    try{
      const response=await fetch('/api/live-state',{cache:'no-store'});
      if(!response.ok)throw new Error('Live API unavailable');
      const data=await response.json();serverTried=true;serverConnected=true;
      if(data&&data.state)acceptState(data.state);else if(localSnapshot())acceptState(localSnapshot());
      setConnection('connected','Live sync');$('syncNotice').hidden=true;
      const source=new EventSource('/api/live-events');
      source.addEventListener('live-state',event=>{try{const parsed=JSON.parse(event.data);serverConnected=true;acceptState(parsed);setConnection('connected','Live sync');$('syncNotice').hidden=true;}catch(e){}});
      source.onopen=()=>{serverConnected=true;setConnection('connected','Live sync');$('syncNotice').hidden=true;};
      source.onerror=()=>{serverConnected=false;setConnection('local','Reconnecting');$('syncNotice').hidden=false;};
    }catch(e){serverTried=true;serverConnected=false;acceptState(localSnapshot());setConnection('local','Local preview');$('syncNotice').hidden=false;}
  }
  try{if('BroadcastChannel'in window){channel=new BroadcastChannel('pickle-point-match-live-view');channel.onmessage=e=>{if(e.data)acceptState(e.data);};}}catch(e){}
  window.addEventListener('storage',e=>{if(e.key===LIVE_VIEW_STORAGE_KEY&&e.newValue){try{acceptState(JSON.parse(e.newValue));}catch(err){}}});
  $('refreshLiveBtn').addEventListener('click',()=>{acceptState(localSnapshot());connectServer();});
  $('copyLiveLinkBtn').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.href);showToast('Live View link copied.');}catch(e){const temp=document.createElement('textarea');temp.value=location.href;temp.setAttribute('readonly','');temp.style.position='fixed';temp.style.opacity='0';document.body.appendChild(temp);temp.select();let copied=false;try{copied=document.execCommand('copy');}catch(err){}temp.remove();showToast(copied?'Live View link copied.':'Copy the page URL from your browser address bar.');}});
  let toastTimer=null;function showToast(message){const el=$('copyToast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2200);}
  const boot=localSnapshot();if(boot){currentState=boot;render();}connectServer();
  setInterval(()=>{document.querySelectorAll('[data-start]').forEach(el=>{el.textContent=elapsed(el.dataset.start);});},1000);
})();
