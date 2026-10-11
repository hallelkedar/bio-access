FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dependencies first: this layer is reused until requirements.txt changes.
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY alembic.ini .
COPY app ./app

# Run as an unprivileged user; it owns only the folders it writes to (volumes).
RUN useradd --create-home --uid 10001 bioaccess \
    && mkdir -p /app/media /data \
    && chown bioaccess:bioaccess /app/media /data
USER bioaccess

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"

# Apply migrations, then serve. The backend is reachable only from the nginx container,
# so trusting its X-Forwarded-* headers is safe and gives rate limits the real client IP.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"]
