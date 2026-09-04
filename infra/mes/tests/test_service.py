"""
Lop dich vu: dung machine tu bang `asset`, chuyen kieu ra JSON, va cach doc bo
dem cua PLC that.
"""

from datetime import datetime, timezone
from decimal import Decimal

from service import Runtime, build_machines, json_safe

ROW = {
    "asset_code": "SMT-LINE-01",
    "name": "SMT Pick & Place",
    "category": "Assembly",
    "ideal_cycle_sec": Decimal("0.400"),
    "target_output": 15000,
    "nominal_temp_c": Decimal("52.40"),
    "nominal_vibration_mm_s": Decimal("1.200"),
    "nominal_power_kw": Decimal("18.50"),
    "warn_temp_c": Decimal("75.00"),
    "crit_temp_c": Decimal("88.00"),
    "warn_vibration_mm_s": Decimal("4.000"),
    "status": "running",
    "temperature_c": Decimal("52.40"),
    "vibration": Decimal("1.200"),
    "power_kw": Decimal("18.50"),
    "output": 14250,
    "defects": 28,
    "run_time_ms": 6195652,
    "down_time_ms": 402717,
}


def test_dung_machine_tu_dong_asset():
    """Danh sach may den tu DB chu khong tu hang so trong ma nguon; NUMERIC cua
    Postgres phai thanh float, neu khong moi phep tinh OEE se bat sang Decimal
    va no ra TypeError khi gap float."""
    m = build_machines([ROW])[0]
    assert m.id == "SMT-LINE-01"
    assert m.code == m.id
    assert isinstance(m.ideal_cycle_sec, float)
    assert isinstance(m.nominal_temp, float)
    assert m.warn_temp == 75.0
    assert m.crit_temp == 88.0
    assert m.output == 14250


def test_json_safe_doi_datetime_va_decimal():
    value = {
        "ts": datetime(2026, 9, 4, 7, 30, tzinfo=timezone.utc),
        "qty": Decimal("0.4200"),
        "rows": [{"n": Decimal("3")}],
        "text": "{khong phai json}",
    }
    out = json_safe(value)
    assert out["ts"] == "2026-09-04T07:30:00+00:00"
    assert out["qty"] == 0.42
    assert out["rows"][0]["n"] == 3.0
    # Chuoi van la chuoi: khong doan xem chuoi nao la JSON.
    assert out["text"] == "{khong phai json}"


# --------------------------------------------------------- bo dem cua PLC


def test_plc_chua_ket_noi_thi_khong_ap_so_lieu_that():
    rt = Runtime()
    assert rt.take_plc_delta() is None


def test_lan_doc_dau_tien_chi_lay_moc_chu_khong_cong_ca_bo_dem():
    """Bo dem PLC dang o 5.000 khong co nghia la vua san xuat 5.000 cai trong
    1.5 giay vua roi."""
    rt = Runtime()
    rt.plc_connected = True
    rt.plc_part_count = 5000
    assert rt.take_plc_delta() == 0

    rt.plc_part_count = 5003
    assert rt.take_plc_delta() == 3


def test_bo_dem_tran_16_bit_khong_thanh_san_luong_am():
    """65535 -> 0 la tran thanh ghi, khong phai san xuat am 65.535 cai."""
    rt = Runtime()
    rt.plc_connected = True
    rt.plc_part_count = 65535
    rt.take_plc_delta()

    rt.plc_part_count = 2
    assert rt.take_plc_delta() == 0
    # Sau khi lay lai moc thi dem tiep binh thuong.
    rt.plc_part_count = 5
    assert rt.take_plc_delta() == 3


def test_plc_roi_mang_thi_lay_lai_moc_khi_ket_noi_lai():
    """Mat ket noi 10 phut roi noi lai: bo dem da nhay len vai nghin. Cong ca
    khoang do vao san luong cua mot tick la sai — trong 10 phut do may van
    chay, chi la ta khong nhin thay."""
    rt = Runtime()
    rt.plc_connected = True
    rt.plc_part_count = 100
    rt.take_plc_delta()
    rt.plc_part_count = 105
    assert rt.take_plc_delta() == 5

    rt.plc_connected = False
    assert rt.take_plc_delta() is None

    rt.plc_connected = True
    rt.plc_part_count = 4000
    assert rt.take_plc_delta() == 0
    rt.plc_part_count = 4002
    assert rt.take_plc_delta() == 2
