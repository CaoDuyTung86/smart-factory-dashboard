# Tiến độ & Kế hoạch — Smart Factory Dashboard

> **File này dùng để mang sang cuộc trò chuyện mới.** Nó chứa toàn bộ bối cảnh
> cần thiết: dự án là gì, đã làm tới đâu, vì sao chọn cách đó, và việc tiếp theo
> là gì. Đưa file này vào đầu chat mới là đủ để tiếp tục mà không phải kể lại.
>
> Cập nhật lần cuối: **2026-09-03**

---

## 1. Bối cảnh

Dự án cá nhân của một sinh viên/kỹ sư **kỹ thuật phần mềm** từng **thực tập
mảng tự động hoá máy móc**. Mục tiêu không phải là một dashboard đẹp, mà là một
dự án chứng minh được hiểu biết ở cả hai phía: phần mềm *và* hệ thống sản xuất.

Tiêu chí thành công đã thống nhất: người phỏng vấn có nền tự động hoá nhìn vào
phải thấy **đúng nghiệp vụ** (công thức OEE, quy ước đấu dây NC/NO, mạch tự
giữ, giao thức công nghiệp), chứ không chỉ thấy giao diện đẹp. Vì vậy mọi thứ
"trông có vẻ công nghiệp" nhưng sai bản chất đều bị coi là lỗi.

Ràng buộc: không gấp, làm vì đam mê, có một dự án khác đang chạy song song.

---

## 2. Trạng thái hiện tại

| Module | Trạng thái | Ghi chú |
|---|---|---|
| PLC S7-1200 & Ladder | 🟢 **Thật** | Chạy trên OpenPLC qua Modbus TCP; tự xuống thang sang mô phỏng khi không có hạ tầng |
| Hạ tầng IIoT (`infra/`) | 🟢 **Chạy được** | OpenPLC + Mosquitto + gateway Python, đã kiểm chứng end-to-end |
| SCADA Command Center | 🟡 Mô phỏng | OEE đã đúng công thức, dữ liệu cảm biến vẫn sinh trong trình duyệt |
| Digital Twin | 🟡 Mô phỏng | Đã tối ưu hiệu năng bằng rAF |
| Vision AOI | 🟡 Mô phỏng | Toạ độ đã chuẩn hoá 0–1, sẵn sàng nhận kết quả từ OpenCV |
| MES Traceability | 🟡 Mô phỏng | Xuất CSV thật, tra cứu serial có phân biệt không tìm thấy |
| Lưu trữ dữ liệu | 🔴 Chưa có | Refresh là mất sạch |
| Backend MES | 🔴 Chưa có | |
| Kiểm thử module factory | 🔴 Chưa có | Test có sẵn của template không chạy được vì thiếu Playwright chromium |

---

## 3. Nhật ký công việc

### 2026-09-03 — Đợt 1: Hiệu năng

Vấn đề ban đầu: web nặng, tốn RAM.

- Chuyển simulator thành **external store**; mỗi component đăng ký một lát dữ
  liệu qua `useSyncExternalStore` (`src/features/factory/hooks/use-factory-store.ts`).
  Dashboard thành vỏ rỗng → tick 1.5s không còn re-render các tab khác.
- Digital Twin: bỏ `setInterval` + `setState`, dùng `requestAnimationFrame` ghi
  thẳng `transform` vào DOM. **~25 render/giây → ~1,5 render/giây**; đổi `left`
  (gây reflow) sang `transform` (chỉ composite).
- Sửa bug reference: `telemetryHistory` trước đây bị mutate tại chỗ — sẽ làm
  biểu đồ đứng im ngay khi thêm `React.memo`.
- Vá rò rỉ bộ nhớ: `URL.revokeObjectURL` cho ảnh AOI, `AudioContext`
  suspend/close, oscillator tự disconnect.
- Gỡ toàn bộ `backdrop-blur-sm` và các animation trang trí chạy vô hạn.
- Timestamp: chuỗi `toLocaleTimeString()` → epoch ms; trục X của biểu đồ thành
  thang thời gian số; một `Intl.DateTimeFormat` dùng chung.

### 2026-09-03 — Đợt 2: Đúng nghiệp vụ

