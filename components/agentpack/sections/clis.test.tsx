import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { RunnerHarness } from "../run/__testing__/harness"
import { useAppStore } from "@/store/app-store"
import { ClisSection } from "./clis"
import { CLI_TOOLS } from "@/lib/agentpack/registry"
import { en } from "@/lib/i18n/en"

beforeEach(() => {
  useAppStore.getState().resetPlan()
  useAppStore.setState({ detections: {}, latestVersions: {}, cliManagers: {} })
})

function renderClis(props: { onOpenRuntimes?: () => void } = {}) {
  return render(
    <I18nProvider>
      <RunnerHarness autoApply>
        <ClisSection {...props} />
      </RunnerHarness>
    </I18nProvider>
  )
}

it("shows detected version from the store and toggles selection", async () => {
  useAppStore.setState({
    detections: { "claude-code": { installed: true, version: "1.2.3" } },
  })
  renderClis()
  expect(await screen.findAllByText(/1\.2\.3/)).not.toHaveLength(0)
  await userEvent.click(screen.getAllByRole("checkbox")[0])
  expect(useAppStore.getState().plan.clis.length).toBeGreaterThan(0)
})

it("offers an upgrade action when a newer version is available", () => {
  useAppStore.setState({
    detections: { "claude-code": { installed: true, version: "1.0.0" } },
    latestVersions: { "claude-code": "2.0.0" },
  })
  renderClis()
  expect(screen.getByRole("button", { name: /Upgrade/i })).toBeInTheDocument()
})

it("shows a latest badge and no upgrade when already current", () => {
  useAppStore.setState({
    detections: { "claude-code": { installed: true, version: "2.0.0" } },
    latestVersions: { "claude-code": "2.0.0" },
  })
  renderClis()
  expect(screen.queryByRole("button", { name: /Upgrade/i })).not.toBeInTheDocument()
  expect(screen.getByText("latest")).toBeInTheDocument()
})

it("hides the upgrade button when the latest version is unknown", () => {
  useAppStore.setState({ detections: { "claude-code": { installed: true, version: "1.0.0" } } })
  renderClis()
  expect(screen.queryByRole("button", { name: /Upgrade/i })).not.toBeInTheDocument()
})

it("runs an upgrade step when the upgrade button is clicked", async () => {
  useAppStore.setState({
    detections: { "claude-code": { installed: true, version: "1.0.0" } },
    latestVersions: { "claude-code": "2.0.0" },
    paths: { os: "mac" } as never,
    panelOpen: false,
  })
  renderClis()
  await userEvent.click(screen.getByRole("button", { name: /Upgrade/i }))
  expect(useAppStore.getState().panelOpen).toBe(true)
})

it("refuses an upgrade npm would reject on this Node, and points at Runtimes", async () => {
  // claude-code declares an engines.node floor of 22; this machine has 18, so
  // Upgrade would stage a command that dies mid-install with EBADENGINE. The
  // row still says an update exists — it just sends you to the fix that
  // unblocks it, exactly as the overview's diagnostics do.
  useAppStore.setState({
    detections: {
      "claude-code": { installed: true, version: "1.0.0" },
      node: { installed: true, version: "v18.19.0" },
    },
    latestVersions: { "claude-code": "2.0.0" },
    paths: { os: "mac" } as never,
    panelOpen: false,
  })
  const onOpenRuntimes = jest.fn()
  renderClis({ onOpenRuntimes })

  expect(screen.queryByRole("button", { name: /Upgrade/i })).not.toBeInTheDocument()
  expect(screen.getByText(en.diagnostics.nodeFloorDetail(22, "v18.19.0"))).toBeInTheDocument()

  await userEvent.click(screen.getByRole("button", { name: en.diagnostics.openRuntimes }))
  expect(onOpenRuntimes).toHaveBeenCalled()
  // Nothing was staged: the review panel never opened.
  expect(useAppStore.getState().panelOpen).toBe(false)
})

