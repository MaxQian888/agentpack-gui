import { expect, test } from "@playwright/test"
import { navTo, openApp } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("shows every preset, configurable surface, and empty selection state", async ({ page }) => {
  await navTo(page, "presets")

  await expect(page.getByRole("heading", { name: "Choose a preset" })).toBeVisible()
  for (const preset of ["Custom", "Minimal", "Recommended", "Everything"]) {
    await expect(page.getByRole("button", { name: preset, exact: true })).toBeVisible()
  }
  await expect(
    page.getByText("A preset pre-fills your selections; you can still adjust each step.")
  ).toBeVisible()
  for (const surface of ["CLIs", "Skills", "MCP servers"]) {
    await expect(page.getByRole("tab", { name: surface, exact: true })).toBeVisible()
  }
  await expect(page.getByRole("region", { name: "Your selection" })).toContainText("Nothing yet.")
})

test("applies a complete preset and Custom clears the staged plan", async ({ page }) => {
  await navTo(page, "presets")

  await page.getByRole("button", { name: "Recommended", exact: true }).click()
  await expect(page.getByRole("button", { name: "Review changes" })).toBeVisible()
  await page.getByRole("button", { name: "Custom", exact: true }).click()
  await expect(page.getByRole("button", { name: "Review changes" })).toHaveCount(0)
})
