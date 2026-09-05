"""
First-out va cause-and-effect.

Bo test nay chu yeu la cac cach de KET LUAN SAI, moi ca chan mot cach:
doc theo thu tu keu thay vi thu tu khoi phat, bia nhan qua tu do gan nhau ve
thoi gian, va noi chac mot thu tu ma dong ho khong phan dinh noi.
"""

from first_out import (
    Annunciation,
    CausalLink,
    analyse,
    analyse_episode,
    group_episodes,
)

T0 = 1_800_000_000.0  # moc epoch bat ky, cac ca deu tinh tuong doi tu day

# Do tre that trong `05-alarms.sql`: HI cho 6 giay, HIHI cho 2 giay.
ON_DELAY_HI = 6.0
ON_DELAY_HIHI = 2.0

TIER_LINK = CausalLink(
    cause_tag="REFLOW-OVEN-02.TEMP.HI",
    effect_tag="REFLOW-OVEN-02.TEMP.HIHI",
    max_propagation_sec=600,
    mechanism="THRESHOLD_TIER",
    note="Nguong toi han cao hon nguong canh bao.",
)


def ann(tag, at, on_delay, asset="REFLOW-OVEN-02", priority="MEDIUM"):
    return Annunciation(
        tag=tag,
        asset_code=asset,
        at=at,
        priority=priority,
        message=tag,
        on_delay_sec=on_delay,
    )


# --------------------------------------------------- do tre lam dao thu tu


def test_do_tre_bat_dao_nguoc_thu_tu_va_first_out_phai_sua_lai():
    """Ca nay lay tu nhat ky THAT do chinh he thong sinh ra o dot 8:

        06:51:17  REFLOW-OVEN-02.TEMP.HIHI  -> UNACK_ALM   (on-delay 2s)
        06:51:20  REFLOW-OVEN-02.TEMP.HI    -> UNACK_ALM   (on-delay 6s)

    HIHI keu truoc HI ba giay. Nhung ve vat ly nhiet do bat buoc phai vuot
    nguong canh bao truoc roi moi toi nguong toi han — khong co duong nao khac,
    vi crit_temp > warn_temp. Doc theo thu tu keu se chi sai thu pham.
    """
    hihi = ann("REFLOW-OVEN-02.TEMP.HIHI", T0 + 17, ON_DELAY_HIHI)
    hi = ann("REFLOW-OVEN-02.TEMP.HI", T0 + 20, ON_DELAY_HI)

    ep = analyse_episode([hihi, hi], [TIER_LINK], resolution_sec=0.5)

    assert ep["firstOut"]["tag"] == "REFLOW-OVEN-02.TEMP.HI"
    # Ca hai deu doi cho, nen ca hai deu phai bi danh dau la da dao thu tu.
    assert set(ep["reorderedByDelay"]) == {
        "REFLOW-OVEN-02.TEMP.HI",
        "REFLOW-OVEN-02.TEMP.HIHI",
    }


def test_khong_tru_do_tre_thi_first_out_ra_sai():
    """Doi chung cho ca tren: neu on-delay bang 0 het (tuc bo qua do tre), cung
    hai moc thoi gian do se cho ra ket luan nguoc lai. Day la ly do cot
    `on_delay_sec` duoc chep vao tung dong nhat ky."""
    hihi = ann("REFLOW-OVEN-02.TEMP.HIHI", T0 + 17, 0.0)
    hi = ann("REFLOW-OVEN-02.TEMP.HI", T0 + 20, 0.0)

    ep = analyse_episode([hihi, hi], [TIER_LINK], resolution_sec=0.5)

    assert ep["firstOut"]["tag"] == "REFLOW-OVEN-02.TEMP.HIHI"
    assert ep["reorderedByDelay"] == []


# ------------------------------------------------------ gioi han phan giai


def test_cach_nhau_duoi_mot_nhip_thi_khong_phan_dinh_duoc():
    """Loi tu choi tra loi. Hai canh bao khoi phat cach nhau 1 giay trong khi
    nhip tick la 1.5 giay: he thong khong biet cai nao truoc. Bua mot cai roi
    trinh bay nhu su that se dua nguoi van hanh di sua nham may."""
    a = ann("SMT-LINE-01.VIB.HI", T0 + 10, 0.0, asset="SMT-LINE-01")
    b = ann("CNC-MILL-03.VIB.HI", T0 + 11, 0.0, asset="CNC-MILL-03")

    ep = analyse_episode([a, b], [], resolution_sec=1.5)

    assert ep["separationSec"] == 1.0
    assert ep["confident"] is False
    # Van phai co first-out de hien ra, chi la kem co "chua chac".
    assert ep["firstOut"]["tag"] == "SMT-LINE-01.VIB.HI"


