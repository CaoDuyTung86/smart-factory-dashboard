# Tiến độ & Kế hoạch — Smart Factory Dashboard

> **File này dùng để mang sang cuộc trò chuyện mới.** Nó chứa toàn bộ bối cảnh
> cần thiết: dự án là gì, đã làm tới đâu, vì sao chọn cách đó, và việc tiếp theo
> là gì. Đưa file này vào đầu chat mới là đủ để tiếp tục mà không phải kể lại.
>
> Cập nhật lần cuối: **2026-09-03** (đợt 5)

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
| Hạ tầng IIoT (`infra/`) | 🟢 **Chạy được** | OpenPLC + Mosquitto + gateway + vision AOI, đã kiểm chứng end-to-end |
| SCADA Command Center | 🟡 Mô phỏng | OEE đã đúng công thức, dữ liệu cảm biến vẫn sinh trong trình duyệt |
| Digital Twin | 🟡 Mô phỏng | Đã tối ưu hiệu năng bằng rAF |
| Vision AOI | 🟢 **Thật** | Service Python + OpenCV: căn ảnh theo fiducial rồi so ảnh mẫu; tự xuống thang sang mô phỏng khi không có service |
| MES Traceability | 🟡 Mô phỏng | Xuất CSV thật, tra cứu serial có phân biệt không tìm thấy |
| Lưu trữ dữ liệu | 🔴 Chưa có | Refresh là mất sạch |
| Backend MES | 🔴 Chưa có | |
| Kiểm thử module factory | 🟢 **Có** | 148 test TypeScript + 37 test Python, tất cả đều xanh |

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

### 2026-09-03 — Đợt 4: Dọn nợ frontend (Ưu tiên 1 xong)

- **Tách 5 tab thành 5 route** (`/scada`, `/twin`, `/vision`, `/plc`, `/mes`)
  qua layout route không đường dẫn `_authenticated/_factory.tsx`. Deep-link
  được, nút Back của trình duyệt hoạt động, và `autoCodeSplitting` chia chunk
  thật: `/mes` 7 KB, `/vision` 11 KB, `/twin` 13 KB, `/plc` 17 KB, `/scada`
  377 KB (Recharts). Trước đó vào bất kỳ tab nào cũng tải cả 403 KB.
  `/` chuyển hướng sang `/scada`.
- Danh sách module nằm ở `features/factory/lib/modules.ts`, cả thanh tab lẫn
  sidebar cùng đọc từ đó — thêm module chỉ sửa một chỗ.
- **Tách logic nghiệp vụ ra hàm thuần** để kiểm thử được:
  - `lib/oee.ts` — `computeOee(machines)`, gỡ khỏi thân class simulator.
  - `lib/ladder.ts` — `solveLadder(inputs, prevConveyor)`, gỡ khỏi
    `PlcDiagnostics.tsx`. Đây là bản sao từng dòng của `infra/plc/conveyor.st`;
    tách ra rồi thì lời khẳng định "mô phỏng chạy đúng logic PLC thật" mới
    kiểm chứng được thay vì chỉ nói miệng.
- **50 test mới**: OEE đối chiếu ví dụ mẫu (A 88.8 / P 86.1 / Q 97.8 /
  OEE 74.8%) và chặn lỗi lấy trung bình ba hệ số; ladder kiểm tra tự giữ,
  restart interlock, đứt dây NC; simulator kiểm tra down time không bị tính
  nhầm sang run time và `telemetryHistory` không bị mutate tại chỗ.
- Sửa 2 test `search-provider` vốn đã hỏng từ trước: chúng còn tìm mục
  `Tasks` của template gốc — mục này đã bị gỡ khỏi sidebar từ lâu.
- `pnpm knip` sạch phần dependency: gỡ `@clerk/react`, `@faker-js/faker` và
  hai file logo Clerk.
- Ảnh trang sign-in: 2 PNG 891 KB → WebP 321 KB (**-64%**), mã hoá bằng chính
  Chromium của Playwright nên không phải thêm dependency ảnh nào.
- `vite.config.ts`: `__dirname` → `import.meta.dirname` (Vite 8 cảnh báo).

---

### 2026-09-03 — Đợt 5: Vision AOI thật bằng OpenCV (Ưu tiên 2 xong)

`infra/vision/` — service FastAPI + OpenCV, `POST /inspect` nhận ảnh trả JSON
đúng schema `PcbInspectionRecord` mà frontend đang đọc.

- **Thuật toán** (`inspector.py`), đúng trình tự máy AOI thật: `HoughCircles`
  tìm fiducial → `atan2` + tỷ số khoảng cách suy ra góc xoay và scale →
  `warpAffine` căn về khung ảnh mẫu → `matchTemplate` (TM_CCOEFF_NORMED) từng
  ô → `absdiff` tại vị trí khớp tốt nhất → `threshold` → `findContours` →
  `boundingRect` → quét phần bo mạch còn lại tìm vật lạ.
- **Phép so chạy trên ảnh màu, không phải ảnh xám.** Phát hiện khi thử: vật lạ
  đỏ (B30 G30 R190) trên sơn phủ xanh (B58 G92 R40) chuyển sang xám chỉ lệch 5
  mức — thuật toán không nhìn thấy gì. Đổi sang lấy chênh lệch lớn nhất trong
  ba kênh màu.
