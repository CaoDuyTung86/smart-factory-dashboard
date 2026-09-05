"""
Quan ly canh bao theo ANSI/ISA-18.2 (Management of Alarm Systems for the
Process Industries).

Truoc dot nay, canh bao trong du an chi la mot co boolean `acknowledged` cong
mot index duy nhat trong DB de chong trung. Do la mot bang log, khong phai mot
he thong canh bao. Ba thu con thieu la ba thu ISA-18.2 sinh ra de giai quyet:

  1. **Vong doi day du.** Mot canh bao tu tat truoc khi ai kip nhin van phai
     duoc xac nhan — do la trang thai RTN_UNACK. Bo trang thai nay di thi mot
     su co thoang qua bien mat khong dau vet, va do dung la loai su co hay lap
     lai nhat.
  2. **Chong chattering co co so.** Deadband va do tre chua hai benh khac nhau
     (xem `_raw_condition` va `_debounce`), tron lam mot thi chua sai benh.
  3. **Shelving.** Nguoi van hanh phai co quyen tam tat mot canh bao dang keu
     lien tuc — neu khong ho se tat am thanh cua CA he thong, va do moi la cach
     mot he canh bao chet that su.

Module nay la mot may trang thai thuan: khong DB, khong dong ho he thong,
khong ngau nhien. Moi thu vao qua tham so, moi thu ra la mot danh sach
`Transition`. Nho vay kiem thu duoc tung nhanh mot bang thoi gian gia lap, va
tang tren (`line.py`, `service.py`) chi con viec bom so do vao va ghi nhat ky
ra.

Doi chieu voi ban TypeScript `src/features/factory/lib/isa18.ts`: hai ban phai
cho cung ket qua tren cung bo vector kiem thu, giong cach `oee.py` va `oee.ts`
duoc ghim vao nhau.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# Trang thai
# ---------------------------------------------------------------------------

# Bay trang thai cua ISA-18.2. Dung chuoi chu khong dung Enum de payload
# WebSocket va cot TEXT trong DB la cung mot gia tri, khong phai qua mot lop
# chuyen doi nao.
NORMAL = "NORMAL"
UNACK_ALM = "UNACK_ALM"
ACKED_ALM = "ACKED_ALM"
RTN_UNACK = "RTN_UNACK"
SHELVED = "SHELVED"
SUPPRESSED = "SUPPRESSED_BY_DESIGN"
OUT_OF_SERVICE = "OUT_OF_SERVICE"

ALL_STATES = (
    NORMAL,
    UNACK_ALM,
    ACKED_ALM,
    RTN_UNACK,
    SHELVED,
    SUPPRESSED,
    OUT_OF_SERVICE,
)

# Nhung trang thai xuat hien tren "alarm summary" — man hinh nguoi van hanh
# nhin. SHELVED / SUPPRESSED / OUT_OF_SERVICE co danh sach rieng: da tat khoi
# man hinh chinh thi cang phai nhin thay o cho khac, neu khong tat mot canh bao
# la lam no bien mat vinh vien.
ACTIVE_STATES = (UNACK_ALM, ACKED_ALM, RTN_UNACK)

# Ba trang thai "khong annunciate": ba duong khac nhau dan toi cung mot ket qua
# im lang, va ISA-18.2 co y tach ba vi ai co quyen bat/tat chung la khac nhau.
#   SHELVED         — nguoi van hanh, tam thoi, co han gio, tu bat lai
#   SUPPRESSED      — logic thiet ke (vi du: khong bao ap suat thap khi bom tat)
#   OUT_OF_SERVICE  — bao tri, khi thiet bi duoc thao ra sua
INHIBITED_STATES = (SHELVED, SUPPRESSED, OUT_OF_SERVICE)

# Muc uu tien. ISA-18.2 khong goi la "severity": muc uu tien la KET QUA cua
# rationalization — ham cua (hau qua neu khong xu ly) va (thoi gian con lai de
# xu ly). Hai canh bao cung hau qua nhung mot cai con 10 giay de phan ung, mot
# cai con 2 gio, thi khong cung muc.
PRIORITIES = ("DIAGNOSTIC", "LOW", "MEDIUM", "HIGH", "URGENT")
PRIORITY_RANK = {p: i for i, p in enumerate(PRIORITIES)}

COMPARISONS = ("HI", "HIHI", "LO", "LOLO", "BOOL")

# Han shelve mac dinh. ISA-18.2 bat buoc shelve phai co han va tu het han —
# shelve vinh vien chinh la cach mot canh bao bi tat roi khong ai nho de bat
# lai, va lan sau no keu that thi khong ai nghe thay.
DEFAULT_MAX_SHELVE_SEC = 8 * 3600

# Nguong chattering cua ISA-18.2: tu 3 lan annunciate tro len trong mot phut.
CHATTER_WINDOW_SEC = 60
CHATTER_THRESHOLD = 3
# Canh bao "stale": keu lien tuc qua 24 gio ma khong het.
STALE_AFTER_SEC = 24 * 3600


@dataclass(frozen=True)
class AlarmDefinition:
    """Cau hinh mot canh bao. Day la DU LIEU, khong phai ma nguon.

    Doi mot setpoint hay mot do tre la viec cua ky su quy trinh; bat ho doi
    lich build de sua mot con so la cach chac chan de khong ai sua, va thang
    tiep theo he canh bao lai day bao dong gia.

    `consequence` / `operator_response` / `response_time_sec` khong phai trang
    tri: ISA-18.2 doi moi canh bao phai qua rationalization va ghi lai ba thu
    do. Neu khong dien noi "nguoi van hanh phai LAM GI khi cai nay keu" thi do
    khong phai canh bao, do la mot su kien — va su kien thuoc ve nhat ky, khong
    thuoc ve man hinh canh bao.
    """

    tag: str
    asset_code: str
    metric: str
    comparison: str
    setpoint: float
    deadband: float
    on_delay_sec: float
    off_delay_sec: float
    priority: str
    alarm_class: str
    message: str
    unit: str = ""
    consequence: str = ""
    operator_response: str = ""
    response_time_sec: int = 0
    enabled: bool = True
    max_shelve_sec: float = DEFAULT_MAX_SHELVE_SEC

    def __post_init__(self) -> None:
        if self.comparison not in COMPARISONS:
            raise ValueError(f"{self.tag}: comparison khong hop le: {self.comparison}")
        if self.priority not in PRIORITY_RANK:
            raise ValueError(f"{self.tag}: priority khong hop le: {self.priority}")
        if self.deadband < 0:
            raise ValueError(f"{self.tag}: deadband khong duoc am")
        # Canh bao an toan khong duoc phep co do tre. Mot do tre 3 giay tren
        # E-Stop la ba giay nguoi van hanh khong biet may da dung — dat kiem
        # tra ngay o day de khong ai vo tinh cau hinh ra no.
        if self.alarm_class == "SAFETY" and self.on_delay_sec > 0:
            raise ValueError(f"{self.tag}: canh bao SAFETY khong duoc co on-delay")


@dataclass
class AlarmRuntime:
    """Trang thai song cua mot canh bao. Mot ban ghi cho moi `tag`."""

    tag: str
    state: str = NORMAL
    # `condition` la dieu kien tho SAU khi ap deadband, TRUOC khi ap do tre.
    # `active` la dieu kien da qua do tre — day moi la thu day may trang thai.
    # Tach hai bien vi deadband va do tre chua hai benh khac nhau; gop lam mot
    # thi khong con nhin ra cai nao dang giu canh bao lai.
    condition: bool = False
    active: bool = False
    pending_since: float | None = None
    clearing_since: float | None = None
    raised_at: float | None = None
    acked_at: float | None = None
    rtn_at: float | None = None
    shelved_until: float | None = None
    shelve_reason: str = ""
    value: float = 0.0
    # Moc thoi gian cua tung lan annunciate, dung cho phu hieu chattering.
    annunciations: list[float] = field(default_factory=list)


@dataclass(frozen=True)
class Transition:
    """Mot dong trong nhat ky canh bao.

    Moi chi so hieu nang o `alarm_metrics.py` deu tinh tu bang nay chu khong
    tinh tu danh sach canh bao dang song: danh sach dang song khong nho gi ve
    cai vua tat mot giay truoc, ma chattering thi chi nhin thay trong lich su.
    """

    tag: str
    asset_code: str
    at: float
    from_state: str
    to_state: str
    cause: str
    priority: str
    alarm_class: str
    message: str
    value: float | None = None
    unit: str = ""
    operator: str = ""
    # Do tre bat DANG CO HIEU LUC luc dong nay duoc ghi. Chep vao day chu khong
    # join sang cau hinh, cung ly do da chep `priority`: phan tich first-out
    # phai tru dung do tre luc do, khong phai do tre hom nay. Xem
    # `infra/mes/first_out.py`.
    on_delay_sec: float = 0.0
    # Ly do thao tac, hien chi dung cho shelve. ISA-18.2 doi shelving phai la
    # mot quy trinh co kiem soat; mot lan shelve khong ghi ly do chinh la dinh
    # nghia cua "unauthorized alarm suppression" — va do la mot chi so phai
    # dem duoc, nen ly do phai nam trong nhat ky chu khong chi trong bo nho.
    note: str = ""


# ---------------------------------------------------------------------------
# Dieu kien tho
# ---------------------------------------------------------------------------


def _raw_condition(defn: AlarmDefinition, value, was_true: bool) -> bool:
    """Ap deadband. Deadband CHI noi rong phia TAT, khong bao gio phia BAT.

    Canh bao HI bat tai `value > setpoint`, nhung chi tat khi
    `value < setpoint - deadband`. Lam nguoc lai (bat tai setpoint + deadband)
    la loi hay gap, va no lam cham chinh cai canh bao ma ky su vua dat setpoint
    cho no: nguoi ta chon 75 do vi 75 do la nguong, khong phai 78.
    """
    if defn.comparison == "BOOL":
        return bool(value)

    v = float(value)
    if defn.comparison in ("HI", "HIHI"):
        return v > defn.setpoint - defn.deadband if was_true else v > defn.setpoint
    return v < defn.setpoint + defn.deadband if was_true else v < defn.setpoint


def _debounce(defn: AlarmDefinition, rt: AlarmRuntime, now: float) -> None:
    """Ap on-delay / off-delay len dieu kien da qua deadband.

    Deadband chua benh "gia tri dao dong quanh dung setpoint"; do tre chua benh
    "gia tri nhay vot roi ve ngay". Hai benh khac nhau, va bien phap nay khong
    chua duoc benh kia: mot xung rung 0.2 giay vot len gap doi nguong thi
    deadband bao nhieu cung khong chan noi.

    Bo dem tre bat dau lai tu dau moi lan dieu kien doi chieu — do chinh la ly
    do mot xung thoang qua khong bao gio cham toi nguong on-delay.
    """
    cond = rt.condition

    if cond and not rt.active:
        if rt.pending_since is None:
            rt.pending_since = now
        rt.clearing_since = None
        if now - rt.pending_since >= defn.on_delay_sec:
            rt.active = True
            rt.pending_since = None
    elif cond and rt.active:
        rt.clearing_since = None
        rt.pending_since = None
    elif not cond and rt.active:
        if rt.clearing_since is None:
            rt.clearing_since = now
        rt.pending_since = None
        if now - rt.clearing_since >= defn.off_delay_sec:
            rt.active = False
            rt.clearing_since = None
    else:
        rt.pending_since = None
        rt.clearing_since = None


# ---------------------------------------------------------------------------
# May trang thai
# ---------------------------------------------------------------------------


class AlarmEngine:
    """Giu cau hinh + trang thai song cua toan bo canh bao tren mot day chuyen.

    Khong biet gi ve DB, ve WebSocket, ve dong ho he thong. `now` luon la tham
    so — day la thu lam cho toan bo hanh vi tre/shelve kiem thu duoc ma khong
    can `sleep`.
    """

    def __init__(self, definitions: list[AlarmDefinition] | None = None) -> None:
        self.definitions: dict[str, AlarmDefinition] = {}
        self.runtime: dict[str, AlarmRuntime] = {}
        for defn in definitions or []:
            self.add(defn)

    def add(self, defn: AlarmDefinition) -> None:
        self.definitions[defn.tag] = defn
        self.runtime.setdefault(defn.tag, AlarmRuntime(tag=defn.tag))

    # -------------------------------------------------------------- tien ich

    def _tx(
        self,
        defn: AlarmDefinition,
        rt: AlarmRuntime,
        at: float,
        to_state: str,
        cause: str,
        operator: str = "",
        note: str = "",
    ) -> Transition:
        tx = Transition(
            tag=defn.tag,
            asset_code=defn.asset_code,
            at=at,
            from_state=rt.state,
            to_state=to_state,
            cause=cause,
            priority=defn.priority,
            alarm_class=defn.alarm_class,
            message=defn.message,
            value=rt.value,
            unit=defn.unit,
            operator=operator,
            note=note,
            on_delay_sec=defn.on_delay_sec,
        )
        rt.state = to_state
        return tx

    def _annunciate(
        self, defn: AlarmDefinition, rt: AlarmRuntime, now: float, cause: str
    ) -> Transition:
        rt.raised_at = now
        rt.acked_at = None
        rt.rtn_at = None
        rt.annunciations.append(now)
        # Chi giu cua so mot gio: chi so chattering that su tinh tu nhat ky
        # trong DB, cai nay chi de bat mot phu hieu "dang rung" ngay tren man
        # hinh nguoi van hanh.
        cutoff = now - 3600
        rt.annunciations = [t for t in rt.annunciations if t >= cutoff]
        return self._tx(defn, rt, now, UNACK_ALM, cause)

    # -------------------------------------------------------------- danh gia

    def evaluate(
        self, now: float, readings: dict[tuple[str, str], float]
    ) -> list[Transition]:
        """Day toan bo canh bao di mot buoc.

        `readings` khoa theo `(asset_code, metric)`. Thieu so do thi canh bao do
        GIU NGUYEN trang thai chu khong tu tat: mat cam bien khong phai la bang
        chung rang moi thu da binh thuong tro lai.
        """
        out: list[Transition] = []
        for tag, defn in self.definitions.items():
            rt = self.runtime[tag]

            # Shelve het han duoc xu ly TRUOC khi doc so do: mot canh bao vua
            # het han shelve phai duoc danh gia lai ngay trong chinh vong nay
            # chu khong doi them mot vong nua.
            if (
                rt.state == SHELVED
                and rt.shelved_until is not None
                and now >= rt.shelved_until
            ):
                out.append(self._resume(defn, rt, now, "SHELVE_EXPIRED"))

            if not defn.enabled:
                continue

            value = readings.get((defn.asset_code, defn.metric))
            if value is None:
                continue
            rt.value = float(value)
            rt.condition = _raw_condition(defn, value, rt.condition)
            _debounce(defn, rt, now)

            # Da bi tat khoi man hinh thi van theo doi dieu kien (de luc bat lai
            # con biet dang tot hay dang xau) nhung khong annunciate.
            if rt.state in INHIBITED_STATES:
                continue

            if rt.state == NORMAL:
                if rt.active:
                    out.append(self._annunciate(defn, rt, now, "ALARM"))
            elif rt.state == UNACK_ALM:
                if not rt.active:
                    # Dieu kien het nhung chua ai xac nhan. Day chinh la trang
                    # thai ma mot he canh bao chi co co boolean se lam mat: su
                    # co tu het, va khong ai biet no da tung xay ra.
                    rt.rtn_at = now
                    out.append(self._tx(defn, rt, now, RTN_UNACK, "RTN"))
            elif rt.state == ACKED_ALM:
                if not rt.active:
                    rt.rtn_at = now
                    out.append(self._tx(defn, rt, now, NORMAL, "RTN"))
            elif rt.state == RTN_UNACK:
                if rt.active:
                    out.append(self._annunciate(defn, rt, now, "RE_ALARM"))
        return out

    # ------------------------------------------------ thao tac nguoi van hanh

    def acknowledge(self, tag: str, now: float, operator: str = "") -> Transition | None:
        defn = self.definitions.get(tag)
        if defn is None:
            return None
        rt = self.runtime[tag]
        if rt.state == UNACK_ALM:
            rt.acked_at = now
            return self._tx(defn, rt, now, ACKED_ALM, "ACK", operator)
        if rt.state == RTN_UNACK:
            # Xac nhan mot canh bao da tu het thi no ve han NORMAL: khong con gi
            # de xu ly nua, chi con viec da co nguoi nhin thay.
            rt.acked_at = now
            return self._tx(defn, rt, now, NORMAL, "ACK", operator)
        return None

    def acknowledge_asset(
        self, asset_code: str, now: float, operator: str = ""
    ) -> list[Transition]:
        out = []
        for tag, defn in self.definitions.items():
            if defn.asset_code == asset_code:
                tx = self.acknowledge(tag, now, operator)
                if tx is not None:
                    out.append(tx)
        return out

    def acknowledge_all(self, now: float, operator: str = "") -> list[Transition]:
        out = []
        for tag in list(self.definitions):
            tx = self.acknowledge(tag, now, operator)
            if tx is not None:
                out.append(tx)
        return out

    def shelve(
        self,
        tag: str,
        now: float,
        duration_sec: float,
        reason: str = "",
        operator: str = "",
    ) -> Transition | None:
        """Tam go mot canh bao khoi man hinh, co han gio.

        Han bi kep boi `max_shelve_sec` cua chinh canh bao do — khong phai moi
        canh bao duoc phep tat lau nhu nhau, va mot canh bao an toan thuong
        khong duoc phep shelve qua mot ca lam viec.
        """
        defn = self.definitions.get(tag)
        if defn is None:
            return None
        rt = self.runtime[tag]
        if rt.state in (SHELVED, OUT_OF_SERVICE):
            return None
        duration = max(0.0, min(float(duration_sec), defn.max_shelve_sec))
        if duration <= 0:
            return None
        rt.shelved_until = now + duration
        rt.shelve_reason = reason
        return self._tx(defn, rt, now, SHELVED, "SHELVE", operator, note=reason)

    def unshelve(self, tag: str, now: float, operator: str = "") -> Transition | None:
        defn = self.definitions.get(tag)
        if defn is None or self.runtime[tag].state != SHELVED:
            return None
        return self._resume(defn, self.runtime[tag], now, "UNSHELVE", operator)

    def suppress(self, tag: str, now: float, operator: str = "") -> Transition | None:
        defn = self.definitions.get(tag)
        if defn is None or self.runtime[tag].state == SUPPRESSED:
            return None
        return self._tx(defn, self.runtime[tag], now, SUPPRESSED, "SUPPRESS", operator)

    def unsuppress(self, tag: str, now: float, operator: str = "") -> Transition | None:
        defn = self.definitions.get(tag)
        if defn is None or self.runtime[tag].state != SUPPRESSED:
            return None
        return self._resume(defn, self.runtime[tag], now, "UNSUPPRESS", operator)

    def out_of_service(
        self, tag: str, now: float, operator: str = ""
    ) -> Transition | None:
        defn = self.definitions.get(tag)
        if defn is None or self.runtime[tag].state == OUT_OF_SERVICE:
            return None
        return self._tx(
            defn, self.runtime[tag], now, OUT_OF_SERVICE, "OUT_OF_SERVICE", operator
        )

    def in_service(self, tag: str, now: float, operator: str = "") -> Transition | None:
        defn = self.definitions.get(tag)
        if defn is None or self.runtime[tag].state != OUT_OF_SERVICE:
            return None
        return self._resume(defn, self.runtime[tag], now, "IN_SERVICE", operator)

    def _resume(
        self,
        defn: AlarmDefinition,
        rt: AlarmRuntime,
        now: float,
        cause: str,
        operator: str = "",
    ) -> Transition:
        """Quay lai man hinh sau khi het shelve / het suppress / vao lai service.

        Dieu kien con xau thi canh bao keu LAI tu dau va lai la chua xac nhan.
        Cho no ve thang NORMAL chi vi truoc do da co nguoi bam xac nhan la giau
        mot su co dang dien ra — dung cai ma shelving sinh ra de tranh.
        """
        rt.shelved_until = None
        rt.shelve_reason = ""
        if rt.active:
            return self._annunciate(defn, rt, now, cause)
        return self._tx(defn, rt, now, NORMAL, cause, operator)

    # --------------------------------------------------------------- doc ra

    def _entry(self, defn: AlarmDefinition, rt: AlarmRuntime, now: float) -> dict:
        return {
            "tag": defn.tag,
            "assetCode": defn.asset_code,
            "metric": defn.metric,
            "state": rt.state,
            "priority": defn.priority,
            "alarmClass": defn.alarm_class,
            "message": defn.message,
            "comparison": defn.comparison,
            "setpoint": defn.setpoint,
            "deadband": defn.deadband,
            "value": round(rt.value, 3),
            "unit": defn.unit,
            "raisedAt": None if rt.raised_at is None else int(rt.raised_at * 1000),
            "ackedAt": None if rt.acked_at is None else int(rt.acked_at * 1000),
            "rtnAt": None if rt.rtn_at is None else int(rt.rtn_at * 1000),
            "shelvedUntil": None
            if rt.shelved_until is None
            else int(rt.shelved_until * 1000),
            "shelveReason": rt.shelve_reason,
            "consequence": defn.consequence,
            "operatorResponse": defn.operator_response,
            "responseTimeSec": defn.response_time_sec,
            "maxShelveSec": defn.max_shelve_sec,
            # Dang chattering hay khong, theo dinh nghia cua ISA-18.2.
            "chattering": sum(
                1 for t in rt.annunciations if t >= now - CHATTER_WINDOW_SEC
            )
            >= CHATTER_THRESHOLD,
            # Canh bao "stale": keu lien tuc qua 24 gio ma khong het. ISA-18.2
            # dem rieng, vi mot canh bao khong bao gio tat la mot canh bao da
            # thanh mot phan cua phong nen — nguoi van hanh thoi nhin no.
            "stale": rt.state in (UNACK_ALM, ACKED_ALM)
            and rt.raised_at is not None
            and now - rt.raised_at >= STALE_AFTER_SEC,
        }

    def summary(self, now: float) -> list[dict]:
        """Danh sach canh bao tren man hinh nguoi van hanh.

        Sap theo (uu tien giam dan, moi nhat truoc) chu khong theo thoi gian
        thuan: khi 20 canh bao ap den cung luc, de thu tu thoi gian quyet dinh
        cai nguy hiem nhat nam o dau la chuyen may rui.
        """
        rows = [
            self._entry(self.definitions[tag], rt, now)
            for tag, rt in self.runtime.items()
            if rt.state in ACTIVE_STATES
        ]
        rows.sort(key=lambda r: (-PRIORITY_RANK[r["priority"]], -(r["raisedAt"] or 0)))
        return rows

    def inhibited(self, now: float) -> list[dict]:
        """Nhung canh bao dang bi tat: shelve / suppress / out-of-service.

        Bat buoc phai co man hinh nay. Tat mot canh bao ma khong co cho nao
        nhin lai duoc thi dung la da xoa no.
        """
        rows = [
            self._entry(self.definitions[tag], rt, now)
            for tag, rt in self.runtime.items()
            if rt.state in INHIBITED_STATES
        ]
        rows.sort(key=lambda r: (r["state"], r["tag"]))
        return rows

    def state_counts(self) -> dict[str, int]:
        counts = {s: 0 for s in ALL_STATES}
        for rt in self.runtime.values():
            counts[rt.state] += 1
        return counts

    def definition_rows(self) -> list[dict]:
        """Bang rationalization: moi canh bao kem ly do no ton tai.

        Day la thu ISA-18.2 goi la Master Alarm Database. De no lo ra API vi
        cau hoi "vi sao cai nay keu, va toi phai lam gi" phai tra loi duoc ngay
        tren man hinh, khong phai bang cach mo ma nguon.
        """
        return [
            {
                "tag": d.tag,
                "assetCode": d.asset_code,
                "metric": d.metric,
                "comparison": d.comparison,
                "setpoint": d.setpoint,
                "deadband": d.deadband,
                "onDelaySec": d.on_delay_sec,
                "offDelaySec": d.off_delay_sec,
                "priority": d.priority,
                "alarmClass": d.alarm_class,
                "message": d.message,
                "unit": d.unit,
                "consequence": d.consequence,
                "operatorResponse": d.operator_response,
                "responseTimeSec": d.response_time_sec,
                "maxShelveSec": d.max_shelve_sec,
                "enabled": d.enabled,
                "state": self.runtime[d.tag].state,
            }
            for d in sorted(
                self.definitions.values(),
                key=lambda d: (d.asset_code, -PRIORITY_RANK[d.priority], d.tag),
            )
        ]


def restore(engine: AlarmEngine, states: dict[str, dict]) -> None:
    """Nap lai trang thai canh bao sau khi khoi dong lai backend.

    Nhan moc thoi gian duoi dang epoch giay (float), khong phai `datetime`:
    module nay khong biet gi ve DB, va viec doi kieu la cua tang goi no.

    Tag co trong DB nhung khong con trong cau hinh thi bo qua — canh bao da bi
    go khoi Master Alarm Database khong duoc phep song lai chi vi con mot dong
    trang thai cu.
    """
    for tag, row in states.items():
        rt = engine.runtime.get(tag)
        if rt is None:
            continue
        state = row.get("state", NORMAL)
        rt.state = state if state in ALL_STATES else NORMAL
        rt.condition = bool(row.get("condition", False))
        rt.active = bool(row.get("active", False))
        rt.raised_at = row.get("raised_at")
        rt.acked_at = row.get("acked_at")
        rt.rtn_at = row.get("rtn_at")
        rt.shelved_until = row.get("shelved_until")
        rt.shelve_reason = row.get("shelve_reason") or ""
        rt.value = float(row.get("value") or 0.0)
        # `annunciations` co y KHONG duoc khoi phuc: no chi phuc vu phu hieu
        # "dang rung" trong mot phut vua qua, va sau mot lan khoi dong lai thi
        # cua so mot phut do da troi qua. Chi so chattering that su tinh tu
        # `alarm_transition`, va bang do khong mat gi khi backend restart.


def definition_from_row(row) -> AlarmDefinition:
    """Dung `AlarmDefinition` tu mot dong cua bang `alarm_definition`."""
    return AlarmDefinition(
        tag=row["tag"],
        asset_code=row["asset_code"],
        metric=row["metric"],
        comparison=row["comparison"],
        setpoint=float(row["setpoint"]),
        deadband=float(row["deadband"]),
        on_delay_sec=float(row["on_delay_sec"]),
        off_delay_sec=float(row["off_delay_sec"]),
        priority=row["priority"],
        alarm_class=row["alarm_class"],
        message=row["message"],
        unit=row["unit"] or "",
        consequence=row["consequence"] or "",
        operator_response=row["operator_response"] or "",
        response_time_sec=int(row["response_time_sec"] or 0),
        enabled=bool(row["enabled"]),
        max_shelve_sec=float(row["max_shelve_sec"]),
    )


__all__ = [
    "ACKED_ALM",
    "ACTIVE_STATES",
    "ALL_STATES",
    "CHATTER_THRESHOLD",
    "CHATTER_WINDOW_SEC",
    "INHIBITED_STATES",
    "NORMAL",
    "OUT_OF_SERVICE",
    "PRIORITIES",
    "PRIORITY_RANK",
    "RTN_UNACK",
    "SHELVED",
    "STALE_AFTER_SEC",
    "SUPPRESSED",
    "UNACK_ALM",
    "AlarmDefinition",
    "AlarmEngine",
    "AlarmRuntime",
    "Transition",
    "definition_from_row",
    "restore",
]
