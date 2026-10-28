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
const REGISTERED_PLAYERS_CSV_FILE = path.join(DATA_DIR, 'registered-players.csv');
const ORGANIZERS_FILE = path.join(DATA_DIR, 'organizer-accounts.json');
const CLUB_ID_SEQUENCE_FILE = path.join(DATA_DIR, 'club-id-sequence.json');
const PORT = Math.max(1, Number(process.env.PORT) || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8'};
const allowedFiles = new Set(['index.html','panel.html','panel.css','panel.js','session.html','login.css','login.js','auth-session.js','queueing.html','start-page.js','queueing-app-loader.js','style.css','script.js','pickleball-p-emblem.png','live-session-indicator.png','team-player-empty-icon.png','live.html','live-view.css','live-view.js','Registration.html','registration-app.js','registration-page.css','registration-page-panel-icon.png','searchbar-device-fix.css','network-skeleton.css','network-skeleton.js','network-validation.js']);
let latestState = null;
let sharedAppState = null;
let sharedAppRevision = 0;
let sharedAppUpdatedAt = null;
let sharedAppClientId = null;
let sharedCloudRecords = null;
let sharedCloudRevision = 0;
let sharedCloudUpdatedAt = null;
let sharedCloudClientId = null;
let sharedCloudPersistenceQueue = Promise.resolve();
let liveTheme = 'night';
const subscribers = new Set();
const liveSubscriberScopes = new Map();
const sharedSubscribers = new Set();
const sharedSubscriberScopes = new Map();
let dbPool = null;
let organizerAccounts = [];
let nextClubIdSequence = 1;
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
// Organizer approval was enabled at 2026-10-26 00:00 Asia/Manila (2026-10-25 16:00 UTC).
// This cutoff lets us safely migrate applications created by an older deployment while
// preserving organizer accounts that already existed before approval was introduced.
const ORGANIZER_APPROVAL_CUTOVER_MS = Date.parse('2026-10-25T16:00:00.000Z');
function organizerCreatedBy(account) {
  return String(account?.createdBy || 'registration').trim().toLowerCase();
}
function isAdminCreatedAccount(account) {
  const source = organizerCreatedBy(account);
  return source === 'panel' || source === 'legacy-environment';
}
function isLegacyPreApprovalAccount(account) {
  if (!account || isAdminCreatedAccount(account) || account.applicationSubmittedAt) return false;
  const createdAt = Date.parse(account.createdAt || '');
  return Number.isFinite(createdAt) && createdAt < ORGANIZER_APPROVAL_CUTOVER_MS;
}
function isRecentUnapprovedSelfRegistration(account) {
  if (!account || String(account.approvalStatus || '').trim().toLowerCase() === 'rejected') return false;
  if (isAdminCreatedAccount(account) || account.adminApproved === true) return false;
  const status = String(account.approvalStatus || '').trim().toLowerCase();
  // Keep legitimate approvals from the previous build, whose confirmation
  // action recorded approvedAt. Startup migration turns this into adminApproved.
  if (status === 'approved' && account.approvedAt) return false;
  // New application records remain pending regardless of active=true or a stale
  // default approvalStatus value written by an older deployment.
  if (account.applicationSubmittedAt) return true;
  const createdAt = Date.parse(account.createdAt || '');
  // Missing timestamps are ambiguous: fail closed and require admin approval.
  return !Number.isFinite(createdAt) || createdAt >= ORGANIZER_APPROVAL_CUTOVER_MS;
}
function effectiveApprovalStatus(account) {
  const status = String(account?.approvalStatus || '').trim().toLowerCase();
  if (status === 'rejected') return 'rejected';
  if (status === 'pending') return 'pending';
  if (isAdminCreatedAccount(account)) return 'approved';
  if (account?.adminApproved === true) return 'approved';
  // A timestamp created by the previous admin-confirmation endpoint is a valid
  // legacy confirmation. Startup migration persists it as adminApproved=true.
  if (status === 'approved' && account?.approvedAt) return 'approved';
  if (isLegacyPreApprovalAccount(account)) return 'approved';
  // Crucially, unknown/new self-registrations fail closed; they never become
  // approved merely because active=true or approvalStatus was omitted.
  if (isRecentUnapprovedSelfRegistration(account)) return 'pending';
  return 'pending';
}
function authIsConfigured() {
  return !!(SESSION_SECRET && ((PANEL_USERNAME && PANEL_PASSWORD) || organizerAccounts.some(a => a.active === true && effectiveApprovalStatus(a) === 'approved')));
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
  return organizerAccounts.find(account => account && account.id === String(id || '') && account.active === true && effectiveApprovalStatus(account) === 'approved') || null;
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
      return {role:'organizer', username:account.username, displayName:account.displayName || account.username, organizerId:account.id, exp:Number(payload.exp)};
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

// The login hash remains the source of truth for authentication. An encrypted
// copy is kept only so an authenticated panel administrator can view/reset the
// organizer password. Older hash-only accounts cannot be decrypted and must
// have their password reset once before it can be shown in the panel.
function organizerPasswordVaultKey() {
  if (!SESSION_SECRET) return null;
  return crypto.createHash('sha256').update(`pick-point-match:organizer-password-vault:v1:${SESSION_SECRET}`).digest();
}
function encryptOrganizerPassword(password) {
  const key = organizerPasswordVaultKey();
  if (!key) return null;
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(String(password), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
  } catch (_) { return null; }
}
function decryptOrganizerPassword(envelope) {
  const key = organizerPasswordVaultKey();
  if (!key || typeof envelope !== 'string') return null;
  const parts = envelope.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const ciphertext = Buffer.from(parts[3], 'base64url');
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (_) { return null; }
}
function normalizeOrganizerDuprId(value) {
  return String(value || '').trim().replace(/^DUPR\s*:\s*/i, '').replace(/\s+/g, '').toUpperCase();
}
function formatClubId(sequence) {
  return String(sequence).padStart(4, '0');
}
function numericClubId(value) {
  const text = String(value || '').trim();
  return /^\d{4,}$/.test(text) ? Number(text) : null;
}
function allocateClubId() {
  const used = new Set(organizerAccounts.map(account => String(account?.clubId || '').trim()).filter(Boolean));
  let sequence = Math.max(1, Number(nextClubIdSequence) || 1);
  let clubId = formatClubId(sequence);
  while (used.has(clubId)) {
    sequence += 1;
    clubId = formatClubId(sequence);
  }
  nextClubIdSequence = sequence + 1;
  return clubId;
}
function ensureOrganizerClubIds() {
  let changed = false;
  const seen = new Set();
  // Preserve the first occurrence of each valid generated ID; repair blanks,
  // malformed IDs, and duplicates without allowing admin edits to override IDs.
  for (const account of organizerAccounts) {
    const clubId = String(account?.clubId || '').trim();
    if (numericClubId(clubId) !== null && !seen.has(clubId)) {
      account.clubId = clubId;
      seen.add(clubId);
    } else {
      if (clubId) changed = true;
      account.clubId = null;
    }
  }
  const largest = [...seen].map(numericClubId).filter(Number.isSafeInteger).reduce((max, value) => Math.max(max, value), 0);
  nextClubIdSequence = Math.max(1, Number(nextClubIdSequence) || 1, largest + 1);
  for (const account of organizerAccounts) {
    if (account.clubId) continue;
    let clubId = formatClubId(nextClubIdSequence);
    while (seen.has(clubId)) {
      nextClubIdSequence += 1;
      clubId = formatClubId(nextClubIdSequence);
    }
    account.clubId = clubId;
    seen.add(clubId);
    nextClubIdSequence += 1;
    changed = true;
  }
  return changed;
}
function clubIdSequenceRecord() {
  return {next:Math.max(1, Number(nextClubIdSequence) || 1)};
}
function safeOrganizerLogo(value) {
  return typeof value === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(value.trim()) ? value.trim() : null;
}
function organizerLogoFor(account) {
  return safeOrganizerLogo(account?.profileImage) || safeOrganizerLogo(account?.organizerLogo) || safeOrganizerLogo(account?.logoData) || safeOrganizerLogo(account?.logo);
}
function organizerPublicRecord(account) {
  const approvalStatus = effectiveApprovalStatus(account);
  const active = account.active !== false && approvalStatus === 'approved';
  return {
    id:account.id,
    clubId:String(account.clubId || '').trim() || null,
    username:account.username,
    displayName:account.displayName || account.username,
    profileImage:organizerLogoFor(account),
    duprId:String(account.duprId || '').trim() || null,
    active,
    approvalStatus,
    adminApproved:account.adminApproved === true,
    createdAt:account.createdAt || null,
    applicationSubmittedAt:account.applicationSubmittedAt || null,
    approvedAt:account.approvedAt || null,
    lastLoginAt:account.lastLoginAt || null,
    createdBy:account.createdBy || 'registration'
  };
}
function organizerPanelRecord(account) {
  const passwordDisplay = decryptOrganizerPassword(account.passwordEncrypted);
  return {
    ...organizerPublicRecord(account),
    duprId:normalizeOrganizerDuprId(account.duprId || account.personalDuprId || account.duprID || account.dupr_id) || null,
    duprOrganizerId:String(account.duprOrganizerId || account.dupr_organizer_id || '').trim() || null,
    passwordDisplay,
    passwordAvailable:typeof passwordDisplay === 'string' && passwordDisplay.length > 0
  };
}
function makeOrganizerRecord(username, password, displayName, createdBy = 'registration') {
  const now = new Date().toISOString();
  const requiresApproval = !['panel','legacy-environment'].includes(String(createdBy || '').trim().toLowerCase());
  return {
    id:crypto.randomUUID(), clubId:allocateClubId(), username, displayName:displayName || username, profileImage:null,
    passwordHash:hashPassword(password), passwordEncrypted:encryptOrganizerPassword(password), active:!requiresApproval,
    approvalStatus:requiresApproval ? 'pending' : 'approved',
    adminApproved:!requiresApproval,
    ...(requiresApproval ? {applicationSubmittedAt:now} : {approvedAt:now, approvalConfirmedBy:'panel'}),
    createdAt:now, lastLoginAt:null, createdBy
  };
}
function getDefaultOrganizer() {
  return organizerAccounts.find(account => account && account.active === true && effectiveApprovalStatus(account) === 'approved') || null;
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

const REGISTERED_PLAYER_CSV_FIELDS = ['cloudId','name','nickname','gender','category','duprId','selfRating','matches','wins','losses'];
function isRemovedOpgField(key) {
  const normalized = String(key || '').replace(/[ _-]/g, '').toLowerCase();
  return normalized === 'opg' || normalized === 'opgid';
}
function withoutOpgFields(value) {
  if (Array.isArray(value)) return value.map(withoutOpgFields);
  if (!value || typeof value !== 'object') return value;
  const clean = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (isRemovedOpgField(key)) continue;
    clean[key] = withoutOpgFields(nestedValue);
  }
  return clean;
}
const REGISTERED_PLAYER_NUMBER_FIELDS = new Set(['cloudId','matches','wins','losses']);

function csvEscape(value) {
  let text;
  if (value === null || value === undefined) text = '';
  else if (typeof value === 'object') text = JSON.stringify(value);
  else text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsvRows(input) {
  const text = String(input || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field.length === 0) {
      quoted = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some(value => value !== '')) rows.push(row);
  }
  return rows;
}

function serializeRegisteredPlayersCsv(players) {
  const safePlayers = (Array.isArray(players) ? players : []).filter(player => player && typeof player === 'object' && !Array.isArray(player));
  const seen = new Set(REGISTERED_PLAYER_CSV_FIELDS);
  const extraFields = [];
  safePlayers.forEach(player => Object.keys(player).forEach(key => {
    if (isRemovedOpgField(key)) return;
    if (!seen.has(key)) { seen.add(key); extraFields.push(key); }
  }));
  const fields = [...REGISTERED_PLAYER_CSV_FIELDS, ...extraFields];
  const lines = [fields.map(csvEscape).join(',')];
  for (const player of safePlayers) {
    lines.push(fields.map(field => csvEscape(player[field])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

function parseRegisteredPlayersCsv(csvText) {
  if (typeof csvText !== 'string' || !csvText.trim()) return null;
  const rows = parseCsvRows(csvText);
  if (!rows.length) return null;
  const fields = rows.shift().map(field => String(field || '').trim());
  if (!fields.includes('name')) return null;
  return rows.map(row => {
    const player = {};
    fields.forEach((field, index) => {
      if (!field || isRemovedOpgField(field)) return;
      const value = row[index] === undefined ? '' : row[index];
      if (REGISTERED_PLAYER_NUMBER_FIELDS.has(field) && value.trim() !== '' && Number.isFinite(Number(value))) {
        player[field] = Number(value);
      } else if (value && (value[0] === '{' || value[0] === '[')) {
        try { player[field] = JSON.parse(value); } catch (_) { player[field] = value; }
      } else {
        player[field] = value;
      }
    });
    return player;
  }).filter(player => String(player.name || '').trim());
}

async function writeFileAtomic(filePath, contents) {
  await fs.promises.mkdir(path.dirname(filePath), {recursive:true});
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.promises.writeFile(tempPath, contents, 'utf8');
    await fs.promises.rename(tempPath, filePath);
  } catch (err) {
    try { await fs.promises.unlink(tempPath); } catch (_) {}
    throw err;
  }
}

async function loadRegisteredPlayersCsv() {
  if (dbPool) {
    const result = await dbPool.query('SELECT payload FROM pickle_point_storage WHERE storage_key = $1', ['registered-player-csv']);
    if (result.rows.length) {
      const payload = result.rows[0].payload;
      if (payload && typeof payload.csv === 'string') return parseRegisteredPlayersCsv(payload.csv);
      if (typeof payload === 'string') return parseRegisteredPlayersCsv(payload);
    }
    // On a database-backed host, prefer importing legacy cloud records during
    // startup instead of seeding from a possibly stale CSV shipped in the code.
    return null;
  }
  try {
    return parseRegisteredPlayersCsv(await fs.promises.readFile(REGISTERED_PLAYERS_CSV_FILE, 'utf8'));
  } catch (_) {
    return null;
  }
}

function persistSharedCloudRecords() {
  const current = sharedCloudRecords || {players:[],logs:[],sessions:[]};
  const snapshot = JSON.parse(JSON.stringify({
    players:Array.isArray(current.players) ? current.players : [],
    logs:Array.isArray(current.logs) ? current.logs : [],
    sessions:Array.isArray(current.sessions) ? current.sessions : []
  }));
  const csv = serializeRegisteredPlayersCsv(snapshot.players);
  const snapshotUpdatedAt = sharedCloudUpdatedAt;
  const cloudEnvelope = {
    revision:sharedCloudRevision,
    updatedAt:snapshotUpdatedAt,
    clientId:sharedCloudClientId,
    // Player profile details live in registered-players.csv. Keep the legacy
    // cloud envelope for match logs/session history and sync metadata only.
    records:{players:[],logs:snapshot.logs,sessions:snapshot.sessions}
  };
  const job = async () => {
    await fs.promises.mkdir(DATA_DIR, {recursive:true});
    if (dbPool) {
      const client = await dbPool.connect();
      try {
        await client.query('BEGIN');
        for (const entry of [
          {key:'registered-player-csv', value:{csv,updatedAt:snapshotUpdatedAt}},
          {key:'cloud-records', value:cloudEnvelope}
        ]) {
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
      // The database row above is durable on hosted deployments. Keep a real
      // CSV file on the instance as an easy-to-inspect/export mirror; it is
      // regenerated from the durable CSV payload after a restart/deploy.
      try { await writeFileAtomic(REGISTERED_PLAYERS_CSV_FILE, csv); }
      catch (err) { console.warn('Could not refresh registered-players.csv mirror:', err.message); }
      return;
    }
    await Promise.all([
      writeFileAtomic(REGISTERED_PLAYERS_CSV_FILE, csv),
      writeFileAtomic(CLOUD_RECORDS_FILE, JSON.stringify(cloudEnvelope))
    ]);
  };
  sharedCloudPersistenceQueue = sharedCloudPersistenceQueue.catch(() => {}).then(job);
  return sharedCloudPersistenceQueue;
}

function sendJson(res, status, data) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(data));
}
function normalizePlayerName(value) {
  return String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}
function createDefaultSharedAppState() {
  return {schemaVersion:12,players:[],left:[],queue:[],lockedPartners:[],courts:[],logs:[],nextPlayer:1,nextCourt:1,nextWaitingCourt:1,nextLog:1,sessionMetrics:{cloudCheckins:0,newRegistered:0},sessionActive:false,sessionEndedAt:null,sessionName:'Open Play',duprMatch:false,duprLocation:'',duprLabelsEnabled:true,recordScores:false,liveRankingEnabled:false,liveMatchesEnabled:false,eventRules:{target:11,winBy:1,type:'Doubles'},matchingMode:'balanced',winnersLosersNextGroup:'winners'};
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
      displayName:auth?.displayName || null,
      organizerId:auth?.organizerId || null
    });
  }

  if (url.pathname === '/api/organizers/public' && req.method === 'GET') {
    // This endpoint intentionally exposes only what the public sign-in picker needs.
    // Never include password hashes, login timestamps, or admin-only account metadata.
    const organizers = organizerAccounts
      .filter(account => account && account.active === true && effectiveApprovalStatus(account) === 'approved' && account.username)
      .map(account => ({
        id: String(account.id),
        username: String(account.username),
        displayName: String(account.displayName || account.username),
        profileImage: organizerLogoFor(account),
        active: account.active === true,
        approvalStatus: effectiveApprovalStatus(account),
        adminApproved: account.adminApproved === true
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, {sensitivity:'base'}));
    const panelAccount = panelIsConfigured()
      ? {username:PANEL_USERNAME,displayName:'Panel Administrator',profileImage:null}
      : null;
    return sendJson(res, 200, {ok:true,organizers,panelAccount});
  }

  if (url.pathname === '/api/login' && req.method === 'POST') {
    if (!SESSION_SECRET || (!panelIsConfigured() && !organizerAccounts.some(account => account.active === true && effectiveApprovalStatus(account) === 'approved'))) {
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
        if (account && account.active === true && effectiveApprovalStatus(account) === 'approved' && verifyPassword(password, account.passwordHash)) role = 'organizer';
      }
      if (!role) {
        return sendJson(res, 401, {ok:false,error:'Incorrect username or password, or this account is inactive.'});
      }
      if (role === 'organizer') {
        account.lastLoginAt = new Date().toISOString();
        if (!account.passwordEncrypted) account.passwordEncrypted = encryptOrganizerPassword(password);
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
      return res.end(JSON.stringify({ok:true,role,username:authUsername,displayName:role === 'organizer' ? (account.displayName || account.username) : null,organizerId:authId,expiresIn:SESSION_MAX_AGE_SECONDS}));
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
      const duprId = String(body?.duprId || '').trim().replace(/^DUPR\s*:\s*/i, '').replace(/\s+/g, '').toUpperCase().slice(0, 40);
      const password = String(body?.password || '');
      if (!/^[A-Z0-9]{6}$/.test(duprId)) return sendJson(res, 400, {ok:false,error:'DUPR ID is required and must contain exactly 6 letters or numbers.'});
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
      account.duprId = duprId;
      account.active = false;
      account.approvalStatus = 'pending';
      account.adminApproved = false;
      account.approvedAt = null;
      account.approvalConfirmedBy = null;
      account.applicationSubmittedAt = new Date().toISOString();
      organizerAccounts.push(account);
      await saveStoredBatch([{key:'organizer-accounts',filePath:ORGANIZERS_FILE,value:organizerAccounts},{key:'club-id-sequence',filePath:CLUB_ID_SEQUENCE_FILE,value:clubIdSequenceRecord()}]);
      return sendJson(res, 201, {
        ok:true,
        status:'pending',
        message:'Your organizer application has been submitted and is awaiting review. You can sign in after Pickle Point Match approves your account.',
        username:account.username,
        organizerId:account.id
      });
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

  if (url.pathname === '/api/panel/registered-players' && req.method === 'GET') {
    if (!isPanelAuthenticated(req)) return sendJson(res, 401, {ok:false,error:'Panel administrator login required.'});
    try {
      // Read the canonical CSV payload when available so the modal reflects the durable
      // player store, not the small example CSV shipped with the project files.
      const savedPlayers = await loadRegisteredPlayersCsv();
      const players = Array.isArray(savedPlayers)
        ? savedPlayers
        : (Array.isArray(sharedCloudRecords?.players) ? sharedCloudRecords.players : []);
      if (url.searchParams.get('summary') === '1') {
        return sendJson(res, 200, {ok:true,count:players.length,updatedAt:sharedCloudUpdatedAt});
      }
      return sendJson(res, 200, {ok:true,count:players.length,players,updatedAt:sharedCloudUpdatedAt});
    } catch (err) {
      console.error('Unable to load registered players for panel:', err.message);
      return sendJson(res, 500, {ok:false,error:'Unable to load registered players from storage.'});
    }
  }
  if (url.pathname === '/api/panel/registered-players.csv' && req.method === 'GET') {
    if (!isPanelAuthenticated(req)) return sendJson(res, 401, {ok:false,error:'Panel administrator login required.'});
    try {
      const savedPlayers = await loadRegisteredPlayersCsv();
      const players = Array.isArray(savedPlayers)
        ? savedPlayers
        : (Array.isArray(sharedCloudRecords?.players) ? sharedCloudRecords.players : []);
      const csv = `\uFEFF${serializeRegisteredPlayersCsv(players)}`;
      const filename = `registered-players-${new Date().toISOString().slice(0,10)}.csv`;
      res.writeHead(200, {
        'Content-Type':'text/csv; charset=utf-8',
        'Content-Disposition':`attachment; filename="${filename}"`,
        'Content-Length':Buffer.byteLength(csv,'utf8'),
        'Cache-Control':'private, no-store, max-age=0',
        'X-Content-Type-Options':'nosniff'
      });
      return res.end(csv);
    } catch (err) {
      console.error('Unable to export registered players CSV:', err.message);
      return sendJson(res, 500, {ok:false,error:'Unable to export registered players. Please check the database connection and try again.'});
    }
  }

  if (url.pathname === '/api/panel/organizers' && req.method === 'GET') {
    if (!isPanelAuthenticated(req)) return sendJson(res, 401, {ok:false,error:'Panel administrator login required.'});
    return sendJson(res, 200, {ok:true,organizers:organizerAccounts.map(organizerPanelRecord)});
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
      await saveStoredBatch([{key:'organizer-accounts',filePath:ORGANIZERS_FILE,value:organizerAccounts},{key:'club-id-sequence',filePath:CLUB_ID_SEQUENCE_FILE,value:clubIdSequenceRecord()}]);
      return sendJson(res, 201, {ok:true,organizer:organizerPanelRecord(account)});
    } catch (err) { return sendJson(res, err.statusCode || 400, {ok:false,error:err.statusCode === 413 ? 'Payload too large' : 'Unable to create organizer account.'}); }
  }
  const organizerAdminMatch = url.pathname.match(/^\/api\/panel\/organizers\/([a-f0-9-]{20,})$/i);
  if (organizerAdminMatch && req.method === 'PATCH') {
    if (!isPanelAuthenticated(req)) return sendJson(res, 401, {ok:false,error:'Panel administrator login required.'});
    try {
      const body = await readBody(req, 4 * 1024 * 1024);
      const account = organizerAccounts.find(item => item.id === organizerAdminMatch[1]);
      if (!account) return sendJson(res, 404, {ok:false,error:'Organizer account not found.'});
      const requestedApprovalStatus = body.approvalStatus !== undefined
        ? String(body.approvalStatus || '').trim().toLowerCase()
        : effectiveApprovalStatus(account);
      if (body.active === true && requestedApprovalStatus !== 'approved') {
        return sendJson(res, 400, {ok:false,error:'Confirm and approve this organizer application before activating the account.'});
      }
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
      if (body.duprId !== undefined || body.personalDuprId !== undefined || body.dupr_id !== undefined) {
        const duprId = normalizeOrganizerDuprId(body.duprId ?? body.personalDuprId ?? body.dupr_id);
        if (duprId && !/^[A-Z0-9_-]{1,40}$/.test(duprId)) return sendJson(res, 400, {ok:false,error:'DUPR ID must use letters, numbers, hyphens, or underscores (up to 40 characters), or be left blank.'});
        account.duprId = duprId || null;
        delete account.personalDuprId;
        delete account.duprID;
        delete account.dupr_id;
      }
      if (body.duprOrganizerId !== undefined) {
        const duprOrganizerId = String(body.duprOrganizerId || '').trim();
        if (duprOrganizerId.length > 100) return sendJson(res, 400, {ok:false,error:'DUPR Organizer ID must be 100 characters or fewer.'});
        account.duprOrganizerId = duprOrganizerId || null;
      }
      if (body.approvalStatus !== undefined) {
        const approvalStatus = String(body.approvalStatus || '').trim().toLowerCase();
        if (!['approved','rejected'].includes(approvalStatus)) {
          return sendJson(res, 400, {ok:false,error:'Approval status must be approved or rejected.'});
        }
        account.approvalStatus = approvalStatus;
        account.active = approvalStatus === 'approved';
        account.adminApproved = approvalStatus === 'approved';
        if (approvalStatus === 'approved') {
          account.approvedAt = new Date().toISOString();
          account.approvalConfirmedAt = account.approvedAt;
          account.approvalConfirmedBy = PANEL_USERNAME;
          account.rejectedAt = null;
        } else {
          account.rejectedAt = new Date().toISOString();
          account.approvalConfirmedAt = null;
          account.approvalConfirmedBy = null;
        }
      }
      if (body.active !== undefined) {
        if (body.active === true && effectiveApprovalStatus(account) !== 'approved') {
          return sendJson(res, 400, {ok:false,error:'This organizer is still awaiting administrator confirmation. Use Confirm organizer first.'});
        }
        account.active = !!body.active;
      }
      if (body.password !== undefined && String(body.password)) {
        const password = String(body.password);
        if (password.length < 8 || password.length > 200) return sendJson(res, 400, {ok:false,error:'Password must be 8–200 characters long.'});
        account.passwordHash = hashPassword(password);
        account.passwordEncrypted = encryptOrganizerPassword(password);
      }
      if (body.profileImage !== undefined) {
        const profileImage = String(body.profileImage || '').trim();
        if (profileImage && (profileImage.length > 2500000 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(profileImage))) {
          return sendJson(res, 400, {ok:false,error:'Profile photo must be a valid image under 2 MB after processing.'});
        }
        account.profileImage = profileImage || null;
      }
      await saveStoredBatch([{key:'organizer-accounts',filePath:ORGANIZERS_FILE,value:organizerAccounts}]);
      return sendJson(res, 200, {ok:true,organizer:organizerPanelRecord(account)});
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

  // Organizer write APIs require login. Player registration is handled separately
  // and requires a valid organizer-scoped share link.
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
      body = `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /Registration.html\nSitemap: ${origin}/sitemap.xml\n`;
      contentType = 'text/plain; charset=utf-8';
    } else {
      const pages = ['/', '/live.html'];
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

  // Organizer app state is available to the signed-in organizer or through a
  // valid organizer-scoped registration link; generic public reads are blocked.
  if (url.pathname === '/api/app-state' && req.method === 'GET') {
    const requestedScope = String(url.searchParams.get('organizer') || '').trim();
    const auth = getAuthSession(req);
    // Scoped links stay tied to their organizer even if the visitor has a
    // different organizer cookie. An unscoped public request is not allowed.
    const organizerId = requestedScope
      ? (accountById(requestedScope)?.id || null)
      : (auth?.role === 'organizer' ? auth.organizerId : null);
    if (requestedScope && !organizerId) return sendJson(res,404,{ok:false,error:'Organizer account was not found or is inactive.'});
    if (!organizerId) return sendJson(res,401,{ok:false,error:'An organizer-specific registration link or organizer login is required.'});
    const entry = getOrganizerAppEntry(organizerId);
    return sendJson(res, 200, {ok:true,revision:entry.revision,state:entry.state,updatedAt:entry.updatedAt,organizerId});
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
      const snapshot = withoutOpgFields(JSON.parse(JSON.stringify(incoming)));
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
    const requestedScope = String(url.searchParams.get('organizer') || '').trim();
    const auth = getAuthSession(req);
    const organizerId = requestedScope
      ? (accountById(requestedScope)?.id || null)
      : (auth?.role === 'organizer' ? auth.organizerId : null);
    if (requestedScope && !organizerId) return sendJson(res,404,{ok:false,error:'Organizer account was not found or is inactive.'});
    if (!organizerId) return sendJson(res,401,{ok:false,error:'An organizer-specific registration link or organizer login is required.'});
    // The organizer scope authorizes the link; records remain in one shared cloud.
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
      const records = {players:incoming.players.slice(0,50000).map(withoutOpgFields).filter(player => player && typeof player === 'object' && !Array.isArray(player)),logs:incoming.logs.slice(0,100000),sessions:incoming.sessions.slice(0,50000)};
      if (JSON.stringify(sharedCloudRecords) !== JSON.stringify(records)) {
        sharedCloudRecords = JSON.parse(JSON.stringify(records));
        sharedCloudRevision += 1;
        sharedCloudUpdatedAt = new Date().toISOString();
        sharedCloudClientId = String(body.clientId || '').slice(0,100) || null;
        await persistSharedCloudRecords();
        broadcastNamedEvent('cloud-records', {revision:sharedCloudRevision,updatedAt:sharedCloudUpdatedAt,clientId:sharedCloudClientId,records:sharedCloudRecords});
      }
      return sendJson(res, 200, {ok:true,accepted:true,revision:sharedCloudRevision,updatedAt:sharedCloudUpdatedAt,unchanged:JSON.stringify(sharedCloudRecords)===JSON.stringify(records)});
    } catch (err) { return sendJson(res, err.statusCode || 500, {ok:false,error:err.statusCode===413?'Payload too large':err.message||'Unable to save Registered Player Cloud records'}); }
  }
  // Register a player profile in the global Registered Player Cloud only.
  // Queue check-in remains an organizer-controlled action from queueing.html.
  if (url.pathname === '/api/register-player' && req.method === 'POST') {
    try {
      const body = await readBody(req, 16 * 1024);
      const name = String(body?.name || '').normalize('NFC').trim().replace(/\s+/g, ' ');
      const nickname = String(body?.nickname || '').normalize('NFC').trim().replace(/\s+/g, ' ').slice(0, 80);
      const gender = String(body?.gender || '');
      const category = String(body?.category || '').toUpperCase();
      const requestedScope = String(url.searchParams.get('organizer') || body?.organizerId || '').trim();
      if (!requestedScope) return sendJson(res, 400, {ok:false,error:'Organizer-specific registration link required. Please scan the QR code or use the link provided by your organizer.'});
      const organizerId = accountById(requestedScope)?.id || null;
      if (!organizerId) return sendJson(res, 400, {ok:false,error:'Organizer link is invalid or inactive. Ask the organizer for an updated registration link.'});

      const requestedDuprMode = url.searchParams.get('dupr');
      const isDuprSession = requestedDuprMode === null
        ? body?.duprMatch === true
        : ['1','true','dupr'].includes(String(requestedDuprMode).trim().toLowerCase());
      const duprId = isDuprSession ? String(body?.duprId || '').trim().toUpperCase() : '';
      const selfRating = isDuprSession ? String(body?.selfRating || '').trim() : '';
      if (!name || name.length > 120) return sendJson(res, 400, {ok:false,error:'Please enter a name (maximum 120 characters).'});
      if (!['Male','Female'].includes(gender)) return sendJson(res, 400, {ok:false,error:'Please select Male or Female.'});
      if (!['BEG','NOV','INT','ADV','EXP'].includes(category)) return sendJson(res, 400, {ok:false,error:'Please select a skill level.'});
      if (isDuprSession && !/^[A-Z0-9]{6}$/.test(duprId)) return sendJson(res, 400, {ok:false,error:'DUPR ID must contain exactly 6 letters or numbers (for example, 1A2B3C).'});
      if (isDuprSession && selfRating && !/^\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?$/.test(selfRating)) return sendJson(res, 400, {ok:false,error:'Enter self rating as a number or a numeric range, such as 2.5/4.0.'});

      // Registration is reachable only through an organizer-specific link.
      // Its records intentionally remain in the single shared Registered Player Cloud.
      const currentRecords = sharedCloudRecords || {players:[],logs:[],sessions:[]};
      const currentPlayers = Array.isArray(currentRecords.players) ? currentRecords.players : [];
      const duplicateDupr = isDuprSession && duprId ? currentPlayers.find(p => {
        const registeredId = String(p?.duprId ?? p?.duprID ?? p?.dupr_id ?? '')
          .trim().replace(/^DUPR\s*:\s*/i, '').replace(/\s+/g, '').toUpperCase();
        return registeredId === duprId;
      }) : null;
      if (duplicateDupr) {
        const registeredId = String(duplicateDupr.duprId ?? duplicateDupr.duprID ?? duplicateDupr.dupr_id ?? duprId).trim().toUpperCase();
        return sendJson(res, 409, {
          ok:false,
          duplicate:true,
          duplicateType:'duprId',
          error:`This DUPR ID: ${duprId} is already registered under the name: ${duplicateDupr.name}.`,
          player:{name:duplicateDupr.name,duprId:registeredId}
        });
      }
      const duplicate = currentPlayers.find(p => normalizePlayerName(p?.name) === normalizePlayerName(name));
      if (duplicate) return sendJson(res, 409, {ok:false,duplicate:true,duplicateType:'name',error:'This user is already registered in Registered Player Cloud',player:{name:duplicate.name}});

      const records = JSON.parse(JSON.stringify(currentRecords));
      records.players = Array.isArray(records.players) ? records.players : [];
      records.logs = Array.isArray(records.logs) ? records.logs : [];
      records.sessions = Array.isArray(records.sessions) ? records.sessions : [];
      const cloudId = Date.now() + Math.floor(Math.random() * 100000);
      const cloudPlayer = {cloudId,name,nickname,gender,category,duprId,selfRating,matches:0,wins:0,losses:0};
      records.players.push(cloudPlayer);

      sharedCloudRecords = records;
      sharedCloudRevision += 1;
      sharedCloudUpdatedAt = new Date().toISOString();
      sharedCloudClientId = 'registration-page';
      await persistSharedCloudRecords();
      broadcastNamedEvent('cloud-records',{revision:sharedCloudRevision,updatedAt:sharedCloudUpdatedAt,clientId:sharedCloudClientId,records:sharedCloudRecords});

      return sendJson(res, 200, {
        ok:true,
        player:cloudPlayer,
        queued:false,
        cloudOnly:true,
        cloudCount:sharedCloudRecords.players.length,
        cloudRevision:sharedCloudRevision,
        organizerId
      });
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
    // A QR/shared Live View URL is explicitly scoped to its organizer. Honor
    // that scope even if this browser has a different organizer login cookie.
    const organizerId = requestedScope ? (accountById(requestedScope)?.id || null) : resolveOrganizerId(req,url,null,true);
    if (requestedScope && !organizerId) return sendJson(res,404,{ok:false,error:'Organizer account was not found or is inactive.'});
    const organizer = organizerId ? accountById(organizerId) : null;
    return sendJson(res, 200, {ok:true,state:getOrganizerLiveState(organizerId),organizerId,organizerName:organizer ? String(organizer.displayName || organizer.username) : null,organizerLogo:organizer ? organizerLogoFor(organizer) : null});
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
    const auth = getAuthSession(req);
    const organizerId = requestedScope
      ? (accountById(requestedScope)?.id || null)
      : (auth?.role === 'organizer' ? auth.organizerId : null);
    if (requestedScope && !organizerId) return sendJson(res,404,{ok:false,error:'Organizer account was not found or is inactive.'});
    if (!organizerId) return sendJson(res,401,{ok:false,error:'An organizer-specific registration link or organizer login is required.'});
    res.writeHead(200, {'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
    res.write('retry: 2000\n\n');
    const appEntry = getOrganizerAppEntry(organizerId);
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
    // Match the HTTP snapshot lookup so EventSource never subscribes to another
    // organizer's queue just because the browser has a login cookie.
    const organizerId = requestedScope ? (accountById(requestedScope)?.id || null) : resolveOrganizerId(req,url,null,true);
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
    const savedClubSequence = await loadStored('club-id-sequence', CLUB_ID_SEQUENCE_FILE);
    nextClubIdSequence = Math.max(1, Number(savedClubSequence?.next) || 1);
    organizerAccounts = Array.isArray(savedAccounts) ? savedAccounts.filter(account => account && typeof account === 'object' && account.id && account.username && account.passwordHash) : [];
    let accountsChanged = !Array.isArray(savedAccounts);
    if (ensureOrganizerClubIds()) accountsChanged = true;
    for (const account of organizerAccounts) {
      const status = String(account.approvalStatus || '').trim().toLowerCase();
      const source = organizerCreatedBy(account);
      const legacyPreCutover = isLegacyPreApprovalAccount(account);

      // Older versions recorded approvedAt only when an administrator used the
      // confirmation action. Preserve those real approvals as an explicit marker.
      if (status === 'approved' && account.approvedAt && account.adminApproved !== true) {
        account.adminApproved = true;
        account.approvalConfirmedAt = account.approvalConfirmedAt || account.approvedAt;
        account.approvalConfirmedBy = account.approvalConfirmedBy || 'previous-admin-confirmation';
        accountsChanged = true;
      }

      if (status === 'rejected') {
        if (account.active !== false || account.adminApproved !== false) accountsChanged = true;
        account.active = false;
        account.adminApproved = false;
        continue;
      }
      if (status === 'pending') {
        if (account.active !== false || account.adminApproved !== false) accountsChanged = true;
        account.active = false;
        account.adminApproved = false;
        account.applicationSubmittedAt = account.applicationSubmittedAt || account.createdAt || new Date().toISOString();
        continue;
      }
      if (isAdminCreatedAccount(account)) {
        if (!status) { account.approvalStatus = 'approved'; accountsChanged = true; }
        account.adminApproved = true;
        if (account.active === undefined) { account.active = true; accountsChanged = true; }
        continue;
      }
      if (account.adminApproved === true) {
        if (status !== 'approved') { account.approvalStatus = 'approved'; accountsChanged = true; }
        continue;
      }
      if (legacyPreCutover) {
        // Preserve existing accounts that predate the approval feature, but make
        // their grandfathered status explicit so future requests cannot infer it.
        account.approvalStatus = 'approved';
        account.adminApproved = true;
        account.approvedAt = account.approvedAt || account.createdAt || new Date().toISOString();
        account.approvalConfirmedAt = account.approvalConfirmedAt || account.approvedAt;
        account.approvalConfirmedBy = account.approvalConfirmedBy || 'legacy-account-migration';
        accountsChanged = true;
        continue;
      }

      // Every self-registration after the cutover (or with ambiguous date data)
      // remains pending until this panel writes adminApproved=true explicitly.
      if (account.approvalStatus !== 'pending' || account.active !== false || account.adminApproved !== false || !account.applicationSubmittedAt) accountsChanged = true;
      account.approvalStatus = 'pending';
      account.active = false;
      account.adminApproved = false;
      account.approvedAt = null;
      account.approvalConfirmedAt = null;
      account.approvalConfirmedBy = null;
      account.applicationSubmittedAt = account.applicationSubmittedAt || account.createdAt || new Date().toISOString();
    }
    if (AUTH_USERNAME && AUTH_PASSWORD && !accountByUsername(AUTH_USERNAME)) {
      organizerAccounts.push(makeOrganizerRecord(AUTH_USERNAME,AUTH_PASSWORD,AUTH_USERNAME,'legacy-environment'));
      accountsChanged = true;
    }
    const accountEntries = [];
    if (accountsChanged) accountEntries.push({key:'organizer-accounts',filePath:ORGANIZERS_FILE,value:organizerAccounts});
    if (accountsChanged || Number(savedClubSequence?.next) !== Number(nextClubIdSequence)) {
      accountEntries.push({key:'club-id-sequence',filePath:CLUB_ID_SEQUENCE_FILE,value:clubIdSequenceRecord()});
    }
    if (accountEntries.length) await saveStoredBatch(accountEntries);

    const loadedLiveState = await loadStored('live-state', DATA_FILE);
    latestState = withoutOpgFields(loadedLiveState);
    if (loadedLiveState && JSON.stringify(latestState) !== JSON.stringify(loadedLiveState)) {
      await saveStoredBatch([{key:'live-state',filePath:DATA_FILE,value:latestState}]);
    }
    const savedTheme = await loadStored('live-theme', THEME_FILE);
    if (savedTheme && (savedTheme.theme === 'light' || savedTheme.theme === 'night')) liveTheme = savedTheme.theme;

    const savedApp = await loadStored('app-state', APP_STATE_FILE);
    if (savedApp && savedApp.state && typeof savedApp.state === 'object') {
      const cleanedSavedApp = {...savedApp,state:withoutOpgFields(savedApp.state)};
      if (JSON.stringify(cleanedSavedApp) !== JSON.stringify(savedApp)) {
        await saveStoredBatch([{key:'app-state',filePath:APP_STATE_FILE,value:cleanedSavedApp}]);
      }
      sharedAppState = cleanedSavedApp.state;
      if (typeof sharedAppState.liveRankingEnabled !== 'boolean') sharedAppState.liveRankingEnabled = latestState?.liveRankingEnabled !== false;
      if (typeof sharedAppState.liveMatchesEnabled !== 'boolean') sharedAppState.liveMatchesEnabled = latestState?.liveMatchesEnabled !== false;
      sharedAppRevision = Math.max(0, Number(savedApp.revision) || 1);
      sharedAppUpdatedAt = savedApp.updatedAt || null;
      sharedAppClientId = savedApp.clientId || null;
    }

    for (const account of organizerAccounts) {
      const orgApp = await loadStored(`app-state:${account.id}`,organizerDataPath('app-state',account.id));
      if (orgApp && typeof orgApp === 'object' && orgApp.state && typeof orgApp.state === 'object') {
        const cleanedOrgApp = {...orgApp,state:withoutOpgFields(orgApp.state)};
        if (JSON.stringify(cleanedOrgApp) !== JSON.stringify(orgApp)) await saveOrganizerAppState(account.id,cleanedOrgApp);
        else organizerAppStates.set(account.id,cleanedOrgApp);
      }
      const orgLive = await loadStored(`live-state:${account.id}`,organizerDataPath('live-state',account.id));
      if (orgLive && typeof orgLive === 'object') {
        const cleanedOrgLive = withoutOpgFields(orgLive);
        if (JSON.stringify(cleanedOrgLive) !== JSON.stringify(orgLive)) await saveOrganizerLiveState(account.id,cleanedOrgLive);
        else organizerLiveStates.set(account.id,cleanedOrgLive);
      }
    }
    const migrationTarget = (AUTH_USERNAME && accountByUsername(AUTH_USERNAME)) || getDefaultOrganizer();
    if (migrationTarget && !organizerAppStates.has(migrationTarget.id) && savedApp?.state && typeof savedApp.state === 'object') {
      const migrated = {revision:Math.max(0,Number(savedApp.revision)||1),updatedAt:savedApp.updatedAt||new Date().toISOString(),clientId:savedApp.clientId||'legacy-migration',state:sharedAppState || withoutOpgFields(savedApp.state)};
      organizerAppStates.set(migrationTarget.id,migrated);
      await saveOrganizerAppState(migrationTarget.id,migrated);
    }
    if (migrationTarget && !organizerLiveStates.has(migrationTarget.id) && latestState && typeof latestState === 'object') {
      organizerLiveStates.set(migrationTarget.id,latestState);
      await saveOrganizerLiveState(migrationTarget.id,latestState);
    }

    const savedCloud = await loadStored('cloud-records', CLOUD_RECORDS_FILE);
    const savedCsvPlayers = await loadRegisteredPlayersCsv();
    const hasSavedCloudRecords = !!(savedCloud && savedCloud.records && typeof savedCloud.records === 'object');
    if (hasSavedCloudRecords || savedCsvPlayers !== null) {
      const legacyRecords = hasSavedCloudRecords ? savedCloud.records : {};
      sharedCloudRecords = {
        players:(savedCsvPlayers !== null ? savedCsvPlayers : (Array.isArray(legacyRecords.players) ? legacyRecords.players : [])).map(withoutOpgFields),
        logs:Array.isArray(legacyRecords.logs) ? legacyRecords.logs : [],
        sessions:Array.isArray(legacyRecords.sessions) ? legacyRecords.sessions : []
      };
      sharedCloudRevision = Math.max(0, Number(savedCloud?.revision) || 1);
      sharedCloudUpdatedAt = savedCloud?.updatedAt || null;
      sharedCloudClientId = savedCloud?.clientId || null;
      // Migrate legacy player details from JSON/PostgreSQL into CSV and remove
      // them from the legacy cloud envelope. CSV becomes the canonical profile store.
      await persistSharedCloudRecords();
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
