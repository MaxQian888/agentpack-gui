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
jest.mock("@/lib/agentpack/network/scan", () => {
  const actual = jest.requireActual("@/lib/agentpack/network/scan")
  return { ...actual, scanNetwork: jest.fn(actual.scanNetwork) }
})

import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { useAppStore } from "@/store/app-store"
import type { NetworkProbeResult } from "@/lib/agentpack/network/probe"
import {
  probePort,
  proxyCheck,
  proxyEnvSnapshot,
  runCommand,
  setProcessProxy,
  writeTextFile,
} from "@/lib/tauri/commands"
import { saveSettings } from "@/lib/tauri/settings"
import { scanNetwork } from "@/lib/agentpack/network/scan"
import { RunnerHarness } from "../../run/__testing__/harness"
import { NetworkSection } from "./index"

const paths = {
  home: "/h",
  claudeSettings: "/h/.claude/settings.json",
  shellProfile: "/h/.zshrc",
  os: "mac",
} as never

/**
 * Seed the store the way the startup probe would. The section no longer scans
 * on mount — the scan runs once at app startup and lives in the store, so three
 * surfaces share one measured answer instead of each scanning separately.
 */
function seedProbe(urls: string[], extra: Partial<NetworkProbeResult> = {}) {
  const proxies = urls.map((url, i) => ({
    id: `port:${url}`,
    source: "port" as const,
    url,
    // Distinct from the URL: the card renders both, and identical text would
    // make `findByText(url)` ambiguous.
    detail: `Proxy app ${i + 1}`,
    result: { ok: true, status: 200, latencyMs: 12, reason: "ok" },
  }))
  useAppStore.getState().setNetworkProbe({
    proxies,
    bestProxy: proxies[0] ?? null,
    directOk: false,
    npm: [],
    gh: [],
    pypi: [],
    brew: [],
    pacUrl: null,
    ...extra,
  } as NetworkProbeResult)
}

beforeEach(() => {
  jest.clearAllMocks()
  useAppStore.getState().resetPlan()
  // resetPlan preserves network config by design (it outlives a bundle switch), so
  // wipe it explicitly here — these tests each start from an unconfigured network.
  useAppStore.setState((s) => ({ plan: { ...s.plan, network: {} } }))
  useAppStore.setState({ paths, panelOpen: false })
  useAppStore.getState().setNetworkProbe(null)
  useAppStore.getState().setNetworkProbing(false)
  // The applied-and-saved proxy is separate from the form: start with none.
  useAppStore.getState().setSettings({ proxy: null })
  // clearAllMocks keeps implementations, and one test makes this write fail.
  ;(writeTextFile as jest.Mock).mockResolvedValue(undefined)
})

function renderSection() {
  return render(
    <I18nProvider>
      <RunnerHarness autoApply>
        <NetworkSection />
      </RunnerHarness>
    </I18nProvider>
  )
}

it("organizes proxy configuration, discovery, and mirrors as one workbench", () => {
  seedProbe(["http://127.0.0.1:7890"], { directOk: true })
  renderSection()

  expect(screen.getByRole("region", { name: en.network.summaryLabel })).toBeInTheDocument()
  expect(screen.getByRole("region", { name: en.network.proxyPanel })).toBeInTheDocument()
  expect(screen.getByRole("complementary", { name: en.network.actionsLabel })).toBeInTheDocument()
  expect(screen.getByRole("region", { name: en.network.mirrorsPanel })).toBeInTheDocument()
})

it("reports an in-progress network measurement in the summary", () => {
  useAppStore.getState().setNetworkProbing(true)
  renderSection()

  const summary = screen.getByRole("region", { name: en.network.summaryLabel })
  expect(within(summary).getByText(en.network.discovery.scanning)).toBeInTheDocument()
})

it("keeps a failed network measurement visible in the summary", async () => {
  ;(scanNetwork as jest.Mock).mockRejectedValueOnce(new Error("offline"))
  renderSection()

  await userEvent.click(screen.getByRole("button", { name: en.network.discovery.scan }))
  const summary = screen.getByRole("region", { name: en.network.summaryLabel })
  expect(await within(summary).findByText(en.network.scanFailed)).toBeInTheDocument()
  expect(within(summary).getByText(en.network.scanError("offline"))).toBeInTheDocument()
  // …and the discovery list doesn't turn the failure into "no proxy here".
  expect(screen.getByText(en.network.discovery.failed)).toBeInTheDocument()
  expect(screen.queryByText(en.network.discovery.empty)).not.toBeInTheDocument()
})

