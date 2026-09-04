# Hạ tầng IIoT

Biến các module của dashboard từ mô phỏng thành hàng thật: **PLC S7-1200** đọc
một PLC đang chạy chương trình IEC 61131-3, **Vision AOI** gửi ảnh cho một
service OpenCV chấm điểm, và **SCADA / MES** đọc số liệu từ một backend có
historian thật thay vì tự sinh trong trình duyệt.

```
  Trình duyệt
    │                                    │  HTTP POST :8001/inspect
    │  WebSocket ws://localhost:8000/ws  │  ┌──────────────────────┐
    │  WebSocket ws://localhost:8002/ws  └──►  Vision AOI (OpenCV) │
    │  HTTP      :8002/api/...              └──────────────────────┘
  ┌─▼───────────────────┐  MQTT :1883/WS :9001
  │  Gateway (Python)   ├──────────────► Mosquitto ──► Node-RED / Grafana / …
  └──▲───────────┬──────┘                (Unified Namespace)
     │           │ asyncpg          ┌──────────────────────────┐
     │           └─────────────────►│  TimescaleDB :5432       │
     │  Modbus TCP :502             │  hypertable + 2 cagg     │
  ┌──┴──────────────────┐           │  + schema MES            │
  │  OpenPLC Runtime    │           └──────────▲───────────────┘
  └─────────────────────┘                      │ asyncpg
    chạy infra/plc/conveyor.st       ┌──────────┴───────────────┐
    Web UI http://127.0.0.1:8081     │  Backend MES :8002       │
                                     │  mô hình dây chuyền + OEE │
                                     │  REST + WebSocket         │
                                     └───────────────────────────┘
```

Các nhánh độc lập nhau: chạy được riêng từng cái, và thiếu cái nào thì module
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
VITE_MES_API_URL=http://localhost:8002
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
| TimescaleDB | `5432` | `factory` / `factory` / db `factory` |
| Backend MES | `8002` | `/health`, `/api/...`, `/ws` |

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

# Historian & Backend MES

`db/` là schema TimescaleDB, `mes/` là backend FastAPI. Hai thứ này trả lời hai
câu hỏi mà bản chỉ chạy trong trình duyệt không trả lời được: *"số liệu 3 tiếng
trước thế nào"* và *"bo mạch này dùng lô linh kiện nào"*.

## Vì sao TimescaleDB chứ không phải một bảng Postgres thường

Telemetry chỉ ghi thêm, truy vấn gần như luôn có điều kiện thời gian, và lớn
rất nhanh: 5 tag × 4 máy × 1 điểm/1.5s ≈ **800 nghìn dòng/ngày**. TimescaleDB
chia bảng thành chunk theo thời gian, nên xoá dữ liệu cũ là drop chunk chứ
không phải `DELETE` quét cả bảng, và nén được theo cột với tỉ lệ ~10–20 lần.

Ba tầng dữ liệu, mỗi tầng một tuổi thọ:

| Bảng | Nội dung | Giữ | Dùng khi |
|---|---|---|---|
| `telemetry` | điểm thô, ~1.5s một điểm | 30 ngày (nén sau 7 ngày) | khoảng ≤ 2 giờ |
| `telemetry_1m` | continuous aggregate 1 phút | 1 năm | khoảng ≤ 7 ngày |
| `telemetry_1h` | cagg 1 giờ, dựng từ cagg 1 phút | 5 năm | khoảng > 7 ngày |

Backend tự chọn tầng theo độ dài khoảng thời gian (`choose_resolution`). Một
biểu đồ 30 ngày đọc bảng thô là ~1,7 triệu dòng cho một tag; đọc cagg 1 giờ là
720 dòng. Nhìn trên màn hình gần như giống nhau, chi phí khác nhau ba bậc.

**Cagg giữ cả min/max chứ không chỉ avg.** Trung bình 1 phút làm biến mất đúng
cái gai nhọn cần nhìn thấy; biểu đồ downsample mà bỏ dải min–max là nói dối về
dữ liệu.

## Trung bình của trung bình là sai

Cagg 1 giờ được dựng từ cagg 1 phút (hierarchical continuous aggregate) — rẻ
hơn quét lại bảng gốc 60 lần. Nhưng `avg(avg_value)` chỉ đúng khi mọi bucket
con có cùng số mẫu, mà điều đó không đúng: mất kết nối PLC 40 giây thì bucket
phút đó chỉ còn 13 mẫu thay vì 40.

