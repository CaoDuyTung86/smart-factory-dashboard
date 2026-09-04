"""
Mo hinh day chuyen phia server.

Cac test o day dung `random.Random(seed)` va moc thoi gian co dinh, nen ket qua
lap lai duoc — mot mo hinh co nhieu ngau nhien ma test khong tat duoc ngau
nhien thi test do khong khang dinh duoc gi.

Canh bao khong con duoc kiem thu o day. Tu khi `AlarmEngine` tach ra thanh mot
may trang thai rieng, `advance()` chi con lam mot viec la cho ra so do; toan bo
hanh vi canh bao nam o `test_alarms.py`. Nhung thu con lai o day la RANH GIOI
giua hai ben: mo hinh sinh so do, engine doc so do, va trang thai may KHONG
phu thuoc vao trang thai canh bao.
"""

import random

import pytest

from alarms import UNACK_ALM, AlarmDefinition, AlarmEngine
from line import PLC_DRIVEN_ASSET, LineModel, Machine, advance, density_factor, readings_of

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


def make_engine(asset: str = "SMT-LINE-01") -> AlarmEngine:
    """Hai canh bao du de kiem tra ranh gioi: mot analog, mot boolean."""
    return AlarmEngine(
        [
            AlarmDefinition(
                tag=f"{asset}.TEMP.HIHI",
                asset_code=asset,
                metric="temperature",
                comparison="HIHI",
                setpoint=88.0,
                deadband=5.0,
                on_delay_sec=0,
                off_delay_sec=0,
                priority="HIGH",
                alarm_class="EQUIPMENT",
                message="nhiet do toi han",
                unit="°C",
            ),
            AlarmDefinition(
                tag=f"{asset}.ESTOP",
                asset_code=asset,
                metric="estop",
                comparison="BOOL",
                setpoint=1,
                deadband=0,
                on_delay_sec=0,
                off_delay_sec=0,
                priority="URGENT",
                alarm_class="SAFETY",
                message="dung khan cap",
            ),
        ]
    )


def rng() -> random.Random:
    return random.Random(20260904)


# ---------------------------------------------------------------------- tick


def test_may_dung_cong_down_time_chu_khong_cong_run_time():
    """Day la loi de mac nhat va lam OEE sai han: may dung van dot thoi gian
    san xuat theo ke hoach, nhung khong duoc cong vao run time."""
    m = make_machine(status="error")
    after = advance(m, 1500, 1.0, "NORMAL", rng(), NOW)
    assert after.down_time_ms == m.down_time_ms + 1500
    assert after.run_time_ms == m.run_time_ms
    assert after.output == m.output


def test_may_chay_cong_run_time_va_lam_ra_san_pham():
    m = make_machine()
    after = advance(m, 1500, 1.0, "NORMAL", rng(), NOW)
    assert after.run_time_ms == m.run_time_ms + 1500
    assert after.output > m.output
    assert after.down_time_ms == m.down_time_ms


def test_san_luong_bam_theo_ideal_cycle_time():
    """1.5s / 0.4s = 3.75 chu ky, nhan hieu suat 0.86-0.98 -> 3 cai."""
    m = make_machine()
    after = advance(m, 1500, 1.0, "NORMAL", rng(), NOW)
    assert after.output - m.output == 3

    # Chu ky dai gap ba thi san luong xuong tuong ung.
    cham = make_machine(ideal_cycle_sec=1.2)
    after_cham = advance(cham, 1500, 1.0, "NORMAL", rng(), NOW)
    assert after_cham.output - cham.output == 1


def test_mat_do_cap_lieu_va_toc_do_day_nhan_vao_san_luong():
    m = make_machine()
    thap = advance(m, 1500, 1.0, "LOW", rng(), NOW)
    thuong = advance(m, 1500, 1.0, "NORMAL", rng(), NOW)
    cao = advance(m, 1500, 1.0, "HIGH", rng(), NOW)
    assert thap.output <= thuong.output <= cao.output
    assert density_factor("LOW") < density_factor("NORMAL") < density_factor("HIGH")


def test_nhiet_do_hoi_quy_ve_gia_tri_danh_dinh():
    """Nong bat thuong ma khong co nguyen nhan thi phai nguoi dan, khong troi."""
    m = make_machine(temperature=70.0, status="running")
    r = rng()
    for _ in range(30):
        m = advance(m, 1500, 1.0, "NORMAL", r, NOW)
    assert abs(m.temperature - 52.4) < 1.0


