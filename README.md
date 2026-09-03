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
| `/scada` — **SCADA Command Center** | Mô phỏng — dữ liệu cảm biến sinh trong trình duyệt, nhưng OEE tính đúng công thức Nakajima/SEMI E10.                                                                         |
| `/twin` — **Digital Twin**          | Mô phỏng — chuyển động băng tải, hành trình servo, actuator khí nén.                                                                                                         |
| `/vision` — **Vision AOI**          | Mô phỏng — bounding box và điểm khớp cố định. Chưa có thuật toán thị giác thật.                                                                                              |
| `/mes` — **MES Traceability**       | Mô phỏng — timeline một lô hàng mẫu, xuất được CSV.                                                                                                                          |
| Lưu trữ dữ liệu                     | **Chưa có** — refresh trang là mất. Time-series DB nằm ở giai đoạn 3.                                                                                                        |

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
EOF
pnpm dev
```

`/plc` đổi nhãn thành `LIVE — OpenPLC qua Modbus TCP`: nút bấm trên web ghi
thật xuống PLC, đèn tháp phản ánh output thật của runtime.

`/vision` đổi nhãn thành `LIVE — OpenCV golden-sample`: ảnh tải lên được gửi
sang service Python, căn theo điểm Mark rồi so với ảnh mẫu.

Hai nhánh độc lập — chạy riêng từng cái cũng được:

```bash
docker compose -f infra/docker-compose.yml up -d --build vision   # chỉ AOI
```

Chi tiết, bản đồ địa chỉ, thuật toán AOI và cách xử lý sự cố:
[infra/README.md](infra/README.md).

---

## Kiến trúc

```
              Trình duyệt
         ┌─────────┴──────────┐
   /plc  │ WebSocket          │ HTTP POST /inspect  /vision
  ┌──────▼───────────────┐    │   ┌──────────────────────┐
  │ Edge gateway         │    └──►│ Vision AOI (OpenCV)  │
  │ FastAPI :8000        │        │ FastAPI :8001        │
  └──┬────────────────┬──┘        └──────────────────────┘
     │ Modbus TCP     │ MQTT (Unified Namespace)
     │ :502           ▼
  ┌──▼───────────┐  ┌────────────┐
  │ OpenPLC      │  │ Mosquitto  │──► Node-RED / Grafana / …
  │ Runtime      │  └────────────┘
  └──────────────┘
   infra/plc/conveyor.st
```

Ánh xạ sang mô hình **ISA-95**: OpenPLC là tầng L1 (điều khiển), gateway là
tầng edge, dashboard phủ L2 (SCADA) và L3 (MES). Topic MQTT tổ chức theo
**Unified Namespace** — `foxconn/hanoi/smt/line-1/plc/...` — phản ánh cấu trúc
nhà máy chứ không phản ánh sơ đồ phần mềm, có birth/death certificate qua LWT
theo tinh thần Sparkplug B.

### Cấu trúc mã nguồn

```
src/features/factory/
├── components/       MachineCard, TelemetryChart, OeeGauge, DigitalTwinLine,
│                     VisionInspector, PlcDiagnostics, MesTraceability, ScadaPanel
├── hooks/            use-factory-store (simulator), use-plc-link (PLC thật)
├── services/         sensorSimulator (external store), plcGateway (WebSocket)
├── lib/              format (thời gian, thời lượng)
└── types/            Machine, OeeMetrics, AlarmEvent, PcbInspectionRecord, PlcIoState

infra/
├── docker-compose.yml
├── openplc/          Dockerfile build OpenPLC từ mã nguồn
├── plc/conveyor.st   chương trình ladder (Structured Text)
├── gateway/          Modbus → MQTT + WebSocket + REST
├── mosquitto/        cấu hình broker
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

**Xuống thang mềm mại.** Không cấu hình `VITE_PLC_GATEWAY_URL` thì không có
socket nào được mở; tab PLC chạy đúng logic đó ngay trong trình duyệt.

---

## Công nghệ

| Lớp         | Công nghệ                                              |
| ----------- | ------------------------------------------------------ |
| UI          | React 19, TypeScript, Vite 8, TailwindCSS 4, shadcn/ui |
| Dữ liệu     | TanStack Router / Query / Table, Zustand, Recharts     |
| Edge        | Python 3.12, FastAPI, pymodbus, paho-mqtt              |
| Công nghiệp | OpenPLC (IEC 61131-3), Modbus TCP, MQTT / Mosquitto    |
| Kiểm thử    | Vitest + Playwright (browser mode)                     |

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

137 test chạy trong Chromium thật (Vitest browser mode). Phần nghiệp vụ được
phủ:

| File                               | Nội dung                                                                                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/oee.test.ts`                  | Đối chiếu với ví dụ mẫu đã công bố (A 88.8 / P 86.1 / Q 97.8 / OEE 74.8%); chặn lỗi kinh điển là lấy **trung bình** ba hệ số thay vì **nhân**; chặn cả việc tính giờ nghỉ ca vào planned production time. |
| `lib/ladder.test.ts`               | Tự giữ, restart interlock khi nhả E-Stop, đứt dây NC = bấm nút, đèn tháp; Stop **không** phải sự cố an toàn nên không bật đèn đỏ.                                                                         |
| `services/sensorSimulator.test.ts` | Máy dừng ăn vào down time chứ không vào run time; đồng hồ chỉ chạy khi có subscriber; `telemetryHistory` được thay mới thay vì mutate tại chỗ; chống alarm chattering.                                    |

---

## Giấy phép

MIT. Giao diện nền dựa trên [shadcn-admin](https://github.com/satnaing/shadcn-admin).
Tên sản phẩm và nhà máy trong dữ liệu mẫu là hư cấu, chỉ dùng cho mục đích mô phỏng.
