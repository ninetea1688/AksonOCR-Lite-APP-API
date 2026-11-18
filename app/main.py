import io
import logging
import math
import time
import warnings
from contextlib import asynccontextmanager, nullcontext
from pathlib import Path
from threading import Lock
from typing import Annotated, Literal

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.schemas import OCR_EXAMPLE, ErrorResponse, HealthResponse, OCRResponse, error_responses

logger = logging.getLogger(__name__)
# PDFium is not thread-safe, including validation while another request renders.
pdf_lock = Lock()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="OCR_", env_file=".env", extra="ignore")
    device: Literal["cpu", "auto", "cuda"] = "cpu"
    dewarp: bool = False
    tables: bool = True
    max_upload_mb: int = Field(default=20, ge=1, le=100)
    max_pages: int = Field(default=10, ge=1, le=100)
    max_pixels: int = Field(default=25_000_000, ge=1)


def validate_document(data: bytes, dpi: int, max_pages: int, max_pixels: int) -> int:
    """Validate the content before loading weights; bound rendered page dimensions."""
    if not data:
        raise HTTPException(400, "The uploaded file is empty.")
    if data.startswith(b"%PDF"):
        import pypdfium2 as pdfium

        try:
            with pdf_lock, pdfium.PdfDocument(data) as pdf:
                count = len(pdf)
                if not count:
                    raise HTTPException(422, "PDF contains no pages.")
                for index in range(min(count, max_pages)):
                    page = pdf[index]
                    try:
                        width, height = page.get_size()
                        if math.ceil(width * dpi / 72) * math.ceil(height * dpi / 72) > max_pixels:
                            raise HTTPException(413, "PDF page exceeds the pixel limit; lower dpi.")
                    finally:
                        page.close()
                return count
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                422, "Cannot read PDF. Check for corruption or encryption."
            ) from exc
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                if image.format not in {"JPEG", "PNG", "WEBP", "TIFF", "BMP"}:
                    raise HTTPException(415, "Supported formats: JPEG, PNG, WebP, TIFF, BMP, PDF.")
                if image.width * image.height > max_pixels:
                    raise HTTPException(413, "Image exceeds the pixel limit.")
                if getattr(image, "n_frames", 1) > 1:
                    raise HTTPException(
                        422, "Multi-frame images are unsupported; convert to PDF first."
                    )
                image.verify()
    except HTTPException:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise HTTPException(413, "Image exceeds the pixel limit.") from exc
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError) as exc:
        raise HTTPException(415, "Cannot read image. Upload a valid image or PDF.") from exc
    return 1


class OCRService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.converter = None
        self.lock = Lock()

    def convert(self, data: bytes, dpi: int, max_pages: int) -> tuple[list[dict], float]:
        # A converter holds mutable configuration; serialize access and reject excess work.
        if not self.lock.acquire(blocking=False):
            raise HTTPException(503, "OCR is busy. Retry shortly.", headers={"Retry-After": "2"})
        try:
            if self.converter is None:
                try:
                    import aksonocr_lite

                    self.converter = aksonocr_lite.load(
                        device=self.settings.device,
                        dewarp=self.settings.dewarp,
                        tables=self.settings.tables,
                    )
                except Exception as exc:
                    logger.exception("Model initialization failed")
                    raise HTTPException(
                        503, "Model unavailable. Check server logs and weights."
                    ) from exc
            self.converter.cfg.dpi = dpi
            started = time.perf_counter()
            try:
                with pdf_lock if data.startswith(b"%PDF") else nullcontext():
                    pages = [
                        page.to_dict() for page in self.converter.convert(data, max_pages=max_pages)
                    ]
            except Exception as exc:
                logger.exception("OCR conversion failed")
                raise HTTPException(500, "OCR failed. Check server logs.") from exc
            return pages, round(time.perf_counter() - started, 4)
        finally:
            self.lock.release()


