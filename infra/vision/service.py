"""
Vision AOI service — POST /inspect nhan anh, tra ve ket qua kiem tra.

Schema tra ve khop dung `PcbInspectionRecord` ma frontend dang dung
(src/features/factory/types/index.ts). Toa do bounding box duoc chuan hoa ve
0..1 ngay tai day, nen giao dien ve dung o moi kich thuoc anh ma khong phai
biet gi ve pixel goc.

Cac endpoint:
  GET  /health              — song chua, nap duoc bao nhieu recipe
  GET  /recipes             — danh sach model kiem tra duoc
  GET  /golden/{model_id}   — anh mau, de HMI hien thi doi chieu
  GET  /samples             — danh sach anh demo
  GET  /samples/{name}      — mot anh demo (bo mach dat / cac kieu loi)
  POST /inspect             — kiem tra mot anh tai len

Service khong luu trang thai va khong ghi file: anh vao, ket qua ra. Muon luu
lich su thi do la viec cua MES o Uu tien 3, khong phai cua may AOI.
"""

from __future__ import annotations

import logging
import os
import random
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

import board
from inspector import InspectionResult, inspect
from recipe import Recipe, load_all

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
)
log = logging.getLogger("vision")

RECIPE_DIR = Path(os.getenv("RECIPE_DIR", Path(__file__).parent / "recipes"))
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(12 * 1024 * 1024)))

RECIPES: dict[str, Recipe] = {}
GOLDEN: dict[str, np.ndarray] = {}

# Anh demo: ten -> (model_id, ham sinh anh tu anh mau). Co san de nguoi xem
# bam mot nut la thay ket qua, khong can di kiem anh bo mach o dau.
SAMPLE_BUILDERS: dict[str, tuple[str, str]] = {
    "pass": ("mbp-m3-logic-rev-b", "Bo mach dat, dat lech tu the nhe"),
    "missing-r12": ("mbp-m3-logic-rev-b", "Thieu dien tro R12"),
    "solder-bridge": ("mbp-m3-logic-rev-b", "Dinh thiec giua hai chan han J8"),
    "misaligned-c45": ("mbp-m3-logic-rev-b", "Tu C45 dat lech 14px"),
    "foreign-object": ("mbp-m3-logic-rev-b", "Vat la roi tren bo mach"),
}


def build_sample(name: str) -> np.ndarray:
    """Sinh anh demo tu anh mau — khong co anh nhi phan nao nam trong repo."""
    model_id, _ = SAMPLE_BUILDERS[name]
    recipe = RECIPES[model_id]
    golden = GOLDEN[model_id]

    if name == "pass":
        img = board.apply_pose(golden, 2.4, 7, -4)
    elif name == "missing-r12":
        img = board.apply_pose(
            board.defect_missing(golden, recipe.component("R12")), 1.2, -5, 3
        )
    elif name == "solder-bridge":
        img = board.defect_solder_bridge(golden, recipe.component("J8"))
    elif name == "misaligned-c45":
        img = board.defect_shift(golden, recipe.component("C45"), 14, 3)
    elif name == "foreign-object":
        img = board.defect_foreign_material(golden, (620, 210))
    else:  # pragma: no cover — da chan o ben goi
        raise KeyError(name)

    return board.add_capture_noise(img)


# --------------------------------------------------------------------------
# Chuyen ket qua sang schema cua frontend
# --------------------------------------------------------------------------


def _serial() -> str:
    return f"FOX-APPLE-M3-2026-{random.randint(1000, 9999)}"


def to_record(
    result: InspectionResult, recipe: Recipe, serial: str | None = None
) -> dict[str, Any]:
    """
    Doi sang PcbInspectionRecord, chuan hoa moi toa do ve 0..1.

    Chuan hoa o day chu khong o frontend: kich thuoc anh la chuyen cua may
    AOI, giao dien khong nen phai biet bo mach nay rong bao nhieu pixel.
    """
    w, h = float(recipe.width), float(recipe.height)

    marks: list[dict[str, Any]] = []
    for i, (nx, ny) in enumerate(recipe.fiducials[:2]):
        if i < len(result.alignment.fiducials):
            f = result.alignment.fiducials[i]
            marks.append(
                {
                    "x": round(f.x / w, 4),
                    "y": round(f.y / h, 4),
                    "status": "FOUND" if f.found else "MISSING",
                }
            )
        else:
            marks.append(
                {"x": round(nx / w, 4), "y": round(ny / h, 4), "status": "MISSING"}
            )

    components = []
    for c in result.components:
        bx, by, bw, bh = c.box
        components.append(
            {
                "id": c.ref,
                "name": c.name,
                "type": c.kind,
                "status": c.status,
                "issue": c.issue,
                # Diem khop NCC la thang do that dang sau chu "confidence" tren
                # man hinh — khong phai xac suat cua mot mo hinh nao ca.
                "confidence": round(max(0.0, c.score) * 100, 1),
                "box": {
                    "x": round(bx / w, 4),
                    "y": round(by / h, 4),
                    "w": round(bw / w, 4),
                    "h": round(bh / h, 4),
                },
                "offsetPx": list(c.offset_px),
                "defectAreaPct": round(c.defect_area_ratio * 100, 2),
            }
        )

    foreign = [
        {
            "box": {
                "x": round(o.box[0] / w, 4),
                "y": round(o.box[1] / h, 4),
                "w": round(o.box[2] / w, 4),
                "h": round(o.box[3] / h, 4),
            },
            "areaPx": o.area_px,
        }
        for o in result.foreign
    ]

    return {
        "id": f"pcb-{int(time.time() * 1000) % 100000}",
        "serialNumber": serial or _serial(),
        "modelName": recipe.model_name,
        "timestamp": int(time.time() * 1000),
        "result": result.result,
        "cycleTimeMs": result.cycle_time_ms,
        "markPoints": {
            "mark1": marks[0],
            "mark2": marks[1],
            "thetaOffset": round(result.alignment.theta_deg, 3),
        },
        "components": components,
        "foreignObjects": foreign,
        "alignment": {
            "ok": result.alignment.ok,
            "scale": round(result.alignment.scale, 4),
            "residualPx": (
                None
                if result.alignment.residual_px == float("inf")
                else round(result.alignment.residual_px, 2)
            ),
        },
        "engine": "opencv-golden-sample",
    }