it("says nothing has been measured yet rather than that there is no proxy", () => {
  renderSection()
  expect(screen.getByText(en.network.discovery.unmeasured)).toBeInTheDocument()
  expect(screen.queryByText(en.network.discovery.empty)).not.toBeInTheDocument()
})

it("drops a manual re-test once a new scan replaces the reading it corrected", async () => {
  seedProbe(["http://127.0.0.1:7890"])
  ;(proxyCheck as jest.Mock).mockResolvedValueOnce({ ok: false, reason: "timeout" })
  renderSection()
  const row = (await screen.findByText("http://127.0.0.1:7890")).closest("li")!
  await userEvent.click(within(row).getByRole("button", { name: en.network.discovery.test }))
  const failed = en.network.proxy.testFail(en.network.proxy.reason.timeout)
  expect(await within(row).findByText(failed)).toBeInTheDocument()

  act(() => seedProbe(["http://127.0.0.1:7890"]))
  const fresh = (await screen.findByText("http://127.0.0.1:7890")).closest("li")!
  expect(within(fresh).queryByText(failed)).not.toBeInTheDocument()
  expect(within(fresh).getByText(en.network.proxy.testOk(200, 12))).toBeInTheDocument()
})

it("reports when the startup scan found nothing", async () => {
  seedProbe([])
  renderSection()
  await screen.findByText(en.network.discovery.empty)
  // The section itself must NOT re-scan on mount: that would duplicate the
  // startup probe every time the user navigates back to this page.
  expect(proxyEnvSnapshot).not.toHaveBeenCalled()
})

it("rescans on demand, sweeping every well-known port against localhost only", async () => {
  renderSection()
  await userEvent.click(screen.getByRole("button", { name: en.network.discovery.scan }))

  await waitFor(() => expect(proxyEnvSnapshot).toHaveBeenCalled())
  expect((probePort as jest.Mock).mock.calls.length).toBeGreaterThan(5)
})

it("shows each candidate's measured latency, so a dead entry is visibly dead", async () => {
  seedProbe(["http://127.0.0.1:7890"])
  renderSection()
  const row = (await screen.findByText("http://127.0.0.1:7890")).closest("li")!
  expect(within(row).getByText(en.network.proxy.testOk(200, 12))).toBeInTheDocument()
})

it("adopts a discovered proxy into the form, filling both schemes", async () => {
  seedProbe(["http://127.0.0.1:7890"])
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
  seedProbe(["socks5://127.0.0.1:1080"])
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
  seedProbe(["http://127.0.0.1:7897"])
  renderSection()
  await screen.findByText("http://127.0.0.1:7897")
  await userEvent.click(screen.getByRole("radio", { name: en.network.proxy.mode.system }))

  expect(useAppStore.getState().plan.network.proxy).toMatchObject({
    mode: "system",
    httpsUrl: "http://127.0.0.1:7897",
  })
})

