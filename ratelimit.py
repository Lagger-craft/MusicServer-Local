import logging
import os
import sqlite3
import time
import threading
from functools import wraps

logger = logging.getLogger(__name__)

DB_PATH = "rate_limits.db"
_lock = threading.Lock()


def _get_db():
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS rate_limits (
            key TEXT PRIMARY KEY,
            window_start REAL,
            count INTEGER DEFAULT 0
        )
    """)
    conn.commit()
    return conn


def _cleanup_old():
    """Remove entries older than 1 hour."""
    try:
        conn = _get_db()
        cutoff = time.time() - 3600
        conn.execute("DELETE FROM rate_limits WHERE window_start < ?", (cutoff,))
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error("Rate limit cleanup failed: %s", e)


def is_rate_limited(key, max_requests, window_seconds):
    """Check if a key is rate limited. Returns (limited: bool, remaining: int)."""
    now = time.time()
    window_start = now - (now % window_seconds)

    with _lock:
        try:
            conn = _get_db()
            row = conn.execute(
                "SELECT window_start, count FROM rate_limits WHERE key = ?",
                (key,)
            ).fetchone()

            if row is None or row[0] < window_start:
                # New window or expired
                conn.execute(
                    "INSERT OR REPLACE INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)",
                    (key, window_start)
                )
                conn.commit()
                conn.close()
                return False, max_requests - 1

            if row[1] >= max_requests:
                conn.close()
                return True, 0

            # Increment count
            new_count = row[1] + 1
            conn.execute(
                "UPDATE rate_limits SET count = ? WHERE key = ?",
                (new_count, key)
            )
            conn.commit()
            conn.close()
            return False, max_requests - new_count

        except Exception as e:
            logger.error("Rate limit check failed: %s", e)
            return False, max_requests  # Fail open


def limit(max_requests, window_seconds):
    """Decorator to rate limit a function."""
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            from flask import request, jsonify

            # Use IP + endpoint as key
            ip = request.remote_addr or "unknown"
            endpoint = request.endpoint or f.__name__
            key = f"rate:{endpoint}:{ip}"

            limited, remaining = is_rate_limited(key, max_requests, window_seconds)
            if limited:
                logger.warning("Rate limit exceeded: %s from %s", endpoint, ip)
                return jsonify({"error": "Demasiadas solicitudes. Intenta mas tarde."}), 429

            return f(*args, **kwargs)
        return decorated
    return decorator


# Schedule periodic cleanup (every 10 minutes)
def _start_cleanup():
    def _cleanup_loop():
        while True:
            time.sleep(600)
            _cleanup_old()

    t = threading.Thread(target=_cleanup_loop, daemon=True)
    t.start()


# Initialize on import
_get_db()
_start_cleanup()
