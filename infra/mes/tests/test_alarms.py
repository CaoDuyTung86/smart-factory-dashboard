"""
May trang thai canh bao ISA-18.2.

Moi test o day di qua thoi gian bang tham so `now` chu khong bang `sleep`, nen
mot canh bao co on-delay 10 giay duoc kiem tra trong 0 giay. Do la ly do
`AlarmEngine` khong bao gio tu doc dong ho he thong.

Bo test nay la ban dac ta chinh thuc cua hanh vi. `src/features/factory/lib/
isa18.ts` la ban cai dat thu hai cua cung may trang thai va phai cho ket qua
giong het tren cung nhung tinh huong nay.
"""

import pytest

from alarms import (
    ACKED_ALM,
    NORMAL,
    OUT_OF_SERVICE,
    RTN_UNACK,
    SHELVED,
    SUPPRESSED,
    UNACK_ALM,
    AlarmDefinition,
    AlarmEngine,
    restore,
)

TAG = "SMT-LINE-01.TEMP.HI"
ASSET = "SMT-LINE-01"


def make_def(**overrides) -> AlarmDefinition:
    base = dict(
        tag=TAG,
        asset_code=ASSET,
        metric="temperature",
        comparison="HI",
        setpoint=75.0,
        deadband=3.0,
        on_delay_sec=0.0,
        off_delay_sec=0.0,
        priority="MEDIUM",
        alarm_class="PROCESS",
        message="nhiet do vuot nguong",
        unit="°C",
        consequence="chat luong moi han giam",
        operator_response="kiem tra quat lam mat",
        response_time_sec=600,
    )
    base.update(overrides)
    return AlarmDefinition(**base)


def engine_with(**overrides) -> AlarmEngine:
    return AlarmEngine([make_def(**overrides)])


def temp(value: float) -> dict:
    return {(ASSET, "temperature"): value}


def state(engine: AlarmEngine, tag: str = TAG) -> str:
    return engine.runtime[tag].state


# ---------------------------------------------------------------------------
# Vong doi co ban
# ---------------------------------------------------------------------------


def test_vuot_nguong_thi_sang_unack():
    e = engine_with()
    tx = e.evaluate(0, temp(80))
    assert [t.to_state for t in tx] == [UNACK_ALM]
    assert tx[0].cause == "ALARM"
    assert tx[0].from_state == NORMAL


def test_xac_nhan_roi_ve_binh_thuong_thi_ve_normal():
    """Duong di day du: NORMAL -> UNACK_ALM -> ACKED_ALM -> NORMAL."""
    e = engine_with()
    e.evaluate(0, temp(80))
    assert e.acknowledge(TAG, 1).to_state == ACKED_ALM

    # 70 nam duoi setpoint - deadband (75 - 3 = 72) nen dieu kien het han.
    e.evaluate(2, temp(70))
    assert state(e) == NORMAL


def test_tu_het_truoc_khi_ai_xac_nhan_thi_vao_rtn_unack():
    """Trang thai ma mot he canh bao chi co co boolean se lam mat han.

    Su co xay ra roi tu het trong 3 giay. Neu khong co RTN_UNACK thi khong con
    dau vet nao tren man hinh, va dung loai su co thoang qua nay moi la loai
    hay lap lai — no se quay lai vao ca dem khi khong ai ngoi day.
    """
    e = engine_with()
    e.evaluate(0, temp(80))
    e.evaluate(3, temp(70))
    assert state(e) == RTN_UNACK

    assert e.acknowledge(TAG, 4).to_state == NORMAL
    assert state(e) == NORMAL


def test_dang_o_rtn_unack_ma_su_co_quay_lai_thi_keu_lai():
    e = engine_with()
    e.evaluate(0, temp(80))
    e.evaluate(1, temp(70))
    assert state(e) == RTN_UNACK

    tx = e.evaluate(2, temp(80))
    assert [t.cause for t in tx] == ["RE_ALARM"]
    assert state(e) == UNACK_ALM


def test_xac_nhan_khi_khong_co_gi_dang_keu_thi_khong_lam_gi():
    e = engine_with()
    assert e.acknowledge(TAG, 0) is None
    assert e.acknowledge("TAG-KHONG-TON-TAI", 0) is None


