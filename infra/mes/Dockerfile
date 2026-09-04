FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY *.py ./

EXPOSE 8002

# Mot worker duy nhat, co chu dich: mo hinh day chuyen la trang thai trong bo
# nho va danh sach WebSocket cung vay. Hai worker se thanh hai day chuyen chay
# song song ghi de len cung mot bang trang thai.
CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "8002", "--workers", "1"]
