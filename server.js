const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT = __dirname;
const DATA_DIR = process.env.PICKLE_DATA_DIR ? path.resolve(process.env.PICKLE_DATA_DIR) : path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'live-state.json');
const THEME_FILE = path.join(DATA_DIR, 'live-theme.json');
const APP_STATE_FILE = path.join(DATA_DIR, 'app-state.json');
const CLOUD_RECORDS_FILE = path.join(DATA_DIR, 'registered-player-cloud.json');
const PORT = Math.max(1, Number(process.env.PORT) || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8'};
const allowedFiles = new Set(['index.html','queueing.html','start-page.js','queueing-app-loader.js','style.css','script.js','live-queue-start-card.html','live-queue-start-loader.js','pickleball-p-emblem.png','live-session-indicator.png','team-player-empty-icon.png','live.html','live-view.css','live-view.js','Registration.html','registration-app.js','registration-page.css','registration-page-panel-icon.png']);
let latestState = null;
let sharedAppState = null;
let sharedAppRevision = 0;
let sharedAppUpdatedAt = null;
let sharedAppClientId = null;
let sharedCloudRecords = null;
let sharedCloudRevision = 0;
let sharedCloudUpdatedAt = null;
let sharedCloudClientId = null;
let liveTheme = 'night';
const subscribers = new Set();
const sharedSubscribers = new Set();

function sendJson(res, status, data) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(data));
}
function normalizePlayerName(value) {
  return String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}
function createDefaultSharedAppState() {
  return {schemaVersion:11,players:[],left:[],queue:[],lockedPartners:[],courts:[],logs:[],nextPlayer:1,nextCourt:1,nextWaitingCourt:1,nextLog:1,sessionMetrics:{cloudCheckins:0,newRegistered:0},sessionActive:false,sessionName:'Open Play',duprMatch:false,recordScores:false,eventRules:{target:11,winBy:1,type:'Doubles'},matchingMode:'balanced',winnersLosersNextGroup:'winners'};
}
function normalizeTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}
function broadcast() {
  if (!latestState) return;
  const packet = `event: live-state\ndata: ${JSON.stringify(latestState)}\n\n`;
  for (const res of subscribers) { try { res.write(packet); } catch (_) { subscribers.delete(res); } }
}
function broadcastNamedEvent(eventName, payload) {
  const packet = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sharedSubscribers) { try { res.write(packet); } catch (_) { sharedSubscribers.delete(res); } }
}
function broadcastTheme() {
  const packet = `event: live-theme\ndata: ${liveTheme}\n\n`;
  for (const res of subscribers) { try { res.write(packet); } catch (_) { subscribers.delete(res); } }
}
async function persistState(snapshot) {
  latestState = snapshot;
  await fs.promises.mkdir(DATA_DIR, {recursive:true});
  await fs.promises.writeFile(DATA_FILE, JSON.stringify(snapshot), 'utf8');
  broadcast();
}

