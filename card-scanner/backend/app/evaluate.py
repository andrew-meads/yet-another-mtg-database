"""
Identification accuracy harness (self-retrieval with synthetic distortions).

Picks random indexed cards, downloads each card's reference image, applies
randomized distortions that mimic a real de-skewed crop (perspective jitter,
brightness/contrast, blur, JPEG recompression, optional 180° flip), runs the
result through the two-stage matcher, and measures how often / how well the
original card is recovered.

Usage (inside the container)::

    python -m app.evaluate --sample 300
    python -m app.evaluate --sample 100 --seed 1 --flip-prob 0.5

Metrics reported:
  * Stage-1 recall@K  — did the true card survive the pHash shortlist?
  * Top-1 accuracy    — strict (exact printing) and lenient (same card/oracle id).
  * Recall@N          — true card anywhere in the returned top-N.
  * False-"confident" — flagged confident but actually wrong (tunes MIN_INLIERS).

The distortions model what Part-1's de-skew actually outputs (a frame-filling
crop with mild residual), so the numbers should track real-image behaviour
reasonably. It is still **self-retrieval** (the query derives from the same
source image the index was built from), so it can't capture genuine optical
differences (true glare, lens blur, a different physical copy) — but it's a
solid, reproducible signal for comparing configs (SHORTLIST_K, PHASH_SIZE, ORB
vs SIFT) and catching regressions.
"""

from __future__ import annotations

import argparse
import csv
import sys
import time
import urllib.request

import cv2
import numpy as np

from . import config, index_db, matcher


def _download(url: str) -> np.ndarray | None:
    """Download and decode a card image to BGR (single attempt; caller throttles)."""
    req = urllib.request.Request(
        url, headers={"User-Agent": config.SCRYFALL_USER_AGENT, "Accept": "*/*"}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = resp.read()
    return cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)


def distort(image: np.ndarray, rng: np.random.Generator, flip_prob: float) -> tuple[np.ndarray, bool]:
    """Apply randomized distortions that model a real **de-skewed crop**.

    The important property is that the output stays **frame-filling** — exactly
    what Part-1's four-point transform produces. We simulate an imperfect de-skew
    by sampling a quad a few percent *inside* the card and warping it to fill the
    frame, so the residual is a slight skew/zoom of card content with NO smeared
    border (the earlier ±6% `BORDER_REPLICATE` warp added non-card edges that real
    de-skew never produces, which unfairly punished the Stage-1 pHash).

    On top of that: mild lighting, occasional light blur, typical-quality JPEG
    recompression, and a possible 180° flip. Driven by ``rng`` (reproducible via
    --seed).
    """
    h, w = image.shape[:2]

    # 1. Imperfect de-skew residual: pick a quad up to ~2% inside each corner and
    #    warp it to fill the frame. Sampling from inside the card guarantees the
    #    output is all card content (frame-filling), like a real de-skew that
    #    clipped a sliver — no border smear.
    mx, my = 0.02 * w, 0.02 * h
    src_quad = np.float32(
        [
            [rng.uniform(0, mx), rng.uniform(0, my)],              # top-left
            [w - rng.uniform(0, mx), rng.uniform(0, my)],          # top-right
            [w - rng.uniform(0, mx), h - rng.uniform(0, my)],      # bottom-right
            [rng.uniform(0, mx), h - rng.uniform(0, my)],          # bottom-left
        ]
    )
    dst = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    out = cv2.warpPerspective(image, cv2.getPerspectiveTransform(src_quad, dst), (w, h))

    # 2. Photometric — mild contrast (alpha) and brightness (beta) variation.
    out = cv2.convertScaleAbs(out, alpha=float(rng.uniform(0.9, 1.1)), beta=float(rng.uniform(-15, 15)))

    # 3. Occasional light blur (a sharp phone photo is the common case).
    if rng.random() < 0.4:
        out = cv2.GaussianBlur(out, (3, 3), 0)

    # 4. JPEG recompression at typical phone quality.
    ok, enc = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, int(rng.integers(75, 95))])
    if ok:
        out = cv2.imdecode(enc, cv2.IMREAD_COLOR)

    # 5. Random 180° flip (still realistic; pHash handles it via 0°/180° variants).
    flipped = rng.random() < flip_prob
    if flipped:
        out = cv2.rotate(out, cv2.ROTATE_180)

    return out, flipped


def _rank_of(results: list[dict], predicate) -> int | None:
    """0-based rank of the first result satisfying ``predicate``, or None."""
    for i, m in enumerate(results):
        if predicate(m):
            return i
    return None


