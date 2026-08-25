/* ==================== STATE ==================== */
const API_BASE = '/api';

/* Make a value safe to embed inside a single-quoted JS string literal used in
   inline event handlers (onclick="fn('VALUE')"). encodeURIComponent leaves
   apostrophes unescaped, so raw paths/names containing ' break the string. */
function jsStr(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

let audio = null;
let video = null;
let allTracks = [];
let tracks = [];
let allFolders = [];
let currentFolder = null;
let playlists = [];
let playQueue = [];
let currentIndex = -1;
let currentPlaylistId = null;
let isShuffle = false;
let repeatMode = 'none';
let currentView = 'list';
let renamingPlaylistId = null;
let activeSubmenu = null;
let musicDirs = [];
let isVideo = false;

/* ==================== YOUTUBE STATE ==================== */
let youtubeResults = [];
let youtubePlaying = null; // {videoId, title} when iframe is open
let invidiousLoggedIn = false;
let invidiousUsername = '';
let youtubeFeed = [];

/* ==================== LOCAL FILTERS STATE (mirror YouTube) ==================== */
let localFilterType = 'all';   // 'all' | 'audio' | 'video'
let localSort = 'name';        // 'name' | 'name_desc' | 'date' | 'date_desc'
let localDateWindow = '';      // '' | 'today' | 'week' | 'month' | 'year'

/* ==================== IMMICH STATE ==================== */
let immichConfig = { url: '', connected: false };
let immichAlbums = [];
let immichAlbumAssets = [];
let immichView = null; // null | 'albums' | 'album-<id>'
let immichAllAssets = [];
let immichSort = 'name'; // 'default' | 'name' | 'date' | 'name_desc' | 'date_desc'
let nowPlayingImmichId = null;

const trackColors = [
  'linear-gradient(135deg, #8b5cf6, #ec4899)',
  'linear-gradient(135deg, #6ee7b7, #38bdf8)',
  'linear-gradient(135deg, #fbbf24, #fb7185)',
  'linear-gradient(135deg, #a78bfa, #38bdf8)',
  'linear-gradient(135deg, #f472b6, #fbbf24)',
  'linear-gradient(135deg, #38bdf8, #6ee7b7)',
  'linear-gradient(135deg, #fb7185, #a78bfa)',
  'linear-gradient(135deg, #6ee7b7, #fbbf24)',
];

/* ==================== UTILS ==================== */
function getTrackColor(i) { return trackColors[i % trackColors.length]; }

/* ==================== AUTH ==================== */
let currentUser = null;

async function checkAuth() {
  try {
    const res = await fetch(`${API_BASE}/auth/status`);
    const data = await res.json();
    if (data.authenticated) {
      currentUser = data.user;
      hideLoginModal();
      showUserBadge();
      return true;
    }
    if (data.first_run) {
      showRegisterModal();
    } else {
      showLoginModal();
    }
    return false;
  } catch (e) {
    showLoginModal();
    return false;
  }
}

function showLoginModal() {
  document.getElementById('loginTitle').textContent = 'Iniciar sesion';
  document.getElementById('loginBtn').textContent = 'Entrar';
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').textContent = '';
  document.getElementById('loginModal').style.display = 'flex';
  document.getElementById('loginUsername').focus();
}

function showRegisterModal() {
  document.getElementById('loginTitle').textContent = 'Crear cuenta';
  document.getElementById('loginBtn').textContent = 'Crear cuenta';
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').textContent = 'Primera vez: create tu usuario administrador';
  document.getElementById('loginModal').style.display = 'flex';
  document.getElementById('loginUsername').focus();
}

function hideLoginModal() {
  document.getElementById('loginModal').style.display = 'none';
}

async function doLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errorEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');
  if (!username || !password) {
    errorEl.textContent = 'Completa todos los campos';
    return;
  }
  const isRegister = btn.textContent.includes('Crear');
  const endpoint = isRegister ? 'register' : 'login';
  btn.disabled = true;
  btn.textContent = isRegister ? 'Creando...' : 'Entrando...';
  errorEl.textContent = '';

  try {
    const res = await fetch(`${API_BASE}/auth/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (data.error) {
      errorEl.textContent = data.error;
      btn.disabled = false;
      btn.textContent = isRegister ? 'Crear cuenta' : 'Entrar';
      return;
    }
    currentUser = data.user;
    hideLoginModal();
    showUserBadge();
    initApp();
  } catch (e) {
    errorEl.textContent = 'Error de conexion';
    btn.disabled = false;
    btn.textContent = isRegister ? 'Crear cuenta' : 'Entrar';
  }
}

async function doLogout() {
  await fetch(`${API_BASE}/auth/logout`, { method: 'POST' });
  currentUser = null;
  const badge = document.getElementById('authBadge');
  if (badge) badge.remove();
  showLoginModal();
}

function showUserBadge() {
  let badge = document.getElementById('authBadge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'authBadge';
    badge.className = 'auth-user-badge';
    document.querySelector('.topbar-controls').appendChild(badge);
  }
  badge.innerHTML = `<span class="auth-username">${escapeHtml(currentUser)}</span><button class="auth-logout-btn" onclick="doLogout()">Salir</button>`;
}

/* Intercept fetch to handle 401 and inject CSRF token */
let _csrfToken = '';
const _originalFetch = window.fetch;
window.fetch = async function(...args) {
  // Inject CSRF header into state-changing requests
  if (_csrfToken && args[1] && typeof args[1] === 'object') {
    const method = (args[1].method || '').toUpperCase();
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      args[1].headers = args[1].headers || {};
      if (args[1].headers instanceof Headers) {
        args[1].headers.set('X-CSRF-Token', _csrfToken);
      } else {
        args[1].headers['X-CSRF-Token'] = _csrfToken;
      }
    }
  }
  const res = await _originalFetch.apply(this, args);
  // Capture CSRF token from any response that carries it
  const serverToken = res.headers.get('X-CSRF-Token');
  if (serverToken) _csrfToken = serverToken;
  if (res.status === 401 && currentUser) {
    currentUser = null;
    showLoginModal();
  }
  return res;
};

function initApp() {
  loadFiles();
  loadPlaylists();
  loadFolders();
  loadImmichConfig();
  checkInvidiousAuth();
}

function escapeHtml(t) {
  if (t == null) return '';
  return String(t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(s) {
  if (isNaN(s)) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

function cleanName(f) {
  return f.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');
}

function getCoverUrl(track) {
  if (track.cover) {
    return `${API_BASE}/cover/${encodeURIComponent(track.path.replace(/\.[^/.]+$/, '.png'))}`;
  }
  return null;
}

/* ==================== METADATA ==================== */
// Last fetched metadata, consumed by the queue card (rendered in PR3).
let currentMeta = null;

async function fetchMetadata(path) {
  try {
    const resp = await fetch(`${API_BASE}/metadata?path=${encodeURIComponent(path)}`);
    if (!resp.ok) return;
    const data = await resp.json();
    if (!data || data.error) return;
    currentMeta = data;
    const track = allTracks.find(t => t.path === path);
    if (track) track.meta = data;
    const titleEl = document.getElementById('nowPlayingTitle');
    const artistEl = document.getElementById('nowPlayingArtist');
    if (titleEl && data.title) titleEl.textContent = data.title;
    if (artistEl && data.artist) artistEl.textContent = data.artist;
  } catch (e) {
    // Metadata is best-effort; ignore network/parse errors.
  }
}

/* ==================== LYRICS (PR4) ==================== */
// Last fetched lyrics for the current track (rendered by the lyrics panel).
let currentLyrics = null;
// Prefixed media path of the track currently loaded in the player.
let currentTrackPath = null;
// Parsed synced-LRC lines for the active track: [{ t: seconds, text }].
let lyricLines = [];
// Index of the currently highlighted synced line (-1 = none).
let activeLyricIndex = -1;

async function fetchLyrics(path, meta) {
  if (!path) return;
  try {
    const resp = await fetch(`${API_BASE}/lyrics?path=${encodeURIComponent(path)}`);
    if (!resp.ok) { currentLyrics = null; return; }
    const data = await resp.json();
    if (!data || data.error) { currentLyrics = null; return; }
    currentLyrics = data;
    if (isLyricsOpen()) renderLyrics();
    const fsContainer = document.getElementById('audioFullscreen');
    if (fsContainer && fsContainer.style.display !== 'none') {
      renderFullscreenLyrics();
      updateAudioFullscreenUI();
    }
  } catch (e) {
    currentLyrics = null;
  }
}

// Parse an LRC string into time-ordered [{ t: seconds, text }] entries.
// A single line may carry multiple timestamps; each becomes its own entry.
function parseLRC(synced) {
  const out = [];
  const re = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  for (const line of synced.split('\n')) {
    re.lastIndex = 0;
    const stamps = [];
    let m;
    let lastEnd = 0;
    while ((m = re.exec(line)) !== null) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const frac = m[3] ? parseInt(m[3], 10) / Math.pow(10, m[3].length) : 0;
      stamps.push(min * 60 + sec + frac);
      lastEnd = re.lastIndex;
    }
    const text = line.slice(lastEnd).trim();
    for (const t of stamps) out.push({ t, text });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

function isLyricsOpen() {
  return !!document.getElementById('lyricsOverlay');
}

// Triggered by the player-bar lyrics button (PR2 wired; panel built in PR4).
function toggleLyrics() {
  if (isLyricsOpen()) { closeLyrics(); return; }
  if (!currentTrackPath) return;
  openLyrics();
}

function openLyrics() {
  if (isLyricsOpen()) return;
  const overlay = document.createElement('div');
  overlay.className = 'lyrics-overlay';
  overlay.id = 'lyricsOverlay';
  overlay.onclick = function (e) { if (e.target === this) closeLyrics(); };
  overlay.innerHTML = `
    <div class="lyrics-drawer">
      <div class="lyrics-header">
        <h3>Letra</h3>
        <button class="lyrics-close-btn" onclick="closeLyrics()" title="Cerrar">✕</button>
      </div>
      <div class="lyrics-body" id="lyricsBody"></div>
    </div>`;
  document.body.appendChild(overlay);
  const btn = document.getElementById('lyricsBtn');
  if (btn) btn.classList.add('active');
  if (currentLyrics) renderLyrics();
  else fetchLyrics(currentTrackPath, currentMeta);
}

function closeLyrics() {
  const overlay = document.getElementById('lyricsOverlay');
  if (overlay) overlay.remove();
  const btn = document.getElementById('lyricsBtn');
  if (btn) btn.classList.remove('active');
  activeLyricIndex = -1;
}

// Render the lyrics panel body from the current track's lyrics payload.
function renderLyrics() {
  const body = document.getElementById('lyricsBody');
  if (!body) return;
  if (!currentLyrics) {
    body.innerHTML = '<div class="lyrics-empty">Cargando letra…</div>';
    return;
  }
  if (currentLyrics.instrumental) {
    body.innerHTML = '<div class="lyrics-instrumental"><span class="lyrics-instrumental-icon">🎵</span>Esta canción es instrumental</div>';
    return;
  }
  const synced = currentLyrics.syncedLyrics;
  if (synced && synced.trim()) {
    lyricLines = parseLRC(synced);
    body.innerHTML = `<div class="lyrics-toolbar"><button class="lyrics-edit-btn" onclick="openLyricsEditor()" title="Editar letra">✏️</button></div>` +
      lyricLines.map((l, i) =>
        `<div class="lyrics-line" data-index="${i}" data-time="${l.t}" onclick="seekToLyric(${i})">${l.text ? escapeHtml(l.text) : '&nbsp;'}</div>`
      ).join('');
    activeLyricIndex = -1;
    updateLyricsHighlight(audio && audio.currentTime ? audio.currentTime : 0);
    return;
  }
  const plain = currentLyrics.plainLyrics;
  if (plain && plain.trim()) {
    lyricLines = [];
    body.innerHTML = `<div class="lyrics-toolbar"><button class="lyrics-edit-btn" onclick="openLyricsEditor()" title="Editar letra">✏️</button></div>` +
      plain.split('\n').map(t =>
        `<div class="lyrics-line">${t.trim() ? escapeHtml(t) : '&nbsp;'}</div>`
      ).join('');
    return;
  }
  body.innerHTML = `<div class="lyrics-empty">Sin letra disponible</div><div class="lyrics-empty"><button class="lyrics-add-btn" onclick="openLyricsEditor()">Agregar letra</button></div>`;
}

// Click a synced line to seek the player to that timestamp.
function seekToLyric(i) {
  if (!lyricLines[i]) return;
  const t = lyricLines[i].t;
  if (audio && audio.duration) {
    audio.currentTime = t;
    if (audio.paused) audio.play().catch(() => {});
  }
}

// Highlight the synced line active at `time`, scrolling it into view.
function updateLyricsHighlight(time) {
  if (!lyricLines.length) return;
  let idx = -1;
  for (let i = 0; i < lyricLines.length; i++) {
    if (lyricLines[i].t <= time) idx = i; else break;
  }
  if (idx === activeLyricIndex) return;
  const body = document.getElementById('lyricsBody');
  if (!body) { activeLyricIndex = idx; return; }
  const prev = body.querySelector('.lyrics-line.active');
  if (prev) prev.classList.remove('active');
  if (idx >= 0) {
    const el = body.querySelector(`.lyrics-line[data-index="${idx}"]`);
    if (el) {
      el.classList.add('active');
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    }
  }
  activeLyricIndex = idx;
}

function openLyricsEditor() {
  const body = document.getElementById('lyricsBody');
  if (!body || !currentTrackPath) return;
  const existing = (currentLyrics && (currentLyrics.syncedLyrics || currentLyrics.plainLyrics)) || '';
  body.innerHTML = `
    <div class="lyrics-editor">
      <textarea class="lyrics-textarea" placeholder="Pegá la letra acá…&#10;&#10;Para letra sincronizada usá formato LRC:&#10;[00:12.50] Primera línea&#10;[00:15.30] Segunda línea">${escapeHtml(existing)}</textarea>
      <div class="lyrics-editor-actions">
        <button class="lyrics-editor-cancel" onclick="cancelLyricsEditor()">Cancelar</button>
        <button class="lyrics-editor-save" onclick="saveLyricsEditor()">Guardar</button>
      </div>
    </div>`;
  body.querySelector('.lyrics-textarea').focus();
}

function cancelLyricsEditor() {
  renderLyrics();
}

async function saveLyricsEditor() {
  const textarea = document.querySelector('.lyrics-textarea');
  if (!textarea || !currentTrackPath) return;
  const btn = document.querySelector('.lyrics-editor-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  try {
    const resp = await fetch(`${API_BASE}/lyrics/save`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({path: currentTrackPath, lyrics: textarea.value}),
    });
    
    // Leer el body una sola vez
    const data = await resp.json();
    
    if (!resp.ok) {
      throw new Error(data.error || `HTTP ${resp.status}`);
    }
    
    currentLyrics = data;
    renderLyrics();
    showToast('Letra guardada', 'success');
  } catch (e) {
    console.error('Error saving lyrics:', e);
    showToast(`Error al guardar: ${e.message}`, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Guardar'; }
  }
}

/* ==================== QUEUE HISTORY (PR3) ==================== */
// In-memory "recently played" list (YouTube Music style). Session-only: it is
// NEVER written to localStorage, so it resets to empty on every page reload
// (spec R: History Isolation).
let playHistory = [];
const MAX_HISTORY = 50;
// The track object currently loaded in the player (local audio/video or Immich).
let currentTrack = null;

function pushHistory(track) {
  if (!track) return;
  // Skip consecutive duplicates (e.g. restarting the same track).
  if (playHistory[0] === track) return;
  playHistory.unshift(track);
  if (playHistory.length > MAX_HISTORY) playHistory.length = MAX_HISTORY;
}

// Record a playback switch: push the outgoing track into history, adopt the new one.
function recordTrackSwitch(newTrack) {
  if (currentTrack && currentTrack !== newTrack && currentTrack.type !== 'youtube') {
    pushHistory(currentTrack);
  }
  currentTrack = newTrack;
}

/* ==================== THEME ==================== */
const THEME_STORAGE_KEY = 'musicserver.themes.v1';
const THEME_COLOR_KEYS = [
  ['bg-primary', 'Fondo principal'], ['bg-secondary', 'Fondo secundario'],
  ['bg-tertiary', 'Superficie elevada'], ['bg-hover', 'Hover'], ['bg-active', 'Activo'],
  ['bg-card', 'Tarjetas'], ['bg-input', 'Campos'], ['bg-modal', 'Modal'],
  ['text-primary', 'Texto principal'], ['text-secondary', 'Texto secundario'],
  ['text-tertiary', 'Texto tenue'], ['accent-primary', 'Acento principal'],
  ['accent-secondary', 'Acento secundario'], ['accent-pink', 'Acento rosa'],
  ['accent-mint', 'Acento menta'], ['accent-rose', 'Acento rojo'],
  ['accent-sky', 'Acento cielo'], ['border-color', 'Bordes'], ['border-hover', 'Borde activo'],
];

const BUILTIN_THEMES = {
  light: { name: 'Claro', colors: {
    'bg-primary':'#faf8ff','bg-secondary':'#f0ecff','bg-tertiary':'#e8e2ff','bg-hover':'#ddd6ff','bg-active':'#d0c7ff','bg-card':'#ffffff','bg-input':'#f5f2ff','bg-modal':'#ffffff','text-primary':'#2d1b69','text-secondary':'#6b5b95','text-tertiary':'#9b8ec4','accent-primary':'#8b5cf6','accent-secondary':'#a78bfa','accent-pink':'#ec4899','accent-mint':'#6ee7b7','accent-rose':'#fb7185','accent-sky':'#38bdf8','border-color':'#e0d8f5','border-hover':'#c4b5fd'
  }},
  dark: { name: 'Oscuro', colors: {
    'bg-primary':'#0f0a1a','bg-secondary':'#1a1225','bg-tertiary':'#251c35','bg-hover':'#2d2240','bg-active':'#362a4d','bg-card':'#1a1225','bg-input':'#251c35','bg-modal':'#1a1225','text-primary':'#f0ecff','text-secondary':'#b8a9e8','text-tertiary':'#8f80b7','accent-primary':'#a78bfa','accent-secondary':'#8b5cf6','accent-pink':'#f472b6','accent-mint':'#6ee7b7','accent-rose':'#fb7185','accent-sky':'#38bdf8','border-color':'#2d2240','border-hover':'#6d54a0'
  }},
  dracula: { name: 'Dracula', colors: {
    'bg-primary':'#282a36','bg-secondary':'#21222c','bg-tertiary':'#343746','bg-hover':'#44475a','bg-active':'#6272a4','bg-card':'#282a36','bg-input':'#343746','bg-modal':'#282a36','text-primary':'#f8f8f2','text-secondary':'#c7c9d1','text-tertiary':'#9a9bad','accent-primary':'#bd93f9','accent-secondary':'#ff79c6','accent-pink':'#ff79c6','accent-mint':'#50fa7b','accent-rose':'#ff5555','accent-sky':'#8be9fd','border-color':'#44475a','border-hover':'#6272a4'
  }},
  catppuccin: { name: 'Catppuccin Mocha', colors: {
    'bg-primary':'#1e1e2e','bg-secondary':'#181825','bg-tertiary':'#313244','bg-hover':'#45475a','bg-active':'#585b70','bg-card':'#1e1e2e','bg-input':'#313244','bg-modal':'#1e1e2e','text-primary':'#cdd6f4','text-secondary':'#bac2de','text-tertiary':'#9399b2','accent-primary':'#cba6f7','accent-secondary':'#89b4fa','accent-pink':'#f5c2e7','accent-mint':'#a6e3a1','accent-rose':'#f38ba8','accent-sky':'#89dceb','border-color':'#45475a','border-hover':'#7f849c'
  }},
};
let editingThemeId = null;
let themeModalLastFocus = null;

function readCustomThemes() {
  try {
    const value = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([id, theme]) => id.startsWith('custom:') && isValidTheme(theme)));
  } catch (_) { return {}; }
}

function isValidTheme(theme) {
  return theme && typeof theme.name === 'string' && theme.name.trim() && theme.colors &&
    THEME_COLOR_KEYS.every(([key]) => typeof theme.colors[key] === 'string' && /^#[0-9a-f]{6}$/i.test(theme.colors[key]));
}

function applyTheme(themeId) {
  const custom = readCustomThemes();
  const theme = BUILTIN_THEMES[themeId] || custom[themeId];
  const fallbackId = theme ? themeId : 'light';
  const selected = theme || BUILTIN_THEMES.light;
  const root = document.documentElement;
  root.dataset.theme = fallbackId;
  THEME_COLOR_KEYS.forEach(([key]) => root.style.setProperty(`--${key}`, selected.colors[key]));
  root.style.setProperty('--bg-overlay', `color-mix(in srgb, ${selected.colors['bg-primary']} 35%, #000)`);
  root.style.setProperty('--bg-player', `linear-gradient(135deg, ${selected.colors['bg-tertiary']}, ${selected.colors['bg-secondary']}, ${selected.colors['bg-primary']})`);
  root.style.setProperty('--bg-topbar', `linear-gradient(135deg, ${selected.colors['bg-secondary']}, ${selected.colors['bg-tertiary']})`);
  root.style.setProperty('--bg-sidebar', selected.colors['bg-primary']);
  root.style.setProperty('--bg-track', selected.colors['bg-card']);
  root.style.setProperty('--bg-track-hover', selected.colors['bg-hover']);
  root.style.setProperty('--bg-grid', selected.colors['bg-card']);
  root.style.setProperty('--bg-grid-hover', selected.colors['bg-hover']);
  root.style.setProperty('--bg-progress', selected.colors['bg-tertiary']);
  root.style.setProperty('--bg-scrollbar', selected.colors['bg-tertiary']);
  root.style.setProperty('--bg-scrollbar-thumb', selected.colors['border-hover']);
  root.style.setProperty('--bg-queue-item', selected.colors['bg-card']);
  root.style.setProperty('--bg-queue-item-hover', selected.colors['bg-hover']);
  root.style.setProperty('--bg-panel', selected.colors['bg-modal'] + 'dd');
  root.style.setProperty('--queue-scrim', `linear-gradient(180deg, ${selected.colors['bg-primary']}88, ${selected.colors['bg-primary']}dd)`);
  root.style.setProperty('--queue-filter', 'blur(12px) brightness(.88) saturate(1.02)');
  root.style.setProperty('--gradient-accent', `linear-gradient(135deg, ${selected.colors['accent-primary']}, ${selected.colors['accent-pink']})`);
  root.style.setProperty('--shadow-sm', `0 2px 8px ${selected.colors['accent-primary']}22`);
  root.style.setProperty('--shadow-md', `0 4px 16px ${selected.colors['accent-primary']}30`);
  root.style.setProperty('--shadow-lg', `0 8px 32px ${selected.colors['accent-primary']}40`);
  root.style.setProperty('--shadow-glow', `0 0 20px ${selected.colors['accent-primary']}55`);
  localStorage.setItem('theme', fallbackId);
  updateThemeIcon(fallbackId);
  renderThemeGrid();
}

function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  applyTheme(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  applyTheme(next);
}

function updateThemeIcon(theme) {
  const button = document.getElementById('themeToggle');
  if (button) button.textContent = theme === 'light' ? '🌙' : '☀️';
}

function allThemes() { return {...BUILTIN_THEMES, ...readCustomThemes()}; }

function showSettingsModal() {
  themeModalLastFocus = document.activeElement;
  renderThemeGrid();
  const modal = document.getElementById('settingsModal');
  modal.style.display = 'flex';
  modal.querySelector('.modal-close-btn').focus();
}

function hideSettingsModal() {
  document.getElementById('settingsModal').style.display = 'none';
  if (themeModalLastFocus) themeModalLastFocus.focus();
}

function renderThemeGrid() {
  const grid = document.getElementById('themeGrid');
  if (!grid) return;
  const active = document.documentElement.dataset.theme;
  grid.innerHTML = Object.entries(allThemes()).map(([id, theme]) => {
    const custom = !BUILTIN_THEMES[id];
    return `<article class="theme-card${id === active ? ' active' : ''}">
      <button class="theme-select" onclick="applyTheme('${jsStr(id)}')" aria-pressed="${id === active}">
        <span class="theme-swatches"><i style="background:${theme.colors['bg-primary']}"></i><i style="background:${theme.colors['accent-primary']}"></i><i style="background:${theme.colors['accent-pink']}"></i></span>
        <strong>${escapeHtml(theme.name)}</strong><small>${custom ? 'Personalizado' : 'Incluido'}</small>
      </button>
      ${custom ? `<span class="theme-card-actions"><button onclick="openThemeEditor('${jsStr(id)}')">Editar</button><button onclick="deleteTheme('${jsStr(id)}')">Eliminar</button></span>` : ''}
    </article>`;
  }).join('');
}

function openThemeEditor(id = null) {
  editingThemeId = id;
  const theme = id ? readCustomThemes()[id] : {name: '', colors: {...BUILTIN_THEMES.dark.colors}};
  document.getElementById('themeEditorTitle').textContent = id ? 'Editar tema' : 'Crear tema';
  document.getElementById('themeNameInput').value = theme.name || '';
  document.getElementById('themeFields').innerHTML = THEME_COLOR_KEYS.map(([key, label]) => `<label class="theme-field">${label}<span><input type="color" data-theme-key="${key}" value="${theme.colors[key]}"><code>${theme.colors[key]}</code></span></label>`).join('');
  document.getElementById('themeEditorError').textContent = '';
  document.getElementById('themeEditorModal').style.display = 'flex';
  document.getElementById('themeNameInput').focus();
}

function hideThemeEditor() { document.getElementById('themeEditorModal').style.display = 'none'; }

function saveThemeEditor() {
  const name = document.getElementById('themeNameInput').value.trim();
  const colors = Object.fromEntries(THEME_COLOR_KEYS.map(([key]) => [key, document.querySelector(`[data-theme-key="${key}"]`).value]));
  if (!name || !isValidTheme({name, colors})) { document.getElementById('themeEditorError').textContent = 'Ingresá un nombre y completá todos los colores.'; return; }
  const id = editingThemeId || `custom:${Date.now().toString(36)}`;
  const themes = readCustomThemes(); themes[id] = {name, colors};
  localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(themes));
  hideThemeEditor(); applyTheme(id); showSettingsModal();
}

function duplicateActiveTheme() {
  const theme = allThemes()[document.documentElement.dataset.theme] || BUILTIN_THEMES.light;
  editingThemeId = null; openThemeEditor();
  document.getElementById('themeNameInput').value = `${theme.name} (copia)`;
  THEME_COLOR_KEYS.forEach(([key]) => { document.querySelector(`[data-theme-key="${key}"]`).value = theme.colors[key]; });
}

function deleteTheme(id) {
  if (!confirm('¿Eliminar este tema personalizado?')) return;
  const themes = readCustomThemes(); delete themes[id]; localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(themes));
  if (document.documentElement.dataset.theme === id) applyTheme('light'); else renderThemeGrid();
}

function exportThemes() {
  const blob = new Blob([JSON.stringify(readCustomThemes(), null, 2)], {type: 'application/json'});
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'musicserver-themes.json'; link.click(); URL.revokeObjectURL(link.href);
}

function importThemes(event) {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  const reader = new FileReader(); reader.onload = () => {
    try {
      const input = JSON.parse(reader.result); const valid = Object.fromEntries(Object.entries(input).filter(([id, theme]) => id.startsWith('custom:') && isValidTheme(theme)));
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({...readCustomThemes(), ...valid})); renderThemeGrid();
      showToast(Object.keys(valid).length ? 'Temas importados' : 'No se encontraron temas válidos');
    } catch (_) { showToast('No se pudo importar el archivo', 'error'); }
  }; reader.readAsText(file);
}

