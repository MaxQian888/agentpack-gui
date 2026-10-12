jest.mock("@/lib/tauri", () => ({ isTauri: () => true }))
jest.mock("@/lib/tauri/activity", () => ({ appendActivity: jest.fn(async () => []) }))
const mockSignedOut = { signedIn: false, mode: null, plan: null, expiresAt: null, source: "x" }
jest.mock("@/lib/tauri/commands", () => ({
  loginStatus: jest.fn(async () => ({
    claude: mockSignedOut,
    codex: mockSignedOut,
    opencode: mockSignedOut,
  })),
  launchAgentLogin: jest.fn(async () => undefined),
  httpGet: jest.fn(async () => ({ status: 200, latencyMs: 40, body: "{}", error: null })),
}))
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() },
}))
// The runner's executor, so a test decides how each step ends — and, with
// `holdRun`, when.
let holdRun: Promise<void> | null = null
jest.mock("@/lib/agentpack/runner", () => ({
  runSteps: jest.fn(
    async (
      steps: { id: string; label: string }[],
      o: { onUpdate: (r: unknown, i: number) => void }
    ) => {
      if (holdRun) await holdRun
      const reports = steps.map((s) => ({
        id: s.id,
        label: s.label,
        status: s.label === "FAIL" ? "error" : "done",
        output: [],
      }))
      reports.forEach((r, i) => o.onUpdate(r, i))
      return reports
    }
  ),
}))

import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nProvider } from "@/lib/i18n/provider"
import { en } from "@/lib/i18n/en"
import type { NetworkProbeResult, RankedProxy } from "@/lib/agentpack/network/probe"
import type { StepDescriptor } from "@/lib/agentpack/types"
import { runSteps } from "@/lib/agentpack/runner"
import { useAppStore } from "@/store/app-store"
import { RunnerProvider, useRunnerCtx } from "./run/runner-context"
import { OnboardingDialog, type StageOutcome, type WizardAnswer } from "./onboarding-dialog"

const w = en.welcome

/** A probe result where the direct route works and no mirror beats the default. */
const healthyProbe: NetworkProbeResult = {
  proxies: [],
  bestProxy: null,
  directOk: true,
  npm: [],
  gh: [],
  pypi: [],
  brew: [],
  pacUrl: null,
}

const clash: RankedProxy = {
  id: "port:clash",
  source: "port",
  url: "http://127.0.0.1:7890",
  detail: "Clash",
  result: { ok: true, status: 200, latencyMs: 62, reason: "ok" },
}

const step = (id: string, label = id): StepDescriptor => ({
  kind: "command",
  id,
  label,
  command: { file: "x", args: [] },
})

beforeEach(() => {
  holdRun = null
  jest.clearAllMocks()
  useAppStore.getState().resetPlan()
  useAppStore.setState({ paths: { os: "mac", home: "/h" } as never, panelOpen: false })
  useAppStore.getState().setNetworkProbe(healthyProbe)
  useAppStore.getState().setNetworkProbing(false)
})

/**
 * Renders the wizard inside a real runner. `onStage` stands in for the shell:
 * it stages `steps` inline exactly as `stageReview({ inline: true })` does, or
 * reports the outcome it is told to.
 */
function renderWizard({
  outcome = "staged",
  steps = [step("cli-claude-code", "Install Claude Code")],
  progress = null,
}: {
  outcome?: StageOutcome
  steps?: StepDescriptor[]
  progress?: React.ComponentProps<typeof OnboardingDialog>["progress"]
} = {}) {
  const answers: WizardAnswer[] = []
  const props = {
    onProgress: jest.fn(),
    onApplied: jest.fn(),
    onLater: jest.fn(),
    onSuspend: jest.fn(),
    onClose: jest.fn(),
    onNavigate: jest.fn(),
  }
  function Wizard() {
    const runner = useRunnerCtx()
    return (
      <OnboardingDialog
        open
        progress={progress}
        {...props}
        onStage={async (answer) => {
          answers.push(answer)
          if (outcome !== "staged") return outcome
          void runner.run(steps, { inline: true })
          return "staged"
        }}
      />
    )
  }
  render(
    <I18nProvider>
      <RunnerProvider>
        <Wizard />
      </RunnerProvider>
    </I18nProvider>
  )
  return { ...props, answers }
}

const cont = () => userEvent.click(screen.getByRole("button", { name: w.continue }))
/** Agent → connect (official, the default) → review, on a network that needs no proxy. */
const toReview = async () => {
  await cont()
  await cont()
}
const installNow = () => screen.getByRole("button", { name: w.installNow })

