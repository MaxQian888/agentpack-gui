import { expect, test } from "@playwright/test"
import { navTo, openApp } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("shows the environment workbench and the browser scan boundary", async ({ page }) => {
  await navTo(page, "dashboard")

  await expect(page.getByRole("heading", { name: "Environment dashboard" })).toBeVisible()
  await expect(page.getByText("Run the desktop app to scan your real environment.")).toBeVisible()
  await expect(page.getByRole("region", { name: "Environment status" })).toBeVisible()
  await expect(page.getByRole("region", { name: "System inventory" })).toBeVisible()
  await expect(page.getByRole("complementary", { name: "Usage and activity" })).toBeVisible()
  for (const heading of [
    "Spend this month",
    "Recent activity",
    "CLIs & runtimes",
    "MCP servers",
    "Installed skills",
    "cc-switch providers",
    "API endpoint (relay)",
  ]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible()
  }
})

test("opens chat history from the spend card", async ({ page }) => {
  await navTo(page, "dashboard")

  await page.getByRole("button", { name: "Open usage dashboard →" }).click()
  await expect(page.getByRole("heading", { name: "Chat history" })).toBeVisible()
})
