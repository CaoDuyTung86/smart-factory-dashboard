"""
Thuat toan AOI: can anh theo fiducial -> so voi anh mau -> phan dinh OK/NG.

Vi sao khong dung deep learning? Vi may AOI cong nghiep that phan lon khong
dung. Mot day chuyen moi chay chua co du anh loi de huan luyen; ky su quy
trinh can biet TAI SAO mot bo mach bi loai de chinh may, chu khong chi can mot
con so xac suat; va khi khach hang doi mot linh kien thi phai sua duoc chuong
trinh kiem tra trong buoi sang chu khong phai gan nhan lai vai nghin anh.
Template matching + so anh mau dap ung duoc ca ba, va moi ket luan deu chi ra
duoc bang chung hinh anh cu the.

Trinh tu, dung thu tu cua mot may AOI that:

  1. Tim fiducial (mark point) bang HoughCircles.
  2. Tu 2 fiducial suy ra goc xoay (atan2) va he so ty le, dung ma tran
     affine, warpAffine dua anh chup ve dung khung cua anh mau.
  3. Voi tung o kiem tra: matchTemplate (NCC) -> diem khop + do lech vi tri.
  4. absdiff voi anh mau tai vi tri khop tot nhat -> threshold -> findContours
     -> boundingRect, de bat dinh thiec / vat la ngay trong o linh kien.
  5. Quet phan con lai cua bo mach de bat vat la roi ngoai moi o.

Buoc 1-2 la buoc khong the bo. Bo mach tren bang tai khong bao gio nam dung
mot cho; so anh chup thang voi anh mau ma khong can truoc thi lech 3 pixel la
ca bo mach bao loi.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass

import cv2
import numpy as np

from recipe import ComponentSpec, Recipe

# Nguong nhi phan cho anh sai khac. Duoi muc nay coi la nhieu cam bien va
# sai lech chieu sang, khong phai loi.
_DIFF_THRESHOLD = 42
_BLUR_KERNEL = (5, 5)


# --------------------------------------------------------------------------
# Ket qua
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Fiducial:
    x: float
    y: float
    found: bool


@dataclass(frozen=True)
class Alignment:
    """Ket qua can anh — tu the that cua bo mach so voi anh mau."""

    ok: bool
    theta_deg: float
    scale: float
    dx: float
    dy: float
    residual_px: float
    """Sai so con lai sau khi can. Lon nghia la fiducial tim duoc khong dang tin."""

    fiducials: tuple[Fiducial, ...] = ()


@dataclass(frozen=True)
class ComponentResult:
    ref: str
    name: str
    kind: str
    status: str  # OK | NG
    issue: str | None
    score: float  # 0..1, diem khop NCC
    offset_px: tuple[int, int]
    defect_area_ratio: float
    box: tuple[int, int, int, int]
    """Vi tri thuc te tim thay tren anh da can, tinh bang pixel."""


@dataclass(frozen=True)
class ForeignObject:
    box: tuple[int, int, int, int]
    area_px: int


@dataclass(frozen=True)
class InspectionResult:
    result: str  # PASS | FAIL
    alignment: Alignment
    components: tuple[ComponentResult, ...]
    foreign: tuple[ForeignObject, ...]
    cycle_time_ms: int


# --------------------------------------------------------------------------
# Buoc 1 — tim fiducial
# --------------------------------------------------------------------------


def find_fiducials(
    gray: np.ndarray, recipe: Recipe
) -> list[tuple[float, float]]:
    """
    Tim cac mark point tron bang bien doi Hough.

    Tra ve danh sach tam vong tron, da ghep voi vi tri chuan trong recipe theo
    thu tu. Thieu bat ky diem nao thi tra ve danh sach ngan hon — ben goi phai
    xu ly, khong duoc doan bua.
    """
    rmin, rmax = recipe.fiducial_search_radius
    blurred = cv2.medianBlur(gray, 5)

    circles = cv2.HoughCircles(
        blurred,
        cv2.HOUGH_GRADIENT,
        dp=1,
        # Hai fiducial khong bao gio sat nhau; ep khoang cach toi thieu lon
        # giup loai bot vong tron gia tren pad va lo khoan.
        minDist=min(recipe.width, recipe.height) // 4,
        param1=110,
        param2=18,
        minRadius=rmin,
        maxRadius=rmax,
    )

    if circles is None:
        return []

    found = [(float(c[0]), float(c[1])) for c in np.round(circles[0]).astype(int)]
    return _pair_with_nominal(found, recipe.fiducials)


def _pair_with_nominal(
    found: list[tuple[float, float]],
    nominal: tuple[tuple[int, int], ...],
) -> list[tuple[float, float]]:
    """
    Gan moi fiducial tim duoc voi diem chuan gan no nhat.

    HoughCircles tra ve vong tron theo thu tu tuy y, con phep can anh thi phu
    thuoc vao viec ghep dung cap. Bo mach chi lech vai pixel va vai do nen
    "gan nhat" la du; neu bo mach co the vao nguoc chieu thi phai doi sang
    ghep theo khoang cach giua cac fiducial.
    """
    used: set[int] = set()
    paired: list[tuple[float, float]] = []

    for nx, ny in nominal:
        best_i = -1
        best_d = float("inf")
        for i, (fx, fy) in enumerate(found):
            if i in used:
                continue
            d = math.hypot(fx - nx, fy - ny)
            if d < best_d:
                best_d = d
                best_i = i
        if best_i < 0:
            break
        used.add(best_i)
        paired.append(found[best_i])

    return paired


# --------------------------------------------------------------------------
# Buoc 2 — can anh
# --------------------------------------------------------------------------


def solve_alignment(
    found: list[tuple[float, float]], recipe: Recipe
) -> tuple[Alignment, np.ndarray | None]:
    """
    Suy ra phep bien doi dua anh chup ve khung cua anh mau, tu 2 fiducial.

    Hai diem cho du thong tin cho mot phep bien doi dong dang: goc xoay tu
    hieu hai atan2, he so ty le tu ty so khoang cach, tinh tien tu phan con
    lai. Khong dung homography vi bo mach phang va camera vuong goc — 4 tham
    so la du, them tham so chi lam ket qua kem on dinh.
    """
    nominal = recipe.fiducials

    if len(found) < 2:
        marks = tuple(
            Fiducial(float(nx), float(ny), False) for nx, ny in nominal
        )
        return (
            Alignment(False, 0.0, 1.0, 0.0, 0.0, float("inf"), marks),
            None,
        )

    (p0x, p0y), (p1x, p1y) = nominal[0], nominal[1]
    (q0x, q0y), (q1x, q1y) = found[0], found[1]

    nominal_angle = math.atan2(p1y - p0y, p1x - p0x)
    found_angle = math.atan2(q1y - q0y, q1x - q0x)
    theta = found_angle - nominal_angle  # bo mach dang xoay bao nhieu

    nominal_len = math.hypot(p1x - p0x, p1y - p0y)
    found_len = math.hypot(q1x - q0x, q1y - q0y)
    if nominal_len <= 0 or found_len <= 0:
        marks = tuple(Fiducial(qx, qy, True) for qx, qy in found)
        return (
            Alignment(False, 0.0, 1.0, 0.0, 0.0, float("inf"), marks),
            None,
        )

    scale = found_len / nominal_len

    # Phep bien doi nguoc: xoay -theta, thu nho 1/scale, roi tinh tien sao cho
    # fiducial dau tien roi dung vao vi tri chuan cua no.
    s = 1.0 / scale
    cos_t = math.cos(-theta) * s
    sin_t = math.sin(-theta) * s

    tx = p0x - (cos_t * q0x - sin_t * q0y)
    ty = p0y - (sin_t * q0x + cos_t * q0y)

    m = np.array([[cos_t, -sin_t, tx], [sin_t, cos_t, ty]], dtype=np.float64)

    # Sai so con lai: fiducial thu hai co roi dung cho khong. Neu khong thi
    # thu tim duoc khong phai fiducial that.
    mapped_x = cos_t * q1x - sin_t * q1y + tx
    mapped_y = sin_t * q1x + cos_t * q1y + ty
    residual = math.hypot(mapped_x - p1x, mapped_y - p1y)

    marks = tuple(Fiducial(qx, qy, True) for qx, qy in found)
    alignment = Alignment(
        ok=residual < 2.0,
        theta_deg=math.degrees(theta),
        scale=scale,
        dx=q0x - p0x,
        dy=q0y - p0y,
        residual_px=residual,
        fiducials=marks,
    )
    return alignment, m


def warp_to_golden(
    img: np.ndarray, m: np.ndarray, recipe: Recipe
) -> np.ndarray:
    return cv2.warpAffine(
        img,
        m,
        (recipe.width, recipe.height),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE,
    )


# --------------------------------------------------------------------------
# Buoc 3-4 — kiem tra tung o
# --------------------------------------------------------------------------


def _diff_mask(a_bgr: np.ndarray, b_bgr: np.ndarray) -> np.ndarray:
    """
    Anh nhi phan cua phan sai khac giua hai anh MAU.

    So theo mau chu khong theo do sang, va day khong phai chi tiet nho: mot
    soi day do (B30 G30 R190) tren son phu xanh (B58 G92 R40) chuyen sang anh
    xam chi lech 5 muc — gan nhu tang hinh. Tren bo mach that, mau moi la thu
    phan biet duoc thiec (xam), son phu (xanh), dong (vang) va vat la; bo mau
    di la tu bit mat mot nua thong tin. Lay chenh lech lon nhat trong ba kenh
    de mot kenh doi manh la du bao loi.

    Lam mo truoc khi tru de nhieu cam bien va lech mot pixel khong bien thanh
    vien trang quanh moi canh. Mo hinh thai hoc sau do xoa cac dom le.
    """
    a_blur = cv2.GaussianBlur(a_bgr, _BLUR_KERNEL, 0)
    b_blur = cv2.GaussianBlur(b_bgr, _BLUR_KERNEL, 0)
    diff = cv2.absdiff(a_blur, b_blur)
    if diff.ndim == 3:
        diff = diff.max(axis=2)
    _, mask = cv2.threshold(diff, _DIFF_THRESHOLD, 255, cv2.THRESH_BINARY)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    return cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)


def inspect_component(
    aligned_bgr: np.ndarray,
    golden_bgr: np.ndarray,
    aligned_gray: np.ndarray,
    golden_gray: np.ndarray,
    comp: ComponentSpec,
) -> ComponentResult:
    """Kiem tra mot o: co dung linh kien khong, dat dung cho khong, co ban khong."""
    x, y, w, h = comp.roi
    template = golden_gray[y : y + h, x : x + w]

    margin = comp.search_margin_px
    x0 = max(0, x - margin)
    y0 = max(0, y - margin)
    x1 = min(aligned_gray.shape[1], x + w + margin)
    y1 = min(aligned_gray.shape[0], y + h + margin)
    window = aligned_gray[y0:y1, x0:x1]

    if window.shape[0] < h or window.shape[1] < w:
        return ComponentResult(
            comp.ref,
            comp.name,
            comp.kind,
            "NG",
            "Ô kiểm tra nằm ngoài ảnh sau khi căn",
            0.0,
            (0, 0),
            1.0,
            comp.roi,
        )

    # NCC (TM_CCOEFF_NORMED) chu khong phai sai khac tuyet doi: no chuan hoa
    # theo trung binh va do lech chuan, nen den sang thay doi khong keo diem
    # khop xuong. Anh sang tren day chuyen that khong bao gio on dinh.
    res = cv2.matchTemplate(window, template, cv2.TM_CCOEFF_NORMED)
    _, max_val, _, max_loc = cv2.minMaxLoc(res)
    score = float(max_val)

    # Vi tri tim thay so voi vi tri mong doi.
    off_x = max_loc[0] + x0 - x
    off_y = max_loc[1] + y0 - y

    found_x = x + off_x
    found_y = y + off_y

    # So anh tai dung vi tri tim thay duoc, de loi dat lech khong bi cong don
    # sang thanh loi "co vat la".
    patch = aligned_bgr[found_y : found_y + h, found_x : found_x + w]
    golden_patch = golden_bgr[y : y + h, x : x + w]
    if patch.shape != golden_patch.shape:
        area_ratio = 1.0
    else:
        mask = _diff_mask(patch, golden_patch)
        area_ratio = float(np.count_nonzero(mask)) / float(w * h)

    shift = math.hypot(off_x, off_y)

    # Thu tu phan dinh di tu loi nang nhat: thieu linh kien thi khong con y
    # nghia gi de noi ve do lech cua no.
    #
    # Cau chu o day hien thang len HMI nen viet tieng Viet co dau, khac voi
    # comment trong infra/ (ASCII de khong phu thuoc bang ma cua terminal).
    status, issue = "OK", None
    if score < comp.match_threshold:
        status = "NG"
        issue = (
            f"Thiếu linh kiện hoặc đặt nhầm loại "
            f"(điểm khớp {score * 100:.1f}% < ngưỡng "
            f"{comp.match_threshold * 100:.0f}%)"
        )
    elif shift > comp.shift_tolerance_px:
        status = "NG"
        issue = (
            f"Lệch chân {shift:.1f}px "
            f"(dung sai {comp.shift_tolerance_px}px), offset ({off_x:+d}, {off_y:+d})"
        )
    elif area_ratio > comp.defect_area_ratio:
        status = "NG"
        issue = (
            f"Dính thiếc / vật lạ trong ô linh kiện: "
            f"{area_ratio * 100:.1f}% diện tích sai khác so với ảnh mẫu"
        )

    return ComponentResult(
        ref=comp.ref,
        name=comp.name,
        kind=comp.kind,
        status=status,
        issue=issue,
        score=score,
        offset_px=(int(off_x), int(off_y)),
        defect_area_ratio=area_ratio,
        box=(int(found_x), int(found_y), int(w), int(h)),
    )


# --------------------------------------------------------------------------
# Buoc 5 — vat la ngoai cac o linh kien
# --------------------------------------------------------------------------


def find_foreign_objects(
    aligned_bgr: np.ndarray, golden_bgr: np.ndarray, recipe: Recipe
) -> list[ForeignObject]:
    """
    Quet phan bo mach khong thuoc o linh kien nao.

    Day la thu ma kiem tra tung o bo sot: mot manh thiec vun hay soi day roi
    giua hai linh kien khong nam trong ROI nao ca, nhung van gay ngan mach.
    """
    mask = _diff_mask(aligned_bgr, golden_bgr)

    # Che cac o linh kien lai — phan do da duoc kiem tra ky hon o buoc truoc.
    for comp in recipe.components:
        x, y, w, h = comp.roi
        pad = comp.search_margin_px
        cv2.rectangle(
            mask,
            (max(0, x - pad), max(0, y - pad)),
            (x + w + pad, y + h + pad),
            0,
            -1,
        )

    # Vien anh luon nhieu sau khi warp (borderMode nhan ban diem bien).
    border = 12
    cv2.rectangle(mask, (0, 0), (mask.shape[1], border), 0, -1)
    cv2.rectangle(mask, (0, 0), (border, mask.shape[0]), 0, -1)
    cv2.rectangle(
        mask, (0, mask.shape[0] - border), (mask.shape[1], mask.shape[0]), 0, -1
    )
    cv2.rectangle(
        mask, (mask.shape[1] - border, 0), (mask.shape[1], mask.shape[0]), 0, -1
    )

    contours, _ = cv2.findContours(
        mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )

    objects: list[ForeignObject] = []
    for c in contours:
        area = int(cv2.contourArea(c))
        if area < recipe.foreign_area_px:
            continue
        objects.append(ForeignObject(box=cv2.boundingRect(c), area_px=area))

    return objects


# --------------------------------------------------------------------------
# Toan bo mot chu ky kiem tra
# --------------------------------------------------------------------------


def inspect(
    image_bgr: np.ndarray, recipe: Recipe, golden_bgr: np.ndarray
) -> InspectionResult:
    started = time.perf_counter()

    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    golden_gray = cv2.cvtColor(golden_bgr, cv2.COLOR_BGR2GRAY)

    found = find_fiducials(gray, recipe)
    alignment, m = solve_alignment(found, recipe)

    if m is None or not alignment.ok:
        # Khong can duoc anh thi moi ket luan phia sau deu vo nghia. May that
        # se bao "fiducial not found" va day bo mach sang khay cho nguoi xem,
        # chu khong doan bua roi bao mot dong loi gia.
        elapsed = int((time.perf_counter() - started) * 1000)
        return InspectionResult(
            result="FAIL",
            alignment=alignment,
            components=(),
            foreign=(),
            cycle_time_ms=elapsed,
        )

    # Can anh mau mot lan roi moi doi sang xam: warp anh mau van giu duoc
    # thong tin mau cho buoc so anh, con matchTemplate thi chay tren anh xam.
    aligned_bgr = warp_to_golden(image_bgr, m, recipe)
    aligned_gray = cv2.cvtColor(aligned_bgr, cv2.COLOR_BGR2GRAY)

    components = tuple(
        inspect_component(aligned_bgr, golden_bgr, aligned_gray, golden_gray, c)
        for c in recipe.components
    )
    foreign = tuple(find_foreign_objects(aligned_bgr, golden_bgr, recipe))

    failed = any(c.status == "NG" for c in components) or bool(foreign)
    elapsed = int((time.perf_counter() - started) * 1000)

    return InspectionResult(
        result="FAIL" if failed else "PASS",
        alignment=alignment,
        components=components,
        foreign=foreign,
        cycle_time_ms=elapsed,
    )
