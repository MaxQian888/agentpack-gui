import { test, expect } from "@playwright/test"
import { openApp, navTo, NOT_IN_TAURI } from "./helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("loads the app shell with the default dashboard section", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Environment dashboard" })).toBeVisible()
  await expect(page.getByText("agentpack").first()).toBeVisible()
})

test("navigates through every sidebar section", async ({ page }) => {
  await navTo(page, "clis")
  await expect(
    page.getByRole("heading", { name: "Which CLIs do you want to install?" })
  ).toBeVisible()

  await navTo(page, "skills")
  await expect(page.getByRole("heading", { name: /Skills/ })).toBeVisible()
  await expect(page.getByRole("tab", { name: "Installed" })).toBeVisible()

  await navTo(page, "mcp")
  await expect(page.getByRole("heading", { name: "MCP servers" })).toBeVisible()

  await navTo(page, "network")
  await expect(page.getByRole("heading", { name: "Network configuration" })).toBeVisible()

  await navTo(page, "ccswitch")
  await expect(page.getByRole("button", { name: "+ Add provider" })).toBeVisible()

  await navTo(page, "ccconnect")
  await expect(page.getByText(NOT_IN_TAURI)).toBeVisible()

  await navTo(page, "config")
  await expect(page.getByRole("button", { name: "Save config" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Load config" })).toBeVisible()

  await navTo(page, "presets")
  await expect(page.getByRole("heading", { name: "Choose a preset" })).toBeVisible()
})
