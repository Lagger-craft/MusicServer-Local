import json
import logging
import os
import threading

from cache import ThreadSafeCache

logger = logging.getLogger(__name__)

CONFIG_FILE = "config.json"
DEFAULT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "music")

_config_cache = ThreadSafeCache(ttl=5, name="config")


def get_config():
    cached = _config_cache.get()
    if cached is not None:
        return cached

    cfg = {"volume": 100, "shuffle": False, "repeat": "none"}
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE) as f:
                stored = json.load(f)
                cfg.update(stored)
        except (json.JSONDecodeError, OSError) as e:
            logger.error("Failed to read config file: %s", e)

    if "music_dirs" not in cfg or not isinstance(cfg["music_dirs"], list):
        old = cfg.get("music_dir", "")
        if old and os.path.isdir(old):
            cfg["music_dirs"] = [{"key": "main", "path": os.path.abspath(old)}]
        else:
            cfg["music_dirs"] = [{"key": "main", "path": DEFAULT_DIR}]

    _config_cache.set(cfg)
    return cfg


def update_config(changes):
    _config_cache.invalidate(reason="config updated")
    existing = get_config()
    existing.update(changes)
    try:
        with open(CONFIG_FILE, "w") as f:
            json.dump(existing, f, indent=2)
        logger.info("Config updated: %s", {k: v for k, v in changes.items() if k not in ("immich_api_key", "auth")})
    except OSError as e:
        logger.error("Failed to write config file: %s", e)


def get_music_dirs():
    cfg = get_config()
    dirs = []
    for d in cfg.get("music_dirs", []):
        p = d.get("path", "")
        if p and os.path.isdir(p):
            dirs.append({"key": d.get("key", "main"), "path": os.path.abspath(p)})
    if not dirs:
        dirs = [{"key": "main", "path": DEFAULT_DIR}]
    return dirs


# ── Encryption ──────────────────────────────────────────────

SECRET_KEY_FILE = ".secret.key"
_fernet_instance = None
_fernet_lock = threading.Lock()


def _get_fernet():
    global _fernet_instance
    if _fernet_instance is not None:
        return _fernet_instance

    with _fernet_lock:
        if _fernet_instance is not None:
            return _fernet_instance
        from cryptography.fernet import Fernet

        env_key = os.environ.get("IMMICH_ENCRYPTION_KEY")
        if env_key:
            _fernet_instance = Fernet(env_key.encode() if not env_key.endswith("=") else env_key)
            return _fernet_instance
        if not os.path.exists(SECRET_KEY_FILE):
            key = Fernet.generate_key()
            with open(SECRET_KEY_FILE, "wb") as f:
                f.write(key)
            os.chmod(SECRET_KEY_FILE, 0o600)
            logger.info("Generated new encryption key")
        with open(SECRET_KEY_FILE, "rb") as f:
            _fernet_instance = Fernet(f.read())
        return _fernet_instance


def encrypt_value(plaintext):
    if not plaintext:
        return plaintext
    return "__enc__" + _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_value(ciphertext):
    if not ciphertext or not isinstance(ciphertext, str) or not ciphertext.startswith("__enc__"):
        return ciphertext
    try:
        return _get_fernet().decrypt(ciphertext[7:].encode()).decode()
    except Exception as e:
        logger.error("Failed to decrypt value: %s", e)
        return ""


def migrate_immich_key():
    cfg = get_config()
    raw = cfg.get("immich_api_key", "")
    if raw and not raw.startswith("__enc__"):
        cfg["immich_api_key"] = encrypt_value(raw)
        update_config(cfg)
        logger.info("Immich API key migrated to encrypted storage")
