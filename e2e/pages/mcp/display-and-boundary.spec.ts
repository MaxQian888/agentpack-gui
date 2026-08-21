import { expect, test } from "@playwright/test"
import { navTo, openApp } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("summarises the section in three facts, not six", async ({ page }) => {
  await navTo(page, "mcp")

  await expect(page.getByRole("heading", { name: "MCP servers" })).toBeVisible()
  const summary = page.getByRole("region", { name: "MCP summary" })
  for (const statistic of ["Installed", "Catalog", "Needs key"]) {
    await expect(summary.getByText(statistic, { exact: true })).toBeVisible()
  }
  // The per-target counts moved onto the inventory's own scope chips.
  await expect(summary.getByText("Claude Code", { exact: true })).toHaveCount(0)
})

test("does not render filesystem management views in browser mode", async ({ page }) => {
  await navTo(page, "mcp")

  await expect(page.getByText("MCP management is only available in the desktop app.")).toBeVisible()
  await expect(page.getByRole("tab", { name: "Catalog" })).toHaveCount(0)
  await expect(page.getByRole("list", { name: "Configured MCP servers" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Rescan" })).toBeDisabled()
})
