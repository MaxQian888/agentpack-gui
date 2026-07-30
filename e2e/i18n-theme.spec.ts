import { test, expect } from "@playwright/test"
import { openApp } from "./helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("switches interface language between English and Chinese", async ({ page }) => {
  // Sidebar starts in English. Language lives behind the header's settings gear
  // as a radio group — the trigger's aria-label is localized, so it is matched
  // per language rather than once.
  await expect(page.getByRole("button", { name: "Quick setup (preset)" })).toBeVisible()

  await page.getByRole("button", { name: "Settings" }).click()
  await page.getByRole("menuitemradio", { name: "中文" }).click()
  await expect(page.getByRole("button", { name: "一键预设安装" })).toBeVisible()

  await page.getByRole("button", { name: "设置" }).click()
  await page.getByRole("menuitemradio", { name: "EN" }).click()
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