def test_khong_phat_lai_khi_dieu_kien_van_dang_dung():
    """Mot su co dang keu khong duoc bien thanh 40 dong nhat ky moi phut."""
    e = engine_with()
    e.evaluate(0, temp(80))
    for t in range(1, 40):
        assert e.evaluate(t, temp(80)) == []


# ---------------------------------------------------------------------------
# Deadband
# ---------------------------------------------------------------------------


def test_deadband_chi_noi_rong_phia_tat():
    """Bat tai dung setpoint, tat tai setpoint - deadband.

    Neu ap deadband ca hai phia (bat tai 78) thi ky su dat nguong 75 se khong
    bao gio duoc bao o 75 — va do la lam sai chinh cai con so ho vua chon.
    """
    e = engine_with(setpoint=75.0, deadband=3.0)
    assert e.evaluate(0, temp(75.5)) != []  # vua vuot 75 la keu ngay
    assert state(e) == UNACK_ALM

    e.acknowledge(TAG, 1)
    e.evaluate(2, temp(73.0))  # nam trong dai deadband -> van con keu
    assert state(e) == ACKED_ALM

    e.evaluate(3, temp(71.9))  # duoi 72 -> moi tat
    assert state(e) == NORMAL


def test_deadband_chan_nhap_nhay_ngay_tai_nguong():
    """Dao dong +-1 do quanh setpoint. Khong co deadband thi day la 20 canh bao."""
    e = engine_with(deadband=3.0)
    e.evaluate(0, temp(75.5))
    e.acknowledge(TAG, 0)

    lan_keu = 0
    for i in range(20):
        gia_tri = 75.5 if i % 2 == 0 else 74.5
        for tx in e.evaluate(i + 1, temp(gia_tri)):
            if tx.to_state == UNACK_ALM:
                lan_keu += 1
    assert lan_keu == 0

    khong_deadband = engine_with(deadband=0.0)
    khong_deadband.evaluate(0, temp(75.5))
    khong_deadband.acknowledge(TAG, 0)
    lan_keu_2 = 0
    for i in range(20):
        gia_tri = 75.5 if i % 2 == 0 else 74.5
        for tx in khong_deadband.evaluate(i + 1, temp(gia_tri)):
            if tx.to_state == UNACK_ALM:
                lan_keu_2 += 1
    assert lan_keu_2 == 9


def test_canh_bao_lo_ap_deadband_nguoc_chieu():
    e = engine_with(comparison="LO", setpoint=10.0, deadband=2.0)
    assert e.evaluate(0, temp(9.5)) != []
    e.acknowledge(TAG, 0)
    e.evaluate(1, temp(11.0))  # trong dai deadband (10 + 2)
    assert state(e) == ACKED_ALM
    e.evaluate(2, temp(12.5))
    assert state(e) == NORMAL


# ---------------------------------------------------------------------------
# Do tre
# ---------------------------------------------------------------------------


def test_on_delay_nuot_xung_thoang_qua():
    """Xung 1 giay tren mot canh bao co on-delay 10 giay: khong keu.

    Deadband bao nhieu cung khong chan duoc tinh huong nay — gia tri vot len
    gap doi nguong roi ve ngay. Hai bien phap chua hai benh khac nhau.
    """
    e = engine_with(on_delay_sec=10.0)
    assert e.evaluate(0, temp(200)) == []
    assert e.evaluate(1, temp(50)) == []
    assert state(e) == NORMAL
    assert e.runtime[TAG].pending_since is None


def test_on_delay_van_keu_khi_dieu_kien_keo_dai():
    e = engine_with(on_delay_sec=10.0)
    e.evaluate(0, temp(80))
    assert e.evaluate(9.9, temp(80)) == []
    assert e.evaluate(10, temp(80)) != []
    assert state(e) == UNACK_ALM


def test_on_delay_dem_lai_tu_dau_sau_moi_lan_gian_doan():
    """9 giay xau, 1 giay tot, 9 giay xau: khong dat 10 giay lien tuc."""
    e = engine_with(on_delay_sec=10.0)
    e.evaluate(0, temp(80))
    e.evaluate(9, temp(80))
    e.evaluate(9.5, temp(50))
    e.evaluate(18, temp(80))
    assert state(e) == NORMAL
    # Bo dem tinh lai tu moc 18 giay chu khong cong don voi 9 giay truoc do,
    # nen phai doi den giay thu 28 canh bao moi keu.
    assert e.evaluate(27.9, temp(80)) == []
    assert e.evaluate(28, temp(80)) != []


