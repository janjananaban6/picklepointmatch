'use strict';

/*
 * HUSAY DINKERS management dashboard
 * This UI reads and mutates the existing Pickle Point Match queueing system.
 * It deliberately does not create a parallel player/session database.
 */

const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h3M8 17h6"/>',
  users: '<path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM17 11a3 3 0 1 0 0-6M17 14.5a4 4 0 0 1 4 4V20"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H3v2a4 4 0 0 0 4 4M17 6h4v2a4 4 0 0 1-4 4"/>',
  chart: '<path d="M4 20V11h4v9M10 20V4h4v16M16 20v-7h4v7M2 20h20"/>',
  pin: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  report: '<path d="M5 3h10l4 4v14H5zM15 3v5h4M8 12h8M8 16h8M8 8h3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.5.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.5-.9l-1.7.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.8l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.5-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.5.9l1.7-.6 1.4 2.4-1.4 1.1a7 7 0 0 1 0 1.7Z"/>',
  search: '<circle cx="10.8" cy="10.8" r="7.2"/><path d="m16.2 16.2 4.3 4.3"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 19h16"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 17v3h16v-3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  edit: '<path d="m14 5 5 5M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  court: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M12 3v18M3 8h4v8H3M21 8h-4v8h4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>',
  filter: '<path d="M4 5h16M7 12h10M10 19h4"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9A7 7 0 0 1 18 6l2 1M4 17l2 1a7 7 0 0 0 12.5-3"/>'
};

const state = {
  page: 'dashboard',
  query: '',
  data: null,
  raw: null,
  organizer: null,
  modal: null,
  refreshRequest: 0,
  refreshController: null,
  refreshingDashboard: false,
  dataSignature: '',
  pendingRender: false,
  navigationRequest: 0,
  pointerInteraction: false,
  eventStream: null,
  mapInstances: new Map(),
  mapResolvedLocations: new Map(),
  rankingRenderToken: 0,
  rankingRenderPlayers: [],
  dashboardRankingToken: 0,
  mapModalSessionId: '',
  mapIncludeRegisteredCourts: false,
  filters: { sessionStatus: 'all', playerCategory: 'all', rankingCategory: 'all', rankingSession: 'all', matchType: 'all' }
};

let pendingPlayerImport = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function registeredCourtLogo(court = {}) {
  const candidates = [court?.logo, court?.logoUrl, court?.logoData, court?.logoDataUrl, court?.imageUrl, court?.image];
  return candidates.map(value => String(value || '').trim()).find(Boolean) || '';
}
const icon = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.info}</svg>`;
const refreshIcon = () => '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-refresh-ccw preview-icon dashboard-refresh-icon" aria-hidden="true"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>';
const normalizeName = value => String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const normalizeDuprId = value => String(value || '').trim().replace(/^DUPR\s*:\s*/i, '').replace(/\s+/g, '').toLocaleUpperCase();
const CATEGORY_NAMES = { BEG: 'Beginner', NOV: 'Novice', INT: 'Intermediate', ADV: 'Advanced', EXP: 'Expert', BEGINNER: 'Beginner', NOVICE: 'Novice', INTERMEDIATE: 'Intermediate', ADVANCED: 'Advanced', EXPERT: 'Expert' };
const CATEGORY_CODES = { Beginner: 'BEG', Novice: 'NOV', Intermediate: 'INT', Advanced: 'ADV', Expert: 'EXP' };
const categoryName = value => CATEGORY_NAMES[String(value || '').trim().toUpperCase()] || String(value || 'Unspecified');
const categoryCode = value => CATEGORY_CODES[categoryName(value)] || String(value || '').toUpperCase();
const dateObj = value => value ? new Date(value) : null;
const fmtDate = (value, options = { month: 'short', day: 'numeric', year: 'numeric' }) => {
  const date = dateObj(value);
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat('en-PH', options).format(date) : '—';
};
const fmtMatchTime = value => {
  const date = dateObj(value);
  return date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(date)
    : '—';
};
const formatPlayerRegisteredOn = player => {
  const savedValue = player?.registeredAt || player?.registered_at || player?.createdAt || player?.created_at || '';
  let timestamp = 0;
  if (typeof savedValue === 'number' && Number.isFinite(savedValue) && savedValue > 0) {
    timestamp = savedValue;
  } else if (String(savedValue).trim()) {
    const text = String(savedValue).trim();
    const numeric = /^\d{10,13}$/.test(text) ? Number(text) : 0;
    if (numeric > 0) timestamp = numeric < 100000000000 ? numeric * 1000 : numeric;
    else {
      const parsed = Date.parse(text);
      if (Number.isFinite(parsed) && parsed > 0) timestamp = parsed;
    }
  }
  // Older cloud IDs were generated from Date.now(); use the embedded creation
  // time only when no explicit registration timestamp was saved.
  if (!timestamp) {
    const legacyId = Number(player?.cloudId);
    if (Number.isFinite(legacyId) && legacyId >= 1577836800000 && legacyId <= Date.now() + 600000) timestamp = legacyId;
  }
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric'
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
  }).format(date);
  return `Registered on ${dateLabel} • ${timeLabel}`;
};
const formatMatchDuration = (value, startedAt, endedAt) => {
  const raw = String(value ?? '').trim();
  let totalSeconds = NaN;
  if (/^\d+:\d{2}:\d{2}$/.test(raw)) {
    const [hours, minutes, seconds] = raw.split(':').map(Number);
    totalSeconds = hours * 3600 + minutes * 60 + seconds;
  } else if (/^\d+:\d{2}$/.test(raw)) {
    const [minutes, seconds] = raw.split(':').map(Number);
    totalSeconds = minutes * 60 + seconds;
  } else if (/^\d+(?:\.\d+)?$/.test(raw)) {
    totalSeconds = Number(raw);
  }
  if (!Number.isFinite(totalSeconds)) {
    const start = dateObj(startedAt);
    const end = dateObj(endedAt);
    if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      totalSeconds = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
    }
  }
  if (!Number.isFinite(totalSeconds)) return '—';
  totalSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = part => String(part).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)} Mins`;
};
const localDateParts = value => {
  const date = dateObj(value);
  if (!date || Number.isNaN(date.getTime())) return { date: '', time: '' };
  const pad = n => String(n).padStart(2, '0');
  return { date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, time: `${pad(date.getHours())}:${pad(date.getMinutes())}` };
};
const todayISO = () => {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};
const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();

function updateOrganizerProfileDisplay(organizer = {}) {
  const displayName = String(organizer.displayName || organizer.username || 'Organizer').trim();
  const username = String(organizer.username || '').trim();
  const nameElement = $('#organizerName');
  const usernameElement = $('#organizerUsername');
  const avatar = $('#organizerAvatar');
  const avatarImage = $('#organizerAvatarImage');
  const avatarFallback = $('#organizerAvatarFallback');

  if (nameElement) nameElement.textContent = displayName || 'Organizer';
  if (usernameElement) {
    usernameElement.textContent = username || 'Organizer';
    usernameElement.title = username || 'Organizer';
  }

  if (!avatar || !avatarImage || !avatarFallback) return;
  const logo = String(organizer.logo || organizer.profileImage || '').trim();
  avatarImage.onerror = () => {
    avatarImage.hidden = true;
    avatarImage.removeAttribute('src');
    avatar.classList.remove('has-logo');
    avatarFallback.hidden = false;
    avatarFallback.textContent = initials(displayName);
  };

  if (logo) {
    avatar.classList.add('has-logo');
    avatarFallback.hidden = true;
    avatarImage.hidden = false;
    if (avatarImage.src !== logo) avatarImage.src = logo;
  } else {
    avatarImage.hidden = true;
    avatarImage.removeAttribute('src');
    avatar.classList.remove('has-logo');
    avatarFallback.hidden = false;
    avatarFallback.textContent = initials(displayName);
  }
}

// Keep the interactive map focused on the Philippine archipelago.
const PH_MAP_BOUNDS = [[4.0, 115.5], [22.4, 128.6]];
const PH_MAP_CENTER = [12.8797, 121.7740];
let photonQueue = Promise.resolve();
let photonLastRequestAt = 0;
let mapLibreLoadPromise = null;


async function api(url, options = {}) {
  const config = {
    cache: 'no-store',
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
  };
  const response = await fetch(url, config);
  let payload = {};
  try { payload = await response.json(); } catch (_) {}
  if (response.status === 401) {
    window.location.replace(`/?next=${encodeURIComponent('manage')}`);
    throw new Error('Your organizer session has expired. Please sign in again.');
  }
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `Request failed (${response.status}).`);
  return payload;
}

