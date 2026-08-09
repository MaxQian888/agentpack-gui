import { test, expect } from "@playwright/test"
import { openApp, navTo, WORKSPACE, NOT_IN_TAURI } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("loads the app shell on the overview", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Environment dashboard" })).toBeVisible()
  await expect(page.getByText("agentpack").first()).toBeVisible()
})

test("offers seven task areas instead of exposing every destination", async ({ page }) => {
  const rail = page.getByRole("navigation", { name: "Task areas" })
  for (const label of Object.values(WORKSPACE)) {
    await expect(rail.getByRole("button", { name: label, exact: true })).toBeVisible()
  }
  await expect(rail.getByRole("button")).toHaveCount(Object.keys(WORKSPACE).length)
})

test("navigates through every section, via its workspace", async ({ page }) => {
  await navTo(page, "clis")
  await expect(
    page.getByRole("heading", { name: "Which CLIs do you want to install?" })
  ).toBeVisible()

  await navTo(page, "skills")
  await expect(page.getByRole("heading", { name: /Skills/ })).toBeVisible()
  await expect(page.getByText("Skill browsing needs the desktop app.")).toBeVisible()

  await navTo(page, "mcp")
  await expect(page.getByRole("heading", { name: "MCP servers" })).toBeVisible()

  await navTo(page, "network")
  await expect(page.getByRole("heading", { name: "Network configuration" })).toBeVisible()

  await navTo(page, "cleanup")
  await expect(page.getByRole("heading", { name: "Clean up" })).toBeVisible()
  // Web mode has no machine to measure, so the section says so instead of
  // rendering an empty list that looks like a clean disk.
  await expect(page.getByText("Cleaning needs the desktop app", { exact: false })).toBeVisible()

  await navTo(page, "ccswitch")
  await expect(page.getByRole("button", { name: "+ Add provider" })).toBeVisible()

  await navTo(page, "ccconnect")
  await expect(page.getByText(NOT_IN_TAURI)).toBeVisible()

  await navTo(page, "myAccount")
  await expect(page.getByRole("heading", { name: "My more-token account" })).toBeVisible()
  await expect(
    page.getByText("Personal account management is available", { exact: false })
  ).toBeVisible()

  await navTo(page, "managementOverview")
  await expect(page.getByRole("heading", { name: "Accounts & quota" })).toBeVisible()
  await expect(page.getByText("Account management is available", { exact: false })).toBeVisible()

  await navTo(page, "config")
  await expect(page.getByRole("button", { name: "Save config" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Load config" })).toBeVisible()

  await navTo(page, "presets")
  await expect(page.getByRole("heading", { name: "Choose a preset" })).toBeVisible()
})

test("a single-destination workspace draws no tab strip", async ({ page }) => {
  await navTo(page, "dashboard")
  await expect(page.getByRole("tablist")).toHaveCount(0)
  await navTo(page, "network")
  await expect(page.getByRole("tablist")).toHaveCount(1)
})

test("the command palette opens on ⌘K and navigates", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+k")
  const input = page.getByPlaceholder("Go to a task area, or type an action…")
  await expect(input).toBeVisible()
  await input.fill("Network")
  await page
    .getByRole("option", { name: /Network \/ mirrors/ })
    .first()
    .click()
  await expect(page.getByRole("heading", { name: "Network configuration" })).toBeVisible()
})

test("Escape closes the palette", async ({ page }) => {
  await page.keyboard.press("ControlOrMeta+k")
  const input = page.getByPlaceholder("Go to a task area, or type an action…")
  await expect(input).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(input).toBeHidden()
})
