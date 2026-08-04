import { expect, test } from "@playwright/test"
import { navTo, openApp } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("shows proxy discovery, proxy modes, and mirror sources", async ({ page }) => {
  await navTo(page, "network")

  await expect(page.getByRole("heading", { name: "Network configuration" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Detected proxies" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Proxy Off" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Mirrors" })).toBeVisible()
  for (const mode of ["Off", "Follow system", "Manual"]) {
    await expect(page.getByRole("radio", { name: mode })).toBeVisible()
  }
})

test("retains npm and GitHub mirror input across page navigation", async ({ page }) => {
  await navTo(page, "network")

  await page.locator("#net-registry").fill("https://registry.npmmirror.com")
  await page.locator("#net-gh-mirror").fill("https://ghproxy.example.com")
  await navTo(page, "presets")
  await navTo(page, "network")
  await expect(page.locator("#net-registry")).toHaveValue("https://registry.npmmirror.com")
  await expect(page.locator("#net-gh-mirror")).toHaveValue("https://ghproxy.example.com")
})
