"""
Edge gateway: OpenPLC (Modbus TCP)  ->  MQTT (Unified Namespace)  ->  WebSocket

Day la tang "edge" trong kien truc ISA-95: doc thiet bi bang giao thuc cong
nghiep, chuan hoa du lieu, roi day len lop tren. Ba dau ra song song:

  1. MQTT  — bus cong nghiep that. Topic to chuc theo Unified Namespace, co
             birth/death certificate bang LWT (y tuong muon tu Sparkplug B).
  2. WebSocket — cho trinh duyet doc truc tiep, khong can thu vien MQTT.
  3. REST  — POST /command de HMI ghi nguoc xuong PLC.
  4. Historian — ghi tag xuong TimescaleDB de con lich su dai hon mot phien
             lam viec cua trinh duyet. Ghi theo kieu "bao cao khi thay doi"
             (exception reporting) chu khong phai moi vong: bang tai dung yen
             10 phut khong sinh ra 3.000 dong giong het nhau.

Gateway khong bao gio tu chet khi PLC hoac broker roi mang: no bao trang thai
DISCONNECTED va tu ket noi lai.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import asyncpg
import paho.mqtt.client as mqtt
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pymodbus.client import AsyncModbusTcpClient

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
)
log = logging.getLogger("gateway")

# --------------------------------------------------------------------------
# Cau hinh
# --------------------------------------------------------------------------

PLC_HOST = os.getenv("PLC_HOST", "openplc")
PLC_PORT = int(os.getenv("PLC_PORT", "502"))
PLC_UNIT_ID = int(os.getenv("PLC_UNIT_ID", "1"))
POLL_INTERVAL_S = float(os.getenv("POLL_INTERVAL_MS", "200")) / 1000

MQTT_HOST = os.getenv("MQTT_HOST", "mosquitto")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))

# Unified Namespace: enterprise/site/area/line — cay topic phan anh nha may
# that, khong phan anh so do phan mem.
UNS_BASE = os.getenv("UNS_BASE", "foxconn/hanoi/smt/line-1")
TOPIC_STATE = f"{UNS_BASE}/plc/state"
TOPIC_STATUS = f"{UNS_BASE}/plc/status"
TOPIC_METRIC = f"{UNS_BASE}/plc/tag"
TOPIC_CMD = f"{UNS_BASE}/plc/cmd"

# Ban do dia chi — phai khop voi infra/plc/conveyor.st
OUTPUT_COILS: dict[str, int] = {
    "conveyor": 0,  # %QX0.0
    "red_tower": 2,  # %QX0.2
    "green_tower": 3,  # %QX0.3
}
COMMAND_COILS: dict[str, int] = {
    "start": 8,  # %QX1.0
    "stop": 9,  # %QX1.1
    "estop": 10,  # %QX1.2
    "door_open": 11,  # %QX1.3
}
# Nut nhan nha: ghi TRUE roi ghi FALSE ngay sau do, dung nhu bam mot cai.
MOMENTARY = {"start", "stop"}
PULSE_WIDTH_S = 0.15

HOLDING_PART_COUNT = 0  # %QW0
COIL_READ_COUNT = 16

# --------------------------------------------------------------------------
# Historian
# --------------------------------------------------------------------------

# Bo trong bien nay thi gateway chay y het nhu truoc, chi la khong ghi gi
# xuong DB — cung mot kieu xuong thang nhu PLC va vision.
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
HISTORIAN_ASSET_CODE = os.getenv("HISTORIAN_ASSET_CODE", "CONVEYOR-01")
# Ghi lai mot lan sau moi khoang nay du khong co gi thay doi. Khong co no thi
# mot tag dung yen ca ca se khong co diem nao trong ca do, va bieu do khong
# phan biet duoc "dung yen" voi "mat ket noi".
HEARTBEAT_S = float(os.getenv("HISTORIAN_HEARTBEAT_S", "30"))
# StatusCode kieu OPC DA: gia tri doc duoc luc mat ket noi khong duoc phep lan
# vao thong ke nhu mot gia tri tot.
QUALITY_GOOD = 192
QUALITY_BAD = 24


# --------------------------------------------------------------------------
# Trang thai dung chung
# --------------------------------------------------------------------------


@dataclass
class PlcState:
    """Anh chup trang thai PLC gui cho moi consumer."""

    connected: bool = False
    outputs: dict[str, bool] = field(default_factory=dict)
    commands: dict[str, bool] = field(default_factory=dict)
    part_count: int = 0
    scan_ms: float = 0.0
    updated_at: float = 0.0
    error: str | None = None

    def payload(self) -> dict[str, Any]:
        return {
            "source": "openplc",
            "uns": UNS_BASE,
            "connected": self.connected,
            "outputs": self.outputs,
            "commands": self.commands,
            "partCount": self.part_count,
            "scanMs": round(self.scan_ms, 2),
            "updatedAt": int(self.updated_at * 1000),
            "error": self.error,
        }


state = PlcState()
subscribers: set[WebSocket] = set()
_broadcast_lock = asyncio.Lock()


async def broadcast(payload: dict[str, Any]) -> None:
    """Day trang thai toi moi trinh duyet dang mo. Client chet thi loai bo."""
    if not subscribers:
        return
    message = json.dumps(payload)
    dead: list[WebSocket] = []

    async with _broadcast_lock:
        for ws in subscribers:
            try:
                await ws.send_text(message)
            except Exception:  # noqa: BLE001 - client roi mang la binh thuong
                dead.append(ws)
        for ws in dead:
            subscribers.discard(ws)


# --------------------------------------------------------------------------
# MQTT
# --------------------------------------------------------------------------


class MqttBridge:
    def __init__(self) -> None:
        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2, client_id="smart-factory-gateway"
        )
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message
        # Death certificate: broker tu phat OFFLINE neu gateway mat ket noi.
        self.client.will_set(TOPIC_STATUS, "OFFLINE", qos=1, retain=True)
        self.connected = False
        self.command_queue: asyncio.Queue[tuple[str, bool]] | None = None
        self.loop: asyncio.AbstractEventLoop | None = None

    def start(self, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue) -> None:
        self.loop = loop
        self.command_queue = queue
        try:
            self.client.connect_async(MQTT_HOST, MQTT_PORT, keepalive=30)
            self.client.loop_start()
        except Exception as exc:  # noqa: BLE001
            log.warning("MQTT khong ket noi duoc: %s", exc)

    def stop(self) -> None:
        with contextlib.suppress(Exception):
            self.client.publish(TOPIC_STATUS, "OFFLINE", qos=1, retain=True)
            self.client.loop_stop()
            self.client.disconnect()

    def _on_connect(self, client, _userdata, _flags, reason_code, _props=None) -> None:
        if reason_code != 0:
            log.warning("MQTT tu choi ket noi: %s", reason_code)
            return
        self.connected = True
        log.info("MQTT da ket noi %s:%s", MQTT_HOST, MQTT_PORT)
        # Birth certificate — consumer biet gateway dang song.
        client.publish(TOPIC_STATUS, "ONLINE", qos=1, retain=True)
        # Lenh cung co the den tu Node-RED / he thong khac qua chinh bus nay.
        client.subscribe(f"{TOPIC_CMD}/#", qos=1)

    def _on_message(self, _client, _userdata, msg: mqtt.MQTTMessage) -> None:
        name = msg.topic.rsplit("/", 1)[-1]
        raw = msg.payload.decode("utf-8", "ignore").strip().lower()
        value = raw in {"1", "true", "on"}
        if name not in COMMAND_COILS:
            log.warning("Lenh MQTT khong hop le: %s", msg.topic)
            return
        if self.loop and self.command_queue:
            self.loop.call_soon_threadsafe(self.command_queue.put_nowait, (name, value))

    def publish_state(self, payload: dict[str, Any]) -> None:
        if not self.connected:
            return
        self.client.publish(TOPIC_STATE, json.dumps(payload), qos=0, retain=True)
        # Tung tag rieng mot topic: dung chuan UNS, tien cho Grafana/Node-RED
        # subscribe dung thu no can thay vi parse ca goi JSON.
        for name, value in payload["outputs"].items():
            self.client.publish(f"{TOPIC_METRIC}/{name}", int(value), qos=0, retain=True)
        self.client.publish(
            f"{TOPIC_METRIC}/part_count", payload["partCount"], qos=0, retain=True
        )


mqtt_bridge = MqttBridge()


# --------------------------------------------------------------------------
# Historian: ghi tag PLC xuong TimescaleDB
# --------------------------------------------------------------------------


class Historian:
    """Ghi theo lo, khong bao gio chan vong doc Modbus.

    Vong poll chay 200ms; mot INSERT dong bo trong do la cach chac chan nhat de
    bien mot truc trac cua DB thanh mot truc trac cua SCADA. Diem do duoc bo vao
    hang doi co gioi han roi mot task rieng do xuong bang COPY. Hang doi day thi
    bo diem cu nhat va dem lai — mat du lieu co kiem soat, va co bao ra /health.
    """

    def __init__(self, dsn: str) -> None:
        self.dsn = dsn
        self.pool: asyncpg.Pool | None = None
        self.buffer: deque[tuple[datetime, str, str, float, int]] = deque(maxlen=20000)
        self.written = 0
        self.dropped = 0
        self.last_error: str | None = None
        self._last_written: dict[str, float] = {}
        self._last_seen_at: dict[str, float] = {}

    @property
    def enabled(self) -> bool:
        return bool(self.dsn)

    async def connect(self) -> None:
        if not self.enabled:
            return
        try:
            self.pool = await asyncpg.create_pool(self.dsn, min_size=1, max_size=3)
            log.info("Historian da noi toi DB")
        except Exception as exc:  # noqa: BLE001
            self.last_error = str(exc)
            log.warning("Historian khong noi duoc DB: %s", exc)

    def record(self, metric: str, value: float, quality: int = QUALITY_GOOD) -> None:
        """Bao cao khi thay doi (exception reporting).

        Mot tag boolean dung yen ca ca ma van ghi 5 lan/giay se sinh ra hang
        trieu dong giong het nhau. Historian cong nghiep nao cung ghi khi gia
        tri doi, cong them mot nhip nen dinh ky de phan biet "khong doi" voi
        "mat ket noi".
        """
        if not self.enabled:
            return
        now = time.time()
        unchanged = self._last_written.get(metric) == value
        fresh = now - self._last_seen_at.get(metric, 0.0) < HEARTBEAT_S
        if unchanged and fresh and quality == QUALITY_GOOD:
            return

        if len(self.buffer) == self.buffer.maxlen:
            self.dropped += 1
        self.buffer.append(
            (datetime.now(timezone.utc), HISTORIAN_ASSET_CODE, metric, float(value), quality)
        )
        self._last_written[metric] = value
        self._last_seen_at[metric] = now

    def mark_disconnected(self) -> None:
        """Danh dau mot moc chat luong xau khi mat PLC.

        Khong lam viec nay thi bieu do noi thang qua khoang mat ket noi va nhin
        nhu may van chay binh thuong suot thoi gian do.
        """
        for metric in list(self._last_written):
            self.record(metric, self._last_written[metric], QUALITY_BAD)
        self._last_written.clear()

    async def flush(self) -> None:
        if not self.buffer or self.pool is None:
            return
        batch = [self.buffer.popleft() for _ in range(len(self.buffer))]
        try:
            async with self.pool.acquire() as conn:
                await conn.copy_records_to_table(
                    "telemetry",
                    records=batch,
                    columns=["ts", "asset_code", "metric", "value", "quality"],
                )
        except Exception as exc:  # noqa: BLE001
            space = (self.buffer.maxlen or 0) - len(self.buffer)
            if space < len(batch):
                self.dropped += len(batch) - space
                batch = batch[len(batch) - space :]
            self.buffer.extendleft(reversed(batch))
            self.last_error = str(exc)
            log.warning("Ghi telemetry that bai: %s", exc)
            return
        self.written += len(batch)
        self.last_error = None

    async def run(self) -> None:
        await self.connect()
        while True:
            await asyncio.sleep(1.0)
            await self.flush()

    async def close(self) -> None:
        await self.flush()
        if self.pool is not None:
            await self.pool.close()

    def payload(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "connected": self.pool is not None,
            "assetCode": HISTORIAN_ASSET_CODE,
            "queued": len(self.buffer),
            "written": self.written,
            "dropped": self.dropped,
            "lastError": self.last_error,
        }


historian = Historian(DATABASE_URL)


# --------------------------------------------------------------------------
# Vong doc Modbus
# --------------------------------------------------------------------------


class ModbusLink:
    def __init__(self) -> None:
        self.client: AsyncModbusTcpClient | None = None
        self._write_lock = asyncio.Lock()

    async def ensure_connected(self) -> bool:
        if self.client is not None and self.client.connected:
            return True
        if self.client is None:
            self.client = AsyncModbusTcpClient(PLC_HOST, port=PLC_PORT, timeout=2)
        with contextlib.suppress(Exception):
            await self.client.connect()
        return bool(self.client and self.client.connected)

    async def read_once(self) -> tuple[dict[str, bool], dict[str, bool], int]:
        assert self.client is not None
        coils = await self.client.read_coils(
            0, COIL_READ_COUNT, slave=PLC_UNIT_ID
        )
        if coils.isError():
            raise RuntimeError(f"read_coils loi: {coils}")

        regs = await self.client.read_holding_registers(
            HOLDING_PART_COUNT, 1, slave=PLC_UNIT_ID
        )
        if regs.isError():
            raise RuntimeError(f"read_holding_registers loi: {regs}")

        bits = coils.bits
        outputs = {name: bool(bits[addr]) for name, addr in OUTPUT_COILS.items()}
        commands = {name: bool(bits[addr]) for name, addr in COMMAND_COILS.items()}
        return outputs, commands, int(regs.registers[0])

    async def write_command(self, name: str, value: bool) -> None:
        coil = COMMAND_COILS[name]
        async with self._write_lock:
            if not await self.ensure_connected():
                raise RuntimeError("Khong ket noi duoc PLC")
            assert self.client is not None
            await self.client.write_coil(coil, value, slave=PLC_UNIT_ID)
            if name in MOMENTARY and value:
                # Nha nut ra sau mot xung ngan — dung logic tu giu trong ladder.
                await asyncio.sleep(PULSE_WIDTH_S)
                await self.client.write_coil(coil, False, slave=PLC_UNIT_ID)

    async def close(self) -> None:
        if self.client is not None:
            with contextlib.suppress(Exception):
                self.client.close()


link = ModbusLink()


async def poll_loop() -> None:
    """Doc PLC theo chu ky, phat ra khi co thay doi."""
    last_payload: str | None = None
    backoff = 1.0

    while True:
        started = time.perf_counter()
        try:
            if not await link.ensure_connected():
                raise RuntimeError(f"Khong ket noi duoc {PLC_HOST}:{PLC_PORT}")

            outputs, commands, part_count = await link.read_once()
            state.connected = True
            state.outputs = outputs
            state.commands = commands
            state.part_count = part_count
            state.error = None
            backoff = 1.0

            historian.record("conveyor", int(outputs["conveyor"]))
            historian.record("red_tower", int(outputs["red_tower"]))
            historian.record("green_tower", int(outputs["green_tower"]))
            historian.record("part_count", part_count)
            historian.record("estop", int(commands["estop"]))
        except Exception as exc:  # noqa: BLE001
            if state.connected or state.error is None:
                log.warning("Mat ket noi PLC: %s", exc)
                historian.mark_disconnected()
            state.connected = False
            state.error = str(exc)
            await link.close()
            link.client = None

        state.scan_ms = (time.perf_counter() - started) * 1000
        state.updated_at = time.time()

        payload = state.payload()
        # Bo qua truong thoi gian khi so sanh, neu khong moi vong deu "thay doi".
        signature = json.dumps(
            {k: v for k, v in payload.items() if k not in {"updatedAt", "scanMs"}}
        )
        if signature != last_payload:
            last_payload = signature
            await broadcast(payload)
            mqtt_bridge.publish_state(payload)

        if state.connected:
            await asyncio.sleep(POLL_INTERVAL_S)
        else:
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 10.0)


async def command_loop(queue: asyncio.Queue[tuple[str, bool]]) -> None:
    """Lenh den tu MQTT duoc xu ly tren event loop chinh."""
    while True:
        name, value = await queue.get()
        try:
            await link.write_command(name, value)
            log.info("Lenh MQTT '%s' = %s da ghi xuong PLC", name, value)
        except Exception as exc:  # noqa: BLE001
            log.warning("Ghi lenh '%s' that bai: %s", name, exc)


# --------------------------------------------------------------------------
# HTTP / WebSocket
# --------------------------------------------------------------------------

app = FastAPI(title="Smart Factory Edge Gateway", version="1.0.0")

# Mo CORS cho moi origin: day la cong cu lab chay tren may local, dashboard dev
# o cong 3000 va gateway o cong 8000 nen mac dinh se bi chan. Neu dem ra mang
# that thi phai khoa lai theo origin cu the.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class Command(BaseModel):
    name: str
    value: bool = True


@app.on_event("startup")
async def on_startup() -> None:
    queue: asyncio.Queue[tuple[str, bool]] = asyncio.Queue()
    mqtt_bridge.start(asyncio.get_running_loop(), queue)
    app.state.tasks = [
        asyncio.create_task(poll_loop()),
        asyncio.create_task(command_loop(queue)),
    ]
    if historian.enabled:
        app.state.tasks.append(asyncio.create_task(historian.run()))
    log.info("Gateway san sang — PLC %s:%s, UNS '%s'", PLC_HOST, PLC_PORT, UNS_BASE)


@app.on_event("shutdown")
async def on_shutdown() -> None:
    for task in getattr(app.state, "tasks", []):
        task.cancel()
    mqtt_bridge.stop()
    await historian.close()
    await link.close()


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "gateway": "ok",
        "plcConnected": state.connected,
        "mqttConnected": mqtt_bridge.connected,
        "uns": UNS_BASE,
        "error": state.error,
        "historian": historian.payload(),
    }


@app.get("/state")
async def get_state() -> dict[str, Any]:
    return state.payload()


@app.post("/command")
async def post_command(command: Command) -> dict[str, Any]:
    if command.name not in COMMAND_COILS:
        raise HTTPException(
            status_code=400,
            detail=f"Lenh khong hop le. Cho phep: {sorted(COMMAND_COILS)}",
        )
    try:
        await link.write_command(command.name, command.value)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"ok": True, "name": command.name, "value": command.value}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    subscribers.add(ws)
    # Gui ngay anh chup hien tai de UI khong phai cho vong poll ke tiep.
    await ws.send_text(json.dumps(state.payload()))
    try:
        while True:
            # Client co the gui lenh thang qua chinh socket nay.
            raw = await ws.receive_text()
            try:
                message = json.loads(raw)
                name = str(message.get("name", ""))
                value = bool(message.get("value", True))
            except (ValueError, AttributeError):
                continue
            if name not in COMMAND_COILS:
                log.warning("Lenh WebSocket khong hop le: %s", name)
                continue
            try:
                await link.write_command(name, value)
                log.info("Lenh WebSocket '%s' = %s da ghi xuong PLC", name, value)
            except Exception as exc:  # noqa: BLE001
                log.warning("Ghi lenh WebSocket '%s' that bai: %s", name, exc)
    except WebSocketDisconnect:
        pass
    finally:
        subscribers.discard(ws)
