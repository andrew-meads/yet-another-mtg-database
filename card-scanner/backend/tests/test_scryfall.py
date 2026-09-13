"""Tests for the Scryfall HTTP helpers (app.scryfall) with urllib monkeypatched.

No request ever leaves the process: ``urllib.request.urlopen`` is replaced by a
fake that records the Request objects and serves canned responses, and
``time.sleep`` is stubbed so retry/pagination delays cost nothing.
"""

from __future__ import annotations

import io
import json
import urllib.request

import cv2
import numpy as np
import pytest

from app import config, scryfall


class _Response(io.BytesIO):
    """Minimal urlopen() result: a readable context manager."""

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


class FakeUrlopen:
    """Serves ``responses[url]`` in order; an ``Exception`` value is raised instead."""

    def __init__(self, responses: dict[str, list]) -> None:
        self.responses = {k: list(v) for k, v in responses.items()}
        self.requests: list[urllib.request.Request] = []

    def __call__(self, req, timeout=None):
        self.requests.append(req)
        url = req.full_url
        queue = self.responses.get(url)
        if not queue:
            raise AssertionError(f"unexpected request for {url}")
        item = queue.pop(0)
        if isinstance(item, Exception):
            raise item
        if isinstance(item, (dict, list)):
            item = json.dumps(item).encode()
        return _Response(item)


@pytest.fixture
def no_sleep(monkeypatch):
    calls: list[float] = []
    monkeypatch.setattr(scryfall.time, "sleep", lambda s: calls.append(s))
    return calls


def _install(monkeypatch, responses) -> FakeUrlopen:
    fake = FakeUrlopen(responses)
    monkeypatch.setattr(urllib.request, "urlopen", fake)
    return fake


def _jpeg() -> bytes:
    ok, enc = cv2.imencode(".jpg", np.zeros((8, 6, 3), np.uint8))
    assert ok
    return enc.tobytes()


def test_get_json_sends_user_agent_and_accept(monkeypatch):
    url = f"{scryfall.API}/sets/tla"
    fake = _install(monkeypatch, {url: [{"code": "tla", "card_count": 3}]})
    assert scryfall.get_json(url) == {"code": "tla", "card_count": 3}
    req = fake.requests[0]
    assert req.get_header("User-agent") == config.SCRYFALL_USER_AGENT
    assert req.get_header("Accept") == "application/json"


def test_download_image_bytes_retries_then_succeeds(monkeypatch, no_sleep):
    url = "https://cards.scryfall.io/normal/front/a/b/ab.jpg"
    payload = _jpeg()
    fake = _install(monkeypatch, {url: [OSError("reset"), TimeoutError("slow"), payload]})
    assert scryfall.download_image_bytes(url) == payload
    assert len(fake.requests) == 3
    assert no_sleep == [0.5, 1.0], "linear back-off between attempts"
    assert fake.requests[0].get_header("User-agent") == config.SCRYFALL_USER_AGENT


def test_download_image_bytes_gives_up_after_attempts(monkeypatch, no_sleep):
    url = "https://cards.scryfall.io/normal/front/a/b/ab.jpg"
    errors = [OSError(f"fail {i}") for i in range(scryfall.DOWNLOAD_ATTEMPTS)]
    fake = _install(monkeypatch, {url: errors})
    with pytest.raises(RuntimeError, match="Failed to download .*fail 2"):
        scryfall.download_image_bytes(url)
    assert len(fake.requests) == scryfall.DOWNLOAD_ATTEMPTS


def test_download_image_decodes_and_returns_none_for_junk(monkeypatch, no_sleep):
    good = "https://cards.scryfall.io/normal/front/a/b/good.jpg"
    junk = "https://cards.scryfall.io/normal/front/a/b/junk.jpg"
    _install(monkeypatch, {good: [_jpeg()], junk: [b"not an image"]})
    img = scryfall.download_image(good)
    assert img is not None and img.shape == (8, 6, 3)
    assert scryfall.download_image(junk) is None
    assert scryfall.decode_image(b"") is None


def test_iter_set_cards_follows_pagination_and_throttles(monkeypatch, no_sleep):
    first = f"{scryfall.API}/cards/search?q=set%3Atla%20unique%3Aprints"
    second = f"{scryfall.API}/cards/search?q=set%3Atla%20unique%3Aprints&page=2"
    _install(
        monkeypatch,
        {
            first: [{"data": [{"id": "a"}, {"id": "b"}], "has_more": True, "next_page": second}],
            second: [{"data": [{"id": "c"}], "has_more": False}],
        },
    )
    assert [c["id"] for c in scryfall.iter_set_cards("tla")] == ["a", "b", "c"]
    assert no_sleep == [config.SCRYFALL_REQUEST_DELAY] * 2


def test_get_sets_and_get_set(monkeypatch, no_sleep):
    sets_url = f"{scryfall.API}/sets"
    page2 = f"{scryfall.API}/sets?page=2"
    _install(
        monkeypatch,
        {
            sets_url: [{"data": [{"code": "tla"}], "has_more": True, "next_page": page2}],
            page2: [{"data": [{"code": "tle"}], "has_more": False}],
            f"{scryfall.API}/sets/tla": [{"code": "tla", "name": "Avatar"}],
            f"{scryfall.API}/sets/nope": [OSError("404")],
        },
    )
    assert [s["code"] for s in scryfall.get_sets()] == ["tla", "tle"]
    assert scryfall.get_set("tla") == {"code": "tla", "name": "Avatar"}
    assert scryfall.get_set("nope") is None


def test_build_index_aliases_delegate_to_scryfall(monkeypatch):
    """build_index keeps its old private names, delegating to the shared client."""
    from app import build_index

    monkeypatch.setattr(scryfall, "get_json", lambda url: {"url": url})
    monkeypatch.setattr(scryfall, "download_image", lambda url: "img:" + url)
    monkeypatch.setattr(scryfall, "iter_set_cards", lambda code: iter([{"set": code}]))
    monkeypatch.setattr(scryfall, "get_sets", lambda: [{"code": "x"}])
    monkeypatch.setattr(scryfall, "get_set", lambda code: {"code": code})
    assert build_index._get_json("u") == {"url": "u"}
    assert build_index._download_image("u") == "img:u"
    assert list(build_index._iter_set_cards("tla")) == [{"set": "tla"}]
    assert build_index._get_sets() == [{"code": "x"}]
    assert build_index._get_set("tla") == {"code": "tla"}
    assert build_index._API == scryfall.API
