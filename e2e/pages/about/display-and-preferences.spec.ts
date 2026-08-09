import { expect, test } from "@playwright/test"
import { navTo, openApp } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("shows update state and every user preference", async ({ page }) => {
  await navTo(page, "about")

  await expect(page.getByRole("heading", { name: "About & updates" })).toBeVisible()
  await expect(
    page
      .getByRole("region", { name: "Application preferences" })
      .getByText("Run the desktop app to see the version and check for updates.")
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Check for updates" })).toBeDisabled()
  await expect(page.getByLabel("Language")).toHaveValue("en")
  await expect(page.getByLabel("OS", { exact: true })).toBeVisible()
  await expect(page.getByRole("switch", { name: "Check for updates on startup" })).toBeVisible()
  await expect(page.getByRole("switch", { name: "Global hotkey" })).toBeDisabled()
})

test("opens both guided help entry points", async ({ page }) => {
  await navTo(page, "about")

  await expect(page.getByRole("button", { name: "Take a tour" })).toBeVisible()
  await page.getByRole("button", { name: "Show welcome guide" }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
})
