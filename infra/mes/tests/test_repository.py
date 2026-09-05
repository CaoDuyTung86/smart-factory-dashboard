"""
Kiem schema truoc khi khoi dong.

Khong can DB that: cai dang duoc kiem la chinh sach — bang nao la bat buoc, va
cau bao loi co noi ro phai lam gi khong — chu khong phai cu phap SQL. Phan SQL
da duoc doi chieu tay voi TimescaleDB that o dot 8.
"""

import asyncio

from repository import REQUIRED_TABLES, missing_tables


class FakePool:
    """Pool gia: tra ve dung nhung bang duoc khai la dang co trong DB."""

    def __init__(self, existing: set[str]) -> None:
        self.existing = existing
        self.asked: list = []

    def acquire(self):
        pool = self

        class _Ctx:
            async def __aenter__(self):
                return pool

            async def __aexit__(self, *_):
                return False

        return _Ctx()

    async def fetch(self, _sql, names):
        self.asked.append(list(names))
        return [{"tablename": n} for n in names if n in self.existing]


def test_schema_du_thi_khong_thieu_gi():
    pool = FakePool(set(REQUIRED_TABLES))
    assert asyncio.run(missing_tables(pool)) == []


def test_volume_cu_thieu_dung_ba_bang_canh_bao():
    """Tinh huong that sau dot 7: nguoi da chay stack tu truoc co mot volume
    con nguyen schema cu. `db/init/` chi chay khi volume rong nen khong tu vao,
    va truoc day loi hien ra la mot traceback asyncpg ket thuc bang
    `UndefinedTableError` — dung ve ky thuat, khong noi duoc phai lam gi."""
    volume_cu = set(REQUIRED_TABLES) - {
        "alarm_definition",
        "alarm_transition",
        "alarm_state",
    }
    assert asyncio.run(missing_tables(FakePool(volume_cu))) == [
        "alarm_definition",
        "alarm_transition",
        "alarm_state",
    ]


def test_giu_nguyen_thu_tu_khai_bao_chu_khong_theo_thu_tu_DB_tra_ve():
    """Danh sach thieu di thang vao cau bao loi cho nguoi doc, nen thu tu phai
    on dinh: cung mot su co phai cho ra cung mot cau chu, khong doi theo thu tu
    Postgres tinh co tra ve."""
    pool = FakePool(set())
    assert asyncio.run(missing_tables(pool)) == list(REQUIRED_TABLES)


def test_ba_bang_canh_bao_deu_la_bat_buoc():
    """`REQUIRED_TABLES` la hop dong giua `db/init/` va ma nguon. Bo sot mot
    bang o day thi loi lai quay ve dang traceback."""
    for tag in ("alarm_definition", "alarm_transition", "alarm_state"):
        assert tag in REQUIRED_TABLES
