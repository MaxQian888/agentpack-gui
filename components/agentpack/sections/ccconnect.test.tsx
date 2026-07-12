const isTauriMock = jest.fn(() => true)
jest.mock("@/lib/tauri", () => ({ isTauri: () => isTauriMock() }))
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() },
}))
jest.mock("@/lib/tauri/commands", () => ({
  detectCli: jest.fn(async () => ({ installed: false })),
  isProcessRunning: jest.fn(async () => false),
  probePort: jest.fn(async () => false),
  pathExists: jest.fn(async () => false),
  readTextFile: jest.fn(async () => ""),
  writeTextFile: jest.fn(async () => undefined),
  startCcConnect: jest.fn(async () => undefined),
  stopCcConnect: jest.fn(async () => undefined),
  runCommand: jest.fn(async (_cmd: unknown, onLine: (l: string) => void) => {
    onLine("installing")
    return 0
  }),
}))
jest.mock("@/lib/tauri/system", () => ({
  openUrl: jest.fn(async () => undefined),
  revealPath: jest.fn(async () => undefined),
  notify: jest.fn(async () => undefined),
}))

import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { RunnerProvider } from "../run/runner-context"
import { useAppStore } from "@/store/app-store"
import { toast } from "sonner"
import {
  detectCli,
  isProcessRunning,
  pathExists,
  probePort,
  readTextFile,
  runCommand,
  startCcConnect,
  stopCcConnect,
  writeTextFile,
} from "@/lib/tauri/commands"
import { openUrl, revealPath } from "@/lib/tauri/system"
import { CcConnectSection } from "./ccconnect"
import { en } from "@/lib/i18n/en"

const CONFIG = "/h/.cc-connect/config.toml"
const paths = {
  ccConnectDir: "/h/.cc-connect",
  ccConnectConfig: CONFIG,
  os: "mac",
} as never

beforeEach(() => {
  jest.clearAllMocks()
  // clearAllMocks keeps implementations, so restore the defaults individual
  // tests override with a persistent mockResolvedValue.
  isTauriMock.mockReturnValue(true)
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: false })
  ;(isProcessRunning as jest.Mock).mockResolvedValue(false)
  ;(probePort as jest.Mock).mockResolvedValue(false)
  ;(pathExists as jest.Mock).mockResolvedValue(false)
  ;(readTextFile as jest.Mock).mockResolvedValue("")
  useAppStore.setState({
    paths,
    dryRun: false,
    panelOpen: false,
    osOverride: null,
    detections: {},
    latestVersions: {},
    cliManagers: {},
  })
})

function renderCc() {
  return render(
    <I18nProvider>
      <RunnerProvider>
        <CcConnectSection />
      </RunnerProvider>
    </I18nProvider>
  )
}

it("shows the not-in-Tauri fallback in web mode", async () => {
  isTauriMock.mockReturnValue(false)
  renderCc()
  expect(screen.getByText(en.shell.notInTauri)).toBeInTheDocument()
})

it("shows not-detected and installs via the runner", async () => {
  renderCc()
  expect(await screen.findByText(en.ccconnect.notDetected)).toBeInTheDocument()
  const install = screen.getByRole("button", { name: en.ccconnect.install })
  await userEvent.click(install)
  await waitFor(() =>
    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ file: "npm", args: ["install", "-g", "cc-connect"] }),
      expect.any(Function),
      expect.anything()
    )
  )
})

it("shows the detected version and offers an upgrade when one exists", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.0.0" })
  useAppStore.setState({ latestVersions: { "cc-connect": "1.4.1" } })
  renderCc()
  expect(await screen.findByText(`${en.ccconnect.detected} · 1.0.0`)).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: en.shell.upgrade }))
  await waitFor(() =>
    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["install", "-g", "cc-connect@latest"] }),
      expect.any(Function),
      expect.anything()
    )
  )
})

it("uninstalls after confirmation", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  renderCc()
  await userEvent.click(await screen.findByRole("button", { name: en.ccconnect.uninstall }))
  const dialog = await screen.findByRole("alertdialog")
  await userEvent.click(within(dialog).getByRole("button", { name: en.ccconnect.uninstall }))
  await waitFor(() =>
    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["uninstall", "-g", "cc-connect"] }),
      expect.any(Function),
      expect.anything()
    )
  )
})

it("starts the bridge and reflects the running state", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(startCcConnect as jest.Mock).mockImplementation(async () => {
    // The process table catches up between the spawn and the first poll.
    ;(isProcessRunning as jest.Mock).mockResolvedValue(true)
  })
  renderCc()
  const start = await screen.findByRole("button", { name: en.ccconnect.start })
  await waitFor(() => expect(start).toBeEnabled())
  await userEvent.click(start)
  await waitFor(() => expect(startCcConnect).toHaveBeenCalled(), { timeout: 3000 })
  expect(await screen.findByText(en.ccconnect.running, {}, { timeout: 3000 })).toBeInTheDocument()
})

it("stops the bridge and reflects the stopped state", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(isProcessRunning as jest.Mock).mockResolvedValue(true)
  ;(stopCcConnect as jest.Mock).mockImplementation(async () => {
    ;(isProcessRunning as jest.Mock).mockResolvedValue(false)
  })
  renderCc()
  const stop = await screen.findByRole("button", { name: en.ccconnect.stop })
  await userEvent.click(stop)
  await waitFor(() => expect(stopCcConnect).toHaveBeenCalled())
  expect(await screen.findByText(en.ccconnect.stopped, {}, { timeout: 3000 })).toBeInTheDocument()
})

