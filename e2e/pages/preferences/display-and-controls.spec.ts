import { expect, test } from "@playwright/test"
import { navTo, openApp } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("groups appearance, startup and machine preferences", async ({ page }) => {
  await navTo(page, "preferences")

  await expect(page.getByRole("heading", { name: "Preferences" })).toBeVisible()
  await expect(page.getByRole("region", { name: "Preference summary" })).toBeVisible()
  for (const group of ["Appearance", "Startup", "This machine"]) {
    await expect(page.getByRole("region", { name: group })).toBeVisible()
  }
  await expect(page.getByRole("switch", { name: "Reduce motion" })).toBeVisible()
  await expect(page.getByLabel("Open on")).toBeVisible()
  // Registering a system-wide accelerator needs the desktop app, and the row
  // says so rather than showing an unexplained disabled switch.
  await expect(page.getByRole("switch", { name: "Global hotkey" })).toBeDisabled()
  await expect(
    page.getByText("The global hotkey can only be registered by the desktop app.")
  ).toBeVisible()
})

test("scales the interface off the document root", async ({ page }) => {
  await navTo(page, "preferences")
  const html = page.locator("html")
  await expect(html).not.toHaveAttribute("data-ui-scale", /.+/)

  await page.getByRole("radio", { name: "125%" }).click()
  await expect(html).toHaveAttribute("data-ui-scale", "125")

  // 100% is the stylesheet's own value, so the default removes the attribute
  // rather than writing a size onto <html>.
  await page.getByRole("radio", { name: "100% · default" }).click()
  await expect(html).not.toHaveAttribute("data-ui-scale", /.+/)
})

test("collapses motion on request", async ({ page }) => {
  await navTo(page, "preferences")
  const html = page.locator("html")
  await page.getByRole("switch", { name: "Reduce motion" }).click()
  await expect(html).toHaveAttribute("data-reduce-motion", "true")
})

test("switches the theme through all three states", async ({ page }) => {
  await navTo(page, "preferences")
  const html = page.locator("html")

  await page.getByRole("radio", { name: "Dark" }).click()
  await expect(html).toHaveClass(/dark/)
  await page.getByRole("radio", { name: "Light" }).click()
  await expect(html).not.toHaveClass(/dark/)
  // Headless Chromium resolves the system scheme to light.
  await page.getByRole("radio", { name: "System" }).click()
  await expect(html).not.toHaveClass(/dark/)
})

test("restores this page's defaults without touching the rest", async ({ page }) => {
  await navTo(page, "preferences")
  await page.getByRole("radio", { name: "110%" }).click()
  await page.getByLabel("Build commands for").selectOption("win")

  await page.getByRole("button", { name: "Restore defaults" }).click()
  await expect(page.locator("html")).not.toHaveAttribute("data-ui-scale", /.+/)
  await expect(page.getByLabel("Build commands for")).toHaveValue("auto")
})
