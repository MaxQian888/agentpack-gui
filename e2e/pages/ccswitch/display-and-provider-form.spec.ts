import { expect, test } from "@playwright/test"
import { navTo, openApp } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("shows provider management and recommended relay entries", async ({ page }) => {
  await navTo(page, "ccswitch")

  await expect(page.getByRole("heading", { name: "Accounts & relays" })).toBeVisible()
  await expect(page.getByRole("button", { name: "+ Add provider" })).toBeVisible()
  await expect(page.getByRole("button", { name: "napi.moretoken.ai (Claude)" })).toBeVisible()
  await expect(page.getByText(/desktop app/i).first()).toBeVisible()
})

test("gates the add-provider form to the desktop runtime", async ({ page }) => {
  await navTo(page, "ccswitch")
  await expect(page.getByRole("button", { name: "+ Add provider" })).toBeDisabled()
  await expect(page.getByRole("dialog")).toHaveCount(0)
})