Vì vậy cagg lưu **tổng có trọng số**, còn view bên trên mới chia ra:

```sql
weighted_sum / sample_count   -- không phải avg(avg_value)
```

Chênh lệch có thật, đo được ngay trên máy:

```
bucket 01:19  avg 52.35  (6 mẫu)     avg(avg) = 52.287
bucket 01:20  avg 52.54  (39 mẫu)    có trọng số = 52.371
bucket 01:21  avg 51.97  (16 mẫu)
```

## Bảng MES

```
product ──┬── bom_item          cái gì phải có, ở vị trí nào (ref_des)
          └── routing_step      thứ tự trạm bắt buộc

work_order ── unit ──┬── unit_step       một lần đi qua một trạm (có attempt)
                     ├── unit_material   ◄── GENEALOGY: lô nào vào bo mạch nào
                     └── defect

material_lot ────────┘
```

`unit_material` là bảng đáng giá nhất ở đây. Nó cho phép trả lời cả hai chiều:

- **Xuôi** — `GET /api/units/{serial}`: bo mạch này đã ăn những lô nào.
- **Ngược (thu hồi)** — `GET /api/lots/{lot}/impact`: lô này đã đi vào những
  bo mạch nào, đang ở đâu.

Dữ liệu mẫu dựng sẵn một tình huống có thật: lô tụ `LOT-CAP-2609-B` bị nhà cung
cấp báo lỗi sau khi đã giao hàng. Truy vấn thu hồi trả về **20 bo mạch, trong
đó 14 đã PASS toàn bộ AOI**. Đó chính là lý do genealogy phải tồn tại độc lập
với kết quả kiểm tra: "đã PASS" không đồng nghĩa "ngoài diện thu hồi". Serial
`FOX-APPLE-M3-90821` (serial mặc định trên giao diện) được chọn có chủ đích —
nó PASS mọi trạm và vẫn nằm trong diện thu hồi.

## Backend MES làm gì

```
line_loop   đẩy mô hình dây chuyền 1.5s/lần → ghi historian → phát WebSocket
historian   gom điểm đo thành lô rồi COPY xuống hypertable
mqtt        nghe bộ đếm sản lượng của PLC thật trên Unified Namespace
```

Đây là điểm chuyển quan trọng nhất của đợt này: **nguồn dữ liệu SCADA chuyển
từ trình duyệt xuống server.** Trước đó mỗi tab tự sinh số riêng, nên hai người
xem thấy hai dây chuyền khác nhau và F5 là mất sạch. Giờ chỉ có một vòng tick,
ghi xuống DB, phát cho mọi trình duyệt — đúng quan hệ giữa SCADA server và HMI.

Số liệu nhiệt độ/rung **vẫn là mô phỏng**. Cái thật ở đây là đường đi (tick →
historian → WebSocket → nhiều client) và bộ đếm sản lượng của trạm SMT: khi
gateway đang sống, trạm đó lấy số từ bộ đếm PLC thật, và payload đánh dấu
`countSource: "plc"` thay vì `"model"` để không ai nhầm số suy ra với số đo được.

Vài chi tiết đáng nói:

- **Vòng tick không bao giờ chờ DB.** Điểm đo vào một hàng đợi có giới hạn, một
  task riêng `COPY` xuống theo lô. `await INSERT` ngay trong tick là cách chắc
  chắn nhất để biến một trục trặc của DB thành một trục trặc của SCADA.
- **Hàng đợi tràn thì bỏ điểm cũ nhất và đếm lại**, rồi báo ra `/health`. Hàng
  đợi không giới hạn chỉ đổi lỗi mất dữ liệu lấy lỗi hết RAM, và giấu mất nó
  còn tệ hơn.
- **Bộ đếm ca sống sót qua khởi động lại.** OEE là tỉ số của những con số cộng
  dồn từ đầu ca; reset về 0 mỗi lần deploy lại thì con số vô nghĩa. Trạng thái
  được ghi xuống `machine_shift_state` mỗi 20 tick và đọc lại lúc khởi động.
