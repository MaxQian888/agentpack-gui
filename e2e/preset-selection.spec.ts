import { test, expect } from "@playwright/test"
import { openApp, navTo } from "./helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("applying the Recommended preset pre-checks CLIs", async ({ page }) => {
  await page.getByRole("button", { name: /Recommended/ }).click()
  await navTo(page, "clis")
  await expect(page.locator("#cli-claude-code")).toBeChecked()
  await expect(page.locator("#cli-codex")).toBeChecked()
})

test("Custom preset clears any selection", async ({ page }) => {
  await page.getByRole("button", { name: /Recommended/ }).click()
  await page.getByRole("button", { name: /Custom/ }).click()
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
  await page.getByRole("combobox", { name: "OS" }).click()
  await page.getByRole("option", { name: "win" }).click()
  await expect(page.getByRole("combobox", { name: "OS" })).toContainText("win")
})
