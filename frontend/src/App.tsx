import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowSquareOut,
  ArrowUpRight,
  ArrowsOutSimple,
  CaretLeft,
  CaretRight,
  Check,
  CheckCircle,
  CircleNotch,
  Copy,
  FileImage,
  FileText,
  Scan,
  SlidersHorizontal,
  UploadSimple,
  X,
  Minus,
  Plus,
  WarningCircle,
  SquaresFour,
} from "@phosphor-icons/react";

type Line = {
  text: string;
  confidence: number;
  bbox: number[];
  poly: number[][];
};
type Page = {
  index: number;
  width: number;
  height: number;
  rotation: number;
  dewarped: boolean;
  text: string;
  markdown: string;
  lines: Line[];
  blocks: unknown[];
  timings: Record<string, number>;
};
type Result = {
  page_count: number;
  total_pages: number;
  truncated: boolean;
  inference_seconds: number;
  elapsed_seconds: number;
  pages: Page[];
  options: {
    dpi: number;
    max_pages: number;
    device: string;
    dewarp: boolean;
    tables: boolean;
  };
};
type Health = {
  status: string;
  model_loaded: boolean;
  device: string;
  dewarp: boolean;
  tables: boolean;
  limits: { max_upload_mb: number; max_pages: number };
};
type Tab = "text" | "markdown" | "lines" | "json";
const tabs: { id: Tab; label: string }[] = [
  { id: "text", label: "ข้อความ" },
  { id: "markdown", label: "Markdown" },
  { id: "lines", label: "รายบรรทัด" },
  { id: "json", label: "JSON" },
];
const accept = ".png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.pdf";
const sizeLabel = (size: number) =>
  size < 1024 ** 2
    ? `${(size / 1024).toFixed(0)} KB`
    : `${(size / 1024 ** 2).toFixed(1)} MB`;

