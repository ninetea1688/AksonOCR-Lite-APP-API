"""Run real inference through the API without starting a server (downloads weights)."""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

root = Path(__file__).resolve().parents[1]
image = root / "examples" / "sample-thai.png"
with TestClient(app) as client:
    with image.open("rb") as file:
        response = client.post("/v1/ocr", files={"file": (image.name, file, "image/png")})
    response.raise_for_status()
    result = response.json()
    assert result["page_count"] == 1
    assert result["pages"][0]["lines"], "No text lines detected"
    output = root / "outputs"
    output.mkdir(exist_ok=True)
    (output / "smoke-result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(result["pages"][0]["text"])
    print(f"Inference: {result['inference_seconds']}s; total: {result['elapsed_seconds']}s")
    print(f"Saved: {output / 'smoke-result.json'}")
