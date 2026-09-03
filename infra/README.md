# Hạ tầng IIoT

Biến hai module của dashboard từ mô phỏng thành hàng thật: **PLC S7-1200** đọc
một PLC đang chạy chương trình IEC 61131-3, và **Vision AOI** gửi ảnh cho một
service OpenCV chấm điểm.

```
  Trình duyệt
    │                                    │  HTTP POST :8001/inspect
    │  WebSocket ws://localhost:8000/ws  │  ┌──────────────────────┐
    │                                    └──►  Vision AOI (OpenCV) │
  ┌─▼───────────────────┐  MQTT :1883/WS :9001 └──────────────────┘
  │  Gateway (Python)   ├──────────────► Mosquitto ──► Node-RED / Grafana / …
  └─────▲───────────────┘                (Unified Namespace)
        │  Modbus TCP :502
  ┌─────┴───────────────┐
  │  OpenPLC Runtime    │  chạy infra/plc/conveyor.st
  └─────────────────────┘  Web UI http://127.0.0.1:8081
```

Hai nhánh độc lập nhau: chạy được riêng từng cái, và thiếu cái nào thì module
tương ứng trên web tự lui về chế độ mô phỏng.

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

Cuối cùng trỏ dashboard vào hạ tầng — tạo file `.env.local` ở gốc dự án:

