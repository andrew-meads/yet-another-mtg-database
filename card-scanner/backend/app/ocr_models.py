"""
OCR model registry + downloader.

RapidOCR (PaddleOCR's detector / text-line classifier / recogniser running as ONNX
models on onnxruntime) fetches its models from modelscope.cn on first use unless it is
given explicit paths. We want neither a runtime network dependency nor an unpinned
model, so this module is the single place that says WHICH model files the scanner
uses (a key -> URL + SHA-256, copied from RapidOCR's own ``default_models.yaml`` for
the locked ``rapidocr`` release) and downloads/verifies them ahead of time::

    python -m app.ocr_models --dest /app/models   # Dockerfile, at build time
    make models                                   # host: ./models for local runs
    python -m app.ocr_models --check              # verify what is on disk

Which entries are *active* is decided by ``config.OCR_DET_MODEL`` /
``OCR_CLS_MODEL`` / ``OCR_REC_MODEL``; swapping a model is a config change (plus a
rebuild or ``make models``). The SHA-256 pin is about artefact integrity and build
reproducibility, not about staying on an old model — add newer entries here as
RapidOCR ships them and point the config at them.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from . import config

# All entries are the ONNX exports published by the RapidAI project for the locked
# rapidocr release; the SHA-256 values are the ones RapidOCR itself verifies against.
_BASE = "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx"


@dataclass(frozen=True)
class ModelSpec:
    """One downloadable model file."""

    kind: str  # "det" | "cls" | "rec"
    url: str
    sha256: str

    @property
    def filename(self) -> str:
        return self.url.rsplit("/", 1)[-1]


MODELS: dict[str, ModelSpec] = {
    # --- text detectors (script-agnostic; find text boxes anywhere in the image) ---
    "det:PP-OCRv6_small": ModelSpec(
        "det",
        f"{_BASE}/PP-OCRv6/det/PP-OCRv6_det_small.onnx",
        "090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f",
    ),
    "det:PP-OCRv6_medium": ModelSpec(
        "det",
        f"{_BASE}/PP-OCRv6/det/PP-OCRv6_det_medium.onnx",
        "92078b7355007ccfffcd4c8cd441a3afd4538904d06881b29a155e1e679907c2",
    ),
    "det:PP-OCRv5_mobile": ModelSpec(
        "det",
        f"{_BASE}/PP-OCRv5/det/ch_PP-OCRv5_det_mobile.onnx",
        "4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae",
    ),
    "det:PP-OCRv5_server": ModelSpec(
        "det",
        f"{_BASE}/PP-OCRv5/det/ch_PP-OCRv5_det_server.onnx",
        "0f8846b1d4bba223a2a2f9d9b44022fbc22cc019051a602b41a7fda9667e4cad",
    ),
    # --- text-line orientation classifier (0° / 180° per line) ---
    "cls:PP-OCRv5_mobile": ModelSpec(
        "cls",
        f"{_BASE}/PP-OCRv5/cls/ch_PP-LCNet_x0_25_textline_ori_cls_mobile.onnx",
        "54379ae5174d026780215fc748a7f31910dee36818e63d49e17dc598ecc82df7",
    ),
    # --- recognisers (the dictionary is embedded in the ONNX metadata) ---
    "rec:en_PP-OCRv5_mobile": ModelSpec(
        "rec",
        f"{_BASE}/PP-OCRv5/rec/en_PP-OCRv5_rec_mobile.onnx",
        "c3461add59bb4323ecba96a492ab75e06dda42467c9e3d0c18db5d1d21924be8",
    ),
    "rec:latin_PP-OCRv5_mobile": ModelSpec(
        "rec",
        f"{_BASE}/PP-OCRv5/rec/latin_PP-OCRv5_rec_mobile.onnx",
        "b20bd37c168a570f583afbc8cd7925603890efbcdc000a59e22c269d160b5f5a",
    ),
    "rec:PP-OCRv6_small": ModelSpec(
        "rec",
        f"{_BASE}/PP-OCRv6/rec/PP-OCRv6_rec_small.onnx",
        "6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884",
    ),
    "rec:PP-OCRv6_medium": ModelSpec(
        "rec",
        f"{_BASE}/PP-OCRv6/rec/PP-OCRv6_rec_medium.onnx",
        "eef444829dbbe18d7fea59a3f6eb75647518d2b3a9568d27c92e42940204894b",
    ),
}


def active_keys() -> dict[str, str]:
    """The configured ``{kind: registry key}`` triple."""
    return {"det": config.OCR_DET_MODEL, "cls": config.OCR_CLS_MODEL, "rec": config.OCR_REC_MODEL}


def spec_for(key: str) -> ModelSpec:
    """Look up a registry key, with a helpful error for typos in the config."""
    try:
        return MODELS[key]
    except KeyError:
        raise KeyError(f"unknown OCR model key {key!r}; known: {sorted(MODELS)}") from None


def model_path(kind: str, model_dir: Path | None = None) -> Path:
    """Where the active model of ``kind`` ("det"/"cls"/"rec") lives on disk."""
    return (model_dir or config.OCR_MODEL_DIR) / spec_for(active_keys()[kind]).filename


def file_sha256(path: Path) -> str:
    """Hex SHA-256 of a file, streamed."""
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def is_valid(spec: ModelSpec, dest: Path) -> bool:
    """True if ``dest/<filename>`` exists and matches the pinned hash."""
    path = dest / spec.filename
    return path.is_file() and file_sha256(path) == spec.sha256


def download(spec: ModelSpec, dest: Path) -> Path:
    """Fetch one model into ``dest`` atomically and verify its SHA-256.

    The file is streamed to a temp file in the same directory and renamed into
    place only after the hash matches, so a half-written or tampered file never
    shadows a good one.
    """
    dest.mkdir(parents=True, exist_ok=True)
    target = dest / spec.filename
    req = urllib.request.Request(spec.url, headers={"User-Agent": config.SCRYFALL_USER_AGENT})
    fd, tmp_name = tempfile.mkstemp(prefix=spec.filename + ".", dir=dest)
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as out, urllib.request.urlopen(req, timeout=120) as resp:
            for chunk in iter(lambda: resp.read(1 << 20), b""):
                out.write(chunk)
        actual = file_sha256(tmp)
        if actual != spec.sha256:
            raise RuntimeError(
                f"SHA-256 mismatch for {spec.filename}: expected {spec.sha256}, got {actual}"
            )
        os.replace(tmp, target)
    finally:
        if tmp.exists():
            tmp.unlink()
    return target


def ensure_models(dest: Path, keys: list[str] | None = None) -> list[tuple[str, Path, bool]]:
    """Make sure every requested model is present and valid under ``dest``.

    Returns ``[(key, path, downloaded)]``. Defaults to the active triple.
    """
    keys = keys or list(active_keys().values())
    out = []
    for key in keys:
        spec = spec_for(key)
        if is_valid(spec, dest):
            out.append((key, dest / spec.filename, False))
        else:
            out.append((key, download(spec, dest), True))
    return out


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.ocr_models", description=__doc__)
    parser.add_argument(
        "--dest", default=str(config.OCR_MODEL_DIR), help="directory for the .onnx files"
    )
    parser.add_argument(
        "--all", action="store_true", help="fetch every registry entry, not just the active ones"
    )
    parser.add_argument(
        "--check", action="store_true", help="only verify what is on disk (no downloads)"
    )
    args = parser.parse_args(argv)

    dest = Path(args.dest)
    keys = list(MODELS) if args.all else list(active_keys().values())
    if args.check:
        ok = True
        for key in keys:
            spec = spec_for(key)
            valid = is_valid(spec, dest)
            ok &= valid
            print(f"{'ok     ' if valid else 'MISSING'} {key:<26} {dest / spec.filename}")
        return 0 if ok else 1

    for key, path, downloaded in ensure_models(dest, keys):
        size_mb = path.stat().st_size / 1e6
        print(
            f"{'downloaded' if downloaded else 'cached    '} {key:<26} {path.name} ({size_mb:.1f} MB)"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
