import { expect, test } from "@playwright/test"
import { navTo, openApp } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("shows catalog statistics calculated from the bundled registry", async ({ page }) => {
  await navTo(page, "mcp")

  await expect(page.getByRole("heading", { name: "MCP servers" })).toBeVisible()
  for (const statistic of ["Catalog", "Installed", "Needs key"]) {
    await expect(page.getByText(statistic, { exact: true })).toBeVisible()
  }
})

test("does not render filesystem management tabs in browser mode", async ({ page }) => {
  await navTo(page, "mcp")

  await expect(page.getByText("MCP management is only available in the desktop app.")).toBeVisible()
  await expect(page.getByRole("tab", { name: "Catalog" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Rescan" })).toBeDisabled()
})
