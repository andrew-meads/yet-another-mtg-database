# syntax=docker/dockerfile:1

# Slim Python base. We use opencv-python-headless, so NO system GUI/GL libraries
# are required (a normal opencv-python build would need libGL, libglib, etc.).
FROM python:3.12-slim

# Unbuffered stdout/stderr so logs appear immediately; no .pyc clutter.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Install Python deps first so this layer is cached unless requirements change.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application package.
COPY app ./app

# Where de-skewed crops are written; overridable, and bind-mounted in
# docker-compose so the host can inspect results.
ENV CARDS_DIR=/data/cards
RUN mkdir -p /data/cards

EXPOSE 8000

# Start the ASGI server on all interfaces so the host (and LAN devices) can reach it.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
