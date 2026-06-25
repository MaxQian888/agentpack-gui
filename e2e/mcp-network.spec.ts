import { test, expect } from "@playwright/test"
import { openApp, navTo } from "./helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("selecting an MCP target and entering its API key", async ({ page }) => {
  await navTo(page, "mcp")
  await expect(page.getByRole("heading", { name: "Select MCP servers to add" })).toBeVisible()

  // context7 requires a key — its password field is rendered with an aria-label.
  const keyField = page.getByLabel("context7 CONTEXT7_API_KEY")
  await expect(keyField).toBeVisible()

  // Toggle a target checkbox for the first server.
  const firstCheckbox = page.getByRole("checkbox").first()
  await firstCheckbox.click()
  await expect(firstCheckbox).toBeChecked()

  await keyField.fill("sk-test-123")
  await expect(keyField).toHaveValue("sk-test-123")
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
