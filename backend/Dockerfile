FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# tesseract-ocr-hin and -guj are what make screenshot analysis work for the
# languages this product exists for. libgomp1 is LightGBM's OpenMP runtime.
RUN apt-get update && apt-get install --no-install-recommends -y \
        tesseract-ocr \
        tesseract-ocr-hin \
        tesseract-ocr-guj \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# requirements.txt deliberately excludes faster-whisper and torch: hosted mode
# reaches speech recognition over the network, and the image must fit a 512MB
# instance and boot in seconds.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY data ./data
COPY models ./models

RUN useradd --create-home --uid 10001 dhanrakshak && chown -R dhanrakshak:dhanrakshak /app
USER dhanrakshak

ENV PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8000')+'/api/health').read()"

# One worker per instance: the workload is I/O bound and the memory budget is
# small. Scale by adding instances, not workers.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --proxy-headers --forwarded-allow-ips=*"]
