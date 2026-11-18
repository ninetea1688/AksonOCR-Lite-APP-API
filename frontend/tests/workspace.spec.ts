import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";

const pdf = fileURLToPath(
  new URL("../../examples/sample-two-pages.pdf", import.meta.url),
);

test("Swagger renders the documented OCR endpoint", async ({ page }) => {
  await page.goto("/docs");
  await expect(page.locator(".info .title")).toContainText("AksonOCR-Lite API");
  await expect(page.locator(".info .title")).toContainText("0.2.0");
  const operation = page.locator("#operations-Documents-ocr_v1_ocr_post");
  await operation.locator(".opblock-summary").click();
  await expect(
    operation.getByRole("button", { name: "Try it out" }),
  ).toBeVisible();
  await expect(
    operation.getByText("output_format", { exact: true }),
  ).toBeVisible();
  await operation.getByText("Schema", { exact: true }).first().click();
  await expect(operation.locator(".responses-inner")).toContainText(
    "OCRResponse",
  );
});

test("sample OCR, line overlay, output tabs, clipboard and download", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await expect(page.getByText("API พร้อมใช้งาน")).toBeVisible();
  await page.screenshot({
    path: "test-results/workspace-empty.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "ลองเอกสารตัวอย่าง" }).click();
  await expect(page.getByRole("img", { name: /sample-thai/ })).toBeVisible();
  await page.getByRole("button", { name: "เริ่มอ่านเอกสาร" }).click();
  await expect(page.getByText("เสร็จสมบูรณ์")).toBeVisible({ timeout: 110_000 });
  await expect(page.locator("pre")).toContainText("ทดสอบการอ่านข้อความภาษาไทย");
  await expect(page.locator(".line-box")).toHaveCount(5);
  await page.locator(".line-box").first().click();
  await expect(page.getByRole("tab", { name: "รายบรรทัด" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".line-row.selected")).toContainText(
    "ทดสอบการอ่านข้อความภาษาไทย",
  );
  await page.getByRole("checkbox", { name: "แสดงกรอบข้อความ" }).uncheck();
  await expect(page.locator(".line-box")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "แสดงกรอบข้อความ" }).check();
  await page.getByRole("tab", { name: "Markdown" }).click();
  await expect(page.locator("pre")).toContainText("AksonOCR Lite");
  await page.getByRole("button", { name: "คัดลอกผลหน้าปัจจุบัน" }).click();
  await expect(page.getByText("คัดลอกแล้ว")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("AksonOCR Lite");
  await page.getByRole("tab", { name: "JSON", exact: true }).click();
  await expect(page.locator("pre")).toContainText("Remtir/AksonOCR-Lite");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "ดาวน์โหลดผลลัพธ์" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("sample-thai.json");
  await page.getByRole("tab", { name: "ข้อความ", exact: true }).click();
  await page.screenshot({
    path: "test-results/workspace-result.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("PDF preview pagination and capped OCR pages", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("เลือกเอกสาร", { exact: true }).setInputFiles(pdf);
  await expect(page.getByText("หน้า 1 / 2")).toBeVisible();
  await page.getByRole("button", { name: "หน้าถัดไป" }).click();
  await expect(page.getByRole("img", { name: /หน้า 2/ })).toBeVisible();
  await page.getByLabel("จำนวนหน้าสูงสุด").selectOption("1");
  await page.getByRole("button", { name: "เริ่มอ่านเอกสาร" }).click();
  await expect(page.getByText("เสร็จสมบูรณ์")).toBeVisible({ timeout: 110_000 });
  await expect(page.getByRole("status")).toContainText("อ่านแล้ว 1 จาก 2 หน้า");
  await expect(page.getByRole("button", { name: "หน้าถัดไป" })).toBeDisabled();
  await expect(page.locator("pre")).toContainText("ทดสอบการอ่านข้อความภาษาไทย");
});

test("mobile layout and rejected upload", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("เลือกเอกสาร", { exact: true }).setInputFiles({
    name: "invalid.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("invalid"),
  });
  await expect(page.getByRole("alert")).toContainText("รองรับไฟล์");
  await page.getByRole("button", { name: "ลองเอกสารตัวอย่าง" }).click();
  await expect(page.getByRole("img", { name: /sample-thai/ })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/workspace-mobile.png",
    fullPage: true,
  });
});

test("busy API error permits retry", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "ลองเอกสารตัวอย่าง" }).click();
  await page.route("**/v1/ocr?*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "OCR is busy." }),
    }),
  );
  await page.getByRole("button", { name: "เริ่มอ่านเอกสาร" }).click();
  await expect(page.getByRole("alert")).toContainText("กรุณาลองใหม่อีกครั้ง");
  await expect(
    page.getByRole("button", { name: "เริ่มอ่านเอกสาร" }),
  ).toBeEnabled();
});
