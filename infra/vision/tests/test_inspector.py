"""
Test thuat toan AOI.

Anh dung trong test duoc sinh ra tu chinh recipe, nen moi test biet chinh xac
loi nam o dau va o linh kien nao. Nho vay khang dinh duoc "phai bao lech chan
R12", chu khong chi "phai bao FAIL" — mot may AOI bao FAIL ma khong noi duoc
loi gi thi ky su quy trinh khong dung duoc.
"""

from __future__ import annotations

import math
from pathlib import Path

import cv2
import numpy as np
import pytest

import board
from inspector import (
    find_fiducials,
    find_foreign_objects,
    inspect,
    solve_alignment,
)
from recipe import load_recipe

RECIPE_PATH = Path(__file__).parent.parent / "recipes" / "mbp-m3-logic-rev-b.json"


@pytest.fixture(scope="module")
def recipe():
    return load_recipe(RECIPE_PATH)


@pytest.fixture(scope="module")
def golden(recipe):
    return board.render_golden(recipe)


def result_for(recipe, golden, img):
    return inspect(board.add_capture_noise(img), recipe, golden)


def component(result, ref):
    for c in result.components:
        if c.ref == ref:
            return c
    raise AssertionError(f"khong thay linh kien {ref} trong ket qua")


# --------------------------------------------------------------------------
# Buoc 1-2 — tim fiducial va can anh
# --------------------------------------------------------------------------


class TestAlignment:
    def test_tim_dung_hai_fiducial_tren_anh_mau(self, recipe, golden):
        gray = cv2.cvtColor(golden, cv2.COLOR_BGR2GRAY)
        found = find_fiducials(gray, recipe)

        assert len(found) == 2
        for (fx, fy), (nx, ny) in zip(found, recipe.fiducials):
            assert math.hypot(fx - nx, fy - ny) < 2.0

    @pytest.mark.parametrize(
        "angle,dx,dy",
        [(0.0, 0, 0), (2.5, 9, -6), (-3.5, -12, 8), (5.0, 0, 14)],
    )
    def test_do_lai_dung_goc_xoay_da_dat_vao(self, recipe, golden, angle, dx, dy):
        posed = board.add_capture_noise(board.apply_pose(golden, angle, dx, dy))
        gray = cv2.cvtColor(posed, cv2.COLOR_BGR2GRAY)

        alignment, m = solve_alignment(find_fiducials(gray, recipe), recipe)

        assert alignment.ok
        assert m is not None
        # getRotationMatrix2D xoay nguoc chieu kim dong ho, atan2 tren toa do
        # anh (truc y huong xuong) do thuan chieu kim dong ho — nen dau nguoc
        # nhau, con do lon phai bang.
        assert alignment.theta_deg == pytest.approx(-angle, abs=0.4)
        assert alignment.scale == pytest.approx(1.0, abs=0.02)

    def test_bo_mach_lech_tu_the_van_PASS(self, recipe, golden):
        # Day la ly do buoc can anh ton tai. Khong can truoc thi mot bo mach
        # dat dung chuan nhung xoay 3 do se bao loi o toan bo linh kien.
        result = result_for(recipe, golden, board.apply_pose(golden, 3.0, 8, -5))

        assert result.result == "PASS"
        assert all(c.status == "OK" for c in result.components)

    def test_khong_thay_fiducial_thi_FAIL_va_khong_doan_bua(self, recipe, golden):
        # Anh trang tron: khong co gi de can. May that se bao "fiducial not
        # found" va day bo mach ra khay cho nguoi kiem tra, chu khong in ra
        # mot danh sach loi bia dat.
        blank = np.full_like(golden, 200)

        result = inspect(blank, recipe, golden)

        assert result.result == "FAIL"
        assert result.components == ()
        assert not result.alignment.ok
        assert all(not f.found for f in result.alignment.fiducials)


# --------------------------------------------------------------------------
# Buoc 3-4 — kiem tra tung o linh kien
# --------------------------------------------------------------------------


