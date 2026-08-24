import collections
import threading
import time
import logging

logger = logging.getLogger(__name__)


class ThreadSafeCache:
    def __init__(self, ttl=10, name="cache"):
        self._data = None
        self._updated = 0.0
        self._ttl = ttl
        self._name = name
        self._lock = threading.Lock()

    def get(self):
        with self._lock:
            if self._data is not None and time.time() - self._updated < self._ttl:
                return self._data
            return None

    def get_all(self):
        with self._lock:
            return self._data, self._updated

    def set(self, data):
        with self._lock:
            self._data = data
            self._updated = time.time()

    def invalidate(self, reason="unknown"):
        with self._lock:
            was_valid = self._data is not None
            self._data = None
            self._updated = 0.0
            if was_valid:
                logger.debug("Cache '%s' invalidated: %s", self._name, reason)

    def is_fresh(self):
        with self._lock:
            return self._data is not None and time.time() - self._updated < self._ttl

    def get_ttl(self):
        return self._ttl

    def set_ttl(self, ttl):
        with self._lock:
            self._ttl = ttl


class PathCache:
    """Per-path cache with per-entry TTL and LRU eviction.

    Unlike ThreadSafeCache (single value), PathCache stores many values
    keyed by path. Each entry expires after ``ttl`` seconds; when more than
    ``max_entries`` are stored, the least-recently-used entry is evicted.
    """

    def __init__(self, ttl=3600, max_entries=500, name="pathcache"):
        self._ttl = ttl
        self._max = max(1, int(max_entries))
        self._name = name
        self._data = {}
        self._expires = {}
        self._lru = collections.OrderedDict()
        self._lock = threading.Lock()

    def get(self, key):
        with self._lock:
            if key not in self._data:
                return None
            if time.time() >= self._expires[key]:
                self._pop(key)
                return None
            self._lru.move_to_end(key)
            return self._data[key]

    def set(self, key, value):
        with self._lock:
            now = time.time()
            self._data[key] = value
            self._expires[key] = now + self._ttl
            self._lru[key] = True
            self._lru.move_to_end(key)
            while len(self._lru) > self._max:
                old, _ = self._lru.popitem(last=False)
                self._data.pop(old, None)
                self._expires.pop(old, None)

    def _pop(self, key):
        self._data.pop(key, None)
        self._expires.pop(key, None)
        self._lru.pop(key, None)

    def invalidate(self, key=None):
        with self._lock:
            if key is None:
                self._data.clear()
                self._expires.clear()
                self._lru.clear()
            else:
                self._pop(key)

    def is_fresh(self, key):
        with self._lock:
            if key not in self._data:
                return False
            return time.time() < self._expires[key]

    def get_ttl(self):
        return self._ttl

    def set_ttl(self, ttl):
        with self._lock:
            self._ttl = ttl
