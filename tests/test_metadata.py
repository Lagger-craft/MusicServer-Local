import os
import uuid

from files import resolve_path
from metadata import get_metadata, parse_filename


def test_parse_filename_no_separator():
    r = parse_filename("My Song.mp3")
    assert r["title"] == "My Song"
    assert r["artist"] is None
    assert r["album"] is None


def test_parse_filename_artist_title():
    r = parse_filename("Daft Punk - Around the World.mp3")
    assert r["artist"] == "Daft Punk"
    assert r["title"] == "Around the World"
    assert r["album"] is None


def test_parse_filename_artist_title_album():
    r = parse_filename("Artist - Title - Album Name.mp3")
    assert r["artist"] == "Artist"
    assert r["title"] == "Title"
    assert r["album"] == "Album Name"


def test_parse_filename_three_part_album_with_dash():
    r = parse_filename("A - T - The - Album.mp3")
    assert r["artist"] == "A"
    assert r["title"] == "T"
    assert r["album"] == "The - Album"


def test_get_metadata_untagged_fallback():
    name = f"__meta_{uuid.uuid4().hex}.mp3"
    d, rel = resolve_path("main/" + name)
    full = os.path.join(d["path"], rel)
    os.makedirs(d["path"], exist_ok=True)
    try:
        with open(full, "w") as f:
            f.write("not audio")
        meta = get_metadata("main/" + name)
        assert meta is not None
        assert meta["title"] == os.path.splitext(name)[0]
        assert meta["artist"] is None
        assert meta["cover"] is False
        assert meta["path"] == "main/" + name
    finally:
        if os.path.exists(full):
            os.remove(full)


def test_get_metadata_missing_returns_none():
    assert get_metadata("main/does_not_exist_xyz.mp3") is None


def test_get_metadata_traversal_returns_none():
    assert get_metadata("../../etc/passwd") is None
