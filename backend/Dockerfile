# Multi-stage build for optimized production image
# Final-stage base comes from the ECR Public mirror of the official image (identical
# digest) because Docker Hub rate-limits the shared ACR build IP. Overridable.
ARG PYTHON_IMAGE=public.ecr.aws/docker/library/python:3.12-slim-bookworm
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder

WORKDIR /app

# Install system dependencies required for building Python packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files
COPY pyproject.toml uv.lock ./

# Install dependencies using uv
RUN uv sync --frozen --no-dev

# Production stage
FROM ${PYTHON_IMAGE}

WORKDIR /app

# Create non-root user for security. The home directory must exist and be
# writable: google/EE client libraries probe it for config, and gunicorn logs
# a "Permission denied: '/home/appuser'" error on every worker recycle without it.
RUN groupadd -r appuser && useradd -r -g appuser -m -d /home/appuser appuser

# Install runtime dependencies only. libpq5 is what psycopg2 links against; the
# psql/pg_dump binaries are deliberately absent, because postgresql-client pulls
# perl in with it and perl is the largest block of unfixable CVEs in this image.
# Nothing here shells out to them - migrations run through alembic, and the
# scripts that do use pg_dump run on a developer machine, not in this container.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Copy virtual environment from builder
COPY --from=builder /app/.venv /app/.venv

# Copy application code
COPY . .

# Create directories for config and logs
RUN mkdir -p /app/config /app/logs && \
    chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Add .venv to PATH
ENV PATH="/app/.venv/bin:$PATH"

# Expose port
EXPOSE 8000

# Run alembic migrations, then start the application with Gunicorn.
# Workers: 2 * CPU cores + 1 (override with WORKERS env var)
# Worker class: uvicorn for async support
#
# max-requests is a leak backstop, not a load control, and 1000 made it the latter:
# UvicornWorker hands it to uvicorn's limit_max_requests, which counts every request at
# the protocol layer - including the 503s the tile bulkhead sheds. Under tile load that
# recycled every worker every ~16s (81 boots in five minutes, measured), and each recycle
# throws away that worker's warm connection pool and drops its in-flight requests. At
# 50000 the backstop still exists but fires on the order of hours rather than seconds.
CMD ["sh", "-c", "alembic upgrade head && exec gunicorn src.main:app \
    --workers ${WORKERS:-1} \
    --worker-class uvicorn.workers.UvicornWorker \
    --bind 0.0.0.0:8000 \
    --timeout ${TIMEOUT:-60} \
    --graceful-timeout ${GRACEFUL_TIMEOUT:-30} \
    --keep-alive ${KEEPALIVE:-5} \
    --max-requests ${MAX_REQUESTS:-50000} \
    --max-requests-jitter ${MAX_REQUESTS_JITTER:-5000} \
    --access-logfile - \
    --error-logfile - \
    --log-level info \
    --forwarded-allow-ips '*'"]
# Note: --forwarded-allow-ips '*' is intentional - Azure Container Apps
# manages its own trusted reverse proxy, so all forwarded headers are safe.
