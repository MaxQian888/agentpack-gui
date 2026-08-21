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
import { RunnerHarness } from "../run/__testing__/harness"
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
import {
  getConfigValue,
  isSectionEnabled,
  parseConfigDoc,
  parseManagementToken,
} from "@/lib/agentpack/ccconnect"
import { CcConnectSection } from "./ccconnect"
import { en } from "@/lib/i18n/en"

const CONFIG = "/h/.cc-connect/config.toml"
const paths = {
  ccConnectDir: "/h/.cc-connect",
  ccConnectConfig: CONFIG,
  os: "mac",
} as never

/**
 * A `[[projects]]` block, appended to any config a test expects the service to
 * actually start from. cc-connect rejects a projectless config during validation
 * and exits before binding a port, so the section refuses to spawn one — every
 * start path below has to be startable for the same reason the real one does.
 */
const PROJECT = [
  "",
  "[[projects]]",
  'name = "demo"',
  "[projects.agent]",
  'type = "claudecode"',
  "[[projects.platforms]]",
  'type = "feishu"',
  "",
].join("\n")

const RUNNABLE = `[management]\nenabled = true\ntoken = "secret"\n${PROJECT}`

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
  ;(writeTextFile as jest.Mock).mockResolvedValue(undefined)
  ;(startCcConnect as jest.Mock).mockResolvedValue(undefined)
  ;(stopCcConnect as jest.Mock).mockResolvedValue(undefined)
  useAppStore.setState({
    paths,
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
      <RunnerHarness autoApply>
        <CcConnectSection />
      </RunnerHarness>
    </I18nProvider>
  )
}

/** The embedded dashboard's frame, once the panel has opened. */
function frame() {
  return document.querySelector("iframe")
}

it("shows the not-in-Tauri fallback in web mode", async () => {
  isTauriMock.mockReturnValue(false)
  renderCc()
  expect(screen.getByText(en.shell.notInTauri)).toBeInTheDocument()
})

it("orders the checklist install → configure → start → open, and tracks progress", async () => {
  // The page is staged work, and the order is the layout: a fresh machine must
  // read top to bottom, with only reached steps ticked.
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  ;(readTextFile as jest.Mock).mockResolvedValue(RUNNABLE)
  renderCc()

  await screen.findByText(en.ccconnect.stepConfigTitle)
  const rows = screen.getAllByRole("listitem")
  expect(rows.map((row) => row.textContent)).toEqual([
    expect.stringContaining(en.ccconnect.stepInstallTitle),
    expect.stringContaining(en.ccconnect.stepConfigTitle),
    expect.stringContaining(en.ccconnect.stepStartTitle),
    expect.stringContaining(en.ccconnect.stepOpenTitle),
  ])
  // Installed and configured; the bridge is not running, so that is where the
  // "do this next" marker sits and the tally stops.
  await waitFor(() => expect(rows[1].dataset.status).toBe("done"))
  expect(rows[0].dataset.status).toBe("done")
  expect(rows[2].dataset.status).toBe("current")
  expect(screen.getByText(en.ccconnect.guideProgress(2, 4))).toBeInTheDocument()
})

it("leaves later steps waiting until the one they depend on is settled", async () => {
  // Nothing installed: configure/start/open are not merely disabled, they say
  // they are waiting on the step above.
  renderCc()
  await screen.findByText(en.ccconnect.notDetected)
  const rows = screen.getAllByRole("listitem")
  expect(rows[0].dataset.status).toBe("current")
  expect(rows.slice(1).map((row) => row.dataset.status)).toEqual(["waiting", "waiting", "waiting"])
})

