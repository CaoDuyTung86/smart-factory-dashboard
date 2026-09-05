# Tiến độ & Kế hoạch — Smart Factory Dashboard

> **File này dùng để mang sang cuộc trò chuyện mới.** Nó chứa toàn bộ bối cảnh
> cần thiết: dự án là gì, đã làm tới đâu, vì sao chọn cách đó, và việc tiếp theo
> là gì. Đưa file này vào đầu chat mới là đủ để tiếp tục mà không phải kể lại.
>
> Cập nhật lần cuối: **2026-09-05** (đợt 8)

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
| Hạ tầng IIoT (`infra/`) | 🟢 **Chạy được** | OpenPLC + Mosquitto + gateway + vision + TimescaleDB + backend MES, đã kiểm chứng end-to-end |
| Vision AOI | 🟢 **Thật** | Service Python + OpenCV: căn ảnh theo fiducial rồi so ảnh mẫu; tự xuống thang sang mô phỏng |
| **Lưu trữ dữ liệu** | 🟢 **Thật** | TimescaleDB: hypertable + 2 continuous aggregate phân cấp, chính sách nén 7 ngày / xoá 30 ngày. F5 không còn mất dữ liệu |
| **Backend MES** | 🟢 **Thật** | FastAPI + asyncpg: work order, BOM, routing, genealogy hai chiều, truy vấn thu hồi theo lô |
| **SCADA Command Center** | 🟡 Số liệu mô phỏng, **chạy ở server** | Một vòng tick duy nhất → historian → WebSocket cho mọi trình duyệt. Bộ đếm sản lượng trạm SMT lấy từ PLC thật khi gateway sống |
| MES Traceability | 🟢 **Thật** | Đọc PostgreSQL; xuất CSV gồm cả lộ trình lẫn hệ phả vật tư |
| **Quản lý cảnh báo** | 🟢 **Thật** | ANSI/ISA-18.2: máy trạng thái 7 trạng thái, deadband + on/off-delay, shelving có hạn, nhật ký kiểm toán, chỉ số hiệu năng theo điều 16. Đã đối chiếu trên TimescaleDB thật (đợt 8) |
| Digital Twin | 🟡 Mô phỏng | Đã tối ưu hiệu năng bằng rAF |
| Kiểm thử | 🟢 **Có** | 211 test TypeScript + 120 test Python (MES) + 37 test Python (vision), tất cả đều xanh. Thêm một lần đối chiếu tay với DB thật ở đợt 8 |

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

### 2026-09-04 — Đợt 6: Historian & backend MES (Ưu tiên 3 xong)

Ba thứ mới: `infra/db/` (schema TimescaleDB), `infra/mes/` (backend FastAPI), và
việc gateway ghi tag PLC xuống historian.

**TimescaleDB — ba tầng dữ liệu, mỗi tầng một tuổi thọ.** `telemetry` là
hypertable chunk 1 ngày, mô hình dài (ts, asset_code, metric, value, quality)
chứ không phải một cột cho mỗi tag: thêm cảm biến là thêm dòng, không phải
`ALTER TABLE` trên bảng vài trăm triệu dòng. Trên nó là continuous aggregate 1
phút (giữ 1 năm) và cagg 1 giờ (giữ 5 năm), còn bảng gốc nén sau 7 ngày và xoá
sau 30 ngày bằng drop chunk. `choose_resolution()` ở backend chọn tầng theo độ
dài khoảng thời gian: ≤2 giờ đọc bảng gốc, ≤7 ngày đọc cagg 1 phút, dài hơn đọc
cagg 1 giờ. Biểu đồ 30 ngày vì vậy đọc 720 dòng thay vì ~1,7 triệu.

- **Cagg 1 giờ dựng từ cagg 1 phút, và phải cộng có trọng số.** `avg(avg_value)`
  chỉ đúng khi mọi bucket con có cùng số mẫu — mất kết nối PLC 40 giây là đủ để
  chúng khác nhau (13 mẫu thay vì 40). Cagg lưu `sum(avg × count)` và `sum(count)`,
  view bên trên mới chia. Đo trên máy: ba bucket 6/39/16 mẫu cho `avg(avg)` =
  52.287 còn có trọng số = 52.371.
- **Giữ cả min/max, không chỉ avg.** Trung bình 1 phút xoá đúng cái gai nhọn cần
  nhìn thấy; biểu đồ downsample mà bỏ dải min–max là nói dối về dữ liệu.
- **`telemetry.asset_code` cố ý không có khoá ngoại.** Historian nhận tag từ mọi
  thứ đo được (băng tải, máy nén khí, đồng hồ điện), không chỉ từ bốn máy có
  tính OEE. Bắt khai báo trước mới được ghi là cách chắc chắn để mất dữ liệu của
  một thiết bị vừa lắp thêm.

**Schema MES.** `product` → `bom_item` (theo `ref_des`, khớp với ô kiểm tra của
AOI) + `routing_step`; `work_order` → `unit` → `unit_step` (có cột `attempt` vì
rework là lần đi qua thứ hai, không phải ghi đè) / `unit_material` / `defect`.
Số đo của trạm nằm ở `measurements JSONB` — mỗi trạm đo một thứ khác nhau, ép
hết vào cột cứng thì bảng có 40 cột mà trạm nào cũng chỉ dùng 3.

