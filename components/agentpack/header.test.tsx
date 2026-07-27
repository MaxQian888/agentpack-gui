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
  useAppStore.setState({ dryRun: false, osOverride: null })
  ;(detectOs as jest.Mock).mockResolvedValue(null)
})

function renderHeader(onRun = jest.fn()) {
  render(
    <I18nProvider>
      <Header onRun={onRun} />
    </I18nProvider>
  )
  return { onRun }
}

it("toggles dry-run via the preview switch", async () => {
  renderHeader()
  expect(useAppStore.getState().dryRun).toBe(false)
  await userEvent.click(screen.getByLabelText(en.shell.preview))
  expect(useAppStore.getState().dryRun).toBe(true)
})

it("invokes onRun when the run button is clicked", async () => {
  const { onRun } = renderHeader()
  await userEvent.click(screen.getByRole("button", { name: en.shell.run }))
  expect(onRun).toHaveBeenCalled()
})

it("toggles the theme without throwing", async () => {
  renderHeader()
  await userEvent.click(screen.getByRole("button", { name: en.shell.toggleTheme }))
  expect(screen.getByRole("button", { name: en.shell.toggleTheme })).toBeInTheDocument()
})

it("renders only the plain Run button when the quick-install handlers are absent", () => {
  renderHeader()
  expect(screen.getByRole("button", { name: en.shell.run })).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: en.shell.quickInstall })).not.toBeInTheDocument()
})

function renderMenuHeader() {
  const onRun = jest.fn()
  const onQuickInstall = jest.fn()
  const onCustomize = jest.fn()
  render(
    <I18nProvider>
      <Header onRun={onRun} onQuickInstall={onQuickInstall} onCustomize={onCustomize} />
    </I18nProvider>
  )
  return { onRun, onQuickInstall, onCustomize }
}

it("runs a preset bundle from the Run ▾ quick-install menu", async () => {
  const { onQuickInstall } = renderMenuHeader()
  await userEvent.click(screen.getByRole("button", { name: en.shell.quickInstall }))
  await userEvent.click(screen.getByRole("menuitem", { name: en.presets.everything.title }))
  expect(onQuickInstall).toHaveBeenCalledWith("everything")
})

it("opens the customize dialog from the Run ▾ menu", async () => {
  const { onCustomize } = renderMenuHeader()
  await userEvent.click(screen.getByRole("button", { name: en.shell.quickInstall }))
  await userEvent.click(screen.getByRole("menuitem", { name: en.shell.customize }))
  expect(onCustomize).toHaveBeenCalled()
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
    const { onRun } = renderHeader()
    await userEvent.click(await screen.findByRole("button", { name: en.shell.run }))
    expect(onRun).toHaveBeenCalled()
  })
})
