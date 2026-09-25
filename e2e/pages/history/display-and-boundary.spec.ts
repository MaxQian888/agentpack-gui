import { expect, test } from "@playwright/test"
import { navTo, openApp } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("shows the history purpose and supported chat sources", async ({ page }) => {
  await navTo(page, "history")

  await expect(page.getByRole("heading", { name: "Chat history" })).toBeVisible()
  await expect(
    page.getByText("Read past sessions and token usage across Claude Code, Codex, OpenCode and Pi.")
  ).toBeVisible()
})

test("does not present fake empty history controls in browser mode", async ({ page }) => {
  await navTo(page, "history")

  await expect(page.getByText("Run the desktop app to read your local chat history.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Rescan" })).toBeDisabled()
  await expect(page.getByPlaceholder("Search sessions, projects, models…")).toHaveCount(0)
})
