const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'live-state.json');
const THEME_FILE = path.join(DATA_DIR, 'live-theme.json');
const PORT = Math.max(1, Number(process.env.PORT) || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8'};
const allowedFiles = new Set(['index.html','style.css','script.js','pickleball-p-emblem.png','live-session-indicator.png','team-player-empty-icon.png','live.html','live-view.css','live-view.js']);
let latestState = null;
let liveTheme = 'night';
const subscribers = new Set();

function sendJson(res, status, data) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(data));
}
function broadcast() {
  if (!latestState) return;
  const packet = `event: live-state\ndata: ${JSON.stringify(latestState)}\n\n`;
  for (const res of subscribers) { try { res.write(packet); } catch (_) { subscribers.delete(res); } }
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
        updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : new Date().toISOString(),
        playerCount: Math.max(0,Number(body.playerCount)||0),
        queue: Array.isArray(body.queue) ? body.queue.slice(0,500).map(p=>({id:p?.id,name:String(p?.name||'Player').slice(0,120),nickname:String(p?.nickname||'').slice(0,80),gender:String(p?.gender||'').slice(0,20),category:String(p?.category||'').slice(0,10)})) : [],
        courts: Array.isArray(body.courts) ? body.courts.slice(0,100).map(c=>({id:c?.id,name:String(c?.name||'Court').slice(0,100),number:Number(c?.number)||null,waitingOnly:!!c?.waitingOnly,playing:!!c?.playing,start:c?.start||null,target:Math.max(1,Number(c?.target)||11),winBy:Math.max(1,Number(c?.winBy)||1),players:Array.isArray(c?.players)?c.players.slice(0,4).map(p=>p?({id:p.id,name:String(p.name||'Player').slice(0,120),nickname:String(p.nickname||'').slice(0,80),gender:String(p.gender||'').slice(0,20),category:String(p.category||'').slice(0,10)}):null):[],team1:Array.isArray(c?.team1)?c.team1.slice(0,2).map(p=>p?({id:p.id,name:String(p.name||'Player').slice(0,120),nickname:String(p.nickname||'').slice(0,80),gender:String(p.gender||'').slice(0,20),category:String(p.category||'').slice(0,10)}):null):[],team2:Array.isArray(c?.team2)?c.team2.slice(0,2).map(p=>p?({id:p.id,name:String(p.name||'Player').slice(0,120),nickname:String(p.nickname||'').slice(0,80),gender:String(p.gender||'').slice(0,20),category:String(p.category||'').slice(0,10)}):null):[],scores:Array.isArray(c?.scores)?c.scores.slice(0,2).map(n=>Math.max(0,Number(n)||0)):[0,0]})) : [],
        activeCourtCount:Math.max(0,Number(body.activeCourtCount)||0), readyCourtCount:Math.max(0,Number(body.readyCourtCount)||0), courtCount:Math.max(0,Number(body.courtCount)||0), waitingCourtCount:Math.max(0,Number(body.waitingCourtCount)||0), matchCount:Math.max(0,Number(body.matchCount)||0),
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
    res.writeHead(200, {'Content-Type':MIME[path.extname(filePath).toLowerCase()]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':name==='index.html'||name==='live.html'?'no-cache':'public, max-age=300','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});
    if(req.method==='HEAD')return res.end();
    fs.createReadStream(filePath).pipe(res);
  } catch (_) { return sendJson(res,404,{ok:false,error:'Not found'}); }
}

(async()=>{
  try { const saved=await fs.promises.readFile(DATA_FILE,'utf8'); const parsed=JSON.parse(saved); if(parsed&&typeof parsed==='object')latestState=parsed; } catch (_) {}
  try { const savedTheme=JSON.parse(await fs.promises.readFile(THEME_FILE,'utf8')); if(savedTheme&& (savedTheme.theme==='light'||savedTheme.theme==='night'))liveTheme=savedTheme.theme; } catch (_) {}
  const server=http.createServer((req,res)=>{handle(req,res).catch(err=>{console.error('Request error:',err);if(!res.headersSent)sendJson(res,500,{ok:false,error:'Internal server error'});else res.end();});});
  server.listen(PORT,HOST,()=>console.log(`Pickle Point Match running at http://localhost:${PORT}\nLive View: http://localhost:${PORT}/live.html\nFor another device on the same Wi-Fi, use this computer's local IP address.`));
  const shutdown=()=>{for(const res of subscribers){try{res.end();}catch(_){}}server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1000).unref();};
  process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
})();