async function errorMessage(response: Response) {
  let detail: unknown;
  try {
    detail = (await response.json()).detail;
  } catch {
    /* Non-JSON upstream error. */
  }
  if (response.status === 413)
    return "ไฟล์หรือความละเอียดภาพเกินขนาดที่กำหนด ลองลดขนาดไฟล์หรือ DPI";
  if (response.status === 415)
    return "ไม่สามารถอ่านไฟล์นี้ได้ กรุณาเลือกภาพหรือ PDF ที่รองรับ";
  if (response.status === 503)
    return "ระบบกำลังประมวลผลงานอื่น หรือโหลดโมเดลไม่ได้ กรุณาลองใหม่อีกครั้ง";
  if (response.status === 422)
    return typeof detail === "string"
      ? detail
      : "กรุณาตรวจสอบไฟล์และค่าที่เลือกอีกครั้ง";
  return "ประมวลผลไม่สำเร็จ กรุณาลองใหม่หรือตรวจสอบ API";
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dpi, setDpi] = useState(150);
  const [maxPages, setMaxPages] = useState(10);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [preview, setPreview] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [totalPreview, setTotalPreview] = useState(1);
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [tab, setTab] = useState<Tab>("text");
  const [boxes, setBoxes] = useState(true);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const requestRef = useRef<AbortController | null>(null);
  const page = result?.pages[pageIndex];
  const rotation = page?.rotation ?? 0;
  const maxUpload = health?.limits.max_upload_mb ?? 20;
  const pageLimit = health?.limits.max_pages ?? 10;
  const pageCount = result?.page_count ?? Math.min(totalPreview, pageLimit);
  const isPdf = file?.name.toLowerCase().endsWith(".pdf");

  useEffect(() => {
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch("/health", { signal: controller.signal });
        if (!response.ok) throw new Error("Health failed");
        const data: Health = await response.json();
        if (!controller.signal.aborted) {
          setHealth(data);
          setMaxPages((value) => Math.min(value, data.limits.max_pages));
        }
      } catch {
        if (!controller.signal.aborted) setHealth(null);
      }
    }
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const timer = setInterval(
      () => setElapsed((Date.now() - started) / 1000),
      100,
    );
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(
    () => () => {
      requestRef.current?.abort();
      clearTimeout(copyTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!file) return;
    const controller = new AbortController();
    let objectUrl = "";
    setPreview("");
    setPreviewError("");
    setPreviewLoading(true);
    async function loadPreview() {
      const form = new FormData();
      form.append("file", file!);
      try {
        const response = await fetch(
          `/v1/preview?page=${pageIndex + 1}&rotation=${rotation}`,
          {
            method: "POST",
            body: form,
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error(await errorMessage(response));
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview(objectUrl);
        setTotalPreview(Number(response.headers.get("X-Total-Pages")) || 1);
      } catch (cause) {
        if (!controller.signal.aborted)
          setPreviewError(
            cause instanceof Error ? cause.message : "โหลดภาพตัวอย่างไม่สำเร็จ",
          );
      } finally {
        if (!controller.signal.aborted) setPreviewLoading(false);
      }
    }
    void loadPreview();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, pageIndex, rotation]);

  function chooseFile(next: File) {
    if (busy || sampleLoading) return;
    setError("");
    if (!/\.(pdf|png|jpe?g|webp|bmp|tiff?)$/i.test(next.name)) {
      setError("รองรับไฟล์ PDF, PNG, JPG, WebP, BMP และ TIFF หน้าเดียว");
      return;
    }
    if (next.size > maxUpload * 1024 ** 2) {
      setError(`ขนาดไฟล์ต้องไม่เกิน ${maxUpload} MB`);
      return;
    }
    if (!next.size) {
      setError("ไฟล์นี้ไม่มีข้อมูล กรุณาเลือกไฟล์ใหม่");
      return;
    }
    setFile(next);
    setResult(null);
    setPageIndex(0);
    setTotalPreview(1);
    setSelectedLine(null);
    setZoom(1);
    setElapsed(0);
    setCopyStatus("");
  }

  async function loadSample() {
    setSampleLoading(true);
    setError("");
    try {
      const response = await fetch("/sample-thai.png");
      if (!response.ok) throw new Error("ไม่สามารถโหลดเอกสารตัวอย่างได้");
      const sample = new File([await response.blob()], "sample-thai.png", {
        type: "image/png",
      });
      setFile(sample);
      setResult(null);
      setPageIndex(0);
      setTotalPreview(1);
      setSelectedLine(null);
      setZoom(1);
      setElapsed(0);
      setCopyStatus("");
    } catch {
      setError("โหลดเอกสารตัวอย่างไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSampleLoading(false);
    }
  }

  async function runOCR() {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    setPageIndex(0);
    setSelectedLine(null);
    setElapsed(0);
    const controller = new AbortController();
    requestRef.current = controller;
    const form = new FormData();
    form.append("file", file);
    try {
      const response = await fetch(`/v1/ocr?dpi=${dpi}&max_pages=${maxPages}`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      setResult(await response.json());
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "เชื่อมต่อ API ไม่สำเร็จ");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const content = !page
    ? ""
    : tab === "json"
      ? JSON.stringify(result, null, 2)
      : tab === "markdown"
        ? page.markdown
        : tab === "lines"
          ? page.lines.map((line) => line.text).join("\n")
          : page.text;

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopyStatus("คัดลอกแล้ว");
    } catch {
      setCopyStatus("คัดลอกไม่ได้ กรุณาดาวน์โหลดแทน");
    }
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyStatus(""), 2500);
  }

  function download() {
    if (!result || !file) return;
    const extension =
      tab === "json" ? "json" : tab === "markdown" ? "md" : "txt";
    const text =
      tab === "json"
        ? JSON.stringify(result, null, 2)
        : result.pages
            .map((item) =>
              tab === "markdown"
                ? item.markdown
                : tab === "lines"
                  ? item.lines.map((line) => line.text).join("\n")
                  : item.text,
            )
            .join("\n\n");
    const url = URL.createObjectURL(
      new Blob([text], {
        type:
          tab === "json"
            ? "application/json;charset=utf-8"
            : "text/plain;charset=utf-8",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${file.name.replace(/\.[^.]+$/, "")}.${extension}`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function navigate(index: number) {
    setPageIndex(index);
    setSelectedLine(null);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Akson OCR หน้าหลัก">
          <span className="brand-icon">
            <Scan size={25} weight="bold" />
          </span>
          <span>
            akson<span className="brand-period">.</span>
          </span>
          <span className="brand-divider" />
          <span className="brand-sub">OCR WORKSPACE</span>
        </a>
        <div className="top-actions">
          <span className={`connection ${health ? "online" : ""}`}>
            <span className="status-dot" />
            {health ? "API พร้อมใช้งาน" : "กำลังเชื่อมต่อ API"}
          </span>
          <a className="api-link" href="/docs" target="_blank" rel="noreferrer">
            API Docs <ArrowSquareOut size={15} />
          </a>
        </div>
      </header>

      <main>
        <section className="intro">
          <div>
            <div className="eyebrow">DOCUMENT INTELLIGENCE / TH + EN</div>
            <h1>เปลี่ยนเอกสารให้เป็นข้อความ</h1>
            <p>
              พื้นที่ทดลองอ่านเอกสารด้วย AksonOCR-Lite เปรียบเทียบผลกับต้นฉบับได้ในที่เดียว
            </p>
          </div>
          <button
            className="sample-button"
            onClick={loadSample}
            disabled={busy || sampleLoading}
          >
            {sampleLoading ? (
              <CircleNotch className="spin" size={18} />
            ) : (
              <FileText size={18} />
            )}
            ลองเอกสารตัวอย่าง <ArrowUpRight size={17} />
          </button>
        </section>

        <section className="control-bar" aria-label="ตั้งค่าการอ่านเอกสาร">
          <div className="settings-heading">
            <SlidersHorizontal size={20} weight="bold" />
            <span>ตั้งค่าการอ่าน</span>
          </div>
          <div className="setting">
            <label htmlFor="dpi">ความละเอียด PDF</label>
            <select
              id="dpi"
              value={dpi}
              disabled={busy}
              onChange={(event) => setDpi(Number(event.target.value))}
            >
              <option value="100">100 DPI</option>
              <option value="150">150 DPI</option>
              <option value="200">200 DPI</option>
              <option value="300">300 DPI</option>
            </select>
          </div>
          <div className="setting">
            <label htmlFor="pages">จำนวนหน้าสูงสุด</label>
            <select
              id="pages"
              value={maxPages}
              disabled={busy}
              onChange={(event) => setMaxPages(Number(event.target.value))}
            >
              {Array.from(
                new Set(
                  [1, 3, 5, 10, pageLimit].filter(
                    (value) => value <= pageLimit,
                  ),
                ),
              )
                .sort((a, b) => a - b)
                .map((value) => (
                  <option key={value} value={value}>
                    {value} หน้า
                  </option>
                ))}
            </select>
          </div>
          <div className="model-settings">
            <span>{health?.tables ? "แยกตาราง" : "ข้อความตาราง"}</span>
            <span>{health?.dewarp ? "ปรับภาพโค้ง" : "ภาพต้นฉบับ"}</span>
            <span>{health?.device?.toUpperCase() ?? "CPU"}</span>
          </div>
        </section>

        {error && (
          <div className="notice error" role="alert">
            <WarningCircle size={20} />
            <span>{error}</span>
            <button aria-label="ปิดข้อความแจ้งเตือน" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {result?.truncated && (
          <div className="notice" role="status">
            <FileText size={19} />
            อ่านแล้ว {result.page_count} จาก {result.total_pages} หน้า
            หากต้องการอ่านเพิ่ม ให้ปรับจำนวนหน้าสูงสุดแล้วเริ่มใหม่
          </div>
        )}

        <div className="workspace">
          <section className="panel document-panel" aria-label="เอกสารต้นฉบับ">
            <div className="panel-heading">
              <div>
                <span className="panel-number">01</span>
                <h2>เอกสารต้นฉบับ</h2>
              </div>
              <span className="subtle">
                {file ? sizeLabel(file.size) : "INPUT"}
              </span>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              className="visually-hidden"
              aria-label="เลือกเอกสาร"
              disabled={busy || sampleLoading}
              onChange={(event) => {
                const next = event.target.files?.[0];
                if (next) chooseFile(next);
                event.target.value = "";
              }}
            />
            {!file ? (
              <div
                className={`upload-area ${dragging ? "is-dragging" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  if (event.dataTransfer.files[0])
                    chooseFile(event.dataTransfer.files[0]);
                }}
              >
                <div className="upload-illustration">
                  <FileText size={58} weight="light" />
                  <span>
                    <Plus size={18} weight="bold" />
                  </span>
                </div>
                <h3>เริ่มต้นจากเอกสารของคุณ</h3>
                <p>ลากไฟล์มาวางที่นี่ หรือเลือกไฟล์จากเครื่อง</p>
                <button
                  className="primary"
                  onClick={() => inputRef.current?.click()}
                >
                  <UploadSimple size={19} weight="bold" />
                  เลือกเอกสาร
                </button>
                <div className="upload-formats">
                  PDF, JPG, PNG, WebP, BMP, TIFF หน้าเดียว
                  <br />
                  ขนาดไม่เกิน {maxUpload} MB ต่อไฟล์
                </div>
                <span className="upload-corner tl" />
                <span className="upload-corner tr" />
                <span className="upload-corner bl" />
                <span className="upload-corner br" />
              </div>
            ) : (
              <>
                <div className="file-bar">
                  <FileImage size={20} />
                  <span title={file.name}>{file.name}</span>
                  <button
                    className="text-button"
                    onClick={() => inputRef.current?.click()}
                    disabled={busy || sampleLoading}
                  >
                    เปลี่ยนไฟล์
                  </button>
                  <button
                    className="icon-button"
                    aria-label="นำไฟล์ออก"
                    disabled={busy}
                    onClick={() => {
                      setFile(null);
                      setResult(null);
                      setPreview("");
                      setError("");
                      setPageIndex(0);
                    }}
                  >
                    <X size={17} />
                  </button>
                </div>
                <div className="preview-toolbar">
                  <div className="page-controls">
                    <button
                      className="icon-button"
                      aria-label="หน้าก่อนหน้า"
                      disabled={busy || pageIndex === 0}
                      onClick={() => navigate(pageIndex - 1)}
                    >
                      <CaretLeft size={17} />
                    </button>
                    <span>
                      หน้า {pageIndex + 1} / {pageCount}
                    </span>
                    <button
                      className="icon-button"
                      aria-label="หน้าถัดไป"
                      disabled={busy || pageIndex >= pageCount - 1}
                      onClick={() => navigate(pageIndex + 1)}
                    >
                      <CaretRight size={17} />
                    </button>
                  </div>
                  <div className="zoom-controls">
                    <button
                      className="icon-button"
                      aria-label="ย่อภาพ"
                      disabled={zoom <= 0.5}
                      onClick={() =>
                        setZoom((value) => Math.max(0.5, value - 0.25))
                      }
                    >
                      <Minus size={16} />
                    </button>
                    <button
                      className="zoom-label"
                      title="ปรับพอดีหน้าจอ"
                      onClick={() => setZoom(1)}
                    >
                      {Math.round(zoom * 100)}%
                    </button>
                    <button
                      className="icon-button"
                      aria-label="ขยายภาพ"
                      disabled={zoom >= 2}
                      onClick={() =>
                        setZoom((value) => Math.min(2, value + 0.25))
                      }
                    >
                      <Plus size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="ปรับภาพพอดีหน้าจอ"
                      onClick={() => setZoom(1)}
                    >
                      <ArrowsOutSimple size={17} />
                    </button>
                  </div>
                </div>
                <div className="preview-stage" aria-busy={previewLoading}>
                  {previewLoading && (
                    <div className="preview-message">
                      <CircleNotch className="spin" size={25} />
                      <p>กำลังเตรียมภาพเอกสาร</p>
                    </div>
                  )}
                  {previewError && (
                    <div className="preview-message">
                      <WarningCircle size={28} />
                      <p>{previewError}</p>
                    </div>
                  )}
                  {preview && (
                    <div
                      className="page-paper"
                      style={{ width: `${zoom * 92}%` }}
                    >
                      <img
                        src={preview}
                        alt={`เอกสาร ${file.name} หน้า ${pageIndex + 1}`}
                      />
                      {boxes && page && !page.dewarped && (
                        <div className="box-layer">
                          {page.lines.map((line, index) => (
                            <button
                              key={index}
                              className={`line-box ${selectedLine === index ? "selected" : ""}`}
                              style={{
                                left: `${(line.bbox[0] / page.width) * 100}%`,
                                top: `${(line.bbox[1] / page.height) * 100}%`,
                                width: `${((line.bbox[2] - line.bbox[0]) / page.width) * 100}%`,
                                height: `${((line.bbox[3] - line.bbox[1]) / page.height) * 100}%`,
                              }}
                              title={`${line.text} · ${(line.confidence * 100).toFixed(1)}%`}
                              aria-label={`ดูบรรทัด ${index + 1}: ${line.text}`}
                              onClick={() => {
                                setSelectedLine(index);
                                setTab("lines");
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {page && (
                  <div className="overlay-controls">
                    <label>
                      <input
                        type="checkbox"
                        checked={boxes && !page.dewarped}
                        disabled={page.dewarped}
                        onChange={(event) => setBoxes(event.target.checked)}
                      />
                      <SquaresFour size={16} />
                      แสดงกรอบข้อความ
                    </label>
                    <span>
                      {page.dewarped
                        ? "ปิดกรอบ: ภาพผ่านการปรับความโค้ง"
                        : `${page.width} × ${page.height} px`}
                    </span>
                  </div>
                )}
              </>
            )}
            <div className="document-footer">
              <div>
                <span className="privacy-dot" />
                ประมวลผลบนเซิร์ฟเวอร์ของคุณ
                <span className="footer-note">ไม่บันทึกเอกสารถาวร</span>
              </div>
              <button
                className="primary run-button"
                disabled={!file || busy || !health || sampleLoading}
                onClick={runOCR}
              >
                {busy ? (
                  <CircleNotch className="spin" size={19} />
                ) : (
                  <Scan size={19} weight="bold" />
                )}
                {busy
                  ? `กำลังอ่าน ${elapsed.toFixed(1)}s`
                  : result
                    ? "อ่านเอกสารอีกครั้ง"
                    : "เริ่มอ่านเอกสาร"}
                {!busy && <ArrowUpRight size={17} />}
              </button>
            </div>
          </section>

          <section className="panel result-panel" aria-label="ผลการอ่านเอกสาร">
            <div className="panel-heading">
              <div>
                <span className="panel-number">02</span>
                <h2>ผลการอ่านเอกสาร</h2>
              </div>
              {result ? (
                <span className="success-label">
                  <CheckCircle size={16} weight="fill" />
                  เสร็จสมบูรณ์
                </span>
              ) : (
                <span className="subtle">OUTPUT</span>
              )}
            </div>
            <div className="result-toolbar">
              <div className="tabs" role="tablist" aria-label="รูปแบบผลลัพธ์">
                {tabs.map((item) => (
                  <button
                    key={item.id}
                    id={`tab-${item.id}`}
                    role="tab"
                    aria-selected={tab === item.id}
                    aria-controls="result-content"
                    tabIndex={tab === item.id ? 0 : -1}
                    onKeyDown={(event) => {
                      const index = tabs.findIndex((entry) => entry.id === tab);
                      const next =
                        event.key === "ArrowRight"
                          ? (index + 1) % tabs.length
                          : event.key === "ArrowLeft"
                            ? (index + tabs.length - 1) % tabs.length
                            : event.key === "Home"
                              ? 0
                              : event.key === "End"
                                ? tabs.length - 1
                                : -1;
                      if (next < 0) return;
                      event.preventDefault();
                      setTab(tabs[next].id);
                      event.currentTarget.parentElement
                        ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                        [next]?.focus();
                    }}
                    className={tab === item.id ? "active" : ""}
                    onClick={() => setTab(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <button
                className="icon-button"
                aria-label="คัดลอกผลหน้าปัจจุบัน"
                disabled={!page || !content}
                onClick={copy}
              >
                {copyStatus === "คัดลอกแล้ว" ? (
                  <Check size={18} />
                ) : (
                  <Copy size={18} />
                )}
              </button>
            </div>
            <div
              id="result-content"
              role="tabpanel"
              tabIndex={0}
              aria-labelledby={`tab-${tab}`}
              className={`result-content ${tab === "json" ? "code-content" : ""}`}
            >
              {busy ? (
                <div className="output-empty processing">
                  <div className="processing-icon">
                    <Scan size={38} weight="light" />
                    <span />
                  </div>
                  <h3>กำลังอ่านเอกสารของคุณ</h3>
                  <p>
                    กำลังตรวจจับข้อความและจัดลำดับการอ่าน
                    <br />
                    ครั้งแรกอาจใช้เวลาเพิ่มเพื่อโหลดโมเดล
                  </p>
                  <span className="elapsed">
                    {elapsed.toFixed(1)}
                    <small> วินาที</small>
                  </span>
                  <span className="processing-note">
                    กรุณารอจนกว่าการประมวลผลจะเสร็จสิ้น
                  </span>
                </div>
              ) : !page ? (
                <div className="output-empty">
                  <div className="output-illustration">
                    <FileText size={43} weight="light" />
                    <span className="mock-line" />
                    <span className="mock-line short" />
                  </div>
                  <h3>ข้อความของคุณจะปรากฏที่นี่</h3>
                  <p>
                    เลือกเอกสาร แล้วกด “เริ่มอ่านเอกสาร”
                    <br />
                    เพื่อดูข้อความและตรวจสอบกับต้นฉบับ
                  </p>
                  <div className="format-chips">
                    <span>ภาษาไทย</span>
                    <span>English</span>
                    <span>ตาราง</span>
                  </div>
                </div>
              ) : tab === "lines" ? (
                <div className="line-list">
                  <div className="line-list-heading">
                    <span>{page.lines.length} บรรทัด</span>
                    <span title="คะแนนจากโมเดล ไม่ใช่อัตราความถูกต้องที่ยืนยันแล้ว">
                      Confidence
                    </span>
                  </div>
                  {page.lines.length ? (
                    page.lines.map((line, index) => (
                      <button
                        key={index}
                        className={`line-row ${selectedLine === index ? "selected" : ""}`}
                        onClick={() => setSelectedLine(index)}
                      >
                        <span className="line-index">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span>{line.text}</span>
                        <span
                          className={`confidence ${line.confidence < 0.8 ? "low" : ""}`}
                        >
                          {(line.confidence * 100).toFixed(1)}%
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="no-text">ไม่พบบรรทัดข้อความในหน้านี้</p>
                  )}
                </div>
              ) : (
                <pre className={tab === "text" ? "plain-text" : ""}>
                  {content || "ไม่พบข้อความในหน้านี้"}
                </pre>
              )}
            </div>
            <div className="result-footer">
              <div aria-live="polite">
                {copyStatus ||
                  (result ? (
                    <>
                      <span className="timing">
                        {result.inference_seconds.toFixed(2)}s
                      </span>{" "}
                      <span>OCR · {result.page_count} หน้า</span>
                    </>
                  ) : (
                    "รองรับ Text, Markdown และ JSON"
                  ))}
              </div>
              <button
                className="download-button"
                disabled={!result}
                onClick={download}
              >
                <ArrowDown size={18} />
                ดาวน์โหลด{result && result.page_count > 1 ? "ทุกหน้า" : "ผลลัพธ์"}
              </button>
            </div>
          </section>
        </div>

        <footer className="page-footer">
          <span>
            AksonOCR-Lite <span className="footer-slash">/</span>{" "}
            เอกสารไทยและอังกฤษ
          </span>
          <span>
            {result
              ? `ผลจาก ${result.options.dpi} DPI · รวม ${result.elapsed_seconds.toFixed(2)}s`
              : "เริ่มจากเอกสาร 1 หน้า เพื่อทดลองผลลัพธ์"}
            <span className="footer-slash">/</span>
            <a
              href="https://huggingface.co/Remtir/AksonOCR-Lite"
              target="_blank"
              rel="noreferrer"
            >
              เกี่ยวกับโมเดล <ArrowSquareOut size={13} />
            </a>
          </span>
        </footer>
        {page && (
          <p className="confidence-note">
            Confidence เป็นคะแนนจากโมเดล ควรตรวจสอบข้อความกับต้นฉบับก่อนนำไปใช้
            {isPdf ? " · เปลี่ยนหน้าเอกสารเพื่อดูผลแต่ละหน้า" : ""}
          </p>
        )}
      </main>
    </div>
  );
}
