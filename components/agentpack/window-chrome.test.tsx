jest.mock("@/lib/tauri/os", () => ({ detectOs: jest.fn() }))
jest.mock("@/lib/tauri/window", () => ({
  minimizeWindow: jest.fn(),
  toggleMaximizeWindow: jest.fn(),
  closeWindow: jest.fn(),
  isWindowMaximized: jest.fn(),
  onWindowResized: jest.fn(),
}))

import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { detectOs } from "@/lib/tauri/os"
import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  onWindowResized,
  toggleMaximizeWindow,
} from "@/lib/tauri/window"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { useWindowChrome, WindowControls } from "./window-chrome"

const unlisten = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  ;(isWindowMaximized as jest.Mock).mockResolvedValue(false)
  ;(onWindowResized as jest.Mock).mockResolvedValue(unlisten)
})

function Probe() {
  const chrome = useWindowChrome()
  return (
    <I18nProvider>
      <span data-testid="chrome">{chrome}</span>
      <WindowControls chrome={chrome} />
    </I18nProvider>
  )
}

describe("useWindowChrome", () => {
  it("stays on the undecorated-free layout in web mode", async () => {
    ;(detectOs as jest.Mock).mockResolvedValue(null)
    render(<Probe />)
    await waitFor(() => expect(detectOs).toHaveBeenCalled())
    expect(screen.getByTestId("chrome")).toHaveTextContent("none")
  })

  it("reports macos so the shell reserves room for the traffic lights", async () => {
    ;(detectOs as jest.Mock).mockResolvedValue("mac")
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId("chrome")).toHaveTextContent("macos"))
  })

  it.each(["win", "linux"] as const)("reports custom chrome on %s", async (os) => {
    ;(detectOs as jest.Mock).mockResolvedValue(os)
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId("chrome")).toHaveTextContent("custom"))
  })
})

describe("WindowControls", () => {
  const renderControls = () =>
    render(
      <I18nProvider>
        <WindowControls chrome="custom" />
      </I18nProvider>
    )

  it("renders nothing when the system draws the frame", () => {
    render(
      <I18nProvider>
        <WindowControls chrome="macos" />
      </I18nProvider>
    )
    expect(screen.queryByRole("button", { name: en.shell.closeWindow })).not.toBeInTheDocument()
  })

  it("renders nothing in web mode", () => {
    render(
      <I18nProvider>
        <WindowControls chrome="none" />
      </I18nProvider>
    )
    expect(screen.queryByRole("button", { name: en.shell.minimize })).not.toBeInTheDocument()
  })

  it("wires each button to its window command", async () => {
    renderControls()
    await userEvent.click(screen.getByRole("button", { name: en.shell.minimize }))
    expect(minimizeWindow).toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: en.shell.maximize }))
    expect(toggleMaximizeWindow).toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: en.shell.closeWindow }))
    expect(closeWindow).toHaveBeenCalled()
  })

  it("offers restore instead of maximize once the window is maximized", async () => {
    ;(isWindowMaximized as jest.Mock).mockResolvedValue(true)
    renderControls()
    expect(await screen.findByRole("button", { name: en.shell.restore })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: en.shell.maximize })).not.toBeInTheDocument()
  })

  it("re-reads the maximized state on resize — Tauri emits no maximize event", async () => {
    renderControls()
    await waitFor(() => expect(onWindowResized).toHaveBeenCalled())
    ;(isWindowMaximized as jest.Mock).mockResolvedValue(true)
    ;(onWindowResized as jest.Mock).mock.calls[0][0]()
    expect(await screen.findByRole("button", { name: en.shell.restore })).toBeInTheDocument()
  })

  it("unsubscribes from resizes on unmount", async () => {
    const { unmount } = renderControls()
    await waitFor(() => expect(onWindowResized).toHaveBeenCalled())
    unmount()
    await waitFor(() => expect(unlisten).toHaveBeenCalled())
  })
})
