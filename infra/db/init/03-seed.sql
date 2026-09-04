-- ---------------------------------------------------------------------------
-- Du lieu mau: mot ca san xuat co that tinh huong
--
-- Kich ban duoc dung co chu dich: lo tu dien LOT-CAP-2609-B bi nha cung cap
-- bao co van de va da bi QUARANTINED. Mot phan cac bo mach da an lo do TRUOC
-- khi co canh bao — trong so do co ca nhung bo mach da PASS toan bo AOI.
-- Day chinh la ly do genealogy phai ton tai doc lap voi ket qua kiem tra:
-- "da PASS" khong dong nghia "khong nam trong dien thu hoi".
--
-- Serial FOX-APPLE-M3-90821 (serial mac dinh tren giao dien MES) co tinh
-- chon: no PASS moi tram, nhung van nam trong dien thu hoi.
-- ---------------------------------------------------------------------------

INSERT INTO product (sku, name, revision, description) VALUES
  ('MBP-M3-LOGIC', 'MacBook M3 Logic Board', 'B',
   'Bo mach logic 6 lop, 148 linh kien SMT, khong chi (SAC305)');

INSERT INTO bom_item (product_sku, ref_des, part_number, description, qty, uom) VALUES
  ('MBP-M3-LOGIC', 'U1',  'APL-M3-SOC-8C',   'SoC Apple M3 8-core, BGA-1024',         1,    'pcs'),
  ('MBP-M3-LOGIC', 'R12', 'RC0402FR-0710KL', 'Dien tro 10k 1% 0402',                 1,    'pcs'),
  ('MBP-M3-LOGIC', 'R13', 'RC0402FR-074K7L', 'Dien tro 4k7 1% 0402',                 1,    'pcs'),
  ('MBP-M3-LOGIC', 'C45', 'CL05A106MQ5NUNC', 'Tu gom 10uF 6.3V X5R 0402',            1,    'pcs'),
  ('MBP-M3-LOGIC', 'C46', 'CL05B104KO5NNNC', 'Tu gom 100nF 16V X7R 0402',            1,    'pcs'),
  ('MBP-M3-LOGIC', 'L4',  'DFE201610E-2R2M', 'Cuon cam 2.2uH 3.0A',                  1,    'pcs'),
  ('MBP-M3-LOGIC', 'D2',  'PMEG3010ER',      'Diode Schottky 30V 1A',                1,    'pcs'),
  ('MBP-M3-LOGIC', 'J8',  'JST-SH-12P',      'Connector FPC 12 chan 0.5mm',          1,    'pcs'),
  ('MBP-M3-LOGIC', 'P1',  'USB4-TYPEC-24P',  'Cong USB-C 24 chan, chiu 10k lan cam', 1,    'pcs'),
  ('MBP-M3-LOGIC', '-',   'SAC305-T4-PASTE', 'Kem han SAC305 Type 4 (khong chi)',    0.42, 'g');

-- Routing bam sat 5 tram tren giao dien Digital Twin / MES.
INSERT INTO routing_step (product_sku, seq, station_name, asset_code, description, std_cycle_sec) VALUES
  ('MBP-M3-LOGIC', 1, 'Nhap Ban (PCB Loader)',            'LOADER-A1',      'Nap bo mach tran, quet ma vach, gan jig', 12.0),
  ('MBP-M3-LOGIC', 2, 'In Kem Han & SPI',                 'PRINTER-SPI-A2', 'In kem han qua stencil, do do day 3D',    18.0),
  ('MBP-M3-LOGIC', 3, 'Gan Linh Kien SMT (Pick & Place)', 'SMT-LINE-01',    'Gan 148 linh kien SMT',                   26.0),
  ('MBP-M3-LOGIC', 4, 'Han Lo Hoi Luu (Reflow Oven)',     'REFLOW-OVEN-02', 'Profile khong chi 4 vung',                42.0),
  ('MBP-M3-LOGIC', 5, 'Kiem Tra Quang Hoc (AOI)',         'AOI-INSPECT-04', 'AOI 148 linh kien + do lech mark',        35.0);

