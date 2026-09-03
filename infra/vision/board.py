"""
Sinh anh bo mach tong hop: mot anh mau (golden sample) va cac bien the loi.

Vi sao khong dung anh chup that? Vi mot anh chup that trong repo khong ai kiem
chung duoc: khong biet no dung hay sai, va khong tai tao lai duoc. Anh sinh
bang code thi biet chinh xac loi nam o dau, nen test co the khang dinh
"thuat toan phai tim thay linh kien R12 bi thieu tai (412, 96)" thay vi chi
noi "co ve chay duoc".

Toan bo hinh hoc lay tu recipe (recipes/*.json) — cung mot nguon voi thuat
toan kiem tra, nen anh mau va cong thuc kiem tra khong the lech nhau.
"""

from __future__ import annotations

import cv2
import numpy as np

from recipe import ComponentSpec, Recipe

# Mau son phu (solder mask) va lop dong, theo BGR.
_BOARD_GREEN = (58, 92, 40)
_SILKSCREEN = (235, 235, 235)
_PAD_TIN = (178, 182, 190)
_IC_BLACK = (34, 34, 38)
_METAL = (168, 172, 176)
_RESISTOR = (24, 22, 60)
_CAP_BROWN = (40, 62, 96)

_RNG_SEED = 20260903


def _texture(shape: tuple[int, int], rng: np.random.Generator) -> np.ndarray:
    """Nhieu nhe cua lop son phu — anh phang tuyet doi la anh khong that."""
    noise = rng.normal(0, 3.0, (shape[0], shape[1], 3))
    return noise


