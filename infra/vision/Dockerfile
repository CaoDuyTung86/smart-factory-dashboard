FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# opencv-python-headless van can libGL/libglib cho cac module anh.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY recipe.py inspector.py board.py service.py ./
COPY recipes ./recipes

EXPOSE 8001

HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8001/health').read()"

CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "8001"]