def create_app(settings: Settings | None = None, service=None) -> FastAPI:
    settings = settings or Settings()
    service = service or OCRService(settings)

    @asynccontextmanager
    async def lifespan(app):
        yield
        service.converter = None

    app = FastAPI(
        title="AksonOCR-Lite API",
        version="0.2.0",
        description="""API อ่านเอกสารภาษาไทยและอังกฤษด้วย **AksonOCR-Lite**

1. เรียก `GET /health` เพื่อตรวจระบบและขีดจำกัดไฟล์
2. ใช้ `POST /v1/preview` เพื่อดูภาพเอกสาร (ไม่โหลดโมเดล)
3. ใช้ `POST /v1/ocr` เลือกไฟล์ใน **Try it out** แล้วกด **Execute**

รองรับ JPEG, PNG, WebP, BMP, TIFF หน้าเดียว และ PDF ผ่าน multipart field `file`.
เลือกผลลัพธ์ด้วย `output_format=json|text|markdown`.

**ครั้งแรก:** ดาวน์โหลดและโหลดน้ำหนักโมเดล อาจใช้เวลาหลายนาที
ระบบประมวลผล OCR ครั้งละหนึ่ง request; หากกำลังทำงานจะคืน `503` พร้อม `Retry-After`.
`/health` เป็น liveness check และไม่ยืนยันว่าโมเดล inference สำเร็จ.
ไม่มีการบันทึกเอกสารหรือผลลัพธ์ถาวร และไม่มี authentication ในตัว.

[เปิด GUI](/) · [ดาวน์โหลด OpenAPI schema](/openapi.json)
""",
        openapi_tags=[
            {"name": "System", "description": "สถานะระบบและขีดจำกัดการใช้งาน"},
            {"name": "Documents", "description": "ภาพตัวอย่างและ OCR เอกสาร"},
        ],
        swagger_ui_parameters={"displayRequestDuration": True, "defaultModelsExpandDepth": 1},
        lifespan=lifespan,
    )
    app.state.ocr = service

    @app.get("/health", tags=["System"], summary="ตรวจสอบสถานะ API", response_model=HealthResponse)
    def health():
        return {
            "status": "ok",
            "model_loaded": service.converter is not None,
            "device": settings.device,
            "dewarp": settings.dewarp,
            "tables": settings.tables,
            "limits": {"max_upload_mb": settings.max_upload_mb, "max_pages": settings.max_pages},
        }

    def read_upload(file: UploadFile) -> bytes:
        data = file.file.read(settings.max_upload_mb * 1024 * 1024 + 1)
        if len(data) > settings.max_upload_mb * 1024 * 1024:
            raise HTTPException(413, f"Upload limit is {settings.max_upload_mb} MB.")
        return data

    @app.post(
        "/v1/preview",
        tags=["Documents"],
        summary="ดูภาพตัวอย่างรายหน้า",
        response_class=Response,
        description="คืนภาพ PNG ที่ 100 DPI จำกัดด้านยาว 2000 px โดยไม่โหลดโมเดล OCR. "
        "page เริ่มจาก 1 และ rotation คือองศาทวนเข็มนาฬิกาหลังแก้ EXIF. ไม่ใช้ dewarp.",
        responses={
            **error_responses(),
            200: {
                "description": "ภาพตัวอย่าง PNG",
                "content": {"image/png": {"schema": {"type": "string", "format": "binary"}}},
                "headers": {
                    "X-Total-Pages": {
                        "description": "จำนวนหน้าทั้งหมด",
                        "schema": {"type": "integer"},
                    },
                    "Cache-Control": {"schema": {"type": "string", "example": "no-store"}},
                },
            },
        },
    )
    def preview(
        file: Annotated[UploadFile, File(description="ภาพหรือ PDF ตรวจสอบชนิดไฟล์จากเนื้อหาจริง")],
        page: Annotated[
            int, Query(ge=1, le=settings.max_pages, description="หน้าที่ต้องการดู เริ่มจาก 1")
        ] = 1,
        rotation: Annotated[
            int,
            Query(
                ge=0,
                le=270,
                description="หมุนทวนเข็มนาฬิกา",
                json_schema_extra={"enum": [0, 90, 180, 270]},
            ),
        ] = 0,
    ):
        """Render a single source page, with EXIF and optional OCR rotation applied."""
        try:
            if rotation not in (0, 90, 180, 270):
                raise HTTPException(422, "Rotation must be 0, 90, 180 or 270.")
            if page > settings.max_pages:
                raise HTTPException(422, "Page exceeds the configured page limit.")
            data = read_upload(file)
            total = validate_document(data, 100, page, settings.max_pixels)
            if page > total:
                raise HTTPException(422, "Page does not exist.")
            if data.startswith(b"%PDF"):
                import pypdfium2 as pdfium

                with pdf_lock, pdfium.PdfDocument(data) as pdf:
                    source = pdf[page - 1]
                    try:
                        bitmap = source.render(scale=100 / 72)
                        try:
                            image = bitmap.to_pil().convert("RGB")
                        finally:
                            bitmap.close()
                    finally:
                        source.close()
            else:
                with Image.open(io.BytesIO(data)) as source:
                    image = ImageOps.exif_transpose(source).convert("RGB")
            with image:
                if rotation:
                    rotated = image.rotate(rotation, expand=True)
                    image.close()
                    image = rotated
                try:
                    image.thumbnail((2000, 2000))
                    output = io.BytesIO()
                    image.save(output, format="PNG")
                finally:
                    image.close()
            return Response(
                output.getvalue(),
                media_type="image/png",
                headers={"Cache-Control": "no-store", "X-Total-Pages": str(total)},
            )
        finally:
            file.file.close()

    @app.post(
        "/v1/ocr",
        tags=["Documents"],
        summary="อ่านข้อความและโครงสร้างเอกสาร",
        response_model=OCRResponse,
        description="ประมวลผล N หน้าแรกตาม max_pages; หน้าที่เกินจะไม่ถูกอ่านและแจ้ง truncated=true. "
        "JSON มี layout, ตาราง HTML, บรรทัดและ confidence; พิกัดอยู่บนภาพหลังหมุน/dewarp. "
        "Text และ Markdown รวมทุกหน้าที่อ่านด้วยบรรทัดว่าง. ตัวอย่าง response เป็นข้อมูลสาธิต ไม่ใช่ benchmark.",
        responses={
            **error_responses(),
            200: {
                "description": "ผล OCR ตาม output_format",
                "content": {
                    "application/json": {"example": OCR_EXAMPLE},
                    "text/plain": {"schema": {"type": "string"}, "example": "ทดสอบ OCR ภาษาไทย"},
                    "text/markdown": {
                        "schema": {"type": "string"},
                        "example": "# เอกสารตัวอย่าง\n\nทดสอบ OCR ภาษาไทย",
                    },
                },
                "headers": {
                    "X-OCR-Seconds": {
                        "description": "เวลา inference สำหรับ Text/Markdown ไม่รวมโหลดโมเดล",
                        "schema": {"type": "number"},
                    }
                },
            },
            500: {
                "model": ErrorResponse,
                "description": "OCR inference ล้มเหลว ตรวจสอบ server logs",
                "content": {
                    "application/json": {"example": {"detail": "OCR failed. Check server logs."}}
                },
            },
            503: {
                "model": ErrorResponse,
                "description": "OCR กำลังทำงาน หรือโหลดโมเดลไม่สำเร็จ",
                "headers": {
                    "Retry-After": {
                        "description": "จำนวนวินาทีที่แนะนำก่อน retry (เมื่อ OCR busy)",
                        "schema": {"type": "integer", "example": 2},
                    }
                },
                "content": {
                    "application/json": {"example": {"detail": "OCR is busy. Retry shortly."}}
                },
            },
        },
    )
    def ocr(
        file: Annotated[UploadFile, File(description="ภาพหรือ PDF ขนาดสูงสุดตาม /health → limits")],
        output_format: Annotated[
            Literal["json", "text", "markdown"],
            Query(description="รูปแบบ response; ใช้ JSON เพื่อดู confidence และ bounding boxes"),
        ] = "json",
        dpi: Annotated[
            int, Query(ge=72, le=300, description="ความละเอียด render PDF ไม่มีผลกับไฟล์ภาพ")
        ] = 150,
        max_pages: Annotated[
            int, Query(ge=1, le=settings.max_pages, description="อ่าน N หน้าแรกของเอกสาร")
        ] = min(10, settings.max_pages),
    ):
        try:
            if max_pages > settings.max_pages:
                raise HTTPException(422, f"max_pages must be <= {settings.max_pages}.")
            data = read_upload(file)
            total = validate_document(data, dpi, max_pages, settings.max_pixels)
            started = time.perf_counter()
            pages, inference_seconds = service.convert(data, dpi, max_pages)
            elapsed = round(time.perf_counter() - started, 4)
            headers = {"X-OCR-Seconds": str(inference_seconds)}
            if output_format != "json":
                key = "text" if output_format == "text" else "markdown"
                return PlainTextResponse(
                    "\n\n".join(page[key] for page in pages),
                    media_type="text/plain" if key == "text" else "text/markdown",
                    headers=headers,
                )
            return {
                "model": "Remtir/AksonOCR-Lite",
                "page_count": len(pages),
                "total_pages": total,
                "truncated": len(pages) < total,
                "inference_seconds": inference_seconds,
                "elapsed_seconds": elapsed,
                "options": {
                    "dpi": dpi,
                    "max_pages": max_pages,
                    "dewarp": settings.dewarp,
                    "tables": settings.tables,
                    "device": settings.device,
                },
                "pages": pages,
            }
        finally:
            file.file.close()

    frontend = Path(__file__).resolve().parents[1] / "frontend" / "dist"
    if (frontend / "index.html").exists():
        # Register last so API routes and Swagger retain their existing paths.
        app.mount("/", StaticFiles(directory=frontend, html=True), name="frontend")
    return app


app = create_app()
