"""
Recipe — "chuong trinh kiem tra" cua mot model bo mach.

Tren may AOI that, moi model san pham co mot recipe rieng: anh mau, vi tri
fiducial, danh sach o kiem tra (ROI) va nguong phan dinh cho tung o. Doi model
la nap recipe khac chu khong sua phan mem. Cau truc o day giu dung y do:
service khong biet gi ve "MacBook M3" — no chi doc recipe.

Nguong de o cap linh kien chu khong phai cap toan may, vi mot con IC va mot
day chan han khong the dung chung mot nguong: chan han vao ban chat da nhieu
bien dong hon nhieu.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

# Loai linh kien khop voi union type ben frontend (types/index.ts).
ComponentKind = str
VALID_KINDS = {"IC", "Resistor", "Capacitor", "Connector", "SolderJoint"}


@dataclass(frozen=True)
class ComponentSpec:
    """Mot o kiem tra: linh kien nao, nam o dau tren anh mau."""

    ref: str
    """Ma tham chieu tren so do mach — R12, U1, C45..."""

    name: str
    kind: ComponentKind

    roi: tuple[int, int, int, int]
    """(x, y, w, h) tinh bang pixel tren anh mau."""

    match_threshold: float = 0.72
    """
    Diem khop NCC toi thieu (0..1). Duoi nguong nay coi nhu thieu linh kien
    hoac dat nham loai. Nguong mac dinh de rong vi anh chup that co nhieu.
    """

    shift_tolerance_px: int = 6
    """
    Do lech vi tri toi da con chap nhan. Vuot qua la 'lech chan'.
    Tren may that con so nay lay tu dung sai lap rap, khong phai chon bua.
    """

    defect_area_ratio: float = 0.035
    """
    Ty le dien tich sai khac so voi anh mau, tren tong dien tich o. Vuot qua
    la co vat the la / dinh thiec ngay trong o linh kien.
    """

    search_margin_px: int = 20
    """
    Vung tim quanh ROI khi chay matchTemplate.

    Phai LON HON shift_tolerance_px mot khoang ro rang, neu khong thi mot linh
    kien dat lech se roi ra ngoai vung tim va bi bao nham la "thieu linh kien".
    Ky su quy trinh doc hai loi do se di sua hai thu khac han nhau: mot ben la
    chinh lai toa do pick & place, mot ben la kiem tra bang tai cap linh kien.
    Quy uoc o day: rong gap khoang ba lan dung sai lech.
    """


@dataclass(frozen=True)
class Recipe:
    model_id: str
    model_name: str
    width: int
    height: int

    fiducials: tuple[tuple[int, int], ...]
    """Vi tri chuan cua cac mark point tren anh mau (it nhat 2 diem)."""

    fiducial_radius: int = 7

    components: tuple[ComponentSpec, ...] = field(default_factory=tuple)

    fiducial_search_radius: tuple[int, int] = (5, 12)
    """Khoang ban kinh (min, max) truyen cho HoughCircles."""

    foreign_area_px: int = 220
    """
    Dien tich toi thieu cua mot vet sai khac NGOAI moi o linh kien thi moi bi
    coi la vat la. De qua thap thi bui va nhieu cam bien cung thanh loi.
    """

    def component(self, ref: str) -> ComponentSpec:
        for c in self.components:
            if c.ref == ref:
                return c
        raise KeyError(f"recipe {self.model_id} khong co linh kien {ref}")


def _component_from_dict(d: dict) -> ComponentSpec:
    kind = d["kind"]
    if kind not in VALID_KINDS:
        raise ValueError(f"loai linh kien khong hop le: {kind}")

    roi = d["roi"]
    if len(roi) != 4 or any(v < 0 for v in roi):
        raise ValueError(f"roi khong hop le cho {d.get('ref')}: {roi}")

    return ComponentSpec(
        ref=d["ref"],
        name=d["name"],
        kind=kind,
        roi=(int(roi[0]), int(roi[1]), int(roi[2]), int(roi[3])),
        match_threshold=float(d.get("match_threshold", 0.72)),
        shift_tolerance_px=int(d.get("shift_tolerance_px", 6)),
        defect_area_ratio=float(d.get("defect_area_ratio", 0.035)),
        search_margin_px=int(d.get("search_margin_px", 20)),
    )


def load_recipe(path: Path) -> Recipe:
    data = json.loads(Path(path).read_text(encoding="utf-8"))

    fiducials = tuple((int(p[0]), int(p[1])) for p in data["fiducials"])
    if len(fiducials) < 2:
        # Mot diem chi cho biet bo mach dich bao nhieu, khong cho biet no xoay
        # bao nhieu. Khong co goc xoay thi khong can anh duoc.
        raise ValueError("recipe phai co it nhat 2 fiducial de tinh duoc goc xoay")

    return Recipe(
        model_id=data["model_id"],
        model_name=data["model_name"],
        width=int(data["width"]),
        height=int(data["height"]),
        fiducials=fiducials,
        fiducial_radius=int(data.get("fiducial_radius", 7)),
        components=tuple(_component_from_dict(c) for c in data["components"]),
        fiducial_search_radius=tuple(
            data.get("fiducial_search_radius", [5, 12])
        ),  # type: ignore[arg-type]
        foreign_area_px=int(data.get("foreign_area_px", 220)),
    )


def load_all(directory: Path) -> dict[str, Recipe]:
    recipes: dict[str, Recipe] = {}
    for path in sorted(Path(directory).glob("*.json")):
        r = load_recipe(path)
        recipes[r.model_id] = r
    return recipes
