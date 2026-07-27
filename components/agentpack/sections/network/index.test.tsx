jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/commands", () => ({
  proxyEnvSnapshot: jest.fn(async () => ({
    httpProxy: null,
    httpsProxy: null,
    allProxy: null,
    noProxy: null,
  })),
  systemProxySnapshot: jest.fn(async () => ({ entries: [], pacUrl: null, bypass: [] })),
  toolProxySnapshot: jest.fn(async () => ({
    npmProxy: null,
    npmHttpsProxy: null,
    npmNoProxy: null,
    npmRegistry: null,
    gitHttpProxy: null,
    gitHttpsProxy: null,
  })),
  probePort: jest.fn(async () => false),
  proxyCheck: jest.fn(async () => ({ ok: true, status: 200, latencyMs: 12, reason: "ok" })),
  setProcessProxy: jest.fn(async () => undefined),
  readTextFile: jest.fn(async () => "{}"),
  writeTextFile: jest.fn(async () => undefined),
  runCommand: jest.fn(async () => 0),
  pathExists: jest.fn(async () => false),
}))
jest.mock("@/lib/tauri/settings", () => ({
  saveSettings: jest.fn(async (patch) => ({ ghMirrorPrefix: null, proxy: null, ...patch })),
}))

import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { useAppStore } from "@/store/app-store"
import {
  probePort,
  proxyCheck,
  proxyEnvSnapshot,
  readTextFile,
  runCommand,
  setProcessProxy,
  writeTextFile,
} from "@/lib/tauri/commands"
import { saveSettings } from "@/lib/tauri/settings"
import { RunnerProvider } from "../../run/runner-context"
import { NetworkSection } from "./index"

const paths = {
  home: "/h",
  claudeSettings: "/h/.claude/settings.json",
  shellProfile: "/h/.zshrc",
  os: "mac",
} as never

beforeEach(() => {
  jest.clearAllMocks()
  useAppStore.getState().resetPlan()
  // resetPlan preserves network config by design (it outlives a bundle switch), so
  // wipe it explicitly here — these tests each start from an unconfigured network.
  useAppStore.setState((s) => ({ plan: { ...s.plan, network: {} } }))
  useAppStore.setState({ paths, dryRun: false, panelOpen: false })
})

function renderSection() {
  return render(
    <I18nProvider>
      <RunnerProvider>
        <NetworkSection />
      </RunnerProvider>
    </I18nProvider>
  )
}

it("scans for proxies on open and reports when nothing is found", async () => {
  renderSection()
  await screen.findByText(en.network.discovery.empty)
  expect(proxyEnvSnapshot).toHaveBeenCalled()
  // Every well-known port is swept, and only against localhost.
  expect((probePort as jest.Mock).mock.calls.length).toBeGreaterThan(5)
})

it("adopts a discovered proxy into the form, filling both schemes", async () => {
  ;(probePort as jest.Mock).mockImplementation(async (port: number) => port === 7890)
  renderSection()
  const row = (await screen.findByText("http://127.0.0.1:7890")).closest("li")!
  await userEvent.click(within(row).getByRole("button", { name: en.network.discovery.use }))

  expect(useAppStore.getState().plan.network.proxy).toMatchObject({
    mode: "manual",
    httpUrl: "http://127.0.0.1:7890",
    httpsUrl: "http://127.0.0.1:7890",
  })
  expect(await screen.findByLabelText(en.network.proxy.httpLabel)).toHaveValue(
    "http://127.0.0.1:7890"
  )
})

it("sends a SOCKS candidate to ALL_PROXY rather than the http fields", async () => {
  ;(probePort as jest.Mock).mockImplementation(async (port: number) => port === 1080)
  renderSection()
  const row = (await screen.findByText("socks5://127.0.0.1:1080")).closest("li")!
  await userEvent.click(within(row).getByRole("button", { name: en.network.discovery.use }))

  const proxy = useAppStore.getState().plan.network.proxy!
  expect(proxy.allUrl).toBe("socks5://127.0.0.1:1080")
  expect(proxy.httpUrl).toBeUndefined()
  // Claude Code can't use SOCKS — the section says so instead of writing it silently.
  expect(await screen.findByText(en.network.proxy.socksWarning)).toBeInTheDocument()
})

it("'follow system' adopts what the scan found instead of leaving empty fields", async () => {
  ;(probePort as jest.Mock).mockImplementation(async (port: number) => port === 7897)
  renderSection()
  await screen.findByText("http://127.0.0.1:7897")
  await userEvent.click(screen.getByRole("radio", { name: en.network.proxy.mode.system }))

  expect(useAppStore.getState().plan.network.proxy).toMatchObject({
    mode: "system",
    httpsUrl: "http://127.0.0.1:7897",
  })
})