# --------------------------------------------------------------------------
# App
# --------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(_app: FastAPI):
    RECIPES.update(load_all(RECIPE_DIR))
    for model_id, recipe in RECIPES.items():
        # Anh mau duoc dung lai tu chinh recipe, nen no khong the lech voi cac
        # o kiem tra. Nha may that thi day la anh chup mot bo mach da duoc QC
        # xac nhan dat, luu kem recipe.
        GOLDEN[model_id] = board.render_golden(recipe)
    log.info("nap %d recipe: %s", len(RECIPES), ", ".join(RECIPES))
    yield


app = FastAPI(title="Smart Factory Vision AOI", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    # Mang lab / may local. Ra ngoai that thi phai khoa lai danh sach origin.
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _require_recipe(model_id: str) -> Recipe:
    recipe = RECIPES.get(model_id)
    if recipe is None:
        raise HTTPException(404, f"khong co recipe cho model {model_id!r}")
    return recipe


def _encode_png(img: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", img)
    if not ok:  # pragma: no cover
        raise HTTPException(500, "khong ma hoa duoc anh PNG")
    return buf.tobytes()


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "engine": "opencv-golden-sample",
        "opencv": cv2.__version__,
        "recipes": sorted(RECIPES),
    }


@app.get("/recipes")
def list_recipes() -> list[dict[str, Any]]:
    return [
        {
            "modelId": r.model_id,
            "modelName": r.model_name,
            "width": r.width,
            "height": r.height,
            "components": [
                {"ref": c.ref, "name": c.name, "type": c.kind} for c in r.components
            ],
        }
        for r in RECIPES.values()
    ]


@app.get("/golden/{model_id}")
def golden_image(model_id: str) -> Response:
    _require_recipe(model_id)
    return Response(_encode_png(GOLDEN[model_id]), media_type="image/png")


@app.get("/samples")
def list_samples() -> list[dict[str, str]]:
    return [
        {"name": name, "modelId": model_id, "description": desc}
        for name, (model_id, desc) in SAMPLE_BUILDERS.items()
    ]


@app.get("/samples/{name}")
def sample_image(name: str) -> Response:
    if name not in SAMPLE_BUILDERS:
        raise HTTPException(404, f"khong co anh mau {name!r}")
    return Response(_encode_png(build_sample(name)), media_type="image/png")


@app.post("/inspect")
async def post_inspect(
    file: UploadFile | None = File(default=None),
    model_id: str = Query(default="mbp-m3-logic-rev-b", alias="model"),
    sample: str | None = Query(default=None),
    serial: str | None = Query(default=None),
) -> dict[str, Any]:
    """
    Kiem tra mot bo mach.

    Anh lay tu `file` (multipart) hoac tu `?sample=` de chay thu khong can
    camera. Bat buoc phai co mot trong hai — khong tu bia ra anh.
    """
    recipe = _require_recipe(model_id)

    if sample is not None:
        if sample not in SAMPLE_BUILDERS:
            raise HTTPException(404, f"khong co anh mau {sample!r}")
        image = build_sample(sample)
    elif file is not None:
        raw = await file.read()
        if not raw:
            raise HTTPException(400, "file rong")
        if len(raw) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                413, f"anh vuot qua {MAX_UPLOAD_BYTES // (1024 * 1024)} MB"
            )
        decoded = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
        if decoded is None:
            raise HTTPException(400, "khong doc duoc anh — dinh dang khong ho tro")
        image = decoded
    else:
        raise HTTPException(400, "can mot trong hai: file tai len hoac ?sample=")

    # Anh chup co the khac kich thuoc anh mau (doi camera, doi do phong dai).
    # Dua ve cung khung truoc, phan lech tu the con lai de fiducial xu ly.
    if image.shape[1] != recipe.width or image.shape[0] != recipe.height:
        image = cv2.resize(
            image, (recipe.width, recipe.height), interpolation=cv2.INTER_AREA
        )

    result = inspect(image, recipe, GOLDEN[model_id])
    return to_record(result, recipe, serial)
