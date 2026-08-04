import { expect, test } from "@playwright/test"
import { navTo, openApp } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("shows every skill management view", async ({ page }) => {
  await navTo(page, "skills")

  await expect(page.getByRole("heading", { name: /Skills/ })).toBeVisible()
  await expect(page.getByText(/Browse, configure and install skills/)).toBeVisible()
  for (const tab of ["Installed", "Bundled", "Add skills"]) {
    await expect(page.getByRole("tab", { name: tab })).toBeVisible()
  }
})

test("defaults to Installed and reports the desktop browsing boundary", async ({ page }) => {
  await navTo(page, "skills")

  await expect(page.getByRole("tab", { name: "Installed" })).toHaveAttribute(
    "aria-selected",
    "true"
  )
  await expect(page.getByText("Skill browsing needs the desktop app.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Rescan" })).toBeDisabled()
})
