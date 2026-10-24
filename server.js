const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const crypto = require('node:crypto');

const ROOT = __dirname;
const DATA_DIR = process.env.PICKLE_DATA_DIR ? path.resolve(process.env.PICKLE_DATA_DIR) : path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'live-state.json');
const THEME_FILE = path.join(DATA_DIR, 'live-theme.json');
const APP_STATE_FILE = path.join(DATA_DIR, 'app-state.json');
const CLOUD_RECORDS_FILE = path.join(DATA_DIR, 'registered-player-cloud.json');
const ORGANIZERS_FILE = path.join(DATA_DIR, 'organizer-accounts.json');
const PORT = Math.max(1, Number(process.env.PORT) || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8'};
const allowedFiles = new Set(['index.html','panel.html','panel.css','panel.js','session.html','login.css','login.js','auth-session.js','queueing.html','start-page.js','queueing-app-loader.js','style.css','script.js','pickleball-p-emblem.png','live-session-indicator.png','team-player-empty-icon.png','live.html','live-view.css','live-view.js','Registration.html','registration-app.js','registration-page.css','registration-page-panel-icon.png','searchbar-device-fix.css']);
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
const liveSubscriberScopes = new Map();
const sharedSubscribers = new Set();
const sharedSubscriberScopes = new Map();
let dbPool = null;
let organizerAccounts = [];
const organizerAppStates = new Map();
const organizerLiveStates = new Map();

// Signed organizer and panel sessions. Credentials and the signing secret stay server-side.
const AUTH_USERNAME = String(process.env.ORGANIZER_USERNAME || '').trim();
const AUTH_PASSWORD = String(process.env.ORGANIZER_PASSWORD || '');
const PANEL_USERNAME = String(process.env.PANEL_USERNAME || 'admin').trim();
const PANEL_PASSWORD = String(process.env.PANEL_PASSWORD || '');
const SESSION_SECRET = String(process.env.SESSION_SECRET || '');
const AUTH_COOKIE = 'ppm_organizer_session';
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
function authIsConfigured() {
  return !!(SESSION_SECRET && ((PANEL_USERNAME && PANEL_PASSWORD) || organizerAccounts.some(a => a.active)));
}
function panelIsConfigured() { return !!(PANEL_USERNAME && PANEL_PASSWORD && SESSION_SECRET); }
function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function signSessionPayload(encodedPayload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(encodedPayload).digest('base64url');
}
function getCookieValue(req, name) {
  const raw = String(req.headers.cookie || '');
  for (const item of raw.split(';')) {
    const index = item.indexOf('=');
    if (index < 0) continue;
    if (item.slice(0, index).trim() === name) return item.slice(index + 1).trim();
  }
  return '';
}
function accountById(id) {
  return organizerAccounts.find(account => account && account.id === String(id || '') && account.active !== false) || null;
}
function accountByUsername(username) {
  const normalized = String(username || '').trim().toLocaleLowerCase();
  return organizerAccounts.find(account => account && String(account.username || '').trim().toLocaleLowerCase() === normalized) || null;
}
function getAuthSession(req) {
  if (!SESSION_SECRET) return null;
  const token = getCookieValue(req, AUTH_COOKIE);
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encodedPayload, suppliedSignature] = parts;
  const expectedSignature = signSessionPayload(encodedPayload);
  if (!safeEqual(suppliedSignature, expectedSignature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (!payload || Number(payload.exp) <= Date.now()) return null;
    if (payload.role === 'panel') {
      if (panelIsConfigured() && payload.u === PANEL_USERNAME) return {role:'panel', username:PANEL_USERNAME, organizerId:null, exp:Number(payload.exp)};
      return null;
    }
    const account = payload.role === 'organizer' && payload.id ? accountById(payload.id) : (payload.role ? null : accountByUsername(payload.u));
    // A token from the previous single-organizer build remains valid until it expires,
    // provided the matching legacy account still exists and is active.
    if (account && String(payload.u || '').toLocaleLowerCase() === String(account.username).toLocaleLowerCase()) {
      return {role:'organizer', username:account.username, organizerId:account.id, exp:Number(payload.exp)};
    }
    return null;
  } catch (_) { return null; }
}
function isAuthenticated(req) { return getAuthSession(req)?.role === 'organizer'; }
function isPanelAuthenticated(req) { return getAuthSession(req)?.role === 'panel'; }
function makeSessionToken(username, role = 'organizer', organizerId = null) {
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({
    u: username,
    role,
    ...(organizerId ? {id:organizerId} : {}),
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS * 1000,
    nonce: crypto.randomBytes(16).toString('hex')
  })).toString('base64url');
  return `${payload}.${signSessionPayload(payload)}`;
}
function cookieOptions(req, maxAge) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const secure = process.env.NODE_ENV === 'production' || forwardedProto === 'https';
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
function setRedirect(res, location) {
  res.writeHead(302, {'Location':location,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end();
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}
function verifyPassword(password, storedHash) {
  const [scheme, salt, expectedHex] = String(storedHash || '').split('$');
  if (scheme !== 'scrypt' || !salt || !expectedHex) return false;
  try {
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = crypto.scryptSync(String(password), salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (_) { return false; }
}
function safeOrganizerLogo(value) {
  return typeof value === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(value.trim()) ? value.trim() : null;
}
function organizerLogoFor(account) {
  return safeOrganizerLogo(account?.profileImage) || safeOrganizerLogo(account?.organizerLogo) || safeOrganizerLogo(account?.logoData) || safeOrganizerLogo(account?.logo);
}
function organizerPublicRecord(account) {
  return {id:account.id,username:account.username,displayName:account.displayName || account.username,profileImage:organizerLogoFor(account),active:account.active !== false,createdAt:account.createdAt || null,lastLoginAt:account.lastLoginAt || null,createdBy:account.createdBy || 'registration'};
}
function makeOrganizerRecord(username, password, displayName, createdBy = 'registration') {
  const now = new Date().toISOString();
  return {id:crypto.randomUUID(),username,displayName:displayName || username,profileImage:null,passwordHash:hashPassword(password),active:true,createdAt:now,lastLoginAt:null,createdBy};
}
function getDefaultOrganizer() {
  return organizerAccounts.find(account => account && account.active !== false) || null;
}
function resolveOrganizerId(req, url, body = null, allowDefault = false) {
  const auth = getAuthSession(req);
  if (auth?.role === 'organizer') return auth.organizerId;
  const requested = String(url?.searchParams?.get('organizer') || body?.organizerId || '').trim();
  if (requested) return accountById(requested)?.id || null;
  if (allowDefault) return getDefaultOrganizer()?.id || null;
  return null;
}
function defaultAppEntry() { return {revision:0,updatedAt:null,clientId:null,state:null}; }
function getOrganizerAppEntry(id) { return id ? (organizerAppStates.get(id) || defaultAppEntry()) : {revision:sharedAppRevision,updatedAt:sharedAppUpdatedAt,clientId:sharedAppClientId,state:sharedAppState}; }
function getOrganizerLiveState(id) { return id ? (organizerLiveStates.get(id) || null) : latestState; }
function organizerDataPath(prefix, id) { return path.join(DATA_DIR, `${prefix}-${String(id).replace(/[^a-zA-Z0-9_-]/g, '')}.json`); }
async function saveOrganizerAppState(id, entry) {
  organizerAppStates.set(id, entry);
  await saveStoredBatch([{key:`app-state:${id}`,filePath:organizerDataPath('app-state',id),value:entry}]);
}
async function saveOrganizerLiveState(id, snapshot) {
  organizerLiveStates.set(id, snapshot);
  await saveStoredBatch([{key:`live-state:${id}`,filePath:organizerDataPath('live-state',id),value:snapshot}]);
}
async function deleteStoredKey(key, filePath) {
  if (dbPool) await dbPool.query('DELETE FROM pickle_point_storage WHERE storage_key = $1', [key]);
  else { try { await fs.promises.unlink(filePath); } catch (_) {} }
}
// Use PostgreSQL when DATABASE_URL is configured (Render), while keeping the
// original JSON-file storage for local development and offline testing.
async function initializeStorage() {
  if (!process.env.DATABASE_URL) return;
  const { Pool } = require('pg');
  dbPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
  dbPool.on('error', err => console.error('Unexpected PostgreSQL pool error:', err.message));
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS pickle_point_storage (
      storage_key TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await dbPool.query('SELECT 1');
  console.log('Persistent storage: PostgreSQL');
}

async function saveStoredBatch(entries) {
  if (dbPool) {
    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');
      for (const entry of entries) {
        await client.query(
          `INSERT INTO pickle_point_storage (storage_key, payload, updated_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (storage_key) DO UPDATE
           SET payload = EXCLUDED.payload, updated_at = NOW()`,
          [entry.key, JSON.stringify(entry.value)]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw err;
    } finally {
      client.release();
    }
    return;
  }

  await fs.promises.mkdir(DATA_DIR, {recursive:true});
  await Promise.all(entries.map(entry =>
    fs.promises.writeFile(entry.filePath, JSON.stringify(entry.value), 'utf8')
  ));
}

async function loadStored(key, filePath) {
  if (dbPool) {
    const result = await dbPool.query(
      'SELECT payload FROM pickle_point_storage WHERE storage_key = $1', [key]
    );
    if (result.rows.length) return result.rows[0].payload;

    // One-time best-effort import from the old JSON file store, if those files
    // are still present on the instance during the first database-backed boot.
    let legacy;
    try {
      legacy = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
    } catch (_) {
      return null;
    }
    if (legacy !== null && typeof legacy === 'object') {
      await saveStoredBatch([{key, filePath, value:legacy}]);
      console.log(`Imported legacy JSON data into PostgreSQL: ${key}`);
      return legacy;
    }
    return null;
  }

  try {
    const saved = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
    return saved && typeof saved === 'object' ? saved : null;
  } catch (_) {
    return null;
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(data));
}
function normalizePlayerName(value) {
  return String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}
function createDefaultSharedAppState() {
  return {schemaVersion:12,players:[],left:[],queue:[],lockedPartners:[],courts:[],logs:[],nextPlayer:1,nextCourt:1,nextWaitingCourt:1,nextLog:1,sessionMetrics:{cloudCheckins:0,newRegistered:0},sessionActive:false,sessionEndedAt:null,sessionName:'Open Play',duprMatch:false,recordScores:false,liveRankingEnabled:false,liveMatchesEnabled:false,eventRules:{target:11,winBy:1,type:'Doubles'},matchingMode:'balanced',winnersLosersNextGroup:'winners'};
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
function broadcast(snapshot = latestState, organizerId = null) {
  if (!snapshot) return;
  const packet = `event: live-state\ndata: ${JSON.stringify(snapshot)}\n\n`;
  for (const res of subscribers) {
    if ((liveSubscriberScopes.get(res) || null) !== (organizerId || null)) continue;
    try { res.write(packet); } catch (_) { subscribers.delete(res); liveSubscriberScopes.delete(res); }
  }
}
function broadcastNamedEvent(eventName, payload, organizerId = null) {
  const packet = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sharedSubscribers) {
    if (eventName === 'app-state' && (sharedSubscriberScopes.get(res) || null) !== (organizerId || null)) continue;
    try { res.write(packet); } catch (_) { sharedSubscribers.delete(res); sharedSubscriberScopes.delete(res); }
  }
}
function broadcastTheme() {
  const packet = `event: live-theme\ndata: ${liveTheme}\n\n`;
  for (const res of subscribers) { try { res.write(packet); } catch (_) { subscribers.delete(res); liveSubscriberScopes.delete(res); } }
}
async function persistState(snapshot) {
  latestState = snapshot;
  await saveStoredBatch([{key:'live-state', filePath:DATA_FILE, value:snapshot}]);
  broadcast(snapshot, null);
}

// Project the authoritative shared queue into the public Live View snapshot.
// This means phone registrations appear immediately even when the organizer tab
// is temporarily asleep or the live queue client has not yet consumed its event.
function buildLiveQueueSnapshot(appState, updatedAt = new Date().toISOString(), previousState = latestState) {
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

  const previous = previousState && typeof previousState === 'object' ? previousState : {};
  return {
    ...previous,
    sessionName: String(appState?.sessionName || previous.sessionName || 'Open Play'),
    active: !!appState?.sessionActive,
    recordScores: appState?.recordScores === true,
    liveRankingEnabled: typeof appState?.liveRankingEnabled === 'boolean' ? appState.liveRankingEnabled : previous.liveRankingEnabled !== false,
    liveMatchesEnabled: typeof appState?.liveMatchesEnabled === 'boolean' ? appState.liveMatchesEnabled : previous.liveMatchesEnabled !== false,
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

  if (url.pathname === '/api/auth-status' && req.method === 'GET') {
    const auth = getAuthSession(req);
    return sendJson(res, 200, {
      ok:true,
      configured:authIsConfigured(),
      panelConfigured:panelIsConfigured(),
      authenticated:!!auth,
      role:auth?.role || null,
      username:auth?.username || null,
      organizerId:auth?.organizerId || null
    });
  }

  if (url.pathname === '/api/organizers/public' && req.method === 'GET') {
    // This endpoint intentionally exposes only what the public sign-in picker needs.
    // Never include password hashes, login timestamps, or admin-only account metadata.
    const organizers = organizerAccounts
      .filter(account => account && account.active !== false && account.username)
      .map(account => ({
        id: String(account.id),
        username: String(account.username),
        displayName: String(account.displayName || account.username),
        profileImage: organizerLogoFor(account)
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, {sensitivity:'base'}));
    const panelAccount = panelIsConfigured()
      ? {username:PANEL_USERNAME,displayName:'Panel Administrator',profileImage:null}
      : null;
    return sendJson(res, 200, {ok:true,organizers,panelAccount});
  }

  if (url.pathname === '/api/login' && req.method === 'POST') {
    if (!SESSION_SECRET || (!panelIsConfigured() && !organizerAccounts.some(account => account.active !== false))) {
      return sendJson(res, 503, {ok:false,error:'Login is not configured yet. Configure PANEL_USERNAME, PANEL_PASSWORD, SESSION_SECRET, or register an organizer after setup.'});
    }
    // Login attempts are not counted or locked out. A failed sign-in returns a normal
    // 401 response, and users can correct credentials and retry immediately.
    try {
      const body = await readBody(req, 16 * 1024);
      const username = String(body?.username || '').trim();
      const password = String(body?.password || '');
      let role = null;
      let account = null;
      if (panelIsConfigured() && safeEqual(username, PANEL_USERNAME) && safeEqual(password, PANEL_PASSWORD)) {
        role = 'panel';
      } else {
        account = accountByUsername(username);
        if (account && account.active !== false && verifyPassword(password, account.passwordHash)) role = 'organizer';
      }
      if (!role) {
        return sendJson(res, 401, {ok:false,error:'Incorrect username or password, or this account is inactive.'});
      }
      if (role === 'organizer') {
        account.lastLoginAt = new Date().toISOString();
        await saveStoredBatch([{key:'organizer-accounts',filePath:ORGANIZERS_FILE,value:organizerAccounts}]);
      }
      const authUsername = role === 'panel' ? PANEL_USERNAME : account.username;
      const authId = role === 'organizer' ? account.id : null;
      res.writeHead(200, {
        'Content-Type':'application/json; charset=utf-8',
        'Cache-Control':'no-store',
        'Set-Cookie':`${AUTH_COOKIE}=${makeSessionToken(authUsername,role,authId)}; ${cookieOptions(req, SESSION_MAX_AGE_SECONDS)}`,
        'X-Content-Type-Options':'nosniff'
      });
      return res.end(JSON.stringify({ok:true,role,username:authUsername,organizerId:authId,expiresIn:SESSION_MAX_AGE_SECONDS}));
    } catch (err) {
      const statusCode = err.statusCode || 503;
      const errorText = err.statusCode === 413
        ? 'Login request is too large.'
        : err.statusCode === 400
          ? 'Invalid login request. Please check the submitted fields and try again.'
          : 'The login service could not access account storage. Please try again shortly.';
      if (!err.statusCode) console.error('Unable to complete login request:', err.message);
      return sendJson(res, statusCode, {ok:false,error:errorText});
    }
  }

  if (url.pathname === '/api/register-organizer' && req.method === 'POST') {
    if (!SESSION_SECRET) return sendJson(res, 503, {ok:false,error:'Organizer registration is not configured. Set SESSION_SECRET on the server and redeploy.'});
    // Public organizer registration intentionally has no application-level attempt lockout.
    // Logos are compressed in the browser; the larger body allowance also accommodates cached clients.
    try {
      const body = await readBody(req, 16 * 1024 * 1024);
      const username = String(body?.username || '').trim();
      const displayName = String(body?.displayName || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      const password = String(body?.password || '');
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,39}$/.test(username)) return sendJson(res, 400, {ok:false,error:'Username must be 3–40 characters and use letters, numbers, dot, underscore, or hyphen.'});
      if (password.length < 8 || password.length > 200) return sendJson(res, 400, {ok:false,error:'Password must be at least 8 characters long.'});
      if (!displayName) return sendJson(res, 400, {ok:false,error:'Enter the organizer or venue name.'});
      if (username.toLocaleLowerCase() === PANEL_USERNAME.toLocaleLowerCase() || (AUTH_USERNAME && username.toLocaleLowerCase() === AUTH_USERNAME.toLocaleLowerCase()) || accountByUsername(username)) {
        return sendJson(res, 409, {ok:false,error:'That username is already in use.'});
      }
      const profileImage = String(body?.profileImage || '').trim();
      if (profileImage && (profileImage.length > 12_000_000 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(profileImage))) {
        return sendJson(res, 400, {ok:false,error:'Please choose a valid PNG, JPG, or WebP logo. Large logos are compressed automatically before saving.'});
      }
      const account = makeOrganizerRecord(username,password,displayName,'self-registration');
      account.profileImage = profileImage || null;
      organizerAccounts.push(account);
      await saveStoredBatch([{key:'organizer-accounts',filePath:ORGANIZERS_FILE,value:organizerAccounts}]);
      res.writeHead(201, {
        'Content-Type':'application/json; charset=utf-8',
        'Cache-Control':'no-store',
        'Set-Cookie':`${AUTH_COOKIE}=${makeSessionToken(account.username,'organizer',account.id)}; ${cookieOptions(req, SESSION_MAX_AGE_SECONDS)}`,
        'X-Content-Type-Options':'nosniff'
      });
      return res.end(JSON.stringify({ok:true,role:'organizer',username:account.username,organizerId:account.id}));
    } catch (err) {
      const statusCode = err.statusCode || 503;
      const errorText = err.statusCode === 413
        ? 'This registration request is still too large. Refresh the page so logo compression can update, then try again.'
        : err.statusCode === 400
          ? 'Invalid registration request. Please check the required fields.'
          : 'Unable to save the organizer account. Check the database connection and try again.';
      if (!err.statusCode) console.error('Unable to register organizer:', err.message);
      return sendJson(res, statusCode, {ok:false,error:errorText});
    }
  }

  if (url.pathname === '/api/panel/organizers' && req.method === 'GET') {
    if (!isPanelAuthenticated(req)) return sendJson(res, 401, {ok:false,error:'Panel administrator login required.'});
    return sendJson(res, 200, {ok:true,organizers:organizerAccounts.map(organizerPublicRecord)});
  }
  if (url.pathname === '/api/panel/organizers' && req.method === 'POST') {
    if (!isPanelAuthenticated(req)) return sendJson(res, 401, {ok:false,error:'Panel administrator login required.'});
    try {
      const body = await readBody(req, 16 * 1024);
      const username = String(body?.username || '').trim();
      const displayName = String(body?.displayName || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      const password = String(body?.password || '');
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,39}$/.test(username)) return sendJson(res, 400, {ok:false,error:'Username must be 3–40 characters and use letters, numbers, dot, underscore, or hyphen.'});
      if (password.length < 8 || password.length > 200) return sendJson(res, 400, {ok:false,error:'Password must be at least 8 characters long.'});
      if (!displayName) return sendJson(res, 400, {ok:false,error:'Enter an organizer or venue name.'});
      if (username.toLocaleLowerCase() === PANEL_USERNAME.toLocaleLowerCase() || accountByUsername(username)) return sendJson(res, 409, {ok:false,error:'That username is already in use.'});
      const account = makeOrganizerRecord(username,password,displayName,'panel');
      organizerAccounts.push(account);
      await saveStoredBatch([{key:'organizer-accounts',filePath:ORGANIZERS_FILE,value:organizerAccounts}]);
      return sendJson(res, 201, {ok:true,organizer:organizerPublicRecord(account)});
    } catch (err) { return sendJson(res, err.statusCode || 400, {ok:false,error:err.statusCode === 413 ? 'Payload too large' : 'Unable to create organizer account.'}); }
  }
  const organizerAdminMatch = url.pathname.match(/^\/api\/panel\/organizers\/([a-f0-9-]{20,})$/i);
  if (organizerAdminMatch && req.method === 'PATCH') {
    if (!isPanelAuthenticated(req)) return sendJson(res, 401, {ok:false,error:'Panel administrator login required.'});
    try {
      const body = await readBody(req, 4 * 1024 * 1024);
      const account = organizerAccounts.find(item => item.id === organizerAdminMatch[1]);
      if (!account) return sendJson(res, 404, {ok:false,error:'Organizer account not found.'});
      if (body.displayName !== undefined) {
        const displayName = String(body.displayName || '').trim().replace(/\s+/g, ' ').slice(0, 80);
        if (!displayName) return sendJson(res, 400, {ok:false,error:'Display name cannot be blank.'});
        account.displayName = displayName;
      }
      if (body.username !== undefined) {
        const username = String(body.username || '').trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,39}$/.test(username)) return sendJson(res, 400, {ok:false,error:'Username must be 3–40 characters and use letters, numbers, dot, underscore, or hyphen.'});
        const collision = accountByUsername(username);
        if (username.toLocaleLowerCase() === PANEL_USERNAME.toLocaleLowerCase() || (AUTH_USERNAME && username.toLocaleLowerCase() === AUTH_USERNAME.toLocaleLowerCase()) || (collision && collision.id !== account.id)) {
          return sendJson(res, 409, {ok:false,error:'That username is already in use.'});
        }
        account.username = username;
      }
      if (body.active !== undefined) account.active = !!body.active;
      if (body.password !== undefined && String(body.password)) {
        const password = String(body.password);
        if (password.length < 8 || password.length > 200) return sendJson(res, 400, {ok:false,error:'New password must be at least 8 characters long.'});
        account.passwordHash = hashPassword(password);
      }
      if (body.profileImage !== undefined) {
        const profileImage = String(body.profileImage || '').trim();
        if (profileImage && (profileImage.length > 2500000 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(profileImage))) {
          return sendJson(res, 400, {ok:false,error:'Profile photo must be a valid image under 2 MB after processing.'});
        }
        account.profileImage = profileImage || null;
      }
      await saveStoredBatch([{key:'organizer-accounts',filePath:ORGANIZERS_FILE,value:organizerAccounts}]);
      return sendJson(res, 200, {ok:true,organizer:organizerPublicRecord(account)});
    } catch (err) { return sendJson(res, err.statusCode || 400, {ok:false,error:err.statusCode === 413 ? 'Payload too large' : 'Unable to update organizer account.'}); }
  }
  if (organizerAdminMatch && req.method === 'DELETE') {
    if (!isPanelAuthenticated(req)) return sendJson(res, 401, {ok:false,error:'Panel administrator login required.'});
    const index = organizerAccounts.findIndex(item => item.id === organizerAdminMatch[1]);
    if (index < 0) return sendJson(res, 404, {ok:false,error:'Organizer account not found.'});
    const [account] = organizerAccounts.splice(index,1);
    await saveStoredBatch([{key:'organizer-accounts',filePath:ORGANIZERS_FILE,value:organizerAccounts}]);
    organizerAppStates.delete(account.id);
    organizerLiveStates.delete(account.id);
    await deleteStoredKey(`app-state:${account.id}`,organizerDataPath('app-state',account.id));
    await deleteStoredKey(`live-state:${account.id}`,organizerDataPath('live-state',account.id));
    return sendJson(res, 200, {ok:true,deletedId:account.id});
  }

  if (url.pathname === '/api/logout' && req.method === 'POST') {
    res.writeHead(200, {
      'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'no-store',
      'Set-Cookie':`${AUTH_COOKIE}=; ${cookieOptions(req, 0)}`,
      'X-Content-Type-Options':'nosniff'
    });
    return res.end(JSON.stringify({ok:true}));
  }

  // Keep public player registration and public Live View reads available, while
  // requiring organizer auth for the app's write APIs.
  if (req.method === 'POST' && ['/api/app-state','/api/cloud-records','/api/live-state','/api/live-theme'].includes(url.pathname) && !isAuthenticated(req)) {
    return sendJson(res, 401, {ok:false,error:'Organizer login required.'});
  }

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
  if (url.pathname === '/api/health' && req.method === 'GET') return sendJson(res, 200, {
    ok:true,
    service:'Pickle Point Match Live View',
    storage:dbPool ? 'postgresql' : 'json-file'
  });
  if (url.pathname === '/api/live-theme' && req.method === 'GET') return sendJson(res, 200, {ok:true,theme:liveTheme});

  // The app state is scoped to the signed-in organizer. Public registration and
  // public Live View may read a specific organizer using its shared organizer id.
  if (url.pathname === '/api/app-state' && req.method === 'GET') {
    const requestedScope = String(url.searchParams.get('organizer') || '').trim();
    const organizerId = resolveOrganizerId(req,url,null,true);
    if (requestedScope && !organizerId) return sendJson(res,404,{ok:false,error:'Organizer account was not found or is inactive.'});
    if (organizerId) {
      const entry = getOrganizerAppEntry(organizerId);
      return sendJson(res, 200, {ok:true,revision:entry.revision,state:entry.state,updatedAt:entry.updatedAt,organizerId});
    }
    return sendJson(res, 200, {ok:true,revision:sharedAppRevision,state:sharedAppState,updatedAt:sharedAppUpdatedAt});
  }
  if (url.pathname === '/api/app-state' && req.method === 'POST') {
    try {
      const auth = getAuthSession(req);
      if (auth?.role !== 'organizer') return sendJson(res, 401, {ok:false,error:'Organizer login required.'});
      const organizerId = auth.organizerId;
      const body = await readBody(req, 8 * 1024 * 1024);
      const incoming = body && body.state;
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming) ||
          !Array.isArray(incoming.players) || !Array.isArray(incoming.left) ||
          !Array.isArray(incoming.queue) || !Array.isArray(incoming.courts) || !Array.isArray(incoming.logs)) {
        return sendJson(res, 400, {ok:false,error:'Invalid shared application state'});
      }
      const currentEntry = getOrganizerAppEntry(organizerId);
      if (body.onlyIfEmpty && currentEntry.state) {
        return sendJson(res, 200, {ok:true,accepted:false,unchanged:true,revision:currentEntry.revision,state:currentEntry.state,updatedAt:currentEntry.updatedAt});
      }
      if (!body.onlyIfEmpty && Number.isFinite(Number(body.baseRevision)) && Number(body.baseRevision) !== currentEntry.revision) {
        return sendJson(res, 409, {ok:false,conflict:true,error:'Queue state changed on another device',revision:currentEntry.revision,state:currentEntry.state,updatedAt:currentEntry.updatedAt});
      }
      const snapshot = JSON.parse(JSON.stringify(incoming));
      let entry = currentEntry;
      if (JSON.stringify(currentEntry.state) !== JSON.stringify(snapshot)) {
        entry = {revision:currentEntry.revision+1,updatedAt:new Date().toISOString(),clientId:String(body.clientId||'').slice(0,100)||null,state:snapshot};
        await saveOrganizerAppState(organizerId,entry);
        broadcastNamedEvent('app-state',{revision:entry.revision,updatedAt:entry.updatedAt,clientId:entry.clientId,state:entry.state,organizerId},organizerId);
      }
      return sendJson(res, 200, {ok:true,accepted:true,revision:entry.revision,updatedAt:entry.updatedAt,unchanged:JSON.stringify(entry.state)===JSON.stringify(snapshot)});
    } catch (err) { return sendJson(res, err.statusCode || 500, {ok:false,error:err.statusCode===413?'Payload too large':err.message||'Unable to save organizer queue state'}); }
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
        await saveStoredBatch([{key:'cloud-records', filePath:CLOUD_RECORDS_FILE, value:{revision:sharedCloudRevision,updatedAt:sharedCloudUpdatedAt,clientId:sharedCloudClientId,records:sharedCloudRecords}}]);
        broadcastNamedEvent('cloud-records', {revision:sharedCloudRevision,updatedAt:sharedCloudUpdatedAt,clientId:sharedCloudClientId,records:sharedCloudRecords});
      }
      return sendJson(res, 200, {ok:true,accepted:true,revision:sharedCloudRevision,updatedAt:sharedCloudUpdatedAt,unchanged:JSON.stringify(sharedCloudRecords)===JSON.stringify(records)});
    } catch (err) { return sendJson(res, err.statusCode || 500, {ok:false,error:err.statusCode===413?'Payload too large':err.message||'Unable to save Registered Player Cloud records'}); }
  }
  // Register a player into one organizer's queue, while keeping the Registered
  // Player Cloud global so every organizer sees the same player library.
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

      const requestedScope = String(url.searchParams.get('organizer') || body?.organizerId || '').trim();
      const organizerId = resolveOrganizerId(req,url,body,true);
      if (requestedScope && !organizerId) return sendJson(res, 400, {ok:false,error:'Organizer link is invalid or inactive. Ask the organizer for an updated registration link.'});
      const currentRecords = sharedCloudRecords || {players:[],logs:[],sessions:[]};
      const duplicate = (Array.isArray(currentRecords.players) ? currentRecords.players : []).find(p => normalizePlayerName(p?.name) === normalizePlayerName(name));
      if (duplicate) return sendJson(res, 409, {ok:false,duplicate:true,error:'This user is already registered in Registered Player Cloud',player:{name:duplicate.name}});

      const records = JSON.parse(JSON.stringify(currentRecords));
      records.players = Array.isArray(records.players) ? records.players : [];
      records.logs = Array.isArray(records.logs) ? records.logs : [];
      records.sessions = Array.isArray(records.sessions) ? records.sessions : [];
      const entry = organizerId ? getOrganizerAppEntry(organizerId) : getOrganizerAppEntry(null);
      const appState = JSON.parse(JSON.stringify(entry.state || createDefaultSharedAppState()));
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
      if (organizerId) {
        const nextEntry = {revision:(Number(entry.revision)||0)+1,updatedAt,clientId:'registration-page',state:appState};
        await saveOrganizerAppState(organizerId,nextEntry);
        broadcastNamedEvent('app-state',{revision:nextEntry.revision,updatedAt,clientId:'registration-page',state:appState,organizerId},organizerId);
      } else {
        sharedAppState = appState;
        sharedAppRevision += 1;
        sharedAppUpdatedAt = updatedAt;
        sharedAppClientId = 'registration-page';
      }
      sharedCloudRecords = records;
      sharedCloudRevision += 1;
      sharedCloudUpdatedAt = updatedAt;
      sharedCloudClientId = 'registration-page';
      const liveSnapshot = buildLiveQueueSnapshot(appState, updatedAt, getOrganizerLiveState(organizerId));
      if (organizerId) {
        await saveOrganizerLiveState(organizerId,liveSnapshot);
        broadcast(liveSnapshot,organizerId);
      } else {
        latestState = liveSnapshot;
        await saveStoredBatch([{key:'app-state',filePath:APP_STATE_FILE,value:{revision:sharedAppRevision,updatedAt:sharedAppUpdatedAt,clientId:sharedAppClientId,state:sharedAppState}}]);
        await saveStoredBatch([{key:'live-state',filePath:DATA_FILE,value:liveSnapshot}]);
        broadcast(liveSnapshot,null);
        broadcastNamedEvent('app-state',{revision:sharedAppRevision,updatedAt:sharedAppUpdatedAt,clientId:sharedAppClientId,state:sharedAppState},null);
      }
      await saveStoredBatch([{key:'cloud-records',filePath:CLOUD_RECORDS_FILE,value:{revision:sharedCloudRevision,updatedAt:sharedCloudUpdatedAt,clientId:sharedCloudClientId,records:sharedCloudRecords}}]);
      broadcastNamedEvent('cloud-records',{revision:sharedCloudRevision,updatedAt:sharedCloudUpdatedAt,clientId:sharedCloudClientId,records:sharedCloudRecords});
      return sendJson(res, 200, {ok:true,player:cloudPlayer,queued:!playingOnCourt,queueCount:appState.queue.length,cloudCount:sharedCloudRecords.players.length,appRevision:organizerId?getOrganizerAppEntry(organizerId).revision:sharedAppRevision,cloudRevision:sharedCloudRevision,liveViewUpdated:true,organizerId});
    } catch (err) {
      return sendJson(res, err.statusCode || 500, {ok:false,error:err.statusCode===413?'Payload too large':err.message||'Unable to register player'});
    }
  }

  if (url.pathname === '/api/live-theme' && req.method === 'POST') {
    try {
      const body = await readBody(req, 4096);
      if (!body || (body.theme !== 'light' && body.theme !== 'night')) return sendJson(res, 400, {ok:false,error:'Invalid Live View theme'});
      liveTheme = body.theme;
      await saveStoredBatch([{key:'live-theme', filePath:THEME_FILE, value:{theme:liveTheme,updatedAt:new Date().toISOString()}}]);
      broadcastTheme();
      return sendJson(res, 200, {ok:true,theme:liveTheme});
    } catch (err) { return sendJson(res, 500, {ok:false,error:'Unable to save Live View theme'}); }
  }
  if (url.pathname === '/api/live-state' && req.method === 'GET') {
    const requestedScope = String(url.searchParams.get('organizer') || '').trim();
    const organizerId = resolveOrganizerId(req,url,null,true);
    if (requestedScope && !organizerId) return sendJson(res,404,{ok:false,error:'Organizer account was not found or is inactive.'});
    return sendJson(res, 200, {ok:true,state:getOrganizerLiveState(organizerId),organizerId});
  }
  if (url.pathname === '/api/live-state' && req.method === 'POST') {
    try {
      const auth = getAuthSession(req);
      if (auth?.role !== 'organizer') return sendJson(res, 401, {ok:false,error:'Organizer login required.'});
      const organizerId = auth.organizerId;
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

      // Heartbeats and the public Live View snapshot are isolated per organizer.
      const previousState = getOrganizerLiveState(organizerId);
      if (previousState) {
        const previousComparable = {...previousState};
        const nextComparable = {...snapshot};
        delete previousComparable.updatedAt;
        delete nextComparable.updatedAt;
        if (JSON.stringify(previousComparable) === JSON.stringify(nextComparable)) {
          snapshot.updatedAt = snapshot.updatedAt || new Date().toISOString();
          if (organizerId) organizerLiveStates.set(organizerId,snapshot);
          else latestState = snapshot;
          return sendJson(res, 200, {ok:true,updatedAt:snapshot.updatedAt,unchanged:true});
        }
      }
      if (organizerId) {
        await saveOrganizerLiveState(organizerId,snapshot);
        broadcast(snapshot,organizerId);
      } else {
        await persistState(snapshot);
      }
      return sendJson(res, 200, {ok:true,updatedAt:snapshot.updatedAt,organizerId});
    } catch (err) { return sendJson(res, err.statusCode || 500, {ok:false,error:err.statusCode===413?'Payload too large':err.message||'Unable to save live state'}); }
  }
  if (url.pathname === '/api/shared-events' && req.method === 'GET') {
    const requestedScope = String(url.searchParams.get('organizer') || '').trim();
    const organizerId = resolveOrganizerId(req,url,null,true);
    if (requestedScope && !organizerId) return sendJson(res,404,{ok:false,error:'Organizer account was not found or is inactive.'});
    res.writeHead(200, {'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
    res.write('retry: 2000\n\n');
    const appEntry = organizerId ? getOrganizerAppEntry(organizerId) : getOrganizerAppEntry(null);
    if (appEntry.state) res.write(`event: app-state\ndata: ${JSON.stringify({...appEntry,organizerId})}\n\n`);
    if (sharedCloudRecords) res.write(`event: cloud-records\ndata: ${JSON.stringify({revision:sharedCloudRevision,updatedAt:sharedCloudUpdatedAt,clientId:sharedCloudClientId,records:sharedCloudRecords})}\n\n`);
    sharedSubscribers.add(res);
    sharedSubscriberScopes.set(res,organizerId || null);
    const heartbeat = setInterval(()=>{try{res.write(': keep-alive\n\n');}catch(_){cleanup();}},20000);
    const cleanup = () => { clearInterval(heartbeat); sharedSubscribers.delete(res); sharedSubscriberScopes.delete(res); };
    res.on('close', cleanup);
    res.on('error', cleanup);
    req.on('aborted', cleanup);
    return;
  }
  if (url.pathname === '/api/live-events' && req.method === 'GET') {
    const requestedScope = String(url.searchParams.get('organizer') || '').trim();
    const organizerId = resolveOrganizerId(req,url,null,true);
    if (requestedScope && !organizerId) return sendJson(res,404,{ok:false,error:'Organizer account was not found or is inactive.'});
    res.writeHead(200, {'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
    res.write('retry: 2000\n\n');
    const scopedState = getOrganizerLiveState(organizerId);
    if (scopedState) res.write(`event: live-state\ndata: ${JSON.stringify(scopedState)}\n\n`);
    res.write(`event: live-theme\ndata: ${liveTheme}\n\n`);
    subscribers.add(res);
    liveSubscriberScopes.set(res,organizerId || null);
    const heartbeat = setInterval(()=>{try{res.write(': keep-alive\n\n');}catch(_){cleanup();}},20000);
    const cleanup = () => { clearInterval(heartbeat); subscribers.delete(res); liveSubscriberScopes.delete(res); };
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
  const auth = getAuthSession(req);
  if (name === 'index.html' && auth?.role === 'organizer') return setRedirect(res, '/session.html');
  if (name === 'index.html' && auth?.role === 'panel') return setRedirect(res, '/panel.html');
  if (name === 'panel.html' && !isPanelAuthenticated(req)) {
    if (auth?.role === 'organizer') return setRedirect(res, '/session.html');
    return setRedirect(res, '/index.html');
  }
  if ((name === 'session.html' || name === 'queueing.html') && auth?.role !== 'organizer') {
    const next = `${name}${url.search || ''}`;
    return setRedirect(res, `/index.html?next=${encodeURIComponent(next)}`);
  }
  const filePath = path.join(ROOT,name);
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) return sendJson(res,404,{ok:false,error:'Not found'});
    const extension=path.extname(filePath).toLowerCase();
    const mutableAsset=['.html','.js','.css'].includes(extension);
    const noStorePage = ['index.html','panel.html','session.html','queueing.html'].includes(name);
    const cacheControl = noStorePage ? 'private, no-store, max-age=0' : (mutableAsset ? 'no-cache, must-revalidate' : 'public, max-age=300');
    res.writeHead(200, {'Content-Type':MIME[extension]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':cacheControl,'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});
    if(req.method==='HEAD')return res.end();
    fs.createReadStream(filePath).pipe(res);
  } catch (_) { return sendJson(res,404,{ok:false,error:'Not found'}); }
}

(async()=>{
  try {
    await initializeStorage();

    const savedAccounts = await loadStored('organizer-accounts', ORGANIZERS_FILE);
    organizerAccounts = Array.isArray(savedAccounts) ? savedAccounts.filter(account => account && typeof account === 'object' && account.id && account.username && account.passwordHash) : [];
    let accountsChanged = !Array.isArray(savedAccounts);
    if (AUTH_USERNAME && AUTH_PASSWORD && !accountByUsername(AUTH_USERNAME)) {
      organizerAccounts.push(makeOrganizerRecord(AUTH_USERNAME,AUTH_PASSWORD,AUTH_USERNAME,'legacy-environment'));
      accountsChanged = true;
    }
    if (accountsChanged) await saveStoredBatch([{key:'organizer-accounts',filePath:ORGANIZERS_FILE,value:organizerAccounts}]);

    latestState = await loadStored('live-state', DATA_FILE);
    const savedTheme = await loadStored('live-theme', THEME_FILE);
    if (savedTheme && (savedTheme.theme === 'light' || savedTheme.theme === 'night')) liveTheme = savedTheme.theme;

    const savedApp = await loadStored('app-state', APP_STATE_FILE);
    if (savedApp && savedApp.state && typeof savedApp.state === 'object') {
      sharedAppState = savedApp.state;
      if (typeof sharedAppState.liveRankingEnabled !== 'boolean') sharedAppState.liveRankingEnabled = latestState?.liveRankingEnabled !== false;
      if (typeof sharedAppState.liveMatchesEnabled !== 'boolean') sharedAppState.liveMatchesEnabled = latestState?.liveMatchesEnabled !== false;
      sharedAppRevision = Math.max(0, Number(savedApp.revision) || 1);
      sharedAppUpdatedAt = savedApp.updatedAt || null;
      sharedAppClientId = savedApp.clientId || null;
    }

    for (const account of organizerAccounts) {
      const orgApp = await loadStored(`app-state:${account.id}`,organizerDataPath('app-state',account.id));
      if (orgApp && typeof orgApp === 'object' && orgApp.state && typeof orgApp.state === 'object') organizerAppStates.set(account.id,orgApp);
      const orgLive = await loadStored(`live-state:${account.id}`,organizerDataPath('live-state',account.id));
      if (orgLive && typeof orgLive === 'object') organizerLiveStates.set(account.id,orgLive);
    }
    const migrationTarget = (AUTH_USERNAME && accountByUsername(AUTH_USERNAME)) || getDefaultOrganizer();
    if (migrationTarget && !organizerAppStates.has(migrationTarget.id) && savedApp?.state && typeof savedApp.state === 'object') {
      const migrated = {revision:Math.max(0,Number(savedApp.revision)||1),updatedAt:savedApp.updatedAt||new Date().toISOString(),clientId:savedApp.clientId||'legacy-migration',state:savedApp.state};
      organizerAppStates.set(migrationTarget.id,migrated);
      await saveOrganizerAppState(migrationTarget.id,migrated);
    }
    if (migrationTarget && !organizerLiveStates.has(migrationTarget.id) && latestState && typeof latestState === 'object') {
      organizerLiveStates.set(migrationTarget.id,latestState);
      await saveOrganizerLiveState(migrationTarget.id,latestState);
    }

    const savedCloud = await loadStored('cloud-records', CLOUD_RECORDS_FILE);
    if (savedCloud && savedCloud.records && typeof savedCloud.records === 'object') {
      sharedCloudRecords = savedCloud.records;
      sharedCloudRevision = Math.max(0, Number(savedCloud.revision) || 1);
      sharedCloudUpdatedAt = savedCloud.updatedAt || null;
      sharedCloudClientId = savedCloud.clientId || null;
    }
  } catch (err) {
    console.error('Unable to initialize persistent storage:', err);
    process.exit(1);
  }
  const server=http.createServer((req,res)=>{handle(req,res).catch(err=>{console.error('Request error:',err);if(!res.headersSent)sendJson(res,500,{ok:false,error:'Internal server error'});else res.end();});});
  server.listen(PORT,HOST,()=>console.log(`Pickle Point Match running at http://localhost:${PORT}\nLive View: http://localhost:${PORT}/live.html\nFor another device on the same Wi-Fi, use this computer's local IP address.`));
  const shutdown=()=>{
    for(const res of subscribers){try{res.end();}catch(_){}}
    for(const res of sharedSubscribers){try{res.end();}catch(_){}}
    server.close(async()=>{
      if (dbPool) { try { await dbPool.end(); } catch (_) {} }
      process.exit(0);
    });
    setTimeout(()=>process.exit(0),1000).unref();
  };
  process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
})();
