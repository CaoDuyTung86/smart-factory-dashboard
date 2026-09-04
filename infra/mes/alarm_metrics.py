"""
Chi so hieu nang cua he canh bao — ISA-18.2 dieu 16, doi chieu voi EEMUA 191.

Day la phan tra loi cau hoi "he canh bao cua ban co dung duoc khong", va no la
mot cau hoi khac han "he canh bao cua ban co chay khong". Mot he thong ban ra
600 canh bao mot ca van chay hoan hao ve mat ky thuat, va van vo dung: khong ai
doc noi 600 dong trong tam gio.

Cac muc tieu duoi day khong phai do tac gia nghi ra. Chung la bang chi tieu
cong bo trong ISA-18.2 (va truoc do la EEMUA 191), rut ra tu do luong tren cac
nha may that:

    Ty le trung binh          <= 1 canh bao / 10 phut  (chap nhan duoc)
                              <= 2 canh bao / 10 phut  (nguong toi da con quan ly noi)
    Dinh trong 10 phut        <= 10
    % so khoang 10 phut       <= 1%     (co tren 10 canh bao — tuc alarm flood)
    Top 10 canh bao keu nhieu <= 5%     cua tong tai canh bao
    Chattering / fleeting     = 0
    Canh bao stale            < 5 cai ton tai trong mot ngay
    Phan bo uu tien           ~80% thap / ~15% trung / ~5% cao / <1% khan cap
    Shelve khong ghi ly do    = 0       (unauthorized suppression)

Bang KPI phai noi that ke ca khi chinh he thong nay truot chi tieu. Mot bang
chi so duoc chinh cho luc nao cung xanh thi khong con la chi so, no la trang
tri.

Phan tinh toan tach hoan toan khoi phan truy van: `summarise()` va cac ham
`_grade` la ham thuan, kiem thu duoc bang mot vai dong so; `fetch()` chi lam
mot viec la lay so tu DB roi giao lai.
"""

from __future__ import annotations

from datetime import timedelta

from historian import utcnow

BUCKET_MINUTES = 10
BUCKETS_PER_HOUR = 60 // BUCKET_MINUTES

# Nguong chi tieu, giu nguyen ten goi cua tieu chuan de tra cuu nguoc lai duoc.
TARGET_RATE_ACCEPTABLE = 1.0  # canh bao / 10 phut
TARGET_RATE_MAX_MANAGEABLE = 2.0
TARGET_PEAK_PER_BUCKET = 10
FLOOD_THRESHOLD_PER_BUCKET = 10  # tren muc nay thi khoang do la alarm flood
TARGET_FLOOD_PCT = 1.0
TARGET_TOP10_PCT = 5.0
TARGET_CHATTERING = 0
TARGET_STALE = 5

# Phan bo uu tien mong doi khi dung bon muc. DIAGNOSTIC khong phai mot muc canh
# bao — do la thong tin cho ky su bao tri — nen chi tieu cua no la 0.
PRIORITY_TARGET_PCT = {
    "DIAGNOSTIC": 0.0,
    "LOW": 80.0,
    "MEDIUM": 15.0,
    "HIGH": 5.0,
    "URGENT": 1.0,
}


def _pct(part: float, whole: float) -> float:
    return 0.0 if whole <= 0 else round(100.0 * part / whole, 2)


def _grade(value: float, ok_at: float, bad_at: float) -> str:
    """Xep loai mot chi so "cang thap cang tot" thanh ok / warn / bad."""
    if value <= ok_at:
        return "ok"
    if value <= bad_at:
        return "warn"
    return "bad"


