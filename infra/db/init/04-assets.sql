-- ---------------------------------------------------------------------------
-- Danh muc thiet bi va trang thai ca
--
-- Truoc day danh sach may nam cung trong ma nguon frontend, va nguong canh
-- bao nam rai rac trong ham tick duoi dang `m.id === 'm1' && temp > 75`. Dua
-- ca hai xuong DB vi day la du lieu ky thuat cua thiet bi, khong phai logic
-- phan mem: doi mot nguong nhiet la viec cua ky su quy trinh, khong nen phai
-- build lai frontend.
--
-- Ma tai san (asset_code) la danh tinh cua may va la khoa noi sang telemetry,
-- routing_step va unit_step. So tram la vi tri, ma may la danh tinh.
-- ---------------------------------------------------------------------------

CREATE TABLE asset (
  asset_code             TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  category               TEXT NOT NULL,
  -- Ideal cycle time: mau so cua he so Performance trong OEE. Sai so nay thi
  -- Performance sai theo, nen no la thong so cua may chu khong phai hang so
  -- trong code.
  ideal_cycle_sec        NUMERIC(8,3) NOT NULL CHECK (ideal_cycle_sec > 0),
  target_output          INTEGER      NOT NULL,
  nominal_temp_c         NUMERIC(6,2) NOT NULL,
  nominal_vibration_mm_s NUMERIC(6,3) NOT NULL,
  nominal_power_kw       NUMERIC(8,2) NOT NULL,
  warn_temp_c            NUMERIC(6,2) NOT NULL,
  crit_temp_c            NUMERIC(6,2) NOT NULL,
  warn_vibration_mm_s    NUMERIC(6,3) NOT NULL,
  sort_order             SMALLINT     NOT NULL
);

INSERT INTO asset (asset_code, name, category, ideal_cycle_sec, target_output,
                   nominal_temp_c, nominal_vibration_mm_s, nominal_power_kw,
                   warn_temp_c, crit_temp_c, warn_vibration_mm_s, sort_order) VALUES
  ('SMT-LINE-01',    'SMT Pick & Place',       'Assembly',        0.400, 15000,  52.4, 1.20, 18.5,  75.0,  88.0, 4.0, 1),
  -- Lo reflow chay o vung peak 245C: nguong canh bao phai tinh theo profile
  -- khong chi, khong the dung chung nguong 75C nhu may gan linh kien.
  ('REFLOW-OVEN-02', 'Reflow Soldering Oven',  'Soldering',       0.450, 15000, 245.0, 0.80, 35.2, 262.0, 295.0, 3.0, 2),
  ('CNC-MILL-03',    'CNC Enclosure Milling',  'Machining',       1.200,  5000,  68.1, 2.40, 24.0,  85.0,  95.0, 6.0, 3),
  ('AOI-INSPECT-04', 'AOI Optical Inspection', 'Quality Control', 0.420, 15000,  38.5, 0.40,  8.2,  55.0,  70.0, 2.5, 4);


-- ---------------------------------------------------------------------------
-- Trang thai tich luy cua ca san xuat
--
-- OEE la ty so cua nhung con so cong don tu dau ca. Neu backend khoi dong lai
-- ma bo dem ve 0 thi OEE nhay len 100% roi tut dan — mot con so vo nghia. Vi
-- vay run_time/down_time/output/defects duoc ghi xuong day moi tick va doc
-- lai luc khoi dong. Day chinh la khac biet giua "mo phong trong trinh duyet"
-- va "co historian": F5 khong con xoa sach du lieu.
-- ---------------------------------------------------------------------------

CREATE TABLE machine_shift_state (
  asset_code    TEXT PRIMARY KEY REFERENCES asset(asset_code) ON DELETE CASCADE,
  shift_start   TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'running'
                CHECK (status IN ('running','idle','warning','error')),
  temperature_c NUMERIC(8,2) NOT NULL,
  vibration     NUMERIC(8,3) NOT NULL,
  power_kw      NUMERIC(8,2) NOT NULL,
  output        INTEGER NOT NULL DEFAULT 0,
  defects       INTEGER NOT NULL DEFAULT 0,
  run_time_ms   BIGINT  NOT NULL DEFAULT 0,
  down_time_ms  BIGINT  NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Gia tri mo ca: san luong va thoi gian chay duoc gieo khop nhau
--   run_time = output x ideal_cycle / performance_gia_dinh (0.92)
-- de OEE ngay khung hinh dau tien da la mot con so co that, khong phai 0.
INSERT INTO machine_shift_state
  (asset_code, shift_start, status, temperature_c, vibration, power_kw,
   output, defects, run_time_ms, down_time_ms)
SELECT
  a.asset_code,
  date_trunc('hour', now()) - INTERVAL '6 hours',
  'running',
  a.nominal_temp_c,
  a.nominal_vibration_mm_s,
  a.nominal_power_kw,
  s.output,
  s.defects,
  round(s.output * a.ideal_cycle_sec * 1000 / 0.92),
  round(s.output * a.ideal_cycle_sec * 1000 / 0.92 * 0.065)  -- ~93.9% availability
FROM asset a
JOIN (VALUES
  ('SMT-LINE-01',    14250, 28),
  ('REFLOW-OVEN-02', 13800, 42),
  ('CNC-MILL-03',     4800, 15),
  ('AOI-INSPECT-04', 14100,  0)
) AS s(asset_code, output, defects) ON s.asset_code = a.asset_code;


-- ---------------------------------------------------------------------------
-- Nhat ky canh bao
--
-- Luu rieng chu khong nhet vao telemetry: canh bao co vong doi (phat sinh ->
-- xac nhan -> tro ve binh thuong), con telemetry chi la mot day so. Bang nay
-- co san cho vong sau khi lam alarm theo ISA-18.2 — cac cot ack_at/cleared_at
-- chinh la hai chuyen trang thai dau tien cua state machine do.
-- ---------------------------------------------------------------------------

CREATE TABLE alarm_event (
  id           BIGSERIAL PRIMARY KEY,
  asset_code   TEXT NOT NULL REFERENCES asset(asset_code) ON DELETE CASCADE,
  raised_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  severity     TEXT NOT NULL CHECK (severity IN ('warning','critical')),
  message      TEXT NOT NULL,
  value        DOUBLE PRECISION,
  unit         TEXT,
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  ack_at       TIMESTAMPTZ,
  cleared_at   TIMESTAMPTZ
);
CREATE INDEX alarm_event_open_idx ON alarm_event (raised_at DESC);
-- Chi duoc phep co mot canh bao chua xac nhan cho moi (may, muc do). Rang buoc
-- nay nam o DB chu khong o code: chong chattering la yeu cau cua he thong
-- canh bao, khong phai cua mot phien ban client cu the.
CREATE UNIQUE INDEX alarm_event_active_idx
  ON alarm_event (asset_code, severity)
  WHERE NOT acknowledged AND cleared_at IS NULL;