function sessionTimestampFromId(sessionId) {
  const match = String(sessionId || '').match(/^session-(\d{13})-/);
  if (!match) return null;
  const date = new Date(Number(match[1]));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function asArray(value) { return Array.isArray(value) ? value : []; }
function normalizeMapLocationCoordinates(value) {
  let source = value;
  if (typeof source === 'string') {
    try { source = JSON.parse(source); } catch (_) { return null; }
  }
  if (!source || typeof source !== 'object') return null;

  // Accept legacy coordinate formats as well as the current saved object:
  // MapLibre arrays use [longitude, latitude], while some older imports store
  // latitude/longitude as named fields or under a nested coordinates object.
  let coordinateArray = null;
  if (Array.isArray(source)) coordinateArray = source;
  else if (Array.isArray(source.coordinates)) coordinateArray = source.coordinates;
  else if (Array.isArray(source.geometry?.coordinates)) coordinateArray = source.geometry.coordinates;

  let lat = coordinateArray
    ? Number(coordinateArray[1])
    : Number(source.lat ?? source.latitude ?? source.y ?? source.location?.lat ?? source.location?.latitude);
  let lon = coordinateArray
    ? Number(coordinateArray[0])
    : Number(source.lon ?? source.lng ?? source.longitude ?? source.x ?? source.location?.lon ?? source.location?.lng ?? source.location?.longitude);

  // A previous map export/import may have stored [lat, lon] or reversed named
  // fields. Detect that exact Philippines range pattern and correct it so the
  // marker is not projected beyond the map's top-left edge.
  if (lat >= 115.5 && lat <= 128.6 && lon >= 4.0 && lon <= 22.4) {
    [lat, lon] = [lon, lat];
  }

  const countrycode = String(source.countrycode || source.countryCode || source.country_code || 'PH').toUpperCase();
  if (countrycode !== 'PH' || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < 4.0 || lat > 22.4 || lon < 115.5 || lon > 128.6) return null;
  return {
    lat, lon,
    label: String(source.label || source.name || source.location?.label || '').trim(),
    countrycode: 'PH',
    source: String(source.source || '').trim(),
    verified: source.verified === true,
    placeId: String(source.placeId || source.osmId || '').trim(),
    pinId: String(source.pinId || '').trim(),
    osmId: String(source.osmId || '').trim()
  };
}
function getLogSessionId(log) { return String(log?.sessionId ?? log?.sessionID ?? log?.session_id ?? '').trim(); }
function getTeamNames(log, side) {
  const names = asArray(log?.[`${side}Names`]).map(name => String(name || '').trim()).filter(Boolean);
  if (names.length) return names;
  const snapshots = asArray(log?.[`${side}Players`]).map(person => String(person?.name || '').trim()).filter(Boolean);
  return snapshots;
}
function scoreParts(log) {
  const score = String(log?.score || '').trim();
  const match = score.match(/^(\d{1,2})\s*[-–:]\s*(\d{1,2})$/);
  if (!match) return { scoreA: null, scoreB: null, scoreLabel: score || (log?.recordingMode === 'win-only' ? 'WIN / LOSS' : '—'), isScored: false };
  return { scoreA: Number(match[1]), scoreB: Number(match[2]), scoreLabel: `${Number(match[1])}–${Number(match[2])}`, isScored: true };
}
function normalizeAttendees(rawPeople) {
  return asArray(rawPeople).map((person, index) => ({
    id: String(person?.id ?? person?._attendanceKey ?? `attendance-${index}`),
    index,
    playerId: String(person?.registeredCloudId || person?.cloudId || person?.id || ''),
    playerName: String(person?.name || person?.displayName || 'Unnamed player'),
    name: String(person?.name || person?.displayName || 'Unnamed player'),
    nickname: String(person?.nickname || ''),
    gender: String(person?.gender || ''),
    category: categoryName(person?.category),
    categoryCode: categoryCode(person?.category),
    avatarId: String(person?.avatarId || ''),
    duprId: String(person?.duprId || ''),
    checkedIn: true
  }));
}
function normalizeLegacyDashboard(payload) {
  const rawRecords = payload?.records || {};
  const appState = payload?.appState && typeof payload.appState === 'object' ? payload.appState : null;
  const attendanceBySession = rawRecords.attendanceBySession && typeof rawRecords.attendanceBySession === 'object' ? rawRecords.attendanceBySession : {};
  const rawPlayers = asArray(rawRecords.players);
  const rawArchived = asArray(rawRecords.sessions);
  const logsBySession = new Map();
  for (const log of asArray(rawRecords.logs)) {
    const sessionId = getLogSessionId(log);
    if (!sessionId) continue;
    if (!logsBySession.has(sessionId)) logsBySession.set(sessionId, []);
    logsBySession.get(sessionId).push(log);
  }
  const activeSessionId = appState?.sessionActive === true && !appState?.sessionEndedAt ? String(appState.sessionId || '') : '';

  const archiveSessions = rawArchived.map(session => {
    const id = String(session?.id || '');
    const people = Array.isArray(attendanceBySession[id]) ? attendanceBySession[id] : asArray(session?.participants);
    const start = session?.startedAt || sessionTimestampFromId(id);
    const startParts = localDateParts(start);
    const endParts = localDateParts(session?.endedAt);
    const sessionLogs = logsBySession.get(id) || [];
    const courts = [...new Set(sessionLogs.map(log => String(log?.court || (log?.courtNumber ? `Court ${log.courtNumber}` : '')).trim()).filter(Boolean))];
    return {
      id,
      title: String(session?.sessionName || 'Open Play Session'),
      sessionName: String(session?.sessionName || 'Open Play Session'),
      date: endParts.date || startParts.date || '',
      startTime: startParts.time || '',
      endTime: endParts.time || '',
      startedAt: session?.startedAt || start || null,
      endedAt: session?.endedAt || null,
      status: 'Completed',
      isLive: false,
      capacity: null,
      attendees: normalizeAttendees(people),
      courtNames: courts,
      matchCount: Number(session?.matchCount) || sessionLogs.length,
      playerCount: Number(session?.playerCount) || people.length,
      location: String(session?.duprLocation || session?.location || '').trim(),
      locationCoordinates: normalizeMapLocationCoordinates(session?.duprLocationCoordinates || session?.locationCoordinates),
      raw: session
    };
  });

  let liveSession = null;
  if (activeSessionId) {
    const saved = Array.isArray(attendanceBySession[activeSessionId]) ? attendanceBySession[activeSessionId] : null;
    const queueRoster = [...asArray(appState?.players), ...asArray(appState?.left)];
    const people = saved || queueRoster.filter((person, index, all) => {
      const key = String(person?.id ?? normalizeName(person?.name));
      return normalizeName(person?.name) && all.findIndex(item => String(item?.id ?? normalizeName(item?.name)) === key) === index;
    });
    const start = sessionTimestampFromId(activeSessionId) || (asArray(appState?.logs)[0]?.startedAt || null);
    const startParts = localDateParts(start);
    const liveLogs = asArray(appState?.logs);
    const courts = asArray(appState?.courts).map(court => String(court?.name || (court?.number ? `Court ${court.number}` : '')).trim()).filter(Boolean);
    liveSession = {
      id: activeSessionId,
      title: String(appState?.sessionName || 'Current Open Play'),
      sessionName: String(appState?.sessionName || 'Current Open Play'),
      date: startParts.date || todayISO(),
      startTime: startParts.time || '',
      endTime: '',
      startedAt: start,
      endedAt: null,
      status: 'Live',
      isLive: true,
      capacity: null,
      attendees: normalizeAttendees(people),
      courtNames: courts,
      matchCount: liveLogs.length,
      playerCount: people.length,
      location: String(appState?.duprLocation || appState?.location || '').trim(),
      locationCoordinates: normalizeMapLocationCoordinates(appState?.duprLocationCoordinates || appState?.locationCoordinates),
      raw: appState
    };
  }

  const sessions = [...(liveSession ? [liveSession] : []), ...archiveSessions.filter(session => session.id !== activeSessionId)]
    .sort((a, b) => (a.isLive ? -1 : b.isLive ? 1 : String(b.endedAt || b.startedAt || '').localeCompare(String(a.endedAt || a.startedAt || ''))));

  const logs = [];
  const logKeys = new Set();
  const appendLog = (log, fallbackSessionId = '') => {
    const sessionId = getLogSessionId(log) || fallbackSessionId;
    const id = String(log?.id ?? `log-${logs.length}`);
    const key = `${sessionId}|${id}`;
    if (logKeys.has(key)) return;
    logKeys.add(key);
    const teamANames = getTeamNames(log, 'team1');
    const teamBNames = getTeamNames(log, 'team2');
    const score = scoreParts(log);
    const playedAt = log?.endedAt || log?.startedAt || null;
    const dateParts = localDateParts(playedAt);
    const winnerTeam = Number(log?.winnerTeam);
    const scoreWinner = score.isScored && score.scoreA !== score.scoreB ? (score.scoreA > score.scoreB ? 'A' : 'B') : '';
    const winnerText = normalizeName(log?.winner);
    const winnerFromText = winnerText && [teamANames, teamBNames].findIndex(names => {
      const joined = normalizeName(names.join(' & '));
      return joined === winnerText || (names.length > 0 && names.every(name => winnerText.includes(normalizeName(name))));
    });
    const winner = winnerTeam === 1 ? 'A' : winnerTeam === 2 ? 'B' : (winnerFromText === 0 ? 'A' : winnerFromText === 1 ? 'B' : scoreWinner);
    logs.push({
      id,
      key,
      sessionId,
      sessionName: String(log?.sessionName || sessions.find(item => item.id === sessionId)?.title || 'Open Play'),
      date: dateParts.date,
      time: dateParts.time,
      timeLabel: fmtMatchTime(playedAt),
      durationLabel: formatMatchDuration(log?.duration, log?.startedAt, log?.endedAt),
      playedAt,
      courtId: String(log?.courtNumber ?? log?.court ?? 'Court'),
      courtName: String(log?.court || (log?.courtNumber ? `Court ${log.courtNumber}` : 'Court')),
      teamA: asArray(log?.team1Ids).map(String),
      teamB: asArray(log?.team2Ids).map(String),
      teamANames,
      teamBNames,
      scoreA: score.scoreA,
      scoreB: score.scoreB,
      scoreLabel: score.scoreLabel,
      isScored: score.isScored,
      winner,
      winnerText: String(log?.winner || ''),
      recordingMode: String(log?.recordingMode || ''),
      duprMatch: log?.duprMatch === true,
      type: String(log?.type || (teamANames.length === 1 ? 'Singles' : 'Doubles')),
      raw: log
    });
  };
  asArray(rawRecords.logs).forEach(log => appendLog(log));
  if (liveSession) asArray(appState?.logs).forEach(log => appendLog(log, activeSessionId));
  logs.sort((a, b) => String(b.playedAt || '').localeCompare(String(a.playedAt || '')));

  const players = rawPlayers.map(player => ({
    id: String(player?.cloudId ?? player?.id ?? `player-${normalizeName(player?.name)}`),
    cloudId: String(player?.cloudId ?? ''),
    name: String(player?.name || 'Unnamed player'),
    nickname: String(player?.nickname || ''),
    category: categoryName(player?.category),
    categoryCode: categoryCode(player?.category),
    gender: String(player?.gender || ''),
    dupr: player?.dupr === '' || player?.dupr === null || player?.dupr === undefined ? null : (Number.isFinite(Number(player.dupr)) ? Number(player.dupr) : null),
    duprId: String(player?.duprId || player?.duprID || player?.dupr_id || ''),
    selfRating: String(player?.selfRating || player?.self_rating || ''),
    matches: Number(player?.matches) || 0,
    wins: Number(player?.wins) || 0,
    losses: Number(player?.losses) || 0,
    phone: String(player?.phone || ''),
    notes: '',
    avatarId: String(player?.avatarId || ''),
    registeredAt: player?.registeredAt || player?.registered_at || player?.createdAt || player?.created_at || null,
    raw: player
  }));

  // Older queue logs may contain participants that have since been removed from
  // Registered Player Cloud. Keep those names visible in historical match rows.
  const knownNames = new Set(players.map(player => normalizeName(player.name)));
  for (const match of logs) {
    for (const name of [...match.teamANames, ...match.teamBNames]) {
      const key = normalizeName(name);
      if (!key || knownNames.has(key)) continue;
      knownNames.add(key);
      players.push({ id: `history-${key}`, cloudId: '', name, nickname: '', category: 'Unspecified', categoryCode: '', gender: '', dupr: null, duprId: '', selfRating: '', matches: 0, wins: 0, losses: 0, phone: '', notes: '', historicalOnly: true, raw: null });
    }
  }

  const locations = [liveSession?.location, ...archiveSessions.map(item => item.location)].filter(Boolean);
  const venueName = locations[0] || '';
  const venues = venueName ? [{ id: 'legacy-session-location', name: venueName, address: venueName, city: '', notes: '' }] : [];
  const courtMap = new Map();
  if (liveSession && appState) {
    asArray(appState.courts).forEach(court => {
      const id = String(court?.id ?? court?.number ?? court?.name ?? courtMap.size + 1);
      courtMap.set(id, {
        id,
        name: String(court?.name || (court?.number ? `Court ${court.number}` : 'Court')),
        status: court?.playing ? 'Active' : court?.waitingOnly ? 'Waiting' : asArray(court?.players).length ? 'Ready' : 'Available',
        venueId: venues[0]?.id || '',
        surface: 'Pickleball court',
        players: asArray(court?.players).length
      });
    });
  }
  if (!courtMap.size) {
    for (const match of logs) {
      const name = match.courtName || 'Court';
      const id = String(match.courtId || name);
      if (!courtMap.has(id)) courtMap.set(id, { id, name, status: 'Used in history', venueId: '', surface: 'Pickleball court', players: 0 });
    }
  }
  const courts = [...courtMap.values()];
  const organizer = payload?.organizer || {};
  const settings = {
    organizerName: String(organizer.displayName || organizer.username || 'Organizer'),
    clubName: String(organizer.displayName || 'HUSAY DINKERS'),
    contact: '',
    timezone: 'Asia/Manila',
    duprId: String(organizer.duprId || ''),
    logo: organizer.logo || ''
  };

  return {
    players,
    sessions,
    matches: logs,
    venues,
    courts,
    registeredCourts: asArray(organizer.registeredCourts).map(court => ({
      id: String(court?.id || ''),
      name: String(court?.name || 'Registered Court'),
      location: String(court?.location || '').trim(),
      logo: registeredCourtLogo(court),
      locationCoordinates: normalizeMapLocationCoordinates(court?.locationCoordinates || court?.coordinates || court),
      registeredAt: court?.registeredAt || null
    })).filter(court => court.id && court.location),
    settings,
    liveSessionId: activeSessionId,
    liveState: appState,
    queueCount: asArray(appState?.queue).length,
    onCourtCount: asArray(appState?.courts).reduce((sum, court) => sum + (court?.playing ? asArray(court.players).length : 0), 0)
  };
}

async function refreshData({ silent = false } = {}) {
  if (dashboardRefreshTimer) { window.clearTimeout(dashboardRefreshTimer); dashboardRefreshTimer = null; }
  const requestId = ++state.refreshRequest;
  if (state.refreshController) state.refreshController.abort();
  const controller = new AbortController();
  state.refreshController = controller;

  try {
    const response = await api('/api/organizer-dashboard', { signal: controller.signal });
    if (requestId !== state.refreshRequest) return false;

    const nextOrganizer = response.organizer || {};
    const nextData = normalizeLegacyDashboard(response);
    // Raw records stay in state.raw for exports. Compare only fields that drive
    // the UI instead of serializing nested copies of every source record.
    const stripRaw = ({ raw, ...item }) => item;
    const signaturePlayers = list => asArray(list).map(person => {
      if (!person || typeof person !== 'object') return person;
      return { id: person.id, name: person.name, nickname: person.nickname, waitingSince: person.waitingSince, queuedAt: person.queuedAt };
    });
    const live = nextData.liveState;
    const liveStateSignature = live ? {
      players: signaturePlayers(live.players),
      left: signaturePlayers(live.left),
      queue: signaturePlayers(live.queue),
      courts: asArray(live.courts).map(court => ({
        id: court?.id, number: court?.number, name: court?.name, playing: court?.playing,
        waitingOnly: court?.waitingOnly, waitingOrder: court?.waitingOrder, start: court?.start,
        players: signaturePlayers(court?.players)
      }))
    } : null;
    const nextSignature = JSON.stringify({
      organizer: nextOrganizer,
      data: {
        players: nextData.players.map(stripRaw),
        sessions: nextData.sessions.map(stripRaw),
        matches: nextData.matches.map(stripRaw),
        venues: nextData.venues,
        courts: nextData.courts,
        registeredCourts: nextData.registeredCourts,
        settings: nextData.settings,
        liveSessionId: nextData.liveSessionId,
        liveState: liveStateSignature,
        queueCount: nextData.queueCount,
        onCourtCount: nextData.onCourtCount
      }
    });
    const hadSignature = Boolean(state.dataSignature);
    const changed = nextSignature !== state.dataSignature;

    state.raw = response;
    state.organizer = nextOrganizer;
    updateOrganizerProfileDisplay(nextOrganizer);
    state.data = nextData;
    state.dataSignature = nextSignature;
    updateNavigation();

    if (!silent) {
      renderPage(true);
    } else if (changed && hadSignature) {
      // Do not mutate dashboard layout while the organizer is scrolled down.
      // Live data is still fetched and stored; the latest view is applied only
      // after the user returns to the top of the page-content scroller.
      if (state.modal || isDashboardInteractionActive() || isDashboardPageScrolled()) state.pendingRender = true;
      else renderPageStable();
    }
    return true;
  } catch (error) {
    if (requestId !== state.refreshRequest || error?.name === 'AbortError') return false;
    if (!silent) {
      $('#pageContent').innerHTML = `<div class="empty-state"><span class="empty-icon">${icon('info')}</span><strong>Unable to load your queueing records</strong><p>${escapeHTML(error.message || 'Check the server connection and try again.')}</p><a class="btn btn-primary btn-sm" href="/?next=manage">Return to organizer sign in</a></div>`;
    }
    return false;
  } finally {
    if (requestId === state.refreshRequest) state.refreshController = null;
  }
}
function sortedSessions() { return [...(state.data?.sessions || [])]; }
function allAttendance() { return (state.data?.sessions || []).flatMap(session => (session.attendees || []).map(person => ({ ...person, session }))); }
function countAttendanceEntries() { return (state.data?.sessions || []).reduce((total, session) => total + (session.attendees?.length || 0), 0); }
function findPlayer(id) { return state.data?.players.find(player => String(player.id) === String(id)); }
function playerName(id) { return findPlayer(id)?.name || 'Player'; }
let playerStatsIndex = null;
function getPlayerStatsIndex() {
  if (playerStatsIndex?.signature === state.dataSignature) return playerStatsIndex;

  const attendanceByName = new Map();
  for (const session of state.data?.sessions || []) {
    for (const person of session.attendees || []) {
      const key = normalizeName(person.playerName || person.name);
      if (key) attendanceByName.set(key, (attendanceByName.get(key) || 0) + 1);
    }
  }

  const matchStatsByName = new Map();
  for (const match of state.data?.matches || []) {
    const teamA = new Set((match.teamANames || []).map(normalizeName).filter(Boolean));
    const teamB = new Set((match.teamBNames || []).map(normalizeName).filter(Boolean));
    const participants = new Set([...teamA, ...teamB]);
    for (const key of participants) {
      const stats = matchStatsByName.get(key) || { matches: 0, wins: 0 };
      stats.matches += 1;
      if ((match.winner === 'A' && teamA.has(key)) || (match.winner === 'B' && teamB.has(key))) stats.wins += 1;
      matchStatsByName.set(key, stats);
    }
  }

  playerStatsIndex = { signature: state.dataSignature, attendanceByName, matchStatsByName, cache: new Map() };
  return playerStatsIndex;
}
function playerStats(player) {
  const index = getPlayerStatsIndex();
  const nameKey = normalizeName(player.name);
  const cacheKey = `${nameKey}|${Number(player.wins) || 0}|${Number(player.losses) || 0}|${Number(player.matches) || 0}`;
  if (index.cache.has(cacheKey)) return index.cache.get(cacheKey);

  const logged = index.matchStatsByName.get(nameKey) || { matches: 0, wins: 0 };
  const wins = Math.max(Number(player.wins) || 0, logged.wins);
  const lossesFromLogs = Math.max(0, logged.matches - logged.wins);
  const losses = Math.max(Number(player.losses) || 0, lossesFromLogs);
  const matches = Math.max(Number(player.matches) || 0, logged.matches, wins + losses);
  const result = { wins, losses, matches, attendance: index.attendanceByName.get(nameKey) || 0 };
  index.cache.set(cacheKey, result);
  return result;
}
function visibleRows(rows) {
  if (!state.query) return rows;
  const q = state.query.toLocaleLowerCase();
  return rows.filter(row => JSON.stringify(row).toLocaleLowerCase().includes(q));
}
function sessionStatus(session) { return session.isLive ? 'Live' : 'Completed'; }
function sessionStatusBadge(status) {
  const cls = status === 'Live' ? 'live' : 'ended';
  return `<span class="status-pill ${cls}">${escapeHTML(status)}</span>`;
}
function sessionDateLabel(session) { return session.date ? fmtDate(session.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Date unavailable'; }
function sessionTimeLabel(session) { return session.startTime ? `${session.startTime}${session.endTime ? ` – ${session.endTime}` : session.isLive ? ' · In progress' : ''}` : (session.isLive ? 'In progress' : 'Time unavailable'); }
function sessionLocationLabel(session) { return session.location || 'Location not saved in this session'; }
function sessionCourtsLabel(session) { return (session.courtNames || []).join(', ') || 'Court details not saved'; }
function sessionPlayersLabel(session) { return `${(session.attendees || []).length} player${(session.attendees || []).length === 1 ? '' : 's'}`; }
function getLiveSession() { return state.data?.sessions.find(session => session.isLive) || null; }
function getRegistrationUrl(session = getLiveSession()) {
  if (!session || !state.organizer?.slug) return '';
  const params = new URLSearchParams({ organizer: state.organizer.slug, session: session.id });
  return `/registration?${params.toString()}`;
}
function navigateTo(path) { window.location.assign(path); }
function openToolTab(path) { window.open(path, '_blank', 'noopener'); }

function organizerClubName() {
  return String(state.organizer?.displayName || state.organizer?.clubName || 'PICKLE POINT MATCH').trim() || 'PICKLE POINT MATCH';
}
function pageHeading(eyebrow, title, subtitle, actions = '') {
  const brandedEyebrow = String(eyebrow).replace(/^HUSAY DINKERS(?=\s*\/)/i, organizerClubName());
  return `<div class="page-heading"><div class="heading-copy"><span class="eyebrow">${escapeHTML(brandedEyebrow)}</span><h1>${escapeHTML(title)}</h1><p class="subtitle">${escapeHTML(subtitle)}</p></div><div class="heading-actions">${actions}</div></div>`;
}
function statCard(label, value, foot, iconName, dark = false) {
  const target = Number(value);
  const isCount = String(value).trim() !== '' && Number.isFinite(target);
  const initialValue = isCount ? '0' : value;
  const countKey = `stat:${String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return `<article class="stat-card ${dark ? 'dark' : 'light'}"><div><p class="stat-label">${escapeHTML(label)}</p><p class="stat-value" aria-live="off"${isCount ? ` data-count-target="${target}" data-count-key="${escapeHTML(countKey)}"` : ''}>${escapeHTML(initialValue)}</p><div class="stat-foot">${escapeHTML(foot)}</div></div><span class="stat-icon">${icon(iconName)}</span></article>`;
}
function metricCount(pageKey, metricKey, value, id = '') {
  const rawValue = String(value ?? 0);
  const target = Number(rawValue);
  const isCount = rawValue.trim() !== '' && Number.isFinite(target);
  const idAttribute = id ? ` id="${escapeHTML(id)}"` : '';
  const countAttributes = isCount
    ? ` data-count-target="${target}" data-count-key="metric:${escapeHTML(pageKey)}:${escapeHTML(metricKey)}"`
    : '';
  return `<strong${idAttribute} aria-live="off"${countAttributes}>${isCount ? '0' : escapeHTML(rawValue)}</strong>`;
}

// Dashboard and page metric readouts share one counter so values animate consistently.
const dashboardCountFrames = new WeakMap();
function captureDashboardCountValues() {
  const values = new Map();
  $$('#pageContent [data-count-target][data-count-key]').forEach(node => {
    const key = node.dataset.countKey;
    const value = Number(String(node.textContent || '').replace(/,/g, '').trim());
    if (key && Number.isFinite(value)) values.set(key, value);
  });
  return values;
}
function animateDashboardCountValues(previousValues = new Map()) {
  $$('#pageContent [data-count-target][data-count-key]').forEach(node => {
    const target = Number(node.dataset.countTarget);
    if (!Number.isFinite(target)) return;

    const previousFrame = dashboardCountFrames.get(node);
    if (previousFrame) cancelAnimationFrame(previousFrame);

    const key = node.dataset.countKey;
    const previousValue = previousValues.has(key) ? previousValues.get(key) : 0;
    const start = Number.isFinite(previousValue) ? previousValue : 0;
    const display = value => String(Math.round(value));
    node.textContent = display(start);

    if (start === target) {
      node.textContent = display(target);
      dashboardCountFrames.delete(node);
      return;
    }

    const duration = node.classList.contains('attendance-bar-value') ? 720 : 760;
    let startedAt = 0;
    const tick = timestamp => {
      if (!node.isConnected) {
        dashboardCountFrames.delete(node);
        return;
      }
      if (!startedAt) startedAt = timestamp;
      const progress = Math.min(1, (timestamp - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      node.textContent = display(start + (target - start) * eased);
      if (progress < 1) {
        dashboardCountFrames.set(node, requestAnimationFrame(tick));
      } else {
        node.textContent = display(target);
        dashboardCountFrames.delete(node);
      }
    };
    dashboardCountFrames.set(node, requestAnimationFrame(tick));
  });
}

const attendanceBarFrames = new WeakMap();
const attendanceBarTargets = new WeakMap();
function animateDashboardAttendanceBars() {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  $$('.page-dashboard .attendance-bar-fill').forEach(fill => {
    const visual = fill.closest('.attendance-bar-visual');
    const targetHeight = visual?.style.getPropertyValue('--bar-height') || '0%';
    const previousTarget = attendanceBarTargets.get(fill);
    const previousFrame = attendanceBarFrames.get(fill);
    if (previousFrame) cancelAnimationFrame(previousFrame);

    // Unchanged bars stay settled during routine background refreshes.
    if (previousTarget === targetHeight) {
      fill.style.setProperty('--bar-scale', '1');
      return;
    }
    attendanceBarTargets.set(fill, targetHeight);
    fill.style.setProperty('--bar-scale', '0');
    if (reducedMotion) {
      fill.style.setProperty('--bar-scale', '1');
      attendanceBarFrames.delete(fill);
      return;
    }

    // Give the browser a paint opportunity with the bar collapsed before raising it.
    // A single requestAnimationFrame can apply both states before the first paint,
    // which makes the CSS transition appear to jump straight to its final height.
    const firstFrame = requestAnimationFrame(() => {
      if (!fill.isConnected) {
        attendanceBarFrames.delete(fill);
        return;
      }
      const secondFrame = requestAnimationFrame(() => {
        if (fill.isConnected) fill.style.setProperty('--bar-scale', '1');
        attendanceBarFrames.delete(fill);
      });
      attendanceBarFrames.set(fill, secondFrame);
    });
    attendanceBarFrames.set(fill, firstFrame);
  });
}
function panelTitle(title, iconName, action = '') {
  return `<div class="panel-heading"><h2 class="panel-title"><span class="mini-icon">${icon(iconName)}</span>${escapeHTML(title)}</h2>${action}</div>`;
}
function emptyState(title, message, actionLabel = '', action = '') {
  return `<div class="empty-state"><span class="empty-icon">${icon('info')}</span><strong>${escapeHTML(title)}</strong><p>${escapeHTML(message)}</p>${actionLabel ? `<button class="btn btn-primary btn-sm" data-action="${escapeHTML(action)}">${escapeHTML(actionLabel)}</button>` : ''}</div>`;
}
function chartMarkup(sessions) {
  const last = sessions.filter(session => !session.isLive).slice(0, 6).reverse();
  if (!last.length) return '<div class="chart-empty">Attendance activity will appear after an open-play session is completed.</div>';
  const values = last.map(session => (session.attendees || []).length);
  const max = Math.max(4, ...values) + 1;
  const bars = last.map((session, index) => {
    const value = values[index];
    const height = value ? Math.max(5, (value / max) * 100) : 0;
    const label = fmtDate(session.date, { month: 'short', day: 'numeric' });
    const countKey = `attendance-bar:${String(session.id ?? index)}`;
    return `<div class="attendance-bar-item" title="${escapeHTML(label)}: ${value} players"><div class="attendance-bar-visual" style="--bar-height:${height}%;--bar-scale:0"><span class="attendance-bar-value" data-count-target="${value}" data-count-key="${escapeHTML(countKey)}" aria-hidden="true">0</span><span class="attendance-bar-fill"></span></div><span class="attendance-bar-date">${escapeHTML(label)}</span></div>`;
  }).join('');
  return `<div class="attendance-chart" role="img" aria-label="Bar chart showing player attendance across the latest completed open-play sessions"><div class="attendance-y-axis"><span>${max}</span><span>${Math.round(max / 2)}</span><span>0</span></div><div class="attendance-plot"><span class="attendance-grid-line grid-top"></span><span class="attendance-grid-line grid-middle"></span><span class="attendance-grid-line grid-bottom"></span><div class="attendance-bars" style="--bar-count:${last.length}">${bars}</div></div></div>`;
}
function liveBanner() {
  const session = getLiveSession();
  if (!session) return '';
  const registrationUrl = getRegistrationUrl(session);
  const queueCount = Number(state.data.queueCount) || 0;
  const courtsPlaying = asArray(state.data.liveState?.courts).filter(court => court?.playing).length;
  return `<section class="live-session-banner"><div><strong><span class="status-pill live">LIVE NOW</span> ${escapeHTML(session.title)}</strong><p>${sessionPlayersLabel(session)} checked in · ${queueCount} waiting in queue · ${courtsPlaying} active court${courtsPlaying === 1 ? '' : 's'}</p></div><div class="live-session-actions"><a class="btn btn-sm btn-primary" href="/queueing" target="_blank" rel="noopener">Open Queueing</a>${registrationUrl ? `<a class="btn btn-sm" href="${escapeHTML(registrationUrl)}" target="_blank" rel="noopener">Registration</a>` : ''}<a class="btn btn-sm" href="/live" target="_blank" rel="noopener">Live View</a></div></section>`;
}
let rankedPlayersCacheSignature = '';
let rankedPlayersCache = [];
function compareRankedPlayers(a, b) {
  const sa = playerStats(a), sb = playerStats(b);
  const rateA = sa.matches ? sa.wins / sa.matches : 0;
  const rateB = sb.matches ? sb.wins / sb.matches : 0;
  return sb.wins - sa.wins || rateB - rateA || sb.matches - sa.matches || a.name.localeCompare(b.name);
}
function getRankedPlayers() {
  const signature = state.dataSignature || 'initial';
  if (rankedPlayersCacheSignature === signature) return rankedPlayersCache;
  const players = [...(state.data?.players || [])];
  players.sort(compareRankedPlayers);
  rankedPlayersCacheSignature = signature;
  rankedPlayersCache = players;
  return rankedPlayersCache;
}
// Dashboard only needs its first 20 rows. Keep the list bounded instead of
// sorting every player before the dashboard can paint.
function topRankedPlayers(limit = 5) {
  if (limit > 100) return getRankedPlayers().slice(0, limit);
  const top = [];
  for (const player of state.data?.players || []) {
    let low = 0, high = top.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (compareRankedPlayers(player, top[middle]) < 0) high = middle;
      else low = middle + 1;
    }
    if (low < limit) {
      top.splice(low, 0, player);
      if (top.length > limit) top.pop();
    } else if (top.length < limit) {
      top.push(player);
    }
  }
  return top;
}
function scheduleIdleTask(callback, timeout = 180) {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(callback, { timeout });
  } else {
    window.setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }), 24);
  }
}
function liveTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value ?? '').trim();
  if (!text) return NaN;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : NaN;
}
function elapsedClockLabel(value) {
  const started = liveTimestamp(value);
  if (!Number.isFinite(started) || started <= 0) return '--:--';
  const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}
function waitingClockLabel(value) {
  const started = liveTimestamp(value);
  if (!Number.isFinite(started) || started <= 0) return '0m';
  const minutes = Math.max(0, Math.floor((Date.now() - started) / 60000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
function livePlayerLabel(player) {
  if (!player) return 'Player';
  const name = String(player.name || 'Player').trim();
  const nickname = String(player.nickname || '').trim();
  return nickname && normalizeName(nickname) !== normalizeName(name) ? `${name} (${nickname})` : name;
}
function courtPlayerChip(player, waiting = false) {
  if (!player) return '';
  const waitStart = player.waitingSince || player.queuedAt || '';
  return `<span class="court-player-chip" title="${escapeHTML(livePlayerLabel(player))}"><span class="court-player-name">${escapeHTML(livePlayerLabel(player))}</span>${waiting ? `<small data-wait-clock="${escapeHTML(String(waitStart))}">${escapeHTML(waitingClockLabel(waitStart))} wait</small>` : ''}</span>`;
}
function courtTile(court, playersById) {
  const waitingOnly = Boolean(court.waitingOnly);
  const playing = Boolean(court.playing);
  const status = waitingOnly ? 'UP NEXT' : playing ? 'PLAYING' : 'READY';
  const statusClass = waitingOnly ? 'up-next' : playing ? 'playing' : 'ready';
  const rawPlayers = asArray(court.players);
  const players = rawPlayers.map(entry => entry && typeof entry === 'object' ? entry : playersById.get(String(entry))).filter(Boolean);
  const courtNumber = Number(court.number);
  const courtName = waitingOnly
    ? (String(court.name || '').trim() || `Up Next ${court.waitingOrder || ''}`).trim()
    : (String(court.name || '').trim() || (courtNumber > 0 ? `Court ${courtNumber}` : 'Court'));
  const start = playing ? (court.start || '') : '';
  const timer = `<span class="court-tile-timer${playing ? ' is-running' : ''}" ${playing && start ? `data-court-clock="${escapeHTML(String(start))}"` : ''}><small>Timer</small><strong>${playing ? escapeHTML(elapsedClockLabel(start)) : '--:--'}</strong></span>`;
  const roster = players.length
    ? players.slice(0, 6).map(player => courtPlayerChip(player)).join('') + (players.length > 6 ? `<span class="court-player-more">+${players.length - 6} more</span>` : '')
    : `<span class="court-player-empty">${waitingOnly ? 'Waiting for next lineup' : 'No players assigned yet'}</span>`;
  return `<article class="court-tile court-tile-${statusClass}" title="${escapeHTML(courtName)} · ${status}"><div class="court-tile-heading"><strong>${escapeHTML(courtName)}</strong><span class="court-tile-status">${status}</span></div><div class="court-tile-meta">${timer}<span class="court-tile-player-count">${players.length} player${players.length === 1 ? '' : 's'}</span></div><div class="court-tile-roster">${roster}</div></article>`;
}
function waitingQueueTile(liveState, playersById) {
  const queue = asArray(liveState?.queue).map(entry => entry && typeof entry === 'object' ? entry : playersById.get(String(entry))).filter(Boolean);
  if (!queue.length) return '';
  const roster = queue.slice(0, 6).map(player => courtPlayerChip(player, true)).join('') + (queue.length > 6 ? `<span class="court-player-more">+${queue.length - 6} more waiting</span>` : '');
  return `<article class="court-tile court-tile-waiting" title="Players waiting in the queue"><div class="court-tile-heading"><strong>Waiting Queue</strong><span class="court-tile-status">WAITING</span></div><div class="court-tile-meta"><span class="court-tile-player-count">${queue.length} player${queue.length === 1 ? '' : 's'} waiting</span></div><div class="court-tile-roster">${roster}</div></article>`;
}
function courtStatusMarkup(live) {
  if (!live) return '<div class="court-empty-note"><strong>No live session</strong><span>There is no active open-play session, so no live court tiles are shown.</span></div>';
  const liveState = state.data?.liveState || {};
  const roster = [...asArray(liveState.players), ...asArray(liveState.left)];
  const playersById = new Map(roster.map(player => [String(player?.id), player]));
  // Keep the visible strip in court-number order so Court 1 is always the first card.
  const courts = asArray(liveState.courts).map((court, index) => ({ court, index })).sort((a, b) => {
    const sortNumber = court => {
      const explicit = Number(court?.number);
      if (Number.isFinite(explicit) && explicit > 0) return explicit;
      const fromName = String(court?.name || '').match(/\bcourt\s*#?\s*(\d+)/i);
      return fromName ? Number(fromName[1]) : Number.MAX_SAFE_INTEGER;
    };
    return sortNumber(a.court) - sortNumber(b.court) || a.index - b.index;
  }).map(entry => entry.court);
  const courtTiles = courts.map(court => courtTile(court, playersById));
  const queueTile = waitingQueueTile(liveState, playersById);
  const tiles = [...courtTiles, queueTile].filter(Boolean);
  return tiles.length
    ? tiles.join('')
    : '<div class="court-empty-note"><strong>No live court available</strong><span>No courts or waiting players are configured for this session yet. Add courts or check in players in Queueing.</span></div>';
}
const REGISTERED_COURT_NEW_MARKER_WINDOW_MS = 10 * 60 * 1000;
function registeredCourtMapMarkerStatus(registeredAt, isLive, now = Date.now()) {
  if (isLive) return 'live';
  const registeredTime = Date.parse(String(registeredAt || ''));
  if (Number.isFinite(registeredTime) && now - registeredTime < REGISTERED_COURT_NEW_MARKER_WINDOW_MS) return 'new';
  return 'idle';
}
function updateRegisteredCourtMapMarkerBorders() {
  const now = Date.now();
  document.querySelectorAll('.dashboard-map-pin-court[data-registered-court-marker="true"]').forEach(marker => {
    const status = registeredCourtMapMarkerStatus(
      marker.dataset.registeredAt,
      marker.dataset.registeredCourtLive === 'true',
      now
    );
    marker.classList.toggle('is-live', status === 'live');
    marker.classList.toggle('is-new', status === 'new');
  });
}
function updateCourtStatusClocks() {
  updateRegisteredCourtMapMarkerBorders();
  // Per-second timer text can change card dimensions while the page is being
  // read. Pause these tiny visual updates until the dashboard is back at top.
  if (isDashboardPageScrolled()) return;
  document.querySelectorAll('[data-court-clock]').forEach(node => {
    const value = node.querySelector('strong');
    const nextLabel = elapsedClockLabel(node.dataset.courtClock);
    if (value && value.textContent !== nextLabel) value.textContent = nextLabel;
  });
  document.querySelectorAll('[data-wait-clock]').forEach(node => {
    const nextLabel = `${waitingClockLabel(node.dataset.waitClock)} wait`;
    if (node.textContent !== nextLabel) node.textContent = nextLabel;
  });
}
function mapSessionsForPins(includeRegisteredCourts = false) {
  const byLocation = new Map();
  const matchCountBySession = new Map();
  for (const match of (state.data?.matches || [])) {
    const key = String(match.sessionId || '');
    if (key) matchCountBySession.set(key, (matchCountBySession.get(key) || 0) + 1);
  }
  for (const session of (state.data?.sessions || [])) {
    // The marker address must come from the saved Location field only.
    // A session title/name is intentionally never used as a geocoding fallback.
    const location = String(session.location || session.raw?.duprLocation || session.raw?.location || '').trim();
    if (!location) continue;
    const key = normalizeName(location);
    if (!key) continue;
    const coordinates = normalizeMapLocationCoordinates(session.locationCoordinates || session.raw?.duprLocationCoordinates || session.raw?.locationCoordinates);
    if (!byLocation.has(key)) byLocation.set(key, { location, coordinates, sessions: [], courts: [] });
    else if (!byLocation.get(key).coordinates && coordinates) byLocation.get(key).coordinates = coordinates;
    byLocation.get(key).sessions.push({
      id: String(session.id || ''),
      title: String(session.title || 'Open Play Session'),
      date: String(session.date || ''),
      time: sessionTimeLabel(session),
      startedAt: session.startedAt || null,
      isLive: Boolean(session.isLive),
      playerCount: (session.attendees || []).length,
      matchCount: matchCountBySession.get(String(session.id)) || 0,
      courtNames: asArray(session.courtNames),
      locationCoordinates: normalizeMapLocationCoordinates(session.locationCoordinates || session.raw?.duprLocationCoordinates || session.raw?.locationCoordinates)
    });
  }

  const sessionLocations = [...byLocation.values()].map(item => ({
    ...item,
    isLive: asArray(item.sessions).some(entry => entry.isLive === true)
  }));
  if (!includeRegisteredCourts) return sessionLocations;

  // Merge a session into a registered court when the saved address or GPS pin
  // identifies the same venue. This avoids two overlapping pins and lets the
  // registered court marker show the live state of its current session.
  const distanceBetweenMapPoints = (first, second) => {
    const a = normalizeMapLocationCoordinates(first);
    const b = normalizeMapLocationCoordinates(second);
    if (!a || !b) return Infinity;
    const radians = value => value * Math.PI / 180;
    const dLat = radians(b.lat - a.lat);
    const dLon = radians(b.lon - a.lon);
    const lat1 = radians(a.lat), lat2 = radians(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  };
  const matchedSessionLocations = new Set();
  const registeredCourtLocations = asArray(state.data?.registeredCourts).map(court => {
    const location = String(court?.location || '').trim();
    const id = String(court?.id || '').trim();
    if (!location || !id) return null;
    const coordinates = normalizeMapLocationCoordinates(court.locationCoordinates || court.coordinates || court);
    const locationKey = normalizeName(location);
    const matchingSessions = sessionLocations.filter(sessionLocation => {
      const sameAddress = normalizeName(sessionLocation.location) === locationKey;
      const sessionCoordinates = sessionLocation.coordinates || asArray(sessionLocation.sessions)
        .map(entry => normalizeMapLocationCoordinates(entry.locationCoordinates)).find(Boolean);
      const sameMapPoint = distanceBetweenMapPoints(coordinates, sessionCoordinates) <= 200;
      if (!sameAddress && !sameMapPoint) return false;
      matchedSessionLocations.add(sessionLocation);
      return true;
    }).flatMap(sessionLocation => asArray(sessionLocation.sessions));
    const isLive = matchingSessions.some(entry => entry.isLive === true);
    return {
      mapKey: `registered-court:${id}`,
      location,
      coordinates,
      sessions: matchingSessions,
      isLive,
      courts: [{
        id,
        name: String(court.name || 'Registered Court'),
        logo: registeredCourtLogo(court),
        locationCoordinates: coordinates,
        registeredAt: court.registeredAt || null,
        isLive
      }]
    };
  }).filter(Boolean);

  // Session-only pins stay visible, but a session at a registered court is
  // represented by that court's branded marker instead of a duplicate pin.
  return [
    ...sessionLocations.filter(item => !matchedSessionLocations.has(item)),
    ...registeredCourtLocations
  ];
}
function mapCard(session, mapId = 'courtLocationMap') {
  // The dashboard overview and the Courts & Locations map both show every
  // registered court, not only locations that currently have a live session.
  const includeRegisteredCourts = ['venuesCourtMap', 'dashboardCourtMap'].includes(mapId);
  const locations = mapSessionsForPins(includeRegisteredCourts);
  const payload = JSON.stringify(locations).replace(/</g, '\\u003c');
  const count = locations.length;
  const liveSessionId = session?.isLive ? String(session.id || '') : '';
  return `<section class="panel panel-pad map-panel">${panelTitle('Court Locations in the Philippines', 'pin', `<button type="button" class="text-link map-open-link" data-open-map-modal="${escapeHTML(liveSessionId)}" data-map-include-registered="${includeRegisteredCourts ? 'true' : 'false'}">Open 3D Map ${icon('arrow')}</button>`)}<div id="${escapeHTML(mapId)}" class="interactive-map map-preview" data-map-variant="preview" data-map-include-registered="${includeRegisteredCourts ? 'true' : 'false'}" data-map-focus-session="${escapeHTML(liveSessionId)}" data-map-locations="${escapeHTML(payload)}" role="application" aria-label="Interactive 3D map of the Philippines with saved open-play court locations"><div class="map-loading">Loading Philippines 3D map…</div></div><div class="map-preview-footer"><span class="map-count">${count} saved location${count === 1 ? '' : 's'}</span><span>Drag to move · scroll or use + / − to zoom</span></div><p class="map-status" data-map-status="${escapeHTML(mapId)}">${includeRegisteredCourts ? 'Registered court locations and saved session locations appear as map pins.' : "Court pins are placed from each session's saved Location field."}</p></section>`;
}
function isPhilippinesCoordinate(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= PH_MAP_BOUNDS[0][0] && lat <= PH_MAP_BOUNDS[1][0] && lon >= PH_MAP_BOUNDS[0][1] && lon <= PH_MAP_BOUNDS[1][1];
}
function coordinatesFromText(value) {
  const match = String(value || '').match(/(-?\d{1,3}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!match) return null;
  let first = Number(match[1]);
  let second = Number(match[2]);
  if (isPhilippinesCoordinate(first, second)) {
    return { lat: first, lon: second, label: 'GPS coordinates from saved location' };
  }
  if (isPhilippinesCoordinate(second, first)) {
    return { lat: second, lon: first, label: 'GPS coordinates from saved location (coordinate order corrected)' };
  }
  return null;
}
function mapCacheRead() {
  try { return JSON.parse(localStorage.getItem('ppm-dashboard-map-cache-v5') || '{}'); } catch (_) { return {}; }
}
function mapCacheWrite(cache) {
  try { localStorage.setItem('ppm-dashboard-map-cache-v5', JSON.stringify(cache)); } catch (_) { /* Storage may be disabled. */ }
}
function photonQueryVariants(location) {
  const original = String(location || '').trim();
  const corrected = original
    .replace(/\bsout\s+cotabato\b/ig, 'South Cotabato')
    .replace(/\bgensan\b/ig, 'General Santos City');
  const variants = [corrected];
  if (/pioneer/i.test(corrected) && /general santos/i.test(corrected)) {
    variants.push('Pioneer Avenue, General Santos City, South Cotabato, Philippines');
    variants.push('Pioneer Ave, General Santos City, South Cotabato, Philippines');
    variants.push('Pioneer, General Santos City, Philippines');
  }
  return [...new Set(variants.map(item => item.replace(/\s+/g, ' ').trim()).filter(Boolean))];
}
function photonLookup(location) {
  const key = normalizeName(location);
  const cache = mapCacheRead();
  const cached = cache[key];
  const cacheAgeLimit = Number(cached?.ttl) || 90 * 24 * 60 * 60 * 1000;
  if (cached && Date.now() - Number(cached.savedAt || 0) < cacheAgeLimit) {
    return Promise.resolve(cached.result || null);
  }
  if (String(location).trim().length < 5) return Promise.resolve(null);
  const request = async () => {
    const wait = Math.max(0, 900 - (Date.now() - photonLastRequestAt));
    if (wait) await new Promise(resolve => window.setTimeout(resolve, wait));
    let best = null;
    for (const query of photonQueryVariants(location)) {
      photonLastRequestAt = Date.now();
      const fullQuery = /philippines/i.test(query) ? query : `${query}, Philippines`;
      const params = new URLSearchParams({ q: fullQuery, limit: '8', lang: 'en', countrycode: 'PH', lat: String(PH_MAP_CENTER[0]), lon: String(PH_MAP_CENTER[1]), zoom: '5', bbox: '115.5,4.0,128.6,22.4' });
      try {
        const response = await fetch(`https://photon.komoot.io/api/?${params.toString()}`, { headers: { Accept: 'application/geo+json, application/json' } });
        if (!response.ok) continue;
        const payload = await response.json();
        const features = Array.isArray(payload.features) ? payload.features : [];
        // Match against the saved Location text only. Do not include the session title,
        // event name, or any descriptive session metadata in the geocoding request.
        const terms = normalizeName(query).split(/[^a-z0-9]+/).filter(term => term.length > 2 && !['philippines', 'south', 'cotabato', 'city', 'avenue', 'ave'].includes(term));
        const venueMustMatch = /pioneer/i.test(location);
        const cityMustMatch = /general\s+santos|gensan/i.test(location);
        const scored = features.map(feature => {
          const coordinates = feature?.geometry?.coordinates || [];
          const lat = Number(coordinates[1]), lon = Number(coordinates[0]);
          const properties = feature?.properties || {};
          const text = normalizeName([properties.name, properties.street, properties.city, properties.district, properties.county, properties.state, properties.country].filter(Boolean).join(' '));
          const countryOk = String(properties.countrycode || properties.countryCode || '').toUpperCase() === 'PH' || /philippines/i.test(properties.country || '');
          if (!countryOk || !isPhilippinesCoordinate(lat, lon)) return null;
          if (venueMustMatch && !text.includes('pioneer')) return null;
          if (cityMustMatch && !(text.includes('general') && text.includes('santos'))) return null;
          const score = terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0);
          const minScore = terms.length <= 1 ? 1 : Math.max(2, Math.ceil(terms.length * 0.5));
          if (score < minScore) return null;
          return { feature, lat, lon, score, totalTerms: terms.length, text };
        }).filter(Boolean).sort((a, b) => b.score - a.score);
        if (scored.length && (!best || scored[0].score > best.score)) best = scored[0];
        if (best && best.score >= Math.max(2, Math.ceil(terms.length * 0.5))) break;
      } catch (_) { /* Try the next location spelling. */ }
    }
    const feature = best?.feature;
    const properties = feature?.properties || {};
    const result = feature ? {
      lat: best.lat,
      lon: best.lon,
      label: [properties.name, properties.street, properties.city, properties.state, properties.country].filter(Boolean).join(', '),
      confidence: best.totalTerms ? best.score / best.totalTerms : 0,
      source: 'photon-geocoder',
      verified: false,
      placeId: photonPlaceId(properties),
      osmId: photonPlaceId(properties)
    } : null;
    cache[key] = { savedAt: Date.now(), ...(result ? {} : { ttl: 6 * 60 * 60 * 1000 }), result };
    mapCacheWrite(cache);
    return result;
  };
  const lookup = photonQueue.then(request, request);
  photonQueue = lookup.catch(() => null);
  return lookup;
}
let courtLocationSearchTimer = null;
let courtLocationSearchToken = 0;
let courtLocationActiveIndex = -1;
const courtLocationSearchCache = new Map();
const VERIFIED_PH_COURT_LOCATIONS = [
  {
    name: 'Summer Pickle and Perks (Alabel)',
    address: 'Pecolados Compound, Purok Centro, Poblacion, Alabel, Sarangani 9501, Philippines',
    label: 'Summer Pickle and Perks, Pecolados Compound, Purok Centro, Poblacion, Alabel, Sarangani 9501, Philippines',
    lat: 6.1114236,
    lon: 125.2934115,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1114236,125.2934115',
    placeId: 'venue:summer-pickle-and-perks-alabel'
  },
  {
    name: 'Summer Pickle and Perks-Bula',
    address: 'Zone 9, Bula, General Santos City, South Cotabato, Philippines',
    label: 'Summer Pickle and Perks-Bula, Zone 9, Bula, General Santos City, South Cotabato, Philippines',
    lat: 6.106678009,
    lon: 125.192527771,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.106678009,125.192527771',
    placeId: 'venue:summer-pickle-and-perks-bula'
  },
  {
    name: 'Pickle World Gensan - Downtown',
    address: 'NCCC Compound, National Highway, General Santos City (Dadiangas), 9500 South Cotabato, Philippines',
    label: 'Pickle World Gensan - Downtown, NCCC Compound, National Highway, General Santos City (Dadiangas), 9500 South Cotabato, Philippines',
    lat: 6.121556,
    lon: 125.1754212,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    placeId: 'google:0x32f79ffa312fcc13:0x530972c55c9f7c3b',
    mapsUrl: 'https://maps.app.goo.gl/i2oK4WniREN33NAv7'
  },
  {
    name: 'Pickle World Gensan - Lagao',
    address: '114L, Purok 12 Arradaza St, General Santos City (Dadiangas), 9500 South Cotabato, Philippines',
    label: 'Pickle World Gensan - Lagao, 114L, Purok 12 Arradaza St, General Santos City (Dadiangas), 9500 South Cotabato, Philippines',
    lat: 6.1187434,
    lon: 125.2048218,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    placeId: 'google:0x32f79fcbfb8ef755:0x9f1ebf6d818c1463',
    mapsUrl: 'https://maps.app.goo.gl/3U1eqL1KNjto2i1BA'
  },
  {
    name: "965 Pickleball Court",
    address: "Barangay Conel, General Santos City, South Cotabato, Philippines",
    label: "965 Pickleball Court, Barangay Conel, General Santos City, South Cotabato, Philippines",
    lat: 6.1926129,
    lon: 125.1603689,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    placeId: 'google:0x32f79d00738e2791:0xfc636a0255966313',
    mapsUrl: 'https://maps.app.goo.gl/FCgyGVzSB4tPWtyu6'
  },
  {
    name: "AFA Paddle & Events Place",
    address: "NLSA Extension, Barangay Mabuhay, General Santos City, South Cotabato, Philippines",
    label: "AFA Paddle & Events Place, NLSA Extension, Barangay Mabuhay, General Santos City, South Cotabato, Philippines",
    lat: 6.155658,
    lon: 125.157001,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.155658,125.157001'
  },
  {
    name: "Altori Park Pickleball",
    address: "Matatag Park Square, Nuñez Extension Street, General Santos City, South Cotabato, Philippines",
    label: "Altori Park Pickleball, Matatag Park Square, Nuñez Extension Street, General Santos City, South Cotabato, Philippines",
    lat: 6.139041,
    lon: 125.156759,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.139041,125.156759'
  },
  {
    name: "Bayview Pickleball Court",
    address: "Zone 8, Upper Banualan, Barangay Tambler, General Santos City, South Cotabato, Philippines",
    label: "Bayview Pickleball Court, Zone 8, Upper Banualan, Barangay Tambler, General Santos City, South Cotabato, Philippines",
    lat: null,
    lon: null,
    countrycode: 'PH',
    source: 'gensan-court-directory'
  },
  {
    name: "Brigada Golf Range",
    address: "Brigada Business Hub, National Highway, Barangay Mabuhay, General Santos City, South Cotabato, Philippines",
    label: "Brigada Golf Range, Brigada Business Hub, National Highway, Barangay Mabuhay, General Santos City, South Cotabato, Philippines",
    lat: null,
    lon: null,
    countrycode: 'PH',
    source: 'gensan-court-directory'
  },
  {
    name: "Cabin Pickle Club",
    address: "Diversion Road, Barangay Apopong, The Cabin Brewery, General Santos City, South Cotabato, Philippines",
    label: "Cabin Pickle Club, Diversion Road, Barangay Apopong, The Cabin Brewery, General Santos City, South Cotabato, Philippines",
    lat: 6.1014193,
    lon: 125.1056464,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    placeId: 'google:0x32f7995021542b5f:0x251e594250baa8bd',
    mapsUrl: 'https://maps.app.goo.gl/gUMpR2Pi1fxcDYSX9'
  },
  {
    name: "CCM Pickleball Court",
    address: "CCM Sports Center, Purok Masagana, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
    label: "CCM Pickleball Court, CCM Sports Center, Purok Masagana, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
    lat: 6.153997,
    lon: 125.165505,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.153997,125.165505'
  },
  {
    name: "Central PickleHub",
    address: "Manansala Street, Dadiangas North, General Santos City, South Cotabato, Philippines",
    label: "Central PickleHub, Manansala Street, Dadiangas North, General Santos City, South Cotabato, Philippines",
    lat: 6.1177125,
    lon: 125.1677942,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://maps.app.goo.gl/YesBChcUndWDdpU19'
  },
  {
    name: "City Smash Pickleball",
    address: "PG Building, National Highway, Queens Love Village, General Santos City, South Cotabato, Philippines",
    label: "City Smash Pickleball, PG Building, National Highway, Queens Love Village, General Santos City, South Cotabato, Philippines",
    lat: 6.11925,
    lon: 125.17311,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.11925,125.17311'
  },
  {
    name: "Conel Courts Pickle and Brew",
    address: "Purok 1B, Santos Compound, Barangay Conel, General Santos City, South Cotabato, Philippines",
    label: "Conel Courts Pickle and Brew, Purok 1B, Santos Compound, Barangay Conel, General Santos City, South Cotabato, Philippines",
    lat: 6.202036,
    lon: 125.1913919,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    placeId: 'google:0x32f79d5b00c3cb07:0xca57c964e897db52',
    mapsUrl: 'https://maps.app.goo.gl/ZZGukqXUMLqj2BSW8'
  },
  {
    name: "Court Zero Racquet Club",
    address: "Sampaguita Street, Barangay City Heights, General Santos City, South Cotabato, Philippines",
    label: "Court Zero Racquet Club, Sampaguita Street, Barangay City Heights, General Santos City, South Cotabato, Philippines",
    lat: 6.1265535,
    lon: 125.1692548,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1265535,125.1692548'
  },
  {
    name: "D'Lotte Picklepark",
    address: "44QW+5H6, Nuñez Street, Purok Riverside, General Santos City, South Cotabato, Philippines",
    label: "D'Lotte Picklepark, 44QW+5H6, Nuñez Street, Purok Riverside, General Santos City, South Cotabato, Philippines",
    lat: 6.1379025,
    lon: 125.14637890625,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1379025,125.14637890625'
  },
  {
    name: "Dink O'Clock",
    address: "Big Wide, National Highway, Palen, Barangay Labangal, General Santos City, South Cotabato, Philippines",
    label: "Dink O'Clock, Big Wide, National Highway, Palen, Barangay Labangal, General Santos City, South Cotabato, Philippines",
    lat: 6.1184025,
    lon: 125.15416015625,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1184025,125.15416015625'
  },
  {
    name: "Dinkwondo",
    address: "NLSA Road, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
    label: "Dinkwondo, NLSA Road, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
    lat: 6.1330625,
    lon: 125.1849375,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    placeId: 'google:0x32f79f78e3b51ad3:0x3c8131512958b7e0',
    mapsUrl: 'https://maps.app.goo.gl/knc8wHTtfVqWfEKW6'
  },
  {
    name: "Frasssati Outdoor Recreation Area (FORA)",
    address: "Our Lady Manaog Compound, Nuñez Street, General Santos City, South Cotabato, Philippines",
    label: "Frasssati Outdoor Recreation Area (FORA), Our Lady Manaog Compound, Nuñez Street, General Santos City, South Cotabato, Philippines",
    lat: null,
    lon: null,
    countrycode: 'PH',
    source: 'gensan-court-directory'
  },
  {
    name: "FRNDZONE Playhub",
    address: "Purok Ricvill, San Jose, near General Santos Airport, General Santos City, South Cotabato, Philippines",
    label: "FRNDZONE Playhub, Purok Ricvill, San Jose, near General Santos Airport, General Santos City, South Cotabato, Philippines",
    lat: 6.0799663,
    lon: 125.0856893,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    placeId: 'google:0x32f7a38886b31997:0x9cd39d23155e9a79',
    mapsUrl: 'https://maps.app.goo.gl/133whi3br3dRnUZk9'
  },
  {
    name: "Game Yard",
    address: "Purok Amadeo, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
    label: "Game Yard, Purok Amadeo, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
    lat: 6.136615,
    lon: 125.1843838,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    placeId: 'google:0x32f79ffd6b407bbb:0x426ab1e8ad1acaef',
    mapsUrl: 'https://maps.app.goo.gl/tFvJpUeVwXwjkLaXA'
  },
  {
    name: "Game-On Picklehaus",
    address: "National Highway, General Santos City, South Cotabato, Philippines",
    label: "Game-On Picklehaus, National Highway, General Santos City, South Cotabato, Philippines",
    lat: null,
    lon: null,
    countrycode: 'PH',
    source: 'gensan-court-directory'
  },
  {
    name: "Gensan Rackets Pickleball Club",
    address: "Nursery Road, near EmJake Aquawave, General Santos City, South Cotabato, Philippines",
    label: "Gensan Rackets Pickleball Club, Nursery Road, near EmJake Aquawave, General Santos City, South Cotabato, Philippines",
    lat: 6.144005,
    lon: 125.1932769,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    placeId: 'google:0x32f79f003b725e2b:0x579b49a5b16cc6b8',
    mapsUrl: 'https://maps.app.goo.gl/n2rLaDc14oLnfzgn9'
  },
  {
    name: "Gmall Pickleball Gensan",
    address: "Gaisano Mall, J. Catolico Sr. Avenue, General Santos City, South Cotabato, Philippines",
    label: "Gmall Pickleball Gensan, Gaisano Mall, J. Catolico Sr. Avenue, General Santos City, South Cotabato, Philippines",
    lat: 6.1183134,
    lon: 125.1845544,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    placeId: 'google:0x32f79fb078fccdab:0x99982f61dbc955e9',
    mapsUrl: 'https://maps.app.goo.gl/YZ7vCmUtkmo2uacG9'
  },
  {
    name: "J&P Pickleball Academy",
    address: "45VH+PGR, Pancubila Street, General Santos City, South Cotabato, Philippines",
    label: "J&P Pickleball Academy, 45VH+PGR, Pancubila Street, General Santos City, South Cotabato, Philippines",
    lat: 6.1443525,
    lon: 125.17875390625,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1443525,125.17875390625'
  },
  {
    name: "JCO Pickleball Hub",
    address: "46R5+FJR, Davao Road, Lagao, beside VSM Estate, General Santos City, South Cotabato, Philippines",
    label: "JCO Pickleball Hub, 46R5+FJR, Davao Road, Lagao, beside VSM Estate, General Santos City, South Cotabato, Philippines",
    lat: 6.1412275,
    lon: 125.20900390625,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1412275,125.20900390625'
  },
  {
    name: "JG Oranza Sports Arena",
    address: "Buayan, General Santos City, South Cotabato, Philippines",
    label: "JG Oranza Sports Arena, Buayan, General Santos City, South Cotabato, Philippines",
    lat: null,
    lon: null,
    countrycode: 'PH',
    source: 'gensan-court-directory'
  },
  {
    name: "Laureto Pickleball Court",
    address: "44QW+4MR, Nuñez Street, General Santos City, South Cotabato, Philippines",
    label: "Laureto Pickleball Court, 44QW+4MR, Nuñez Street, General Santos City, South Cotabato, Philippines",
    lat: 6.1378525,
    lon: 125.14662890625,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1378525,125.14662890625'
  },
  {
    name: "Lim Spring Garden",
    address: "Near Lagao Barangay Hall, General Santos City, South Cotabato, Philippines",
    label: "Lim Spring Garden, Near Lagao Barangay Hall, General Santos City, South Cotabato, Philippines",
    lat: 6.1296466,
    lon: 125.1971456,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    placeId: 'google:0x32f79f00008990e3:0x2203e1d9ca535f51',
    mapsUrl: 'https://maps.app.goo.gl/E9LEPzc89yrsLkB9A'
  },
  {
    name: "LPS Homecourt",
    address: "Fil-Am Road, Barangay Calumpang, General Santos City, South Cotabato, Philippines",
    label: "LPS Homecourt, Fil-Am Road, Barangay Calumpang, General Santos City, South Cotabato, Philippines",
    lat: 6.0718022,
    lon: 125.1345484,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    placeId: 'google:0x32f7a100608cffb7:0x368e6dd81ffebb80',
    mapsUrl: 'https://maps.app.goo.gl/JcRmkEGerEz8uzSn9'
  },
  {
    name: "Mamikilay",
    address: "Lower Cabuay Road, Barangay Sinawal, General Santos City, South Cotabato, Philippines",
    label: "Mamikilay, Lower Cabuay Road, Barangay Sinawal, General Santos City, South Cotabato, Philippines",
    lat: 6.1406545,
    lon: 125.1127992,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    placeId: 'google:0x32f799005c95f7a1:0x405b75587d671514',
    mapsUrl: 'https://maps.app.goo.gl/P4wZLTpFNFDp41p28'
  },
  {
    name: "NRT Events Center",
    address: "Purok Cañas, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
    label: "NRT Events Center, Purok Cañas, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
    lat: 6.16112,
    lon: 125.167273,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    placeId: 'google:0x32f79f0a7dae8fff:0x7cece8854e054ecf',
    mapsUrl: 'https://maps.app.goo.gl/FXhF1UMMhe4HNMeG9'
  },
  {
    name: "Paddle King Court",
    address: "MC Village, Block 3, Barangay Fatima, General Santos City, South Cotabato, Philippines",
    label: "Paddle King Court, MC Village, Block 3, Barangay Fatima, General Santos City, South Cotabato, Philippines",
    lat: 6.071332,
    lon: 125.1049725,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    placeId: 'google:0x32f7a3003b360a19:0x5714df713af06d75',
    mapsUrl: 'https://maps.app.goo.gl/pkbQEafHmRQacJDu8'
  },
  {
    name: "Pickle Barn",
    address: "Upper Villegas, beside Imperial Bodega, General Santos City, South Cotabato, Philippines",
    label: "Pickle Barn, Upper Villegas, beside Imperial Bodega, General Santos City, South Cotabato, Philippines",
    lat: 6.1431454,
    lon: 125.1741914,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    placeId: 'google:0x32f79f07cdfc0831:0xc59a7ab7af150b84',
    mapsUrl: 'https://maps.app.goo.gl/uDNzGxhK6ERNzHrn7'
  },
  {
    name: "Pickle Bull by Kwiky Mart",
    address: "National Highway, General Santos City, South Cotabato, Philippines",
    label: "Pickle Bull by Kwiky Mart, National Highway, General Santos City, South Cotabato, Philippines",
    lat: null,
    lon: null,
    countrycode: 'PH',
    source: 'gensan-court-directory'
  },
  {
    name: "Pickle Court Co.",
    address: "Golden Village, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
    label: "Pickle Court Co., Golden Village, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
    lat: null,
    lon: null,
    countrycode: 'PH',
    source: 'gensan-court-directory'
  },
  {
    name: "Pickle Panic Recreational Park",
    address: "Lagare Farms & Parks, General Santos City, South Cotabato, Philippines",
    label: "Pickle Panic Recreational Park, Lagare Farms & Parks, General Santos City, South Cotabato, Philippines",
    lat: 6.131262,
    lon: 125.149036,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    placeId: 'google:0x32f79f13956fcd9b:0x30c3dc62dbe93cf5',
    mapsUrl: 'https://maps.app.goo.gl/T3Wn9TvPYwyN5JXP8'
  },
  {
    name: "Pickleholics",
    address: "Purok Soriano, Barangay Sinawal, General Santos City, South Cotabato, Philippines",
    label: "Pickleholics, Purok Soriano, Barangay Sinawal, General Santos City, South Cotabato, Philippines",
    lat: null,
    lon: null,
    countrycode: 'PH',
    source: 'gensan-court-directory'
  },
  {
    name: "Picklehub & Cafe",
    address: "Velasquez Street, Dadiangas North, General Santos City, South Cotabato, Philippines",
    label: "Picklehub & Cafe, Velasquez Street, Dadiangas North, General Santos City, South Cotabato, Philippines",
    lat: 6.118462563,
    lon: 125.165641785,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.118462563,125.165641785'
  },
  {
    name: "Picklepals – SM City GenSan",
    address: "Parking Lot E, SM City General Santos, J. Catolico Sr. Avenue, General Santos City, South Cotabato, Philippines",
    label: "Picklepals – SM City GenSan, Parking Lot E, SM City General Santos, J. Catolico Sr. Avenue, General Santos City, South Cotabato, Philippines",
    lat: null,
    lon: null,
    countrycode: 'PH',
    source: 'gensan-court-directory'
  },
  {
    name: "Pickleyard & Co",
    address: "Fernandez Street, near Lagao Barangay Hall, General Santos City, South Cotabato, Philippines",
    label: "Pickleyard & Co, Fernandez Street, near Lagao Barangay Hall, General Santos City, South Cotabato, Philippines",
    lat: 6.1235625,
    lon: 125.1845625,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1235625,125.1845625'
  },
  {
    name: "Rally Point GenSan (RPG-GUPC) Pickleball Courts",
    address: "45CM+6J5, behind GSIS Office, National Highway, General Santos City, South Cotabato, Philippines",
    label: "Rally Point GenSan (RPG-GUPC) Pickleball Courts, 45CM+6J5, behind GSIS Office, National Highway, General Santos City, South Cotabato, Philippines",
    lat: 6.1205169,
    lon: 125.1841202,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    placeId: 'google:0x32f79f0012e2b089:0x35bff7fe44048df2',
    mapsUrl: 'https://maps.app.goo.gl/LsqVfPhH8BdnHfS27'
  },
  {
    name: "RAPIKOL Pickleball Court",
    address: "Odi Street, General Santos City, South Cotabato, Philippines",
    label: "RAPIKOL Pickleball Court, Odi Street, General Santos City, South Cotabato, Philippines",
    lat: 6.1294375,
    lon: 125.1933125,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1294375,125.1933125'
  },
  {
    name: "RGR Pickleball Courtside",
    address: "Pancubila Street, General Santos City, South Cotabato, Philippines",
    label: "RGR Pickleball Courtside, Pancubila Street, General Santos City, South Cotabato, Philippines",
    lat: 6.1457025,
    lon: 125.17841015625,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1457025,125.17841015625'
  },
  {
    name: "Robinson Pickleball",
    address: "Robinsons Place GenSan, J. Catolico Sr. Avenue, General Santos City, South Cotabato, Philippines",
    label: "Robinson Pickleball, Robinsons Place GenSan, J. Catolico Sr. Avenue, General Santos City, South Cotabato, Philippines",
    lat: 6.1202669,
    lon: 125.1897059,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    placeId: 'google:0x32f79f000f19fa1f:0x4ea148efa1bfdb7d',
    mapsUrl: 'https://maps.app.goo.gl/C2J2Fth5ZbtQd1gX7'
  },
  {
    name: "Sanman Pickle Punch GenSan",
    address: "Sanman Boxing Gym Compound, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
    label: "Sanman Pickle Punch GenSan, Sanman Boxing Gym Compound, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
    lat: 6.138551,
    lon: 125.1803825,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    placeId: 'google:0x32f79f9c72b79b19:0x88c31ee2fcca06de',
    mapsUrl: 'https://maps.app.goo.gl/hhxMtkQqs3rmMHbd8'
  },
  {
    name: "Serve & Volley Pickleball Courts",
    address: "Mabuhay Road, General Santos City, South Cotabato, Philippines",
    label: "Serve & Volley Pickleball Courts, Mabuhay Road, General Santos City, South Cotabato, Philippines",
    lat: 6.1449375,
    lon: 125.1605625,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1449375,125.1605625'
  },
  {
    name: "SideOut GenSan – Exclusive",
    address: "Solomon Subdivision, Purok 15, Lagao, General Santos City, South Cotabato, Philippines",
    label: "SideOut GenSan – Exclusive, Solomon Subdivision, Purok 15, Lagao, General Santos City, South Cotabato, Philippines",
    lat: null,
    lon: null,
    countrycode: 'PH',
    source: 'gensan-court-directory'
  },
  {
    name: "SideOut Pickleball Court GenSan – Main",
    address: "National Highway, Lagao, opposite La Mirada Inn, General Santos City, South Cotabato, Philippines",
    label: "SideOut Pickleball Court GenSan – Main, National Highway, Lagao, opposite La Mirada Inn, General Santos City, South Cotabato, Philippines",
    lat: 6.131947517,
    lon: 125.201087952,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.131947517,125.201087952'
  },
  {
    name: "T-James Sporty Bar",
    address: "Purok 14-D, Katangawan, General Santos City, South Cotabato, Philippines",
    label: "T-James Sporty Bar, Purok 14-D, Katangawan, General Santos City, South Cotabato, Philippines",
    lat: null,
    lon: null,
    countrycode: 'PH',
    source: 'gensan-court-directory'
  },
  {
    name: "The Compound Courts",
    address: "5568+6WR, General Santos City Circumferential Road, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
    label: "The Compound Courts, 5568+6WR, General Santos City Circumferential Road, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
    lat: 6.1606025,
    lon: 125.16725390625,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1606025,125.16725390625'
  },
  {
    name: "The Loom & The Leaf Weekend Market",
    address: "Nopo-Conel, Mabuhay Road, General Santos City, South Cotabato, Philippines",
    label: "The Loom & The Leaf Weekend Market, Nopo-Conel, Mabuhay Road, General Santos City, South Cotabato, Philippines",
    lat: null,
    lon: null,
    countrycode: 'PH',
    source: 'gensan-court-directory'
  },
  {
    name: "The Paddle Club Pickleball",
    address: "Tiongson Street, Lagao, General Santos City, South Cotabato, Philippines",
    label: "The Paddle Club Pickleball, Tiongson Street, Lagao, General Santos City, South Cotabato, Philippines",
    lat: 6.1272035,
    lon: 125.192598,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    placeId: 'google:0x32f79f0077b50255:0xa504247b5cbf36ae',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1271875,125.1925625'
  },
  {
    name: "The Palm Court",
    address: "Del Carmen Street, Lagao, General Santos City, South Cotabato, Philippines",
    label: "The Palm Court, Del Carmen Street, Lagao, General Santos City, South Cotabato, Philippines",
    lat: 6.131737232,
    lon: 125.189704895,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.131737232,125.189704895'
  },
  {
    name: "The Pickle Cafe",
    address: "Purok 3, Labu, Katangawan, General Santos City, South Cotabato, Philippines",
    label: "The Pickle Cafe, Purok 3, Labu, Katangawan, General Santos City, South Cotabato, Philippines",
    lat: null,
    lon: null,
    countrycode: 'PH',
    source: 'gensan-court-directory'
  },
  {
    name: "The Pickle Neighbour",
    address: "Romana Estate, Dacera Street, Barangay City Heights, General Santos City, South Cotabato, Philippines",
    label: "The Pickle Neighbour, Romana Estate, Dacera Street, Barangay City Heights, General Santos City, South Cotabato, Philippines",
    lat: 6.1243525,
    lon: 125.15603515625,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1243525,125.15603515625'
  },
  {
    name: "Third Shot Pickleground Gensan",
    address: "Sunshine Compound, Arradaza Street, Lagao, General Santos City, South Cotabato, Philippines",
    label: "Third Shot Pickleground Gensan, Sunshine Compound, Arradaza Street, Lagao, General Santos City, South Cotabato, Philippines",
    lat: 6.1173896,
    lon: 125.1937748,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    placeId: 'google:0x32f79f0011f697bf:0x9884c43134ddb9cf',
    mapsUrl: 'https://maps.app.goo.gl/FxksNtumf1rp1Nvz6'
  },
  {
    name: "Tranquil Bounce Pickleball Club",
    address: "Greenfield Residences, Nursery Road, Lagao, General Santos City, South Cotabato, Philippines",
    label: "Tranquil Bounce Pickleball Club, Greenfield Residences, Nursery Road, Lagao, General Santos City, South Cotabato, Philippines",
    lat: 6.1438433,
    lon: 125.2027057,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    placeId: 'google:0x32f79fc4204c719d:0x23387cdeecc58f81',
    mapsUrl: 'https://maps.app.goo.gl/LvKprZ9k6M7SQ4Ff9'
  },
  {
    name: "Triangle Centre Court",
    address: "Bula, General Santos City, South Cotabato, Philippines",
    label: "Triangle Centre Court, Bula, General Santos City, South Cotabato, Philippines",
    lat: null,
    lon: null,
    countrycode: 'PH',
    source: 'gensan-court-directory'
  },
  {
    name: "V-Park",
    address: "Circumferential Road, Velayo Farm, General Santos City, South Cotabato, Philippines",
    label: "V-Park, Circumferential Road, Velayo Farm, General Santos City, South Cotabato, Philippines",
    lat: null,
    lon: null,
    countrycode: 'PH',
    source: 'gensan-court-directory'
  },
  {
    name: "Verde Pickle Courts",
    address: "Purok Maunlad Phase 2, General Santos City, South Cotabato, Philippines",
    label: "Verde Pickle Courts, Purok Maunlad Phase 2, General Santos City, South Cotabato, Philippines",
    lat: null,
    lon: null,
    countrycode: 'PH',
    source: 'gensan-court-directory'
  },
  {
    name: "ZZ Pickle Court",
    address: "Dadiangas Heights Subdivision, Block 6, General Santos City, South Cotabato, Philippines",
    label: "ZZ Pickle Court, Dadiangas Heights Subdivision, Block 6, General Santos City, South Cotabato, Philippines",
    lat: 6.1258314,
    lon: 125.174884,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    placeId: 'google:0x32f79f7e1143e47b:0xb16c43e998c7c238',
    mapsUrl: 'https://maps.app.goo.gl/QfpTRyEofVtriTuo8'
  },
  {
    name: "4th Road Picklehub & Cafe",
    address: "35H3+J56, Fourth Road, General Santos City (Dadiangas), South Cotabato, Philippines",
    label: "4th Road Picklehub & Cafe, 35H3+J56, Fourth Road, General Santos City (Dadiangas), South Cotabato, Philippines",
    lat: 6.0790275,
    lon: 125.15287890625,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.0790275,125.15287890625',
    status: "coming-soon"
  },
  {
    name: "Cross Court Gensan",
    address: "Mercado Street, Barangay San Isidro, General Santos City (Dadiangas), South Cotabato, Philippines",
    label: "Cross Court Gensan, Mercado Street, Barangay San Isidro, General Santos City (Dadiangas), South Cotabato, Philippines",
    lat: 6.1488376,
    lon: 125.16542,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1488376,125.16542'
  },
  {
    name: "SHAO Pickle Court",
    address: "Zone 1, Barangay Buayan Townsite, General Santos City, South Cotabato, Philippines",
    label: "SHAO Pickle Court, Zone 1, Barangay Buayan Townsite, General Santos City, South Cotabato, Philippines",
    lat: null,
    lon: null,
    countrycode: 'PH',
    source: 'gensan-court-directory'
  },
  {
    name: "Picklepals - San Miguel",
    address: "San Miguel Street, General Santos City (Dadiangas), 9500 South Cotabato, Philippines",
    label: "Picklepals - San Miguel, San Miguel Street, General Santos City (Dadiangas), 9500 South Cotabato, Philippines",
    lat: 6.1163125,
    lon: 125.1833125,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1163125,125.1833125'
  },
  {
    name: "RALLÉ Sports Center",
    address: "543W+JRH, General Santos City Circumferential Road, General Santos City (Dadiangas), South Cotabato, Philippines",
    label: "RALLÉ Sports Center, 543W+JRH, General Santos City Circumferential Road, General Santos City (Dadiangas), South Cotabato, Philippines",
    lat: 6.1540525,
    lon: 125.14709765625,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1540525,125.14709765625',
    status: "coming-soon"
  },
  {
    name: "The Pickle Field",
    address: "Purok 28, Barangay San Jose Road, General Santos City (Dadiangas), South Cotabato, Philippines",
    label: "The Pickle Field, Purok 28, Barangay San Jose Road, General Santos City (Dadiangas), South Cotabato, Philippines",
    lat: 6.0781555,
    lon: 125.10362,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.0781555,125.10362'
  },
  {
    name: "PickleBelle",
    address: "Savemore, Nuñez Street, Purok Malakas, General Santos City (Dadiangas), South Cotabato, Philippines",
    label: "PickleBelle, Savemore, Nuñez Street, Purok Malakas, General Santos City (Dadiangas), South Cotabato, Philippines",
    lat: 6.138061047,
    lon: 125.1614151,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.138061047,125.1614151'
  },
  {
    name: "The Pickle Yard",
    address: "Catalino Cabe Street, Bula, General Santos City (Dadiangas), South Cotabato, Philippines",
    label: "The Pickle Yard, Catalino Cabe Street, Bula, General Santos City (Dadiangas), South Cotabato, Philippines",
    lat: 6.111452,
    lon: 125.18355,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.111452,125.18355'
  },
  {
    name: "The Dirty Kitchen Pickleball Court",
    address: "Mabuhay Road, Agan Homes, Phase 1, Purok Perez, General Santos City (Dadiangas), 9500 South Cotabato, Philippines",
    label: "The Dirty Kitchen Pickleball Court, Mabuhay Road, Agan Homes, Phase 1, Purok Perez, General Santos City (Dadiangas), 9500 South Cotabato, Philippines",
    lat: null,
    lon: null,
    countrycode: 'PH',
    source: 'gensan-court-directory'
  },
  {
    name: "Dink Yard Gensan Inc",
    address: "Purok Bagong Silang, Upper Molok Bridge, National Highway, Barangay Labangal, General Santos City, South Cotabato, Philippines",
    label: "Dink Yard Gensan Inc, Purok Bagong Silang, Upper Molok Bridge, National Highway, Barangay Labangal, General Santos City, South Cotabato, Philippines",
    lat: 6.1019683,
    lon: 125.1518,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1019683,125.1518'
  },
  {
    name: "PaddlePals Recreational Hub",
    address: "Yumang Extension, General Santos City, South Cotabato, Philippines",
    label: "PaddlePals Recreational Hub, Yumang Extension, General Santos City, South Cotabato, Philippines",
    lat: null,
    lon: null,
    countrycode: 'PH',
    source: 'gensan-court-directory'
  },
  {
    name: "PogzGen Pickleball Court",
    address: "Phase 3, Block 7, Lot 24, Galatians Street, Purok Placida, Barangay Calumpang, General Santos City, South Cotabato, Philippines",
    label: "PogzGen Pickleball Court, Phase 3, Block 7, Lot 24, Galatians Street, Purok Placida, Barangay Calumpang, General Santos City, South Cotabato, Philippines",
    lat: null,
    lon: null,
    countrycode: 'PH',
    source: 'gensan-court-directory'
  },
  {
    name: "Pikolbol Couples",
    address: "Block 7, Purok 3, Barangay Conel, General Santos City (Dadiangas), South Cotabato, 9500, Philippines",
    label: "Pikolbol Couples, Block 7, Purok 3, Barangay Conel, General Santos City (Dadiangas), South Cotabato, 9500, Philippines",
    lat: null,
    lon: null,
    countrycode: 'PH',
    source: 'gensan-court-directory'
  },
  {
    name: "Vast Grounds - Pickleball Hub",
    address: "JFR Commercial Complex Leasing, Purok 24, Mabuhay Road, Barangay Mabuhay, General Santos City (Dadiangas), South Cotabato, 9500, Philippines",
    label: "Vast Grounds - Pickleball Hub, JFR Commercial Complex Leasing, Purok 24, Mabuhay Road, Barangay Mabuhay, General Santos City (Dadiangas), South Cotabato, 9500, Philippines",
    lat: 6.1524506,
    lon: 125.16048,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1524506,125.16048'
  },
  {
    name: "P16 Dink Yard",
    address: "Purok 16, Block 1, Barangay Fatima, General Santos City (Dadiangas), South Cotabato, 9500, Philippines",
    label: "P16 Dink Yard, Purok 16, Block 1, Barangay Fatima, General Santos City (Dadiangas), South Cotabato, 9500, Philippines",
    lat: null,
    lon: null,
    countrycode: 'PH',
    source: 'gensan-court-directory'
  },
  {
    name: "Gensan Commandos Sports Center",
    address: "Purok Pantay-Pantay, Barangay Baluan, General Santos City (Dadiangas), South Cotabato, Philippines",
    label: "Gensan Commandos Sports Center, Purok Pantay-Pantay, Barangay Baluan, General Santos City (Dadiangas), South Cotabato, Philippines",
    lat: 6.1269625,
    lon: 125.21873437500001,
    countrycode: 'PH',
    source: 'verified-venue-listing',
    mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1269625,125.21873437500001'
  },
  {
    name: "Pickle Vista",
    address: "Purok Vista, Alilaya Village, Barangay Sinawal, General Santos City (Dadiangas), South Cotabato, Philippines",
    label: "Pickle Vista, Purok Vista, Alilaya Village, Barangay Sinawal, General Santos City (Dadiangas), South Cotabato, Philippines",
    lat: null,
    lon: null,
    countrycode: 'PH',
    source: 'gensan-court-directory'
  }
];

