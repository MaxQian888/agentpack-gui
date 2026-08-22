import type { StepDescriptor, StepReport } from "@/lib/agentpack/types"

interface Ctx {
  reports: StepReport[]
  pendingSteps: StepDescriptor[]
  running: boolean
  previewing: boolean
  awaitingConfirm: boolean
  lastWasPreview: boolean
  cancelled: boolean
  previewPending: jest.Mock
  applyPending: jest.Mock
  abandonPending: jest.Mock
  retry: jest.Mock
  cancel: jest.Mock
}

const blank = (): Omit<Ctx, "reports"> => ({
  pendingSteps: [],
  running: false,
  previewing: false,
  awaitingConfirm: false,
  lastWasPreview: false,
  cancelled: false,
  previewPending: jest.fn(),
  applyPending: jest.fn(),
  abandonPending: jest.fn(),
  retry: jest.fn(),
  cancel: jest.fn(),
})

const ctx: Ctx = { reports: [], ...blank() }

jest.mock("./runner-context", () => ({ useRunnerCtx: () => ctx }))

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { useAppStore } from "@/store/app-store"
import { ExecutionPanel } from "./execution-panel"
import { en } from "@/lib/i18n/en"

const done: StepReport = { id: "a", label: "Step A", status: "done", output: [] }
const failed: StepReport = { id: "b", label: "Step B", status: "error", output: [], error: "x" }

beforeEach(() => {
  Object.assign(ctx, { reports: [], ...blank() })
  useAppStore.setState({ paths: { os: "mac" } as never, panelOpen: true })
})

function renderPanel() {
  return render(
    <I18nProvider>
      <ExecutionPanel />
    </I18nProvider>
  )
}

describe("the review gate", () => {
  beforeEach(() => {
    ctx.awaitingConfirm = true
    ctx.reports = [{ ...done, status: "pending" }]
    ctx.pendingSteps = [
      {
        kind: "command",
        id: "cli-x",
        label: "Install X",
        command: { file: "npm", args: ["i"] },
        requiresElevation: true,
      },
    ]
  })

  it("offers preview and apply as two named, separate exits", async () => {
    renderPanel()
    expect(screen.getByText(en.review.stepCount(1))).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: en.review.previewOnly }))
    expect(ctx.previewPending).toHaveBeenCalled()
    expect(ctx.applyPending).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole("button", { name: en.review.apply }))
    expect(ctx.applyPending).toHaveBeenCalled()
  })

  it("keeps Apply available after a preview, and says nothing was written", () => {
    ctx.lastWasPreview = true
    renderPanel()
    expect(screen.getByText(en.review.previewDone)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: en.review.apply })).toBeEnabled()
  })

  it("discarding abandons the staged steps rather than just hiding them", async () => {
    renderPanel()
    await userEvent.click(screen.getByRole("button", { name: en.review.discard }))
    expect(ctx.abandonPending).toHaveBeenCalled()
    expect(useAppStore.getState().panelOpen).toBe(false)
  })

  it("locks both exits while a preview is in flight", () => {
    ctx.previewing = true
    renderPanel()
    expect(screen.getByRole("button", { name: en.review.apply })).toBeDisabled()
    expect(screen.getByText(en.review.previewing).closest("button")).toBeDisabled()
  })
})

describe("running and finished", () => {
  it("shows a cancel button while running", async () => {
    ctx.running = true
    ctx.reports = [{ ...done, status: "running" }]
    renderPanel()
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }))
    expect(ctx.cancel).toHaveBeenCalled()
  })

  it("offers retry and a summary when finished with errors", async () => {
    ctx.reports = [done, failed]
    renderPanel()
    expect(screen.getByText(/Setup complete/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: /retry/i }))
    expect(ctx.retry).toHaveBeenCalled()
  })

  it("hides retry when finished without errors", () => {
    ctx.reports = [done]
    renderPanel()
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument()
  })

  it("reports a finished preview as a preview, not as an install", () => {
    ctx.reports = [done]
    ctx.lastWasPreview = true
    renderPanel()
    expect(screen.getByText(en.summary.dryRunComplete)).toBeInTheDocument()
  })
})

describe("the pre-flight brief", () => {
  beforeEach(() => {
    ctx.awaitingConfirm = true
    ctx.reports = [{ ...done, status: "pending" }]
    ctx.pendingSteps = [
      {
        kind: "command",
        id: "cli-x",
        label: "Install X",
        command: { file: "npm", args: ["i"] },
        requiresElevation: true,
      },
    ]
  })

  it("says in words what the step list says in commands", () => {
    // The password prompt is the single most alarming thing that happens during
    // a first install, and it is knowable before the run rather than during it.
    renderPanel()
    expect(screen.getByText(en.preflight.elevationTitle)).toBeInTheDocument()
  })

  it("goes away once the run starts, because it is no longer about to happen", () => {
    ctx.awaitingConfirm = false
    ctx.running = true
    renderPanel()
    expect(screen.queryByText(en.preflight.elevationTitle)).not.toBeInTheDocument()
  })

  it("stays through a preview, because Apply is still the next decision", () => {
    ctx.lastWasPreview = true
    renderPanel()
    expect(screen.getByText(en.preflight.elevationTitle)).toBeInTheDocument()
  })

  it("says nothing at all about an ordinary run", () => {
    ctx.pendingSteps = [
      { kind: "command", id: "cli-x", label: "Install X", command: { file: "npm", args: ["i"] } },
    ]
    renderPanel()
    expect(screen.queryByRole("region", { name: en.preflight.title })).not.toBeInTheDocument()
  })
})

describe("following a failure to its fix", () => {
  it("closes the panel on the way, so it isn't left over the page it opened", async () => {
    const onNavigate = jest.fn()
    ctx.reports = [{ id: "a", label: "Install A", status: "error", output: ["ENOSPC"] }]
    render(
      <I18nProvider>
        <ExecutionPanel onNavigate={onNavigate} />
      </I18nProvider>
    )
    await userEvent.click(
      screen.getByRole("button", { name: en.failure.openSection(en.menu.cleanup) })
    )
    expect(onNavigate).toHaveBeenCalledWith("cleanup")
    expect(useAppStore.getState().panelOpen).toBe(false)
  })

  it("shows the reading without a destination button when nowhere was wired up", () => {
    ctx.reports = [{ id: "a", label: "Install A", status: "error", output: ["ENOSPC"] }]
    renderPanel()
    expect(screen.getByText(en.failure.diskFullTitle)).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: en.failure.openSection(en.menu.cleanup) })
    ).not.toBeInTheDocument()
  })
})