- **Ngưỡng cảnh báo nằm ở bảng `asset`, không nằm trong code.** Lò reflow chạy
  245°C là bình thường, máy gắn linh kiện 245°C là cháy. Đổi một ngưỡng là việc
  của kỹ sư quy trình, không nên phải build lại frontend.
- **Bộ đếm PLC tràn 16 bit không thành sản lượng âm.** 65535 → 0 là tràn thanh
  ghi; mất kết nối rồi nối lại thì bộ đếm đã nhảy vài nghìn. Cả hai trường hợp
  đều lấy lại mốc chứ không bơm con số đó vào sản lượng của một tick.

## Gateway ghi gì xuống historian

Gateway ghi tag PLC (`conveyor`, `red_tower`, `green_tower`, `part_count`,
`estop`) dưới mã tài sản `CONVEYOR-01`, theo kiểu **báo cáo khi thay đổi**
(exception reporting) chứ không phải mỗi vòng poll: băng tải đứng yên 10 phút
không sinh ra 3.000 dòng giống hệt nhau. Cộng thêm một nhịp nền 30 giây để phân
biệt "không đổi" với "mất kết nối", và một mốc `quality = 24` (BAD, theo tinh
thần OPC StatusCode) tại thời điểm mất PLC — không có nó thì biểu đồ nối thẳng
qua khoảng mất kết nối và trông như máy vẫn chạy bình thường suốt thời gian đó.

Bỏ biến `DATABASE_URL` đi thì gateway chạy y hệt như trước, chỉ là không ghi gì.

## Thử bằng dòng lệnh

```bash
curl -s http://127.0.0.1:8002/health
curl -s "http://127.0.0.1:8002/api/units/FOX-APPLE-M3-90821"
curl -s "http://127.0.0.1:8002/api/lots/LOT-CAP-2609-B/impact"
curl -s "http://127.0.0.1:8002/api/telemetry?asset=SMT-LINE-01&metric=temperature&minutes=30"
curl -s "http://127.0.0.1:8002/api/defects/pareto?hours=24"
```

Xem trực tiếp trong DB:

```bash
docker exec -it smart-factory-timescaledb psql -U factory -d factory
```

```sql
-- Ba tầng dữ liệu
SELECT count(*) FROM telemetry;
SELECT count(*) FROM telemetry_1m;

-- Chính sách vòng đời đang chạy
SELECT proc_name, hypertable_name, schedule_interval
FROM timescaledb_information.jobs ORDER BY job_id;

-- Truy vấn thu hồi
SELECT u.status, count(*) FROM unit_material um
JOIN unit u USING (serial_number)
WHERE um.lot_code = 'LOT-CAP-2609-B' GROUP BY 1;
```

Cagg được policy làm mới theo lịch (1 phút / 30 phút). Muốn thấy ngay thì gọi
tay:

```sql
CALL refresh_continuous_aggregate('telemetry_1m', NULL, NULL);
CALL refresh_continuous_aggregate('telemetry_1h_acc', NULL, NULL);
```

## Kiểm thử

```bash
cd infra/mes
python -m venv .venv && . .venv/Scripts/activate   # Linux/macOS: . .venv/bin/activate
pip install -r requirements.txt pytest httpx
pytest
```

54 test, không cần DB: công thức OEE đối chiếu cùng ví dụ mẫu với bản
TypeScript, mô hình dây chuyền chạy với `random.Random(seed)` nên lặp lại được,
historian kiểm chính sách chọn bảng và hành vi khi hàng đợi tràn, và bộ đếm PLC
kiểm các trường hợp tràn thanh ghi / mất kết nối.

---

# Quản lý cảnh báo — ANSI/ISA-18.2

