"""
Truy van MES: work order, BOM, routing, genealogy.

SQL viet tay chu khong dung ORM. Hai truy van quan trong nhat o day
(`unit_genealogy` va `lot_impact`) la truy van dang do thi tren du lieu that;
mot ORM se sinh ra N+1 query cho dung nhung cho khong duoc phep cham.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def _rows(records) -> list[dict[str, Any]]:
    return [dict(r) for r in records]


# Cac bang schema phai co truoc khi backend chay duoc. Danh sach nay la hop
# dong giua `db/init/` va ma nguon: them mot bang bat buoc thi them vao day.
REQUIRED_TABLES = (
    "asset",
    "machine_shift_state",
    "telemetry",
    "alarm_definition",
    "alarm_transition",
    "alarm_state",
)


async def missing_tables(pool, names=REQUIRED_TABLES) -> list[str]:
    """Nhung bang trong `names` chua ton tai trong DB.

    Script trong `db/init/` chi chay khi volume con rong, nen tinh huong hay
    gap nhat khi doi schema khong phai la "DB trong" ma la "DB con nguyen
    schema cu". Truoc day tinh huong do bao bang mot traceback asyncpg dai hai
    muoi dong ket thuc bang `UndefinedTableError` — dung ve ky thuat nhung
    khong noi cho nguoi doc biet phai lam gi. Kiem truoc mot lan de doi lay
    mot cau bao ro rang.
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT tablename FROM pg_tables "
            "WHERE schemaname = current_schema() AND tablename = ANY($1::text[])",
            list(names),
        )
    have = {r["tablename"] for r in rows}
    return [n for n in names if n not in have]


# ---------------------------------------------------------------------------
# Danh muc
# ---------------------------------------------------------------------------


async def list_assets(pool) -> list[dict]:
    async with pool.acquire() as conn:
        return _rows(
            await conn.fetch(
                "SELECT asset_code, name, category, ideal_cycle_sec, target_output, "
                "       nominal_temp_c, nominal_vibration_mm_s, nominal_power_kw, "
                "       warn_temp_c, crit_temp_c, warn_vibration_mm_s "
                "FROM asset ORDER BY sort_order"
            )
        )


async def list_work_orders(pool, limit: int = 50) -> list[dict]:
    async with pool.acquire() as conn:
        return _rows(
            await conn.fetch(
                """
                SELECT w.wo_number, w.product_sku, p.name AS product_name, p.revision,
                       w.qty_planned, w.qty_completed, w.qty_scrapped, w.status,
                       w.planned_start, w.planned_end, w.actual_start, w.actual_end,
                       -- Yield tinh tren so da ra khoi day chuyen, khong phai
                       -- tren qty_planned: mot lenh moi chay duoc 10% ma bao
                       -- yield 10% la sai ban chat.
                       CASE WHEN w.qty_completed + w.qty_scrapped > 0
                            THEN round(100.0 * w.qty_completed
                                       / (w.qty_completed + w.qty_scrapped), 2)
                            ELSE NULL END AS yield_pct
                FROM work_order w
                JOIN product p ON p.sku = w.product_sku
                ORDER BY w.planned_start DESC
                LIMIT $1
                """,
                limit,
            )
        )


async def get_bom(pool, sku: str) -> list[dict]:
    async with pool.acquire() as conn:
        return _rows(
            await conn.fetch(
                "SELECT ref_des, part_number, description, qty, uom "
                "FROM bom_item WHERE product_sku = $1 ORDER BY ref_des",
                sku,
            )
        )


async def get_routing(pool, sku: str) -> list[dict]:
    async with pool.acquire() as conn:
        return _rows(
            await conn.fetch(
                "SELECT seq, station_name, asset_code, description, std_cycle_sec "
                "FROM routing_step WHERE product_sku = $1 ORDER BY seq",
                sku,
            )
        )


# ---------------------------------------------------------------------------
# Genealogy
# ---------------------------------------------------------------------------


