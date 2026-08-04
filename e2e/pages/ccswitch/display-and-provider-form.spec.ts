import { expect, test } from "@playwright/test"
import { navTo, openApp } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("shows provider management and recommended relay entries", async ({ page }) => {
  await navTo(page, "ccswitch")

  await expect(page.getByRole("heading", { name: "cc-switch management" })).toBeVisible()
  await expect(page.getByRole("button", { name: "+ Add provider" })).toBeVisible()
  await expect(page.getByRole("button", { name: "napi.moretoken.ai (Claude)" })).toBeVisible()
  await expect(page.getByText(/desktop app/i).first()).toBeVisible()
})

test("validates and accepts the add-provider form", async ({ page }) => {
  await navTo(page, "ccswitch")
  await page.getByRole("button", { name: "+ Add provider" }).click()

  const dialog = page.getByRole("dialog")
  const save = dialog.getByRole("button", { name: "Save", exact: true })
  await expect(dialog.getByText("Add provider")).toBeVisible()
  await expect(save).toBeDisabled()
  await dialog.getByLabel("Name:").fill("E2E relay")
  await expect(save).toBeEnabled()
  await save.click()
  await expect(dialog).toBeHidden()
})