def test_off_delay_giu_canh_bao_qua_mot_lan_tut_ngan():
    e = engine_with(off_delay_sec=15.0)
    e.evaluate(0, temp(80))
    e.acknowledge(TAG, 0)
    e.evaluate(5, temp(50))
    assert state(e) == ACKED_ALM  # chua du 15 giay
    e.evaluate(10, temp(80))  # xau tro lai -> bo dem tat huy bo
    e.evaluate(20, temp(50))
    assert state(e) == ACKED_ALM
    e.evaluate(35, temp(50))
    assert state(e) == NORMAL


def test_canh_bao_an_toan_khong_duoc_phep_co_on_delay():
    """Chan ngay o kieu du lieu, khong doi den luc chay.

    Rang buoc nay duoc lap lai o CHECK cua bang `alarm_definition`: bang do la
    cho ky su quy trinh sua bang tay bang SQL, khong phai chi qua Python.
    """
    with pytest.raises(ValueError, match="SAFETY"):
        make_def(alarm_class="SAFETY", on_delay_sec=3.0)

    # Khong co on-delay thi hop le.
    make_def(alarm_class="SAFETY", on_delay_sec=0.0)


@pytest.mark.parametrize(
    "field,value,loi",
    [
        ("comparison", "GREATER_THAN", "comparison"),
        ("priority", "SUPER_URGENT", "priority"),
        ("deadband", -1.0, "deadband"),
    ],
)
def test_cau_hinh_sai_bi_chan_ngay_khi_dung(field, value, loi):
    with pytest.raises(ValueError, match=loi):
        make_def(**{field: value})


# ---------------------------------------------------------------------------
# Shelving
# ---------------------------------------------------------------------------


def test_shelve_go_khoi_man_hinh_nhung_van_nam_o_danh_sach_rieng():
    e = engine_with()
    e.evaluate(0, temp(80))
    tx = e.shelve(TAG, 10, 3600, reason="cho thay cam bien", operator="op1")
    assert tx.to_state == SHELVED
    assert tx.note == "cho thay cam bien"

    assert e.summary(10) == []
    inhibited = e.inhibited(10)
    assert [r["tag"] for r in inhibited] == [TAG]
    assert inhibited[0]["shelveReason"] == "cho thay cam bien"


def test_shelve_khong_annunciate_du_dieu_kien_van_xau():
    e = engine_with()
    e.shelve(TAG, 0, 3600)
    for t in range(1, 20):
        assert e.evaluate(t, temp(200)) == []
    assert state(e) == SHELVED


def test_shelve_tu_het_han_va_keu_lai_neu_van_con_xau():
    """Shelve vinh vien la cach mot canh bao bi tat roi khong ai nho bat lai."""
    e = engine_with()
    e.shelve(TAG, 0, 600)
    e.evaluate(300, temp(200))
    assert state(e) == SHELVED

    tx = e.evaluate(600, temp(200))
    assert [t.cause for t in tx] == ["SHELVE_EXPIRED"]
    assert state(e) == UNACK_ALM


def test_het_shelve_ma_moi_thu_da_tot_thi_ve_normal_khong_keu():
    e = engine_with()
    e.shelve(TAG, 0, 600)
    e.evaluate(700, temp(50))
    assert state(e) == NORMAL


def test_bat_lai_thu_cong_thi_canh_bao_keu_lai_va_lai_la_chua_xac_nhan():
    """Khong duoc cho no ve thang NORMAL chi vi truoc do da co nguoi bam xac
    nhan — do la giau mot su co dang dien ra."""
    e = engine_with()
    e.evaluate(0, temp(80))
    e.acknowledge(TAG, 1)
    e.shelve(TAG, 2, 3600)

    e.evaluate(3, temp(80))
    tx = e.unshelve(TAG, 4, operator="op1")
    assert tx.to_state == UNACK_ALM
    assert tx.cause == "UNSHELVE"