**`unit_material` là bảng đáng giá nhất.** Nó trả lời được cả hai chiều: serial
→ lô, và lô → serial. Chiều ngược mới là chiều MES sinh ra để phục vụ. Dữ liệu
mẫu dựng sẵn tình huống lô tụ `LOT-CAP-2609-B` bị nhà cung cấp báo lỗi sau khi
giao hàng; truy vấn thu hồi trả về **20 bo mạch, trong đó 14 đã PASS toàn bộ
AOI**. Serial mặc định trên giao diện (`FOX-APPLE-M3-90821`) được chọn có chủ
đích: nó PASS mọi trạm và vẫn nằm trong diện thu hồi. "Đã PASS" không đồng
nghĩa "ngoài diện thu hồi" — đó là lý do genealogy phải tồn tại độc lập với kết
quả kiểm tra.

**Backend MES (`infra/mes/`).** Ba vòng chạy song song: `line_loop` đẩy mô hình
dây chuyền 1.5s/lần rồi phát WebSocket, `historian` gom điểm đo thành lô và
`COPY` xuống hypertable, `mqtt` nghe bộ đếm sản lượng của PLC thật trên Unified
Namespace.

- **Nguồn dữ liệu SCADA chuyển từ trình duyệt xuống server.** Trước đó mỗi tab
  tự sinh số riêng: hai người xem thấy hai dây chuyền khác nhau, và F5 là mất
  sạch. Giờ một vòng tick, ghi DB, phát cho mọi client — đúng quan hệ giữa SCADA
  server và HMI. Nhiệt độ/rung **vẫn là mô phỏng**; cái đã thành thật là đường
  đi của dữ liệu.
- **Bộ đếm sản lượng trạm SMT lấy từ PLC thật** khi gateway đang sống, và payload
  đánh dấu `countSource: "plc"` hay `"model"` để không nhầm số đo được với số
  suy ra. Tràn thanh ghi 16 bit (65535 → 0) và mất-rồi-nối-lại đều lấy lại mốc
  chứ không bơm con số đó vào sản lượng của một tick.
- **Vòng tick không bao giờ chờ DB.** Điểm đo vào hàng đợi có giới hạn, task
  riêng `COPY` theo lô. Hàng đợi tràn thì bỏ điểm **cũ nhất**, đếm lại và báo ra
  `/health` — hàng đợi không giới hạn chỉ đổi lỗi mất dữ liệu lấy lỗi hết RAM.
- **Bộ đếm ca sống sót qua khởi động lại** (`machine_shift_state`, ghi mỗi 20
  tick). OEE là tỉ số của những con số cộng dồn từ đầu ca; reset về 0 mỗi lần
  deploy lại thì con số vô nghĩa. Đã kiểm chứng: dừng container MES rồi bật lại,
  OEE tiếp tục từ 82.7% chứ không nhảy về 0.
- **Ngưỡng cảnh báo chuyển xuống bảng `asset`.** Trước đây là
  `m.id === 'm1' && temp > 75` nằm rải rác trong hàm tick. Lò reflow chạy 245°C
  là bình thường, máy gắn linh kiện 245°C là cháy — một ngưỡng dùng chung thì
  hoặc báo động giả suốt ngày, hoặc không bao giờ báo. Thêm độ trễ 3°C khi trả
  về bình thường để cảnh báo không nhấp nháy tại ngưỡng.
- **Chống chattering nằm ở DB**: index duy nhất từng phần trên
  `(asset_code, severity) WHERE NOT acknowledged AND cleared_at IS NULL`. Bảng
  `alarm_event` đã có sẵn `ack_at` / `cleared_at` cho state machine ISA-18.2 ở
  Ưu tiên 4.
- **Công thức OEE port sang Python và ghim vào cùng một ví dụ mẫu** với bản
  TypeScript (A 88.8 / P 86.1 / Q 97.8 / OEE 74.8%). Có hàm `round1()` riêng vì
  `round()` của Python làm tròn về số chẵn còn `toFixed(1)` của JavaScript làm
  tròn ra xa số 0 — không có nó thì hai bản lệch nhau ở chữ số cuối và lời khẳng
  định "hai bản giống hệt" thành nói suông.

**Gateway ghi historian.** Tag PLC (`conveyor`, `red_tower`, `green_tower`,
`part_count`, `estop`) dưới mã `CONVEYOR-01`, theo kiểu **báo cáo khi thay đổi**
chứ không mỗi vòng poll — băng tải đứng yên 10 phút không sinh ra 3.000 dòng
giống hệt nhau. Cộng nhịp nền 30 giây để phân biệt "không đổi" với "mất kết
nối", và ghi một mốc `quality = 24` (BAD, theo tinh thần OPC StatusCode) tại
thời điểm mất PLC: không có nó thì biểu đồ nối thẳng qua khoảng mất kết nối và
trông như máy vẫn chạy bình thường.

**Frontend.**

- `mesLink.ts` là external store thứ hai, cùng hợp đồng `subscribe`/`getSnapshot`
  với `sensorSimulator` — đây là phần thưởng cho việc đợt 1 đã biến simulator
  thành external store: đổi nguồn dữ liệu là **thêm một file**, không phải sửa
  lại từng component. `factorySource.ts` là chỗ duy nhất biết có hai nguồn.
- **Mất kết nối thì KHÔNG âm thầm quay về dữ liệu mô phỏng.** Màn hình giữ số
  cuối cùng và phù hiệu đổi thành `MES MẤT KẾT NỐI`. Thay số liệu thật đang chết
  bằng số sinh tại chỗ là kiểu lỗi tệ nhất một hệ SCADA mắc phải.