/* ==================== DATA LOADING ==================== */
async function loadFiles() {
  try {
    const res = await fetch(`${API_BASE}/files`);
    allTracks = await res.json();
    applyFilters();
    restorePlayback();
  } catch (e) { console.error('Error loading files:', e); }
}

function applyFilters() {
  let filtered = [...allTracks];
  if (currentFolder) {
    filtered = filtered.filter(t => t.path.startsWith(currentFolder + '/'));
  }
  if (localFilterType !== 'all') {
    filtered = filtered.filter(t => t.type === localFilterType);
  }
  if (localDateWindow) {
    const windows = { today: 86400, week: 604800, month: 2592000, year: 31536000 };
    const w = windows[localDateWindow];
    if (w) {
      filtered = filtered.filter(t => Date.now() / 1000 - (t.mtime || 0) <= w);
    }
  }
  switch (localSort) {
    case 'name_desc':
      filtered.sort((a, b) => -naturalCompare(a.name, b.name));
      break;
    case 'date':
      filtered.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
      break;
    case 'date_desc':
      filtered.sort((a, b) => (a.mtime || 0) - (b.mtime || 0));
      break;
    default:
      filtered.sort((a, b) => naturalCompare(a.name, b.name));
  }
  tracks = filtered;
  renderContent();
  renderSidebar();
}

function removeLocalFilterBar() {
  const existing = document.getElementById('localFilterBar');
  if (existing) existing.remove();
}

function renderLocalFilterBar() {
  removeLocalFilterBar();
  if (immichView || currentPlaylistId) return;
  const listView = document.getElementById('listView');
  if (!listView) return;

  const bar = document.createElement('div');
  bar.id = 'localFilterBar';
  bar.className = 'youtube-filters';
  bar.innerHTML = `
    <span class="youtube-filter-label">Tipo:</span>
    <select class="youtube-filter-select" id="localFilterType" onchange="localFilterType=this.value;applyFilters()">
      <option value="all">Todas</option>
      <option value="audio">🎵 Audio</option>
      <option value="video">🎬 Video</option>
    </select>
    <span class="youtube-filter-label">Ordenar:</span>
    <select class="youtube-filter-select" id="localSort" onchange="localSort=this.value;applyFilters()">
      <option value="name">Nombre A→Z</option>
      <option value="name_desc">Nombre Z→A</option>
      <option value="date">Más recientes</option>
      <option value="date_desc">Más antiguos</option>
    </select>
    <span class="youtube-filter-label">Fecha:</span>
    <select class="youtube-filter-select" id="localDateWindow" onchange="localDateWindow=this.value;applyFilters()">
      <option value="">Cualquiera</option>
      <option value="today">Hoy</option>
      <option value="week">Esta semana</option>
      <option value="month">Este mes</option>
      <option value="year">Este año</option>
    </select>`;

  listView.parentNode.insertBefore(bar, listView);
  document.getElementById('localFilterType').value = localFilterType;
  document.getElementById('localSort').value = localSort;
  document.getElementById('localDateWindow').value = localDateWindow;
}

function dedupeYouTube(arr) {
  const seen = new Set();
  const out = [];
  for (const r of arr || []) {
    if (r && r.videoId && !seen.has(r.videoId)) {
      seen.add(r.videoId);
      out.push(r);
    }
  }
  return out;
}

async function loadFolders() {
  try {
    const [foldersRes, configRes] = await Promise.all([
      fetch(`${API_BASE}/folders`),
      fetch(`${API_BASE}/config`),
    ]);
    allFolders = await foldersRes.json();
    const cfg = await configRes.json();
    musicDirs = cfg.music_dirs || [];
    renderFolderList();
  } catch (e) { console.error('Error loading folders:', e); }
}

async function loadPlaylists() {
  try {
    const res = await fetch(`${API_BASE}/playlists`);
    playlists = await res.json();
    renderSidebar();
  } catch (e) { console.error('Error loading playlists:', e); }
}

/* ==================== RENDER ==================== */
/* ==================== IMMICH SIDEBAR ==================== */
function renderImmichSidebar() {
  const container = document.getElementById('immichSidebar');
  const active = immichView ? ' active' : '';
  const dot = immichConfig.connected ? '🟢' : '🔴';
  let html = `<div class="folder-item${active}" onclick="toggleImmichBrowser()">
    <div class="folder-icon" style="background:var(--gradient-accent);color:white;">📷</div>
    <div class="folder-info"><div class="folder-name">Immich</div></div>
    <span class="immich-status-dot" title="${immichConfig.connected ? 'Conectado' : 'Desconectado'}">${dot}</span>
  </div>`;
  const ytDot = invidiousLoggedIn ? '🟢' : '⚪';
  html += `<div class="folder-item" onclick="showYouTubeSearch()">
    <div class="folder-icon" style="background:var(--gradient-accent);color:white;">▶</div>
    <div class="folder-info"><div class="folder-name">YouTube</div></div>
    <span class="immich-status-dot" title="${invidiousLoggedIn ? 'Conectado' : 'Sin sesión'}">${ytDot}</span>
  </div>`;
  container.innerHTML = html;
}

function toggleImmichBrowser() {
  if (!immichConfig.connected) {
    showImmichConfig();
    return;
  }
  if (immichView) {
    immichView = null;
    currentPlaylistId = null;
    currentFolder = null;
    renderImmichSidebar();
    renderFolderList();
    renderSidebar();
    renderContent();
    return;
  }
  loadImmichAlbums();
}

async function loadImmichAlbums() {
  try {
    const res = await fetch(`${API_BASE}/immich/albums`);
    if (!res.ok) { const e = await res.json(); alert(e.error); return; }
    immichAlbums = await res.json();
    immichView = 'albums';
    currentPlaylistId = null;
    currentFolder = null;
    renderImmichSidebar();
    renderFolderList();
    renderSidebar();
    renderImmichAlbumsView();
  } catch (e) { console.error(e); }
}

async function loadImmichAlbum(encodedId) {
  const albumId = decodeURIComponent(encodedId);
  try {
    const res = await fetch(`${API_BASE}/immich/albums/${albumId}`);
    if (!res.ok) { const e = await res.json(); alert(e.error); return; }
    const data = await res.json();
    immichAlbumAssets = (data.assets || []).filter(a => a.type === 'VIDEO');
    immichView = `album-${albumId}`;
    renderImmichAlbumsView();
  } catch (e) { console.error(e); }
}

function setImmichActions(html) {
  const existing = document.getElementById('immichActions');
  if (existing) existing.remove();
  const addBtn = document.getElementById('addToPlaylistBtn');
  if (addBtn) addBtn.style.display = 'none';
  const container = document.createElement('div');
  container.id = 'immichActions';
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.gap = '12px';
  container.innerHTML = html;
  document.querySelector('.content-actions').appendChild(container);
}

