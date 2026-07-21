import { test, expect } from "@playwright/test"
import { openApp, navTo } from "./helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("the MCP section summarises the catalog and defers management to the desktop app", async ({
  page,
}) => {
  await navTo(page, "mcp")
  await expect(page.getByRole("heading", { name: "MCP servers" })).toBeVisible()

  // The stat tiles are computed from the built-in catalog, so they render even
  // without a scan.
  await expect(page.getByText("Catalog", { exact: true })).toBeVisible()
  await expect(page.getByText("Installed", { exact: true })).toBeVisible()
  await expect(page.getByText("Needs key", { exact: true })).toBeVisible()

  // Reading and writing MCP config needs the filesystem, so the manager tabs are
  // desktop-only; the web build says so instead of rendering them.
  await expect(page.getByText("MCP management is only available in the desktop app.")).toBeVisible()
  await expect(page.getByRole("tab", { name: "Catalog" })).toHaveCount(0)
})

test("network configuration fields accept and retain input", async ({ page }) => {
  await navTo(page, "network")
  await expect(page.getByRole("heading", { name: "Network configuration" })).toBeVisible()

  const base = page.locator("#net-base-url")
  const token = page.locator("#net-token")
  const registry = page.locator("#net-registry")

  await base.fill("https://relay.example.com")
  await token.fill("relay-token")
  await registry.fill("https://registry.npmmirror.com")

  await expect(base).toHaveValue("https://relay.example.com")
  await expect(token).toHaveValue("relay-token")
  await expect(registry).toHaveValue("https://registry.npmmirror.com")

  // Values survive a section switch (held in the store).
  await navTo(page, "presets")
  await navTo(page, "network")
  await expect(page.locator("#net-base-url")).toHaveValue("https://relay.example.com")
})