describe("the agent question", () => {
  it("leads with Claude Code in the terminal, no desktop app, and names the extras", () => {
    renderWizard()
    expect(screen.getByRole("radio", { name: new RegExp(`^${w.agentClaude}`) })).toBeChecked()
    expect(screen.getByText(w.recommendedTag)).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: new RegExp(w.desktopLabel) })).not.toBeChecked()
    expect(screen.getByText(w.coreNote)).toBeInTheDocument()
  })

  it("asks nothing else: no bundle, no skills, no API keys, no tour detour", () => {
    renderWizard()
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    expect(screen.queryByText(en.catalog.skills.rust.title)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: new RegExp(en.tour.start) })).toBeNull()
  })

  it("reports each answer, so a suspended wizard can resume it", async () => {
    const { onProgress } = renderWizard()
    await userEvent.click(screen.getByRole("radio", { name: new RegExp(`^${w.agentCodex}`) }))
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ agent: "codex" }))
  })

  it("resumes on the answer it was left with, and ignores an older version's progress", () => {
    renderWizard({ progress: { step: "agent", agent: "both", desktop: true } })
    expect(screen.getByRole("radio", { name: new RegExp(`^${w.agentBoth}`) })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: new RegExp(w.desktopLabel) })).toBeChecked()
  })

  it("falls back to the first question for a step this version doesn't have", () => {
    renderWizard({ progress: { step: "bundle" } })
    expect(screen.getByText(w.agentLabel)).toBeInTheDocument()
  })
})

describe("the connect step", () => {
  it("holds Continue until a key is typed, never for the test, and keeps the key out of progress", async () => {
    const { answers, onProgress } = renderWizard()
    await cont()
    expect(screen.getByText(w.connectIntro)).toBeInTheDocument()
    await userEvent.click(screen.getByRole("radio", { name: new RegExp(w.connectApiKey) }))
    expect(screen.getByRole("button", { name: w.continue })).toBeDisabled()

    await userEvent.type(screen.getByLabelText(`${w.agentClaude} ${w.fieldKey}`), "sk-ant")
    await cont()
    await waitFor(() =>
      expect(answers.at(-1)?.connections).toEqual({
        claude: { kind: "apiKey", baseUrl: "", token: "sk-ant" },
      })
    )
    // A key is never part of what a suspended wizard saves.
    expect(JSON.stringify(onProgress.mock.calls)).not.toContain("sk-ant")
  })
})

describe("the network step", () => {
  it("is skipped on a network that needs no proxy", async () => {
    renderWizard()
    expect(screen.getByText(en.tour.progress(1, 3))).toBeInTheDocument()
    await toReview()
    expect(screen.getByText(w.reviewIntro)).toBeInTheDocument()
  })

  it("asks about a proxy the machine needs, kept by default", async () => {
    useAppStore.getState().setNetworkProbe({
      ...healthyProbe,
      directOk: false,
      bestProxy: clash,
      proxies: [clash],
    })
    const { answers } = renderWizard()
    expect(screen.getByText(en.tour.progress(1, 4))).toBeInTheDocument()
    await cont()
    await cont()
    const keep = screen.getByRole("checkbox", { name: new RegExp(w.proxyAdopt) })
    expect(keep).toBeChecked()
    expect(screen.getByText(en.network.probe.proxyFound("127.0.0.1:7890", 62))).toBeInTheDocument()

    // Declining keeps the direct connection, and the staged answer says so.
    await userEvent.click(keep)
    await cont()
    await waitFor(() => expect(answers.at(-1)).toMatchObject({ proxy: false }))
  })

  it("stays in while the probe is still measuring, and says so", async () => {
    useAppStore.getState().setNetworkProbe(null)
    useAppStore.getState().setNetworkProbing(true)
    renderWizard()
    await cont()
    await cont()
    expect(screen.getByText(en.network.probe.running)).toBeInTheDocument()
  })
})

