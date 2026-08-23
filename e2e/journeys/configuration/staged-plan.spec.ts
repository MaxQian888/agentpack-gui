import { expect, test } from "@playwright/test"
import { NOT_IN_TAURI, navTo, openApp } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("keeps network configuration when install selections are cleared", async ({ page }) => {
  await navTo(page, "network")
  const registry = page.locator("#net-registry")
  await registry.fill("https://registry.npmmirror.com")
  await expect(page.getByRole("region", { name: "Pending selection" })).toContainText("1 selected")

  await navTo(page, "presets")
  await page.getByRole("button", { name: "Recommended", exact: true }).click()
  await expect(page.getByRole("region", { name: "Pending selection" })).toContainText("9 selected")
  await page.getByRole("button", { name: "Clear selection" }).click()

  // Clearing means "drop the install batch". The network route is machine
  // configuration and remains staged so the next install can still use it.
  await expect(page.getByRole("region", { name: "Pending selection" })).toContainText("1 selected")
  await navTo(page, "clis")
  await expect(page.locator('input[id^="cli-"]:checked')).toHaveCount(0)
  await navTo(page, "network")
  await expect(page.locator("#net-registry")).toHaveValue("https://registry.npmmirror.com")

  await page.getByRole("button", { name: "Review changes" }).click()
  await expect(page.getByText(NOT_IN_TAURI).first()).toBeVisible()
})
