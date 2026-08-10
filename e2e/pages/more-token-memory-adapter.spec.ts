import { expect, test, type Page } from "@playwright/test"

async function openFixture(page: Page) {
  await page.goto("/e2e/more-token")
  await expect(page.getByRole("heading", { name: "More-token E2E fixture" })).toBeVisible()
}

test("runs scoped root, master, and child account journeys through the memory adapter", async ({
  page,
}) => {
  await openFixture(page)

  await page.getByRole("button", { name: "Root role" }).click()
  await expect(page.getByRole("heading", { name: "Account center" })).toBeVisible()
  const rootTable = page.getByRole("table")
  await expect(rootTable.getByText("master-a", { exact: true })).toBeVisible()
  await rootTable.getByRole("button", { name: "Actions: independent-a" }).click()
  await expect(page.getByRole("menuitem", { name: "Attach" })).toBeVisible()
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "Create account" }).click()
  const createDialog = page.getByRole("dialog")
  await createDialog.getByLabel("Username").fill("child-created")
  await createDialog.getByLabel("Display name").fill("Created child")
  await createDialog.getByLabel("Master account ID").fill("1")
  await createDialog.getByLabel("Initial quota").fill("20")
  await createDialog.getByLabel("Reason").fill("E2E account provisioning")
  await createDialog.getByRole("button", { name: "Create account" }).click()
  await expect(createDialog.getByText("Temporary password — shown once")).toBeVisible()
  await expect(createDialog.getByText("E2E-temporary-9x!Q")).toBeVisible()
  await createDialog.getByRole("button", { name: "Confirm" }).click()

  await page.getByRole("button", { name: "Master role" }).click()
  await expect(page.getByRole("heading", { name: "Account center" })).toBeVisible()
  await page.getByRole("table").getByRole("button", { name: "Actions: master-a" }).click()
  await expect(page.getByRole("menuitem", { name: "Attach" })).toHaveCount(0)
  await page.keyboard.press("Escape")
  const childRow = page.getByRole("row").filter({ hasText: "child-a" })
  await childRow.getByRole("button", { name: "Actions: child-a" }).click()
  await page.getByRole("menuitem", { name: "Disable" }).click()
  const disableDialog = page.getByRole("dialog")
  await disableDialog.getByLabel("Reason").fill("E2E lifecycle control")
  await disableDialog.getByRole("button", { name: "Preview" }).click()
  await expect(disableDialog.getByText("Server-verified impact")).toBeVisible()
  await disableDialog.getByRole("button", { name: "Confirm" }).click()
  await childRow.getByRole("button", { name: "Actions: child-a" }).click()
  await expect(page.getByRole("menuitem", { name: "Enable" })).toBeVisible()
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "Child role" }).click()
  await expect(page.getByRole("heading", { name: "My account" })).toBeVisible()
  await expect(page.getByText("@child-a", { exact: false })).toBeVisible()
  await expect(page.getByText("Master A", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Balance view" }).click()
  await expect(page.getByRole("heading", { name: "Balance", exact: true })).toBeVisible()
  await expect(page.getByText("initial_allocation", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Security view" }).click()
  await expect(page.getByText("Other desktop", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Revoke" }).click()
  await expect(page.getByRole("button", { name: "Revoked" })).toBeDisabled()
})

for (const width of [390, 768, 1280]) {
  test(`keeps the account control plane usable without horizontal clipping at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await openFixture(page)
    await page.keyboard.press("Tab")
    await expect(page.getByRole("button", { name: "Root role" })).toBeFocused()
    await page.getByRole("button", { name: "Root role" }).click()
    await expect(page.getByRole("heading", { name: "Account center" })).toBeVisible()

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    )
    expect(overflows).toBe(false)
    await page.evaluate(() => document.documentElement.classList.add("dark"))
    await expect(page.locator("html")).toHaveClass(/dark/)
    const darkOverflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    )
    expect(darkOverflows).toBe(false)
    if (width < 640) {
      await expect(page.getByRole("table")).toBeHidden()
      await expect(page.locator("article").filter({ hasText: "master-a" })).toBeVisible()
    } else {
      await expect(page.getByRole("table")).toBeVisible()
    }
  })
}
