import { test, expect } from "@playwright/test"
import { openApp, navTo } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("switches interface language between English and Chinese", async ({ page }) => {
  // Language is a set-once preference, so it moved out of the title bar and into
  // Settings → About with the rest of them.
  // The rail's own accessible name is localized too, so it is re-queried each
  // time rather than captured once.
  const rail = (name: string) => page.getByRole("navigation", { name })
  await expect(rail("Task areas").getByRole("button", { name: "Install & repair" })).toBeVisible()

  await navTo(page, "about")
  await page.getByLabel("Language").selectOption("zh-CN")
  await expect(rail("任务分区").getByRole("button", { name: "安装与修复" })).toBeVisible()

  await page.getByLabel("语言").selectOption("en")
  await expect(rail("Task areas").getByRole("button", { name: "Install & repair" })).toBeVisible()
})

test("toggles the color theme on the document root", async ({ page }) => {
  const html = page.locator("html")
  // Headless Chromium resolves to the light scheme, so one toggle yields dark.
  await expect(html).not.toHaveClass(/dark/)
  await page.getByRole("button", { name: "Toggle theme" }).click()
  await expect(html).toHaveClass(/dark/)
})

test("carries no global preview switch — preview belongs to a run", async ({ page }) => {
  await expect(page.getByRole("switch", { name: "Preview (dry-run)" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Run plan" })).toHaveCount(0)
})
