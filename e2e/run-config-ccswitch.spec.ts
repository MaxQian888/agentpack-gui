import { test, expect } from "@playwright/test"
import { openApp, navTo, NOT_IN_TAURI } from "./helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("Run plan in web mode prompts to use the desktop app", async ({ page }) => {
  await page.getByRole("button", { name: "Run plan" }).click()
  await expect(page.getByText(NOT_IN_TAURI).first()).toBeVisible()
})

test("save and load config are gated to the desktop runtime", async ({ page }) => {
  await navTo(page, "config")
  await page.getByRole("button", { name: "Save config" }).click()
  await expect(page.getByText(NOT_IN_TAURI).first()).toBeVisible()

  await page.getByRole("button", { name: "Load config" }).click()
  await expect(page.getByText(NOT_IN_TAURI).first()).toBeVisible()
})

test("the cc-switch provider form validates and submits", async ({ page }) => {
  await navTo(page, "ccswitch")
  await page.getByRole("button", { name: "+ Add provider" }).click()

  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("Add provider")).toBeVisible()

  const save = dialog.getByRole("button", { name: "Save", exact: true })
  await expect(save).toBeDisabled()

  await dialog.getByLabel("Name:").fill("My Relay")
  await expect(save).toBeEnabled()

  await save.click()
  // Submitting closes the dialog (the actual write is a desktop-only action).
  await expect(page.getByRole("dialog")).toHaveCount(0)
})

test("recommended provider presets open the add-provider form", async ({ page }) => {
  await navTo(page, "ccswitch")
  // Recommended preset buttons sit next to "+ Add provider".
  await page.getByRole("button", { name: "napi.moretoken.ai (Claude)" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText("Add provider")).toBeVisible()
})
