import { test, expect } from "@playwright/test"
import { openApp, navTo } from "./helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("loads the app shell with the default presets section", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Choose a preset" })).toBeVisible()
  await expect(page.getByText("agentpack").first()).toBeVisible()
})

test("navigates through every sidebar section", async ({ page }) => {
  await navTo(page, "clis")
  await expect(
    page.getByRole("heading", { name: "Which CLIs do you want to install?" })
  ).toBeVisible()

  await navTo(page, "skills")
  await expect(page.getByRole("heading", { name: "Select domain skills to install" })).toBeVisible()

  await navTo(page, "mcp")
  await expect(page.getByRole("heading", { name: "Select MCP servers to add" })).toBeVisible()

  await navTo(page, "network")
  await expect(page.getByRole("heading", { name: "Network configuration" })).toBeVisible()

  await navTo(page, "ccswitch")
  await expect(page.getByRole("button", { name: "+ Add provider" })).toBeVisible()

  await navTo(page, "config")
  await expect(page.getByRole("button", { name: "Save config" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Load config" })).toBeVisible()

  await navTo(page, "presets")
  await expect(page.getByRole("heading", { name: "Choose a preset" })).toBeVisible()
})