function normalizeCourtLocationSearchText(value) {
  return String(value || '').normalize('NFKD').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function photonPlaceId(properties = {}) {
  const osmType = String(properties.osm_type || '').trim();
  const osmId = String(properties.osm_id || '').trim();
  return osmType && osmId ? `osm:${osmType}:${osmId}` : '';
}

function searchPhilippineLocations(query) {
  const trimmed = String(query || '').trim();
  if (trimmed.length < 3) return Promise.resolve([]);
  const cacheKey = normalizeName(trimmed);
  if (courtLocationSearchCache.has(cacheKey)) return Promise.resolve(courtLocationSearchCache.get(cacheKey));

  const terms = normalizeCourtLocationSearchText(trimmed).split(' ')
    .filter(term => term.length > 2 && !['the', 'and', 'for', 'philippines', 'pickleball', 'court', 'courts', 'venue', 'venues', 'club', 'clubs'].includes(term));
  const requiredMatches = terms.length <= 1 ? 1 : Math.max(1, Math.ceil(terms.length * 0.5));
  const curatedMatches = terms.length ? VERIFIED_PH_COURT_LOCATIONS.filter(feature => {
    const searchable = normalizeCourtLocationSearchText(`${feature.name} ${feature.address} ${/general\s+santos/i.test(feature.address) ? 'GenSan' : ''}`);
    const matches = terms.filter(term => searchable.includes(term)).length;
    return matches >= requiredMatches;
  }).map(feature => ({ ...feature })) : [];

  const params = new URLSearchParams({
    q: trimmed,
    limit: '10',
    lang: 'en',
    countrycode: 'PH',
    bbox: '115.5,4.0,128.6,22.4',
    lat: String(PH_MAP_CENTER[0]),
    lon: String(PH_MAP_CENTER[1]),
    zoom: '5'
  });

  const request = async () => {
    const wait = Math.max(0, 900 - (Date.now() - photonLastRequestAt));
    if (wait) await new Promise(resolve => window.setTimeout(resolve, wait));
    photonLastRequestAt = Date.now();

    const response = await fetch(`https://photon.komoot.io/api/?${params.toString()}`, {
      headers: { Accept: 'application/geo+json, application/json' },
      cache: 'no-store'
    });
    if (!response.ok) throw new Error('Philippines location search is temporarily unavailable.');
    const payload = await response.json();
    const unique = new Map();

    curatedMatches.forEach(feature => {
      const lat = Number(feature.lat);
      const lon = Number(feature.lon);
      const hasVerifiedCoordinates = isPhilippinesCoordinate(lat, lon);
      const key = hasVerifiedCoordinates
        ? `${normalizeCourtLocationSearchText(feature.name)}|${lat.toFixed(5)}|${lon.toFixed(5)}`
        : `directory:${normalizeCourtLocationSearchText(feature.name)}`;
      unique.set(key, {
        ...feature,
        lat: hasVerifiedCoordinates ? lat : '',
        lon: hasVerifiedCoordinates ? lon : '',
        primary: feature.name,
        secondary: feature.address
      });
    });

    (Array.isArray(payload.features) ? payload.features : []).forEach(feature => {
      const properties = feature?.properties || {};
      const coordinates = feature?.geometry?.coordinates || [];
      const lon = Number(coordinates[0]);
      const lat = Number(coordinates[1]);
      const countrycode = String(properties.countrycode || properties.countryCode || '').toUpperCase();
      if (countrycode !== 'PH' || !isPhilippinesCoordinate(lat, lon)) return;

      const name = String(properties.name || properties.street || properties.city || 'Philippines location').trim();
      const street = [properties.housenumber, properties.street].filter(Boolean).join(' ').trim();
      const addressParts = [
        street && normalizeCourtLocationSearchText(street) !== normalizeCourtLocationSearchText(name) ? street : '',
        properties.district,
        properties.suburb,
        properties.city,
        properties.county,
        properties.state,
        properties.postcode,
        'Philippines'
      ].filter(Boolean);
      const address = [...new Set(addressParts.map(value => String(value).trim()).filter(Boolean))].join(', ');
      const label = [...new Set([name, ...addressParts].filter(Boolean))].join(', ');
      const searchable = normalizeCourtLocationSearchText([
        name, address, properties.osm_key, properties.osm_value
      ].filter(Boolean).join(' '));
      const matches = terms.filter(term => searchable.includes(term)).length;
      if (terms.length && matches < requiredMatches) return;

      const osmId = photonPlaceId(properties);
      const result = {
        name,
        address,
        label,
        primary: name,
        secondary: address,
        lat,
        lon,
        countrycode: 'PH',
        source: 'photon',
        placeId: osmId,
        osmId
      };
      const key = `${normalizeCourtLocationSearchText(name)}|${lat.toFixed(5)}|${lon.toFixed(5)}`;
      if (!unique.has(key)) unique.set(key, result);
    });

    const results = [...unique.values()].slice(0, 8);
    courtLocationSearchCache.set(cacheKey, results);
    if (courtLocationSearchCache.size > 40) {
      courtLocationSearchCache.delete(courtLocationSearchCache.keys().next().value);
    }
    return results;
  };

  const lookup = photonQueue.then(request, request);
  photonQueue = lookup.catch(() => []);
  return lookup.catch(() => {
    if (curatedMatches.length) return curatedMatches;
    throw new Error('Philippines location search is temporarily unavailable.');
  });
}
function renderCourtLocationSuggestions(form, results, query) {
  const list = form?.querySelector('[data-court-location-suggestions]');
  if (!list) return;
  const input = form.querySelector('[data-court-location-input]');
  courtLocationActiveIndex = -1;
  if (!results.length) {
    list.innerHTML = `<div class="court-location-no-results">No matching Philippine pickleball court or map place found. Try a court name, barangay, city or province.</div>`;
    list.hidden = false;
    if (input) input.setAttribute('aria-expanded', 'true');
    return;
  }
  list.innerHTML = results.map(result => {
    const sourceLabel = result.source === 'gensan-court-directory'
      ? 'GenSan court directory · Exact map pin required'
      : result.source === 'verified-venue-listing'
        ? 'Verified court venue · Philippines'
        : 'Philippines · Map search';
    const statusLabel = result.status === 'coming-soon' ? 'Coming soon · ' : '';
    return `<button type="button" class="court-location-option" role="option" aria-selected="false" data-court-location-option data-kind="map-place" data-label="${escapeHTML(result.label)}" data-lat="${escapeHTML(result.lat ?? '')}" data-lon="${escapeHTML(result.lon ?? '')}" data-place-id="${escapeHTML(result.placeId || result.osmId || '')}" data-source="${escapeHTML(result.source || 'photon')}"><strong>${escapeHTML(result.primary || result.name)}</strong><small>${escapeHTML(result.secondary || result.address || result.label)}</small><small>${statusLabel}${sourceLabel}</small></button>`;
  }).join('');
  list.hidden = false;
  if (input) input.setAttribute('aria-expanded', 'true');
}

function updateCourtPinFields(form, coordinates, { confirmed = true, source = 'manual-map-pin', label = '', placeId = '', pinId = '', osmId = '' } = {}) {
  if (!form || !coordinates) return false;
  const lat = Number(coordinates.lat);
  const lon = Number(coordinates.lon);
  if (!isPhilippinesCoordinate(lat, lon)) return false;
  const latField = form.querySelector('[data-court-location-lat]');
  const lonField = form.querySelector('[data-court-location-lon]');
  const labelField = form.querySelector('[data-court-location-label]');
  const confirmedField = form.querySelector('[data-court-location-pin-confirmed]');
  const sourceField = form.querySelector('[data-court-location-pin-source]');
  const placeIdField = form.querySelector('[data-court-location-place-id]');
  const pinIdField = form.querySelector('[data-court-location-pin-id]');
  const input = form.querySelector('[data-court-location-input]');
  const resolvedPlaceId = String(placeId || coordinates.placeId || coordinates.osmId || '').trim();
  const resolvedOsmId = String(osmId || coordinates.osmId || (resolvedPlaceId.startsWith('osm:') ? resolvedPlaceId : '')).trim();
  const resolvedPinId = String(pinId || coordinates.pinId || `pin:${lat.toFixed(7)},${lon.toFixed(7)}`).trim();

  if (latField) latField.value = lat.toFixed(7);
  if (lonField) lonField.value = lon.toFixed(7);
  if (labelField) labelField.value = label || coordinates.label || `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  if (confirmedField) confirmedField.value = confirmed ? 'true' : 'false';
  if (sourceField) sourceField.value = source || '';
  if (placeIdField) placeIdField.value = resolvedPlaceId;
  if (pinIdField) pinIdField.value = resolvedPinId;
  if (input) {
    input.dataset.placeId = resolvedPlaceId;
    input.dataset.pinId = resolvedPinId;
    input.dataset.osmId = resolvedOsmId;
  }

  const status = form.querySelector('#registerCourtLocationStatus');
  if (status) status.textContent = confirmed
    ? `Pin location confirmed · ${lat.toFixed(5)}, ${lon.toFixed(5)}. Drag the pin again or tap the map to adjust it.`
    : 'Approximate city preview only. Drag the pin or tap the exact court location before saving.';
  return true;
}

function clearCourtLocationPinForDirectorySelection(form) {
  if (!form) return;
  form._courtPinRevision = Number(form._courtPinRevision || 0) + 1;
  [
    '[data-court-location-lat]', '[data-court-location-lon]',
    '[data-court-location-label]', '[data-court-location-place-id]',
    '[data-court-location-pin-id]', '[data-court-location-pin-confirmed]',
    '[data-court-location-pin-source]'
  ].forEach(selector => {
    const field = form.querySelector(selector);
    if (field) field.value = selector === '[data-court-location-pin-confirmed]' ? 'false' : '';
  });
  const input = form.querySelector('[data-court-location-input]');
  if (input) {
    delete input.dataset.placeId;
    delete input.dataset.pinId;
    delete input.dataset.osmId;
    input.dataset.selectedLocation = 'true';
  }
  const pinMap = form._courtPinMap;
  if (pinMap?.marker) pinMap.marker.getElement().style.display = 'none';
  if (pinMap?.map) {
    // A city-level view is only a navigation aid; it is never saved as a court pin.
    pinMap.map.flyTo({ center: [125.1716, 6.1164], zoom: 12, pitch: 0, bearing: 0, duration: 650 });
  }
  const status = form.querySelector('#registerCourtLocationStatus');
  if (status) status.textContent = 'GenSan venue selected. This directory entry has no verified GPS pin yet. Tap the exact court entrance on the map (or place the pin there) before saving.';
  return Number(form._courtPinRevision || 0);
}

async function previewGensanDirectoryVenueOnMap(form, venue) {
  const revision = clearCourtLocationPinForDirectorySelection(form);
  if (!form?.isConnected) return;
  const query = `${venue?.name || ''}, General Santos City, South Cotabato, Philippines`;
  const match = await photonLookup(query);
  if (!match || Number(match.confidence || 0) < 0.55 || !form.isConnected || Number(form._courtPinRevision || 0) !== revision) return;
  const mapReady = await form._courtPinMapReady;
  if (!mapReady || !form.isConnected || Number(form._courtPinRevision || 0) !== revision) return;
  if (!isPhilippinesCoordinate(Number(match.lat), Number(match.lon))) return;
  moveCourtLocationPin(form, match, {
    confirmed: false,
    source: 'gensan-directory-geocoder-preview',
    label: `Map suggestion · ${match.label || query}`,
    zoom: 16,
    placeId: match.placeId || match.osmId || '',
    osmId: match.osmId || ''
  });
  const status = form.querySelector('#registerCourtLocationStatus');
  if (status) status.textContent = 'Approximate GenSan map suggestion shown. Confirm the exact court entrance by dragging the pin or tapping the correct spot before saving.';
}

function moveCourtLocationPin(form, coordinates, { confirmed = true, source = 'map-search', label = '', zoom = 16, placeId = '', pinId = '', osmId = '' } = {}) {
  const lat = Number(coordinates?.lat);
  const lon = Number(coordinates?.lon);
  const resolvedPlaceId = placeId || coordinates?.placeId || coordinates?.osmId || '';
  const resolvedPinId = pinId || coordinates?.pinId || (isPhilippinesCoordinate(lat, lon) ? `pin:${lat.toFixed(7)},${lon.toFixed(7)}` : '');
  if (!updateCourtPinFields(form, coordinates, { confirmed, source, label, placeId: resolvedPlaceId, pinId: resolvedPinId, osmId: osmId || coordinates?.osmId || '' })) return false;
  const pinMap = form?._courtPinMap;
  if (pinMap?.marker && pinMap?.map) {
    pinMap.marker.getElement()?.style.removeProperty('display');
    pinMap.marker.setLngLat([Number(coordinates.lon), Number(coordinates.lat)]);
    pinMap.map.flyTo({ center: [Number(coordinates.lon), Number(coordinates.lat)], zoom, pitch: 0, bearing: 0, duration: 650 });
  }
  return true;
}

async function resolveCourtPinPlaceId(form, coordinates, pinRevision) {
  const lat = Number(coordinates?.lat);
  const lon = Number(coordinates?.lon);
  if (!form?.isConnected || !isPhilippinesCoordinate(lat, lon)) return null;
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), lang: 'en', limit: '1' });
  try {
    const response = await fetch(`https://photon.komoot.io/reverse/?${params.toString()}`, {
      headers: { Accept: 'application/geo+json, application/json' },
      cache: 'no-store'
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const feature = Array.isArray(payload.features) ? payload.features[0] : null;
    if (!feature || Number(form._courtPinRevision || 0) !== Number(pinRevision || 0) || !form.isConnected) return null;
    const properties = feature.properties || {};
    const osmId = photonPlaceId(properties);
    if (!osmId) return null;
    const currentLat = Number(form.querySelector('[data-court-location-lat]')?.value);
    const currentLon = Number(form.querySelector('[data-court-location-lon]')?.value);
    if (!Number.isFinite(currentLat) || !Number.isFinite(currentLon) ||
        Math.abs(currentLat - lat) > 0.000001 || Math.abs(currentLon - lon) > 0.000001) return null;
    const placeLabel = [
      properties.name,
      properties.street,
      properties.city,
      properties.state,
      properties.country || 'Philippines'
    ].filter(Boolean).join(', ');
    const pinId = `pin:${lat.toFixed(7)},${lon.toFixed(7)}`;
    updateCourtPinFields(form, { lat, lon, placeId: osmId, osmId, pinId, label: placeLabel }, {
      confirmed: true,
      source: 'manual-map-pin',
      label: placeLabel || `Manually placed map pin · ${lat.toFixed(6)}, ${lon.toFixed(6)}`,
      placeId: osmId,
      pinId,
      osmId
    });
    const status = form.querySelector('#registerCourtLocationStatus');
    if (status) status.textContent = `Pin confirmed and linked to map place ${osmId}.`;
    return { placeId: osmId, osmId, pinId, label: placeLabel };
  } catch (_) {
    return null;
  }
}

