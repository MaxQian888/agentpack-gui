jest.mock("@/lib/tauri/commands", () => ({ launchApp: jest.fn(async () => undefined) }))
jest.mock("@/lib/tauri/clipboard", () => ({ copyText: jest.fn(async () => true) }))

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import { launchApp } from "@/lib/tauri/commands"
import { useAppStore } from "@/store/app-store"
import { Completion } from "./completion"
import type { StepReport } from "@/lib/agentpack/types"

const done: StepReport[] = [{ id: "a", label: "A", status: "done", output: [] }]

beforeEach(() => {
  jest.clearAllMocks()
  useAppStore.getState().resetPlan()
  // resetPlan deliberately keeps mcpKeys and network — they're the user's own
  // environment, not part of a bundle — so a test that sets a key would leak
  // into every test after it. Clear them here to keep the file order-independent.
  useAppStore.setState((s) => ({ plan: { ...s.plan, mcpKeys: {}, network: {} } }))
  useAppStore.getState().setOsOverride(null)
})

function renderCompletion(reports: StepReport[] = done, dryRun = false, cancelled = false) {
  return render(
    <I18nProvider>
      <Completion reports={reports} dryRun={dryRun} cancelled={cancelled} />
    </I18nProvider>
  )
}

describe("the verdict", () => {
  it("says plainly that it worked", () => {
    renderCompletion()
    expect(screen.getByText(en.completion.done)).toBeInTheDocument()
  })

  it("does not claim success when a step failed", () => {
    renderCompletion([...done, { id: "b", label: "Broken", status: "error", output: [] }])
    expect(screen.getByText(en.completion.partial)).toBeInTheDocument()
    expect(screen.queryByText(en.completion.done)).not.toBeInTheDocument()
  })

  it("keeps the dry-run headline distinct from a real one", () => {
    renderCompletion(done, true)
    expect(screen.getByText(en.summary.dryRunComplete)).toBeInTheDocument()
  })

  it("keeps the full log, one disclosure away", async () => {
    renderCompletion([{ id: "a", label: "Broken", status: "error", output: [], error: "nope" }])
    await userEvent.click(screen.getByText(en.completion.details))
    expect(screen.getByText(/Broken/)).toBeInTheDocument()
  })

  /**
   * `warning` and `skipped` used not to count at all, so both of these landed on
   * a green tick and "All set" — the two states most likely to mean the user's
   * machine is not, in fact, all set.
   */
  it("does not claim success for a run the user stopped", () => {
    renderCompletion(
      [...done, { id: "b", label: "Never ran", status: "skipped", output: [] }],
      false,
      true
    )
    expect(screen.getByText(en.completion.cancelled)).toBeInTheDocument()
    expect(screen.queryByText(en.completion.done)).not.toBeInTheDocument()
  })

  it("does not claim plain success when a step raised a warning", () => {
    renderCompletion([...done, { id: "b", label: "Needs a hand", status: "warning", output: [] }])
    expect(screen.getByText(en.completion.withWarnings)).toBeInTheDocument()
    expect(screen.queryByText(en.completion.done)).not.toBeInTheDocument()
  })

  it("shows the warnings themselves rather than burying them in the log", () => {
    renderCompletion([...done, { id: "b", label: "Needs a hand", status: "warning", output: [] }])
    // Visible without opening the disclosure.
    expect(screen.getByText("Needs a hand")).toBeInTheDocument()
  })

  it("counts every outcome, not just the successes and failures", () => {
    renderCompletion([
      ...done,
      { id: "b", label: "Warned", status: "warning", output: [] },
      { id: "c", label: "Broke", status: "error", output: [] },
    ])
    expect(screen.getByText(en.completion.counts(1, 1, 1))).toBeInTheDocument()
  })

  it("still reports a failure as a failure even when there are warnings too", () => {
    renderCompletion([
      { id: "b", label: "Warned", status: "warning", output: [] },
      { id: "c", label: "Broke", status: "error", output: [] },
    ])
    expect(screen.getByText(en.completion.partial)).toBeInTheDocument()
  })
})