def test_cong_suat_bam_theo_tai_chu_khong_dung_yen():
    """Truoc day `power_usage` doc tu DB roi khong bao gio doi — mot so do cham
    chet, va mot canh bao dat tren no thi khong bao gio keu."""
    m = make_machine()
    r = rng()
    for _ in range(30):
        m = advance(m, 1500, 2.8, "HIGH", r, NOW)
    assert m.power_usage > m.nominal_power * 1.25

    cham = make_machine()
    for _ in range(30):
        cham = advance(cham, 1500, 0.5, "LOW", r, NOW)
    assert cham.power_usage < cham.nominal_power


# ------------------------------------------------- ranh gioi voi he canh bao


def test_trang_thai_may_do_dieu_kien_qua_trinh_chu_khong_do_canh_bao():
    """Canh bao khong phai interlock.

    Canh bao nhiet do co off-delay de chong nhap nhay; neu trang thai may bam
    theo trang thai canh bao thi do tre do se bien thanh "sua xong roi ma may
    khong chiu chay lai". O day may quay ve 'running' ngay khi so do binh
    thuong, con canh bao thi van con tren man hinh cho nguoi xac nhan.
    """
    line = LineModel(machines=[make_machine()], engine=make_engine(), rng=rng())
    line.trigger_fault("SMT-LINE-01", "overheat")
    line.tick(now_ms=NOW)
    assert line.machine("SMT-LINE-01").status == "error"
    assert line.engine.runtime["SMT-LINE-01.TEMP.HIHI"].state == UNACK_ALM

    line.repair("SMT-LINE-01")
    line.tick(now_ms=NOW + 1500)
    assert line.machine("SMT-LINE-01").status == "running"
    # May da chay lai, nhung canh bao van con — chi la da tro ve binh thuong va
    # dang cho xac nhan.
    assert line.engine.runtime["SMT-LINE-01.TEMP.HIHI"].state == "RTN_UNACK"


def test_advance_khong_con_sinh_canh_bao():
    """Tach mo hinh khoi he canh bao: `advance` chi cho ra so do.

    Truoc day chinh ham nay quyet dinh canh bao nao duoc keu, va do la ly do
    nguong tung nam rai rac trong than ham duoi dang `temp > 75`.
    """
    nong = make_machine(temperature=80.0, nominal_temp=80.0, warn_temp=75.0)
    after = advance(nong, 1500, 1.0, "NORMAL", rng(), NOW)
    assert isinstance(after, Machine)
    # Nong thi may chuyen sang warning, nhung khong co canh bao nao sinh ra o day.
    assert after.status == "warning"


def test_readings_dung_dung_ten_metric_cua_historian():
    """Mot ten so do di suot tu mo hinh qua canh bao xuong bieu do lich su."""
    readings = readings_of([make_machine()])
    assert set(readings) == {
        ("SMT-LINE-01", "temperature"),
        ("SMT-LINE-01", "vibration"),
        ("SMT-LINE-01", "power_kw"),
        ("SMT-LINE-01", "estop"),
    }
    assert readings[("SMT-LINE-01", "estop")] == 0.0


def test_tick_tra_ve_chuyen_trang_thai_de_tang_tren_ghi_nhat_ky():
    """`line.py` khong biet gi ve DB: no tra ve, tang tren ghi."""
    line = LineModel(machines=[make_machine()], engine=make_engine(), rng=rng())
    assert line.tick(now_ms=NOW) == []

    line.trigger_fault("SMT-LINE-01", "emergency_stop")
    transitions = line.tick(now_ms=NOW + 1500)
    assert [t.tag for t in transitions] == ["SMT-LINE-01.ESTOP"]
    assert transitions[0].to_state == UNACK_ALM


# ------------------------------------------------------------------- dieu khien


def test_trigger_fault_phai_vuot_nguong_chu_khong_bang_nguong():
    """`value > setpoint` — dat dung bang nguong toi han thi canh bao khong keu,
    va do la mot loi off-by-one im lang."""
    line = LineModel(machines=[make_machine(crit_temp=88.0)], engine=make_engine(), rng=rng())
    assert line.trigger_fault("SMT-LINE-01", "overheat")
    m = line.machine("SMT-LINE-01")
    assert m.status == "error"
    assert m.temperature > 88.0

    line.tick(now_ms=NOW)
    assert line.engine.runtime["SMT-LINE-01.TEMP.HIHI"].state == UNACK_ALM