it("keeps the upgrade when Node clears the floor", () => {
  useAppStore.setState({
    detections: {
      "claude-code": { installed: true, version: "1.0.0" },
      node: { installed: true, version: "v22.14.0" },
    },
    latestVersions: { "claude-code": "2.0.0" },
  })
  renderClis()
  expect(screen.getByRole("button", { name: /Upgrade/i })).toBeInTheDocument()
})

it("leaves a native install alone, because its upgrade never touches npm", () => {
  useAppStore.setState({
    detections: {
      "claude-code": { installed: true, version: "1.0.0" },
      node: { installed: true, version: "v18.19.0" },
    },
    latestVersions: { "claude-code": "2.0.0" },
    cliManagers: { "claude-code": "native" },
  })
  renderClis()
  expect(screen.getByRole("button", { name: /Upgrade/i })).toBeInTheDocument()
})

it("says nothing about Node when Node itself was never detected", () => {
  // Absent is not the same as too old — an install picks up a current LTS.
  useAppStore.setState({
    detections: { "claude-code": { installed: true, version: "1.0.0" } },
    latestVersions: { "claude-code": "2.0.0" },
  })
  renderClis()
  expect(screen.getByRole("button", { name: /Upgrade/i })).toBeInTheDocument()
})

it("shows a not-found badge for a detected-but-missing tool", () => {
  useAppStore.setState({ detections: { "claude-code": { installed: false } } })
  renderClis()
  expect(screen.getAllByText(/not found/i).length).toBeGreaterThan(0)
})

it("renders every catalog tool under its kind heading, agents first", () => {
  const { container } = renderClis()
  const catalog = screen.getByRole("region", { name: en.tools.catalogPanel })
  const headings = within(catalog)
    .getAllByRole("heading", { level: 3 })
    .map((h) => h.textContent)
  expect(headings).toEqual(["Coding agents", "Companions"])
  // Grouped, not dropped: every tool still gets exactly one card.
  expect(screen.getAllByRole("checkbox")).toHaveLength(CLI_TOOLS.length)
  for (const tool of CLI_TOOLS) {
    expect(container.querySelector(`#cli-${tool.id}`)).not.toBeNull()
    expect(screen.getByText(en.catalog.cli[tool.id].title)).toBeInTheDocument()
  }
})

it("organizes CLI status, catalog, and selection guidance as one workbench", () => {
  useAppStore.setState({
    detections: {
      "claude-code": { installed: true, version: "1.2.3" },
      codex: { installed: false },
    },
    latestVersions: { "claude-code": "2.0.0" },
  })
  renderClis()

  expect(screen.getByRole("region", { name: en.tools.summaryLabel })).toBeInTheDocument()
  expect(screen.getByRole("region", { name: en.tools.catalogPanel })).toBeInTheDocument()
  expect(screen.getByRole("complementary", { name: en.tools.actionsLabel })).toBeInTheDocument()
  expect(screen.getByText(en.tools.overviewTitle)).toBeInTheDocument()
})

it("does not report zero installed tools before detection has completed", () => {
  renderClis()

  const summary = screen.getByRole("region", { name: en.tools.summaryLabel })
  expect(within(summary).getAllByText("—")).toHaveLength(2)
})

it("puts the third-party agents in the agent group, not among the companions", () => {
  const { container } = renderClis()
  const groupOf = (name: string) =>
    screen.getByRole("heading", { name }).closest("section") as HTMLElement
  const row = (id: string) => container.querySelector(`#cli-${id}`) as HTMLElement
  const agents = groupOf("Coding agents")
  for (const id of ["gemini-cli", "qwen-code", "amp", "droid", "cursor-cli"]) {
    expect(agents).toContainElement(row(id))
  }
  const companions = groupOf("Companions")
  expect(companions).toContainElement(row("cc-switch"))
  expect(companions).not.toContainElement(row("gemini-cli"))
})