def test_cach_nhau_hon_mot_nhip_thi_phan_dinh_duoc():
    a = ann("SMT-LINE-01.VIB.HI", T0 + 10, 0.0, asset="SMT-LINE-01")
    b = ann("CNC-MILL-03.VIB.HI", T0 + 14, 0.0, asset="CNC-MILL-03")

    ep = analyse_episode([a, b], [], resolution_sec=1.5)

    assert ep["separationSec"] == 4.0
    assert ep["confident"] is True


# ------------------------------------------------------------ nhan qua


def test_hau_qua_duoc_giai_thich_khi_co_dong_khai_bao():
    hi = ann("REFLOW-OVEN-02.TEMP.HI", T0, 0.0)
    hihi = ann("REFLOW-OVEN-02.TEMP.HIHI", T0 + 30, 0.0)

    ep = analyse_episode([hi, hihi], [TIER_LINK], resolution_sec=1.5)

    hau_qua = ep["members"][1]
    assert hau_qua["tag"] == "REFLOW-OVEN-02.TEMP.HIHI"
    assert hau_qua["explainedBy"]["causeTag"] == "REFLOW-OVEN-02.TEMP.HI"
    assert hau_qua["explainedBy"]["mechanism"] == "THRESHOLD_TIER"
    assert hau_qua["explainedBy"]["lagSec"] == 30.0
    assert ep["unexplained"] == 0


def test_khong_co_dong_khai_bao_thi_khong_tu_suy_ra_nhan_qua():
    """Nhiet do va cong suat cung tang khi day toc do len, nhung do la HAI HAU
    QUA CUA MOT NGUYEN NHAN CHUNG chu khong phai cai nay gay ra cai kia. Khong
    co dong nao trong ma tran C&E thi khong duoc phep ghep, du chung keu cach
    nhau dung mot giay."""
    temp = ann("REFLOW-OVEN-02.TEMP.HI", T0, 0.0)
    power = ann("REFLOW-OVEN-02.PWR.HI", T0 + 1, 0.0, priority="LOW")

    ep = analyse_episode([temp, power], [TIER_LINK], resolution_sec=0.5)

    assert ep["members"][1]["explainedBy"] is None
    assert ep["unexplained"] == 1


def test_qua_max_propagation_thi_khong_con_ghep_duoc():
    """Mot canh bao keu sau nguyen nhan nua tieng khong phai hau qua cua no, du
    ma tran co noi gi. Khong co moc nay thi hai su co roi rac trong ca se bi
    noi thanh mot chuoi."""
    link = CausalLink(
        cause_tag="REFLOW-OVEN-02.TEMP.HI",
        effect_tag="REFLOW-OVEN-02.TEMP.HIHI",
        max_propagation_sec=10,
        mechanism="THRESHOLD_TIER",
        note="",
    )
    hi = ann("REFLOW-OVEN-02.TEMP.HI", T0, 0.0)
    hihi = ann("REFLOW-OVEN-02.TEMP.HIHI", T0 + 40, 0.0)

    ep = analyse_episode([hi, hihi], [link], resolution_sec=1.5)
    assert ep["members"][1]["explainedBy"] is None


def test_nhan_qua_khong_duoc_chay_nguoc_thoi_gian():
    """Neu HIHI khoi phat TRUOC HI thi HI khong the la nguyen nhan cua no, du
    ma tran khai bao dung chieu do."""
    hihi = ann("REFLOW-OVEN-02.TEMP.HIHI", T0, 0.0)
    hi = ann("REFLOW-OVEN-02.TEMP.HI", T0 + 5, 0.0)

    ep = analyse_episode([hihi, hi], [TIER_LINK], resolution_sec=1.5)

    assert ep["firstOut"]["tag"] == "REFLOW-OVEN-02.TEMP.HIHI"
    # HI la thanh vien thu hai, va khong co dong nao khai bao HIHI -> HI.
    assert ep["members"][1]["explainedBy"] is None


# --------------------------------------------------------- nguyen nhan chung