def test_trigger_fault_may_khong_ton_tai_thi_bao_that_bai():
    line = LineModel(machines=[make_machine()], engine=make_engine(), rng=rng())
    assert line.trigger_fault("KHONG-CO-MAY-NAY", "overheat") is False


def test_estop_la_bien_qua_trinh_chu_khong_phai_canh_bao():
    """Nut E-Stop la mot dau vao vat ly. Canh bao E-Stop la thu DOC bien do."""
    line = LineModel(machines=[make_machine()], engine=make_engine(), rng=rng())
    line.trigger_fault("SMT-LINE-01", "emergency_stop")
    assert line.machine("SMT-LINE-01").estop is True

    line.repair("SMT-LINE-01")
    assert line.machine("SMT-LINE-01").estop is False


def test_repair_khong_tu_y_xac_nhan_canh_bao():
    """Sua may la mot hanh dong vat ly; xac nhan la mot hanh dong cua nguoi van
    hanh. Gop hai viec lam mot thi RTN_UNACK khong con ly do ton tai."""
    line = LineModel(machines=[make_machine()], engine=make_engine(), rng=rng())
    line.trigger_fault("SMT-LINE-01", "emergency_stop")
    line.tick(now_ms=NOW)

    assert line.repair("SMT-LINE-01")
    ngay_sau_khi_sua = line.machine("SMT-LINE-01")
    assert ngay_sau_khi_sua.status == "running"
    assert ngay_sau_khi_sua.temperature == ngay_sau_khi_sua.nominal_temp
    assert ngay_sau_khi_sua.vibration == ngay_sau_khi_sua.nominal_vibration

    line.tick(now_ms=NOW + 1500)
    canh_bao = line.payload(NOW + 1500)["alarms"]
    assert [a["state"] for a in canh_bao] == ["RTN_UNACK"]


def test_worst_priority_bo_qua_canh_bao_da_tro_ve_binh_thuong():
    """RTN_UNACK nghia la dieu kien da het. To do mot may da binh thuong tro
    lai la noi sai tinh trang day chuyen."""
    line = LineModel(machines=[make_machine()], engine=make_engine(), rng=rng())
    line.trigger_fault("SMT-LINE-01", "emergency_stop")
    line.tick(now_ms=NOW)
    assert line.worst_priority("SMT-LINE-01") == "URGENT"

    line.repair("SMT-LINE-01")
    line.tick(now_ms=NOW + 1500)
    assert line.worst_priority("SMT-LINE-01") is None


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
    after = advance(m, 1500, 1.0, "NORMAL", rng(), NOW, plc_produced=7)
    assert after.output - m.output == 7
    assert after.count_source == "plc"

    mo_hinh = advance(m, 1500, 1.0, "NORMAL", rng(), NOW)
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
    line = LineModel(machines=[make_machine()], engine=make_engine(), rng=rng())
    payload = line.payload(NOW)
    assert set(payload) == {
        "machines",
        "alarms",
        "inhibitedAlarms",
        "alarmCounts",
        "oee",
        "lineSpeed",
        "feedDensity",
    }
    machine = payload["machines"][0]
    for key in ("idealCycleSec", "runTimeMs", "downTimeMs", "targetOutput",
                "powerUsage", "lastUpdated", "countSource", "estop"):
        assert key in machine


def test_danh_sach_canh_bao_bi_tat_di_kem_trong_cung_goi_tin():
    """Da tat mot canh bao thi phai nhin thay no o cho khac. Neu danh sach do
    nam o mot endpoint rieng ai nho thi goi, thi thuc te la khong ai goi."""
    line = LineModel(machines=[make_machine()], engine=make_engine(), rng=rng())
    line.shelve("SMT-LINE-01.TEMP.HIHI", 600, reason="doi thay cam bien", now_ms=NOW)

    payload = line.payload(NOW)
    assert [a["tag"] for a in payload["inhibitedAlarms"]] == ["SMT-LINE-01.TEMP.HIHI"]
    assert payload["inhibitedAlarms"][0]["shelveReason"] == "doi thay cam bien"
    assert payload["alarmCounts"]["SHELVED"] == 1