it("shows not-detected and installs via the runner", async () => {
  renderCc()
  expect(screen.getByRole("region", { name: en.ccconnect.summaryLabel })).toBeInTheDocument()
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
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  ;(readTextFile as jest.Mock).mockResolvedValue(RUNNABLE)
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

it("names the config file when starting, so a stray ./config.toml can't win", async () => {
  // cc-connect resolves flag → ./config.toml → ~/.cc-connect/config.toml, and
  // the app spawns with whatever cwd it was launched from.
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  ;(readTextFile as jest.Mock).mockResolvedValue(RUNNABLE)
  ;(startCcConnect as jest.Mock).mockImplementation(async () => {
    ;(isProcessRunning as jest.Mock).mockResolvedValue(true)
  })
  renderCc()
  const start = await screen.findByRole("button", { name: en.ccconnect.start })
  await waitFor(() => expect(start).toBeEnabled())
  await userEvent.click(start)
  await waitFor(() => expect(startCcConnect).toHaveBeenCalledWith(CONFIG), { timeout: 3000 })
})

it("refuses to start a projectless config instead of polling a dead process", async () => {
  // cc-connect exits during validation on a config with no [[projects]], so the
  // six-second liveness poll could only ever end in a generic "couldn't start".
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  ;(readTextFile as jest.Mock).mockResolvedValue("[management]\nenabled = true\n")
  renderCc()
  const start = await screen.findByRole("button", { name: en.ccconnect.start })
  await waitFor(() => expect(start).toBeEnabled())
  await userEvent.click(start)
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en.ccconnect.needsProject))
  expect(startCcConnect).not.toHaveBeenCalled()
})

it("flags a projectless config in the service card", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  ;(readTextFile as jest.Mock).mockResolvedValue("[management]\nenabled = true\n")
  renderCc()
  expect(await screen.findByText(en.ccconnect.noProjects)).toBeInTheDocument()
  expect(screen.getByText(en.ccconnect.needsProject)).toBeInTheDocument()
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
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  ;(readTextFile as jest.Mock).mockResolvedValue(RUNNABLE)
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

it("disables start while cc-connect is not installed", async () => {
  renderCc()
  const start = await screen.findByRole("button", { name: en.ccconnect.start })
  await screen.findByText(en.ccconnect.notDetected)
  expect(start).toBeDisabled()
})

it("enables the dashboard and opens it pre-authenticated when none is configured", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  // Service already answering, so no (re)start needed — just write config + open.
  ;(probePort as jest.Mock).mockResolvedValue(true)
  renderCc()
  const open = await screen.findByRole("button", { name: en.ccconnect.enableAndOpen })
  await waitFor(() => expect(open).toBeEnabled())
  await userEvent.click(open)
  await waitFor(() =>
    expect(writeTextFile).toHaveBeenCalledWith(CONFIG, expect.stringContaining("token = "))
  )
  await waitFor(() =>
    expect(frame()).toHaveAttribute(
      "src",
      expect.stringMatching(/^http:\/\/localhost:9820\/login\?token=[0-9a-f]+$/)
    )
  )
  expect(openUrl).not.toHaveBeenCalled()
})

it("starts the bridge first when the dashboard port isn't answering, then opens it", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  ;(readTextFile as jest.Mock).mockResolvedValue(RUNNABLE)
  ;(probePort as jest.Mock).mockResolvedValue(false)
  ;(startCcConnect as jest.Mock).mockImplementation(async () => {
    ;(probePort as jest.Mock).mockResolvedValue(true)
  })
  renderCc()
  const open = await screen.findByRole("button", { name: en.ccconnect.openWeb })
  await waitFor(() => expect(open).toBeEnabled())
  await userEvent.click(open)
  await waitFor(() => expect(startCcConnect).toHaveBeenCalled(), { timeout: 3000 })
  await waitFor(
    () => expect(frame()).toHaveAttribute("src", "http://localhost:9820/login?token=secret"),
    { timeout: 3000 }
  )
})

it("hands the same pre-authed URL to the browser on request", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  ;(probePort as jest.Mock).mockResolvedValue(true)
  ;(readTextFile as jest.Mock).mockResolvedValue(RUNNABLE)
  renderCc()
  const external = await screen.findByRole("button", { name: en.ccconnect.openInBrowser })
  await waitFor(() => expect(external).toBeEnabled())
  await userEvent.click(external)
  await waitFor(() =>
    expect(openUrl).toHaveBeenCalledWith("http://localhost:9820/login?token=secret")
  )
  // The browser path opens nothing in-app.
  expect(frame()).toBeNull()
})

it("embeds the dashboard without ever putting the token on screen", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  ;(probePort as jest.Mock).mockResolvedValue(true)
  ;(readTextFile as jest.Mock).mockResolvedValue(RUNNABLE)
  renderCc()
  await userEvent.click(await screen.findByRole("button", { name: en.ccconnect.openWeb }))
  await waitFor(() => expect(frame()).not.toBeNull())
  // The frame loads the token; the visible chrome shows only the origin. Same
  // rule the section's own hint follows — localhost-only, but no need to leak it.
  expect(frame()!.getAttribute("src")).toContain("token=secret")
  expect(document.body.textContent).not.toContain("secret")
  expect(screen.getByText("http://localhost:9820")).toBeInTheDocument()
})