async function initializeCourtLocationPinMap(form, initialCoordinates = null) {
  const node = form?.querySelector('[data-court-location-map]');
  if (!node) return;
  let resolveMapReady;
  form._courtPinMapReady = new Promise(resolve => { resolveMapReady = resolve; });
  const prior = state.mapInstances.get('courtLocationPinMap');
  if (prior) { try { prior.remove(); } catch (_) {} state.mapInstances.delete('courtLocationPinMap'); }
  node.innerHTML = '<div class="map-loading">Loading court pin map…</div>';
  try {
    const maplibre = await ensureMapLibreLoaded();
    if (!node.isConnected || !form.isConnected) return;
    node.innerHTML = '';
    const coords = normalizeMapLocationCoordinates(initialCoordinates);
    const center = coords ? [coords.lon, coords.lat] : [PH_MAP_CENTER[1], PH_MAP_CENTER[0]];
    const map = new maplibre.Map({
      container: node,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center,
      zoom: coords ? 15 : 4.6,
      minZoom: 4,
      maxZoom: 19,
      maxBounds: [[115.5, 4.0], [128.6, 22.4]],
      renderWorldCopies: false,
      pitch: 0,
      bearing: 0,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: { compact: true }
    });
    state.mapInstances.set('courtLocationPinMap', map);
    const pin = document.createElement('div');
    pin.className = 'court-location-draggable-pin';
    pin.setAttribute('aria-label', 'Drag to set the exact court location');
    // Keep the location editor's draggable marker as the plain red pin shown
    // in the reference image; unlike registered-court map pins, it has no logo.
    pin.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="50" viewBox="0 0 24 34" aria-hidden="true"><defs><linearGradient id="court-location-pin-red" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff0046"/><stop offset=".5" stop-color="#ff0046"/><stop offset=".5" stop-color="#e60035"/><stop offset="1" stop-color="#e60035"/></linearGradient></defs><path d="M21 10a9 9 0 0 0-18 0c0 6.8 6.8 15.7 8.2 17.9a1 1 0 0 0 1.6 0C14.2 25.7 21 16.8 21 10Z" fill="url(#court-location-pin-red)"/><circle cx="12" cy="10" r="4.5" fill="#fff"/></svg>';
    map.on('load', () => {
      if (!form.isConnected || !node.isConnected) { resolveMapReady(false); return; }
      map.addControl(new maplibre.NavigationControl({ showCompass: false, visualizePitch: false }), 'top-right');
      const marker = new maplibre.Marker({ element: pin, anchor: 'bottom', draggable: true }).setLngLat(center).addTo(map);
      form._courtPinMap = { map, marker };
      const commitManual = lngLat => {
        pin.style.display = '';
        const coordinates = { lat: lngLat.lat, lon: lngLat.lng };
        const pinId = `pin:${lngLat.lat.toFixed(7)},${lngLat.lng.toFixed(7)}`;
        const pinRevision = Number(form._courtPinRevision || 0) + 1;
        form._courtPinRevision = pinRevision;
        updateCourtPinFields(form, { ...coordinates, pinId }, {
          confirmed: true,
          source: 'manual-map-pin',
          label: `Manually placed map pin · ${lngLat.lat.toFixed(6)}, ${lngLat.lng.toFixed(6)}`,
          pinId
        });
        resolveCourtPinPlaceId(form, coordinates, pinRevision);
      };
      marker.on('dragend', () => commitManual(marker.getLngLat()));
      map.on('click', event => {
        if (event.originalEvent?.target?.closest?.('.maplibregl-ctrl, .maplibregl-marker, .maplibregl-popup')) return;
        marker.setLngLat(event.lngLat);
        commitManual(event.lngLat);
      });
      if (coords) {
        updateCourtPinFields(form, coords, { confirmed: coords.verified === true, source: coords.source || 'saved-map-pin', label: coords.label || 'Saved court pin', placeId: coords.placeId || '', pinId: coords.pinId || '', osmId: coords.osmId || '' });
        if (coords.verified !== true) {
          const status = form.querySelector('#registerCourtLocationStatus');
          if (status) status.textContent = 'Previous pin loaded as a preview. Drag it to the correct venue entrance/court or tap the exact location to confirm before saving.';
        }
      }
      window.setTimeout(() => { if (node.isConnected) map.resize(); }, 90);
      resolveMapReady(true);
    });
    map.on('error', () => {
      if (node.isConnected && !form._courtPinMap) node.innerHTML = '<div class="map-loading map-error">The court pin map could not load. Check your internet connection and try again.</div>';
      resolveMapReady(false);
    });
  } catch (_) {
    if (node.isConnected) node.innerHTML = '<div class="map-loading map-error">The court pin map could not load. Check your internet connection and try again.</div>';
    resolveMapReady(false);
  }
}

async function prepareExistingCourtPinPreview(form, court) {
  const current = normalizeMapLocationCoordinates(court?.locationCoordinates);
  if (current?.verified === true || !form?.isConnected) return;
  const pinRevision = Number(form._courtPinRevision || 0);
  const status = form.querySelector('#registerCourtLocationStatus');
  if (status) status.textContent = 'Checking the court name against the map to improve the old pin…';
  const query = [court?.name, court?.location, 'Philippines'].filter(Boolean).join(', ');
  const match = await photonLookup(query);
  if (!form?.isConnected || Number(form._courtPinRevision || 0) !== pinRevision) return;
  if (!match || Number(match.confidence || 0) < 0.55) {
    if (status) status.textContent = 'Could not find a reliable automatic venue match. Drag the pin to the correct court or tap the exact location to confirm it.';
    return;
  }
  const mapReady = await form._courtPinMapReady;
  if (!mapReady || !form.isConnected || Number(form._courtPinRevision || 0) !== pinRevision) return;
  moveCourtLocationPin(form, match, {
    confirmed: false,
    source: 'venue-geocoder-preview',
    label: `Map suggestion · ${match.label || query}`,
    zoom: 16
  });
  if (status) status.textContent = 'A closer map match is shown as a preview. Confirm the exact court by dragging the pin or tapping the map before saving.';
}

function dashboardMapPinMarkup(logo = '') {
  const logoUrl = String(logo || '').trim();
  if (logoUrl) {
    return `<span class="dashboard-map-pin-art dashboard-map-pin-art-logo" aria-hidden="true"><img class="dashboard-map-pin-logo" src="${escapeHTML(logoUrl)}" alt="" aria-hidden="true"></span>`;
  }
  return `<span class="dashboard-map-pin-art" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#fff" stroke="#e53935" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="4.6" fill="#fff"/></svg></span>`;
}

function mapPopupMarkup(item) {
  const courts = asArray(item.courts);
  const sessions = asArray(item.sessions);
  const primaryCourt = courts[0] || null;
  const liveCount = sessions.filter(entry => entry.isLive === true).length;
  const heading = primaryCourt?.name || item.location;
  const sessionSummary = sessions.length
    ? `${sessions.length} session${sessions.length === 1 ? '' : 's'} · ${liveCount} live · ${sessions.length - liveCount} completed`
    : 'Registered court';
  const courtActions = courts.map(court => `<button type="button" class="map-popup-correct-pin" data-map-edit-court-id="${escapeHTML(court.id)}">Edit ${escapeHTML(court.name || 'court')} pin</button>`).join('');
  const sessionButtons = sessions.map(entry => `<button type="button" class="map-popup-session" data-map-session-select="${escapeHTML(entry.id)}"><strong>${escapeHTML(entry.title)}</strong><small>${entry.date ? `${escapeHTML(fmtDate(entry.date))} · ` : ''}${entry.isLive ? 'LIVE' : 'Completed'}</small></button>`).join('');
  return `<div class="map-popup"><div class="map-popup-heading">${primaryCourt?.logo ? `<img src="${escapeHTML(primaryCourt.logo)}" alt="" aria-hidden="true">` : ''}<span><strong class="map-popup-location">${escapeHTML(heading)}</strong><small class="map-popup-summary">${escapeHTML(item.location)} · ${escapeHTML(sessionSummary)}</small></span></div>${courtActions ? `<div class="map-popup-court-actions">${courtActions}</div>` : ''}${sessionButtons ? `<div class="map-popup-sessions">${sessionButtons}</div>` : ''}</div>`;
}
async function populateMapMarkers(map, node, locations) {
  const status = document.querySelector(`[data-map-status="${node.id}"]`);
  if (!locations.length) {
    if (status) status.textContent = 'No session or registered court location has been saved yet.';
    focusGeneralSantosMap(node.id);
    return;
  }
  if (status) status.textContent = `Finding map pins for ${locations.length} saved location${locations.length === 1 ? '' : 's'}…`;
  let pinned = 0;
  const unresolvedLocations = [];
  for (const item of locations) {
    if (!node.isConnected || !map || !map.getStyle()) return;
    const savedLocation = String(item.location || '').trim();
    if (!savedLocation) { unresolvedLocations.push('Unnamed location'); continue; }
    const primaryCourt = asArray(item.courts)[0] || null;
    const courtCoordinates = asArray(item.courts)
      .map(court => normalizeMapLocationCoordinates(court.locationCoordinates))
      .find(Boolean);
    const sessionCoordinates = asArray(item.sessions)
      .map(entry => normalizeMapLocationCoordinates(entry.locationCoordinates))
      .find(Boolean);

    // A saved court pin is the authoritative location. Do not ask Photon to
    // replace it with a broad venue-name result just because it was created by
    // the map search instead of a manual drag.
    let coords = normalizeMapLocationCoordinates(courtCoordinates || item.coordinates || sessionCoordinates);
    if (!coords) coords = coordinatesFromText(savedLocation);
    if (!coords) coords = await photonLookup(savedLocation);
    // Older registered courts may have only a court name and address saved.
    // Try the combined query only after the address-only lookup has failed.
    if (!coords && primaryCourt) {
      coords = await photonLookup(`${primaryCourt.name}, ${savedLocation}, Philippines`);
    }
    if (!node.isConnected || !map) return;
    if (!coords || !isPhilippinesCoordinate(Number(coords.lat), Number(coords.lon))) {
      unresolvedLocations.push(primaryCourt?.name || savedLocation);
      continue;
    }

    state.mapResolvedLocations.set(normalizeName(item.location), coords);
    const markerElement = document.createElement('button');
    markerElement.type = 'button';
    const isRegisteredCourt = asArray(item.courts).length > 0;
    const registeredCourt = asArray(item.courts)[0] || null;
    const isLiveLocation = item.isLive === true || asArray(item.sessions).some(entry => entry.isLive === true);
    // Keep MapLibre's outer marker element free of CSS transforms. MapLibre
    // positions this element at the GPS coordinate; only the nested artwork
    // receives visual styling or a live-state glow.
    const markerLogo = registeredCourtLogo(registeredCourt);
    const registeredAt = String(registeredCourt?.registeredAt || '').trim();
    const registeredMarkerStatus = isRegisteredCourt
      ? registeredCourtMapMarkerStatus(registeredAt, isLiveLocation)
      : (isLiveLocation ? 'live' : 'idle');
    markerElement.className = `dashboard-map-pin${isRegisteredCourt ? ' dashboard-map-pin-court' : ''}${registeredMarkerStatus === 'live' ? ' is-live' : ''}${registeredMarkerStatus === 'new' ? ' is-new' : ''}${markerLogo ? ' has-logo' : ''}`;
    if (isRegisteredCourt) {
      markerElement.dataset.registeredCourtMarker = 'true';
      markerElement.dataset.registeredAt = registeredAt;
      markerElement.dataset.registeredCourtLive = isLiveLocation ? 'true' : 'false';
    }
    markerElement.setAttribute('aria-label', isRegisteredCourt
      ? `${isLiveLocation ? 'Live registered court' : 'Registered court'}: ${registeredCourt.name} at ${item.location}`
      : `${isLiveLocation ? 'Live session location' : 'Court location'}: ${item.location}`);
    markerElement.title = `${isRegisteredCourt ? registeredCourt.name : item.location}${isLiveLocation ? ' · LIVE NOW' : ''} · ${item.location}`;
    // Registered courts with a saved logo show only the compact logo image.
    // Center its image on the saved coordinate; other location markers keep
    // their original bottom-anchored red SVG pin.
    markerElement.innerHTML = dashboardMapPinMarkup(markerLogo);
    const markerLogoImage = markerElement.querySelector('.dashboard-map-pin-logo');
    if (markerLogoImage) {
      markerLogoImage.addEventListener('error', () => {
        // Fall back to the plain red map pin if the court logo is unavailable.
        markerElement.innerHTML = dashboardMapPinMarkup();
        markerElement.classList.remove('has-logo');
      }, { once: true });
    }
    const marker = new window.maplibregl.Marker({ element: markerElement, anchor: markerLogo ? 'center' : 'bottom' })
      .setLngLat([Number(coords.lon), Number(coords.lat)]);
    if (node.dataset.mapModal === 'true') {
      const popup = new window.maplibregl.Popup({ offset: 16, closeButton: true, maxWidth: '210px' }).setHTML(mapPopupMarkup(item));
      marker.setPopup(popup);
    } else if (markerLogo) {
      // A registered court logo pin acts as a direct map-focus control.
      markerElement.addEventListener('click', () => focusMapCoordinates(node.id, coords, registeredCourt?.name || item.location));
    } else {
      markerElement.addEventListener('click', () => openMapModal(item.sessions?.[0]?.id || '', node.dataset.mapIncludeRegistered === 'true'));
    }
    marker.addTo(map);
    pinned += 1;
  }
  if (status) {
    const unresolvedSummary = unresolvedLocations.length
      ? ` · ${unresolvedLocations.length} could not be placed: ${unresolvedLocations.slice(0, 4).join(', ')}${unresolvedLocations.length > 4 ? ', …' : ''}`
      : '';
    status.textContent = pinned
      ? `${pinned} map pin${pinned === 1 ? '' : 's'} displayed${unresolvedSummary}.`
      : `No map pins could be placed. The saved court records need valid Philippines pin coordinates or a recognizable address.${unresolvedSummary}`;
  }
  const focusedLocation = String(node.dataset.mapFocusLocation || '').trim();
  const focusedSessionId = String(node.dataset.mapFocusSession || '');
  if (focusedLocation) {
    const focusedCoordinates = state.mapResolvedLocations.get(normalizeName(focusedLocation));
    if (focusedCoordinates) focusMapCoordinates(node.id, focusedCoordinates, focusedLocation);
    else focusGeneralSantosMap(node.id);
  } else if (focusedSessionId) {
    if (!focusMapSession(focusedSessionId, node.id)) focusGeneralSantosMap(node.id);
  } else {
    // Keep the map useful even when there is no active live session.
    focusGeneralSantosMap(node.id);
  }
}
function mapSessionDetailsMarkup(session) {
  if (!session) return '<div class="map-detail-empty"><strong>No session selected</strong><span>Choose a saved open-play session to see its details beside the map.</span></div>';
  const matches = (state.data?.matches || []).filter(match => String(match.sessionId) === String(session.id)).length;
  const courts = asArray(session.courtNames).join(', ') || 'No court details saved';
  const created = session.startedAt ? fmtDate(session.startedAt, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not available';
  const location = String(session.location || '').trim();
  return `<div class="map-session-detail"><div class="map-session-status"><span class="status-pill ${session.isLive ? 'live' : 'ended'}">${session.isLive ? 'LIVE NOW' : 'COMPLETED'}</span><span>${escapeHTML(sessionDateLabel(session))}</span></div><h3>${escapeHTML(session.title)}</h3><div class="map-session-facts"><div><span>Session time</span><strong>${escapeHTML(sessionTimeLabel(session))}</strong></div><div><span>Created / started</span><strong>${escapeHTML(created)}</strong></div><div><span>Location</span><strong>${escapeHTML(location || 'Location not saved')}</strong></div><div><span>Courts</span><strong>${escapeHTML(courts)}</strong></div><div class="map-session-metrics"><span><strong>${(session.attendees || []).length}</strong> players</span><span><strong>${matches}</strong> matches</span></div></div><p class="map-pin-note">${location ? 'The pin on the map is matched from this session’s saved Location field.' : 'This session has no saved location, so it cannot have a map pin yet.'}</p><button type="button" class="btn btn-sm btn-primary" data-map-open-session="${escapeHTML(session.id)}">View full session details</button></div>`;
}
function mapModalMarkup(selectedSessionId, includeRegisteredCourts = false) {
  const sessions = state.data?.sessions || [];
  const selected = sessions.find(session => String(session.id) === String(selectedSessionId)) || sessions[0] || null;
  const locations = mapSessionsForPins(includeRegisteredCourts);
  const payload = JSON.stringify(locations).replace(/</g, '\\u003c');
  // On the Dashboard, keep the saved-location list limited to actual open-play
  // sessions. Registered-court-only pins remain on the map, but not in this list.
  const dashboardSessionLocationsOnly = state.page === 'dashboard';
  const sidebarLocations = dashboardSessionLocationsOnly
    ? mapSessionsForPins(true).filter(item => asArray(item.sessions).some(entry => typeof entry.isLive === 'boolean'))
    : locations;
  const sessionOptions = sessions.map(session => `<option value="${escapeHTML(session.id)}" ${selected && String(selected.id) === String(session.id) ? 'selected' : ''}>${escapeHTML(session.title)}${session.date ? ` · ${escapeHTML(fmtDate(session.date, { month: 'short', day: 'numeric' }))}` : ''}${session.isLive ? ' · LIVE' : ''}</option>`).join('');
  const savedLocations = sidebarLocations.length ? sidebarLocations.map(item => {
    const recent = item.sessions?.[0];
    const courtNames = asArray(item.courts).map(court => court.name).join(', ');
    const courtSummary = courtNames ? `${asArray(item.courts).length} registered court${item.courts.length === 1 ? '' : 's'} · ${courtNames}` : '';
    const liveCount = asArray(item.sessions).filter(entry => entry.isLive === true).length;
    const completedCount = asArray(item.sessions).filter(entry => entry.isLive === false).length;
    const sessionSummary = recent
      ? `${item.sessions.length} session${item.sessions.length === 1 ? '' : 's'} · ${liveCount} live · ${completedCount} completed · ${recent.title}`
      : '';
    const summary = dashboardSessionLocationsOnly ? sessionSummary : [courtSummary, sessionSummary].filter(Boolean).join(' · ');
    const pinContent = `<span class="map-location-pin">${asArray(item.courts).length && item.courts[0].logo ? `<img src="${escapeHTML(item.courts[0].logo)}" alt="">` : icon('pin')}</span><span><strong>${escapeHTML(item.location)}</strong><small>${escapeHTML(summary || 'Saved court location')}</small></span><span class="map-location-arrow">${icon('arrow')}</span>`;
    if (recent) {
      return `<button type="button" class="map-location-row" data-map-session-select="${escapeHTML(recent.id)}" aria-label="Focus map on ${escapeHTML(item.location)}">${pinContent}</button>`;
    }
    return `<button type="button" class="map-location-row is-static" data-map-location-focus="${escapeHTML(item.location)}" aria-label="Focus map on ${escapeHTML(item.location)}">${pinContent}</button>`;
  }).join('') : `<p class="map-detail-empty">${dashboardSessionLocationsOnly ? 'No live or completed session locations have been saved yet. Save a location in Session Setup or edit a session to add one.' : 'No saved court locations yet. Register a court or save a location in Session Setup to create a map pin.'}</p>`;
  const liveFocusSessionId = selected?.isLive ? String(selected.id || '') : '';
  const listHeading = dashboardSessionLocationsOnly ? 'Live & completed session locations' : 'Saved court locations';
  return `<div class="map-modal-layout"><aside class="map-modal-details"><div class="map-modal-intro"><span class="eyebrow">${escapeHTML(organizerClubName())} · COURT MAP</span><h3>Open-play locations</h3><p>Session locations and registered court locations are shown as map pins.</p></div><div class="map-session-picker"><label for="mapModalSessionSelect">Session details</label><select id="mapModalSessionSelect" class="select-control" ${sessions.length ? '' : 'disabled'}>${sessionOptions || '<option>No saved sessions</option>'}</select></div><div id="mapModalSessionInfo">${mapSessionDetailsMarkup(selected)}</div><div class="map-saved-location-list"><div class="map-list-heading">${listHeading} <span>${sidebarLocations.length}</span></div>${savedLocations}</div></aside><section class="map-modal-view"><div class="map-modal-toolbar"><span><strong>3D Philippines map</strong><small>Drag to move · scroll or + / − to zoom</small></span><div class="map-modal-actions"><button type="button" class="btn btn-sm" data-map-show-philippines>Philippines view</button><button type="button" class="btn btn-sm btn-primary" data-map-focus-selected ${selected ? '' : 'disabled'}>Focus session</button></div></div><div id="sessionMapModal" class="interactive-map map-modal-canvas" data-map-variant="modal" data-map-modal="true" data-map-include-registered="${includeRegisteredCourts ? 'true' : 'false'}" data-map-focus-session="${escapeHTML(liveFocusSessionId)}" data-map-locations="${escapeHTML(payload)}" role="application" aria-label="Draggable and zoomable 3D Philippines map with open-play court pins"><div class="map-loading">Loading 3D Philippines map…</div></div><p class="map-status" data-map-status="sessionMapModal">Loading session court pins…</p></section></div>`;
}
function openMapModal(sessionId = '', includeRegisteredCourts = false) {
  const sessions = state.data?.sessions || [];
  const initial = sessions.find(session => String(session.id) === String(sessionId)) || getLiveSession() || sessions[0] || null;
  state.mapModalSessionId = initial?.id || '';
  state.mapIncludeRegisteredCourts = Boolean(includeRegisteredCourts);
  modal('Philippines 3D Court Map & Session Details', mapModalMarkup(state.mapModalSessionId, state.mapIncludeRegisteredCourts), { wide: true, className: 'map-modal-card' });
  initializeInteractiveMaps();
  window.setTimeout(() => state.mapInstances.get('sessionMapModal')?.resize(), 50);
}
function setMapModalSession(sessionId) {
  const session = (state.data?.sessions || []).find(item => String(item.id) === String(sessionId));
  if (!session) return;
  state.mapModalSessionId = session.id;
  const select = $('#mapModalSessionSelect');
  if (select) select.value = session.id;
  const modalMapNode = $('#sessionMapModal');
  if (modalMapNode) {
    modalMapNode.dataset.mapFocusSession = session.id;
    modalMapNode.dataset.mapFocusLocation = '';
  }
  const details = $('#mapModalSessionInfo');
  if (details) details.innerHTML = mapSessionDetailsMarkup(session);
  focusMapSession(session.id, 'sessionMapModal');
}
function focusMapCoordinates(mapId, coordinates, label = '') {
  const map = state.mapInstances.get(mapId);
  const coords = normalizeMapLocationCoordinates(coordinates);
  if (!map || !coords) return false;
  map.flyTo({ center: [Number(coords.lon), Number(coords.lat)], zoom: 15, pitch: 54, bearing: -16, duration: 1250, essential: true });
  return true;
}
function focusMapSession(sessionId, mapId = 'sessionMapModal') {
  const item = mapSessionsForPins(state.mapIncludeRegisteredCourts).find(location => location.sessions.some(entry => String(entry.id) === String(sessionId)));
  if (!item) return false;
  const coords = state.mapResolvedLocations.get(normalizeName(item.location));
  if (!coords) {
    const status = document.querySelector(`[data-map-status="${mapId}"]`);
    if (status) status.textContent = `Finding the saved venue “${item.location}”…`;
    return false;
  }
  return focusMapCoordinates(mapId, coords, item.location);
}
async function focusRegisteredCourtOnMap(courtId) {
  const court = asArray(state.data?.registeredCourts).find(item => String(item?.id || '') === String(courtId));
  if (!court) return false;
  const location = String(court.location || '').trim();
  let coords = normalizeMapLocationCoordinates(court.locationCoordinates || court.coordinates || court);
  if (!coords && location) coords = state.mapResolvedLocations.get(normalizeName(location)) || null;
  if (!coords && location) coords = await photonLookup(location);
  const mapId = ['venuesCourtMap', 'dashboardCourtMap'].find(id => state.mapInstances.has(id));
  if (!coords || !mapId || !focusMapCoordinates(mapId, coords, court.name || location || 'registered court')) {
    toast(`The map location for ${court.name || 'this court'} is not available yet.`, 'error');
    return false;
  }
  return true;
}
function focusGeneralSantosMap(mapId) {
  const map = state.mapInstances.get(mapId);
  if (!map) return false;
  map.flyTo({ center: [125.1716, 6.1164], zoom: 11.5, pitch: 34, bearing: -8, duration: 950, essential: true });
  return true;
}
function showPhilippinesMap(mapId = 'sessionMapModal') {
  const map = state.mapInstances.get(mapId);
  if (!map) return;
  map.fitBounds([[115.5, 4.0], [128.6, 22.4]], { padding: mapId === 'sessionMapModal' ? 44 : 10, maxZoom: mapId === 'sessionMapModal' ? 5.2 : 4.8, duration: 900 });
  map.easeTo({ pitch: 34, bearing: -8, duration: 900 });
}
function collapseMapAttribution(node) {
  const attribution = $('.maplibregl-ctrl-attrib', node);
  if (!attribution) return;
  // MapLibre initially expands its compact control; start with the details closed.
  attribution.classList.add('maplibregl-compact');
  attribution.classList.remove('maplibregl-compact-show');
  attribution.removeAttribute('open');
}

function ensureMapLibreLoaded() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (mapLibreLoadPromise) return mapLibreLoadPromise;

  if (!document.querySelector('link[data-maplibre-stylesheet]')) {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = 'https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css';
    stylesheet.dataset.maplibreStylesheet = 'true';
    document.head.append(stylesheet);
  }

  mapLibreLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js';
    script.async = true;
    script.dataset.maplibreScript = 'true';
    script.onload = () => window.maplibregl ? resolve(window.maplibregl) : reject(new Error('MapLibre did not initialize.'));
    script.onerror = () => reject(new Error('MapLibre could not be downloaded.'));
    document.head.append(script);
  }).catch(error => {
    mapLibreLoadPromise = null;
    throw error;
  });
  return mapLibreLoadPromise;
}

