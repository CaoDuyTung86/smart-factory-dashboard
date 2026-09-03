# Hạ tầng IIoT — Giai đoạn 1

Biến tab **PLC S7-1200** của dashboard từ mô phỏng bằng `useState` thành HMI
thật, đọc/ghi một PLC đang chạy chương trình IEC 61131-3.

```
  Trình duyệt (tab PLC)
        │  WebSocket ws://localhost:8000/ws
  ┌─────▼───────────────┐        MQTT :1883 / WS :9001
  │  Gateway (Python)   ├──────────────► Mosquitto ──► Node-RED / Grafana / …
  └─────▲───────────────┘                (Unified Namespace)
        │  Modbus TCP :502
  ┌─────┴───────────────┐
  │  OpenPLC Runtime    │  chạy infra/plc/conveyor.st
  └─────────────────────┘  Web UI http://127.0.0.1:8081
```

## Chạy

```bash
docker compose -f infra/docker-compose.yml up -d --build
```

Lần đầu mất khoảng 5–10 phút vì OpenPLC phải build từ mã nguồn (dự án không
phát hành image dựng sẵn). Sau đó nạp chương trình ladder vào runtime:

```bash
bash infra/load-program.sh
```

Script làm thay việc bấm tay trong web UI: đăng nhập → upload → biên dịch →
Start PLC. Kết thúc, nó in trạng thái gateway; `"plcConnected": true` là xong.

Cuối cùng trỏ dashboard vào gateway — tạo file `.env.local` ở gốc dự án:

```
VITE_PLC_GATEWAY_URL=http://localhost:8000
```

Chạy `pnpm dev`, mở tab **PLC S7-1200**: nhãn phải chuyển sang
`LIVE — OpenPLC qua Modbus TCP`. Bỏ biến môi trường này đi thì tab quay về chế
độ mô phỏng cục bộ, không mở socket nào — dashboard vẫn deploy lên Netlify được
mà không cần hạ tầng đi kèm.

## Cổng

| Dịch vụ | Cổng host | Ghi chú |
|---|---|---|
| OpenPLC Web UI | `127.0.0.1:8081` | đăng nhập `openplc` / `openplc` |
| OpenPLC Modbus TCP | `502` | slave, unit id 1 |
| Mosquitto MQTT | `1883` | |
| Mosquitto MQTT/WebSocket | `9001` | cho mqtt.js trong trình duyệt |
| Gateway REST/WebSocket | `8000` | `/health`, `/state`, `/command`, `/ws` |

Web UI dùng 8081 chứ không phải 8080 vì 8080 là cổng bị tranh chấp nhất trên
máy dev (Jenkins, Tomcat…). Dùng `127.0.0.1` thay vì `localhost`: nếu có tiến
trình khác đang nghe 8080/localhost trên IPv6, `localhost` sẽ đi vào nhầm chỗ.

## Bản đồ địa chỉ

Ba nơi phải khớp nhau: [`plc/conveyor.st`](plc/conveyor.st),
`gateway/gateway.py`, và tab PLC trên web.

| IEC | Modbus | Tên | Chiều |
|---|---|---|---|
| `%QX0.0` | coil 0 | `conveyor` | PLC ghi |
| `%QX0.2` | coil 2 | `red_tower` | PLC ghi |
| `%QX0.3` | coil 3 | `green_tower` | PLC ghi |
| `%QX1.0` | coil 8 | `start` | HMI ghi |
| `%QX1.1` | coil 9 | `stop` | HMI ghi |
| `%QX1.2` | coil 10 | `estop` | HMI ghi |
| `%QX1.3` | coil 11 | `door_open` | HMI ghi |
| `%QW0` | holding reg 0 | `part_count` | PLC ghi |

Lệnh từ HMI nằm ở vùng `%QX1.x` chứ không phải `%IX`: Modbus master chỉ được
phép **ghi** vào coil và holding register, còn discrete input là vùng chỉ đọc
do phần cứng cấp 24V. Không có nút bấm vật lý nên HMI ghi vào `%QX1.x` và
chương trình chỉ đọc, không bao giờ ghi đè. Khi nối với nút bấm thật hoặc với
Factory I/O, đổi các `CMD_*` sang `%IX0.x` là xong, logic giữ nguyên.

## Điều khiển bằng dòng lệnh

```bash
curl http://127.0.0.1:8000/state
curl -X POST http://127.0.0.1:8000/command -H 'Content-Type: application/json' -d '{"name":"start"}'
curl -X POST http://127.0.0.1:8000/command -H 'Content-Type: application/json' -d '{"name":"estop","value":true}'
```

Lệnh cũng đi được qua MQTT — tiện khi cắm Node-RED vào sau này:

```bash
docker compose -f infra/docker-compose.yml exec mosquitto mosquitto_sub -h 127.0.0.1 -t 'foxconn/#' -v
docker compose -f infra/docker-compose.yml exec mosquitto mosquitto_pub -h 127.0.0.1 -t 'foxconn/hanoi/smt/line-1/plc/cmd/start' -m 1
```

## Kiểm chứng hành vi an toàn

Chuỗi này chứng minh mạch tự giữ và restart interlock chạy đúng trên PLC thật:

1. `start` → `conveyor: true`, `green_tower: true`, `part_count` tăng 1/giây.
2. `estop = true` → `conveyor: false`, `red_tower: true`.
3. `estop = false` → **vẫn dừng**. Nhả nút khẩn cấp không được phép tự khởi
   động lại máy (ISO 13849-1); phải bấm Start lần nữa.

## Những chỗ dễ vấp

**Nạp chương trình xong mà logic không chạy.** Binary do OpenPLC biên dịch nằm
ở `webserver/core` bên trong container, không nằm trong `/docker_persistent`.
Compose đã gắn volume `openplc-core` cho thư mục đó; nếu xoá volume này, hoặc
build lại image, phải chạy lại `load-program.sh`. Triệu chứng rất dễ nhầm:
Modbus vẫn kết nối, đọc/ghi coil vẫn được, nhưng output không bao giờ đổi — vì
runtime đang chạy chương trình rỗng.

**`Start PLC in RUN mode`** được bật sẵn trong Dockerfile bằng cách ghi thẳng
vào SQLite, vì form Settings của OpenPLC không nhận POST từ script. Nhờ vậy
container khởi động lại là runtime chạy tiếp chương trình cũ.

**Cổng 502** cần quyền trên Linux/macOS (cổng < 1024). Nếu vướng, đổi mapping
thành `1502:502` rồi đặt `PLC_PORT: '502'` giữ nguyên (biến này là cổng phía
trong mạng Docker).

## Bảo mật

Toàn bộ stack này mở: MQTT ẩn danh, CORS `*`, mật khẩu OpenPLC mặc định. Nó
được thiết kế để chạy trên máy local hoặc mạng lab. Trước khi đưa ra ngoài phải
bật `password_file` + TLS cho Mosquitto, khoá CORS theo origin, và đổi mật khẩu
OpenPLC.

## Dừng

```bash
docker compose -f infra/docker-compose.yml down          # giữ dữ liệu
docker compose -f infra/docker-compose.yml down -v       # xoá sạch volume
```