def test_nhieu_canh_bao_khong_giai_thich_duoc_tren_nhieu_may_la_nguyen_nhan_chung():
    """Day toc do day chuyen len 2.5x lam CA BON may nong len va an them dien
    cung luc. Do khong phai mot chuoi lan truyen tu may nay sang may kia, va
    truy nguyen theo kieu chuoi se dan nguoi van hanh di sai huong hoan toan.
    He thong khong doan nguyen nhan — no chi noi 'day khong phai mot chuoi'."""
    anns = [
        ann("SMT-LINE-01.TEMP.HI", T0 + 0, 0.0, asset="SMT-LINE-01"),
        ann("REFLOW-OVEN-02.TEMP.HI", T0 + 3, 0.0, asset="REFLOW-OVEN-02"),
        ann("CNC-MILL-03.TEMP.HI", T0 + 5, 0.0, asset="CNC-MILL-03"),
        ann("AOI-INSPECT-04.PWR.HI", T0 + 8, 0.0, asset="AOI-INSPECT-04"),
    ]
    ep = analyse_episode(anns, [TIER_LINK], resolution_sec=1.5)

    assert ep["unexplained"] == 3
    assert ep["suspectedCommonCause"] is True
    assert len(ep["assets"]) == 4


def test_chuoi_giai_thich_duoc_tren_mot_may_thi_khong_goi_la_nguyen_nhan_chung():
    hi = ann("REFLOW-OVEN-02.TEMP.HI", T0, 0.0)
    hihi = ann("REFLOW-OVEN-02.TEMP.HIHI", T0 + 20, 0.0)

    ep = analyse_episode([hi, hihi], [TIER_LINK], resolution_sec=1.5)
    assert ep["suspectedCommonCause"] is False


# ------------------------------------------------------------- gom thanh dot


def test_khoang_lang_tach_hai_dot():
    anns = [
        ann("SMT-LINE-01.TEMP.HI", T0, 0.0, asset="SMT-LINE-01"),
        ann("SMT-LINE-01.VIB.HI", T0 + 5, 0.0, asset="SMT-LINE-01"),
        # Cach 5 phut: mot su co khac han.
        ann("CNC-MILL-03.TEMP.HI", T0 + 305, 0.0, asset="CNC-MILL-03"),
        ann("CNC-MILL-03.VIB.HI", T0 + 310, 0.0, asset="CNC-MILL-03"),
    ]
    dot = group_episodes(anns, quiet_gap_sec=60)
    assert [len(e) for e in dot] == [2, 2]


def test_gom_dot_theo_onset_chu_khong_theo_luc_keu():
    """Hai canh bao khoi phat cach nhau 5 giay, nhung mot cai co on-delay 30
    giay nen keu tre. Gom theo luc keu voi khoang lang 20 giay se cat chung
    thanh hai dot va lam mat chinh cai chuoi can nhin."""
    som = ann("SMT-LINE-01.TEMP.HI", T0 + 0, 0.0, asset="SMT-LINE-01")
    tre = ann("SMT-LINE-01.PWR.HI", T0 + 35, 30.0, asset="SMT-LINE-01")

    assert tre.at - som.at == 35  # theo luc keu thi cach nhau 35 giay
    assert tre.onset - som.onset == 5  # theo onset thi chi cach 5 giay

    dot = group_episodes([som, tre], quiet_gap_sec=20)
    assert len(dot) == 1


def test_mot_canh_bao_le_loi_khong_phai_mot_chuoi():
    """Khong can phan tich first-out cho mot canh bao don — no tu la first-out
    cua chinh no, va do la mot dong nhieu tren man hinh."""
    le_loi = [ann("SMT-LINE-01.ESTOP", T0, 0.0, asset="SMT-LINE-01")]
    assert analyse(le_loi, [], resolution_sec=1.5) == []


def test_dot_moi_nhat_dung_dau():
    anns = [
        ann("SMT-LINE-01.TEMP.HI", T0, 0.0, asset="SMT-LINE-01"),
        ann("SMT-LINE-01.VIB.HI", T0 + 5, 0.0, asset="SMT-LINE-01"),
        ann("CNC-MILL-03.TEMP.HI", T0 + 305, 0.0, asset="CNC-MILL-03"),
        ann("CNC-MILL-03.VIB.HI", T0 + 310, 0.0, asset="CNC-MILL-03"),
    ]
    ket_qua = analyse(anns, [], resolution_sec=1.5)
    assert ket_qua[0]["firstOut"]["tag"] == "CNC-MILL-03.TEMP.HI"
    assert ket_qua[1]["firstOut"]["tag"] == "SMT-LINE-01.TEMP.HI"