function initializeInteractiveMaps() {
  const mapNodes = $$('.interactive-map');
  if (!mapNodes.length) return;
  if (!window.maplibregl) {
    ensureMapLibreLoaded().then(() => {
      // Re-query after loading: the user may have navigated away while the CDN
      // request was in flight, so only initialize maps that are still mounted.
      initializeInteractiveMaps();
    }).catch(() => {
      $$('.interactive-map').forEach(node => {
        if (node.isConnected) node.innerHTML = '<div class="map-loading map-error">The 3D map library could not be loaded. Check your internet connection and refresh.</div>';
      });
    });
    return;
  }
  mapNodes.forEach(node => {
    if (state.mapInstances.has(node.id)) return;
    const isModal = node.dataset.mapModal === 'true';
    node.innerHTML = '';
    const map = new window.maplibregl.Map({
      container: node,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [PH_MAP_CENTER[1], PH_MAP_CENTER[0]],
      zoom: 4.4,
      minZoom: 3.8,
      maxZoom: 18,
      pitch: isModal ? 43 : 32,
      bearing: -8,
      maxBounds: [[115.5, 4.0], [128.6, 22.4]],
      renderWorldCopies: false,
      scrollZoom: true,
      dragPan: true,
      dragRotate: false,
      pitchWithRotate: false,
      touchZoomRotate: true,
      cooperativeGestures: false,
      attributionControl: { compact: true },
      fadeDuration: 180
    });
    map.addControl(new window.maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right');
    collapseMapAttribution(node);
    map.on('resize', () => collapseMapAttribution(node));
    state.mapInstances.set(node.id, map);
    map.on('load', () => {
      if (!node.isConnected) return;
      collapseMapAttribution(node);
      map.fitBounds([[115.5, 4.0], [128.6, 22.4]], { padding: isModal ? 42 : 8, maxZoom: isModal ? 5.2 : 4.8, duration: 0 });
      map.setPitch(isModal ? 43 : 32);
      let locations = [];
      try { locations = JSON.parse(node.dataset.mapLocations || '[]'); } catch (_) { locations = []; }
      populateMapMarkers(map, node, locations);
      window.setTimeout(() => {
        if (!node.isConnected) return;
        map.resize();
        collapseMapAttribution(node);
      }, 80);
    });
    map.on('error', event => {
      if (!node.isConnected || !event?.error) return;
      const status = document.querySelector(`[data-map-status="${node.id}"]`);
      if (status && /style|source|tile|fetch|network/i.test(String(event.error.message || ''))) {
        status.textContent = 'Map tiles are temporarily unavailable. Check your internet connection and refresh.';
      }
    });
  });
}
function renderDashboard() {
  const players = state.data.players;
  const sessions = state.data.sessions;
  const matches = state.data.matches;
  const attendanceCount = countAttendanceEntries();
  const live = getLiveSession();
  const activeCourts = live ? state.data.courts.filter(court => ['Active', 'Ready', 'Waiting', 'Available'].includes(court.status)) : [];
  const lastSession = sessions[0] || null;
  const recentMatches = [];
  if (lastSession) {
    const sessionId = String(lastSession.id);
    for (const match of matches) {
      if (String(match.sessionId) !== sessionId) continue;
      const key = String(match.playedAt || '');
      let insertAt = 0;
      while (insertAt < recentMatches.length && String(recentMatches[insertAt].playedAt || '') >= key) insertAt += 1;
      if (insertAt < 5) {
        recentMatches.splice(insertAt, 0, match);
        if (recentMatches.length > 5) recentMatches.pop();
      } else if (recentMatches.length < 5) {
        recentMatches.push(match);
      }
    }
  }
  const recentAction = lastSession
    ? `<span class="latest-session-label">${escapeHTML(lastSession.title)}${lastSession.date ? ` · ${escapeHTML(fmtDate(lastSession.date, { month: 'short', day: 'numeric' }))}` : ''}</span>`
    : '<span class="latest-session-label">Latest session</span>';
  const courtsMarkup = courtStatusMarkup(live);
  const recentMarkup = recentMatches.length
    ? `<div class="table-wrap"><table class="compact-table"><thead><tr><th>Court</th><th>Players</th><th>Result</th></tr></thead><tbody>${recentMatches.map(match => `<tr><td>${escapeHTML(match.courtName)}</td><td class="primary-cell">${escapeHTML(match.teamANames.join(' / '))} <span>vs</span> ${escapeHTML(match.teamBNames.join(' / '))}</td><td><span class="score-pill">${escapeHTML(match.scoreLabel)}</span></td></tr>`).join('')}</tbody></table></div>`
    : emptyState('No matches in the latest session', lastSession ? 'Matches from this session will appear here after they are recorded in Queueing.' : 'Completed matches recorded in Queueing will appear here.');
  return `<div class="page-dashboard">
    ${pageHeading('HUSAY DINKERS / OVERVIEW', 'Pickleball Dashboard', 'Your existing queueing records, open-play attendance and match results in one place.', `<button class="btn dashboard-refresh-button${state.refreshingDashboard ? ' is-refreshing' : ''}" type="button" data-action="refresh" aria-label="Refresh dashboard" aria-busy="${state.refreshingDashboard ? 'true' : 'false'}" ${state.refreshingDashboard ? 'disabled' : ''}>${refreshIcon()}<span>Refresh</span></button><a class="btn btn-primary" href="/session" target="_blank" rel="noopener">${icon('plus')} Start Open Play</a>`)}
    ${liveBanner()}
    <div class="stats-grid">${statCard('Registered Players', String(players.filter(player => !player.historicalOnly).length), 'Registered Player Cloud', 'users')}${statCard('Recorded Matches', String(matches.length), 'From queueing match logs', 'trophy', true)}${statCard('Attendance Records', String(attendanceCount), 'Saved session check-ins', 'users', true)}${statCard('Active Courts', String(live ? activeCourts.filter(court => court.status === 'Active').length : 0), live ? `${activeCourts.length} courts in current session` : 'No live session', 'court')}</div>
    <div class="dashboard-grid">
      <section class="panel panel-pad trend-panel">${panelTitle('Attendance Trend', 'chart')}<div class="chart-meta"><strong data-count-target="${attendanceCount}" data-count-key="attendance-total">0</strong><span>attendance entries loaded from queueing history</span></div><div class="chart-box">${chartMarkup(sessions)}</div></section>
      <section class="panel panel-pad ranking-panel">${panelTitle('Overall Player Rankings', 'trophy', '<button class="text-link" data-page="rankings">View all →</button>')}<div class="ranking-list" id="dashboardTopRankings"><div class="ranking-loading">Preparing player rankings…</div></div></section>
      <div class="side-stack">${mapCard(live || lastSession, 'dashboardCourtMap')}<section class="panel panel-pad court-panel">${panelTitle('Court Status', 'court', '<a class="text-link" href="/queueing" target="_blank" rel="noopener">Open Queueing →</a>')}<div class="court-status-grid" role="region" aria-label="Court status. Swipe horizontally to view each court"><div class="court-status-track ${live && activeCourts.length ? '' : 'is-empty'}">${courtsMarkup}</div></div></section></div>
      <section class="panel panel-pad recent-panel">${panelTitle('Recent Matches', 'trophy', recentAction)}${recentMarkup}</section>
    </div>
  </div>`;
}
function sessionCard(session) {
  const count = (session.attendees || []).length;
  return `<article class="session-card ${session.isLive ? 'is-live' : ''}"><div class="session-main"><h3 class="session-name">${sessionStatusBadge(sessionStatus(session))}<span>${escapeHTML(session.title)}</span></h3><div class="session-meta"><span>${icon('calendar')}${escapeHTML(sessionDateLabel(session))}</span><span>${icon('clock')}${escapeHTML(sessionTimeLabel(session))}</span><span>${icon('pin')}${escapeHTML(sessionLocationLabel(session))}</span><span>${icon('court')}${escapeHTML(sessionCourtsLabel(session))}</span><span>${count} player${count === 1 ? '' : 's'}</span></div></div><div class="session-actions"><button class="btn btn-sm" data-session-view="${escapeHTML(session.id)}">Details</button>${session.isLive ? `<a class="btn btn-sm btn-primary" href="/queueing" target="_blank" rel="noopener">Open Queue</a>` : `<button class="btn btn-sm" data-session-edit="${escapeHTML(session.id)}">Rename</button><button class="icon-action danger" title="Delete session" data-session-delete="${escapeHTML(session.id)}">${icon('trash')}</button>`}${session.isLive && getRegistrationUrl(session) ? `<a class="btn btn-sm btn-soft" href="${escapeHTML(getRegistrationUrl(session))}" target="_blank" rel="noopener">Register</a>` : ''}</div></article>`;
}
function renderSessions() {
  const all = visibleRows(sortedSessions()).filter(session => state.filters.sessionStatus === 'all' || sessionStatus(session) === state.filters.sessionStatus);
  const liveCount = state.data.sessions.filter(session => session.isLive).length;
  const completedCount = state.data.sessions.filter(session => !session.isLive).length;
  const attendanceCount = countAttendanceEntries();
  return `<div class="page-stack">${pageHeading('HUSAY DINKERS / OPEN PLAY', 'Open Play Sessions', 'Session history and live attendance synced from your original queueing system.', `<a class="btn btn-primary" href="/session" target="_blank" rel="noopener">${icon('plus')} Start Open Play</a>`)}
    <div class="metric-grid"><div class="metric-tile"><span>Live sessions</span>${metricCount('sessions', 'live-sessions', liveCount)}</div><div class="metric-tile"><span>Completed sessions</span>${metricCount('sessions', 'completed-sessions', completedCount)}</div><div class="metric-tile"><span>Total attendance</span>${metricCount('sessions', 'total-attendance', attendanceCount)}</div><div class="metric-tile"><span>Recorded matches</span>${metricCount('sessions', 'recorded-matches', state.data.matches.length)}</div></div>
    <section class="panel panel-pad"><div class="panel-heading">${panelTitle('Session History', 'calendar')}<div class="toolbar"><select class="select-control" id="sessionStatusFilter" aria-label="Filter sessions"><option value="all" ${state.filters.sessionStatus === 'all' ? 'selected' : ''}>All sessions</option><option value="Live" ${state.filters.sessionStatus === 'Live' ? 'selected' : ''}>Live</option><option value="Completed" ${state.filters.sessionStatus === 'Completed' ? 'selected' : ''}>Completed</option></select></div></div><div class="session-list">${all.length ? all.map(sessionCard).join('') : emptyState('No sessions found', 'Start an open-play session in the existing Session Setup page.')}</div></section>
    <p class="page-note">The original queueing system creates a session when an organizer starts Open Play. This dashboard does not create a separate, duplicate session record.</p></div>`;
}
function playersTable(players) {
  if (!players.length) return emptyState('No registered players yet', 'Players added through the player registration page will appear here.', 'Open registration', 'register-player');
  return `<div class="table-wrap players-table-wrap"><table class="data-table players-table"><colgroup><col style="width:5%"><col style="width:30%"><col style="width:16%"><col style="width:11%"><col style="width:14%"><col style="width:11%"><col style="width:13%"></colgroup><thead><tr><th scope="col">#</th><th scope="col">Player's Fullname (Nickname)</th><th scope="col">Category</th><th scope="col">Gender</th><th scope="col">DUPR ID</th><th scope="col">Attendance</th><th scope="col">Match Records</th></tr></thead><tbody>${players.map((player, index) => {
    const stats = playerStats(player);
    const category = categoryName(player.category);
    const categoryClass = `category-${categoryCode(player.category).toLowerCase()}`;
    const gender = String(player.gender || '').trim();
    const genderClass = gender.toLowerCase() === 'male' ? 'gender-male' : gender.toLowerCase() === 'female' ? 'gender-female' : '';
    const genderCell = genderClass
      ? `<span class="player-gender-badge ${genderClass}">${escapeHTML(gender)}</span>`
      : escapeHTML(gender || '—');
    const fullDisplayName = `${player.name || 'Unnamed Player'}${player.nickname ? ` (${player.nickname})` : ''}`;
    const registeredOn = formatPlayerRegisteredOn(player);
    return `<tr><td class="player-number">${index + 1}</td><td class="primary-cell"><span class="table-player"><span class="player-avatar">${initials(player.name)}</span><span class="player-name-copy"><span class="player-name-text">${escapeHTML(fullDisplayName)}</span>${registeredOn ? `<span class="player-registered-date">${escapeHTML(registeredOn)}</span>` : ''}</span></span></td><td><span class="player-category-badge ${escapeHTML(categoryClass)}">${escapeHTML(category.toUpperCase())}</span></td><td>${genderCell}</td><td><strong>${escapeHTML(player.duprId || '—')}</strong></td><td class="player-count-cell">${stats.attendance}</td><td class="player-count-cell">${stats.matches}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function renderPlayers() {
  const registeredPlayers = state.data.players.filter(player => !player.historicalOnly);
  const players = visibleRows([...registeredPlayers].sort((a, b) => a.name.localeCompare(b.name)));
  const attendanceCount = countAttendanceEntries();
  const rated = registeredPlayers.filter(player => String(player.duprId || '').trim()).length;
  const nonDuprPlayers = registeredPlayers.length - rated;
  const duprPlayerMatchCount = state.data.matches.filter(match => matchIsDupr(match, state.data.sessions.find(session => session.id === match.sessionId))).length;
  const nonDuprPlayerMatchCount = state.data.matches.length - duprPlayerMatchCount;
  const skillCategories = [
    { code: 'BEG', match: ['BEG'], className: 'category-beg' },
    { code: 'NOV', match: ['NOV'], className: 'category-nov' },
    { code: 'INT', match: ['INT'], className: 'category-int' },
    { code: 'ADV', match: ['ADV'], className: 'category-adv' },
    { code: 'EXT', match: ['EXP', 'EXT'], className: 'category-exp' }
  ];
  const skillCounts = skillCategories.map(category => ({
    ...category,
    count: registeredPlayers.filter(player => category.match.includes(categoryCode(player.category))).length
  }));
  const skillCountMarkup = `<div class="registered-player-skill-counts" aria-label="Registered player skill category counts">${skillCounts.map(category => `<span class="registered-player-skill-count ${category.className}"><span class="registered-player-skill-code">${category.code}</span><span class="registered-player-skill-value" data-count-target="${category.count}" data-count-key="metric:players:registered-skill-${category.code.toLowerCase()}" aria-live="off">0</span></span>`).join('')}</div>`;
  return `<div class="page-stack">${pageHeading('HUSAY DINKERS / COMMUNITY', 'Players', 'Registered Player Cloud profiles used by queueing, player registration and match history.', `<button class="btn" data-action="import-players">${icon('upload')} Import CSV</button><button class="btn" data-action="export-players">${icon('download')} Export CSV</button><button class="btn btn-primary" data-action="register-player">${icon('plus')} Register Player</button><input id="playerCsvImportFile" type="file" accept=".csv,text/csv" hidden>`)}
    <div class="metric-grid"><div class="metric-tile registered-players-metric"><span>Registered players</span>${metricCount('players', 'registered-players', registeredPlayers.length)}${skillCountMarkup}</div><div class="metric-tile metric-breakdown-tile player-dupr-breakdown"><span>With DUPR ID</span>${metricCount('players', 'with-dupr-id', registeredPlayers.length)}<div class="metric-breakdown" aria-label="DUPR and non-DUPR player counts"><span class="metric-breakdown-item dupr"><span>DUPR</span><strong data-count-target="${rated}" data-count-key="metric:players:with-dupr-id-dupr" aria-live="off">0</strong></span><span class="metric-breakdown-item non-dupr"><span>Non DUPR</span><strong data-count-target="${nonDuprPlayers}" data-count-key="metric:players:with-dupr-id-non-dupr" aria-live="off">0</strong></span></div></div><div class="metric-tile"><span>Attendance entries</span>${metricCount('players', 'attendance-entries', attendanceCount)}</div><div class="metric-tile metric-breakdown-tile player-match-records-breakdown"><span>Match records</span>${metricCount('players', 'match-records', state.data.matches.length)}<div class="metric-breakdown" aria-label="DUPR and non-DUPR match counts"><span class="metric-breakdown-item dupr"><span>DUPR</span><strong data-count-target="${duprPlayerMatchCount}" data-count-key="metric:players:match-records-dupr" aria-live="off">0</strong></span><span class="metric-breakdown-item non-dupr"><span>Non DUPR</span><strong data-count-target="${nonDuprPlayerMatchCount}" data-count-key="metric:players:match-records-non-dupr" aria-live="off">0</strong></span></div></div></div>
    <section class="panel panel-pad"><div class="panel-heading">${panelTitle('Registered Player Cloud', 'users')}<div class="toolbar"><select class="select-control" id="playerCategoryFilter"><option value="all">All categories</option>${['Beginner','Novice','Intermediate','Advanced','Expert'].map(cat => `<option value="${cat}" ${state.filters.playerCategory === cat ? 'selected' : ''}>${cat}</option>`).join('')}</select></div></div><div id="playersTableWrap">${playersTable(players.filter(player => state.filters.playerCategory === 'all' || player.category === state.filters.playerCategory))}</div></section>
    <p class="page-note">Player profiles are stored in the existing Registered Player Cloud. Register new players through the live session registration page so they enter the real queue.</p></div>`;
}
function matchesTable(matches) {
  if (!matches.length) return emptyState('No matches recorded', 'Completed matches saved by the queueing system will appear here.');
  return `<div class="table-wrap match-records-wrap"><table class="data-table match-records-table"><colgroup><col style="width:15%"><col style="width:9%"><col style="width:13%"><col style="width:16%"><col style="width:16%"><col style="width:9%"><col style="width:10%"><col style="width:12%"></colgroup><thead><tr><th scope="col">Date</th><th scope="col">Court</th><th scope="col">Duration</th><th scope="col">Team 1</th><th scope="col">Team 2</th><th scope="col">Result</th><th scope="col">Type</th><th scope="col">Action</th></tr></thead><tbody>${matches.map(match => `<tr><td class="match-date-cell"><strong>${escapeHTML(fmtDate(match.date))}</strong><span class="muted-cell match-time">${escapeHTML(match.timeLabel || match.time || '—')}</span></td><td>${escapeHTML(match.courtName || '—')}</td><td class="match-duration-cell">${escapeHTML(match.durationLabel || '—')}</td><td class="primary-cell match-team-cell">${escapeHTML(match.teamANames.join(' / ') || '—')}</td><td class="primary-cell match-team-cell">${escapeHTML(match.teamBNames.join(' / ') || '—')}</td><td><span class="score-pill">${escapeHTML(match.scoreLabel || '—')}</span></td><td>${match.duprMatch ? '<span class="status-pill dupr">DUPR</span>' : '<span class="status-pill gray">NON-DUPR</span>'}</td><td><div class="table-actions">${match.isScored ? `<button class="btn btn-sm" data-match-edit="${escapeHTML(match.key)}">Edit</button>` : '<button class="btn btn-sm" type="button" disabled title="Only matches with a recorded score can be edited">Edit</button>'}<button class="btn btn-sm btn-danger" type="button" title="Delete match" data-match-delete="${escapeHTML(match.key)}">${icon('trash')} Delete</button></div></td></tr>`).join('')}</tbody></table></div>`;
}
function filteredMatchRecords() {
  const selectedSessionId = currentRankingSessionId();
  const matchType = state.filters.matchType || 'all';
  return visibleRows([...state.data.matches]).filter(match => {
    const matchesSession = selectedSessionId === 'all' || String(match.sessionId || '') === selectedSessionId;
    const matchesType = matchType === 'all' || (matchType === 'dupr' ? match.duprMatch === true : match.duprMatch !== true);
    return matchesSession && matchesType;
  });
}
function updateFilteredMatchRecordsMetric() {
  if (state.page !== 'matches') return;
  const metric = $('#pageContent [data-count-key="metric:matches:recorded-matches"]');
  if (!metric) return;

  const target = filteredMatchRecords().length;
  const previousFrame = dashboardCountFrames.get(metric);
  if (previousFrame) cancelAnimationFrame(previousFrame);
  const currentValue = Number(String(metric.textContent || '').replace(/,/g, '').trim());
  const start = Number.isFinite(currentValue) ? currentValue : 0;
  metric.dataset.countTarget = String(target);
  metric.textContent = String(Math.round(start));

  if (start === target) {
    metric.textContent = String(target);
    dashboardCountFrames.delete(metric);
    return;
  }

  let startedAt = 0;
  const tick = timestamp => {
    if (!metric.isConnected) {
      dashboardCountFrames.delete(metric);
      return;
    }
    if (!startedAt) startedAt = timestamp;
    const progress = Math.min(1, (timestamp - startedAt) / 760);
    const eased = 1 - Math.pow(1 - progress, 3);
    metric.textContent = String(Math.round(start + (target - start) * eased));
    if (progress < 1) {
      dashboardCountFrames.set(metric, requestAnimationFrame(tick));
    } else {
      metric.textContent = String(target);
      dashboardCountFrames.delete(metric);
    }
  };
  dashboardCountFrames.set(metric, requestAnimationFrame(tick));
}
function renderMatches() {
  const matches = filteredMatchRecords();
  const matchType = state.filters.matchType || 'all';
  const playersInMatches = new Set(state.data.matches.flatMap(match => [...match.teamANames, ...match.teamBNames].map(normalizeName))).size;
  const sessionsById = new Map(state.data.sessions.map(session => [String(session.id), session]));
  const duprMatchesCount = state.data.matches.filter(match => matchIsDupr(match, sessionsById.get(String(match.sessionId || '')))).length;
  const nonDuprMatchesCount = state.data.matches.length - duprMatchesCount;
  return `<div class="page-stack">${pageHeading('HUSAY DINKERS / MATCH HISTORY', 'Match Records', 'Results recorded from Court Queueing, including scored and win/loss matches.', `<button class="btn" data-action="export-dupr">${icon('download')} Export DUPR CSV</button><a class="btn btn-primary" href="/queueing" target="_blank" rel="noopener">${icon('plus')} Record in Queue</a>`)}
    <div class="metric-grid"><div class="metric-tile"><span>Match records</span>${metricCount('matches', 'recorded-matches', matches.length)}</div><div class="metric-tile"><span>Players involved</span>${metricCount('matches', 'players-involved', playersInMatches)}</div><div class="metric-tile"><span>DUPR matches</span>${metricCount('matches', 'dupr-matches', duprMatchesCount)}</div><div class="metric-tile"><span>Non DUPR matches</span>${metricCount('matches', 'non-dupr-matches', nonDuprMatchesCount)}</div></div>
    <section class="panel panel-pad"><div class="panel-heading">${panelTitle('All Match Records', 'trophy')}<div class="toolbar">${rankingSessionFilterMarkup(currentRankingSessionId())}<div class="match-type-filter" data-active="${escapeHTML(matchType)}" role="group" aria-label="Filter match records by type"><button class="match-type-option" type="button" data-match-type-filter="all" aria-pressed="${matchType === 'all'}">ALL</button><button class="match-type-option" type="button" data-match-type-filter="dupr" aria-pressed="${matchType === 'dupr'}">DUPR</button><button class="match-type-option" type="button" data-match-type-filter="non-dupr" aria-pressed="${matchType === 'non-dupr'}">NON-DUPR</button></div></div></div><div id="matchRecordsTableWrap">${matchesTable(matches)}</div></section>
    <p class="page-note">Match creation and player lineups remain in the original Queueing page, which updates this history automatically.</p></div>`;
}
function rankingRowMarkup(player, index) {
  const stats = player.rankingStats || playerStats(player);
  const rate = stats.matches ? `${Math.round(stats.wins / stats.matches * 100)}%` : '—';
  const rank = ['🥇', '🥈', '🥉'][index] || `#${index + 1}`;
  const rankLabel = `Rank ${index + 1}`;
  const playerName = player.name || 'Unnamed Player';
  const fullDisplayName = `${playerName}${player.nickname ? ` (${player.nickname})` : ''}`;
  const category = categoryName(player.category);
  const categoryClass = `category-${categoryCode(player.category).toLowerCase()}`;
  return `<tr><td class="ranking-rank-cell"><span class="ranking-rank-mark" aria-label="${rankLabel}">${rank}</span></td><td class="primary-cell ranking-player-cell"><span class="ranking-player-name">${escapeHTML(fullDisplayName)}</span></td><td><span class="player-category-badge ${escapeHTML(categoryClass)}">${escapeHTML(category.toUpperCase())}</span></td><td class="ranking-stat-cell"><strong>${stats.wins}</strong></td><td class="ranking-stat-cell">${stats.losses}</td><td class="ranking-stat-cell">${stats.matches}</td><td class="ranking-stat-cell">${rate}</td><td class="ranking-dupr-cell"><strong>${escapeHTML(player.duprId || '-')}</strong></td></tr>`;
}
function appendRankingRowsInChunks(token, cursor = 0) {
  const batchSize = 60;
  const liveTbody = $('#rankingTableBody');
  const players = state.rankingRenderPlayers;
  if (!liveTbody?.isConnected) return;

  // Build the replacement body off-screen and swap it in once complete. This
  // keeps the visible table height stable while larger leaderboards are built.
  const stagedTbody = document.createElement('tbody');
  stagedTbody.id = 'rankingTableBody';
  const appendNext = () => {
    const currentTbody = $('#rankingTableBody');
    if (state.page !== 'rankings' || token !== state.rankingRenderToken || !currentTbody?.isConnected) return;

    const end = Math.min(cursor + batchSize, players.length);
    if (cursor < end) {
      const holder = document.createElement('tbody');
      holder.innerHTML = players.slice(cursor, end).map((player, offset) => rankingRowMarkup(player, cursor + offset)).join('');
      stagedTbody.append(...holder.childNodes);
      cursor = end;
    }

    if (cursor < players.length) {
      window.requestAnimationFrame(appendNext);
      return;
    }

    if (!players.length) {
      stagedTbody.innerHTML = '<tr><td colspan="8" class="ranking-empty">No ranking data yet. Rankings will appear when players have saved match results.</td></tr>';
    }
    currentTbody.replaceWith(stagedTbody);
    $('#rankingsTableWrap')?.setAttribute('aria-busy', 'false');
  };
  appendNext();
}
function scheduleDashboardRankings() {
  const token = ++state.dashboardRankingToken;
  scheduleIdleTask(() => {
    const target = $('#dashboardTopRankings');
    if (state.page !== 'dashboard' || token !== state.dashboardRankingToken || !target?.isConnected) return;
    const top = topRankedPlayers(20);
    target.classList.remove('is-entering');
    target.innerHTML = top.length ? top.map((player, index) => {
      const stats = playerStats(player);
      const podiumClass = ['podium-rank-gold', 'podium-rank-silver', 'podium-rank-bronze'][index] || '';
      const avatarClass = podiumClass ? `player-avatar ${podiumClass}` : 'player-avatar';
      const rankLabel = ['🥇', '🥈', '🥉'][index] || String(index + 1);
      return `<div class="ranking-row" style="--ranking-order:${index}"><span class="rank-index ${index < 3 ? 'top' : ''}" aria-label="Rank ${index + 1}">${rankLabel}</span><span class="${avatarClass}"><span class="podium-avatar-initials">${initials(player.name)}</span></span><span class="ranking-name">${escapeHTML(player.name)}</span><span class="ranking-rating">${stats.wins}W - ${stats.losses}L (${stats.matches} <span class="ranking-match-label-long">Matches</span><span class="ranking-match-label-short">Match</span>)</span></div>`;
    }).join('') : emptyState('No player records yet', 'Players registered through the existing queueing system will appear here.');
    if (top.length) requestAnimationFrame(() => {
      if (target.isConnected) target.classList.add('is-entering');
    });
  });
}
function currentRankingSessionId() {
  const selected = String(state.filters.rankingSession || 'all');
  if (selected !== 'all' && !(state.data?.sessions || []).some(session => String(session.id) === selected)) {
    state.filters.rankingSession = 'all';
    return 'all';
  }
  return selected;
}
function rankingSessionType(session) {
  const raw = session?.raw || {};
  const names = [raw.sessionName, raw.name, session?.sessionName, session?.title].map(value => String(value || '').trim()).filter(Boolean);
  const markedName = names.find(value => /^\((?:NON[\s-]+)?DUPR\s+MATCH\)/i.test(value));
  if (markedName) return /^\(NON[\s-]+DUPR\s+MATCH\)/i.test(markedName) ? 'NON-DUPR' : 'DUPR';
  const sessionMatches = (state.data?.matches || []).filter(match => String(match.sessionId) === String(session.id));
  if (sessionMatches.length) {
    const hasDupr = sessionMatches.some(match => matchIsDupr(match, session));
    const hasNonDupr = sessionMatches.some(match => !matchIsDupr(match, session));
    if (hasDupr && hasNonDupr) return 'MIXED';
    return hasDupr ? 'DUPR' : 'NON-DUPR';
  }
  if (typeof raw.duprMatch === 'boolean') return raw.duprMatch ? 'DUPR' : 'NON-DUPR';
  return 'NON-DUPR';
}
function rankingSessionTitle(session) {
  return String(session?.title || session?.sessionName || 'Open Play Session')
    .replace(/^\((?:NON[\s-]+)?DUPR\s+MATCH\)\s*/i, '').trim() || 'Open Play Session';
}
function rankingSessionFilterMarkup(selectedSessionId = currentRankingSessionId()) {
  const sessionOptions = sortedSessions().map(session => {
    const sessionType = rankingSessionType(session);
    const optionLabel = `(${sessionType}) ${rankingSessionTitle(session)} — ${sessionDateLabel(session)} · ${sessionStatus(session)}`;
    return `<option value="${escapeHTML(session.id)}" ${selectedSessionId === String(session.id) ? 'selected' : ''}>${escapeHTML(optionLabel)}</option>`;
  }).join('');
  return `<select class="select-control ranking-session-filter" id="rankingSessionFilter"><option value="all" ${selectedSessionId === 'all' ? 'selected' : ''}>All Sessions</option>${sessionOptions}</select>`;
}
function getRankingPlayersForCurrentView() {
  const selectedSessionId = currentRankingSessionId();
  let players;
  if (selectedSessionId === 'all') {
    players = getRankedPlayers().filter(player => !player.historicalOnly);
  } else {
    const session = (state.data?.sessions || []).find(item => String(item.id) === selectedSessionId);
    players = session ? buildSessionRanking(session).map(entry => {
      const profile = state.data.players.find(player => normalizeName(player.name) === normalizeName(entry.name)) || {};
      return {
        ...profile,
        name: entry.name,
        nickname: entry.nickname || profile.nickname || '',
        category: entry.category || profile.category || 'Unspecified',
        duprId: profile.duprId || '',
        rankingStats: {
          wins: entry.wins,
          losses: entry.losses,
          matches: entry.matches,
          attendance: (session.attendees || []).some(person => normalizeName(person.name) === normalizeName(entry.name)) ? 1 : 0
        }
      };
    }) : [];
  }
  return visibleRows(players.filter(player => state.filters.rankingCategory === 'all' || player.category === state.filters.rankingCategory));
}
function scheduleRankingsPage() {
  const token = ++state.rankingRenderToken;
  $('#rankingsTableWrap')?.setAttribute('aria-busy', 'true');
  scheduleIdleTask(() => {
    if (state.page !== 'rankings' || token !== state.rankingRenderToken) return;
    const players = getRankingPlayersForCurrentView();
    state.rankingRenderPlayers = players;
    const count = $('#rankingPlayerCount');
    if (count) {
      const previousCountValues = captureDashboardCountValues();
      count.dataset.countTarget = String(players.length);
      animateDashboardCountValues(previousCountValues);
    }
    if (!$('#rankingTableBody')?.isConnected) return;
    appendRankingRowsInChunks(token);
  });
}
function renderRankings() {
  state.rankingRenderPlayers = [];
  const selectedSessionId = currentRankingSessionId();
  return `<div class="page-stack">${pageHeading('HUSAY DINKERS / LEADERBOARD', 'Player Rankings', 'Rank players using their wins, losses, total matches and win rate from the existing system.', `<button class="btn" data-action="export-rankings">${icon('download')} Export</button>`)}
    <div class="metric-grid"><div class="metric-tile"><span>Players ranked</span>${metricCount('rankings', 'players-ranked', state.data.players.filter(player => !player.historicalOnly).length, 'rankingPlayerCount')}</div><div class="metric-tile"><span>Matches recorded</span>${metricCount('rankings', 'matches-recorded', state.data.matches.length)}</div><div class="metric-tile"><span>Attendance entries</span>${metricCount('rankings', 'attendance-entries', countAttendanceEntries())}</div><div class="metric-tile"><span>DUPR IDs recorded</span>${metricCount('rankings', 'dupr-ids-recorded', state.data.players.filter(player => player.duprId).length)}</div></div>
    <section class="panel panel-pad"><div class="panel-heading">${panelTitle('Community Leaderboard', 'trophy')}<div class="toolbar">${rankingSessionFilterMarkup(selectedSessionId)}<select class="select-control" id="rankingCategoryFilter"><option value="all">All categories</option>${['Beginner','Novice','Intermediate','Advanced','Expert'].map(cat => `<option value="${cat}" ${state.filters.rankingCategory === cat ? 'selected' : ''}>${cat}</option>`).join('')}</select></div></div><div class="table-wrap rankings-table-wrap" id="rankingsTableWrap" aria-busy="true"><table class="data-table rankings-table"><colgroup><col style="width:8%"><col style="width:25%"><col style="width:15%"><col style="width:8%"><col style="width:8%"><col style="width:9%"><col style="width:11%"><col style="width:16%"></colgroup><thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Category</th><th scope="col">Wins</th><th scope="col">Losses</th><th scope="col">Matches</th><th scope="col">Win rate</th><th scope="col">DUPR ID</th></tr></thead><tbody id="rankingTableBody"><tr><td colspan="8" class="ranking-loading-row">Preparing player rankings…</td></tr></tbody></table></div></section>
    <p class="page-note">DUPR ID is shown as an identifier only. This dashboard does not treat a DUPR ID as a numeric DUPR rating.</p></div>`;
}
function renderCourts() {
  const session = getLiveSession();
  const courts = state.data.courts;
  const registeredCourts = asArray(state.data.registeredCourts);
  const registeredCourtCards = registeredCourts.length ? `<div class="registered-court-grid">${registeredCourts.map(court => `<article class="registered-court-card"><button type="button" class="registered-court-logo" data-map-focus-court-id="${escapeHTML(court.id)}" aria-label="Focus map on ${escapeHTML(court.name)}" title="Show ${escapeHTML(court.name)} on map">${court.logo ? `<img src="${escapeHTML(court.logo)}" alt="">` : icon('court')}</button><span class="registered-court-copy"><strong>${escapeHTML(court.name)}</strong><small>${escapeHTML(court.location)}</small><span class="registered-court-actions"><button type="button" class="registered-court-edit" data-action="edit-registered-court" data-court-id="${escapeHTML(court.id)}">${icon('edit')} Edit</button><button type="button" class="registered-court-delete" data-action="delete-registered-court" data-court-id="${escapeHTML(court.id)}">${icon('trash')} Delete</button></span></span></article>`).join('')}</div>` : emptyState('No registered courts yet', 'Register a court to add its logo and location to the CourtMap.');
  const courtPageActions = `<div class="court-page-actions"><button type="button" class="btn btn-sm btn-primary court-action-pill" data-action="register-court">${icon('plus')} Register Court</button><a class="btn btn-primary court-action-pill" href="/queueing" target="_blank" rel="noopener">Manage in Queueing ${icon('external')}</a></div>`;
  return `<div class="page-stack">${pageHeading('HUSAY DINKERS / VENUES', 'Courts & Locations', 'Current court activity is read directly from the live queueing session.', courtPageActions)}
    <div class="metric-grid"><div class="metric-tile"><span>Total courts</span>${metricCount('courts', 'total-courts', registeredCourts.length)}</div><div class="metric-tile"><span>In play</span>${metricCount('courts', 'in-play', courts.filter(court => court.status === 'Active').length)}</div><div class="metric-tile"><span>Ready / assigned</span>${metricCount('courts', 'ready-assigned', courts.filter(court => court.status === 'Ready').length)}</div><div class="metric-tile"><span>Waiting courts</span>${metricCount('courts', 'waiting-courts', courts.filter(court => court.status === 'Waiting').length)}</div></div>
    <div class="registered-courts-map-layout">
      ${mapCard(session, 'venuesCourtMap')}
      <section class="panel panel-pad registered-courts-panel">${panelTitle('Registered Court List', 'court')}${registeredCourtCards}</section>
    </div>
    <p class="page-note">Registered courts are saved to this organizer workspace and their locations are added to CourtMap automatically.</p></div>`;
}
function renderSchedule() {
  const sessions = visibleRows(sortedSessions());
  return `<div class="page-stack">${pageHeading('HUSAY DINKERS / SESSION HISTORY', 'Open Play Schedule', 'A date-ordered view of sessions already created in your queueing system.', `<a class="btn btn-primary" href="/session" target="_blank" rel="noopener">${icon('plus')} Start Open Play</a>`)}<section class="panel panel-pad">${panelTitle('Session Timeline', 'calendar')}<div class="session-list">${sessions.length ? sessions.map(sessionCard).join('') : emptyState('No session history', 'Start your first session from Session Setup.')}</div></section></div>`;
}
function downloadCSV(filename, headers, rows) {
  const csv = [headers, ...rows].map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}
function parsePlayerImportCsv(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ',') {
      row.push(field); field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      if (row.some(value => String(value).trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some(value => String(value).trim() !== '')) rows.push(row);
  }
  if (rows.length < 2) throw new Error('The CSV does not contain any player rows.');

  const normalizeHeader = value => String(value || '').trim().toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
  const headers = rows.shift().map(normalizeHeader);
  const findColumn = aliases => headers.findIndex(header => aliases.includes(header));
  const columns = {
    name: findColumn(['name', 'fullname', 'playername', 'playerfullname', 'playersfullname', 'fullplayername']),
    nickname: findColumn(['nickname', 'nick']),
    category: findColumn(['category', 'skillcategory', 'level']),
    gender: findColumn(['gender', 'sex']),
    duprId: findColumn(['duprid', 'dupridentifier', 'duprplayerid']),
    selfRating: findColumn(['selfrating', 'selfrate']),
    matches: findColumn(['matches', 'matchrecords']),
    wins: findColumn(['wins', 'win']),
    losses: findColumn(['losses', 'loss']),
    avatarId: findColumn(['avatarid'])
  };
  if (columns.name < 0) throw new Error('A Full Name or Name column is required in the CSV.');

  const valueAt = (values, column) => column < 0 ? '' : String(values[column] ?? '').trim();
  return rows.map((values, index) => {
    const name = valueAt(values, columns.name).normalize('NFC').replace(/\s+/g, ' ').trim();
    const categoryValue = valueAt(values, columns.category);
    const player = {
      name,
      nickname: valueAt(values, columns.nickname),
      category: categoryValue ? categoryName(categoryValue) : 'Unspecified',
      gender: valueAt(values, columns.gender),
      duprId: valueAt(values, columns.duprId),
      selfRating: valueAt(values, columns.selfRating),
      matches: valueAt(values, columns.matches),
      wins: valueAt(values, columns.wins),
      losses: valueAt(values, columns.losses),
      avatarId: valueAt(values, columns.avatarId)
    };
    return { rowNumber: index + 2, player };
  });
}

function analyzePlayerImportRows(rows) {
  const existingPlayers = asArray(state.data?.players).filter(player => !player.historicalOnly);
  const existingNames = new Map();
  const existingDuprIds = new Map();
  existingPlayers.forEach(player => {
    const nameKey = normalizeName(player.name);
    const duprKey = normalizeDuprId(player.duprId || player.duprID || player.dupr_id);
    if (nameKey && !existingNames.has(nameKey)) existingNames.set(nameKey, player);
    if (duprKey && !existingDuprIds.has(duprKey)) existingDuprIds.set(duprKey, player);
  });

  const seenNames = new Map();
  const seenDuprIds = new Map();
  return rows.map(row => {
    const nameKey = normalizeName(row.player.name);
    const duprKey = normalizeDuprId(row.player.duprId);
    if (!nameKey) return { ...row, status: 'invalid', reasons: [], duplicateOf: 'Full name is required.' };

    const nameMatch = existingNames.get(nameKey);
    const duprMatch = duprKey ? existingDuprIds.get(duprKey) : null;
    const fileNameMatch = seenNames.get(nameKey);
    const fileDuprMatch = duprKey ? seenDuprIds.get(duprKey) : null;
    const reasons = [];
    if (nameMatch || fileNameMatch) reasons.push('Full name');
    if (duprMatch || fileDuprMatch) reasons.push('DUPR ID');

    const duplicateTargets = [];
    if (nameMatch) duplicateTargets.push(`List: ${nameMatch.name}`);
    if (duprMatch && duprMatch !== nameMatch) duplicateTargets.push(`List: ${duprMatch.name}`);
    if (fileNameMatch) duplicateTargets.push(`CSV row ${fileNameMatch.rowNumber}: ${fileNameMatch.player.name}`);
    if (fileDuprMatch && fileDuprMatch !== fileNameMatch) duplicateTargets.push(`CSV row ${fileDuprMatch.rowNumber}: ${fileDuprMatch.player.name}`);

    if (nameKey && !seenNames.has(nameKey)) seenNames.set(nameKey, row);
    if (duprKey && !seenDuprIds.has(duprKey)) seenDuprIds.set(duprKey, row);

    return {
      ...row,
      status: reasons.length ? 'duplicate' : 'ready',
      reasons,
      duplicateOf: [...new Set(duplicateTargets)].join(' · ')
    };
  });
}

function playerImportCounts(rows = asArray(pendingPlayerImport?.rows)) {
  return {
    all: rows.length,
    ready: rows.filter(row => row.status === 'ready').length,
    duplicate: rows.filter(row => row.status === 'duplicate').length,
    invalid: rows.filter(row => row.status === 'invalid').length
  };
}

function applyPlayerImportPreviewFilters() {
  const root = $('#modalRoot');
  if (!root || !pendingPlayerImport) return;
  const search = normalizeName($('#playerImportSearch', root)?.value || '');
  const selectedFilter = pendingPlayerImport.filter || 'all';
  const rows = $$('.player-import-table tbody tr[data-player-import-row]', root);
  let visibleCount = 0;

  rows.forEach(row => {
    const matchesFilter = selectedFilter === 'all' || row.dataset.status === selectedFilter;
    const matchesSearch = !search || String(row.dataset.search || '').includes(search);
    const visible = matchesFilter && matchesSearch;
    row.hidden = !visible;
    if (visible) visibleCount += 1;
  });

  const countLabel = $('.player-import-visible-count', root);
  if (countLabel) countLabel.textContent = `Showing ${visibleCount} of ${asArray(pendingPlayerImport.rows).length} players`;
  const emptyRow = $('.player-import-empty-row', root);
  if (emptyRow) emptyRow.hidden = visibleCount !== 0;

  $$('.player-import-tab', root).forEach(button => {
    const active = button.dataset.playerImportFilter === selectedFilter;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function playerImportReviewMarkup() {
  const rows = asArray(pendingPlayerImport?.rows);
  const counts = playerImportCounts(rows);
  const filter = pendingPlayerImport?.filter || 'all';
  const tableRows = rows.map((row, index) => {
    const statusClass = row.status === 'ready' ? 'ready' : row.status === 'duplicate' ? 'duplicate' : 'invalid';
    const statusLabel = row.status === 'ready'
      ? 'Ready to import'
      : row.status === 'duplicate'
        ? `Duplicate · ${row.reasons.join(' + ')}`
        : 'Missing full name';
    const category = categoryName(row.player.category);
    const categoryClass = `category-${categoryCode(category).toLowerCase()}`;
    const gender = String(row.player.gender || '').trim();
    const genderClass = gender.toLowerCase() === 'male' ? 'gender-male' : gender.toLowerCase() === 'female' ? 'gender-female' : '';
    const stats = playerStats(row.player);
    const fullName = `${row.player.name || 'Unnamed player'}${row.player.nickname ? ` (${row.player.nickname})` : ''}`;
    const searchText = normalizeName([
      row.player.name, row.player.nickname, category, gender, row.player.duprId,
      statusLabel, row.duplicateOf, row.reasons.join(' ')
    ].join(' '));
    const duplicateDetail = row.status === 'duplicate'
      ? `<small class="player-import-row-detail" title="${escapeHTML(row.duplicateOf || '')}">Matched by ${escapeHTML(row.reasons.join(' and '))}${row.duplicateOf ? ` · ${escapeHTML(row.duplicateOf)}` : ''}</small>`
      : row.status === 'invalid'
        ? '<small class="player-import-row-detail">A full name is required before importing.</small>'
        : '';
    return `<tr class="player-import-row-${statusClass}" data-player-import-row="true" data-status="${statusClass}" data-search="${escapeHTML(searchText)}">
      <td class="player-number player-import-row-number">${index + 1}</td>
      <td class="player-import-person-cell"><strong>${escapeHTML(fullName)}</strong><span class="player-import-status ${statusClass}">${escapeHTML(statusLabel)}</span>${duplicateDetail}</td>
      <td><span class="player-category-badge ${escapeHTML(categoryClass)}">${escapeHTML(category.toUpperCase())}</span></td>
      <td>${genderClass ? `<span class="player-gender-badge ${genderClass}">${escapeHTML(gender)}</span>` : escapeHTML(gender || '—')}</td>
      <td><strong class="player-import-dupr-id">${escapeHTML(row.player.duprId || '—')}</strong></td>
      <td class="player-count-cell player-import-count">${stats.attendance}</td>
      <td class="player-count-cell player-import-count">${stats.matches}</td>
    </tr>`;
  }).join('');

  const filterTabs = [
    ['all', `All (${counts.all})`],
    ['ready', `Ready (${counts.ready})`],
    ['duplicate', `Duplicates (${counts.duplicate})`],
    ['invalid', `Invalid (${counts.invalid})`]
  ].map(([key, label]) => `<button type="button" class="player-import-tab ${filter === key ? 'is-active' : ''}" data-player-import-filter="${key}" aria-pressed="${filter === key}">${label}</button>`).join('');

  return `<div class="player-import-layout">
    <div class="player-import-filterbar"><div class="player-import-tabs" role="group" aria-label="Filter CSV player rows">${filterTabs}</div></div>
    <div class="player-import-searchbar">
      <label class="player-import-search" for="playerImportSearch">${icon('search')}<input id="playerImportSearch" type="search" autocomplete="off" placeholder="Search name, nickname, category, DUPR ID…" value="${escapeHTML(pendingPlayerImport?.query || '')}"></label>
      <div class="player-import-meta"><strong>${counts.all} CSV players</strong><span class="player-import-visible-count">Showing ${counts.all} of ${counts.all} players</span><small>${escapeHTML(pendingPlayerImport?.filename || 'Selected CSV file')}</small></div>
    </div>
    ${counts.duplicate || counts.invalid ? `<div class="player-import-alert"><span class="player-import-alert-icon">${icon('info')}</span><div><strong>${counts.duplicate} duplicate${counts.duplicate === 1 ? '' : 's'}${counts.invalid ? ` · ${counts.invalid} invalid` : ''} will be skipped</strong><span>Duplicates are detected by full name or DUPR ID. Only rows marked Ready can be imported.</span></div></div>` : `<div class="player-import-success-note">${icon('check')} All ${counts.ready} player rows are ready to import. Duplicate checking will run once more before saving.</div>`}
    <div class="player-import-table-wrap"><table class="data-table players-table player-import-table"><colgroup><col style="width:5%"><col style="width:31%"><col style="width:13%"><col style="width:11%"><col style="width:14%"><col style="width:12%"><col style="width:14%"></colgroup><thead><tr><th scope="col">#</th><th scope="col">Player's Fullname (Nickname)</th><th scope="col">Category</th><th scope="col">Gender</th><th scope="col">DUPR ID</th><th scope="col">Attendance</th><th scope="col">Match Records</th></tr></thead><tbody>${tableRows}<tr class="player-import-empty-row" hidden><td colspan="7">No player rows match your search or selected filter.</td></tr></tbody></table></div>
    <div class="player-import-footer"><span>Only <strong>${counts.ready} Ready</strong> player${counts.ready === 1 ? '' : 's'} will be saved. Duplicate and invalid rows are excluded.</span><div><button type="button" class="btn" data-action="close-modal">Close</button><button type="button" class="btn" data-action="import-players">${icon('upload')} Upload CSV</button><button type="button" class="btn btn-primary" data-action="confirm-player-import" ${counts.ready ? '' : 'disabled'}>${icon('download')} Import ${counts.ready} Player${counts.ready === 1 ? '' : 's'}</button></div></div>
  </div>`;
}
function openPlayerImportReview(filename, rows) {
  pendingPlayerImport = { filename, rows: analyzePlayerImportRows(rows), filter: 'all', query: '' };
  modal('Registered Player Cloud', playerImportReviewMarkup(), { wide: true, className: 'player-import-modal', subtitle: 'Review the selected CSV before adding players to your shared directory.' });
}

async function handlePlayerCsvFile(file) {
  if (!file) return;
  if (!/\.csv$/i.test(file.name) && file.type && !/csv|comma-separated/i.test(file.type)) {
    toast('Please choose a CSV file.', 'error');
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    toast('The CSV file is too large. Choose a file smaller than 8 MB.', 'error');
    return;
  }
  try {
    const rows = parsePlayerImportCsv(await file.text());
    if (rows.length > 5000) throw new Error('A maximum of 5,000 player rows can be imported at one time.');
    openPlayerImportReview(file.name, rows);
  } catch (error) {
    toast(error.message || 'Unable to read this CSV file.', 'error');
  }
}

async function confirmPlayerImport(button) {
  const readyRows = asArray(pendingPlayerImport?.rows).filter(row => row.status === 'ready');
  if (!readyRows.length) return;
  button.disabled = true;
  button.innerHTML = 'Importing…';
  try {
    const response = await api('/api/organizer-dashboard/players/import', {
      method: 'POST',
      body: JSON.stringify({ players: readyRows.map(row => row.player) })
    });
    await refreshData({ silent: true });
    closeModal();
    pendingPlayerImport = null;
    const imported = Number(response.importedCount) || 0;
    const serverDuplicates = Number(response.duplicateCount) || 0;
    const skipped = Number(response.invalidCount) || 0;
    const summary = [`Imported ${imported} player${imported === 1 ? '' : 's'}`];
    if (serverDuplicates) summary.push(`${serverDuplicates} duplicate${serverDuplicates === 1 ? '' : 's'} skipped`);
    if (skipped) summary.push(`${skipped} invalid row${skipped === 1 ? '' : 's'} skipped`);
    toast(summary.join(' · '));
  } catch (error) {
    toast(error.message || 'Unable to import players.', 'error');
    if (button.isConnected) {
      button.disabled = false;
      button.innerHTML = `${icon('download')} Import ${readyRows.length} Player${readyRows.length === 1 ? '' : 's'}`;
    }
  }
}

function exportPlayers() {
  downloadCSV('husay-dinkers-players.csv', ['Name', 'Nickname', 'Category', 'Gender', 'DUPR ID', 'Self Rating', 'Matches', 'Wins', 'Losses', 'Attendance'], state.data.players.filter(p => !p.historicalOnly).map(player => { const s = playerStats(player); return [player.name, player.nickname, player.category, player.gender, player.duprId, player.selfRating, s.matches, s.wins, s.losses, s.attendance]; }));
}
const DUPR_EXPORT_COLUMNS = ['matchType','event','date','playerA1','playerA1DuprId','playerA1ExternalId','playerA2','playerA2DuprId','playerA2ExternalId','playerB1','playerB1DuprId','playerB1ExternalId','playerB2','playerB2DuprId','playerB2ExternalId','teamAGame1','teamBGame1','teamAGame2','teamBGame2','teamAGame3','teamBGame3','teamAGame4','teamBGame4','teamAGame5','teamBGame5','scoreType','location'];
function matchIsDupr(match, session) {
  const log = match.raw || {};
  const sessionRaw = session?.raw || {};
  const matchName = String(log.sessionName || '').trim();
  if (/^\(NON\s+DUPR\s+MATCH\)/i.test(matchName)) return false;
  if (/^\(DUPR\s+MATCH\)/i.test(matchName)) return true;
  if (typeof log.duprMatch === 'boolean') return log.duprMatch;
  const sessionName = String(sessionRaw.sessionName || sessionRaw.name || '').trim();
  if (/^\(NON\s+DUPR\s+MATCH\)/i.test(sessionName)) return false;
  if (/^\(DUPR\s+MATCH\)/i.test(sessionName)) return true;
  return sessionRaw.duprMatch === true;
}
function matchDuprPlayer(match, side, index) {
  const log = match.raw || {};
  const snapshots = asArray(log[`${side}Players`]);
  const ids = asArray(log[`${side}Ids`]);
  const names = side === 'team1' ? match.teamANames : match.teamBNames;
  const snapshot = snapshots[index] || {};
  const name = String(snapshot.name || names[index] || '').trim();
  const id = snapshot.id ?? snapshot.playerId ?? ids[index] ?? '';
  const cloudId = String(snapshot.cloudId || snapshot.registeredCloudId || '');
  const registered = state.data.players.find(player =>
    (cloudId && player.cloudId === cloudId) ||
    (id !== '' && (player.id === String(id) || player.cloudId === String(id))) ||
    normalizeName(player.name) === normalizeName(name)
  );
  const duprId = String(registered?.duprId || snapshot.duprId || snapshot.duprID || snapshot.dupr_id || snapshot.dupr || '').trim().toUpperCase();
  return { name, duprId };
}
function duprRowForMatch(match) {
  const session = state.data.sessions.find(item => item.id === match.sessionId);
  if (!session || !matchIsDupr(match, session)) return { row: null, reason: 'nonDupr' };
  const log = match.raw || {};
  const score = String(log.score || '').trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (String(log.recordingMode || '').toLowerCase() === 'win-only' || !score || Number(score[1]) === Number(score[2])) return { row: null, reason: 'unscored' };
  const type = String(log.type || match.type || 'Doubles').toLowerCase();
  const singles = type.includes('single');
  if (!singles && !type.includes('double')) return { row: null, reason: 'incomplete' };
  const teamA = match.teamANames.map((_, index) => matchDuprPlayer(match, 'team1', index));
  const teamB = match.teamBNames.map((_, index) => matchDuprPlayer(match, 'team2', index));
  const expected = singles ? 1 : 2;
  if (teamA.length !== expected || teamB.length !== expected || [...teamA, ...teamB].some(player => !player.name || !player.duprId)) return { row: null, reason: 'incomplete' };
  const sessionRaw = session.raw || {};
  const event = String(log.sessionName || sessionRaw.sessionName || session.title || 'Open Play').replace(/^\((?:NON\s+)?DUPR\s+MATCH\)\s*/i, '').trim() || 'Open Play';
  const playedAt = new Date(log.endedAt || log.startedAt || sessionRaw.endedAt || sessionRaw.startedAt || match.playedAt || '');
  const date = Number.isNaN(playedAt.getTime()) ? '' : `${playedAt.getFullYear()}-${String(playedAt.getMonth() + 1).padStart(2, '0')}-${String(playedAt.getDate()).padStart(2, '0')}`;
  const row = {
    matchType: singles ? 'S' : 'D', event, date,
    playerA1: teamA[0]?.name || '', playerA1DuprId: teamA[0]?.duprId || '', playerA1ExternalId: '',
    playerA2: teamA[1]?.name || '', playerA2DuprId: teamA[1]?.duprId || '', playerA2ExternalId: '',
    playerB1: teamB[0]?.name || '', playerB1DuprId: teamB[0]?.duprId || '', playerB1ExternalId: '',
    playerB2: teamB[1]?.name || '', playerB2DuprId: teamB[1]?.duprId || '', playerB2ExternalId: '',
    teamAGame1: Number(score[1]), teamBGame1: Number(score[2]),
    teamAGame2: '', teamBGame2: '', teamAGame3: '', teamBGame3: '', teamAGame4: '', teamBGame4: '', teamAGame5: '', teamBGame5: '',
    scoreType: String(log.scoreType || (Number(log.target) === 21 ? 'Rally' : 'Sideout')),
    location: String(sessionRaw.duprLocation || sessionRaw.location || session.location || sessionRaw.venue || '').trim()
  };
  return { row, reason: '' };
}
function exportDuprMatches() {
  const results = state.data.matches.map(match => duprRowForMatch(match));
  const rows = results.filter(result => result.row).map(result => result.row);
  const excluded = results.reduce((counts, result) => { if (result.reason) counts[result.reason] += 1; return counts; }, { nonDupr: 0, unscored: 0, incomplete: 0 });
  if (!rows.length) {
    toast('No matches currently meet DUPR export requirements. Check DUPR match flags, scores, match type, and all player DUPR IDs.', 'error');
    return;
  }
  downloadCSV('husay-dinkers-dupr-matches.csv', DUPR_EXPORT_COLUMNS, rows.map(row => DUPR_EXPORT_COLUMNS.map(column => row[column])));
  const warningCount = excluded.nonDupr + excluded.unscored + excluded.incomplete;
  toast(`Downloaded ${rows.length} DUPR match${rows.length === 1 ? '' : 'es'}${warningCount ? `; ${warningCount} other record(s) were excluded` : ''}.`);
}
function exportRankings() {
  const players = getRankingPlayersForCurrentView();
  downloadCSV('husay-dinkers-rankings.csv', ['Rank', 'Player', 'Category', 'Wins', 'Losses', 'Matches', 'Attendance', 'DUPR ID'], players.map((player, index) => { const s = player.rankingStats || playerStats(player); return [index + 1, player.name, player.category, s.wins, s.losses, s.matches, s.attendance, player.duprId]; }));
}
function exportReport() {
  downloadCSV('husay-dinkers-session-attendance.csv', ['Session', 'Status', 'Date', 'Location', 'Player', 'Nickname', 'Gender', 'Category'], state.data.sessions.flatMap(session => session.attendees.map(person => [session.title, sessionStatus(session), session.date, session.location, person.name, person.nickname, person.gender, person.category])));
}
function exportBackup() {
  const safeBackup = {
    exportedAt: new Date().toISOString(),
    source: 'Existing Pickle Point Match organizer data',
    organizer: { id: state.organizer?.id, slug: state.organizer?.slug, displayName: state.organizer?.displayName },
    records: state.raw?.records || {},
    appState: state.raw?.appState || null
  };
  const blob = new Blob([JSON.stringify(safeBackup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = 'husay-dinkers-queueing-backup.json'; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}
function renderReports() {
  const attendance = allAttendance();
  const byPlayer = new Map();
  attendance.forEach(row => byPlayer.set(normalizeName(row.name), (byPlayer.get(normalizeName(row.name)) || { name: row.name, count: 0 }).count + 1));
  const topAttendance = [...byPlayer.values()].sort((a, b) => b.count - a.count).slice(0, 8);
  return `<div class="page-stack">${pageHeading('HUSAY DINKERS / ANALYTICS', 'Reports', 'Attendance and match activity calculated from your existing queueing records.', `<button class="btn" data-action="export-backup">${icon('download')} Full Backup</button><button class="btn btn-primary" data-action="export-report">${icon('download')} Export Attendance</button>`)}
    <div class="metric-grid"><div class="metric-tile"><span>Players registered</span>${metricCount('reports', 'players-registered', state.data.players.filter(p => !p.historicalOnly).length)}</div><div class="metric-tile"><span>Sessions saved</span>${metricCount('reports', 'sessions-saved', state.data.sessions.length)}</div><div class="metric-tile"><span>Attendance entries</span>${metricCount('reports', 'attendance-entries', attendance.length)}</div><div class="metric-tile"><span>Matches saved</span>${metricCount('reports', 'matches-saved', state.data.matches.length)}</div></div>
    <section class="panel panel-pad">${panelTitle('Most Frequent Attendees', 'users')}<div class="table-wrap">${topAttendance.length ? `<table class="data-table"><thead><tr><th>Player</th><th>Attendance</th></tr></thead><tbody>${topAttendance.map(item => `<tr><td class="primary-cell">${escapeHTML(item.name)}</td><td>${item.count}</td></tr>`).join('')}</tbody></table>` : emptyState('No attendance data', 'Completed or live session attendance will appear here.')}</div></section>
    <div class="notice-box">This report reads saved sessions and player records from the existing Pickle Point Match server. The dashboard does not store a second copy of your attendance.</div></div>`;
}
function renderSettings() {
  const organizer = state.organizer || {};
  const live = getLiveSession();
  return `<div class="page-stack">${pageHeading('HUSAY DINKERS / WORKSPACE', 'Workspace & Tools', 'The new management dashboard is your main organizer workspace. Queueing tools remain connected below.')}
    <section class="panel panel-pad">${panelTitle('Organizer Profile', 'users')}<div class="detail-list"><div class="detail-row"><span>Club / organizer</span><strong>${escapeHTML(organizer.displayName || organizer.username || 'HUSAY DINKERS')}</strong></div><div class="detail-row"><span>Username</span><strong>${escapeHTML(organizer.username || '—')}</strong></div><div class="detail-row"><span>Organizer slug</span><strong>${escapeHTML(organizer.slug || '—')}</strong></div><div class="detail-row"><span>DUPR ID</span><strong>${escapeHTML(organizer.duprId || '—')}</strong></div></div><div class="detail-actions"><button class="btn btn-primary" data-action="edit-settings">${icon('edit')} Edit workspace profile</button><button class="btn" data-action="export-backup">${icon('download')} Download Backup</button><button class="btn btn-danger" data-action="logout">Sign Out</button></div></section>
    <section class="panel panel-pad">${panelTitle('Connected Queueing Tools', 'court')}<div class="external-tools-grid"><a class="external-tool-card" href="/session" target="_blank" rel="noopener"><span>${icon('calendar')}</span><span><strong>Session Setup</strong><small>Start or end an open-play session</small></span></a><a class="external-tool-card" href="/queueing" target="_blank" rel="noopener"><span>${icon('court')}</span><span><strong>Live Queueing</strong><small>Manage players, courts and matches</small></span></a><a class="external-tool-card" href="/live" target="_blank" rel="noopener"><span>${icon('external')}</span><span><strong>Public Live View</strong><small>Display queue and match activity</small></span></a>${live && getRegistrationUrl(live) ? `<a class="external-tool-card" href="${escapeHTML(getRegistrationUrl(live))}" target="_blank" rel="noopener"><span>${icon('users')}</span><span><strong>Player Registration</strong><small>Open the current session registration page</small></span></a>` : ''}<a class="external-tool-card" href="/panel"><span>${icon('users')}</span><span><strong>Admin Panel</strong><small>Organizer account administration</small></span></a></div></section>
    <section class="panel panel-pad">${panelTitle('Data Source', 'report')}<div class="notice-box">This dashboard reads the same organizer-scoped app state, Registered Player Cloud, saved sessions, attendance snapshots and match logs used by Queueing. No duplicate player or match database is created.</div></section></div>`;
}

function isDashboardInteractionActive() {
  const container = $('#pageContent');
  const active = document.activeElement;
  const editingControl = Boolean(container && active && container.contains(active)
    && active.matches('input, textarea, select, [contenteditable="true"]'));
  return Boolean(state.pointerInteraction || courtStripDrag || editingControl);
}

function isDashboardPageScrolled() {
  const container = $('#pageContent');
  return Boolean(state.page === 'dashboard' && container && container.scrollTop > 1);
}

function flushPendingDashboardRender() {
  if (!state.pendingRender || isDashboardPageScrolled()) return;
  window.setTimeout(() => {
    if (state.pendingRender && !state.modal && !isDashboardInteractionActive()) renderPageStable();
  }, 160);
}

function interactiveMapSignature(node) {
  const raw = node.dataset.mapLocations || '';
  const variant = node.dataset.mapVariant || '';
  const focusSession = node.dataset.mapFocusSession || '';
  if (variant !== 'preview') return `${variant}|${focusSession}|${raw}`;
  try {
    const locations = JSON.parse(raw);
    return JSON.stringify({
      variant,
      focusSession,
      includeRegisteredCourts: node.dataset.mapIncludeRegistered === 'true',
      locations: asArray(locations).map(item => ({
        location: item.location,
        coordinates: item.coordinates,
        sessionIds: asArray(item.sessions).map(session => session.id),
        courts: asArray(item.courts).map(court => ({
          id: court.id,
          name: court.name,
          logo: court.logo,
          locationCoordinates: court.locationCoordinates
        }))
      }))
    });
  } catch (_) {
    return `${variant}|${focusSession}|${raw}`;
  }
}

function samePatchNode(current, next) {
  return current.nodeType === next.nodeType
    && (current.nodeType !== Node.ELEMENT_NODE || current.tagName === next.tagName);
}

function syncPatchAttributes(current, next) {
  for (const attribute of [...current.attributes]) {
    if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
  }
  for (const attribute of [...next.attributes]) {
    if (current.getAttribute(attribute.name) !== attribute.value) {
      current.setAttribute(attribute.name, attribute.value);
    }
  }
}

function patchNodeIdentity(node) {
  if (node.nodeType === Node.ELEMENT_NODE) {
    if (node.id) return `id:${node.id}`;
    const classes = node.getAttribute('class');
    if (classes) return `${node.tagName}|class:${classes}`;
    for (const attribute of ['data-key', 'data-session-id', 'data-player-id', 'data-match-id']) {
      if (node.hasAttribute(attribute)) return `${node.tagName}|${attribute}:${node.getAttribute(attribute)}`;
    }
    return `${node.tagName}|plain`;
  }
  return `node:${node.nodeType}`;
}

function patchDashboardChildren(current, next) {
  let cursor = current.firstChild;
  for (const nextChild of [...next.childNodes]) {
    const identity = patchNodeIdentity(nextChild);
    let match = null;
    if (cursor && samePatchNode(cursor, nextChild) && patchNodeIdentity(cursor) === identity) {
      match = cursor;
    } else {
      for (let candidate = cursor; candidate; candidate = candidate.nextSibling) {
        if (samePatchNode(candidate, nextChild) && patchNodeIdentity(candidate) === identity) {
          match = candidate;
          break;
        }
      }
    }

    if (!match) {
      const inserted = nextChild.cloneNode(true);
      current.insertBefore(inserted, cursor);
      cursor = inserted.nextSibling;
      continue;
    }
    if (match !== cursor) current.insertBefore(match, cursor);
    patchDashboardNode(match, nextChild);
    cursor = match.nextSibling;
  }

  while (cursor) {
    const following = cursor.nextSibling;
    cursor.remove();
    cursor = following;
  }
}

// Patch existing dashboard nodes instead of replacing the whole page. This keeps
// the scroll containers, focused controls, map canvas and card layout in place.
function patchDashboardNode(current, next) {
  if (!samePatchNode(current, next)) {
    const replacement = next.cloneNode(true);
    current.replaceWith(replacement);
    return replacement;
  }

  if (current.nodeType === Node.TEXT_NODE || current.nodeType === Node.COMMENT_NODE) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return current;
  }

  if (current.classList?.contains('interactive-map') && current.id === next.id) {
    const sameMap = interactiveMapSignature(current) === interactiveMapSignature(next);
    if (sameMap) {
      syncPatchAttributes(current, next);
      return current;
    }
    const map = state.mapInstances.get(current.id);
    if (map) { try { map.remove(); } catch (_) {} }
    state.mapInstances.delete(current.id);
    const replacement = next.cloneNode(true);
    current.replaceWith(replacement);
    return replacement;
  }

  syncPatchAttributes(current, next);
  patchDashboardChildren(current, next);
  return current;
}

function renderDashboardInPlace() {
  const container = $('#pageContent');
  if (isDashboardPageScrolled()) {
    state.pendingRender = true;
    return;
  }
  const previousCountValues = captureDashboardCountValues();
  const currentRoot = container?.firstElementChild;
  if (!container || !currentRoot?.classList.contains('page-dashboard')) {
    renderPage(true);
    return;
  }

  const staging = document.createElement('div');
  staging.innerHTML = renderDashboard();
  const nextRoot = staging.firstElementChild;
  if (!nextRoot) return;

  patchDashboardNode(currentRoot, nextRoot);
  animateDashboardCountValues(previousCountValues);
  animateDashboardAttendanceBars();
  state.pendingRender = false;
  updateNavigation();
  scheduleDashboardRankings();
  initializeInteractiveMaps();
}

function renderPage(preserveScroll = true) {
  if (!state.data) return;
  const container = $('#pageContent');
  const previousCountValues = captureDashboardCountValues();
  const oldScroll = preserveScroll ? container.scrollTop : 0;
  const activeElement = preserveScroll && container.contains(document.activeElement) ? document.activeElement : null;
  const activeId = activeElement?.id || '';
  const previousMaps = preserveScroll
    ? new Map($$('.interactive-map', container).map(node => [node.id, {
        node,
        locations: interactiveMapSignature(node),
        variant: node.dataset.mapVariant || ''
      }]))
    : new Map();

  // Detach old map instances from state immediately, but dispose their WebGL
  // resources after the new page has painted so sidebar navigation stays responsive.
  const mapsToDestroy = preserveScroll ? [] : [...state.mapInstances.values()];
  if (!preserveScroll) state.mapInstances.clear();
  const renderers = { dashboard: renderDashboard, sessions: renderSessions, players: renderPlayers, matches: renderMatches, rankings: renderRankings, courts: renderCourts, schedule: renderSchedule, reports: renderReports, settings: renderSettings };
  container.innerHTML = (renderers[state.page] || renderDashboard)();
  animateDashboardCountValues(previousCountValues);
  if (state.page === 'dashboard') {
    animateDashboardAttendanceBars();
  }
  if (state.page === 'rankings') {
    scheduleRankingsPage();
    state.dashboardRankingToken += 1;
  } else if (state.page === 'dashboard') {
    state.rankingRenderToken += 1;
    scheduleDashboardRankings();
  } else {
    state.rankingRenderToken += 1;
    state.dashboardRankingToken += 1;
  }

  // Retain loaded WebGL maps when their saved location payload is unchanged.
  for (const [mapId, previous] of previousMaps) {
    const replacement = $('#' + mapId, container);
    const canKeepMap = replacement
      && previous.locations === interactiveMapSignature(replacement)
      && previous.variant === (replacement.dataset.mapVariant || '');
    if (canKeepMap) {
      replacement.replaceWith(previous.node);
      const map = state.mapInstances.get(mapId);
      if (map) window.requestAnimationFrame(() => { if (previous.node.isConnected) map.resize(); });
    } else {
      const map = state.mapInstances.get(mapId);
      if (map) { try { map.remove(); } catch (_) {} }
      state.mapInstances.delete(mapId);
    }
  }

  container.scrollTop = oldScroll;
  if (activeId) {
    const replacement = document.getElementById(activeId);
    if (replacement) replacement.focus({ preventScroll: true });
  }
  updateNavigation();
  state.pendingRender = false;
  window.requestAnimationFrame(() => {
    if (container.isConnected) container.scrollTop = oldScroll;
    // Give the browser one paint with the new page before doing WebGL teardown
    // or creating a map for the destination page.
    window.setTimeout(() => {
      mapsToDestroy.forEach(map => { try { map.remove(); } catch (_) { /* The old map node may already be detached. */ } });
      if (container.isConnected) initializeInteractiveMaps();
    }, 0);
  });
}
function renderPageStable() {
  const container = $('#pageContent');
  if (!container || !state.data) return;
  if (isDashboardPageScrolled()) {
    state.pendingRender = true;
    return;
  }
  if (state.page === 'dashboard') {
    renderDashboardInPlace();
    return;
  }
  const scrollTop = container.scrollTop;
  const nested = ['.table-wrap', '.session-list', '.ranking-list', '.court-status-grid'].flatMap(selector => $$(selector, container).map((node, index) => ({ selector, index, top: node.scrollTop, left: node.scrollLeft })));
  renderPage(true);
  container.scrollTop = scrollTop;
  nested.forEach(saved => {
    const nodes = $$(saved.selector, container);
    if (nodes[saved.index]) {
      nodes[saved.index].scrollTop = saved.top;
      nodes[saved.index].scrollLeft = saved.left;
    }
  });
  state.pendingRender = false;
}

function updateNavigation() {
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.page === state.page));
  const labels = { dashboard: 'Dashboard', sessions: 'Open Play Sessions', players: 'Players', matches: 'Match Records', rankings: 'Player Rankings', courts: 'Courts & Locations', schedule: 'Schedule', reports: 'Reports', settings: 'Workspace & Tools' };
  $('#breadcrumb').textContent = labels[state.page] || 'Dashboard';
  $('#organizerName').textContent = state.organizer?.displayName || state.organizer?.username || 'HUSAY DINKERS';
}
function setPage(page) {
  if (!['dashboard', 'sessions', 'players', 'matches', 'rankings', 'courts', 'schedule', 'reports', 'settings'].includes(page)) return;
  $('#sidebar').classList.remove('mobile-open');
  $('#mobileScrim').classList.remove('visible');
  $('#topPopover').hidden = true;

  // Clicking the already-open item should not rebuild the page or restart its map.
  // Preserve the old behavior of clearing an active search on the current page.
  if (state.page === page) {
    if (state.query) {
      state.query = '';
      $('#globalSearch').value = '';
      renderPage(true);
    }
    return;
  }

  state.page = page;
  state.query = '';
  $('#globalSearch').value = '';
  updateNavigation();
  // Dashboard and Rankings now paint lightweight shells first; their ranking
  // calculations and map initialization happen after the first content paint.
  // Render the shell in this click task instead of waiting for another frame.
  state.navigationRequest += 1;
  renderPage(false);
}
function toast(message, type = 'success') {
  const node = document.createElement('div');
  node.className = 'toast';
  node.innerHTML = `${icon(type === 'error' ? 'info' : 'check')}<span>${escapeHTML(message)}</span>`;
  $('#toastRegion').append(node);
  window.setTimeout(() => node.remove(), 3400);
}
function modal(title, body, options = {}) {
  for (const mapId of ['sessionMapModal', 'courtLocationPinMap']) {
    const existingMap = state.mapInstances.get(mapId);
    if (existingMap) { try { existingMap.remove(); } catch (_) {} state.mapInstances.delete(mapId); }
  }
  const root = $('#modalRoot');
  root.innerHTML = `<div class="modal-backdrop" data-action="close-modal"></div><section class="modal-card ${options.wide ? 'wide' : ''} ${escapeHTML(options.className || '')}" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><header class="modal-header"><div class="modal-heading-copy"><h2 id="modalTitle">${escapeHTML(title)}</h2>${options.subtitle ? `<p>${escapeHTML(options.subtitle)}</p>` : ''}</div><button type="button" class="icon-action" data-action="close-modal" aria-label="Close">${icon('close')}</button></header><div class="modal-body">${body}</div></section>`;
  state.modal = title;
  const focusable = $('input:not([type=hidden]),select,textarea,button', root);
  if (focusable) window.setTimeout(() => focusable.focus(), 20);
}
function closeModal() {
  for (const mapId of ['sessionMapModal', 'courtLocationPinMap']) {
    const map = state.mapInstances.get(mapId);
    if (map) { try { map.remove(); } catch (_) {} state.mapInstances.delete(mapId); }
  }
  $('#modalRoot').innerHTML = '';
  state.modal = null;
  flushPendingDashboardRender();
}
function datetimeLocalValue(value) {
  const parts = localDateParts(value);
  return parts.date && parts.time ? `${parts.date}T${parts.time}` : '';
}
function buildSessionRanking(session) {
  const ranked = new Map();
  const ensure = name => {
    const clean = String(name || '').trim();
    const key = normalizeName(clean);
    if (!key) return null;
    if (!ranked.has(key)) {
      const profile = state.data.players.find(player => normalizeName(player.name) === key) || {};
      ranked.set(key, { name: clean, nickname: profile.nickname || '', gender: profile.gender || '', category: profile.category || '', wins: 0, losses: 0, matches: 0, winRate: 0 });
    }
    return ranked.get(key);
  };
  (session.attendees || []).forEach(person => ensure(person.name));
  state.data.matches.filter(match => match.sessionId === session.id).forEach(match => {
    const a = match.teamANames.map(ensure).filter(Boolean);
    const b = match.teamBNames.map(ensure).filter(Boolean);
    const score = String(match.raw?.score || match.scoreLabel || '').match(/^(\d{1,2})\s*[-–:]\s*(\d{1,2})$/);
    let winner = match.winner;
    if (score && Number(score[1]) !== Number(score[2])) winner = Number(score[1]) > Number(score[2]) ? 'A' : 'B';
    if (!winner) return;
    [...a, ...b].forEach(player => { player.matches += 1; });
    a.forEach(player => { if (winner === 'A') player.wins += 1; else player.losses += 1; });
    b.forEach(player => { if (winner === 'B') player.wins += 1; else player.losses += 1; });
  });
  return [...ranked.values()].filter(player => player.matches > 0).map(player => ({ ...player, winRate: Math.round(player.wins / player.matches * 100) })).sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || a.losses - b.losses || b.matches - a.matches || a.name.localeCompare(b.name));
}
function openSessionPodium(sessionId) {
  const session = state.data.sessions.find(item => item.id === sessionId);
  if (!session || session.isLive) return;
  const ranking = buildSessionRanking(session);
  const podium = ranking.slice(0, 3);
  const podiumMarkup = podium.length ? `<div class="session-podium">${podium.map((player, index) => `<article class="session-podium-card place-${index + 1}"><span class="session-podium-medal">${['🥇','🥈','🥉'][index]}</span><strong>${escapeHTML(player.name)}${player.nickname ? ` (${escapeHTML(player.nickname)})` : ''}</strong><span>${player.winRate}% win rate</span><small>${player.wins}W · ${player.losses}L · ${player.matches} matches</small></article>`).join('')}</div>` : emptyState('No ranking available yet', 'This session has no completed match results with a recorded winner.');
  const rows = ranking.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Rank</th><th>Player</th><th>Category</th><th>Wins</th><th>Losses</th><th>Win rate</th><th>Matches</th></tr></thead><tbody>${ranking.map((player, index) => `<tr><td class="primary-cell">${index + 1}</td><td class="primary-cell">${escapeHTML(player.name)}</td><td>${escapeHTML(player.category || '—')}</td><td>${player.wins}</td><td>${player.losses}</td><td>${player.winRate}%</td><td>${player.matches}</td></tr>`).join('')}</tbody></table></div>` : '';
  modal(`${session.title} — Session Podium`, `${podiumMarkup}${rows}<div class="detail-actions"><button class="btn" data-action="close-modal">Close</button></div>`, { wide: true });
}

function openSessionDetails(sessionId) {
  const session = state.data.sessions.find(item => item.id === sessionId);
  if (!session) return;
  const attendees = session.attendees || [];
  const attendanceRows = attendees.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Player</th><th>Category</th><th>Gender</th><th>Action</th></tr></thead><tbody>${attendees.map(person => `<tr><td>${person.index + 1}</td><td class="primary-cell">${escapeHTML(person.name)}${person.nickname ? `<span class="muted-cell">${escapeHTML(person.nickname)}</span>` : ''}</td><td>${escapeHTML(person.category)}</td><td>${escapeHTML(person.gender || '—')}</td><td><div class="table-actions"><button class="btn btn-sm" data-attendance-edit="${escapeHTML(session.id)}|${person.index}">Edit</button><button class="icon-action danger" data-attendance-delete="${escapeHTML(session.id)}|${person.index}" title="Remove attendance">${icon('trash')}</button></div></td></tr>`).join('')}</tbody></table></div>` : emptyState('No attendance names available', 'No player attendance snapshots were saved for this session.');
  const sessionMatches = state.data.matches.filter(match => match.sessionId === session.id);
  modal(session.title, `<div class="detail-list"><div class="detail-row"><span>Date</span><strong>${escapeHTML(sessionDateLabel(session))}</strong></div><div class="detail-row"><span>Time</span><strong>${escapeHTML(sessionTimeLabel(session))}</strong></div><div class="detail-row"><span>Status</span><strong>${escapeHTML(sessionStatus(session))}</strong></div><div class="detail-row"><span>Players</span><strong>${attendees.length}</strong></div><div class="detail-row"><span>Matches</span><strong>${sessionMatches.length}</strong></div><div class="detail-row"><span>Location</span><strong>${escapeHTML(sessionLocationLabel(session))}</strong></div></div><div class="panel-heading session-detail-heading"><h3 class="panel-title">${icon('users')} Attendance List</h3><span class="page-note">${attendees.length} saved check-ins</span></div>${attendanceRows}<div class="detail-actions"><button class="btn" data-action="close-modal">Close</button>${!session.isLive && sessionMatches.length ? `<button class="btn btn-primary" data-session-podium="${escapeHTML(session.id)}">View Session Podium</button>` : ''}${session.isLive ? `<a class="btn btn-primary" href="/queueing" target="_blank" rel="noopener">Open Live Queue</a>` : ''}</div>`, { wide: true });
}
function openSessionRename(sessionId) {
  const session = state.data.sessions.find(item => item.id === sessionId);
  if (!session || session.isLive) return;
  const endValue = datetimeLocalValue(session.endedAt);
  const coordinates = normalizeMapLocationCoordinates(session.locationCoordinates || session.raw?.duprLocationCoordinates || session.raw?.locationCoordinates);
  modal('Edit Open Play Session', `<form id="sessionRenameForm" data-session-id="${escapeHTML(session.id)}"><div class="form-grid"><div class="field full"><label for="renameSession">Session name</label><input id="renameSession" name="sessionName" maxlength="200" required value="${escapeHTML(session.title)}"></div>${courtLocationFieldMarkup(session.location || '', coordinates, false)}<div class="field full"><label for="renameSessionEnd">Session end date and time</label><input id="renameSessionEnd" name="endedAt" type="datetime-local" value="${escapeHTML(endValue)}"><small class="field-help">Changing the end time also adjusts the saved start time and match timestamps in the original records.</small></div><div class="field full"><div class="modal-footer form-footer"><button type="button" class="btn" data-action="close-modal">Cancel</button><button type="submit" class="btn btn-primary">Save changes</button></div></div></div></form>`, { wide: true });
  const form = $('#sessionRenameForm');
  initializeCourtLocationPinMap(form, coordinates);
  if (session.location) prepareExistingCourtPinPreview(form, { name: '', location: session.location, locationCoordinates: coordinates });
}
function openParticipantEdit(sessionId, index) {
  const session = state.data.sessions.find(item => item.id === sessionId);
  const person = session?.attendees.find(item => item.index === index);
  if (!session || !person) return;
  const categories = ['BEG', 'NOV', 'INT', 'ADV', 'EXP'];
  modal('Edit Attendance Record', `<form id="participantEditForm" data-session-id="${escapeHTML(sessionId)}" data-index="${index}"><div class="participant-edit-grid"><div class="field full"><label for="participantName">Full name</label><input id="participantName" name="name" maxlength="100" required value="${escapeHTML(person.name)}"></div><div class="field"><label for="participantNickname">Nickname</label><input id="participantNickname" name="nickname" maxlength="60" value="${escapeHTML(person.nickname)}"></div><div class="field"><label for="participantGender">Gender</label><select id="participantGender" name="gender"><option value="">Not specified</option><option ${person.gender === 'Male' ? 'selected' : ''}>Male</option><option ${person.gender === 'Female' ? 'selected' : ''}>Female</option></select></div><div class="field full"><label for="participantCategory">Category</label><select id="participantCategory" name="category"><option value="">Not specified</option>${categories.map(code => `<option value="${code}" ${person.categoryCode === code ? 'selected' : ''}>${CATEGORY_NAMES[code]}</option>`).join('')}</select></div></div><div class="modal-footer form-footer"><button type="button" class="btn" data-action="close-modal">Cancel</button><button type="submit" class="btn btn-primary">Save attendance</button></div></form>`);
}
function openMatchEdit(matchKey) {
  const match = state.data.matches.find(item => item.key === matchKey);
  if (!match || !match.isScored) return;
  modal('Edit Match Score', `<form id="matchEditForm" data-session-id="${escapeHTML(match.sessionId)}" data-match-id="${escapeHTML(match.id)}"><div class="form-grid"><div class="field full"><label>Match</label><div class="notice-box">${escapeHTML(match.teamANames.join(' / '))} vs ${escapeHTML(match.teamBNames.join(' / '))}</div></div><div class="field"><label for="matchEditScore">Score (Team 1 – Team 2)</label><input id="matchEditScore" name="score" required maxlength="5" pattern="\\d{1,2}\\s*-\\s*\\d{1,2}" value="${escapeHTML(match.scoreLabel.replace('–', '-'))}" placeholder="11-7"></div><div class="field full"><div class="field-help">Only matches with a recorded score can be edited in the original queueing system.</div></div><div class="field full"><div class="modal-footer form-footer"><button type="button" class="btn" data-action="close-modal">Cancel</button><button type="submit" class="btn btn-primary">Save score</button></div></div></div></form>`);
}

async function openOrganizerSettings() {
  try {
    const response = await api('/api/organizer-settings');
    const organizer = response.organizer || {};
    modal('Edit Workspace Profile', `<form id="organizerSettingsForm"><div class="form-grid"><div class="field full"><label for="workspaceDisplayName">Club / organizer name</label><input id="workspaceDisplayName" name="displayName" maxlength="80" required value="${escapeHTML(organizer.displayName || '')}"></div><div class="field"><label for="workspaceDuprId">Organizer DUPR ID</label><input id="workspaceDuprId" name="duprId" maxlength="6" minlength="6" pattern="[A-Za-z0-9]{6}" value="${escapeHTML(organizer.duprId || '')}" placeholder="6 characters"><small class="field-help">Exactly 6 letters or numbers.</small></div><div class="field"><label for="workspaceLogo">Club logo (optional)</label><input id="workspaceLogo" name="profileImage" type="file" accept="image/png,image/jpeg,image/webp"><small class="field-help">PNG, JPG or WebP, maximum 2 MB.</small></div><div class="field full"><label class="checkbox-field"><input type="checkbox" name="showOnLeaderboard" ${organizer.showOnLeaderboard !== false ? 'checked' : ''}> Show this club on organizer leaderboard</label></div><div class="field full"><div class="notice-box">Password change is optional. Leave password fields blank to keep your current password.</div></div><div class="field"><label for="workspaceCurrentPassword">Current password</label><input id="workspaceCurrentPassword" name="currentPassword" type="password" autocomplete="current-password"></div><div class="field"><label for="workspaceNewPassword">New password</label><input id="workspaceNewPassword" name="newPassword" type="password" minlength="8" maxlength="200" autocomplete="new-password"></div><div class="field full"><label for="workspaceConfirmPassword">Confirm new password</label><input id="workspaceConfirmPassword" name="confirmPassword" type="password" minlength="8" maxlength="200" autocomplete="new-password"></div></div><div class="modal-footer form-footer"><button type="button" class="btn" data-action="close-modal">Cancel</button><button type="submit" class="btn btn-primary">Save profile</button></div></form>`, { wide: true });
  } catch (error) { toast(error.message || 'Unable to load workspace settings.', 'error'); }
}
function courtLocationFieldMarkup(value = '', coordinates = null, required = true) {
  const saved = normalizeMapLocationCoordinates(coordinates);
  const lat = saved?.lat ?? '';
  const lon = saved?.lon ?? '';
  const label = saved?.label || '';
  return `<div class="field full court-location-field"><label for="registerCourtLocation">Court location</label><div class="court-location-input-wrap"><input id="registerCourtLocation" name="courtLocation" data-court-location-input maxlength="250" autocomplete="off" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-controls="registerCourtLocationSuggestions" aria-expanded="false" ${required ? 'required' : ''} value="${escapeHTML(value)}" placeholder="Search a court, venue, street, barangay, or city in the Philippines"><div id="registerCourtLocationSuggestions" class="court-location-suggestions" data-court-location-suggestions role="listbox" aria-label="Philippines location search results" hidden></div></div><input type="hidden" data-court-location-lat value="${escapeHTML(lat)}"><input type="hidden" data-court-location-lon value="${escapeHTML(lon)}"><input type="hidden" data-court-location-label value="${escapeHTML(label)}"><input type="hidden" data-court-location-place-id value="${escapeHTML(saved?.placeId || saved?.osmId || '')}"><input type="hidden" data-court-location-pin-id value="${escapeHTML(saved?.pinId || '')}"><input type="hidden" data-court-location-pin-confirmed value="${saved?.verified === true ? 'true' : 'false'}"><input type="hidden" data-court-location-pin-source value="${escapeHTML(saved?.source || '')}"><small class="field-help">Search a court, venue, or address in the Philippines, then choose the correct result. Drag the red pin or tap the map to set the exact court entrance; the selected place ID or generated pin ID is saved with the location.</small><div class="court-location-map-heading"><strong>Pin the exact court location</strong><span>Drag pin or tap map</span></div><div class="court-location-pin-map" data-court-location-map role="application" aria-label="Map for placing the exact pickleball court pin"><div class="map-loading">Loading court pin map…</div></div><span class="field-help" id="registerCourtLocationStatus" aria-live="polite">${saved ? 'Saved court pin loaded. Drag it or tap the map to correct the exact location.' : 'Search a place first, or zoom in and tap the exact court location on the map.'}</span></div>`;
}

function courtLogoFieldMarkup(existingLogo = '', edit = false) {
  return `<div class="field full"><label for="registerCourtLogo">Court logo</label><input id="registerCourtLogo" name="courtLogo" type="file" accept="image/png,image/jpeg,image/webp" ${edit ? '' : 'required'}><small class="field-help">PNG, JPG or WebP. ${edit ? 'Choose a new file only if you want to replace the current logo.' : 'This logo will appear inside the court pin on CourtMap.'}</small><div class="court-logo-preview" id="registerCourtLogoPreview" ${existingLogo ? '' : 'hidden'}>${existingLogo ? `<img src="${escapeHTML(existingLogo)}" alt="Current court logo preview">` : ''}</div></div>`;
}
function openRegisterCourtModal() {
  modal('Register a Court on a Session', `<form id="registerCourtForm"><div class="form-grid">${courtLogoFieldMarkup()}<div class="field full"><label for="registerCourtName">Court name</label><input id="registerCourtName" name="courtName" maxlength="100" required placeholder="Enter court name"></div>${courtLocationFieldMarkup()}</div><div class="modal-footer form-footer"><button type="button" class="btn" data-action="close-modal">Cancel</button><button type="submit" class="btn btn-primary">${icon('plus')} Register Court</button></div></form>`, { wide: true });
  initializeCourtLocationPinMap($('#registerCourtForm'));
}
function openEditRegisteredCourtModal(courtId) {
  const court = asArray(state.data?.registeredCourts).find(item => String(item.id) === String(courtId));
  if (!court) { toast('Registered court not found. Refresh the page and try again.', 'error'); return; }
  modal('Edit Registered Court', `<form id="editRegisteredCourtForm" data-court-id="${escapeHTML(court.id)}"><div class="form-grid">${courtLogoFieldMarkup(court.logo, true)}<div class="field full"><label for="registerCourtName">Court name</label><input id="registerCourtName" name="courtName" maxlength="100" required value="${escapeHTML(court.name)}" placeholder="Enter court name"></div>${courtLocationFieldMarkup(court.location, court.locationCoordinates)}</div><div class="modal-footer form-footer"><button type="button" class="btn" data-action="close-modal">Cancel</button><button type="submit" class="btn btn-primary">Save Changes</button></div></form>`, { wide: true });
  const form = $('#editRegisteredCourtForm');
  initializeCourtLocationPinMap(form, court.locationCoordinates);
  prepareExistingCourtPinPreview(form, court);
}
function readCourtLogoFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      reject(new Error('Choose a PNG, JPG or WebP court logo no larger than 2 MB.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The selected court logo could not be read.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('The selected court logo is not a valid image.'));
      image.onload = () => {
        const maxDimension = 320;
        const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) { reject(new Error('The court logo could not be prepared.')); return; }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        let result = canvas.toDataURL('image/webp', 0.82);
        if (!result.startsWith('data:image/webp;base64,')) result = canvas.toDataURL('image/png');
        if (result.length > 450000) { reject(new Error('The court logo is still too large after resizing. Choose a smaller image.')); return; }
        resolve(result);
      };
      image.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve('');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) return reject(new Error('Choose a PNG, JPG or WebP logo no larger than 2 MB.'));
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('The selected logo could not be read.'));
    reader.readAsDataURL(file);
  });
}