it("'follow system' never discards an address the user already typed", async () => {
  ;(probePort as jest.Mock).mockImplementation(async (port: number) => port === 7897)
  renderSection()
  await screen.findByText("http://127.0.0.1:7897")
  await userEvent.click(screen.getByRole("radio", { name: en.network.proxy.mode.manual }))
  await userEvent.type(screen.getByLabelText(en.network.proxy.httpLabel), "http://mine:1")
  await userEvent.click(screen.getByRole("radio", { name: en.network.proxy.mode.system }))

  expect(useAppStore.getState().plan.network.proxy).toMatchObject({
    mode: "system",
    httpUrl: "http://mine:1",
  })
})

it("applies the proxy: writes the selected targets, then makes it real for agentpack", async () => {
  renderSection()
  await userEvent.click(screen.getByRole("radio", { name: en.network.proxy.mode.manual }))
  await userEvent.type(screen.getByLabelText(en.network.proxy.httpLabel), "127.0.0.1:7890")
  await userEvent.click(screen.getByRole("button", { name: en.network.proxy.apply }))

  await waitFor(() => expect(writeTextFile).toHaveBeenCalled())
  // Claude Code's settings.json gets the env vars…
  const written = (writeTextFile as jest.Mock).mock.calls.find(
    ([path]) => path === "/h/.claude/settings.json"
  )!
  expect(JSON.parse(written[1]).env).toMatchObject({
    HTTP_PROXY: "http://127.0.0.1:7890",
    HTTPS_PROXY: "http://127.0.0.1:7890",
  })
  // …npm and git are configured by command…
  const commands = (runCommand as jest.Mock).mock.calls.map(([cmd]) => cmd.args.join(" "))
  expect(commands).toContain("config set proxy http://127.0.0.1:7890")
  expect(commands).toContain("config --global http.proxy http://127.0.0.1:7890")
  // …and agentpack's own traffic follows, persisted for the next launch.
  await waitFor(() =>
    expect(setProcessProxy).toHaveBeenCalledWith(
      expect.objectContaining({ https: "http://127.0.0.1:7890" })
    )
  )
  expect(saveSettings).toHaveBeenCalledWith(
    expect.objectContaining({ proxy: expect.objectContaining({ httpUrl: "127.0.0.1:7890" }) })
  )
})

it("a preview run changes nothing outside the plan", async () => {
  useAppStore.setState({ dryRun: true })
  renderSection()
  await userEvent.click(screen.getByRole("radio", { name: en.network.proxy.mode.manual }))
  await userEvent.type(screen.getByLabelText(en.network.proxy.httpLabel), "127.0.0.1:7890")
  await userEvent.click(screen.getByRole("button", { name: en.network.proxy.apply }))

  // The run happened (the execution panel opened) but nothing was touched.
  await waitFor(() => expect(useAppStore.getState().panelOpen).toBe(true))
  expect(writeTextFile).not.toHaveBeenCalled()
  expect(readTextFile).not.toHaveBeenCalled()
  expect(runCommand).not.toHaveBeenCalled()
  expect(setProcessProxy).not.toHaveBeenCalled()
  expect(saveSettings).not.toHaveBeenCalled()
})

it("clearing turns the proxy off and releases agentpack's own traffic", async () => {
  useAppStore.getState().setProxy({ mode: "manual", httpUrl: "http://127.0.0.1:7890" })
  renderSection()
  await userEvent.click(screen.getByRole("button", { name: en.network.proxy.clear }))

  await waitFor(() => expect(useAppStore.getState().plan.network.proxy!.mode).toBe("off"))
  expect(setProcessProxy).toHaveBeenCalledWith({})
  expect(saveSettings).toHaveBeenCalledWith({ proxy: null })
})

it("tests connectivity through the configured proxy", async () => {
  useAppStore.getState().setProxy({ mode: "manual", httpUrl: "http://127.0.0.1:7890" })
  renderSection()
  await userEvent.click(screen.getByRole("button", { name: en.network.proxy.testRun }))

  await waitFor(() => expect(proxyCheck).toHaveBeenCalled())
  expect((proxyCheck as jest.Mock).mock.calls[0][0]).toBe("http://127.0.0.1:7890")
  expect(await screen.findByText(en.network.proxy.testOk(200, 12))).toBeInTheDocument()
})

it("mirror presets fill the registry and persist the GitHub prefix immediately", async () => {
  renderSection()
  await userEvent.click(screen.getByRole("button", { name: "npmmirror" }))
  expect(useAppStore.getState().plan.network.npmRegistry).toBe("https://registry.npmmirror.com")

  await userEvent.click(screen.getByRole("button", { name: "gh-proxy.com" }))
  expect(saveSettings).toHaveBeenCalledWith({ ghMirrorPrefix: "https://gh-proxy.com/" })
})

it("still writes the relay fields into the plan", async () => {
  renderSection()
  await userEvent.type(screen.getByLabelText(en.network.baseUrlLabel), "https://r")
  expect(useAppStore.getState().plan.network.apiBaseUrl).toBe("https://r")
})
