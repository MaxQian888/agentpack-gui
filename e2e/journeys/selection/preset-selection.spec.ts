import { test, expect } from "@playwright/test"
import { openApp, navTo } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("applying the Recommended preset pre-checks CLIs", async ({ page }) => {
  await navTo(page, "presets")
  await page.getByRole("button", { name: "Recommended", exact: true }).click()
  await navTo(page, "clis")
  await expect(page.locator("#cli-claude-code")).toBeChecked()
  await expect(page.locator("#cli-codex")).toBeChecked()
})

test("Custom preset clears any selection", async ({ page }) => {
  await navTo(page, "presets")
  await page.getByRole("button", { name: "Recommended", exact: true }).click()
  // Custom now clears in place — the checklists it used to open a dialog for are
  // on this very page.
  await page.getByRole("button", { name: "Custom", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await navTo(page, "clis")
  await expect(page.locator("#cli-claude-code")).not.toBeChecked()
})

test("a CLI can be toggled manually", async ({ page }) => {
  await navTo(page, "clis")
  const claude = page.locator("#cli-claude-code")
  await expect(claude).not.toBeChecked()
  await claude.click()
  await expect(claude).toBeChecked()
  await claude.click()
  await expect(claude).not.toBeChecked()
})

test("the OS override can be changed from Settings", async ({ page }) => {
  await navTo(page, "about")
  await page.getByLabel("OS", { exact: true }).selectOption("win")
  // Leave and come back: the choice is held in the store, not the control.
  await navTo(page, "presets")
  await navTo(page, "about")
  await expect(page.getByLabel("OS", { exact: true })).toHaveValue("win")
})