async function withRefresh(successMessage, requestFn, page = state.page) {
  try {
    await requestFn();
    await refreshData({ silent: true });
    closeModal();
    state.page = page;
    renderPage(true);
    if (successMessage) toast(successMessage);
  } catch (error) {
    toast(error.message || 'The change could not be saved.', 'error');
  }
}
function parseComposite(value) {
  const parts = String(value || '').split('|');
  return { sessionId: parts[0] || '', index: Number(parts[1]) };
}
function getMatchByKey(key) { return state.data.matches.find(match => match.key === key); }

function populateStaticIcons() { $$('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); }); }
function closeMobileNav() { $('#sidebar').classList.remove('mobile-open'); $('#mobileScrim').classList.remove('visible'); }

// Main click delegation keeps controls stable when view HTML is refreshed.
// Mouse users can drag the horizontal court strip just like a touch swipe.
let courtStripDrag = null;
document.addEventListener('pointerdown', event => {
  if (event.pointerType !== 'mouse' || event.button !== 0 || !event.isPrimary) return;
  const viewport = event.target.closest('.court-status-grid');
  if (!viewport || viewport.scrollWidth <= viewport.clientWidth + 1) return;
  courtStripDrag = { viewport, pointerId: event.pointerId, startX: event.clientX, startScrollLeft: viewport.scrollLeft, moved: false };
  // Capture the pointer so dragging keeps working even when the cursor leaves the court strip.
  try { viewport.setPointerCapture(event.pointerId); } catch (_) {}
});
document.addEventListener('pointermove', event => {
  if (!courtStripDrag || event.pointerId !== courtStripDrag.pointerId) return;
  const delta = event.clientX - courtStripDrag.startX;
  if (!courtStripDrag.moved && Math.abs(delta) < 3) return;
  courtStripDrag.moved = true;
  const viewport = courtStripDrag.viewport;
  viewport.classList.add('is-dragging');
  const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
  viewport.scrollLeft = Math.min(maxScroll, Math.max(0, courtStripDrag.startScrollLeft - delta));
  event.preventDefault();
});
function finishCourtStripDrag(event) {
  if (!courtStripDrag || (event && event.pointerId !== courtStripDrag.pointerId)) return;
  const { viewport, pointerId } = courtStripDrag;
  viewport.classList.remove('is-dragging');
  try { if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId); } catch (_) {}
  courtStripDrag = null;
}
document.addEventListener('pointerup', finishCourtStripDrag);
document.addEventListener('pointercancel', finishCourtStripDrag);

// Pause automatic DOM replacement while a pointer gesture is in progress.
document.addEventListener('pointerdown', event => {
  if ($('#pageContent').contains(event.target)) state.pointerInteraction = true;
}, true);
function finishDashboardPointerInteraction() {
  state.pointerInteraction = false;
  flushPendingDashboardRender();
}
document.addEventListener('pointerup', finishDashboardPointerInteraction);
document.addEventListener('pointercancel', finishDashboardPointerInteraction);
window.addEventListener('blur', finishDashboardPointerInteraction);

document.addEventListener('click', async event => {
  const registeredCourtMapFocus = event.target.closest('[data-map-focus-court-id]');
  if (registeredCourtMapFocus) {
    await focusRegisteredCourtOnMap(registeredCourtMapFocus.dataset.mapFocusCourtId || '');
    return;
  }
  const courtLocationOption = event.target.closest('[data-court-location-option]');
  if (courtLocationOption) {
    const form = courtLocationOption.closest('form');
    const input = form?.querySelector('[data-court-location-input]');
    if (form && input) {
      form._courtPinRevision = Number(form._courtPinRevision || 0) + 1;
      const label = courtLocationOption.dataset.label || '';
      courtLocationSearchToken += 1;
      if (courtLocationSearchTimer) window.clearTimeout(courtLocationSearchTimer);
      input.value = label;
      const suggestions = form.querySelector('[data-court-location-suggestions]');
      if (suggestions) { suggestions.hidden = true; suggestions.innerHTML = ''; }
      input.setAttribute('aria-expanded', 'false');
      courtLocationActiveIndex = -1;
      const lat = Number(courtLocationOption.dataset.lat);
      const lon = Number(courtLocationOption.dataset.lon);
      const placeId = String(courtLocationOption.dataset.placeId || '').trim();
      const selectedSource = String(courtLocationOption.dataset.source || '').trim();
      input.dataset.selectedLocation = 'true';
      if (isPhilippinesCoordinate(lat, lon)) {
        moveCourtLocationPin(form, { lat, lon, placeId, osmId: placeId.startsWith('osm:') ? placeId : '' }, {
          confirmed: true,
          source: selectedSource || 'map-search',
          label,
          zoom: 16,
          placeId,
          osmId: placeId.startsWith('osm:') ? placeId : ''
        });
      } else if (selectedSource === 'gensan-court-directory') {
        previewGensanDirectoryVenueOnMap(form, {
          name: courtLocationOption.querySelector('strong')?.textContent || label,
          address: courtLocationOption.querySelector('small')?.textContent || ''
        });
      } else {
        const status = form.querySelector('#registerCourtLocationStatus');
        if (status) status.textContent = 'This map result has no usable GPS coordinates. Tap the exact court location on the map before saving.';
      }
    }
    return;
  }
  const playerImportFilter = event.target.closest('[data-player-import-filter]');
  if (playerImportFilter && pendingPlayerImport) {
    pendingPlayerImport.filter = playerImportFilter.dataset.playerImportFilter || 'all';
    applyPlayerImportPreviewFilters();
    return;
  }

  const matchTypeButton = event.target.closest('[data-match-type-filter]');
  if (matchTypeButton) {
    const nextMatchType = matchTypeButton.dataset.matchTypeFilter;
    if (!['all', 'dupr', 'non-dupr'].includes(nextMatchType)) return;
    state.filters.matchType = nextMatchType;
    const matchTypeFilter = matchTypeButton.closest('.match-type-filter');
    if (matchTypeFilter) {
      matchTypeFilter.dataset.active = nextMatchType;
      $$('.match-type-option', matchTypeFilter).forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.matchTypeFilter === nextMatchType));
      });
    }
    const recordsWrap = $('#matchRecordsTableWrap');
    if (recordsWrap) recordsWrap.innerHTML = matchesTable(filteredMatchRecords());
    updateFilteredMatchRecordsMetric();
    return;
  }

  const pageButton = event.target.closest('[data-page]');
  if (pageButton) { event.preventDefault(); setPage(pageButton.dataset.page); return; }

  const navigationButton = event.target.closest('[data-navigate]');
  if (navigationButton) { event.preventDefault(); openToolTab(navigationButton.dataset.navigate); return; }

  const actionButton = event.target.closest('[data-action]');
  if (actionButton) {
    const action = actionButton.dataset.action;
    if (action === 'close-modal') { closeModal(); return; }
    if (action === 'create-session') { openToolTab('/session'); return; }
    if (action === 'register-player') {
      const url = getRegistrationUrl();
      if (url) navigateTo(url); else { toast('Start an open-play session before registering players.', 'error'); openToolTab('/session'); }
      return;
    }
    if (action === 'record-match' || action === 'open-queue' || action === 'manage-courts') { openToolTab('/queueing'); return; }
    if (action === 'open-live') { window.open('/live', '_blank', 'noopener'); return; }
    if (action === 'refresh') {
      if (state.refreshingDashboard) return;
      state.refreshingDashboard = true;
      actionButton.classList.add('is-refreshing');
      actionButton.setAttribute('aria-busy', 'true');
      actionButton.disabled = true;
      try {
        const ok = await refreshData({ silent: true });
        if (ok) toast('Queueing data refreshed.');
      } finally {
        state.refreshingDashboard = false;
        const refreshButton = $('[data-action="refresh"]');
        if (refreshButton) {
          refreshButton.classList.remove('is-refreshing');
          refreshButton.setAttribute('aria-busy', 'false');
          refreshButton.disabled = false;
        }
      }
      return;
    }
    if (action === 'import-players') { $('#playerCsvImportFile')?.click(); return; }
    if (action === 'confirm-player-import') { await confirmPlayerImport(actionButton); return; }
    if (action === 'export-players') { exportPlayers(); return; }
    if (action === 'export-dupr') { exportDuprMatches(); return; }
    if (action === 'edit-settings') { openOrganizerSettings(); return; }
    if (action === 'register-court') { openRegisterCourtModal(); return; }
    if (action === 'edit-registered-court') { openEditRegisteredCourtModal(actionButton.dataset.courtId || ''); return; }
    if (action === 'delete-registered-court') {
      const courtId = String(actionButton.dataset.courtId || '');
      const court = asArray(state.data?.registeredCourts).find(item => String(item.id) === courtId);
      if (!court) { toast('Registered court not found. Refresh the page and try again.', 'error'); return; }
      if (window.confirm(`Delete ${court.name} from your Registered Court List? Its map pin will also be removed.`)) {
        await withRefresh('Registered court deleted.', () => api(`/api/organizer-dashboard/courts/${encodeURIComponent(courtId)}`, { method: 'DELETE' }), 'courts');
      }
      return;
    }
    if (action === 'export-rankings') { exportRankings(); return; }
    if (action === 'export-report') { exportReport(); return; }
    if (action === 'export-backup') { exportBackup(); return; }
    if (action === 'logout') {
      try { await api('/api/logout', { method: 'POST' }); } catch (_) {}
      navigateTo('/'); return;
    }
  }

  const openMap = event.target.closest('[data-open-map-modal]');
  if (openMap) { openMapModal(openMap.dataset.openMapModal || '', openMap.dataset.mapIncludeRegistered === 'true'); return; }
  const mapEditCourt = event.target.closest('[data-map-edit-court-id]');
  if (mapEditCourt) { openEditRegisteredCourtModal(mapEditCourt.dataset.mapEditCourtId || ''); return; }
  const mapSessionSelect = event.target.closest('[data-map-session-select]');
  if (mapSessionSelect) {
    const selectedId = mapSessionSelect.dataset.mapSessionSelect;
    if ($('#sessionMapModal')) setMapModalSession(selectedId);
    else openMapModal(selectedId, state.page === 'dashboard');
    return;
  }
  const mapLocationFocus = event.target.closest('[data-map-location-focus]');
  if (mapLocationFocus) {
    const location = String(mapLocationFocus.dataset.mapLocationFocus || '').trim();
    const mapNode = $('#sessionMapModal');
    if (mapNode) {
      mapNode.dataset.mapFocusLocation = location;
      mapNode.dataset.mapFocusSession = '';
    }
    let coordinates = state.mapResolvedLocations.get(normalizeName(location)) || coordinatesFromText(location);
    if (!coordinates && location) coordinates = await photonLookup(location);
    if (coordinates) {
      state.mapResolvedLocations.set(normalizeName(location), coordinates);
      if (mapNode) focusMapCoordinates('sessionMapModal', coordinates, location);
    } else if (location) {
      const status = $('[data-map-status="sessionMapModal"]');
      if (status) status.textContent = `The map location for “${location}” could not be resolved.`;
    }
    return;
  }
  const mapOpenSession = event.target.closest('[data-map-open-session]');
  if (mapOpenSession) { openSessionDetails(mapOpenSession.dataset.mapOpenSession); return; }
  if (event.target.closest('[data-map-show-philippines]')) { showPhilippinesMap('sessionMapModal'); return; }
  if (event.target.closest('[data-map-focus-selected]')) { focusMapSession(state.mapModalSessionId, 'sessionMapModal'); return; }

  const sessionView = event.target.closest('[data-session-view]');
  if (sessionView) { openSessionDetails(sessionView.dataset.sessionView); return; }
  const sessionPodium = event.target.closest('[data-session-podium]');
  if (sessionPodium) { openSessionPodium(sessionPodium.dataset.sessionPodium); return; }
  const sessionEdit = event.target.closest('[data-session-edit]');
  if (sessionEdit) { openSessionRename(sessionEdit.dataset.sessionEdit); return; }
  const sessionRegister = event.target.closest('[data-session-register]');
  if (sessionRegister) {
    const session = state.data.sessions.find(item => item.id === sessionRegister.dataset.sessionRegister);
    const url = getRegistrationUrl(session);
    if (url) window.open(url, '_blank', 'noopener'); else toast('Registration is available only for the current live session.', 'error');
    return;
  }
  const sessionDelete = event.target.closest('[data-session-delete]');
  if (sessionDelete) {
    const session = state.data.sessions.find(item => item.id === sessionDelete.dataset.sessionDelete);
    if (!session || session.isLive) { toast('End the live session before deleting it.', 'error'); return; }
    if (window.confirm('Delete this session and all match records saved under it? This cannot be undone.')) {
      await withRefresh('Session deleted.', () => api(`/api/organizer-dashboard/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE' }), 'sessions');
    }
    return;
  }
  const attendanceEdit = event.target.closest('[data-attendance-edit]');
  if (attendanceEdit) { const { sessionId, index } = parseComposite(attendanceEdit.dataset.attendanceEdit); openParticipantEdit(sessionId, index); return; }
  const attendanceDelete = event.target.closest('[data-attendance-delete]');
  if (attendanceDelete) {
    const { sessionId, index } = parseComposite(attendanceDelete.dataset.attendanceDelete);
    const session = state.data.sessions.find(item => item.id === sessionId);
    const person = session?.attendees.find(item => item.index === index);
    if (person && window.confirm(`Remove ${person.name} from this session's attendance only? The player profile and queue history remain unchanged.`)) {
      await withRefresh('Attendance record removed.', () => api(`/api/organizer-dashboard/sessions/${encodeURIComponent(sessionId)}/participants/${index}`, { method: 'DELETE' }));
      if (state.data) openSessionDetails(sessionId);
    }
    return;
  }
  const matchEdit = event.target.closest('[data-match-edit]');
  if (matchEdit) { openMatchEdit(matchEdit.dataset.matchEdit); return; }
  const matchDelete = event.target.closest('[data-match-delete]');
  if (matchDelete) {
    const match = getMatchByKey(matchDelete.dataset.matchDelete);
    if (match && window.confirm('Delete this match record from the original queueing history?')) {
      await withRefresh('Match record deleted.', () => api(`/api/organizer-dashboard/sessions/${encodeURIComponent(match.sessionId)}/matches/${encodeURIComponent(match.id)}`, { method: 'DELETE' }), 'matches');
    }
    return;
  }
});

