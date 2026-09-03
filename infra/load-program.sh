#!/usr/bin/env bash
#
# Nạp chương trình ladder vào OpenPLC Runtime rồi khởi động PLC.
#
#   ./infra/load-program.sh                    # nạp infra/plc/conveyor.st
#   ./infra/load-program.sh path/toi/file.st   # nạp file khác
#
# Làm thay việc bấm tay trong web UI: Programs -> Upload -> Compile -> Start PLC.
# Modbus TCP :502 chỉ mở sau khi PLC ở trạng thái Running, nên bước này bắt
# buộc phải chạy trước khi gateway nối được.

set -euo pipefail

BASE_URL="${OPENPLC_URL:-http://127.0.0.1:8081}"
USERNAME="${OPENPLC_USER:-openplc}"
PASSWORD="${OPENPLC_PASS:-openplc}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ST_FILE="${1:-$SCRIPT_DIR/plc/conveyor.st}"

if [[ ! -f "$ST_FILE" ]]; then
  echo "Khong tim thay file chuong trinh: $ST_FILE" >&2
  exit 1
fi

COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

echo "==> Cho OpenPLC san sang tai $BASE_URL"
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "$BASE_URL/login"; then break; fi
  sleep 2
done

echo "==> Dang nhap"
curl -fsS -c "$COOKIE_JAR" -o /dev/null \
  --data-urlencode "username=$USERNAME" \
  --data-urlencode "password=$PASSWORD" \
  "$BASE_URL/login"

echo "==> Tai len $(basename "$ST_FILE")"
UPLOAD_HTML="$(curl -fsS -b "$COOKIE_JAR" -F "file=@$ST_FILE" "$BASE_URL/upload-program")"

# OpenPLC doi ten file thanh <so ngau nhien>.st va tra ve trong input an.
PROG_FILE="$(printf '%s' "$UPLOAD_HTML" |
  grep -oE "value='[0-9]+\.st'" | head -1 | cut -d"'" -f2)"
EPOCH="$(printf '%s' "$UPLOAD_HTML" |
  grep -oE "value='[0-9]+' id='epoch_time'" | head -1 | cut -d"'" -f2)"

if [[ -z "${PROG_FILE:-}" ]]; then
  echo "Khong doc duoc ten file tu phan hoi cua OpenPLC. Dang nhap sai?" >&2
  exit 1
fi
echo "    OpenPLC luu thanh $PROG_FILE"

echo "==> Ghi vao danh sach chuong trinh"
curl -fsS -b "$COOKIE_JAR" -o /dev/null \
  --data-urlencode "prog_name=Smart Factory Conveyor" \
  --data-urlencode "prog_descr=Start/Stop co mach tu giu + E-Stop + cua an toan + dem san luong" \
  --data-urlencode "prog_file=$PROG_FILE" \
  --data-urlencode "epoch_time=${EPOCH:-$(date +%s)}" \
  "$BASE_URL/upload-program-action"

echo "==> Bien dich"
curl -fsS -b "$COOKIE_JAR" -o /dev/null "$BASE_URL/compile-program?file=$PROG_FILE"

for _ in $(seq 1 60); do
  LOGS="$(curl -fsS -b "$COOKIE_JAR" "$BASE_URL/compilation-logs" || true)"
  if printf '%s' "$LOGS" | grep -q "Compilation finished successfully"; then
    echo "    Bien dich thanh cong"
    break
  fi
  if printf '%s' "$LOGS" | grep -qi "error"; then
    echo "Bien dich that bai:" >&2
    printf '%s\n' "$LOGS" >&2
    exit 1
  fi
  sleep 2
done

echo "==> Khoi dong PLC"
curl -fsS -b "$COOKIE_JAR" -o /dev/null "$BASE_URL/start_plc"
sleep 3

echo "==> Trang thai gateway"
curl -fsS "${GATEWAY_URL:-http://127.0.0.1:8000}/health" || true
echo
echo
echo "Xong. Web UI OpenPLC: $BASE_URL  (openplc / openplc)"