function renderImmichAlbumsView() {
  const container = document.getElementById('trackList');
  const grid = document.getElementById('gridList');
  grid.oncontextmenu = null;
  document.getElementById('listView').style.display = 'none';
  document.getElementById('gridView').style.display = '';

  renderBackButton(immichView !== 'albums' ? loadImmichAlbums : null);

  if (immichView === 'albums') {
    document.getElementById('contentTitle').textContent = '📷 Immich — Álbumes';
    setImmichActions(`
      <button class="play-all-btn" onclick="showImmichCreateAlbum()" style="padding:12px 20px">➕ Nuevo álbum</button>
    `);

    const createCard = `<div class="grid-item" onclick="showImmichCreateAlbum()" style="cursor:pointer;border:2px dashed var(--border-hover);display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:200px">
      <div style="font-size:48px;color:var(--accent-primary);margin-bottom:12px">+</div>
      <div class="grid-title" style="color:var(--accent-primary);text-align:center">Nuevo álbum</div>
      <div class="grid-meta">Crear un álbum nuevo</div>
    </div>`;

    if (immichAlbums.length === 0) {
      grid.innerHTML = createCard;
      return;
    }
    grid.innerHTML = createCard + immichAlbums.map(a => {
      const thumb = a.albumThumbnailAssetId
        ? `${API_BASE}/immich/thumbnail/${a.albumThumbnailAssetId}`
        : null;
      const img = thumb
        ? `<img src="${thumb}" alt="" onerror="this.parentElement.innerHTML='<div class=\\'grid-art-placeholder\\' style=\\'background:var(--gradient-accent)\\'>📷</div>'">`
        : `<div class="grid-art-placeholder" style="background:var(--gradient-accent);font-size:40px">📷</div>`;
      const eid = encodeURIComponent(a.id);
      const ename = escapeHtml(a.albumName).replace(/'/g, "\\'");
      return `<div class="grid-item" data-album-id="${eid}" data-album-name="${ename}" data-album-count="${a.assetCount || 0}" onclick="loadImmichAlbum('${eid}')" style="cursor:pointer">
        <div class="grid-art">${img}</div>
        <div class="grid-title">${escapeHtml(a.albumName)}</div>
        <div class="grid-meta">${a.assetCount || 0} archivos</div>
      </div>`;
    }).join('');
    // Delegate contextmenu for album grid items
    grid.oncontextmenu = function(e) {
      const item = e.target.closest('.grid-item[data-album-id]');
      if (!item) return;
      e.preventDefault();
      e.stopPropagation();
      showAlbumContextMenu(
        e,
        item.dataset.albumId,
        (item.dataset.albumName || '').replace(/&#39;/g, "'"),
        parseInt(item.dataset.albumCount) || 0
      );
    };
  } else {
    const album = immichAlbums.find(a => immichView === `album-${a.id}`);
    document.getElementById('contentTitle').textContent = `📷 ${escapeHtml(album ? album.albumName : '')}`;
    setImmichActions(`
      <button class="play-all-btn" onclick="immichUploadToAlbum('${album ? album.id : ''}')" style="padding:12px 20px">📤 Subir video</button>
      <button class="play-all-btn" onclick="addAllImmichToQueue()" style="padding:12px 20px">⬇ Cola todo</button>
      <button class="add-all-btn" onclick="loadImmichAlbums()" style="padding:12px 20px">← Volver</button>
    `);
    if (immichAlbumAssets.length === 0) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🎬</div><div class="empty-state-text">No hay videos en este álbum</div>
        <button class="play-all-btn" onclick="immichUploadToAlbum('${album ? album.id : ''}')" style="margin-top:16px;display:inline-flex">📤 Subir video</button>
      </div>`;
      return;
    }
    // Sort controls
    const sortOptions = [
      ['default', 'Por defecto'],
      ['name', 'Nombre A→Z'],
      ['name_desc', 'Nombre Z→A'],
      ['date', 'Fecha más antigua'],
      ['date_desc', 'Fecha más reciente'],
    ];
    let sortHtml = '<div class="youtube-filters" style="padding:0 0 12px">';
    sortHtml += '<span class="youtube-filter-label">Ordenar:</span>';
    sortHtml += sortOptions.map(([val, label]) =>
      `<button class="sort-btn${immichSort === val ? ' active' : ''}" onclick="setImmichSort('${val}')">${label}</button>`
    ).join('');
    sortHtml += '</div>';
    // Insert sort controls before grid
    const listView = document.getElementById('listView');
    listView.style.display = 'none';
    const gridParent = grid.parentElement;
    const existingSort = document.getElementById('immichSortBar');
    if (existingSort) existingSort.remove();
    const sortBar = document.createElement('div');
    sortBar.id = 'immichSortBar';
    sortBar.innerHTML = sortHtml;
    gridParent.insertBefore(sortBar, grid);

    let sorted = [...immichAlbumAssets];
    if (immichSort === 'name') sorted.sort((a, b) => naturalCompare(a.originalFileName, b.originalFileName));
    else if (immichSort === 'name_desc') sorted.sort((a, b) => naturalCompare(b.originalFileName, a.originalFileName));
    else if (immichSort === 'date') sorted.sort((a, b) => (a.fileCreatedAt || a.createdAt || '').localeCompare(b.fileCreatedAt || b.createdAt || ''));
    else if (immichSort === 'date_desc') sorted.sort((a, b) => (b.fileCreatedAt || b.createdAt || '').localeCompare(a.fileCreatedAt || a.createdAt || ''));

    grid.innerHTML = sorted.map(a => {
      const dn = (a.originalFileName || a.id).replace(/\.[^/.]+$/, '');
      const thumb = `${API_BASE}/immich/thumbnail/${a.id}`;
      const encodedId = encodeURIComponent(a.id);
      return `<div class="grid-item" style="cursor:pointer" oncontextmenu="event.preventDefault();event.stopPropagation();showImmichContextMenu(event,'${encodedId}','${jsStr(dn)}')">
        <div class="grid-art">
          <img src="${thumb}" alt="" onerror="this.parentElement.innerHTML='<div class=\\'grid-art-placeholder\\' style=\\'background:var(--gradient-accent)\\'>🎬</div>'">
          <button class="grid-play-btn" onclick="event.stopPropagation(); playImmichTrack('${encodedId}', '${jsStr(dn)}')">▶</button>
        </div>
        <div class="grid-title">${escapeHtml(dn)}</div>
        <div class="grid-meta"><button class="track-action-btn" onclick="event.stopPropagation(); showImmichAddMenu(event, '${encodedId}', '${jsStr(dn)}')">+ Añadir</button></div>
      </div>`;
    }).join('');
  }
}

function naturalCompare(a, b) {
  const re = /(\d+)|(\D+)/g;
  const partsA = (a || '').match(re) || [];
  const partsB = (b || '').match(re) || [];
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const pa = partsA[i], pb = partsB[i];
    if (pa === undefined) return -1;
    if (pb === undefined) return 1;
    if (pa === pb) continue;
    const na = parseInt(pa, 10), nb = parseInt(pb, 10);
    if (!isNaN(na) && !isNaN(nb)) {
      if (na !== nb) return na - nb;
    } else {
      if (pa < pb) return -1;
      if (pa > pb) return 1;
    }
  }
  return 0;
}

function setImmichSort(sort) {
  immichSort = sort;
  renderImmichAlbumsView();
}

function showImmichAddMenu(event, encodedId, name) {
  event.preventDefault();
  hideAddMenu();
  const menu = document.createElement('div');
  menu.className = 'submenu show';
  menu.style.position = 'fixed';
  menu.style.left = Math.max(10, event.clientX - 200) + 'px';
  menu.style.top = Math.min(window.innerHeight - 100, event.clientY) + 'px';
  let html = '<div class="submenu-title">Añadir a playlist</div>';
  if (playlists.length === 0) {
    html += '<div class="submenu-item" style="color:var(--text-tertiary)">No hay playlists</div>';
  } else {
    playlists.forEach(p => {
      html += `<div class="submenu-item" onclick="addImmichToPlaylist(${p.id}, '${encodedId}', '${jsStr(name)}'); hideAddMenu();">${escapeHtml(p.name)}</div>`;
    });
  }
  menu.innerHTML = html;
  document.body.appendChild(menu);
  activeSubmenu = menu;
  setTimeout(() => document.addEventListener('click', hideAddMenu, { once: true }), 10);
}

async function addImmichToPlaylist(playlistId, encodedId, originalName) {
  const assetId = decodeURIComponent(encodedId);
  try {
    await fetch(`${API_BASE}/playlists/${playlistId}/songs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'immich', assetId, originalName }),
    });
    await loadPlaylists();
    if (currentPlaylistId === playlistId) renderContent();
  } catch (e) { console.error(e); }
}

function playImmichTrack(encodedId, name) {
  const track = {
    type: 'immich',
    assetId: decodeURIComponent(encodedId),
    name: name + '.mp4',
    path: `immich:${decodeURIComponent(encodedId)}`,
  };
  // Set up queue from visible assets respecting current sort
  let sorted = [...immichAlbumAssets];
  if (immichSort === 'name') sorted.sort((a, b) => naturalCompare(a.originalFileName, b.originalFileName));
  else if (immichSort === 'name_desc') sorted.sort((a, b) => naturalCompare(b.originalFileName, a.originalFileName));
  else if (immichSort === 'date') sorted.sort((a, b) => (a.fileCreatedAt || a.createdAt || '').localeCompare(b.fileCreatedAt || b.createdAt || ''));
  else if (immichSort === 'date_desc') sorted.sort((a, b) => (b.fileCreatedAt || b.createdAt || '').localeCompare(a.fileCreatedAt || b.createdAt || ''));
  const idx = sorted.findIndex(a => a.id === decodeURIComponent(encodedId));
  if (idx !== -1) {
    let rest = sorted.filter((_, i) => i !== idx);
    if (isShuffle) shuffleArray(rest);
    playQueue = rest.map(a => ({
      path: `immich:${a.id}`,
      track: {
        type: 'immich',
        assetId: a.id,
        name: (a.originalFileName || a.id).replace(/\.[^/.]+$/, ''),
        path: `immich:${a.id}`,
      }
    }));
  }
  updateQueueBadge();
  if (isQueueOpen()) renderQueueContent();
  playTrackDirect(track);
}

function addImmichToQueue(encodedId, name) {
  const assetId = decodeURIComponent(encodedId);
  const path = `immich:${assetId}`;
  if (playQueue.some(q => q.path === path)) return;
  playQueue.push({ path, track: { type: 'immich', assetId, name: name + '.mp4', path } });
  updateQueueBadge();
  if (isQueueOpen()) renderQueueContent();
}

function addAllImmichToQueue() {
  let sorted = [...immichAlbumAssets];
  if (immichSort === 'name') sorted.sort((a, b) => naturalCompare(a.originalFileName, b.originalFileName));
  else if (immichSort === 'name_desc') sorted.sort((a, b) => naturalCompare(b.originalFileName, a.originalFileName));
  else if (immichSort === 'date') sorted.sort((a, b) => (a.fileCreatedAt || a.createdAt || '').localeCompare(b.fileCreatedAt || b.createdAt || ''));
  else if (immichSort === 'date_desc') sorted.sort((a, b) => (b.fileCreatedAt || b.createdAt || '').localeCompare(a.fileCreatedAt || a.createdAt || ''));
  let startIdx = 0;
  if (nowPlayingImmichId) {
    const playingIdx = sorted.findIndex(a => a.id === nowPlayingImmichId);
    if (playingIdx !== -1) startIdx = playingIdx + 1;
  }
  playQueue = [];
  for (let i = startIdx; i < sorted.length; i++) {
    const a = sorted[i];
    const name = (a.originalFileName || a.id).replace(/\.[^/.]+$/, '');
    const path = `immich:${a.id}`;
    playQueue.push({ path, track: { type: 'immich', assetId: a.id, name: name + '.mp4', path } });
  }
  updateQueueBadge();
  if (isQueueOpen()) renderQueueContent();
  if (playQueue.length > 0) {
    const orderLabel = immichSort === 'name' ? 'A→Z' : immichSort === 'name_desc' ? 'Z→A' : immichSort === 'date' ? 'más antigua' : immichSort === 'date_desc' ? 'más reciente' : 'por defecto';
    showToast(`⬇ ${playQueue.length} video(s) en cola (${orderLabel})`);
  } else {
    showToast('✅ No hay más videos después del actual');
  }
}

function showToast(msg, duration) {
  duration = duration || 2000;
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('toast-out');
    el.addEventListener('animationend', () => el.remove());
  }, duration);
}

function handleMediaError(mediaEl, filename) {
  const err = mediaEl.error;
  const ext = filename ? filename.replace(/^.*(\.\w+)$/, '$1').toLowerCase() : '';
  if (err && err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
    showToast(`Formato no soportado por el navegador: ${ext || 'desconocido'}`, 4000);
    document.getElementById('nowPlayingTitle').textContent = `Formato no soportado: ${ext}`;
  } else {
    showToast('Error al reproducir', 3000);
    document.getElementById('nowPlayingTitle').textContent = 'Error al reproducir';
  }
}

function showImmichContextMenu(event, encodedId, name) {
  event.preventDefault();
  event.stopPropagation();
  hideTrackContextMenu();

  const assetId = decodeURIComponent(encodedId);
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = Math.min(event.clientX, window.innerWidth - 220) + 'px';
  menu.style.top = Math.min(event.clientY, window.innerHeight - 180) + 'px';
  menu.style.position = 'fixed';

  let html = `<div class="context-menu-title">${escapeHtml(name)}</div>`;
  html += `<div class="context-menu-item" onclick="hideTrackContextMenu(); playImmichTrack('${encodedId}', '${jsStr(name)}')">▶ Reproducir</div>`;
  html += `<div class="context-menu-item" onclick="hideTrackContextMenu(); addImmichToQueue('${encodedId}', '${jsStr(name)}')">⬇ Agregar a la cola</div>`;
  html += `<div class="context-menu-item" onclick="hideTrackContextMenu(); showImmichAddMenu(event, '${encodedId}', '${jsStr(name)}')">+ Añadir a playlist</div>`;
  html += `<div class="context-menu-divider"></div>`;
  html += `<div class="context-menu-item" onclick="hideTrackContextMenu(); renameImmichAsset('${encodedId}', '${jsStr(name)}')">✏ Renombrar</div>`;
  html += `<div class="context-menu-item" onclick="hideTrackContextMenu(); showImmichProperties('${encodedId}', '${jsStr(name)}')">ℹ Propiedades</div>`;

  menu.innerHTML = html;
  document.body.appendChild(menu);
  activeContextMenu = menu;

  setTimeout(() => {
    document.addEventListener('click', hideTrackContextMenu, { once: true });
    document.addEventListener('contextmenu', hideTrackContextMenu, { once: true });
  }, 10);
}

async function renameImmichAsset(encodedId, currentName) {
  const assetId = decodeURIComponent(encodedId);
  const newName = prompt('Nuevo nombre para el video:', currentName);
  if (!newName || newName.trim() === currentName) return;
  try {
    const res = await fetch(`${API_BASE}/immich/assets/${assetId}/rename`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() })
    });
    const data = await res.json();
    if (data.error) { alert(data.error); return; }
    if (immichView && immichView.startsWith('album-')) {
      const albumId = immichView.replace('album-', '');
      await loadImmichAlbum(encodeURIComponent(albumId));
    } else {
      renderImmichAlbumsView();
    }
  } catch (e) { console.error(e); alert('Error al renombrar'); }
}

function showImmichProperties(encodedId, name) {
  const assetId = decodeURIComponent(encodedId);
  const asset = immichAlbumAssets.find(a => a.id === assetId)
    || immichAllAssets.find(a => a.id === assetId);
  const dn = name || (asset ? (asset.originalFileName || asset.id) : assetId);
  const rows = [
    { label: 'Nombre', value: dn },
    { label: 'Asset ID', value: assetId },
    { label: 'Tipo', value: 'Immich (video)' },
  ];
  if (asset) {
    if (asset.type) rows.push({ label: 'Formato', value: asset.type });
    if (asset.exifInfo && asset.exifInfo.fileSizeInByte) rows.push({ label: 'Tamaño', value: formatSize(asset.exifInfo.fileSizeInByte) });
  }
  document.getElementById('propertiesContent').innerHTML = rows.map(r =>
    `<div class="properties-row"><span class="properties-label">${escapeHtml(r.label)}</span><span class="properties-value">${escapeHtml(r.value)}</span></div>`
  ).join('');
  document.getElementById('propertiesModal').style.display = 'flex';
}

/* ==================== ALBUM CONTEXT MENU ==================== */

function showAlbumContextMenu(event, encodedId, name, assetCount) {
  event.preventDefault();
  event.stopPropagation();
  hideTrackContextMenu();

  const albumId = decodeURIComponent(encodedId);
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = Math.min(event.clientX, window.innerWidth - 220) + 'px';
  menu.style.top = Math.min(event.clientY, window.innerHeight - 180) + 'px';
  menu.style.position = 'fixed';

  let html = `<div class="context-menu-title">${escapeHtml(name)}</div>`;
  html += `<div class="context-menu-item" onclick="hideTrackContextMenu(); loadImmichAlbum('${encodedId}')">📂 Abrir álbum</div>`;
  html += `<div class="context-menu-item" onclick="hideTrackContextMenu(); renameImmichAlbum('${encodedId}', '${jsStr(name)}')">✏ Renombrar</div>`;
  html += `<div class="context-menu-item" onclick="hideTrackContextMenu(); showAlbumProperties('${encodedId}', '${jsStr(name)}', ${assetCount})">ℹ Propiedades</div>`;
  html += `<div class="context-menu-divider"></div>`;
  html += `<div class="context-menu-item" onclick="hideTrackContextMenu(); deleteImmichAlbum('${encodedId}', '${jsStr(name)}')" style="color:var(--accent-rose)">✕ Eliminar álbum</div>`;

  menu.innerHTML = html;
  document.body.appendChild(menu);
  activeContextMenu = menu;

  setTimeout(() => {
    document.addEventListener('click', hideTrackContextMenu, { once: true });
    document.addEventListener('contextmenu', hideTrackContextMenu, { once: true });
  }, 10);
}

function showAlbumProperties(encodedId, name, assetCount) {
  const albumId = decodeURIComponent(encodedId);
  const album = immichAlbums.find(a => a.id === albumId);
  const rows = [
    { label: 'Nombre', value: name },
    { label: 'ID', value: albumId },
    { label: 'Archivos', value: String(assetCount) },
  ];
  if (album) {
    if (album.createdAt) rows.push({ label: 'Creado', value: new Date(album.createdAt).toLocaleDateString() });
    if (album.updatedAt) rows.push({ label: 'Actualizado', value: new Date(album.updatedAt).toLocaleDateString() });
  }
  document.getElementById('propertiesContent').innerHTML = rows.map(r =>
    `<div class="properties-row"><span class="properties-label">${escapeHtml(r.label)}</span><span class="properties-value">${escapeHtml(r.value)}</span></div>`
  ).join('');
  document.getElementById('propertiesModal').style.display = 'flex';
}

