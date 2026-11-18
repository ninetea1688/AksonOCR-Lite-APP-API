import io
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import OCRService, Settings, create_app


class FakeService:
    converter = None

    def convert(self, data, dpi, max_pages):
        return [
            {
                "index": 0,
                "width": 32,
                "height": 32,
                "rotation": 0,
                "dewarped": False,
                "text": "ทดสอบ OCR",
                "markdown": "# ทดสอบ OCR",
                "lines": [],
                "blocks": [],
                "timings": {},
            }
        ], 0.01


@pytest.fixture
def client():
    with TestClient(create_app(Settings(_env_file=None), FakeService())) as client:
        yield client


def png(size=(32, 32)):
    stream = io.BytesIO()
    Image.new("RGB", size, "white").save(stream, format="PNG")
    return stream.getvalue()


def test_health_does_not_load_weights(client):
    assert client.get("/health").json()["model_loaded"] is False


def test_json_and_content_detection(client):
    response = client.post(
        "/v1/ocr", files={"file": ("wrong.bin", png(), "application/octet-stream")}
    )
    assert response.status_code == 200
    result = response.json()
    assert result["pages"][0]["text"] == "ทดสอบ OCR"
    assert result["page_count"] == result["total_pages"] == 1
    assert result["truncated"] is False


@pytest.mark.parametrize("kind,expected", [("text", "ทดสอบ OCR"), ("markdown", "# ทดสอบ OCR")])
def test_text_outputs(client, kind, expected):
    response = client.post(f"/v1/ocr?output_format={kind}", files={"file": ("test.png", png())})
    assert response.status_code == 200
    assert response.text == expected
    assert response.headers["x-ocr-seconds"] == "0.01"


@pytest.mark.parametrize("data,status", [(b"", 400), (b"not an image", 415), (b"%PDF broken", 422)])
def test_invalid_documents(client, data, status):
    assert client.post("/v1/ocr", files={"file": ("test.pdf", data)}).status_code == status


@pytest.mark.parametrize("query", ["dpi=500", "max_pages=0", "max_pages=11", "output_format=html"])
def test_option_limits(client, query):
    assert client.post(f"/v1/ocr?{query}", files={"file": ("test.png", png())}).status_code == 422


def test_upload_and_pixel_limits():
    settings = Settings(_env_file=None, max_upload_mb=1, max_pixels=100)
    with TestClient(create_app(settings, FakeService())) as client:
        assert (
            client.post("/v1/ocr", files={"file": ("large.png", b"x" * (1024**2 + 1))}).status_code
            == 413
        )
        assert client.post("/v1/ocr", files={"file": ("large.png", png())}).status_code == 413


def test_pdf_truncation(client):
    import pypdfium2 as pdfium

    stream = io.BytesIO()
    with pdfium.PdfDocument.new() as pdf:
        pdf.new_page(200, 200).close()
        pdf.new_page(200, 200).close()
        pdf.save(stream)
    response = client.post("/v1/ocr?max_pages=1", files={"file": ("test.pdf", stream.getvalue())})
    assert response.status_code == 200
    assert response.json()["total_pages"] == 2
    assert response.json()["truncated"] is True


def test_busy_does_not_start_another_conversion():
    service = OCRService(Settings(_env_file=None))
    service.lock.acquire()
    try:
        with TestClient(create_app(Settings(_env_file=None), service)) as client:
            response = client.post("/v1/ocr", files={"file": ("test.png", png())})
            assert response.status_code == 503
            assert response.headers["retry-after"] == "2"
    finally:
        service.lock.release()


def test_converter_receives_options_and_serializes_page():
    service = OCRService(Settings(_env_file=None))
    received = {}

    def convert(data, max_pages):
        received.update(data=data, max_pages=max_pages, dpi=service.converter.cfg.dpi)
        yield SimpleNamespace(to_dict=lambda: {"text": "test"})

    service.converter = SimpleNamespace(cfg=SimpleNamespace(dpi=150), convert=convert)
    pages, seconds = service.convert(b"test", 200, 3)
    assert pages == [{"text": "test"}]
    assert received == {"data": b"test", "max_pages": 3, "dpi": 200}
    assert seconds >= 0


def test_preview_image_rotation_and_no_model_load(client):
    response = client.post("/v1/preview?rotation=90", files={"file": ("page.png", png((60, 30)))})
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-total-pages"] == "1"
    with Image.open(io.BytesIO(response.content)) as image:
        assert image.size == (30, 60)
    assert client.get("/health").json()["model_loaded"] is False


@pytest.mark.parametrize("query", ["page=0", "page=2", "page=11", "rotation=45"])
def test_preview_invalid_options(client, query):
    assert (
        client.post(f"/v1/preview?{query}", files={"file": ("test.png", png())}).status_code == 422
    )


def test_preview_pdf_page_selection(client):
    import pypdfium2 as pdfium

    stream = io.BytesIO()
    with pdfium.PdfDocument.new() as pdf:
        pdf.new_page(200, 100).close()
        pdf.new_page(100, 200).close()
        pdf.save(stream)
    response = client.post("/v1/preview?page=2", files={"file": ("page.pdf", stream.getvalue())})
    assert response.status_code == 200
    assert response.headers["x-total-pages"] == "2"
    with Image.open(io.BytesIO(response.content)) as image:
        assert image.height > image.width


def test_built_gui_does_not_shadow_api(client):
    from pathlib import Path

    if not (Path(__file__).resolve().parents[1] / "frontend/dist/index.html").exists():
        pytest.skip("Build frontend first to test static serving")
    assert client.get("/").status_code == 200
    assert "text/html" in client.get("/").headers["content-type"]
    assert client.get("/sample-thai.png").status_code == 200
    assert client.get("/docs").status_code == 200
    assert client.get("/openapi.json").status_code == 200
    assert client.get("/v1/does-not-exist").status_code == 404


def test_openapi_documents_response_contracts(client):
    from app.schemas import OCR_EXAMPLE, OCRResponse

    schema = client.get("/openapi.json").json()
    assert schema["info"]["version"] == "0.2.0"
    responses = schema["paths"]["/v1/ocr"]["post"]["responses"]
    assert set(responses["200"]["content"]) == {"application/json", "text/plain", "text/markdown"}
    assert responses["200"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/OCRResponse"
    )
    assert "Retry-After" in responses["503"]["headers"]
    preview = schema["paths"]["/v1/preview"]["post"]["responses"]
    assert "image/png" in preview["200"]["content"]
    assert "X-Total-Pages" in preview["200"]["headers"]
    assert "400" in preview and "413" in preview and "422" in preview
    OCRResponse.model_validate(OCR_EXAMPLE)


def test_openapi_limits_match_configuration():
    with TestClient(create_app(Settings(_env_file=None, max_pages=3), FakeService())) as client:
        schema = client.get("/openapi.json").json()
        for path, parameter in [("/v1/ocr", "max_pages"), ("/v1/preview", "page")]:
            params = schema["paths"][path]["post"]["parameters"]
            assert next(p for p in params if p["name"] == parameter)["schema"]["maximum"] == 3
        response = client.post("/v1/ocr", files={"file": ("test.png", png())})
        assert response.status_code == 200
        assert response.json()["options"]["max_pages"] == 3