document.addEventListener('change', event => {
  if (event.target?.id !== 'registerCourtLogo') return;
  const file = event.target.files?.[0];
  const preview = event.target.closest('form')?.querySelector('#registerCourtLogoPreview');
  if (!preview) return;
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
    toast('Choose a PNG, JPG or WebP court logo no larger than 2 MB.', 'error');
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    if (!preview.isConnected) return;
    preview.innerHTML = `<img src="${escapeHTML(String(reader.result || ''))}" alt="Court logo preview">`;
    preview.hidden = false;
  };
  reader.readAsDataURL(file);
});

document.addEventListener('submit', async event => {
  const form = event.target;
  if (form.id === 'registerCourtForm' || form.id === 'editRegisteredCourtForm') {
    event.preventDefault();
    const editing = form.id === 'editRegisteredCourtForm';
    const fd = new FormData(form);
    const name = String(fd.get('courtName') || '').trim();
    const location = String(fd.get('courtLocation') || '').trim();
    const logoFile = form.querySelector('[name="courtLogo"]')?.files?.[0];
    const existingCourt = editing ? asArray(state.data?.registeredCourts).find(item => String(item.id) === String(form.dataset.courtId || '')) : null;
    const submitButton = form.querySelector('button[type="submit"]');
    const locationStatus = form.querySelector('#registerCourtLocationStatus');
    if (!name || !location || (!editing && !logoFile) || (editing && !existingCourt)) { toast('Enter the court name and location, then choose a court logo.', 'error'); return; }
    if (submitButton) { submitButton.disabled = true; submitButton.textContent = editing ? 'Saving…' : 'Registering…'; }
    if (locationStatus) locationStatus.textContent = 'Checking the selected Philippines map location…';
    try {
      const logo = logoFile ? await readCourtLogoFile(logoFile) : String(existingCourt?.logo || '');
      const selectedLat = Number(form.querySelector('[data-court-location-lat]')?.value);
      const selectedLon = Number(form.querySelector('[data-court-location-lon]')?.value);
      const selectedLabel = String(form.querySelector('[data-court-location-label]')?.value || '').trim();
      const pinConfirmed = form.querySelector('[data-court-location-pin-confirmed]')?.value === 'true';
      const pinSource = String(form.querySelector('[data-court-location-pin-source]')?.value || '').trim();
      let selectedPlaceId = String(form.querySelector('[data-court-location-place-id]')?.value || '').trim();
      let selectedPinId = String(form.querySelector('[data-court-location-pin-id]')?.value || '').trim();
      if (pinConfirmed && Number.isFinite(selectedLat) && Number.isFinite(selectedLon) &&
          isPhilippinesCoordinate(selectedLat, selectedLon) && !selectedPlaceId) {
        const pinRevision = Number(form._courtPinRevision || 0);
        await resolveCourtPinPlaceId(form, { lat: selectedLat, lon: selectedLon }, pinRevision);
        selectedPlaceId = String(form.querySelector('[data-court-location-place-id]')?.value || '').trim();
        selectedPinId = String(form.querySelector('[data-court-location-pin-id]')?.value || '').trim();
      }
      const selectedCoordinates = pinConfirmed && Number.isFinite(selectedLat) && Number.isFinite(selectedLon) && isPhilippinesCoordinate(selectedLat, selectedLon)
        ? { lat: selectedLat, lon: selectedLon, label: selectedLabel || location, source: pinSource || (selectedLabel.includes('Manually placed') ? 'manual-map-pin' : 'map-search'), verified: true, placeId: selectedPlaceId, pinId: selectedPinId || `pin:${selectedLat.toFixed(7)},${selectedLon.toFixed(7)}` }
        : null;
      const coordinates = selectedCoordinates || null;
      if (!coordinates) {
        const pinHelp = 'This GenSan court listing does not have a verified GPS pin yet. On the map, tap the exact court entrance or drag the red pin onto it, then register again.';
        if (locationStatus) locationStatus.textContent = pinHelp;
        throw new Error('Exact court pin not confirmed. Tap the court entrance on the map or drag the red pin to the correct spot before registering.');
      }
      if (!logo) throw new Error('Choose a valid court logo before saving.');
      const requestUrl = editing ? `/api/organizer-dashboard/courts/${encodeURIComponent(existingCourt.id)}` : '/api/organizer-dashboard/courts';
      await api(requestUrl, {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify({ name, location, logo, locationCoordinates: { lat: coordinates.lat, lon: coordinates.lon, label: coordinates.label || selectedLabel || location, countrycode: 'PH', source: coordinates.source || 'manual-map-pin', verified: true, placeId: coordinates.placeId || '', pinId: coordinates.pinId || `pin:${coordinates.lat.toFixed(7)},${coordinates.lon.toFixed(7)}`, osmId: String(coordinates.placeId || '').startsWith('osm:') ? coordinates.placeId : '' } })
      });
      closeModal();
      await refreshData({ silent: false });
      toast(editing ? 'Registered court updated.' : 'Court registered and added to CourtMap.');
    } catch (error) {
      toast(error.message || (editing ? 'The court could not be updated.' : 'The court could not be registered.'), 'error');
      if (submitButton && submitButton.isConnected) {
        submitButton.disabled = false;
        if (editing) submitButton.textContent = 'Save Changes';
        else submitButton.innerHTML = `${icon('plus')} Register Court`;
      }
    }
    return;
  }
  if (form.id === 'sessionRenameForm') {
    event.preventDefault();
    const sessionId = form.dataset.sessionId;
    const fd = new FormData(form);
    const sessionName = String(fd.get('sessionName') || '').trim();
    const location = String(fd.get('courtLocation') || '').trim();
    const endValue = String(fd.get('endedAt') || '').trim();
    const session = state.data.sessions.find(item => item.id === sessionId);
    const previousLocation = String(session?.location || '').trim();
    const locationChanged = location !== previousLocation;
    const lat = Number(form.querySelector('[data-court-location-lat]')?.value);
    const lon = Number(form.querySelector('[data-court-location-lon]')?.value);
    const pinConfirmed = form.querySelector('[data-court-location-pin-confirmed]')?.value === 'true';
    const hasConfirmedPin = pinConfirmed && isPhilippinesCoordinate(lat, lon);
    const locationLabel = String(form.querySelector('[data-court-location-label]')?.value || location).trim();
    const placeId = String(form.querySelector('[data-court-location-place-id]')?.value || '').trim();
    const pinId = String(form.querySelector('[data-court-location-pin-id]')?.value || '').trim();
    const pinSource = String(form.querySelector('[data-court-location-pin-source]')?.value || '').trim();
    if (!sessionName) { toast('Session name cannot be blank.', 'error'); return; }
    if (previousLocation && !location) { toast('Please enter a session location. To change it, select a new place or confirm its map pin.', 'error'); return; }
    if (locationChanged && location && !hasConfirmedPin) {
      toast('Select the new location from the suggestions, or drag/tap the map pin to confirm its exact location before saving.', 'error');
      return;
    }
    const body = { sessionName };
    // Preserve the previous rename-only behavior when an older session has no
    // GPS pin or when its location has not been changed. Save a location only
    // when the user has confirmed a pin or entered a new location.
    if (location && hasConfirmedPin) {
      body.location = location;
      body.locationCoordinates = {
        lat,
        lon,
        label: locationLabel || location,
        countrycode: 'PH',
        source: pinSource || 'manual-map-pin',
        verified: true,
        placeId,
        pinId: pinId || `pin:${lat.toFixed(7)},${lon.toFixed(7)}`,
        osmId: placeId.startsWith('osm:') ? placeId : ''
      };
    }
    if (endValue) {
      const endDate = new Date(endValue);
      if (!Number.isFinite(endDate.getTime())) { toast('Please enter a valid session end date and time.', 'error'); return; }
      if (session?.startedAt && endDate.getTime() < new Date(session.startedAt).getTime()) { toast('Session end time cannot be earlier than its start time.', 'error'); return; }
      body.endedAt = endDate.toISOString();
    }
    await withRefresh('Session details updated.', () => api(`/api/organizer-dashboard/sessions/${encodeURIComponent(sessionId)}`, { method: 'PATCH', body: JSON.stringify(body) }), 'sessions');
  }
  if (form.id === 'organizerSettingsForm') {
    event.preventDefault();
    const fd = new FormData(form);
    const newPassword = String(fd.get('newPassword') || '');
    const confirmPassword = String(fd.get('confirmPassword') || '');
    if (newPassword && newPassword !== confirmPassword) { toast('New password and confirmation do not match.', 'error'); return; }
    if (newPassword && !String(fd.get('currentPassword') || '')) { toast('Enter your current password to change it.', 'error'); return; }
    try {
      const body = {
        displayName: String(fd.get('displayName') || '').trim(),
        showOnLeaderboard: fd.get('showOnLeaderboard') === 'on'
      };
      const submittedDuprId = String(fd.get('duprId') || '').trim().toUpperCase();
      if (submittedDuprId) body.duprId = submittedDuprId;
      if (newPassword) { body.currentPassword = String(fd.get('currentPassword') || ''); body.newPassword = newPassword; }
      const image = form.querySelector('[name="profileImage"]')?.files?.[0];
      if (image) body.profileImage = await readImageFile(image);
      const response = await api('/api/organizer-settings', { method: 'PATCH', body: JSON.stringify(body) });
      state.organizer = { ...(state.organizer || {}), ...(response.organizer || {}) };
      closeModal();
      await refreshData({ silent: false });
      toast('Workspace profile updated.');
    } catch (error) { toast(error.message || 'Workspace profile could not be saved.', 'error'); }
  }
  if (form.id === 'participantEditForm') {
    event.preventDefault();
    const fd = new FormData(form);
    const sessionId = form.dataset.sessionId;
    const index = Number(form.dataset.index);
    const body = { name: fd.get('name'), nickname: fd.get('nickname'), gender: fd.get('gender'), category: fd.get('category') };
    await withRefresh('Attendance participant updated.', () => api(`/api/organizer-dashboard/sessions/${encodeURIComponent(sessionId)}/participants/${index}`, { method: 'PATCH', body: JSON.stringify(body) }));
    openSessionDetails(sessionId);
  }
  if (form.id === 'matchEditForm') {
    event.preventDefault();
    const fd = new FormData(form);
    const sessionId = form.dataset.sessionId;
    const matchId = form.dataset.matchId;
    await withRefresh('Match score updated.', () => api(`/api/organizer-dashboard/sessions/${encodeURIComponent(sessionId)}/matches/${encodeURIComponent(matchId)}`, { method: 'PATCH', body: JSON.stringify({ score: fd.get('score') }) }), 'matches');
  }
});

