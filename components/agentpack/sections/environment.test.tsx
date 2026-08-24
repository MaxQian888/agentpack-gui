jest.mock("@/lib/tauri", () => ({ isTauri: () => false }))
jest.mock("@/lib/tauri/system", () => ({ openUrl: jest.fn() }))

import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { openUrl } from "@/lib/tauri/system"
import { RunnerHarness } from "../run/__testing__/harness"
import { useAppStore } from "@/store/app-store"
import { EnvironmentSection } from "./environment"

beforeEach(() => {
  jest.clearAllMocks()
  useAppStore.getState().resetPlan()
  useAppStore.setState({
    detections: {},
    runtimeOwned: {},
    paths: null,
    osOverride: null,
    panelOpen: false,
  })
})

function renderEnv() {
  return render(
    <I18nProvider>
      <RunnerHarness autoApply>
        <EnvironmentSection />
      </RunnerHarness>
    </I18nProvider>
  )
}

it("shows the detected runtime version from the store", () => {
  useAppStore.setState({ detections: { node: { installed: true, version: "v20.11.0" } } })
  renderEnv()
  // `detect_runtime` keeps the whole first line of `--version`; the badge shows
  // just the semver it contains, so the leading "v" is dropped here.
  expect(screen.getByText(/· 20\.11\.0/)).toBeInTheDocument()
})

it("falls back to the raw --version line when it holds no semver", () => {
  useAppStore.setState({ detections: { node: { installed: true, version: "nightly-build" } } })
  renderEnv()
  expect(screen.getByText(/nightly-build/)).toBeInTheDocument()
})

it("offers an install action for a missing runtime and opens the run panel", async () => {
  useAppStore.setState({
    detections: { node: { installed: false } },
    paths: { os: "mac" } as never,
  })
  renderEnv()
  const installBtn = screen.getAllByRole("button", { name: /install now/i })[0]
  await userEvent.click(installBtn)
  expect(useAppStore.getState().panelOpen).toBe(true)
})

it("offers to install a missing Windows Terminal on Windows", async () => {
  useAppStore.setState({
    detections: { "windows-terminal": { installed: false } },
    paths: { os: "win" } as never,
  })
  renderEnv()

  expect(screen.getByText(en.catalog.runtime["windows-terminal"].title)).toBeInTheDocument()
  await userEvent.click(screen.getByRole("button", { name: en.shell.installNow }))
  expect(useAppStore.getState().panelOpen).toBe(true)
})

it("does not show the Windows-only terminal on macOS", () => {
  useAppStore.setState({
    detections: { "windows-terminal": { installed: false } },
    paths: { os: "mac" } as never,
  })
  renderEnv()

  expect(screen.queryByText("Windows Terminal")).not.toBeInTheDocument()
})

it("uses the host OS rather than the command-preview override", () => {
  useAppStore.setState({
    detections: { "windows-terminal": { installed: false } },
    paths: { os: "win" } as never,
    osOverride: "mac",
  })
  renderEnv()

  expect(screen.getByText(en.catalog.runtime["windows-terminal"].title)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: en.shell.installNow })).toBeInTheDocument()
})

it("shows a not-found badge when a runtime is absent", () => {
  useAppStore.setState({ detections: { bun: { installed: false }, node: { installed: false } } })
  renderEnv()
  expect(screen.getAllByText(/not found/i).length).toBeGreaterThan(0)
})

it("offers Update + Reinstall for an installed runtime and opens the run panel", async () => {
  // Node has both an install method and an upgrade command on macOS.
  useAppStore.setState({
    detections: { node: { installed: true, version: "v20.0.0" } },
    paths: { os: "mac" } as never,
  })
  renderEnv()
  await userEvent.click(screen.getByRole("button", { name: en.shell.update }))
  expect(useAppStore.getState().panelOpen).toBe(true)
  expect(screen.getByRole("button", { name: en.shell.reinstall })).toBeInTheDocument()
})

it("reinstalls an installed runtime through the run panel", async () => {
  useAppStore.setState({
    detections: { node: { installed: true, version: "v20.0.0" } },
    paths: { os: "mac" } as never,
  })
  renderEnv()
  await userEvent.click(screen.getByRole("button", { name: en.shell.reinstall }))
  expect(useAppStore.getState().panelOpen).toBe(true)
})