async function deleteImmichAlbum(encodedId, name) {
  const albumId = decodeURIComponent(encodedId);
  if (!confirm(`¿Eliminar el álbum "${name}"?`)) return;
  try {
    const res = await fetch(`${API_BASE}/immich/albums/${albumId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.error) { alert(data.error); return; }
    await loadImmichAlbums();
  } catch (e) { console.error(e); alert('Error al eliminar el álbum'); }
}

async function renameImmichAlbum(encodedId, currentName) {
  const albumId = decodeURIComponent(encodedId);
  const newName = prompt('Nuevo nombre para el álbum:', currentName);
  if (!newName || newName.trim() === currentName) return;
  try {
    const res = await fetch(`${API_BASE}/immich/albums/${albumId}/rename`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() })
    });
    const data = await res.json();
    if (data.error) { alert(data.error); return; }
    await loadImmichAlbums();
  } catch (e) { console.error(e); alert('Error al renombrar el álbum'); }
}

/* ==================== IMMICH CONFIG ==================== */
function showImmichConfig() {
  document.getElementById('immichConfigModal').style.display = 'flex';
  document.getElementById('immichUrlInput').value = immichConfig.url || '';
  document.getElementById('immichKeyInput').value = '';
  document.getElementById('immichConfigStatus').textContent = '';
  document.getElementById('immichDisconnectBtn').style.display = immichConfig.connected ? '' : 'none';
  document.getElementById('immichConfigSaveBtn').textContent = immichConfig.connected ? 'Actualizar' : 'Conectar';
  if (immichConfig.url) document.getElementById('immichKeyInput').focus();
  else document.getElementById('immichUrlInput').focus();
}

function hideImmichConfig() {
  document.getElementById('immichConfigModal').style.display = 'none';
}

async function confirmImmichConfig() {
  const url = document.getElementById('immichUrlInput').value.trim();
  const apiKey = document.getElementById('immichKeyInput').value.trim();
  if (!url || !apiKey) { document.getElementById('immichConfigStatus').textContent = 'Completa ambos campos'; return; }
  const btn = document.getElementById('immichConfigSaveBtn');
  const status = document.getElementById('immichConfigStatus');
  btn.disabled = true;
  btn.textContent = 'Conectando...';
  status.textContent = '';
  try {
    const res = await fetch(`${API_BASE}/immich/config`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, apiKey }),
    });
    const data = await res.json();
    if (data.error) {
      status.textContent = data.error;
      btn.disabled = false;
      btn.textContent = 'Conectar';
      return;
    }
    immichConfig = { url: data.url, connected: true };
    hideImmichConfig();
    renderImmichSidebar();
    loadImmichAlbums();
  } catch (e) {
    status.textContent = 'Error de conexión';
    btn.disabled = false;
    btn.textContent = 'Conectar';
  }
}

async function disconnectImmich() {
  immichConfig = { url: '', connected: false };
  immichAlbums = [];
  immichAlbumAssets = [];
  immichView = null;
  await fetch(`${API_BASE}/config`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ immich_url: '', immich_api_key: '' }),
  });
  hideImmichConfig();
  renderImmichSidebar();
  if (immichView) { immichView = null; renderContent(); }
  renderContent();
}

/* ==================== IMMICH UPLOAD QUEUE TRAY ==================== */
let queueTrayPollingInterval = null;

function toggleQueueTray() {
  const tray = document.getElementById('queueTray');
  const visible = tray.style.display !== 'none';
  if (visible) {
    tray.style.display = 'none';
    if (queueTrayPollingInterval) {
      clearInterval(queueTrayPollingInterval);
      queueTrayPollingInterval = null;
    }
  } else {
    tray.style.display = '';
    pollQueue();
    if (!queueTrayPollingInterval) {
      queueTrayPollingInterval = setInterval(pollQueue, 3000);
    }
  }
}

async function pollQueue() {
  try {
    const res = await fetch(`${API_BASE}/immich/queue`);
    const jobs = await res.json();
    renderQueueTray(jobs);
    const activeJobs = jobs.filter(j => j.status === 'pending' || j.status === 'compressing' || j.status === 'uploading');
    const toggle = document.getElementById('queueTrayToggle');
    if (jobs.length > 0) {
      toggle.style.display = '';
      document.getElementById('queueTrayBadge').textContent = activeJobs.length || jobs.length;
      document.getElementById('queueTrayCount').textContent = jobs.length;
    } else {
      toggle.style.display = 'none';
      document.getElementById('queueTray').style.display = 'none';
      if (queueTrayPollingInterval) {
        clearInterval(queueTrayPollingInterval);
        queueTrayPollingInterval = null;
      }
    }
  } catch (e) {
    console.error('Error polling queue:', e);
  }
}

function renderQueueTray(jobs) {
  const list = document.getElementById('queueTrayList');
  if (jobs.length === 0) {
    list.innerHTML = '<div class="queue-tray-empty">No hay archivos en la cola</div>';
    return;
  }
  const statusIcons = {
    pending: '⏳',
    compressing: '📦',
    uploading: '⬆',
    done: '✅',
    error: '❌',
    cancelled: '⏹',
  };
  const statusLabels = {
    pending: 'En cola',
    compressing: 'Comprimiendo',
    uploading: 'Subiendo',
    done: 'Completado',
    error: 'Error',
    cancelled: 'Cancelado',
  };
  list.innerHTML = jobs.map(j => {
    const icon = statusIcons[j.status] || '⏳';
    const label = statusLabels[j.status] || j.status;
    const cancelable = j.status === 'pending' || j.status === 'compressing';
    const sizeInfo = j.originalSize ? ` (${formatBytes(j.originalSize)})` : '';
    const errorInfo = j.error ? `<div class="queue-tray-item-status" style="color:var(--accent-rose);font-size:11px">${escapeHtml(j.error)}</div>` : '';
    return `<div class="queue-tray-item">
      <div class="queue-tray-status ${j.status}">${icon}</div>
      <div class="queue-tray-item-info">
        <div class="queue-tray-item-name">${escapeHtml(j.filename)}${sizeInfo}</div>
        <div class="queue-tray-item-status">${label}</div>
        ${errorInfo}
      </div>
      ${cancelable ? `<button class="queue-tray-item-cancel" onclick="cancelQueueJob('${j.id}')" title="Cancelar">✕</button>` : ''}
    </div>`;
  }).join('');
}

async function cancelQueueJob(id) {
  try {
    const res = await fetch(`${API_BASE}/immich/queue/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.error) { console.error(data.error); return; }
    pollQueue();
  } catch (e) {
    console.error('Error cancelling job:', e);
  }
}

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let s = bytes;
  while (s >= 1024 && i < units.length - 1) { s /= 1024; i++; }
  return s.toFixed(1) + ' ' + units[i];
}

/* ==================== IMMICH CREATE & UPLOAD ==================== */

function showImmichCreateAlbum() {
  document.getElementById('immichAlbumNameInput').value = '';
  document.getElementById('immichCreateAlbumStatus').textContent = '';
  document.getElementById('immichCreateAlbumModal').style.display = 'flex';
  document.getElementById('immichAlbumNameInput').focus();
}

function hideImmichCreateAlbum() {
  document.getElementById('immichCreateAlbumModal').style.display = 'none';
}

async function confirmImmichCreateAlbum() {
  const name = document.getElementById('immichAlbumNameInput').value.trim();
  const status = document.getElementById('immichCreateAlbumStatus');
  if (!name) { status.textContent = 'Ingresá un nombre'; return; }
  status.textContent = 'Creando...';
  try {
    const res = await fetch(`${API_BASE}/immich/albums`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ albumName: name }),
    });
    const data = await res.json();
    if (data.error) { status.textContent = data.error; return; }
    hideImmichCreateAlbum();
    // Navigate into the new album so user can upload immediately
    await loadImmichAlbum(encodeURIComponent(data.id));
  } catch (e) { status.textContent = 'Error de conexión'; }
}

function immichUploadToAlbum(albumId) {
  // store target album id so onImmichFileSelected uses it
  window._immichUploadAlbumId = albumId;
  document.getElementById('immichFileInput').click();
}

function onImmichFileSelected(event) {
  const file = event.target.files[0];
  if (!file) return;
  const albumId = window._immichUploadAlbumId || '';
  window._immichUploadAlbumId = null;
  startImmichUpload(file, albumId);
  event.target.value = '';
}

async function startImmichUpload(file, albumId) {
  const compressCheck = document.getElementById('compressCheck');
  const threshold = 10 * 1024 * 1024 * 1024;
  const useCompression = file.size > threshold && compressCheck.checked;

  const form = new FormData();
  form.append('file', file);
  if (albumId) form.append('albumId', albumId);
  if (useCompression) form.append('compress', 'true');

  try {
    const res = await fetch(`${API_BASE}/immich/queue`, {
      method: 'POST', body: form,
    });
    const data = await res.json();
    if (data.error) { alert(data.error); return; }
    showToast(`⬆ ${file.name} agregado a la cola`);
    const toggle = document.getElementById('queueTrayToggle');
    toggle.style.display = '';
    pollQueue();
    if (!queueTrayPollingInterval) {
      queueTrayPollingInterval = setInterval(pollQueue, 3000);
    }
  } catch (e) {
    console.error(e);
    alert('Error de conexión al subir');
  }
}

/* ==================== YOUTUBE ==================== */
async function showYouTubeSearch() {
  immichView = null;
  currentPlaylistId = null;
  currentFolder = null;
  removeLocalFilterBar();
  renderImmichSidebar();
  renderFolderList();
  renderSidebar();

  const title = document.getElementById('contentTitle');
  title.textContent = '▶ YouTube — Buscar';

  const addBtn = document.getElementById('addToPlaylistBtn');
  addBtn.style.display = 'none';

  document.getElementById('listView').style.display = '';
  document.getElementById('gridView').style.display = 'none';

  const trackList = document.getElementById('trackList');
  const authArea = invidiousLoggedIn
    ? `<span class="yt-user-badge">👤 ${escapeHtml(invidiousUsername)}</span>
       <button class="add-all-btn" onclick="loadYouTubeSubscriptions()" style="padding:8px 14px">📺 Feed</button>
       <button class="add-all-btn" onclick="loadYouTubeChannels()" style="padding:8px 14px">📋 Canales</button>
       <button class="add-all-btn" onclick="doInvidiousLogout()" style="padding:8px 14px">Cerrar sesión</button>`
    : `<button class="add-all-btn" onclick="showInvidiousLogin()" style="padding:8px 14px">🔑 Iniciar sesión</button>`;
  trackList.innerHTML = `<div class="youtube-topbar">${authArea}</div>
  <div class="youtube-search-bar">
    <input type="text" id="youtubeQuery" placeholder="Buscar en YouTube..." onkeypress="if(event.key==='Enter')doYouTubeSearch()">
    <button class="play-all-btn" onclick="doYouTubeSearch()" style="padding:12px 24px">🔍 Buscar</button>
    <button class="add-all-btn" onclick="loadYouTubeTrending()" style="padding:12px 20px">🔥 Tendencias</button>
  </div>
  <div class="youtube-filters">
    <span class="youtube-filter-label">Ordenar:</span>
    <select id="youtubeSort" class="youtube-filter-select" onchange="if(document.getElementById('youtubeQuery').value)doYouTubeSearch()">
      <option value="relevance">Relevancia</option>
      <option value="date">Más nuevos</option>
      <option value="views">Más vistos</option>
      <option value="rating">Mejor valorados</option>
    </select>
    <span class="youtube-filter-label">Fecha:</span>
    <select id="youtubeDate" class="youtube-filter-select" onchange="if(document.getElementById('youtubeQuery').value)doYouTubeSearch()">
      <option value="">Cualquier fecha</option>
      <option value="hour">Última hora</option>
      <option value="today">Hoy</option>
      <option value="week">Esta semana</option>
      <option value="month">Este mes</option>
      <option value="year">Este año</option>
    </select>
  </div>
  <div id="youtubeResults"></div>`;
  document.getElementById('youtubeQuery').focus();
}

