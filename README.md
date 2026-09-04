# 🏭 Smart Factory Dashboard — Web SCADA / MES cho dây chuyền SMT

> Dashboard giám sát sản xuất thời gian thực, mô phỏng một dây chuyền lắp ráp
> bo mạch SMT — kèm hạ tầng IIoT chạy được thật: PLC mềm OpenPLC, Modbus TCP,
> MQTT Unified Namespace.

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)
![Vite](https://img.shields.io/badge/Vite-8.x-646CFF?logo=vite)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-4.x-38B2AC?logo=tailwindcss)
![License](https://img.shields.io/badge/License-MIT-blue.svg)

---

## Dự án này là gì (và chưa là gì)

Đây là **bài tập mô phỏng**, xuất phát từ thời gian thực tập kỹ thuật tự động
hoá tại nhà máy sản xuất linh kiện điện tử, viết lại bằng góc nhìn kỹ thuật
phần mềm. Nói rõ ngay để không ai kỳ vọng nhầm:

| Thành phần                          | Trạng thái                                                                                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/plc` — **PLC S7-1200 & Ladder**   | **Thật** — chương trình IEC 61131-3 chạy trên OpenPLC, đọc/ghi qua Modbus TCP, khi có hạ tầng ở [`infra/`](infra/). Không có hạ tầng thì tự chuyển sang mô phỏng cùng logic. |
| `/vision` — **Vision AOI**          | **Thật** — service Python + OpenCV: căn ảnh theo fiducial rồi so ảnh mẫu (template matching + absdiff). Không có service thì quay về dữ liệu mô phỏng.                       |
| `/mes` — **MES Traceability**       | **Thật** — work order, BOM, routing và genealogy trong PostgreSQL; truy vấn thu hồi theo lô vật tư. Không có backend thì hiện dòng thời gian mẫu, có ghi rõ là dữ liệu mẫu.  |
| Lưu trữ dữ liệu                     | **Thật** — TimescaleDB: hypertable + 2 continuous aggregate, chính sách nén và xoá theo tuổi. F5 không còn mất dữ liệu.                                                      |
| `/scada` — **SCADA Command Center** | Số liệu cảm biến vẫn mô phỏng, **nhưng chạy ở server**: một vòng tick duy nhất ghi xuống historian rồi phát cho mọi trình duyệt. OEE đúng công thức Nakajima/SEMI E10.       |
| `/twin` — **Digital Twin**          | Mô phỏng — chuyển động băng tải, hành trình servo, actuator khí nén.                                                                                                         |

Nói cho rõ về `/scada`: nhiệt độ và độ rung **không phải số đo từ cảm biến
thật**. Thứ đã thành thật là đường đi của dữ liệu (server → historian →
WebSocket → nhiều client) và bộ đếm sản lượng của trạm SMT khi PLC đang chạy —
gói tin đánh dấu `countSource: "plc"` hay `"model"` để không nhầm hai thứ đó.

Lộ trình đưa các phần còn lại về "thật" nằm trong [PROJECT_STATUS.md](PROJECT_STATUS.md).

---

## Chạy dashboard

```bash
pnpm install
pnpm dev
```

Mở `http://localhost:3000`. Không cần backend, không cần Docker — dashboard tự
sinh dữ liệu mô phỏng.

## Chạy kèm hạ tầng thật

```bash
docker compose -f infra/docker-compose.yml up -d --build
bash infra/load-program.sh
cat > .env.local <<'EOF'
VITE_PLC_GATEWAY_URL=http://localhost:8000
VITE_VISION_API_URL=http://localhost:8001
VITE_MES_API_URL=http://localhost:8002
EOF
pnpm dev
```

`/plc` đổi nhãn thành `LIVE — OpenPLC qua Modbus TCP`: nút bấm trên web ghi
thật xuống PLC, đèn tháp phản ánh output thật của runtime.

`/vision` đổi nhãn thành `LIVE — OpenCV golden-sample`: ảnh tải lên được gửi
sang service Python, căn theo điểm Mark rồi so với ảnh mẫu.

Phù hiệu trên thanh tiêu đề đổi thành `MES LIVE · Historian`: số liệu SCADA do
backend phát ra, và biểu đồ telemetry dựng lại 30 phút lịch sử từ TimescaleDB
ngay khi mở trang thay vì bắt đầu từ con số không. `/mes` tra cứu serial thật
trong PostgreSQL — thử `FOX-APPLE-M3-90821` để thấy một bo mạch PASS toàn bộ
các trạm nhưng vẫn nằm trong diện thu hồi vật tư.

Mất kết nối backend thì màn hình **giữ nguyên số cuối cùng và báo
`MES MẤT KẾT NỐI`**, chứ không âm thầm quay về dữ liệu mô phỏng — thay số liệu
thật đang chết bằng số sinh tại chỗ là kiểu lỗi tệ nhất một hệ SCADA mắc phải.

Các nhánh độc lập — chạy riêng từng cái cũng được:

```bash
docker compose -f infra/docker-compose.yml up -d --build vision   # chỉ AOI
```

Chi tiết, bản đồ địa chỉ, thuật toán AOI và cách xử lý sự cố:
[infra/README.md](infra/README.md).

---

## Kiến trúc

```
                        Trình duyệt
        ┌──────────────┬──────┴───────┬──────────────────┐
  /plc  │ WebSocket    │ HTTP+WS      │ POST /inspect    │ /vision
 ┌──────▼───────────┐  │  ┌───────────▼──────────┐  ┌────▼─────────────────┐
 │ Edge gateway     │  │  │ Backend MES          │  │ Vision AOI (OpenCV)  │
 │ FastAPI :8000    │  │  │ FastAPI :8002        │  │ FastAPI :8001        │
 └─┬─────────┬──────┘  │  └────────┬─────────────┘  └──────────────────────┘
   │ Modbus  │ MQTT    │           │ asyncpg
   │ :502    ▼         │           ▼
 ┌─▼──────────┐  ┌─────┴──────┐  ┌─────────────────────────┐
 │ OpenPLC    │  │ Mosquitto  │  │ TimescaleDB :5432       │
 │ Runtime    │  └────────────┘  │ telemetry (hypertable)  │
 └────────────┘   Node-RED /     │ + cagg 1m, 1h           │
  infra/plc/      Grafana / …    │ + schema MES            │
  conveyor.st                    └─────────────────────────┘
                                    ▲ asyncpg (gateway ghi tag PLC)
```

Ánh xạ sang mô hình **ISA-95**: OpenPLC là tầng L1 (điều khiển), gateway là
tầng edge, backend MES + TimescaleDB là L2/L3 (SCADA server và MES), dashboard
là HMI đọc từ đó. Topic MQTT tổ chức theo
**Unified Namespace** — `foxconn/hanoi/smt/line-1/plc/...` — phản ánh cấu trúc
nhà máy chứ không phản ánh sơ đồ phần mềm, có birth/death certificate qua LWT
theo tinh thần Sparkplug B.

### Cấu trúc mã nguồn

```
src/features/factory/
├── components/       MachineCard, TelemetryChart, OeeGauge, DigitalTwinLine,
│                     VisionInspector, PlcDiagnostics, MesTraceability, ScadaPanel
├── hooks/            use-factory-store (chọn nguồn), use-plc-link (PLC thật)
├── services/         factorySource (chọn simulator hay MES), sensorSimulator,
│                     mesLink (WebSocket), mesApi (REST), plcGateway, visionService
├── lib/              format (thời gian, thời lượng)
└── types/            Machine, OeeMetrics, AlarmEvent, PcbInspectionRecord, PlcIoState

infra/
├── docker-compose.yml
├── openplc/          Dockerfile build OpenPLC từ mã nguồn
├── plc/conveyor.st   chương trình ladder (Structured Text)
├── gateway/          Modbus → MQTT + WebSocket + REST + ghi historian
├── mosquitto/        cấu hình broker
├── vision/           service AOI: OpenCV, recipe, ảnh mẫu sinh bằng code
├── db/init/          schema TimescaleDB (historian) + MES + dữ liệu mẫu
├── mes/              backend MES: mô hình dây chuyền, OEE, genealogy, REST/WS
└── load-program.sh   nạp + biên dịch + khởi động PLC
```

---

## Vài chi tiết kỹ thuật đáng nói

**OEE tính đúng định nghĩa.** `Availability = Run Time / Planned Production Time`,
`Performance = (Ideal Cycle Time × Total Count) / Run Time`,
`Quality = Good Count / Total Count`. Mỗi máy có `idealCycleSec` riêng và sản
lượng sinh ra _từ_ con số đó, nên Performance đo một thứ có thật. Performance
chặn trần 100%: vượt ngưỡng nghĩa là ideal cycle time ghi sai chứ không phải
máy chạy nhanh hơn vật lý.

**Ladder theo đúng thực hành công nghiệp.** Nút Start/Stop là nút nhấn nhả, có
mạch tự giữ (seal-in). Nút Stop và E-Stop đấu thường đóng (NC) nên tín hiệu
TRUE khi _không_ bị bấm — đứt dây là máy dừng, đó là nguyên tắc fail-safe; vì
vậy mọi tiếp điểm trong chương trình đều là thường mở. Nhả E-Stop không tự khởi
động lại máy (restart interlock, ISO 13849-1). Màn hình cũng ghi rõ: E-Stop
thật phải cắt nguồn động lực qua rơ-le an toàn cứng đạt tối thiểu Cat.3 / PL d,
PLC tiêu chuẩn chỉ được dùng để báo trạng thái.

**Hiệu năng.** Simulator là một external store; mỗi component đăng ký đúng lát
dữ liệu nó vẽ qua `useSyncExternalStore`, nên một tick telemetry không re-render
các module khác. Băng tải trong Digital Twin chạy bằng `requestAnimationFrame`
ghi thẳng `transform` vào DOM — React chỉ render lại khi bo mạch qua mốc 5%.
Năm module là năm route riêng, nên mỗi module là một chunk riêng: mở `/mes` tải
7 KB thay vì kéo theo cả Recharts của `/scada` (377 KB).

**AOI đúng cách máy thật làm.** Ảnh được căn theo 2 điểm Mark
(`HoughCircles` → `atan2` → `warpAffine`) rồi mới so với ảnh mẫu — bỏ bước này
thì một bo mạch tốt nhưng đặt xoay 3° sẽ báo lỗi ở toàn bộ linh kiện. Phép so
chạy trên **ảnh màu**: một sợi dây đỏ trên sơn phủ xanh chuyển sang ảnh xám chỉ
lệch 5 mức, gần như tàng hình. Không dùng deep learning, vì máy AOI công nghiệp
thật phần lớn cũng không — chi tiết và lý do ở [infra/README.md](infra/README.md).

**Logic nghiệp vụ tách khỏi giao diện.** Công thức OEE
(`src/features/factory/lib/oee.ts`) và các nấc thang ladder
(`src/features/factory/lib/ladder.ts`) là hàm thuần, không dính React. Nhờ vậy
chúng kiểm thử được bằng ví dụ mẫu — và `ladder.ts` giữ đúng từng dòng với
`infra/plc/conveyor.st` đang chạy trên PLC thật, để chế độ mô phỏng và chế độ
LIVE không thể hiểu khác nhau về cùng một mạch.

**Historian ba tầng, không phải một bảng log.** Telemetry thô sống 30 ngày
(nén sau 7), continuous aggregate 1 phút sống 1 năm, cagg 1 giờ sống 5 năm; API
tự chọn tầng theo độ dài khoảng thời gian. Cagg 1 giờ dựng từ cagg 1 phút bằng
**tổng có trọng số** chứ không phải `avg(avg)` — trung bình của trung bình sai
khi các bucket con có số mẫu khác nhau, mà mất kết nối PLC 40 giây là đủ để
chúng khác nhau.

**Genealogy trả lời được cả hai chiều.** Serial → lô vật tư, và lô vật tư →
serial. Chiều ngược mới là chiều MES sinh ra để phục vụ: dữ liệu mẫu dựng sẵn
một lô tụ bị cách ly, truy vấn trả về 20 bo mạch trong đó **14 đã PASS toàn bộ
AOI**. "Đã PASS" không đồng nghĩa "ngoài diện thu hồi", và đó là lý do bảng
`unit_material` phải tồn tại độc lập với bảng kết quả kiểm tra.

**Xuống thang mềm mại, nhưng không nói dối.** Không cấu hình
`VITE_PLC_GATEWAY_URL` / `VITE_VISION_API_URL` / `VITE_MES_API_URL` thì không
có socket hay request nào được mở, và giao diện ghi rõ đang chạy dữ liệu mô
phỏng. Ngược lại, đã cấu hình MES mà backend chết thì màn hình **đứng lại và
báo mất kết nối** chứ không lặng lẽ tụt về số mô phỏng — người vận hành thấy
dây chuyền vẫn chạy trong khi không ai biết nó ra sao là kịch bản tệ nhất.

---

## Công nghệ

| Lớp             | Công nghệ                                              |
| --------------- | ------------------------------------------------------ |
| UI              | React 19, TypeScript, Vite 8, TailwindCSS 4, shadcn/ui |
| Dữ liệu         | TanStack Router / Query / Table, Zustand, Recharts     |
| Edge            | Python 3.12, FastAPI, pymodbus, paho-mqtt              |
| Backend         | FastAPI, asyncpg, OpenCV (AOI)                         |
| Dữ liệu lịch sử | TimescaleDB 2.17 / PostgreSQL 16 (hypertable, cagg)    |
| Công nghiệp     | OpenPLC (IEC 61131-3), Modbus TCP, MQTT / Mosquitto    |
| Kiểm thử        | Vitest + Playwright (browser mode)                     |

---

## Lệnh hay dùng

```bash
pnpm dev            # dev server, cổng 3000
pnpm build          # tsc -b && vite build
pnpm lint           # eslint
pnpm format         # prettier --write
pnpm knip           # tìm code và dependency không dùng
pnpm test           # vitest (lần đầu: npx playwright install chromium)
```

### Kiểm thử

**171 test TypeScript** chạy trong Chromium thật (Vitest browser mode), cộng
**54 test Python** cho backend MES và **37 test Python** cho service AOI. Phần
nghiệp vụ được phủ:

| File                               | Nội dung                                                                                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/oee.test.ts`                  | Đối chiếu với ví dụ mẫu đã công bố (A 88.8 / P 86.1 / Q 97.8 / OEE 74.8%); chặn lỗi kinh điển là lấy **trung bình** ba hệ số thay vì **nhân**; chặn cả việc tính giờ nghỉ ca vào planned production time. |
| `lib/ladder.test.ts`               | Tự giữ, restart interlock khi nhả E-Stop, đứt dây NC = bấm nút, đèn tháp; Stop **không** phải sự cố an toàn nên không bật đèn đỏ.                                                                         |
| `services/sensorSimulator.test.ts` | Máy dừng ăn vào down time chứ không vào run time; đồng hồ chỉ chạy khi có subscriber; `telemetryHistory` được thay mới thay vì mutate tại chỗ; chống alarm chattering.                                    |
| `services/mesLink.test.ts`         | Mất kết nối thì **giữ số cuối cùng và báo offline**, không đổi sang số mô phỏng; gói tin trùng mốc thời gian không tạo hai điểm chồng nhau; lệnh đi qua chính socket đó.                                  |
| `services/mesApi.test.ts`          | Không cấu hình thì không gửi request nào; 404 (serial không tồn tại) phân biệt được với lỗi mạng; escape serial và mã lô trong URL.                                                                       |
| `services/factorySource.test.ts`   | Chọn đúng nguồn dữ liệu, hai nguồn có cùng bề mặt API; id của máy là mã tài sản dùng chung với backend.                                                                                                   |

Backend MES (`cd infra/mes && pytest`):

| File                      | Nội dung                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/test_oee.py`       | Cùng ví dụ mẫu với bản TypeScript, nên hai bản cài đặt bị ghim vào một bộ số; kiểm cả cách làm tròn giống `toFixed(1)` của JavaScript.     |
| `tests/test_line.py`      | Ngưỡng cảnh báo theo từng máy (lò reflow 245°C là bình thường), độ trễ chống nhấp nháy, bộ đếm PLC thay số mô hình và được đánh dấu nguồn. |
| `tests/test_historian.py` | Chọn bảng theo độ dài khoảng thời gian; ghi hỏng thì giữ lại dữ liệu đúng thứ tự; hàng đợi tràn thì bỏ điểm **cũ** nhất và đếm lại.        |
| `tests/test_service.py`   | Bộ đếm PLC tràn 16 bit không thành sản lượng âm; nối lại sau khi mất kết nối thì lấy lại mốc chứ không cộng cả khoảng vắng vào một tick.   |

---

## Giấy phép

MIT. Giao diện nền dựa trên [shadcn-admin](https://github.com/satnaing/shadcn-admin).
Tên sản phẩm và nhà máy trong dữ liệu mẫu là hư cấu, chỉ dùng cho mục đích mô phỏng.