- **OEE** tính lại theo Nakajima / SEMI E10 (chi tiết ở README). Thêm dải "đồng
  hồ thời gian ca" vì một sự cố 30 giây gần như không nhúc nhích phần trăm OEE
  của cả ca — đó là hành vi thật, nhưng cần chỗ nhìn thấy tác động tức thì.
- **Ladder**: sửa E-Stop từ tiếp điểm NC thành NO (phần "thường đóng" nằm ở đấu
  dây, không nằm trong code); thêm mạch tự giữ; thêm Network 3 cho đèn tháp
  xanh (trước đó code tính nhưng không render); thêm module analog với thang
  Siemens 0–10V ↔ 0…27648 counts; thêm ghi chú an toàn ISO 13849.
- **Wave solder → Reflow**: wave soldering là công nghệ THT, không thuộc dây
  chuyền SMT. Đồng bộ mã tài sản trên cả 3 tab (SCADA / Twin / MES) — số trạm
  là vị trí, mã máy là danh tính.
- **Vision**: bounding box chuẩn hoá 0–1; slider threshold có tác dụng thật kèm
  cảnh báo over-kill.
- **MES**: xuất CSV thật; serial lạ trả về "không tìm thấy".

### 2026-09-03 — Đợt 3: Hạ tầng IIoT giai đoạn 1

- `infra/` với 3 container: OpenPLC (build từ mã nguồn), Mosquitto, gateway Python.
- `infra/plc/conveyor.st` — chương trình Structured Text thật: Start/Stop tự
  giữ, E-Stop, cửa an toàn, đèn tháp, bộ đếm sản lượng bằng TON.
- Gateway: Modbus TCP → MQTT (Unified Namespace, LWT birth/death) + WebSocket +
  REST; tự kết nối lại khi PLC hoặc broker rớt.
- `infra/load-program.sh` — nạp + biên dịch + khởi động PLC bằng script.
- Frontend: `plcGateway.ts` + `use-plc-link.ts`; tab PLC chạy chế độ LIVE khi
  có gateway, mô phỏng khi không có.
- **Đã kiểm chứng end-to-end**: click E-Stop trên web → PLC thật ngắt băng tải,
  đèn tháp đỏ sáng; nhả E-Stop → vẫn dừng (restart interlock); bấm Start → chạy
  lại, bộ đếm tăng 1/giây.

---

## 4. Quyết định đã chốt (đừng lật lại nếu không có lý do mới)

- **Lệnh HMI ghi vào `%QX1.x`, không phải `%IX`.** Modbus master chỉ được ghi
  coil và holding register; discrete input là vùng chỉ đọc do phần cứng cấp
  24V. Khi nối nút bấm thật hoặc Factory I/O thì đổi `CMD_*` sang `%IX0.x`.
- **Lệnh gửi qua WebSocket, không dùng fetch.** WebSocket không bị CORS chặn.
- **Gateway có volume riêng cho `webserver/core`.** Binary do OpenPLC biên dịch
  nằm trong container chứ không nằm trong `/docker_persistent`; thiếu volume
  này thì container tạo lại sẽ âm thầm chạy chương trình rỗng — Modbus vẫn kết
  nối, đọc ghi vẫn được, nhưng output không bao giờ đổi. Đây là lỗi đã thực sự
  mắc phải và mất thời gian truy.
- **OpenPLC Web UI ở cổng 8081, dùng `127.0.0.1`.** Cổng 8080 trên máy này đang
  bị Jenkins chiếm trên IPv6 loopback; `localhost` sẽ đi nhầm vào Jenkins.
- **`Start_run_mode` bật bằng cách ghi thẳng SQLite trong Dockerfile**, vì form
  Settings của OpenPLC không nhận POST từ script.
- **MatIEC không cho trộn biến có địa chỉ (`AT %..`) và biến thường trong cùng
  một khối `VAR`** — phải tách hai khối.
- **Không dùng deep learning cho AOI.** Máy AOI công nghiệp thật phần lớn chạy
  template matching + rule-based; OpenCV cổ điển vừa đúng thực tế vừa dễ giải
  thích khi phỏng vấn.

---

## 5. Việc tiếp theo (theo thứ tự ưu tiên)

### Ưu tiên 1 — Dọn nốt phần frontend còn nợ
- [ ] Tách 5 tab thành 5 route (`/scada`, `/twin`, `/vision`, `/plc`, `/mes`)
      để deep-link được và `autoCodeSplitting` tự chia chunk.
