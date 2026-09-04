"""
Mo hinh day chuyen chay o phia server.

Truoc day toan bo viec nay chay trong trinh duyet (`sensorSimulator.ts`), keo
theo ba he qua: F5 la mat sach du lieu, hai tab mo cung luc thay hai day
chuyen khac nhau, va khong co lich su nao dai hon 40 diem trong RAM.

Chuyen xuong server thi nguon du lieu tro thanh mot: mot vong tick duy nhat,
ghi xuong TimescaleDB, phat cho moi trinh duyet dang mo. Frontend tro thanh
mot client thuan tuy — dung nhu quan he giua SCADA server va HMI that.

Van la du lieu MO PHONG, khong phai cam bien that. Cai that o day la duong
di: tick -> historian -> WebSocket -> nhieu client. Rieng bo dem san luong cua
tram SMT se lay tu bo dem PLC that khi gateway dang song (xem `plc_count`).
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass, field, replace

from oee import OeeMetrics, compute_oee

TICK_MS_DEFAULT = 1500

FeedDensity = str  # 'LOW' | 'NORMAL' | 'HIGH'
MachineStatus = str  # 'running' | 'idle' | 'warning' | 'error'

DENSITY_FACTOR = {"LOW": 0.7, "NORMAL": 1.0, "HIGH": 1.4}

# Tram duy nhat hien co bo dem vat ly: bang tai chay tren OpenPLC. Cac tram
# con lai van la so lieu mo hinh, va payload noi ro dieu do qua `countSource`.
PLC_DRIVEN_ASSET = "SMT-LINE-01"


@dataclass
class Machine:
    """Khop 1-1 voi interface `Machine` cua frontend, cong them nguong thiet bi.

    `id` chinh la asset_code chu khong phai mot khoa rieng: ma tai san la danh
    tinh cua may, dung chung tu telemetry qua routing toi unit_step. Mot khoa
    'm1' rieng cho giao dien chi tao them mot bang anh xa phai giu dong bo.
    """

    id: str
    name: str
    code: str
    category: str
    status: MachineStatus
    temperature: float
    vibration: float
    output: int
    defects: int
    power_usage: float
    target_output: int
    ideal_cycle_sec: float
    run_time_ms: float
    down_time_ms: float
    last_updated: int
    # Thong so danh dinh + nguong, doc tu bang `asset`.
    nominal_temp: float
    nominal_vibration: float
    nominal_power: float
    warn_temp: float
    crit_temp: float
    warn_vibration: float
    # 'model' = so do mo hinh sinh ra; 'plc' = bo dem cua PLC that.
    count_source: str = "model"

    def payload(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "code": self.code,
            "category": self.category,
            "status": self.status,
            "temperature": round(self.temperature, 1),
            "vibration": round(self.vibration, 2),
            "output": self.output,
            "defects": self.defects,
            "powerUsage": round(self.power_usage, 1),
            "targetOutput": self.target_output,
            "idealCycleSec": self.ideal_cycle_sec,
            "runTimeMs": round(self.run_time_ms),
            "downTimeMs": round(self.down_time_ms),
            "lastUpdated": self.last_updated,
            "countSource": self.count_source,
        }


@dataclass
class Alarm:
    id: str
    machine_id: str
    machine_name: str
    timestamp: int
    severity: str
    message: str
    value: float
    unit: str
    acknowledged: bool = False

    def payload(self) -> dict:
        return {
            "id": self.id,
            "machineId": self.machine_id,
            "machineName": self.machine_name,
            "timestamp": self.timestamp,
            "severity": self.severity,
            "message": self.message,
            "acknowledged": self.acknowledged,
            "value": self.value,
            "unit": self.unit,
        }


MAX_ALARMS = 15


def density_factor(density: FeedDensity) -> float:
    return DENSITY_FACTOR.get(density, 1.0)


def advance(
    machine: Machine,
    tick_ms: int,
    line_speed: float,
    density: FeedDensity,
    rng: random.Random,
    now_ms: int,
    plc_produced: int | None = None,
) -> tuple[Machine, list[tuple[str, str, float, str]]]:
    """Day mot may di mot tick. Tra ve may moi + danh sach canh bao can phat.

    Canh bao tra ve duoi dang tuple tho (severity, message, value, unit) de ham
    nay khong phu thuoc vao bo sinh id hay dong ho — nho vay kiem thu duoc bang
    mot `random.Random(seed)` va mot moc thoi gian co dinh.

    `plc_produced` la so san pham do PLC that dem duoc trong tick nay. Co gia
    tri thi no thay cho so lieu mo hinh: du lieu do duoc luon thang du lieu suy
    ra. Chi so luong bi thay, con nhiet do/rung van la mo phong — noi ro de
    khong ai tuong may nay da co cam bien that.
    """
    alarms: list[tuple[str, str, float, str]] = []
    producing = machine.status in ("running", "warning")

    if not producing:
        # May dung van dot thoi gian san xuat theo ke hoach — chinh la thu keo
        # Availability xuong.
        return (
            replace(
                machine,
                down_time_ms=machine.down_time_ms + tick_ms,
                last_updated=now_ms,
            ),
            alarms,
        )

    dt_sec = tick_ms / 1000
    # Hoi quy ve gia tri danh dinh giu nhiet do/rung dao dong quanh mot moc,
    # thay vi troi tu do.
    temp_pull = (machine.nominal_temp - machine.temperature) * 0.15
    vib_pull = (machine.nominal_vibration - machine.vibration) * 0.15
    over = max(0.0, line_speed - 2.0)
    new_temp = machine.temperature + temp_pull + (rng.random() - 0.5) * 0.6 + over * 1.6
    new_vib = max(
        0.1,
        machine.vibration + vib_pull + (rng.random() - 0.5) * 0.1 + over * 0.15,
    )

    if plc_produced is not None:
        produced = plc_produced
        count_source = "plc"
    else:
        # San luong bam theo ideal cycle time cua chinh may, tru di mot phan hao
        # hut hieu suat — nho vay he so Performance trong OEE do mot thu co that.
        efficiency = 0.86 + rng.random() * 0.12
        produced = int(
            (dt_sec / machine.ideal_cycle_sec)
            * line_speed
            * density_factor(density)
            * efficiency
        )
        count_source = "model"

    defect_rate = 0.004 + over * 0.09
    new_defects = machine.defects + sum(
        1 for _ in range(produced) if rng.random() < defect_rate
    )

    status = machine.status
    if line_speed > 2.5:
        status = "warning"
        alarms.append(
            (
                "warning",
                f"WARNING: Line Speed Overclocked ({line_speed}x) - Overheating!",
                round(new_temp, 1),
                "°C",
            )
        )
    elif new_temp > machine.warn_temp:
        status = "warning"
        alarms.append(
            (
                "warning",
                f"Warning: {machine.name} temperature above {machine.warn_temp}°C",
                round(new_temp, 1),
                "°C",
            )
        )
    elif new_vib > machine.warn_vibration:
        status = "warning"
        alarms.append(
            (
                "warning",
                f"Warning: {machine.name} vibration above {machine.warn_vibration} mm/s",
                round(new_vib, 2),
                "mm/s",
            )
        )
    elif (
        status == "warning"
        and new_temp < machine.warn_temp - 3
        and new_vib < machine.warn_vibration
        and line_speed <= 2.0
    ):
        # Tra ve binh thuong co tre (hysteresis) 3 do: neu tra ve ngay tai
        # nguong thi mot dao dong nho lam canh bao bat/tat lien tuc.
        status = "running"

    return (
        replace(
            machine,
            temperature=new_temp,
            vibration=new_vib,
            output=machine.output + produced,
            defects=new_defects,
            run_time_ms=machine.run_time_ms + tick_ms,
            status=status,
            last_updated=now_ms,
            count_source=count_source,
        ),
        alarms,
    )


@dataclass
class LineModel:
    """Trang thai day chuyen + cac lenh dieu khien tu HMI."""

    machines: list[Machine]
    tick_ms: int = TICK_MS_DEFAULT
    line_speed: float = 1.0
    feed_density: FeedDensity = "NORMAL"
    alarms: list[Alarm] = field(default_factory=list)
    rng: random.Random = field(default_factory=random.Random)
    _seq: int = 0

    # ------------------------------------------------------------- dieu khien

    def set_line_speed(self, speed: float) -> None:
        self.line_speed = max(0.5, min(3.0, round(float(speed), 1)))

    def set_feed_density(self, density: FeedDensity) -> None:
        if density in DENSITY_FACTOR:
            self.feed_density = density

    def machine(self, machine_id: str) -> Machine | None:
        return next((m for m in self.machines if m.id == machine_id), None)

    def trigger_fault(self, machine_id: str, fault_type: str) -> bool:
        m = self.machine(machine_id)
        if m is None:
            return False
        idx = self.machines.index(m)

        if fault_type == "overheat":
            value = m.crit_temp
            self._raise(
                m, "critical", f"CRITICAL: Thermal Overheat Detected! ({value}°C)", value, "°C"
            )
            self.machines[idx] = replace(m, temperature=value, status="error")
        elif fault_type == "vibration":
            value = round(m.warn_vibration * 1.3, 2)
            self._raise(
                m,
                "critical",
                f"CRITICAL: Mechanical Bearing Fault Vibration ({value} mm/s)",
                value,
                "mm/s",
            )
            self.machines[idx] = replace(m, vibration=value, status="error")
        else:
            self._raise(m, "critical", "CRITICAL: Manual Emergency Stop Triggered", 0, "N/A")
            self.machines[idx] = replace(m, status="error")
        return True

    def repair(self, machine_id: str) -> bool:
        m = self.machine(machine_id)
        if m is None:
            return False
        idx = self.machines.index(m)
        self.machines[idx] = replace(
            m,
            temperature=m.nominal_temp,
            vibration=m.nominal_vibration,
            status="running",
        )
        for a in self.alarms:
            if a.machine_id == machine_id:
                a.acknowledged = True
        return True

    def acknowledge(self, alarm_id: str) -> bool:
        for a in self.alarms:
            if a.id == alarm_id:
                a.acknowledged = True
                return True
        return False

    # ------------------------------------------------------------------- tick

    def tick(self, now_ms: int | None = None, plc_produced: int | None = None) -> None:
        now_ms = now_ms if now_ms is not None else int(time.time() * 1000)
        next_machines: list[Machine] = []
        for m in self.machines:
            # Bo dem PLC that chi ap cho tram bang tai dang duoc dieu khien.
            produced = plc_produced if (plc_produced is not None and m.id == PLC_DRIVEN_ASSET) else None
            advanced, raised = advance(
                m,
                self.tick_ms,
                self.line_speed,
                self.feed_density,
                self.rng,
                now_ms,
                plc_produced=produced,
            )
            next_machines.append(advanced)
            for severity, message, value, unit in raised:
                self._raise(advanced, severity, message, value, unit, now_ms)
        self.machines = next_machines

    def _raise(
        self,
        machine: Machine,
        severity: str,
        message: str,
        value: float,
        unit: str,
        now_ms: int | None = None,
    ) -> None:
        # Chong chattering: chi mot canh bao chua xac nhan cho moi (may, muc do).
        if any(
            a.machine_id == machine.id and a.severity == severity and not a.acknowledged
            for a in self.alarms
        ):
            return
        self._seq += 1
        now_ms = now_ms if now_ms is not None else int(time.time() * 1000)
        self.alarms.insert(
            0,
            Alarm(
                id=f"alarm-{now_ms}-{self._seq}",
                machine_id=machine.id,
                machine_name=machine.name,
                timestamp=now_ms,
                severity=severity,
                message=message,
                value=value,
                unit=unit,
            ),
        )
        del self.alarms[MAX_ALARMS:]

    # ------------------------------------------------------------------ doc ra

    def oee(self) -> OeeMetrics:
        return compute_oee(self.machines)

    def payload(self) -> dict:
        return {
            "machines": [m.payload() for m in self.machines],
            "alarms": [a.payload() for a in self.alarms],
            "oee": self.oee().payload(),
            "lineSpeed": self.line_speed,
            "feedDensity": self.feed_density,
        }
