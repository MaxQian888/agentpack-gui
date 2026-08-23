import { expect, test } from "@playwright/test"
import { navTo, openApp } from "../../helpers"

test.beforeEach(async ({ page }) => openApp(page))

test("shows recovery as a real settings destination with an honest browser boundary", async ({
  page,
}) => {
  await navTo(page, "recovery")

  await expect(page.getByRole("tab", { name: "Recovery points" })).toHaveAttribute(
    "aria-selected",
    "true"
  )
  await expect(page.getByRole("heading", { name: "Recovery points" })).toBeVisible()
  const summary = page.getByRole("region", { name: "Recovery summary" })
  await expect(summary).toBeVisible()
  for (const metric of ["Restore points", "Older than the live file", "Newest"]) {
    await expect(summary.getByText(metric, { exact: true })).toBeVisible()
  }
  await expect(summary.getByText("—", { exact: true })).toHaveCount(3)
  await expect(
    summary.getByText(
      "Restore points live on your machine — run the desktop app to see what can be undone."
    )
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Refresh" })).toHaveCount(0)
  await expect(page.getByRole("region", { name: "Restore points" })).toHaveCount(0)
})

test("switches between recovery and profiles without appending both views", async ({ page }) => {
  await navTo(page, "recovery")
  await expect(page.getByRole("heading", { name: "Recovery points" })).toBeVisible()

  await page.getByRole("tab", { name: "Profiles & backup" }).click()

  await expect(page.getByRole("heading", { name: "Profiles & backup" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Recovery points" })).toHaveCount(0)
})