async function doYouTubeSearch() {
  const q = document.getElementById('youtubeQuery').value.trim();
  if (!q) return;
  const sort = document.getElementById('youtubeSort').value;
  const date = document.getElementById('youtubeDate').value;
  const container = document.getElementById('youtubeResults');
  container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Buscando...</div></div>';
  try {
    let url = `${API_BASE}/invidious/search?q=${encodeURIComponent(q)}&sort=${sort}`;
    if (date) url += `&date=${date}`;
    const res = await fetch(url);
    if (!res.ok) { container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Error al buscar</div></div>'; return; }
    const data = await res.json();
    youtubeResults = dedupeYouTube(data.filter(r => (r.type === 'video' || r.type === 'shortVideo' || r.videoId)));
    renderYouTubeResults(container);
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Error de conexión</div></div>';
  }
}

function renderYouTubeResults(container) {
  if (youtubeResults.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">▶</div><div class="empty-state-text">Sin resultados</div></div>';
    return;
  }
  container.innerHTML = youtubeResults.map((v, i) => {
    const dn = v.title || 'Sin título';
    const thumbUrl = `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`;
    const author = v.author || 'Desconocido';
    const duration = v.lengthSeconds ? formatTime(v.lengthSeconds) : '';
    const published = v.publishedText || (v.published ? new Date(v.published * 1000).toLocaleDateString() : '');
    const encodedId = encodeURIComponent(v.videoId);
    const ucid = v.authorId || '';
    const subBtn = invidiousLoggedIn && ucid
      ? `<button class="track-action-btn" onclick="event.stopPropagation(); subscribeToChannel('${ucid}','${jsStr(author)}',this)">🔔 Subscribir</button>`
      : '';
    const art = `<img src="${thumbUrl}" alt="" onerror="this.parentElement.innerHTML='<div class=\\'track-art-placeholder\\' style=\\'background:${getTrackColor(i)}\\'>▶</div>'">`;
    return `<div class="track-item" style="cursor:pointer" onclick="playYouTubeVideo('${encodedId}','${jsStr(dn)}')" oncontextmenu="event.preventDefault();event.stopPropagation();showYouTubeContextMenu(event,'${encodedId}','${jsStr(dn)}')">
      <span class="track-number">${i + 1}</span>
      <div class="track-art">${art}</div>
      <div class="track-info">
        <div class="track-title">${escapeHtml(dn)}</div>
        <div class="track-meta">${escapeHtml(author)}${duration ? ' · ' + duration : ''}${published ? ' · ' + escapeHtml(published) : ''}</div>
      </div>
      <div class="track-actions">
        ${subBtn}
        <button class="track-action-btn queue" onclick="event.stopPropagation(); addYouTubeToQueue('${encodedId}','${jsStr(dn)}')">⬇ Cola</button>
        <button class="track-action-btn" onclick="event.stopPropagation(); showYouTubeAddMenu(event,'${encodedId}','${jsStr(dn)}')">+ Añadir</button>
      </div>
    </div>`;
  }).join('');
}

async function loadYouTubeTrending() {
  const container = document.getElementById('youtubeResults');
  container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Cargando tendencias...</div></div>';
  try {
    const res = await fetch(`${API_BASE}/invidious/trending`);
    if (!res.ok) { container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Error al cargar</div></div>'; return; }
    const data = await res.json();
    youtubeResults = dedupeYouTube(data.filter(r => (r.type === 'video' || r.type === 'shortVideo' || r.videoId)));
    renderYouTubeResults(container);
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Error de conexión</div></div>';
  }
}

/* ── Invidious Auth ── */

async function checkInvidiousAuth() {
  try {
    const res = await fetch(`${API_BASE}/invidious/status`);
    const data = await res.json();
    invidiousLoggedIn = data.logged_in;
    invidiousUsername = data.username || '';
    renderImmichSidebar();
  } catch (_) {}
}

async function showInvidiousLogin() {
  const container = document.getElementById('youtubeResults');
  container.innerHTML = `<div class="invidious-login-form">
    <h3>Iniciar sesión en Invidious</h3>
    <p style="color:var(--text-tertiary);font-size:13px;margin-bottom:16px">Necesitás una cuenta en Invidious (creala en http://localhost:3000)</p>
    <input type="text" id="invidiousUserInput" placeholder="Usuario" onkeypress="if(event.key==='Enter')document.getElementById('invidiousPassInput').focus()">
    <input type="password" id="invidiousPassInput" placeholder="Contraseña" onkeypress="if(event.key==='Enter')doInvidiousLogin()">
    <div id="invidiousLoginStatus" style="font-size:13px;color:var(--accent-rose);margin-bottom:12px"></div>
    <div class="modal-buttons">
      <button class="modal-btn cancel" onclick="showYouTubeSearch()">Cancelar</button>
      <button class="modal-btn confirm" onclick="doInvidiousLogin()">Iniciar sesión</button>
    </div>
  </div>`;
}

async function doInvidiousLogin() {
  const username = document.getElementById('invidiousUserInput').value.trim();
  const password = document.getElementById('invidiousPassInput').value.trim();
  const status = document.getElementById('invidiousLoginStatus');
  if (!username || !password) { status.textContent = 'Completa ambos campos'; return; }
  status.textContent = 'Conectando...';
  try {
    const res = await fetch(`${API_BASE}/invidious/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (data.error) { status.textContent = data.error; return; }
    invidiousLoggedIn = true;
    invidiousUsername = username;
    renderImmichSidebar();
    showYouTubeSearch();
    loadYouTubeSubscriptions();
  } catch (_) { status.textContent = 'Error de conexión'; }
}

async function doInvidiousLogout() {
  await fetch(`${API_BASE}/invidious/logout`, { method: 'POST' });
  invidiousLoggedIn = false;
  invidiousUsername = '';
  renderImmichSidebar();
  showYouTubeSearch();
}

async function loadYouTubeSubscriptions() {
  const container = document.getElementById('youtubeResults');
  container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Cargando suscripciones...</div></div>';
  try {
    const res = await fetch(`${API_BASE}/invidious/feed?max_results=50`);
    if (!res.ok) {
      if (res.status === 401) { invidiousLoggedIn = false; renderImmichSidebar(); showInvidiousLogin(); return; }
      container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Error</div></div>'; return;
    }
    const data = await res.json();
    youtubeResults = dedupeYouTube(data.filter(r => (r.type === 'video' || r.type === 'shortVideo' || r.videoId)));
    renderYouTubeResults(container);
  } catch (e) { container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Error de conexión</div></div>'; }
}

async function loadYouTubeChannels() {
  const container = document.getElementById('youtubeResults');
  container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Cargando canales...</div></div>';
  try {
    const res = await fetch(`${API_BASE}/invidious/subscriptions`);
    if (!res.ok) {
      if (res.status === 401) { invidiousLoggedIn = false; renderImmichSidebar(); showInvidiousLogin(); return; }
      container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Error</div></div>'; return;
    }
    const channels = await res.json();
    if (!channels.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">Sin canales subscritos. Buscá un canal y presioná 🔔 Subscribir.</div></div>';
      return;
    }
    container.innerHTML = channels.map((c, i) => {
      const encodedUcid = encodeURIComponent(c.authorId);
      return `<div class="track-item" style="cursor:pointer" onclick="loadChannelVideos('${encodedUcid}','${escapeHtml(c.author).replace(/'/g, "\\'")}')">
        <span class="track-number">${i + 1}</span>
        <div class="track-art">
          <div class="track-art-placeholder" style="background:${getTrackColor(i)}">📺</div>
        </div>
        <div class="track-info">
          <div class="track-title">${escapeHtml(c.author)}</div>
          <div class="track-meta">${escapeHtml(c.authorId)}</div>
        </div>
        <div class="track-actions">
          <button class="track-action-btn remove" onclick="event.stopPropagation(); unsubscribeChannel('${encodedUcid}','${escapeHtml(c.author).replace(/'/g, "\\'")}',this)">✕</button>
        </div>
      </div>`;
    }).join('');
  } catch (e) { container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Error de conexión</div></div>'; }
}

let _channelViewUcid = null;

async function loadChannelVideos(encodedUcid, channelName) {
  const ucid = decodeURIComponent(encodedUcid);
  _channelViewUcid = ucid;
  const container = document.getElementById('youtubeResults');
  container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Cargando videos...</div></div>';
  try {
    const res = await fetch(`${API_BASE}/invidious/channel/${ucid}`);
    if (!res.ok) { container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Error</div></div>'; return; }
    const data = await res.json();
    const videos = Array.isArray(data) ? data : (data.videos || []);
    youtubeResults = dedupeYouTube(videos.filter(r => (r.type === 'video' || r.type === 'shortVideo' || r.videoId)));
    const title = document.getElementById('contentTitle');
    title.textContent = `📺 ${escapeHtml(channelName || 'Canal')}`;
    renderYouTubeResults(container);
  } catch (e) { container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Error de conexión</div></div>'; }
}

async function unsubscribeChannel(encodedUcid, channelName, btnEl) {
  const ucid = decodeURIComponent(encodedUcid);
  if (btnEl) btnEl.textContent = '⋯';
  try {
    const res = await fetch(`${API_BASE}/invidious/unsubscribe`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ucid }),
    });
    if (res.status === 401) { invidiousLoggedIn = false; renderImmichSidebar(); showInvidiousLogin(); return; }
    loadYouTubeChannels();
  } catch (_) { if (btnEl) btnEl.textContent = '✕ Subscripción'; }
}

let subscribingChannels = new Set();

async function subscribeToChannel(ucid, channelName, btnEl) {
  if (subscribingChannels.has(ucid)) return;
  subscribingChannels.add(ucid);
  if (btnEl) btnEl.textContent = '⋯';

  try {
    const res = await fetch(`${API_BASE}/invidious/subscribe`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ucid }),
    });
    if (res.status === 401) {
      invidiousLoggedIn = false;
      renderImmichSidebar();
      showInvidiousLogin();
      subscribingChannels.delete(ucid);
      return;
    }
    await res.text();
    if (btnEl) btnEl.textContent = '✅';
    setTimeout(() => { if (btnEl) btnEl.textContent = '🔔 Subscrito'; }, 1500);
  } catch (_) {
    if (btnEl) btnEl.textContent = '🔔 Subscribir';
  }
  subscribingChannels.delete(ucid);
}

/* YouTube Playback (iframe) */
let invidiousEmbedHost = null;

function getInvidiousEmbedHost() {
  if (invidiousEmbedHost) return invidiousEmbedHost;
  const port = window.location.port === '5000' ? '3000' : '3000';
  invidiousEmbedHost = `${window.location.protocol}//${window.location.hostname}:${port}`;
  return invidiousEmbedHost;
}

function playYouTubeVideo(encodedId, title) {
  const videoId = decodeURIComponent(encodedId);
  closeYouTubePlayer();

  fetch(`${API_BASE}/invidious/video/${videoId}`).then(r => r.json()).then(data => {
    if (data.liveNow) {
      window.open(`${getInvidiousEmbedHost()}/watch?v=${videoId}`, '_blank');
      return;
    }
    const stream = (data.formatStreams && data.formatStreams[0]);
    if (stream && stream.url) {
      playYouTubeDirect(videoId, stream.url, title);
    } else {
      showYouTubeIframe(videoId, title);
    }
  }).catch(() => {
    showYouTubeIframe(videoId, title);
  });
}

function showYouTubeIframe(videoId, title) {
  const overlay = document.createElement('div');
  overlay.className = 'youtube-overlay';
  overlay.id = 'youtubeOverlay';
  overlay.onclick = (e) => { if (e.target === overlay) closeYouTubePlayer(); };
  const container = document.createElement('div');
  container.className = 'youtube-player-container';
  container.innerHTML = `
    <div class="youtube-header">
      <span class="youtube-title">${escapeHtml(title)}</span>
      <button class="youtube-close-btn" onclick="closeYouTubePlayer()">✕</button>
    </div>
    <iframe class="youtube-iframe" src="${getInvidiousEmbedHost()}/embed/${videoId}" allowfullscreen></iframe>
  `;
  overlay.appendChild(container);
  document.body.appendChild(overlay);
  // PR3: keep the queue "current card" in sync with YouTube playback.
  recordTrackSwitch({ type: 'youtube', videoId, name: title });
  youtubePlaying = { videoId, title };
}

function playYouTubeDirect(videoId, streamUrl, title) {
  stopPlayback();
  // PR3: keep the queue "current card" in sync with YouTube playback.
  recordTrackSwitch({ type: 'youtube', videoId, name: title });
  nowPlayingImmichId = null;
  isVideo = true;
  const player = document.getElementById('playerContainer');
  const nowPlaying = document.getElementById('nowPlayingSection');
  const progressSection = document.getElementById('progressSection');
  const fsBtn = document.getElementById('fullscreenBtn');
  progressSection.style.display = '';
  player.innerHTML = `<div id="videoWrapper" class="video-wrapper">
    <video id="videoPlayer" class="video-player" controls autoplay></video>
  </div>`;
  video = document.getElementById('videoPlayer');
  video.src = streamUrl;
  video.load();
  nowPlaying.style.display = 'none';
  player.style.display = 'block';
  fsBtn.style.display = 'inline-block';
  video.onerror = () => { showYouTubeIframe(videoId, title); };
  video.ontimeupdate = () => { onTimeUpdate(video); };
  video.onplay = () => { updatePlayPauseBtn(true); };
  video.onpause = () => { updatePlayPauseBtn(false); };
  video.onended = () => { playNextInSequence(); };
  document.getElementById('nowPlayingTitle').textContent = cleanName(title);
  document.getElementById('nowPlayingArtist').textContent = 'YouTube';
}

function closeYouTubePlayer() {
  const overlay = document.getElementById('youtubeOverlay');
  if (overlay) overlay.remove();
  youtubePlaying = null;
}

function addYouTubeToQueue(encodedId, title) {
  const videoId = decodeURIComponent(encodedId);
  const path = `youtube:${videoId}`;
  if (playQueue.some(q => q.path === path)) return;
  playQueue.push({ path, track: { type: 'youtube', videoId, name: title, path } });
  updateQueueBadge();
  if (isQueueOpen()) renderQueueContent();
}

/* YouTube Context Menu */
function showYouTubeContextMenu(event, encodedId, title) {
  event.preventDefault();
  event.stopPropagation();
  hideTrackContextMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = Math.min(event.clientX, window.innerWidth - 220) + 'px';
  menu.style.top = Math.min(event.clientY, window.innerHeight - 180) + 'px';
  menu.style.position = 'fixed';
  let html = `<div class="context-menu-title">${escapeHtml(title)}</div>`;
  html += `<div class="context-menu-item" onclick="hideTrackContextMenu(); playYouTubeVideo('${encodedId}','${jsStr(title)}')">▶ Reproducir</div>`;
  html += `<div class="context-menu-item" onclick="hideTrackContextMenu(); addYouTubeToQueue('${encodedId}','${jsStr(title)}')">⬇ Agregar a la cola</div>`;
  html += `<div class="context-menu-item" onclick="hideTrackContextMenu(); showYouTubeAddMenu(event,'${encodedId}','${jsStr(title)}')">+ Añadir a playlist</div>`;
  html += `<div class="context-menu-divider"></div>`;
  html += `<div class="context-menu-item" onclick="hideTrackContextMenu(); showYouTubeProperties('${encodedId}','${jsStr(title)}')">ℹ Propiedades</div>`;
  menu.innerHTML = html;
  document.body.appendChild(menu);
  activeContextMenu = menu;
  setTimeout(() => {
    document.addEventListener('click', hideTrackContextMenu, { once: true });
    document.addEventListener('contextmenu', hideTrackContextMenu, { once: true });
  }, 10);
}

function showYouTubeProperties(encodedId, title) {
  const videoId = decodeURIComponent(encodedId);
  const rows = [
    { label: 'Título', value: title },
    { label: 'Video ID', value: videoId },
    { label: 'Tipo', value: 'YouTube' },
    { label: 'URL', value: `https://youtube.com/watch?v=${videoId}` },
  ];
  document.getElementById('propertiesContent').innerHTML = rows.map(r =>
    `<div class="properties-row"><span class="properties-label">${escapeHtml(r.label)}</span><span class="properties-value">${escapeHtml(r.value)}</span></div>`
  ).join('');
  document.getElementById('propertiesModal').style.display = 'flex';
}

/* YouTube Add to Playlist */
function showYouTubeAddMenu(event, encodedId, title) {
  event.preventDefault();
  hideAddMenu();
  const menu = document.createElement('div');
  menu.className = 'submenu show';
  menu.style.position = 'fixed';
  menu.style.left = Math.max(10, event.clientX - 200) + 'px';
  menu.style.top = Math.min(window.innerHeight - 100, event.clientY) + 'px';
  let html = '<div class="submenu-title">Añadir a playlist</div>';
  if (playlists.length === 0) {
    html += '<div class="submenu-item" style="color:var(--text-tertiary)">No hay playlists</div>';
  } else {
    playlists.forEach(p => {
      html += `<div class="submenu-item" onclick="addYouTubeToPlaylist(${p.id},'${encodedId}','${jsStr(title)}'); hideAddMenu();">${escapeHtml(p.name)}</div>`;
    });
  }
  menu.innerHTML = html;
  document.body.appendChild(menu);
  activeSubmenu = menu;
  setTimeout(() => document.addEventListener('click', hideAddMenu, { once: true }), 10);
}

async function addYouTubeToPlaylist(playlistId, encodedId, title) {
  const videoId = decodeURIComponent(encodedId);
  try {
    await fetch(`${API_BASE}/playlists/${playlistId}/songs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'youtube', videoId, originalName: title }),
    });
    await loadPlaylists();
    if (currentPlaylistId === playlistId) renderContent();
  } catch (e) { console.error(e); }
}

function renderFolderList() {
  const container = document.getElementById('folderList');
  const allActive = !currentFolder ? ' active' : '';
  let html = `<div class="folder-item${allActive}" onclick="goHome()">
    <div class="folder-icon">🎵</div>
    <div class="folder-info"><div class="folder-name">Toda la música</div></div>
  </div>`;
  allFolders.forEach(f => {
    const active = currentFolder === f.path ? ' active' : '';
    html += `<div class="folder-item${active}" data-folder="${escapeHtml(f.path)}" onclick="selectFolder(this.dataset.folder)">
      <div class="folder-icon">📁</div>
      <div class="folder-info"><div class="folder-name">${escapeHtml(f.name)}</div></div>
    </div>`;
  });
  html += `<div class="folder-item add-folder" onclick="showFolderModal()">
    <div class="folder-icon" style="background:var(--gradient-accent);color:white;">+</div>
    <div class="folder-info"><div class="folder-name" style="color:var(--accent-primary)">Agregar carpeta</div></div>
  </div>`;

  // Show registered dirs with remove buttons
  if (musicDirs.length > 0) {
    html += `<div class="sidebar-divider"></div>`;
    musicDirs.forEach((d, i) => {
      const short = d.path.split('/').filter(Boolean).pop() || d.path;
      html += `<div class="dir-info-item">
        <div class="dir-info-path" title="${escapeHtml(d.path)}">${escapeHtml(short)}</div>
        ${musicDirs.length > 1 ? `<button class="dir-remove-btn" onclick="removeDir(${i})" title="Eliminar">✕</button>` : ''}
      </div>`;
    });
  }

  container.innerHTML = html;
}

async function removeDir(idx) {
  const dirs = musicDirs.filter((_, i) => i !== idx);
  if (dirs.length === 0) return;
  const res = await fetch(`${API_BASE}/config`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ music_dirs: dirs }),
  });
  const data = await res.json();
  if (data.error) { alert(data.error); return; }
  currentFolder = null;
  currentPlaylistId = null;
  loadFiles();
  loadFolders();
  renderSidebar();
}

function selectFolder(path) {
  immichView = null;
  closeYouTubePlayer();
  currentFolder = path;
  currentPlaylistId = null;
  renderFolderList();
  renderImmichSidebar();
  renderSidebar();
  renderContent();
}

function goHome() {
  currentFolder = null;
  currentPlaylistId = null;
  immichView = null;
  closeYouTubePlayer();
  renderFolderList();
  renderImmichSidebar();
  renderSidebar();
  renderContent();
}

function showAllFolders() {
  goHome();
}

function renderContent() {
  if (immichView) { removeLocalFilterBar(); renderImmichAlbumsView(); return; }
  // Clean up Immich actions when leaving Immich view
  const immichActions = document.getElementById('immichActions');
  if (immichActions) immichActions.remove();
  renderTrackList();
  renderGridView();
  let title = 'Todas las canciones';
  if (currentFolder) title = `📁 ${currentFolder}`;
  else if (currentPlaylistId) title = getPlaylistName(currentPlaylistId);
  document.getElementById('contentTitle').textContent = title;
  const visible = getVisibleTracks();
  const addBtn = document.getElementById('addToPlaylistBtn');
  if (addBtn) addBtn.style.display = visible.length > 0 ? '' : 'none';

  // Back button for folder view
  renderBackButton(currentFolder ? () => goHome() : null);

  if (currentPlaylistId) removeLocalFilterBar();
  else renderLocalFilterBar();
}

function renderBackButton(onclick) {
  const existing = document.getElementById('backBtn');
  if (existing) existing.remove();
  if (!onclick) return;
  const contentTitle = document.getElementById('contentTitle');
  const backBtn = document.createElement('button');
  backBtn.id = 'backBtn';
  backBtn.className = 'back-btn';
  backBtn.textContent = '←';
  backBtn.title = 'Volver';
  backBtn.onclick = onclick;
  contentTitle.parentElement.prepend(backBtn);
}

function renderTrackList() {
  const container = document.getElementById('trackList');
  const list = getVisibleTracks();
  if (list.length === 0) {
    if (currentPlaylistId) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <div class="empty-state-text">Playlist vacía</div>
        <button class="play-all-btn" onclick="showImmichAssetPicker()" style="margin-top:16px;display:inline-flex">📷 Agregar desde Immich</button>
      </div>`;
    } else {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🎵</div><div class="empty-state-text">No hay canciones</div></div>`;
    }
    return;
  }
  container.innerHTML = list.map((track, i) => {
    const sp = encodeURIComponent(track.path);
    const dn = cleanName(track.name);
    const isImmich = track.type === 'immich';
    const isYouTube = track.type === 'youtube';
    const cu = isImmich ? `${API_BASE}/immich/thumbnail/${track.assetId}`
      : isYouTube ? `https://i.ytimg.com/vi/${track.videoId}/mqdefault.jpg`
      : getCoverUrl(track);
    const icon = (isImmich || isYouTube || track.type === 'video') ? '🎬' : '♪';
    const art = cu
      ? `<img src="${cu}" alt="${escapeHtml(dn)}" onerror="this.parentElement.innerHTML='<div class=\\'track-art-placeholder\\' style=\\'background: ${getTrackColor(i)}\\'>${icon}</div>'">`
      : `<div class="track-art-placeholder" style="background: ${getTrackColor(i)};">${icon}</div>`;
    let metaText;
    if (isYouTube) metaText = (track.author || 'YouTube');
    else if (isImmich) metaText = track.path;
    else {
      const dateStr = track.mtime ? new Date(track.mtime * 1000).toLocaleDateString() : '';
      metaText = dateStr ? `${track.path} · ${dateStr}` : track.path;
    }
    const actions = renderTrackActions(sp, track);
    return `
    <div class="track-item" data-path="${sp}" data-idx="${i}" onclick="playTrack('${jsStr(sp)}')" oncontextmenu="event.preventDefault();event.stopPropagation();showTrackContextMenu(event,'${jsStr(sp)}')">
      <span class="track-number">${i + 1}</span>
      <div class="track-art">${art}</div>
      <div class="track-info">
        <div class="track-title">${escapeHtml(dn)}${isImmich || isYouTube || track.type === 'video' ? ' <span style="font-size:11px;color:var(--accent-pink);font-weight:400">🎬</span>' : ''}</div>
        <div class="track-meta">${escapeHtml(metaText)}</div>
      </div>
      <div class="track-actions">${actions}</div>
    </div>`;
  }).join('');
}

function renderTrackActions(sp, track) {
  const isImmich = track.type === 'immich';
  const isYouTube = track.type === 'youtube';
  const queueBtn = `<button class="track-action-btn queue" onclick="event.stopPropagation(); addToQueue('${jsStr(sp)}')">⬇ Cola</button>`;
  let playlistBtn;
  if (currentPlaylistId) {
    if (isImmich) {
      playlistBtn = `<button class="track-action-btn remove" onclick="event.stopPropagation(); removeImmichFromPlaylist(${currentPlaylistId}, '${track.assetId}')">✕ Quitar</button>`;
    } else if (isYouTube) {
      playlistBtn = `<button class="track-action-btn remove" onclick="event.stopPropagation(); removeYouTubeFromPlaylist(${currentPlaylistId}, '${track.videoId}')">✕ Quitar</button>`;
    } else {
      playlistBtn = `<button class="track-action-btn remove" onclick="event.stopPropagation(); removeFromPlaylist(${currentPlaylistId}, '${jsStr(sp)}')">✕ Quitar</button>`;
    }
  } else {
    playlistBtn = `<button class="track-action-btn" onclick="event.stopPropagation(); showAddMenu(event, '${jsStr(sp)}')">+ Añadir</button>`;
  }
  return queueBtn + playlistBtn;
}

function renderGridView() {
  const container = document.getElementById('gridList');
  const list = getVisibleTracks();
  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🎵</div><div class="empty-state-text">No hay canciones</div></div>`;
    return;
  }
  container.innerHTML = list.map((track, i) => {
    const sp = encodeURIComponent(track.path);
    const dn = cleanName(track.name);
    const isImmich = track.type === 'immich';
    const isYouTube = track.type === 'youtube';
    const cu = isImmich ? `${API_BASE}/immich/thumbnail/${track.assetId}`
      : isYouTube ? `https://i.ytimg.com/vi/${track.videoId}/mqdefault.jpg`
      : getCoverUrl(track);
    const icon = (isImmich || isYouTube || track.type === 'video') ? '🎬' : '♪';
    const art = cu
      ? `<img src="${cu}" alt="${escapeHtml(dn)}" onerror="this.parentElement.innerHTML='<div class=\\'grid-art-placeholder\\' style=\\'background: ${getTrackColor(i)}\\'>${icon}</div>'">`
      : `<div class="grid-art-placeholder" style="background: ${getTrackColor(i)};">${icon}</div>`;
    let metaText;
    if (isYouTube) metaText = (track.author || 'YouTube');
    else if (isImmich) metaText = track.path;
    else {
      const dateStr = track.mtime ? new Date(track.mtime * 1000).toLocaleDateString() : '';
      metaText = dateStr ? `${track.path} · ${dateStr}` : track.path;
    }
    return `
    <div class="grid-item" data-path="${sp}" data-idx="${i}" onclick="playTrack('${jsStr(sp)}')" oncontextmenu="event.preventDefault();event.stopPropagation();showTrackContextMenu(event,'${jsStr(sp)}')">
      <div class="grid-art">${art}<button class="grid-play-btn" onclick="event.stopPropagation(); playTrack('${jsStr(sp)}')">▶</button></div>
      <div class="grid-title">${escapeHtml(dn)}${isImmich || isYouTube || track.type === 'video' ? ' <span style="font-size:11px;color:var(--accent-pink)">🎬</span>' : ''}</div>
      <div class="grid-meta">${escapeHtml(metaText)}</div>
    </div>`;
  }).join('');
}