it("sandboxes the frame so a localhost page cannot navigate the app away", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  ;(probePort as jest.Mock).mockResolvedValue(true)
  ;(readTextFile as jest.Mock).mockResolvedValue(RUNNABLE)
  renderCc()
  await userEvent.click(await screen.findByRole("button", { name: en.ccconnect.openWeb }))
  await waitFor(() => expect(frame()).not.toBeNull())
  const sandbox = frame()!.getAttribute("sandbox") ?? ""
  // The SPA needs its own origin (API + storage) and scripts to run at all.
  expect(sandbox).toContain("allow-scripts")
  expect(sandbox).toContain("allow-same-origin")
  // What it must not get: control of the top-level browsing context.
  expect(sandbox).not.toContain("allow-top-navigation")
})

it("reloads the frame by remounting it, so the login effect runs again", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  ;(probePort as jest.Mock).mockResolvedValue(true)
  ;(readTextFile as jest.Mock).mockResolvedValue(RUNNABLE)
  renderCc()
  await userEvent.click(await screen.findByRole("button", { name: en.ccconnect.openWeb }))
  await waitFor(() => expect(frame()).not.toBeNull())
  const before = frame()
  await userEvent.click(screen.getByRole("button", { name: en.ccconnect.embedReload }))
  // Re-setting an identical `src` would not re-navigate a cross-origin frame;
  // only a new element does.
  await waitFor(() => expect(frame()).not.toBe(before))
  expect(frame()).toHaveAttribute("src", "http://localhost:9820/login?token=secret")
})

it("names the one failure the frame cannot report to us", async () => {
  // A stale remembered token makes the dashboard show its own login form, and
  // cross-origin we can neither see that nor fix it — so the panel says what to
  // do where the user is already looking.
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  ;(probePort as jest.Mock).mockResolvedValue(true)
  ;(readTextFile as jest.Mock).mockResolvedValue(RUNNABLE)
  renderCc()
  await userEvent.click(await screen.findByRole("button", { name: en.ccconnect.openWeb }))
  await waitFor(() => expect(frame()).not.toBeNull())
  expect(screen.getByText(en.ccconnect.embedLoginHint)).toBeInTheDocument()
})

it("unmounts the frame on close so the dashboard stops polling", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  ;(probePort as jest.Mock).mockResolvedValue(true)
  ;(readTextFile as jest.Mock).mockResolvedValue(RUNNABLE)
  renderCc()
  await userEvent.click(await screen.findByRole("button", { name: en.ccconnect.openWeb }))
  await waitFor(() => expect(frame()).not.toBeNull())
  await userEvent.click(screen.getByRole("button", { name: en.ccconnect.embedClose }))
  await waitFor(() => expect(frame()).toBeNull())
})

it("offers the browser as an escape hatch from inside the panel", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  ;(probePort as jest.Mock).mockResolvedValue(true)
  ;(readTextFile as jest.Mock).mockResolvedValue(RUNNABLE)
  renderCc()
  await userEvent.click(await screen.findByRole("button", { name: en.ccconnect.openWeb }))
  await waitFor(() => expect(frame()).not.toBeNull())
  await userEvent.click(screen.getByRole("button", { name: en.ccconnect.embedExternal }))
  // Same page, no second prepare pass — the service is already up by then.
  await waitFor(() =>
    expect(openUrl).toHaveBeenCalledWith("http://localhost:9820/login?token=secret")
  )
})

it("restarts a bridge-only instance so it serves the dashboard, then opens it", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  ;(readTextFile as jest.Mock).mockResolvedValue(RUNNABLE)
  ;(isProcessRunning as jest.Mock).mockResolvedValue(true)
  ;(probePort as jest.Mock).mockResolvedValue(false)
  ;(stopCcConnect as jest.Mock).mockImplementation(async () => {
    ;(isProcessRunning as jest.Mock).mockResolvedValue(false)
  })
  ;(startCcConnect as jest.Mock).mockImplementation(async () => {
    ;(probePort as jest.Mock).mockResolvedValue(true)
  })
  renderCc()
  const open = await screen.findByRole("button", { name: en.ccconnect.openWeb })
  await userEvent.click(open)
  await waitFor(() => expect(stopCcConnect).toHaveBeenCalledWith([9820, 9810, 9111]), {
    timeout: 3000,
  })
  await waitFor(() => expect(startCcConnect).toHaveBeenCalled(), { timeout: 3000 })
  await waitFor(
    () => expect(frame()).toHaveAttribute("src", "http://localhost:9820/login?token=secret"),
    { timeout: 3000 }
  )
})

