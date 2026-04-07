# Multi-stage build for the tiler service
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    libgdal-dev \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml uv.lock* ./
RUN uv sync --frozen --no-dev || uv sync --no-dev

# Production stage
FROM python:3.12-slim-bookworm

WORKDIR /app

RUN groupadd -r appuser && useradd -r -g appuser appuser

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    libgdal32 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/.venv /app/.venv
COPY . .
RUN chown -R appuser:appuser /app

USER appuser
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8001

# Gunicorn with sync workers (tile serving is CPU-bound)
CMD ["sh", "-c", "gunicorn src.main:app \
    --workers ${WORKERS:-4} \
    --worker-class uvicorn.workers.UvicornWorker \
    --bind 0.0.0.0:8001 \
    --timeout ${TIMEOUT:-120} \
    --graceful-timeout 30 \
    --keep-alive 5 \
    --max-requests ${MAX_REQUESTS:-500} \
    --max-requests-jitter 50 \
    --access-logfile - \
    --error-logfile - \
    --log-level info \
    --forwarded-allow-ips '*'"]
# Note: --forwarded-allow-ips '*' is intentional - Azure Container Apps
# manages its own trusted reverse proxy, so all forwarded headers are safe.
