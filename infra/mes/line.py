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

RANH GIOI QUAN TRONG: **canh bao khong phai interlock.** Trang thai may o day
do dieu kien qua trinh quyet dinh (nhiet do vuot toi han thi dung, E-Stop thi
dung), con `AlarmEngine` chi QUAN SAT cung nhung so do do roi bao cho nguoi.
Neu de trang thai may phu thuoc vao trang thai canh bao thi mot do tre 30 giay
dat de chong nhap nhay canh bao se bien thanh 30 giay may khong chiu chay lai
sau khi da sua xong. Trong nha may that, cat dien la viec cua mach an toan va
cua PLC; man hinh canh bao khong dieu khien gi ca.
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass, field, replace

from alarms import ACKED_ALM, UNACK_ALM, AlarmEngine, PRIORITY_RANK, Transition
from oee import OeeMetrics, compute_oee

TICK_MS_DEFAULT = 1500

FeedDensity = str  # 'LOW' | 'NORMAL' | 'HIGH'
MachineStatus = str  # 'running' | 'idle' | 'warning' | 'error'

DENSITY_FACTOR = {"LOW": 0.7, "NORMAL": 1.0, "HIGH": 1.4}

# Tram duy nhat hien co bo dem vat ly: bang tai chay tren OpenPLC. Cac tram
# con lai van la so lieu mo hinh, va payload noi ro dieu do qua `countSource`.
PLC_DRIVEN_ASSET = "SMT-LINE-01"

# Do tre khi tra trang thai may ve binh thuong. Rieng biet voi deadband cua
# canh bao: mot cai giu may khoi nhap nhay chay/dung, mot cai giu man hinh
# canh bao khoi nhap nhay. Hai muc dich khac nhau nen hai con so khac nhau.
STATUS_RECOVER_MARGIN_C = 3.0

# Do nong len khi day qua 2.0x, tinh theo ty le du dia nhiet cua may moi tick.
# Voi he so hoi quy 0.15, gia tri can bang la ~1.33 lan du dia: du de vuot
# nguong canh bao (warn) o toc do 3.0x nhung khong cham nguong toi han (crit).
SPEED_HEAT_GAIN = 0.2


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
    # Nut dung khan cap dang bi giu. La mot BIEN QUA TRINH chu khong phai mot
    # canh bao: canh bao E-Stop la thu doc bien nay, khong phai thu tao ra no.
    estop: bool = False
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
            "estop": self.estop,
        }


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
) -> Machine:
    """Day mot may di mot tick.

    Ham nay KHONG con sinh canh bao. Truoc day no vua mo phong qua trinh vua
    quyet dinh canh bao nao duoc keu, va hai viec do tron lam mot la ly do
    nguong canh bao tung nam rai rac trong than ham duoi dang `temp > 75`. Bay
    gio no chi lam mot viec: cho ra so do. `AlarmEngine` doc so do do.

    `plc_produced` la so san pham do PLC that dem duoc trong tick nay. Co gia
    tri thi no thay cho so lieu mo hinh: du lieu do duoc luon thang du lieu suy
    ra. Chi so luong bi thay, con nhiet do/rung van la mo phong — noi ro de
    khong ai tuong may nay da co cam bien that.
    """
    producing = machine.status in ("running", "warning")

    if not producing:
        # May dung van dot thoi gian san xuat theo ke hoach — chinh la thu keo
        # Availability xuong.
        return replace(
            machine,
            down_time_ms=machine.down_time_ms + tick_ms,
            last_updated=now_ms,
        )

    dt_sec = tick_ms / 1000
    # Hoi quy ve gia tri danh dinh giu nhiet do/rung dao dong quanh mot moc,
    # thay vi troi tu do.
    temp_pull = (machine.nominal_temp - machine.temperature) * 0.15
    vib_pull = (machine.nominal_vibration - machine.vibration) * 0.15
    over = max(0.0, line_speed - 2.0)
    # Day day qua 2.0x thi may nong len — va do la HAU QUA DO DUOC cua viec day
    # nhanh, khong phai mot canh bao bao lai cho nguoi van hanh dieu ho vua tu
    # tay lam. He so tinh theo DU DIA cua chinh may (warn - danh dinh) chu khong
    # phai mot so do co dinh: lo reflow con 17 do du dia, may gan linh kien con
    # 22 do, dung chung mot con so thi mot trong hai may khong bao gio bao.
    headroom = max(1.0, machine.warn_temp - machine.nominal_temp)
    new_temp = (
        machine.temperature
        + temp_pull
        + (rng.random() - 0.5) * 0.6
        + over * headroom * SPEED_HEAT_GAIN
    )
    new_vib = max(
        0.1,
        machine.vibration + vib_pull + (rng.random() - 0.5) * 0.1 + over * 0.15,
    )

    # Cong suat bam theo tai. Truoc day day la mot hang so doc tu DB va khong
    # bao gio doi — nghia la mot so do cham chet, va mot canh bao dat tren no
    # thi khong bao gio keu. Day toc do day len cao thi dong co an them dien,
    # va do la thu do duoc; day chinh la cach thay the canh bao "Line Speed
    # Overclocked" cu, von chi bao lai cho nguoi van hanh dieu ho vua tu tay
    # lam.
    load = 0.72 + 0.28 * line_speed * density_factor(density)
    power_target = machine.nominal_power * load
    new_power = machine.power_usage + (power_target - machine.power_usage) * 0.2 + (
        rng.random() - 0.5
    ) * machine.nominal_power * 0.01

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

    # Trang thai may: quyet dinh boi dieu kien qua trinh, khong boi canh bao.
    status = machine.status
    if machine.estop or new_temp > machine.crit_temp:
        status = "error"
    elif new_temp > machine.warn_temp or new_vib > machine.warn_vibration:
        status = "warning"
    elif (
        status == "warning"
        and new_temp < machine.warn_temp - STATUS_RECOVER_MARGIN_C
        and new_vib < machine.warn_vibration
    ):
        status = "running"

    return replace(
        machine,
        temperature=new_temp,
        vibration=new_vib,
        power_usage=new_power,
        output=machine.output + produced,
        defects=new_defects,
        run_time_ms=machine.run_time_ms + tick_ms,
        status=status,
        last_updated=now_ms,
        count_source=count_source,
    )