def summarise(
    *,
    window_hours: int,
    bucket_counts: list[int],
    priority_counts: dict[str, int],
    bad_actors: list[dict],
    chattering: list[dict],
    stale: list[dict],
    ack_seconds: list[float],
    shelves: int,
    shelves_without_reason: int,
) -> dict:
    """Gop so lieu tho thanh bang chi so kem phan dinh dat/khong dat.

    `bucket_counts` la so canh bao trong tung khoang 10 phut, KE CA nhung
    khoang bang 0 — mau so cua "canh bao moi 10 phut" phai la toan bo thoi gian
    cua ca, khong phai chi nhung luc co canh bao. Bo khoang rong di la cach
    de nhat de mot he thong dang ngoi tren mot tran canh bao van bao cao dep.
    """
    periods = len(bucket_counts)
    total = sum(bucket_counts)
    peak = max(bucket_counts) if bucket_counts else 0
    avg = round(total / periods, 3) if periods else 0.0
    floods = sum(1 for c in bucket_counts if c > FLOOD_THRESHOLD_PER_BUCKET)
    flood_pct = _pct(floods, periods)

    annunciated = sum(priority_counts.values())
    distribution = [
        {
            "priority": p,
            "count": priority_counts.get(p, 0),
            "pct": _pct(priority_counts.get(p, 0), annunciated),
            "targetPct": target,
        }
        for p, target in PRIORITY_TARGET_PCT.items()
    ]

    actors = [
        {**row, "pct": _pct(row["count"], total)}
        for row in bad_actors
    ]
    top10_pct = round(sum(a["pct"] for a in actors[:10]), 2)

    ordered = sorted(ack_seconds)
    ack = {
        "count": len(ordered),
        "medianSec": _quantile(ordered, 0.5),
        "p90Sec": _quantile(ordered, 0.9),
    }

    verdicts = [
        {
            "key": "rate",
            "label": "Canh bao trung binh / 10 phut",
            "value": avg,
            "target": TARGET_RATE_ACCEPTABLE,
            "limit": TARGET_RATE_MAX_MANAGEABLE,
            "status": _grade(avg, TARGET_RATE_ACCEPTABLE, TARGET_RATE_MAX_MANAGEABLE),
            "note": "ISA-18.2: <=1 la chap nhan duoc, <=2 la nguong toi da con quan ly noi.",
        },
        {
            "key": "peak",
            "label": "Dinh trong mot khoang 10 phut",
            "value": peak,
            "target": TARGET_PEAK_PER_BUCKET,
            "limit": TARGET_PEAK_PER_BUCKET * 2,
            "status": _grade(peak, TARGET_PEAK_PER_BUCKET, TARGET_PEAK_PER_BUCKET * 2),
            "note": "Tren 10 canh bao trong 10 phut thi nguoi van hanh bat dau bo qua.",
        },
        {
            "key": "flood",
            "label": "% khoang 10 phut bi alarm flood",
            "value": flood_pct,
            "target": TARGET_FLOOD_PCT,
            "limit": TARGET_FLOOD_PCT * 5,
            "status": _grade(flood_pct, TARGET_FLOOD_PCT, TARGET_FLOOD_PCT * 5),
            "note": f"Flood = tren {FLOOD_THRESHOLD_PER_BUCKET} canh bao trong mot khoang 10 phut.",
        },
        {
            "key": "topTen",
            "label": "% tai canh bao do 10 tag keu nhieu nhat",
            "value": top10_pct,
            "target": TARGET_TOP10_PCT,
            "limit": 20.0,
            "status": _grade(top10_pct, TARGET_TOP10_PCT, 20.0),
            "note": "Tap trung cao nghia la sua vai tag la giam duoc phan lon tai.",
        },
        {
            "key": "chattering",
            "label": "So tag dang chattering",
            "value": len(chattering),
            "target": TARGET_CHATTERING,
            "limit": 2,
            "status": _grade(len(chattering), TARGET_CHATTERING, 2),
            "note": "Tu 3 lan keu trong mot phut. Chua bang deadband hoac on-delay.",
        },
        {
            "key": "stale",
            "label": "Canh bao stale (keu qua 24 gio)",
            "value": len(stale),
            "target": TARGET_STALE,
            "limit": TARGET_STALE * 2,
            "status": _grade(len(stale), TARGET_STALE, TARGET_STALE * 2),
            "note": "Canh bao khong bao gio tat da thanh phong nen, khong con ai nhin.",
        },
        {
            "key": "unauthorisedSuppression",
            "label": "Lan shelve khong ghi ly do",
            "value": shelves_without_reason,
            "target": 0,
            "limit": 0,
            "status": "ok" if shelves_without_reason == 0 else "bad",
            "note": "ISA-18.2 doi shelving phai la quy trinh co kiem soat, tuc la co ly do ghi lai.",
        },
    ]

    return {
        "windowHours": window_hours,
        "bucketMinutes": BUCKET_MINUTES,
        "annunciations": total,
        "periods": periods,
        "rate": {
            "perTenMinAvg": avg,
            "perTenMinPeak": peak,
            "floodPeriods": floods,
            "floodPct": flood_pct,
            "buckets": bucket_counts,
        },
        "priorityDistribution": distribution,
        "badActors": actors,
        "topTenPct": top10_pct,
        "chattering": chattering,
        "stale": stale,
        "ackResponse": ack,
        "shelves": shelves,
        "shelvesWithoutReason": shelves_without_reason,
        "verdicts": verdicts,
        # Xep loai chung: xau nhat trong cac chi so. Mot bang toan xanh voi mot
        # o do van la mot he canh bao co van de.
        "overall": "bad"
        if any(v["status"] == "bad" for v in verdicts)
        else ("warn" if any(v["status"] == "warn" for v in verdicts) else "ok"),
    }