describe("the review step", () => {
  it("stages the answer and draws the real review, with the only Apply", async () => {
    const { answers } = renderWizard()
    await userEvent.click(screen.getByRole("radio", { name: new RegExp(`^${w.agentCodex}`) }))
    await userEvent.click(screen.getByRole("checkbox", { name: new RegExp(w.desktopLabel) }))
    await toReview()

    expect(await screen.findByText("Install Claude Code")).toBeInTheDocument()
    expect(answers).toEqual([
      {
        agent: "codex",
        desktop: true,
        proxy: true,
        mirrors: true,
        connections: { codex: { kind: "official", baseUrl: "", token: "" } },
      },
    ])
    // Drawn here, not in the side panel.
    expect(useAppStore.getState().panelOpen).toBe(false)
    expect(installNow()).toBeEnabled()
    // Nothing has run, and there is no Preview to misread.
    expect(runSteps).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: en.review.previewOnly })).toBeNull()
  })

  it("Install now records the yes, runs in place, and ends on Done", async () => {
    const { onApplied, onClose } = renderWizard()
    await toReview()
    await waitFor(() => expect(installNow()).toBeEnabled())
    await userEvent.click(installNow())

    expect(onApplied).toHaveBeenCalledWith(undefined)
    expect(await screen.findByText(w.finishedIntro)).toBeInTheDocument()
    expect(screen.getByText(en.completion.done)).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: w.done }))
    expect(onClose).toHaveBeenCalled()
  })

  it("follows an official install with its sign-in", async () => {
    renderWizard()
    await toReview()
    await waitFor(() => expect(installNow()).toBeEnabled())
    await userEvent.click(installNow())
    expect(await screen.findByText(w.signInTitle)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: w.signInOpen })).toBeInTheDocument()
  })

  it("offers no sign-in for an agent whose install failed", async () => {
    renderWizard({ steps: [step("cli-claude-code", "FAIL")] })
    await toReview()
    await waitFor(() => expect(installNow()).toBeEnabled())
    await userEvent.click(installNow())
    await screen.findByRole("button", { name: en.shell.retry })
    expect(screen.queryByText(w.signInTitle)).toBeNull()
  })

  it("offers Retry in place when a step fails", async () => {
    renderWizard({ steps: [step("a", "FAIL")] })
    await toReview()
    await waitFor(() => expect(installNow()).toBeEnabled())
    await userEvent.click(installNow())
    expect(await screen.findByRole("button", { name: en.shell.retry })).toBeInTheDocument()
  })

  it("Back drops the staged steps rather than leaving them waiting", async () => {
    renderWizard()
    await toReview()
    await screen.findByText("Install Claude Code")
    await userEvent.click(screen.getByRole("button", { name: en.tour.back }))
    expect(screen.getByText(w.connectIntro)).toBeInTheDocument()
    expect(screen.queryByText("Install Claude Code")).not.toBeInTheDocument()
  })

  it("names a faster mirror in one line, and restages without it on request", async () => {
    useAppStore.getState().setNetworkProbe({
      ...healthyProbe,
      npm: [
        {
          preset: { id: "npmmirror", label: "npmmirror", url: "https://m", probeUrl: "x" },
          result: { ok: true, status: 200, latencyMs: 30, reason: "ok" },
        },
        {
          preset: { id: "npmjs", label: "npmjs", url: null, probeUrl: "x" },
          result: { ok: false, reason: "timeout" },
        },
      ],
    })
    const { answers } = renderWizard()
    await toReview()
    const note = w.mirrorNote("npmmirror (npm)")
    expect(await screen.findByText(note, { exact: false })).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: w.mirrorDecline }))
    await waitFor(() => expect(answers.at(-1)).toMatchObject({ mirrors: false }))
    expect(screen.queryByText(note, { exact: false })).toBeNull()
  })

  it("says so when everything picked is already installed, and Done is a deliberate exit", async () => {
    const { onLater } = renderWizard({ outcome: "empty" })
    await toReview()
    expect(await screen.findByText(w.nothingToDo)).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: w.done }))
    expect(onLater).toHaveBeenCalled()
  })

  it("says installing needs the desktop app when there is nothing to install with", async () => {
    renderWizard({ outcome: "unavailable" })
    await toReview()
    expect(await screen.findByText(w.unavailable)).toBeInTheDocument()
  })

  it("offers to try again when the machine couldn't be read", async () => {
    const { answers } = renderWizard({ outcome: "failed" })
    await toReview()
    await userEvent.click(await screen.findByRole("button", { name: w.tryAgain }))
    await waitFor(() => expect(answers).toHaveLength(2))
  })
})

describe("leaving", () => {
  it("Maybe later is a deliberate no", async () => {
    const { onLater, onSuspend } = renderWizard()
    await userEvent.click(screen.getByRole("button", { name: w.later }))
    expect(onLater).toHaveBeenCalled()
    expect(onSuspend).not.toHaveBeenCalled()
  })

  it("Escape before Install now only suspends", async () => {
    const { onLater, onSuspend } = renderWizard()
    await toReview()
    await screen.findByText("Install Claude Code")
    await userEvent.keyboard("{Escape}")
    expect(onSuspend).toHaveBeenCalled()
    expect(onLater).not.toHaveBeenCalled()
  })

  it("Escape mid-run hands the run to the side panel instead of hiding it", async () => {
    let release!: () => void
    holdRun = new Promise((r) => (release = r))
    const { onClose, onSuspend } = renderWizard()
    await toReview()
    await waitFor(() => expect(installNow()).toBeEnabled())
    await userEvent.click(installNow())
    expect(await screen.findByText(w.installingIntro)).toBeInTheDocument()

    await userEvent.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalled()
    expect(onSuspend).not.toHaveBeenCalled()
    expect(useAppStore.getState().panelOpen).toBe(true)
    await act(async () => release())
  })
})
