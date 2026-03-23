FROM python:3.11-slim

WORKDIR /app

# GDAL and build dependencies
RUN apt-get update && apt-get install -y \
    gdal-bin \
    libgdal-dev \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Rust — required to build cramjam
RUN curl https://sh.rustup.rs -sSf | sh -s -- -y --default-toolchain stable
ENV PATH="/root/.cargo/bin:${PATH}"

# GDAL Python bindings need to match the system GDAL version
RUN pip install --no-cache-dir GDAL==$(gdal-config --version)

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

ENV GDAL_HTTP_MERGE_CONSECUTIVE_RANGES=YES
ENV GDAL_HTTP_MULTIPLEX=YES
ENV GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR
ENV CPL_VSIL_CURL_CACHE_SIZE=200000000
ENV GDAL_CACHEMAX=200
ENV VSI_CACHE=TRUE
ENV VSI_CACHE_SIZE=5000000

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]