def evaluate(sample: int, seed: int, top_n: int, flip_prob: float, report_path: str) -> int:
    """Run the harness and print a report. Returns a process exit code."""
    index_db.init_db()  # ensure tables exist (presents "empty" rather than crashing)
    with index_db.connection() as conn:
        # Map every scryfall_id -> oracle_id so we can score "lenient" (same card,
        # any printing/art) in addition to "strict" (exact printing).
        oracle_by_sid = {
            r["scryfall_id"]: r["oracle_id"]
            for r in conn.execute("SELECT DISTINCT scryfall_id, oracle_id FROM cards")
        }

        # Candidate rows (metadata only — no heavy BLOBs), then a reproducible sample.
        rows = conn.execute(
            "SELECT id, scryfall_id, oracle_id, name, set_code, collector_number, face, image_url "
            "FROM cards WHERE image_url IS NOT NULL"
        ).fetchall()

    if not rows:
        print("Index is empty — build it first (python -m app.build_index ...).")
        return 1

    rng = np.random.default_rng(seed)
    n = min(sample, len(rows))
    chosen = [rows[i] for i in rng.permutation(len(rows))[:n]]
    print(
        f"Evaluating {n} cards (of {len(rows)} indexed) · detector={config.FEATURE_DETECTOR} · "
        f"SHORTLIST_K={config.SHORTLIST_K} · PHASH_SIZE={config.PHASH_SIZE} · top_n={top_n} · "
        f"flip_prob={flip_prob} · seed={seed}\n"
    )

    stats = {
        "evaluated": 0,
        "shortlist_recall": 0,
        "top1_strict": 0,
        "topN_strict": 0,
        "top1_lenient": 0,
        "topN_lenient": 0,
        "false_confident": 0,
        "download_errors": 0,
    }
    latencies: list[float] = []
    failures: list[dict] = []

    for i, row in enumerate(chosen, start=1):
        try:
            image = _download(row["image_url"])
        except Exception as err:
            stats["download_errors"] += 1
            print(f"  ! download failed for {row['name']}: {err}", file=sys.stderr)
            continue
        if image is None:
            stats["download_errors"] += 1
            continue

        query, _flipped = distort(image, rng, flip_prob)

        t0 = time.perf_counter()
        shortlist_ids, results = matcher.identify_with_shortlist(query, top_n)
        latencies.append(time.perf_counter() - t0)

        stats["evaluated"] += 1
        truth_id, truth_sid, truth_oid = row["id"], row["scryfall_id"], row["oracle_id"]

        if truth_id in shortlist_ids:
            stats["shortlist_recall"] += 1

        strict_rank = _rank_of(results, lambda m: m["scryfallId"] == truth_sid)
        lenient_rank = _rank_of(
            results, lambda m: oracle_by_sid.get(m["scryfallId"]) == truth_oid
        )

        if strict_rank == 0:
            stats["top1_strict"] += 1
        if strict_rank is not None:
            stats["topN_strict"] += 1
        if lenient_rank == 0:
            stats["top1_lenient"] += 1
        if lenient_rank is not None:
            stats["topN_lenient"] += 1

        best = results[0] if results else None
        # "Wrong but confident" uses the lenient notion (returning the same card
        # under a different printing shouldn't count as a confidence failure).
        if best and best["confident"] and lenient_rank != 0:
            stats["false_confident"] += 1

        if lenient_rank != 0:  # record anything that wasn't a clean top-1 hit
            failures.append(
                {
                    "truth_name": row["name"],
                    "truth_scryfall_id": truth_sid,
                    "truth_set": row["set_code"],
                    "truth_collector": row["collector_number"],
                    "strict_rank": "" if strict_rank is None else strict_rank + 1,
                    "lenient_rank": "" if lenient_rank is None else lenient_rank + 1,
                    "in_shortlist": truth_id in shortlist_ids,
                    "best_name": best["name"] if best else "",
                    "best_inliers": best["inliers"] if best else "",
                    "best_confident": best["confident"] if best else "",
                }
            )

        if i % 25 == 0:
            print(f"  ...{i}/{n}")
        time.sleep(config.SCRYFALL_REQUEST_DELAY)

    _print_report(stats, latencies)
    _write_failures(report_path, failures)
    return 0


def _pct(num: int, den: int) -> str:
    return f"{(100.0 * num / den):5.1f}%" if den else "  n/a"


def _print_report(stats: dict, latencies: list[float]) -> None:
    ev = stats["evaluated"]
    print("\n================ identification accuracy ================")
    print(f"  evaluated          : {ev}  (download errors: {stats['download_errors']})")
    print(f"  Stage-1 recall@K   : {_pct(stats['shortlist_recall'], ev)}")
    print(f"  Top-1 (strict)     : {_pct(stats['top1_strict'], ev)}   exact printing")
    print(f"  Top-1 (lenient)    : {_pct(stats['top1_lenient'], ev)}   same card (oracle id)")
    print(f"  Recall@N (strict)  : {_pct(stats['topN_strict'], ev)}")
    print(f"  Recall@N (lenient) : {_pct(stats['topN_lenient'], ev)}")
    print(f"  False 'confident'  : {_pct(stats['false_confident'], ev)}")
    if latencies:
        arr = np.array(latencies) * 1000.0
        print(f"  Latency / query    : {arr.mean():.0f} ms (median {np.median(arr):.0f} ms)")
    print("========================================================")


def _write_failures(path: str, failures: list[dict]) -> None:
    if not failures:
        print("No failures to write — every query was a clean top-1 hit.")
        return
    fields = list(failures[0].keys())
    with open(path, "w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        writer.writerows(failures)
    print(f"Wrote {len(failures)} failure rows to {path}")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.evaluate", description=__doc__)
    parser.add_argument("--sample", type=int, default=200, help="number of cards to test")
    parser.add_argument("--seed", type=int, default=0, help="RNG seed (reproducible runs)")
    parser.add_argument("--top-n", type=int, default=config.TOP_N_MATCHES, help="candidates per query")
    parser.add_argument("--flip-prob", type=float, default=0.5, help="probability of a 180° flip")
    parser.add_argument(
        "--report",
        default=str(config.CARDS_DIR / "eval_failures.csv"),
        help="CSV path for failure rows",
    )
    args = parser.parse_args(argv)
    return evaluate(args.sample, args.seed, args.top_n, args.flip_prob, args.report)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
