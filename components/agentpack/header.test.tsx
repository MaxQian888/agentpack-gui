jest.mock("@/lib/tauri/os", () => ({ detectOs: jest.fn().mockResolvedValue(null) }))
jest.mock("@/lib/tauri/window", () => ({
  minimizeWindow: jest.fn(),
  toggleMaximizeWindow: jest.fn(),
  closeWindow: jest.fn(),
  isWindowMaximized: jest.fn().mockResolvedValue(false),
  onWindowResized: jest.fn().mockResolvedValue(() => {}),
}))

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { detectOs } from "@/lib/tauri/os"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { Header } from "./header"
import { en } from "@/lib/i18n/en"

beforeEach(() => {
  useAppStore.setState({ osOverride: null })
  ;(detectOs as jest.Mock).mockResolvedValue(null)
})

function renderHeader(props: Partial<React.ComponentProps<typeof Header>> = {}): {
  onNavigate: jest.Mock
  onOpenCommand: jest.Mock
} {
  const onNavigate = jest.fn()
  const onOpenCommand = jest.fn()
  render(
    <I18nProvider>
      <Header
        workspace="overview"
        section="dashboard"
        onNavigate={onNavigate}
        onOpenCommand={onOpenCommand}
        {...props}
      />
    </I18nProvider>
  )
  return { onNavigate, onOpenCommand }
}

describe("context", () => {
  it("names the workspace, and stays quiet about the section when there's only one", () => {
    renderHeader()
    expect(screen.getByText(en.workspaces.overview)).toBeInTheDocument()
    expect(screen.queryByText(en.menu.dashboard)).not.toBeInTheDocument()
  })

  it("names both once the workspace has tabs to be lost among", () => {
    renderHeader({ workspace: "install", section: "network" })
    expect(screen.getByText(en.workspaces.install)).toBeInTheDocument()
    expect(screen.getByText(en.menu.network)).toBeInTheDocument()
  })
})

describe("controls", () => {
  it("opens the command palette from the search affordance", async () => {
    const { onOpenCommand } = renderHeader()
    await userEvent.click(screen.getByRole("button", { name: /⌘K/ }))
    expect(onOpenCommand).toHaveBeenCalled()
  })

  it("toggles the theme without throwing", async () => {
    renderHeader()
    await userEvent.click(screen.getByRole("button", { name: en.shell.toggleTheme }))
    expect(screen.getByRole("button", { name: en.shell.toggleTheme })).toBeInTheDocument()
  })

  it("carries no run control — the title bar can't show what it would do", () => {
    // A one-click install that is always in reach, on the one row of the window
    // that never explains itself, is exactly the control this refactor removed.
    renderHeader()
    expect(screen.queryByRole("button", { name: en.shell.run })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: en.shell.quickInstall })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(en.shell.preview)).not.toBeInTheDocument()
  })

  it("shows the update affordance only when there is an update to take", async () => {
    const onShowUpdates = jest.fn()
    useAppStore.setState({
      updateState: "available",
      updateInfo: { version: "9.9.9" } as never,
    })
    renderHeader({ onShowUpdates })
    await userEvent.click(screen.getByRole("button", { name: en.about.updateAvailable("9.9.9") }))
    expect(onShowUpdates).toHaveBeenCalled()
    useAppStore.setState({ updateState: "idle", updateInfo: null })
  })
})

// The header doubles as the title bar once the window frame is gone.
describe("frameless window", () => {
  it("stays a plain header in web mode — no drag region, no window buttons", async () => {
    renderHeader()
    await waitFor(() => expect(detectOs).toHaveBeenCalled())
    expect(document.querySelector("header")).not.toHaveAttribute("data-tauri-drag-region")
    expect(screen.queryByRole("button", { name: en.shell.closeWindow })).not.toBeInTheDocument()
  })

  it("becomes a deep drag region on macOS, where the system draws the buttons", async () => {
    ;(detectOs as jest.Mock).mockResolvedValue("mac")
    renderHeader()
    await waitFor(() =>
      expect(document.querySelector("header")).toHaveAttribute("data-tauri-drag-region", "deep")
    )
    expect(screen.queryByRole("button", { name: en.shell.closeWindow })).not.toBeInTheDocument()
  })

  it("adds our own window buttons on Windows/Linux", async () => {
    ;(detectOs as jest.Mock).mockResolvedValue("win")
    renderHeader()
    expect(await screen.findByRole("button", { name: en.shell.minimize })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: en.shell.maximize })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: en.shell.closeWindow })).toBeInTheDocument()
    expect(document.querySelector("header")).toHaveAttribute("data-tauri-drag-region", "deep")
  })

  it("keeps the header's own controls clickable inside the drag region", async () => {
    // Tauri's drag script bails on BUTTON/LABEL/role-bearing elements, so this
    // guards the thing that would break if we ever swapped a control for a div.
    ;(detectOs as jest.Mock).mockResolvedValue("win")
    const { onOpenCommand } = renderHeader()
    await userEvent.click(await screen.findByRole("button", { name: /⌘K/ }))
    expect(onOpenCommand).toHaveBeenCalled()
  })
})
