import { expect, test } from "@playwright/test"
import { navTo, NOT_IN_TAURI, openApp } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("shows the cc-connect page and its product explanation", async ({ page }) => {
  await navTo(page, "ccconnect")

  await expect(page.getByRole("heading", { name: "cc-connect management" })).toBeVisible()
  await expect(
    page.getByRole("button", { name: /cc-connect bridges your local coding agents/ })
  ).toBeVisible()
  await expect(page.getByRole("tab", { name: "cc-connect management" })).toHaveAttribute(
    "aria-selected",
    "true"
  )
})

test("gates service and configuration management to the desktop runtime", async ({ page }) => {
  await navTo(page, "ccconnect")

  await expect(page.getByText(NOT_IN_TAURI)).toBeVisible()
  await expect(page.getByText("Bridge service", { exact: true })).toHaveCount(0)
  await expect(page.getByText("Configuration", { exact: true })).toHaveCount(0)
})
