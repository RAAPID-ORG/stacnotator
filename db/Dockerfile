FROM pgvector/pgvector:pg16-trixie

# Install PostGIS matching the PG 16 base image
RUN apt-get update && \
    apt-get install -y --no-install-recommends postgresql-16-postgis-3 && \
    rm -rf /var/lib/apt/lists/*