- [ ] `pnpm knip` rồi gỡ `@clerk/react` và `@faker-js/faker` (0 file dùng).
- [ ] Nén 2 ảnh PNG trang sign-in (891KB) sang WebP.
- [ ] `npx playwright install chromium` rồi viết test cho `sensorSimulator`
      (OEE, tích luỹ downtime) và cho logic ladder.

### Ưu tiên 2 — Vision AOI thật bằng OpenCV
Service Python `POST /inspect` nhận ảnh, trả JSON đúng schema
`VisionComponentInspection` đang dùng (toạ độ đã chuẩn hoá 0–1 nên cắm vào là
vẽ đúng ngay). Thuật toán đầu tiên nên làm: **golden-sample diff** — canh ảnh
theo 2 điểm mark (`HoughCircles` → `atan2` → `warpAffine`), `absdiff` với ảnh
mẫu, `threshold`, `findContours`, `boundingRect`. Sau đó thêm `matchTemplate`
cho điểm khớp từng linh kiện.

### Ưu tiên 3 — Lưu trữ & backend MES
- [ ] TimescaleDB (extension của Postgres) lưu telemetry; dùng *continuous
      aggregates* để downsampling — cách đúng đắn để thay cho việc chỉ giữ 40
      điểm trong RAM.
- [ ] Gateway ghi telemetry vào DB thay vì chỉ phát đi.
- [ ] Backend (FastAPI hoặc NestJS): work order, BOM, routing, **genealogy**
      (bo mạch này dùng lô linh kiện nào, qua máy nào, ai vận hành).
- [ ] Chuyển SCADA tab từ simulator sang WebSocket của backend — chỉ cần đổi
      một file vì `sensorSimulator` đã là external store có `subscribe`/`getSnapshot`.

### Ưu tiên 4 — Phần "kỹ sư", chọn 1–2 cái làm sâu
- [ ] **Alarm theo ISA-18.2**: state machine chuẩn (Normal → Unack → Ack →
      RTN), shelving, chống chattering. Hiện tại alarm mới chỉ có cờ boolean.
- [ ] **Predictive maintenance**: FFT tín hiệu rung, tính tần số đặc trưng hỏng
      vòng bi (BPFO/BPFI). Đây là chỗ nền tự động hoá ăn đứt dân thuần web.
- [ ] **SPC**: biểu đồ kiểm soát X-bar/R + Cpk cho độ dày kem hàn (số liệu
      120µm đã có sẵn trong MES timeline).
- [ ] **Factory I/O** nối Modbus với OpenPLC: ladder điều khiển băng tải 3D thật.
- [ ] **Sparkplug B thật** (protobuf, metric alias) thay cho JSON hiện tại.
- [ ] **Store-and-forward** ở gateway: buffer SQLite khi mất mạng, gửi bù khi
      có lại — vấn đề kinh điển của IIoT thật.
- [ ] **OPC UA** (`asyncua`) song song với Modbus — chuẩn giao tiếp L2↔L3.

---

## 6. Cách chạy nhanh

```bash
# Chỉ dashboard
pnpm install && pnpm dev                    # http://localhost:3000

# Kèm PLC thật
docker compose -f infra/docker-compose.yml up -d --build
bash infra/load-program.sh
echo "VITE_PLC_GATEWAY_URL=http://localhost:8000" > .env.local
pnpm dev
```

Kiểm chứng nhanh hạ tầng:

```bash
curl http://127.0.0.1:8000/health
curl -X POST http://127.0.0.1:8000/command -H 'Content-Type: application/json' -d '{"name":"start"}'
curl http://127.0.0.1:8000/state
```

---

## 7. Vấn đề đã biết

- Test suite của template không chạy được: thiếu Playwright chromium
  (`npx playwright install chromium`). Chưa có test nào cho module factory.
- Bundle `_authenticated` khoảng 403KB, chủ yếu do Recharts kéo theo d3. Nếu
  telemetry là trọng tâm, cân nhắc `uPlot` (~40KB).
- Toàn bộ stack `infra/` đang mở (MQTT ẩn danh, CORS `*`, mật khẩu OpenPLC mặc
  định) — chỉ dùng cho máy local / mạng lab.
- Dữ liệu SCADA vẫn mất khi refresh trang.
