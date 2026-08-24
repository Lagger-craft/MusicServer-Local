import os
import uuid

from files import resolve_path


def _make_temp():
    name = f"__meta_{uuid.uuid4().hex}.mp3"
    d, rel = resolve_path("main/" + name)
    full = os.path.join(d["path"], rel)
    os.makedirs(d["path"], exist_ok=True)
    with open(full, "w") as f:
        f.write("not audio")
    return "main/" + name, full


def test_traversal_returns_403(client):
    # Threat-matrix routing case: path traversal must be rejected with 4xx.
    resp = client.get("/api/metadata?path=" + "../../etc/passwd")
    assert resp.status_code == 403


def test_missing_returns_404(client):
    resp = client.get("/api/metadata?path=" + "main/__nope_xyz.mp3")
    assert resp.status_code == 404


def test_untagged_returns_200_fallback(client):
    path, full = _make_temp()
    try:
        resp = client.get("/api/metadata?path=" + path)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["title"] == os.path.splitext(path.split("/")[-1])[0]
        assert data["artist"] is None
        assert data["path"] == path
        assert set(data.keys()) >= {
            "artist",
            "title",
            "album",
            "duration",
            "cover",
            "path",
        }
        # Second call is served from the PathCache (still 200).
        resp2 = client.get("/api/metadata?path=" + path)
        assert resp2.status_code == 200
    finally:
        if os.path.exists(full):
            os.remove(full)
