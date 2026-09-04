"""
OEE: doi chieu voi cung mot vi du mau ma ban TypeScript dung.

`src/features/factory/lib/oee.test.ts` ghim ban trong trinh duyet vao bo so
duoi day; file nay ghim ban backend vao dung bo so do. Hai ban cai dat phai ra
cung mot ket qua, neu khong thi cau "SCADA doc tu backend van hien dung con so
nhu truoc" chi la noi mieng.
"""

from dataclasses import dataclass

import pytest

from oee import compute_oee, round1

HOUR_MS = 3_600_000


@dataclass
class M:
    output: int
    defects: int
    ideal_cycle_sec: float
    run_time_ms: float
    down_time_ms: float


def shift() -> M:
    """Vi du mau kinh dien, mot ca mot may.

    Ca 8 gio tru 30 phut nghi theo lich -> 420 phut planned production time
    47 phut dung ngoai ke hoach                -> 373 phut run time
    Ideal cycle 1.0s, 19.271 cai, 423 phe
    Dap an cong bo: A 88.8% / P 86.1% / Q 97.8% / OEE 74.8%.

    Chu y thu KHONG co trong con so: 30 phut nghi theo lich khong he di vao
    planned production time. Cong no vao se bao ~83% availability cho cung mot
    ca — cach pho bien nhat de thoi phong mot chi so OEE.
    """
    return M(
        output=19_271,
        defects=423,
        ideal_cycle_sec=1.0,
        run_time_ms=373 * 60_000,
        down_time_ms=47 * 60_000,
    )


def test_tai_lap_dung_vi_du_mau():
    oee = compute_oee([shift()])
    assert oee.availability == 88.8
    assert oee.performance == 86.1
    assert oee.quality == 97.8
    assert oee.overall == 74.8


def test_nhan_ba_he_so_chu_khong_lay_trung_binh():
    oee = compute_oee([shift()])
    trung_binh = (oee.availability + oee.performance + oee.quality) / 3
    # Trung binh cong cua 88.8 / 86.1 / 97.8 la 90.9%, khong phai 74.8%.
    assert round1(trung_binh) == 90.9
    assert oee.overall < trung_binh - 15


def test_thoi_gian_dung_tinh_vao_availability_chu_khong_phai_quality():
    oee = compute_oee(
        [M(output=100, defects=0, ideal_cycle_sec=1.0, run_time_ms=9 * HOUR_MS, down_time_ms=HOUR_MS)]
    )
    assert oee.availability == 90.0
    assert oee.quality == 100.0


def test_performance_la_ty_so_thoi_gian_ly_thuyet_tren_thoi_gian_chay():
    # 1.800 cai x 2s ly thuyet = 1 gio cong viec, lam trong 2 gio chay.
    oee = compute_oee(
        [M(output=1800, defects=0, ideal_cycle_sec=2.0, run_time_ms=2 * HOUR_MS, down_time_ms=0)]
    )
    assert oee.performance == 50.0


def test_performance_bi_chan_o_100():
    # Gap doi so cai ma chu ky ly thuyet cho phep: chu ky ghi trong danh muc
    # sai. Bao 200% se am tham day OEE vuot 100%.
    oee = compute_oee(
        [M(output=7200, defects=0, ideal_cycle_sec=1.0, run_time_ms=HOUR_MS, down_time_ms=0)]
    )
    assert oee.performance == 100.0


def test_quality_tinh_tren_hang_tot_nen_hang_sua_lai_van_ton():
    oee = compute_oee(
        [M(output=1000, defects=25, ideal_cycle_sec=1.0, run_time_ms=HOUR_MS, down_time_ms=0)]
    )
    assert oee.quality == 97.5


def test_gop_ca_day_chuyen_truoc_khi_chia():
    nhanh = M(output=28_800, defects=0, ideal_cycle_sec=1.0, run_time_ms=8 * HOUR_MS, down_time_ms=0)
    dung = M(output=0, defects=0, ideal_cycle_sec=1.0, run_time_ms=0, down_time_ms=8 * HOUR_MS)
    oee = compute_oee([nhanh, dung])
    # 8 gio chay tren 16 gio ke hoach: mot may chet lam doi availability ca day.
    assert oee.availability == 50.0
    # May dung khong gop run time nen khong the keo Performance xuong.
    assert oee.performance == 100.0


def test_chua_co_gio_nao_thi_tra_ve_0_chu_khong_phai_NaN():
    oee = compute_oee([M(output=0, defects=0, ideal_cycle_sec=1.0, run_time_ms=0, down_time_ms=0)])
    assert (oee.availability, oee.performance, oee.overall) == (0.0, 0.0, 0.0)
    assert oee.quality == 100.0


def test_day_chuyen_rong():
    oee = compute_oee([])
    assert oee.payload() == {
        "availability": 0.0,
        "performance": 0.0,
        "quality": 100.0,
        "overall": 0.0,
    }


@pytest.mark.parametrize(
    "value,expected",
    [
        # round() cua Python lam tron ve so chan va cho 0.2 — day chinh la cho
        # hai ban cai dat se lech nhau neu khong co round1().
        (0.25, 0.3),
        (88.75, 88.8),
        (2.5, 2.5),
        (74.7499, 74.7),
        (99.95, 100.0),
    ],
)
def test_lam_tron_giong_toFixed_cua_javascript(value, expected):
    assert round1(value) == expected
