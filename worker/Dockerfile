FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgdal-dev \
    gdal-bin \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml .
COPY src/ /app/src/
RUN pip install --no-cache-dir .

CMD ["python", "-m", "src.main"]