def readings_of(machines: list[Machine]) -> dict[tuple[str, str], float]:
    """So do dua vao `AlarmEngine`, khoa theo (ma tai san, ten so do).

    Ten so do trung voi ten metric trong historian va trong cot
    `alarm_definition.metric` — mot ten duy nhat di suot tu mo hinh qua canh
    bao xuong bieu do lich su, khong co bang anh xa nao o giua.
    """
    out: dict[tuple[str, str], float] = {}
    for m in machines:
        out[(m.id, "temperature")] = m.temperature
        out[(m.id, "vibration")] = m.vibration
        out[(m.id, "power_kw")] = m.power_usage
        out[(m.id, "estop")] = 1.0 if m.estop else 0.0
    return out


@dataclass
class LineModel:
    """Trang thai day chuyen + cac lenh dieu khien tu HMI."""

    machines: list[Machine]
    engine: AlarmEngine = field(default_factory=AlarmEngine)
    tick_ms: int = TICK_MS_DEFAULT
    line_speed: float = 1.0
    feed_density: FeedDensity = "NORMAL"
    rng: random.Random = field(default_factory=random.Random)

    # ------------------------------------------------------------- dieu khien

    def set_line_speed(self, speed: float) -> None:
        self.line_speed = max(0.5, min(3.0, round(float(speed), 1)))

    def set_feed_density(self, density: FeedDensity) -> None:
        if density in DENSITY_FACTOR:
            self.feed_density = density

    def machine(self, machine_id: str) -> Machine | None:
        return next((m for m in self.machines if m.id == machine_id), None)

    def trigger_fault(self, machine_id: str, fault_type: str) -> bool:
        """Dat may vao mot dieu kien hong. KHONG tu tao canh bao.

        Canh bao se do `AlarmEngine` sinh ra o tick ke tiep khi no doc duoc so
        do moi — va nho vay do tre on-delay, deadband va toan bo may trang thai
        deu duoc di qua that su, chu khong bi mot duong tat bo qua.
        """
        m = self.machine(machine_id)
        if m is None:
            return False
        idx = self.machines.index(m)

        if fault_type == "overheat":
            # Phai VUOT nguong toi han chu khong bang no: `v > setpoint`.
            self.machines[idx] = replace(m, temperature=m.crit_temp + 2.0, status="error")
        elif fault_type == "vibration":
            self.machines[idx] = replace(
                m, vibration=round(m.warn_vibration * 1.3, 2), status="error"
            )
        else:
            self.machines[idx] = replace(m, estop=True, status="error")
        return True

    def repair(self, machine_id: str) -> bool:
        """Sua may: dua dieu kien qua trinh ve binh thuong.

        CO Y khong xac nhan canh bao ho. Sua xong may khong lam bien mat viec
        da co mot su co xay ra; canh bao chuyen sang RTN_UNACK va van nam tren
        man hinh cho den khi co nguoi bam xac nhan. Do la toan bo ly do trang
        thai RTN_UNACK ton tai.
        """
        m = self.machine(machine_id)
        if m is None:
            return False
        idx = self.machines.index(m)
        self.machines[idx] = replace(
            m,
            temperature=m.nominal_temp,
            vibration=m.nominal_vibration,
            power_usage=m.nominal_power,
            estop=False,
            status="running",
        )
        return True

    # ------------------------------------------------ thao tac tren canh bao

    def acknowledge(self, tag: str, now_ms: int | None = None, operator: str = "") -> list[Transition]:
        tx = self.engine.acknowledge(tag, self._now_s(now_ms), operator)
        return [tx] if tx else []

    def acknowledge_asset(
        self, asset_code: str, now_ms: int | None = None, operator: str = ""
    ) -> list[Transition]:
        return self.engine.acknowledge_asset(asset_code, self._now_s(now_ms), operator)

    def acknowledge_all(self, now_ms: int | None = None, operator: str = "") -> list[Transition]:
        return self.engine.acknowledge_all(self._now_s(now_ms), operator)

    def shelve(
        self,
        tag: str,
        duration_sec: float,
        reason: str = "",
        operator: str = "",
        now_ms: int | None = None,
    ) -> list[Transition]:
        tx = self.engine.shelve(tag, self._now_s(now_ms), duration_sec, reason, operator)
        return [tx] if tx else []

    def unshelve(self, tag: str, now_ms: int | None = None, operator: str = "") -> list[Transition]:
        tx = self.engine.unshelve(tag, self._now_s(now_ms), operator)
        return [tx] if tx else []

    def set_out_of_service(
        self, tag: str, out: bool, now_ms: int | None = None, operator: str = ""
    ) -> list[Transition]:
        now = self._now_s(now_ms)
        tx = (
            self.engine.out_of_service(tag, now, operator)
            if out
            else self.engine.in_service(tag, now, operator)
        )
        return [tx] if tx else []

    @staticmethod
    def _now_s(now_ms: int | None) -> float:
        return (now_ms / 1000) if now_ms is not None else time.time()

    # ------------------------------------------------------------------- tick

    def tick(self, now_ms: int | None = None, plc_produced: int | None = None) -> list[Transition]:
        """Day day chuyen di mot tick. Tra ve cac chuyen trang thai canh bao.

        Tra ve chu khong tu ghi: `line.py` khong biet gi ve DB. Tang tren nhan
        danh sach nay roi ghi xuong `alarm_transition` — nho vay toan bo may
        trang thai kiem thu duoc ma khong can mot ket noi nao.
        """
        now_ms = now_ms if now_ms is not None else int(time.time() * 1000)
        next_machines: list[Machine] = []
        for m in self.machines:
            # Bo dem PLC that chi ap cho tram bang tai dang duoc dieu khien.
            produced = (
                plc_produced
                if (plc_produced is not None and m.id == PLC_DRIVEN_ASSET)
                else None
            )
            next_machines.append(
                advance(
                    m,
                    self.tick_ms,
                    self.line_speed,
                    self.feed_density,
                    self.rng,
                    now_ms,
                    plc_produced=produced,
                )
            )
        self.machines = next_machines
        return self.engine.evaluate(now_ms / 1000, readings_of(self.machines))

    # ------------------------------------------------------------------ doc ra

    def oee(self) -> OeeMetrics:
        return compute_oee(self.machines)

    def _names(self) -> dict[str, str]:
        return {m.id: m.name for m in self.machines}

    def _decorate(self, rows: list[dict]) -> list[dict]:
        names = self._names()
        return [{**r, "machineName": names.get(r["assetCode"], r["assetCode"])} for r in rows]

    def worst_priority(self, asset_code: str) -> str | None:
        """Muc uu tien cao nhat dang keu tren mot may, de to mau the may.

        Chi tinh UNACK_ALM va ACKED_ALM: RTN_UNACK nghia la dieu kien da het,
        chi con cho nguoi xac nhan — to do mot may da binh thuong tro lai la
        noi sai tinh trang day chuyen.
        """
        worst = None
        for tag, rt in self.engine.runtime.items():
            defn = self.engine.definitions[tag]
            if defn.asset_code != asset_code or rt.state not in (UNACK_ALM, ACKED_ALM):
                continue
            if worst is None or PRIORITY_RANK[defn.priority] > PRIORITY_RANK[worst]:
                worst = defn.priority
        return worst

    def payload(self, now_ms: int | None = None) -> dict:
        now = self._now_s(now_ms)
        return {
            "machines": [m.payload() for m in self.machines],
            "alarms": self._decorate(self.engine.summary(now)),
            # Danh sach canh bao dang bi tat di kem trong CUNG mot goi tin, khong
            # phai mot endpoint rieng ai nho thi goi. Da tat mot canh bao thi
            # phai nhin thay no o cho khac, neu khong la da xoa no.
            "inhibitedAlarms": self._decorate(self.engine.inhibited(now)),
            "alarmCounts": self.engine.state_counts(),
            "oee": self.oee().payload(),
            "lineSpeed": self.line_speed,
            "feedDensity": self.feed_density,
        }
