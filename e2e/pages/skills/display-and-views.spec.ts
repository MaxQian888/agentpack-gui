import { expect, test } from "@playwright/test"
import { navTo, openApp } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("shows the skill workbench boundary in web mode", async ({ page }) => {
  await navTo(page, "skills")

  await expect(page.getByRole("heading", { name: /Skills/ })).toBeVisible()
  await expect(page.getByText(/Browse, configure and install skills/)).toBeVisible()
  await expect(page.getByText("Skill browsing needs the desktop app.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Rescan" })).toBeDisabled()
})

test("does not expose desktop skill actions in web mode", async ({ page }) => {
  await navTo(page, "skills")

  await expect(page.getByRole("button", { name: "Bundled skills" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Add skills" })).toHaveCount(0)
})
