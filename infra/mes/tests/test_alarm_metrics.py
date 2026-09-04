"""
Chi so hieu nang he canh bao — ISA-18.2 dieu 16 / EEMUA 191.

Phan tinh toan tach khoi phan truy van chinh la de kiem thu duoc o day bang
vai dong so, khong can dung mot TimescaleDB len.
"""

from alarm_metrics import FLOOD_THRESHOLD_PER_BUCKET, summarise


def call(**overrides) -> dict:
    base = dict(
        window_hours=1,
        bucket_counts=[0] * 6,
        priority_counts={},
        bad_actors=[],
        chattering=[],
        stale=[],
        ack_seconds=[],
        shelves=0,
        shelves_without_reason=0,
    )
    base.update(overrides)
    return summarise(**base)


def verdict(result: dict, key: str) -> dict:
    return next(v for v in result["verdicts"] if v["key"] == key)


# ---------------------------------------------------------------------------
# Ty le canh bao
# ---------------------------------------------------------------------------


def test_mau_so_la_toan_bo_thoi_gian_chu_khong_chi_luc_co_canh_bao():
    """Bo cac khoang 10 phut khong co canh bao ra khoi mau so la cach de nhat
    de mot he thong dang ngoi tren mot tran canh bao van bao cao dep.

    6 canh bao trong mot khoang, 5 khoang con lai im lang: ty le that la 1.0
    tren moi 10 phut, khong phai 6.0.
    """
    r = call(bucket_counts=[6, 0, 0, 0, 0, 0])
    assert r["rate"]["perTenMinAvg"] == 1.0
    assert r["rate"]["perTenMinPeak"] == 6


def test_duoi_mot_canh_bao_moi_muoi_phut_thi_dat():
    r = call(bucket_counts=[1, 0, 1, 0, 0, 0])
    assert verdict(r, "rate")["status"] == "ok"


def test_tren_hai_canh_bao_moi_muoi_phut_la_khong_quan_ly_noi():
    r = call(bucket_counts=[5, 5, 5, 5, 5, 5])
    assert r["rate"]["perTenMinAvg"] == 5.0
    assert verdict(r, "rate")["status"] == "bad"


def test_khoang_giua_hai_nguong_thi_canh_bao_chu_khong_phai_hong():
    r = call(bucket_counts=[2, 1, 1, 2, 1, 2])
    assert verdict(r, "rate")["status"] == "warn"


# ---------------------------------------------------------------------------
# Alarm flood
# ---------------------------------------------------------------------------


def test_flood_dem_khoang_co_tren_muoi_canh_bao():
    r = call(bucket_counts=[FLOOD_THRESHOLD_PER_BUCKET, 11, 0, 0, 0, 0])
    # Dung 10 thi chua phai flood; 11 moi la.
    assert r["rate"]["floodPeriods"] == 1
    assert r["rate"]["floodPct"] == round(100 / 6, 2)
    assert verdict(r, "flood")["status"] == "bad"


def test_khong_co_flood_thi_dat():
    r = call(bucket_counts=[1, 2, 0, 1, 0, 0])
    assert r["rate"]["floodPeriods"] == 0
    assert verdict(r, "flood")["status"] == "ok"


# ---------------------------------------------------------------------------
# Bad actor
# ---------------------------------------------------------------------------


def test_top_muoi_tag_chiem_phan_lon_tai_la_khong_dat():
    """Tap trung cao co nghia la sua vai tag la giam duoc phan lon tai — nen no
    la mot phat hien, khong phai mot loi khen."""
    r = call(
        bucket_counts=[80, 20, 0, 0, 0, 0],
        bad_actors=[{"tag": "A", "count": 80}, {"tag": "B", "count": 15}],
    )
    assert r["badActors"][0]["pct"] == 80.0
    assert r["topTenPct"] == 95.0
    assert verdict(r, "topTen")["status"] == "bad"


def test_tai_canh_bao_trai_deu_thi_dat():
    r = call(
        bucket_counts=[100] + [0] * 5,
        bad_actors=[{"tag": f"T{i}", "count": 2} for i in range(10)],
    )
    assert r["topTenPct"] == 20.0