function renderSidebar() {
  const container = document.getElementById('playlistList');
  const allActive = !currentPlaylistId ? ' active' : '';
  let html = `<div class="playlist-item${allActive}" onclick="showAllTracks()">
    <div class="playlist-icon">🎵</div>
    <div class="playlist-info"><div class="playlist-name">Todas las canciones</div><div class="playlist-count">${allTracks.length} canciones</div></div>
  </div>`;
  playlists.forEach(p => {
    const active = currentPlaylistId === p.id ? ' active' : '';
    const safeName = escapeHtml(p.name).replace(/'/g, "\\'");
    html += `<div class="playlist-item${active}" onclick="showPlaylist(${p.id})">
      <div class="playlist-icon">📋</div>
      <div class="playlist-info">
        <div class="playlist-name">${escapeHtml(p.name)}</div>
        <div class="playlist-count">${p.songs.length} canciones</div>
      </div>
      <div class="playlist-actions">
        <button class="playlist-action-btn" onclick="event.stopPropagation(); showRenameModal(${p.id}, '${jsStr(safeName)}')">✎</button>
        <button class="playlist-action-btn delete" onclick="event.stopPropagation(); deletePlaylist(${p.id})">✕</button>
      </div>
    </div>`;
  });
  container.innerHTML = html;
}

function getVisibleTracks() {
  if (!currentPlaylistId) return tracks;
  const pl = playlists.find(p => p.id === currentPlaylistId);
  if (!pl) return [];
  const result = [];
  for (const song of pl.songs) {
    if (song.type === 'local') {
      const t = allTracks.find(t => t.path === song.path);
      if (t) result.push(t);
    } else if (song.type === 'immich') {
      result.push({
        type: 'immich',
        assetId: song.assetId,
        name: song.name || 'Video',
        path: `immich:${song.assetId}`,
        cover: null,
      });
    } else if (song.type === 'youtube') {
      result.push({
        type: 'youtube',
        videoId: song.videoId,
        name: song.name || 'Video',
        path: `youtube:${song.videoId}`,
        cover: `https://i.ytimg.com/vi/${song.videoId}/mqdefault.jpg`,
        author: song.author || 'YouTube',
      });
    }
  }
  return result;
}

/* ==================== PLAYLIST NAV ==================== */
function getPlaylistName(id) {
  const pl = playlists.find(p => p.id === id);
  return pl ? pl.name : 'Playlist';
}

function showAllTracks() {
  goHome();
}

function showPlaylist(id) {
  immichView = null;
  closeYouTubePlayer();
  currentPlaylistId = id;
  currentFolder = null;
  renderFolderList();
  renderImmichSidebar();
  renderContent();
  renderSidebar();
}

/* ==================== FOLDER MODAL ==================== */
function showFolderModal() {
  document.getElementById('folderModal').style.display = 'flex';
  document.getElementById('folderPathInput').value = '';
  document.getElementById('folderPathInput').focus();
}

function hideFolderModal() { document.getElementById('folderModal').style.display = 'none'; }

async function confirmAddFolder() {
  const path = document.getElementById('folderPathInput').value.trim();
  if (!path) return;
  const newDir = { key: path.split('/').filter(Boolean).pop() || 'music', path };
  const dirs = [...musicDirs, newDir];
  const res = await fetch(`${API_BASE}/config`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ music_dirs: dirs }),
  });
  const data = await res.json();
  if (data.error) { alert(data.error); return; }
  hideFolderModal();
  currentFolder = null;
  currentPlaylistId = null;
  loadFiles();
  loadFolders();
  renderSidebar();
}

/* ==================== PLAYLIST CRUD ==================== */
let createSelectedSongs = [];

function showCreateModal() {
  document.getElementById('createModal').style.display = 'flex';
  document.getElementById('playlistNameInput').value = '';
  document.getElementById('playlistNameInput').focus();
  createSelectedSongs = [];
  document.getElementById('addTrackSearch').value = '';
  renderAddTrackList();
  renderCreateSelected();
}

function hideCreateModal() {
  document.getElementById('createModal').style.display = 'none';
  document.getElementById('addTrackPanel').classList.remove('open');
}

function renderAddTrackList() {
  const container = document.getElementById('createPlaylistTracks');
  const q = (document.getElementById('addTrackSearch').value || '').toLowerCase();
  const filtered = q
    ? allTracks.filter(t => cleanName(t.name).toLowerCase().includes(q) || t.path.toLowerCase().includes(q))
    : allTracks;
  const icon = t => t.type === 'video' ? '🎬' : '♪';
  container.innerHTML = filtered.map(track => {
    const dn = cleanName(track.name);
    const sp = encodeURIComponent(track.path);
    const sel = createSelectedSongs.includes(sp) ? ' selected' : '';
    return `<div class="create-track-item${sel}" onclick="toggleCreateTrack('${jsStr(sp)}')">
      <span class="create-track-icon">${icon(track)}</span>
      <span class="create-track-name">${escapeHtml(dn)}</span>
    </div>`;
  }).join('');
}

function toggleCreateTrack(encodedPath) {
  const idx = createSelectedSongs.indexOf(encodedPath);
  if (idx === -1) {
    createSelectedSongs.push(encodedPath);
  } else {
    createSelectedSongs.splice(idx, 1);
  }
  renderAddTrackList();
  renderCreateSelected();
}

function renderCreateSelected() {
  const container = document.getElementById('createSelectedList');
  const count = document.getElementById('createPlaylistCount');
  if (createSelectedSongs.length === 0) {
    container.innerHTML = '<div class="create-selected-empty">No hay canciones seleccionadas</div>';
    count.textContent = '0';
    return;
  }
  count.textContent = createSelectedSongs.length;
  container.innerHTML = createSelectedSongs.map(sp => {
    const track = allTracks.find(t => encodeURIComponent(t.path) === sp);
    if (!track) return '';
    const dn = cleanName(track.name);
    return `<div class="create-selected-item">
      <span class="create-track-name">${escapeHtml(dn)}</span>
      <button class="create-selected-remove" onclick="event.stopPropagation(); removeCreateTrack('${jsStr(sp)}')">✕</button>
    </div>`;
  }).join('');
}

function removeCreateTrack(encodedPath) {
  createSelectedSongs = createSelectedSongs.filter(s => s !== encodedPath);
  renderAddTrackList();
  renderCreateSelected();
}

function filterAddTrack() {
  renderAddTrackList();
}

function toggleAddTrackPanel() {
  document.getElementById('addTrackPanel').classList.toggle('open');
  if (document.getElementById('addTrackPanel').classList.contains('open')) {
    document.getElementById('addTrackSearch').focus();
  }
}

async function createPlaylist() {
  const name = document.getElementById('playlistNameInput').value.trim();
  if (!name) return;
  const songs = createSelectedSongs.map(decodeURIComponent);
  try {
    await fetch(`${API_BASE}/playlists`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, songs }),
    });
    hideCreateModal();
    await loadPlaylists();
  } catch (e) { console.error(e); }
}

/* ==================== ADD VISIBLE TO PLAYLIST ==================== */
function showAddVisibleModal() {
  document.getElementById('addVisibleModal').style.display = 'flex';
  const list = getVisibleTracks();
  window._addVisibleSongs = list.map(t => encodeURIComponent(t.path));
  const select = document.getElementById('addVisiblePlaylistSelect');
  select.innerHTML = '<option value="">-- Crear nueva playlist --</option>' +
    playlists.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  select.value = '';
  document.getElementById('addVisibleNewName').style.display = 'none';
  document.getElementById('addVisibleNameInput').value = '';
  renderAddVisibleList();
  renderAddVisibleCount();
}

function hideAddVisibleModal() {
  document.getElementById('addVisibleModal').style.display = 'none';
  document.getElementById('addVisiblePanel').classList.remove('open');
}

function renderAddVisibleList() {
  const container = document.getElementById('addVisibleTrackList');
  const q = (document.getElementById('addVisibleSearch').value || '').toLowerCase();
  const list = getVisibleTracks();
  const filtered = q ? list.filter(t => cleanName(t.name).toLowerCase().includes(q) || t.path.toLowerCase().includes(q)) : list;
  const icon = t => t.type === 'video' ? '🎬' : '♪';
  container.innerHTML = filtered.map(track => {
    const dn = cleanName(track.name);
    const sp = encodeURIComponent(track.path);
    const sel = window._addVisibleSongs.includes(sp) ? ' selected' : '';
    return `<div class="create-track-item${sel}" onclick="toggleAddVisibleTrack('${jsStr(sp)}')">
      <span class="create-track-icon">${icon(track)}</span>
      <span class="create-track-name">${escapeHtml(dn)}</span>
    </div>`;
  }).join('');
}

function toggleAddVisibleTrack(encodedPath) {
  const idx = window._addVisibleSongs.indexOf(encodedPath);
  if (idx === -1) {
    window._addVisibleSongs.push(encodedPath);
  } else {
    window._addVisibleSongs.splice(idx, 1);
  }
  renderAddVisibleList();
  renderAddVisibleCount();
}

function renderAddVisibleCount() {
  const n = window._addVisibleSongs.length;
  document.getElementById('addVisibleCount').textContent = n;
  document.getElementById('addVisibleConfirmBtn').textContent = `Agregar (${n})`;
}

function filterAddVisible() {
  renderAddVisibleList();
}

function toggleAddVisiblePanel() {
  const p = document.getElementById('addVisiblePanel');
  p.classList.toggle('open');
  if (p.classList.contains('open')) document.getElementById('addVisibleSearch').focus();
}

function onAddVisiblePlaylistChange() {
  const val = document.getElementById('addVisiblePlaylistSelect').value;
  document.getElementById('addVisibleNewName').style.display = val === '' ? '' : 'none';
}

