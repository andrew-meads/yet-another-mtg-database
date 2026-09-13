"""
Stage 1.5 — OCR of a de-skewed card crop (card name + collector line).

Why OCR at all: Stage 1's whole-card pHash is dominated by the frame layout, so on
real photos the true card often sits in a flat band of same-frame near-ties and can
fall out of the shortlist; and identical-art reprints are indistinguishable by
appearance at all. Text fixes both: a fuzzy-matched *name* pulls the right card's
printings into the shortlist regardless of pHash rank, and the bottom-left
*collector line* ("0150 R", "TLA • EN") names the exact printing.

Engine: RapidOCR (PaddleOCR's detector / text-line orientation classifier /
recogniser as ONNX models on onnxruntime, CPU). Model files are pinned by
:mod:`app.ocr_models` and never fetched at runtime.

Design, from measurements on real crops (see the plan / README):

* **Detect everywhere, recognise selectively.** The DB text detector is run once on
  the whole 487x680 crop and returns rotated boxes for text at any angle, so names
  in a title bar, on the side strip of a split card, or upside down are all found
  without per-layout region tables. Recognition (~20 ms per line) is then limited
  to the tallest ``max_lines`` boxes — titles are the tallest text on virtually
  every frame — plus every box inside the top/bottom bands (collector line).
* **Band passes.** The collector line is ~16-20 px tall at crop resolution and
  usually readable, but not always. A second read of the bottom band and of the
  180°-rotated top band (the crop may be upside down) taken from the 2x warp that
  de-skew already produces recovers it at native detail.
* **Every recognised line is a name candidate**; deciding what is a name, a
  collector line or rules text is the job of :mod:`app.names`, not this module.
* **Orientation.** The classifier's per-line 0°/180° verdicts, weighted by box
  area and confidence, vote on whether the crop is upside down.

Any failure (missing models, import error, runtime error) degrades to "no OCR":
:func:`get_engine` returns ``None`` and :meth:`OcrEngine.read_card` never raises.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from . import config, ocr_models

log = logging.getLogger(__name__)


@dataclass
class OcrLine:
    """One recognised text line.

    ``box`` is in the coordinates of the image the line was read from (the crop for
    the full pass, the strip for band passes); ``center_y`` is always expressed in
    the *crop's* frame as a fraction of its height (0 = top, 1 = bottom) so callers
    can reason about bands uniformly. ``rotated`` is True when the line was upside
    down *in the crop* (already accounts for the top band being read rotated).
    """

    text: str
    conf: float
    box: np.ndarray
    text_height: float
    text_width: float
    center_y: float
    source: str  # "full" | "band_bottom" | "band_top"
    rotated: bool


@dataclass
class OcrResult:
    """Everything the matcher needs from OCR: lines plus an orientation vote."""

    lines: list[OcrLine]
    # Weighted votes for the crop being upright (0) or upside down (180).
    orientation_votes: dict[int, float] = field(default_factory=lambda: {0: 0.0, 180: 0.0})
    elapsed_ms: dict[str, float] = field(default_factory=dict)

    @property
    def texts(self) -> list[tuple[str, float]]:
        """``[(text, confidence)]`` in the order recognised — the input for name matching."""
        return [(line.text, line.conf) for line in self.lines]

    def best_orientation(self, min_margin: float = 1.5) -> int | None:
        """0 or 180 when one side out-votes the other by ``min_margin``, else None."""
        up, down = self.orientation_votes.get(0, 0.0), self.orientation_votes.get(180, 0.0)
        if up <= 0 and down <= 0:
            return None
        if up >= down * min_margin:
            return 0
        if down >= up * min_margin:
            return 180
        return None


class _RapidBackend:
    """Thin adapter over RapidOCR's three sub-models.

    Kept separate so tests can substitute a fake with the same three methods and the
    engine logic (selection, bands, votes) is exercised without ONNX models.
    """

    def __init__(self, model_dir: Path, threads: int, det_limit_side: int) -> None:
        # Imported lazily: the service must start (and the unit suite must run)
        # without rapidocr/onnxruntime being importable.
        from rapidocr import RapidOCR
        from rapidocr.ch_ppocr_rec.typings import TextRecInput
        from rapidocr.utils.process_img import get_rotate_crop_image
        from rapidocr.utils.typings import LangRec, ModelType, OCRVersion

        keys = ocr_models.active_keys()

        def version(key: str) -> OCRVersion:
            return {"PP-OCRv4": OCRVersion.PPOCRV4, "PP-OCRv5": OCRVersion.PPOCRV5}.get(
                next((v for v in ("PP-OCRv4", "PP-OCRv5", "PP-OCRv6") if v in key), ""),
                OCRVersion.PPOCRV6,
            )

        def model_type(key: str) -> ModelType:
            for name, member in (
                ("server", ModelType.SERVER),
                ("medium", ModelType.MEDIUM),
                ("small", ModelType.SMALL),
                ("tiny", ModelType.TINY),
            ):
                if name in key:
                    return member
            return ModelType.MOBILE

        rec_key = keys["rec"]
        lang = (
            LangRec.EN
            if ":en_" in rec_key
            else (LangRec.LATIN if "latin" in rec_key else LangRec.CH)
        )
        params = {
            "Det.model_path": str(ocr_models.model_path("det", model_dir)),
            "Cls.model_path": str(ocr_models.model_path("cls", model_dir)),
            "Rec.model_path": str(ocr_models.model_path("rec", model_dir)),
            "Det.ocr_version": version(keys["det"]),
            "Det.model_type": model_type(keys["det"]),
            "Rec.ocr_version": version(rec_key),
            "Rec.model_type": model_type(rec_key),
            "Rec.lang_type": lang,
            "Cls.ocr_version": version(keys["cls"]),
            # The PP-OCRv5 orientation classifier takes 80x160 inputs; RapidOCR's
            # default config still carries the v4 shape (48x192).
            "Cls.cls_image_shape": [3, 80, 160] if "PP-OCRv5" in keys["cls"] else [3, 48, 192],
            "Global.log_level": "warning",
            "EngineConfig.onnxruntime.intra_op_num_threads": threads,
            # "max": only shrink images whose long side exceeds the cap (never
            # upscale a crop for detection — measured to add time, not reads).
            "Det.limit_side_len": det_limit_side,
            "Det.limit_type": "max",
        }
        self._rapid = RapidOCR(params=params)
        self._rec_input = TextRecInput
        self._crop = get_rotate_crop_image

    def detect(self, img: np.ndarray) -> np.ndarray:
        """Text boxes ``(N, 4, 2)`` in ``img`` coordinates (empty array if none)."""
        out = self._rapid.text_det(img)
        if out.boxes is None:
            return np.empty((0, 4, 2), np.float32)
        return np.asarray(out.boxes, dtype=np.float32)

    def crop(self, img: np.ndarray, box: np.ndarray) -> np.ndarray:
        """Rectify one (possibly rotated) text box to a horizontal strip."""
        return self._crop(img, np.asarray(box, dtype=np.float32))

    def classify(self, strips: list[np.ndarray]) -> tuple[list[np.ndarray], list[bool]]:
        """Rotate upside-down strips; returns ``(strips, upside_down_flags)``."""
        out = self._rapid.text_cls(list(strips))
        flags = [
            bool("180" in label and score > self._rapid.text_cls.cls_thresh)
            for label, score in out.cls_res
        ]
        return list(out.img_list), flags

    def recognize(self, strips: list[np.ndarray]) -> list[tuple[str, float]]:
        """``[(text, confidence)]`` per strip."""
        out = self._rapid.text_rec(self._rec_input(img=list(strips)))
        if out.txts is None:
            return [("", 0.0)] * len(strips)
        return [(str(t), float(s)) for t, s in zip(out.txts, out.scores, strict=True)]


class OcrEngine:
    """Reads the text of card crops. One instance per process (see :func:`get_engine`)."""

    def __init__(
        self,
        model_dir: Path | None = None,
        *,
        threads: int = 4,
        max_lines: int = 6,
        min_line_height_frac: float = 0.02,
        band_fraction: float = 0.10,
        min_conf: float = 0.7,
        band_passes: bool = True,
        det_limit_side: int = 1400,
        backend=None,
    ) -> None:
        self.max_lines = max_lines
        self.min_line_height_frac = min_line_height_frac
        self.band_fraction = band_fraction
        self.min_conf = min_conf
        self.band_passes = band_passes
        self._backend = backend or _RapidBackend(
            model_dir or config.OCR_MODEL_DIR, threads, det_limit_side
        )
        self._failed_once = False

    # --- geometry helpers -----------------------------------------------------

    @staticmethod
    def _box_metrics(box: np.ndarray) -> tuple[float, float, float]:
        """``(text_height, text_width, center_y_px)`` of a rotated text box.

        The detector orders corners along the reading direction, but for vertical
        text the "height" edge is the long one; the text height is the short side.
        """
        e01 = float(np.linalg.norm(box[1] - box[0]))
        e03 = float(np.linalg.norm(box[3] - box[0]))
        return min(e01, e03), max(e01, e03), float(box[:, 1].mean())

    def _select(self, boxes: np.ndarray, img_h: int) -> list[int]:
        """Indices of the boxes worth recognising (see the module docstring)."""
        if len(boxes) == 0:
            return []
        metrics = [self._box_metrics(b) for b in boxes]
        min_h = self.min_line_height_frac * img_h
        band = self.band_fraction * img_h
        tall = sorted(
            (i for i, (h, _w, _cy) in enumerate(metrics) if h >= min_h),
            key=lambda i: -metrics[i][0],
        )[: self.max_lines]
        in_band = [i for i, (_h, _w, cy) in enumerate(metrics) if cy < band or cy > img_h - band]
        # Preserve "tallest first" order, then band extras; dedupe.
        seen: set[int] = set()
        chosen = []
        for i in tall + in_band:
            if i not in seen:
                seen.add(i)
                chosen.append(i)
        return chosen

    # --- passes ----------------------------------------------------------------

    def _read(
        self,
        img: np.ndarray,
        *,
        source: str,
        select: bool,
        crop_h: int,
        y_offset_frac: float,
        flip_y: bool,
    ) -> list[OcrLine]:
        """Detect → (select) → classify → recognise on one image.

        ``y_offset_frac``/``flip_y`` map the image's vertical position back into the
        crop's frame: a bottom strip starts at ``1 - band``; the top strip is read
        rotated 180°, so its rows run backwards (``flip_y``) and a classifier "180"
        there means the text was upright in the crop.
        """
        boxes = self._backend.detect(img)
        idx = self._select(boxes, img.shape[0]) if select else list(range(len(boxes)))
        if not idx:
            return []
        strips = [self._backend.crop(img, boxes[i]) for i in idx]
        strips, flags = self._backend.classify(strips)
        texts = self._backend.recognize(strips)
        lines: list[OcrLine] = []
        for i, upside_down, (text, conf) in zip(idx, flags, texts, strict=True):
            text = text.strip()
            if not text or conf < self.min_conf:
                continue
            h, w, cy_px = self._box_metrics(boxes[i])
            frac_in_img = cy_px / max(img.shape[0], 1)
            if flip_y:
                frac_in_img = 1.0 - frac_in_img
            # Strips are a `band_fraction`-tall slice of the crop; the full pass is
            # the whole crop (scale 1, offset 0).
            scale = 1.0 if source == "full" else self.band_fraction
            center_y = y_offset_frac + frac_in_img * scale
            rotated = upside_down != (source == "band_top")
            lines.append(OcrLine(text, conf, boxes[i], h, w, center_y, source, rotated))
        return lines

    def read_card(
        self,
        crop_bgr: np.ndarray,
        ocr_image: np.ndarray | None = None,
        *,
        band_passes: bool | None = None,
    ) -> OcrResult | None:
        """OCR one de-skewed crop.

        Args:
            crop_bgr: The 487x680 portrait crop from detection.
            ocr_image: Optional higher-resolution portrait warp of the same card
                (the 2x image de-skew produces before downsizing); used for the
                band passes. Falls back to a 2x cubic upscale of the crop.
            band_passes: Override the engine default; ``False`` runs only the
                full-crop pass (callers can add :meth:`read_bands` later).

        Returns:
            An :class:`OcrResult`, or ``None`` if OCR failed (logged once).
        """
        try:
            timings: dict[str, float] = {}
            t0 = time.perf_counter()
            lines = self._read(
                crop_bgr,
                source="full",
                select=True,
                crop_h=crop_bgr.shape[0],
                y_offset_frac=0.0,
                flip_y=False,
            )
            timings["full"] = (time.perf_counter() - t0) * 1000
            timings["total"] = timings["full"]
            result = OcrResult(lines, self._votes(lines), timings)
            if self.band_passes if band_passes is None else band_passes:
                self.read_bands(crop_bgr, ocr_image, into=result)
            return result
        except Exception as err:  # never let OCR take the scan down
            self._log_failure(err)
            return None

    def read_bands(
        self, crop_bgr: np.ndarray, ocr_image: np.ndarray | None = None, *, into: OcrResult
    ) -> OcrResult:
        """Run the top/bottom band passes and merge their lines into ``into``.

        Separate from :meth:`read_card` so the matcher can skip them when the
        full pass already produced a collector line (they cost ~50-150 ms).
        Failures are swallowed like in :meth:`read_card`; ``into`` is returned.
        """
        try:
            t1 = time.perf_counter()
            src = (
                ocr_image
                if ocr_image is not None
                else cv2.resize(crop_bgr, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
            )
            band_px = max(1, int(round(src.shape[0] * self.band_fraction)))
            bottom = src[src.shape[0] - band_px :]
            top = cv2.rotate(src[:band_px], cv2.ROTATE_180)
            extra = self._read(
                bottom,
                source="band_bottom",
                select=False,
                crop_h=crop_bgr.shape[0],
                y_offset_frac=1.0 - self.band_fraction,
                flip_y=False,
            )
            extra += self._read(
                top,
                source="band_top",
                select=False,
                crop_h=crop_bgr.shape[0],
                y_offset_frac=0.0,
                flip_y=True,
            )
            into.lines.extend(extra)
            into.orientation_votes = self._votes(into.lines)
            bands_ms = (time.perf_counter() - t1) * 1000
            into.elapsed_ms["bands"] = bands_ms
            into.elapsed_ms["total"] = into.elapsed_ms.get("total", 0.0) + bands_ms
        except Exception as err:
            self._log_failure(err)
        return into

    @staticmethod
    def _votes(lines: list[OcrLine]) -> dict[int, float]:
        """Weighted 0°/180° votes: long, tall, confident lines are the best witnesses."""
        votes = {0: 0.0, 180: 0.0}
        for line in lines:
            votes[180 if line.rotated else 0] += line.text_height * line.text_width * line.conf
        return votes

    def _log_failure(self, err: Exception) -> None:
        if not self._failed_once:
            self._failed_once = True
            log.warning("OCR failed (further failures suppressed): %s", err)


# --- process-wide singleton ---------------------------------------------------

_lock = threading.Lock()
_engine: OcrEngine | None = None
_engine_failed = False


def models_present(model_dir: Path | None = None) -> bool:
    """True when the active det/cls/rec model files exist (no hash check: fast)."""
    return all(ocr_models.model_path(kind, model_dir).is_file() for kind in ("det", "cls", "rec"))


def get_engine() -> OcrEngine | None:
    """The shared engine, built from config on first use; ``None`` when unavailable.

    Unavailable means OCR is disabled, the models are missing, or the OCR stack
    failed to import/initialise — each is logged once and the matcher then runs
    the pure pHash → ORB path.
    """
    global _engine, _engine_failed
    if not config.OCR_ENABLED or _engine_failed:
        return None
    if _engine is not None:
        return _engine
    with _lock:
        if _engine is not None or _engine_failed:
            return _engine
        if not models_present():
            log.warning(
                "OCR disabled: models missing under %s (run `python -m app.ocr_models`)",
                config.OCR_MODEL_DIR,
            )
            _engine_failed = True
            return None
        try:
            _engine = OcrEngine(
                config.OCR_MODEL_DIR,
                threads=config.OCR_THREADS,
                max_lines=config.OCR_MAX_LINES,
                min_line_height_frac=config.OCR_MIN_LINE_HEIGHT_FRAC,
                band_fraction=config.OCR_BAND_FRACTION,
                min_conf=config.OCR_MIN_CONF,
                band_passes=config.OCR_BAND_PASSES,
                det_limit_side=config.OCR_DET_LIMIT_SIDE,
            )
        except Exception as err:
            log.warning("OCR disabled: engine failed to initialise: %s", err)
            _engine_failed = True
            return None
        return _engine


def available() -> bool:
    """Whether OCR will run for scans (used by ``/health``)."""
    return get_engine() is not None
