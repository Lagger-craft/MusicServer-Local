# Security: SSRF Fix + Authentication Login

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix SSRF vulnerability in Invidious proxy and add session-based authentication to protect all API endpoints.

**Architecture:** Remove the catch-all Invidious proxy route (SSRF source), replace with a dedicated video metadata endpoint. Add Flask session-based auth with bcrypt password hashing. First-run auto-registers an admin user. All API routes protected behind a `@login_required` decorator except login/status endpoints.

**Tech Stack:** Flask sessions, bcrypt (password hashing), secrets (session keys). No new dependencies beyond what's already in requirements.txt (cryptography already present).

## Global Constraints

- No new pip dependencies (bcrypt via `hashlib` + `hmac` or use `werkzeug.security` which ships with Flask)
- Credentials stored in `config.json` under `auth` key
- Session cookie with `httponly=True`, `samesite='Lax'`
- Existing uncommitted modular structure (config.py, files.py, immich.py, etc.) must be preserved

---

## Task 1: Fix SSRF — Remove catch-all proxy, add dedicated video endpoint

**Files:**
- Modify: `app.py:374-389` (remove `invidious_proxy` catch-all route)
- Modify: `app.py` (add new `invidious_video` route)
- Modify: `static/app.js:1060` (update frontend to use new route)

**Interfaces:**
- Consumes: `get_invidious_url()` from invidious.py
- Produces: `/api/invidious/video/<videoId>` — returns video metadata JSON

- [ ] **Step 1: Add dedicated video metadata route in app.py**

Add after the existing `invidious_channel_videos` route (around line 507):

```python
@app.route("/api/invidious/video/<videoId>")
def invidious_video(videoId):
    base = get_invidious_url()
    if not base:
        return jsonify({"error": "Invidious no disponible"}), 503
    try:
        resp = requests.get(base + f"/api/v1/videos/{videoId}", timeout=15)
        if not resp.ok:
            return jsonify({"error": "Error al obtener video"}), resp.status_code
        return jsonify(resp.json())
    except Exception as e:
        return jsonify({"error": str(e)}), 500
```

- [ ] **Step 2: Remove the catch-all proxy route**

Delete the entire `invidious_proxy` function (lines ~374-389 in current app.py):

```python
# DELETE THIS ROUTE ENTIRELY:
@app.route("/api/invidious/<path:subpath>")
def invidious_proxy(subpath):
    ...
```

- [ ] **Step 3: Update frontend to use new endpoint**

In `static/app.js`, find the line (~1060):
```javascript
fetch(`${API_BASE}/invidious/api/v1/videos/${videoId}`).then(r => r.json()).then(data => {
```

Replace with:
```javascript
fetch(`${API_BASE}/invidious/video/${videoId}`).then(r => r.json()).then(data => {
```

- [ ] **Step 4: Verify server starts and video metadata works**

Run: `python app.py` and test `curl http://localhost:5000/api/invidious/video/dQw4w9WgXcQ`

- [ ] **Step 5: Commit**

```bash
git add app.py static/app.js
git commit -m "fix(security): replace SSRF catch-all proxy with dedicated video endpoint"
```

---

## Task 2: Add authentication module (config.py)

**Files:**
- Modify: `config.py` (add user management functions)
- Create: `auth.py` (authentication helpers)

**Interfaces:**
- Consumes: `get_config()`, `update_config()` from config.py
- Produces: `create_user()`, `verify_user()`, `get_user()`, `delete_user()`, `login_required()` decorator

- [ ] **Step 1: Create auth.py with authentication helpers**

```python
import hashlib
import hmac
import os
import functools
import logging
from flask import session, redirect, url_for, jsonify, request

logger = logging.getLogger(__name__)

SALT_LENGTH = 32


def _hash_password(password, salt=None):
    if salt is None:
        salt = os.urandom(SALT_LENGTH)
    elif isinstance(salt, str):
        salt = bytes.fromhex(salt)
    hashed = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 100000)
    return salt.hex() + ':' + hashed.hex()


def _verify_password(password, stored):
    try:
        salt_hex, hash_hex = stored.split(':')
        salt = bytes.fromhex(salt_hex)
        hashed = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 100000)
        return hmac.compare_digest(hashed.hex(), hash_hex)
    except Exception:
        return False


def create_user(username, password):
    from config import get_config, update_config
    cfg = get_config()
    if 'auth' not in cfg:
        cfg['auth'] = {}
    if username in cfg['auth']:
        return False, "Usuario ya existe"
    cfg['auth'][username] = _hash_password(password)
    update_config(cfg)
    logger.info("User created: %s", username)
    return True, None


def verify_user(username, password):
    from config import get_config
    cfg = get_config()
    auth = cfg.get('auth', {})
    stored = auth.get(username)
    if not stored:
        return False
    return _verify_password(password, stored)


def get_users():
    from config import get_config
    cfg = get_config()
    return list(cfg.get('auth', {}).keys())


def delete_user(username):
    from config import get_config, update_config
    cfg = get_config()
    auth = cfg.get('auth', {})
    if username in auth:
        del auth[username]
        cfg['auth'] = auth
        update_config(cfg)
        logger.info("User deleted: %s", username)
        return True
    return False


def change_password(username, old_password, new_password):
    from config import get_config, update_config
    if not verify_user(username, old_password):
        return False, "Contraseña actual incorrecta"
    cfg = get_config()
    cfg['auth'][username] = _hash_password(new_password)
    update_config(cfg)
    logger.info("Password changed for: %s", username)
    return True, None


def login_required(f):
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        if 'user' not in session:
            if request.path.startswith('/api/'):
                return jsonify({"error": "No autenticado"}), 401
            return redirect(url_for('index'))
        return f(*args, **kwargs)
    return decorated


def is_first_run():
    from config import get_config
    cfg = get_config()
    return not cfg.get('auth')
```