- Phù hiệu `IoT Stream Online` bật cứng ở header bị thay bằng phù hiệu nói thật
  nguồn dữ liệu (`Nguồn: Mô Phỏng` / `MES LIVE · Historian` / `MES MẤT KẾT NỐI`).
- Biểu đồ telemetry **dựng lại 30 phút lịch sử từ TimescaleDB** khi mở trang.
  Đây là khác biệt cụ thể nhất so với bản cũ: F5 không còn xoá sạch biểu đồ.
- Tab MES tra cứu serial thật, hiện số đo từng trạm, hệ phả vật tư, cảnh báo thu
  hồi, và bảng phạm vi ảnh hưởng khi bấm vào mã lô. CSV xuất ra gồm cả lộ trình
  lẫn hệ phả, phân biệt bằng cột `record_type`.
- **Id của máy đổi từ `m1`..`m4` sang mã tài sản** (`SMT-LINE-01`,
  `REFLOW-OVEN-02`, `CNC-MILL-03`, `AOI-INSPECT-04`). Khoá `m1` chỉ tồn tại
  trong frontend; mã tài sản là danh tính thật, dùng xuyên suốt telemetry,
  routing và `unit_step` — nhờ vậy không cần một bảng ánh xạ phải giữ đồng bộ.
- **Cờ còi cảnh báo ra khỏi `FactoryState`.** Còi bật hay tắt là thiết lập của
  trạm vận hành đang ngồi, không phải trạng thái của dây chuyền; từ khi gói tin
  do backend phát cho mọi trình duyệt thì để nó trong đó là sai hẳn về mô hình.
  Chuyển sang `alarmChime.ts` với external store riêng.

**Một lỗi đã mắc và đã sửa:** cảnh báo do HMI tạo ra (bấm E-Stop) không được ghi
xuống `alarm_event`. `line_loop` so danh sách cảnh báo trước/sau mỗi tick, mà
lệnh HMI xử lý ngoài vòng tick nên đến tick sau id đó đã "cũ". Sửa bằng cách đối
chiếu với một tập id đã ghi (`rt.persisted_alarms`) thay vì với ảnh chụp của
vòng tick.

**Đã kiểm chứng end-to-end** với cả stack đang chạy: F5 thì biểu đồ dựng lại đầy
đủ lịch sử; bấm E-Stop trên web thì backend đổi trạng thái máy và ghi
`alarm_event`; dừng container MES thì phù hiệu đỏ và số đứng lại (không tụt về
số mô phỏng); bật lại thì tự nối lại và OEE tiếp tục từ chỗ cũ; tra cứu
`FOX-APPLE-M3-90821` ra đúng 5 trạm, 10 dòng vật tư và cảnh báo thu hồi;
bấm vào `LOT-CAP-2609-B` ra 20 bo mạch / 14 PASS / 6 FAIL.

---

### 2026-09-04 — Đợt 7: Quản lý cảnh báo theo ISA-18.2 (Ưu tiên 4, hạng mục 1)

Trước đợt này, cảnh báo chỉ là một cờ boolean `acknowledged` cộng một index duy
nhất trong DB để chống trùng. Đó là một bảng log, không phải một hệ cảnh báo.

**Máy trạng thái bảy trạng thái** (`infra/mes/alarms.py`, thuần, không I/O):
NORMAL → UNACK_ALM → ACKED_ALM → NORMAL, cộng ba đường rẽ mà bản cũ không có.

- **`RTN_UNACK` là trạng thái đáng giá nhất.** Sự cố tự hết trước khi ai kịp
  nhìn thì vẫn phải có người xác nhận. Bỏ nó đi là để loại sự cố thoáng qua —
  đúng loại hay lặp lại nhất — biến mất không dấu vết.
- **Ba trạng thái im lặng tách riêng**, không gộp: SHELVED (người vận hành, tạm
  thời, có hạn giờ, tự bật lại), SUPPRESSED_BY_DESIGN (logic thiết kế),
  OUT_OF_SERVICE (bảo trì). Gộp lại là mất khả năng trả lời "ai đã tắt cái này,
  theo thẩm quyền nào".
- Cả ba đều đi trong **cùng gói tin WebSocket** với danh sách chính. Tắt một
  cảnh báo mà không có chỗ nào nhìn lại được thì đúng là đã xoá nó.

**Chống chattering bằng hai cơ chế chữa hai bệnh khác nhau.** Deadband chữa
"dao động quanh đúng setpoint"; on/off-delay chữa "nhảy vọt rồi về ngay". Một
xung rung 0.2 giây vọt gấp đôi ngưỡng thì deadband bao nhiêu cũng không chặn
nổi. Deadband **chỉ nới rộng phía tắt** — bật tại `setpoint + deadband` là làm
chậm đúng cái ngưỡng kỹ sư vừa chọn. Bộ đếm on-delay tính lại từ đầu mỗi lần
điều kiện đổi chiều.

**Cảnh báo an toàn không được có on-delay**, chặn ở cả hai tầng:
`AlarmDefinition.__post_init__` ném lỗi khi dựng, và bảng có
`CONSTRAINT alarm_safety_khong_duoc_tre`. Lặp lại là cố ý — bảng là chỗ kỹ sư
quy trình sửa bằng SQL, không phải chỉ qua mã nguồn.

**Ba bảng, ba tuổi thọ** (`infra/db/init/05-alarms.sql`, thay hẳn `alarm_event`):

