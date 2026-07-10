jest.mock("@/lib/tauri", () => ({ isTauri: () => false }))
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() },
}))

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { toast } from "sonner"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { AppShell } from "./app-shell"
import { SECTIONS } from "./sidebar-nav"
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

it("renders the presets section by default and the run control", () => {
  renderShell()
  expect(screen.getByRole("button", { name: en.shell.run })).toBeInTheDocument()
})

it("renders each section branch when its nav item is selected", async () => {
  renderShell()
  for (const s of SECTIONS) {
    const label = s.label(en)
    // Nav buttons share their label with the section heading; the nav item is first.
    await userEvent.click(screen.getAllByRole("button", { name: label })[0])
    expect(screen.getByRole("button", { name: en.shell.run })).toBeInTheDocument()
  }
  // The config section exposes its own load action (navigate to it explicitly
  // so this doesn't depend on which section the loop ends on).
  await userEvent.click(screen.getAllByRole("button", { name: en.menu.saveConfig })[0])
  expect(screen.getByRole("button", { name: /load config/i })).toBeInTheDocument()
})

it("toasts when Run is pressed with no resolved paths (web mode)", async () => {
  renderShell()
  await userEvent.click(screen.getByRole("button", { name: en.shell.run }))
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
      quickStartDismissed: false,
      ghMirrorPrefix: null,
    },
  })
  renderShell()
  await userEvent.click(screen.getByRole("button", { name: en.about.updateAvailable("9.9.9") }))
  expect(screen.getByRole("heading", { name: en.about.title })).toBeInTheDocument()
})
