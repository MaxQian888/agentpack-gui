import { test, expect } from "@playwright/test"
import { openApp, navTo, reviewChanges, NOT_IN_TAURI } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("reviewing changes in web mode prompts to use the desktop app", async ({ page }) => {
  await navTo(page, "presets")
  await page.getByRole("button", { name: "Recommended", exact: true }).click()
  await reviewChanges(page)
  await expect(page.getByText(NOT_IN_TAURI).first()).toBeVisible()
})

test("the change tray appears only once something is selected", async ({ page }) => {
  await navTo(page, "presets")
  await expect(page.getByRole("button", { name: "Review changes" })).toHaveCount(0)
  await page.getByRole("button", { name: "Recommended", exact: true }).click()
  await expect(page.getByRole("button", { name: "Review changes" })).toBeVisible()
  await page.getByRole("button", { name: "Clear selection" }).click()
  await expect(page.getByRole("button", { name: "Review changes" })).toHaveCount(0)
})

test("save and load config are gated to the desktop runtime", async ({ page }) => {
  await navTo(page, "config")
  await page.getByRole("button", { name: "Save config" }).click()
  await expect(page.getByText(NOT_IN_TAURI).first()).toBeVisible()

  await page.getByRole("button", { name: "Load config" }).click()
  await expect(page.getByText(NOT_IN_TAURI).first()).toBeVisible()
})

test("the cc-switch provider form is gated in web mode", async ({ page }) => {
  await navTo(page, "ccswitch")
  await expect(page.getByRole("button", { name: "Add provider" })).toBeDisabled()
})

test("recommended provider presets are gated in web mode", async ({ page }) => {
  await navTo(page, "ccswitch")
  await expect(page.getByRole("button", { name: "napi.moretoken.ai (Claude)" })).toBeDisabled()
  await expect(page.getByRole("dialog")).toHaveCount(0)
})
