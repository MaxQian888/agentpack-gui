import { expect, test } from "@playwright/test"
import { navTo, openApp } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("shows agent and companion catalogs with the desktop status boundary", async ({ page }) => {
  await navTo(page, "clis")

  await expect(
    page.getByRole("heading", { name: "Which CLIs do you want to install?" })
  ).toBeVisible()
  await expect(page.getByText("Coding agents", { exact: true })).toBeVisible()
  await expect(page.getByText("Companions", { exact: true })).toBeVisible()
  await expect(page.getByText(/Install status can't be checked here/)).toBeVisible()
})

test("selects and clears an individual CLI", async ({ page }) => {
  await navTo(page, "clis")

  const codex = page.locator("#cli-codex")
  await codex.check()
  await expect(codex).toBeChecked()
  await codex.uncheck()
  await expect(codex).not.toBeChecked()
})