INSERT INTO material_lot (lot_code, part_number, supplier, received_at, qty_received, expires_at, status) VALUES
  ('LOT-SOC-2608-A',   'APL-M3-SOC-8C',   'Apple Silicon',         now() - INTERVAL '21 days',  2000, NULL,                        'RELEASED'),
  ('LOT-RES-2607-C',   'RC0402FR-0710KL', 'Yageo',                 now() - INTERVAL '30 days', 50000, NULL,                        'RELEASED'),
  ('LOT-RES-2607-D',   'RC0402FR-074K7L', 'Yageo',                 now() - INTERVAL '30 days', 50000, NULL,                        'RELEASED'),
  ('LOT-CAP-2605-A',   'CL05A106MQ5NUNC', 'Samsung EM',            now() - INTERVAL '45 days', 40000, NULL,                        'RELEASED'),
  -- Lo co van de: nha cung cap bao sai lech dien dung sau khi da giao hang.
  ('LOT-CAP-2609-B',   'CL05A106MQ5NUNC', 'Samsung EM',            now() - INTERVAL '9 days',  40000, NULL,                        'QUARANTINED'),
  ('LOT-CAP-2606-E',   'CL05B104KO5NNNC', 'Murata',                now() - INTERVAL '38 days', 60000, NULL,                        'RELEASED'),
  ('LOT-IND-2604-A',   'DFE201610E-2R2M', 'Murata',                now() - INTERVAL '60 days', 12000, NULL,                        'RELEASED'),
  ('LOT-DIO-2603-B',   'PMEG3010ER',      'Nexperia',              now() - INTERVAL '70 days', 15000, NULL,                        'RELEASED'),
  ('LOT-CON-2608-F',   'JST-SH-12P',      'JST',                   now() - INTERVAL '18 days',  8000, NULL,                        'RELEASED'),
  ('LOT-USB-2608-G',   'USB4-TYPEC-24P',  'Foxconn Interconnect',  now() - INTERVAL '15 days',  8000, NULL,                        'RELEASED'),
  -- Kem han co han su dung that: qua han la phai huy, khong phai dung co.
  ('LOT-PASTE-2609-H', 'SAC305-T4-PASTE', 'Indium Corp',           now() - INTERVAL '4 days',    500, now() + INTERVAL '2 months', 'RELEASED');

INSERT INTO work_order (wo_number, product_sku, qty_planned, qty_completed, qty_scrapped, status, planned_start, planned_end, actual_start, actual_end) VALUES
  ('WO-2026-0842', 'MBP-M3-LOGIC', 500, 494, 6, 'CLOSED',
   now() - INTERVAL '3 days', now() - INTERVAL '2 days', now() - INTERVAL '3 days', now() - INTERVAL '2 days'),
  ('WO-2026-0901', 'MBP-M3-LOGIC', 500,   0, 0, 'RUNNING',
   now() - INTERVAL '4 hours', now() + INTERVAL '4 hours', now() - INTERVAL '3 hours', NULL);


-- ---------------------------------------------------------------------------
-- 60 bo mach cua WO-2026-0901, moi bo mach 5 buoc + he pha vat tu
-- ---------------------------------------------------------------------------
DO LANGUAGE plpgsql $seed$
DECLARE
  n           INT;
  serial      TEXT;
  t0          TIMESTAMPTZ;
  step_start  TIMESTAMPTZ;
  step_id     BIGINT;
  cap_lot     TEXT;
  aoi_result  TEXT;
  unit_status TEXT;
  paste_um    NUMERIC;
  peak_c      NUMERIC;
  ng_count    INT;