```
VITE_PLC_GATEWAY_URL=http://localhost:8000
VITE_VISION_API_URL=http://localhost:8001
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
| Vision AOI | `8001` | `/health`, `/recipes`, `/inspect`, `/samples` |

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

---

# Vision AOI (OpenCV)

Chỉ cần service này, không cần PLC:

```bash
docker compose -f infra/docker-compose.yml up -d --build vision
curl http://127.0.0.1:8001/health
```

Tab **Vision AOI** sẽ đổi nhãn sang `LIVE — OpenCV golden-sample` và hiện năm
nút ảnh mẫu do chính service sinh ra. Nút "Tải Ảnh Bo Mạch Tùy Chỉnh" gửi ảnh
thật lên `POST /inspect`.

## Thuật toán

Chạy đúng trình tự của một máy AOI thật —
[`vision/inspector.py`](vision/inspector.py):

1. **Tìm fiducial** (mark point) bằng `HoughCircles`.
2. **Căn ảnh**: từ 2 fiducial suy ra góc xoay (`atan2`) và hệ số tỷ lệ, dựng
   ma trận affine, `warpAffine` đưa ảnh chụp về đúng khung ảnh mẫu.
3. **Template matching** từng ô: `matchTemplate` với `TM_CCOEFF_NORMED` cho
   điểm khớp và độ lệch vị trí.
4. **So với ảnh mẫu** tại vị trí khớp tốt nhất: `absdiff` → `threshold` →
   `findContours` → `boundingRect`.
5. **Quét phần bo mạch còn lại** để bắt vật lạ nằm ngoài mọi ô linh kiện.

Bước 1–2 là bước không được bỏ. Bo mạch trên băng tải không bao giờ nằm đúng
một chỗ; so ảnh chụp thẳng với ảnh mẫu mà không căn trước thì lệch 3 pixel là
cả bo mạch báo lỗi.

Thứ tự phán định đi từ lỗi nặng nhất, và sự phân biệt này có ý nghĩa thực tế:
"thiếu linh kiện" thì đi kiểm tra băng tải cấp linh kiện, "lệch chân" thì đi
chỉnh toạ độ pick & place. Báo nhầm loại là kỹ sư đi sửa nhầm máy.

**Phép so ảnh chạy trên ảnh màu, không phải ảnh xám.** Một sợi dây đỏ
(B30 G30 R190) trên sơn phủ xanh (B58 G92 R40) chuyển sang ảnh xám chỉ lệch 5
mức — gần như tàng hình. Trên bo mạch thật, màu mới là thứ phân biệt được thiếc
(xám), sơn phủ (xanh), đồng (vàng) và vật lạ.

**Không dùng deep learning** — máy AOI công nghiệp thật phần lớn cũng không.
Dây chuyền mới chạy chưa có đủ ảnh lỗi để huấn luyện; kỹ sư quy trình cần biết
*tại sao* một bo mạch bị loại để chỉnh máy, chứ không chỉ cần một con số xác
suất; và khi khách đổi một linh kiện thì phải sửa được chương trình kiểm tra
trong buổi sáng chứ không phải gán nhãn lại vài nghìn ảnh.

## Recipe — chương trình kiểm tra

Mỗi model bo mạch có một recipe ([`vision/recipes/*.json`](vision/recipes)):
ảnh mẫu, vị trí fiducial, danh sách ô kiểm tra và **ngưỡng riêng cho từng ô**.
Đổi model là nạp recipe khác, không sửa mã nguồn — đúng cách máy thật làm việc.

Ngưỡng để ở cấp linh kiện vì một con IC và một dãy chân hàn không thể dùng
chung một ngưỡng: chân hàn vốn đã nhiều biến động hơn nhiều.

| Tham số | Ý nghĩa |
|---|---|
| `match_threshold` | Điểm khớp NCC tối thiểu. Dưới ngưỡng = thiếu linh kiện. |
| `shift_tolerance_px` | Độ lệch vị trí tối đa còn chấp nhận. |
| `defect_area_ratio` | Tỷ lệ diện tích sai khác cho phép trong ô. |
| `search_margin_px` | Vùng tìm quanh ô. Phải lớn hơn `shift_tolerance_px` rõ rệt, nếu không một linh kiện lệch sẽ rơi ra ngoài vùng tìm và bị báo nhầm là "thiếu". |

## Ảnh mẫu

Ảnh mẫu và ảnh demo được **sinh bằng code** ([`vision/board.py`](vision/board.py)),
không có ảnh nhị phân nào nằm trong repo. Lý do: một ảnh chụp thật thì không ai
kiểm chứng được — không biết nó đúng hay sai, và không tái tạo lại được. Ảnh
sinh bằng code thì biết chính xác lỗi nằm ở đâu, nên test khẳng định được "phải
báo lệch chân C45 với offset (+14, +3)" thay vì chỉ "có vẻ chạy được".

Hình học lấy thẳng từ recipe, nên ảnh mẫu và các ô kiểm tra không thể lệch nhau.

## Thử bằng dòng lệnh

```bash
curl http://127.0.0.1:8001/recipes
curl -X POST 'http://127.0.0.1:8001/inspect?sample=solder-bridge'
curl -X POST 'http://127.0.0.1:8001/inspect' -F 'file=@bo-mach.png'
curl http://127.0.0.1:8001/golden/mbp-m3-logic-rev-b -o golden.png
```

## Kiểm thử

```bash
cd infra/vision
pip install -r requirements.txt pytest httpx
pytest
```

37 test: căn ảnh chịu được xoay/tịnh tiến, từng kiểu lỗi báo đúng ô linh kiện,
lệch trong dung sai thì không bị loại oan, và schema JSON đúng cái frontend đọc
(frontend không kiểm tra kiểu lúc chạy — đổi tên một trường là bảng điều khiển
im lặng hỏng chứ không báo lỗi).

---

## Bảo mật

Toàn bộ stack này mở: MQTT ẩn danh, CORS `*` (cả gateway lẫn vision), mật khẩu
OpenPLC mặc định. Service vision nhận file tải lên không cần xác thực. Nó
được thiết kế để chạy trên máy local hoặc mạng lab. Trước khi đưa ra ngoài phải
bật `password_file` + TLS cho Mosquitto, khoá CORS theo origin, và đổi mật khẩu
OpenPLC.

## Dừng

```bash
docker compose -f infra/docker-compose.yml down          # giữ dữ liệu
docker compose -f infra/docker-compose.yml down -v       # xoá sạch volume
```