| Bảng               | Trả lời                                     | Sống cùng           |
| ------------------ | ------------------------------------------- | ------------------- |
| `alarm_definition` | Vì sao tồn tại, người vận hành làm gì?      | hồ sơ thiết bị      |
| `alarm_transition` | Đi qua trạng thái nào, lúc nào, do ai?      | hồ sơ kiểm toán     |
| `alarm_state`      | Bây giờ ở đâu, sống sót qua restart chưa?   | phiên chạy hiện tại |

- `alarm_transition.tag` **cố ý không có khoá ngoại**: hồ sơ kiểm toán phải sống
  sót khi một cảnh báo bị gỡ khỏi cấu hình.
- `priority` / `alarm_class` / `message` được **chép** vào từng dòng nhật ký chứ
  không join sang cấu hình. Hạ một cảnh báo từ HIGH xuống LOW mà join thì mọi
  biểu đồ xu hướng tự viết lại quá khứ.
- Bảng thường, **không có chính sách xoá**: telemetry thô là dãy số lặp lại,
  nhật ký cảnh báo là hồ sơ vận hành.
- Đổi tên hai cột trước khi commit: `at` → `occurred_at`, `condition` →
  `raw_condition`. Cả hai là từ khoá trong SQL chuẩn / PL/pgSQL; PostgreSQL vẫn
  cho dùng, nhưng một cái tên phải tra keyword-list mới biết có hợp lệ hay không
  là một cái tên tồi.

**Rationalization là các CỘT, không phải chú thích.** `consequence`,
`operator_response`, `response_time_sec` nằm trong `alarm_definition`; mức ưu
tiên được suy ra từ chúng. Chính quy tắc "không điền nổi `operator_response` thì
đây không phải cảnh báo" đã **loại bỏ cảnh báo `Line Speed Overclocked`**:
người vận hành vừa tự tay kéo thanh trượt lên 2.5x, báo lại cho họ điều họ vừa
làm là một sự kiện, không phải cảnh báo. Thay vào đó đẩy dây nhanh làm máy nóng
lên (theo **dư địa nhiệt của chính máy**, `SPEED_HEAT_GAIN`) và ăn thêm điện —
hậu quả đo được, và chính nó kích cảnh báo. `power_usage` trước đây đọc từ DB
rồi không bao giờ đổi, tức là một số đo chết; giờ nó bám theo tải.

**Cảnh báo không phải interlock.** Trạng thái máy do điều kiện quá trình quyết
định; `AlarmEngine` chỉ quan sát. Nếu để trạng thái máy bám theo trạng thái cảnh
báo thì off-delay 30 giây (đặt để chống nhấp nháy) biến thành 30 giây máy không
chịu chạy lại sau khi đã sửa xong. Hệ quả: **`repair()` không xác nhận hộ cảnh
báo** — sửa máy là hành động vật lý, xác nhận là hành động của người vận hành.
Và nút `reset` không còn `alarms.clear()`: nó đưa điều kiện về bình thường rồi
xác nhận, tức là mọi bước đều đi qua máy trạng thái và để lại dấu trong nhật ký.

**Chỉ số hiệu năng** (`infra/mes/alarm_metrics.py`, ISA-18.2 điều 16 / EEMUA
191): tỉ lệ trung bình và đỉnh trên mỗi 10 phút, % khoảng bị alarm flood,
top-10 bad actor, chattering, stale, phân bố ưu tiên, thời gian tới lúc xác
nhận, và số lần shelve không ghi lý do (unauthorized suppression).

- **Mẫu số là toàn bộ cửa sổ**, kể cả những khoảng 10 phút không có cảnh báo
  nào. Bỏ khoảng rỗng đi là cách dễ nhất để một hệ thống đang ngồi trên một trận
  cảnh báo vẫn báo cáo đẹp.
- **Chattering dùng cửa sổ TRƯỢT 60 giây** (`RANGE BETWEEN INTERVAL '60 seconds'
  PRECEDING`), không cắt khúc theo phút: ba lần kêu lúc 10:00:59 / 10:01:00 /
  10:01:01 là chattering thật, cắt khúc theo phút sẽ thấy "1 rồi 2" và không báo.
- Bảng KPI nói thật kể cả khi chính hệ thống này trượt chỉ tiêu.

**Frontend.**

- `src/features/factory/lib/isa18.ts` — bản cài đặt **thứ hai** của cùng máy
  trạng thái, dùng khi chưa cấu hình `VITE_MES_API_URL`. `isa18.test.ts` là bản
  dịch từng ca của `test_alarms.py`. Cùng kỷ luật với `oee.ts` ↔ `oee.py` và
  `ladder.ts` ↔ `conveyor.st`: nếu bản trong trình duyệt chạy cơ chế khác thì màn
  hình lúc demo không phải màn hình hệ thống thật tạo ra.
- Route thứ sáu `/alarms` — `AlarmCenter`: alarm summary, danh sách bị tắt tiếng,
  nhật ký chuyển trạng thái, bảng chỉ số hiệu năng, và Master Alarm Database.
  Bảng cấu hình đọc từ `/api/alarms/definitions` khi có backend, từ engine trong
  trình duyệt khi chạy ngoại tuyến — không vẽ bản suy ra trong khi hệ thống đang
  chạy theo cấu hình của DB.
- Xác nhận theo **`tag`** chứ không theo một id ngẫu nhiên mỗi lần kêu — cùng lý
  do mã tài sản đã thay khoá `m1`.
