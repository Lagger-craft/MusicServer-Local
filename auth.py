import functools
import logging
import time

from flask import session, jsonify, request
from werkzeug.security import generate_password_hash, check_password_hash

logger = logging.getLogger(__name__)

# Account lockout: {username: (fail_count, lockout_until)}
_login_attempts: dict[str, tuple[int, float]] = {}
_MAX_FAILS = 5
_LOCKOUT_SECONDS = 900  # 15 minutes


def _get_auth():
    from config import get_config
    return get_config().get("auth", {})


def _is_locked(username: str) -> bool:
    entry = _login_attempts.get(username)
    if not entry:
        return False
    fails, lockout_until = entry
    if fails >= _MAX_FAILS and time.time() < lockout_until:
        return True
    if time.time() >= lockout_until:
        _login_attempts.pop(username, None)
    return False


def _record_fail(username: str):
    entry = _login_attempts.get(username, (0, 0))
    fails = entry[0] + 1
    if fails >= _MAX_FAILS:
        _login_attempts[username] = (fails, time.time() + _LOCKOUT_SECONDS)
        logger.warning("Account locked: %s (%d failed attempts)", username, fails)
    else:
        _login_attempts[username] = (fails, 0)


def _record_success(username: str):
    _login_attempts.pop(username, None)


def create_user(username, password):
    from config import get_config, update_config
    cfg = get_config()
    if "auth" not in cfg:
        cfg["auth"] = {}
    if username in cfg["auth"]:
        return False, "Usuario ya existe"
    cfg["auth"][username] = generate_password_hash(password, method="scrypt")
    update_config(cfg)
    logger.info("User created: %s", username)
    return True, None


def verify_user(username, password):
    if _is_locked(username):
        return False
    stored = _get_auth().get(username)
    if not stored:
        return False
    if check_password_hash(stored, password):
        _record_success(username)
        return True
    _record_fail(username)
    return False


def delete_user(username):
    from config import get_config, update_config
    cfg = get_config()
    auth = cfg.get("auth", {})
    if username in auth:
        del auth[username]
        cfg["auth"] = auth
        update_config(cfg)
        logger.info("User deleted: %s", username)
        return True
    return False


def change_password(username, old_password, new_password):
    if not verify_user(username, old_password):
        return False, "Contrasena actual incorrecta"
    from config import get_config, update_config
    cfg = get_config()
    cfg["auth"][username] = generate_password_hash(new_password, method="scrypt")
    update_config(cfg)
    logger.info("Password changed for: %s", username)
    return True, None


def is_first_run():
    return not _get_auth()


def login_required(f):
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        if "user" not in session:
            if request.path.startswith("/api/"):
                return jsonify({"error": "No autenticado"}), 401
            from flask import redirect, url_for
            return redirect(url_for("index"))
        return f(*args, **kwargs)
    return decorated
