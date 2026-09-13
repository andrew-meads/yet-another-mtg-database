# Developer entry points for the card-scanner backend. Run from this directory or
# via `make -C card-scanner/backend <target>` (the root package.json wraps the
# common ones as `npm run scanner:*`). GNU make 3.81 compatible (macOS default).

VENV ?= .venv
PY   := $(VENV)/bin/python
UV   ?= uv

.PHONY: venv test lint format upgrade models eval-photos baseline synth docker-test docker-build

## venv: create the host virtualenv (uv fetches the CPython in .python-version if needed)
venv:
	$(UV) venv $(VENV)
	$(UV) pip install --python $(PY) --no-deps -r requirements-dev.lock

## test: run the pytest suite (unit + synthetic; no Postgres, no network)
test:
	$(PY) -m pytest $(ARGS)

## lint: ruff check + format check
lint:
	$(VENV)/bin/ruff check . && $(VENV)/bin/ruff format --check .

## format: ruff format + autofix
format:
	$(VENV)/bin/ruff format . && $(VENV)/bin/ruff check --fix .

## upgrade: re-resolve the locks to the newest compatible versions (then run test + harness)
upgrade:
	$(UV) pip compile requirements.txt --override overrides.txt --universal --python-version 3.14 --upgrade -o requirements.lock
	$(UV) pip compile requirements-dev.txt --override overrides.txt --universal --python-version 3.14 --upgrade -o requirements-dev.lock

## models: download + verify the OCR models into ./models (same files the Docker image ships)
models:
	$(PY) -m app.ocr_models --dest models

## eval-photos: run the real-photo harness over test-images (detection + identification)
eval-photos:
	$(PY) -m app.evaluate_photos ../test-images --overlay-dir ../test-images/_overlays $(ARGS)

## baseline: regenerate BOTH committed real-photo detection baselines from test-images —
## with the live index (VERIFY_MODE resolves to filter; the numbers the README quotes) and
## without it (VERIFY_MODE=off; what CI, which has no Postgres, can reproduce)
baseline:
	$(PY) -m app.evaluate_photos ../test-images --detection-only --json ../benchmarks/real-photos.detection.json
	VERIFY_MODE=off $(PY) -m app.evaluate_photos ../test-images --detection-only --json ../benchmarks/real-photos.detection.noindex.json

## synth: generate the fixed-seed synthetic regression set
synth:
	$(PY) -m app.synth --preset regression --out ../data/synth-regression

## docker-test: run lint + tests inside the runtime image
docker-test:
	docker build --target test -t card-scanner-backend:test .

## docker-build: build the runtime image with the tag the compose files pull
docker-build:
	docker build --target runtime -t ghcr.io/andrew-meads/card-scanner-backend:latest .
