# AksonOCR-Lite Workspace & API

API สำหรับทดลอง OCR ภาษาไทย/อังกฤษด้วย [Remtir/AksonOCR-Lite](https://huggingface.co/Remtir/AksonOCR-Lite) โดยใช้แพ็กเกจต้นฉบับ `aksonocr-lite==1.0.0` และ FastAPI

ขณะจัดทำยังติดตั้งแพ็กเกจจาก registry ไม่ได้ จึงตั้ง `uv` ให้ติดตั้ง source archive จาก repository ทางการ โดยตรึง commit `18da1dfeb9d4fc71d781ec0bfd5c80014e29a225` เพื่อให้รันซ้ำได้

รองรับ JPEG, PNG, WebP, BMP, TIFF หน้าเดียว และ PDF คืนข้อความ, Markdown, layout blocks, ตาราง HTML, bounding boxes, confidence รายบรรทัด และเวลาประมวลผล

> ขอขอบคุณ **Teetouch Jaknamon ([Remtir](https://github.com/Remtir))** ผู้พัฒนา [AksonOCR-Lite](https://github.com/Remtir/AksonOCR-Lite) ที่เผยแพร่โมเดลและโค้ด OCR ภาษาไทยให้ชุมชนนำไปใช้งานและพัฒนาต่อยอด โปรเจกต์นี้ใช้โมเดลและ pipeline ต้นฉบับเป็นฐานในการพัฒนา GUI และ API สำหรับทดสอบเอกสาร

## เริ่มใช้งาน

ถ้าใช้ Docker ไม่ต้องติดตั้ง Python, Node.js หรือ uv ในเครื่อง ให้ใช้ `docker compose up -d --build --wait` ตามหัวข้อ Docker Compose ด้านล่าง

ติดตั้ง [uv](https://docs.astral.sh/uv/getting-started/installation/) และ Node.js 24 แล้วรัน:

```bash
uv sync
cp .env.example .env
npm --prefix frontend ci
npm --prefix frontend run build
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

เปิด **[หน้า GUI](http://127.0.0.1:8000/)** เลือกเอกสารหรือลองเอกสารตัวอย่าง แล้วกด “เริ่มอ่านเอกสาร”

หน้าเว็บใช้ React + TypeScript + Vite รองรับลากวางไฟล์, ดูภาพและ PDF รายหน้า, ซูม, แสดงกรอบข้อความ, คลิกดู confidence รายบรรทัด, สลับ Text/Markdown/JSON, คัดลอก และดาวน์โหลดผลทุกหน้าที่ประมวลผล JSON แสดงผลทั้งเอกสาร ส่วนแท็บอื่นแสดงหน้าที่เลือก Markdown แสดงเป็น source เพื่อให้คัดลอกต่อได้โดยไม่ประมวลผล HTML จากเอกสาร

GUI และ API ใช้ port เดียวกันหลัง build จึงไม่ต้องตั้ง CORS หากแก้ frontend ให้ build ใหม่ ถ้ายังไม่ได้ build สามารถใช้ API ได้ตามปกติ แต่หน้า `/` จะไม่มี GUI

สำหรับเรียก API โดยตรงยังมี **[Swagger UI](http://127.0.0.1:8000/docs)** → `POST /v1/ocr` → Try it out → เลือกไฟล์ → Execute

### พัฒนา frontend

เปิด FastAPI ตามคำสั่งด้านบน แล้วเปิดอีก terminal:

```bash
npm --prefix frontend run dev
```

ใช้ URL ที่ Vite แสดง (ปกติ `http://127.0.0.1:5173`) ตัว dev server proxy `/v1`, `/health` และ `/docs` ไป FastAPI port 8000

ภาพตัวอย่างส่งผ่าน `POST /v1/preview?page=1&rotation=0` รองรับ rotation 0/90/180/270 องศาทวนเข็มนาฬิกา คืน PNG พร้อม header `X-Total-Pages` และไม่โหลดโมเดล แสดงภาพ PDF ที่ 100 DPI จำกัดด้านยาว 2000 px กรอบ OCR ใช้พิกัดแบบสัดส่วนหลังหมุนภาพ ถ้าหน้าผ่าน dewarp จะปิดกรอบอัตโนมัติ เพราะภาพต้นฉบับไม่ตรงกับพิกัดหลังแก้ความโค้ง

ใช้ Python 3.11–3.13 (โปรเจกต์เลือก 3.13) และ CPU เป็นค่าเริ่มต้น ไม่ต้องติดตั้ง PyTorch/Paddle หรือใช้ Hugging Face token โมเดลจะดาวน์โหลดน้ำหนักเมื่อเรียก OCR ครั้งแรก (ประมาณ 330 MB; เปิด dewarp ประมาณ 620 MB ตามเอกสารต้นฉบับ) จึงใช้เวลานานกว่าครั้งถัดไป RAM ตามต้นฉบับประมาณ 1.3 GB ต่อหน้า หรือ 2.8 GB เมื่อเปิด dewarp ความเร็วจริงขึ้นกับเครื่องและเอกสาร

## เรียก API

```bash
curl http://127.0.0.1:8000/health

# JSON รายหน้า พร้อมกรอบข้อความและ confidence
curl -X POST 'http://127.0.0.1:8000/v1/ocr?max_pages=3&dpi=150' \
  -F 'file=@/path/to/document.pdf' -o result.json

# Markdown หรือเปลี่ยนเป็น output_format=text
curl -X POST 'http://127.0.0.1:8000/v1/ocr?output_format=markdown' \
  -F 'file=@/path/to/image.png' -o result.md
```

Python client (ติดตั้ง `httpx` ใน environment ฝั่ง client):

```python
import httpx

with open("document.pdf", "rb") as file:
    response = httpx.post(
        "http://127.0.0.1:8000/v1/ocr",
        files={"file": ("document.pdf", file, "application/pdf")},
        params={"max_pages": 3, "dpi": 150},
        timeout=600,
    )
response.raise_for_status()
result = response.json()
print(result["inference_seconds"])
for page in result["pages"]:
    print(page["text"])
```

JSON มี `page_count`, `total_pages`, `truncated`, `options`, `pages`, `inference_seconds` (ไม่รวมโหลดโมเดล) และ `elapsed_seconds` (รวมโหลดโมเดลและรอผล แต่ไม่รวมอัปโหลด/ตรวจไฟล์) ในแต่ละหน้ามี `index` เริ่มที่ 0, `width`, `height`, `rotation`, `dewarped`, `text`, `markdown`, `blocks`, `lines`, `timings` หน่วยเวลาเป็นวินาที พิกัดอยู่บนภาพหลังหมุน/ปรับความโค้งแล้ว ไม่ใช่ภาพต้นฉบับเสมอไป

## ตัวเลือกและข้อจำกัด

Query parameters:

| ชื่อ | ค่าเริ่มต้น | ความหมาย |
| --- | --- | --- |
| `output_format` | `json` | `json`, `text`, `markdown` |
| `dpi` | `150` | ความละเอียด PDF ระหว่าง 72–300; ไม่มีผลกับภาพ |
| `max_pages` | `10` หรือเพดานที่ตั้งไว้ถ้าต่ำกว่า | อ่าน N หน้าแรก สูงสุดตาม `OCR_MAX_PAGES`; หน้าเกินจะไม่ประมวลผลและแจ้ง `truncated=true` |

ตั้งค่าผ่าน `.env` หรือ environment แล้ว restart server:

| Environment | ค่าเริ่มต้น | ความหมาย |
| --- | --- | --- |
| `OCR_DEVICE` | `cpu` | `cpu`, `auto`, `cuda` |
| `OCR_DEWARP` | `false` | ปรับภาพเอกสารโค้ง/ถ่ายเอียง; เพิ่มน้ำหนักและเวลา |
| `OCR_TABLES` | `true` | แยกโครงสร้างตาราง |
| `OCR_MAX_UPLOAD_MB` | `20` | ขนาดไฟล์สูงสุด MB |
| `OCR_MAX_PAGES` | `10` | จำนวนหน้าสูงสุดต่อ request |
| `OCR_MAX_PIXELS` | `25000000` | จำนวนพิกเซลสูงสุดต่อภาพ/หน้า PDF ที่ render |
| `AKSONOCR_WEIGHTS` | ไม่กำหนด | ใช้น้ำหนักในโฟลเดอร์แทนการดาวน์โหลดจาก Hub |

`AKSONOCR_WEIGHTS` ต้องตั้งเป็น environment ที่ export จริง (เช่น `export AKSONOCR_WEIGHTS=/path/to/weights`) เพราะเป็นตัวเลือกของแพ็กเกจต้นฉบับ ไม่ได้อ่านจาก `.env` ของ API

API โหลดโมเดลครั้งเดียวต่อ process และรับงาน OCR ครั้งละหนึ่ง request; ถ้ากำลังทำงานจะคืน `503` พร้อม `Retry-After` ใช้ worker เดียวเพื่อไม่โหลดโมเดลซ้ำ `/health` แสดงว่า process ทำงานและโมเดลถูกโหลดหรือยัง แต่ไม่ได้ทดสอบ inference หรือตรวจ GPU readiness

API ไม่บันทึกไฟล์หรือผล OCR ถาวร; multipart parser อาจพักไฟล์ชั่วคราวบนดิสก์และปิดหลัง request ตรวจขนาดไฟล์หลัง multipart parsing แล้ว หากเปิดรับจากภายนอกควรตั้ง body limit ที่ reverse proxy เพิ่ม API นี้เตรียมสำหรับทดสอบในเครื่องและยังไม่มี authentication

ลายมือ ภาพเบลอ และเอกสารหลายคอลัมน์อาจอ่านผิดตามข้อจำกัดโมเดล ควรเปรียบเทียบกับข้อความที่ตรวจด้วยคน และแยกวัดความถูกต้องของข้อความ ตาราง และลำดับการอ่าน Confidence เป็นคะแนนจากโมเดล ไม่ใช่อัตราความถูกต้องที่ยืนยันแล้ว

## Docker Compose (CPU)

ต้องมี Docker Engine/Desktop และ Docker Compose รุ่นที่รองรับ `up --wait` (Compose v2.20 ขึ้นไป) ตัว image build GUI และ API ให้ครบ ไม่ต้องติดตั้ง Python หรือ Node.js บนเครื่องปลายทาง

```bash
# ไม่บังคับมี .env; ใช้ค่าเริ่มต้นได้เลย
docker compose up -d --build --wait
```

เปิด GUI ที่ [http://localhost:8000](http://localhost:8000/), Swagger ที่ [http://localhost:8000/docs](http://localhost:8000/docs), ReDoc ที่ [http://localhost:8000/redoc](http://localhost:8000/redoc) และ schema ที่ [http://localhost:8000/openapi.json](http://localhost:8000/openapi.json)

Swagger v0.2.0 มี schema ของหน้าเอกสาร/layout/บรรทัด/ตาราง, ตัวอย่าง response JSON/Text/Markdown, คำอธิบาย query parameters และ error codes รวมถึง preview PNG และ response headers ค่าสูงสุดของจำนวนหน้าจะอ้างอิงการตั้งค่าจริง

ครั้งแรกที่เรียก OCR container จะดาวน์โหลดน้ำหนักโมเดล เก็บไว้ใน named volume `aksonocr-lite_model-cache` และใช้ต่อได้หลัง restart/recreate container ตัว image ไม่รวม model weights ส่วน healthcheck ตรวจ `/health` เท่านั้น สถานะ `healthy` และ `--wait` จึงหมายถึง API รับคำขอได้ ยังไม่ยืนยันว่าโหลดโมเดลสำเร็จ

### ปรับค่าการ deploy

```bash
cp .env.example .env
# แก้ค่าที่ต้องการ แล้วใช้คำสั่งเดิมเพื่อ apply
docker compose up -d --build --wait
```

| ตัวแปร | ค่าเริ่มต้น | ใช้ทำอะไร |
| --- | --- | --- |
| `APP_HOST` | `127.0.0.1` | IP ที่ publish port; ตั้ง `0.0.0.0` เพื่อเปิดให้เครื่องอื่นใน LAN |
| `APP_PORT` | `8000` | port บนเครื่อง host; เปลี่ยนเมื่อชนกับโปรแกรมอื่น |
| `OCR_CPUS` | `2.0` | CPU quota ของ container |
| `OCR_MEMORY_LIMIT` | `4g` | RAM สูงสุดของ container; เพิ่มได้เมื่อเปิด dewarp/ใช้เอกสารใหญ่ |
| `AKSONOCR_THREADS` | `2` | จำนวน CPU threads ของแต่ละ ONNX session |

ค่า `OCR_DEWARP`, `OCR_TABLES`, `OCR_MAX_UPLOAD_MB`, `OCR_MAX_PAGES`, `OCR_MAX_PIXELS` ใช้ตามตารางด้านบน Compose นี้เป็น CPU image จึงกำหนด `OCR_DEVICE=cpu` และไม่ส่งค่า CUDA จาก host เข้ามา ตัวแปร `.env` ที่ Compose ใช้ถูกส่งเข้า container เฉพาะรายการใน `compose.yaml` ไฟล์ `.env` ไม่ถูกรวมใน image

ตัวอย่างใช้ port อื่นโดยไม่แก้ไฟล์:

```bash
APP_PORT=8080 docker compose up -d --build --wait
```

เมื่อใช้คำสั่งดูแล container ให้ใช้ค่า port/environment เดิมด้วย ถ้า deploy ผ่าน LAN ให้เปิด `http://IP-ของเซิร์ฟเวอร์:PORT` ระบบยังไม่มี authentication ในตัว จึงควรใช้ในเครือข่ายที่กำหนดสิทธิ์เข้าถึงไว้

### ดูสถานะ อัปเดต และหยุด

```bash
docker compose ps
docker compose logs -f --tail=100 ocr
curl http://localhost:8000/health

# หลังแก้โค้ด ให้ build และ recreate
docker compose up -d --build --wait

# รีสตาร์ต โดยไม่ build
docker compose restart ocr

# หยุดและลบ container/network; เก็บ model cache ไว้
docker compose down
```

`restart: unless-stopped` ให้ container กลับมาทำงานเมื่อ Docker เริ่มใหม่ (หากไม่ได้สั่งหยุดไว้) healthcheck ไม่ได้ restart container ที่ unhealthy โดยอัตโนมัติ Logs จำกัดไฟล์ละ 10 MB เก็บ 3 ไฟล์ Process รันด้วย UID 10001 และมี worker เดียวเพื่อไม่โหลดโมเดลซ้ำ

`docker compose down -v` จะลบ model cache ด้วยและต้องดาวน์โหลดน้ำหนักใหม่ หลีกเลี่ยง `-v` หากต้องการเก็บ cache

หากใช้ไฟล์น้ำหนัก offline ให้เพิ่ม bind mount โฟลเดอร์โมเดลเข้า container และกำหนด `AKSONOCR_WEIGHTS` เป็น path ภายใน container ผ่าน Compose override น้ำหนักต้องอ่านได้โดย UID 10001 ดูรายการไฟล์ในเอกสารต้นฉบับ

### Docker โดยไม่ใช้ Compose

```bash
docker build -t aksonocr-lite-api .
docker run --rm -p 127.0.0.1:8000:8000 \
  -v aksonocr-cache:/cache/huggingface aksonocr-lite-api
```

ถ้าใช้ NVIDIA ให้ใช้ environment ที่ติดตั้ง `onnxruntime-gpu` แทน `onnxruntime` และ CUDA/cuDNN ตาม [ข้อกำหนดต้นฉบับ](https://github.com/Remtir/AksonOCR-Lite#gpu) Dockerfile นี้เป็น CPU image

## ตรวจสอบโค้ด

```bash
uv run pytest
uv run ruff check .
npm --prefix frontend run build
```

Unit tests ไม่ดาวน์โหลดโมเดล โดยทดสอบ contract API, ข้อจำกัดไฟล์/หน้า, PDF, output formats และการป้องกัน inference ซ้อนกัน การทดสอบโมเดลจริงให้รัน API แล้วส่งเอกสารตามตัวอย่างด้านบน

ทดสอบ GUI ผ่านเบราว์เซอร์ (ดาวน์โหลดและเรียกโมเดลจริง):

```bash
cd frontend
npx playwright install chromium
npm run test:e2e
```

Playwright เริ่ม FastAPI ให้อัตโนมัติ หรือใช้ server port 8000 ที่กำลังรันอยู่ ทดสอบภาพตัวอย่าง, PDF 2 หน้า, กรอบข้อความ, คัดลอก, ดาวน์โหลด, มือถือ และกรณี API ไม่พร้อม หากใช้ Chrome ที่ติดตั้งในเครื่องให้ใช้ `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`

ทดสอบ GUI กับ deployment ที่รันอยู่ (ไม่เริ่ม FastAPI เพิ่ม):

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8000 npm --prefix frontend run test:e2e
```

ตรวจ dependency ด้วย `npm --prefix frontend audit` และ `npm --prefix frontend audit --omit=dev` ตอนติดตั้งพบ advisory ReDoS ของ `picomatch` ที่มากับเครื่องมือพัฒนา Vite แต่ registry ยังไม่มีเวอร์ชันแก้ไขในสายปัจจุบัน dependency ที่ใช้รันหน้าเว็บจริงไม่มี advisory จาก npm audit และ dev server ผูกกับ localhost

หรือใช้ภาพตัวอย่างที่สร้างขึ้นเอง (มีข้อความอ้างอิงใน `examples/sample-thai.txt`):

```bash
uv run python -m scripts.smoke_test
```

คำสั่งนี้เรียกโมเดลจริงผ่าน FastAPI TestClient และบันทึกผลที่ `outputs/smoke-result.json` เป็นเพียง smoke test ยืนยันว่าท่อประมวลผลทำงาน ไม่ใช่ผล benchmark ความแม่นยำบนเอกสารจริง

ผล OCR เดิมบน macOS Apple Silicon วันที่ 18 พฤศจิกายน 2026: ส่ง `examples/sample-thai.png` เข้า HTTP API จริงได้ `200` ข้อความ 5 บรรทัดตรงกับข้อความอ้างอิงเมื่อไม่นับ whitespace ใช้เวลา inference 2.5861 วินาที และรวมโหลดโมเดลจาก cache 6.9933 วินาที (CPU, tables=true, dewarp=false)

หลังเพิ่ม Swagger และ Compose: backend tests ผ่าน 24 กรณี รวมการตรวจ schema/example และค่า limits ที่ปรับได้ Docker multi-stage build ผ่าน และ Compose รันเป็น non-root พร้อม healthcheck ผ่าน ทดสอบ OCR ใน Linux ARM64 container (2 CPU, RAM limit 4 GB) ข้อความตรงกับไฟล์อ้างอิง ใช้ inference 7.9481 วินาที รวมดาวน์โหลด/โหลดครั้งแรก 83.047 วินาที และทดสอบ recreate โดยใช้ cache volume เดิมแล้ว

Playwright บน Chrome ทดสอบกับ container จริงผ่าน 5 กรณี รวม Swagger, OCR ภาพ/PDF, กรอบข้อความ, การคัดลอก/ดาวน์โหลด, จอมือถือ 390 px และกรณี API busy ภาพหน้าจออยู่ใน `frontend/test-results/` (ไม่เก็บใน Git) ผลเวลาข้างต้นเป็น smoke test ของภาพตัวอย่าง ไม่ใช่ benchmark บนเอกสารทั่วไป

## กิตติกรรมประกาศ (Acknowledgements)

ขอขอบคุณ **Teetouch Jaknamon (Remtir)** สำหรับการพัฒนา **AksonOCR-Lite** และการเผยแพร่น้ำหนักโมเดล โค้ด และเอกสารประกอบ ซึ่งเป็นรากฐานของระบบ OCR ในโปรเจกต์นี้ การเปิดเผยผลงานดังกล่าวช่วยให้สามารถทดลองประมวลผลเอกสารภาษาไทยและภาษาอังกฤษผ่าน GUI และ API ได้

เครดิตการพัฒนาโมเดลรู้จำข้อความภาษาไทยและ pipeline OCR เป็นของผู้พัฒนา AksonOCR-Lite ส่วนโปรเจกต์นี้พัฒนาส่วนติดต่อผู้ใช้ FastAPI/Swagger และการ deploy ด้วย Docker Compose เพื่อให้ทดลองใช้งานโมเดลได้สะดวกขึ้น

ขอขอบคุณผู้พัฒนาส่วนประกอบที่ AksonOCR-Lite ใช้ ตามที่ระบุในเอกสารต้นฉบับ:

| ผู้พัฒนา / โครงการ | ส่วนประกอบที่นำมาใช้ | แหล่งอ้างอิง |
| --- | --- | --- |
| PaddlePaddle / PaddleOCR | PP-DocLayoutV3 สำหรับ layout และลำดับการอ่าน, PP-OCRv6 สำหรับตรวจจับข้อความและโมเดลตั้งต้นของ recognizer, PP-LCNet สำหรับทิศทางภาพ/บรรทัด | [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) |
| Microsoft | Table Transformer สำหรับโครงสร้างตาราง | [Table Transformer](https://github.com/microsoft/table-transformer) |
| MonkeyOCRv2 | ตัวประมวลผลปรับความโค้งเอกสาร เมื่อเปิด dewarp | [MonkeyOCRv2](https://github.com/Yuliang-Liu/MonkeyOCRv2) |
| ONNX Runtime | ประมวลผลโมเดล ONNX | [ONNX Runtime](https://onnxruntime.ai/) |
| pypdfium2 | อ่านและ render เอกสาร PDF | [pypdfium2](https://github.com/pypdfium2-team/pypdfium2) |

## เอกสารอ้างอิง (References)

1. Jaknamon, T. (2026). **AksonOCR-Lite: Thai Document OCR with Grapheme-Cluster CTC Recognition**, version 1.0.0. [โครงการต้นฉบับและวิธีใช้งาน](https://github.com/Remtir/AksonOCR-Lite)
2. Remtir. **AksonOCR-Lite model weights**. [Hugging Face repository](https://huggingface.co/Remtir/AksonOCR-Lite)
3. Remtir. **Model card**: ที่มา สถาปัตยกรรม และข้อจำกัดของโมเดล. [Model card บน Hugging Face](https://huggingface.co/Remtir/AksonOCR-Lite/blob/main/MODEL_CARD.md)
4. Remtir. **Source revision ที่โปรเจกต์นี้ใช้งาน**: `18da1dfeb9d4fc71d781ec0bfd5c80014e29a225`. [โค้ดที่ตรึงไว้สำหรับการติดตั้ง](https://github.com/Remtir/AksonOCR-Lite/tree/18da1dfeb9d4fc71d781ec0bfd5c80014e29a225)
5. Remtir. **Licenses and third-party attribution**. [Models and licenses](https://github.com/Remtir/AksonOCR-Lite#models-and-licenses), [LICENSE](https://github.com/Remtir/AksonOCR-Lite/blob/main/LICENSE), [NOTICE](https://github.com/Remtir/AksonOCR-Lite/blob/main/NOTICE)

### การอ้างอิง AksonOCR-Lite (BibTeX)

สำหรับรายงานหรือผลงานที่ใช้โมเดล สามารถใช้อ้างอิงตามที่ผู้พัฒนาต้นฉบับระบุไว้ใน [Citation](https://github.com/Remtir/AksonOCR-Lite#citation):

```bibtex
@software{aksonocr_lite,
  author = {Jaknamon, Teetouch},
  title  = {AksonOCR-Lite: Thai Document OCR with Grapheme-Cluster CTC Recognition},
  version = {1.0.0},
  year   = {2026},
  url    = {https://github.com/Remtir/AksonOCR-Lite}
}
```

ตัวโมเดลและโค้ด AksonOCR-Lite ใช้ Apache-2.0 โดยส่วนประกอบจากบุคคลที่สามมีเงื่อนไขสัญญาอนุญาตของตนเอง เช่น Table Transformer ใช้ MIT โปรดตรวจสอบ LICENSE และ NOTICE ต้นฉบับเมื่อนำไปแจกจ่ายหรือพัฒนาต่อยอด