- `sensorSimulator` export cả lớp (như `MesLink`): từ khi cảnh báo có máy trạng
  thái, một cảnh báo ACKED_ALM đang trong off-delay sẽ sống qua ranh giới giữa
  hai test.
- Tiếng bíp khoá theo `tag@raisedAt` chứ không theo id: cùng một cảnh báo kêu
  lại sau khi đã trở về bình thường là một sự cố MỚI và phải bíp lần nữa.

**Kiểm thử**: 116 test Python (thêm `test_alarms.py` 41 ca + `test_alarm_metrics.py`
17 ca) và 211 test TypeScript (thêm `isa18.test.ts` 37 ca). Máy trạng thái đi
qua thời gian bằng tham số `now` chứ không bằng `sleep`, nên on-delay 10 giây
được kiểm tra trong 0 giây.

**Đã kiểm chứng**: chạy dashboard ở chế độ mô phỏng và đi hết vòng đời trên
trình duyệt — E-Stop kêu ngay (URGENT, không on-delay); quá nhiệt chờ hết
on-delay mới kêu (HIGH, `90 °C / SP 88`); bấm "Sửa Máy" thì máy chạy lại nhưng
cảnh báo chuyển sang RTN_UNACK và **vẫn nằm trên màn hình**; shelve thì nó rời
màn hình chính sang danh sách "Đang bị tắt tiếng" kèm lý do và mốc tự bật lại;
trong lúc đó `TEMP.HI` (ngưỡng thấp hơn) kêu lên đúng như thiết kế phân tầng
HI/HIHI.

**Phần chưa kiểm chứng của đợt này (schema SQL và các truy vấn KPI mới chỉ
mới kiểm được cú pháp bằng `pglast`) đã được chạy trên TimescaleDB thật ở đợt 8
— xem bên dưới.**

---

### 2026-09-05 — Đợt 8: Đối chiếu hệ cảnh báo với TimescaleDB thật

Đợt 7 dừng lại ở chỗ `pglast` chỉ chứng minh được **cú pháp**. Đợt này chạy
thật, và chạy theo cách không đụng vào volume `factory` đang có dữ liệu: dựng
một database trắng `verify_alarms` trong chính container TimescaleDB rồi chạy
đủ 5 file `db/init/` theo đúng thứ tự entrypoint. Cách này kiểm được thêm một
thứ mà `down -v` không kiểm: rằng **các script init chạy sạch từ số 0**, đúng
đường mà một máy mới sẽ đi.

- 5 file init: chạy sạch, không một cảnh báo. `alarm_definition` sinh ra đúng
  20 dòng (4 tài sản × 5 định nghĩa) từ chính bảng `asset`.
- Ràng buộc `alarm_safety_khong_duoc_tre` đứng vững: cả 4 cảnh báo SAFETY đều
  có `on_delay_sec = 0` sau khi sinh.

**Số 0 không chứng minh được gì.** `/api/alarms/performance` lần chạy đầu trả
HTTP 200 với toàn số 0 — chỉ đủ nói rằng SQL parse và plan được, chưa nói gì về
phần đọc cột hay logic cửa sổ. Nên bơm một nhật ký giả dựng riêng để ép chạy
hết các nhánh, mỗi dòng nhắm một khẳng định của đợt 7:

| Tình huống dựng                              | Điều cần chứng minh                             | Kết quả |
| -------------------------------------------- | ----------------------------------------------- | ------- |
| 3 lần kêu lúc `:59` / `:60` / `:61`           | cửa sổ TRƯỢT 60s bắt được, cắt khúc theo phút thì không | `maxPerMinute: 3` ✅ |
| Cùng một tag kêu 2 lần, ACK sau 45s và sau 5s | view `alarm_occurrence` gán ACK đúng lần kêu    | median 25.0 / p90 41.0 ✅ |
| Shelve ghi `'   '` (toàn khoảng trắng)        | `btrim(note) = ''` tính là không ghi lý do      | `shelvesWithoutReason: 1` ✅ |
| Tag `LEGACY-WAVE-09` không có trong cấu hình  | nhật ký kiểm toán sống sót khi cảnh báo bị gỡ   | vẫn vào KPI ✅ |
| `raised_at` cách đây 30 giờ                   | truy vấn stale + `numeric → float`              | `hours: 30.0` ✅ |

Con số ack đáng nói riêng: hai lần ACK là 45 giây và 5 giây, ra median 25.0 và
p90 41.0 — tức là view đã gán 5 giây cho **lần kêu thứ hai** chứ không gộp vào
lần đầu. Đó chính là cái bẫy `lead()` trong view được viết ra để tránh, và giờ
có bằng chứng chứ không còn là lập luận.

**Đường ghi thì phải lái mới biết.** Đọc bao nhiêu endpoint cũng không chứng
minh được engine ghi xuống DB. Nên lái một vòng đời thật qua WebSocket:
E-Stop (SAFETY, on-delay 0) → kêu ngay ở tick kế tiếp; quá nhiệt (on-delay 2s)
→ chờ hết trễ mới kêu, và kêu phân tầng đúng HIHI trước rồi HI sau; ACK; shelve
không ghi lý do; repair. Sáu dòng `alarm_transition` hiện ra đúng thứ tự, đúng
`operator`, đúng `from_state -> to_state`.

