"""
Historian: chon do phan giai va hanh vi khi hang doi tran.

Khong can DB that: phan dang duoc kiem o day la chinh sach (chon bang nao, bo
diem nao khi day), khong phai cu phap SQL.
"""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from historian import Historian, choose_resolution


def t(**kwargs) -> datetime:
    return datetime(2026, 9, 4, 12, 0, tzinfo=timezone.utc) + timedelta(**kwargs)


# ------------------------------------------------------------- do phan giai


@pytest.mark.parametrize(
    "span,expected",
    [
        (timedelta(minutes=5), "raw"),
        (timedelta(hours=2), "raw"),  # dung tai nguong van la bang goc
        (timedelta(hours=2, seconds=1), "1m"),
        (timedelta(days=7), "1m"),
        (timedelta(days=7, seconds=1), "1h"),
        (timedelta(days=365), "1h"),
    ],
)
def test_chon_bang_theo_do_dai_khoang_thoi_gian(span, expected):
    start = t()
    assert choose_resolution(start, start + span) == expected


def test_khoang_dai_khong_bao_gio_doc_bang_goc():
    """Muc dich cua continuous aggregate. Mot bieu do 30 ngay doc bang goc la
    ~1,7 trieu dong cho mot tag; doc cagg 1 gio la 720 dong."""
    assert choose_resolution(t(), t(days=30)) == "1h"


# ---------------------------------------------------------------- hang doi


class FakePool:
    """Pool gia: dem so lo da ghi, co the bat che do loi."""

    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.batches: list[list] = []

    def acquire(self):
        pool = self

        class _Ctx:
            async def __aenter__(self):
                return pool

            async def __aexit__(self, *_):
                return False

        return _Ctx()

    async def copy_records_to_table(self, _table, records, columns):  # noqa: ARG002
        if self.fail:
            raise RuntimeError("DB tam thoi khong ghi duoc")
        self.batches.append(list(records))


def test_ghi_thanh_lo_va_don_sach_hang_doi():
    pool = FakePool()
    h = Historian(pool)
    for i in range(5):
        h.record(t(seconds=i), "SMT-LINE-01", "temperature", 52.0 + i)

    written = asyncio.run(h.flush())
    assert written == 5
    assert len(pool.batches[0]) == 5
    assert h.payload()["queued"] == 0
    assert h.stats.written == 5


def test_ghi_that_bai_thi_giu_lai_du_lieu_de_ghi_lai():
    """DB cham mot nhip khong duoc phep lam mat diem do."""
    pool = FakePool(fail=True)
    h = Historian(pool)
    for i in range(3):
        h.record(t(seconds=i), "SMT-LINE-01", "temperature", 52.0)

    assert asyncio.run(h.flush()) == 0
    assert h.payload()["queued"] == 3
    assert h.stats.last_error is not None

    pool.fail = False
    assert asyncio.run(h.flush()) == 3
    assert h.stats.last_error is None


def test_ghi_lai_giu_dung_thu_tu_thoi_gian():
    pool = FakePool(fail=True)
    h = Historian(pool)
    for i in range(3):
        h.record(t(seconds=i), "SMT-LINE-01", "temperature", float(i))
    asyncio.run(h.flush())

    # Diem moi den trong luc DB dang loi phai nam SAU nhung diem cu.
    h.record(t(seconds=9), "SMT-LINE-01", "temperature", 9.0)
    pool.fail = False
    asyncio.run(h.flush())

    values = [r[3] for r in pool.batches[0]]
    assert values == [0.0, 1.0, 2.0, 9.0]


def test_hang_doi_tran_thi_bo_diem_cu_nhat_va_dem_lai():
    """Hang doi khong gioi han chi doi loi mat du lieu lay loi het RAM. Bo thi
    phai bo diem cu nhat, va phai dem duoc bao nhieu diem da mat."""
    pool = FakePool()
    h = Historian(pool, queue_max=3)
    for i in range(5):
        h.record(t(seconds=i), "SMT-LINE-01", "temperature", float(i))

    assert h.stats.dropped == 2
    asyncio.run(h.flush())
    values = [r[3] for r in pool.batches[0]]
    assert values == [2.0, 3.0, 4.0]  # ba diem MOI nhat con lai


def test_tick_lap_day_hang_doi_trong_luc_ghi_hong_thi_van_bo_diem_cu_nhat():
    """Tinh huong that: lo dang duoc ghi thi DB roi, va trong luc await do vong
    tick van chay tiep va lap day cho trong. Phan khong con cho phai bo tu dau
    lo — tuc la diem CU nhat — chu khong phai bo diem vua sinh ra."""
    pool = FakePool(fail=True)
    h = Historian(pool, queue_max=4)

    async def refill_then_fail(_table, records, columns):  # noqa: ARG001
        # Vong tick chay xen vao giua: hang doi day lai bang diem moi.
        for i in range(90, 94):
            h.record(t(seconds=i), "SMT-LINE-01", "temperature", float(i))
        raise RuntimeError("DB tam thoi khong ghi duoc")

    for i in range(4):
        h.record(t(seconds=i), "SMT-LINE-01", "temperature", float(i))
    pool.copy_records_to_table = refill_then_fail

    assert asyncio.run(h.flush()) == 0
    # Khong con cho cho lo cu: ca 4 diem cu bi bo, dem lai du.
    assert h.stats.dropped == 4
    assert h.payload()["queued"] == 4

    pool.copy_records_to_table = FakePool.copy_records_to_table.__get__(pool)
    pool.fail = False
    asyncio.run(h.flush())
    assert [r[3] for r in pool.batches[0]] == [90.0, 91.0, 92.0, 93.0]


def test_payload_bao_ra_so_diem_da_mat():
    """Mat du lieu ma khong bao ra thi te hon mat du lieu."""
    h = Historian(FakePool(), queue_max=2)
    for i in range(5):
        h.record(t(seconds=i), "SMT-LINE-01", "temperature", float(i))

    p = h.payload()
    assert p["dropped"] == 3
    assert p["enqueued"] == 5
    assert p["queueMax"] == 2


def test_khong_co_gi_de_ghi_thi_khong_cham_vao_db():
    pool = FakePool()
    h = Historian(pool)
    assert asyncio.run(h.flush()) == 0
    assert pool.batches == []
