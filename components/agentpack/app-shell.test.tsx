jest.mock("@/lib/tauri", () => ({ isTauri: () => false }))
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() },
}))

import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { AppShell } from "./app-shell"
import { SECTIONS, sectionMeta, workspaceMeta } from "./sidebar-nav"
import { hasTabs, workspaceOf, type SectionKey } from "@/lib/agentpack/workspaces"
import { en } from "@/lib/i18n/en"

beforeEach(() => {
  useAppStore.setState({ paths: null, panelOpen: false })
  useAppStore.getState().resetPlan()
})

function renderShell() {
  return render(
    <I18nProvider>
      <AppShell />
    </I18nProvider>
  )
}

/** Open a workspace from the rail, then a section from its tab strip. */
async function goTo(section: SectionKey) {
  const w = workspaceOf(section)
  const rail = screen.getByRole("navigation", { name: en.workspaces.nav })
  await userEvent.click(within(rail).getByRole("button", { name: workspaceMeta(w).label(en) }))
  if (hasTabs(w)) {
    await userEvent.click(screen.getByRole("tab", { name: sectionMeta(section).label(en) }))
  }
}

it("lands on the overview, named in the title bar", () => {
  renderShell()
  expect(screen.getByRole("navigation", { name: en.workspaces.nav })).toBeInTheDocument()
  expect(screen.getByText(en.dashboard.title)).toBeInTheDocument()
})

it("reaches every section through its workspace", async () => {
  renderShell()
  for (const s of SECTIONS) {
    await goTo(s.key)
    // Each destination is a real panel, not a blank: its heading is on screen.
    expect(screen.getAllByText(sectionMeta(s.key).label(en)).length).toBeGreaterThan(0)
  }
  // The config section exposes its own load action (navigate to it explicitly
  // so this doesn't depend on which section the loop ends on).
  await goTo("config")
  expect(screen.getByRole("button", { name: /load config/i })).toBeInTheDocument()
})

it("shows a tab strip only where a workspace has more than one destination", async () => {
  renderShell()
  await goTo("dashboard")
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument()
  await goTo("network")
  expect(screen.getByRole("tablist")).toBeInTheDocument()
})

it("only offers the review tray once something is selected", async () => {
  renderShell()
  expect(screen.queryByRole("button", { name: en.tray.review })).not.toBeInTheDocument()
  useAppStore.getState().applyPreset("minimal")
  expect(await screen.findByRole("button", { name: en.tray.review })).toBeInTheDocument()
})

it("toasts when a review is requested with no resolved paths (web mode)", async () => {
  renderShell()
  useAppStore.getState().applyPreset("minimal")
  await userEvent.click(await screen.findByRole("button", { name: en.tray.review }))
  expect(toast.error).toHaveBeenCalled()
})

it("shows the header update badge when an update is available and opens About", async () => {
  useAppStore.setState({
    updateState: "available",
    updateInfo: { version: "9.9.9", currentVersion: "1.0.0" },
    settings: {
      autoCheckUpdates: true,
      skippedVersion: null,
      lastCheckAt: null,
      onboarded: true,
      onboardingProgress: null,
      quickStartDismissed: false,
      ghMirrorPrefix: null,
      skillRepoSources: [],
      proxy: null,
      summonShortcut: null,
      monthlySubscriptionUsd: null,
      providerBackend: "native",
      uiScale: 100,
      reduceMotion: false,
      startupSection: null,
    },
  })
  renderShell()
  await userEvent.click(screen.getByRole("button", { name: en.about.updateAvailable("9.9.9") }))
  expect(screen.getByRole("heading", { name: en.about.title })).toBeInTheDocument()
})

/**
 * The wizard seeds its state from persisted progress exactly once, so it waits
 * for settings to be read — but the effect that reads them returns early outside
 * Tauri. Without releasing the gate here the wizard could never be opened in web
 * mode at all, and every other suite mocks isTauri as true, so nothing caught it.
 */
it("can still open the welcome wizard in web mode", async () => {
  renderShell()
  await userEvent.click(screen.getByRole("button", { name: en.quickStart.openGuide }))
  expect(await screen.findByRole("heading", { name: en.welcome.title })).toBeInTheDocument()
})
