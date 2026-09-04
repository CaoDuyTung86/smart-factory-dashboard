"""
OEE theo dinh nghia Nakajima / SEMI E10.

    Availability = Run Time / Planned Production Time
    Performance  = (Ideal Cycle Time x Total Count) / Run Time
    Quality      = Good Count / Total Count
    OEE          = A x P x Q

Planned production time = run time + down time. May dung van dot thoi gian ke
hoach — do la thu keo Availability xuong. Thoi gian nghi theo lich KHONG phai
planned production time va khong bao gio duoc cong vao day.

Performance bi chan tran o 100%: vuot qua nghia la ideal cycle time ghi trong
danh muc thiet bi sai, khong phai day chuyen thang duoc vat ly.

Ban nay la ban sao tung dong cua `src/features/factory/lib/oee.ts`. Hai ban
duoc ghim vao cung mot vi du mau (A 88.8 / P 86.1 / Q 97.8 / OEE 74.8%) trong
test cua ca hai ben, nen neu mot ben troi cong thuc thi test ben do do.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Iterable, Protocol


def round1(value: float) -> float:
    """Lam tron 1 chu so thap phan theo kieu `Number.toFixed(1)` cua JavaScript.

    `round()` cua Python lam tron ve so chan (banker's rounding): round(0.25, 1)
    ra 0.2 con toFixed(1) ra 0.3. Ty le OEE rat hay roi dung vao duoi .x5, nen
    neu dung round() thi hai ban cai dat se lech nhau o chu so cuoi va loi khang
    dinh "hai ban giong het nhau" thanh noi suong.
    """
    return float(Decimal(repr(value)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


class HasOeeCounters(Protocol):
    output: int
    defects: int
    ideal_cycle_sec: float
    run_time_ms: float
    down_time_ms: float


@dataclass(frozen=True)
class OeeMetrics:
    availability: float
    performance: float
    quality: float
    overall: float

    def payload(self) -> dict[str, float]:
        return {
            "availability": self.availability,
            "performance": self.performance,
            "quality": self.quality,
            "overall": self.overall,
        }


def compute_oee(machines: Iterable[HasOeeCounters]) -> OeeMetrics:
    run_ms = 0.0
    down_ms = 0.0
    total_count = 0
    good_count = 0
    ideal_run_ms = 0.0

    for m in machines:
        run_ms += m.run_time_ms
        down_ms += m.down_time_ms
        total_count += m.output
        good_count += m.output - m.defects
        ideal_run_ms += m.output * m.ideal_cycle_sec * 1000

    planned_ms = run_ms + down_ms
    availability = (run_ms / planned_ms) * 100 if planned_ms > 0 else 0.0
    performance = min(100.0, (ideal_run_ms / run_ms) * 100) if run_ms > 0 else 0.0
    # Chua lam ra san pham nao thi khong phai van de chat luong — 100% cho toi
    # khi co bang chung nguoc lai.
    quality = (good_count / total_count) * 100 if total_count > 0 else 100.0

    return OeeMetrics(
        availability=round1(availability),
        performance=round1(performance),
        quality=round1(quality),
        # Nhan ba he so goc roi moi lam tron mot lan. Lam tron tung he so truoc
        # khi nhan lam sai chu so cuoi cua OEE.
        overall=round1(availability * performance * quality / 10000),
    )
