import { expect, test } from "@playwright/test"
import { navTo, openApp } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("shows all supported runtimes and their role", async ({ page }) => {
  await navTo(page, "environment")

  await expect(page.getByRole("heading", { name: "Runtime environment" })).toBeVisible()
  for (const runtime of ["Node.js", "Bun", "Python", "uv"]) {
    await expect(page.getByText(runtime, { exact: true }).first()).toBeVisible()
  }
  await expect(page.getByText(/Node.js \(with npm\)/)).toBeVisible()
})

test("keeps detection honest in browser mode", async ({ page }) => {
  await navTo(page, "environment")

  await expect(
    page.getByText("Runtime detection needs the desktop app — here the versions below stay blank.")
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Re-detect" })).toBeVisible()
})
