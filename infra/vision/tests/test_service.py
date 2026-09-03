"""
Test lop HTTP: schema tra ve phai khop dung cai frontend dang doc.

Frontend khong co gi de kiem tra kieu du lieu luc chay — no tin vao interface
`PcbInspectionRecord` trong TypeScript. Neu service doi ten mot truong thi
bang dieu khien im lang hong chu khong bao loi. Cac test o day la cho chan duy
nhat cho viec do.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from service import SAMPLE_BUILDERS, app

MODEL = "mbp-m3-logic-rev-b"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


class TestMetaEndpoints:
    def test_health_bao_engine_va_recipe_da_nap(self, client):
        body = client.get("/health").json()

        assert body["status"] == "ok"
        assert body["engine"] == "opencv-golden-sample"
        assert MODEL in body["recipes"]

    def test_recipes_liet_ke_o_kiem_tra(self, client):
        [recipe] = client.get("/recipes").json()

        assert recipe["modelId"] == MODEL
        assert {c["ref"] for c in recipe["components"]} == {
            "U1",
            "R12",
            "C45",
            "J8",
            "P1",
        }

    def test_tra_ve_anh_mau_dang_PNG(self, client):
        r = client.get(f"/golden/{MODEL}")

        assert r.status_code == 200
        assert r.headers["content-type"] == "image/png"
        assert r.content[:8] == b"\x89PNG\r\n\x1a\n"

    def test_model_la_khong_tra_ve_404(self, client):
        assert client.get("/golden/khong-ton-tai").status_code == 404


class TestInspect:
    def test_bo_mach_dat_tra_ve_PASS(self, client):
        body = client.post("/inspect", params={"sample": "pass"}).json()

        assert body["result"] == "PASS"
        assert body["foreignObjects"] == []
        assert all(c["status"] == "OK" for c in body["components"])

    @pytest.mark.parametrize(
        "sample,ref,phrase",
        [
            ("missing-r12", "R12", "Thiếu linh kiện"),
            ("misaligned-c45", "C45", "Lệch chân"),
            ("solder-bridge", "J8", "Dính thiếc"),
        ],
    )
    def test_tung_kieu_loi_bao_dung_linh_kien(self, client, sample, ref, phrase):
        body = client.post("/inspect", params={"sample": sample}).json()

        ng = [c for c in body["components"] if c["status"] == "NG"]

        assert body["result"] == "FAIL"
        assert [c["id"] for c in ng] == [ref]
        assert phrase in ng[0]["issue"]

    def test_vat_la_bao_o_muc_bo_mach_chu_khong_do_cho_linh_kien(self, client):
        body = client.post("/inspect", params={"sample": "foreign-object"}).json()

        assert body["result"] == "FAIL"
        assert len(body["foreignObjects"]) == 1
        assert all(c["status"] == "OK" for c in body["components"])

    def test_moi_toa_do_deu_da_chuan_hoa_ve_0_1(self, client):
        # Giao dien ve box theo phan tram, nen mot toa do pixel lot ra ngoai
        # se ve mot khung to gap hang tram lan bo mach.
        body = client.post("/inspect", params={"sample": "missing-r12"}).json()

        for c in body["components"]:
            box = c["box"]
            assert 0.0 <= box["x"] <= 1.0
            assert 0.0 <= box["y"] <= 1.0
            assert 0.0 < box["w"] <= 1.0
            assert 0.0 < box["h"] <= 1.0

        for mark in (body["markPoints"]["mark1"], body["markPoints"]["mark2"]):
            assert 0.0 <= mark["x"] <= 1.0
            assert 0.0 <= mark["y"] <= 1.0

    def test_giu_dung_ten_truong_ma_frontend_doc(self, client):
        body = client.post("/inspect", params={"sample": "pass"}).json()

        assert set(body) >= {
            "id",
            "serialNumber",
            "modelName",
            "timestamp",
            "result",
            "cycleTimeMs",
            "markPoints",
            "components",
        }
        assert set(body["markPoints"]) == {"mark1", "mark2", "thetaOffset"}
        assert set(body["components"][0]) >= {
            "id",
            "name",
            "type",
            "status",
            "confidence",
            "box",
        }
        assert body["components"][0]["type"] in {
            "IC",
            "Resistor",
            "Capacitor",
            "Connector",
            "SolderJoint",
        }

    def test_confidence_la_phan_tram_khong_phai_ty_le(self, client):
        body = client.post("/inspect", params={"sample": "pass"}).json()

        # Giao dien in thang con so nay kem dau %; tra ve 0.98 se hien "0.98%".
        assert all(50 <= c["confidence"] <= 100 for c in body["components"])

    def test_nhan_anh_tai_len_qua_multipart(self, client):
        png = client.get(f"/samples/{'solder-bridge'}").content

        body = client.post(
            "/inspect",
            params={"model": MODEL},
            files={"file": ("board.png", png, "image/png")},
        ).json()

        assert body["result"] == "FAIL"
        assert [c["id"] for c in body["components"] if c["status"] == "NG"] == ["J8"]

    def test_serial_truyen_vao_duoc_giu_nguyen(self, client):
        # MES cap serial cho bo mach; may AOI khong duoc tu dat lai, neu khong
        # thi ket qua kiem tra khong gan duoc vao dung san pham.
        body = client.post(
            "/inspect", params={"sample": "pass", "serial": "FOX-TEST-0001"}
        ).json()

        assert body["serialNumber"] == "FOX-TEST-0001"


class TestInputValidation:
    def test_khong_co_anh_thi_tu_choi_chu_khong_bia(self, client):
        assert client.post("/inspect").status_code == 400

    def test_file_khong_phai_anh_bi_tu_choi(self, client):
        r = client.post(
            "/inspect",
            files={"file": ("x.png", b"day khong phai anh", "image/png")},
        )

        assert r.status_code == 400

    def test_file_rong_bi_tu_choi(self, client):
        r = client.post("/inspect", files={"file": ("x.png", b"", "image/png")})

        assert r.status_code == 400

    def test_anh_mau_khong_ton_tai_tra_ve_404(self, client):
        assert client.post("/inspect", params={"sample": "khong-co"}).status_code == 404

    def test_moi_anh_demo_deu_chay_duoc(self, client):
        for name in SAMPLE_BUILDERS:
            r = client.post("/inspect", params={"sample": name})

            assert r.status_code == 200, name
            assert r.json()["result"] in {"PASS", "FAIL"}
