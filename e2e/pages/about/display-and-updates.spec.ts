import { expect, test } from "@playwright/test"
import { navTo, openApp } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("states the build, the update route, and where config lives", async ({ page }) => {
  await navTo(page, "about")

  await expect(page.getByRole("heading", { name: "About & updates" })).toBeVisible()
  await expect(
    page
      .getByRole("region", { name: "Application status summary" })
      .getByText("Run the desktop app to see the version and check for updates.")
  ).toBeVisible()
  await expect(page.getByRole("region", { name: "Application updates" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Check for updates" })).toBeDisabled()
  await expect(page.getByRole("heading", { name: "Configuration folders" })).toBeVisible()
  await expect(page.getByRole("button", { name: "View on GitHub" })).toBeVisible()
})

/**
 * The preferences moved to their own tab. Two controls writing one setting is
 * how a hotkey switch ends up on while the accelerator is unclaimed.
 */
test("carries no user preferences of its own", async ({ page }) => {
  await navTo(page, "about")

  await expect(page.getByRole("switch")).toHaveCount(0)
  await expect(page.getByLabel("Build commands for")).toHaveCount(0)
})
