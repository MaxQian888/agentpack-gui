import { expect, test } from "@playwright/test"
import { NOT_IN_TAURI, navTo, openApp } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("completes setup and stages the chosen terminal bundle", async ({ page }) => {
  await page.getByRole("button", { name: "Open the guide" }).click()
  const wizard = page.getByRole("dialog", { name: "Welcome to agentpack" })

  await wizard.getByRole("radio", { name: /In the terminal/ }).click()
  await wizard.getByRole("button", { name: "Continue" }).click()
  await wizard.getByRole("radio", { name: /Minimal/ }).click()
  await wizard.getByRole("button", { name: "Continue" }).click()

  await expect(wizard.getByText("Claude Code", { exact: true })).toBeVisible()
  await expect(wizard.getByText("Claude Desktop", { exact: true })).toHaveCount(0)
  await expect(wizard.getByText("Memory (official knowledge graph)", { exact: true })).toBeVisible()
  await wizard.getByRole("checkbox", { name: "Rust engineering" }).check()
  await wizard.getByRole("button", { name: "Review and install" }).click()

  await expect(wizard).toBeHidden()
  await expect(page.getByText(NOT_IN_TAURI).first()).toBeVisible()
  await expect(page.getByRole("region", { name: "Pending selection" })).toContainText("3 selected")

  await navTo(page, "clis")
  await expect(page.locator("#cli-claude-code")).toBeChecked()
  await expect(page.locator("#cli-claude-desktop")).not.toBeChecked()
})

test("starts the integrated tour and returns home when it is dismissed", async ({ page }) => {
  await page.getByRole("button", { name: "Open the guide" }).click()
  await page.getByRole("button", { name: "Take a tour →" }).click()

  const tour = page.getByRole("dialog", { name: "Guided tour" })
  await expect(tour.getByText("Seven focused workspaces")).toBeVisible()
  await tour.getByRole("button", { name: "Next" }).click()
  await expect(tour.getByText("Dashboard", { exact: true })).toBeVisible()
  await tour.getByRole("button", { name: "Next" }).click()
  await expect(tour.getByText("Presets", { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Choose a preset" })).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(tour).toBeHidden()
  await expect(page.getByRole("heading", { name: "Environment dashboard" })).toBeVisible()
})

test("restores the quick-start entry point from Preferences", async ({ page }) => {
  await page.getByRole("button", { name: "Don't show again" }).click()
  await expect(page.getByRole("region", { name: "Quick start" })).toHaveCount(0)

  await navTo(page, "preferences")
  const quickStart = page.getByRole("switch", { name: "Show the quick-start card" })
  await expect(quickStart).not.toBeChecked()
  await quickStart.click()
  await expect(quickStart).toBeChecked()

  await navTo(page, "dashboard")
  await expect(page.getByRole("region", { name: "Quick start" })).toBeVisible()
})
