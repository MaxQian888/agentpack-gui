import { expect, test } from "@playwright/test"
import { navTo, openApp } from "../helpers"

const sections = [
  { id: "presets", primary: "Preset and component selection", aside: "Selected items" },
  { id: "clis", primary: "CLI catalog", aside: "CLI selection guidance" },
  { id: "environment", primary: "Runtime catalog", aside: "Runtime detection controls" },
  { id: "network", primary: "Proxy configuration", aside: "Network discovery" },
  { id: "cleanup", primary: "Cleanup targets", aside: "Cleanup recovery" },
  { id: "about", primary: "Application preferences", aside: "Application locations" },
] as const

for (const section of sections) {
  test(`${section.id} stays single-column on mobile and switches to the 8/4 workbench`, async ({
    page,
  }) => {
    await openApp(page)
    await navTo(page, section.id)
    await page.setViewportSize({ width: 320, height: 900 })

    const mobileOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    )
    expect(mobileOverflow).toBe(false)

    const primary = page.getByRole("region", { name: section.primary })
    const aside = page.getByRole("complementary", { name: section.aside })
    await expect(primary).toBeVisible()
    await expect(aside).toBeVisible()
    const mobilePrimary = await primary.boundingBox()
    const mobileAside = await aside.boundingBox()
    expect(mobileAside!.y).toBeGreaterThan(mobilePrimary!.y)

    await page.setViewportSize({ width: 1100, height: 760 })
    const desktopPrimary = await primary.boundingBox()
    const desktopAside = await aside.boundingBox()
    expect(desktopAside!.x).toBeGreaterThan(desktopPrimary!.x)
    expect(desktopAside!.y).toBeLessThan(desktopPrimary!.y + desktopPrimary!.height)
  })
}
