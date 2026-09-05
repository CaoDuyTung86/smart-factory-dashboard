"""
First-out va cause-and-effect: canh bao nao keu TRUOC trong mot chuoi do day
chuyen.

Khi day chuyen do, canh bao khong den mot cai — chung den thanh chum. Man hinh
day kin trong vai giay, va cau hoi duy nhat dang gia luc do khong phai "dang co
gi keu" ma la "cai nao keu TRUOC". Bang dieu khien lo hoi va tua-bin da co mach
first-out chot rieng canh bao dau tien tu nhung nam 1960 vi dung ly do do.

Ba diem ky thuat, va ca ba deu la cho de lam sai:

1. **Thu tu KEU khong phai thu tu XAY RA.** Moi canh bao co on-delay rieng, nen
   mot nguyen nhan cho 6 giay se keu SAU mot hau qua cho 2 giay. Day khong phai
   truong hop hiem — no la he qua co he thong cua viec dat do tre khac nhau, va
   no dao nguoc dung cai ket luan ma first-out sinh ra de dua. Nen o day moi
   thu deu xep theo `onset` = luc keu TRU do tre, chu khong theo luc keu.

2. **Thu tu thoi gian khong chung minh duoc nhan qua.** No chi LOAI TRU (hau
   qua khong the xay ra truoc nguyen nhan). Muon noi A gay ra B thi phai co tri
   thuc ky thuat khai bao truoc, tuc bang `alarm_causal_link`. Suy nhan qua tu
   tuong quan thoi gian se bia ra mot chuoi nhan qua tu hai su co doc lap chi
   tinh co xay ra gan nhau.

3. **May do nao cung co gioi han phan giai.** Thiet bi SOE (sequence of events)
   cong nghiep duoc ban kem con so nay: 1 ms cho SOE dau day, 10-50 ms cho DCS
   thong thuong. O day nguon phan giai la nhip tick va buoc luong tu hoa cua
   on-delay. Hai canh bao cach nhau it hon mot nhip thi KHONG phan dinh duoc
   thu tu, va noi bua ra mot cai la sai nguy hiem hon la noi "khong biet" —
   nguoi van hanh se di sua nham may.

Module thuan: khong DB, khong dong ho he thong. `fetch()` chi lay so roi giao
lai, giong cach `alarm_metrics.py` duoc chia.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from historian import utcnow

# Khoang lang tach hai dot. Duoi moc nay thi cac canh bao con duoc coi la cung
# mot chuoi; qua moc nay la mot su co khac.
QUIET_GAP_SEC = 60.0

# Duoi bao nhieu canh bao thi khong goi la mot chuoi. Mot canh bao le loi khong
# can phan tich first-out — no tu la first-out cua chinh no.
MIN_EPISODE_SIZE = 2

# Tu bao nhieu canh bao khong giai thich duoc, trai tren bao nhieu may, thi
# nghi toi mot nguyen nhan chung thay vi mot chuoi lan truyen.
COMMON_CAUSE_MIN_ALARMS = 3
COMMON_CAUSE_MIN_ASSETS = 2


@dataclass(frozen=True)
class Annunciation:
    """Mot lan canh bao keu len truoc mat nguoi van hanh."""

    tag: str
    asset_code: str
    at: float  # epoch giay, luc KEU
    priority: str
    message: str
    on_delay_sec: float

    @property
    def onset(self) -> float:
        """Thoi diem DIEU KIEN bat dau, suy nguoc tu luc keu.

        Day la mot UOC LUONG chu khong phai mot so do. No chi chinh xac toi mot
        nhip tick, va do chinh la ly do `resolution_sec` ton tai o duoi.
        """
        return self.at - self.on_delay_sec


@dataclass(frozen=True)
class CausalLink:
    """Mot dong trong ma tran cause-and-effect. Tri thuc ky thuat khai bao tay."""

    cause_tag: str
    effect_tag: str
    max_propagation_sec: float
    mechanism: str
    note: str


def group_episodes(
    annunciations: list[Annunciation], quiet_gap_sec: float = QUIET_GAP_SEC
) -> list[list[Annunciation]]:
    """Cat danh sach thanh cac dot, ngan cach boi mot khoang lang.

    Gom theo `onset` chu khong theo luc keu: gom theo luc keu thi mot canh bao
    co on-delay 30 giay se bi day sang dot sau, tach khoi dung cai chuoi ma no
    thuoc ve.
    """
    ordered = sorted(annunciations, key=lambda a: (a.onset, a.tag))
    episodes: list[list[Annunciation]] = []
    for a in ordered:
        if episodes and a.onset - episodes[-1][-1].onset <= quiet_gap_sec:
            episodes[-1].append(a)
        else:
            episodes.append([a])
    return episodes


def _explain(
    member: Annunciation, episode: list[Annunciation], links: list[CausalLink]
) -> dict | None:
    """Tim mot nguyen nhan DA KHAI BAO cho `member` trong cung dot.

    Ba dieu kien phai du ca ba, va moi dieu kien chan mot kieu ket luan bay:

      * co dong khai bao trong ma tran C&E -> chan viec bia nhan qua tu thoi gian
      * nguyen nhan khoi phat KHONG SAU hau qua -> chan viec dao nguoc nhan qua
      * cach nhau trong `max_propagation_sec` -> chan viec ghep hai su co roi rac
    """
    ung_vien = []
    for link in links:
        if link.effect_tag != member.tag:
            continue
        for cause in episode:
            if cause.tag != link.cause_tag or cause is member:
                continue
            tre = member.onset - cause.onset
            if tre < 0 or tre > link.max_propagation_sec:
                continue
            ung_vien.append(
                {
                    "causeTag": cause.tag,
                    "mechanism": link.mechanism,
                    "note": link.note,
                    "lagSec": round(tre, 2),
                }
            )
    # Gan nhat ve thoi gian la ung vien tot nhat TRONG SO nhung cai da duoc khai
    # bao. Day la xep hang trong mot tap hop dung, khong phai suy nhan qua.
    return min(ung_vien, key=lambda c: c["lagSec"]) if ung_vien else None


def analyse_episode(
    episode: list[Annunciation],
    links: list[CausalLink],
    resolution_sec: float,
) -> dict:
    """Phan tich mot dot: ai keu truoc, ai la hau qua, con lai la gi."""
    theo_onset = sorted(episode, key=lambda a: (a.onset, a.tag))
    theo_luc_keu = sorted(episode, key=lambda a: (a.at, a.tag))
    dau = theo_onset[0]
    goc = dau.onset

    hang_theo_keu = {a.tag: i for i, a in enumerate(theo_luc_keu)}

    thanh_vien = []
    khong_giai_thich = []
    nguyen_nhan_cua: dict[str, str] = {}
    for i, a in enumerate(theo_onset):
        ly_do = None if i == 0 else _explain(a, theo_onset, links)
        if ly_do is not None:
            nguyen_nhan_cua[a.tag] = ly_do["causeTag"]
        thanh_vien.append(
            {
                "tag": a.tag,
                "assetCode": a.asset_code,
                "priority": a.priority,
                "message": a.message,
                "annunciatedAt": int(a.at * 1000),
                "onsetAt": int(a.onset * 1000),
                "onDelaySec": a.on_delay_sec,
                "offsetSec": round(a.onset - goc, 2),
                "rankByOnset": i,
                "rankByAnnunciation": hang_theo_keu[a.tag],
                "explainedBy": ly_do,
            }
        )
        if i > 0 and ly_do is None:
            khong_giai_thich.append(a)

    def la_hau_qua_cua_dau(tag: str) -> bool:
        """Lan nguoc chuoi nhan qua xem co ve toi first-out khong."""
        da_qua = set()
        while tag in nguyen_nhan_cua and tag not in da_qua:
            da_qua.add(tag)
            tag = nguyen_nhan_cua[tag]
            if tag == dau.tag:
                return True
        return False

    # Co phan dinh duoc thu tu khong? Hai duong, va duong thu hai moi la cho
    # ma tran C&E tra cong.
    #
    #   1. Bang DONG HO: canh bao thu hai khoi phat sau qua mot nhip phan giai.
    #   2. Bang TRI THUC KY THUAT: dong ho bo tay, nhung moi cai dong hang deu
    #      da duoc khai bao la HAU QUA cua chinh cai dau. Nhiet do vuot nguong
    #      canh bao va vuot nguong toi han gan nhu cung luc tren mot cu nhay
    #      nhiet, nen dong ho khong tach noi — nhung crit_temp > warn_temp la
    #      mot rang buoc cua cap nguong, khong phai mot gia thiet, nen thu tu
    #      van xac dinh duoc. Bo duong nay di thi he thong se noi "chua chac"
    #      ngay ca luc no biet chac.
    dong_hang = [
        a.tag
        for a in theo_onset[1:]
        if a.onset - goc <= resolution_sec and not la_hau_qua_cua_dau(a.tag)
    ]
    cach_biet = (theo_onset[1].onset - goc) if len(theo_onset) > 1 else None
    if cach_biet is not None and cach_biet > resolution_sec:
        can_cu = "TIMING"
    elif cach_biet is not None and not dong_hang:
        can_cu = "CAUSAL_MATRIX"
    else:
        can_cu = "NONE"
    phan_dinh_duoc = can_cu != "NONE"

    # Do tre co lam dao lon thu tu khong? Day la thu dang bao cao nhat: no noi
    # rang doc man hinh theo thu tu keu se dan toi mot ket luan KHAC.
    dao_thu_tu = [
        m["tag"] for m in thanh_vien if m["rankByOnset"] != m["rankByAnnunciation"]
    ]

    may_khong_giai_thich = {a.asset_code for a in khong_giai_thich}
    nghi_nguyen_nhan_chung = (
        len(khong_giai_thich) + 1 >= COMMON_CAUSE_MIN_ALARMS
        and len({dau.asset_code} | may_khong_giai_thich) >= COMMON_CAUSE_MIN_ASSETS
    )

    return {
        "startedAt": int(goc * 1000),
        "endedAt": int(max(a.at for a in episode) * 1000),
        "count": len(episode),
        "assets": sorted({a.asset_code for a in episode}),
        "firstOut": {
            "tag": dau.tag,
            "assetCode": dau.asset_code,
            "priority": dau.priority,
            "message": dau.message,
            "onsetAt": int(dau.onset * 1000),
            "annunciatedAt": int(dau.at * 1000),
            # Rong khi phan dinh duoc. Khong rong nghia la "mot trong nhung cai
            # nay", chu khong phai "cai nay".
            "tiedWith": dong_hang,
        },
        # Phan dinh duoc hay khong, va cach biet bao nhieu. Hai truong nay di
        # cung nhau: mot first-out khong phan dinh duoc van phai hien ra, nhung
        # phai hien kem loi canh bao rang no chua chac dung.
        "resolutionSec": resolution_sec,
        "separationSec": None if cach_biet is None else round(cach_biet, 2),
        "confident": phan_dinh_duoc,
        # Phan dinh nho dong ho, nho ma tran C&E, hay khong phan dinh duoc.
        "confidenceBasis": can_cu,
        "reorderedByDelay": dao_thu_tu,
        "members": thanh_vien,
        "unexplained": len(khong_giai_thich),
        "suspectedCommonCause": nghi_nguyen_nhan_chung,
    }


def analyse(
    annunciations: list[Annunciation],
    links: list[CausalLink],
    resolution_sec: float,
    quiet_gap_sec: float = QUIET_GAP_SEC,
    min_size: int = MIN_EPISODE_SIZE,
) -> list[dict]:
    """Gom thanh dot roi phan tich tung dot, moi nhat truoc."""
    ket_qua = [
        analyse_episode(ep, links, resolution_sec)
        for ep in group_episodes(annunciations, quiet_gap_sec)
        if len(ep) >= min_size
    ]
    ket_qua.sort(key=lambda e: e["startedAt"], reverse=True)
    return ket_qua


# ---------------------------------------------------------------------------
# Truy van
# ---------------------------------------------------------------------------


async def fetch(pool, hours: int = 8, resolution_sec: float = 1.5) -> dict:
    """Lay nhat ky va ma tran C&E tu DB roi giao cho `analyse()`."""
    end = utcnow()
    start = end - timedelta(hours=hours)

    async with pool.acquire() as conn:
        ann_rows = await conn.fetch(
            """
            SELECT tag, asset_code, extract(epoch FROM occurred_at) AS at,
                   priority, message, on_delay_sec
            FROM alarm_transition
            WHERE to_state = 'UNACK_ALM' AND occurred_at >= $1 AND occurred_at < $2
            ORDER BY occurred_at, id
            """,
            start,
            end,
        )
        link_rows = await conn.fetch(
            "SELECT cause_tag, effect_tag, max_propagation_sec, mechanism, note "
            "FROM alarm_causal_link"
        )

    annunciations = [
        Annunciation(
            tag=r["tag"],
            asset_code=r["asset_code"],
            at=float(r["at"]),
            priority=r["priority"],
            message=r["message"],
            on_delay_sec=float(r["on_delay_sec"]),
        )
        for r in ann_rows
    ]
    links = [
        CausalLink(
            cause_tag=r["cause_tag"],
            effect_tag=r["effect_tag"],
            max_propagation_sec=float(r["max_propagation_sec"]),
            mechanism=r["mechanism"],
            note=r["note"],
        )
        for r in link_rows
    ]

    return {
        "windowHours": hours,
        "resolutionSec": resolution_sec,
        "quietGapSec": QUIET_GAP_SEC,
        "linkCount": len(links),
        "episodes": analyse(annunciations, links, resolution_sec),
    }


__all__ = [
    "Annunciation",
    "CausalLink",
    "QUIET_GAP_SEC",
    "analyse",
    "analyse_episode",
    "fetch",
    "group_episodes",
]