def _quantile(ordered: list[float], q: float) -> float | None:
    """Phan vi noi suy tuyen tinh. `None` khi chua co so lieu nao.

    Tra `None` chu khong tra 0: "chua ai xac nhan canh bao nao" va "moi nguoi
    xac nhan tuc thi trong 0 giay" la hai tinh huong nguoc han nhau.
    """
    if not ordered:
        return None
    if len(ordered) == 1:
        return round(ordered[0], 1)
    pos = q * (len(ordered) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(ordered) - 1)
    frac = pos - lo
    return round(ordered[lo] * (1 - frac) + ordered[hi] * frac, 1)


# ---------------------------------------------------------------------------
# Truy van
# ---------------------------------------------------------------------------


async def fetch(pool, window_hours: int = 24) -> dict:
    """Lay so lieu tho tu nhat ky roi giao cho `summarise()`."""
    end = utcnow()
    start = end - timedelta(hours=window_hours)
    periods = window_hours * BUCKETS_PER_HOUR

    async with pool.acquire() as conn:
        # time_bucket cua TimescaleDB chi tra ve nhung khoang CO du lieu. Mau so
        # phai la toan bo thoi gian cua cua so, nen nhung khoang rong duoc bu
        # lai o duoi bang mot mang khoi tao san.
        bucket_rows = await conn.fetch(
            """
            SELECT time_bucket(make_interval(mins => $1), occurred_at) AS bucket, count(*) AS n
            FROM alarm_transition
            WHERE to_state = 'UNACK_ALM' AND occurred_at >= $2 AND occurred_at < $3
            GROUP BY 1 ORDER BY 1
            """,
            BUCKET_MINUTES,
            start,
            end,
        )
        priority_rows = await conn.fetch(
            """
            SELECT priority, count(*) AS n
            FROM alarm_transition
            WHERE to_state = 'UNACK_ALM' AND occurred_at >= $1 AND occurred_at < $2
            GROUP BY 1
            """,
            start,
            end,
        )
        actor_rows = await conn.fetch(
            """
            SELECT tag, min(asset_code) AS asset_code, min(priority) AS priority,
                   min(message) AS message, count(*) AS count
            FROM alarm_transition
            WHERE to_state = 'UNACK_ALM' AND occurred_at >= $1 AND occurred_at < $2
            GROUP BY tag
            ORDER BY count DESC, tag
            LIMIT 10
            """,
            start,
            end,
        )
        # Chattering: cua so TRUOT 60 giay, khong phai cua so cat khuc theo phut.
        # Ba lan keu luc 10:00:59, 10:01:00, 10:01:01 la chattering that su, nhung
        # cat khuc theo phut se thay "1 lan roi 2 lan" va khong bao gi ca.
        chatter_rows = await conn.fetch(
            """
            SELECT tag, max(c) AS max_per_minute, min(message) AS message
            FROM (
              SELECT tag, message,
                     count(*) OVER (PARTITION BY tag ORDER BY occurred_at
                                    RANGE BETWEEN INTERVAL '60 seconds' PRECEDING
                                              AND CURRENT ROW) AS c
              FROM alarm_transition
              WHERE to_state = 'UNACK_ALM' AND occurred_at >= $1 AND occurred_at < $2
            ) w
            GROUP BY tag
            HAVING max(c) >= $3
            ORDER BY 2 DESC, 1
            """,
            start,
            end,
            3,
        )
        stale_rows = await conn.fetch(
            """
            SELECT s.tag, s.raised_at, d.message, d.priority,
                   round(extract(epoch FROM now() - s.raised_at) / 3600.0, 1) AS hours
            FROM alarm_state s
            JOIN alarm_definition d ON d.tag = s.tag
            WHERE s.state IN ('UNACK_ALM','ACKED_ALM')
              AND s.raised_at IS NOT NULL
              AND s.raised_at < now() - INTERVAL '24 hours'
            ORDER BY s.raised_at
            """
        )
        ack_rows = await conn.fetch(
            """
            SELECT extract(epoch FROM acked_at - raised_at) AS sec
            FROM alarm_occurrence
            WHERE raised_at >= $1 AND raised_at < $2 AND acked_at IS NOT NULL
            """,
            start,
            end,
        )
        shelve_row = await conn.fetchrow(
            """
            SELECT count(*) AS total,
                   count(*) FILTER (WHERE btrim(note) = '') AS no_reason
            FROM alarm_transition
            WHERE cause = 'SHELVE' AND occurred_at >= $1 AND occurred_at < $2
            """,
            start,
            end,
        )

    counts = [0] * periods
    for row in bucket_rows:
        idx = int((row["bucket"] - start).total_seconds() // (BUCKET_MINUTES * 60))
        if 0 <= idx < periods:
            counts[idx] = int(row["n"])

    return summarise(
        window_hours=window_hours,
        bucket_counts=counts,
        priority_counts={r["priority"]: int(r["n"]) for r in priority_rows},
        bad_actors=[
            {
                "tag": r["tag"],
                "assetCode": r["asset_code"],
                "priority": r["priority"],
                "message": r["message"],
                "count": int(r["count"]),
            }
            for r in actor_rows
        ],
        chattering=[
            {
                "tag": r["tag"],
                "message": r["message"],
                "maxPerMinute": int(r["max_per_minute"]),
            }
            for r in chatter_rows
        ],
        stale=[
            {
                "tag": r["tag"],
                "message": r["message"],
                "priority": r["priority"],
                "raisedAt": int(r["raised_at"].timestamp() * 1000),
                "hours": float(r["hours"]),
            }
            for r in stale_rows
        ],
        ack_seconds=[float(r["sec"]) for r in ack_rows],
        shelves=int(shelve_row["total"]),
        shelves_without_reason=int(shelve_row["no_reason"]),
    )


async def journal(pool, hours: int = 8, limit: int = 200, tag: str | None = None) -> list[dict]:
    """Nhat ky chuyen trang thai, moi nhat truoc.

    Man hinh nay la thu nguoi ta mo ra sau mot su co de dung lai dien bien:
    canh bao nao keu truoc, ai xac nhan luc nao, cai nao bi shelve trong luc
    dang xu ly.
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, tag, asset_code, occurred_at, from_state, to_state, cause,
                   priority, alarm_class, message, value, unit, operator, note
            FROM alarm_transition
            WHERE occurred_at >= now() - make_interval(hours => $1)
              AND ($2::text IS NULL OR tag = $2)
            ORDER BY occurred_at DESC, id DESC
            LIMIT $3
            """,
            hours,
            tag,
            limit,
        )
    return [
        {
            "id": int(r["id"]),
            "tag": r["tag"],
            "assetCode": r["asset_code"],
            "at": int(r["occurred_at"].timestamp() * 1000),
            "fromState": r["from_state"],
            "toState": r["to_state"],
            "cause": r["cause"],
            "priority": r["priority"],
            "alarmClass": r["alarm_class"],
            "message": r["message"],
            "value": None if r["value"] is None else float(r["value"]),
            "unit": r["unit"],
            "operator": r["operator"],
            "note": r["note"],
        }
        for r in rows
    ]


__all__ = [
    "BUCKET_MINUTES",
    "FLOOD_THRESHOLD_PER_BUCKET",
    "PRIORITY_TARGET_PCT",
    "TARGET_RATE_ACCEPTABLE",
    "TARGET_RATE_MAX_MANAGEABLE",
    "fetch",
    "journal",
    "summarise",
]