# ---------------------------------------------------------------------------
# Phan bo uu tien
# ---------------------------------------------------------------------------


def test_phan_bo_uu_tien_doi_chieu_voi_chi_tieu_80_15_5():
    r = call(priority_counts={"LOW": 80, "MEDIUM": 15, "HIGH": 5})
    by_priority = {d["priority"]: d for d in r["priorityDistribution"]}
    assert by_priority["LOW"]["pct"] == 80.0
    assert by_priority["LOW"]["targetPct"] == 80.0
    assert by_priority["HIGH"]["pct"] == 5.0
    # Muc chua tung keu van phai xuat hien trong bang, voi 0%.
    assert by_priority["URGENT"]["count"] == 0


def test_khong_co_canh_bao_nao_thi_khong_chia_cho_khong():
    r = call()
    assert all(d["pct"] == 0.0 for d in r["priorityDistribution"])
    assert r["topTenPct"] == 0.0


# ---------------------------------------------------------------------------
# Chattering, stale, shelve
# ---------------------------------------------------------------------------


def test_chi_tieu_chattering_la_khong_co_cai_nao():
    assert verdict(call(), "chattering")["status"] == "ok"
    r = call(chattering=[{"tag": "A", "maxPerMinute": 7}])
    assert verdict(r, "chattering")["status"] == "warn"
    nhieu = call(chattering=[{"tag": f"T{i}"} for i in range(5)])
    assert verdict(nhieu, "chattering")["status"] == "bad"


def test_shelve_khong_ghi_ly_do_la_suppression_khong_duoc_phep():
    """ISA-18.2 doi shelving phai la mot quy trinh co kiem soat. Mot lan shelve
    khong ghi ly do chinh la dinh nghia cua unauthorized suppression — nen chi
    tieu la khong co cai nao, khong co vung 'chap nhan duoc'."""
    assert verdict(call(shelves=4), "unauthorisedSuppression")["status"] == "ok"
    r = call(shelves=4, shelves_without_reason=1)
    assert verdict(r, "unauthorisedSuppression")["status"] == "bad"


def test_stale_duoi_nam_cai_thi_van_dat():
    assert verdict(call(stale=[{"tag": "A"}] * 4), "stale")["status"] == "ok"
    assert verdict(call(stale=[{"tag": "A"}] * 8), "stale")["status"] == "warn"


# ---------------------------------------------------------------------------
# Thoi gian phan ung
# ---------------------------------------------------------------------------


def test_chua_ai_xac_nhan_thi_tra_none_chu_khong_tra_khong():
    """'Chua ai xac nhan canh bao nao' va 'moi nguoi xac nhan tuc thi trong 0
    giay' la hai tinh huong nguoc han nhau."""
    r = call()
    assert r["ackResponse"]["medianSec"] is None
    assert r["ackResponse"]["count"] == 0


def test_trung_vi_va_p90_thoi_gian_xac_nhan():
    r = call(ack_seconds=[10, 20, 30, 40, 50])
    assert r["ackResponse"]["medianSec"] == 30.0
    assert r["ackResponse"]["p90Sec"] == 46.0
    assert r["ackResponse"]["count"] == 5


def test_mot_so_lieu_duy_nhat_van_ra_ket_qua():
    r = call(ack_seconds=[12.5])
    assert r["ackResponse"]["medianSec"] == 12.5
    assert r["ackResponse"]["p90Sec"] == 12.5


# ---------------------------------------------------------------------------
# Xep loai chung
# ---------------------------------------------------------------------------


def test_mot_o_do_la_ca_bang_do():
    """Bang KPI phai noi that ke ca khi chinh he thong nay truot chi tieu. Mot
    bang toan xanh voi mot o do van la mot he canh bao co van de."""
    assert call()["overall"] == "ok"
    assert call(chattering=[{"tag": "A"}])["overall"] == "warn"
    assert call(shelves_without_reason=1)["overall"] == "bad"
