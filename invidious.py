import concurrent.futures
import logging
import time

import requests

from cache import ThreadSafeCache
from config import decrypt_value, encrypt_value, get_config, update_config

logger = logging.getLogger(__name__)

INVIDIOUS_URLS = ["http://invidious:3000", "http://localhost:3000"]

_invidious_url_cache = ThreadSafeCache(ttl=60, name="invidious_url")
_feed_cache = ThreadSafeCache(ttl=300, name="invidious_feed")


def get_invidious_url():
    cached = _invidious_url_cache.get()
    if cached is not None:
        return cached

    for url in INVIDIOUS_URLS:
        try:
            r = requests.get(url + "/api/v1/stats", timeout=3)
            if r.ok:
                _invidious_url_cache.set(url)
                logger.debug("Invidious available at %s", url)
                return url
        except Exception:
            continue
    logger.warning("No Invidious instance available")
    return None


def get_invidious_sid():
    cfg = get_config()
    return decrypt_value(cfg.get("invidious_sid", ""))


def save_invidious_sid(sid):
    cfg = get_config()
    cfg["invidious_sid"] = encrypt_value(sid) if sid else ""
    update_config(cfg)


def invidious_auth_headers():
    sid = get_invidious_sid()
    h = {"Content-Type": "application/json"}
    if sid:
        h["Cookie"] = f"SID={sid}"
    return h


def invidious_auth_get(path):
    base = get_invidious_url()
    if not base:
        return None, "Invidious no disponible"
    try:
        resp = requests.get(base + path, headers=invidious_auth_headers(), timeout=15)
        if resp.status_code == 401:
            return None, "Sesión expirada"
        resp.raise_for_status()
        return resp.json(), None
    except Exception as e:
        return None, str(e)


def invidious_auth_post(path, data=None):
    base = get_invidious_url()
    if not base:
        return None, "Invidious no disponible"
    try:
        resp = requests.post(base + path, json=data or {},
                             headers=invidious_auth_headers(), timeout=15)
        if resp.status_code == 401:
            return None, "Sesión expirada"
        resp.raise_for_status()
        if resp.status_code == 204 or not resp.content:
            return {"status": "ok"}, None
        return resp.json(), None
    except Exception as e:
        return None, str(e)


def get_feed(max_results=50):
    cached = _feed_cache.get()
    if cached is not None:
        return cached[:max_results]

    subs, err = invidious_auth_get("/api/v1/auth/subscriptions")
    if err:
        return None
    if not subs:
        return []

    base = get_invidious_url()
    if not base:
        return []

    videos = []
    seen = set()

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        futures = {
            pool.submit(
                requests.get,
                base + f"/api/v1/channels/{ch.get('authorId') or ch.get('ucid') or ''}/videos",
                params={"sort": "newest"},
                timeout=10,
            ): ch
            for ch in subs if ch.get("authorId") or ch.get("ucid")
        }
        for future in concurrent.futures.as_completed(futures):
            try:
                resp = future.result()
                if not resp.ok:
                    continue
                channel_data = resp.json()
                channel_videos = channel_data if isinstance(channel_data, list) else channel_data.get("videos", [])
                for v in channel_videos[:5]:
                    vid = v.get("videoId")
                    if vid and vid not in seen:
                        seen.add(vid)
                        videos.append(v)
            except Exception:
                continue

    videos.sort(key=lambda v: v.get("published") or 0, reverse=True)
    _feed_cache.set(videos)
    logger.debug("Feed: %d videos from %d subscriptions", len(videos), len(subs))
    return videos[:max_results]


def invalidate_feed_cache():
    _feed_cache.invalidate(reason="feed refresh requested")
