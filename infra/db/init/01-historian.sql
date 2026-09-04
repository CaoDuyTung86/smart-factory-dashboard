-- ---------------------------------------------------------------------------
-- Historian: TimescaleDB luu telemetry cua day chuyen
--
-- Vi sao khong dung bang Postgres thuong? Telemetry la du lieu chi ghi them,
-- truy van gan nhu luon co dieu kien thoi gian, va lon rat nhanh: 5 tag x 4
-- may x 1 diem/1.5s = ~800k dong/ngay. TimescaleDB chia bang thanh chunk theo
-- thoi gian, nen xoa du lieu cu la drop chunk chu khong phai DELETE quet ca
-- bang, va nen ra duoc dia bang cot voi ty le ~10-20 lan.
--
-- Mo hinh dai (long/EAV) chu khong phai mot cot cho moi tag: them mot cam bien
-- moi thi chi la them dong, khong phai ALTER TABLE tren bang vai tram trieu
-- dong. Day la cach moi historian cong nghiep (PI System, Ignition, InfluxDB)
-- to chuc du lieu.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE telemetry (
  ts         TIMESTAMPTZ      NOT NULL,
  asset_code TEXT             NOT NULL,
  metric     TEXT             NOT NULL,
  value      DOUBLE PRECISION NOT NULL,
  -- 'quality' theo tinh than OPC UA StatusCode: mot gia tri doc duoc luc mat
  -- ket noi PLC khong duoc phep lan vao thong ke nhu mot gia tri tot.
  quality    SMALLINT         NOT NULL DEFAULT 192  -- 192 = GOOD (OPC DA)
);

-- Co y KHONG dat khoa ngoai tu asset_code sang bang `asset`. Historian nhan
-- tag tu moi thu co the do duoc — bang tai, may nen khi, dong ho dien, cam
-- bien moi truong — chu khong chi tu bon may co tinh OEE. Bat buoc khai bao
-- truoc moi duoc ghi la cach chac chan de mat du lieu cua mot thiet bi vua
-- duoc lap them.

-- chunk 1 ngay: du nho de drop/nen theo tung ngay, du lon de mot truy van
-- "24 gio qua" khong phai mo hang chuc chunk.
SELECT create_hypertable('telemetry', by_range('ts', INTERVAL '1 day'));

-- Truy van luon la "mot tag, mot khoang thoi gian" -> index phai bat dau bang
-- (asset_code, metric) roi moi den ts. Index mac dinh chi tren ts la khong du.
CREATE INDEX telemetry_asset_metric_ts_idx
  ON telemetry (asset_code, metric, ts DESC);


-- ---------------------------------------------------------------------------
-- Continuous aggregate 1 phut
--
-- Bieu do 8 gio ma doc thang bang goc la ~19.000 diem cho mot tag — trinh
-- duyet khong ve noi va cung khong can ve. Continuous aggregate la
-- materialized view tu cap nhat: TimescaleDB chi tinh lai nhung bucket co du
-- lieu moi, khong tinh lai ca lich su.
--
-- Giu ca min/max chu khong chi avg: trung binh 1 phut lam bien mat dung cai
-- gai nhon can nhin thay. Bieu do downsample dung thi phai ve duoc dai
-- min-max, neu khong la noi doi ve du lieu.
-- ---------------------------------------------------------------------------

CREATE MATERIALIZED VIEW telemetry_1m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket(INTERVAL '1 minute', ts) AS bucket,
  asset_code,
  metric,
  avg(value)   AS avg_value,
  min(value)   AS min_value,
  max(value)   AS max_value,
  last(value, ts) AS last_value,
  count(*)     AS sample_count
FROM telemetry
WHERE quality = 192
GROUP BY bucket, asset_code, metric
WITH NO DATA;

-- start_offset 3 gio: du de bat du lieu den muon (gateway store-and-forward,
-- dong ho lech gio). end_offset 1 phut: khong materialize bucket dang con
-- chay do, neu khong bucket do se bi dong bang khi moi co vai mau.
SELECT add_continuous_aggregate_policy('telemetry_1m',
  start_offset      => INTERVAL '3 hours',
  end_offset        => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute');


-- ---------------------------------------------------------------------------
-- Continuous aggregate 1 gio — xay tu cai 1 phut (hierarchical cagg)
--
-- Cong lai tu 1 phut chu khong quet lai bang goc: re hon 60 lan.
--
-- CANH BAO nghiep vu: trung binh cua trung binh la SAI khi cac bucket con co
-- so mau khac nhau. Mat ket noi PLC 40 giay thi bucket phut do chi con 13 mau
-- thay vi 40; avg(avg_value) van tinh no ngang mot phut day du. Vi vay cagg
-- nay luu tong co trong so, con view ben duoi moi chia ra trung binh dung.
-- ---------------------------------------------------------------------------

CREATE MATERIALIZED VIEW telemetry_1h_acc
WITH (timescaledb.continuous) AS
SELECT
  time_bucket(INTERVAL '1 hour', bucket) AS bucket,
  asset_code,
  metric,
  sum(avg_value * sample_count) AS weighted_sum,
  sum(sample_count)             AS sample_count,
  min(min_value)                AS min_value,
  max(max_value)                AS max_value
FROM telemetry_1m
GROUP BY 1, 2, 3
WITH NO DATA;

SELECT add_continuous_aggregate_policy('telemetry_1h_acc',
  start_offset      => INTERVAL '1 day',
  end_offset        => INTERVAL '1 hour',
  schedule_interval => INTERVAL '30 minutes');

-- View thuong boc ngoai: nguoi doc query chi thay avg_value, khong phai tu
-- nho chia tong co trong so.
CREATE VIEW telemetry_1h AS
SELECT
  bucket,
  asset_code,
  metric,
  weighted_sum / NULLIF(sample_count, 0) AS avg_value,
  min_value,
  max_value,
  sample_count
FROM telemetry_1h_acc;


-- ---------------------------------------------------------------------------
-- Chinh sach vong doi du lieu
--
-- Day la thu phan biet mot historian that voi mot bang log: du lieu tho song
-- ngan, du lieu tong hop song lau. Khong ai can biet nhiet do luc 14:32:07
-- cua thang truoc, nhung xu huong nhiet do theo gio cua ca nam thi co.
-- ---------------------------------------------------------------------------

-- Nen sau 7 ngay. segmentby theo (asset_code, metric) de mot truy van mot tag
-- chi giai nen dung nhung segment cua tag do.
ALTER TABLE telemetry SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'asset_code, metric',
  timescaledb.compress_orderby   = 'ts DESC'
);
SELECT add_compression_policy('telemetry', INTERVAL '7 days');

-- Xoa du lieu tho sau 30 ngay — la DROP CHUNK, khong phai DELETE.
SELECT add_retention_policy('telemetry', INTERVAL '30 days');

-- Cagg 1 phut giu 1 nam, cagg 1 gio giu 5 nam. Retention cua bang goc KHONG
-- keo theo cagg: day chinh la ly do tach ra ba tang.
SELECT add_retention_policy('telemetry_1m',     INTERVAL '1 year');
SELECT add_retention_policy('telemetry_1h_acc', INTERVAL '5 years');