def test_han_shelve_bi_kep_boi_cau_hinh_cua_chinh_canh_bao():
    """Canh bao an toan khong duoc phep tat ca ca."""
    e = engine_with(alarm_class="SAFETY", on_delay_sec=0, max_shelve_sec=300)
    e.shelve(TAG, 0, 8 * 3600)
    assert e.runtime[TAG].shelved_until == 300


def test_khong_shelve_duoc_cai_dang_out_of_service():
    e = engine_with()
    e.out_of_service(TAG, 0)
    assert e.shelve(TAG, 1, 600) is None
    assert e.shelve("TAG-KHONG-TON-TAI", 1, 600) is None


def test_shelve_khong_duong_thi_bo_qua():
    e = engine_with()
    assert e.shelve(TAG, 0, 0) is None
    assert state(e) == NORMAL


# ---------------------------------------------------------------------------
# Suppression va out-of-service — ba duong khac nhau toi cung mot su im lang
# ---------------------------------------------------------------------------


def test_suppress_va_out_of_service_la_hai_trang_thai_khac_nhau():
    """Gop ba khai niem lam mot la mat kha nang tra loi cau hoi 'ai da tat cai
    nay va theo tham quyen nao'."""
    e = AlarmEngine([make_def(), make_def(tag="B", metric="vibration")])
    e.suppress(TAG, 0, operator="logic")
    e.out_of_service("B", 0, operator="bao-tri")

    counts = e.state_counts()
    assert counts[SUPPRESSED] == 1
    assert counts[OUT_OF_SERVICE] == 1
    assert e.summary(0) == []
    assert len(e.inhibited(0)) == 2


def test_vao_lai_service_thi_danh_gia_lai_tu_dau():
    e = engine_with()
    e.out_of_service(TAG, 0)
    e.evaluate(1, temp(200))
    assert state(e) == OUT_OF_SERVICE

    tx = e.in_service(TAG, 2, operator="bao-tri")
    assert tx.to_state == UNACK_ALM
    assert tx.cause == "IN_SERVICE"


def test_khong_lam_gi_khi_thao_tac_sai_trang_thai():
    e = engine_with()
    assert e.unshelve(TAG, 0) is None
    assert e.unsuppress(TAG, 0) is None
    assert e.in_service(TAG, 0) is None
    e.suppress(TAG, 0)
    assert e.suppress(TAG, 1) is None
    assert e.unsuppress(TAG, 2).to_state == NORMAL


# ---------------------------------------------------------------------------
# Man hinh nguoi van hanh
# ---------------------------------------------------------------------------


def test_summary_sap_theo_uu_tien_truoc_roi_moi_theo_thoi_gian():
    """Khi 20 canh bao ap den cung luc, de thu tu thoi gian quyet dinh cai nguy
    hiem nhat nam o dau la chuyen may rui."""
    e = AlarmEngine(
        [
            make_def(tag="THAP", metric="a", priority="LOW"),
            make_def(tag="CAO", metric="b", priority="URGENT", alarm_class="EQUIPMENT"),
            make_def(tag="VUA", metric="c", priority="MEDIUM"),
        ]
    )
    e.evaluate(0, {(ASSET, "a"): 80})
    e.evaluate(1, {(ASSET, "b"): 80})
    e.evaluate(2, {(ASSET, "c"): 80})

    assert [r["tag"] for r in e.summary(3)] == ["CAO", "VUA", "THAP"]


def test_chattering_dem_theo_dinh_nghia_cua_tieu_chuan():
    """Tu 3 lan keu trong mot phut."""
    e = engine_with()
    for i in range(2):
        e.evaluate(i * 2, temp(80))
        e.evaluate(i * 2 + 1, temp(50))
        e.acknowledge(TAG, i * 2 + 1)
    e.evaluate(4, temp(80))
    assert e.summary(5)[0]["chattering"] is True


def test_khong_bao_chattering_khi_thua_thot():
    e = engine_with()
    for i in range(5):
        e.evaluate(i * 600, temp(80))
        e.evaluate(i * 600 + 1, temp(50))
        e.acknowledge(TAG, i * 600 + 1)
    e.evaluate(3000, temp(80))
    assert e.summary(3001)[0]["chattering"] is False


