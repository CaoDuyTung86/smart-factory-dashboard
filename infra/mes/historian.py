"""
Ghi va doc telemetry tren TimescaleDB.

Hai nguyen tac:

1. **Vong tick khong bao gio cho DB.** Ghi diem do la fire-and-forget vao mot
   hang doi co gioi han; mot task rieng gom lai thanh lo va do xuong bang
   COPY. DB cham mot nhip thi day chuyen van chay dung nhip, chi la du lieu
   xuong tre. Nguoc lai — await INSERT ngay trong tick — la cach chac chan
   nhat de bien mot truc trac cua DB thanh mot truc trac cua SCADA.

2. **Tran hang doi thi mat du lieu, va phai noi ra.** Hang doi day nghia la
   DB khong theo kip; bo diem cu nhat va dem so diem da bo, roi bao ra
   /health. Mot hang doi khong gioi han chi doi loi mat du lieu lay loi het
   RAM, va giau mat no thi te hon nhieu.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

log = logging.getLogger("mes.historian")

QUALITY_GOOD = 192  # OPC DA StatusCode: GOOD
QUALITY_BAD = 24  # OPC DA StatusCode: BAD / not connected

FLUSH_INTERVAL_S = 1.0
BATCH_MAX = 5000


@dataclass
class HistorianStats:
    enqueued: int = 0
    written: int = 0
    dropped: int = 0
    last_error: str | None = None


class Historian:
    def __init__(self, pool, queue_max: int = 20000) -> None:
        self.pool = pool
        self.queue_max = queue_max
        self._buffer: deque[tuple[datetime, str, str, float, int]] = deque(maxlen=queue_max)
        self.stats = HistorianStats()

    def record(
        self,
        ts: datetime,
        asset_code: str,
        metric: str,
        value: float,
        quality: int = QUALITY_GOOD,
    ) -> None:
        # deque(maxlen=...) tu day diem cu nhat ra khi day. Dem lai de con biet
        # da mat bao nhieu, thay vi im lang.
        if len(self._buffer) == self.queue_max:
            self.stats.dropped += 1
        self._buffer.append((ts, asset_code, metric, float(value), quality))
        self.stats.enqueued += 1

    async def flush(self) -> int:
        if not self._buffer or self.pool is None:
            return 0
        batch = [self._buffer.popleft() for _ in range(min(BATCH_MAX, len(self._buffer)))]
        try:
            async with self.pool.acquire() as conn:
                await conn.copy_records_to_table(
                    "telemetry",
                    records=batch,
                    columns=["ts", "asset_code", "metric", "value", "quality"],
                )
        except Exception as exc:  # noqa: BLE001
            # Tra lai dau hang doi de lan sau ghi tiep. Trong luc dang await,
            # tick moi co the da lap day cho trong; phan khong con cho thi bo
            # tu dau lo — tuc la bo diem CU nhat, dung mot chinh sach voi
            # `record()`. Neu dung extendleft thang thi deque se day nguoc ra
            # dau kia va bo mat diem moi nhat.
            space = self.queue_max - len(self._buffer)
            if space < len(batch):
                self.stats.dropped += len(batch) - space
                batch = batch[len(batch) - space :]
            self._buffer.extendleft(reversed(batch))
            self.stats.last_error = str(exc)
            log.warning("Ghi telemetry that bai: %s", exc)
            return 0
        self.stats.written += len(batch)
        self.stats.last_error = None
        return len(batch)

    async def run(self) -> None:
        while True:
            await asyncio.sleep(FLUSH_INTERVAL_S)
            await self.flush()

    def payload(self) -> dict:
        return {
            "queued": len(self._buffer),
            "queueMax": self.queue_max,
            "enqueued": self.stats.enqueued,
            "written": self.stats.written,
            "dropped": self.stats.dropped,
            "lastError": self.stats.last_error,
        }


# ---------------------------------------------------------------------------
# Doc lai
# ---------------------------------------------------------------------------

# Nguong chon do phan giai. Con so 2 gio khong phai tuy tien: tick 1.5s x 2 gio
# = 4800 diem cho mot tag, gan cham tran so diem ma mot bieu do line ve duoc
# ma con phan biet duoc bang mat thuong tren man hinh ~1000px.
RAW_MAX_SPAN = timedelta(hours=2)
MINUTE_MAX_SPAN = timedelta(days=7)

RESOLUTIONS = {
    "raw": (
        "SELECT ts AS bucket, value AS avg_value, value AS min_value, value AS max_value "
        "FROM telemetry "
        "WHERE asset_code = $1 AND metric = $2 AND ts >= $3 AND ts <= $4 AND quality = 192 "
        "ORDER BY ts"
    ),
    "1m": (
        "SELECT bucket, avg_value, min_value, max_value "
        "FROM telemetry_1m "
        "WHERE asset_code = $1 AND metric = $2 AND bucket >= $3 AND bucket <= $4 "
        "ORDER BY bucket"
    ),
    "1h": (
        "SELECT bucket, avg_value, min_value, max_value "
        "FROM telemetry_1h "
        "WHERE asset_code = $1 AND metric = $2 AND bucket >= $3 AND bucket <= $4 "
        "ORDER BY bucket"
    ),
}


def choose_resolution(start: datetime, end: datetime) -> str:
    """Chon bang doc theo do dai khoang thoi gian.

    Day la ly do ton tai cua continuous aggregate: mot bieu do 30 ngay ma doc
    bang goc la ~1.7 trieu dong cho mot tag, doc cagg 1 gio la 720 dong. Ket
    qua nhin gan giong nhau tren man hinh, chi phi khac nhau ba bac.
    """
    span = end - start
    if span <= RAW_MAX_SPAN:
        return "raw"
    if span <= MINUTE_MAX_SPAN:
        return "1m"
    return "1h"


async def fetch_series(
    pool,
    asset_code: str,
    metric: str,
    start: datetime,
    end: datetime,
    resolution: str | None = None,
) -> dict:
    resolution = resolution or choose_resolution(start, end)
    if resolution not in RESOLUTIONS:
        raise ValueError(f"Do phan giai khong hop le: {resolution}")

    started = time.perf_counter()
    async with pool.acquire() as conn:
        rows = await conn.fetch(RESOLUTIONS[resolution], asset_code, metric, start, end)

    return {
        "assetCode": asset_code,
        "metric": metric,
        "resolution": resolution,
        "from": start.isoformat(),
        "to": end.isoformat(),
        "queryMs": round((time.perf_counter() - started) * 1000, 1),
        "points": [
            {
                "t": int(r["bucket"].timestamp() * 1000),
                "v": float(r["avg_value"]),
                # Bieu do downsample ma bo min/max la noi doi ve du lieu: dinh
                # nhon 90 giay bien mat hoan toan sau khi lay trung binh phut.
                "lo": float(r["min_value"]),
                "hi": float(r["max_value"]),
            }
            for r in rows
        ],
    }


HISTORY_SQL = {
    "raw": (
        "SELECT ts AS bucket, asset_code, metric, value "
        "FROM telemetry "
        "WHERE metric = ANY($1::text[]) AND ts >= $2 AND ts <= $3 AND quality = 192 "
        "ORDER BY ts"
    ),
    "1m": (
        "SELECT bucket, asset_code, metric, avg_value AS value "
        "FROM telemetry_1m "
        "WHERE metric = ANY($1::text[]) AND bucket >= $2 AND bucket <= $3 "
        "ORDER BY bucket"
    ),
    "1h": (
        "SELECT bucket, asset_code, metric, avg_value AS value "
        "FROM telemetry_1h "
        "WHERE metric = ANY($1::text[]) AND bucket >= $2 AND bucket <= $3 "
        "ORDER BY bucket"
    ),
}


async def fetch_history(pool, start: datetime, end: datetime) -> dict:
    """Lich su nhiet do + rung cua moi may, gom theo may.

    Mot truy van cho tat ca thay vi hai truy van moi may: cung mot khoang thoi
    gian, cung mot index, nen de DB quet mot lan roi gom trong Python re hon
    han tam lan round-trip.
    """
    resolution = choose_resolution(start, end)
    started = time.perf_counter()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            HISTORY_SQL[resolution], ["temperature", "vibration"], start, end
        )

    # {asset: {t: {temp, vibration}}} — hai tag duoc ghi cung mot moc thoi gian
    # nen ghep lai theo t la khop chinh xac, khong phai noi suy.
    grouped: dict[str, dict[int, dict[str, float]]] = {}
    for r in rows:
        t = int(r["bucket"].timestamp() * 1000)
        point = grouped.setdefault(r["asset_code"], {}).setdefault(
            t, {"t": t, "temp": 0.0, "vibration": 0.0}
        )
        if r["metric"] == "temperature":
            point["temp"] = round(float(r["value"]), 1)
        else:
            point["vibration"] = round(float(r["value"]), 2)

    return {
        "resolution": resolution,
        "from": start.isoformat(),
        "to": end.isoformat(),
        "queryMs": round((time.perf_counter() - started) * 1000, 1),
        "series": {
            asset: [points[t] for t in sorted(points)] for asset, points in grouped.items()
        },
    }


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
