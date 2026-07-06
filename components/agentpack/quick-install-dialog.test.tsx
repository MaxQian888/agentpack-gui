jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))

import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { CLI_TOOLS, MCP_SERVERS, SKILLS } from "@/lib/agentpack/registry"
import { useAppStore } from "@/store/app-store"
import { QuickInstallDialog, matchPreset } from "./quick-install-dialog"
import type { Plan } from "@/lib/agentpack/types"

beforeEach(() => {
  useAppStore.setState({ dryRun: false, detections: {} })
  useAppStore.getState().resetPlan()
})

function renderDialog(overrides: Partial<React.ComponentProps<typeof QuickInstallDialog>> = {}) {
  const onInstall = jest.fn()
  const onClose = jest.fn()
  render(
    <I18nProvider>
      <QuickInstallDialog open onInstall={onInstall} onClose={onClose} {...overrides} />
    </I18nProvider>
  )
  return { onInstall, onClose }
}

it("renders the one-page selection with every CLI, skill and MCP server", () => {
  renderDialog()
  expect(screen.getByRole("heading", { name: en.installDialog.title })).toBeInTheDocument()
  // A checkbox per catalog entry across the three groups.
  expect(screen.getAllByRole("checkbox")).toHaveLength(
    CLI_TOOLS.length + SKILLS.length + MCP_SERVERS.length
  )
})

it("applies a bundle to the shared plan and marks the chip active", async () => {
  renderDialog()
  await userEvent.click(screen.getByRole("button", { name: en.presets.everything.title }))
  // "everything" selects every CLI/skill/MCP id in the registry.
  expect(useAppStore.getState().plan.clis).toEqual(CLI_TOOLS.map((c) => c.id))
  expect(screen.getByRole("button", { name: en.presets.everything.title })).toHaveAttribute(
    "aria-pressed",
    "true"
  )
})

it("switches to Custom when a single item is toggled off a preset", async () => {
  renderDialog()
  await userEvent.click(screen.getByRole("button", { name: en.presets.everything.title }))
  // Untick one CLI — the plan no longer matches any preset.
  const claudeTitle = en.catalog.cli["claude-code"].title
  await userEvent.click(screen.getByRole("checkbox", { name: claudeTitle }))
  expect(useAppStore.getState().plan.clis).not.toContain("claude-code")
  expect(screen.getByRole("button", { name: en.installDialog.custom })).toHaveAttribute(
    "aria-pressed",
    "true"
  )
})

it("Custom clears the plan back to empty", async () => {
  renderDialog()
  await userEvent.click(screen.getByRole("button", { name: en.presets.recommended.title }))
  expect(useAppStore.getState().plan.clis.length).toBeGreaterThan(0)
  await userEvent.click(screen.getByRole("button", { name: en.installDialog.custom }))
  expect(useAppStore.getState().plan.clis).toHaveLength(0)
})

it("disables Install while nothing is selected, enabling it after a pick", async () => {
  const { onInstall } = renderDialog()
  const installBtn = screen.getByRole("button", { name: en.installDialog.install })
  expect(installBtn).toBeDisabled()
  await userEvent.click(screen.getByRole("button", { name: en.presets.minimal.title }))
  expect(screen.getByRole("button", { name: en.installDialog.install })).toBeEnabled()
  await userEvent.click(screen.getByRole("button", { name: en.installDialog.install }))
  expect(onInstall).toHaveBeenCalled()
})

it("marks an already-installed CLI with an installed indicator", () => {
  useAppStore.setState({ detections: { "claude-code": { installed: true, version: "1.0.0" } } })
  renderDialog()
  expect(screen.getByLabelText(en.envcheck.installed)).toBeInTheDocument()
})

it("preview toggle flips the shared dry-run flag and relabels Install", async () => {
  renderDialog()
  await userEvent.click(screen.getByRole("switch"))
  expect(useAppStore.getState().dryRun).toBe(true)
  expect(screen.getByRole("button", { name: en.installDialog.installPreview })).toBeInTheDocument()
})

it("closes via Cancel", async () => {
  const { onClose } = renderDialog()
  await userEvent.click(screen.getByRole("button", { name: en.shell.cancel }))
  expect(onClose).toHaveBeenCalled()
})

it("renders nothing when closed", () => {
  renderDialog({ open: false })
  expect(screen.queryByText(en.installDialog.title)).not.toBeInTheDocument()
})

it("shows a single dialog", () => {
  renderDialog()
  const dialog = screen.getByRole("dialog")
  expect(within(dialog).getByRole("heading", { name: en.installDialog.title })).toBeInTheDocument()
})

describe("matchPreset", () => {
  const plan = (over: Partial<Plan>): Plan => ({
    os: "mac",
    clis: [],
    skills: [],
    mcps: [],
    mcpKeys: {},
    network: {},
    ...over,
  })

  it("recognizes the minimal bundle by its id sets", () => {
    expect(
      matchPreset(plan({ clis: ["claude-code"], mcps: [{ id: "memory", targets: ["claude"] }] }))
    ).toBe("minimal")
  })

  it("falls back to custom when nothing matches", () => {
    expect(matchPreset(plan({ clis: ["codex"] }))).toBe("custom")
  })
})
