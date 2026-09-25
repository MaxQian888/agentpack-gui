import { expect, test } from "@playwright/test"
import { NOT_IN_TAURI, navTo, openApp } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("keeps a picked mirror across bundle switches, and Clear clears it", async ({ page }) => {
  await navTo(page, "network")
  const registry = page.locator("#net-registry")
  await registry.fill("https://registry.npmmirror.com")
  const tray = page.getByRole("region", { name: "Pending selection" })
  await expect(tray).toContainText("1 selected")

  // Picking a bundle replaces the install selection, not the network route.
  await navTo(page, "presets")
  await page.getByRole("button", { name: "Recommended", exact: true }).click()
  await expect(tray).toContainText("9 selected")

  await page.getByRole("button", { name: "Review changes" }).click()
  await expect(page.getByText(NOT_IN_TAURI).first()).toBeVisible()

  // A mirror that was never applied is part of the selection: Clear that
  // leaves "1 selected" behind is a Clear that doesn't work.
  await page.getByRole("button", { name: "Clear selection" }).click()
  await expect(tray).toHaveCount(0)
  await navTo(page, "clis")
  await expect(page.locator('input[id^="cli-"]:checked')).toHaveCount(0)
  await navTo(page, "network")
  await expect(page.locator("#net-registry")).toHaveValue("")
})
