import { expect, test } from "@playwright/test"
import { NOT_IN_TAURI, navTo, openApp } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("asks one question, and leaves the picks in the tray where nothing can install", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open the guide" }).click()
  const wizard = page.getByRole("dialog", { name: "Welcome to agentpack" })

  // One real question: which agent. No bundle, no skills, no API keys.
  await wizard.getByRole("radio", { name: /^Codex/ }).click()
  await expect(wizard.getByRole("textbox")).toHaveCount(0)
  await wizard.getByRole("button", { name: "Continue" }).click()

  // The review step is the gate; web mode has nothing to install with, and says so.
  await expect(
    wizard.getByText("Installing needs the desktop app. Your picks are waiting in the change tray.")
  ).toBeVisible()
  await wizard.getByRole("button", { name: "Done" }).click()

  await expect(wizard).toBeHidden()
  await expect(page.getByText(NOT_IN_TAURI).first()).toBeVisible()
  // Codex plus the three servers that need no account.
  await expect(page.getByRole("region", { name: "Pending selection" })).toContainText("4 selected")

  await navTo(page, "clis")
  await expect(page.locator("#cli-codex")).toBeChecked()
  await expect(page.locator("#cli-claude-code")).not.toBeChecked()
})

test("offers no tour detour mid-setup; the tour lives in Preferences", async ({ page }) => {
  await page.getByRole("button", { name: "Open the guide" }).click()
  const wizard = page.getByRole("dialog", { name: "Welcome to agentpack" })
  await expect(wizard.getByRole("button", { name: /Take a tour/ })).toHaveCount(0)
  await page.keyboard.press("Escape")

  await navTo(page, "preferences")
  await page.getByRole("button", { name: "Take a tour" }).click()
  const tour = page.getByRole("dialog", { name: "Guided tour" })
  await expect(tour.getByText("Seven focused workspaces")).toBeVisible()
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
