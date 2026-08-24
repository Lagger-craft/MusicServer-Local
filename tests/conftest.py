import os
import shutil
import tempfile

import pytest

import files
from app import app


@pytest.fixture(scope="session", autouse=True)
def temp_music_dir():
    """Redirect the 'main' music dir to a writable temp dir for tests.

    The project's real music/ directory is owned by root (created by Docker),
    so tests cannot write fixtures there. We patch files.get_music_dirs so
    resolve_path maps 'main' to a temp dir owned by the test user.
    """
    tmp = tempfile.mkdtemp(prefix="music_test_")

    def _fake_dirs():
        return [{"key": "main", "path": os.path.abspath(tmp)}]

    original = files.get_music_dirs
    files.get_music_dirs = _fake_dirs
    yield tmp
    files.get_music_dirs = original
    shutil.rmtree(tmp, ignore_errors=True)


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as c:
        with c.session_transaction() as sess:
            sess["user"] = "test"
        yield c
