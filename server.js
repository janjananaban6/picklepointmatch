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
const allowedFiles = new Set(['index.html','queueing.html','start-page.js','queueing-app-loader.js','style.css','script.js','live-queue-start-card.html','live-queue-start-loader.js','pickleball-p-emblem.png','live-session-indicator.png','team-player-empty-icon.png','live.html','live-view.css','live-view.js']);
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
