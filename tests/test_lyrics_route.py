import os
import uuid

from files import resolve_path


def _make_song(name):
    d, rel = resolve_path("main/" + name)
    full = os.path.join(d["path"], rel)
    os.makedirs(d["path"], exist_ok=True)
    with open(full, "w") as f:
        f.write("not audio")
    return "main/" + name, full


def test_lyrics_traversal_returns_403(client):
    # Threat-matrix routing case: path traversal must be rejected with 4xx.
    resp = client.get("/api/lyrics?path=" + "../../etc/passwd")
    assert resp.status_code == 403


def test_lyrics_missing_returns_404(client):
    resp = client.get("/api/lyrics?path=" + "main/__nope_xyz.mp3")
    assert resp.status_code == 404


def test_lyrics_untagged_no_match_returns_200_empty(client, monkeypatch):
    # File named without " - " yields no artist/title, so get_lyrics is never
    # called; route returns an empty 200 (graceful, no error).
    path, full = _make_song("__lyr_%s.mp3" % uuid.uuid4().hex)
    monkeypatch.setattr(
        "app.get_lyrics",
        lambda p, m, audio_full_path=None: {"plainLyrics": "", "syncedLyrics": "", "instrumental": False, "source": "none"},
    )
    try:
        resp = client.get("/api/lyrics?path=" + path)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["plainLyrics"] == ""
        assert data["instrumental"] is False
    finally:
        if os.path.exists(full):
            os.remove(full)


def test_lyrics_success_mocked_lrclib(client, monkeypatch):
    # Named "Artist - Title" so metadata yields artist/title; LRCLIB mocked.
    path, full = _make_song("Artist - Title %s.mp3" % uuid.uuid4().hex)
    monkeypatch.setattr(
        "app.get_lyrics",
        lambda p, m, audio_full_path=None: {
            "plainLyrics": "la la",
            "syncedLyrics": "[00:01.00]la la",
            "instrumental": False,
            "source": "lrclib",
        },
    )
    try:
        resp = client.get("/api/lyrics?path=" + path)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["plainLyrics"] == "la la"
        assert data["syncedLyrics"] == "[00:01.00]la la"
        # Served from lyrics_cache on repeat.
        resp2 = client.get("/api/lyrics?path=" + path)
        assert resp2.status_code == 200
        assert resp2.get_json()["plainLyrics"] == "la la"
    finally:
        if os.path.exists(full):
            os.remove(full)
