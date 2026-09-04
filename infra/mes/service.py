"""
Backend MES + historian API.

    REST  :8002/api/...   danh muc, work order, BOM, routing, genealogy, telemetry,
                          cau hinh + chi so hieu nang cua he canh bao (ISA-18.2)
    WS    :8002/ws        trang thai day chuyen + OEE + canh bao, phat moi tick

Dich vu nay la nguon su that cua tab SCADA. Frontend khong con tu sinh so lieu
khi ket noi duoc toi day; khong ket noi duoc thi no quay ve simulator trong
trinh duyet — cung mot kieu xuong thang nhu tab PLC va tab Vision.

Ba vong chay song song:
  * `line_loop`   — day mo hinh day chuyen, ghi telemetry, phat WebSocket
  * `historian`   — gom telemetry thanh lo roi COPY xuong TimescaleDB
  * `mqtt`        — nghe bo dem cua PLC that tren Unified Namespace
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import random
import time
from contextlib import asynccontextmanager
from dataclasses import replace as dc_replace
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import asyncpg
import paho.mqtt.client as mqtt
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import alarm_metrics
import repository as repo
from alarms import AlarmEngine, definition_from_row, restore as restore_alarms
from historian import Historian, choose_resolution, fetch_history, fetch_series, utcnow
from line import LineModel, Machine, readings_of

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
)
log = logging.getLogger("mes")

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://factory:factory@timescaledb:5432/factory")
MQTT_HOST = os.getenv("MQTT_HOST", "mosquitto")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
UNS_BASE = os.getenv("UNS_BASE", "foxconn/hanoi/smt/line-1")
TICK_MS = int(os.getenv("LINE_TICK_MS", "1500"))
# Ghi trang thai ca xuong DB thua hon moi tick la lang phi: bo dem chi can song
# sot qua mot lan khoi dong lai, khong can chinh xac tung 1.5 giay.
STATE_SAVE_EVERY = int(os.getenv("STATE_SAVE_EVERY_TICKS", "20"))

# Cac tag duoc ghi vao historian moi tick.
TELEMETRY_METRICS = ("temperature", "vibration", "power_kw", "output", "defects")

# Ten nguoi thao tac. Chua co dang nhap, nhung cot `operator` cua nhat ky da
# ton tai va duoc dien: them xac thuc sau nay la doi mot hang so nay, khong
# phai sua lai luoc do bang va viet lai lich su.
OPERATOR = os.getenv("OPERATOR_NAME", "hmi")


# ---------------------------------------------------------------------------
# Trang thai dung chung
# ---------------------------------------------------------------------------


class Runtime:
    def __init__(self) -> None:
        self.pool: asyncpg.Pool | None = None
        self.line: LineModel | None = None
        self.historian: Historian | None = None
        self.subscribers: set[WebSocket] = set()
        self.tasks: list[asyncio.Task] = []
        self.mqtt: mqtt.Client | None = None
        self.plc_connected = False
        self.plc_part_count: int | None = None
        self._plc_last_count: int | None = None
        self.started_at = time.time()
        self.tick_count = 0
        self.db_error: str | None = None

    def take_plc_delta(self) -> int | None:
        """So san pham PLC dem duoc ke tu lan hoi truoc.

        Bo dem cua PLC la thanh ghi 16 bit: 65535 -> 0 la tran chu khong phai
        vua san xuat am 65535 san pham. Bo dem cung ve 0 khi chuong trinh duoc
        nap lai. Ca hai truong hop deu tra ve 0 va lay lai moc, thay vi bom mot
        con so rac vao san luong.
        """
        if not self.plc_connected or self.plc_part_count is None:
            self._plc_last_count = None
            return None
        current = self.plc_part_count
        previous = self._plc_last_count
        self._plc_last_count = current
        if previous is None:
            return 0
        delta = current - previous
        if delta < 0:
            return 0
        return delta


rt = Runtime()


def build_machines(rows: list[dict]) -> list[Machine]:
    return [
        Machine(
            id=r["asset_code"],
            name=r["name"],
            code=r["asset_code"],
            category=r["category"],
            status=r["status"],
            temperature=float(r["temperature_c"]),
            vibration=float(r["vibration"]),
            output=int(r["output"]),
            defects=int(r["defects"]),
            power_usage=float(r["power_kw"]),
            target_output=int(r["target_output"]),
            ideal_cycle_sec=float(r["ideal_cycle_sec"]),
            run_time_ms=float(r["run_time_ms"]),
            down_time_ms=float(r["down_time_ms"]),
            last_updated=int(time.time() * 1000),
            nominal_temp=float(r["nominal_temp_c"]),
            nominal_vibration=float(r["nominal_vibration_mm_s"]),
            nominal_power=float(r["nominal_power_kw"]),
            warn_temp=float(r["warn_temp_c"]),
            crit_temp=float(r["crit_temp_c"]),
            warn_vibration=float(r["warn_vibration_mm_s"]),
        )
        for r in rows
    ]


async def broadcast(message: dict) -> None:
    if not rt.subscribers:
        return
    text = json.dumps(message)
    dead = []
    for ws in list(rt.subscribers):
        try:
            await ws.send_text(text)
        except Exception:  # noqa: BLE001 - client roi mang la binh thuong
            dead.append(ws)
    for ws in dead:
        rt.subscribers.discard(ws)


def json_safe(value):
    """datetime -> ISO 8601 (UTC), Decimal -> float. Phan con lai giu nguyen."""
    if isinstance(value, dict):
        return {k: json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [json_safe(v) for v in value]
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


# ---------------------------------------------------------------------------
# Vong chinh
# ---------------------------------------------------------------------------


async def journal(transitions) -> None:
    """Ghi cac chuyen trang thai canh bao xuong nhat ky.

    Loi ghi DB khong duoc phep lam gay vong tick — day chuyen van phai chay va
    van phai phat cho cac HMI ke ca khi historian dang co van de. Nhung loi do
    duoc ghi log va lo ra `/health`, khong nuot im.
    """
    if rt.pool is None or not transitions:
        return
    try:
        await repo.journal_transitions(rt.pool, transitions)
        rt.db_error = None
    except Exception as exc:  # noqa: BLE001
        rt.db_error = str(exc)
        log.warning("Ghi alarm_transition that bai: %s", exc)


async def line_loop() -> None:
    assert rt.line is not None and rt.historian is not None
    while True:
        await asyncio.sleep(TICK_MS / 1000)
        now = utcnow()
        now_ms = int(now.timestamp() * 1000)

        transitions = rt.line.tick(now_ms=now_ms, plc_produced=rt.take_plc_delta())
        rt.tick_count += 1

        for m in rt.line.machines:
            rt.historian.record(now, m.id, "temperature", m.temperature)
            rt.historian.record(now, m.id, "vibration", m.vibration)
            rt.historian.record(now, m.id, "power_kw", m.power_usage)
            rt.historian.record(now, m.id, "output", m.output)
            rt.historian.record(now, m.id, "defects", m.defects)

        # Nhat ky canh bao ghi NGAY, khong gom lo theo nhip nhu telemetry.
        # Telemetry co the thua mot diem; mot chuyen trang thai canh bao thi
        # khong — do la ho so noi ai biet chuyen gi vao luc nao.
        await journal(transitions)

        if rt.pool is not None and rt.tick_count % STATE_SAVE_EVERY == 0:
            try:
                await repo.save_shift_state(rt.pool, rt.line.machines)
                await repo.save_alarm_state(rt.pool, rt.line.engine)
                rt.db_error = None
            except Exception as exc:  # noqa: BLE001
                rt.db_error = str(exc)
                log.warning("Ghi trang thai xuong DB that bai: %s", exc)

        await broadcast(
            {"type": "update", **rt.line.payload(now_ms), "serverTime": now_ms}
        )


class MqttListener:
    """Nghe bo dem PLC that tren Unified Namespace.

    Doc qua MQTT chu khong goi thang REST cua gateway: bus la noi moi he thong
    khac (Node-RED, Grafana, MES) doc cung mot so lieu. Them mot ket noi Modbus
    thu hai vao PLC la cach nhanh nhat de hai he thong doc lech nhau.
    """

    def __init__(self) -> None:
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="smart-factory-mes")
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message

    def start(self) -> None:
        try:
            self.client.connect_async(MQTT_HOST, MQTT_PORT, keepalive=30)
            self.client.loop_start()
        except Exception as exc:  # noqa: BLE001
            log.warning("MQTT khong ket noi duoc: %s", exc)

    def stop(self) -> None:
        with contextlib.suppress(Exception):
            self.client.loop_stop()
            self.client.disconnect()

    def _on_connect(self, client, _u, _f, reason_code, _p=None) -> None:
        if reason_code != 0:
            log.warning("MQTT tu choi ket noi: %s", reason_code)
            return
        client.subscribe(f"{UNS_BASE}/plc/status", qos=1)
        client.subscribe(f"{UNS_BASE}/plc/tag/part_count", qos=0)
        log.info("MES nghe UNS '%s'", UNS_BASE)

    def _on_message(self, _c, _u, msg: mqtt.MQTTMessage) -> None:
        raw = msg.payload.decode("utf-8", "ignore").strip()
        if msg.topic.endswith("/plc/status"):
            rt.plc_connected = raw.upper() == "ONLINE"
            if not rt.plc_connected:
                rt.plc_part_count = None
        elif msg.topic.endswith("/part_count"):
            try:
                rt.plc_part_count = int(float(raw))
            except ValueError:
                pass


async def _init_connection(conn: asyncpg.Connection) -> None:
    # Khong dang ky codec thi asyncpg tra JSONB ve duoi dang chuoi, va tang tren
    # phai doan xem chuoi nao la JSON — doan sai mot lan la mot cot `details`
    # binh thuong bi bien thanh object.
    await conn.set_type_codec(
        "jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
    )


async def connect_pool(retries: int = 30) -> asyncpg.Pool:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            return await asyncpg.create_pool(
                DATABASE_URL, min_size=2, max_size=8, init=_init_connection
            )
        except Exception as exc:  # noqa: BLE001
            last = exc
            log.info("Cho TimescaleDB (%s/%s): %s", attempt + 1, retries, exc)
            await asyncio.sleep(2)
    raise RuntimeError(f"Khong ket noi duoc DB: {last}")


# ---------------------------------------------------------------------------
# FastAPI
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(_app: FastAPI):
    await startup()
    try:
        yield
    finally:
        await shutdown()


app = FastAPI(title="Smart Factory MES", version="1.0.0", lifespan=lifespan)

# Cong cu lab chay tren may local: dashboard o cong 3000 noi chuyen voi backend
# o cong 8002 nen mac dinh se bi CORS chan. Dem ra mang that thi phai khoa lai.
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


async def build_alarm_engine(pool) -> AlarmEngine:
    """Dung `AlarmEngine` tu Master Alarm Database roi nap lai trang thai cu.

    Cau hinh canh bao nam trong DB chu khong trong ma nguon: doi mot setpoint
    la mot cau UPDATE cong mot lan khoi dong lai, khong phai mot lan build.
    """
    defs = await repo.load_alarm_definitions(pool)
    if not defs:
        raise RuntimeError("Bang alarm_definition rong — schema chua duoc nap")
    engine = AlarmEngine([definition_from_row(row) for row in defs])

    def epoch(value):
        return None if value is None else value.timestamp()

    restore_alarms(
        engine,
        {
            row["tag"]: {
                "state": row["state"],
                "condition": row["raw_condition"],
                "active": row["active"],
                "raised_at": epoch(row["raised_at"]),
                "acked_at": epoch(row["acked_at"]),
                "rtn_at": epoch(row["rtn_at"]),
                "shelved_until": epoch(row["shelved_until"]),
                "shelve_reason": row["shelve_reason"],
                "value": row["value"],
            }
            for row in await repo.load_alarm_state(pool)
        },
    )
    return engine


async def startup() -> None:
    rt.pool = await connect_pool()
    rows = await repo.load_shift_state(rt.pool)
    if not rows:
        raise RuntimeError("Bang asset/machine_shift_state rong — schema chua duoc nap")

    engine = await build_alarm_engine(rt.pool)
    rt.line = LineModel(
        machines=build_machines(rows),
        engine=engine,
        tick_ms=TICK_MS,
        rng=random.Random(),
    )
    rt.historian = Historian(rt.pool)
    listener = MqttListener()
    listener.start()
    rt.mqtt = listener.client

    rt.tasks = [
        asyncio.create_task(line_loop()),
        asyncio.create_task(rt.historian.run()),
    ]
    log.info(
        "MES san sang — %s may, %s canh bao, tick %sms, DB %s",
        len(rt.line.machines),
        len(engine.definitions),
        TICK_MS,
        DATABASE_URL.rsplit("@", 1)[-1],
    )


async def shutdown() -> None:
    for task in rt.tasks:
        task.cancel()
    if rt.historian is not None:
        # Do not hang doi lan cuoi: khong lam thi mot lan deploy lai la mat vai
        # nghin diem do dang cho trong RAM.
        with contextlib.suppress(Exception):
            await rt.historian.flush()
    if rt.line is not None and rt.pool is not None:
        with contextlib.suppress(Exception):
            await repo.save_shift_state(rt.pool, rt.line.machines)
        # Trang thai canh bao phai duoc ghi o day chu khong chi moi 20 tick:
        # dung container ngay sau khi ai do shelve mot canh bao thi han shelve
        # do phai con nguyen luc bat lai.
        with contextlib.suppress(Exception):
            await repo.save_alarm_state(rt.pool, rt.line.engine)
    if rt.mqtt is not None:
        with contextlib.suppress(Exception):
            rt.mqtt.loop_stop()
            rt.mqtt.disconnect()
    if rt.pool is not None:
        await rt.pool.close()


@app.get("/health")
async def health() -> dict:
    db_ok = False
    if rt.pool is not None:
        with contextlib.suppress(Exception):
            async with rt.pool.acquire() as conn:
                db_ok = (await conn.fetchval("SELECT 1")) == 1
    return {
        "mes": "ok",
        "dbConnected": db_ok,
        "dbError": rt.db_error,
        "plcConnected": rt.plc_connected,
        "plcPartCount": rt.plc_part_count,
        "uptimeSec": round(time.time() - rt.started_at, 1),
        "ticks": rt.tick_count,
        "subscribers": len(rt.subscribers),
        "historian": rt.historian.payload() if rt.historian else None,
    }


@app.get("/api/state")
async def get_state() -> dict:
    if rt.line is None:
        raise HTTPException(503, "Day chuyen chua khoi dong")
    return {**rt.line.payload(), "serverTime": int(time.time() * 1000)}


@app.get("/api/assets")
async def get_assets() -> JSONResponse:
    return JSONResponse(json_safe(await repo.list_assets(rt.pool)))


@app.get("/api/telemetry")
async def get_telemetry(
    asset: str = Query(..., description="Ma tai san, vi du SMT-LINE-01"),
    metric: str = Query("temperature"),
    minutes: int = Query(60, ge=1, le=60 * 24 * 400),
    resolution: str | None = Query(None, pattern="^(raw|1m|1h)$"),
) -> dict:
    end = utcnow()
    start = end - timedelta(minutes=minutes)
    try:
        return await fetch_series(rt.pool, asset, metric, start, end, resolution)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/telemetry/history")
async def get_history(minutes: int = Query(60, ge=1, le=1440)) -> dict:
    """Lich su cua ca 4 may, dung de dung lai bieu do ngay khi mo trang.

    Day la thu thay cho 40 diem trong RAM cua ban cu: F5 khong con bat dau lai
    tu con so khong.
    """
    end = utcnow()
    start = end - timedelta(minutes=minutes)
    return await fetch_history(rt.pool, start, end)


@app.get("/api/work-orders")
async def get_work_orders(limit: int = Query(50, ge=1, le=500)) -> JSONResponse:
    return JSONResponse(json_safe(await repo.list_work_orders(rt.pool, limit)))


@app.get("/api/products/{sku}/bom")
async def get_bom(sku: str) -> JSONResponse:
    rows = await repo.get_bom(rt.pool, sku)
    if not rows:
        raise HTTPException(404, f"Khong co BOM cho san pham {sku}")
    return JSONResponse(json_safe(rows))


@app.get("/api/products/{sku}/routing")
async def get_routing(sku: str) -> JSONResponse:
    rows = await repo.get_routing(rt.pool, sku)
    if not rows:
        raise HTTPException(404, f"Khong co routing cho san pham {sku}")
    return JSONResponse(json_safe(rows))


@app.get("/api/units/{serial}")
async def get_unit(serial: str) -> JSONResponse:
    unit = await repo.get_unit(rt.pool, serial.strip().upper())
    if unit is None:
        # 404 chu khong phai 200 kem danh sach rong: "khong tim thay serial" la
        # mot cau tra loi khac han voi "tim thay nhung chua di tram nao".
        raise HTTPException(404, f"Khong tim thay serial {serial} trong MES")
    return JSONResponse(json_safe(unit))


@app.get("/api/lots/{lot_code}/impact")
async def get_lot_impact(lot_code: str, limit: int = Query(500, ge=1, le=5000)) -> JSONResponse:
    impact = await repo.lot_impact(rt.pool, lot_code.strip().upper(), limit)
    if impact is None:
        raise HTTPException(404, f"Khong tim thay lo {lot_code}")
    return JSONResponse(json_safe(impact))


@app.get("/api/defects/pareto")
async def get_defect_pareto(hours: int = Query(24, ge=1, le=24 * 90)) -> JSONResponse:
    return JSONResponse(json_safe(await repo.defect_pareto(rt.pool, hours)))


# ---------------------------------------------------------------------------
# Canh bao (ISA-18.2)
# ---------------------------------------------------------------------------


@app.get("/api/alarms")
async def get_alarms() -> dict:
    """Anh chup canh bao hien tai, cho client khong mo WebSocket."""
    if rt.line is None:
        raise HTTPException(503, "Day chuyen chua khoi dong")
    now_ms = int(time.time() * 1000)
    payload = rt.line.payload(now_ms)
    return {
        "alarms": payload["alarms"],
        "inhibitedAlarms": payload["inhibitedAlarms"],
        "alarmCounts": payload["alarmCounts"],
        "serverTime": now_ms,
    }


@app.get("/api/alarms/definitions")
async def get_alarm_definitions() -> list[dict]:
    """Master Alarm Database: moi canh bao kem can cu ton tai cua no.

    Lo ra API vi cau hoi "vi sao cai nay keu, va toi phai lam gi trong bao lau"
    phai tra loi duoc ngay tren man hinh nguoi van hanh. Bat ho di doc ma nguon
    la mot cach chac chan de khong ai doc.
    """
    if rt.line is None:
        raise HTTPException(503, "Day chuyen chua khoi dong")
    return rt.line.engine.definition_rows()


@app.get("/api/alarms/performance")
async def get_alarm_performance(hours: int = Query(24, ge=1, le=24 * 30)) -> JSONResponse:
    """Chi so hieu nang he canh bao theo ISA-18.2 dieu 16 / EEMUA 191."""
    return JSONResponse(json_safe(await alarm_metrics.fetch(rt.pool, hours)))


@app.get("/api/alarms/journal")
async def get_alarm_journal(
    hours: int = Query(8, ge=1, le=24 * 30),
    limit: int = Query(200, ge=1, le=2000),
    tag: str | None = Query(None),
) -> JSONResponse:
    return JSONResponse(json_safe(await alarm_metrics.journal(rt.pool, hours, limit, tag)))


# ---------------------------------------------------------------------------
# WebSocket
# ---------------------------------------------------------------------------

COMMANDS = {
    "setLineSpeed",
    "setFeedDensity",
    "triggerFault",
    "repair",
    "acknowledge",
    "acknowledgeAsset",
    "acknowledgeAll",
    "shelve",
    "unshelve",
    "outOfService",
    "reset",
}

# Han shelve toi da nguoi dung duoc phep xin. Con bi kep lan nua boi
# `max_shelve_sec` cua chinh canh bao do trong Master Alarm Database — canh bao
# an toan chi duoc 5 phut, va gioi han do nam o cau hinh chu khong o day.
MAX_SHELVE_REQUEST_SEC = 8 * 3600


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    if rt.line is None:
        await ws.close(code=1013)
        return
    rt.subscribers.add(ws)
    # Anh chup ngay khi ket noi: UI khong phai doi den tick ke tiep moi co gi
    # de ve.
    now_ms = int(time.time() * 1000)
    await ws.send_text(
        json.dumps({"type": "snapshot", **rt.line.payload(now_ms), "serverTime": now_ms})
    )
    try:
        while True:
            raw = await ws.receive_text()
            try:
                message = json.loads(raw)
            except ValueError:
                continue
            await handle_command(message)
    except WebSocketDisconnect:
        pass
    finally:
        rt.subscribers.discard(ws)


async def handle_command(message: dict) -> None:
    assert rt.line is not None
    name = str(message.get("cmd", ""))
    if name not in COMMANDS:
        log.warning("Lenh khong hop le: %s", name)
        return

    now_ms = int(time.time() * 1000)
    operator = str(message.get("operator") or OPERATOR)
    transitions = []

    if name == "setLineSpeed":
        rt.line.set_line_speed(float(message.get("value", 1.0)))
    elif name == "setFeedDensity":
        rt.line.set_feed_density(str(message.get("value", "NORMAL")))
    elif name == "triggerFault":
        # Chi dat may vao dieu kien hong. Canh bao (neu co) do AlarmEngine sinh
        # ra o tick ke tiep, sau khi da di qua on-delay va deadband that su.
        rt.line.trigger_fault(str(message.get("machineId", "")), str(message.get("fault", "")))
    elif name == "repair":
        # Sua may KHONG xac nhan ho canh bao: xem ghi chu tren `LineModel.repair`.
        rt.line.repair(str(message.get("machineId", "")))
    elif name == "acknowledge":
        transitions = rt.line.acknowledge(str(message.get("tag", "")), now_ms, operator)
    elif name == "acknowledgeAsset":
        transitions = rt.line.acknowledge_asset(
            str(message.get("machineId", "")), now_ms, operator
        )
    elif name == "acknowledgeAll":
        transitions = rt.line.acknowledge_all(now_ms, operator)
    elif name == "shelve":
        seconds = max(60.0, min(float(message.get("seconds", 1800)), MAX_SHELVE_REQUEST_SEC))
        transitions = rt.line.shelve(
            str(message.get("tag", "")),
            seconds,
            reason=str(message.get("reason", "")).strip(),
            operator=operator,
            now_ms=now_ms,
        )
    elif name == "unshelve":
        transitions = rt.line.unshelve(str(message.get("tag", "")), now_ms, operator)
    elif name == "outOfService":
        transitions = rt.line.set_out_of_service(
            str(message.get("tag", "")), bool(message.get("value", True)), now_ms, operator
        )
    elif name == "reset":
        transitions = await reset_line(now_ms, operator)

    await journal(transitions)
    # Phat ngay chu khong doi tick ke tiep: nut bam phai phan hoi tuc thi.
    await broadcast({"type": "update", **rt.line.payload(now_ms), "serverTime": now_ms})


async def reset_line(now_ms: int, operator: str) -> list:
    """Dua day chuyen ve trang thai sach — nut cua ban demo.

    KHONG xoa trang canh bao. Truoc day `reset` goi thang `alarms.clear()`, tuc
    la mot nut lam bien mat moi bang chung ve nhung gi vua xay ra. O day no dua
    dieu kien qua trinh ve binh thuong roi XAC NHAN toan bo canh bao — cung dan
    toi mot man hinh sach, nhung moi buoc deu di qua may trang thai va deu de
    lai mot dong trong nhat ky.
    """
    assert rt.line is not None
    rt.line.set_line_speed(1.0)
    rt.line.set_feed_density("NORMAL")
    rt.line.machines = [
        dc_replace(
            m,
            status="running",
            temperature=m.nominal_temp,
            vibration=m.nominal_vibration,
            power_usage=m.nominal_power,
            estop=False,
        )
        for m in rt.line.machines
    ]
    # Danh gia lai voi so do da ve binh thuong TRUOC khi xac nhan, de canh bao
    # di qua may trang thai chu khong bi nhac thang ve NORMAL. Canh bao nao con
    # trong off-delay thi van o trang thai "dang keu" them mot lat sau khi da
    # xac nhan — dung nhu thiet ke, va do la ly do man hinh khong sach tuc thi.
    transitions = rt.line.engine.evaluate(now_ms / 1000, readings_of(rt.line.machines))
    return transitions + rt.line.acknowledge_all(now_ms, operator)


__all__ = ["app", "build_machines", "json_safe", "rt"]
