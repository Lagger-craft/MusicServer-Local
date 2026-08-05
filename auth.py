import functools
import logging

from flask import session, jsonify, request
from werkzeug.security import generate_password_hash, check_password_hash

logger = logging.getLogger(__name__)


def _get_auth():
    from config import get_config
    return get_config().get("auth", {})


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
    stored = _get_auth().get(username)
    if not stored:
        return False
    return check_password_hash(stored, password)


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