it("surfaces a start failure as a toast", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(startCcConnect as jest.Mock).mockRejectedValue("boom")
  renderCc()
  const start = await screen.findByRole("button", { name: en.ccconnect.start })
  await waitFor(() => expect(start).toBeEnabled())
  await userEvent.click(start)
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en.ccconnect.startFailed))
})

it("surfaces a stop failure as a toast", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(isProcessRunning as jest.Mock).mockResolvedValue(true)
  ;(stopCcConnect as jest.Mock).mockRejectedValue("boom")
  renderCc()
  await userEvent.click(await screen.findByRole("button", { name: en.ccconnect.stop }))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en.ccconnect.stopFailed))
})

it("disables start/stop and shows a hint in preview (dry-run) mode", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  useAppStore.setState({ dryRun: true })
  renderCc()
  const start = await screen.findByRole("button", { name: en.ccconnect.start })
  expect(start).toBeDisabled()
  expect(screen.getByText(en.ccconnect.dryRunBlocked)).toBeInTheDocument()
})

it("disables start while cc-connect is not installed", async () => {
  renderCc()
  const start = await screen.findByRole("button", { name: en.ccconnect.start })
  await screen.findByText(en.ccconnect.notDetected)
  expect(start).toBeDisabled()
})

it("opens the dashboard on the management port once that port answers", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(probePort as jest.Mock).mockResolvedValue(true)
  renderCc()
  const open = await screen.findByRole("button", { name: en.ccconnect.openWeb })
  await waitFor(() => expect(open).toBeEnabled())
  await userEvent.click(open)
  expect(openUrl).toHaveBeenCalledWith("http://localhost:9820")
})

it("keeps Open dashboard disabled while the management port isn't answering", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  // Process up but no port bound yet (management disabled): running, not openable.
  ;(isProcessRunning as jest.Mock).mockResolvedValue(true)
  renderCc()
  const open = await screen.findByRole("button", { name: en.ccconnect.openWeb })
  await screen.findByText(en.ccconnect.running)
  expect(open).toBeDisabled()
})

it("appends the management token to the dashboard URL when one is configured", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  ;(probePort as jest.Mock).mockResolvedValue(true)
  ;(readTextFile as jest.Mock).mockResolvedValue('[management]\nenabled = true\ntoken = "secret"\n')
  renderCc()
  const open = await screen.findByRole("button", { name: en.ccconnect.openWeb })
  await waitFor(() => expect(open).toBeEnabled())
  await userEvent.click(open)
  expect(openUrl).toHaveBeenCalledWith("http://localhost:9820/?token=secret")
})

it("treats a listening service port as running even when the process name doesn't match", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(isProcessRunning as jest.Mock).mockResolvedValue(false)
  ;(probePort as jest.Mock).mockResolvedValue(true)
  renderCc()
  expect(await screen.findByText(en.ccconnect.running)).toBeInTheDocument()
})

it("passes the management, bridge and webhook ports to stop", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(isProcessRunning as jest.Mock).mockResolvedValue(true)
  ;(stopCcConnect as jest.Mock).mockImplementation(async () => {
    ;(isProcessRunning as jest.Mock).mockResolvedValue(false)
  })
  renderCc()
  await userEvent.click(await screen.findByRole("button", { name: en.ccconnect.stop }))
  await waitFor(() => expect(stopCcConnect).toHaveBeenCalledWith([9820, 9810, 9111]))
})

it("reads a custom management port from config.toml", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  ;(probePort as jest.Mock).mockResolvedValue(true)
  ;(readTextFile as jest.Mock).mockResolvedValue("[management]\nenabled = true\nport = 8080\n")
  renderCc()
  const open = await screen.findByRole("button", { name: en.ccconnect.openWeb })
  await waitFor(() =>
    expect(screen.getByText(en.ccconnect.webUrl("http://localhost:8080"))).toBeInTheDocument()
  )
  await userEvent.click(open)
  expect(openUrl).toHaveBeenCalledWith("http://localhost:8080")
})

it("enables web admin by writing an enabled [management] section", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  renderCc()
  const enable = await screen.findByRole("button", { name: en.ccconnect.enableWebAdmin })
  await waitFor(() => expect(enable).toBeEnabled())
  await userEvent.click(enable)
  await waitFor(() =>
    expect(writeTextFile).toHaveBeenCalledWith(CONFIG, expect.stringContaining("enabled = true"))
  )
  expect(writeTextFile).toHaveBeenCalledWith(CONFIG, expect.stringContaining("[management]"))
  expect(toast.success).toHaveBeenCalledWith(en.ccconnect.webAdminEnabled)
})

it("hides Enable web admin once management is already enabled", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  ;(readTextFile as jest.Mock).mockResolvedValue("[management]\nenabled = true\n")
  renderCc()
  expect(await screen.findByText(en.ccconnect.managementEnabled)).toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: en.ccconnect.enableWebAdmin })
  ).not.toBeInTheDocument()
})

it("shows config state and reveals the file when initialized", async () => {
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  renderCc()
  expect(await screen.findByText(en.ccconnect.configInitialized)).toBeInTheDocument()
  expect(screen.getByText(CONFIG)).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: en.ccconnect.reveal }))
  expect(revealPath).toHaveBeenCalledWith(CONFIG)
})

it("shows the not-initialized hint (and no reveal button) without a config", async () => {
  renderCc()
  expect(await screen.findByText(en.ccconnect.configMissing)).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: en.ccconnect.reveal })).not.toBeInTheDocument()
})

it("toasts when the scan fails and recovers on refresh", async () => {
  ;(detectCli as jest.Mock).mockRejectedValueOnce("io error")
  renderCc()
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en.ccconnect.loadFailed))
  await userEvent.click(screen.getByRole("button", { name: en.ccconnect.refresh }))
  expect(await screen.findByText(en.ccconnect.notDetected)).toBeInTheDocument()
})