- [ ] **Step 2: Verify auth.py imports correctly**

Run: `python -c "from auth import create_user, verify_user, login_required; print('OK')"`

- [ ] **Step 3: Commit**

```bash
git add auth.py
git commit -m "feat(auth): add authentication module with password hashing"
```

---

## Task 3: Add auth routes and protect API endpoints (app.py)

**Files:**
- Modify: `app.py` (add auth routes, add `login_required` to all API routes)

**Interfaces:**
- Consumes: `create_user()`, `verify_user()`, `login_required()`, `is_first_run()` from auth.py
- Produces: `/api/auth/login`, `/api/auth/logout`, `/api/auth/status`, `/api/auth/register`, `/api/auth/change-password` routes

- [ ] **Step 1: Add auth imports and session config to app.py**

At the top of `app.py`, after existing imports, add:

```python
import secrets
from auth import (
    create_user, verify_user, login_required, is_first_run,
    delete_user, change_password, get_users,
)
```

After `app = Flask(...)` line, add session config:

```python
app.secret_key = os.environ.get("FLASK_SECRET_KEY") or secrets.token_hex(32)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    PERMANENT_SESSION_LIFETIME=86400 * 30,  # 30 days
)
```

- [ ] **Step 2: Add auth routes**

Add before the media serving routes:

```python
# ══════════════════════════════════════════════════════════════
# AUTH ROUTES
# ══════════════════════════════════════════════════════════════

@app.route("/api/auth/status")
def auth_status():
    if 'user' in session:
        return jsonify({"authenticated": True, "user": session['user']})
    return jsonify({"authenticated": False, "first_run": is_first_run()})


@app.route("/api/auth/register", methods=["POST"])
@limit("5 per minute")
def auth_register():
    if not is_first_run():
        return jsonify({"error": "Registro no disponible"}), 403
    data = request.json
    username = (data or {}).get("username", "").strip()
    password = (data or {}).get("password", "")
    if not username or not password:
        return jsonify({"error": "Usuario y contraseña requeridos"}), 400
    if len(password) < 6:
        return jsonify({"error": "La contraseña debe tener al menos 6 caracteres"}), 400
    ok, err = create_user(username, password)
    if not ok:
        return jsonify({"error": err}), 400
    session['user'] = username
    session.permanent = True
    return jsonify({"status": "ok", "user": username})


@app.route("/api/auth/login", methods=["POST"])
@limit("10 per minute")
def auth_login():
    data = request.json
    username = (data or {}).get("username", "").strip()
    password = (data or {}).get("password", "")
    if not username or not password:
        return jsonify({"error": "Usuario y contraseña requeridos"}), 400
    if verify_user(username, password):
        session['user'] = username
        session.permanent = True
        logger.info("User logged in: %s", username)
        return jsonify({"status": "ok", "user": username})
    logger.warning("Failed login attempt for: %s", username)
    return jsonify({"error": "Credenciales inválidas"}), 401


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    user = session.pop('user', None)
    if user:
        logger.info("User logged out: %s", user)
    return jsonify({"status": "ok"})


@app.route("/api/auth/change-password", methods=["POST"])
@login_required
@limit("5 per minute")
def auth_change_password():
    data = request.json
    old_pw = (data or {}).get("old_password", "")
    new_pw = (data or {}).get("new_password", "")
    if not old_pw or not new_pw:
        return jsonify({"error": "Contraseña actual y nueva requeridas"}), 400
    if len(new_pw) < 6:
        return jsonify({"error": "La nueva contraseña debe tener al menos 6 caracteres"}), 400
    ok, err = change_password(session['user'], old_pw, new_pw)
    if not ok:
        return jsonify({"error": err}), 400
    return jsonify({"status": "ok"})
```