describe("the one next action", () => {
  it("opens the desktop app that was just installed", async () => {
    useAppStore.getState().setClis(["claude-desktop"])
    renderCompletion()
    await userEvent.click(screen.getByRole("button", { name: /Open Claude Desktop/i }))
    expect(launchApp).toHaveBeenCalledWith("Claude")
  })

  it("prefers Claude when both apps were installed, rather than offering two", () => {
    useAppStore.getState().setClis(["codex-app", "claude-desktop"])
    renderCompletion()
    expect(screen.getByRole("button", { name: /Open Claude Desktop/i })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Open Codex/i })).not.toBeInTheDocument()
  })

  it("offers the command to copy when there is no app, only a CLI", () => {
    useAppStore.getState().setClis(["claude-code"])
    renderCompletion()
    expect(screen.getByText(en.completion.cliHint)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "claude" })).toBeInTheDocument()
  })

  it("offers nothing to open after a dry run — nothing was installed", () => {
    useAppStore.getState().setClis(["claude-desktop"])
    renderCompletion(done, true)
    expect(screen.queryByRole("button", { name: /Open/i })).not.toBeInTheDocument()
  })

  it("says so when the app will not open, instead of appearing to do nothing", async () => {
    ;(launchApp as jest.Mock).mockRejectedValueOnce(new Error("could not open Claude"))
    useAppStore.getState().setClis(["claude-desktop"])
    renderCompletion()
    await userEvent.click(screen.getByRole("button", { name: /Open Claude Desktop/i }))
    expect(await screen.findByText(/could not open Claude/)).toBeInTheDocument()
  })
})

describe("what still needs a human", () => {
  it("names an MCP server that installed cleanly but cannot run without its key", () => {
    useAppStore.getState().setMcp("context7", ["claude"])
    renderCompletion()
    expect(screen.getByText(en.completion.todoKey("CONTEXT7_API_KEY"))).toBeInTheDocument()
  })

  it("drops that todo once the key is set", () => {
    useAppStore.getState().setMcp("context7", ["claude"])
    useAppStore.getState().setMcpKey("context7", "sk-x")
    renderCompletion()
    expect(screen.queryByText(en.completion.todoKey("CONTEXT7_API_KEY"))).not.toBeInTheDocument()
  })

  it("tells a desktop user they still have to sign in", () => {
    useAppStore.getState().setClis(["claude-desktop"])
    renderCompletion()
    expect(screen.getByText(en.completion.todoSignIn)).toBeInTheDocument()
  })

  it("asks for Git only on Windows, where local sessions need it", () => {
    useAppStore.getState().setClis(["claude-desktop"])
    useAppStore.getState().setOsOverride("win")
    renderCompletion()
    expect(screen.getByText(en.completion.todoWindowsGit)).toBeInTheDocument()
  })

  it("explains the cc-switch gateway only when it is actually in play", () => {
    useAppStore.getState().setClis(["claude-desktop", "cc-switch"])
    renderCompletion()
    expect(screen.getByText(en.completion.todoCcSwitchGateway)).toBeInTheDocument()
  })

  it("lists no chores after a dry run — nothing changed", () => {
    useAppStore.getState().setClis(["claude-desktop"])
    renderCompletion(done, true)
    expect(screen.queryByText(en.completion.todoTitle)).not.toBeInTheDocument()
  })
})

/**
 * These used to be read off the plan alone, which describes what the user asked
 * for rather than what happened — so a failed install still produced a button
 * offering to open the app, and a failed MCP add still asked for its API key.
 */
describe("what actually installed, not what was asked for", () => {
  const failed = (id: string): StepReport => ({
    id,
    label: id,
    status: "error",
    output: [],
    error: "nope",
  })

  it("does not offer to open an app whose install failed", () => {
    useAppStore.getState().setClis(["claude-desktop"])
    renderCompletion([failed("cli-claude-desktop-brew")])
    expect(screen.queryByRole("button", { name: /Open/i })).not.toBeInTheDocument()
  })

  it("falls back to the CLI command when the app failed but the CLI is in the plan", () => {
    useAppStore.getState().setClis(["claude-desktop", "claude-code"])
    renderCompletion([failed("cli-claude-desktop-brew"), { ...done[0]! }])
    expect(screen.getByRole("button", { name: "claude" })).toBeInTheDocument()
  })

  it("does not ask for the key of a server that never got added", () => {
    useAppStore.getState().setMcp("context7", ["claude"])
    renderCompletion([failed("mcp-claude-context7")])
    expect(screen.queryByText(en.completion.todoKey("CONTEXT7_API_KEY"))).not.toBeInTheDocument()
  })

  // The one-click dedup emits no step for something already installed, so an
  // absent step has to read as "fine", not as "failed".
  it("still asks for the key when the server was skipped as already present", () => {
    useAppStore.getState().setMcp("context7", ["claude"])
    renderCompletion([failed("cli-codex-npm")])
    expect(screen.getByText(en.completion.todoKey("CONTEXT7_API_KEY"))).toBeInTheDocument()
  })

  it("drops the sign-in chore when Claude Desktop itself failed", () => {
    useAppStore.getState().setClis(["claude-desktop"])
    renderCompletion([failed("cli-claude-desktop-brew")])
    expect(screen.queryByText(en.completion.todoSignIn)).not.toBeInTheDocument()
  })
})
