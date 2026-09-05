-- ---------------------------------------------------------------------------
-- First-out va cause-and-effect
--
-- Khi mot day chuyen do, canh bao khong den mot cai. Chung den thanh chum, va
-- cau hoi duy nhat dang gia luc do khong phai "dang co gi keu" (man hinh da
-- day roi) ma la "cai NAO keu TRUOC". Bang dieu khien lo hoi va tua-bin co
-- mach first-out chot rieng canh bao dau tien tu nhung nam 1960 chinh vi ly do
-- nay.
--
-- Hai thu duoc them o day, va chung tra loi hai cau khac nhau:
--
--   * `alarm_transition.on_delay_sec` — de suy nguoc ra thoi diem DIEU KIEN
--     bat dau, chu khong phai thoi diem canh bao KEU LEN.
--   * `alarm_causal_link` — tri thuc ky thuat ve cai gi gay ra cai gi. Thu tu
--     thoi gian khong bao gio chung minh duoc nhan qua; no chi xep hang ung
--     vien.
--
-- File nay viet idempotent (IF NOT EXISTS) de dung duoc ca cho volume moi lan
-- volume da co san. Cac file 01-05 khong nhu vay, va do la mot bai hoc cua dot
-- 8: doi schema thi tinh huong hay gap la "DB con nguyen schema cu", khong
-- phai "DB trong".
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Do tre bat, chep vao tung dong nhat ky
--
-- Vi sao phai chep chu khong join sang `alarm_definition`: cung ly do da chep
-- `priority` va `message`. Ky su doi on-delay tu 6 giay xuong 2 giay thi moi
-- ket luan first-out da rut ra trong qua khu phai giu nguyen — neu join, lich
-- su tu viet lai moi lan cau hinh doi.
--
-- Vi sao CAN no: thu tu canh bao KEU LEN khong phai thu tu su co XAY RA. Do
-- tre bat lam dao lon thu tu, va dao lon mot cach co he thong chu khong ngau
-- nhien. Vi du that do chinh he thong nay sinh ra:
--
--     06:51:17  REFLOW-OVEN-02.TEMP.HIHI  -> UNACK_ALM   (on-delay 2s)
--     06:51:20  REFLOW-OVEN-02.TEMP.HI    -> UNACK_ALM   (on-delay 6s)
--
-- HIHI keu truoc HI ba giay, trong khi ve vat ly nhiet do bat buoc phai vuot
-- nguong canh bao truoc roi moi toi nguong toi han. Doc theo thu tu keu thi
-- first-out la HIHI — sai thu pham. Tru do tre ra thi onset cua HI la 06:51:14
-- va cua HIHI la 06:51:15, dung lai thu tu vat ly.
-- ---------------------------------------------------------------------------

ALTER TABLE alarm_transition
  ADD COLUMN IF NOT EXISTS on_delay_sec NUMERIC(6,2) NOT NULL DEFAULT 0;


-- ---------------------------------------------------------------------------
-- 2. Ma tran cause-and-effect
--
-- Day la tri thuc ky thuat khai bao bang tay, khong phai thu suy ra tu du
-- lieu. Suy nhan qua tu do tuong quan thoi gian la sai lam kinh dien: hai su
-- co doc lap xay ra cach nhau mot giay se cho ra mot "chuoi nhan qua" hoan
-- toan bia dat. Thu tu thoi gian chi dung de LOAI TRU (hau qua khong the xay
-- ra truoc nguyen nhan), khong dung de CHUNG MINH.
--
-- Bang nay co dung bon dong, va nen ngan nhu vay. Trong mo hinh day chuyen
-- hien tai chi co DUNG MOT quan he nhan qua that giua hai canh bao: nguong
-- phan tang HI -> HIHI tren cung mot so do. Nhiet do va cong suat cung tang
-- khi day toc do len, nhung do la HAI HAU QUA CUA MOT NGUYEN NHAN CHUNG chu
-- khong phai cai nay gay ra cai kia — khai bao TEMP.HI -> PWR.HI se la mot
-- dong sai, va mot ma tran C&E sai con te hon khong co ma tran nao. Truong hop
-- nguyen nhan chung duoc xu ly o tang phan tich (`first_out.py`), khong phai
-- bang cach bia them dong o day.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS alarm_causal_link (
  cause_tag           TEXT NOT NULL,
  effect_tag          TEXT NOT NULL,
  -- Qua moc nay thi khong con ghep doi duoc nua. Mot canh bao keu sau nguyen
  -- nhan nua tieng khong phai hau qua cua no, du ma tran co noi gi.
  max_propagation_sec INTEGER NOT NULL CHECK (max_propagation_sec > 0),
  mechanism           TEXT NOT NULL
                      CHECK (mechanism IN ('THRESHOLD_TIER','PROCESS','EQUIPMENT')),
  note                TEXT NOT NULL,

  PRIMARY KEY (cause_tag, effect_tag),
  -- Mot canh bao khong the tu gay ra chinh no.
  CONSTRAINT canh_bao_khong_tu_gay_ra_minh CHECK (cause_tag <> effect_tag)
);

-- Khong co khoa ngoai sang `alarm_definition`, cung ly do voi
-- `alarm_transition.tag`: ma tran C&E la tai lieu ky thuat, phai doc duoc ca
-- khi mot canh bao da bi go khoi cau hinh.

INSERT INTO alarm_causal_link (cause_tag, effect_tag, max_propagation_sec, mechanism, note)
SELECT a.asset_code || '.TEMP.HI',
       a.asset_code || '.TEMP.HIHI',
       -- 10 phut: du cho mot lan troi nhiet cham tu nguong canh bao len nguong
       -- toi han, va van du ngan de khong ghep nham hai su co roi rac trong ca.
       600,
       'THRESHOLD_TIER',
       'Nguong toi han cao hon nguong canh bao, nen nhiet do bat buoc phai vuot HI truoc khi toi HIHI. '
       || 'Day la rang buoc cua chinh cap nguong, khong phai mot gia thiet ve qua trinh.'
FROM asset a
ON CONFLICT (cause_tag, effect_tag) DO NOTHING;


CREATE INDEX IF NOT EXISTS alarm_causal_link_effect_idx
  ON alarm_causal_link (effect_tag);