it("refuses to open the dashboard when config.toml is invalid", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  ;(readTextFile as jest.Mock).mockResolvedValue("broken = [")
  renderCc()
  await userEvent.click(await screen.findByRole("button", { name: en.ccconnect.enableAndOpen }))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en.ccconnect.invalidToml))
  expect(writeTextFile).not.toHaveBeenCalled()
})

it("surfaces a dashboard open failure as a toast", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(probePort as jest.Mock).mockResolvedValue(true)
  ;(writeTextFile as jest.Mock).mockRejectedValue("io")
  renderCc()
  await userEvent.click(await screen.findByRole("button", { name: en.ccconnect.enableAndOpen }))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en.ccconnect.webAdminFailed))
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
  await waitFor(() =>
    expect(frame()).toHaveAttribute(
      "src",
      expect.stringMatching(/^http:\/\/localhost:8080\/login\?token=[0-9a-f]+$/)
    )
  )
})

it("enables web admin and opens the dashboard in one click", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(pathExists as jest.Mock).mockResolvedValue(true)
  ;(readTextFile as jest.Mock).mockResolvedValue(PROJECT)
  ;(startCcConnect as jest.Mock).mockImplementation(async () => {
    ;(probePort as jest.Mock).mockResolvedValue(true)
  })
  renderCc()
  const open = await screen.findByRole("button", { name: en.ccconnect.enableAndOpen })
  await waitFor(() => expect(open).toBeEnabled())
  await userEvent.click(open)
  await waitFor(() =>
    expect(writeTextFile).toHaveBeenCalledWith(CONFIG, expect.stringContaining("enabled = true"))
  )
  expect(writeTextFile).toHaveBeenCalledWith(CONFIG, expect.stringContaining("[management]"))
  await waitFor(
    () =>
      expect(frame()).toHaveAttribute(
        "src",
        expect.stringMatching(/^http:\/\/localhost:9820\/login\?token=[0-9a-f]+$/)
      ),
    { timeout: 3000 }
  )
})

it("enables the bridge alongside management, as `cc-connect web` does", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(probePort as jest.Mock).mockResolvedValue(true)
  renderCc()
  const open = await screen.findByRole("button", { name: en.ccconnect.enableAndOpen })
  await waitFor(() => expect(open).toBeEnabled())
  await userEvent.click(open)
  await waitFor(() => expect(writeTextFile).toHaveBeenCalled())
  const written = (writeTextFile as jest.Mock).mock.calls[0][1] as string
  expect(written).toContain("[bridge]")
  expect(isSectionEnabled(written, "bridge")).toBe(true)
  expect(isSectionEnabled(written, "management")).toBe(true)
  // Two independent secrets: the management one is handed to a browser.
  expect(parseManagementToken(written)).not.toBe(
    getConfigValue(parseConfigDoc(written)!, ["bridge", "token"])
  )
})

it("saves web admin but names the real blocker when there is no project", async () => {
  // The config is written (so the setting sticks), the doomed spawn is skipped,
  // and the message points at [[projects]] rather than saying "couldn't start".
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  ;(probePort as jest.Mock).mockResolvedValue(false)
  renderCc()
  const open = await screen.findByRole("button", { name: en.ccconnect.enableAndOpen })
  await waitFor(() => expect(open).toBeEnabled())
  await userEvent.click(open)
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(en.ccconnect.needsProject))
  expect(writeTextFile).toHaveBeenCalledWith(CONFIG, expect.stringContaining("[management]"))
  expect(startCcConnect).not.toHaveBeenCalled()
  expect(openUrl).not.toHaveBeenCalled()
})

it("labels the dashboard button 'Enable & open' until management is enabled", async () => {
  ;(detectCli as jest.Mock).mockResolvedValue({ installed: true, version: "1.4.1" })
  renderCc()
  expect(
    await screen.findByRole("button", { name: en.ccconnect.enableAndOpen })
  ).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: en.ccconnect.openWeb })).not.toBeInTheDocument()
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
