import { expect, test } from "@playwright/test"
import { navTo, openApp } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("explains cleanup scope and preserves the recycle area", async ({ page }) => {
  await navTo(page, "cleanup")

  await expect(page.getByRole("heading", { name: "Clean up" })).toBeVisible()
  await expect(page.getByText(/nothing here can touch your credentials/i)).toBeVisible()
  await expect(page.getByText("Recycle area", { exact: true })).toBeVisible()
  await expect(
    page.getByText("The recycle area is only available in the desktop app.", { exact: true })
  ).toBeVisible()
})

test("disables disk scanning when no desktop machine is attached", async ({ page }) => {
  await navTo(page, "cleanup")

  await expect(page.getByText("Cleaning needs the desktop app", { exact: false })).toBeVisible()
  await expect(page.getByRole("button", { name: "Rescan" })).toBeDisabled()
})