async function confirmAddVisible() {
  const songs = window._addVisibleSongs.map(decodeURIComponent);
  if (songs.length === 0) return;
  const select = document.getElementById('addVisiblePlaylistSelect');
  let playlistId = select.value;

  if (!playlistId) {
    const name = document.getElementById('addVisibleNameInput').value.trim();
    if (!name) { alert('Ingresa un nombre para la nueva playlist'); return; }
    const res = await fetch(`${API_BASE}/playlists`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, songs }),
    });
    const pl = await res.json();
    if (pl.error) { alert(pl.error); return; }
  } else {
    for (const sp of songs) {
      await fetch(`${API_BASE}/playlists/${playlistId}/songs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: sp }),
      });
    }
  }

  hideAddVisibleModal();
  await loadPlaylists();
}

/* ==================== RENAME ==================== */
function showRenameModal(id, name) {
  renamingPlaylistId = id;
  document.getElementById('renameModal').style.display = 'flex';
  document.getElementById('renameInput').value = name;
  document.getElementById('renameInput').focus();
}

function hideRenameModal() { document.getElementById('renameModal').style.display = 'none'; renamingPlaylistId = null; }

async function confirmRename() {
  const name = document.getElementById('renameInput').value.trim();
  if (!name || !renamingPlaylistId) return;
  try {
    await fetch(`${API_BASE}/playlists/${renamingPlaylistId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    hideRenameModal();
    await loadPlaylists();
    renderContent();
  } catch (e) { console.error(e); }
}

async function deletePlaylist(id) {
  if (!confirm('¿Eliminar esta playlist?')) return;
  try {
    await fetch(`${API_BASE}/playlists/${id}`, { method: 'DELETE' });
    if (currentPlaylistId === id) showAllTracks();
    await loadPlaylists();
  } catch (e) { console.error(e); }
}

async function addToPlaylist(playlistId, songPath) {
  try {
    await fetch(`${API_BASE}/playlists/${playlistId}/songs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: decodeURIComponent(songPath) }),
    });
    await loadPlaylists();
    renderContent();
  } catch (e) { console.error(e); }
}

async function removeFromPlaylist(playlistId, songPath) {
  try {
    await fetch(`${API_BASE}/playlists/${playlistId}/songs/${songPath}`, { method: 'DELETE' });
    await loadPlaylists();
    renderContent();
  } catch (e) { console.error(e); }
}

async function removeImmichFromPlaylist(playlistId, assetId) {
  try {
    await fetch(`${API_BASE}/playlists/${playlistId}/songs`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'immich', assetId }),
    });
    await loadPlaylists();
    renderContent();
  } catch (e) { console.error(e); }
}

async function removeYouTubeFromPlaylist(playlistId, videoId) {
  try {
    await fetch(`${API_BASE}/playlists/${playlistId}/songs`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'youtube', videoId }),
    });
    await loadPlaylists();
    renderContent();
  } catch (e) { console.error(e); }
}

async function showImmichAssetPicker() {
  if (!immichConfig.connected) {
    showImmichConfig();
    return;
  }
  // Load all video assets from all albums into a picker modal
  try {
    const albumsRes = await fetch(`${API_BASE}/immich/albums`);
    const albums = await albumsRes.json();
    let allAssets = [];
    for (const album of albums) {
      const res = await fetch(`${API_BASE}/immich/albums/${album.id}`);
      const data = await res.json();
      allAssets = allAssets.concat((data.assets || []).filter(a => a.type === 'VIDEO'));
    }
    // Deduplicate by id
    const seen = new Set();
    immichAllAssets = allAssets.filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; });
    document.getElementById('immichAssetsTitle').textContent = 'Seleccionar video de Immich';
    document.getElementById('immichAssetSearch').value = '';
    renderImmichAssetList();
    document.getElementById('immichAssetsModal').style.display = 'flex';
  } catch (e) { console.error(e); }
}

function hideImmichAssetsModal() {
  document.getElementById('immichAssetsModal').style.display = 'none';
}

function filterImmichAssets() {
  renderImmichAssetList();
}

function renderImmichAssetList() {
  const container = document.getElementById('immichAssetList');
  const q = (document.getElementById('immichAssetSearch').value || '').toLowerCase();
  const filtered = q
    ? immichAllAssets.filter(a => (a.originalFileName || '').toLowerCase().includes(q))
    : immichAllAssets;
  if (filtered.length === 0) {
    container.innerHTML = '<div class="create-selected-empty">No hay videos</div>';
    return;
  }
  container.innerHTML = filtered.map(a => {
    const dn = (a.originalFileName || a.id).replace(/\.[^/.]+$/, '');
    const encodedId = encodeURIComponent(a.id);
    return `<div class="create-track-item" onclick="addImmichToCurrentPlaylist('${encodedId}', '${jsStr(dn)}')">
      <span class="create-track-icon">🎬</span>
      <span class="create-track-name">${escapeHtml(dn)}</span>
    </div>`;
  }).join('');
}

async function addImmichToCurrentPlaylist(encodedId, originalName) {
  if (!currentPlaylistId) return;
  const assetId = decodeURIComponent(encodedId);
  await addImmichToPlaylist(currentPlaylistId, encodedId, originalName);
  hideImmichAssetsModal();
  renderContent();
}

/* ==================== ADD TO PLAYLIST SUBMENU ==================== */
function showAddMenu(event, songPath) {
  event.preventDefault();
  hideAddMenu();
  const menu = document.createElement('div');
  menu.className = 'submenu show';
  menu.style.position = 'fixed';
  menu.style.left = Math.max(10, event.clientX - 200) + 'px';
  menu.style.top = Math.min(window.innerHeight - 100, event.clientY) + 'px';
  let html = '<div class="submenu-title">Añadir a playlist</div>';
  if (playlists.length === 0) {
    html += '<div class="submenu-item" style="color:var(--text-tertiary)">No hay playlists</div>';
  } else {
    playlists.forEach(p => {
      html += `<div class="submenu-item" onclick="addToPlaylist(${p.id}, '${jsStr(songPath)}'); hideAddMenu();">${escapeHtml(p.name)}</div>`;
    });
  }
  menu.innerHTML = html;
  document.body.appendChild(menu);
  activeSubmenu = menu;
  setTimeout(() => document.addEventListener('click', hideAddMenu, { once: true }), 10);
}

function hideAddMenu() {
  if (activeSubmenu) { activeSubmenu.remove(); activeSubmenu = null; }
}

/* ==================== CONTEXT MENU ==================== */
let activeContextMenu = null;

function showTrackContextMenu(event, sp) {
  event.preventDefault();
  event.stopPropagation();
  hideTrackContextMenu();

  const track = allTracks.find(t => encodeURIComponent(t.path) === sp)
    || getVisibleTracks().find(t => encodeURIComponent(t.path) === sp);
  if (!track) return;

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = Math.min(event.clientX, window.innerWidth - 220) + 'px';
  menu.style.top = Math.min(event.clientY, window.innerHeight - 180) + 'px';
  menu.style.position = 'fixed';

  const dn = cleanName(track.name);
  const isImmich = track.type === 'immich';

  let html = `<div class="context-menu-title">${escapeHtml(dn)}</div>`;
  html += `<div class="context-menu-item" onclick="hideTrackContextMenu(); playTrack('${jsStr(sp)}')">▶ Reproducir</div>`;
  html += `<div class="context-menu-item" onclick="hideTrackContextMenu(); addToQueue('${jsStr(sp)}')">⬇ Agregar a la cola</div>`;

  if (currentPlaylistId) {
    if (isImmich) {
      html += `<div class="context-menu-item" onclick="hideTrackContextMenu(); removeImmichFromPlaylist(${currentPlaylistId}, '${track.assetId}')">✕ Quitar de playlist</div>`;
    } else {
      html += `<div class="context-menu-item" onclick="hideTrackContextMenu(); removeFromPlaylist(${currentPlaylistId}, '${jsStr(sp)}')">✕ Quitar de playlist</div>`;
    }
  } else {
    html += `<div class="context-menu-item" onclick="hideTrackContextMenu(event); showAddMenu(event, '${jsStr(sp)}')">+ Añadir a playlist</div>`;
  }

  html += `<div class="context-menu-divider"></div>`;
  html += `<div class="context-menu-item" onclick="hideTrackContextMenu(); showTrackProperties(event, '${jsStr(sp)}')">ℹ Propiedades</div>`;

  menu.innerHTML = html;
  document.body.appendChild(menu);
  activeContextMenu = menu;

  setTimeout(() => {
    document.addEventListener('click', hideTrackContextMenu, { once: true });
    document.addEventListener('contextmenu', hideTrackContextMenu, { once: true });
  }, 10);
}

function hideTrackContextMenu() {
  if (activeContextMenu) { activeContextMenu.remove(); activeContextMenu = null; }
}

function showTrackProperties(event, sp) {
  event.preventDefault();
  hideTrackContextMenu();
  const track = allTracks.find(t => encodeURIComponent(t.path) === sp)
    || getVisibleTracks().find(t => encodeURIComponent(t.path) === sp);
  if (!track) return;

  const isImmich = track.type === 'immich';
  const dn = cleanName(track.name);
  const rows = [
    { label: 'Nombre', value: dn },
    { label: 'Ruta', value: track.path },
    { label: 'Tipo', value: isImmich ? 'Immich (video)' : track.type === 'video' ? 'Video local' : 'Audio' },
    { label: 'Tamaño', value: track.size ? formatSize(track.size) : '—' },
  ];
  if (isImmich) {
    rows.push({ label: 'Asset ID', value: track.assetId });
  }
  if (track.format) {
    rows.push({ label: 'Formato', value: track.format });
  }

  document.getElementById('propertiesContent').innerHTML = rows.map(r =>
    `<div class="properties-row"><span class="properties-label">${escapeHtml(r.label)}</span><span class="properties-value">${escapeHtml(r.value)}</span></div>`
  ).join('');
  document.getElementById('propertiesModal').style.display = 'flex';
}

function hidePropertiesModal() {
  document.getElementById('propertiesModal').style.display = 'none';
}

function formatSize(bytes) {
  if (!bytes || isNaN(bytes)) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let s = bytes;
  while (s >= 1024 && i < u.length - 1) { s /= 1024; i++; }
  return s.toFixed(1) + ' ' + u[i];
}

/* ==================== VIEW TOGGLE ==================== */
function setView(view) {
  currentView = view;
  document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('listView').style.display = view === 'list' ? '' : 'none';
  document.getElementById('gridView').style.display = view === 'grid' ? '' : 'none';
}

function filterTracks() {
  const q = document.getElementById('searchInput').value.toLowerCase();
  document.querySelectorAll('.track-item').forEach(el => {
    const t = el.querySelector('.track-title').textContent.toLowerCase();
    const m = el.querySelector('.track-meta').textContent.toLowerCase();
    el.style.display = (t.includes(q) || m.includes(q)) ? '' : 'none';
  });
  document.querySelectorAll('.grid-item').forEach(el => {
    const t = el.querySelector('.grid-title').textContent.toLowerCase();
    const m = el.querySelector('.grid-meta').textContent.toLowerCase();
    el.style.display = (t.includes(q) || m.includes(q)) ? '' : 'none';
  });
}

/* ==================== QUEUE ==================== */
function addToQueue(encodedPath) {
  let track = allTracks.find(t => encodeURIComponent(t.path) === encodedPath);
  if (!track) {
    const visible = getVisibleTracks();
    track = visible.find(t => encodeURIComponent(t.path) === encodedPath);
  }
  if (!track) return;
  if (playQueue.some(q => q.path === encodedPath)) return;
  playQueue.push({ path: encodedPath, track });
  updateQueueBadge();
  if (isQueueOpen()) renderQueueContent();
}

function removeFromQueue(encodedPath) {
  playQueue = playQueue.filter(q => q.path !== encodedPath);
  updateQueueBadge();
  if (isQueueOpen()) renderQueueContent();
}

function clearQueue() {
  playQueue = [];
  updateQueueBadge();
  if (isQueueOpen()) renderQueueContent();
}

function getNextFromQueue() {
  if (playQueue.length === 0) return null;
  return playQueue.shift();
}

function updateQueueBadge() {
  const count = playQueue.length;
  const btn = document.getElementById('queueBtn');
  if (!btn) return;
  btn.innerHTML = count > 0
    ? `☰ <span class="badge">${count}</span>`
    : `☰`;
}

function playFromQueue(encodedPath) {
  const q = playQueue.find(entry => entry.path === encodedPath);
  playQueue = playQueue.filter(entry => entry.path !== encodedPath);
  updateQueueBadge();
  if (isQueueOpen()) renderQueueContent();
  if (q && q.track.type === 'immich') {
    playTrackDirect(q.track);
  } else {
    playTrack(encodedPath);
  }
}

function renderQueueContent() {
  const container = document.getElementById('queueContent');
  if (!container) return;

  let html = '';

  // Próximo — upcoming tracks still in the queue.
  html += '<div class="queue-section-label">Próximo</div>';
  if (playQueue.length === 0) {
    html += '<div class="queue-section-empty">No hay canciones en cola</div>';
  } else {
    playQueue.forEach((q) => {
      const t = q.track;
      const cover = getTrackCover(t);
      const title = getTrackTitle(t);
      const artist = getTrackArtist(t);
      html += `<div class="queue-item" onclick="playFromQueue('${jsStr(q.path)}')">
        <div class="queue-item-thumb${cover ? '' : ' queue-item-thumb-ph'}"${cover ? ` style="background-image:url('${cover}')"` : ''}>${cover ? '' : '<span>♪</span>'}</div>
        <div class="queue-item-info">
          <div class="queue-item-title">${escapeHtml(title)}</div>
          <div class="queue-item-meta">${escapeHtml(artist)}</div>
        </div>
        <button class="queue-item-remove" onclick="event.stopPropagation(); removeFromQueue('${jsStr(q.path)}')" title="Quitar de la cola">✕</button>
      </div>`;
    });
  }

  // Historial — recently played this session (never persisted, see pushHistory).
  if (playHistory.length > 0) {
    html += '<div class="queue-section-label">Historial</div>';
    playHistory.forEach((t) => {
      const cover = getTrackCover(t);
      const title = getTrackTitle(t);
      const artist = getTrackArtist(t);
      html += `<div class="queue-item queue-item-history">
        <div class="queue-item-thumb${cover ? '' : ' queue-item-thumb-ph'}"${cover ? ` style="background-image:url('${cover}')"` : ''}>${cover ? '' : '<span>♪</span>'}</div>
        <div class="queue-item-info">
          <div class="queue-item-title">${escapeHtml(title)}</div>
          <div class="queue-item-meta">${escapeHtml(artist)}</div>
        </div>
      </div>`;
    });
  }

  container.innerHTML = html;
}

function toggleQueue() {
  const overlay = document.getElementById('queueOverlay');
  if (overlay) {
    overlay.remove();
    return;
  }
  renderQueueDrawer();
}

function isQueueOpen() {
  return !!document.getElementById('queueOverlay');
}

/* ==================== QUEUE DRAWER (PR3, YouTube Music style) ==================== */

// Resolve a cover URL for any track-like object (local uses the boolean `cover`
// flag; Immich uses its thumbnail endpoint). Returns null when there is none.
function getTrackCover(track) {
  if (!track) return null;
  if (track.type === 'immich') return `${API_BASE}/immich/thumbnail/${track.assetId}`;
  return getCoverUrl(track);
}

function getTrackTitle(track) {
  if (!track) return '';
  if (track.meta && track.meta.title) return track.meta.title;
  return cleanName(track.name);
}

function getTrackArtist(track) {
  if (!track) return '';
  if (track.meta && track.meta.artist) return track.meta.artist;
  if (track.type === 'immich') return 'Immich';
  if (track.path) return cleanName(track.path);
  return '';
}

function renderQueueCurrentCard() {
  const el = document.getElementById('queueCurrentCard');
  if (!el) return;
  const cover = getTrackCover(currentTrack);
  const title = getTrackTitle(currentTrack);
  const artist = getTrackArtist(currentTrack);
  if (!title && !cover) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="queue-current-cover${cover ? '' : ' queue-current-cover-ph'}"${cover ? ` style="background-image:url('${cover}')"` : ''}>
      ${cover ? '' : '<span>♪</span>'}
    </div>
    <div class="queue-current-info">
      <div class="queue-current-label">Reproduciendo ahora</div>
      <div class="queue-current-title">${escapeHtml(title)}</div>
      <div class="queue-current-artist">${escapeHtml(artist)}</div>
    </div>`;
}

function renderQueueDrawer() {
  let overlay = document.getElementById('queueOverlay');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.className = 'queue-overlay';
  overlay.id = 'queueOverlay';
  overlay.onclick = function (e) { if (e.target === this) this.remove(); };

  const cover = getTrackCover(currentTrack);
  const drawer = document.createElement('div');
  drawer.className = 'queue-drawer';
  drawer.onclick = function (e) { e.stopPropagation(); };

  drawer.innerHTML = `
    <div class="queue-backdrop"${cover ? ` style="background-image:url('${cover}')"` : ''}></div>
    <div class="queue-header">
      <h3>Cola de reproducción</h3>
      <button class="queue-clear-btn" onclick="clearQueue()">Limpiar</button>
      <button class="queue-close-btn" onclick="toggleQueue()">✕</button>
    </div>
    <div class="queue-current-card" id="queueCurrentCard"></div>
    <div class="queue-content" id="queueContent"></div>
  `;

  overlay.appendChild(drawer);
  document.body.appendChild(overlay);
  renderQueueCurrentCard();
  renderQueueContent();
}

/* ==================== IMMICH PLAYBACK ==================== */
function playTrackDirect(track) {
  if (!track) return;
  // PR3: record the switch so the previous track lands in session history.
  recordTrackSwitch(track);
  const encodedPath = track.type === 'immich' ? track.path : encodeURIComponent(track.path);

  stopPlayback();
  isVideo = true;

  const player = document.getElementById('playerContainer');
  const nowPlaying = document.getElementById('nowPlayingSection');
  const progressSection = document.getElementById('progressSection');
  const fsBtn = document.getElementById('fullscreenBtn');
  progressSection.style.display = '';
  player.innerHTML = `<div id="videoWrapper" class="video-wrapper">
    <video id="videoPlayer" class="video-player"></video>
    <div id="videoOverlay" class="video-overlay">
      <div class="video-overlay-top">
        <span class="video-overlay-title">${escapeHtml(cleanName(track.name))}</span>
      </div>
      <div class="video-overlay-bottom">
        <div class="video-overlay-progress" id="videoOverlayProgress" onclick="seekOverlay(event)">
          <div class="video-overlay-fill" id="videoOverlayFill"></div>
        </div>
        <div class="video-overlay-time">
          <span id="videoOverlayCurrent">0:00</span>
          <span id="videoOverlayDuration">0:00</span>
        </div>
      </div>
    </div>
  </div>`;
  video = document.getElementById('videoPlayer');

  if (track.type === 'immich') {
    video.src = `${API_BASE}/immich/media/${track.assetId}`;
    nowPlayingImmichId = track.assetId;
  } else {
    video.src = `/media/${encodedPath}`;
    nowPlayingImmichId = null;
  }

  video.load();
  nowPlaying.style.display = 'none';
  player.style.display = 'block';
  fsBtn.style.display = 'inline-block';
  document.getElementById('videoOverlay').classList.add('hidden');

  video.onerror = () => { handleMediaError(video, track.name); };
  video.oncanplay = () => {
    const vol = document.getElementById('volumeFill').style.width.replace('%', '') / 100 || 1;
    video.volume = vol;
    video.play().then(() => updatePlayPauseBtn(true)).catch(() => updatePlayPauseBtn(false));
  };
  video.ontimeupdate = () => { onTimeUpdate(video); updateOverlay(video); };
  video.onended = () => {
    if (repeatMode === 'one') { video.currentTime = 0; video.play().catch(() => updatePlayPauseBtn(false)); }
    else { playNextInSequence(); }
  };
  video.onwaiting = () => { updatePlayPauseBtn(false); };
  video.onplay = () => { updatePlayPauseBtn(true); };

  persistTrack(track.path || encodedPath);
  currentIndex = -1;

  const cu = track.type === 'immich'
    ? `${API_BASE}/immich/thumbnail/${track.assetId}`
    : getCoverUrl(track);
  const artEl = document.getElementById('nowPlayingArt');
  artEl.innerHTML = cu
    ? `<img src="${cu}" alt="" onerror="this.parentElement.innerHTML='<div class=\\'now-playing-art-placeholder\\' style=\\'background:var(--gradient-accent)\\'>🎬</div>'">`
    : `<div class="now-playing-art-placeholder" style="background:var(--gradient-accent);">🎬</div>`;
  document.getElementById('nowPlayingTitle').textContent = cleanName(track.name);
  document.getElementById('nowPlayingArtist').textContent = track.path;

  // PR3: refresh the queue drawer (current card + history) if it is open.
  if (isQueueOpen()) { renderQueueCurrentCard(); renderQueueContent(); }
}

function playTrackFromQueue(q) {
  if (q.track.type === 'immich') {
    playTrackDirect(q.track);
  } else {
    playTrack(q.path, false);
  }
}

/* ==================== PLAYBACK ==================== */
function stopPlayback() {
  if (audio) { audio.pause(); audio.src = ''; audio.load(); }
  if (video) { video.pause(); video.src = ''; video.load(); }
  const fsBtn = document.getElementById('fullscreenBtn');
  if (fsBtn) fsBtn.style.display = 'none';
}

function playTrack(encodedPath, autoQueue) {
  let track = allTracks.find(t => encodeURIComponent(t.path) === encodedPath);
  // Check visible tracks for Immich entries
  if (!track) {
    const visible = getVisibleTracks();
    track = visible.find(t => encodeURIComponent(t.path) === encodedPath);
  }
  if (!track) return;

  if (track.type === 'immich') {
    playTrackDirect(track);
    return;
  }
  if (track.type === 'youtube') {
    playYouTubeVideo(track.videoId, cleanName(track.name));
    return;
  }

  // PR3: record the switch so the previous track lands in session history.
  recordTrackSwitch(track);

  if (autoQueue !== false) {
    const visible = getVisibleTracks();
    const clickedIdx = visible.findIndex(t => encodeURIComponent(t.path) === encodedPath);
    if (clickedIdx !== -1) {
      if (isShuffle) {
        const rest = visible.filter((_, i) => i !== clickedIdx);
        shuffleArray(rest);
        playQueue = rest.map(t => ({ path: encodeURIComponent(t.path), track: t }));
      } else {
        playQueue = visible.slice(clickedIdx + 1).map(t => ({
          path: encodeURIComponent(t.path),
          track: t,
        }));
      }
    }
    updateQueueBadge();
    if (isQueueOpen()) renderQueueContent();
  }

  stopPlayback();
  isVideo = track.type === 'video';

  const player = document.getElementById('playerContainer');
  const nowPlaying = document.getElementById('nowPlayingSection');
  const progressSection = document.getElementById('progressSection');
  const fsBtn = document.getElementById('fullscreenBtn');

  progressSection.style.display = '';

  if (isVideo) {
    const vname = cleanName(track.name);
    player.innerHTML = `<div id="videoWrapper" class="video-wrapper">
      <video id="videoPlayer" class="video-player"></video>
      <div id="videoOverlay" class="video-overlay">
        <div class="video-overlay-top">
          <span class="video-overlay-title">${escapeHtml(vname)}</span>
        </div>
        <div class="video-overlay-bottom">
          <div class="video-overlay-progress" id="videoOverlayProgress" onclick="seekOverlay(event)">
            <div class="video-overlay-fill" id="videoOverlayFill"></div>
          </div>
          <div class="video-overlay-time">
            <span id="videoOverlayCurrent">0:00</span>
            <span id="videoOverlayDuration">0:00</span>
          </div>
        </div>
      </div>
    </div>`;
    nowPlayingImmichId = null;
    video = document.getElementById('videoPlayer');
    video.src = `/media/${encodedPath}`;
    video.load();
    nowPlaying.style.display = 'none';
    player.style.display = 'block';
    fsBtn.style.display = 'inline-block';
    document.getElementById('videoOverlay').classList.add('hidden');

    video.onerror = () => { handleMediaError(video, track.name); };
    video.oncanplay = () => {
      const vol = document.getElementById('volumeFill').style.width.replace('%', '') / 100 || 1;
      video.volume = vol;
      video.play().catch(() => updatePlayPauseBtn(false));
      updatePlayPauseBtn(true);
    };
    video.ontimeupdate = () => { onTimeUpdate(video); updateOverlay(video); };
    video.onended = () => {
      if (repeatMode === 'one') { video.currentTime = 0; video.play().catch(() => updatePlayPauseBtn(false)); }
      else { playNextInSequence(); }
    };
    video.onwaiting = () => { updatePlayPauseBtn(false); };
    video.onplay = () => { updatePlayPauseBtn(true); };
  } else {
    nowPlayingImmichId = null;
    player.innerHTML = '';
    player.style.display = 'none';
    nowPlaying.style.display = '';
    fsBtn.style.display = 'inline-block';

    if (!audio) audio = new Audio();
    audio.src = `/media/${encodedPath}`;
    audio.load();

    audio.onerror = () => { handleMediaError(audio, track.name); };
    audio.oncanplay = () => {
      const vol = document.getElementById('volumeFill').style.width.replace('%', '') / 100 || 1;
      audio.volume = vol;
      audio.play().catch(() => updatePlayPauseBtn(false));
      updatePlayPauseBtn(true);
    };
    audio.ontimeupdate = () => { onTimeUpdate(audio); };
    audio.onended = () => {
      if (repeatMode === 'one') { audio.currentTime = 0; audio.play().catch(() => updatePlayPauseBtn(false)); }
      else { playNextInSequence(); }
    };
  }

  persistTrack(encodedPath);

  currentIndex = allTracks.indexOf(track);

  document.querySelectorAll('.track-item, .grid-item').forEach(el => el.classList.remove('active'));
  const el = document.querySelector(`.track-item[data-path="${encodedPath}"], .grid-item[data-path="${encodedPath}"]`);
  if (el) el.classList.add('active');

  const cu = getCoverUrl(track);
  const artEl = document.getElementById('nowPlayingArt');
  artEl.innerHTML = cu
    ? `<img src="${cu}" alt="" onerror="this.parentElement.innerHTML='<div class=\\'now-playing-art-placeholder\\' style=\\'background: ${getTrackColor(currentIndex)}\\'>♪</div>'">`
    : `<div class="now-playing-art-placeholder" style="background: ${getTrackColor(currentIndex)};">♪</div>`;

  document.getElementById('nowPlayingTitle').textContent = cleanName(track.name);
  document.getElementById('nowPlayingArtist').textContent = track.path;

  // Lazy metadata: tags override filename-derived title/artist when present.
  fetchMetadata(track.path);

  // Track the loaded path so the lyrics button can fetch on demand, and also
  // prefetch lyrics on play (best-effort, panel rendered in PR4).
  currentTrackPath = track.path;
  fetchLyrics(track.path, currentMeta);

  // PR3: refresh the queue drawer (current card + history) if it is open.
  if (isQueueOpen()) { renderQueueCurrentCard(); renderQueueContent(); }
}

/* ==================== VIDEO OVERLAY ==================== */
let overlayHideTimer = null;

function setupOverlayAutoHide() {
  const overlay = document.getElementById('videoOverlay');
  const wrapper = document.getElementById('videoWrapper');
  if (!overlay || !wrapper) return;
  overlay.classList.remove('hidden');
  clearTimeout(overlayHideTimer);
  overlayHideTimer = setTimeout(() => overlay.classList.add('hidden'), 3000);
  wrapper.onmousemove = () => {
    overlay.classList.remove('hidden');
    clearTimeout(overlayHideTimer);
    overlayHideTimer = setTimeout(() => overlay.classList.add('hidden'), 3000);
  };
  wrapper.onmouseleave = () => {
    clearTimeout(overlayHideTimer);
    overlayHideTimer = setTimeout(() => overlay.classList.add('hidden'), 1500);
  };
}

function stopOverlayAutoHide() {
  clearTimeout(overlayHideTimer);
  const wrapper = document.getElementById('videoWrapper');
  if (wrapper) wrapper.onmousemove = null;
}

function updateOverlay(el) {
  const fill = document.getElementById('videoOverlayFill');
  const cur = document.getElementById('videoOverlayCurrent');
  const dur = document.getElementById('videoOverlayDuration');
  if (!fill || !cur || !dur || !el.duration) return;
  fill.style.width = `${(el.currentTime / el.duration) * 100}%`;
  cur.textContent = formatTime(el.currentTime);
  dur.textContent = formatTime(el.duration);
}

function seekOverlay(e) {
  const el = isVideo ? video : audio;
  if (!el || !el.duration) return;
  el.currentTime = (e.offsetX / e.target.offsetWidth) * el.duration;
}

function toggleFullscreen() {
  const fsContainer = document.getElementById('audioFullscreen');
  const isAudioFullscreen = fsContainer && fsContainer.style.display !== 'none';

  if (isAudioFullscreen) {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
    return;
  }

  if (isVideo) {
    const w = document.getElementById('videoWrapper') || document.getElementById('videoPlayer');
    if (!w) return;
    if (w.requestFullscreen) {
      w.requestFullscreen();
    } else if (w.webkitRequestFullscreen) {
      w.webkitRequestFullscreen();
    } else if (w.msRequestFullscreen) {
      w.msRequestFullscreen();
    }
  } else {
    if (!audio) return;
    openAudioFullscreen();
  }
}

function openAudioFullscreen() {
  const fsContainer = document.getElementById('audioFullscreen');
  if (!fsContainer) return;

  fsContainer.style.display = 'flex';

  if (fsContainer.requestFullscreen) {
    fsContainer.requestFullscreen();
  } else if (fsContainer.webkitRequestFullscreen) {
    fsContainer.webkitRequestFullscreen();
  } else if (fsContainer.msRequestFullscreen) {
    fsContainer.msRequestFullscreen();
  }

  updateAudioFullscreenUI();
  renderFullscreenLyrics();
}

function closeAudioFullscreen() {
  const fsContainer = document.getElementById('audioFullscreen');
  if (!fsContainer) return;
  fsContainer.style.display = 'none';

  if (document.fullscreenElement || document.webkitFullscreenElement) {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
  }
}

function updateAudioFullscreenUI() {
  if (!audio) return;

  const coverEl = document.getElementById('audioFullscreenCover');
  const titleEl = document.getElementById('audioFullscreenTitle');
  const artistEl = document.getElementById('audioFullscreenArtist');
  const playPauseBtn = document.getElementById('audioFullscreenPlayPauseBtn');
  const progressFill = document.getElementById('audioFullscreenProgressFill');
  const currentTimeEl = document.getElementById('audioFullscreenCurrentTime');
  const durationEl = document.getElementById('audioFullscreenDuration');
  const volumeFill = document.getElementById('audioFullscreenVolumeFill');

  const track = allTracks[currentIndex];
  if (track) {
    const cu = getCoverUrl(track);
    if (coverEl) {
      coverEl.innerHTML = cu
        ? `<img src="${cu}" alt="" onerror="this.parentElement.innerHTML='<div class=\\'audio-fullscreen-cover-placeholder\\' style=\\'background: ${getTrackColor(currentIndex)}\\'>♪</div>'">`
        : `<div class="audio-fullscreen-cover-placeholder" style="background: ${getTrackColor(currentIndex)};">♪</div>`;
    }
    if (titleEl) titleEl.textContent = cleanName(track.name);
    if (artistEl) artistEl.textContent = track.path;
  }

  if (playPauseBtn) {
    playPauseBtn.textContent = audio.paused ? '▶' : '⏸';
  }

  if (progressFill && audio.duration) {
    progressFill.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
  }
  if (currentTimeEl) currentTimeEl.textContent = formatTime(audio.currentTime);
  if (durationEl) durationEl.textContent = formatTime(audio.duration);

  if (volumeFill) {
    const vol = audio.muted ? 0 : (audio.volume * 100);
    volumeFill.style.width = `${vol}%`;
  }

  const fsContainer = document.getElementById('audioFullscreen');
  if (fsContainer) {
    if (currentLyrics && (currentLyrics.syncedLyrics || currentLyrics.plainLyrics || currentLyrics.instrumental)) {
      fsContainer.classList.remove('audio-fullscreen-no-lyrics');
    } else {
      fsContainer.classList.add('audio-fullscreen-no-lyrics');
    }
  }
}

function seekFullscreenTo(e) {
  if (!audio || !audio.duration) return;
  audio.currentTime = (e.offsetX / e.target.offsetWidth) * audio.duration;
  updateAudioFullscreenUI();
}

function seekRelative(seconds) {
  const el = isVideo ? video : audio;
  if (!el || !el.duration) return;
  el.currentTime = Math.max(0, Math.min(el.duration, el.currentTime + seconds));
  updateAudioFullscreenUI();
}

function setFullscreenVolume(e) {
  const p = Math.max(0, Math.min(1, e.offsetX / e.target.offsetWidth));
  const volumeFill = document.getElementById('audioFullscreenVolumeFill');
  const mainVolumeFill = document.getElementById('volumeFill');
  if (volumeFill) volumeFill.style.width = `${p * 100}%`;
  if (mainVolumeFill) mainVolumeFill.style.width = `${p * 100}%`;
  if (audio) audio.volume = p;
  if (video) video.volume = p;
  localStorage.setItem('volume', p);
}

function renderFullscreenLyrics() {
  const body = document.getElementById('audioFullscreenLyricsBody');
  if (!body) return;

  if (!currentLyrics) {
    body.innerHTML = '<div class="audio-fullscreen-lyrics-empty">Cargando letra…</div>';
    return;
  }

  if (currentLyrics.instrumental) {
    body.innerHTML = '<div class="audio-fullscreen-lyrics-empty"><span style="font-size:48px">🎵</span>Esta canción es instrumental</div>';
    return;
  }

  const synced = currentLyrics.syncedLyrics;
  if (synced && synced.trim()) {
    lyricLines = parseLRC(synced);
    body.innerHTML = lyricLines.map((l, i) =>
      `<div class="audio-fullscreen-lyrics-line" data-index="${i}" data-time="${l.t}" onclick="seekToLyric(${i})">${l.text ? escapeHtml(l.text) : '&nbsp;'}</div>`
    ).join('');
    updateFullscreenLyricsHighlight(audio && audio.currentTime ? audio.currentTime : 0);
    return;
  }

  const plain = currentLyrics.plainLyrics;
  if (plain && plain.trim()) {
    lyricLines = [];
    body.innerHTML = plain.split('\n').map(t =>
      `<div class="audio-fullscreen-lyrics-line">${t.trim() ? escapeHtml(t) : '&nbsp;'}</div>`
    ).join('');
    return;
  }

  body.innerHTML = `<div class="audio-fullscreen-lyrics-empty">Sin letra disponible<button class="audio-fullscreen-lyrics-add-btn" onclick="openLyricsEditor()">Agregar letra</button></div>`;
}

function updateFullscreenLyricsHighlight(time) {
  if (!lyricLines.length) return;
  let idx = -1;
  for (let i = 0; i < lyricLines.length; i++) {
    if (lyricLines[i].t <= time) idx = i; else break;
  }
  const body = document.getElementById('audioFullscreenLyricsBody');
  if (!body) return;
  const prev = body.querySelector('.audio-fullscreen-lyrics-line.active');
  if (prev) prev.classList.remove('active');
  if (idx >= 0) {
    const el = body.querySelector(`.audio-fullscreen-lyrics-line[data-index="${idx}"]`);
    if (el) {
      el.classList.add('active');
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    }
  }
}

document.addEventListener('fullscreenchange', () => {
  const overlay = document.getElementById('videoOverlay');
  const fsContainer = document.getElementById('audioFullscreen');

  if (document.fullscreenElement) {
    if (overlay) {
      overlay.classList.remove('hidden');
      setupOverlayAutoHide();
    }
  } else {
    if (overlay) {
      overlay.classList.add('hidden');
      stopOverlayAutoHide();
    }
    if (fsContainer && fsContainer.style.display !== 'none') {
      fsContainer.style.display = 'none';
    }
  }
});
document.addEventListener('webkitfullscreenchange', () => {
  const overlay = document.getElementById('videoOverlay');
  const fsContainer = document.getElementById('audioFullscreen');

  if (document.webkitFullscreenElement) {
    if (overlay) {
      overlay.classList.remove('hidden');
      setupOverlayAutoHide();
    }
  } else {
    if (overlay) {
      overlay.classList.add('hidden');
      stopOverlayAutoHide();
    }
    if (fsContainer && fsContainer.style.display !== 'none') {
      fsContainer.style.display = 'none';
    }
  }
});

/* ==================== KEYBOARD SHORTCUTS ==================== */
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  const fsContainer = document.getElementById('audioFullscreen');
  const isAudioFsOpen = fsContainer && fsContainer.style.display !== 'none';

  // Escape: exit audio fullscreen or close YouTube player
  if (e.key === 'Escape') {
    const settings = document.getElementById('settingsModal');
    const editor = document.getElementById('themeEditorModal');
    if (editor && editor.style.display !== 'none') { hideThemeEditor(); return; }
    if (settings && settings.style.display !== 'none') { hideSettingsModal(); return; }
    if (isAudioFsOpen) {
      closeAudioFullscreen();
      return;
    }
    if (youtubePlaying) {
      closeYouTubePlayer();
      return;
    }
  }

  const openModal = document.querySelector('.modal-overlay[style*="display: flex"] .modal');
  if (e.key === 'Tab' && openModal) {
    const focusable = [...openModal.querySelectorAll('button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')];
    if (focusable.length) {
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  // Space: play/pause (except when typing in input)
  if (e.key === ' ') {
    if (isInput) return;
    e.preventDefault();
    if (youtubePlaying) {
      // Focus iframe for YouTube play/pause via its internal handler
      const iframe = document.querySelector('.youtube-iframe');
      if (iframe) iframe.focus();
      return;
    }
    togglePlayPause();
    return;
  }
  // Arrow keys, F, M: only when not typing and no modifier held
  if (!isInput && !e.ctrlKey && !e.altKey && !e.metaKey) {
    const el = isVideo ? video : audio;
    if (e.key === 'ArrowLeft' && el) {
      e.preventDefault();
      el.currentTime = Math.max(0, el.currentTime - 10);
      if (isAudioFsOpen) updateAudioFullscreenUI();
    }
    else if (e.key === 'ArrowRight' && el) {
      e.preventDefault();
      el.currentTime = Math.min(el.duration || 0, el.currentTime + 10);
      if (isAudioFsOpen) updateAudioFullscreenUI();
    }
    else if (e.key === 'ArrowUp') { e.preventDefault(); adjustVolume(0.05); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); adjustVolume(-0.05); }
    else if (e.key === 'f' || e.key === 'F') { toggleFullscreen(); }
    else if (e.key === 'm' || e.key === 'M') { toggleMute(); }
  }
});

function adjustVolume(delta) {
  const fill = document.getElementById('volumeFill');
  let current = parseFloat(fill.style.width) / 100;
  if (isNaN(current)) current = 1;
  const p = Math.max(0, Math.min(1, current + delta));
  fill.style.width = `${p * 100}%`;
  if (audio) audio.volume = p;
  if (video) video.volume = p;
  localStorage.setItem('volume', p);
}

function playNextInSequence() {
  if (playQueue.length > 0) {
    const next = getNextFromQueue();
    updateQueueBadge();
    if (next.track.type === 'immich') {
      playTrackDirect(next.track);
    } else {
      playTrack(next.path, false);
    }
    return;
  }
  const list = getVisibleTracks();
  if (!list.length) return;

  if (isShuffle) {
    const idx = Math.floor(Math.random() * list.length);
    const next = list[idx];
    if (next.type === 'immich') {
      playTrackDirect(next);
    } else {
      playTrack(encodeURIComponent(next.path), true);
    }
    return;
  }
  if (repeatMode === 'all') {
    const curPath = allTracks[currentIndex]?.path;
    const curIdx = list.findIndex(t => t.path === curPath);
    const nextIdx = curIdx < list.length - 1 ? curIdx + 1 : 0;
    if (nextIdx !== -1) {
      const next = list[nextIdx];
      if (next.type === 'immich') {
        playTrackDirect(next);
      } else {
        playTrack(encodeURIComponent(next.path), true);
      }
    }
  }
}

function togglePlayPause() {
  if (!audio && !video) {
    const list = getVisibleTracks();
    if (list.length > 0) playTrack(encodeURIComponent(list[0].path));
    return;
  }
  const el = isVideo ? video : audio;
  if (!el) return;
  if (el.paused) {
    el.play().then(() => updatePlayPauseBtn(true)).catch(() => updatePlayPauseBtn(false));
  } else {
    el.pause();
    updatePlayPauseBtn(false);
  }
}

function updatePlayPauseBtn(playing) {
  document.getElementById('playPauseBtn').textContent = playing ? '⏸' : '▶';
  const fsPlayPauseBtn = document.getElementById('audioFullscreenPlayPauseBtn');
  if (fsPlayPauseBtn) fsPlayPauseBtn.textContent = playing ? '⏸' : '▶';
}

function prevTrack() {
  const list = getVisibleTracks();
  if (!list.length) return;
  const curPath = allTracks[currentIndex]?.path;
  const curIdx = list.findIndex(t => t.path === curPath);
  if (curIdx > 0) {
    playTrack(encodeURIComponent(list[curIdx - 1].path));
  } else if (repeatMode === 'all') {
    playTrack(encodeURIComponent(list[list.length - 1].path));
  }
}

function nextTrack() {
  playNextInSequence();
}

function playAll() {
  const list = getVisibleTracks();
  if (list.length > 0) playTrack(encodeURIComponent(list[0].path));
}

function toggleShuffle() {
  isShuffle = !isShuffle;
  document.getElementById('shuffleBtn').classList.toggle('active', isShuffle);
  if (isShuffle && playQueue.length > 0) {
    shuffleArray(playQueue);
    if (isQueueOpen()) renderQueueContent();
    updateQueueBadge();
  }
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function toggleRepeat() {
  const modes = ['none', 'all', 'one'];
  repeatMode = modes[(modes.indexOf(repeatMode) + 1) % 3];
  const btn = document.getElementById('repeatBtn');
  btn.classList.toggle('active', repeatMode !== 'none');
  btn.textContent = repeatMode === 'one' ? '↻¹' : '↻';
}

function seekTo(e) {
  const el = isVideo ? video : audio;
  if (!el || !el.duration) return;
  el.currentTime = (e.offsetX / e.target.offsetWidth) * el.duration;
}

function setVolume(e) {
  const p = Math.max(0, Math.min(1, e.offsetX / e.target.offsetWidth));
  document.getElementById('volumeFill').style.width = `${p * 100}%`;
  if (audio) audio.volume = p;
  if (video) video.volume = p;
  localStorage.setItem('volume', p);
}

function volumeWheel(e) {
  e.preventDefault();
  const fill = document.getElementById('volumeFill');
  const current = parseFloat(fill.style.width) / 100 || 1;
  const step = e.deltaY > 0 ? -0.05 : 0.05;
  const p = Math.max(0, Math.min(1, current + step));
  fill.style.width = `${p * 100}%`;
  if (audio) audio.volume = p;
  if (video) video.volume = p;
  localStorage.setItem('volume', p);
}

function toggleMute() {
  const el = isVideo ? video : audio;
  if (!el) return;
  el.muted = !el.muted;
  document.getElementById('volumeFill').style.width = el.muted ? '0%' : '100%';
}

/* ==================== PERSISTENCE ==================== */
const SAVE_KEY_TRACK = 'lastTrack';
const SAVE_KEY_TIME = 'lastTime';
const SAVE_KEY_QUEUE = 'lastQueue';

function onTimeUpdate(el) {
  if (!el.duration) return;
  document.getElementById('progressFill').style.width = `${(el.currentTime / el.duration) * 100}%`;
  document.getElementById('currentTime').textContent = formatTime(el.currentTime);
  document.getElementById('duration').textContent = formatTime(el.duration);
  savePositionThrottled(el.currentTime);
  updateLyricsHighlight(el.currentTime);

  const fsContainer = document.getElementById('audioFullscreen');
  if (fsContainer && fsContainer.style.display !== 'none') {
    const progressFill = document.getElementById('audioFullscreenProgressFill');
    const currentTimeEl = document.getElementById('audioFullscreenCurrentTime');
    const durationEl = document.getElementById('audioFullscreenDuration');
    if (progressFill) progressFill.style.width = `${(el.currentTime / el.duration) * 100}%`;
    if (currentTimeEl) currentTimeEl.textContent = formatTime(el.currentTime);
    if (durationEl) durationEl.textContent = formatTime(el.duration);
    updateFullscreenLyricsHighlight(el.currentTime);
  }
}

function persistTrack(encodedPath) {
  localStorage.setItem(SAVE_KEY_TRACK, encodedPath);
  saveQueue();
}

function savePositionThrottled(t) {
  if (savePositionThrottled.timer) return;
  savePositionThrottled.timer = setTimeout(() => {
    localStorage.setItem(SAVE_KEY_TIME, t);
    savePositionThrottled.timer = null;
  }, 2000);
}

function saveQueue() {
  const data = playQueue.map(q => ({ path: q.path, track: q.track }));
  localStorage.setItem(SAVE_KEY_QUEUE, JSON.stringify(data));
}

function restorePlayback() {
  const savedTrack = localStorage.getItem(SAVE_KEY_TRACK);
  const savedTime = parseFloat(localStorage.getItem(SAVE_KEY_TIME)) || 0;
  const savedVolume = parseFloat(localStorage.getItem('volume'));

  if (savedVolume && !isNaN(savedVolume)) {
    document.getElementById('volumeFill').style.width = `${savedVolume * 100}%`;
  }

  if (!savedTrack || !allTracks.some(t => encodeURIComponent(t.path) === savedTrack)) return;

  const savedQueue = localStorage.getItem(SAVE_KEY_QUEUE);
  if (savedQueue) {
    try {
      playQueue = JSON.parse(savedQueue);
      updateQueueBadge();
    } catch (_) {}
  }

  window._restoreTrack = savedTrack;
  window._restoreTime = savedTime;

  const bar = document.getElementById('restoreBar');
  if (bar) {
    bar.style.display = 'flex';
    bar.dataset.countdown = '2';
    document.getElementById('restoreCountdown').textContent = '2';
    const cd = setInterval(() => {
      const n = parseInt(bar.dataset.countdown, 10) - 1;
      bar.dataset.countdown = n;
      document.getElementById('restoreCountdown').textContent = n;
      if (n <= 0) {
        clearInterval(cd);
        autoResume();
      }
    }, 1000);
    window._restoreTimer = cd;
  }
  document.getElementById('restoreTrackName').textContent =
    cleanName(allTracks.find(t => encodeURIComponent(t.path) === savedTrack)?.name || '');
}

function resumePlayback() {
  const track = window._restoreTrack;
  const time = window._restoreTime || 0;
  if (!track) return;
  clearSavedState();
  playTrack(track, true);
  const el = isVideo ? video : audio;
  const wait = setInterval(() => {
    if (el && el.readyState >= 2) {
      el.currentTime = time;
      clearInterval(wait);
    }
  }, 100);
  setTimeout(() => clearInterval(wait), 10000);
  document.getElementById('restoreBar').style.display = 'none';
}

function autoResume() {
  if (!window._restoreTrack) return;
  resumePlayback();
}

function clearSavedState() {
  localStorage.removeItem(SAVE_KEY_TRACK);
  localStorage.removeItem(SAVE_KEY_TIME);
  localStorage.removeItem(SAVE_KEY_QUEUE);
}

function dismissRestore() {
  clearSavedState();
  if (window._restoreTimer) clearInterval(window._restoreTimer);
  document.getElementById('restoreBar').style.display = 'none';
}

/* ==================== IMMICH CONFIG LOAD ==================== */
async function loadImmichConfig() {
  try {
    const res = await fetch(`${API_BASE}/immich/config`);
    immichConfig = await res.json();
  } catch (_) { immichConfig = { url: '', connected: false }; }
  renderImmichSidebar();
}

/* ==================== INIT ==================== */
initTheme();
document.getElementById('volumeBar').addEventListener('wheel', volumeWheel, { passive: false });
(async () => {
  const authed = await checkAuth();
  if (authed) initApp();
})();