BEGIN
  FOR n IN 90801..90860 LOOP
    serial := 'FOX-APPLE-M3-' || n;
    -- Nhip 3 phut/bo mach, bat dau tu 3 gio truoc.
    t0 := now() - INTERVAL '3 hours' + ((n - 90801) * INTERVAL '3 minutes');

    -- Cua so an lo tu bi cach ly: 90815..90834.
    cap_lot := CASE WHEN n BETWEEN 90815 AND 90834
                    THEN 'LOT-CAP-2609-B' ELSE 'LOT-CAP-2605-A' END;

    -- Loi AOI: mot ty le nen rai deu, cong them cum loi cua lo tu xau.
    -- 90821 duoc chua ra: no PASS het, de minh hoa "PASS van bi thu hoi".
    ng_count := CASE
      WHEN n = 90821 THEN 0
      WHEN cap_lot = 'LOT-CAP-2609-B' AND n % 4 = 0 THEN 1
      WHEN n % 17 = 0 THEN 1
      ELSE 0
    END;
    aoi_result  := CASE WHEN ng_count > 0 THEN 'FAIL' ELSE 'PASS' END;
    unit_status := aoi_result;

    INSERT INTO unit (serial_number, wo_number, product_sku, started_at, completed_at, status)
    VALUES (serial, 'WO-2026-0901', 'MBP-M3-LOGIC', t0, t0 + INTERVAL '133 seconds', unit_status);

    -- 1. Loader
    step_start := t0;
    INSERT INTO unit_step (serial_number, seq, station_name, asset_code, operator, started_at, finished_at, result, measurements, details)
    VALUES (serial, 1, 'Nhap Ban (PCB Loader)', 'LOADER-A1', 'Auto Robot Inovance',
            step_start, step_start + INTERVAL '12 seconds', 'PASS',
            jsonb_build_object('jig_id', 'J-' || (9000 + (n % 60)), 'barcode_read_ms', 180),
            'Bare PCB da quet ma, jig gan chac.');

    -- 2. In kem han + SPI. Do day kem han la so do that, co dung sai 115-125um.
    step_start := t0 + INTERVAL '17 seconds';
    paste_um := 120.0 + ((n * 7) % 90) / 10.0 - 4.5;   -- ~115.5 .. 124.4
    INSERT INTO unit_step (serial_number, seq, station_name, asset_code, operator, started_at, finished_at, result, measurements, details)
    VALUES (serial, 2, 'In Kem Han & SPI', 'PRINTER-SPI-A2', 'Auto Printer',
            step_start, step_start + INTERVAL '18 seconds',
            CASE WHEN paste_um BETWEEN 115 AND 125 THEN 'PASS' ELSE 'WARNING' END,
            jsonb_build_object('paste_thickness_um', round(paste_um, 1),
                               'spec_low_um', 115, 'spec_high_um', 125,
                               'squeegee_speed_mm_s', 45),
            'Kem han SAC305, in qua stencil 0.10mm.')
    RETURNING id INTO step_id;

    INSERT INTO unit_material (serial_number, unit_step_id, ref_des, part_number, lot_code, qty, consumed_at)
    VALUES (serial, step_id, '-', 'SAC305-T4-PASTE', 'LOT-PASTE-2609-H', 0.42, step_start);

    -- 3. Pick & place: day la tram tieu thu linh kien -> he pha nam o day.
    step_start := t0 + INTERVAL '40 seconds';
    INSERT INTO unit_step (serial_number, seq, station_name, asset_code, operator, started_at, finished_at, result, measurements, details)
    VALUES (serial, 3, 'Gan Linh Kien SMT (Pick & Place)', 'SMT-LINE-01', 'Auto Nozzle Array',
            step_start, step_start + INTERVAL '26 seconds', 'PASS',
            jsonb_build_object('components_placed', 148, 'pickup_errors', (n % 3),
                               'feeder_lane_count', 24),
            'Gan 148 linh kien SMT.')
    RETURNING id INTO step_id;

    INSERT INTO unit_material (serial_number, unit_step_id, ref_des, part_number, lot_code, qty, consumed_at) VALUES
      (serial, step_id, 'U1',  'APL-M3-SOC-8C',   'LOT-SOC-2608-A', 1, step_start),
      (serial, step_id, 'R12', 'RC0402FR-0710KL', 'LOT-RES-2607-C', 1, step_start),
      (serial, step_id, 'R13', 'RC0402FR-074K7L', 'LOT-RES-2607-D', 1, step_start),
      (serial, step_id, 'C45', 'CL05A106MQ5NUNC', cap_lot,          1, step_start),
      (serial, step_id, 'C46', 'CL05B104KO5NNNC', 'LOT-CAP-2606-E', 1, step_start),
      (serial, step_id, 'L4',  'DFE201610E-2R2M', 'LOT-IND-2604-A', 1, step_start),
      (serial, step_id, 'D2',  'PMEG3010ER',      'LOT-DIO-2603-B', 1, step_start),
      (serial, step_id, 'J8',  'JST-SH-12P',      'LOT-CON-2608-F', 1, step_start),
      (serial, step_id, 'P1',  'USB4-TYPEC-24P',  'LOT-USB-2608-G', 1, step_start);

    -- 4. Reflow: TAL (time above liquidus) va peak la hai so quyet dinh chat
    -- luong moi han khong chi; 217C la diem nong chay cua SAC305.
    step_start := t0 + INTERVAL '68 seconds';
    peak_c := 245.0 + ((n * 3) % 40) / 10.0 - 2.0;    -- ~243.0 .. 246.9
    INSERT INTO unit_step (serial_number, seq, station_name, asset_code, operator, started_at, finished_at, result, measurements, details)
    VALUES (serial, 4, 'Han Lo Hoi Luu (Reflow Oven)', 'REFLOW-OVEN-02', 'Reflow Controller',
            step_start, step_start + INTERVAL '42 seconds', 'PASS',
            jsonb_build_object('peak_temp_c', round(peak_c, 1),
                               'liquidus_c', 217,
                               'tal_s', 55 + (n % 8),
                               'soak_s', 65,
                               'cooling_rate_c_s', 3.4,
                               'zones', 4),
            'Profile khong chi 4 vung: preheat 150->180C, soak, peak, cooling < 4C/s.');

    -- 5. AOI
    step_start := t0 + INTERVAL '113 seconds';
    INSERT INTO unit_step (serial_number, seq, station_name, asset_code, operator, started_at, finished_at, result, measurements, details)
    VALUES (serial, 5, 'Kiem Tra Quang Hoc (AOI)', 'AOI-INSPECT-04', 'AOI OpenCV (infra/vision)',
            step_start, step_start + INTERVAL '20 seconds', aoi_result,
            jsonb_build_object('components_checked', 148,
                               'ng_count', ng_count,
                               'theta_offset_deg', round((((n * 11) % 40) / 100.0 - 0.2)::numeric, 2),
                               'cycle_time_ms', 40 + (n % 45)),
            CASE WHEN ng_count > 0
                 THEN 'AOI phat hien loi tai C45.'
                 ELSE 'Quet 148 linh kien, 148 PASS.' END)
    RETURNING id INTO step_id;

    IF ng_count > 0 THEN
      INSERT INTO defect (serial_number, unit_step_id, ref_des, code, description, detected_at)
      VALUES (serial, step_id, 'C45', 'IPC-610-8.3.2',
              CASE WHEN cap_lot = 'LOT-CAP-2609-B'
                   THEN 'Tu C45 lech chan, diem khop 0.58 duoi nguong 0.70'
                   ELSE 'Moi han C45 thieu thiec' END,
              step_start + INTERVAL '15 seconds');
    END IF;
  END LOOP;

  UPDATE work_order SET
    qty_completed = (SELECT count(*) FROM unit WHERE wo_number = 'WO-2026-0901' AND status = 'PASS'),
    qty_scrapped  = (SELECT count(*) FROM unit WHERE wo_number = 'WO-2026-0901' AND status = 'FAIL')
  WHERE wo_number = 'WO-2026-0901';
END
$seed$;
