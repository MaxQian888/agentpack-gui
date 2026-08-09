import { type Page, expect } from "@playwright/test"

/**
 * The seven task areas in the rail (English catalog `workspaces.*`), and which
 * of them owns each destination. Navigation is two steps now — pick the area,
 * then its tab — so the helper below does both and the specs stay about what
 * they're actually testing.
 */
export const WORKSPACE = {
  overview: "Overview",
  install: "Install & repair",
  capabilities: "Capabilities",
  account: "My account",
  management: "Accounts & quota",
  usage: "Usage",
  settings: "Settings",
} as const

/** Section tab labels (English catalog `menu.*`), and their owning workspace. */
export const NAV = {
  dashboard: { workspace: "overview", tab: null },
  presets: { workspace: "install", tab: "Quick setup (preset)" },
  environment: { workspace: "install", tab: "Runtime environment" },
  clis: { workspace: "install", tab: "Install / upgrade CLIs" },
  network: { workspace: "install", tab: "Network / mirrors" },
  cleanup: { workspace: "install", tab: "Clean up" },
  skills: { workspace: "capabilities", tab: "Engineering skills" },
  mcp: { workspace: "capabilities", tab: "MCP servers" },
  ccswitch: { workspace: "capabilities", tab: "Accounts & relays" },
  ccconnect: { workspace: "capabilities", tab: "cc-connect management" },
  myAccount: { workspace: "account", tab: "My account" },
  managementOverview: { workspace: "management", tab: "Operations overview" },
  history: { workspace: "usage", tab: null },
  config: { workspace: "settings", tab: "Save current setup as config" },
  about: { workspace: "settings", tab: "About & updates" },
} as const satisfies Record<string, { workspace: keyof typeof WORKSPACE; tab: string | null }>

/** The "run the desktop app" toast shown for Tauri-only actions in web mode. */
export const NOT_IN_TAURI = "Run the desktop app (pnpm tauri dev) to execute installs."

export async function openApp(page: Page) {
  await page.goto("/")
  // The command affordance is the one control that is always in the title bar,
  // so it's the shell's readiness signal now that the Run button is gone.
  await expect(page.getByRole("button", { name: /⌘K/ })).toBeVisible()
}

export async function navTo(page: Page, key: keyof typeof NAV) {
  const { workspace, tab } = NAV[key]
  await page
    .getByRole("navigation", { name: "Task areas" })
    .getByRole("button", { name: WORKSPACE[workspace], exact: true })
    .click()
  if (tab) await page.getByRole("tab", { name: tab, exact: true }).click()
}

/** Stage the current selection for review, from the change tray. */
export async function reviewChanges(page: Page) {
  await page.getByRole("button", { name: "Review changes" }).click()
}
