import { expect, test } from "@playwright/test"
import { navTo, NOT_IN_TAURI, openApp } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("shows profile, backup, and config-file controls", async ({ page }) => {
  await navTo(page, "config")

  await expect(page.getByRole("heading", { name: "Profiles" })).toBeVisible()
  await expect(page.getByText("No profiles saved yet.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Save config" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Load config" })).toBeVisible()
})

test("gates profile and config filesystem writes to the desktop runtime", async ({ page }) => {
  await navTo(page, "config")

  await page.getByPlaceholder("Profile name").fill("Browser profile")
  await page.getByRole("button", { name: "Save current as profile" }).click()
  await expect(page.getByText(NOT_IN_TAURI).first()).toBeVisible()
  await page.getByRole("button", { name: "Save config" }).click()
  await expect(page.getByText(NOT_IN_TAURI).first()).toBeVisible()
})