def draw_component(img: np.ndarray, comp: ComponentSpec) -> None:
    """Ve mot linh kien theo dung o (ROI) ma recipe khai bao."""
    x, y, w, h = comp.roi
    body = (x, y, x + w, y + h)

    if comp.kind == "IC":
        cv2.rectangle(img, body[:2], body[2:], _IC_BLACK, -1)
        # Chan IC hai ben — chi tiet nho nhung la thu matchTemplate bam vao.
        pitch = max(4, h // 10)
        for py in range(y + pitch, y + h - pitch, pitch):
            cv2.line(img, (x - 3, py), (x + 2, py), _PAD_TIN, 2)
            cv2.line(img, (x + w - 2, py), (x + w + 3, py), _PAD_TIN, 2)
        # Cham dinh huong chan so 1: bat buoc phai co tren IC that.
        cv2.circle(img, (x + 7, y + 7), 3, _SILKSCREEN, -1)

    elif comp.kind == "Resistor":
        cv2.rectangle(img, body[:2], body[2:], _RESISTOR, -1)
        cv2.rectangle(img, (x, y), (x + 4, y + h), _PAD_TIN, -1)
        cv2.rectangle(img, (x + w - 4, y), (x + w, y + h), _PAD_TIN, -1)

    elif comp.kind == "Capacitor":
        cv2.rectangle(img, body[:2], body[2:], _CAP_BROWN, -1)
        cv2.line(img, (x + 3, y + 2), (x + 3, y + h - 2), _SILKSCREEN, 1)

    elif comp.kind == "Connector":
        cv2.rectangle(img, body[:2], body[2:], _METAL, -1)
        cv2.rectangle(img, (x + 5, y + 5), (x + w - 5, y + h - 5), _IC_BLACK, -1)

    elif comp.kind == "SolderJoint":
        # Day chan han: cac pad tron rieng biet. Loi "dinh thiec" chinh la hai
        # pad canh nhau bi noi lai — nen chung phai tach roi o anh mau.
        pads = max(3, w // 14)
        step = w // pads
        r = max(3, min(step // 2 - 1, h // 2 - 1))
        cy = y + h // 2
        for i in range(pads):
            cx = x + step // 2 + i * step
            cv2.circle(img, (cx, cy), r, _PAD_TIN, -1)

    # Nhan silkscreen canh linh kien, giong bo mach that.
    cv2.putText(
        img,
        comp.ref,
        (x, max(9, y - 4)),
        cv2.FONT_HERSHEY_PLAIN,
        0.7,
        _SILKSCREEN,
        1,
        cv2.LINE_AA,
    )


def render_golden(recipe: Recipe) -> np.ndarray:
    """Anh mau: bo mach dat chuan, dung tu the chuan."""
    rng = np.random.default_rng(_RNG_SEED)
    h, w = recipe.height, recipe.width

    img = np.full((h, w, 3), _BOARD_GREEN, dtype=np.float32)
    img += _texture((h, w), rng)

    # Vien bo mach.
    cv2.rectangle(img, (6, 6), (w - 7, h - 7), (46, 74, 32), 2)

    img = np.clip(img, 0, 255).astype(np.uint8)

    for comp in recipe.components:
        draw_component(img, comp)

    # Fiducial (mark point) ve sau cung de khong bi linh kien de len.
    for fx, fy in recipe.fiducials:
        draw_fiducial(img, (fx, fy), recipe.fiducial_radius)

    return img


def draw_fiducial(img: np.ndarray, center: tuple[int, int], radius: int) -> None:
    """
    Fiducial chuan: dong tron sang tren nen son phu bi go sach quanh no.

    Vong toi bao quanh khong phai trang tri — no tao ra bien do tuong phan cao
    ma HoughCircles can de tim duoc tam vong tron on dinh.
    """
    cv2.circle(img, center, radius + 4, (18, 30, 14), -1)
    cv2.circle(img, center, radius, _PAD_TIN, -1)


def apply_pose(
    img: np.ndarray, angle_deg: float, dx: int, dy: int
) -> np.ndarray:
    """
    Dat bo mach lech di: xoay quanh tam roi tinh tien.

    Day la tinh huong binh thuong tren bang tai — bo mach khong bao gio nam
    dung mot cho tuyet doi. Thuat toan phai tu can lai truoc khi so sanh, neu
    khong thi moi linh kien deu bao loi.
    """
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle_deg, 1.0)
    m[0, 2] += dx
    m[1, 2] += dy
    return cv2.warpAffine(
        img, m, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
    )


def add_capture_noise(img: np.ndarray, sigma: float = 2.5) -> np.ndarray:
    """Nhieu cam bien + lech sang nhe, giong anh chup that."""
    rng = np.random.default_rng(_RNG_SEED + 7)
    out = img.astype(np.float32) + rng.normal(0, sigma, img.shape)
    out *= 0.98
    return np.clip(out, 0, 255).astype(np.uint8)


# --------------------------------------------------------------------------
# Cac loi co the sinh ra — moi ham tra ve anh da bi loi
# --------------------------------------------------------------------------


def defect_missing(img: np.ndarray, comp: ComponentSpec) -> np.ndarray:
    """Thieu linh kien: pick & place bo qua, hoac linh kien roi tren duong di."""
    out = img.copy()
    x, y, w, h = comp.roi
    rng = np.random.default_rng(_RNG_SEED + 11)
    patch = np.full((h, w, 3), _BOARD_GREEN, dtype=np.float32)
    patch += rng.normal(0, 3.0, patch.shape)
    out[y : y + h, x : x + w] = np.clip(patch, 0, 255).astype(np.uint8)
    return out


def defect_shift(img: np.ndarray, comp: ComponentSpec, dx: int, dy: int):
    """Lech chan: linh kien dat sai vi tri nhung van co mat."""
    out = defect_missing(img, comp)
    moved = ComponentSpec(
        ref=comp.ref,
        name=comp.name,
        kind=comp.kind,
        roi=(comp.roi[0] + dx, comp.roi[1] + dy, comp.roi[2], comp.roi[3]),
    )
    draw_component(out, moved)
    return out


def defect_solder_bridge(img: np.ndarray, comp: ComponentSpec) -> np.ndarray:
    """Dinh thiec: hai chan han canh nhau bi noi lai — ngan mach."""
    out = img.copy()
    x, y, w, h = comp.roi
    pads = max(3, w // 14)
    step = w // pads
    cy = y + h // 2
    c1 = x + step // 2 + step
    c2 = c1 + step
    cv2.line(out, (c1, cy), (c2, cy), _PAD_TIN, max(4, h // 3))
    return out


def defect_foreign_material(img: np.ndarray, at: tuple[int, int]) -> np.ndarray:
    """Vat la roi tren bo mach — khong nam trong o cua linh kien nao."""
    out = img.copy()
    cv2.circle(out, at, 11, (30, 30, 190), -1)
    return out