// Project the authoritative shared queue into the public Live View snapshot.
// This means phone registrations appear immediately even when the organizer tab
// is temporarily asleep or the live queue client has not yet consumed its event.
function buildLiveQueueSnapshot(appState, updatedAt = new Date().toISOString()) {
  const players = Array.isArray(appState?.players) ? appState.players : [];
  const left = Array.isArray(appState?.left) ? appState.left : [];
  const roster = [...players, ...left];
  const byId = new Map(roster.filter(p => p && p.id != null).map(p => [String(p.id), p]));
  const lockedPartners = Array.isArray(appState?.lockedPartners) ? appState.lockedPartners : [];
  const queue = (Array.isArray(appState?.queue) ? appState.queue : []).map(id => {
    const player = byId.get(String(id));
    if (!player) return null;
    const pair = lockedPartners.find(item => Array.isArray(item) && item.map(String).includes(String(id)));
    const partnerId = pair?.find(value => String(value) !== String(id));
    const partner = partnerId != null ? byId.get(String(partnerId)) : null;
    return {
      id: player.id,
      name: String(player.name || 'Player').slice(0, 120),
      nickname: String(player.nickname || '').slice(0, 80),
      gender: String(player.gender || '').slice(0, 20),
      category: String(player.category || '').slice(0, 10),
      queuedAt: normalizeTimestamp(player.queuedAt),
      waitingSince: normalizeTimestamp(player.waitingSince) || normalizeTimestamp(player.queuedAt),
      ...(partner ? {lockedPartnerName: String(partner.name || '').trim().split(/\s+/)[0] || ''} : {})
    };
  }).filter(Boolean);

  const previous = latestState && typeof latestState === 'object' ? latestState : {};
  return {
    ...previous,
    sessionName: String(appState?.sessionName || previous.sessionName || 'Open Play'),
    active: !!appState?.sessionActive,
    recordScores: appState?.recordScores === true,
    liveRankingEnabled: previous.liveRankingEnabled !== false,
    liveMatchesEnabled: previous.liveMatchesEnabled !== false,
    updatedAt,
    playerCount: roster.length,
    queue,
    courts: Array.isArray(previous.courts) ? previous.courts : [],
    // Always compute counters from the court list. Cached counters can lag
    // behind when this snapshot is refreshed by the registration endpoint.
    activeCourtCount: (Array.isArray(previous.courts) ? previous.courts : []).filter(c => c && !c.waitingOnly && !!c.playing).length,
    readyCourtCount: (Array.isArray(previous.courts) ? previous.courts : []).filter(c => c && !c.waitingOnly && !c.playing).length,
    courtCount: (Array.isArray(previous.courts) ? previous.courts : []).filter(c => c && !c.waitingOnly).length,
    waitingCourtCount: (Array.isArray(previous.courts) ? previous.courts : []).filter(c => c && c.waitingOnly).length,
    matchCount: Array.isArray(appState?.logs) ? appState.logs.length : Number(previous.matchCount) || 0,
    ranking: Array.isArray(previous.ranking) ? previous.ranking : [],
    eventRules: previous.eventRules || appState?.eventRules || {target:11,winBy:1,type:'Doubles'},
    recentMatches: Array.isArray(previous.recentMatches) ? previous.recentMatches : []
  };
}
async function readBody(req, limit = 2 * 1024 * 1024) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) { const err = new Error('Payload too large'); err.statusCode = 413; throw err; }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw); } catch (_) { const err = new Error('Invalid JSON'); err.statusCode = 400; throw err; }
}
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // SEO endpoints: generate absolute URLs from the public host that requested them,
  // so the same build works on Render's onrender.com address or a custom domain.
  if ((req.method === 'GET' || req.method === 'HEAD') && (url.pathname === '/robots.txt' || url.pathname === '/sitemap.xml')) {
    const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    if (!/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(rawHost)) return sendJson(res, 400, {ok:false,error:'Invalid host'});
    const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(rawHost);
    const origin = `${isLocal ? 'http' : 'https'}://${rawHost}`;
    let body;
    let contentType;
    if (url.pathname === '/robots.txt') {
      body = `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${origin}/sitemap.xml\n`;
      contentType = 'text/plain; charset=utf-8';
    } else {
      const pages = ['/', '/live.html', '/Registration.html'];
      const xmlEscape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
      body = `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        pages.map(page => `  <url><loc>${xmlEscape(origin + page)}</loc></url>`).join('\n') +
        `\n</urlset>\n`;
      contentType = 'application/xml; charset=utf-8';
    }
    res.writeHead(200, {'Content-Type':contentType,'Content-Length':Buffer.byteLength(body),'Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'});
    return req.method === 'HEAD' ? res.end() : res.end(body);
  }
  if (url.pathname === '/api/health' && req.method === 'GET') return sendJson(res, 200, {ok:true, service:'Pickle Point Match Live View'});
  if (url.pathname === '/api/live-theme' && req.method === 'GET') return sendJson(res, 200, {ok:true,theme:liveTheme});

  // Shared application state powers the Existing Live Queue across devices.
  if (url.pathname === '/api/app-state' && req.method === 'GET') {
    return sendJson(res, 200, {ok:true, revision:sharedAppRevision, state:sharedAppState, updatedAt:sharedAppUpdatedAt});
  }
  if (url.pathname === '/api/app-state' && req.method === 'POST') {
    try {
      const body = await readBody(req, 8 * 1024 * 1024);
      const incoming = body && body.state;
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming) ||
          !Array.isArray(incoming.players) || !Array.isArray(incoming.left) ||
          !Array.isArray(incoming.queue) || !Array.isArray(incoming.courts) || !Array.isArray(incoming.logs)) {
        return sendJson(res, 400, {ok:false,error:'Invalid shared application state'});
      }
      if (body.onlyIfEmpty && sharedAppState) {
        return sendJson(res, 200, {ok:true,accepted:false,unchanged:true,revision:sharedAppRevision,state:sharedAppState,updatedAt:sharedAppUpdatedAt});
      }
      if (!body.onlyIfEmpty && Number.isFinite(Number(body.baseRevision)) && Number(body.baseRevision) !== sharedAppRevision) {
        return sendJson(res, 409, {ok:false,conflict:true,error:'Queue state changed on another device',revision:sharedAppRevision,state:sharedAppState,updatedAt:sharedAppUpdatedAt});
      }
      const snapshot = JSON.parse(JSON.stringify(incoming));
      if (JSON.stringify(sharedAppState) !== JSON.stringify(snapshot)) {
        sharedAppState = snapshot;
        sharedAppRevision += 1;
        sharedAppUpdatedAt = new Date().toISOString();
        sharedAppClientId = String(body.clientId || '').slice(0,100) || null;
        await fs.promises.mkdir(DATA_DIR, {recursive:true});
        await fs.promises.writeFile(APP_STATE_FILE, JSON.stringify({revision:sharedAppRevision,updatedAt:sharedAppUpdatedAt,clientId:sharedAppClientId,state:sharedAppState}), 'utf8');
        broadcastNamedEvent('app-state', {revision:sharedAppRevision,updatedAt:sharedAppUpdatedAt,clientId:sharedAppClientId,state:sharedAppState});
      }
      return sendJson(res, 200, {ok:true,accepted:true,revision:sharedAppRevision,updatedAt:sharedAppUpdatedAt,unchanged:JSON.stringify(sharedAppState)===JSON.stringify(snapshot)});
    } catch (err) { return sendJson(res, err.statusCode || 500, {ok:false,error:err.statusCode===413?'Payload too large':err.message||'Unable to save shared application state'}); }
  }

  // Registered Player Cloud is stored on the server, not in each browser only.
  if (url.pathname === '/api/cloud-records' && req.method === 'GET') {
    return sendJson(res, 200, {ok:true, revision:sharedCloudRevision, records:sharedCloudRecords, updatedAt:sharedCloudUpdatedAt});
  }
  if (url.pathname === '/api/cloud-records' && req.method === 'POST') {
    try {
      const body = await readBody(req, 8 * 1024 * 1024);
      const incoming = body && body.records;
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming) ||
          !Array.isArray(incoming.players) || !Array.isArray(incoming.logs) || !Array.isArray(incoming.sessions)) {
        return sendJson(res, 400, {ok:false,error:'Invalid Registered Player Cloud records'});
      }
      if (body.onlyIfEmpty && sharedCloudRecords) {
        return sendJson(res, 200, {ok:true,accepted:false,unchanged:true,revision:sharedCloudRevision,records:sharedCloudRecords,updatedAt:sharedCloudUpdatedAt});
      }
      if (!body.onlyIfEmpty && Number.isFinite(Number(body.baseRevision)) && Number(body.baseRevision) !== sharedCloudRevision) {
        return sendJson(res, 409, {ok:false,conflict:true,error:'Registered Player Cloud changed on another device',revision:sharedCloudRevision,records:sharedCloudRecords,updatedAt:sharedCloudUpdatedAt});
      }
      const records = {players:incoming.players.slice(0,50000),logs:incoming.logs.slice(0,100000),sessions:incoming.sessions.slice(0,50000)};
      if (JSON.stringify(sharedCloudRecords) !== JSON.stringify(records)) {
        sharedCloudRecords = JSON.parse(JSON.stringify(records));
        sharedCloudRevision += 1;
        sharedCloudUpdatedAt = new Date().toISOString();
        sharedCloudClientId = String(body.clientId || '').slice(0,100) || null;
        await fs.promises.mkdir(DATA_DIR, {recursive:true});
        await fs.promises.writeFile(CLOUD_RECORDS_FILE, JSON.stringify({revision:sharedCloudRevision,updatedAt:sharedCloudUpdatedAt,clientId:sharedCloudClientId,records:sharedCloudRecords}), 'utf8');
        broadcastNamedEvent('cloud-records', {revision:sharedCloudRevision,updatedAt:sharedCloudUpdatedAt,clientId:sharedCloudClientId,records:sharedCloudRecords});
      }
      return sendJson(res, 200, {ok:true,accepted:true,revision:sharedCloudRevision,updatedAt:sharedCloudUpdatedAt,unchanged:JSON.stringify(sharedCloudRecords)===JSON.stringify(records)});
    } catch (err) { return sendJson(res, err.statusCode || 500, {ok:false,error:err.statusCode===413?'Payload too large':err.message||'Unable to save Registered Player Cloud records'}); }
  }
  // Register a player and update both shared data stores as one operation.
  // The server-side duplicate check protects against submissions from multiple phones.
  if (url.pathname === '/api/register-player' && req.method === 'POST') {
    try {
      const body = await readBody(req, 16 * 1024);
      const name = String(body?.name || '').normalize('NFC').trim().replace(/\s+/g, ' ');
      const nickname = String(body?.nickname || '').normalize('NFC').trim().replace(/\s+/g, ' ').slice(0, 80);
      const gender = String(body?.gender || '');
      const category = String(body?.category || '').toUpperCase();
      if (!name || name.length > 120) return sendJson(res, 400, {ok:false,error:'Please enter a name (maximum 120 characters).'});
      if (!['Male','Female'].includes(gender)) return sendJson(res, 400, {ok:false,error:'Please select Male or Female.'});
      if (!['BEG','NOV','INT','ADV','EXP'].includes(category)) return sendJson(res, 400, {ok:false,error:'Please select a skill level.'});

      const currentRecords = sharedCloudRecords || {players:[],logs:[],sessions:[]};
      const duplicate = (Array.isArray(currentRecords.players) ? currentRecords.players : []).find(p => normalizePlayerName(p?.name) === normalizePlayerName(name));
      if (duplicate) return sendJson(res, 409, {ok:false,duplicate:true,error:'This user is already registered',player:{name:duplicate.name}});

      const records = JSON.parse(JSON.stringify(currentRecords));
      records.players = Array.isArray(records.players) ? records.players : [];
      records.logs = Array.isArray(records.logs) ? records.logs : [];
      records.sessions = Array.isArray(records.sessions) ? records.sessions : [];
      const appState = JSON.parse(JSON.stringify(sharedAppState || createDefaultSharedAppState()));
      appState.players = Array.isArray(appState.players) ? appState.players : [];
      appState.left = Array.isArray(appState.left) ? appState.left : [];
      appState.queue = Array.isArray(appState.queue) ? appState.queue : [];
      appState.courts = Array.isArray(appState.courts) ? appState.courts : [];
      appState.logs = Array.isArray(appState.logs) ? appState.logs : [];
      appState.sessionMetrics = appState.sessionMetrics && typeof appState.sessionMetrics === 'object' ? appState.sessionMetrics : {cloudCheckins:0,newRegistered:0};
      appState.nextPlayer = Math.max(Number(appState.nextPlayer) || 1, appState.players.reduce((max,p)=>Math.max(max,Number(p?.id)||0),0)+1);

      let player = appState.players.find(p => normalizePlayerName(p?.name) === normalizePlayerName(name));
      const isNewQueuePlayer = !player;
      const now = Date.now();
      if (player) {
        if (player.id == null) player.id = appState.nextPlayer++;
        player.name = name;
        player.nickname = nickname;
        player.gender = gender;
        player.category = category;
        player.court = player.court ?? null;
      } else {
        player = {id:appState.nextPlayer++,name,nickname,wins:0,court:null,gender,category,queuedAt:now,waitingSince:now};
        appState.players.push(player);
      }
      const playingOnCourt = !!player.court || appState.courts.some(c => Array.isArray(c?.players) && c.players.includes(player.id));
      if (!playingOnCourt && !appState.queue.includes(player.id)) {
        player.queuedAt = now;
        player.waitingSince = now;
        appState.queue.push(player.id);
      }
      if (isNewQueuePlayer) appState.sessionMetrics.newRegistered = (Number(appState.sessionMetrics.newRegistered) || 0) + 1;

      const cloudId = Date.now() + Math.floor(Math.random() * 100000);
      const cloudPlayer = {cloudId,name,nickname,gender,category,opgId:'',matches:0,wins:0,losses:0};
      records.players.push(cloudPlayer);

      const updatedAt = new Date().toISOString();
      sharedAppState = appState;
      sharedAppRevision += 1;
      sharedAppUpdatedAt = updatedAt;
      sharedAppClientId = 'registration-page';
      sharedCloudRecords = records;
      sharedCloudRevision += 1;
      sharedCloudUpdatedAt = updatedAt;
      sharedCloudClientId = 'registration-page';

      const liveSnapshot = buildLiveQueueSnapshot(sharedAppState, updatedAt);
      await fs.promises.mkdir(DATA_DIR, {recursive:true});
      await Promise.all([
        fs.promises.writeFile(APP_STATE_FILE, JSON.stringify({revision:sharedAppRevision,updatedAt:sharedAppUpdatedAt,clientId:sharedAppClientId,state:sharedAppState}), 'utf8'),
        fs.promises.writeFile(CLOUD_RECORDS_FILE, JSON.stringify({revision:sharedCloudRevision,updatedAt:sharedCloudUpdatedAt,clientId:sharedCloudClientId,records:sharedCloudRecords}), 'utf8'),
        fs.promises.writeFile(DATA_FILE, JSON.stringify(liveSnapshot), 'utf8')
      ]);
      latestState = liveSnapshot;
      broadcast();
      broadcastNamedEvent('app-state', {revision:sharedAppRevision,updatedAt:sharedAppUpdatedAt,clientId:sharedAppClientId,state:sharedAppState});
      broadcastNamedEvent('cloud-records', {revision:sharedCloudRevision,updatedAt:sharedCloudUpdatedAt,clientId:sharedCloudClientId,records:sharedCloudRecords});
      return sendJson(res, 200, {ok:true,player:cloudPlayer,queued:!playingOnCourt,queueCount:sharedAppState.queue.length,cloudCount:sharedCloudRecords.players.length,appRevision:sharedAppRevision,cloudRevision:sharedCloudRevision,liveViewUpdated:true});
    } catch (err) {
      return sendJson(res, err.statusCode || 500, {ok:false,error:err.statusCode===413?'Payload too large':err.message||'Unable to register player'});
    }
  }

  if (url.pathname === '/api/live-theme' && req.method === 'POST') {
    try {
      const body = await readBody(req, 4096);
      if (!body || (body.theme !== 'light' && body.theme !== 'night')) return sendJson(res, 400, {ok:false,error:'Invalid Live View theme'});
      liveTheme = body.theme;
      await fs.promises.mkdir(DATA_DIR, {recursive:true});
      await fs.promises.writeFile(THEME_FILE, JSON.stringify({theme:liveTheme,updatedAt:new Date().toISOString()}), 'utf8');
      broadcastTheme();
      return sendJson(res, 200, {ok:true,theme:liveTheme});
    } catch (err) { return sendJson(res, 500, {ok:false,error:'Unable to save Live View theme'}); }
  }
  if (url.pathname === '/api/live-state' && req.method === 'GET') return sendJson(res, 200, {ok:true,state:latestState});
  if (url.pathname === '/api/live-state' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.sessionName !== 'string') return sendJson(res, 400, {ok:false,error:'Invalid live view state'});
      // Only public display fields should be submitted by the browser publisher.
      const snapshot = {
        sessionName: String(body.sessionName).slice(0,200), active: !!body.active,
        recordScores: body.recordScores === true,
        liveRankingEnabled: body.liveRankingEnabled !== false,
        liveMatchesEnabled: body.liveMatchesEnabled !== false,
        updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : new Date().toISOString(),
        playerCount: Math.max(0,Number(body.playerCount)||0),
        // Keep the queue timestamps in the shared state. Live View uses these
        // exact values to calculate each player's waiting duration on every device.
        queue: Array.isArray(body.queue) ? body.queue.slice(0,500).map(p=>{
          const queuedAt = normalizeTimestamp(p?.queuedAt);
          const waitingSince = normalizeTimestamp(p?.waitingSince) || queuedAt;
          return {id:p?.id,name:String(p?.name||'Player').slice(0,120),nickname:String(p?.nickname||'').slice(0,80),gender:String(p?.gender||'').slice(0,20),category:String(p?.category||'').slice(0,10),queuedAt,waitingSince};
        }) : [],
        courts: Array.isArray(body.courts) ? body.courts.slice(0,100).map(c=>({id:c?.id,name:String(c?.name||'Court').slice(0,100),number:Number(c?.number)||null,waitingOnly:!!c?.waitingOnly,playing:!!c?.playing,start:c?.start||null,target:Math.max(1,Number(c?.target)||11),winBy:Math.max(1,Number(c?.winBy)||1),players:Array.isArray(c?.players)?c.players.slice(0,4).map(p=>p?({id:p.id,name:String(p.name||'Player').slice(0,120),nickname:String(p.nickname||'').slice(0,80),gender:String(p.gender||'').slice(0,20),category:String(p.category||'').slice(0,10)}):null):[],team1:Array.isArray(c?.team1)?c.team1.slice(0,2).map(p=>p?({id:p.id,name:String(p.name||'Player').slice(0,120),nickname:String(p.nickname||'').slice(0,80),gender:String(p.gender||'').slice(0,20),category:String(p.category||'').slice(0,10)}):null):[],team2:Array.isArray(c?.team2)?c.team2.slice(0,2).map(p=>p?({id:p.id,name:String(p.name||'Player').slice(0,120),nickname:String(p.nickname||'').slice(0,80),gender:String(p.gender||'').slice(0,20),category:String(p.category||'').slice(0,10)}):null):[],scores:Array.isArray(c?.scores)?c.scores.slice(0,2).map(n=>Math.max(0,Number(n)||0)):[0,0]})) : [],
        activeCourtCount:Math.max(0,Number(body.activeCourtCount)||0), readyCourtCount:Math.max(0,Number(body.readyCourtCount)||0), courtCount:Math.max(0,Number(body.courtCount)||0), waitingCourtCount:Math.max(0,Number(body.waitingCourtCount)||0), matchCount:Math.max(0,Number(body.matchCount)||0),
        // Keep the ranking in the published snapshot. Without this allowlisted
        // field, the server silently discarded the ranking created by script.js,
        // so Live View showed an empty ranking after deployment.
        ranking:Array.isArray(body.ranking)?body.ranking.slice(0,500).map((p,index)=>({
          position:Math.max(1,Number(p?.position)||index+1),
          id:p?.id==null?null:String(p.id).slice(0,100),
          name:String(p?.name||'Player').slice(0,120),
          nickname:String(p?.nickname||'').slice(0,80),
          gender:String(p?.gender||'').slice(0,20),
          category:String(p?.category||'').slice(0,10),
          matches:Math.max(0,Number(p?.matches)||0),
          wins:Math.max(0,Number(p?.wins)||0),
          losses:Math.max(0,Number(p?.losses)||0),
          winRate:Math.max(0,Math.min(100,Number(p?.winRate)||0)),
          totalSeconds:Math.max(0,Number(p?.totalSeconds)||0),
          playing:!!p?.playing
        })) : [],
        eventRules:{target:Math.max(1,Number(body.eventRules?.target)||11),winBy:Math.max(1,Number(body.eventRules?.winBy)||1),type:String(body.eventRules?.type||'Doubles').slice(0,30)},
        recentMatches:Array.isArray(body.recentMatches)?body.recentMatches.slice(0,12).map(m=>({id:m?.id,court:String(m?.court||'Court').slice(0,100),winner:String(m?.winner||'').slice(0,300),loser:String(m?.loser||'').slice(0,300),score:String(m?.score||'').slice(0,30),endedAt:m?.endedAt||null,duration:String(m?.duration||'').slice(0,40)})):[]
      };
      // Treat the normalized court list as the source of truth for court counters;
      // never trust a separately published count that may be stale.
      const regularCourts = snapshot.courts.filter(c => !c.waitingOnly);
      snapshot.activeCourtCount = regularCourts.filter(c => c.playing).length;
      snapshot.readyCourtCount = regularCourts.filter(c => !c.playing).length;
      snapshot.courtCount = regularCourts.length;
      snapshot.waitingCourtCount = snapshot.courts.filter(c => c.waitingOnly).length;

      // A lightweight publisher heartbeat keeps hosted free-tier services awake.
      // Avoid disk writes and viewer broadcasts when only updatedAt has changed.
      if (latestState) {
        const previousComparable = {...latestState};
        const nextComparable = {...snapshot};
        delete previousComparable.updatedAt;
        delete nextComparable.updatedAt;
        if (JSON.stringify(previousComparable) === JSON.stringify(nextComparable)) {
          latestState.updatedAt = snapshot.updatedAt;
          return sendJson(res, 200, {ok:true,updatedAt:snapshot.updatedAt,unchanged:true});
        }
      }
      await persistState(snapshot);
      return sendJson(res, 200, {ok:true,updatedAt:snapshot.updatedAt});
    } catch (err) { return sendJson(res, err.statusCode || 500, {ok:false,error:err.statusCode===413?'Payload too large':err.message||'Unable to save live state'}); }
  }
  if (url.pathname === '/api/shared-events' && req.method === 'GET') {
    res.writeHead(200, {'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
    res.write('retry: 2000\n\n');
    if (sharedAppState) res.write(`event: app-state\ndata: ${JSON.stringify({revision:sharedAppRevision,updatedAt:sharedAppUpdatedAt,clientId:sharedAppClientId,state:sharedAppState})}\n\n`);
    if (sharedCloudRecords) res.write(`event: cloud-records\ndata: ${JSON.stringify({revision:sharedCloudRevision,updatedAt:sharedCloudUpdatedAt,clientId:sharedCloudClientId,records:sharedCloudRecords})}\n\n`);
    sharedSubscribers.add(res);
    const heartbeat = setInterval(()=>{try{res.write(': keep-alive\n\n');}catch(_){cleanup();}},20000);
    const cleanup = () => { clearInterval(heartbeat); sharedSubscribers.delete(res); };
    res.on('close', cleanup);
    res.on('error', cleanup);
    req.on('aborted', cleanup);
    return;
  }
  if (url.pathname === '/api/live-events' && req.method === 'GET') {
    res.writeHead(200, {'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
    res.write('retry: 2000\n\n');
    if (latestState) res.write(`event: live-state\ndata: ${JSON.stringify(latestState)}\n\n`);
    res.write(`event: live-theme\ndata: ${liveTheme}\n\n`);
    subscribers.add(res);
    const heartbeat = setInterval(()=>{try{res.write(': keep-alive\n\n');}catch(_){cleanup();}},20000);
    const cleanup = () => { clearInterval(heartbeat); subscribers.delete(res); };
    // Track the response/socket lifetime for SSE clients. The incoming request
    // itself can finish before the long-lived event stream has ended.
    res.on('close', cleanup);
    res.on('error', cleanup);
    req.on('aborted', cleanup);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res,405,{ok:false,error:'Method not allowed'});
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch (_) { return sendJson(res,400,{ok:false,error:'Invalid path'}); }
  if (pathname === '/') pathname = '/index.html';
  const name = path.basename(pathname);
  if (!allowedFiles.has(name) || pathname.includes('..')) return sendJson(res,404,{ok:false,error:'Not found'});
  const filePath = path.join(ROOT,name);
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) return sendJson(res,404,{ok:false,error:'Not found'});
    const extension=path.extname(filePath).toLowerCase();
    const mutableAsset=['.html','.js','.css'].includes(extension);
    res.writeHead(200, {'Content-Type':MIME[extension]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':mutableAsset?'no-cache, must-revalidate':'public, max-age=300','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});
    if(req.method==='HEAD')return res.end();
    fs.createReadStream(filePath).pipe(res);
  } catch (_) { return sendJson(res,404,{ok:false,error:'Not found'}); }
}

(async()=>{
  try { const saved=await fs.promises.readFile(DATA_FILE,'utf8'); const parsed=JSON.parse(saved); if(parsed&&typeof parsed==='object')latestState=parsed; } catch (_) {}
  try { const savedTheme=JSON.parse(await fs.promises.readFile(THEME_FILE,'utf8')); if(savedTheme&& (savedTheme.theme==='light'||savedTheme.theme==='night'))liveTheme=savedTheme.theme; } catch (_) {}
  try { const saved=JSON.parse(await fs.promises.readFile(APP_STATE_FILE,'utf8')); if(saved&&saved.state&&typeof saved.state==='object'){sharedAppState=saved.state;sharedAppRevision=Math.max(0,Number(saved.revision)||1);sharedAppUpdatedAt=saved.updatedAt||null;sharedAppClientId=saved.clientId||null;} } catch (_) {}
  try { const saved=JSON.parse(await fs.promises.readFile(CLOUD_RECORDS_FILE,'utf8')); if(saved&&saved.records&&typeof saved.records==='object'){sharedCloudRecords=saved.records;sharedCloudRevision=Math.max(0,Number(saved.revision)||1);sharedCloudUpdatedAt=saved.updatedAt||null;sharedCloudClientId=saved.clientId||null;} } catch (_) {}
  const server=http.createServer((req,res)=>{handle(req,res).catch(err=>{console.error('Request error:',err);if(!res.headersSent)sendJson(res,500,{ok:false,error:'Internal server error'});else res.end();});});
  server.listen(PORT,HOST,()=>console.log(`Pickle Point Match running at http://localhost:${PORT}\nLive View: http://localhost:${PORT}/live.html\nFor another device on the same Wi-Fi, use this computer's local IP address.`));
  const shutdown=()=>{for(const res of subscribers){try{res.end();}catch(_){}}server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1000).unref();};
  process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
})();
