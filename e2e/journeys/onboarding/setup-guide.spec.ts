import { expect, test } from "@playwright/test"
import { NOT_IN_TAURI, navTo, openApp } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("asks which agent and how it connects, and leaves the picks in the tray where nothing can install", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open the guide" }).click()
  const wizard = page.getByRole("dialog", { name: "Welcome to agentpack" })

  // Which agent — no bundle, no skills, no MCP keys.
  await wizard.getByRole("radio", { name: /^Codex/ }).click()
  await expect(wizard.getByRole("textbox")).toHaveCount(0)
  await wizard.getByRole("button", { name: "Continue" }).click()

  // How it reaches a model: the subscription by default, which needs no key here.
  await expect(wizard.getByRole("radio", { name: /Sign in with my subscription/ })).toBeChecked()
  await wizard.getByRole("radio", { name: /Use an API key/ }).click()
  await expect(wizard.getByRole("button", { name: "Continue" })).toBeDisabled()
  await wizard.getByRole("radio", { name: /Sign in with my subscription/ }).click()
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
  // One stop per workspace plus ⌘K and the tray — not one per section.
  await expect(tour.getByRole("heading", { name: "Overview" })).toBeVisible()
  await expect(tour.getByText("1 / 9")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(tour).toBeHidden()
  await expect(page.getByRole("heading", { name: "Environment dashboard" })).toBeVisible()
})

test("hides the Getting started checklist, and brings it back from Preferences", async ({
  page,
}) => {
  const checklist = page.getByRole("region", { name: "Getting started" })
  // Web mode measures nothing, so every row is unticked and the first is the wizard.
  await expect(checklist.getByRole("button", { name: "Open the guide" })).toBeVisible()
  await checklist.getByRole("button", { name: "Hide" }).click()
  await expect(checklist).toHaveCount(0)

  await navTo(page, "preferences")
  const toggle = page.getByRole("switch", { name: "Show the Getting started list" })
  await expect(toggle).not.toBeChecked()
  await toggle.click()
  await expect(toggle).toBeChecked()

  await navTo(page, "dashboard")
  await expect(checklist).toBeVisible()
})