async def get_unit(pool, serial: str) -> dict | None:
    """Ho so day du cua mot bo mach: header + lo trinh + vat tu + loi.

    Bon truy van song song thay vi mot cau JOIN khong lo: JOIN ca bon bang se
    nhan cheo (5 buoc x 10 vat tu = 50 dong cho mot bo mach) roi phai gom lai
    trong Python — vua ton bang thong vua de sai.
    """
    async with pool.acquire() as conn:
        header = await conn.fetchrow(
            """
            SELECT u.serial_number, u.wo_number, u.product_sku, u.started_at,
                   u.completed_at, u.status,
                   p.name AS product_name, p.revision
            FROM unit u
            JOIN product p ON p.sku = u.product_sku
            WHERE u.serial_number = $1
            """,
            serial,
        )
        if header is None:
            return None

        steps = await conn.fetch(
            "SELECT seq, attempt, station_name, asset_code, operator, started_at, "
            "       finished_at, result, measurements, details "
            "FROM unit_step WHERE serial_number = $1 ORDER BY seq, attempt",
            serial,
        )
        materials = await conn.fetch(
            """
            SELECT um.ref_des, um.part_number, um.lot_code, um.qty, um.consumed_at,
                   ml.supplier, ml.status AS lot_status, ml.received_at
            FROM unit_material um
            JOIN material_lot ml ON ml.lot_code = um.lot_code
            WHERE um.serial_number = $1
            ORDER BY um.ref_des
            """,
            serial,
        )
        defects = await conn.fetch(
            "SELECT ref_des, code, description, detected_at "
            "FROM defect WHERE serial_number = $1 ORDER BY detected_at",
            serial,
        )

    result = dict(header)
    result["steps"] = _rows(steps)
    result["materials"] = _rows(materials)
    result["defects"] = _rows(defects)
    # Co lo nao dang bi cach ly khong — cau tra loi doc lap voi ket qua kiem
    # tra. Mot bo mach PASS het moi tram van co the nam trong dien thu hoi.
    result["quarantinedLots"] = sorted(
        {m["lot_code"] for m in result["materials"] if m["lot_status"] == "QUARANTINED"}
    )
    return result


async def lot_impact(pool, lot_code: str, limit: int = 500) -> dict | None:
    """Truy van thu hoi: mot lo vat tu da di vao nhung bo mach nao.

    Day la cau hoi ma MES sinh ra de tra loi. Khong co bang unit_material thi
    cau tra loi duy nhat con lai la "thu hoi ca thang san xuat".
    """
    async with pool.acquire() as conn:
        lot = await conn.fetchrow(
            "SELECT lot_code, part_number, supplier, received_at, qty_received, "
            "       expires_at, status FROM material_lot WHERE lot_code = $1",
            lot_code,
        )
        if lot is None:
            return None

        summary = await conn.fetchrow(
            """
            SELECT count(*)                                        AS units_affected,
                   count(*) FILTER (WHERE u.status = 'PASS')       AS units_passed,
                   count(*) FILTER (WHERE u.status = 'FAIL')       AS units_failed,
                   count(*) FILTER (WHERE u.status = 'WIP')        AS units_wip,
                   count(DISTINCT u.wo_number)                     AS work_orders,
                   min(um.consumed_at)                             AS first_consumed_at,
                   max(um.consumed_at)                             AS last_consumed_at
            FROM unit_material um
            JOIN unit u ON u.serial_number = um.serial_number
            WHERE um.lot_code = $1
            """,
            lot_code,
        )
        units = await conn.fetch(
            """
            SELECT u.serial_number, u.wo_number, u.status, um.ref_des, um.consumed_at
            FROM unit_material um
            JOIN unit u ON u.serial_number = um.serial_number
            WHERE um.lot_code = $1
            ORDER BY um.consumed_at
            LIMIT $2
            """,
            lot_code,
            limit,
        )

    return {
        "lot": dict(lot),
        "summary": dict(summary),
        "units": _rows(units),
        "truncated": len(units) == limit,
    }


async def defect_pareto(pool, hours: int = 24) -> list[dict]:
    """Pareto loi theo ma + vi tri — dau vao cua mot cuoc hop chat luong.

    Nhom theo (code, ref_des) chu khong theo mo ta: mo ta la van ban tu do, moi
    ca lai viet mot kieu, gom lai se ra mot bang phang.
    """
    async with pool.acquire() as conn:
        return _rows(
            await conn.fetch(
                """
                SELECT code, ref_des, count(*) AS occurrences,
                       count(DISTINCT serial_number) AS units
                FROM defect
                WHERE detected_at >= now() - make_interval(hours => $1)
                GROUP BY code, ref_des
                ORDER BY occurrences DESC, code
                """,
                hours,
            )
        )


# ---------------------------------------------------------------------------
# Trang thai ca (doc luc khoi dong, ghi moi tick)
# ---------------------------------------------------------------------------


async def load_shift_state(pool) -> list[dict]:
    async with pool.acquire() as conn:
        return _rows(
            await conn.fetch(
                """
                SELECT a.asset_code, a.name, a.category, a.ideal_cycle_sec,
                       a.target_output, a.nominal_temp_c, a.nominal_vibration_mm_s,
                       a.nominal_power_kw, a.warn_temp_c, a.crit_temp_c,
                       a.warn_vibration_mm_s,
                       s.status, s.temperature_c, s.vibration, s.power_kw,
                       s.output, s.defects, s.run_time_ms, s.down_time_ms
                FROM asset a
                JOIN machine_shift_state s ON s.asset_code = a.asset_code
                ORDER BY a.sort_order
                """
            )
        )


