# 🏭 Smart Factory Ultra Edition — Industrial IoT & SCADA/MES Platform

> **Hệ Thống Giám Sát & Điều Hành Sản Xuất Thông Minh Thời Gian Thực (Real-time Industrial IoT, Digital Twin, Camera Vision AOI & PLC Diagnostics)**

![License](https://img.shields.io/badge/License-MIT-blue.svg)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)
![Vite](https://img.shields.io/badge/Vite-6.x-646CFF?logo=vite)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-4.x-38B2AC?logo=tailwindcss)

---

## 📌 Giới Thiệu Dự Án

**Smart Factory Ultra Edition** là một nền tảng Web SCADA / MES công nghiệp hiện đại, mô phỏng toàn diện hoạt động của dây chuyền sản xuất tự động hóa SMT (Surface Mount Technology) và lắp ráp linh kiện điện tử cao cấp (dựa trên trải nghiệm thực tế tại nhà máy sản xuất linh kiện điện tử Fukang Technology - Tập đoàn Foxconn).

Hệ thống cho phép kỹ sư và quản lý nhà máy theo dõi dữ liệu cảm biến thời gian thực, trực quan hóa bản sao số 2D/3D (Digital Twin), soi lỗi linh kiện bằng Camera Vision AOI, kiểm tra trạng thái I/O & sơ đồ thang PLC Siemens S7-1200, và truy xuất nguồn gốc sản phẩm theo chuỗi thời gian.

---

## 🌟 Các Tính Năng Nổi Bật

### 1. 📊 SCADA Command Center (Trung Tâm Điều Hành Real-time)
- **Real-time Telemetry:** Giám sát dòng dữ liệu Nhiệt độ (°C), Độ rung (mm/s), Sản lượng, và Phế phẩm cập nhật mỗi 1.5 giây.
- **Chỉ số OEE Quốc tế:** Tự động tính toán 4 chỉ số hiệu suất nhà máy: *Availability (Độ khả dụng), Performance (Hiệu suất), Quality (Chất lượng)* và *Overall OEE Score*.
- **Alarm Management System:** Phát hiện vượt ngưỡng an toàn tự động, phát cảnh báo đỏ và hỗ trợ xác nhận xử lý sự cố (*Acknowledge*).
- **Fault Injection Console:** Bảng điều khiển giả lập cố tình tạo lỗi (*Quá nhiệt SMT, Rung lắc CNC, Dừng khẩn cấp E-Stop, Khôi phục hệ thống*) để thử nghiệm khả năng ứng phó sự cố.

### 2. 🎬 2D/3D Digital Twin Assembly Line (Bản Sao Số Dây Chuyền SMT)
- Mô phỏng băng tải 2D/3D chạy động của bo mạch PCB di chuyển qua 5 trạm máy: *Loader ➔ In kem hàn ➔ Gắn chip SMT ➔ Lò nung Reflow ➔ Kiểm tra AOI ➔ Unloader*.
- **Station Hardware Inspector:** Xem trực tiếp vị trí hành trình Robot Servo trục X/Y/Z (mm), trạng thái xi lanh khí nén (*Pneumatic Cylinder Extended/Retracted*) và đầu hút chân không (*Vacuum Nozzle*).

### 3. 👁️ Camera Vision & AOI Defect Inspector (Thị Giác Máy Tính Công Nghiệp)
- Màn hình mô phỏng máy kiểm tra quang học tự động **Cognex VisionPro / Halcon**:
- Tự động soi bo mạch PCB và vẽ khung **Bounding Box** xanh (OK) / đỏ (NG):
  - *Chip IC-U1:* **OK (99.8% confidence)**.
  - *Resistor R12:* 🔴 **NG - Component Misaligned (Lệch chân 12°)**.
  - *Solder Pin 8-12:* 🔴 **NG - Solder Bridge (Dính thiếc ngắn mạch)**.
- Quét mã QR Serial bo mạch và kiểm tra độ lệch góc Mark Alignment ($\theta$).

### 4. ⚡ PLC Siemens SIMATIC S7-1200 & Ladder Logic Diagnostics
- Mô phỏng cấu trúc phần cứng **PLC Rack Siemens S7-1200** (CPU 1212C + Module DI/DO + Module Analog AI 4x13BIT chuẩn TIA Portal V16).
- **Bảng đèn LED I/O Real-time:** Đèn tín hiệu nhấp nháy theo công tắc đầu vào và đầu ra.
- **Interactive Ladder Diagram Viewer (Sơ Đồ Thang Chạy Động):** Trực quan hóa dòng điện chạy qua các tiếp điểm Ladder (Normally Open/Closed). Thao tác bấm nút *E-Stop* hoặc *Mở cửa an toàn* sẽ ngắt dòng điện và kích hoạt tháp đèn đỏ báo lỗi tức thì!

### 5. 📦 MES Product Traceability System (Truy Xuất Nguồn Gốc Bo Mạch)
- Tra cứu mã Barcode / QR Code bo mạch (VD: `FOX-APPLE-M3-90821`).
- Hiển thị **Vòng đời bo mạch (Lifecycle Timeline)** từ lúc vào xưởng đến khi ra lò.
- Xuất báo cáo sản xuất lô hàng dạng file CSV/JSON.

---

## 🛠️ Công Nghệ & Ngôn Ngữ Sử Dụng

| Thành phần | Công nghệ / Thư viện | Vai trò |
|---|---|---|
| **Ngôn ngữ chính** | **TypeScript 5.x** | Đảm bảo tính chặt chẽ về dữ liệu (Type Safety), quản lý State thời gian thực, ngăn ngừa lỗi rò rỉ bộ nhớ. |
| **Giao diện & Framework** | **React 19** + **Vite 8** | Xây dựng UI linh hoạt, Render tốc độ cao 60 FPS, Hot Module Replacement (HMR) mượt mà. |
| **Styling & Theme** | **TailwindCSS 4** + **Shadcn UI** | Cung cấp Design System đẳng cấp Enterprise, hỗ trợ Dark/Light Mode rực rỡ. |
| **Data Visualization** | **Recharts** + **Canvas / SVG** | Vẽ biểu đồ biến thiên telemetry theo thời gian thực & render sơ đồ Digital Twin. |
| **Routing** | **TanStack Router** | Điều hướng file-based routing type-safe cho 5 Module công nghiệp. |
| **Icons & Assets** | **Lucide React** | Bộ biểu tượng chuẩn giao diện điều khiển công nghiệp SCADA. |

---

## ❓ Phân Tích: Ngôn Ngữ & Tech Stack Có Phù Hợp & Tối Ưu Nhất Không?

### 👉 CÂU TRẢ LỜI: RẤT PHÙ HỢP VÀ TỐI ƯU TUYỆT ĐỐI CHO LỚP WEB SCADA/MES!

#### 1. Tại sao là TypeScript mà không phải JavaScript thuần?
- Trong công nghiệp IoT/SCADA, dữ liệu cảm biến (Nhiệt độ, Độ rung, Điện áp, Trạng thái Relay/I-O) có cấu trúc vô cùng chặt chẽ.
- **TypeScript** giúp định nghĩa các strict interface (`Machine`, `PlcIoState`, `AlarmEvent`, `VisionInspectionRecord`). Nhờ đó ngăn chặn 100% lỗi runtime phổ biến như `NullPointerException` hay đọc phải giá trị `undefined/NaN` — yếu tố sinh tử trong các ứng dụng điều khiển công nghiệp.

#### 2. Tại sao lại là Web-based (React + Vite + TailwindCSS) thay vì ứng dụng Desktop truyền thống (C# WinForms / C++ WPF / WinCC)?
- **Truy cập đa nền tảng (Cross-Platform):** Các phần mềm SCADA truyền thống (như WinCC, Wonderware) đòi hỏi cài đặt phức tạp trên máy tính Windows. Với Web SCADA (React/TypeScript), kỹ sư và giám đốc có thể mở trang web giám sát nhà máy ở bất kỳ đâu trên Máy tính, Máy tính bảng (iPad) hay Điện thoại di động.
- **Tốc độ Render & Đồ họa WebGL/Canvas:** Công nghệ Web hiện đại hỗ trợ SVG/Canvas render 60fps mượt mà, giúp dựng bản sao số (Digital Twin) trực quan mà không cần đầu tư máy tính chuyên dụng đắt đỏ.
- **Dễ dàng tích hợp Cloud / Rest API / WebSocket:** Thuận tiện kết nối với máy chủ Backend (Node.js, Spring Boot, Python FastAPI) qua WebSocket/MQTT để nhận dữ liệu từ thiết bị IoT thật hoặc PLC.

---

## 💻 Hướng Dẫn Cài Đặt & Chạy Khởi Động

### Yêu cầu tiên quyết
- Node.js (phiên bản v18 trở lên)
- pnpm (hoặc npm / yarn)

### Các bước chạy dự án:

1. **Di chuyển vào thư mục dự án:**
   ```powershell
   cd "d:\clone repo\smart-factory-dashboard"
   ```

2. **Cài đặt các gói phụ thuộc (Dependencies):**
   ```powershell
   pnpm install
   ```

3. **Khởi chạy môi trường phát triển (Dev Server):**
   ```powershell
   pnpm dev
   ```

4. **Mở trình duyệt:**
   Truy cập địa chỉ `http://localhost:3000` để trải nghiệm giao diện!

---

## 📜 Cấu Trúc Thư Mục Dự Án

```text
smart-factory-dashboard/
├── src/
│   ├── components/            # Shadcn UI components + Layout (Sidebar, Header)
│   ├── features/
│   │   ├── dashboard/         # Màn hình chính lắp ráp 5 Tabs Module
│   │   └── factory/           # Module lõi Smart Factory
│   │       ├── components/    # MachineCard, TelemetryChart, OeeGauge, DigitalTwinLine,
│   │       │                  # VisionInspector, PlcDiagnostics, MesTraceability
│   │       ├── services/      # sensorSimulator.ts (Data Engine real-time)
│   │       └── types/         # TypeScript Interfaces (Machine, Alarm, Vision, PLC IO)
│   └── routes/                # TanStack Router configuration
├── package.json
└── vite.config.ts
```

---

*Dự án được xây dựng với tinh thần học hỏi, thử thách tư duy thiết kế phần mềm công nghiệp và ứng dụng thực tế kiến thức tự động hóa sản xuất.*
