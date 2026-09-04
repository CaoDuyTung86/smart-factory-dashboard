-- ---------------------------------------------------------------------------
-- MES: work order, BOM, routing va GENEALOGY
--
-- Genealogy la ly do MES ton tai. Khi mot lo tu dien bi loi tu nha cung cap,
-- cau hoi khong phai "bo mach nay co tot khong" ma la "nhung bo mach nao da
-- an lo do, dang o dau, va da giao cho ai". Tra loi duoc cau do trong vai
-- phut la thu hoi 300 bo mach; khong tra loi duoc la thu hoi ca thang san
-- xuat. Toan bo thiet ke ben duoi xoay quanh viec truy nguoc duoc theo ca hai
-- chieu: serial -> lo, va lo -> serial.
--
-- Thuat ngu theo ISA-95 / IEC 62264:
--   product        = product definition
--   work_order     = production request
--   routing_step   = operations segment (thu tu tram)
--   unit           = mot san pham co danh tinh (serialised unit)
--   unit_step      = production performance cua mot unit tai mot tram
--   material_lot   = material lot / batch
--   unit_material  = material consumed actual  <-- day la genealogy
-- ---------------------------------------------------------------------------

CREATE TABLE product (
  sku         TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  revision    TEXT NOT NULL,
  description TEXT
);

-- BOM: cai gi phai co tren bo mach, va o vi tri nao.
-- ref_des (reference designator: R12, C45, U1...) la khoa noi BOM voi ket qua
-- AOI — infra/vision cham diem theo dung nhung ma nay.
CREATE TABLE bom_item (
  id           BIGSERIAL PRIMARY KEY,
  product_sku  TEXT NOT NULL REFERENCES product(sku) ON DELETE CASCADE,
  ref_des      TEXT NOT NULL,
  part_number  TEXT NOT NULL,
  description  TEXT NOT NULL,
  qty          NUMERIC(12,4) NOT NULL DEFAULT 1,
  uom          TEXT NOT NULL DEFAULT 'pcs',
  UNIQUE (product_sku, ref_des)
);

-- Routing: thu tu tram bat buoc. asset_code trung voi ma may ben SCADA /
-- Digital Twin — so tram la vi tri, ma may la danh tinh.
CREATE TABLE routing_step (
  id            BIGSERIAL PRIMARY KEY,
  product_sku   TEXT NOT NULL REFERENCES product(sku) ON DELETE CASCADE,
  seq           SMALLINT NOT NULL,
  station_name  TEXT NOT NULL,
  asset_code    TEXT NOT NULL,
  description   TEXT,
  std_cycle_sec NUMERIC(8,2) NOT NULL,
  UNIQUE (product_sku, seq)
);

CREATE TABLE work_order (
  wo_number     TEXT PRIMARY KEY,
  product_sku   TEXT NOT NULL REFERENCES product(sku),
  qty_planned   INTEGER NOT NULL CHECK (qty_planned > 0),
  qty_completed INTEGER NOT NULL DEFAULT 0,
  qty_scrapped  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'RELEASED'
                CHECK (status IN ('PLANNED','RELEASED','RUNNING','HELD','CLOSED')),
  planned_start TIMESTAMPTZ NOT NULL,
  planned_end   TIMESTAMPTZ NOT NULL,
  actual_start  TIMESTAMPTZ,
  actual_end    TIMESTAMPTZ
);

CREATE TABLE material_lot (
  lot_code     TEXT PRIMARY KEY,
  part_number  TEXT NOT NULL,
  supplier     TEXT NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL,
  qty_received NUMERIC(14,4) NOT NULL,
  expires_at   TIMESTAMPTZ,
  -- Khoa lo lai la thao tac thu hoi: khong con duoc cap phat cho unit moi.
  status       TEXT NOT NULL DEFAULT 'RELEASED'
               CHECK (status IN ('RELEASED','QUARANTINED','CONSUMED'))
);
CREATE INDEX material_lot_part_idx ON material_lot (part_number);

