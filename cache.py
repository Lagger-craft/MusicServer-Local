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