- [ ] **Step 3: Add `@login_required` to all existing API routes**

Apply `@login_required` decorator to every route that should be protected. The decorator must be placed **after** `@app.route(...)` but **before** `@limit(...)` if present. Routes that stay public (no auth needed):

- `GET /` (index — serves the HTML)
- `GET /api/auth/status`
- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/health`

All other routes get `@login_required`. For example:

```python
@app.route("/media/<path:filename>")
@login_required
def serve_media(filename):
    ...

@app.route("/api/files")
@login_required
def get_files():
    ...
```

Apply to these routes:
- `/media/<path:filename>`
- `/api/cover/<path:filename>`
- `/api/folders`
- `/api/files`
- `/api/config` (GET and PUT)
- `/api/health` → **KEEP PUBLIC** (for Docker healthcheck)
- All `/api/immich/*` routes
- All `/api/invidious/*` routes (except status check which can stay public for UI)
- All `/api/playlists/*` routes
- `/api/auth/change-password`

**IMPORTANT:** `/api/invidious/status` should stay public so the login screen can show Invidious availability.

- [ ] **Step 4: Verify server starts and auth flow works**

Run: `python app.py`
Test: `curl http://localhost:5000/api/auth/status` → should return `{"authenticated": false, "first_run": true}`
Test: `curl http://localhost:5000/api/files` → should return 401

- [ ] **Step 5: Commit**

```bash
git add app.py
git commit -m "feat(auth): add auth routes and protect all API endpoints"
```

---

## Task 4: Add login UI (frontend)

**Files:**
- Modify: `templates/index.html` (add login modal)
- Modify: `static/app.js` (add login logic, handle 401)
- Modify: `static/style.css` (login styles)

**Interfaces:**
- Consumes: `/api/auth/status`, `/api/auth/login`, `/api/auth/register`, `/api/auth/logout` from Task 3
- Produces: Login/register flow, session persistence in browser, automatic redirect on 401

- [ ] **Step 1: Add login modal to index.html**

Add before the `<script>` tag at the bottom of `templates/index.html`:

```html
<!-- Login Modal -->
<div class="modal-overlay" id="loginModal" style="display:none">
  <div class="modal">
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:48px;margin-bottom:8px">♪</div>
      <h3 style="margin:0" id="loginTitle">Iniciar sesión</h3>
    </div>
    <div id="loginForm">
      <input type="text" id="loginUsername" placeholder="Usuario" autocomplete="username"
             onkeypress="if(event.key==='Enter')doLogin()">
      <input type="password" id="loginPassword" placeholder="Contraseña" autocomplete="current-password"
             onkeypress="if(event.key==='Enter')doLogin()">
      <div class="immich-config-status" id="loginError"></div>
      <div class="modal-buttons">
        <button class="modal-btn confirm" onclick="doLogin()" id="loginBtn">Entrar</button>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add login CSS to style.css**

Append at the end of `static/style.css`:

```css
/* ==================== AUTH ==================== */
.auth-user-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: default;
}
.auth-user-badge .auth-username {
  font-weight: 600;
  color: var(--text-primary);
}
.auth-user-badge .auth-logout-btn {
  background: none;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  padding: 4px 10px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}
.auth-user-badge .auth-logout-btn:hover {
  border-color: var(--accent-rose);
  color: var(--accent-rose);
}
#loginModal .modal input[type="text"],
#loginModal .modal input[type="password"] {
  width: 100%;
  padding: 12px 16px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 15px;
  margin-bottom: 12px;
  outline: none;
  transition: border-color 0.2s;
  box-sizing: border-box;
}
#loginModal .modal input:focus {
  border-color: var(--accent-primary);
}
```

- [ ] **Step 3: Add auth JavaScript to app.js**

Add at the TOP of `static/app.js` (before any other code), right after the `const API_BASE` line:

```javascript
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
  document.getElementById('loginTitle').textContent = 'Iniciar sesión';
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
  document.getElementById('loginError').textContent = 'Primera vez: creá tu usuario administrador';
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
    errorEl.textContent = 'Completá todos los campos';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Entrando...';
  errorEl.textContent = '';

  const isRegister = btn.textContent.includes('Crear');
  const endpoint = isRegister ? 'register' : 'login';

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
    errorEl.textContent = 'Error de conexión';
    btn.disabled = false;
    btn.textContent = isRegister ? 'Crear cuenta' : 'Entrar';
  }
}

