# syntax=docker/dockerfile:1
#
# Stages:
#   base    - locked dependencies + the app + the OCR models (shared by both targets)
#   test    - dev deps + tests; `docker build --target test .` runs lint + pytest inside
#             the exact runtime environment (the CI "docker" job does this)
#   runtime - the default target: what the compose files run
#
# Python version: the newest CPython the locked wheels support (see .python-version and
# the README's "Versions" section). Bump FROM, .python-version and the locks together.
FROM python:3.14-slim AS base

# Unbuffered stdout/stderr so logs appear immediately; no .pyc clutter.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Locked, --no-deps install: requirements.lock is the complete, tested dependency set
# (requirements.txt / overrides.txt explain why rapidocr's GUI opencv is excluded from
# it). The import check fails the build if the GUI build ever leaks back in, because
# it would need libGL and shadow the headless cv2.
COPY requirements.txt requirements.lock ./
RUN pip install --no-cache-dir --no-deps -r requirements.lock \
 && python - <<'PY'
import importlib.metadata as md
import cv2, onnxruntime, rapidfuzz, rapidocr  # noqa: F401
names = {d.metadata["Name"] for d in md.distributions()}
assert "opencv-python" not in names, "GUI opencv-python leaked into the image"
print("cv2", cv2.__version__, "onnxruntime", onnxruntime.__version__)
PY

# Copy the application package.
COPY app ./app

# OCR models: downloaded once at build time and verified by SHA-256, so the running
# service never talks to the model host (see app/ocr_models.py).
ENV OCR_MODEL_DIR=/app/models
RUN python -m app.ocr_models --dest /app/models

# Where de-skewed crops are written; overridable, and bind-mounted in docker-compose so
# the host can inspect results.
ENV CARDS_DIR=/data/cards
RUN mkdir -p /data/cards

# ---------------------------------------------------------------------------------
FROM base AS test
COPY requirements-dev.txt requirements-dev.lock pyproject.toml ./
RUN pip install --no-cache-dir --no-deps -r requirements-dev.lock
COPY tests ./tests
RUN ruff check . && ruff format --check . && pytest

# ---------------------------------------------------------------------------------
FROM base AS runtime
EXPOSE 8000
# Start the ASGI server on all interfaces so the host (and LAN devices) can reach it.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