def test_dong_hang_duoc_neu_ten_chu_khong_chi_dich_danh_mot_cai():
    """Day toc do day chuyen len lam CA BON may cung an them dien trong cung
    mot tick. Khong may nao khoi phat truoc ca. `firstOut` van phai co mot cai
    de hien, nhung `tiedWith` phai neu ten ba cai con lai — neu khong, mot ket
    qua thang nho thu tu chu cai se doc ra nhu mot ket luan ky thuat."""
    cung_luc = [
        ann("AOI-INSPECT-04.PWR.HI", T0, 30.0, asset="AOI-INSPECT-04"),
        ann("CNC-MILL-03.PWR.HI", T0, 30.0, asset="CNC-MILL-03"),
        ann("REFLOW-OVEN-02.PWR.HI", T0, 30.0, asset="REFLOW-OVEN-02"),
        ann("SMT-LINE-01.PWR.HI", T0, 30.0, asset="SMT-LINE-01"),
    ]
    ep = analyse_episode(cung_luc, [], resolution_sec=1.5)

    assert ep["confident"] is False
    assert len(ep["firstOut"]["tiedWith"]) == 3
    assert ep["firstOut"]["tag"] not in ep["firstOut"]["tiedWith"]


def test_phan_dinh_duoc_thi_khong_co_ai_dong_hang():
    a = ann("SMT-LINE-01.VIB.HI", T0, 0.0, asset="SMT-LINE-01")
    b = ann("CNC-MILL-03.VIB.HI", T0 + 10, 0.0, asset="CNC-MILL-03")
    ep = analyse_episode([a, b], [], resolution_sec=1.5)
    assert ep["confident"] is True
    assert ep["firstOut"]["tiedWith"] == []


# --------------------------------------- ma tran C&E go duoc the be tac cua dong ho


def test_ma_tran_cause_and_effect_phan_dinh_duoc_khi_dong_ho_bo_tay():
    """Mot cu nhay nhiet lam HI va HIHI khoi phat gan nhu cung luc — cach nhau
    0.99 giay trong khi nhip la 1.5 giay, tuc dong ho khong tach noi. Nhung
    crit_temp > warn_temp la mot RANG BUOC cua cap nguong chu khong phai mot
    gia thiet, nen thu tu van xac dinh duoc. Khong co duong nay thi he thong se
    noi 'chua chac' ngay ca luc no biet chac."""
    hi = ann("REFLOW-OVEN-02.TEMP.HI", T0 + 20, ON_DELAY_HI)
    hihi = ann("REFLOW-OVEN-02.TEMP.HIHI", T0 + 17, ON_DELAY_HIHI)

    ep = analyse_episode([hihi, hi], [TIER_LINK], resolution_sec=1.5)

    assert ep["separationSec"] == 1.0  # dong ho: nho hon mot nhip, khong tach noi
    assert ep["confident"] is True
    assert ep["confidenceBasis"] == "CAUSAL_MATRIX"
    assert ep["firstOut"]["tiedWith"] == []


def test_khong_co_dong_khai_bao_thi_the_be_tac_van_la_be_tac():
    """Doi chung: cung khoang cach thoi gian do, nhung khong co dong nao trong
    ma tran C&E. Khong duoc phep tu go the be tac bang cach doan."""
    a = ann("SMT-LINE-01.PWR.HI", T0, 0.0, asset="SMT-LINE-01")
    b = ann("CNC-MILL-03.PWR.HI", T0 + 0.99, 0.0, asset="CNC-MILL-03")

    ep = analyse_episode([a, b], [TIER_LINK], resolution_sec=1.5)

    assert ep["confident"] is False
    assert ep["confidenceBasis"] == "NONE"
    assert ep["firstOut"]["tiedWith"] == ["CNC-MILL-03.PWR.HI"]


def test_phan_dinh_bang_dong_ho_duoc_ghi_dung_can_cu():
    a = ann("SMT-LINE-01.VIB.HI", T0, 0.0, asset="SMT-LINE-01")
    b = ann("CNC-MILL-03.VIB.HI", T0 + 10, 0.0, asset="CNC-MILL-03")
    ep = analyse_episode([a, b], [], resolution_sec=1.5)
    assert ep["confidenceBasis"] == "TIMING"
