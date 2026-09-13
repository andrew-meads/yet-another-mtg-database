"""
Thin Scryfall HTTP client shared by the index builder, the harnesses and the
image cache.

Everything that talks to ``api.scryfall.com`` or its image CDN lives here so
the etiquette rules are applied in one place:

* every request carries the descriptive ``SCRYFALL_USER_AGENT`` (Scryfall
  rejects anonymous clients and asks for a contact string);
* pagination is followed with ``SCRYFALL_REQUEST_DELAY`` between pages, and
  callers that download many images throttle themselves the same way
  (``image_cache`` only sleeps on a cache *miss*);
* image downloads retry a few times with a short back-off, because the CDN
  occasionally drops a connection mid-body on long index builds.

The functions are deliberately small wrappers over ``urllib`` (no ``requests``
dependency) and are looked up through the module at call time, so tests can
monkeypatch ``urllib.request.urlopen`` and never touch the network.
"""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from collections.abc import Iterator

import cv2
import numpy as np

from . import config

API = "https://api.scryfall.com"

# How many times an image download is attempted before giving up. Attempts are
# spaced 0.5 s, 1.0 s, ... apart (linear back-off) — long enough for a CDN blip,
# short enough not to stall a build noticeably.
DOWNLOAD_ATTEMPTS = 3


def _headers(accept: str) -> dict[str, str]:
    return {"User-Agent": config.SCRYFALL_USER_AGENT, "Accept": accept}


def get_json(url: str) -> dict:
    """GET a Scryfall JSON endpoint with the configured User-Agent."""
    req = urllib.request.Request(url, headers=_headers("application/json"))
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def download_image_bytes(url: str) -> bytes:
    """Download an image and return its raw (still encoded) bytes.

    Retries ``DOWNLOAD_ATTEMPTS`` times on any error (connection reset, timeout,
    HTTP 5xx) and raises ``RuntimeError`` naming the URL and the last error once
    they are exhausted. Returning the *bytes* rather than a decoded image is what
    lets the image cache store exactly what Scryfall served (no re-encoding loss).
    """
    req = urllib.request.Request(url, headers=_headers("*/*"))
    last_err: Exception | None = None
    for attempt in range(DOWNLOAD_ATTEMPTS):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read()
        except Exception as err:  # network hiccups; retried below
            last_err = err
            time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"Failed to download {url}: {last_err}")


def decode_image(data: bytes) -> np.ndarray | None:
    """Decode encoded image bytes to a BGR array (``None`` if undecodable)."""
    if not data:
        return None
    return cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)


def download_image(url: str) -> np.ndarray | None:
    """Download and decode a card image to BGR (retrying like the bytes variant).

    ``None`` means the download succeeded but the payload was not a decodable
    image — callers treat that as a per-card error, not a transport failure.
    """
    return decode_image(download_image_bytes(url))


def iter_set_cards(set_code: str) -> Iterator[dict]:
    """Yield every card object in a set, following Scryfall's pagination.

    Uses the ``unique:prints`` search so every printing (including promo and
    variant collector numbers) is returned, not just one card per name.
    """
    url = f"{API}/cards/search?q=" + urllib.parse.quote(f"set:{set_code} unique:prints")
    while url:
        page = get_json(url)
        yield from page.get("data", [])
        url = page.get("next_page") if page.get("has_more") else None
        time.sleep(config.SCRYFALL_REQUEST_DELAY)


def get_sets() -> list[dict]:
    """Fetch every Scryfall set object (handles pagination defensively).

    ``/sets`` is a single page today, but the list object carries ``has_more``
    like every other list endpoint, so we honour it in case that changes.
    """
    sets: list[dict] = []
    url = f"{API}/sets"
    while url:
        page = get_json(url)
        sets.extend(page.get("data", []))
        url = page.get("next_page") if page.get("has_more") else None
    return sets


def get_set(code: str) -> dict | None:
    """Fetch a single Scryfall set object by code (for its ``card_count``).

    Returns ``None`` on any failure (unknown code, network error) so callers that
    only want the count/name for display can carry on without it.
    """
    try:
        return get_json(f"{API}/sets/{urllib.parse.quote(code)}")
    except Exception:
        return None