def test_stale_khi_keu_lien_tuc_qua_24_gio():
    e = engine_with()
    e.evaluate(0, temp(80))
    assert e.summary(23 * 3600)[0]["stale"] is False
    assert e.summary(25 * 3600)[0]["stale"] is True


def test_mat_so_do_thi_giu_nguyen_trang_thai_chu_khong_tu_tat():
    """Mat cam bien khong phai bang chung rang moi thu da binh thuong tro lai."""
    e = engine_with()
    e.evaluate(0, temp(80))
    assert e.evaluate(1, {}) == []
    assert state(e) == UNACK_ALM


def test_canh_bao_bi_tat_trong_cau_hinh_thi_khong_danh_gia():
    e = engine_with(enabled=False)
    assert e.evaluate(0, temp(500)) == []
    assert state(e) == NORMAL


def test_bang_rationalization_lo_ra_ca_can_cu_ton_tai():
    """Cau hoi 'vi sao cai nay keu va toi phai lam gi' phai tra loi duoc tren
    man hinh, khong phai bang cach mo ma nguon."""
    rows = engine_with().definition_rows()
    assert rows[0]["consequence"]
    assert rows[0]["operatorResponse"]
    assert rows[0]["responseTimeSec"] == 600


# ---------------------------------------------------------------------------
# Xac nhan hang loat
# ---------------------------------------------------------------------------


def test_xac_nhan_theo_may_chi_dong_toi_may_do():
    e = AlarmEngine(
        [
            make_def(tag="A1", asset_code="MAY-1", metric="a"),
            make_def(tag="A2", asset_code="MAY-1", metric="b"),
            make_def(tag="B1", asset_code="MAY-2", metric="a"),
        ]
    )
    e.evaluate(0, {("MAY-1", "a"): 80, ("MAY-1", "b"): 80, ("MAY-2", "a"): 80})
    tx = e.acknowledge_asset("MAY-1", 1, operator="op1")
    assert sorted(t.tag for t in tx) == ["A1", "A2"]
    assert state(e, "B1") == UNACK_ALM
    assert all(t.operator == "op1" for t in tx)


def test_xac_nhan_tat_ca():
    e = AlarmEngine([make_def(tag="A", metric="a"), make_def(tag="B", metric="b")])
    e.evaluate(0, {(ASSET, "a"): 80, (ASSET, "b"): 80})
    assert len(e.acknowledge_all(1)) == 2
    assert e.acknowledge_all(2) == []


# ---------------------------------------------------------------------------
# Song sot qua khoi dong lai
# ---------------------------------------------------------------------------


def test_nap_lai_trang_thai_sau_khi_khoi_dong_lai():
    """Canh bao chua ai xac nhan ma bien mat sau lan deploy ke tiep la mot canh
    bao bi nuot."""
    e = engine_with()
    restore(
        e,
        {
            TAG: {
                "state": UNACK_ALM,
                "condition": True,
                "active": True,
                "raised_at": 100.0,
                "acked_at": None,
                "rtn_at": None,
                "shelved_until": None,
                "shelve_reason": "",
                "value": 82.5,
            }
        },
    )
    assert state(e) == UNACK_ALM
    assert e.summary(200)[0]["value"] == 82.5
    # Khong bi keu lai lan nua chi vi vua khoi dong lai.
    assert e.evaluate(201, temp(80)) == []


def test_han_shelve_song_sot_qua_khoi_dong_lai():
    """Neu han shelve mat khi restart, canh bao dang bi tat co chu dich se keu
    lai giua ca ma khong ai hieu vi sao."""
    e = engine_with()
    restore(e, {TAG: {"state": SHELVED, "active": True, "shelved_until": 500.0}})
    assert e.evaluate(400, temp(80)) == []
    assert [t.cause for t in e.evaluate(500, temp(80))] == ["SHELVE_EXPIRED"]


def test_bo_qua_trang_thai_cua_canh_bao_da_bi_go_khoi_cau_hinh():
    e = engine_with()
    restore(e, {"TAG-DA-XOA": {"state": UNACK_ALM}})
    assert "TAG-DA-XOA" not in e.runtime


def test_trang_thai_la_khong_hop_le_thi_ve_normal():
    e = engine_with()
    restore(e, {TAG: {"state": "TRANG_THAI_KHONG_CO_THAT"}})
    assert state(e) == NORMAL