Rồi `docker restart`: cảnh báo SHELVED quay lại **kèm nguyên hạn tự bật lại**,
cảnh báo UNACK quay lại **kèm nguyên `raisedAt` cũ**. Đó là toàn bộ lý do tồn
tại của bảng `alarm_state`, và tới đợt này nó mới thực sự được chứng minh.

**Một lỗi thật tìm được, và nó nằm ở chỗ không ai kiểm.** Thử đúng tình huống
của một người đã chạy stack từ trước đợt 7: volume cũ không có ba bảng cảnh
báo, vì `db/init/` chỉ chạy khi volume còn rỗng. Backend chết bằng traceback
asyncpg 25 dòng kết thúc bằng `UndefinedTableError: relation "alarm_definition"
does not exist` — đúng về kỹ thuật, vô dụng với người đọc.

Code đã có sẵn một guard đẹp cho trường hợp **bảng rỗng**
(`"Bang alarm_definition rong — schema chua duoc nap"`) nhưng không có cho
trường hợp **bảng không tồn tại** — mà đổi schema thì hầu như luôn rơi vào vế
sau chứ không phải vế trước. Thêm `repository.missing_tables()` và một lần kiểm
ở đầu `startup()`, trước khi chạm vào bất kỳ bảng nào:

```
RuntimeError: Thieu bang trong DB: alarm_definition, alarm_transition,
alarm_state. Script db/init/ chi chay khi volume con rong, nen volume cu phai
xoa: docker compose -f infra/docker-compose.yml down -v && up -d
```

`REQUIRED_TABLES` là hợp đồng giữa `db/init/` và mã nguồn: thêm một bảng bắt
buộc thì thêm vào đó một dòng.

**Không phải lỗi, đã kiểm rồi loại:**

- `alarm_state` có lúc trống trơn trong khi engine đang giữ một cảnh báo
  SHELVED — hoá ra chỉ là tra trước nhịp lưu kế tiếp (`STATE_SAVE_EVERY = 20`
  tick × 1.5s = 30 giây). Tra lại sau đó thì DB khớp engine từng dòng.
- `message` hiện ra `SMT � do rung` — kiểm bytes thì là `â`, tức
  em-dash UTF-8 đúng chuẩn; chỉ là console Windows không vẽ được.

**Kiểm thử**: 211 test TypeScript + 120 test Python (thêm `test_repository.py`
4 ca cho guard mới), tất cả xanh.

**Còn nợ**: `topTenPct` cộng từ các phần trăm đã làm tròn nên ra 99.99 thay vì
100 khi chỉ có vài tag. Vô hại với ngưỡng 5% đang dùng, nhưng là một con số hơi
lệch nếu sau này ai đó so bằng dấu bằng.

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
- **Trung bình của trung bình là sai khi các bucket con khác số mẫu.** Cagg 1
  giờ lưu tổng có trọng số (`sum(avg × count)`), view bên trên mới chia. Dùng
  `avg(avg_value)` là bug thầm lặng: mất kết nối vài chục giây làm bucket phút
  đó ít mẫu hơn nhưng vẫn được tính ngang một phút đầy đủ.
- **Dữ liệu thô sống ngắn, dữ liệu tổng hợp sống lâu.** Đây là thứ phân biệt
  historian với một bảng log. Retention của bảng gốc KHÔNG kéo theo cagg — đó
  chính là lý do tách ba tầng.
- **Vòng tick không bao giờ `await` DB.** Điểm đo vào hàng đợi có giới hạn, một
  task riêng ghi theo lô. Ghi đồng bộ trong tick là cách chắc chắn nhất để biến
  một trục trặc của DB thành một trục trặc của SCADA.
- **Hàng đợi tràn thì bỏ điểm cũ nhất, đếm lại, và báo ra `/health`.** Hàng đợi
  không giới hạn chỉ đổi lỗi mất dữ liệu lấy lỗi hết RAM; giấu mất nó còn tệ hơn.
- **Đã cấu hình MES mà mất kết nối thì màn hình đứng lại và báo, KHÔNG tụt về
  dữ liệu mô phỏng.** Thay số liệu thật đang chết bằng số sinh tại chỗ là kiểu
  lỗi tệ nhất một hệ SCADA mắc phải.
- **Id của máy là mã tài sản, không phải khoá riêng của frontend.** `m1` chỉ tồn
  tại trong giao diện; `SMT-LINE-01` dùng chung từ telemetry qua routing tới
  `unit_step`, nên không cần bảng ánh xạ phải giữ đồng bộ.
- **Ngưỡng cảnh báo là dữ liệu của thiết bị, nằm ở bảng `asset`.** Đổi một ngưỡng
  là việc của kỹ sư quy trình, không nên phải build lại frontend.
- **Bộ đếm ca phải sống sót qua khởi động lại backend.** OEE là tỉ số của những
  con số cộng dồn từ đầu ca; reset về 0 mỗi lần deploy lại thì con số vô nghĩa.
- **Cờ còi cảnh báo không thuộc `FactoryState`.** Đó là thiết lập của trạm vận
  hành, không phải trạng thái dây chuyền — hai trạm nhìn cùng một dây chuyền vẫn
  được phép đặt còi khác nhau.
- **`round1()` trong `infra/mes/oee.py` là cố ý.** `round()` của Python làm tròn
  về số chẵn, `toFixed(1)` của JavaScript làm tròn ra xa số 0; không có nó thì
  hai bản cài đặt OEE lệch nhau ở chữ số cuối.