class TestComponentInspection:
    def test_bo_mach_dat_thi_moi_o_deu_OK(self, recipe, golden):
        result = result_for(recipe, golden, golden)

        assert result.result == "PASS"
        assert result.foreign == ()
        for c in result.components:
            assert c.status == "OK"
            assert c.issue is None
            assert c.score > 0.9

    def test_thieu_linh_kien_bao_dung_o_do(self, recipe, golden):
        img = board.defect_missing(golden, recipe.component("R12"))

        result = result_for(recipe, golden, img)
        r12 = component(result, "R12")

        assert result.result == "FAIL"
        assert r12.status == "NG"
        assert "Thiếu linh kiện" in r12.issue
        assert r12.score < recipe.component("R12").match_threshold
        # Khong duoc keo theo linh kien khac thanh NG.
        assert [c.ref for c in result.components if c.status == "NG"] == ["R12"]

    def test_lech_chan_bao_la_lech_chu_khong_bao_la_thieu(self, recipe, golden):
        # Phan biet nay khong phai chuyen chu nghia: "thieu linh kien" thi di
        # kiem tra bang tai cap linh kien, "lech chan" thi di chinh toa do
        # pick & place. Bao nham loai la ky su di sua nham may.
        img = board.defect_shift(golden, recipe.component("C45"), 14, 3)

        result = result_for(recipe, golden, img)
        c45 = component(result, "C45")

        assert c45.status == "NG"
        assert "Lệch chân" in c45.issue
        assert c45.score > recipe.component("C45").match_threshold
        assert c45.offset_px[0] == pytest.approx(14, abs=2)
        assert c45.offset_px[1] == pytest.approx(3, abs=2)

    def test_lech_trong_dung_sai_thi_van_dat(self, recipe, golden):
        # Khong co day chuyen nao dat linh kien chinh xac tuyet doi. Bao NG o
        # muc lech 3px la over-kill: loai oan hang tot, tra gia bang san luong.
        img = board.defect_shift(golden, recipe.component("C45"), 3, 0)

        result = result_for(recipe, golden, img)

        assert component(result, "C45").status == "OK"
        assert result.result == "PASS"

    def test_dinh_thiec_bat_duoc_du_diem_khop_van_cao(self, recipe, golden):
        # Cau kho nhat: dinh thiec chi them mot vet nho, matchTemplate van cho
        # diem cao vi tong the o van rat giong anh mau. Chi co phep so anh moi
        # nhin ra. Day la ly do phai lam ca hai buoc chu khong chon mot.
        img = board.defect_solder_bridge(golden, recipe.component("J8"))

        result = result_for(recipe, golden, img)
        j8 = component(result, "J8")

        assert j8.status == "NG"
        assert "Dính thiếc" in j8.issue
        assert j8.score > recipe.component("J8").match_threshold
        assert j8.defect_area_ratio > recipe.component("J8").defect_area_ratio

    def test_bao_loi_nang_nhat_truoc(self, recipe, golden):
        # Linh kien bi thieu thi noi "no lech bao nhieu" la vo nghia.
        img = board.defect_missing(golden, recipe.component("U1"))

        u1 = component(result_for(recipe, golden, img), "U1")

        assert "Thiếu linh kiện" in u1.issue
        assert "Lệch chân" not in u1.issue


# --------------------------------------------------------------------------
# Buoc 5 — vat la ngoai cac o linh kien
# --------------------------------------------------------------------------


class TestForeignObjects:
    def test_bat_duoc_vat_la_nam_ngoai_moi_o_linh_kien(self, recipe, golden):
        img = board.defect_foreign_material(golden, (620, 210))

        result = result_for(recipe, golden, img)

        assert result.result == "FAIL"
        assert len(result.foreign) == 1
        x, y, w, h = result.foreign[0].box
        assert x <= 620 <= x + w
        assert y <= 210 <= y + h
        # Khong linh kien nao bi bao oan.
        assert all(c.status == "OK" for c in result.components)

    def test_vat_la_do_tren_nen_xanh_van_bat_duoc(self, recipe, golden):
        # Vet do (B30 G30 R190) tren son phu xanh (B58 G92 R40) chuyen sang
        # anh xam chi lech 5 muc — neu so anh theo do sang thi no tang hinh.
        # Test nay chot lai rang phep so phai chay tren anh mau.
        img = board.defect_foreign_material(golden, (620, 210))
        gray_a = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        gray_b = cv2.cvtColor(golden, cv2.COLOR_BGR2GRAY)

        assert int(cv2.absdiff(gray_a, gray_b).max()) < 30  # gan nhu tang hinh
        assert len(find_foreign_objects(img, golden, recipe)) == 1

    def test_nhieu_cam_bien_khong_bien_thanh_vat_la(self, recipe, golden):
        # Nguong dien tich ton tai chinh vi viec nay: mot may bao loi vi bui
        # se bi nguoi van hanh tat di trong tuan dau tien.
        noisy = board.add_capture_noise(golden, sigma=6.0)

        assert find_foreign_objects(noisy, golden, recipe) == []


# --------------------------------------------------------------------------
# Chu ky kiem tra
# --------------------------------------------------------------------------


class TestCycle:
    def test_bao_thoi_gian_chu_ky_that(self, recipe, golden):
        result = result_for(recipe, golden, golden)

        assert result.cycle_time_ms >= 0
        # Nhip mot bo mach tren day chuyen SMT tinh bang giay; mot chu ky AOI
        # ngon hon mot giay la con dung trong nhip.
        assert result.cycle_time_ms < 1000

    def test_ket_qua_khong_doi_giua_hai_lan_chay(self, recipe, golden):
        # Thuat toan tat dinh. Cung mot anh ma hai lan cho hai ket qua thi
        # khong ai truy duoc nguyen nhan mot bo mach bi loai.
        img = board.add_capture_noise(
            board.defect_missing(golden, recipe.component("R12"))
        )

        first = inspect(img, recipe, golden)
        second = inspect(img, recipe, golden)

        assert first.result == second.result
        assert [
            (c.ref, c.status, round(c.score, 6)) for c in first.components
        ] == [(c.ref, c.status, round(c.score, 6)) for c in second.components]