CREATE TABLE unit (
  serial_number TEXT PRIMARY KEY,
  wo_number     TEXT NOT NULL REFERENCES work_order(wo_number),
  product_sku   TEXT NOT NULL REFERENCES product(sku),
  started_at    TIMESTAMPTZ NOT NULL,
  completed_at  TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'WIP'
                CHECK (status IN ('WIP','PASS','FAIL','SCRAP','REWORK'))
);
CREATE INDEX unit_wo_idx ON unit (wo_number);

-- Mot dong = mot lan mot unit di qua mot tram. Co lan 2 khi rework, nen khoa
-- chinh KHONG phai (serial, seq): attempt la mot phan cua danh tinh.
CREATE TABLE unit_step (
  id            BIGSERIAL PRIMARY KEY,
  serial_number TEXT NOT NULL REFERENCES unit(serial_number) ON DELETE CASCADE,
  seq           SMALLINT NOT NULL,
  attempt       SMALLINT NOT NULL DEFAULT 1,
  station_name  TEXT NOT NULL,
  asset_code    TEXT NOT NULL,
  operator      TEXT NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL,
  finished_at   TIMESTAMPTZ,
  result        TEXT NOT NULL DEFAULT 'PASS'
                CHECK (result IN ('PASS','WARNING','FAIL')),
  -- Do do cua tram (do day kem han, nhiet do peak, so linh kien dat...).
  -- JSONB vi moi tram do mot thu khac nhau; ep het vao cot cung thi bang se
  -- co 40 cot ma tram nao cung chi dung 3 cot.
  measurements  JSONB NOT NULL DEFAULT '{}'::jsonb,
  details       TEXT,
  UNIQUE (serial_number, seq, attempt)
);
CREATE INDEX unit_step_serial_idx ON unit_step (serial_number, seq, attempt);
CREATE INDEX unit_step_asset_idx  ON unit_step (asset_code, started_at DESC);

-- GENEALOGY: lo linh kien nao thuc su di vao bo mach nao, tai buoc nao.
CREATE TABLE unit_material (
  id            BIGSERIAL PRIMARY KEY,
  serial_number TEXT NOT NULL REFERENCES unit(serial_number) ON DELETE CASCADE,
  unit_step_id  BIGINT REFERENCES unit_step(id) ON DELETE SET NULL,
  ref_des       TEXT NOT NULL,
  part_number   TEXT NOT NULL,
  lot_code      TEXT NOT NULL REFERENCES material_lot(lot_code),
  qty           NUMERIC(12,4) NOT NULL DEFAULT 1,
  consumed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Index nay la thu lam cho truy van thu hoi (lo -> serial) chay duoc trong
-- mili giay thay vi quet toan bang.
CREATE INDEX unit_material_lot_idx    ON unit_material (lot_code);
CREATE INDEX unit_material_serial_idx ON unit_material (serial_number);

CREATE TABLE defect (
  id            BIGSERIAL PRIMARY KEY,
  serial_number TEXT NOT NULL REFERENCES unit(serial_number) ON DELETE CASCADE,
  unit_step_id  BIGINT REFERENCES unit_step(id) ON DELETE SET NULL,
  ref_des       TEXT,
  -- Ma loi theo tu dien IPC-A-610 rut gon; ma chuan hoa moi thong ke Pareto
  -- duoc, mo ta tu do thi khong.
  code          TEXT NOT NULL,
  description   TEXT NOT NULL,
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX defect_serial_idx ON defect (serial_number);
CREATE INDEX defect_code_idx   ON defect (code, detected_at DESC);


-- ---------------------------------------------------------------------------
-- View: he pha xuoi (mot serial -> tat ca lo da an)
-- ---------------------------------------------------------------------------
CREATE VIEW unit_genealogy AS
SELECT
  um.serial_number,
  um.ref_des,
  um.part_number,
  um.lot_code,
  ml.supplier,
  ml.received_at,
  ml.status AS lot_status,
  us.seq,
  us.station_name,
  us.asset_code,
  um.consumed_at
FROM unit_material um
JOIN material_lot ml ON ml.lot_code = um.lot_code
LEFT JOIN unit_step us ON us.id = um.unit_step_id;