it("'follow system' never discards an address the user already typed", async () => {
  seedProbe(["http://127.0.0.1:7897"])
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

it("labels each mirror chip with its measured latency", async () => {
  seedProbe([], {
    npm: [
      {
        preset: {
          id: "npmmirror",
          label: "npmmirror",
          url: "https://registry.npmmirror.com",
          probeUrl: "x",
        },
        result: { ok: true, status: 200, latencyMs: 82, reason: "ok" },
      },
    ],
  })
  renderSection()
  // "Which mirror should I pick" is unanswerable from a list of names alone.
  const chip = await screen.findByRole("button", { name: /npmmirror/ })
  expect(within(chip).getByText("82ms")).toBeInTheDocument()
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

it("writes nothing until the staged changes are applied", async () => {
  // The gate, from the section's side: Apply opens the review panel and stops.
  // Nothing reaches the machine — and the settings write, which is ours rather
  // than the runner's, must not run ahead of it either.
  render(
    <I18nProvider>
      <RunnerHarness panel>
        <NetworkSection />
      </RunnerHarness>
    </I18nProvider>
  )
  await userEvent.click(screen.getByRole("radio", { name: en.network.proxy.mode.manual }))
  await userEvent.type(screen.getByLabelText(en.network.proxy.httpLabel), "127.0.0.1:7890")
  await userEvent.click(screen.getByRole("button", { name: en.network.proxy.apply }))

  await waitFor(() => expect(useAppStore.getState().panelOpen).toBe(true))
  await screen.findByRole("button", { name: en.review.apply })
  expect(writeTextFile).not.toHaveBeenCalled()
  expect(runCommand).not.toHaveBeenCalled()
  expect(setProcessProxy).not.toHaveBeenCalled()
  expect(saveSettings).not.toHaveBeenCalled()

  // And a preview still writes nothing, while leaving Apply on the table.
  await userEvent.click(screen.getByRole("button", { name: en.review.previewOnly }))
  await waitFor(() => expect(writeTextFile).not.toHaveBeenCalled())
  expect(runCommand).not.toHaveBeenCalled()
  expect(screen.getByRole("button", { name: en.review.apply })).toBeEnabled()
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

it("clearing that fails somewhere keeps the saved proxy and agentpack's traffic as they were", async () => {
  useAppStore.getState().setProxy({ mode: "manual", httpUrl: "http://127.0.0.1:7890" })
  // The settings.json write is refused, so Claude Code still has the proxy.
  ;(writeTextFile as jest.Mock).mockRejectedValue(new Error("EACCES: permission denied"))
  render(
    <I18nProvider>
      <RunnerHarness panel>
        <NetworkSection />
      </RunnerHarness>
    </I18nProvider>
  )
  await userEvent.click(screen.getByRole("button", { name: en.network.proxy.clear }))
  await userEvent.click(await screen.findByRole("button", { name: en.review.apply }))

  // The run finished with an error — Retry is the panel's way of saying so.
  await screen.findByRole("button", { name: en.shell.retry })
  await act(async () => {})
  expect(useAppStore.getState().plan.network.proxy!.mode).toBe("manual")
  expect(setProcessProxy).not.toHaveBeenCalled()
  expect(saveSettings).not.toHaveBeenCalled()
})

it("a discarded apply leaves agentpack's traffic and the saved setting alone", async () => {
  render(
    <I18nProvider>
      <RunnerHarness panel>
        <NetworkSection />
      </RunnerHarness>
    </I18nProvider>
  )
  await userEvent.click(screen.getByRole("radio", { name: en.network.proxy.mode.manual }))
  await userEvent.type(screen.getByLabelText(en.network.proxy.httpLabel), "127.0.0.1:7890")
  await userEvent.click(screen.getByRole("button", { name: en.network.proxy.apply }))
  await userEvent.click(await screen.findByRole("button", { name: en.review.discard }))

  await waitFor(() => expect(useAppStore.getState().panelOpen).toBe(false))
  await act(async () => {})
  expect(setProcessProxy).not.toHaveBeenCalled()
  expect(saveSettings).not.toHaveBeenCalled()
})

it("keeps Clear reachable in Off while a proxy applied earlier is still saved", async () => {
  // Off writes nothing and removes nothing, so without this the saved proxy
  // could only be cleared by switching back to a mode that re-applies it.
  useAppStore.getState().setSettings({
    proxy: { mode: "manual", httpUrl: "http://127.0.0.1:7890", targets: ["claude"] },
  })
  renderSection()
  expect(screen.getByRole("radio", { name: en.network.proxy.mode.off })).toBeChecked()
  expect(screen.getByText(en.network.proxy.stillApplied)).toBeInTheDocument()

  await userEvent.click(screen.getByRole("button", { name: en.network.proxy.clear }))
  await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ proxy: null }))
  expect(setProcessProxy).toHaveBeenCalledWith({})
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: en.network.proxy.clear })).not.toBeInTheDocument()
  )
})

it("shows the PyPI mirrors as measured readouts, not as buttons that do nothing", async () => {
  seedProbe([], {
    pypi: [
      {
        preset: { id: "tsinghua", label: "TUNA", url: "https://x", probeUrl: "x" },
        result: { ok: true, status: 200, latencyMs: 40, reason: "ok" },
      },
    ],
  })
  renderSection()
  const mirrors = screen.getByRole("region", { name: en.network.mirrorsPanel })
  expect(within(mirrors).getByText("40ms")).toBeInTheDocument()
  expect(within(mirrors).queryByRole("button", { name: /TUNA/ })).not.toBeInTheDocument()
  expect(within(mirrors).queryByRole("button", { name: /pypi\.org/ })).not.toBeInTheDocument()
})

it("mirror presets fill the registry and persist the GitHub prefix immediately", async () => {
  renderSection()
  await userEvent.click(screen.getByRole("button", { name: "npmmirror" }))
  expect(useAppStore.getState().plan.network.npmRegistry).toBe("https://registry.npmmirror.com")

  await userEvent.click(screen.getByRole("button", { name: "gh-proxy.com" }))
  expect(saveSettings).toHaveBeenCalledWith({ ghMirrorPrefix: "https://gh-proxy.com/" })
})

it("offers no API endpoint field — endpoints are provider rows", async () => {
  renderSection()
  // The removed relay card owned the only base-URL/token pair here; a second
  // writer for the agent CLIs' endpoint must not come back.
  expect(screen.queryByPlaceholderText("https://api.example.com")).not.toBeInTheDocument()
})
