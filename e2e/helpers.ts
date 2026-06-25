import { type Page, expect } from "@playwright/test"

/** Sidebar nav labels (English catalog `menu.*`). */
export const NAV = {
  presets: "Quick setup (preset)",
  clis: "Install / upgrade CLIs",
  skills: "Engineering skills",
  mcp: "MCP servers",
  network: "Network / mirrors",
  ccswitch: "cc-switch management",
  config: "Save current setup as config",
} as const

/** The "run the desktop app" toast shown for Tauri-only actions in web mode. */
export const NOT_IN_TAURI = "Run the desktop app (pnpm tauri dev) to execute installs."

export async function openApp(page: Page) {
  await page.goto("/")
  await expect(page.getByRole("button", { name: "Run plan" })).toBeVisible()
}

export async function navTo(page: Page, key: keyof typeof NAV) {
  await page.getByRole("button", { name: NAV[key], exact: true }).first().click()
}