- **`visionService.ts` đọc biến môi trường mỗi lần gọi, không chốt thành hằng
  số lúc import.** Trong browser mode của Vitest, `vi.resetModules()` không làm
  module chạy lại (registry là của trình duyệt), nên hằng số ở tầng module thì
  không cách nào test được nhánh "chưa cấu hình".

- **Cảnh báo không phải interlock.** Trạng thái máy do điều kiện quá trình quyết
  định, `AlarmEngine` chỉ quan sát. Để trạng thái máy bám theo trạng thái cảnh
  báo thì một off-delay đặt để chống nhấp nháy sẽ biến thành thời gian máy không
  chịu chạy lại sau khi đã sửa xong.
- **`repair()` không xác nhận hộ cảnh báo, và `reset` không xoá trắng.** Sửa máy
  là hành động vật lý; xác nhận là hành động của người vận hành. Gộp lại thì
  RTN_UNACK không còn lý do tồn tại, và nút reset trở thành nút làm biến mất mọi
  bằng chứng.
- **Deadband chỉ nới rộng phía TẮT.** Bật tại `setpoint + deadband` là làm chậm
  đúng cái ngưỡng kỹ sư vừa chọn: người ta chọn 75 độ vì 75 là ngưỡng, không
  phải 78.
- **Deadband và độ trễ chữa hai bệnh khác nhau**, không thay thế nhau. Deadband
  chữa dao động quanh setpoint; on/off-delay chữa xung nhọn.
- **Cảnh báo `SAFETY` không được có on-delay**, chặn ở cả kiểu dữ liệu Python
  lẫn `CONSTRAINT` của bảng. Lặp lại là cố ý: bảng là chỗ sửa bằng SQL.
- **Ba trạng thái im lặng (shelve / suppress / out-of-service) không gộp làm
  một**, và cả ba phải hiện ở một danh sách nhìn thấy được. Tắt một cảnh báo mà
  không có chỗ nào nhìn lại được thì đúng là đã xoá nó.
- **Shelve bắt buộc có hạn và tự hết hạn**, hạn bị kẹp bởi `max_shelve_sec` của
  chính cảnh báo (cảnh báo an toàn tối đa 5 phút). Bật lại mà điều kiện còn xấu
  thì nó kêu LẠI và lại là chưa xác nhận.
- **Nhật ký cảnh báo chép `priority`/`message` vào từng dòng, không join.** Hạ
  một cảnh báo từ HIGH xuống LOW mà join thì mọi biểu đồ xu hướng tự viết lại
  quá khứ.
- **`alarm_transition.tag` cố ý không có khoá ngoại.** Hồ sơ kiểm toán phải sống
  sót khi một cảnh báo bị gỡ khỏi cấu hình.
- **Nhật ký cảnh báo không có chính sách xoá.** Telemetry thô là dãy số lặp lại
  nên sống 30 ngày; nhật ký cảnh báo là hồ sơ vận hành.
- **Mẫu số của tỉ lệ cảnh báo là toàn bộ cửa sổ**, kể cả khoảng không có cảnh
  báo nào. Bỏ khoảng rỗng là cách dễ nhất để báo cáo đẹp trong khi đang ngồi
  trên một trận cảnh báo.
- **Chattering đếm bằng cửa sổ trượt 60 giây**, không cắt khúc theo phút.
- **Cảnh báo nào không điền nổi "người vận hành phải làm gì" thì không phải cảnh
  báo.** Đó là lý do `Line Speed Overclocked` bị loại: nó báo lại cho người vận
  hành điều họ vừa tự tay làm.
- **Xác nhận theo `tag`, không theo id ngẫu nhiên mỗi lần kêu.** `tag` là danh
  tính bền trong Master Alarm Database, dùng chung từ cấu hình qua nhật ký tới
  màn hình — cùng lý do mã tài sản đã thay khoá `m1`.
- **Trạng thái cảnh báo phải sống sót qua khởi động lại backend.** Một cảnh báo
  chưa ai xác nhận mà biến mất sau lần deploy kế tiếp là một cảnh báo bị nuốt;
  nghiêm trọng hơn là hạn shelve, vì mất nó thì cảnh báo đang tắt có chủ đích sẽ
  kêu lại giữa ca mà không ai hiểu vì sao.
- **Không đặt tên cột trùng từ khoá SQL** (`at`, `condition` → `occurred_at`,
  `raw_condition`). PostgreSQL vẫn cho dùng, nhưng một cái tên phải tra
  keyword-list mới biết có hợp lệ hay không là một cái tên tồi.
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

### ~~Ưu tiên 3 — Lưu trữ & backend MES~~ ✅ xong 2026-09-04
- [x] TimescaleDB lưu telemetry, dùng continuous aggregate để downsampling.
- [x] Gateway ghi telemetry vào DB thay vì chỉ phát đi.
- [x] Backend FastAPI: work order, BOM, routing, genealogy hai chiều.
- [x] SCADA tab đọc WebSocket của backend thay vì simulator trong trình duyệt.

Còn nợ nếu muốn đi sâu tiếp:
- [ ] Trang danh sách work order + Pareto lỗi trên giao diện (API `/api/work-orders`
      và `/api/defects/pareto` đã có, chưa có màn hình nào đọc).
- [ ] Truy vấn thu hồi hiện chỉ đi một mức. Bo mạch lắp vào cụm, cụm lắp vào máy
      — genealogy nhiều tầng cần bảng cha–con giữa các unit.