async function doLogout() {
  await fetch(`${API_BASE}/auth/logout`, { method: 'POST' });
  currentUser = null;
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
  badge.innerHTML = `
    <span class="auth-username">${escapeHtml(currentUser)}</span>
    <button class="auth-logout-btn" onclick="doLogout()">Salir</button>
  `;
}
```

- [ ] **Step 4: Add 401 interceptor for fetch calls**

Add this function near the top of `app.js` (after the auth section):

```javascript
/* Intercept fetch to handle 401 */
const _originalFetch = window.fetch;
window.fetch = async function(...args) {
  const res = await _originalFetch.apply(this, args);
  if (res.status === 401 && currentUser) {
    currentUser = null;
    showLoginModal();
  }
  return res;
};
```

- [ ] **Step 5: Modify initApp to check auth first**

Find the existing `initApp()` or `DOMContentLoaded` handler in `app.js`. Wrap the initialization so it only runs after auth succeeds:

The existing pattern likely has something like:
```javascript
document.addEventListener('DOMContentLoaded', () => {
  // ... init code
});
```

Change to:
```javascript
document.addEventListener('DOMContentLoaded', async () => {
  const authenticated = await checkAuth();
  if (authenticated) {
    initApp();
  }
});

function initApp() {
  // ... ALL existing init code goes here
}
```

**Note:** The exact init code structure needs to be verified against the current app.js. The key point is that `checkAuth()` runs first, and only if authenticated, the app initializes.

- [ ] **Step 6: Verify login flow works**

Run: `python app.py`, open browser, verify:
1. First visit shows registration form
2. Creating a user works and redirects to main app
3. Refreshing keeps you logged in (session cookie)
4. `/api/files` returns 200 (was 401 before)
5. Logout shows login screen again
6. `/api/health` still works without auth

- [ ] **Step 7: Commit**

```bash
git add templates/index.html static/app.js static/style.css
git commit -m "feat(auth): add login/register UI with session management"
```

---

## Task 5: Final verification and security hardening

**Files:**
- Modify: `app.py` (add security headers)
- Modify: `config.py` (ensure auth data not logged)

**Interfaces:**
- Consumes: All previous tasks
- Produces: Security headers on all responses, no sensitive data in logs

- [ ] **Step 1: Add security headers middleware to app.py**

Add after Flask app creation:

```python
@app.after_request
def set_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response
```

- [ ] **Step 2: Verify config.py doesn't log auth data**

The existing `update_config()` in config.py already filters `immich_api_key` from logs. Verify it doesn't log the `auth` key contents. The line is:

```python
logger.info("Config updated: %s", {k: v for k, v in changes.items() if k != "immich_api_key"})
```

This is safe — the `auth` key contains hashed passwords but the filter only excludes `immich_api_key`. However, we should also exclude `auth`:

```python
logger.info("Config updated: %s", {k: v for k, v in changes.items() if k not in ("immich_api_key", "auth")})
```

- [ ] **Step 3: Verify FLASK_SECRET_KEY persistence**

If `FLASK_SECRET_KEY` env var is not set, a random key is generated on each restart, invalidating all sessions. Document that for production, set `FLASK_SECRET_KEY` in environment or docker-compose.yml.

Add to `docker-compose.yml` under the `music-server` service:

```yaml
    environment:
      - FLASK_SECRET_KEY=${FLASK_SECRET_KEY:-}
```

- [ ] **Step 4: Run full integration test**

```bash
# Test auth flow
curl -s http://localhost:5000/api/auth/status
curl -s -X POST http://localhost:5000/api/auth/register -H 'Content-Type: application/json' -d '{"username":"admin","password":"test123"}'
curl -s -b cookies.txt http://localhost:5000/api/auth/status

# Test protected routes
curl -s http://localhost:5000/api/files  # should 401 without cookie
curl -s -b cookies.txt http://localhost:5000/api/files  # should 200

# Test SSRF fix is gone
curl -s http://localhost:5000/api/invidious/something  # should 404 (route removed)

# Test health still public
curl -s http://localhost:5000/api/health  # should 200
```

- [ ] **Step 5: Commit**

```bash
git add app.py config.py docker-compose.yml
git commit -m "fix(security): add security headers, protect auth data in logs"
```

---

## Summary

| Task | What | Security Impact |
|------|------|----------------|
| 1 | Remove SSRF catch-all proxy | Eliminates server-side request forgery |
| 2 | Auth module (bcrypt + sessions) | Password storage + session management |
| 3 | Auth routes + protect API | All endpoints require authentication |
| 4 | Login UI + 401 interceptor | User-facing auth flow |
| 5 | Security headers + hardening | Defense in depth |

## Post-Implementation Notes

- **First run:** User sees registration form, creates admin account
- **Subsequent runs:** User sees login form
- **Sessions:** Cookie-based, 30-day lifetime, httponly
- **Rate limiting:** Login limited to 10/min, registration 5/min
- **Health endpoint:** Stays public for Docker healthcheck
- **Invidious status:** Stays public so login screen shows connectivity