Bản trước chỉ có một bảng `alarm_event` với một cờ `acknowledged`. Bảng đó đã bị
bỏ — không phải vì nó sai, mà vì nó trả lời được đúng một câu hỏi ("hiện có gì
đang kêu") trong khi một hệ cảnh báo phải trả lời được ba. Ba câu hỏi thành ba
bảng, và ba tuổi thọ khác nhau:

| Bảng               | Trả lời                                              | Sống cùng           |
| ------------------ | ---------------------------------------------------- | ------------------- |
| `alarm_definition` | Vì sao cảnh báo này tồn tại, người vận hành làm gì?   | hồ sơ thiết bị      |
| `alarm_transition` | Nó đã đi qua trạng thái nào, lúc nào, do ai?          | hồ sơ kiểm toán     |
| `alarm_state`      | Ngay bây giờ nó ở đâu (và sống sót qua restart chưa)? | phiên chạy hiện tại |

## Bảy trạng thái, và trạng thái hay bị bỏ quên

```
                 điều kiện đúng            xác nhận
      NORMAL ────────────────────► UNACK_ALM ────────► ACKED_ALM
        ▲                            │                    │
        │  xác nhận                  │ điều kiện hết       │ điều kiện hết
        │                            ▼                    │
        └──────────────────────  RTN_UNACK ◄──────────────┘
                                     │  điều kiện quay lại
                                     └──────────► UNACK_ALM

   SHELVED · SUPPRESSED_BY_DESIGN · OUT_OF_SERVICE — ba đường tới cùng một
   sự im lặng, cố ý tách ba vì ai có quyền bật/tắt chúng là khác nhau.
```

**`RTN_UNACK` là trạng thái đáng giá nhất.** Sự cố xảy ra rồi tự hết trong ba
giây; nếu hệ thống chỉ có một cờ boolean thì không còn dấu vết nào trên màn
hình. Mà đúng loại sự cố thoáng qua đó mới là loại hay lặp lại — nó sẽ quay lại
vào ca đêm khi không ai ngồi đấy.

**Ba trạng thái im lặng không được gộp làm một.** Shelve là người vận hành, tạm
thời, **có hạn giờ và tự bật lại**. Suppress là logic thiết kế (không báo áp
suất thấp khi bơm đang tắt). Out-of-service là bảo trì. Gộp lại là mất khả năng
trả lời "ai đã tắt cái này, theo thẩm quyền nào". Cả ba đều hiện trong danh sách
riêng **trong cùng gói tin WebSocket** — tắt một cảnh báo mà không có chỗ nào
nhìn lại được thì đúng là đã xoá nó.

## Chống chattering: hai cơ chế, hai bệnh

| Cơ chế       | Chữa bệnh                                | Không chữa được |
| ------------ | ---------------------------------------- | --------------- |
| Deadband     | giá trị dao động **quanh đúng setpoint** | xung nhọn       |
| On/off-delay | giá trị **nhảy vọt rồi về ngay**         | dao động chậm   |

**Deadband chỉ nới rộng phía TẮT.** Cảnh báo HI bật tại `value > setpoint` nhưng
chỉ tắt khi `value < setpoint − deadband`. Làm ngược lại (bật tại
`setpoint + deadband`) là lỗi hay gặp, và nó làm chậm đúng cái cảnh báo mà kỹ sư
vừa đặt setpoint cho: người ta chọn 75 độ vì 75 độ là ngưỡng, không phải 78.

**Bộ đếm on-delay tính lại từ đầu mỗi lần điều kiện đổi chiều** — đó chính là lý
do một xung thoáng qua không bao giờ chạm tới ngưỡng. Một xung rung 0.2 giây vọt
lên gấp đôi ngưỡng thì deadband bao nhiêu cũng không chặn nổi.

Độ trễ trong cấu hình mẫu cố ý **không đối xứng** và **khác nhau theo loại tín
hiệu**:

| Cảnh báo    | on-delay | off-delay | Vì sao                                                             |
| ----------- | -------- | --------- | ------------------------------------------------------------------ |
| `TEMP.HI`   | 6s       | 10s       | nhiệt độ có quán tính; xung 1.5 giây gần như luôn là nhiễu cảm biến |
| `TEMP.HIHI` | 2s       | 30s       | muốn biết thật nhanh, nhưng không nhấp nháy khi máy nguội chậm      |
| `VIB.HI`    | 10s      | 15s       | rung là tín hiệu xung — xe nâng đi ngang cũng làm kim nhảy          |
| `ESTOP`     | 0s       | 0s        | **không bao giờ trễ một cảnh báo an toàn**                          |

Quy tắc cuối được chặn ở **cả hai tầng**: `AlarmDefinition.__post_init__` ném lỗi
ngay khi dựng, và bảng có `CONSTRAINT alarm_safety_khong_duoc_tre`. Lặp lại là
cố ý — bảng đó là chỗ kỹ sư quy trình sửa bằng tay bằng SQL, không phải chỉ qua
mã nguồn Python.

## Rationalization: cảnh báo nào không có hành động thì không phải cảnh báo

`alarm_definition` lưu ba cột mà ISA-18.2 bắt buộc phải có: `consequence`,
`operator_response`, `response_time_sec`. Mức ưu tiên được **suy ra** từ chúng
(hậu quả nặng + thời gian phản ứng ngắn = ưu tiên cao), nên lưu mức ưu tiên mà
không lưu căn cứ thì lần sau không ai rà soát lại được.

Chính quy tắc "không điền nổi `operator_response` thì đây không phải cảnh báo"
đã **loại bỏ cảnh báo `Line Speed Overclocked`** của bản trước: người vận hành
vừa tự tay kéo thanh trượt lên 2.5x, báo lại cho họ điều họ vừa làm là một sự
kiện, không phải một cảnh báo. Thay vào đó, đẩy dây nhanh làm máy nóng lên (theo
tỉ lệ **dư địa nhiệt của chính máy đó** — lò reflow còn 17 độ, máy gắn linh kiện
còn 22 độ) và ăn thêm điện. Hậu quả đo được, và chính nó kích cảnh báo.

Cấu hình sinh từ bảng `asset` bằng `INSERT ... SELECT`, không gõ lại tay từng
con số: ngưỡng nằm ở hồ sơ thiết bị, cảnh báo chỉ trỏ tới nó.

## Cảnh báo không phải interlock

Trạng thái máy do **điều kiện quá trình** quyết định (nhiệt độ vượt tới hạn thì
dừng, E-Stop thì dừng); `AlarmEngine` chỉ **quan sát** cùng những số đo đó rồi
báo cho người. Để trạng thái máy bám theo trạng thái cảnh báo thì một off-delay
30 giây đặt để chống nhấp nháy sẽ biến thành 30 giây máy không chịu chạy lại sau
khi đã sửa xong. Trong nhà máy thật, cắt điện là việc của mạch an toàn và của
PLC; màn hình cảnh báo không điều khiển gì cả.

Hệ quả trực tiếp: **`repair()` không xác nhận hộ cảnh báo.** Sửa máy là hành
động vật lý, xác nhận là hành động của người vận hành. Gộp hai việc lại thì
`RTN_UNACK` không còn lý do tồn tại.

## Chỉ số hiệu năng (điều 16 / EEMUA 191)

`GET /api/alarms/performance?hours=24` trả về bảng chỉ số kèm **phán định
đạt/không đạt** theo chỉ tiêu công bố của tiêu chuẩn:

| Chỉ số                               | Chỉ tiêu                    |
| ------------------------------------ | --------------------------- |
| Cảnh báo trung bình / 10 phút        | ≤ 1 (tối đa quản lý nổi ≤ 2) |
| Đỉnh trong một khoảng 10 phút        | ≤ 10                        |
| % khoảng 10 phút bị alarm flood      | ≤ 1%                        |
| % tải do 10 tag kêu nhiều nhất       | ≤ 5%                        |
| Chattering (≥3 lần kêu trong 1 phút) | 0                           |
| Stale (kêu liên tục > 24 giờ)        | < 5                         |
| Phân bố ưu tiên                      | ~80 / 15 / 5 / <1           |
| Shelve không ghi lý do               | 0                           |

Ba điểm đáng nói về cách tính:

- **Mẫu số là toàn bộ thời gian của cửa sổ**, kể cả những khoảng 10 phút không
  có cảnh báo nào. Bỏ khoảng rỗng đi là cách dễ nhất để một hệ thống đang ngồi
  trên một trận cảnh báo vẫn báo cáo đẹp.
- **Chattering dùng cửa sổ TRƯỢT 60 giây**, không cắt khúc theo phút. Ba lần kêu
  lúc 10:00:59, 10:01:00, 10:01:01 là chattering thật, nhưng cắt khúc theo phút
  sẽ thấy "1 lần rồi 2 lần" và không báo gì.
- **Mọi chỉ số tính từ `alarm_transition`**, không từ danh sách đang sống: danh
  sách đang sống không nhớ gì về cái vừa tắt một giây trước, mà chattering thì
  chỉ nhìn thấy trong lịch sử.

`alarm_transition` **chép** `priority` / `alarm_class` / `message` vào từng dòng
thay vì join sang cấu hình. Lần sau kỹ sư hạ một cảnh báo từ HIGH xuống LOW,
lịch sử vẫn phải nói rằng lúc đó nó là HIGH — nếu join, mọi biểu đồ xu hướng sẽ
tự viết lại quá khứ mỗi lần cấu hình đổi. Cũng vì vậy `tag` **không** có khoá
ngoại tới `alarm_definition`: hồ sơ kiểm toán phải sống sót khi một cảnh báo bị
gỡ khỏi cấu hình.

Bảng này là bảng thường, không phải hypertable, và **không có chính sách xoá**:
telemetry thô sống 30 ngày vì nó là một dãy số lặp lại, còn nhật ký cảnh báo là
hồ sơ vận hành.

## Thử bằng dòng lệnh

```bash
curl -s "http://127.0.0.1:8002/api/alarms"
curl -s "http://127.0.0.1:8002/api/alarms/definitions"
curl -s "http://127.0.0.1:8002/api/alarms/performance?hours=24"
curl -s "http://127.0.0.1:8002/api/alarms/journal?hours=8&limit=50"
```

```sql
-- Một lần kêu, gom từ nhật ký: kêu lúc nào, ai xác nhận, bao lâu mới hết
SELECT tag, raised_at, acked_at, rtn_at FROM alarm_occurrence
ORDER BY raised_at DESC LIMIT 20;

-- Bad actor trong 24 giờ
SELECT tag, count(*) FROM alarm_transition
WHERE to_state = 'UNACK_ALM' AND occurred_at >= now() - INTERVAL '24 hours'
GROUP BY 1 ORDER BY 2 DESC LIMIT 10;

-- Đang bị tắt tiếng
SELECT tag, state, shelved_until, shelve_reason FROM alarm_state
WHERE state IN ('SHELVED', 'SUPPRESSED_BY_DESIGN', 'OUT_OF_SERVICE');
```

> **Schema đã đổi.** Bảng `alarm_event` không còn; `alarm_definition`,
> `alarm_transition` và `alarm_state` là bảng mới. Script trong `db/init/` chỉ
> chạy trên volume rỗng, nên volume cũ phải xoá:
> `docker compose -f infra/docker-compose.yml down -v` rồi `up -d`.

## Kiểm thử

```bash
cd infra/mes && python -m pytest        # gồm test_alarms.py + test_alarm_metrics.py
```

Máy trạng thái đi qua thời gian bằng tham số `now` chứ không bằng `sleep`, nên
một cảnh báo có on-delay 10 giây được kiểm tra trong 0 giây — đó là lý do
`AlarmEngine` không bao giờ tự đọc đồng hồ hệ thống.

Bản TypeScript (`src/features/factory/lib/isa18.ts`) là bản cài đặt **thứ hai**
của cùng máy trạng thái, dùng khi chạy ngoại tuyến. `isa18.test.ts` là bản dịch
từng ca của `test_alarms.py` — cùng số liệu, cùng mốc thời gian, cùng kết quả
mong đợi. Hai bản lệch nhau một nhánh là lúc màn hình khi demo không còn là màn
hình hệ thống thật tạo ra.

---

## Bảo mật

Toàn bộ stack này mở: MQTT ẩn danh, CORS `*` (gateway, vision và MES), mật khẩu
OpenPLC mặc định, và Postgres dùng `factory`/`factory` với cổng 5432 publish ra
host. Service vision nhận file tải lên không cần xác thực; backend MES nhận
lệnh WebSocket không xác thực — bất kỳ ai mở được cổng 8002 đều bấm được E-Stop.
Nó được thiết kế để chạy trên máy local hoặc mạng lab. Trước khi đưa ra ngoài
phải bật `password_file` + TLS cho Mosquitto, khoá CORS theo origin, xác thực
lệnh điều khiển, đổi mật khẩu OpenPLC và Postgres, và bỏ publish cổng 5432.

## Dừng

```bash
docker compose -f infra/docker-compose.yml down          # giữ dữ liệu
docker compose -f infra/docker-compose.yml down -v       # xoá sạch volume
```