// Keep the dashboard visually still while the user scrolls through it.
// Background refreshes may update state, but the DOM is patched only at the top.
$('#pageContent').addEventListener('scroll', () => {
  if (state.page !== 'dashboard') return;
  if ($('#pageContent').scrollTop <= 1) {
    updateCourtStatusClocks();
    if (state.pendingRender) flushPendingDashboardRender();
  }
}, { passive: true });

$('#pageContent').addEventListener('focusout', () => {
  if (!state.pendingRender) return;
  window.setTimeout(() => {
    const active = document.activeElement;
    const editingControl = $('#pageContent').contains(active) && active && active.matches('input, textarea, select, [contenteditable="true"]');
    if (!editingControl && !state.modal && !state.pointerInteraction && !courtStripDrag) renderPageStable();
  }, 0);
});

let registrationPrefetchUrl = '';
function prefetchRegistrationPage() {
  const url = getRegistrationUrl();
  if (!url || url === registrationPrefetchUrl) return;
  registrationPrefetchUrl = url;
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.as = 'document';
  link.href = url;
  document.head.append(link);
}
document.addEventListener('pointerover', event => {
  if (event.target.closest('[data-action="register-player"]')) prefetchRegistrationPage();
}, { passive: true });
document.addEventListener('focusin', event => {
  if (event.target.closest('[data-action="register-player"]')) prefetchRegistrationPage();
});

document.addEventListener('input', event => {
  if (event.target?.id === 'playerImportSearch' && pendingPlayerImport) {
    pendingPlayerImport.query = event.target.value || '';
    applyPlayerImportPreviewFilters();
    return;
  }
  const input = event.target.closest('[data-court-location-input]');
  if (!input) return;
  const form = input.closest('form');
  if (!form) return;
  const latField = form.querySelector('[data-court-location-lat]');
  const lonField = form.querySelector('[data-court-location-lon]');
  const labelField = form.querySelector('[data-court-location-label]');
  const confirmedField = form.querySelector('[data-court-location-pin-confirmed]');
  const sourceField = form.querySelector('[data-court-location-pin-source]');
  const placeIdField = form.querySelector('[data-court-location-place-id]');
  const pinIdField = form.querySelector('[data-court-location-pin-id]');
  if (latField) latField.value = '';
  if (lonField) lonField.value = '';
  if (labelField) labelField.value = '';
  if (confirmedField) confirmedField.value = 'false';
  if (sourceField) sourceField.value = '';
  if (placeIdField) placeIdField.value = '';
  if (pinIdField) pinIdField.value = '';
  delete input.dataset.placeId;
  delete input.dataset.pinId;
  delete input.dataset.osmId;
  input.dataset.selectedLocation = 'false';
  const status = form.querySelector('#registerCourtLocationStatus');
  form._courtPinRevision = Number(form._courtPinRevision || 0) + 1;
  const query = input.value.trim();
  const token = ++courtLocationSearchToken;
  if (courtLocationSearchTimer) window.clearTimeout(courtLocationSearchTimer);
  const list = form.querySelector('[data-court-location-suggestions]');
  if (list) { list.hidden = true; list.innerHTML = ''; }
  input.setAttribute('aria-expanded', 'false');
  courtLocationActiveIndex = -1;
  if (query.length < 3) {
    if (list) { list.hidden = true; list.innerHTML = ''; }
    if (status) status.textContent = 'Type at least 3 characters to search Philippine locations.';
    return;
  }
  if (status) status.textContent = 'Searching Philippine map locations…';
  courtLocationSearchTimer = window.setTimeout(async () => {
    try {
      const places = await searchPhilippineLocations(query);
      if (token !== courtLocationSearchToken || !input.isConnected || input.value.trim() !== query) return;
      const mapPlaces = places.map(item => ({ ...item, kind: 'map-place' }));
      renderCourtLocationSuggestions(form, mapPlaces.slice(0, 8), query);
      if (status) status.textContent = mapPlaces.length
        ? 'Select a Philippines map location, then verify the exact pin.'
        : 'No exact match yet. Try another court name, barangay, city or province, or place the pin manually.';
    } catch (error) {
      if (token !== courtLocationSearchToken || !input.isConnected) return;
      if (list) { list.innerHTML = `<div class="court-location-no-results">${escapeHTML(error.message || 'Location search is unavailable.')}</div>`; list.hidden = false; }
      if (status) status.textContent = 'Location search is temporarily unavailable. You can try again.';
    }
  }, 320);
});

document.addEventListener('focusin', event => {
  const input = event.target.closest('[data-court-location-input]');
  if (!input) return;
  const list = input.closest('form')?.querySelector('[data-court-location-suggestions]');
  if (list && list.children.length) { list.hidden = false; input.setAttribute('aria-expanded', 'true'); }
});
document.addEventListener('click', event => {
  if (event.target.closest('.court-location-field')) return;
  document.querySelectorAll('[data-court-location-suggestions]').forEach(list => {
    list.hidden = true;
    const input = list.closest('form')?.querySelector('[data-court-location-input]');
    if (input) input.setAttribute('aria-expanded', 'false');
  });
});
document.addEventListener('pointerdown', event => {
  if (event.target.closest('[data-court-location-option]')) event.preventDefault();
});
document.addEventListener('keydown', event => {
  const input = event.target.closest('[data-court-location-input]');
  if (!input) return;
  const list = input.closest('form')?.querySelector('[data-court-location-suggestions]');
  if (!list || list.hidden) return;
  const options = [...list.querySelectorAll('[data-court-location-option]')];
  if (event.key === 'ArrowDown' && options.length) {
    event.preventDefault();
    courtLocationActiveIndex = Math.min(options.length - 1, courtLocationActiveIndex + 1);
  } else if (event.key === 'ArrowUp' && options.length) {
    event.preventDefault();
    courtLocationActiveIndex = Math.max(0, courtLocationActiveIndex - 1);
  } else if (event.key === 'Enter' && courtLocationActiveIndex >= 0) {
    event.preventDefault();
    options[courtLocationActiveIndex]?.click();
    return;
  } else if (event.key === 'Escape') {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    courtLocationActiveIndex = -1;
    return;
  } else {
    return;
  }
  options.forEach((option, index) => {
    const active = index === courtLocationActiveIndex;
    option.setAttribute('aria-selected', String(active));
    if (active) option.scrollIntoView({ block: 'nearest' });
  });
});

$('#globalSearch').addEventListener('input', event => { state.query = event.target.value.trim(); renderPage(true); });
$('#globalSearch').addEventListener('keydown', event => { if (event.key === 'Escape') { event.target.value = ''; state.query = ''; renderPage(true); } });
$('#mobileMenu').addEventListener('click', () => { $('#sidebar').classList.add('mobile-open'); $('#mobileScrim').classList.add('visible'); });
$('#mobileScrim').addEventListener('click', closeMobileNav);
$('#notificationsBtn').addEventListener('click', () => {
  const pop = $('#topPopover');
  const live = getLiveSession();
  pop.innerHTML = `<strong class="popover-heading">Queueing activity</strong>${live ? `<button type="button" data-session-view="${escapeHTML(live.id)}">${escapeHTML(live.title)} · Live now</button>` : '<span class="popover-empty">No active open-play session.</span>'}<div class="popover-actions"><button type="button" class="popover-action" data-navigate="/queueing">Open live queue</button><button type="button" class="popover-action" data-navigate="/session">Session setup</button></div>`;
  pop.hidden = !pop.hidden;
});
$('#profileBtn').addEventListener('click', () => {
  const pop = $('#topPopover');
  pop.innerHTML = `<strong class="popover-heading">${escapeHTML(state.organizer?.displayName || 'HUSAY DINKERS')}</strong><button data-page="settings">Workspace & tools</button><button data-action="export-backup">Download data backup</button><button data-action="logout">Sign out</button>`;
  pop.hidden = !pop.hidden;
});
document.addEventListener('click', event => {
  if (!event.target.closest('#topPopover') && !event.target.closest('#notificationsBtn') && !event.target.closest('#profileBtn')) $('#topPopover').hidden = true;
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { closeModal(); $('#topPopover').hidden = true; closeMobileNav(); }
});
document.addEventListener('change', async event => {
  const target = event.target;
  if (target.id === 'playerCsvImportFile') {
    const file = target.files?.[0];
    target.value = '';
    await handlePlayerCsvFile(file);
    return;
  }
  if (target.id === 'mapModalSessionSelect') { setMapModalSession(target.value); return; }
  if (target.id === 'sessionStatusFilter') { state.filters.sessionStatus = target.value; renderPage(true); }
  if (target.id === 'playerCategoryFilter') { state.filters.playerCategory = target.value; const filtered = visibleRows(state.data.players.filter(player => !player.historicalOnly).sort((a,b)=>a.name.localeCompare(b.name))).filter(player => state.filters.playerCategory === 'all' || player.category === state.filters.playerCategory); $('#playersTableWrap').innerHTML = playersTable(filtered); }
  if (target.id === 'rankingCategoryFilter') { state.filters.rankingCategory = target.value; scheduleRankingsPage(); }
  if (target.id === 'rankingSessionFilter') {
    state.filters.rankingSession = target.value;
    if (state.page === 'rankings') scheduleRankingsPage();
    else if (state.page === 'matches') {
      const recordsWrap = $('#matchRecordsTableWrap');
      if (recordsWrap) recordsWrap.innerHTML = matchesTable(filteredMatchRecords());
      updateFilteredMatchRecordsMetric();
    }
  }
});

let dashboardRefreshTimer = null;
function scheduleDashboardRefresh(delay = 220) {
  if (dashboardRefreshTimer) window.clearTimeout(dashboardRefreshTimer);
  dashboardRefreshTimer = window.setTimeout(() => {
    dashboardRefreshTimer = null;
    if (!document.hidden && !state.modal) refreshData({ silent: true });
  }, delay);
}

function initEventStream() {
  if (!('EventSource' in window) || state.eventStream) return;
  const stream = new EventSource('/api/shared-events');
  state.eventStream = stream;
  const refresh = () => scheduleDashboardRefresh();
  stream.addEventListener('app-state', refresh);
  stream.addEventListener('cloud-records', refresh);
  stream.addEventListener('error', () => { /* EventSource retries automatically. */ });
}

async function init() {
  populateStaticIcons();
  try {
    await refreshData({ silent: true });
    if (!state.data) return;
    renderPage(false);
    initEventStream();
    updateCourtStatusClocks();
    window.setInterval(updateCourtStatusClocks, 1000);
    window.setInterval(() => scheduleDashboardRefresh(0), 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !state.modal) scheduleDashboardRefresh(0); });
  } catch (error) {
    $('#pageContent').innerHTML = `<div class="empty-state"><span class="empty-icon">${icon('info')}</span><strong>Unable to connect to the Pickle Point Match server</strong><p>${escapeHTML(error.message || 'Please sign in again or check the server.')}</p><a class="btn btn-primary btn-sm" href="/?next=manage">Organizer sign in</a></div>`;
  }
}

init();
