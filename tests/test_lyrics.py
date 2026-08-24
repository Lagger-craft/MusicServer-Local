import time
from unittest import mock

import lyrics
from lyrics import get_lyrics


def setup_function(item):
    # Reset the module-level rate-limit cooldown between tests.
    lyrics._rate_limited_until = 0.0


def _mock_response(status_code=200, json_data=None, headers=None):
    resp = mock.Mock()
    resp.status_code = status_code
    resp.headers = headers or {}
    resp.ok = 200 <= status_code < 300
    resp.json = mock.Mock(return_value=json_data if json_data is not None else {})
    return resp


def test_lyrics_success_returns_both_fields():
    meta = {"artist": "Daft Punk", "title": "Around the World", "album": "", "duration": 300}
    resp = _mock_response(200, {
        "plainLyrics": "Around the world...",
        "syncedLyrics": "[00:00.00]Around the world...",
        "instrumental": False,
    })
    with mock.patch("lyrics.requests.get", return_value=resp) as m:
        result = get_lyrics("main/song.mp3", meta)
    assert m.called
    assert result["plainLyrics"] == "Around the world..."
    assert result["syncedLyrics"] == "[00:00.00]Around the world..."
    assert result["instrumental"] is False
    assert result["source"] == "lrclib"
    # LRCLIB requires track_name / artist_name (not title / artist).
    _, kwargs = m.call_args
    assert kwargs["params"]["artist_name"] == "Daft Punk"
    assert kwargs["params"]["track_name"] == "Around the World"
    assert "album_name" not in kwargs["params"]


def test_lyrics_includes_album_and_duration_when_present():
    meta = {"artist": "A", "title": "B", "album": "The Album", "duration": 213}
    resp = _mock_response(200, {"plainLyrics": "x", "syncedLyrics": "", "instrumental": False})
    with mock.patch("lyrics.requests.get", return_value=resp) as m:
        get_lyrics("main/s.mp3", meta)
    _, kwargs = m.call_args
    assert kwargs["params"]["album_name"] == "The Album"
    assert kwargs["params"]["duration"] == 213


def test_lyrics_no_match_returns_empty():
    meta = {"artist": "Unknown Artist", "title": "Nonexistent Track"}
    # LRCLIB returns 404 when no lyrics match.
    resp = _mock_response(404, {"name": "TrackNotFound", "message": "not found"})
    with mock.patch("lyrics.requests.get", return_value=resp):
        result = get_lyrics("main/x.mp3", meta)
    assert result == {"plainLyrics": "", "syncedLyrics": "", "instrumental": False, "source": "none"}


def test_lyrics_instrumental_flag_no_body():
    meta = {"artist": "A", "title": "B"}
    resp = _mock_response(200, {"instrumental": True})
    with mock.patch("lyrics.requests.get", return_value=resp):
        result = get_lyrics("main/i.mp3", meta)
    assert result["instrumental"] is True
    assert result["plainLyrics"] == ""
    assert result["syncedLyrics"] == ""


def test_lyrics_missing_artist_title_skips_request():
    with mock.patch("lyrics.requests.get") as m:
        result = get_lyrics("main/s.mp3", {"artist": None, "title": None})
    m.assert_not_called()
    assert result == {"plainLyrics": "", "syncedLyrics": "", "instrumental": False, "source": "none"}


def test_lyrics_none_meta_skips_request():
    with mock.patch("lyrics.requests.get") as m:
        result = get_lyrics("main/s.mp3", None)
    m.assert_not_called()
    assert result == {"plainLyrics": "", "syncedLyrics": "", "instrumental": False, "source": "none"}


def test_lyrics_network_error_is_graceful():
    meta = {"artist": "A", "title": "B"}
    with mock.patch("lyrics.requests.get", side_effect=lyrics.requests.RequestException("boom")):
        result = get_lyrics("main/s.mp3", meta)
    assert result == {"plainLyrics": "", "syncedLyrics": "", "instrumental": False, "source": "none"}


def test_lyrics_non_json_is_graceful():
    meta = {"artist": "A", "title": "B"}
    resp = _mock_response(200, {})
    resp.json.side_effect = ValueError("not json")
    with mock.patch("lyrics.requests.get", return_value=resp):
        result = get_lyrics("main/s.mp3", meta)
    assert result == {"plainLyrics": "", "syncedLyrics": "", "instrumental": False, "source": "none"}


def test_lyrics_429_retry_after_backoff():
    meta = {"artist": "A", "title": "B"}
    resp = _mock_response(429, headers={"Retry-After": "30"})
    with mock.patch("lyrics.requests.get", return_value=resp) as m:
        result = get_lyrics("main/s.mp3", meta)
    # Graceful: no client error, empty result.
    assert result == {"plainLyrics": "", "syncedLyrics": "", "instrumental": False, "source": "none"}
    assert m.called
    # Retry-After honored: cooldown recorded, blocking further calls (backoff).
    assert lyrics._rate_limited_until > time.time()
    with mock.patch("lyrics.requests.get") as m2:
        result2 = get_lyrics("main/s.mp3", meta)
    m2.assert_not_called()
    assert result2 == {"plainLyrics": "", "syncedLyrics": "", "instrumental": False, "source": "none"}


def test_lyrics_unexpected_status_is_graceful():
    meta = {"artist": "A", "title": "B"}
    resp = _mock_response(500, headers={})
    with mock.patch("lyrics.requests.get", return_value=resp):
        result = get_lyrics("main/s.mp3", meta)
    assert result == {"plainLyrics": "", "syncedLyrics": "", "instrumental": False, "source": "none"}
