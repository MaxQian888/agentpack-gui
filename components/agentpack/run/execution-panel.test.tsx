import type { StepReport } from "@/lib/agentpack/types"

interface Ctx {
  reports: StepReport[]
  running: boolean
  dryRun: boolean
  awaitingConfirm: boolean
  confirm: jest.Mock
  retry: jest.Mock
  cancel: jest.Mock
}

const ctx: Ctx = {
  reports: [],
  running: false,
  dryRun: false,
  awaitingConfirm: false,
  confirm: jest.fn(),
  retry: jest.fn(),
  cancel: jest.fn(),
}

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
  Object.assign(ctx, {
    reports: [],
    running: false,
    dryRun: false,
    awaitingConfirm: false,
    confirm: jest.fn(),
    retry: jest.fn(),
    cancel: jest.fn(),
  })
  useAppStore.setState({ paths: { os: "mac" } as never, panelOpen: true })
})

function renderPanel() {
  return render(
    <I18nProvider>
      <ExecutionPanel />
    </I18nProvider>
  )
}

it("shows a confirm gate while awaiting confirmation", async () => {
  ctx.awaitingConfirm = true
  ctx.reports = [{ ...done, status: "pending" }]
  renderPanel()
  const proceed = screen.getByRole("button", { name: /proceed/i })
  await userEvent.click(proceed)
  expect(ctx.confirm).toHaveBeenCalled()
})

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

it("hides retry when finished without errors and renders a dry-run badge", () => {
  ctx.reports = [done]
  ctx.dryRun = true
  renderPanel()
  expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument()
  // The dry-run badge surfaces the preview label in the panel title.
  expect(screen.getByText(en.shell.preview)).toBeInTheDocument()
})