- [ ] Đẩy kết quả AOI thật (`infra/vision`) vào `unit_step` + `defect` thay vì
      chỉ trả về cho trình duyệt. Bảng đã sẵn sàng, còn thiếu đường nối.
- [ ] Ghi nhận `unit` theo thời gian thực từ bộ đếm PLC, thay vì chỉ có dữ liệu
      mẫu dựng sẵn.

### Ưu tiên 4 — Phần "kỹ sư", chọn 1–2 cái làm sâu

- [x] **Alarm theo ISA-18.2** — xong 2026-09-04 (đợt 7). Còn nợ nếu muốn đi sâu:
      - [x] **Chạy thử trên TimescaleDB thật** — xong 2026-09-05 (đợt 8).
            5 file init chạy sạch trên DB trắng; cả 7 truy vấn KPI, view
            `alarm_occurrence` và đường ghi/khôi phục trạng thái đã đối chiếu
            với dữ liệu thật.
      - [ ] Alarm flood suppression: khi trên 10 cảnh báo ập đến trong 10 phút,
            gom theo nguyên nhân gốc thay vì đổ hết lên màn hình.
      - [ ] First-out / cause-and-effect: cảnh báo nào kêu TRƯỚC trong một chuỗi
            đổ dây chuyền — đó là câu hỏi thật sự khi truy nguyên nhân.
      - [ ] Cảnh báo từ AOI và từ PLC vào chung một máy trạng thái (hiện chỉ có
            4 máy trong bảng `asset`).
      - [ ] Đẩy cảnh báo lên MQTT theo Unified Namespace để Node-RED / Grafana
            đọc cùng một nguồn.
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

# Kèm toàn bộ hạ tầng (PLC + AOI + historian + MES)
docker compose -f infra/docker-compose.yml up -d --build
bash infra/load-program.sh
cat > .env.local <<'EOF'
VITE_PLC_GATEWAY_URL=http://localhost:8000
VITE_VISION_API_URL=http://localhost:8001
VITE_MES_API_URL=http://localhost:8002
EOF
pnpm dev
```

Kiểm chứng nhanh hạ tầng:

```bash
curl http://127.0.0.1:8000/health
curl -X POST http://127.0.0.1:8000/command -H 'Content-Type: application/json' -d '{"name":"start"}'
curl http://127.0.0.1:8000/state

curl http://127.0.0.1:8002/health
curl "http://127.0.0.1:8002/api/units/FOX-APPLE-M3-90821"
curl "http://127.0.0.1:8002/api/lots/LOT-CAP-2609-B/impact"
```

Chạy test:

```bash
pnpm test                                    # 211 test TypeScript
cd infra/mes  && pytest                      # 120 test backend MES
cd infra/vision && pytest                    # 37 test AOI
```

---

## 7. Vấn đề đã biết

- Chunk `/scada` vẫn ~377KB, gần như toàn bộ là Recharts kéo theo d3. Nếu
  telemetry là trọng tâm, cân nhắc `uPlot` (~40KB). Bốn module còn lại đã
  xuống dưới 20KB mỗi cái sau khi tách route.
- `npm audit` báo 1 lỗ hổng high ở `nanoid` (dependency gián tiếp).
- Các component data-table của template gốc vẫn nằm trong repo và `knip` liệt
  kê là không dùng — giữ lại vì màn hình danh sách work order sẽ cần bảng dữ liệu.
- Toàn bộ stack `infra/` đang mở, và giờ mở hơn trước: MQTT ẩn danh, CORS `*`,
  mật khẩu OpenPLC mặc định, Postgres `factory`/`factory` publish cổng 5432 ra
  host, service vision nhận file không xác thực, và **backend MES nhận lệnh
  WebSocket không xác thực** — ai mở được cổng 8002 đều bấm được E-Stop. Chỉ
  dùng cho máy local / mạng lab.
- Service AOI mới có đúng một recipe, và ảnh mẫu là ảnh tổng hợp. Cắm ảnh chụp
  thật vào thì phải đo lại toàn bộ ngưỡng.
- **Số liệu nhiệt độ / độ rung vẫn là mô phỏng**, chỉ khác là mô phỏng chạy ở
  server. Đã thành thật là đường đi của dữ liệu và bộ đếm sản lượng trạm SMT
  (`countSource: "plc"`). Đừng để README hay giao diện nói khác đi.
- Backend MES chạy **một worker duy nhất** vì mô hình dây chuyền và danh sách
  WebSocket là trạng thái trong bộ nhớ. Muốn scale ngang thì phải đưa trạng thái
  ra ngoài (Redis) hoặc tách vòng tick thành một tiến trình riêng.
- Tốc độ dây chuyền và mật độ cấp liệu (`lineSpeed`, `feedDensity`) chỉ nằm
  trong RAM của backend, chưa ghi xuống DB — khởi động lại là về mặc định. Bộ
  đếm ca thì đã lưu.
- Dữ liệu MES là dữ liệu mẫu dựng sẵn lúc khởi tạo DB (60 bo mạch của một work
  order). Vòng tick chưa sinh `unit` mới, nên tra cứu serial ngoài dải
  `FOX-APPLE-M3-90801..90860` sẽ trả về "không tìm thấy".
- Cagg được policy làm mới theo lịch (1 phút / 30 phút), nên ngay sau khi khởi
  tạo DB thì truy vấn khoảng dài trả về rỗng cho tới lần refresh đầu tiên. Gọi
  `refresh_continuous_aggregate` để thấy ngay.