async def save_shift_state(pool, machines) -> None:
    """Ghi lai bo dem cua ca. Mot cau UPDATE cho ca 4 may, khong phai 4 cau."""
    async with pool.acquire() as conn:
        await conn.executemany(
            """
            UPDATE machine_shift_state SET
              status = $2, temperature_c = $3, vibration = $4, power_kw = $5,
              output = $6, defects = $7, run_time_ms = $8, down_time_ms = $9,
              updated_at = now()
            WHERE asset_code = $1
            """,
            [
                (
                    m.id,
                    m.status,
                    round(m.temperature, 2),
                    round(m.vibration, 3),
                    round(m.power_usage, 2),
                    m.output,
                    m.defects,
                    int(m.run_time_ms),
                    int(m.down_time_ms),
                )
                for m in machines
            ],
        )


# ---------------------------------------------------------------------------
# Canh bao (ISA-18.2)
#
# Ba bang, ba tuoi tho: `alarm_definition` la cau hinh, `alarm_state` la trang
# thai song phai sot qua restart, `alarm_transition` la ho so kiem toan. Xem
# `infra/db/init/05-alarms.sql`.
# ---------------------------------------------------------------------------


async def load_alarm_definitions(pool) -> list[dict]:
    async with pool.acquire() as conn:
        return _rows(
            await conn.fetch(
                """
                SELECT tag, asset_code, metric, comparison, setpoint, deadband,
                       on_delay_sec, off_delay_sec, priority, alarm_class, message,
                       unit, consequence, operator_response, response_time_sec,
                       max_shelve_sec, enabled
                FROM alarm_definition
                ORDER BY asset_code, tag
                """
            )
        )


async def load_alarm_state(pool) -> list[dict]:
    async with pool.acquire() as conn:
        return _rows(
            await conn.fetch(
                "SELECT tag, state, raw_condition, active, raised_at, acked_at, rtn_at, "
                "       shelved_until, shelve_reason, value "
                "FROM alarm_state"
            )
        )


async def save_alarm_state(pool, engine) -> None:
    """Ghi lai trang thai cua toan bo canh bao.

    Mot canh bao chua ai xac nhan ma bien mat sau lan deploy ke tiep la mot
    canh bao bi nuot. Nghiem trong hon la shelving: neu han shelve mat khi khoi
    dong lai, canh bao dang duoc tat co chu dich se keu lai giua ca ma khong ai
    hieu vi sao — va do dung la tinh huong lam nguoi van hanh mat long tin vao
    ca he thong.
    """

    def ts(value):
        return None if value is None else datetime.fromtimestamp(value, tz=timezone.utc)

    async with pool.acquire() as conn:
        await conn.executemany(
            """
            INSERT INTO alarm_state (tag, state, raw_condition, active, raised_at,
                                     acked_at, rtn_at, shelved_until, shelve_reason,
                                     value, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
            ON CONFLICT (tag) DO UPDATE SET
              state = EXCLUDED.state, raw_condition = EXCLUDED.raw_condition,
              active = EXCLUDED.active, raised_at = EXCLUDED.raised_at,
              acked_at = EXCLUDED.acked_at, rtn_at = EXCLUDED.rtn_at,
              shelved_until = EXCLUDED.shelved_until,
              shelve_reason = EXCLUDED.shelve_reason,
              value = EXCLUDED.value, updated_at = now()
            """,
            [
                (
                    rt.tag,
                    rt.state,
                    rt.condition,
                    rt.active,
                    ts(rt.raised_at),
                    ts(rt.acked_at),
                    ts(rt.rtn_at),
                    ts(rt.shelved_until),
                    rt.shelve_reason,
                    float(rt.value),
                )
                for rt in engine.runtime.values()
            ],
        )


async def journal_transitions(pool, transitions) -> None:
    """Ghi nhat ky chuyen trang thai.

    `executemany` mot lo chu khong mot cau cho moi dong: mot tran canh bao sinh
    ra hang chuc chuyen trang thai trong cung mot tick, va do dung la luc khong
    duoc phep cham.
    """
    if not transitions:
        return
    async with pool.acquire() as conn:
        await conn.executemany(
            """
            INSERT INTO alarm_transition
              (tag, asset_code, occurred_at, from_state, to_state, cause, priority,
               alarm_class, message, value, unit, operator, note, on_delay_sec)
            VALUES ($1,$2,to_timestamp($3),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
            """,
            [
                (
                    t.tag,
                    t.asset_code,
                    t.at,
                    t.from_state,
                    t.to_state,
                    t.cause,
                    t.priority,
                    t.alarm_class,
                    t.message,
                    None if t.value is None else float(t.value),
                    t.unit,
                    t.operator,
                    t.note,
                    float(t.on_delay_sec),
                )
                for t in transitions
            ],
        )