it("offers a download link (not Update/Reinstall) when the manager doesn't own the runtime", async () => {
  // Node on macOS updates via brew; a confirmed `false` ownership means it came
  // from somewhere brew can't touch (the installer / nvm), so the in-place
  // actions are replaced by a link to the vendor's download page.
  useAppStore.setState({
    detections: { node: { installed: true, version: "v20.0.0" } },
    runtimeOwned: { node: false },
    paths: { os: "mac" } as never,
  })
  renderEnv()
  expect(screen.queryByRole("button", { name: en.shell.update })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: en.shell.reinstall })).not.toBeInTheDocument()
  const link = screen.getByRole("button", { name: new RegExp(en.shell.downloadLatest, "i") })
  await userEvent.click(link)
  expect(openUrl).toHaveBeenCalledWith("https://nodejs.org/en/download")
  // The run panel is NOT opened — this is an external link, not an install.
  expect(useAppStore.getState().panelOpen).toBe(false)
})

it("keeps Update/Reinstall while ownership is still unknown (probe pending)", () => {
  // runtimeOwned absent = unknown: don't hide the actions on an unconfirmed guess.
  useAppStore.setState({
    detections: { node: { installed: true, version: "v20.0.0" } },
    paths: { os: "mac" } as never,
  })
  renderEnv()
  expect(screen.getByRole("button", { name: en.shell.update })).toBeInTheDocument()
  expect(
    screen.queryByRole("button", { name: new RegExp(en.shell.downloadLatest, "i") })
  ).not.toBeInTheDocument()
})

it("keeps Update/Reinstall for a self-updating runtime even when not owned", () => {
  // uv self-updates (no winget/brew), so runtimePkgManager returns undefined and
  // a `false` ownership flag must NOT suppress its actions.
  useAppStore.setState({
    detections: { uv: { installed: true, version: "0.5.0" } },
    runtimeOwned: { uv: false },
    paths: { os: "win" } as never,
  })
  renderEnv()
  expect(screen.getByRole("button", { name: en.shell.update })).toBeInTheDocument()
})

it("shows a re-detect button that calls refresh, and hides it without a handler", async () => {
  const refresh = jest.fn(async () => {})
  render(
    <I18nProvider>
      <RunnerHarness autoApply>
        <EnvironmentSection refresh={refresh} />
      </RunnerHarness>
    </I18nProvider>
  )
  await userEvent.click(screen.getByRole("button", { name: en.environment.recheck }))
  expect(refresh).toHaveBeenCalled()
})

it("renders no re-detect button when no refresh handler is passed", () => {
  renderEnv()
  expect(screen.queryByRole("button", { name: en.environment.recheck })).not.toBeInTheDocument()
})

it("shows unmeasured runtime totals until detection has completed", () => {
  renderEnv()

  // Two of the three facts are unmeasured; the catalog size is a real number,
  // and the one reason they're unmeasured is stated once for the line.
  const summary = screen.getByRole("region", { name: en.environment.summaryLabel })
  expect(within(summary).getAllByText("—")).toHaveLength(2)
  expect(within(summary).getByText(en.environment.metricPending)).toBeInTheDocument()
})

it("replaces the re-detect label while detection is running", async () => {
  const refresh = jest.fn(() => new Promise<void>(() => {}))
  render(
    <I18nProvider>
      <RunnerHarness autoApply>
        <EnvironmentSection refresh={refresh} />
      </RunnerHarness>
    </I18nProvider>
  )

  await userEvent.click(screen.getByRole("button", { name: en.environment.recheck }))
  expect(screen.getByRole("button", { name: en.environment.detecting })).toBeDisabled()
})

it("organizes runtime status, catalog, and detection controls as one workbench", () => {
  useAppStore.setState({
    detections: {
      node: { installed: true, version: "v20.11.0" },
      bun: { installed: false },
    },
  })
  renderEnv()

  expect(screen.getByRole("region", { name: en.environment.summaryLabel })).toBeInTheDocument()
  expect(screen.getByRole("region", { name: en.environment.catalogPanel })).toBeInTheDocument()
  expect(
    screen.getByRole("complementary", { name: en.environment.actionsLabel })
  ).toBeInTheDocument()
})

it("hides Update + Reinstall where a runtime has no automated path (Linux node)", () => {
  useAppStore.setState({
    detections: { node: { installed: true, version: "v20.0.0" } },
    paths: { os: "linux" } as never,
  })
  renderEnv()
  expect(screen.queryByRole("button", { name: en.shell.update })).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: en.shell.reinstall })).not.toBeInTheDocument()
})
