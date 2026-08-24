import time

from cache import PathCache


def test_get_set_and_ttl():
    c = PathCache(ttl=1, max_entries=5)
    c.set("k", "v")
    assert c.get("k") == "v"
    assert c.is_fresh("k") is True
    time.sleep(1.1)
    # After TTL expires, get returns None and evicts the entry.
    assert c.get("k") is None


def test_lru_eviction():
    c = PathCache(ttl=1000, max_entries=3)
    for i in range(3):
        c.set(f"k{i}", i)
    # Touch k0 so k1 becomes the least-recently-used entry.
    assert c.get("k0") == 0
    c.set("k3", 3)  # exceeds max_entries -> evicts k1
    assert c.get("k1") is None
    assert c.get("k0") == 0
    assert c.get("k2") == 2
    assert c.get("k3") == 3


def test_invalidate():
    c = PathCache(ttl=1000, max_entries=5)
    c.set("a", 1)
    c.invalidate("a")
    assert c.get("a") is None
    c.set("b", 2)
    c.invalidate()
    assert c.get("b") is None
