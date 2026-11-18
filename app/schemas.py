"""Public response contracts and OpenAPI examples."""

from typing import Any, Literal

from pydantic import BaseModel, Field


class Limits(BaseModel):
    max_upload_mb: int = Field(description="ขนาดไฟล์สูงสุด หน่วย MB")
    max_pages: int = Field(description="จำนวนหน้าสูงสุดต่อ request")


class HealthResponse(BaseModel):
    status: Literal["ok"]
    model_loaded: bool = Field(description="โหลดโมเดลใน process แล้วหรือยัง ไม่ใช่การทดสอบ inference")
    device: Literal["cpu", "auto", "cuda"]
    dewarp: bool
    tables: bool
    limits: Limits


class Line(BaseModel):
    text: str
    confidence: float = Field(description="คะแนนจากโมเดล ไม่ใช่อัตราความถูกต้องที่ยืนยันแล้ว")
    bbox: list[float] = Field(min_length=4, max_length=4, description="[x0, y0, x1, y1] หน่วย pixel")
    poly: list[list[float]] = Field(description="พิกัดมุมกรอบข้อความ 4 จุด")


class Block(BaseModel):
    id: int
    label: str = Field(description="ชนิด layout เช่น text, doc_title, table")
    bbox: list[float] = Field(min_length=4, max_length=4)
    score: float
    order: float = Field(description="ลำดับการอ่าน")
    text: str
    html: str | None = Field(description="ตารางในรูปแบบ HTML ถ้ามี")
    line_ids: list[int]


class Page(BaseModel):
    index: int = Field(description="ลำดับหน้า เริ่มจาก 0")
    width: int
    height: int
    rotation: Literal[0, 90, 180, 270] = Field(description="การหมุนทวนเข็มนาฬิกาที่ใช้กับภาพ")
    dewarped: bool
    text: str
    markdown: str
    lines: list[Line]
    blocks: list[Block]
    timings: dict[str, float] = Field(description="เวลาของแต่ละขั้นตอน หน่วยวินาที")


class OCROptions(BaseModel):
    dpi: int
    max_pages: int
    dewarp: bool
    tables: bool
    device: Literal["cpu", "auto", "cuda"]


class OCRResponse(BaseModel):
    model: str
    page_count: int
    total_pages: int
    truncated: bool = Field(description="true เมื่อประมวลผลเพียง N หน้าแรกตาม max_pages")
    inference_seconds: float = Field(description="เวลา OCR ไม่รวมโหลดโมเดล หน่วยวินาที")
    elapsed_seconds: float = Field(description="รวมโหลดโมเดล ไม่รวมอัปโหลดและตรวจไฟล์ หน่วยวินาที")
    options: OCROptions
    pages: list[Page] = Field(description="พิกัดทั้งหมดอ้างอิงภาพหลังหมุนและ dewarp แล้ว")


class ValidationIssue(BaseModel):
    loc: list[str | int]
    msg: str
    type: str
    input: Any = None
    ctx: dict[str, Any] | None = None


class ErrorResponse(BaseModel):
    detail: str | list[ValidationIssue]


OCR_EXAMPLE = {
    "model": "Remtir/AksonOCR-Lite",
    "page_count": 1,
    "total_pages": 1,
    "truncated": False,
    "inference_seconds": 1.25,
    "elapsed_seconds": 1.3,
    "options": {"dpi": 150, "max_pages": 10, "dewarp": False, "tables": True, "device": "cpu"},
    "pages": [
        {
            "index": 0,
            "width": 1400,
            "height": 700,
            "rotation": 0,
            "dewarped": False,
            "text": "ทดสอบ OCR ภาษาไทย",
            "markdown": "ทดสอบ OCR ภาษาไทย",
            "lines": [
                {
                    "text": "ทดสอบ OCR ภาษาไทย",
                    "confidence": 0.98,
                    "bbox": [70, 70, 700, 120],
                    "poly": [[70, 70], [700, 70], [700, 120], [70, 120]],
                }
            ],
            "blocks": [
                {
                    "id": 0,
                    "label": "text",
                    "bbox": [70, 70, 700, 120],
                    "score": 0.99,
                    "order": 0,
                    "text": "ทดสอบ OCR ภาษาไทย",
                    "html": None,
                    "line_ids": [0],
                }
            ],
            "timings": {"ocr": 1.0, "layout": 0.25},
        }
    ],
}


def error_responses():
    examples = {
        400: ("ไฟล์ว่าง", "The uploaded file is empty."),
        413: ("ขนาดไฟล์หรือจำนวนพิกเซลเกินกำหนด", "Upload limit is 20 MB."),
        415: ("ชนิดไฟล์ไม่รองรับ หรืออ่านภาพไม่ได้", "Cannot read image. Upload a valid image or PDF."),
        422: ("พารามิเตอร์ไม่ถูกต้อง หรือ PDF เสีย/เข้ารหัส", "Page does not exist."),
    }
    return {
        code: {
            "model": ErrorResponse,
            "description": description,
            "content": {"application/json": {"example": {"detail": detail}}},
        }
        for code, (description, detail) in examples.items()
    }
