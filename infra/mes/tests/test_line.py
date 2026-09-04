"""
Mo hinh day chuyen phia server.

Cac test o day dung `random.Random(seed)` va moc thoi gian co dinh, nen ket qua
lap lai duoc — mot mo hinh co nhieu ngau nhien ma test khong tat duoc ngau
nhien thi test do khong khang dinh duoc gi.
"""

import random

import pytest

from line import PLC_DRIVEN_ASSET, LineModel, Machine, advance, density_factor

NOW = 1_760_000_000_000


def make_machine(**overrides) -> Machine:
    base = dict(
        id="SMT-LINE-01",
        name="SMT Pick & Place",
        code="SMT-LINE-01",
        category="Assembly",
        status="running",
        temperature=52.4,
        vibration=1.2,
        output=1000,
        defects=10,
        power_usage=18.5,
        target_output=15000,
        ideal_cycle_sec=0.4,
        run_time_ms=400_000,
        down_time_ms=20_000,
        last_updated=NOW,
        nominal_temp=52.4,
        nominal_vibration=1.2,
        nominal_power=18.5,
        warn_temp=75.0,
        crit_temp=88.0,
        warn_vibration=4.0,
    )
    base.update(overrides)
    return Machine(**base)


def rng() -> random.Random:
    return random.Random(20260904)


# ---------------------------------------------------------------------- tick


def test_may_dung_cong_down_time_chu_khong_cong_run_time():
    """Day la loi de mac nhat va lam OEE sai han: may dung van dot thoi gian
    san xuat theo ke hoach, nhung khong duoc cong vao run time."""
    m = make_machine(status="error")
    after, _ = advance(m, 1500, 1.0, "NORMAL", rng(), NOW)
    assert after.down_time_ms == m.down_time_ms + 1500
    assert after.run_time_ms == m.run_time_ms
    assert after.output == m.output


def test_may_chay_cong_run_time_va_lam_ra_san_pham():
    m = make_machine()
    after, _ = advance(m, 1500, 1.0, "NORMAL", rng(), NOW)
    assert after.run_time_ms == m.run_time_ms + 1500
    assert after.output > m.output
    assert after.down_time_ms == m.down_time_ms


def test_san_luong_bam_theo_ideal_cycle_time():
    """1.5s / 0.4s = 3.75 chu ky, nhan hieu suat 0.86-0.98 -> 3 cai."""
    m = make_machine()
    after, _ = advance(m, 1500, 1.0, "NORMAL", rng(), NOW)
    assert after.output - m.output == 3

    # Chu ky dai gap ba thi san luong xuong tuong ung.
    cham = make_machine(ideal_cycle_sec=1.2)
    after_cham, _ = advance(cham, 1500, 1.0, "NORMAL", rng(), NOW)
    assert after_cham.output - cham.output == 1


def test_mat_do_cap_lieu_va_toc_do_day_nhan_vao_san_luong():
    m = make_machine()
    thap, _ = advance(m, 1500, 1.0, "LOW", rng(), NOW)
    thuong, _ = advance(m, 1500, 1.0, "NORMAL", rng(), NOW)
    cao, _ = advance(m, 1500, 1.0, "HIGH", rng(), NOW)
    assert thap.output <= thuong.output <= cao.output
    assert density_factor("LOW") < density_factor("NORMAL") < density_factor("HIGH")


def test_nhiet_do_hoi_quy_ve_gia_tri_danh_dinh():
    """Nong bat thuong ma khong co nguyen nhan thi phai nguoi dan, khong troi."""
    m = make_machine(temperature=70.0, status="running")
    r = rng()
    for _ in range(30):
        m, _ = advance(m, 1500, 1.0, "NORMAL", r, NOW)
    assert abs(m.temperature - 52.4) < 1.0


# -------------------------------------------------------------------- alarms


def test_vuot_nguong_nhiet_cua_chinh_may_thi_bao_canh_bao():
    """Nguong lay tu bang `asset`, khong phai hang so trong code: lo reflow
    chay 245C binh thuong, may gan linh kien 245C la chay."""
    nong = make_machine(temperature=80.0, nominal_temp=80.0, warn_temp=75.0)
    _, alarms = advance(nong, 1500, 1.0, "NORMAL", rng(), NOW)
    assert len(alarms) == 1
    assert alarms[0][0] == "warning"

    lo_reflow = make_machine(
        id="REFLOW-OVEN-02", temperature=245.0, nominal_temp=245.0, warn_temp=262.0
    )
    _, khong_alarm = advance(lo_reflow, 1500, 1.0, "NORMAL", rng(), NOW)
    assert khong_alarm == []


def test_tra_ve_binh_thuong_co_do_tre_de_chong_nhap_nhay():
    """Ngay tai nguong, mot dao dong 0.1 do se lam canh bao bat/tat lien tuc.
    Chi tra ve 'running' khi da nguoi duoi nguong 3 do."""
    sat_nguong = make_machine(status="warning", temperature=74.0, nominal_temp=74.0, warn_temp=75.0)
    after, _ = advance(sat_nguong, 1500, 1.0, "NORMAL", rng(), NOW)
    assert after.status == "warning"

    da_nguoi = make_machine(status="warning", temperature=60.0, nominal_temp=60.0, warn_temp=75.0)
    after2, _ = advance(da_nguoi, 1500, 1.0, "NORMAL", rng(), NOW)
    assert after2.status == "running"


