# Prepress worker. Targets:
#   dev  - used by docker-compose, source bind-mounted, auto-reload
#   prod - production image (default)
FROM python:3.13.16-slim-trixie AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/app/src
RUN apt-get update \
    && apt-get install -y --no-install-recommends ghostscript \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS dev
COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements-dev.txt
CMD ["watchfiles", "--filter", "python", "python -m worker.main", "src"]

FROM base AS prod
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY src ./src
RUN useradd --system --uid 10001 worker
USER worker
CMD ["python", "-m", "worker.main"]
