-- ---------------------------------------------------------------------------
-- He canh bao theo ANSI/ISA-18.2
--
-- Ban truoc chi co mot bang `alarm_event` voi mot co `acknowledged`. Bang do
-- da bi bo, khong phai vi no sai ma vi no tra loi duoc dung mot cau hoi ("hien
-- co gi dang keu") trong khi mot he canh bao phai tra loi duoc ba:
--
--   * Vi sao canh bao nay ton tai, va nguoi van hanh phai lam gi?  -> alarm_definition
--   * No da di qua nhung trang thai nao, luc nao, do ai?           -> alarm_transition
--   * Ngay bay gio no dang o dau, va con song sot qua restart chua? -> alarm_state
--
-- Ba bang, ba tuoi tho khac nhau: cau hinh song cung thiet bi, nhat ky song
-- cung ho so kiem toan, trang thai song cung phien chay hien tai.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Master Alarm Database — ket qua cua rationalization
--
-- ISA-18.2 doi moi canh bao phai qua mot buoc goi la alarm rationalization:
-- ghi lai hau qua neu khong xu ly, hanh dong nguoi van hanh phai lam, va thoi
-- gian ho co de lam. Ba thu do la CAC COT o day chu khong phai chu thich:
-- muc uu tien duoc SUY RA tu chung (hau qua nang + thoi gian phan ung ngan =
-- uu tien cao), nen luu muc uu tien ma khong luu can cu thi lan sau khong ai
-- rasoat lai duoc.
--
-- Va neu khong dien noi cot `operator_response` thi day khong phai canh bao.
-- Do la mot su kien, va su kien thuoc ve nhat ky chu khong thuoc ve man hinh
-- canh bao. Chinh quy tac nay da loai bo canh bao "Line Speed Overclocked" cua
-- ban truoc: nguoi van hanh vua tu tay keo thanh truot len 2.5x, bao lai cho
-- ho biet dieu ho vua lam khong phai la mot canh bao.
-- ---------------------------------------------------------------------------

CREATE TABLE alarm_definition (
  tag               TEXT PRIMARY KEY,
  asset_code        TEXT NOT NULL REFERENCES asset(asset_code) ON DELETE CASCADE,
  metric            TEXT NOT NULL,
  -- HI/HIHI/LO/LOLO la quy uoc chung cua DCS va SCADA. Tach HI voi HIHI chu
  -- khong dung mot nguong: hai muc do doi hai hanh dong khac nhau, va gop lai
  -- thi mat kha nang bao som.
  comparison        TEXT NOT NULL CHECK (comparison IN ('HI','HIHI','LO','LOLO','BOOL')),
  setpoint          DOUBLE PRECISION NOT NULL,
  -- Deadband chi noi rong phia TAT. Xem `_raw_condition` trong alarms.py.
  deadband          DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (deadband >= 0),
  on_delay_sec      NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (on_delay_sec  >= 0),
  off_delay_sec     NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (off_delay_sec >= 0),
  priority          TEXT NOT NULL
                    CHECK (priority IN ('DIAGNOSTIC','LOW','MEDIUM','HIGH','URGENT')),
  alarm_class       TEXT NOT NULL
                    CHECK (alarm_class IN ('SAFETY','ENVIRONMENTAL','QUALITY',
                                           'PROCESS','EQUIPMENT','ENERGY')),
  message           TEXT NOT NULL,
  unit              TEXT NOT NULL DEFAULT '',
  consequence       TEXT NOT NULL,
  operator_response TEXT NOT NULL,
  response_time_sec INTEGER NOT NULL CHECK (response_time_sec > 0),
  max_shelve_sec    INTEGER NOT NULL DEFAULT 28800 CHECK (max_shelve_sec > 0),
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,

  -- Rang buoc nay lap lai kiem tra da co trong `AlarmDefinition.__post_init__`,
  -- va lap lai la co y: bang nay la cho ky su quy trinh sua bang tay bang SQL,
  -- khong phai chi qua ma nguon Python. Mot do tre 3 giay dat nham len E-Stop
  -- la ba giay nguoi van hanh khong biet may da dung.
  CONSTRAINT alarm_safety_khong_duoc_tre
    CHECK (alarm_class <> 'SAFETY' OR on_delay_sec = 0),
  -- Mot may + mot so do + mot muc so sanh = mot canh bao. Hai dinh nghia trung
  -- nhau nghia la mot su co keu hai lan, va do la cach nhanh nhat de tao ra
  -- alarm flood tu chinh file cau hinh.
  UNIQUE (asset_code, metric, comparison)
);


-- Sinh cau hinh tu chinh bang `asset`, khong go lai tay tung con so.
-- Nguong nam o ho so thiet bi; canh bao chi tro toi no. Go lai tay la tao ra
-- hai nguon su that roi cho chung lech nhau.

-- Nhiet do cao (HI) — muc canh bao som.
INSERT INTO alarm_definition (tag, asset_code, metric, comparison, setpoint, deadband,
       on_delay_sec, off_delay_sec, priority, alarm_class, message, unit,
       consequence, operator_response, response_time_sec, max_shelve_sec)
SELECT a.asset_code || '.TEMP.HI', a.asset_code, 'temperature', 'HI',
       a.warn_temp_c, 3.0,
       -- On-delay 6 giay: nhiet do la dai luong co quan tinh, mot xung 1.5 giay
       -- vuot nguong hau nhu luon la nhieu cua cam bien chu khong phai may
       -- nong len that.
       6, 10,
       'MEDIUM', 'PROCESS',
       a.name || ' — nhiet do vuot nguong canh bao',
       '°C',
       'Sai lech nhiet do keo chat luong moi han xuong; keo dai se sang muc HIHI va phai dung may.',
       'Kiem tra quat lam mat va tai cua may, giam toc do day neu can.',
       600, 28800
FROM asset a;

-- Nhiet do toi han (HIHI) — muc phai dung may.
INSERT INTO alarm_definition (tag, asset_code, metric, comparison, setpoint, deadband,
       on_delay_sec, off_delay_sec, priority, alarm_class, message, unit,
       consequence, operator_response, response_time_sec, max_shelve_sec)
SELECT a.asset_code || '.TEMP.HIHI', a.asset_code, 'temperature', 'HIHI',
       a.crit_temp_c, 5.0,
       -- Do tre bat/tat co y KHONG doi xung: muon biet that nhanh (2 giay),
       -- nhung khong muon no nhap nhay tat khi may dang nguoi cham (30 giay).
       2, 30,
       'HIGH', 'EQUIPMENT',
       a.name || ' — NHIET DO TOI HAN, nguy co hu hong',
       '°C',
       'Hong o truc/dong co hoac chay ban mach; dung ke hoach san xuat ca.',
       'Dung may, cat tai, goi bao tri co khi.',
       60,
       -- Canh bao muc HIGH chi duoc shelve toi da 1 gio.
       3600
FROM asset a;

-- Rung cao — dau hieu som cua hong vong bi.
INSERT INTO alarm_definition (tag, asset_code, metric, comparison, setpoint, deadband,
       on_delay_sec, off_delay_sec, priority, alarm_class, message, unit,
       consequence, operator_response, response_time_sec, max_shelve_sec)
SELECT a.asset_code || '.VIB.HI', a.asset_code, 'vibration', 'HI',
       a.warn_vibration_mm_s, 0.4,
       -- On-delay 10 giay, dai hon han nhiet do: rung la tin hieu xung. Mot xe
       -- nang di ngang qua cung lam kim nhay. Canh bao rung ma khong co do tre
       -- la nguon chattering kinh dien nhat trong mot nha may.
       10, 15,
       'MEDIUM', 'EQUIPMENT',
       a.name || ' — do rung vuot nguong',
       'mm/s',
       'Vong bi hoac can bang truc dang xuong cap; bo qua se dan toi ke hong dot ngot.',
       'Ghi nhan vao phieu bao tri, hen kiem tra vong bi trong ca ke tiep.',
       1800, 28800
FROM asset a;

-- Cong suat tieu thu cao — canh bao muc thap, thuoc nhom nang luong.
INSERT INTO alarm_definition (tag, asset_code, metric, comparison, setpoint, deadband,
       on_delay_sec, off_delay_sec, priority, alarm_class, message, unit,
       consequence, operator_response, response_time_sec, max_shelve_sec)
SELECT a.asset_code || '.PWR.HI', a.asset_code, 'power_kw', 'HI',
       round(a.nominal_power_kw * 1.25, 2), round(a.nominal_power_kw * 0.05, 2),
       30, 60,
       'LOW', 'ENERGY',
       a.name || ' — cong suat vuot 125% dinh muc',
       'kW',
       'Chi phi dien tang va co the la dau hieu ma sat co hoc; khong anh huong ngay toi san pham.',
       'Ghi nhan de doi chieu voi bao cao nang luong cuoi ca.',
       3600, 28800
FROM asset a;

-- E-Stop — canh bao an toan.
INSERT INTO alarm_definition (tag, asset_code, metric, comparison, setpoint, deadband,
       on_delay_sec, off_delay_sec, priority, alarm_class, message, unit,
       consequence, operator_response, response_time_sec, max_shelve_sec)
SELECT a.asset_code || '.ESTOP', a.asset_code, 'estop', 'BOOL',
       1, 0,
       -- Bang khong ca hai chieu. Canh bao an toan khong duoc tre khi bat (rang
       -- buoc CHECK o tren chan dieu do), va cung khong nen tre khi tat: trang
       -- thai E-Stop phai phan anh dung cai nut ngay lap tuc.
       0, 0,
       'URGENT', 'SAFETY',
       a.name || ' — DUNG KHAN CAP (E-Stop)',
       '',
       'Day chuyen dung; san pham dang tren bang co the phai loai.',
       'Xac dinh nguyen nhan dung, giai tru nguy hiem, nha nut va bam Start de khoi dong lai.',
       10,
       -- Canh bao an toan khong duoc phep shelve qua 5 phut. De 8 tieng nhu cac
       -- canh bao khac thi shelve tro thanh cach tat mot canh bao an toan ca ca.
       300
FROM asset a;


-- ---------------------------------------------------------------------------
-- 2. Nhat ky chuyen trang thai
--
-- Moi chi so hieu nang cua he canh bao deu tinh tu bang nay. Khong tinh tu
-- danh sach canh bao dang song: danh sach dang song khong nho gi ve cai vua
-- tat mot giay truoc, ma chattering thi chi nhin thay trong lich su.
--
-- Hai quyet dinh co ve thua nhung khong thua:
--
--   * `tag` KHONG co khoa ngoai toi `alarm_definition`. Ho so kiem toan phai
--     song sot khi mot canh bao bi go khoi cau hinh. Xoa dinh nghia ma keo
--     theo lich su thi dung cai lich su can nhat de giai trinh la cai bi mat.
--
--   * `priority`, `alarm_class`, `message` duoc CHEP vao day chu khong join
--     sang cau hinh. Lan sau ky su ha mot canh bao tu HIGH xuong LOW, lich su
--     van phai noi rang luc do no la HIGH — neu join, moi bieu do xu huong se
--     tu vie lai qua khu moi lan cau hinh doi.
--
-- Bang thuong chu khong phai hypertable, va khong co chinh sach xoa: telemetry
-- tho song 30 ngay vi no la mot day so lap lai, con nhat ky canh bao la ho so
-- van hanh. Hai loai du lieu, hai tuoi tho.
-- ---------------------------------------------------------------------------

-- `occurred_at` chu khong phai `at`, va `raw_condition` chu khong phai
-- `condition`: ca hai tu do la tu khoa trong SQL chuan va trong PL/pgSQL. Ky
-- thuat ma noi PostgreSQL van cho dung lam ten cot, nhung mot cai ten phai tra
-- cuu bang keyword-list moi biet co hop le hay khong la mot cai ten toi.
CREATE TABLE alarm_transition (
  id          BIGSERIAL PRIMARY KEY,
  tag         TEXT NOT NULL,
  asset_code  TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  from_state  TEXT NOT NULL,
  to_state    TEXT NOT NULL,
  cause       TEXT NOT NULL,
  priority    TEXT NOT NULL,
  alarm_class TEXT NOT NULL,
  message     TEXT NOT NULL,
  value       DOUBLE PRECISION,
  unit        TEXT NOT NULL DEFAULT '',
  operator    TEXT NOT NULL DEFAULT '',
  -- Ly do thao tac. Mot lan shelve khong ghi ly do chinh la dinh nghia cua
  -- "unauthorized alarm suppression" trong ISA-18.2 — va do la mot chi so phai
  -- dem duoc, nen ly do phai nam trong nhat ky chu khong chi trong bo nho.
  note        TEXT NOT NULL DEFAULT ''
);

CREATE INDEX alarm_transition_at_idx  ON alarm_transition (occurred_at DESC);
CREATE INDEX alarm_transition_tag_idx ON alarm_transition (tag, occurred_at DESC);
-- Phan lon chi so (ty le canh bao, alarm flood, bad actor, chattering) chi dem
-- nhung lan CHUYEN SANG UNACK_ALM — tuc la nhung lan canh bao thuc su keu len
-- truoc mat nguoi van hanh. Index rieng phan cho dung tap dong do.
CREATE INDEX alarm_transition_annunciation_idx
  ON alarm_transition (occurred_at DESC, tag)
  WHERE to_state = 'UNACK_ALM';


-- ---------------------------------------------------------------------------
-- 3. Trang thai song, de song sot qua khoi dong lai
--
-- Cung ly do voi `machine_shift_state`: mot canh bao chua ai xac nhan ma bien
-- mat sau lan deploy ke tiep la mot canh bao bi nuot. Nghiem trong hon nua la
-- shelving — neu han shelve mat khi restart, canh bao dang bi tat co chu dich
-- se keu lai giua ca ma khong ai hieu vi sao.
-- ---------------------------------------------------------------------------

CREATE TABLE alarm_state (
  tag           TEXT PRIMARY KEY REFERENCES alarm_definition(tag) ON DELETE CASCADE,
  state         TEXT NOT NULL,
  raw_condition BOOLEAN NOT NULL DEFAULT FALSE,
  active        BOOLEAN NOT NULL DEFAULT FALSE,
  raised_at     TIMESTAMPTZ,
  acked_at      TIMESTAMPTZ,
  rtn_at        TIMESTAMPTZ,
  shelved_until TIMESTAMPTZ,
  shelve_reason TEXT NOT NULL DEFAULT '',
  value         DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO alarm_state (tag, state)
SELECT tag, 'NORMAL' FROM alarm_definition;


-- ---------------------------------------------------------------------------
-- 4. View: mot lan canh bao keu, gom tu nhat ky
--
-- Nhat ky ghi tung chuyen trang thai; cau hoi thuong gap lai la "lan keu do
-- bat dau luc nao, ai xac nhan, bao lau moi het". `lead()` tren cung mot tag
-- gap hai cau hoi do lai lam mot dong.
-- ---------------------------------------------------------------------------

CREATE VIEW alarm_occurrence AS
WITH annunciation AS (
  SELECT id, tag, asset_code, occurred_at AS raised_at, priority, alarm_class,
         message, value, unit,
         lead(occurred_at) OVER (PARTITION BY tag ORDER BY occurred_at) AS next_at
  FROM alarm_transition
  WHERE to_state = 'UNACK_ALM'
)
SELECT
  a.id, a.tag, a.asset_code, a.raised_at, a.priority, a.alarm_class,
  a.message, a.value, a.unit,
  (SELECT min(t.occurred_at) FROM alarm_transition t
    WHERE t.tag = a.tag AND t.cause = 'ACK'
      AND t.occurred_at >= a.raised_at
      AND (a.next_at IS NULL OR t.occurred_at < a.next_at))     AS acked_at,
  (SELECT min(t.occurred_at) FROM alarm_transition t
    WHERE t.tag = a.tag AND t.cause = 'RTN'
      AND t.occurred_at >= a.raised_at
      AND (a.next_at IS NULL OR t.occurred_at < a.next_at))     AS rtn_at
FROM annunciation a;