def test_khong_phat_lai_canh_bao_khi_chua_ai_xac_nhan():
    """Chong chattering: mot may + mot muc do = mot canh bao chua xac nhan."""
    line = LineModel(machines=[make_machine(temperature=80.0, nominal_temp=80.0)], rng=rng())
    for _ in range(10):
        line.tick(now_ms=NOW)
    assert len(line.alarms) == 1

    line.acknowledge(line.alarms[0].id)
    line.tick(now_ms=NOW)
    assert len(line.alarms) == 2


def test_danh_sach_canh_bao_co_tran():
    line = LineModel(
        machines=[make_machine(id=f"M-{i}", code=f"M-{i}", temperature=80.0, nominal_temp=80.0) for i in range(30)],
        rng=rng(),
    )
    line.tick(now_ms=NOW)
    assert len(line.alarms) == 15


# ------------------------------------------------------------------- dieu khien


def test_trigger_fault_dung_nguong_toi_han_cua_may():
    line = LineModel(machines=[make_machine(crit_temp=88.0)], rng=rng())
    assert line.trigger_fault("SMT-LINE-01", "overheat")
    m = line.machine("SMT-LINE-01")
    assert m.status == "error"
    assert m.temperature == 88.0
    assert line.alarms[0].severity == "critical"


def test_trigger_fault_may_khong_ton_tai_thi_bao_that_bai():
    line = LineModel(machines=[make_machine()], rng=rng())
    assert line.trigger_fault("KHONG-CO-MAY-NAY", "overheat") is False


def test_repair_dua_ve_danh_dinh_va_xac_nhan_canh_bao():
    line = LineModel(machines=[make_machine()], rng=rng())
    line.trigger_fault("SMT-LINE-01", "vibration")
    assert line.machine("SMT-LINE-01").status == "error"

    assert line.repair("SMT-LINE-01")
    m = line.machine("SMT-LINE-01")
    assert m.status == "running"
    assert m.temperature == m.nominal_temp
    assert m.vibration == m.nominal_vibration
    assert all(a.acknowledged for a in line.alarms)


@pytest.mark.parametrize("speed,expected", [(0.1, 0.5), (1.34, 1.3), (9.0, 3.0)])
def test_toc_do_day_bi_kep_trong_khoang_hop_le(speed, expected):
    line = LineModel(machines=[make_machine()], rng=rng())
    line.set_line_speed(speed)
    assert line.line_speed == expected


def test_mat_do_cap_lieu_khong_hop_le_thi_giu_nguyen():
    line = LineModel(machines=[make_machine()], rng=rng())
    line.set_feed_density("TURBO")
    assert line.feed_density == "NORMAL"


# ------------------------------------------------------------ bo dem cua PLC


def test_bo_dem_plc_thay_the_so_lieu_mo_hinh_va_duoc_danh_dau_nguon():
    """So do duoc luon thang so suy ra — nhung phai noi ro tren payload la no
    den tu dau, neu khong nguoi xem se tuong ca 4 may deu co cam bien that."""
    m = make_machine()
    after, _ = advance(m, 1500, 1.0, "NORMAL", rng(), NOW, plc_produced=7)
    assert after.output - m.output == 7
    assert after.count_source == "plc"

    mo_hinh, _ = advance(m, 1500, 1.0, "NORMAL", rng(), NOW)
    assert mo_hinh.count_source == "model"


def test_chi_tram_co_plc_moi_lay_bo_dem_that():
    khac = make_machine(id="CNC-MILL-03", code="CNC-MILL-03", ideal_cycle_sec=1.2)
    line = LineModel(machines=[make_machine(), khac], rng=rng())
    line.tick(now_ms=NOW, plc_produced=7)

    assert line.machine(PLC_DRIVEN_ASSET).count_source == "plc"
    assert line.machine("CNC-MILL-03").count_source == "model"


def test_oee_gop_tu_moi_may():
    line = LineModel(
        machines=[
            make_machine(output=19_271, defects=423, ideal_cycle_sec=1.0,
                         run_time_ms=373 * 60_000, down_time_ms=47 * 60_000)
        ],
        rng=rng(),
    )
    assert line.oee().overall == 74.8


def test_payload_dung_ten_truong_theo_kieu_camelCase_cua_frontend():
    line = LineModel(machines=[make_machine()], rng=rng())
    payload = line.payload()
    assert set(payload) == {"machines", "alarms", "oee", "lineSpeed", "feedDensity"}
    machine = payload["machines"][0]
    for key in ("idealCycleSec", "runTimeMs", "downTimeMs", "targetOutput",
                "powerUsage", "lastUpdated", "countSource"):
        assert key in machine
