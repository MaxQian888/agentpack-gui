import { test, expect } from "@playwright/test"
import { openApp } from "./helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("switches interface language between English and Chinese", async ({ page }) => {
  // Sidebar starts in English. The language select's own aria-label is localized,
  // so locate it by its displayed value (EN / 中文) instead.
  await expect(page.getByRole("button", { name: "Quick setup (preset)" })).toBeVisible()

  await page.getByRole("combobox").filter({ hasText: "EN" }).click()
  await page.getByRole("option", { name: "中文" }).click()
  await expect(page.getByRole("button", { name: "一键预设安装" })).toBeVisible()

  await page.getByRole("combobox").filter({ hasText: "中文" }).click()
  await page.getByRole("option", { name: "EN" }).click()
  await expect(page.getByRole("button", { name: "Quick setup (preset)" })).toBeVisible()
})

test("toggles the color theme on the document root", async ({ page }) => {
  const html = page.locator("html")
  // Headless Chromium resolves to the light scheme, so one toggle yields dark.
  await expect(html).not.toHaveClass(/dark/)
  await page.getByRole("button", { name: "Toggle theme" }).click()
  await expect(html).toHaveClass(/dark/)
})

test("toggles dry-run preview mode", async ({ page }) => {
  const preview = page.getByRole("switch", { name: "Preview (dry-run)" })
  await expect(preview).not.toBeChecked()
  await preview.click()
  await expect(preview).toBeChecked()
})