- **Cửa sổ tìm phải rộng hơn dung sai lệch.** Ban đầu để 10px trong khi dung
  sai 6px: một linh kiện lệch 14px rơi ra ngoài cửa sổ và bị báo nhầm là
  "thiếu linh kiện". Mặc định nâng lên 20px (~3× dung sai) — phân biệt này
  không phải chuyện chữ nghĩa: thiếu linh kiện thì đi kiểm tra băng tải cấp
  linh kiện, lệch chân thì đi chỉnh toạ độ pick & place.
- **Recipe** (`recipes/*.json`): mỗi model một chương trình kiểm tra với ngưỡng
  riêng cho từng ô. Đổi model là nạp recipe khác, không sửa mã nguồn.
- **Ảnh mẫu sinh bằng code** (`board.py`), không có ảnh nhị phân nào trong repo.
  Hình học lấy thẳng từ recipe nên ảnh mẫu và ô kiểm tra không thể lệch nhau,
  và test khẳng định được "phải báo lệch chân C45 offset (+14,+3)".
- **Frontend**: `visionService.ts` + tab `/vision` chạy chế độ LIVE khi có
  service, hiển thị đúng tấm ảnh vừa kiểm tra kèm bounding box thật, khung vật
  lạ, góc xoay và sai số căn ảnh. Không cấu hình `VITE_VISION_API_URL` thì
  không gửi request nào.
- Thanh trượt ngưỡng hạ mặc định từ 85% xuống 70% — nằm dưới ngưỡng thấp nhất
  trong recipe, để mặc định màn hình hiện đúng phán định của thuật toán; kéo
  lên là thấy ngay over-kill.
- **37 test Python** + 11 test TypeScript cho lớp service.
- **Đã kiểm chứng end-to-end** trong container: bo mạch xoay 3° vẫn PASS; thiếu
  R12, dính thiếc J8, lệch C45 14px, vật lạ — mỗi loại báo đúng ô và đúng tên
  lỗi; chu kỳ 20–100 ms.

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
- **Phép so ảnh AOI chạy trên ảnh màu.** Bỏ màu là tự bịt mất một nửa thông
  tin: trên bo mạch, màu mới là thứ phân biệt thiếc / sơn phủ / đồng / vật lạ.
- **`search_margin_px` phải lớn hơn `shift_tolerance_px` rõ rệt** (quy ước ~3
  lần), nếu không linh kiện lệch bị báo nhầm thành thiếu linh kiện.
- **Ảnh dùng cho AOI sinh bằng code, không đưa ảnh nhị phân vào repo.** Ảnh
  chụp thật thì không kiểm chứng và không tái tạo được.
- **`visionService.ts` đọc biến môi trường mỗi lần gọi, không chốt thành hằng
  số lúc import.** Trong browser mode của Vitest, `vi.resetModules()` không làm
  module chạy lại (registry là của trình duyệt), nên hằng số ở tầng module thì
  không cách nào test được nhánh "chưa cấu hình".

---

## 5. Việc tiếp theo (theo thứ tự ưu tiên)

### ~~Ưu tiên 1 — Dọn nốt phần frontend còn nợ~~ ✅ xong 2026-09-03
- [x] Tách 5 tab thành 5 route (`/scada`, `/twin`, `/vision`, `/plc`, `/mes`).
- [x] `pnpm knip` rồi gỡ `@clerk/react` và `@faker-js/faker`.
- [x] Nén 2 ảnh PNG trang sign-in (891KB) sang WebP (321KB).
- [x] Viết test cho `sensorSimulator` (OEE, tích luỹ downtime) và logic ladder.

### ~~Ưu tiên 2 — Vision AOI thật bằng OpenCV~~ ✅ xong 2026-09-03
Đã có `infra/vision/`. Còn nợ nếu muốn đi sâu tiếp:
- [ ] Nhiều recipe hơn, và giao diện tự tạo recipe từ một ảnh mẫu (dùng chuột
      khoanh ROI) thay vì sửa JSON tay.
- [ ] Đo lặp lại (gauge R&R) cho thuật toán: chụp cùng một bo mạch nhiều lần,
      xem điểm khớp dao động bao nhiêu — cơ sở thật để đặt ngưỡng.
- [ ] Gửi kết quả AOI lên MQTT để MES nhận, thay vì chỉ trả về cho trình duyệt.

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

- Chunk `/scada` vẫn 377KB, gần như toàn bộ là Recharts kéo theo d3. Nếu
  telemetry là trọng tâm, cân nhắc `uPlot` (~40KB). Bốn module còn lại đã
  xuống dưới 20KB mỗi cái sau khi tách route.
- `npm audit` báo 1 lỗ hổng high ở `nanoid` (dependency gián tiếp).
- Các component data-table của template gốc vẫn nằm trong repo và `knip` liệt
  kê là không dùng — giữ lại vì backend MES ở Ưu tiên 3 sẽ cần bảng dữ liệu.
- Toàn bộ stack `infra/` đang mở (MQTT ẩn danh, CORS `*`, mật khẩu OpenPLC mặc
  định, service vision nhận file tải lên không xác thực) — chỉ dùng cho máy
  local / mạng lab.
- Service AOI mới có đúng một recipe, và ảnh mẫu là ảnh tổng hợp. Cắm ảnh chụp
  thật vào thì phải đo lại toàn bộ ngưỡng — con số hiện tại đúng cho ảnh sinh
  bằng code, không phải cho dây chuyền thật.
- Dữ liệu SCADA vẫn mất khi refresh trang.
