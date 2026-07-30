import { test, expect } from "@playwright/test"
import { openApp, navTo } from "./helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("applying the Recommended preset pre-checks CLIs", async ({ page }) => {
  await navTo(page, "presets")
  await page.getByRole("button", { name: /^Recommended/ }).click()
  await navTo(page, "clis")
  await expect(page.locator("#cli-claude-code")).toBeChecked()
  await expect(page.locator("#cli-codex")).toBeChecked()
})

test("Custom preset clears any selection", async ({ page }) => {
  await navTo(page, "presets")
  await page.getByRole("button", { name: /^Recommended/ }).click()
  await page.getByRole("button", { name: /^Custom/ }).click()
  // Custom resets the plan and opens the customize dialog — dismiss it before navigating.
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toBeHidden()
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

test("the OS override can be changed from the header", async ({ page }) => {
  // Behind the settings gear, in an "OS" submenu.
  await page.getByRole("button", { name: "Settings" }).click()
  await page.getByRole("menuitem", { name: "OS" }).click()
  await page.getByRole("menuitemradio", { name: "win" }).click()

  // Reopen and confirm the choice stuck.
  await page.getByRole("button", { name: "Settings" }).click()
  await page.getByRole("menuitem", { name: "OS" }).click()
  await expect(page.getByRole("menuitemradio", { name: "win" })).toBeChecked()
})
